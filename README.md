# OptiDesk — logiciel complet

Pharmacie ADJOLOLO · aide à la vente au comptoir et vérification de la couverture assurantielle.
Application de bureau **100 % hors-ligne** : interface + API + base SQLite, livrée sous forme d'un installateur Windows.

## Fabriquer l'installateur (`OptiDesk-Setup-1.0.0.exe`)

L'installateur doit être construit **sur Windows** (PyInstaller ne sait pas compiler pour Windows depuis un autre système). Deux voies :

**A. Sur votre PC Windows** — installer une fois Python 3.11+ et Node.js 20+, puis double-clic sur
`Construire-Installateur.bat`. Résultat : `desktop\dist\OptiDesk-Setup-1.0.0.exe`.

**B. Sans rien installer** — déposer le dossier sur GitHub, onglet *Actions* → *Installateur Windows* → *Run workflow*.
GitHub construit, teste le programme serveur compilé puis met l'installateur en téléchargement (*Artifacts*).

## Ce que voit le pharmacien
Un assistant d'installation en français (choix du dossier, raccourcis Bureau et menu Démarrer, aucun droit administrateur requis),
puis une application « OptiDesk » avec son icône, son écran de démarrage et sa fenêtre dédiée — comme n'importe quel logiciel du commerce.
Désinstallation depuis *Paramètres Windows › Applications*. Les données (`%APPDATA%\OptiDesk`) sont conservées à la désinstallation.

## Comptes de démonstration
| Compte | PIN | Rôle |
|---|---|---|
| LACLE Erika | 2580 | Titulaire / Admin |
| AGBEVON Rachelle | 1234 | Vendeur / Préparateur |

Installation réelle sans données de démo : variable `OPTIDESK_SEED_DEMO=false` (compte `admin`, PIN 0000, à changer aussitôt).
La création d'un compte depuis l'écran de connexion exige le PIN d'un titulaire (F9.2).

## Développer / tester sans installateur
```
Lancer OptiDesk.bat                          # ouvre l'interface dans le navigateur (Windows)
cd api && python run.py                      # http://127.0.0.1:8765  ·  /docs (Swagger)
cd api && python -m pytest -q                # 72 tests
cd desktop && npm install && npm start       # fenêtre Electron (utilise api/dist s'il existe, sinon Python)
```

## Organisation
```
api/        FastAPI · SQLAlchemy 2 · JWT · bcrypt · sert aussi l'interface        (voir api/README.md)
frontend/   index.html · style.css · fonts.css + fonts/ (Outfit, hébergée localement) · app1.js · app2.js · app3.js
desktop/    coque Electron (main.js), icône, configuration electron-builder / NSIS
.github/    workflow de construction automatique de l'installateur
```
Le frontend ne calcule rien : couverture, totaux, statistiques, alternatives et péremptions viennent de l'API.

## Distribution : signature du code
L'installateur n'est pas signé : au premier lancement, Windows SmartScreen peut afficher « Windows a protégé votre ordinateur »
(*Informations complémentaires › Exécuter quand même*). Pour un logiciel distribué sur internet sans cet avertissement,
il faut un certificat de signature de code (Authenticode) ; electron-builder le prend en charge via les variables
`CSC_LINK` et `CSC_KEY_PASSWORD`, sans autre modification.
