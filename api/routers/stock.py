"""Fraîcheur du stock : horodatage du dernier import Winpharma (affiché en permanence par le frontend)."""
from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from core.config import settings
from core.deps import current_user, get_db
from models import AppSetting, Product, User, utcnow
from schemas import FreshnessOut

router = APIRouter(prefix="/stock", tags=["Catalogue"])


@router.get("/freshness", response_model=FreshnessOut)
def freshness(_: User = Depends(current_user), db: Session = Depends(get_db)):
    raw = db.get(AppSetting, "last_import")
    last = datetime.fromisoformat(raw.value) if raw else None
    hours = round((utcnow() - last).total_seconds() / 3600, 1) if last else None
    n_imported = db.scalar(select(func.count(Product.id)).where(Product.source == "import")) or 0
    return {"last_import": last, "imported_products": n_imported, "hours_since": hours,
            "stale": last is None or hours > settings.stock_stale_hours}
