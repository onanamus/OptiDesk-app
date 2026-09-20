"""Modèles SQLAlchemy 2 (Mapped). Libellés métier en français, noms de champs en anglais."""
from datetime import date, datetime, timezone
from typing import Optional

from sqlalchemy import (Boolean, CheckConstraint, Date, DateTime, ForeignKey, Integer, String,
                        Text, UniqueConstraint, event)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.text import normalize
from db import Base


def utcnow() -> datetime:
    """Horodatage UTC naïf. Le Togo est à UTC+0 : heure locale = heure UTC, pas de décalage."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class User(Base):
    __tablename__ = "users"
    __table_args__ = (CheckConstraint("role in ('admin','vendeur')", name="ck_users_role"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80))                  # « NOM Prénom »
    login: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    pin_hash: Mapped[str] = mapped_column(String(100))             # bcrypt, jamais le PIN en clair
    role: Mapped[str] = mapped_column(String(10), default="vendeur")   # admin | vendeur
    photo: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # data URL
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class RefreshToken(Base):
    """Jetons de rafraîchissement émis : permet la rotation et la révocation."""
    __tablename__ = "refresh_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    jti: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(60), unique=True)


class Product(Base):
    __tablename__ = "products"
    __table_args__ = (
        CheckConstraint("price >= 0", name="ck_products_price"),
        CheckConstraint("stock >= 0", name="ck_products_stock"),
        CheckConstraint("source in ('import','manuel')", name="ck_products_source"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(150), index=True)
    dci: Mapped[str] = mapped_column(String(150), default="")
    code: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id", ondelete="RESTRICT"))
    price: Mapped[int] = mapped_column(Integer)                    # FCFA, entier
    stock: Mapped[int] = mapped_column(Integer, default=0)
    last_stock: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # stock avant mise en rupture
    expiry: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    source: Mapped[str] = mapped_column(String(10), default="manuel")  # import | manuel
    search_text: Mapped[str] = mapped_column(Text, default="")     # nom + DCI + code, sans accents
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    category: Mapped["Category"] = relationship(lazy="joined")


class Client(Base):
    __tablename__ = "clients"

    id: Mapped[int] = mapped_column(primary_key=True)
    first_name: Mapped[str] = mapped_column(String(60))
    last_name: Mapped[str] = mapped_column(String(60))
    insurer: Mapped[str] = mapped_column(String(40))
    policy_number: Mapped[str] = mapped_column(String(40), default="")
    valid_until: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    frequent: Mapped[bool] = mapped_column(Boolean, default=False)
    last_purchase: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    photo: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    search_text: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    usual_cart: Mapped[list["UsualCartItem"]] = relationship(
        cascade="all, delete-orphan", order_by="UsualCartItem.id", lazy="selectin")


class UsualCartItem(Base):
    """Panier habituel d'un client (régénéré à chaque vente par l'API)."""
    __tablename__ = "usual_cart_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"))
    quantity: Mapped[int] = mapped_column(Integer, default=1)

    product: Mapped["Product"] = relationship(lazy="joined")


class CoverageRule(Base):
    __tablename__ = "coverage_rules"
    __table_args__ = (
        UniqueConstraint("insurer", "scope", name="uq_rule_insurer_scope"),
        CheckConstraint("rate between 0 and 100", name="ck_rule_rate"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    insurer: Mapped[str] = mapped_column(String(40), index=True)
    scope: Mapped[str] = mapped_column(String(60))                 # catégorie exacte, « Tous » ou « Tous médicaments »
    rate: Mapped[int] = mapped_column(Integer)                     # 0..100
    exclusion: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)  # catégorie exclue
    note: Mapped[str] = mapped_column(String(200), default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class Sale(Base):
    __tablename__ = "sales"
    __table_args__ = (CheckConstraint("type in ('simple','assuree')", name="ck_sales_type"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    reference: Mapped[str] = mapped_column(String(20), unique=True, index=True)   # V1001, V1002...
    type: Mapped[str] = mapped_column(String(10))                  # simple | assuree
    client_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("clients.id", ondelete="SET NULL"), nullable=True, index=True)
    seller_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    date: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    gross_total: Mapped[int] = mapped_column(Integer, default=0)       # brut
    insurer_share: Mapped[int] = mapped_column(Integer, default=0)     # part assurance
    patient_share: Mapped[int] = mapped_column(Integer, default=0)     # reste à charge
    note: Mapped[str] = mapped_column(String(300), default="")
    insurer: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)         # figé à la vente
    policy_number: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)   # figé à la vente

    client: Mapped[Optional["Client"]] = relationship(lazy="joined")
    seller: Mapped[Optional["User"]] = relationship(lazy="joined")
    lines: Mapped[list["SaleLine"]] = relationship(
        cascade="all, delete-orphan", order_by="SaleLine.id", lazy="selectin")


class SaleLine(Base):
    __tablename__ = "sale_lines"

    id: Mapped[int] = mapped_column(primary_key=True)
    sale_id: Mapped[int] = mapped_column(ForeignKey("sales.id", ondelete="CASCADE"), index=True)
    # SET NULL : supprimer un produit ne doit jamais effacer l'historique des ventes
    product_id: Mapped[Optional[int]] = mapped_column(ForeignKey("products.id", ondelete="SET NULL"), nullable=True)
    name: Mapped[str] = mapped_column(String(150))                 # figé à la vente
    price: Mapped[int] = mapped_column(Integer)                    # figé à la vente
    quantity: Mapped[int] = mapped_column(Integer)
    coverage_rate: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # None = non calculable / vente simple


class SaleModel(Base):
    """Modèle de vente récurrente (F6.4)."""
    __tablename__ = "sale_models"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    client_id: Mapped[Optional[int]] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), nullable=True)
    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    lines: Mapped[list["SaleModelLine"]] = relationship(
        cascade="all, delete-orphan", order_by="SaleModelLine.id", lazy="selectin")


class SaleModelLine(Base):
    __tablename__ = "sale_model_lines"

    id: Mapped[int] = mapped_column(primary_key=True)
    model_id: Mapped[int] = mapped_column(ForeignKey("sale_models.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[Optional[int]] = mapped_column(ForeignKey("products.id", ondelete="SET NULL"), nullable=True)
    name: Mapped[str] = mapped_column(String(150))
    price: Mapped[int] = mapped_column(Integer)
    quantity: Mapped[int] = mapped_column(Integer)


class AuditEntry(Base):
    """Journal d'audit : ajout uniquement, aucun endpoint de modification ni de purge."""
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    user_name: Mapped[str] = mapped_column(String(80), default="Système")   # figé : survit à un renommage
    action: Mapped[str] = mapped_column(String(60))
    detail: Mapped[str] = mapped_column(String(500), default="")


class AppSetting(Base):
    """Petite table clé/valeur (ex. last_import, seed_version)."""
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(40), primary_key=True)
    value: Mapped[str] = mapped_column(String(200))


# --- Colonnes de recherche sans accents, tenues à jour automatiquement -------------------------

@event.listens_for(Product, "before_insert")
@event.listens_for(Product, "before_update")
def _product_search_text(_mapper, _conn, target: Product) -> None:
    target.search_text = normalize(f"{target.name} {target.dci} {target.code}")


@event.listens_for(Client, "before_insert")
@event.listens_for(Client, "before_update")
def _client_search_text(_mapper, _conn, target: Client) -> None:
    target.search_text = normalize(
        f"{target.last_name} {target.first_name} {target.insurer} {target.policy_number}")
