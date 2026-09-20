# -*- mode: python ; coding: utf-8 -*-
# Programme OptiDesk (API + interface) : pyinstaller optidesk-api.spec  ->  dist/optidesk-api/optidesk-api(.exe)
from PyInstaller.utils.hooks import collect_submodules

hidden = (
    collect_submodules("uvicorn")
    + collect_submodules("passlib.handlers")
    + collect_submodules("jose")
    + collect_submodules("sqlalchemy.dialects.sqlite")
    + ["bcrypt", "multipart", "openpyxl", "email_validator"]
    + ["models", "schemas", "services", "seed", "importer", "app", "db"]
    + collect_submodules("routers")
    + collect_submodules("core")
)

a = Analysis(
    ["run_exe.py"],
    pathex=["."],
    datas=[("../frontend", "frontend")],      # l'interface est embarquée et servie par l'API
    hiddenimports=hidden,
    excludes=["tkinter", "pytest", "numpy", "PIL", "lxml", "pandas", "matplotlib", "scipy", "IPython"],
)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="optidesk-api", console=True)
coll = COLLECT(exe, a.binaries, a.datas, name="optidesk-api")
