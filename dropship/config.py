from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def load_dotenv(path: str | Path = ".env") -> None:
    p = Path(path)
    if not p.exists():
        return
    for line in p.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


def _f(name: str, default: float) -> float:
    return float(os.environ.get(name, default))


def _i(name: str, default: int) -> int:
    return int(os.environ.get(name, default))


@dataclass
class Config:
    # Store
    shopify_domain: str = ""
    shopify_token: str = ""
    shopify_api_version: str = "2024-10"
    store_currency: str = "USD"

    # Meta (Facebook / Instagram) ads
    meta_token: str = ""
    meta_ad_account_id: str = ""  # digits only, without "act_"
    meta_page_id: str = ""
    meta_pixel_id: str = ""
    meta_api_version: str = "v21.0"
    target_countries: list[str] = field(default_factory=lambda: ["US"])
    age_min: int = 21
    age_max: int = 55

    # Supplier
    supplier_mode: str = "manual"  # manual | http
    supplier_order_url: str = ""
    supplier_api_key: str = ""

    # Optional LLM for copywriting
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"

    # Pricing / product selection
    target_profit_per_order: float = 12.0
    payment_fee_pct: float = 0.029
    payment_fee_fixed: float = 0.30
    min_price: float = 19.0
    max_price: float = 79.0
    min_supplier_rating: float = 4.5
    min_supplier_orders: int = 500
    min_contribution: float = 10.0  # profit per order before ad spend

    # Ad safety limits (all amounts in store currency)
    test_daily_budget: float = 10.0
    max_daily_budget_per_product: float = 50.0
    max_total_daily_budget: float = 100.0
    max_active_products: int = 5
    ads_start_active: bool = False

    # Optimizer
    kill_spend_multiple: float = 2.0  # pause at 0 sales once spend >= N x contribution
    scale_roas_multiple: float = 1.5  # scale when ROAS >= N x break-even ROAS
    scale_min_purchases: int = 3
    scale_step: float = 1.2
    insights_window: str = "last_7d"

    state_file: str = "state.json"
    orders_outbox: str = "orders_to_place.csv"

    @classmethod
    def from_env(cls) -> "Config":
        e = os.environ.get
        return cls(
            shopify_domain=e("SHOPIFY_DOMAIN", ""),
            shopify_token=e("SHOPIFY_ACCESS_TOKEN", ""),
            shopify_api_version=e("SHOPIFY_API_VERSION", "2024-10"),
            store_currency=e("STORE_CURRENCY", "USD"),
            meta_token=e("META_ACCESS_TOKEN", ""),
            meta_ad_account_id=e("META_AD_ACCOUNT_ID", "").removeprefix("act_"),
            meta_page_id=e("META_PAGE_ID", ""),
            meta_pixel_id=e("META_PIXEL_ID", ""),
            meta_api_version=e("META_API_VERSION", "v21.0"),
            target_countries=[c.strip() for c in e("TARGET_COUNTRIES", "US").split(",") if c.strip()],
            age_min=_i("TARGET_AGE_MIN", 21),
            age_max=_i("TARGET_AGE_MAX", 55),
            supplier_mode=e("SUPPLIER_MODE", "manual"),
            supplier_order_url=e("SUPPLIER_ORDER_URL", ""),
            supplier_api_key=e("SUPPLIER_API_KEY", ""),
            openai_api_key=e("OPENAI_API_KEY", ""),
            openai_model=e("OPENAI_MODEL", "gpt-4o-mini"),
            target_profit_per_order=_f("TARGET_PROFIT_PER_ORDER", 12.0),
            min_price=_f("MIN_PRICE", 19.0),
            max_price=_f("MAX_PRICE", 79.0),
            min_supplier_rating=_f("MIN_SUPPLIER_RATING", 4.5),
            min_supplier_orders=_i("MIN_SUPPLIER_ORDERS", 500),
            min_contribution=_f("MIN_CONTRIBUTION", 10.0),
            test_daily_budget=_f("TEST_DAILY_BUDGET", 10.0),
            max_daily_budget_per_product=_f("MAX_DAILY_BUDGET_PER_PRODUCT", 50.0),
            max_total_daily_budget=_f("MAX_TOTAL_DAILY_BUDGET", 100.0),
            max_active_products=_i("MAX_ACTIVE_PRODUCTS", 5),
            ads_start_active=e("ADS_START_ACTIVE", "false").lower() == "true",
            kill_spend_multiple=_f("KILL_SPEND_MULTIPLE", 2.0),
            scale_roas_multiple=_f("SCALE_ROAS_MULTIPLE", 1.5),
            scale_min_purchases=_i("SCALE_MIN_PURCHASES", 3),
            scale_step=_f("SCALE_STEP", 1.2),
            insights_window=e("INSIGHTS_WINDOW", "last_7d"),
            state_file=e("STATE_FILE", "state.json"),
            orders_outbox=e("ORDERS_OUTBOX", "orders_to_place.csv"),
        )

    def missing_for_live(self) -> list[str]:
        required = {
            "SHOPIFY_DOMAIN": self.shopify_domain,
            "SHOPIFY_ACCESS_TOKEN": self.shopify_token,
            "META_ACCESS_TOKEN": self.meta_token,
            "META_AD_ACCOUNT_ID": self.meta_ad_account_id,
            "META_PAGE_ID": self.meta_page_id,
            "META_PIXEL_ID": self.meta_pixel_id,
        }
        if self.supplier_mode == "http":
            required["SUPPLIER_ORDER_URL"] = self.supplier_order_url
        return [k for k, v in required.items() if not v]
