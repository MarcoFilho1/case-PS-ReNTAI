from fastapi import FastAPI, Depends, HTTPException, status, Form, File, UploadFile, BackgroundTasks, WebSocket, WebSocketDisconnect, Query
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import text
from contextlib import asynccontextmanager
from database import engine, Base, get_db
import models
import auth
import schemas
from datetime import date
import os
import uuid
import ai_service
from sqlalchemy.orm import selectinload
from typing import List


class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                pass


manager = ConnectionManager()


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        try:
            await conn.execute(text("ALTER TABLE teleconsultations ADD COLUMN IF NOT EXISTS ai_rejection_reason TEXT;"))
        except Exception as e:
            print(f"Erro ao adicionar coluna ai_rejection_reason: {e}")
        try:
            await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS specialty VARCHAR(50);"))
        except Exception as e:
            print(f"Erro ao adicionar coluna specialty em users: {e}")
    yield

app = FastAPI(
    title="Telemedicina API",
    description="API para gestão de teleconsultorias com IA",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "message": "Backend e banco rodando"
    }


@app.post("/register", response_model=schemas.UserOut, status_code=status.HTTP_201_CREATED)
async def register_user(user: schemas.UserCreate, db: AsyncSession = Depends(get_db)):
    stmt = select(models.User).where(models.User.email == user.email)
    result = await db.execute(stmt)
    exist_user = result.scalar_one_or_none()

    if exist_user:
        raise HTTPException(
            status_code=400,
            detail="Email ja cadastrado"
        )

    hashed_password = auth.get_password_hash(user.password)
    new_user = models.User(
        name=user.name,
        email=user.email,
        password_hash=hashed_password,
        role=user.role,
        specialty=user.specialty
    )
    
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)

    return new_user

@app.get("/me", response_model=schemas.UserOut)
async def get_me(current_user: models.User = Depends(auth.get_current_user)):
    return current_user

@app.post("/login", response_model=schemas.Token)
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends(), db: AsyncSession = Depends(get_db)):
    stmt = select(models.User).where(models.User.email == form_data.username)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if not user or not auth.verify_password(form_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciais invalidas",
            headers={"WWW-Authenticate": "Bearer"}
        )
    
    access_token = auth.create_access_token(data={"sub": str(user.id)})
    return {"access_token": access_token, "token_type": "bearer"}


async def run_ai_validation_task(
    tele_id: uuid.UUID,
    file_bytes: bytes,
    filename: str,
    specialty: str,
    diagnostic_hypothesis: str,
    clinical_history: str,
    requester_id: uuid.UUID
):
    from database import AsyncSessionLocal
    import models
    import ai_service

    confidence_score, rejection_reason = await ai_service.validate_document(
        file_bytes, filename, specialty, diagnostic_hypothesis, clinical_history
    )

    if confidence_score >= ai_service.THRESHOLD:
        new_status = models.TeleconsultationStatus.EM_ANDAMENTO
    else:
        new_status = models.TeleconsultationStatus.CANCELADA

    async with AsyncSessionLocal() as db:
        stmt = select(models.Teleconsultation).where(models.Teleconsultation.id == tele_id)
        result = await db.execute(stmt)
        tele = result.scalar_one_or_none()

        if tele:
            old_status = tele.status
            tele.status = new_status
            tele.ai_confidence_score = confidence_score
            tele.ai_rejection_reason = rejection_reason

            history = models.StatusHistory(
                teleconsultation_id=tele.id,
                old_status=old_status,
                new_status=new_status,
                changed_by=requester_id
            )
            db.add(history)
            await db.commit()

            # Broadcast update event
            await manager.broadcast({
                "type": "TELECONSULTATION_UPDATED",
                "id": str(tele_id),
                "status": new_status.value if hasattr(new_status, "value") else str(new_status),
                "specialty": tele.specialty.value if hasattr(tele.specialty, "value") else tele.specialty,
                "patient_name": tele.patient_name,
                "requester_id": str(tele.requester_id)
            })


@app.post("/teleconsultations", response_model=schemas.TeleconsultationOut, status_code=201)
async def create_teleconsultation(
    background_tasks: BackgroundTasks,
    patient_name: str = Form(...),
    patient_dob: date = Form(...),
    specialty: models.Specialty = Form(...),
    diagnostic_hypothesis: str = Form(...),
    clinical_history: str = Form(...),
    document: UploadFile = File(...),
    current_user: models.User = Depends(auth.get_current_user),
    db: AsyncSession = Depends(get_db)
):
    if current_user.role != models.UserRole.SOLICITANTE:
        raise HTTPException(status_code=403, detail="Apenas solicitantes podem criar teleconsultorias.")

    file_bytes = await document.read()

    upload_dir = "/app/uploads"
    os.makedirs(upload_dir, exist_ok=True)
    file_path = f"{upload_dir}/{uuid.uuid4()}_{document.filename}"

    with open(file_path, "wb") as f:
        f.write(file_bytes)

    new_tele = models.Teleconsultation(
        patient_name=patient_name,
        patient_dob=patient_dob,
        specialty=specialty,
        diagnostic_hypothesis=diagnostic_hypothesis,
        clinical_history=clinical_history,
        document_path=file_path,
        ai_confidence_score=None,
        ai_rejection_reason=None,
        status=models.TeleconsultationStatus.PENDENTE,
        requester_id=current_user.id
    )

    db.add(new_tele)
    await db.flush()

    # Registra na linha do tempo que iniciou como PENDENTE
    hist_pendente = models.StatusHistory(
        teleconsultation_id=new_tele.id,
        new_status=models.TeleconsultationStatus.PENDENTE,
        changed_by=current_user.id
    )
    db.add(hist_pendente)
    await db.commit()
    await db.refresh(new_tele)

    # Agenda a tarefa de validação por IA em segundo plano
    background_tasks.add_task(
        run_ai_validation_task,
        new_tele.id,
        file_bytes,
        document.filename,
        specialty.value,
        diagnostic_hypothesis,
        clinical_history,
        current_user.id
    )

    # Broadcast creation event
    await manager.broadcast({
        "type": "TELECONSULTATION_CREATED",
        "id": str(new_tele.id),
        "status": new_tele.status.value if hasattr(new_tele.status, "value") else str(new_tele.status),
        "specialty": new_tele.specialty.value if hasattr(new_tele.specialty, "value") else new_tele.specialty,
        "patient_name": new_tele.patient_name,
        "requester_id": str(new_tele.requester_id)
    })
    
    return new_tele


@app.get("/teleconsultations", response_model=list[schemas.TeleconsultationOut])
async def list_teleconsultations(
    current_user: models.User = Depends(auth.get_current_user),
    db: AsyncSession = Depends(get_db)
):
    if current_user.role == models.UserRole.SOLICITANTE:
        stmt = select(models.Teleconsultation).where(
            models.Teleconsultation.requester_id == current_user.id
        ).order_by(models.Teleconsultation.created_at.desc())
    elif current_user.role == models.UserRole.ESPECIALISTA:
        stmt = select(models.Teleconsultation).where(
            models.Teleconsultation.status.in_([
                models.TeleconsultationStatus.EM_ANDAMENTO,
                models.TeleconsultationStatus.CONCLUIDA
            ]),
            models.Teleconsultation.specialty == current_user.specialty
        ).order_by(models.Teleconsultation.created_at.desc())
    else:
        stmt = select(models.Teleconsultation).order_by(
            models.Teleconsultation.created_at.desc()
        )
    
    result = await db.execute(stmt)
    return result.scalars().all()


@app.get("/teleconsultations/{tele_id}", response_model=schemas.TeleconsultationDetailOut)
async def get_teleconsultation_details(
    tele_id: uuid.UUID,
    current_user: models.User = Depends(auth.get_current_user),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(models.Teleconsultation).options(
        selectinload(models.Teleconsultation.opinions),
        selectinload(models.Teleconsultation.status_history),
    ).where(models.Teleconsultation.id == tele_id)

    result = await db.execute(stmt)
    tele = result.scalar_one_or_none()

    if not tele:
        raise HTTPException(status_code=404, detail="Teleconsultoria não encontrada")

    if current_user.role == models.UserRole.ESPECIALISTA:
        if tele.specialty != current_user.specialty:
            raise HTTPException(status_code=403, detail="Acesso não autorizado para esta especialidade")
        if tele.status not in [models.TeleconsultationStatus.EM_ANDAMENTO, models.TeleconsultationStatus.CONCLUIDA]:
            raise HTTPException(status_code=403, detail="Acesso não autorizado para este status de teleconsultoria")

    return tele

@app.post("/teleconsultations/{tele_id}/opinions", response_model=schemas.OpinionOut)
async def create_opinion(
    tele_id: uuid.UUID,
    content: str = Form(...),
    current_user: models.User = Depends(auth.get_current_user),
    db: AsyncSession = Depends(get_db)
):

    if current_user.role != models.UserRole.ESPECIALISTA:
        raise HTTPException(status_code=403, detail="Apenas especialistas podem registrar pareceres.")
    
    stmt = select(models.Teleconsultation).where(models.Teleconsultation.id == tele_id)
    tele = (await db.execute(stmt)).scalar_one_or_none()

    if not tele:
        raise HTTPException(status_code=404, detail="Teleconsultoria não encontrada")

    if tele.specialty != current_user.specialty:
        raise HTTPException(status_code=403, detail="Acesso não autorizado para esta especialidade")
    
    if tele.status != models.TeleconsultationStatus.EM_ANDAMENTO:
        raise HTTPException(status_code=400, detail="Só é possível opinar em teleconsultorias EM ANDAMENTO")
    
    new_opinion = models.Opinion(
        teleconsultation_id=tele_id,
        specialist_id=current_user.id,
        content=content
    )

    db.add(new_opinion)

    old_status = tele.status
    tele.status = models.TeleconsultationStatus.CONCLUIDA
    tele.specialist_id = current_user.id

    history = models.StatusHistory(
        teleconsultation_id=tele.id,
        old_status=old_status,
        new_status=tele.status,
        changed_by=current_user.id
    )
    db.add(history)

    await db.commit()
    await db.refresh(new_opinion)

    # Broadcast update event
    await manager.broadcast({
        "type": "TELECONSULTATION_UPDATED",
        "id": str(tele_id),
        "status": tele.status.value if hasattr(tele.status, "value") else str(tele.status),
        "specialty": tele.specialty.value if hasattr(tele.specialty, "value") else tele.specialty,
        "patient_name": tele.patient_name,
        "requester_id": str(tele.requester_id)
    })

    return new_opinion


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query(None)):
    if not token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    
    try:
        import jwt
        payload = jwt.decode(token, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
    except Exception:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
