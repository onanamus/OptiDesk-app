"""Moteur de couverture — cœur métier d'OptiDesk.

Appelé par la recherche produits, le panier habituel ET l'enregistrement d'une vente :
la couverture n'est JAMAIS calculée par le frontend. Ce module ne contient aucune route.

    couverture(client, produit)
      -> règles de l'organisme du client
      -> exclusion de catégorie ?                 -> non couvert
      -> règle la plus spécifique (catégorie exacte), sinon repli sur « Tous »
      -> taux : 100 = full · 0 < t < 100 = partial · 0 = none
      -> + alerte « à vérifier » si la validité de la couverture du client est dépassée
"""
from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.text import normalize
from models import Client, CoverageRule, Product, utcnow

FULL, PARTIAL, NONE = "full", "partial", "none"
ALERT_A_VERIFIER = "a_verifier"


@dataclass(frozen=True)
class Coverage:
    status: str                    # full | partial | none
    rate: int                      # 0..100
    alert: str | None = None       # "a_verifier" si la validité du client est dépassée
    rule_id: int | None = None     # règle appliquée (None = aucune)


def rules_by_insurer(db: Session) -> dict[str, list[CoverageRule]]:
    """Charge toutes les règles en une requête (à faire une fois par appel d'API)."""
    grouped: dict[str, list[CoverageRule]] = {}
    for rule in db.scalars(select(CoverageRule).order_by(CoverageRule.id)):
        grouped.setdefault(rule.insurer, []).append(rule)
    return grouped


def _status_for(rate: int) -> str:
    return FULL if rate >= 100 else PARTIAL if rate > 0 else NONE


def couverture(client: Client, product: Product, rules: list[CoverageRule],
               today: date | None = None) -> Coverage:
    """Couverture d'un produit pour un client. `rules` = règles de l'organisme du client."""
    today = today or utcnow().date()
    alert = ALERT_A_VERIFIER if client.valid_until and client.valid_until < today else None
    category = normalize(product.category.name)

    # 1. Exclusion de catégorie : elle l'emporte sur tout taux (on ne promet jamais une prise
    #    en charge qu'une règle exclut explicitement).
    for rule in rules:
        if rule.exclusion and normalize(rule.exclusion) == category:
            return Coverage(NONE, 0, alert, rule.id)

    # 2. Règle la plus spécifique : catégorie exacte
    chosen = next((r for r in rules if normalize(r.scope) == category), None)

    # 3. Sinon repli sur « Tous » (puis sur toute règle « Tous … », ex. « Tous médicaments »)
    if chosen is None:
        chosen = next((r for r in rules if normalize(r.scope) == "tous"), None) \
            or next((r for r in rules if normalize(r.scope).startswith("tous")), None)

    if chosen is None:
        return Coverage(NONE, 0, alert)
    return Coverage(_status_for(chosen.rate), chosen.rate, alert, chosen.id)


def split_amount(unit_price: int, quantity: int, rate: int | None) -> tuple[int, int]:
    """(part assurance, reste à charge) d'une ligne — entiers FCFA, arrondi à l'unité la plus proche."""
    gross = unit_price * quantity
    insured = (gross * (rate or 0) + 50) // 100
    return insured, gross - insured


def coverage_payload(cov: Coverage | None, unit_price: int, quantity: int = 1) -> dict | None:
    """Représentation JSON de la couverture, avec reste à charge estimé pour `quantity` unités."""
    if cov is None:
        return None
    insured, patient = split_amount(unit_price, quantity, cov.rate)
    return {"status": cov.status, "rate": cov.rate, "alert": cov.alert,
            "insurer_share": insured, "patient_share": patient}
