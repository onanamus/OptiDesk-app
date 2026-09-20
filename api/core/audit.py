"""Helper unique d'écriture dans le journal d'audit."""
from sqlalchemy.orm import Session

from models import AuditEntry, User


def log_action(db: Session, user: User | None, action: str, detail: str = "",
               *, user_name: str | None = None) -> AuditEntry:
    """Ajoute une ligne au journal, dans la même transaction que l'écriture métier
    (l'appelant fait le commit : si l'action échoue, sa trace disparaît avec elle)."""
    entry = AuditEntry(
        user_id=user.id if user else None,
        user_name=user_name or (user.name if user else "Système"),
        action=action,
        detail=detail[:500],
    )
    db.add(entry)
    return entry


def diff_detail(before: dict, after: dict, labels: dict | None = None) -> str:
    """'prix : 350 → 400 ; stock : 12 → 10' — uniquement les champs réellement modifiés."""
    labels = labels or {}
    parts = []
    for key, new in after.items():
        old = before.get(key)
        if old != new:
            parts.append(f"{labels.get(key, key)} : {'—' if old in (None, '') else old} → "
                         f"{'—' if new in (None, '') else new}")
    return " ; ".join(parts)
