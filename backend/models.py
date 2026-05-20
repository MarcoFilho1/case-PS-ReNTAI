import uuid
import enum
from datetime import datetime, date
from sqlalchemy import String, Text, ForeignKey, Float, Date, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, ENUM
from database import Base

class UserRole(str, enum.Enum):
    SOLICITANTE = "SOLICITANTE"
    ESPECIALISTA = "ESPECIALISTA"

class Specialty(str, enum.Enum):
    CARDIOLOGIA = "CARDIOLOGIA"
    CIRURGIA_ROBOTICA = "CIRURGIA_ROBOTICA"
    ODONTOLOGIA = "ODONTOLOGIA"
    DOENCAS_RARAS = "DOENCAS_RARAS"
    OXIGENOTERAPIA = "OXIGENOTERAPIA"

class TeleconsultationStatus(str, enum.Enum):
    PENDENTE = "PENDENTE"
    EM_ANDAMENTO = "EM_ANDAMENTO"
    CONCLUIDA = "CONCLUIDA"
    CANCELADA = "CANCELADA"

class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(100))
    email: Mapped[str] = mapped_column(String(150), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[UserRole] = mapped_column(String(50))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

class Teleconsultation(Base):
    __tablename__ = "teleconsultations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    patient_name: Mapped[str] = mapped_column(String(150))
    patient_dob: Mapped[date] = mapped_column(Date)
    specialty: Mapped[Specialty] = mapped_column(String(50))
    diagnostic_hypothesis: Mapped[str] = mapped_column(Text)
    clinical_history: Mapped[str] = mapped_column(Text)
    document_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[TeleconsultationStatus] = mapped_column(String(50), default=TeleconsultationStatus.PENDENTE)
    ai_confidence_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    
    requester_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    specialist_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())

class Opinion(Base):
    __tablename__ = "opinions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    teleconsultation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("teleconsultations.id"))
    specialist_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

class StatusHistory(Base):
    __tablename__ = "status_history"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    teleconsultation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("teleconsultations.id"))
    old_status: Mapped[TeleconsultationStatus | None] = mapped_column(String(50), nullable=True)
    new_status: Mapped[TeleconsultationStatus] = mapped_column(String(50))
    changed_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())