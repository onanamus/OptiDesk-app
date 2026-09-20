"""Comptes utilisateurs. Création réservée à l'admin (pas d'auto-inscription, F9.2)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from core.audit import log_action
from core.deps import current_user, get_db, require_admin
from core.security import hash_pin, login_limiter, verify_pin
from core.text import slugify_login
from models import RefreshToken, User
from schemas import ActiveIn, UserCreate, UserOut, UserSelfUpdate

router = APIRouter(prefix="/users", tags=["Comptes"])

ROLE_LABEL = {"admin": "Admin", "vendeur": "Vendeur"}


def _unique_login(db: Session, base: str) -> str:
    login, n = base, 1
    while db.scalar(select(User.id).where(User.login == login)):
        n += 1
        login = f"{base}{n}"
    return login


@router.get("", response_model=list[UserOut], summary="Liste des comptes (admin)")
def list_users(_: User = Depends(require_admin), db: Session = Depends(get_db)):
    return db.scalars(select(User).order_by(User.name)).all()


def create_account(db: Session, actor: User, *, name: str, pin: str, role: str, photo: str | None,
                   login: str | None = None, origin: str = "") -> User:
    """Création d'un compte (partagée entre POST /users et POST /auth/register). L'appelant fait le commit."""
    if login:
        if db.scalar(select(User.id).where(User.login == login)):
            raise HTTPException(409, f"L'identifiant « {login} » est déjà pris.")
    else:   # identifiant proposé à partir du prénom (dernier mot du nom complet)
        login = _unique_login(db, slugify_login(name.split(" ")[-1]))
    user = User(name=name, login=login, pin_hash=hash_pin(pin), role=role, photo=photo)
    db.add(user)
    log_action(db, actor, "Compte créé", f"{name} ({ROLE_LABEL[role]}){origin}")
    return user


@router.post("", response_model=UserOut, status_code=201, summary="Créer un compte (admin)")
def create_user(body: UserCreate, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    user = create_account(db, admin, name=body.name, pin=body.pin, role=body.role, photo=body.photo,
                          login=body.login)
    db.commit()
    return user


@router.patch("/me", response_model=UserOut, summary="Changer son nom, sa photo ou son PIN")
def update_me(body: UserSelfUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    changed = []
    if body.pin:
        key = f"pin:{user.login}"
        wait = login_limiter.retry_after(key)
        if wait:
            raise HTTPException(429, f"Trop de tentatives. Réessayez dans {wait} seconde(s).",
                                headers={"Retry-After": str(wait)})
        if not verify_pin(body.old_pin or "", user.pin_hash):
            login_limiter.register_failure(key)
            raise HTTPException(403, "L'ancien code PIN est incorrect.")
        login_limiter.reset(key)
        user.pin_hash = hash_pin(body.pin)
        changed.append("code PIN")
    if body.name and body.name != user.name:
        user.name = body.name
        changed.append("nom")
    if "photo" in body.model_fields_set:
        user.photo = body.photo
        changed.append("photo")
    if changed:
        log_action(db, user, "Profil modifié", ", ".join(changed))   # jamais les valeurs
    db.commit()
    return user


@router.patch("/{user_id}/active", response_model=UserOut, summary="Désactiver / réactiver un compte (admin)")
def set_active(user_id: int, body: ActiveIn, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(404, "Compte introuvable.")
    if not body.active:
        if target.id == admin.id:
            raise HTTPException(409, "Vous ne pouvez pas désactiver votre propre compte.")
        others = db.scalar(select(func.count(User.id)).where(
            User.role == "admin", User.active.is_(True), User.id != target.id))
        if target.role == "admin" and not others:
            raise HTTPException(409, "Il doit rester au moins un administrateur actif.")
        db.execute(update(RefreshToken).where(RefreshToken.user_id == target.id).values(revoked=True))
    target.active = body.active
    log_action(db, admin, "Compte réactivé" if body.active else "Compte désactivé", target.name)
    db.commit()
    return target
