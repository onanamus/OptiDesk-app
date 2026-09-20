"""Règles de couverture. Lecture : tous ; écriture : admin. Toute modification est historisée (F2.3)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.audit import diff_detail, log_action
from core.deps import current_user, get_db, require_admin
from core.text import normalize
from models import Category, CoverageRule, User
from schemas import INSURERS, RuleCreate, RuleOut, RuleUpdate

router = APIRouter(prefix="/rules", tags=["Règles de couverture"])

LABELS = {"insurer": "organisme", "scope": "périmètre", "rate": "taux", "exclusion": "exclusion", "note": "note"}


def _check_scope_and_exclusion(db: Session, scope: str | None, exclusion: str | None) -> None:
    names = {normalize(n) for n in db.scalars(select(Category.name))}
    if scope and not normalize(scope).startswith("tous") and normalize(scope) not in names:
        raise HTTPException(400, f"Le périmètre « {scope} » n'est ni « Tous » ni une catégorie existante.")
    if exclusion and normalize(exclusion) not in names:
        raise HTTPException(400, f"L'exclusion « {exclusion} » n'est pas une catégorie existante.")


def _describe(r: CoverageRule) -> str:
    return f"{r.insurer} · {r.scope} · {r.rate}%" + (f" · exclut {r.exclusion}" if r.exclusion else "")


@router.get("", response_model=list[RuleOut])
def list_rules(_: User = Depends(current_user), db: Session = Depends(get_db)):
    return db.scalars(select(CoverageRule).order_by(CoverageRule.insurer, CoverageRule.id)).all()


@router.get("/insurers", response_model=list[str], summary="Organismes assureurs connus")
def list_insurers(_: User = Depends(current_user)):
    return list(INSURERS)


@router.post("", response_model=RuleOut, status_code=201, summary="Créer une règle (admin)")
def create_rule(body: RuleCreate, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    _check_scope_and_exclusion(db, body.scope, body.exclusion)
    rule = CoverageRule(insurer=body.insurer, scope=body.scope, rate=body.rate,
                        exclusion=body.exclusion or None, note=body.note)
    db.add(rule)
    log_action(db, admin, "Règle créée", _describe(rule))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, f"Une règle existe déjà pour {body.insurer} · {body.scope}. Modifiez-la plutôt.")
    return rule


@router.patch("/{rule_id}", response_model=RuleOut, summary="Modifier une règle (admin, historisé)")
def update_rule(rule_id: int, body: RuleUpdate, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    rule = db.get(CoverageRule, rule_id)
    if rule is None:
        raise HTTPException(404, "Cette règle n'existe pas.")
    changes = body.model_dump(exclude_unset=True)
    for field in ("insurer", "scope", "rate"):
        if field in changes and changes[field] is None:
            raise HTTPException(400, f"Le champ « {LABELS[field]} » ne peut pas être vide.")
    if "note" in changes and changes["note"] is None:
        changes["note"] = ""
    _check_scope_and_exclusion(db, changes.get("scope"), changes.get("exclusion"))
    if "exclusion" in changes:
        changes["exclusion"] = changes["exclusion"] or None

    before = {k: getattr(rule, k) for k in LABELS}
    for field, value in changes.items():
        setattr(rule, field, value)
    detail = diff_detail(before, {**before, **changes}, LABELS)
    log_action(db, admin, "Règle modifiée", f"{_describe(rule)}" + (f" ({detail})" if detail else ""))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Une autre règle existe déjà pour cet organisme et ce périmètre.")
    return rule
