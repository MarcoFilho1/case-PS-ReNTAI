import os
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncAttrs
from sqlalchemy.orm import DeclarativeBase

DATABASE_URL = os.getenv(
    "DATABASE_URL", 
    "postgresql+asyncpg://admin:secretpassword@localhost:5432/telemed"
).replace("postgresql://", "postgresql+asyncpg://")

engine = create_async_engine(DATABASE_URL, echo=True)

AsyncSessionLocal = async_sessionmaker(
    bind=engine, 
    autocommit=False, 
    autoflush=False, 
    expire_on_commit=False
)

class Base(AsyncAttrs, DeclarativeBase):
    pass

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session