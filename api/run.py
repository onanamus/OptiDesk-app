"""Développement : python run.py  ->  http://127.0.0.1:8765/docs"""
import uvicorn

from core.config import settings
from db import init_db

if __name__ == "__main__":
    init_db()
    uvicorn.run("app:app", host=settings.host, port=settings.port, reload=True)
