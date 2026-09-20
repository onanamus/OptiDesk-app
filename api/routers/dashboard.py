"""Tableau de bord des blocages comptoir (admin). Tous les chiffres sont calculés ici, pas par le frontend."""
import csv
import io
from datetime import datetime, time, timedelta

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from core.audit import log_action
from core.config import settings
from core.deps import get_db, require_admin
from models import Product, Sale, SaleLine, User, utcnow
from schemas import DashboardOut
from services import days_to_expiry

router = APIRouter(prefix="/dashboard", tags=["Tableau de bord"])


def _out_of_coverage(db: Session, since: datetime) -> list[dict]:
    """Lignes de ventes assurées dont le taux figé est 0 : produits demandés mais non couverts."""
    rows = db.execute(
        select(SaleLine.name, Sale.insurer, func.count(SaleLine.id).label("n"))
        .join(Sale, Sale.id == SaleLine.sale_id)
        .where(Sale.date >= since, Sale.client_id.is_not(None), SaleLine.coverage_rate == 0)
        .group_by(SaleLine.name, Sale.insurer)
        .order_by(func.count(SaleLine.id).desc(), SaleLine.name)).all()
    return [{"name": name, "insurer": insurer or "—", "count": n} for name, insurer, n in rows]


def _alert_row(p: Product, today) -> dict:
    return {"id": p.id, "name": p.name, "code": p.code, "category": p.category.name, "stock": p.stock,
            "expiry": p.expiry, "days_to_expiry": days_to_expiry(p, today)}


@router.get("", response_model=DashboardOut, summary="Synthèse sur N jours (admin)")
def dashboard(days: int = Query(7, ge=1, le=90), _: User = Depends(require_admin), db: Session = Depends(get_db)):
    today = utcnow().date()
    first_day = today - timedelta(days=days - 1)
    since = datetime.combine(first_day, time.min)
    sales = db.scalars(select(Sale).where(Sale.date >= since)).all()

    per_day = {first_day + timedelta(days=i): [0, 0] for i in range(days)}
    for s in sales:
        per_day[s.date.date()][0] += s.gross_total
        per_day[s.date.date()][1] += 1
    assured = sum(1 for s in sales if s.type == "assuree")
    simple = len(sales) - assured

    ooc = _out_of_coverage(db, since)
    out_of_stock = db.scalars(select(Product).where(Product.stock == 0).order_by(Product.name)).all()
    limit_date = today + timedelta(days=settings.expiry_warning_days)
    expiring = db.scalars(select(Product).where(Product.expiry.is_not(None), Product.expiry <= limit_date)
                          .order_by(Product.expiry)).all()
    return {
        "period_days": days, "gross_total": sum(s.gross_total for s in sales), "sales_count": len(sales),
        "assured_count": assured, "simple_count": simple,
        "assured_rate": round(assured / len(sales) * 100) if sales else 0,
        "daily": [{"date": d, "gross_total": v[0], "sales_count": v[1]} for d, v in per_day.items()],
        "out_of_coverage": ooc[:20], "out_of_coverage_total": sum(r["count"] for r in ooc),
        "stock_out_count": len(out_of_stock), "stock_outs": [_alert_row(p, today) for p in out_of_stock[:50]],
        "expiring_count": len(expiring), "expiring": [_alert_row(p, today) for p in expiring[:50]],
    }


@router.get("/out-of-coverage.csv", summary="Export CSV des produits hors couverture (admin)")
def export_out_of_coverage(days: int = Query(7, ge=1, le=365), admin: User = Depends(require_admin),
                           db: Session = Depends(get_db)):
    since = datetime.combine(utcnow().date() - timedelta(days=days - 1), time.min)
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=";", quoting=csv.QUOTE_ALL)
    writer.writerow(["Produit", "Organisme", "Demandes hors couverture"])
    for r in _out_of_coverage(db, since):
        writer.writerow([r["name"], r["insurer"], r["count"]])
    log_action(db, admin, "Export CSV", "Synthèse blocages comptoir")
    db.commit()
    return Response("\ufeff" + buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="optidesk-synthese.csv"'})
