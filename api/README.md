# OptiDesk — API (backend FastAPI)

L'API sert aussi l'interface du dossier `../frontend`. Voir le `README.md` à la racine pour le lancement.

## Démarrage
```
cd api
python -m venv .venv && .venv\Scripts\activate      # Windows
pip install -r requirements.txt
python run.py                                       # http://127.0.0.1:8765/docs
```
Premier lancement : tables + données de démonstration (relancer n'ajoute rien).

| Compte | Identifiant | PIN | Rôle |
|---|---|---|---|
| LACLE Erika | `erika` | 2580 | admin (Titulaire) |
| AGBEVON Rachelle | `rachelle` | 1234 | vendeur (Préparateur) |

Installation réelle sans démo : `OPTIDESK_SEED_DEMO=false` → catégories, règles et un compte `admin` (PIN 0000, à changer aussitôt).

## Tester dans Swagger (/docs)
1. `POST /auth/login` → copier `access_token` → bouton **Authorize** → coller.
2. Refaire avec l'autre compte pour vérifier les 403 côté vendeur.

## Tests automatiques
```
pip install -r requirements-dev.txt
python -m pytest -q
```

## Variables d'environnement (préfixe `OPTIDESK_`)
`DATABASE_URL` (PostgreSQL : `postgresql+psycopg://…`, installer `psycopg[binary]`), `DATA_DIR`, `SECRET`,
`ACCESS_TOKEN_MINUTES` (480), `REFRESH_TOKEN_DAYS` (7), `EXPIRY_WARNING_DAYS` (90), `SEED_DEMO`, `PORT` (8765).

## Structure
```
run.py / run_exe.py   dev (reload) / sidecar .exe
app.py                assemble les routeurs sous /api/v1, erreurs en français
core/                 config, security (bcrypt, JWT, limiteur), deps (permissions), audit (log_action)
routers/coverage.py   moteur de couverture (aucune route)
routers/*.py          auth users products categories stock clients rules sales audit dashboard imports
services.py           enregistrement d'une vente + présentation (partagés routeurs / seed)
importer.py           lecture CSV/Excel Winpharma, détection des colonnes, upsert
models.py schemas.py seed.py db.py
optidesk-api.spec     PyInstaller
```

## Export .exe
```
cd api && pip install pyinstaller && pyinstaller optidesk-api.spec   # -> dist/optidesk-api/
```
Le sidecar range sa base et sa clé dans `%APPDATA%/OptiDesk`.
