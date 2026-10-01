from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .config import Config
from .content import AdCopy
from .http import Client
from .models import Product


@dataclass
class Metrics:
    spend: float = 0.0
    impressions: int = 0
    clicks: int = 0
    purchases: int = 0
    revenue: float = 0.0

    @property
    def roas(self) -> float:
        return self.revenue / self.spend if self.spend else 0.0


PURCHASE_ACTIONS = {"purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"}


def parse_insights(resp: dict[str, Any]) -> Metrics:
    rows = resp.get("data") or []
    if not rows:
        return Metrics()
    row = rows[0]

    def total(key: str) -> float:
        vals = {a["action_type"]: float(a["value"]) for a in row.get(key, [])}
        for t in ("omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"):
            if t in vals:
                return vals[t]
        return 0.0

    return Metrics(
        spend=float(row.get("spend", 0)),
        impressions=int(row.get("impressions", 0)),
        clicks=int(row.get("clicks", 0)),
        purchases=int(total("actions")),
        revenue=total("action_values"),
    )


class MetaAds:
    def __init__(self, cfg: Config, client: Client):
        self.cfg = cfg
        self.client = client
        self.base = f"https://graph.facebook.com/{cfg.meta_api_version}"
        self.account = f"act_{cfg.meta_ad_account_id}"

    def _req(self, method: str, path: str, **kw: Any) -> dict[str, Any]:
        params = dict(kw.pop("params", None) or {})
        params["access_token"] = self.cfg.meta_token
        return self.client.request(method, f"{self.base}/{path}", params=params, **kw)

    def _status(self) -> str:
        return "ACTIVE" if self.cfg.ads_start_active else "PAUSED"

    def launch_product_campaign(
        self, p: Product, url: str, image_url: str, copies: list[AdCopy], daily_budget: float
    ) -> dict[str, Any]:
        status = self._status()
        campaign = self._req(
            "POST",
            f"{self.account}/campaigns",
            body={
                "name": f"[auto] {p.sku} - {p.title}"[:200],
                "objective": "OUTCOME_SALES",
                "status": status,
                "special_ad_categories": [],
                "buying_type": "AUCTION",
            },
        )
        adset = self._req(
            "POST",
            f"{self.account}/adsets",
            body={
                "name": f"[auto] {p.sku} broad",
                "campaign_id": campaign["id"],
                "daily_budget": int(round(daily_budget * 100)),
                "billing_event": "IMPRESSIONS",
                "optimization_goal": "OFFSITE_CONVERSIONS",
                "bid_strategy": "LOWEST_COST_WITHOUT_CAP",
                "promoted_object": {"pixel_id": self.cfg.meta_pixel_id, "custom_event_type": "PURCHASE"},
                "targeting": {
                    "geo_locations": {"countries": self.cfg.target_countries},
                    "age_min": self.cfg.age_min,
                    "age_max": self.cfg.age_max,
                    "targeting_automation": {"advantage_audience": 1},
                },
                "status": status,
            },
        )
        ad_ids = []
        for i, c in enumerate(copies, start=1):
            creative = self._req(
                "POST",
                f"{self.account}/adcreatives",
                body={
                    "name": f"[auto] {p.sku} creative {i}",
                    "object_story_spec": {
                        "page_id": self.cfg.meta_page_id,
                        "link_data": {
                            "link": url,
                            "picture": image_url,
                            "message": c.primary_text,
                            "name": c.headline,
                            "description": c.description,
                            "call_to_action": {"type": "SHOP_NOW", "value": {"link": url}},
                        },
                    },
                },
            )
            ad = self._req(
                "POST",
                f"{self.account}/ads",
                body={
                    "name": f"[auto] {p.sku} ad {i}",
                    "adset_id": adset["id"],
                    "creative": {"creative_id": creative["id"]},
                    "status": status,
                },
            )
            ad_ids.append(ad["id"])
        return {
            "campaign_id": campaign["id"],
            "adset_id": adset["id"],
            "ad_ids": ad_ids,
            "daily_budget": daily_budget,
            "status": status,
        }

    def insights(self, campaign_id: str) -> Metrics:
        resp = self._req(
            "GET",
            f"{campaign_id}/insights",
            params={"fields": "spend,impressions,clicks,actions,action_values", "date_preset": self.cfg.insights_window},
        )
        return parse_insights(resp)

    def set_status(self, object_id: str, status: str) -> None:
        self._req("POST", object_id, body={"status": status})

    def set_daily_budget(self, adset_id: str, daily_budget: float) -> None:
        self._req("POST", adset_id, body={"daily_budget": int(round(daily_budget * 100))})
