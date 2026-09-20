"""Catalogue : recherche comptoir (avec couverture croisée), péremptions, CRUD admin, stock."""
import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from core.audit import diff_detail, log_action
from core.config import settings
from core.deps import current_user, get_db, require_admin
from core.text import normalize
from models import Category, Client, Product, User, utcnow
from routers.coverage import rules_by_insurer
from schemas import (ExpiringOut, OutOfStockIn, ProductCreate, ProductOut, ProductPage, ProductUpdate,
                     StockAdjustIn)
from services import alternatives_for, product_out

router = APIRouter(prefix="/products", tags=["Catalogue"])

LABELS = {"name": "nom", "dci": "DCI", "code": "code", "category": "catégorie",
          "price": "prix", "stock": "stock", "expiry": "péremption"}


def _get_category(db: Session, name: str) -> Category:
    cat = db.scalar(select(Category).where(Category.name == name))
    if cat is None:
        raise HTTPException(400, f"La catégorie « {name} » n'existe pas. Créez-la d'abord.")
    return cat


def _get_product(db: Session, product_id: int) -> Product:
    p = db.get(Product, product_id)
    if p is None:
        raise HTTPException(404, "Ce produit n'existe pas ou a été supprimé.")
    return p


def _check_code_free(db: Session, code: str, own_id: int | None = None) -> None:
    other = db.scalar(select(Product).where(Product.code == code))
    if other and other.id != own_id:
        raise HTTPException(409, f"Le code « {code} » est déjà utilisé par « {other.name} ».")


@router.get("", response_model=ProductPage, summary="Recherche comptoir (+ couverture si client_id)")
def list_products(
    q: str | None = Query(None, description="Nom, DCI ou code — insensible aux accents et à la casse"),
    client_id: int | None = Query(None, description="Si présent : statut de couverture et reste à charge estimé"),
    category: str | None = None,
    with_alternatives: bool = Query(False, description="Joindre 2 alternatives en stock aux produits en rupture"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    _: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    client = None
    if client_id is not None:
        client = db.get(Client, client_id)
        if client is None:
            raise HTTPException(404, "Ce client n'existe pas ou a été supprimé.")

    conds = [Product.search_text.contains(tok, autoescape=True) for tok in normalize(q).split()] if q else []
    if category:
        conds.append(Product.category.has(Category.name == category))

    total = db.scalar(select(func.count(Product.id)).where(*conds)) or 0
    rows = db.scalars(select(Product).where(*conds).order_by(Product.name).limit(limit).offset(offset)).all()

    rules = rules_by_insurer(db) if client else None
    today = utcnow().date()
    items = [product_out(p, client=client, rules=rules, today=today,
                         alternatives=alternatives_for(db, p) if with_alternatives and p.stock == 0 else None)
             for p in rows]
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/expiring", response_model=ExpiringOut, summary="Péremptions proches (délai de retour fournisseur : 7 j)")
def expiring(_: User = Depends(current_user), db: Session = Depends(get_db)):
    today = utcnow().date()
    limit_date = today + timedelta(days=settings.expiry_warning_days)
    rows = db.scalars(select(Product).where(Product.expiry.is_not(None), Product.expiry <= limit_date)
                      .order_by(Product.expiry)).all()
    return {"warning_days": settings.expiry_warning_days, "return_window_days": settings.supplier_return_days,
            "items": [product_out(p, today=today) for p in rows]}


@router.post("", response_model=ProductOut, status_code=201, summary="Créer un produit manuellement (admin, F10.1)")
def create_product(body: ProductCreate, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    cat = _get_category(db, body.category)
    code = body.code
    if code:
        _check_code_free(db, code)
    else:
        code = next(c for c in (f"MAN-{secrets.token_hex(3).upper()}" for _ in range(50))
                    if not db.scalar(select(Product.id).where(Product.code == c)))
    p = Product(name=body.name, dci=body.dci, code=code, category=cat, price=body.price,
                stock=body.stock, expiry=body.expiry, source="manuel")
    db.add(p)
    log_action(db, admin, "Produit créé", p.name)
    db.commit()
    return product_out(p)


@router.patch("/{product_id}", response_model=ProductOut, summary="Modifier un produit (admin, F10.2)")
def update_product(product_id: int, body: ProductUpdate, admin: User = Depends(require_admin),
                   db: Session = Depends(get_db)):
    p = _get_product(db, product_id)
    changes = body.model_dump(exclude_unset=True)
    for field in ("name", "code", "category", "price"):       # champs obligatoires : pas de null
        if field in changes and changes[field] is None:
            raise HTTPException(400, f"Le champ « {LABELS[field]} » ne peut pas être vide.")
    if changes.get("stock", 0) is None:
        del changes["stock"]
    if "dci" in changes and changes["dci"] is None:
        changes["dci"] = ""
    new_category = _get_category(db, changes["category"]) if "category" in changes else None
    if "code" in changes:
        _check_code_free(db, changes["code"], own_id=p.id)

    before = {"name": p.name, "dci": p.dci, "code": p.code, "category": p.category.name,
              "price": p.price, "stock": p.stock, "expiry": p.expiry}
    for field, value in changes.items():
        if field == "category":
            p.category = new_category
        else:
            setattr(p, field, value)
    detail = diff_detail(before, {**before, **changes}, LABELS)
    log_action(db, admin, "Produit modifié", p.name + (f" · {detail}" if detail else ""))
    db.commit()
    return product_out(p)


@router.patch("/{product_id}/stock", response_model=ProductOut, summary="Ajuster le stock +/- (admin, F10.3)")
def adjust_stock(product_id: int, body: StockAdjustIn, admin: User = Depends(require_admin),
                 db: Session = Depends(get_db)):
    p = _get_product(db, product_id)
    old = p.stock
    p.stock = max(0, old + body.delta)          # jamais de stock négatif
    log_action(db, admin, "Stock ajusté", f"{p.name} : {old} → {p.stock} ({body.delta:+d})")
    db.commit()
    return product_out(p)


@router.patch("/{product_id}/outofstock", response_model=ProductOut,
              summary="Marquer en rupture / réactiver (admin, F10.4)")
def toggle_out_of_stock(product_id: int, body: OutOfStockIn, admin: User = Depends(require_admin),
                        db: Session = Depends(get_db)):
    p = _get_product(db, product_id)
    if body.out_of_stock:
        if p.stock > 0:
            p.last_stock = p.stock              # mémorisé pour la réactivation
        p.stock = 0
        log_action(db, admin, "Produit marqué en rupture", p.name)
    else:
        p.stock = body.quantity or p.last_stock or 1
        log_action(db, admin, "Produit réactivé", f"{p.name} : stock rétabli à {p.stock}")
    db.commit()
    return product_out(p)


@router.delete("/{product_id}", status_code=204, summary="Supprimer un produit (admin)")
def delete_product(product_id: int, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    """La confirmation est gérée côté UI. L'historique des ventes est conservé (nom et prix figés)."""
    p = _get_product(db, product_id)
    log_action(db, admin, "Produit supprimé", p.name)
    db.delete(p)
    db.commit()
