from fastapi import FastAPI
from contextlib import asynccontextmanager
from database import engine, Base
import models

@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield

app = FastAPI(
    title="Telemedicina API",
    description="API para gestão de teleconsultorias com IA",
    version="1.0.0",
    lifespan=lifespan
)

app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "message": "Backend e banco rodando"
    }
    
