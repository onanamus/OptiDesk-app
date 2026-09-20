"""Configuration de l'application (variables d'environnement préfixées OPTIDESK_)."""
import os
import secrets
import sys
from pathlib import Path

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

APP_DIR = Path(__file__).resolve().parent.parent


def _default_data_dir() -> Path:
    """Mode .exe : %APPDATA%/OptiDesk (jamais à côté de l'exécutable). Mode dev : api/data."""
    if os.environ.get("OPTIDESK_MODE") == "exe" or getattr(sys, "frozen", False):
        base = os.environ.get("APPDATA") or str(Path.home() / ".config")
        return Path(base) / "OptiDesk"
    return APP_DIR / "data"


def _default_frontend_dir() -> Path:
    """Dossier de l'interface (index.html, app*.js, style.css) servi par l'API elle-même."""
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", APP_DIR)) / "frontend"
    return APP_DIR.parent / "frontend"


def _load_or_create_secret(data_dir: Path) -> str:
    """Clé de signature des jetons : générée une fois, conservée dans le dossier de données."""
    path = data_dir / "secret.key"
    if path.exists():
        return path.read_text().strip()
    value = secrets.token_urlsafe(48)
    path.write_text(value)
    return value


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="OPTIDESK_", extra="ignore")

    data_dir: Path = Field(default_factory=_default_data_dir)
    database_url: str = ""          # vide = SQLite dans data_dir ; sinon postgresql+psycopg://...
    secret: str = ""                # vide = clé générée et conservée dans data_dir/secret.key

    access_token_minutes: int = 480  # 8 h
    refresh_token_days: int = 7
    expiry_warning_days: int = 90    # péremption proche
    supplier_return_days: int = 7    # délai de retour fournisseur
    low_stock_threshold: int = 10    # au-delà : disponible ; 1..seuil : stock faible ; 0 : rupture
    stock_stale_hours: int = 24      # au-delà, le stock est signalé « à réimporter »

    login_max_attempts: int = 5      # tentatives ratées tolérées ...
    login_window_seconds: int = 60   # ... par minute et par identifiant
    bcrypt_rounds: int = 12

    frontend_dir: Path = Field(default_factory=_default_frontend_dir)
    open_browser: bool = False       # run_exe.py : ouvre le navigateur au démarrage (sauf si Electron)

    host: str = "127.0.0.1"
    port: int = 8765
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173", "null"]

    seed_demo: bool = True           # False : uniquement catégories, règles et un compte admin initial
    pharmacy_name: str = "Pharmacie ADJOLOLO"
    pharmacy_address: str = "58 rue de la Charité, Nyékonakpoè, Lomé, Togo"

    @model_validator(mode="after")
    def _fill_defaults(self):
        self.data_dir.mkdir(parents=True, exist_ok=True)
        if not self.database_url:
            self.database_url = f"sqlite:///{(self.data_dir / 'optidesk.db').as_posix()}"
        if not self.secret:
            self.secret = _load_or_create_secret(self.data_dir)
        return self


settings = Settings()
