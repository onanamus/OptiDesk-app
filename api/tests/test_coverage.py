"""Le moteur de couverture, isolé de la base : les quatre cas + validité dépassée."""
from datetime import date

from models import Category, Client, CoverageRule, Product
from routers.coverage import couverture, split_amount

TODAY = date(2026, 9, 19)


def rule(i, scope, rate, exclusion=None):
    return CoverageRule(id=i, insurer="X", scope=scope, rate=rate, exclusion=exclusion)


def prod(cat):
    return Product(name="p", code="c", price=1000, category=Category(name=cat))


def cli(valid=date(2027, 1, 1)):
    return Client(first_name="A", last_name="B", insurer="X", valid_until=valid)


INAM_LIKE = [rule(1, "Antipaludiques", 100), rule(2, "Tous médicaments", 80), rule(3, "Matériel", 50)]
PRIVEE_LIKE = [rule(4, "Tous", 70, exclusion="Parapharmacie")]


def test_full():
    c = couverture(cli(), prod("Antipaludiques"), INAM_LIKE, TODAY)
    assert (c.status, c.rate, c.alert) == ("full", 100, None)


def test_partial_specific_rule_beats_fallback():
    assert couverture(cli(), prod("Matériel"), INAM_LIKE, TODAY).rate == 50


def test_partial_fallback_tous():
    c = couverture(cli(), prod("Antalgiques"), INAM_LIKE, TODAY)
    assert (c.status, c.rate) == ("partial", 80)


def test_none_when_no_rule():
    assert couverture(cli(), prod("Antalgiques"), [], TODAY).status == "none"


def test_none_by_category_exclusion():
    c = couverture(cli(), prod("Parapharmacie"), PRIVEE_LIKE, TODAY)
    assert (c.status, c.rate) == ("none", 0)
    assert couverture(cli(), prod("Antalgiques"), PRIVEE_LIKE, TODAY).rate == 70


def test_expired_validity_raises_alert_but_keeps_rate():
    c = couverture(cli(valid=date(2026, 1, 31)), prod("Antalgiques"), INAM_LIKE, TODAY)
    assert c.alert == "a_verifier" and c.rate == 80


def test_accents_and_case_are_ignored():
    assert couverture(cli(), prod("antipaludiques"), INAM_LIKE, TODAY).status == "full"


def test_split_amount_rounds_to_franc():
    assert split_amount(350, 2, 80) == (560, 140)
    assert split_amount(333, 1, 70) == (233, 100)      # 233,1 -> 233
    assert split_amount(500, 1, None) == (0, 500)      # hors catalogue : prix plein
