"""PIN (bcrypt), jetons JWT, limitation des tentatives de connexion."""
import math
import threading
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from passlib.context import CryptContext

from core.config import settings

ALGORITHM = "HS256"
_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=settings.bcrypt_rounds)


class TokenError(Exception):
    """Jeton absent, illisible, expiré ou du mauvais type."""


# --- PIN ---------------------------------------------------------------------------------------

def hash_pin(pin: str) -> str:
    return _pwd.hash(pin)


def verify_pin(pin: str, pin_hash: str) -> bool:
    try:
        return _pwd.verify(pin, pin_hash)
    except ValueError:
        return False


_DUMMY_HASH = hash_pin("0000")


def burn_time(pin: str) -> None:
    """Vérification factice : un identifiant inconnu prend le même temps qu'un identifiant valide."""
    _pwd.verify(pin, _DUMMY_HASH)


# --- Jetons ------------------------------------------------------------------------------------

def _now() -> datetime:
    return datetime.now(timezone.utc)


def create_access_token(user_id: int, role: str) -> str:
    exp = _now() + timedelta(minutes=settings.access_token_minutes)
    claims = {"sub": str(user_id), "role": role, "type": "access", "jti": uuid.uuid4().hex, "exp": exp}
    return jwt.encode(claims, settings.secret, algorithm=ALGORITHM)


def create_refresh_token(user_id: int, role: str) -> tuple[str, str, datetime]:
    """Retourne (jeton, jti, expiration UTC naïve) : le jti est enregistré pour permettre la rotation."""
    exp = _now() + timedelta(days=settings.refresh_token_days)
    jti = uuid.uuid4().hex
    claims = {"sub": str(user_id), "role": role, "type": "refresh", "jti": jti, "exp": exp}
    return jwt.encode(claims, settings.secret, algorithm=ALGORITHM), jti, exp.replace(tzinfo=None)


def decode_token(token: str, expected_type: str) -> dict:
    try:
        payload = jwt.decode(token, settings.secret, algorithms=[ALGORITHM])
    except JWTError as exc:
        raise TokenError("Jeton invalide ou expiré.") from exc
    if payload.get("type") != expected_type or "sub" not in payload:
        raise TokenError("Ce jeton ne peut pas être utilisé ici.")
    return payload


# --- Limitation des tentatives -------------------------------------------------------------------

class AttemptLimiter:
    """Fenêtre glissante en mémoire : `max_attempts` échecs par `window` secondes et par clé."""

    def __init__(self, max_attempts: int, window: int):
        self.max_attempts, self.window = max_attempts, window
        self._fails: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def retry_after(self, key: str) -> int:
        """0 si la clé peut essayer, sinon le nombre de secondes à attendre."""
        now = time.monotonic()
        with self._lock:
            q = self._fails[key]
            while q and now - q[0] > self.window:
                q.popleft()
            if len(q) >= self.max_attempts:
                return max(1, math.ceil(self.window - (now - q[0])))
        return 0

    def register_failure(self, key: str) -> None:
        with self._lock:
            self._fails[key].append(time.monotonic())

    def reset(self, key: str) -> None:
        with self._lock:
            self._fails.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._fails.clear()


login_limiter = AttemptLimiter(settings.login_max_attempts, settings.login_window_seconds)
