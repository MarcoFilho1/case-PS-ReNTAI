from pydantic import BaseModel, EmailStr
from uuid import UUID
from models import UserRole

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