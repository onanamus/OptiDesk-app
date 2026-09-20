"""Logique métier partagée (ventes, présentation des produits/clients/ventes).
Rien ici n'est écrit deux fois : routeurs et seed passent par ces fonctions."""
from dataclasses import dataclass
from datetime import date, datetime

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from core.audit import log_action
from core.config import settings
from core.text import fmt_fcfa
from models import Client, Product, Sale, SaleLine, UsualCartItem, User, utcnow
from routers.coverage import Coverage, coverage_payload, couverture, rules_by_insurer, split_amount


# --- Présentation --------------------------------------------------------------------------------

def availability(stock: int) -> str:
    if stock <= 0:
        return "rupture"
    return "faible" if stock <= settings.low_stock_threshold else "disponible"


def days_to_expiry(p: Product, today: date | None = None) -> int | None:
    return (p.expiry - (today or utcnow().date())).days if p.expiry else None


def alternatives_for(db: Session, p: Product, limit: int = 2) -> list[dict]:
    rows = db.scalars(
        select(Product).where(Product.category_id == p.category_id, Product.id != p.id, Product.stock > 0)
        .order_by(Product.id).limit(limit))
    return [{"id": a.id, "name": a.name, "price": a.price} for a in rows]


def product_out(p: Product, *, client: Client | None = None, rules: dict | None = None,
                alternatives: list[dict] | None = None, today: date | None = None) -> dict:
    today = today or utcnow().date()
    days = days_to_expiry(p, today)
    cov = None
    if client is not None:
        cov = coverage_payload(couverture(client, p, (rules or {}).get(client.insurer, []), today), p.price)
    return {
        "id": p.id, "name": p.name, "dci": p.dci, "code": p.code, "category": p.category.name,
        "price": p.price, "stock": p.stock, "expiry": p.expiry, "source": p.source,
        "availability": availability(p.stock), "days_to_expiry": days,
        "expiring_soon": days is not None and days <= settings.expiry_warning_days,
        "updated_at": p.updated_at, "coverage": cov, "alternatives": alternatives,
    }


def client_out(c: Client, today: date | None = None) -> dict:
    today = today or utcnow().date()
    return {
        "id": c.id, "first_name": c.first_name, "last_name": c.last_name,
        "full_name": f"{c.last_name} {c.first_name}", "insurer": c.insurer,
        "policy_number": c.policy_number, "valid_until": c.valid_until,
        "coverage_alert": "a_verifier" if c.valid_until and c.valid_until < today else None,
        "frequent": c.frequent, "last_purchase": c.last_purchase,
        "usual_cart_count": len(c.usual_cart), "usual_products": [i.product.name for i in c.usual_cart],
        "photo": c.photo,
    }


def _client_ref(sale: Sale) -> dict | None:
    if sale.client is None:
        return None
    return {"id": sale.client.id, "full_name": f"{sale.client.last_name} {sale.client.first_name}",
            "insurer": sale.insurer or sale.client.insurer,
            "policy_number": sale.policy_number if sale.policy_number is not None else sale.client.policy_number}


def sale_out(sale: Sale) -> dict:
    lines = []
    for l in sale.lines:
        insured, patient = split_amount(l.price, l.quantity, l.coverage_rate)
        lines.append({"product_id": l.product_id, "name": l.name, "price": l.price,
                      "quantity": l.quantity, "total": l.price * l.quantity,
                      "coverage_rate": l.coverage_rate, "insurer_share": insured, "patient_share": patient})
    return {
        "reference": sale.reference, "type": sale.type, "date": sale.date,
        "seller": sale.seller.name if sale.seller else None, "client": _client_ref(sale),
        "note": sale.note, "lines": lines,
        "totals": {"gross_total": sale.gross_total, "insurer_share": sale.insurer_share,
                   "patient_share": sale.patient_share},
    }


def build_slip(sale: Sale) -> dict:
    """Bordereau prêt à ressaisir dans Winpharma. Le rendu imprimable est fait côté frontend."""
    base = sale_out(sale)
    return {
        "pharmacy": {"name": settings.pharmacy_name, "address": settings.pharmacy_address},
        "reference": base["reference"], "date": base["date"], "seller": base["seller"],
        "client": base["client"], "lines": base["lines"], "totals": base["totals"],
        "mention": "Document généré par OptiDesk. La facturation officielle reste effectuée dans Winpharma.",
    }


# --- Calcul et enregistrement d'une vente -----------------------------------------------------------

@dataclass
class RawLine:
    product_id: int | None
    quantity: int
    name: str | None = None      # hors catalogue uniquement
    price: int | None = None     # hors catalogue uniquement


@dataclass
class PricedLine:
    product: Product | None
    name: str
    price: int
    quantity: int
    coverage: Coverage | None    # None : vente simple ou ligne hors catalogue


def price_lines(db: Session, client: Client | None, lines: list[RawLine],
                today: date | None = None) -> tuple[list[PricedLine], int, int]:
    """Cœur du calcul, partagé par la simulation (quote) et l'enregistrement : nom et prix viennent
    du catalogue, la couverture du moteur. Retourne (lignes, brut, part assurance)."""
    # Fusion des lignes catalogue en double (même produit ajouté deux fois)
    merged: list[RawLine] = []
    by_product: dict[int, RawLine] = {}
    for l in lines:
        if l.product_id is None:
            merged.append(RawLine(None, l.quantity, l.name, l.price))
        elif l.product_id in by_product:
            by_product[l.product_id].quantity += l.quantity
        else:
            by_product[l.product_id] = RawLine(l.product_id, l.quantity)
            merged.append(by_product[l.product_id])

    products = {p.id: p for p in db.scalars(select(Product).where(Product.id.in_(list(by_product))))} \
        if by_product else {}
    missing = [pid for pid in by_product if pid not in products]
    if missing:
        raise HTTPException(400, "Un produit du panier n'existe plus dans le catalogue "
                                 f"(n° {missing[0]}). Retirez-le du panier puis relancez la recherche.")

    today = today or utcnow().date()
    rules = rules_by_insurer(db).get(client.insurer, []) if client else []
    priced: list[PricedLine] = []
    gross = insured_total = 0
    for l in merged:
        product = products.get(l.product_id) if l.product_id is not None else None
        name, price = (product.name, product.price) if product else (l.name, l.price)
        cov = couverture(client, product, rules, today) if (client and product) else None
        insured, _ = split_amount(price, l.quantity, cov.rate if cov else None)
        gross += price * l.quantity
        insured_total += insured
        priced.append(PricedLine(product, name, price, l.quantity, cov))
    return priced, gross, insured_total


def quote_out(client: Client | None, priced: list[PricedLine], gross: int, insured: int) -> dict:
    return {
        "type": "assuree" if client else "simple",
        "lines": [{"product_id": p.product.id if p.product else None, "name": p.name, "price": p.price,
                   "quantity": p.quantity, "total": p.price * p.quantity,
                   "coverage": coverage_payload(p.coverage, p.price, p.quantity)} for p in priced],
        "totals": {"gross_total": gross, "insurer_share": insured, "patient_share": gross - insured},
    }


def register_sale(db: Session, seller: User | None, lines: list[RawLine], client: Client | None = None,
                  note: str = "", when: datetime | None = None, audit: bool = True) -> Sale:
    """Enregistre une vente. Le SERVEUR recalcule tout : les montants reçus ne sont jamais crus.
    L'appelant fait le commit."""
    when = when or utcnow()
    priced, gross, insured_total = price_lines(db, client, lines, when.date())
    sale = Sale(reference=f"tmp-{id(priced)}", type="assuree" if client else "simple",
                client_id=client.id if client else None, seller_id=seller.id if seller else None,
                date=when, note=note, insurer=client.insurer if client else None,
                policy_number=client.policy_number if client else None,
                gross_total=gross, insurer_share=insured_total, patient_share=gross - insured_total)
    for p in priced:
        sale.lines.append(SaleLine(product_id=p.product.id if p.product else None, name=p.name,
                                   price=p.price, quantity=p.quantity,
                                   coverage_rate=p.coverage.rate if p.coverage else None))
    db.add(sale)
    db.flush()
    sale.reference = f"V{1000 + sale.id}"

    if client:
        _update_client_after_sale(db, client, sale, priced)
    if audit:
        detail = f"{sale.reference} · {'assurée' if client else 'simple'} · {fmt_fcfa(gross)}"
        if client:
            detail += f" · {client.last_name} {client.first_name}"
        if when.date() != utcnow().date():
            detail += f" · saisie pour le {when.strftime('%d/%m/%Y')}"
        log_action(db, seller, "Vente enregistrée", detail)
    return sale


def _update_client_after_sale(db: Session, client: Client, sale: Sale, priced: list[PricedLine]) -> None:
    """C'est l'API qui met à jour le client — pas le frontend : dernier achat, statut fréquent,
    panier habituel (régénéré à partir des lignes du catalogue de cette vente)."""
    sale_day = sale.date.date()
    if client.last_purchase is None or sale_day >= client.last_purchase:
        client.last_purchase = sale_day
    n_sales = db.scalar(select(func.count(Sale.id)).where(Sale.client_id == client.id)) or 0
    if not client.frequent and n_sales >= 2:
        client.frequent = True
    catalogue = [p for p in priced if p.product is not None]
    if catalogue:
        client.usual_cart.clear()
        db.flush()
        for p in catalogue:
            client.usual_cart.append(UsualCartItem(product_id=p.product.id, quantity=p.quantity))
