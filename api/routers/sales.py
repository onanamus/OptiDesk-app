"""Ventes, modèles de vente récurrente, bordereau. Le serveur recalcule tous les montants."""
from datetime import date, datetime, time, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from core.audit import log_action
from core.deps import current_user, get_db
from models import Client, Product, Sale, SaleModel, SaleModelLine, User, utcnow
from schemas import (QuoteOut, SaleCreate, SaleModelIn, SaleModelOut, SaleOut, SalePage, SlipOut,
                     TodaySummary)
from services import RawLine, build_slip, price_lines, quote_out, register_sale, sale_out

router = APIRouter(prefix="/sales", tags=["Ventes"])


def _raw(lines) -> list[RawLine]:
    return [RawLine(l.product_id, l.quantity, l.name, l.price) for l in lines]


def _client_or_404(db: Session, client_id: int | None) -> Client | None:
    if client_id is None:
        return None
    client = db.get(Client, client_id)
    if client is None:
        raise HTTPException(404, "Ce client n'existe pas ou a été supprimé.")
    return client


@router.post("/quote", response_model=QuoteOut,
             summary="Simuler une vente (panier en cours) : couverture et totaux calculés par le serveur, rien n'est écrit")
def quote(body: SaleCreate, _: User = Depends(current_user), db: Session = Depends(get_db)):
    client = _client_or_404(db, body.client_id)
    priced, gross, insured = price_lines(db, client, _raw(body.lines))
    return quote_out(client, priced, gross, insured)


@router.post("", response_model=SaleOut, status_code=201,
             summary="Enregistrer une vente (type déduit : client_id présent = assurée, absent = simple)")
def create_sale(body: SaleCreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    client = _client_or_404(db, body.client_id)
    now = utcnow()
    when = None
    if body.date and body.date != now.date():
        if body.date > now.date():
            raise HTTPException(400, "La date de la vente ne peut pas être dans le futur.")
        if (now.date() - body.date).days > 60:
            raise HTTPException(400, "Une vente ne peut pas être saisie plus de 60 jours après coup.")
        when = datetime.combine(body.date, now.time())
    sale = register_sale(db, user, _raw(body.lines), client, body.note, when=when)
    db.commit()
    return sale_out(sale)


@router.get("", response_model=SalePage, summary="Historique paginé")
def list_sales(
    date_from: date | None = Query(None, alias="from"),
    date_to: date | None = Query(None, alias="to"),
    client_id: int | None = None,
    type: Literal["simple", "assuree"] | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    _: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    conds = []
    if date_from:
        conds.append(Sale.date >= datetime.combine(date_from, time.min))
    if date_to:
        conds.append(Sale.date < datetime.combine(date_to + timedelta(days=1), time.min))
    if client_id is not None:
        conds.append(Sale.client_id == client_id)
    if type:
        conds.append(Sale.type == type)
    total = db.scalar(select(func.count(Sale.id)).where(*conds)) or 0
    rows = db.scalars(select(Sale).where(*conds).order_by(Sale.date.desc(), Sale.id.desc())
                      .limit(page_size).offset((page - 1) * page_size)).all()
    return {"items": [sale_out(s) for s in rows], "total": total, "page": page, "page_size": page_size}


@router.get("/summary/today", response_model=TodaySummary, summary="Chiffres du jour (cartes du comptoir)")
def today_summary(_: User = Depends(current_user), db: Session = Depends(get_db)):
    today = utcnow().date()
    start = datetime.combine(today, time.min)
    y_start = start - timedelta(days=1)
    todays = db.scalars(select(Sale).where(Sale.date >= start)).all()
    y_gross = db.scalar(select(func.coalesce(func.sum(Sale.gross_total), 0))
                        .where(Sale.date >= y_start, Sale.date < start)) or 0
    gross = sum(s.gross_total for s in todays)
    assured = [s for s in todays if s.type == "assuree"]
    simple = [s for s in todays if s.type == "simple"]
    return {
        "date": today, "sales_count": len(todays), "gross_total": gross,
        "assured_count": len(assured), "assured_total": sum(s.gross_total for s in assured),
        "simple_count": len(simple), "simple_total": sum(s.gross_total for s in simple),
        "clients_served": len({s.client_id for s in assured}),
        "yesterday_gross_total": y_gross,
        "trend_percent": round((gross - y_gross) / y_gross * 100) if y_gross else None,
    }


# --- Modèles de vente récurrente (F6.4) ---------------------------------------------------------

def _model_out(m: SaleModel, db: Session) -> dict:
    """Les prix des lignes catalogue sont relus dans le catalogue (le modèle ne fige pas un vieux prix)."""
    ids = [l.product_id for l in m.lines if l.product_id]
    prices = {p.id: p.price for p in db.scalars(select(Product).where(Product.id.in_(ids)))} if ids else {}
    return {"id": m.id, "name": m.name, "client_id": m.client_id, "created_at": m.created_at,
            "lines": [{"product_id": l.product_id, "name": l.name,
                       "price": prices.get(l.product_id, l.price), "quantity": l.quantity} for l in m.lines]}


@router.post("/models", response_model=SaleModelOut, status_code=201, summary="Enregistrer un modèle récurrent (F6.4)")
def create_model(body: SaleModelIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if body.client_id is not None and db.get(Client, body.client_id) is None:
        raise HTTPException(404, "Ce client n'existe pas ou a été supprimé.")
    model = SaleModel(name=body.name, client_id=body.client_id, created_by=user.id)
    for l in body.lines:
        if l.product_id is not None:
            p = db.get(Product, l.product_id)
            if p is None:
                raise HTTPException(400, f"Le produit n° {l.product_id} n'existe pas dans le catalogue.")
            model.lines.append(SaleModelLine(product_id=p.id, name=p.name, price=p.price, quantity=l.quantity))
        else:
            model.lines.append(SaleModelLine(product_id=None, name=l.name, price=l.price, quantity=l.quantity))
    db.add(model)
    log_action(db, user, "Modèle créé", model.name)
    db.commit()
    return _model_out(model, db)


@router.get("/models", response_model=list[SaleModelOut],
            summary="Modèles globaux, ou globaux + ceux d'un client (client_id) ; scope=all pour tout lister")
def list_models(client_id: int | None = None, scope: Literal["current", "all"] = "current",
                _: User = Depends(current_user), db: Session = Depends(get_db)):
    stmt = select(SaleModel).order_by(SaleModel.name)
    if scope == "current":
        stmt = stmt.where(SaleModel.client_id.is_(None) if client_id is None
                          else (SaleModel.client_id.is_(None)) | (SaleModel.client_id == client_id))
    return [_model_out(m, db) for m in db.scalars(stmt)]


@router.delete("/models/{model_id}", status_code=204, summary="Supprimer un modèle")
def delete_model(model_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    m = db.get(SaleModel, model_id)
    if m is None:
        raise HTTPException(404, "Ce modèle n'existe pas ou a déjà été supprimé.")
    log_action(db, user, "Modèle supprimé", m.name)
    db.delete(m)
    db.commit()


# --- Bordereau -------------------------------------------------------------------------------------

@router.get("/{ref}/slip", response_model=SlipOut, summary="Bordereau prêt à ressaisir dans Winpharma (F6.8)")
def slip(ref: str, _: User = Depends(current_user), db: Session = Depends(get_db)):
    sale = db.scalar(select(Sale).where(Sale.reference == ref))
    if sale is None:
        raise HTTPException(404, f"La vente « {ref} » est introuvable.")
    return build_slip(sale)
