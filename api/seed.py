"""Données de démonstration (idempotent : un drapeau `seed_version` empêche tout doublon)."""
from datetime import timedelta

from sqlalchemy.orm import Session

from core.audit import log_action
from core.config import settings
from core.security import hash_pin
from models import (AppSetting, Category, Client, CoverageRule, Product, UsualCartItem, User, utcnow)
from services import RawLine, register_sale

CATEGORIES = ["Antalgiques", "Antibiotiques", "Antipaludiques", "Cardiovasculaire", "Digestif",
              "Vitamines", "Matériel", "Parapharmacie"]

RULES = [  # (organisme, périmètre, taux, exclusion, note)
    ("INAM", "Antipaludiques", 100, None, "Paludisme : prise en charge intégrale"),
    ("INAM", "Tous médicaments", 80, None, "Médicaments sur liste remboursable"),
    ("INAM", "Matériel", 50, None, "Matériel médical"),
    ("AMU", "Antipaludiques", 100, None, "Accès gratuit aux antipaludiques"),
    ("AMU", "Tous", 70, None, "Couverture AMU standard"),
    ("Privée (ASCOMA)", "Tous", 70, "Parapharmacie", "Exclut la parapharmacie"),
]

# (nom, DCI, code, catégorie, prix, stock, jours avant péremption, source, ancienneté de mise à jour en h)
PRODUCTS = [
    ("Doliprane 500mg (boîte 16)", "Paracétamol", "DOL500", "Antalgiques", 350, 124, 320, "import", 3),
    ("Efferalgan 1g (boîte 8)", "Paracétamol", "EFF1G", "Antalgiques", 850, 42, 280, "import", 3),
    ("Amoxicilline 500mg (boîte 12)", "Amoxicilline", "AMX500", "Antibiotiques", 1200, 8, 24, "import", 3),
    ("Coartem 20/120 (boîte 24)", "Artéméther + Luméfantrine", "COA20", "Antipaludiques", 2800, 15, 58, "import", 3),
    ("Amodiaquine 200mg", "Amodiaquine", "AMO200", "Antipaludiques", 900, 0, 210, "import", 50),
    ("Amlodipine 5mg (boîte 30)", "Amlodipine", "AML5", "Cardiovasculaire", 1500, 30, 400, "manuel", 96),
    ("Metronidazole 250mg", "Metronidazole", "MET250", "Antibiotiques", 700, 55, 85, "import", 3),
    ("Vitamine C 500mg", "Acide ascorbique", "VTC500", "Vitamines", 400, 200, 500, "manuel", 120),
    ("SRO (sels de réhydratation orale)", "SRO", "SRO01", "Digestif", 250, 80, 150, "import", 3),
    ("Compresses stériles (boîte 50)", "", "COMP50", "Matériel", 600, 35, None, "import", 3),
    ("Sérum physiologique 5ml (x20)", "NaCl 0,9%", "SER5", "Matériel", 500, 0, 40, "import", 27),
    ("Crème hydratante corps 200ml", "", "CRM200", "Parapharmacie", 3500, 12, None, "manuel", 140),
]

# (prénom, NOM, organisme, n° d'assuré, validité en jours depuis aujourd'hui, fréquent)
CLIENTS = [
    ("Kossi", "AGBEKO", "INAM", "INAM-10245", 465, True),
    ("Amévi", "TCHALLA", "AMU", "AMU-8832", 284, True),
    ("Adzo", "MENSAH", "Privée (ASCOMA)", "ASC-5510", 57, True),
    ("Sarah", "KOUDJOU", "INAM", "INAM-11998", -231, False),     # validité dépassée → « à vérifier »
    ("Blankah", "LAWSON", "Privée (ASCOMA)", "ASC-7021", 193, False),
]

# (jours en arrière, heure, minute, client n° (1-based) ou None, [(produit n°, quantité)])
SALES = [
    (6, 9, 15, 1, [(1, 2), (4, 1)]), (6, 11, 40, None, [(12, 1)]),
    (5, 10, 5, 2, [(6, 1), (8, 3)]), (5, 16, 22, 3, [(7, 2), (9, 4)]),
    (4, 9, 50, None, [(2, 1), (8, 2)]), (3, 12, 10, 1, [(1, 3), (10, 2)]),
    (2, 10, 30, 3, [(9, 6)]), (2, 15, 5, None, [(11, 2)]),
    (1, 9, 20, 2, [(6, 1)]), (1, 14, 45, 1, [(1, 2), (4, 1)]),
    (0, 10, 10, 3, [(7, 1), (9, 2)]), (0, 11, 30, None, [(12, 2)]),
]


def run(db: Session) -> None:
    if db.get(AppSetting, "seed_version"):
        return
    now = utcnow()
    today = now.date()

    cats = {name: Category(name=name) for name in CATEGORIES}
    db.add_all(cats.values())
    db.add_all(CoverageRule(insurer=i, scope=s, rate=r, exclusion=e, note=n) for i, s, r, e, n in RULES)

    if not settings.seed_demo:
        # Installation réelle : uniquement les données de référence + un premier compte à personnaliser.
        db.add(User(name="TITULAIRE Admin", login="admin", pin_hash=hash_pin("0000"), role="admin"))
        db.add(AppSetting(key="seed_version", value="1"))
        db.commit()
        return

    erika = User(name="LACLE Erika", login="erika", pin_hash=hash_pin("2580"), role="admin")
    rachelle = User(name="AGBEVON Rachelle", login="rachelle", pin_hash=hash_pin("1234"), role="vendeur")
    db.add_all([erika, rachelle])

    last_import = now - timedelta(hours=3)
    products = []
    for name, dci, code, cat, price, stock, days, source, age_h in PRODUCTS:
        products.append(Product(
            name=name, dci=dci, code=code, category=cats[cat], price=price, stock=stock, source=source,
            expiry=today + timedelta(days=days) if days is not None else None,
            updated_at=last_import if source == "import" and age_h <= 3 else now - timedelta(hours=age_h)))
    db.add_all(products)
    db.add(AppSetting(key="last_import", value=last_import.isoformat()))

    clients = [Client(first_name=f, last_name=l, insurer=ins, policy_number=pol,
                      valid_until=today + timedelta(days=d), frequent=freq)
               for f, l, ins, pol, d, freq in CLIENTS]
    db.add_all(clients)
    db.flush()      # attribue les identifiants (produits n° 1..12, clients n° 1..5)

    for days_ago, h, m, cn, lines in SALES:       # ordre chronologique : le panier habituel = dernière vente
        when = min((now - timedelta(days=days_ago)).replace(hour=h, minute=m, second=0, microsecond=0), now)
        register_sale(db, erika, [RawLine(products[p - 1].id, q) for p, q in lines],
                      clients[cn - 1] if cn else None, when=when, audit=False)
    db.flush()
    clients[3].last_purchase = today - timedelta(days=9)
    clients[4].last_purchase = today - timedelta(days=22)
    clients[4].usual_cart.append(UsualCartItem(product_id=products[11].id, quantity=1))

    log_action(db, None, "Initialisation", "Données de démonstration chargées")
    db.add(AppSetting(key="seed_version", value="1"))
    db.commit()
