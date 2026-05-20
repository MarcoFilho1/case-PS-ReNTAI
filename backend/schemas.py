from models import TeleconsultationStatus
from pydantic import BaseModel, EmailStr
from uuid import UUID
from models import UserRole, Specialty, TeleconsultationStatus
from datetime import date, datetime
from typing import Optional

# Contrato pra criação de usuário
class UserCreate(BaseModel):
    name: str
    email: EmailStr
    password: str
    role: UserRole

# Contrato pra exibição de usuário
class UserOut(BaseModel):
    id: UUID
    name: str
    email: EmailStr
    role: UserRole

    class Config:
        from_attributes = True

# Contrato do JWT
class Token(BaseModel):
    access_token: str
    token_type: str

class TeleconsultationOut(BaseModel):
    id: UUID
    patient_name: str
    specialty: Specialty
    status: TeleconsultationStatus
    created_at: datetime

    class Config:
        from_attributes = True

class TeleconsultationDetailOut(TeleconsultationOut):
    patient_dob: date
    diagnostic_hypothesis: str
    clinical_history: str
    ai_confidence_score: Optional[float]
    requester_id: UUID
    specialist_id: Optional[UUID]