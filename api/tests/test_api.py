"""Définition of done du brief : démarrage, seed idempotent, statuts, audit, 403 vendeur, couverture."""
import io

import pytest

API = "/api/v1"


def audit_actions(client, admin, **params):
    r = client.get(f"{API}/audit", headers=admin, params={"limit": 1000, **params})
    assert r.status_code == 200
    return [(e["action"], e["detail"]) for e in r.json()["items"]]


def product_by_code(client, admin, code, **params):
    r = client.get(f"{API}/products", headers=admin, params={"q": code, **params})
    assert r.status_code == 200
    return next(p for p in r.json()["items"] if p["code"] == code)


def client_id(client, admin, name):
    return client.get(f"{API}/clients", headers=admin, params={"q": name}).json()[0]["id"]


# --- Démarrage et seed ------------------------------------------------------------------------------

def test_health(client):
    assert client.get(f"{API}/health").json()["status"] == "ok"


def test_seed_is_idempotent(client, admin):
    from db import init_db
    before = (client.get(f"{API}/products", headers=admin).json()["total"],
              client.get(f"{API}/audit", headers=admin).json()["total"])
    init_db()
    init_db()
    after = (client.get(f"{API}/products", headers=admin).json()["total"],
             client.get(f"{API}/audit", headers=admin).json()["total"])
    assert before == after and before[0] == 12


# --- Authentification -------------------------------------------------------------------------------

def test_accounts_list_has_no_secrets(client):
    accounts = client.get(f"{API}/auth/accounts").json()
    assert {a["login"] for a in accounts} >= {"erika", "rachelle"}
    assert all("pin" not in a and "pin_hash" not in a for a in accounts)


def test_login_wrong_pin_401_and_traced(client, admin):
    r = client.post(f"{API}/auth/login", json={"login": "erika", "pin": "0000"})
    assert r.status_code == 401
    assert any(a == "Échec de connexion" for a, _ in audit_actions(client, admin))


@pytest.mark.parametrize("pin", ["12", "12345", "abcd", 2580])
def test_login_pin_must_be_4_digits(client, pin):
    r = client.post(f"{API}/auth/login", json={"login": "erika", "pin": pin})
    assert r.status_code == 400 and "PIN" in r.json()["detail"]


def test_login_rate_limit(client):
    for _ in range(5):
        assert client.post(f"{API}/auth/login", json={"login": "erika", "pin": "1111"}).status_code == 401
    r = client.post(f"{API}/auth/login", json={"login": "erika", "pin": "2580"})
    assert r.status_code == 429 and "Retry-After" in r.headers


def test_refresh_rotates_and_reuse_is_rejected(client):
    first = client.post(f"{API}/auth/login", json={"login": "rachelle", "pin": "1234"}).json()
    second = client.post(f"{API}/auth/refresh", json={"refresh_token": first["refresh_token"]})
    assert second.status_code == 200
    new = second.json()
    assert new["refresh_token"] != first["refresh_token"] and new["access_token"] != first["access_token"]
    assert client.post(f"{API}/auth/refresh", json={"refresh_token": first["refresh_token"]}).status_code == 401
    # vol présumé : le refresh « neuf » est révoqué lui aussi
    assert client.post(f"{API}/auth/refresh", json={"refresh_token": new["refresh_token"]}).status_code == 401


def test_access_token_cannot_be_used_as_refresh(client):
    pair = client.post(f"{API}/auth/login", json={"login": "rachelle", "pin": "1234"}).json()
    assert client.post(f"{API}/auth/refresh", json={"refresh_token": pair["access_token"]}).status_code == 401


def test_no_token_401(client):
    assert client.get(f"{API}/products").status_code == 401
    assert client.get(f"{API}/products", headers={"Authorization": "Bearer nimportequoi"}).status_code == 401


# --- Permissions : le vendeur reçoit 403 sur toutes les routes admin ---------------------------------------

ADMIN_ROUTES = [
    ("get", "/users", None), ("post", "/users", {"name": "A B", "pin": "1234"}),
    ("patch", "/users/1/active", {"active": False}),
    ("post", "/products", {"name": "x", "category": "Digestif", "price": 1}),
    ("patch", "/products/1", {"price": 1}), ("patch", "/products/1/stock", {"delta": 1}),
    ("patch", "/products/1/outofstock", {"out_of_stock": True}), ("delete", "/products/1", None),
    ("post", "/categories", {"name": "Zzz"}), ("delete", "/categories/Digestif", None),
    ("post", "/rules", {"insurer": "AMU", "scope": "Tous", "rate": 10}), ("patch", "/rules/1", {"rate": 10}),
    ("get", "/audit", None), ("get", "/dashboard", None), ("get", "/dashboard/out-of-coverage.csv", None),
    ("post", "/import/winpharma/commit", {"import_id": "0" * 32, "mapping": {}}),
]


@pytest.mark.parametrize("method,path,body", ADMIN_ROUTES)
def test_vendeur_gets_403_on_admin_routes(client, vendeur, method, path, body):
    r = getattr(client, method)(f"{API}{path}", headers=vendeur, **({"json": body} if body else {}))
    assert r.status_code == 403, (path, r.text)


def test_vendeur_gets_403_on_import_upload(client, vendeur):
    r = client.post(f"{API}/import/winpharma", headers=vendeur, files={"file": ("a.csv", b"a;b\n1;2", "text/csv")})
    assert r.status_code == 403


def test_vendeur_can_do_counter_work(client, vendeur):
    assert client.get(f"{API}/products", headers=vendeur, params={"q": "doli"}).status_code == 200
    assert client.get(f"{API}/clients", headers=vendeur).status_code == 200
    assert client.get(f"{API}/rules", headers=vendeur).status_code == 200
    assert client.get(f"{API}/products/expiring", headers=vendeur).status_code == 200


# --- Recherche et couverture croisée -----------------------------------------------------------------

def test_search_is_accent_and_case_insensitive(client, vendeur):
    r = client.get(f"{API}/products", headers=vendeur, params={"q": "METRONIDAZOLE 250"}).json()
    assert r["total"] == 1
    r = client.get(f"{API}/products", headers=vendeur, params={"q": "serum physiologique"}).json()
    assert r["items"][0]["code"] == "SER5"


def test_coverage_full_partial_none_and_expired(client, admin):
    kossi = client_id(client, admin, "AGBEKO")          # INAM
    adzo = client_id(client, admin, "MENSAH")           # ASCOMA, exclut la parapharmacie
    sarah = client_id(client, admin, "KOUDJOU")         # INAM, validité dépassée

    full = product_by_code(client, admin, "COA20", client_id=kossi)["coverage"]
    assert (full["status"], full["rate"], full["patient_share"]) == ("full", 100, 0)

    part = product_by_code(client, admin, "DOL500", client_id=kossi)["coverage"]
    assert (part["status"], part["rate"], part["insurer_share"], part["patient_share"]) == ("partial", 80, 280, 70)

    none = product_by_code(client, admin, "CRM200", client_id=adzo)["coverage"]
    assert (none["status"], none["rate"], none["patient_share"]) == ("none", 0, 3500)

    exp = product_by_code(client, admin, "DOL500", client_id=sarah)["coverage"]
    assert exp["alert"] == "a_verifier"
    assert product_by_code(client, admin, "DOL500")["coverage"] is None      # sans client : pas de couverture


def test_out_of_stock_alternatives(client, admin):
    p = product_by_code(client, admin, "AMO200", with_alternatives=True)
    assert p["availability"] == "rupture" and [a["name"] for a in p["alternatives"]] == ["Coartem 20/120 (boîte 24)"]


def test_expiring_lists_products_under_90_days(client, admin):
    r = client.get(f"{API}/products/expiring", headers=admin).json()
    codes = {p["code"] for p in r["items"]}
    assert {"AMX500", "COA20", "SER5", "MET250"} <= codes and "DOL500" not in codes
    assert r["return_window_days"] == 7 and r["warning_days"] == 90


# --- Ventes ---------------------------------------------------------------------------------------------

def test_sale_totals_are_recomputed_by_the_server(client, vendeur, admin):
    kossi = client_id(client, admin, "AGBEKO")
    doli = product_by_code(client, admin, "DOL500")["id"]
    coa = product_by_code(client, admin, "COA20")["id"]
    body = {"client_id": kossi, "gross_total": 1, "insurer_share": 999999,     # montants menteurs : ignorés
            "lines": [{"product_id": doli, "quantity": 2, "price": 1, "name": "faux"},
                      {"product_id": coa, "quantity": 1},
                      {"name": "Gel douche", "price": 1000, "quantity": 1}]}      # hors catalogue
    r = client.post(f"{API}/sales", headers=vendeur, json=body)
    assert r.status_code == 201, r.text
    sale = r.json()
    assert sale["type"] == "assuree"
    # 2×350 (80 %) + 2800 (100 %) + 1000 hors catalogue (prix plein)
    assert sale["totals"] == {"gross_total": 4500, "insurer_share": 3360, "patient_share": 1140}
    assert sale["lines"][0]["name"] == "Doliprane 500mg (boîte 16)" and sale["lines"][0]["price"] == 350
    assert sale["lines"][2]["coverage_rate"] is None and sale["lines"][2]["patient_share"] == 1000
    assert ("Vente enregistrée", f"{sale['reference']} · assurée") == \
        next((a, d[:len(sale['reference']) + 10]) for a, d in audit_actions(client, admin) if sale["reference"] in d)


def test_simple_sale_has_no_insurance(client, vendeur):
    r = client.post(f"{API}/sales", headers=vendeur, json={"lines": [{"product_id": 12, "quantity": 2}]})
    assert r.status_code == 201
    s = r.json()
    assert s["type"] == "simple" and s["client"] is None
    assert s["totals"] == {"gross_total": 7000, "insurer_share": 0, "patient_share": 7000}


def test_sale_updates_client_and_usual_cart(client, vendeur, admin):
    lawson = client_id(client, admin, "LAWSON")
    sale = client.post(f"{API}/sales", headers=vendeur, json={
        "client_id": lawson, "lines": [{"product_id": 8, "quantity": 3}, {"product_id": 9, "quantity": 1}]}).json()
    c = client.get(f"{API}/clients", headers=admin, params={"q": "LAWSON"}).json()[0]
    assert c["last_purchase"] is not None and c["usual_cart_count"] == 2
    cart = client.get(f"{API}/clients/{lawson}/usual-cart", headers=admin).json()
    assert {(l["product_id"], l["quantity"]) for l in cart["lines"]} == {(8, 3), (9, 1)}
    assert cart["totals"]["gross_total"] == 3 * 400 + 250
    assert sale["totals"]["gross_total"] == cart["totals"]["gross_total"]


def test_sale_line_is_frozen_after_price_change(client, vendeur, admin):
    sale = client.post(f"{API}/sales", headers=vendeur, json={"lines": [{"product_id": 8, "quantity": 1}]}).json()
    client.patch(f"{API}/products/8", headers=admin, json={"price": 999})
    slip = client.get(f"{API}/sales/{sale['reference']}/slip", headers=vendeur).json()
    assert slip["lines"][0]["price"] == 400
    client.patch(f"{API}/products/8", headers=admin, json={"price": 400})


def test_sale_invalid_inputs_never_500(client, vendeur):
    bad = [{"lines": []}, {"lines": [{"product_id": 1, "quantity": 0}]}, {"lines": [{"quantity": 1}]},
           {"lines": [{"product_id": 999999, "quantity": 1}]}, {"client_id": 999999, "lines": [{"product_id": 1, "quantity": 1}]},
           {"lines": [{"product_id": "abc", "quantity": 1}]}, {}]
    codes = [client.post(f"{API}/sales", headers=vendeur, json=b).status_code for b in bad]
    assert codes == [400, 400, 400, 400, 404, 400, 400]


def test_slip_content_and_history(client, vendeur):
    hist = client.get(f"{API}/sales", headers=vendeur, params={"type": "assuree", "page_size": 5}).json()
    assert hist["total"] >= 1 and all(s["type"] == "assuree" for s in hist["items"])
    slip = client.get(f"{API}/sales/{hist['items'][0]['reference']}/slip", headers=vendeur).json()
    assert slip["pharmacy"]["name"] == "Pharmacie ADJOLOLO" and "Winpharma" in slip["mention"]
    assert slip["client"]["policy_number"] and slip["lines"]
    assert client.get(f"{API}/sales/V0/slip", headers=vendeur).status_code == 404


def test_today_summary(client, vendeur):
    s = client.get(f"{API}/sales/summary/today", headers=vendeur).json()
    assert s["sales_count"] == s["assured_count"] + s["simple_count"]
    assert s["gross_total"] == s["assured_total"] + s["simple_total"]


def test_sale_models(client, vendeur, admin):
    kossi = client_id(client, admin, "AGBEKO")
    r = client.post(f"{API}/sales/models", headers=vendeur,
                    json={"name": "Ordonnance ALD", "client_id": kossi, "lines": [{"product_id": 1, "quantity": 2}]})
    assert r.status_code == 201
    mid = r.json()["id"]
    assert [m["name"] for m in client.get(f"{API}/sales/models", headers=vendeur).json()
            if m["id"] == mid] == []                               # sans client : uniquement les globaux
    assert any(m["id"] == mid for m in client.get(f"{API}/sales/models", headers=vendeur,
                                                  params={"client_id": kossi}).json())
    assert any(m["id"] == mid for m in client.get(f"{API}/sales/models", headers=vendeur,
                                                  params={"scope": "all"}).json())
    assert client.delete(f"{API}/sales/models/{mid}", headers=vendeur).status_code == 204
    assert client.delete(f"{API}/sales/models/{mid}", headers=vendeur).status_code == 404


# --- Catalogue (admin) et audit -----------------------------------------------------------------------------

def test_product_crud_stock_and_audit(client, admin):
    r = client.post(f"{API}/products", headers=admin, json={"name": "Paracétamol sirop", "category": "Antalgiques",
                                                            "price": 1100, "stock": 20})
    assert r.status_code == 201
    p = r.json()
    assert p["source"] == "manuel" and p["code"].startswith("MAN-")
    dup = client.post(f"{API}/products", headers=admin, json={"name": "Autre", "code": p["code"],
                                                              "category": "Antalgiques", "price": 1})
    assert dup.status_code == 409
    assert client.post(f"{API}/products", headers=admin, json={"name": "x", "category": "Inconnue", "price": 1}).status_code == 400

    r = client.patch(f"{API}/products/{p['id']}", headers=admin, json={"price": 1200})
    assert r.status_code == 200 and r.json()["price"] == 1200
    r = client.patch(f"{API}/products/{p['id']}/stock", headers=admin, json={"delta": -25})
    assert r.json()["stock"] == 0                                   # jamais négatif
    r = client.patch(f"{API}/products/{p['id']}/stock", headers=admin, json={"delta": 0})
    assert r.status_code == 400
    r = client.patch(f"{API}/products/{p['id']}/outofstock", headers=admin, json={"out_of_stock": False, "quantity": 7})
    assert r.json()["stock"] == 7
    r = client.patch(f"{API}/products/{p['id']}/outofstock", headers=admin, json={"out_of_stock": True})
    assert r.json()["stock"] == 0
    r = client.patch(f"{API}/products/{p['id']}/outofstock", headers=admin, json={"out_of_stock": False})
    assert r.json()["stock"] == 7                                   # stock d'avant la rupture
    assert client.delete(f"{API}/products/{p['id']}", headers=admin).status_code == 204
    assert client.delete(f"{API}/products/{p['id']}", headers=admin).status_code == 404
    actions = [a for a, _ in audit_actions(client, admin)]
    for expected in ("Produit créé", "Produit modifié", "Stock ajusté", "Produit marqué en rupture",
                     "Produit réactivé", "Produit supprimé"):
        assert expected in actions
    detail = next(d for a, d in audit_actions(client, admin) if a == "Produit modifié" and "Paracétamol sirop" in d)
    assert "prix : 1100 → 1200" in detail


def test_category_delete_refused_when_used(client, admin):
    r = client.delete(f"{API}/categories/Digestif", headers=admin)
    assert r.status_code == 409 and "utilisée" in r.json()["detail"]
    assert client.post(f"{API}/categories", headers=admin, json={"name": "Hygiène"}).status_code == 201
    assert client.post(f"{API}/categories", headers=admin, json={"name": "hygiene"}).status_code == 409
    assert client.delete(f"{API}/categories/Hygiène", headers=admin).status_code == 204
    assert client.delete(f"{API}/categories/Hygiène", headers=admin).status_code == 404


def test_clients_create_update_traced(client, vendeur, admin):
    r = client.post(f"{API}/clients", headers=vendeur, json={"first_name": "Yao", "last_name": "amegah",
                                                              "insurer": "AMU", "policy_number": "AMU-1"})
    assert r.status_code == 201 and r.json()["last_name"] == "AMEGAH" and r.json()["full_name"] == "AMEGAH Yao"
    cid = r.json()["id"]
    assert client.post(f"{API}/clients", headers=vendeur, json={"first_name": "Z", "last_name": "Z",
                                                                 "insurer": "AMU", "policy_number": "AMU-1"}).status_code == 409
    assert client.post(f"{API}/clients", headers=vendeur, json={"first_name": "Z", "last_name": "Z",
                                                                 "insurer": "CNSS"}).status_code == 400
    r = client.patch(f"{API}/clients/{cid}", headers=vendeur, json={"valid_until": "2027-05-01"})
    assert r.status_code == 200 and r.json()["valid_until"] == "2027-05-01"
    assert client.patch(f"{API}/clients/999999", headers=vendeur, json={"first_name": "A"}).status_code == 404
    actions = [a for a, _ in audit_actions(client, admin)]
    assert "Client créé" in actions and "Fiche client modifiée" in actions


def test_frequent_clients(client, vendeur):
    r = client.get(f"{API}/clients/frequent", headers=vendeur).json()
    assert len(r) >= 3 and r == sorted(r, key=lambda x: x["score"], reverse=True)


def test_rules_write_is_historised_and_unique(client, admin):
    r = client.patch(f"{API}/rules/5", headers=admin, json={"rate": 75})
    assert r.status_code == 200 and r.json()["rate"] == 75
    d = next(d for a, d in audit_actions(client, admin) if a == "Règle modifiée")
    assert "taux : 70 → 75" in d
    client.patch(f"{API}/rules/5", headers=admin, json={"rate": 70})
    assert client.post(f"{API}/rules", headers=admin, json={"insurer": "AMU", "scope": "Tous", "rate": 10}).status_code == 409
    assert client.post(f"{API}/rules", headers=admin, json={"insurer": "AMU", "scope": "Inconnue", "rate": 10}).status_code == 400
    assert client.post(f"{API}/rules", headers=admin, json={"insurer": "AMU", "scope": "Tous", "rate": 101}).status_code == 400
    assert client.patch(f"{API}/rules/9999", headers=admin, json={"rate": 1}).status_code == 404


def test_audit_is_read_only(client, admin):
    for method in ("post", "put", "patch", "delete"):
        r = getattr(client, method)(f"{API}/audit", headers=admin)
        assert r.status_code == 405
    r = client.get(f"{API}/audit", headers=admin, params={"user": "LACLE Erika", "days": 1}).json()
    assert r["items"] and all(e["user"] == "LACLE Erika" for e in r["items"])


# --- Comptes -------------------------------------------------------------------------------------------------

def test_user_management_and_pin_change(client, admin):
    r = client.post(f"{API}/users", headers=admin, json={"name": "ayeva kokou", "pin": "4321"})
    assert r.status_code == 201
    u = r.json()
    assert u["name"] == "AYEVA kokou" and u["login"] == "kokou" and u["role"] == "vendeur" and "pin" not in u
    assert client.post(f"{API}/users", headers=admin, json={"name": "Seul", "pin": "4321"}).status_code == 400
    assert client.post(f"{API}/users", headers=admin, json={"name": "AB Cd", "pin": "43"}).status_code == 400
    assert client.post(f"{API}/users", headers=admin, json={"name": "X Kokou", "pin": "1111"}).json()["login"] == "kokou2"

    tok = client.post(f"{API}/auth/login", json={"login": "kokou", "pin": "4321"}).json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    assert client.patch(f"{API}/users/me", headers=h, json={"pin": "5555"}).status_code == 400      # ancien PIN requis
    assert client.patch(f"{API}/users/me", headers=h, json={"pin": "5555", "old_pin": "0000"}).status_code == 403
    assert client.patch(f"{API}/users/me", headers=h, json={"pin": "5555", "old_pin": "4321"}).status_code == 200
    assert client.post(f"{API}/auth/login", json={"login": "kokou", "pin": "4321"}).status_code == 401
    assert client.post(f"{API}/auth/login", json={"login": "kokou", "pin": "5555"}).status_code == 200

    assert client.patch(f"{API}/users/{u['id']}/active", headers=admin, json={"active": False}).status_code == 200
    assert client.get(f"{API}/products", headers=h).status_code == 401          # jeton d'un compte désactivé
    assert client.post(f"{API}/auth/login", json={"login": "kokou", "pin": "5555"}).status_code == 403
    assert "kokou" not in [a["login"] for a in client.get(f"{API}/auth/accounts").json()]


def test_admin_cannot_lock_himself_out(client, admin):
    me = client.get(f"{API}/auth/me", headers=admin).json()
    assert client.patch(f"{API}/users/{me['id']}/active", headers=admin, json={"active": False}).status_code == 409


def test_pin_never_stored_in_clear(client):
    from sqlalchemy import select
    from db import SessionLocal
    from models import User
    with SessionLocal() as db:
        for u in db.scalars(select(User)):
            assert u.pin_hash.startswith("$2") and u.pin_hash not in ("2580", "1234")


# --- Import Winpharma ------------------------------------------------------------------------------------------------

CSV = ("Désignation;Code-barres;Qté stock;Prix public;Prix achat;Péremption\n"
       "Doliprane 500mg (boîte 16);DOL500;100;400;250;12/2028\n"          # existant (importé) : mis à jour
       "Vitamine C 500mg;VTC500;150;450;300;\n"                             # existant (saisi à la main)
       "Ibuprofène 400mg;IBU400;60;1 500 FCFA;900;03/2027\n"                # nouveau
       "Sans prix;SP1;5;;;\n").encode("cp1252")                              # ligne ignorée


def test_import_preview_writes_nothing_then_commit_applies(client, admin):
    before_fresh = client.get(f"{API}/stock/freshness", headers=admin).json()
    before_total = client.get(f"{API}/products", headers=admin).json()["total"]
    r = client.post(f"{API}/import/winpharma", headers=admin, files={"file": ("stock.csv", CSV, "text/csv")})
    assert r.status_code == 200, r.text
    prev = r.json()
    assert prev["mapping"]["name"] == "Désignation" and prev["mapping"]["code"] == "Code-barres"
    assert prev["mapping"]["stock"] == "Qté stock" and prev["mapping"]["price"] == "Prix public"   # pas « Prix achat »
    assert prev["mapping"]["expiry"] == "Péremption" and prev["missing_required"] == []
    assert (prev["detected_count"], prev["new_count"], prev["update_count"], prev["manual_count"],
            prev["skipped_count"]) == (3, 1, 2, 1, 1)
    # aperçu : rien n'est écrit
    assert client.get(f"{API}/products", headers=admin).json()["total"] == before_total
    assert client.get(f"{API}/stock/freshness", headers=admin).json() == before_fresh

    r = client.post(f"{API}/import/winpharma/commit", headers=admin,
                    json={"import_id": prev["import_id"], "mapping": prev["mapping"]})
    assert r.status_code == 200, r.text
    res = r.json()
    assert (res["created"], res["updated"], res["skipped"]) == (1, 2, 1) and res["manual_updated"] == ["Vitamine C 500mg"]
    assert client.get(f"{API}/products", headers=admin).json()["total"] == before_total + 1

    ibu = product_by_code(client, admin, "IBU400")
    assert ibu["price"] == 1500 and ibu["category"] == "Non classé" and ibu["expiry"] == "2027-03-31"
    assert product_by_code(client, admin, "DOL500")["price"] == 400
    fresh = client.get(f"{API}/stock/freshness", headers=admin).json()
    assert fresh["stale"] is False and fresh["last_import"] != before_fresh["last_import"]
    detail = next(d for a, d in audit_actions(client, admin) if a == "Import Winpharma")
    assert "stock.csv" in detail and "Vitamine C" in detail            # écrasement d'un produit manuel journalisé
    # le même aperçu ne peut pas être appliqué deux fois
    assert client.post(f"{API}/import/winpharma/commit", headers=admin,
                       json={"import_id": prev["import_id"], "mapping": prev["mapping"]}).status_code == 404


def test_import_rejects_bad_files(client, admin):
    def up(name, data):
        return client.post(f"{API}/import/winpharma", headers=admin, files={"file": (name, data, "application/octet-stream")})
    assert up("notes.pdf", b"%PDF").status_code == 400
    assert "Winpharma" in up("notes.pdf", b"%PDF").json()["detail"]
    assert up("old.xls", b"\xd0\xcf").status_code == 400
    assert up("vide.csv", b"").status_code == 400
    assert up("faux.xlsx", b"pas un excel").status_code == 400
    r = up("incomplet.csv", "Nom;Prix\nA;10\n".encode())
    assert r.status_code == 200 and "Code" in r.json()["missing_required"] and "Qté" in r.json()["missing_required"]


def test_import_excel_file(client, admin):
    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active
    ws.append(["Désignation", "Code", "Qté", "Prix", "DCI", "Famille"])
    ws.append(["Aspirine 500mg", 3400930001234, 40, 700, "Acide acétylsalicylique", "Antalgiques"])
    buf = io.BytesIO()
    wb.save(buf)
    prev = client.post(f"{API}/import/winpharma", headers=admin,
                       files={"file": ("stock.xlsx", buf.getvalue(), "application/vnd.ms-excel")}).json()
    assert prev["detected_count"] == 1 and prev["mapping"]["category"] == "Famille"
    # mapping modifié par l'utilisatrice : on ignore la DCI
    mapping = {**prev["mapping"], "dci": None}
    assert client.post(f"{API}/import/winpharma/commit", headers=admin,
                       json={"import_id": prev["import_id"], "mapping": mapping}).status_code == 200
    p = product_by_code(client, admin, "3400930001234")
    assert p["category"] == "Antalgiques" and p["dci"] == "" and p["source"] == "import"


def test_commit_validates_mapping(client, admin):
    prev = client.post(f"{API}/import/winpharma", headers=admin,
                       files={"file": ("s.csv", b"A;B;C;D\nx;y;1;2\n", "text/csv")}).json()
    r = client.post(f"{API}/import/winpharma/commit", headers=admin, json={"import_id": prev["import_id"], "mapping": {"name": "Z"}})
    assert r.status_code == 400
    r = client.post(f"{API}/import/winpharma/commit", headers=admin, json={"import_id": "../../etc", "mapping": {}})
    assert r.status_code == 404


# --- Tableau de bord ------------------------------------------------------------------------------------------------------

def test_dashboard_and_csv_export(client, admin, vendeur):
    sarah = client_id(client, admin, "MENSAH")     # ASCOMA : la parapharmacie n'est pas couverte
    client.post(f"{API}/sales", headers=vendeur, json={"client_id": sarah, "lines": [{"product_id": 12, "quantity": 1}]})
    d = client.get(f"{API}/dashboard", headers=admin).json()
    assert len(d["daily"]) == 7 and d["sales_count"] == d["assured_count"] + d["simple_count"]
    assert any(r["name"].startswith("Crème") and r["insurer"] == "Privée (ASCOMA)" for r in d["out_of_coverage"])
    assert d["stock_out_count"] >= 2 and d["expiring_count"] >= 4
    csv_resp = client.get(f"{API}/dashboard/out-of-coverage.csv", headers=admin)
    assert csv_resp.status_code == 200 and csv_resp.text.startswith("\ufeff") and "Crème" in csv_resp.text
    assert client.get(f"{API}/dashboard", headers=admin, params={"days": 0}).status_code == 400


def test_malformed_requests_never_500(client, admin):
    for path, method, kw in [("/products?limit=abc", "get", {}), ("/products/abc/stock", "patch", {"json": {"delta": 1}}),
                              ("/sales?from=hier", "get", {}), ("/audit?days=-3", "get", {}),
                              ("/products", "post", {"content": b"{pas du json", "headers": {"Content-Type": "application/json"}})]:
        headers = {**admin, **kw.pop("headers", {})}
        r = getattr(client, method)(f"{API}{path}", headers=headers, **kw)
        assert r.status_code == 400, (path, r.status_code, r.text)


# --- Ajouts pour l'interface : simulation, fiche client, inscription, date, recount, service du frontend ---------------

def test_quote_matches_sale_and_writes_nothing(client, vendeur, admin):
    kossi = client_id(client, admin, "AGBEKO")
    body = {"client_id": kossi, "lines": [{"product_id": 1, "quantity": 2}, {"product_id": 4, "quantity": 1},
                                           {"name": "Gel", "price": 1000, "quantity": 1}]}
    before = client.get(f"{API}/sales", headers=vendeur).json()["total"]
    q = client.post(f"{API}/sales/quote", headers=vendeur, json=body).json()
    assert client.get(f"{API}/sales", headers=vendeur).json()["total"] == before        # rien d'écrit
    assert q["type"] == "assuree" and q["lines"][0]["coverage"]["status"] == "partial"
    assert q["lines"][2]["coverage"] is None
    sale = client.post(f"{API}/sales", headers=vendeur, json=body).json()
    assert q["totals"] == sale["totals"]                                                  # même calcul


def test_get_client_and_usual_products(client, vendeur, admin):
    cid = client_id(client, admin, "AGBEKO")
    c = client.get(f"{API}/clients/{cid}", headers=vendeur).json()
    assert c["full_name"] == "AGBEKO Kossi" and c["usual_products"]
    assert client.get(f"{API}/clients/999999", headers=vendeur).status_code == 404


def test_manual_sale_date(client, vendeur):
    import datetime as dt
    line = [{"name": "Gel", "price": 500, "quantity": 1}]
    past = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=3)).date().isoformat()
    r = client.post(f"{API}/sales", headers=vendeur, json={"lines": line, "date": past})
    assert r.status_code == 201 and r.json()["date"].startswith(past)
    future = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=2)).date().isoformat()
    assert client.post(f"{API}/sales", headers=vendeur, json={"lines": line, "date": future}).status_code == 400
    assert client.post(f"{API}/sales", headers=vendeur, json={"lines": line, "date": "2020-01-01"}).status_code == 400


def test_register_needs_admin_pin(client, admin):
    body = {"name": "koffi ama", "pin": "3210", "admin_pin": "9999"}
    assert client.post(f"{API}/auth/register", json=body).status_code == 403
    r = client.post(f"{API}/auth/register", json={**body, "admin_pin": "2580"})
    assert r.status_code == 201 and r.json()["name"] == "KOFFI ama" and r.json()["role"] == "vendeur"
    d = next(d for a, d in audit_actions(client, admin) if a == "Compte créé" and "KOFFI" in d)
    assert "écran de connexion" in d
    assert any(a == "Échec de création de compte" for a, _ in audit_actions(client, admin))


def test_register_is_rate_limited(client):
    for _ in range(5):
        assert client.post(f"{API}/auth/register", json={"name": "A B", "pin": "1234", "admin_pin": "0001"}).status_code == 403
    assert client.post(f"{API}/auth/register", json={"name": "A B", "pin": "1234", "admin_pin": "2580"}).status_code == 429


def test_import_recount_after_mapping_change(client, admin):
    csv = "Nom;Réf;Stock;Tarif\nAlpha;A1;3;100\nBeta;B1;4;200\n".encode()
    prev = client.post(f"{API}/import/winpharma", headers=admin, files={"file": ("x.csv", csv, "text/csv")}).json()
    assert prev["detected_count"] == 0 and set(prev["missing_required"]) >= {"Code", "Prix"}   # colonnes non reconnues
    mapping = {"name": "Nom", "code": "Réf", "stock": "Stock", "price": "Tarif"}
    r = client.post(f"{API}/import/winpharma/recount", headers=admin, json={"import_id": prev["import_id"], "mapping": mapping})
    assert r.status_code == 200 and r.json()["detected_count"] == 2 and r.json()["new_count"] == 2
    assert client.post(f"{API}/import/winpharma/recount", headers=admin,
                       json={"import_id": "0" * 32, "mapping": mapping}).status_code == 404


def test_frontend_is_served_by_the_api(client):
    r = client.get("/")
    assert r.status_code == 200 and "OptiDesk" in r.text
    assert client.get("/app1.js").status_code == 200 and client.get("/style.css").status_code == 200
    assert client.get("/fonts.css").status_code == 200 and client.get("/fonts/outfit-latin-500-normal.woff2").status_code == 200   # police locale
    assert client.get("/docs").status_code == 200 and client.get("/api/v1/health").json()["status"] == "ok"


def test_cors_allows_local_dev_servers(client):
    """Live Server (VS Code) sert l'interface sur :5500 et appelle l'API sur :8765."""
    for origin in ("http://127.0.0.1:5500", "http://localhost:5500", "null"):
        r = client.options(f"{API}/auth/accounts", headers={
            "Origin": origin, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization"})
        assert r.status_code == 200 and r.headers["access-control-allow-origin"] == origin, origin
        g = client.get(f"{API}/auth/accounts", headers={"Origin": origin})
        assert g.headers["access-control-allow-origin"] == origin
    r = client.options(f"{API}/auth/accounts", headers={"Origin": "https://site-quelconque.example",
                                                         "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in r.headers          # un site distant n'a pas accès
