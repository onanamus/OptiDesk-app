"""Petits utilitaires de texte partagés (recherche sans accents, montants, logins)."""
import re
import unicodedata


def normalize(text: str | None) -> str:
    """Minuscules, sans accents, espaces compactés : sert à la recherche insensible aux accents."""
    decomposed = unicodedata.normalize("NFKD", text or "")
    no_accents = "".join(c for c in decomposed if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", no_accents.lower()).strip()


def slugify_login(text: str) -> str:
    """'Rachelle' -> 'rachelle' ; sert à proposer un identifiant à la création d'un compte."""
    slug = re.sub(r"[^a-z0-9]+", "", normalize(text))
    return slug[:30] or "user"


def fmt_fcfa(amount: int) -> str:
    """3550 -> '3 550 FCFA' (espace insécable, comme le fait le frontend)."""
    return f"{int(amount):,}".replace(",", "\u00a0") + "\u00a0FCFA"
