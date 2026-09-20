"""Import Winpharma en deux temps : aperçu (rien n'est écrit), puis commit (jamais d'application directe)."""
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

import importer
from core.audit import log_action
from core.deps import get_db, require_admin
from models import AppSetting, Product, User, utcnow
from schemas import ImportCommitIn, ImportCommitOut, ImportPreviewOut

router = APIRouter(prefix="/import", tags=["Import Winpharma"])


def _fail(exc: importer.ImportFileError, status: int = 400):
    return HTTPException(status, str(exc))


def _analyse(db: Session, table: importer.Table, mapping: dict) -> dict:
    """Compte ce que l'import ferait, sans rien écrire."""
    missing = importer.missing_required(mapping)
    rows, skipped, duplicates, existing = [], [], 0, {}
    if not missing:
        rows, skipped, duplicates = importer.parse_rows(table, mapping)
        existing = dict(db.execute(select(Product.code, Product.source)).all())
    warnings = skipped[:10] + ([f"… et {len(skipped) - 10} autre(s) ligne(s) ignorée(s)"] if len(skipped) > 10 else [])
    if duplicates:
        warnings.append(f"{duplicates} code(s) présent(s) plusieurs fois : la dernière ligne est retenue.")
    if missing:
        warnings.append("Colonne(s) à indiquer : " + ", ".join(missing) + ".")
    return {
        "mapping": mapping, "missing_required": missing, "detected_count": len(rows),
        "new_count": sum(1 for r in rows if r["code"] not in existing),
        "update_count": sum(1 for r in rows if r["code"] in existing),
        "manual_count": sum(1 for r in rows if existing.get(r["code"]) == "manuel"),
        "skipped_count": len(skipped), "warnings": warnings,
        "sample": [{k: v for k, v in r.items() if k != "row"} for r in rows[:5]],
    }


def _columns(table: importer.Table) -> list[dict]:
    return [{"index": i, "header": h} for i, h in enumerate(table.headers)]


@router.post("/winpharma", response_model=ImportPreviewOut,
             summary="Étape 1 — aperçu : détecte les colonnes et compte les produits. RIEN n'est écrit.")
async def preview(file: UploadFile = File(...), _: User = Depends(require_admin), db: Session = Depends(get_db)):
    content = await file.read()
    filename = file.filename or "import"
    try:
        table = importer.read_table(content, filename)
    except importer.ImportFileError as exc:
        raise _fail(exc)
    analysis = _analyse(db, table, importer.detect_mapping(table.headers))
    return {"import_id": importer.save_pending(content, filename), "filename": filename,
            "columns": _columns(table), **analysis}


@router.post("/winpharma/recount", response_model=ImportPreviewOut,
             summary="Étape 1 bis — recompte après modification du mapping. RIEN n'est écrit.")
def recount(body: ImportCommitIn, _: User = Depends(require_admin), db: Session = Depends(get_db)):
    try:
        content, filename = importer.load_pending(body.import_id)
        table = importer.read_table(content, filename)
    except importer.ImportFileError as exc:
        raise _fail(exc, 404)
    mapping = {f: (h if h in table.headers else None) for f, h in body.mapping.items() if f in importer.FIELDS}
    mapping = {f: mapping.get(f) for f in importer.FIELDS}
    return {"import_id": body.import_id, "filename": filename, "columns": _columns(table),
            **_analyse(db, table, mapping)}


@router.post("/winpharma/commit", response_model=ImportCommitOut,
             summary="Étape 2 — applique le mapping validé (upsert, horodatage, audit)")
def commit(body: ImportCommitIn, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    try:
        content, filename = importer.load_pending(body.import_id)
        table = importer.read_table(content, filename)
    except importer.ImportFileError as exc:
        raise _fail(exc, 404)

    mapping = {f: h for f, h in body.mapping.items() if f in importer.FIELDS and h}
    unknown = [h for h in mapping.values() if h not in table.headers]
    if unknown:
        raise HTTPException(400, f"La colonne « {unknown[0]} » n'existe pas dans le fichier.")
    missing = importer.missing_required(mapping)
    if missing:
        raise HTTPException(400, "Indiquez la colonne : " + ", ".join(missing) + ".")

    rows, skipped, _dups = importer.parse_rows(table, mapping)
    if not rows:
        raise HTTPException(400, "Aucune ligne exploitable dans ce fichier. Vérifiez le choix des colonnes.")
    created, updated, manual = importer.apply_import(db, rows)

    now = utcnow()
    setting = db.get(AppSetting, "last_import")
    if setting:
        setting.value = now.isoformat()
    else:
        db.add(AppSetting(key="last_import", value=now.isoformat()))
    detail = f"{filename} : {len(rows):,} produits ({created} nouveaux, {updated} mis à jour".replace(",", "\u00a0")
    detail += f", {len(skipped)} ligne(s) ignorée(s))" if skipped else ")"
    if manual:
        detail += f" · saisis à la main, mis à jour par l'import : {', '.join(manual[:8])}"
        detail += f" (+{len(manual) - 8})" if len(manual) > 8 else ""
    log_action(db, admin, "Import Winpharma", detail)
    db.commit()
    importer.drop_pending(body.import_id)
    return {"created": created, "updated": updated, "skipped": len(skipped),
            "manual_updated": manual, "last_import": now}
