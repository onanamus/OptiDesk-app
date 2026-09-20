"""Connexion par PIN, rotation des jetons, profil courant."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from core.audit import log_action
from core.deps import current_user, get_db
from core.security import (TokenError, burn_time, create_access_token, create_refresh_token, decode_token,
                           login_limiter, verify_pin)
from models import RefreshToken, User, utcnow
from routers.users import create_account
from schemas import LoginIn, LogoutIn, PublicAccount, RefreshIn, RegisterIn, TokenPair, UserOut

router = APIRouter(prefix="/auth", tags=["Authentification"])


def issue_pair(db: Session, user: User) -> TokenPair:
    """Émet une paire access + refresh et enregistre le refresh (pour pouvoir le faire tourner)."""
    access = create_access_token(user.id, user.role)
    refresh, jti, exp = create_refresh_token(user.id, user.role)
    db.add(RefreshToken(jti=jti, user_id=user.id, expires_at=exp))
    return TokenPair(access_token=access, refresh_token=refresh)


@router.get("/accounts", response_model=list[PublicAccount], summary="Comptes actifs (écran de connexion)")
def accounts(db: Session = Depends(get_db)):
    """Public : l'écran de connexion affiche la liste des comptes avant la saisie du PIN.
    Ne renvoie ni PIN ni hash."""
    return db.scalars(select(User).where(User.active.is_(True)).order_by(User.name)).all()


@router.post("/register", response_model=PublicAccount, status_code=201,
             summary="Créer un compte depuis l'écran de connexion (autorisé par le PIN du titulaire)")
def register(body: RegisterIn, db: Session = Depends(get_db)):
    """Pas d'auto-inscription (F9.2) : la demande n'aboutit que si le PIN d'un titulaire actif l'autorise.
    Le compte est journalisé au nom de ce titulaire."""
    key = "register"
    wait = login_limiter.retry_after(key)
    if wait:
        raise HTTPException(429, f"Trop de tentatives. Réessayez dans {wait} seconde(s).",
                            headers={"Retry-After": str(wait)})
    admins = db.scalars(select(User).where(User.role == "admin", User.active.is_(True))).all()
    authorizer = next((a for a in admins if verify_pin(body.admin_pin, a.pin_hash)), None)
    if authorizer is None:
        login_limiter.register_failure(key)
        log_action(db, None, "Échec de création de compte", f"PIN titulaire refusé pour « {body.name} »",
                   user_name="Inconnu")
        db.commit()
        raise HTTPException(403, "Le code PIN du titulaire est incorrect : le compte n'a pas été créé.")
    login_limiter.reset(key)
    user = create_account(db, authorizer, name=body.name, pin=body.pin, role=body.role, photo=body.photo,
                          origin=" · depuis l'écran de connexion")
    db.commit()
    return user


@router.post("/login", response_model=TokenPair)
def login(body: LoginIn, db: Session = Depends(get_db)):
    key = body.login.strip().lower()
    wait = login_limiter.retry_after(key)
    if wait:
        raise HTTPException(429, f"Trop de tentatives. Réessayez dans {wait} seconde(s).",
                            headers={"Retry-After": str(wait)})

    user = db.scalar(select(User).where(User.login == key))
    pin_ok = verify_pin(body.pin, user.pin_hash) if user else (burn_time(body.pin) or False)
    if not pin_ok:
        login_limiter.register_failure(key)
        log_action(db, user, "Échec de connexion", f"Identifiant saisi : {key[:40]}",
                   user_name=user.name if user else "Inconnu")
        db.commit()
        raise HTTPException(401, "Identifiant ou code PIN incorrect.")
    if not user.active:
        raise HTTPException(403, "Ce compte est désactivé. Contactez le titulaire de l'officine.")

    login_limiter.reset(key)
    db.execute(delete(RefreshToken).where(RefreshToken.user_id == user.id, RefreshToken.expires_at < utcnow()))
    pair = issue_pair(db, user)
    log_action(db, user, "Connexion", "Code PIN validé")
    db.commit()
    return pair


@router.post("/refresh", response_model=TokenPair, summary="Nouvelle paire de jetons (rotation)")
def refresh(body: RefreshIn, db: Session = Depends(get_db)):
    """Le refresh régénère la paire COMPLÈTE et invalide l'ancien refresh. Un refresh déjà
    utilisé qui reparaît est traité comme un vol : tous les refresh du compte sont révoqués."""
    invalid = HTTPException(401, "Votre session a expiré. Reconnectez-vous avec votre code PIN.")
    try:
        payload = decode_token(body.refresh_token, "refresh")
    except TokenError:
        raise invalid
    record = db.scalar(select(RefreshToken).where(RefreshToken.jti == payload.get("jti")))
    if record is None or record.expires_at < utcnow():
        raise invalid
    if record.revoked:
        db.execute(update(RefreshToken).where(RefreshToken.user_id == record.user_id).values(revoked=True))
        db.commit()
        raise invalid
    user = db.get(User, record.user_id)
    if user is None or not user.active:
        raise invalid
    record.revoked = True
    pair = issue_pair(db, user)
    db.commit()
    return pair


@router.post("/logout", status_code=204, summary="Déconnexion (révoque le refresh, trace l'événement)")
def logout(body: LogoutIn | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if body and body.refresh_token:
        try:
            jti = decode_token(body.refresh_token, "refresh").get("jti")
            db.execute(update(RefreshToken).where(RefreshToken.jti == jti,
                                                  RefreshToken.user_id == user.id).values(revoked=True))
        except TokenError:
            pass
    log_action(db, user, "Déconnexion", "Déconnexion manuelle")
    db.commit()


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return user
