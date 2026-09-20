"""Clients assurés : recherche, clients fréquents, panier habituel, création/mise à jour tracées."""
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from core.audit import diff_detail, log_action
from core.deps import current_user, get_db
from core.text import normalize
from models import Client, Product, Sale, User, utcnow
from routers.coverage import coverage_payload, couverture, rules_by_insurer, split_amount
from schemas import ClientCreate, ClientOut, ClientUpdate, FrequentClientOut, UsualCartOut
from services import availability, client_out

router = APIRouter(prefix="/clients", tags=["Clients assurés"])

LABELS = {"first_name": "prénom", "last_name": "nom", "insurer": "organisme", "policy_number": "n° d'assuré",
          "valid_until": "validité"}


def _get_client(db: Session, client_id: int) -> Client:
    c = db.get(Client, client_id)
    if c is None:
        raise HTTPException(404, "Ce client n'existe pas ou a été supprimé.")
    return c


def _check_policy_free(db: Session, insurer: str, policy: str, own_id: int | None = None) -> None:
    if not policy:
        return
    other = db.scalar(select(Client).where(Client.insurer == insurer, Client.policy_number == policy))
    if other and other.id != own_id:
        raise HTTPException(409, f"Le numéro d'assuré « {policy} » est déjà attribué à "
                                 f"{other.last_name} {other.first_name}.")


@router.get("", response_model=list[ClientOut], summary="Recherche (nom partiel, n° d'assuré, organisme)")
def search_clients(q: str | None = None, limit: int = Query(50, ge=1, le=200),
                   _: User = Depends(current_user), db: Session = Depends(get_db)):
    conds = [Client.search_text.contains(tok, autoescape=True) for tok in normalize(q).split()] if q else []
    rows = db.scalars(select(Client).where(*conds).order_by(Client.last_name, Client.first_name).limit(limit))
    today = utcnow().date()
    return [client_out(c, today) for c in rows]


@router.get("/frequent", response_model=list[FrequentClientOut], summary="Clients fréquents (widget du comptoir)")
def frequent_clients(limit: int = Query(12, ge=1, le=50), _: User = Depends(current_user),
                     db: Session = Depends(get_db)):
    """Score = 10 × (ventes des 90 derniers jours) + points de récence (30 le jour même, 0 après 30 jours)."""
    today = utcnow().date()
    since = utcnow() - timedelta(days=90)
    counts = dict(db.execute(select(Sale.client_id, func.count(Sale.id))
                             .where(Sale.client_id.is_not(None), Sale.date >= since)
                             .group_by(Sale.client_id)).all())
    out = []
    for c in db.scalars(select(Client).where(Client.frequent.is_(True))):
        recency = max(0, 30 - (today - c.last_purchase).days) if c.last_purchase else 0
        out.append({**client_out(c, today), "score": counts.get(c.id, 0) * 10 + recency})
    return sorted(out, key=lambda x: x["score"], reverse=True)[:limit]


@router.get("/{client_id}", response_model=ClientOut, summary="Fiche d'un client")
def get_client(client_id: int, _: User = Depends(current_user), db: Session = Depends(get_db)):
    return client_out(_get_client(db, client_id))


@router.get("/{client_id}/usual-cart", response_model=UsualCartOut, summary="Panier habituel reconstitué (F6.3)")
def usual_cart(client_id: int, _: User = Depends(current_user), db: Session = Depends(get_db)):
    c = _get_client(db, client_id)
    rules = rules_by_insurer(db).get(c.insurer, [])
    products = {p.id: p for p in db.scalars(select(Product).where(Product.id.in_([i.product_id for i in c.usual_cart])))} \
        if c.usual_cart else {}
    today = utcnow().date()
    lines, gross, insured_total = [], 0, 0
    for item in c.usual_cart:
        p = products.get(item.product_id)
        if p is None:
            continue
        cov = couverture(c, p, rules, today)
        insured, _patient = split_amount(p.price, item.quantity, cov.rate)
        gross += p.price * item.quantity
        insured_total += insured
        lines.append({"product_id": p.id, "name": p.name, "price": p.price, "quantity": item.quantity,
                      "stock": p.stock, "availability": availability(p.stock),
                      "coverage": coverage_payload(cov, p.price, item.quantity)})
    return {"client_id": c.id, "lines": lines,
            "totals": {"gross_total": gross, "insurer_share": insured_total, "patient_share": gross - insured_total}}


@router.post("", response_model=ClientOut, status_code=201, summary="Créer un client à la volée (F4.3, tracé)")
def create_client(body: ClientCreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    _check_policy_free(db, body.insurer, body.policy_number)
    c = Client(first_name=body.first_name, last_name=body.last_name.upper(), insurer=body.insurer,
               policy_number=body.policy_number, valid_until=body.valid_until, photo=body.photo,
               last_purchase=None, frequent=False)
    db.add(c)
    log_action(db, user, "Client créé", f"{c.last_name} {c.first_name}")
    db.commit()
    return client_out(c)


@router.patch("/{client_id}", response_model=ClientOut, summary="Mettre à jour une fiche client (tracé, F4.1)")
def update_client(client_id: int, body: ClientUpdate, user: User = Depends(current_user),
                  db: Session = Depends(get_db)):
    c = _get_client(db, client_id)
    changes = body.model_dump(exclude_unset=True)
    for field in ("first_name", "last_name", "insurer", "policy_number"):
        if field in changes and changes[field] is None:
            raise HTTPException(400, f"Le champ « {LABELS[field]} » ne peut pas être vide.")
    if "last_name" in changes:
        changes["last_name"] = changes["last_name"].upper()
    _check_policy_free(db, changes.get("insurer", c.insurer), changes.get("policy_number", c.policy_number),
                       own_id=c.id)
    before = {k: getattr(c, k) for k in LABELS}
    for field, value in changes.items():
        setattr(c, field, value)
    detail = diff_detail(before, {**before, **{k: v for k, v in changes.items() if k in LABELS}}, LABELS)
    if "photo" in changes:
        detail = (detail + " ; " if detail else "") + "photo"
    log_action(db, user, "Fiche client modifiée", f"{c.last_name} {c.first_name}" + (f" · {detail}" if detail else ""))
    db.commit()
    return client_out(c)
