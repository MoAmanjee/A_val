import csv

from dropship.config import Config
from dropship.fulfillment import ManualSupplier
from dropship.http import Client
from dropship.meta_ads import Metrics, MetaAds, parse_insights
from dropship.models import Order, Product
from dropship.optimizer import decide
from dropship.pipeline import Pipeline
from dropship.shopify import Shopify
from dropship.sourcing import compute_economics, load_products, rank_products
from dropship.state import State


def cfg(**kw):
    base = dict(shopify_domain="s.myshopify.com", shopify_token="t", meta_token="m", meta_ad_account_id="123",
                meta_page_id="p", meta_pixel_id="px")
    base.update(kw)
    return Config(**base)


def product(**kw):
    base = dict(sku="A", title="Thing", description="d", category="c", cost=5.0, shipping=2.0,
                image_url="http://i/x.jpg", supplier_rating=4.8, supplier_orders=1000)
    base.update(kw)
    return Product(**base)


class FakeClient(Client):
    """Records requests; answers writes with sequential ids and reads from `reads`."""

    def __init__(self, reads=None):
        super().__init__(dry_run=False)
        self.calls = []
        self.reads = reads or {}
        self.n = 0

    def request(self, method, url, *, headers=None, params=None, body=None):
        self.calls.append((method, url, params, body))
        self.n += 1
        for key, val in self.reads.items():
            if key in url:
                return val
        if "products.json" in url:
            return {"product": {"id": 99, "handle": "thing"}}
        return {"id": str(self.n)}


def test_economics_hits_target_profit_and_charm_price():
    e = compute_economics(product(), cfg())
    assert str(e.price).endswith(".99")
    assert e.contribution >= 12.0
    assert e.fees == round(e.price * 0.029 + 0.30, 2)
    assert abs(e.break_even_roas - e.price / e.contribution) < 0.01


def test_rank_filters_low_quality_and_low_margin(tmp_path):
    p = tmp_path / "c.csv"
    with open(p, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["sku", "title", "description", "category", "cost", "shipping", "image_url", "supplier_rating", "supplier_orders", "supplier_url"])
        w.writerow(["good", "G", "", "", 5, 2, "http://i", 4.8, 5000, ""])
        w.writerow(["badrating", "B", "", "", 5, 2, "http://i", 3.9, 5000, ""])
        w.writerow(["fewsales", "F", "", "", 5, 2, "http://i", 4.8, 10, ""])
        w.writerow(["cheap", "C", "", "", 0.4, 0.8, "http://i", 4.8, 5000, ""])
    ranked = rank_products(load_products(p), cfg())
    assert [r[0].sku for r in ranked] == ["good"]


def decide_with(m, **kw):
    args = dict(contribution=10.0, break_even_roas=2.0, current_budget=10.0, other_active_budget=0.0, cfg=cfg())
    args.update(kw)
    return decide(m, **args)


def test_optimizer_waits_then_kills_with_no_sales():
    assert decide_with(Metrics(spend=5)).action == "WAIT"
    assert decide_with(Metrics(spend=20)).action == "PAUSE"


def test_optimizer_pauses_unprofitable():
    assert decide_with(Metrics(spend=30, purchases=2, revenue=40)).action == "PAUSE"


def test_optimizer_scales_winner_within_caps():
    d = decide_with(Metrics(spend=50, purchases=5, revenue=200))
    assert d.action == "SCALE" and d.new_budget == 12.0
    d = decide_with(Metrics(spend=50, purchases=5, revenue=200), current_budget=48.0)
    assert d.new_budget == 50.0
    d = decide_with(Metrics(spend=50, purchases=5, revenue=200), current_budget=40.0, other_active_budget=60.0)
    assert d.action == "KEEP"


def test_parse_insights():
    resp = {"data": [{"spend": "12.5", "impressions": "1000", "clicks": "40",
                      "actions": [{"action_type": "link_click", "value": "40"}, {"action_type": "purchase", "value": "2"}],
                      "action_values": [{"action_type": "purchase", "value": "48.0"}]}]}
    m = parse_insights(resp)
    assert (m.spend, m.purchases, m.revenue) == (12.5, 2, 48.0)
    assert parse_insights({"data": []}).spend == 0


def test_dry_run_client_never_sends_writes():
    c = Client(dry_run=True)
    assert c.request("POST", "http://invalid.invalid/x", body={"a": 1})["dry_run"] is True


def make_pipeline(tmp_path, client, **cfg_kw):
    c = cfg(state_file=str(tmp_path / "state.json"), orders_outbox=str(tmp_path / "out.csv"), **cfg_kw)
    state = State(c.state_file)
    return Pipeline(c, client, state, Shopify(c, client), MetaAds(c, client), ManualSupplier(c.orders_outbox)), c


def test_launch_creates_store_listing_and_paused_ads_and_persists(tmp_path):
    client = FakeClient()
    pipe, c = make_pipeline(tmp_path, client)
    assert pipe.launch([product()], limit=1) == ["A"]
    urls = [u for _, u, _, _ in client.calls]
    assert any("products.json" in u for u in urls)
    assert any(u.endswith("act_123/campaigns") for u in urls)
    statuses = {b["status"] for _, u, _, b in client.calls if b and "status" in b and "graph" in u}
    assert statuses == {"PAUSED"}
    assert State(c.state_file).products["A"]["store"]["url"] == "https://s.myshopify.com/products/thing"
    assert pipe.launch([product()], limit=1) == []  # already launched


def test_launch_respects_total_budget_cap(tmp_path):
    client = FakeClient()
    pipe, _ = make_pipeline(tmp_path, client, max_total_daily_budget=15.0, test_daily_budget=10.0)
    launched = pipe.launch([product(sku="A"), product(sku="B", title="Other")], limit=5)
    assert launched == ["A"]


def test_optimize_pauses_loser_and_marks_killed(tmp_path):
    insights = {"insights": {"data": [{"spend": "40", "impressions": "9000", "clicks": "100"}]}}
    client = FakeClient(reads=insights)
    pipe, _ = make_pipeline(tmp_path, client)
    pipe.launch([product()], limit=1)
    results = pipe.optimize()
    assert results[0][1] == "PAUSE"
    assert pipe.state.products["A"]["ads"]["killed"] is True
    assert pipe.state.live_budget() == 0


def test_orders_forwarded_once(tmp_path):
    orders = {"orders.json": {"orders": [{"id": 7, "name": "#1001", "email": "a@b.c",
                                          "shipping_address": {"name": "N", "address1": "1 St", "country_code": "US"},
                                          "line_items": [{"sku": "A", "quantity": 2}]}]}}
    client = FakeClient(reads=orders)
    pipe, c = make_pipeline(tmp_path, client)
    assert pipe.process_orders() == ["#1001"]
    assert pipe.process_orders() == []
    rows = list(csv.DictReader(open(c.orders_outbox)))
    assert len(rows) == 1 and rows[0]["sku"] == "A" and rows[0]["quantity"] == "2"
