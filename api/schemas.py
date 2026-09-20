"""Schémas Pydantic v2 (entrée / sortie). Messages de validation en langage métier."""
import re
import datetime as _dt
from datetime import date, datetime
from typing import Annotated, Literal, Optional

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator

INSURERS = ("INAM", "AMU", "Privée (ASCOMA)")
Insurer = Literal["INAM", "AMU", "Privée (ASCOMA)"]
Role = Literal["admin", "vendeur"]

# --- Types réutilisables -------------------------------------------------------------------------

Pin = Annotated[str, Field(pattern=r"^\d{4}$")]      # exactement 4 chiffres


def _photo(v: Optional[str]) -> Optional[str]:
    if not v:
        return None
    if not v.startswith("data:image/"):
        raise ValueError("La photo doit être une image.")
    if len(v) > 700_000:
        raise ValueError("La photo est trop lourde (500 Ko maximum).")
    return v


Photo = Annotated[Optional[str], AfterValidator(_photo)]


def _person_name(v: str) -> str:
    v = re.sub(r"\s+", " ", v).strip()
    parts = v.split(" ")
    if len(parts) < 2:
        raise ValueError("Saisissez le nom puis le prénom (ex. AGBEVON Rachelle).")
    parts[0] = parts[0].upper()          # « NOM Prénom » : le nom est en majuscules
    return " ".join(parts)


PersonName = Annotated[str, Field(min_length=3, max_length=80), AfterValidator(_person_name)]


class In(BaseModel):
    """Base des schémas d'entrée : espaces superflus retirés."""
    model_config = ConfigDict(str_strip_whitespace=True)


class Out(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --- Authentification / comptes --------------------------------------------------------------------

class LoginIn(In):
    login: str = Field(min_length=1, max_length=40)
    pin: Pin


class RefreshIn(In):
    refresh_token: str


class RegisterIn(In):
    """Création de compte depuis l'écran de connexion : autorisée par le PIN d'un titulaire."""
    name: PersonName
    role: Role = "vendeur"
    pin: Pin
    photo: Photo = None
    admin_pin: Pin


class LogoutIn(In):
    refresh_token: Optional[str] = None


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class UserOut(Out):
    id: int
    name: str
    login: str
    role: Role
    photo: Optional[str] = None
    active: bool
    created_at: datetime


class PublicAccount(Out):
    """Ce que voit l'écran de connexion (choix du compte avant saisie du PIN). Jamais de PIN."""
    id: int
    name: str
    login: str
    role: Role
    photo: Optional[str] = None


class UserCreate(In):
    name: PersonName
    login: Optional[str] = Field(default=None, pattern=r"^[a-z0-9._-]{3,30}$")
    pin: Pin
    role: Role = "vendeur"
    photo: Photo = None


class UserSelfUpdate(In):
    name: Optional[PersonName] = None
    photo: Photo = None
    pin: Optional[Pin] = None              # nouveau PIN
    old_pin: Optional[Pin] = None          # ancien PIN, exigé pour changer de PIN

    @model_validator(mode="after")
    def _old_pin_required(self):
        if self.pin and not self.old_pin:
            raise ValueError("Saisissez votre ancien code PIN pour en choisir un nouveau.")
        return self


class ActiveIn(In):
    active: bool


# --- Catalogue -------------------------------------------------------------------------------------

class CategoryIn(In):
    name: str = Field(min_length=1, max_length=60)


class CategoryOut(BaseModel):
    name: str
    product_count: int


class ProductCreate(In):
    name: str = Field(min_length=1, max_length=150)
    dci: str = Field(default="", max_length=150)
    code: Optional[str] = Field(default=None, max_length=40)
    category: str
    price: int = Field(ge=0, le=100_000_000)
    stock: int = Field(default=0, ge=0, le=1_000_000)
    expiry: Optional[date] = None


class ProductUpdate(In):
    name: Optional[str] = Field(default=None, min_length=1, max_length=150)
    dci: Optional[str] = Field(default=None, max_length=150)
    code: Optional[str] = Field(default=None, min_length=1, max_length=40)
    category: Optional[str] = None
    price: Optional[int] = Field(default=None, ge=0, le=100_000_000)
    stock: Optional[int] = Field(default=None, ge=0, le=1_000_000)
    expiry: Optional[date] = None


class StockAdjustIn(In):
    delta: int = Field(ge=-100_000, le=100_000)

    @model_validator(mode="after")
    def _non_zero(self):
        if self.delta == 0:
            raise ValueError("L'ajustement ne peut pas être nul.")
        return self


class OutOfStockIn(In):
    out_of_stock: bool
    quantity: Optional[int] = Field(default=None, ge=1, le=1_000_000)   # stock rétabli à la réactivation


class CoverageOut(BaseModel):
    status: Literal["full", "partial", "none"]
    rate: int
    alert: Optional[Literal["a_verifier"]] = None
    insurer_share: int          # part assurance estimée (pour 1 unité dans la recherche)
    patient_share: int          # reste à charge estimé


class AlternativeOut(BaseModel):
    id: int
    name: str
    price: int


class ProductOut(BaseModel):
    id: int
    name: str
    dci: str
    code: str
    category: str
    price: int
    stock: int
    expiry: Optional[date]
    source: Literal["import", "manuel"]
    availability: Literal["disponible", "faible", "rupture"]
    days_to_expiry: Optional[int]
    expiring_soon: bool
    updated_at: datetime
    coverage: Optional[CoverageOut] = None
    alternatives: Optional[list[AlternativeOut]] = None


class ProductPage(BaseModel):
    items: list[ProductOut]
    total: int
    limit: int
    offset: int


class ExpiringOut(BaseModel):
    warning_days: int
    return_window_days: int
    items: list[ProductOut]


class FreshnessOut(BaseModel):
    last_import: Optional[datetime]
    imported_products: int
    hours_since: Optional[float]
    stale: bool


# --- Clients ---------------------------------------------------------------------------------------

class ClientCreate(In):
    first_name: str = Field(min_length=1, max_length=60)
    last_name: str = Field(min_length=1, max_length=60)
    insurer: Insurer
    policy_number: str = Field(default="", max_length=40)
    valid_until: Optional[date] = None
    photo: Photo = None


class ClientUpdate(In):
    first_name: Optional[str] = Field(default=None, min_length=1, max_length=60)
    last_name: Optional[str] = Field(default=None, min_length=1, max_length=60)
    insurer: Optional[Insurer] = None
    policy_number: Optional[str] = Field(default=None, max_length=40)
    valid_until: Optional[date] = None
    photo: Photo = None


class ClientOut(BaseModel):
    id: int
    first_name: str
    last_name: str
    full_name: str              # « NOM Prénom »
    insurer: str
    policy_number: str
    valid_until: Optional[date]
    coverage_alert: Optional[Literal["a_verifier"]]
    frequent: bool
    last_purchase: Optional[date]
    usual_cart_count: int
    usual_products: list[str]   # noms des produits du panier habituel
    photo: Optional[str] = None


class FrequentClientOut(ClientOut):
    score: int


class Totals(BaseModel):
    gross_total: int
    insurer_share: int
    patient_share: int


class UsualCartLineOut(BaseModel):
    product_id: int
    name: str
    price: int
    quantity: int
    stock: int
    availability: Literal["disponible", "faible", "rupture"]
    coverage: Optional[CoverageOut]


class UsualCartOut(BaseModel):
    client_id: int
    lines: list[UsualCartLineOut]
    totals: Totals


# --- Règles de couverture ------------------------------------------------------------------------------

class RuleCreate(In):
    insurer: Insurer
    scope: str = Field(min_length=1, max_length=60)
    rate: int = Field(ge=0, le=100)
    exclusion: Optional[str] = Field(default=None, max_length=60)
    note: str = Field(default="", max_length=200)


class RuleUpdate(In):
    insurer: Optional[Insurer] = None
    scope: Optional[str] = Field(default=None, min_length=1, max_length=60)
    rate: Optional[int] = Field(default=None, ge=0, le=100)
    exclusion: Optional[str] = Field(default=None, max_length=60)
    note: Optional[str] = Field(default=None, max_length=200)


class RuleOut(Out):
    id: int
    insurer: str
    scope: str
    rate: int
    exclusion: Optional[str]
    note: str
    updated_at: datetime


# --- Ventes ------------------------------------------------------------------------------------------

class SaleLineIn(In):
    """Ligne reçue du frontend. Pour un produit du catalogue, seul `product_id` et `quantity`
    comptent : nom et prix sont relus en base. Hors catalogue (F6.6) : nom et prix sont saisis."""
    product_id: Optional[int] = None
    name: Optional[str] = Field(default=None, min_length=1, max_length=150)
    price: Optional[int] = Field(default=None, ge=0, le=100_000_000)
    quantity: int = Field(ge=1, le=999)

    @model_validator(mode="after")
    def _off_catalogue(self):
        if self.product_id is None and (not self.name or self.price is None):
            raise ValueError("Une ligne hors catalogue doit avoir un nom et un prix.")
        return self


class SaleCreate(In):
    client_id: Optional[int] = None      # présent = vente assurée ; absent = vente simple
    lines: list[SaleLineIn] = Field(min_length=1, max_length=100)
    note: str = Field(default="", max_length=300)
    date: Optional[_dt.date] = None      # vente manuelle saisie après coup (≤ aujourd'hui, 60 jours max)


class QuoteLineOut(BaseModel):
    product_id: Optional[int]
    name: str
    price: int
    quantity: int
    total: int
    coverage: Optional[CoverageOut]      # None = vente simple ou ligne hors catalogue


class QuoteOut(BaseModel):
    """Simulation d'une vente : mêmes calculs que l'enregistrement, mais rien n'est écrit."""
    type: Literal["simple", "assuree"]
    lines: list[QuoteLineOut]
    totals: Totals


class SaleLineOut(BaseModel):
    product_id: Optional[int]
    name: str
    price: int
    quantity: int
    total: int
    coverage_rate: Optional[int]
    insurer_share: int
    patient_share: int


class ClientRef(BaseModel):
    id: int
    full_name: str
    insurer: Optional[str]
    policy_number: Optional[str]


class SaleOut(BaseModel):
    reference: str
    type: Literal["simple", "assuree"]
    date: datetime
    seller: Optional[str]
    client: Optional[ClientRef]
    note: str
    lines: list[SaleLineOut]
    totals: Totals


class SalePage(BaseModel):
    items: list[SaleOut]
    total: int
    page: int
    page_size: int


class SlipOut(BaseModel):
    pharmacy: dict
    reference: str
    date: datetime
    seller: Optional[str]
    client: Optional[ClientRef]
    lines: list[SaleLineOut]
    totals: Totals
    mention: str


class SaleModelIn(In):
    name: str = Field(min_length=1, max_length=80)
    client_id: Optional[int] = None
    lines: list[SaleLineIn] = Field(min_length=1, max_length=100)


class SaleModelLineOut(BaseModel):
    product_id: Optional[int]
    name: str
    price: int
    quantity: int


class SaleModelOut(BaseModel):
    id: int
    name: str
    client_id: Optional[int]
    created_at: datetime
    lines: list[SaleModelLineOut]


class TodaySummary(BaseModel):
    date: date
    sales_count: int
    gross_total: int
    assured_count: int
    assured_total: int
    simple_count: int
    simple_total: int
    clients_served: int
    yesterday_gross_total: int
    trend_percent: Optional[int]      # None si hier = 0


# --- Audit, tableau de bord, import ------------------------------------------------------------------------

class AuditOut(BaseModel):
    id: int
    ts: datetime
    user: str
    action: str
    detail: str


class AuditPage(BaseModel):
    items: list[AuditOut]
    total: int
    users: list[str]      # noms présents dans le journal (pour le filtre)


class DailyPoint(BaseModel):
    date: date
    gross_total: int
    sales_count: int


class OutOfCoverageRow(BaseModel):
    name: str
    insurer: str
    count: int


class StockAlertRow(BaseModel):
    id: int
    name: str
    code: str
    category: str
    stock: int
    expiry: Optional[date]
    days_to_expiry: Optional[int]


class DashboardOut(BaseModel):
    period_days: int
    gross_total: int
    sales_count: int
    assured_count: int
    simple_count: int
    assured_rate: int                       # pourcentage
    daily: list[DailyPoint]
    out_of_coverage: list[OutOfCoverageRow]
    out_of_coverage_total: int
    stock_out_count: int
    stock_outs: list[StockAlertRow]
    expiring_count: int
    expiring: list[StockAlertRow]


class ColumnInfo(BaseModel):
    index: int
    header: str


class ImportPreviewOut(BaseModel):
    import_id: str
    filename: str
    columns: list[ColumnInfo]
    mapping: dict[str, Optional[str]]       # champ OptiDesk -> en-tête de colonne proposé
    missing_required: list[str]
    detected_count: int
    new_count: int
    update_count: int
    manual_count: int                       # produits saisis à la main qui seront mis à jour
    skipped_count: int
    warnings: list[str]
    sample: list[dict]


class ImportCommitIn(In):
    import_id: str
    mapping: dict[str, Optional[str]]


class ImportCommitOut(BaseModel):
    created: int
    updated: int
    skipped: int
    manual_updated: list[str]
    last_import: datetime
