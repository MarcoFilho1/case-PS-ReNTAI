from models import TeleconsultationStatus
from pydantic import BaseModel, EmailStr
from uuid import UUID
from models import UserRole, Specialty, TeleconsultationStatus
from datetime import date, datetime
from typing import Optional, List

# Contrato pra criação de usuário
class UserCreate(BaseModel):
    name: str
    email: EmailStr
    password: str
    role: UserRole
    specialty: Optional[Specialty] = None

# Contrato pra exibição de usuário
class UserOut(BaseModel):
    id: UUID
    name: str
    email: EmailStr
    role: UserRole
    specialty: Optional[Specialty] = None

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
    diagnostic_hypothesis: str
    ai_confidence_score: Optional[float] = None
    ai_rejection_reason: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True

class OpinionOut(BaseModel):
    id: UUID
    specialist_id: UUID
    content: str
    created_at: datetime

    class Config:
        from_attributes = True


class StatusHistoryOut(BaseModel):
    id: UUID
    old_status: Optional[TeleconsultationStatus]
    new_status: TeleconsultationStatus
    changed_by: UUID
    created_at: datetime

    class Config:
        from_attributes = True


class TeleconsultationDetailOut(TeleconsultationOut):
    patient_dob: date
    clinical_history: str
    requester_id: UUID
    specialist_id: Optional[UUID]
    ai_summary: Optional[str] = None
    document_name: Optional[str] = None
    requester: Optional[UserOut] = None
    specialist: Optional[UserOut] = None
    opinions: List[OpinionOut] = []
    status_history: List[StatusHistoryOut] = []

