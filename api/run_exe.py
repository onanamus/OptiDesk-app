"""Programme du .exe : API + interface dans un seul processus.
Sans Electron, il ouvre le navigateur par défaut sur l'interface (OPTIDESK_OPEN_BROWSER=false pour l'éviter)."""
import os
import threading
import time
import urllib.request
import webbrowser

os.environ.setdefault("OPTIDESK_MODE", "exe")     # base dans %APPDATA%/OptiDesk

import uvicorn  # noqa: E402

from app import app  # noqa: E402
from core.config import settings  # noqa: E402
from db import init_db  # noqa: E402


def _open_when_ready(url: str) -> None:
    for _ in range(60):
        try:
            urllib.request.urlopen(f"{url}/api/v1/health", timeout=1)
            webbrowser.open(url)
            return
        except Exception:
            time.sleep(0.5)


if __name__ == "__main__":
    init_db()
    if os.environ.get("OPTIDESK_OPEN_BROWSER", "true").lower() != "false":
        threading.Thread(target=_open_when_ready, args=(f"http://{settings.host}:{settings.port}",),
                         daemon=True).start()
    uvicorn.run(app, host=settings.host, port=settings.port, log_level="warning")
