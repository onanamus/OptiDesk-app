"""Journal d'audit — LECTURE SEULE. Aucun endpoint ne peut le modifier ou le purger."""
from datetime import datetime, time, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from core.deps import get_db, require_admin
from models import AuditEntry, User, utcnow
from schemas import AuditPage

router = APIRouter(prefix="/audit", tags=["Journal d'audit"])


@router.get("", response_model=AuditPage, summary="Journal filtrable (admin, F7.3)")
def read_audit(
    user: str | None = Query(None, description="Nom exact de l'utilisateur"),
    days: int | None = Query(None, ge=1, le=3650, description="1 = aujourd'hui, 7 = aujourd'hui et les 6 jours précédents"),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    conds = []
    if user:
        conds.append(AuditEntry.user_name == user)
    if days:
        conds.append(AuditEntry.ts >= datetime.combine(utcnow().date() - timedelta(days=days - 1), time.min))
    total = db.scalar(select(func.count(AuditEntry.id)).where(*conds)) or 0
    rows = db.scalars(select(AuditEntry).where(*conds).order_by(AuditEntry.ts.desc(), AuditEntry.id.desc())
                      .limit(limit).offset(offset)).all()
    users = sorted(db.scalars(select(AuditEntry.user_name).distinct()).all())
    return {"items": [{"id": e.id, "ts": e.ts, "user": e.user_name, "action": e.action, "detail": e.detail}
                      for e in rows], "total": total, "users": users}
