import os
import sys
import tempfile
from pathlib import Path

# Environnement isolé, posé AVANT tout import de l'application
_tmp = tempfile.mkdtemp(prefix="optidesk_test_")
os.environ["OPTIDESK_DATA_DIR"] = _tmp
os.environ["OPTIDESK_BCRYPT_ROUNDS"] = "4"     # hash rapide pour les tests
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import app  # noqa: E402
from core.security import login_limiter  # noqa: E402

API = "/api/v1"


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:        # démarre le lifespan : tables + seed
        yield c


@pytest.fixture(autouse=True)
def _reset_limiter():
    login_limiter.clear()


def _login(client, login, pin):
    r = client.post(f"{API}/auth/login", json={"login": login, "pin": pin})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="session")
def admin(client):
    return {"Authorization": f"Bearer {_login(client, 'erika', '2580')['access_token']}"}


@pytest.fixture(scope="session")
def vendeur(client):
    return {"Authorization": f"Bearer {_login(client, 'rachelle', '1234')['access_token']}"}
