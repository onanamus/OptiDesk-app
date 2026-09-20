"""Catégories / rayons."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from core.audit import log_action
from core.deps import current_user, get_db, require_admin
from core.text import normalize
from models import Category, CoverageRule, Product, User
from schemas import CategoryIn, CategoryOut

router = APIRouter(prefix="/categories", tags=["Catalogue"])


@router.get("", response_model=list[CategoryOut])
def list_categories(_: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.execute(select(Category.name, func.count(Product.id)).outerjoin(Product)
                      .group_by(Category.id).order_by(Category.name)).all()
    return [{"name": name, "product_count": n} for name, n in rows]


@router.post("", response_model=CategoryOut, status_code=201, summary="Créer une catégorie (admin)")
def create_category(body: CategoryIn, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    if any(normalize(n) == normalize(body.name) for n in db.scalars(select(Category.name))):
        raise HTTPException(409, f"La catégorie « {body.name} » existe déjà.")
    db.add(Category(name=body.name))
    log_action(db, admin, "Catégorie créée", body.name)
    db.commit()
    return {"name": body.name, "product_count": 0}


@router.delete("/{name}", status_code=204, summary="Supprimer une catégorie (admin, refusée si utilisée)")
def delete_category(name: str, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    cat = db.scalar(select(Category).where(Category.name == name))
    if cat is None:
        raise HTTPException(404, f"La catégorie « {name} » n'existe pas.")
    n_products = db.scalar(select(func.count(Product.id)).where(Product.category_id == cat.id)) or 0
    if n_products:
        raise HTTPException(409, f"La catégorie « {name} » est utilisée par {n_products} produit(s) : "
                                 "déplacez-les d'abord dans un autre rayon.")
    n_rules = db.scalar(select(func.count(CoverageRule.id)).where(
        (CoverageRule.scope == name) | (CoverageRule.exclusion == name))) or 0
    if n_rules:
        raise HTTPException(409, f"La catégorie « {name} » est citée par {n_rules} règle(s) de couverture : "
                                 "modifiez ces règles d'abord.")
    db.delete(cat)
    log_action(db, admin, "Catégorie supprimée", name)
    db.commit()
