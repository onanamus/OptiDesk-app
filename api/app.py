"""Assemble l'API : routeurs sous /api/v1, Swagger sur /docs, erreurs en langage métier."""
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import IntegrityError

from core.config import settings
from db import init_db
from routers import (audit, auth, categories, clients, dashboard, imports, products, rules, sales, stock,
                     users)

API_PREFIX = "/api/v1"
VERSION = "1.0.0"

FIELD_FR = {"pin": "code PIN", "old_pin": "ancien code PIN", "login": "identifiant", "name": "nom",
            "price": "prix", "stock": "stock", "quantity": "quantité", "rate": "taux", "insurer": "organisme",
            "first_name": "prénom", "last_name": "nom de famille", "policy_number": "n° d'assuré",
            "valid_until": "validité", "expiry": "péremption", "category": "catégorie", "scope": "périmètre",
            "lines": "lignes de la vente", "delta": "ajustement", "photo": "photo", "code": "code"}
TYPE_FR = {
    "missing": "champ obligatoire",
    "string_type": "doit être du texte",
    "int_type": "doit être un nombre entier", "int_parsing": "doit être un nombre entier",
    "bool_type": "doit être vrai ou faux", "bool_parsing": "doit être vrai ou faux",
    "greater_than_equal": "valeur trop petite", "less_than_equal": "valeur trop grande",
    "string_too_short": "texte trop court", "string_too_long": "texte trop long",
    "too_short": "la liste ne peut pas être vide", "too_long": "liste trop longue",
    "date_parsing": "date invalide (format AAAA-MM-JJ)", "date_type": "date invalide (format AAAA-MM-JJ)",
    "date_from_datetime_parsing": "date invalide (format AAAA-MM-JJ)",
    "json_invalid": "corps de la requête illisible",
    "string_pattern_mismatch": "format incorrect",
}


def _validation_message(errors: list[dict]) -> str:
    parts = []
    for e in errors:
        field = next((str(x) for x in reversed(e["loc"]) if not isinstance(x, int) and x not in ("body", "query")), None)
        etype = e["type"]
        if etype == "value_error":
            msg = e["msg"].removeprefix("Value error, ")
        elif etype == "string_pattern_mismatch" and field in ("pin", "old_pin"):
            msg = "Le code PIN doit contenir exactement 4 chiffres."
        elif etype == "string_type" and field in ("pin", "old_pin"):
            msg = "Le code PIN doit être envoyé sous forme de texte de 4 chiffres."
        elif etype == "literal_error":
            msg = f"valeur non autorisée (attendu : {e.get('ctx', {}).get('expected', '…')})"
        else:
            msg = TYPE_FR.get(etype, "valeur invalide")
        parts.append(f"« {FIELD_FR.get(field, field)} » : {msg}" if field and etype != "value_error" else msg)
    return "Données invalides — " + " ; ".join(parts)


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()       # idempotent : crée les tables et le seed au premier lancement seulement
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="OptiDesk API", version=VERSION, lifespan=lifespan,
        description="API de la pharmacie ADJOLOLO : vente au comptoir, couverture assurantielle, stock, audit. "
                    "Pour tester dans Swagger : POST /auth/login, copiez `access_token`, puis « Authorize ».")
    # Application locale : toute page ouverte depuis ce PC (localhost / 127.0.0.1, n'importe quel port —
    # Live Server de VS Code sur :5500, Vite sur :5173…) peut appeler l'API, ainsi que file:// (origine « null »).
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins,
                       allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
                       allow_methods=["*"], allow_headers=["*"])

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        # 400 (et non 422) : le contrat de routes n'admet que 200/201/400/401/403/404/409
        return JSONResponse({"detail": _validation_message(exc.errors())}, status_code=400)

    @app.exception_handler(IntegrityError)
    async def _integrity(_: Request, exc: IntegrityError):
        return JSONResponse({"detail": "Cette opération entre en conflit avec des données existantes "
                                       "(doublon ou élément encore utilisé)."}, status_code=409)

    for module in (auth, users, products, categories, stock, clients, rules, sales, audit, dashboard, imports):
        app.include_router(module.router, prefix=API_PREFIX)

    @app.get(f"{API_PREFIX}/health", tags=["Système"], summary="État du service (surveillé par Electron)")
    def health():
        return {"status": "ok", "version": VERSION}

    # L'interface est servie par l'API elle-même (même origine : pas de CORS, un seul programme à lancer).
    # Montée en dernier : les routes /api/v1, /docs et /openapi.json restent prioritaires.
    if (settings.frontend_dir / "index.html").exists():
        app.mount("/", StaticFiles(directory=settings.frontend_dir, html=True), name="frontend")
    else:
        @app.get("/", include_in_schema=False)
        def root():
            return {"app": "OptiDesk API", "docs": "/docs"}

    return app


app = create_app()
