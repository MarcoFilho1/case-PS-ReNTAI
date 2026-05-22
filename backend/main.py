from fastapi import FastAPI, Depends, HTTPException, status, Form, File, UploadFile, BackgroundTasks, WebSocket, WebSocketDisconnect, Query
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import text
from contextlib import asynccontextmanager
from database import engine, Base, get_db, AsyncSessionLocal
import models
import auth
import schemas
from datetime import date
import os
import uuid
import ai_service
from sqlalchemy.orm import selectinload
from typing import List, Optional
import jwt
import io
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.platypus.flowables import HRFlowable
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas


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
        try:
            await conn.execute(text("ALTER TABLE teleconsultations ADD COLUMN IF NOT EXISTS ai_summary TEXT;"))
        except Exception as e:
            print(f"Erro ao adicionar coluna ai_summary: {e}")
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
    

    confidence_score, rejection_reason, ai_summary = await ai_service.validate_document(
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
            tele.ai_summary = ai_summary

            history = models.StatusHistory(
                teleconsultation_id=tele.id,
                old_status=old_status,
                new_status=new_status,
                changed_by=requester_id
            )
            db.add(history)
            await db.commit()

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
        selectinload(models.Teleconsultation.requester),
        selectinload(models.Teleconsultation.specialist)
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


@app.get("/teleconsultations/{tele_id}/document")
async def get_teleconsultation_document(
    tele_id: uuid.UUID,
    token: str = Query(...),
    download: bool = Query(False),
    db: AsyncSession = Depends(get_db)
):
    try:
        payload = jwt.decode(token, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Token inválido")
    except Exception:
        raise HTTPException(status_code=401, detail="Token inválido")

    stmt = select(models.User).where(models.User.id == uuid.UUID(user_id))
    current_user = (await db.execute(stmt)).scalar_one_or_none()
    if not current_user:
        raise HTTPException(status_code=401, detail="Usuário não encontrado")

    stmt = select(models.Teleconsultation).where(models.Teleconsultation.id == tele_id)
    tele = (await db.execute(stmt)).scalar_one_or_none()
    if not tele:
        raise HTTPException(status_code=404, detail="Teleconsultoria não encontrada")

    if current_user.role == models.UserRole.SOLICITANTE:
        if tele.requester_id != current_user.id:
            raise HTTPException(status_code=403, detail="Acesso negado")
    elif current_user.role == models.UserRole.ESPECIALISTA:
        if tele.specialty != current_user.specialty:
            raise HTTPException(status_code=403, detail="Acesso negado")

    if not tele.document_path or not os.path.exists(tele.document_path):
        raise HTTPException(status_code=404, detail="Arquivo não encontrado")

    
    basename = os.path.basename(tele.document_path)
    parts = basename.split("_", 1)
    filename = parts[1] if len(parts) > 1 else basename

    return FileResponse(
        tele.document_path,
        filename=filename,
        content_disposition_type="attachment" if download else "inline"
    )


@app.get("/teleconsultations/{tele_id}/pdf")
async def get_teleconsultation_pdf(
    tele_id: uuid.UUID,
    token: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    try:
        payload = jwt.decode(token, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Token inválido")
    except Exception:
        raise HTTPException(status_code=401, detail="Token inválido")

    stmt = select(models.User).where(models.User.id == uuid.UUID(user_id))
    current_user = (await db.execute(stmt)).scalar_one_or_none()
    if not current_user:
        raise HTTPException(status_code=401, detail="Usuário não encontrado")

    if current_user.role != models.UserRole.SOLICITANTE:
        raise HTTPException(status_code=403, detail="Apenas médicos solicitantes podem exportar o resumo em PDF")

    stmt = select(models.Teleconsultation).options(
        selectinload(models.Teleconsultation.opinions),
        selectinload(models.Teleconsultation.requester),
        selectinload(models.Teleconsultation.specialist)
    ).where(models.Teleconsultation.id == tele_id)

    result = await db.execute(stmt)
    tele = result.scalar_one_or_none()

    if not tele:
        raise HTTPException(status_code=404, detail="Teleconsultoria não encontrada")

    if tele.requester_id != current_user.id:
        raise HTTPException(status_code=403, detail="Acesso negado")

    if tele.status != models.TeleconsultationStatus.CONCLUIDA:
        raise HTTPException(status_code=400, detail="O resumo em PDF está disponível apenas para teleconsultas concluídas")

    # Classe Canvas customizada para Cabeçalho Clínico Formal
    class MedicalCanvas(canvas.Canvas):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self._saved_page_states = []

        def showPage(self):
            self._saved_page_states.append(dict(self.__dict__))
            self._startPage()

        def save(self):
            num_pages = len(self._saved_page_states)
            for state in self._saved_page_states:
                self.__dict__.update(state)
                self.draw_header_footer(num_pages)
                super().showPage()
            super().save()

        def draw_header_footer(self, page_count):
            self.saveState()
            
            # --- CABEÇALHO ---
            lavid_path = "/app/assets/logo_lavid.jpg"
            
            rentai_path = "/app/assets/logo_rentai.png"
            
            
            if os.path.exists(lavid_path):
                try:
                    self.drawImage(ImageReader(lavid_path), 54, 760, width=90, height=45, preserveAspectRatio=True, anchor='nw')
                except Exception:
                    pass
            
            if os.path.exists(rentai_path):
                try:
                    self.drawImage(ImageReader(rentai_path), 450, 760, width=90, height=45, preserveAspectRatio=True, anchor='ne')
                except Exception:
                    pass

            # Linha e Título do Cabeçalho
            self.setStrokeColor(colors.HexColor("#0F172A"))
            self.setLineWidth(1.5)
            self.line(54, 745, 541, 745)
            
            self.setFont("Helvetica-Bold", 14)
            self.setFillColor(colors.HexColor("#1E293B"))
            self.drawCentredString(297.5, 770, "HOSPITAL RENTAI")
            self.setFont("Helvetica", 10)
            self.setFillColor(colors.HexColor("#475569"))
            self.drawCentredString(297.5, 755, "NÚCLEO DE TELEMEDICINA E TELESSAÚDE")
            
            # --- RODAPÉ ---
            self.setStrokeColor(colors.HexColor("#CBD5E1"))
            self.setLineWidth(0.5)
            self.line(54, 50, 541, 50)
            
            self.setFont("Helvetica-Oblique", 8)
            self.setFillColor(colors.HexColor("#64748B"))
            self.drawString(54, 38, "Documento Oficial - Assinado e validado eletronicamente no sistema PS-ReNTAI.")
            
            page_text = f"Página {self._pageNumber} de {page_count}"
            self.drawRightString(541, 38, page_text)
            self.restoreState()

    buffer = io.BytesIO()
    # Aumentando o topMargin para não colidir com os logos do cabeçalho
    doc = SimpleDocTemplate(buffer, pagesize=A4, leftMargin=54, rightMargin=54, topMargin=110, bottomMargin=72)

    styles = getSampleStyleSheet()
    
    title_style = ParagraphStyle(
        'DocTitle', parent=styles['Normal'], fontName='Helvetica-Bold', fontSize=14, leading=18,
        alignment=1, textColor=colors.HexColor("#0F172A"), spaceAfter=20
    )

    h1_style = ParagraphStyle(
        'H1', parent=styles['Normal'], fontName='Helvetica-Bold', fontSize=11, leading=14,
        textColor=colors.HexColor("#1E293B"), spaceBefore=20, spaceAfter=8, keepWithNext=True
    )

    body_style = ParagraphStyle(
        'Body', parent=styles['Normal'], fontName='Helvetica', fontSize=10, leading=15,
        textColor=colors.HexColor("#334155"), alignment=4 # Justificado
    )

    bold_body = ParagraphStyle(
        'BoldBody', parent=body_style, fontName='Helvetica-Bold'
    )

    story = []

    # Título do Documento
    story.append(Paragraph("PARECER CLÍNICO DE TELECONSULTORIA", title_style))

    def calculate_age(dob: date) -> int:
        today = date.today()
        return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))

    def format_specialty(spec: str) -> str:
        mapping = {
            "CARDIOLOGIA": "Cardiologia", "CIRURGIA_ROBOTICA": "Cirurgia Robótica",
            "ODONTOLOGIA": "Odontologia", "DOENCAS_RARAS": "Doenças Raras", "OXIGENOTERAPIA": "Oxigenoterapia"
        }
        return mapping.get(spec, spec)

    # --- QUADRO DE IDENTIFICAÇÃO DO PACIENTE (Estilo Médico Limpo) ---
    spec_str = format_specialty(tele.specialty.value if hasattr(tele.specialty, "value") else str(tele.specialty))
    
    patient_data = [
        [Paragraph("<b>Paciente:</b>", body_style), Paragraph(tele.patient_name, body_style),
         Paragraph("<b>Idade:</b>", body_style), Paragraph(f"{calculate_age(tele.patient_dob)} anos ({tele.patient_dob.strftime('%d/%m/%Y')})", body_style)],
        [Paragraph("<b>Protocolo:</b>", body_style), Paragraph(str(tele.id).split('-')[0].upper(), body_style),
         Paragraph("<b>Data:</b>", body_style), Paragraph(tele.created_at.strftime("%d/%m/%Y %H:%M"), body_style)],
        [Paragraph("<b>Especialidade:</b>", body_style), Paragraph(spec_str, bold_body),
         Paragraph("<b>Solicitante:</b>", body_style), Paragraph(tele.requester.name if tele.requester else "-", body_style)]
    ]

    t = Table(patient_data, colWidths=[90, 153, 90, 154])
    t.setStyle(TableStyle([
        ('LINEABOVE', (0,0), (-1,0), 1.5, colors.HexColor("#1E293B")), # Borda grossa no topo
        ('LINEBELOW', (0,-1), (-1,-1), 1.5, colors.HexColor("#1E293B")), # Borda grossa na base
        ('LINEBELOW', (0,0), (-1,-2), 0.5, colors.HexColor("#E2E8F0")), # Linhas finas internas
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor("#F8FAFC")), # Fundo cinza ultraclaro
        ('TOPPADDING', (0,0), (-1,-1), 8),
        ('BOTTOMPADDING', (0,0), (-1,-1), 8),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ]))
    story.append(t)
    story.append(Spacer(1, 15))

    # --- DADOS CLÍNICOS ---
    story.append(Paragraph("1. INDICAÇÃO E HISTÓRICO CLÍNICO", h1_style))
    story.append(Paragraph(f"<b>Hipótese Diagnóstica Inicial:</b> {tele.diagnostic_hypothesis}", body_style))
    story.append(Spacer(1, 5))
    story.append(Paragraph(tele.clinical_history.replace("\n", "<br/>"), body_style))
    
    story.append(Spacer(1, 10))
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#CBD5E1"), spaceBefore=10, spaceAfter=10))

    # --- RESUMO DE TRIAGEM (IA) ---
    story.append(Paragraph("2. TRIAGEM DOCUMENTAL (INTELIGÊNCIA ARTIFICIAL)", h1_style))
    ai_text = tele.ai_summary if tele.ai_summary else "Análise de documento de apoio realizada com sucesso."
    story.append(Paragraph(ai_text.replace("\n", "<br/>"), body_style))
    
    if tele.ai_confidence_score is not None:
        story.append(Spacer(1, 5))
        story.append(Paragraph(f"<i>Grau de confiabilidade do documento de apoio (Score IA): {int(tele.ai_confidence_score * 100)}%</i>", body_style))

    story.append(Spacer(1, 10))
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#CBD5E1"), spaceBefore=10, spaceAfter=10))

    # --- PARECERES ---
    story.append(Paragraph("3. CONCLUSÃO E PARECER ESPECIALIZADO", h1_style))
    
    if tele.opinions:
        for op in tele.opinions:
            op_time = op.created_at.strftime("%d/%m/%Y às %H:%M")
            story.append(Paragraph(op.content.replace("\n", "<br/>"), body_style))
            story.append(Spacer(1, 15))
            
            # Assinatura do médico especialista (Alinhada à direita)
            med_name = tele.specialist.name if tele.specialist else "Médico Especialista"
            signature = Paragraph(f"___________________________________________<br/><b>{med_name}</b><br/>CRM/Especialista Responsável<br/>Assinado em: {op_time}", 
                                  ParagraphStyle('Sig', parent=body_style, alignment=2, fontSize=9))
            story.append(signature)
            story.append(Spacer(1, 15))
    else:
        story.append(Paragraph("Nenhum parecer registrado até o momento.", body_style))

    # Gera o PDF
    doc.build(story, canvasmaker=MedicalCanvas)
    
    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=Parecer_Telemedicina_{tele_id}.pdf"}
    )


@app.put("/teleconsultations/{tele_id}", response_model=schemas.TeleconsultationDetailOut)
async def update_teleconsultation(
    tele_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    patient_name: str = Form(...),
    patient_dob: date = Form(...),
    specialty: models.Specialty = Form(...),
    diagnostic_hypothesis: str = Form(...),
    clinical_history: str = Form(...),
    document: Optional[UploadFile] = File(None),
    current_user: models.User = Depends(auth.get_current_user),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(models.Teleconsultation).options(
        selectinload(models.Teleconsultation.opinions),
        selectinload(models.Teleconsultation.status_history),
        selectinload(models.Teleconsultation.requester),
        selectinload(models.Teleconsultation.specialist)
    ).where(models.Teleconsultation.id == tele_id)
    tele = (await db.execute(stmt)).scalar_one_or_none()

    if not tele:
        raise HTTPException(status_code=404, detail="Teleconsultoria não encontrada")

    if tele.requester_id != current_user.id:
        raise HTTPException(status_code=403, detail="Apenas o médico solicitante criador do caso pode editá-lo.")

    if tele.status == models.TeleconsultationStatus.CONCLUIDA:
        raise HTTPException(status_code=400, detail="Não é possível editar uma teleconsultoria concluída.")

    old_status = tele.status

    tele.patient_name = patient_name
    tele.patient_dob = patient_dob
    tele.specialty = specialty
    tele.diagnostic_hypothesis = diagnostic_hypothesis
    tele.clinical_history = clinical_history

    file_bytes = None
    filename = None
    if document is not None and document.filename:
        file_bytes = await document.read()
        upload_dir = "/app/uploads"
        os.makedirs(upload_dir, exist_ok=True)
        file_path = f"{upload_dir}/{uuid.uuid4()}_{document.filename}"
        with open(file_path, "wb") as f:
            f.write(file_bytes)
        tele.document_path = file_path
        filename = document.filename
    else:
        if tele.document_path and os.path.exists(tele.document_path):
            with open(tele.document_path, "rb") as f:
                file_bytes = f.read()
            filename = os.path.basename(tele.document_path).split("_", 1)[-1]

    tele.status = models.TeleconsultationStatus.PENDENTE
    tele.ai_confidence_score = None
    tele.ai_rejection_reason = None
    tele.ai_summary = None

    history = models.StatusHistory(
        teleconsultation_id=tele.id,
        old_status=old_status,
        new_status=models.TeleconsultationStatus.PENDENTE,
        changed_by=current_user.id
    )
    db.add(history)
    await db.commit()
    await db.refresh(tele)

    if file_bytes:
        background_tasks.add_task(
            run_ai_validation_task,
            tele.id,
            file_bytes,
            filename or "documento.pdf",
            specialty.value,
            diagnostic_hypothesis,
            clinical_history,
            current_user.id
        )

    await manager.broadcast({
        "type": "TELECONSULTATION_UPDATED",
        "id": str(tele.id),
        "status": tele.status.value if hasattr(tele.status, "value") else str(tele.status),
        "specialty": tele.specialty.value if hasattr(tele.specialty, "value") else tele.specialty,
        "patient_name": tele.patient_name,
        "requester_id": str(tele.requester_id)
    })

    return tele


@app.delete("/teleconsultations/{tele_id}", status_code=204)
async def delete_teleconsultation(
    tele_id: uuid.UUID,
    current_user: models.User = Depends(auth.get_current_user),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(models.Teleconsultation).where(models.Teleconsultation.id == tele_id)
    tele = (await db.execute(stmt)).scalar_one_or_none()

    if not tele:
        raise HTTPException(status_code=404, detail="Teleconsultoria não encontrada")

    if tele.requester_id != current_user.id:
        raise HTTPException(status_code=403, detail="Apenas o médico solicitante criador do caso pode excluí-lo.")

    await db.delete(tele)
    await db.commit()

    await manager.broadcast({
        "type": "TELECONSULTATION_DELETED",
        "id": str(tele_id),
        "requester_id": str(tele.requester_id)
    })

    return None


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query(None)):
    if not token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    
    try:
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
