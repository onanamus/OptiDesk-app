"""Dépendances FastAPI : session, utilisateur courant, contrôle des rôles.
C'est ici — et nulle part ailleurs — que vit la matrice de permissions."""
from typing import Iterator

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from core.security import TokenError, decode_token
from db import SessionLocal
from models import User

bearer = HTTPBearer(auto_error=False, description="Jeton d'accès obtenu via POST /auth/login")


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def current_user(creds: HTTPAuthorizationCredentials | None = Depends(bearer),
                 db: Session = Depends(get_db)) -> User:
    if creds is None:
        raise HTTPException(401, "Connexion requise. Saisissez votre code PIN.",
                            headers={"WWW-Authenticate": "Bearer"})
    try:
        payload = decode_token(creds.credentials, "access")
    except TokenError:
        raise HTTPException(401, "Votre session a expiré. Reconnectez-vous avec votre code PIN.",
                            headers={"WWW-Authenticate": "Bearer"})
    user = db.get(User, int(payload["sub"]))
    if user is None or not user.active:
        raise HTTPException(401, "Ce compte n'est plus actif. Contactez le titulaire.",
                            headers={"WWW-Authenticate": "Bearer"})
    return user


def require_admin(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(403, "Cette action est réservée au titulaire de l'officine.")
    return user
