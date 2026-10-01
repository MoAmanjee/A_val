from __future__ import annotations

import logging

from .config import Config
from .content import generate_content
from .fulfillment import Supplier
from .http import ApiError, Client
from .meta_ads import MetaAds
from .models import Product
from .optimizer import decide
from .shopify import Shopify
from .sourcing import rank_products
from .state import State

log = logging.getLogger("dropship")


class Pipeline:
    def __init__(
        self,
        cfg: Config,
        client: Client,
        state: State,
        shop: Shopify,
        ads: MetaAds,
        supplier: Supplier,
    ):
        self.cfg, self.client, self.state = cfg, client, state
        self.shop, self.ads, self.supplier = shop, ads, supplier

    def _persist(self) -> None:
        if not self.client.dry_run:
            self.state.save()

    def launch(self, catalog: list[Product], limit: int) -> list[str]:
        """List the best not-yet-launched products on the store and start test ads."""
        launched: list[str] = []
        ranked = [t for t in rank_products(catalog, self.cfg) if t[0].sku not in self.state.products]
        for p, econ, sc in ranked:
            if len(launched) >= limit:
                break
            if len(self.state.live_products()) >= self.cfg.max_active_products:
                log.info("max_active_products reached; not launching more")
                break
            budget = self.cfg.test_daily_budget
            if self.state.live_budget() + budget > self.cfg.max_total_daily_budget:
                log.info("max_total_daily_budget would be exceeded; not launching more")
                break

            listing, copies = generate_content(p, econ.price, self.cfg)
            try:
                store = self.shop.create_product(p, listing, econ.price)
                ads = self.ads.launch_product_campaign(p, store["url"], p.image_url, copies, budget)
            except ApiError as exc:
                log.error("launch failed for %s: %s", p.sku, exc)
                continue

            self.state.products[p.sku] = {
                "title": p.title,
                "price": econ.price,
                "contribution": econ.contribution,
                "break_even_roas": econ.break_even_roas,
                "score": sc,
                "store": store,
                "ads": ads,
            }
            self._persist()
            launched.append(p.sku)
            log.info(
                "launched %s at $%.2f (contribution $%.2f, break-even ROAS %.2f, budget $%.2f/day, ads %s)",
                p.sku, econ.price, econ.contribution, econ.break_even_roas, budget, ads["status"],
            )
        return launched

    def optimize(self) -> list[tuple[str, str, str]]:
        """Pause losers and scale winners. Returns (sku, action, reason)."""
        results = []
        for sku, rec in self.state.live_products().items():
            ads = rec["ads"]
            try:
                metrics = self.ads.insights(ads["campaign_id"])
            except ApiError as exc:
                log.error("insights failed for %s: %s", sku, exc)
                continue
            d = decide(
                metrics,
                contribution=rec["contribution"],
                break_even_roas=rec["break_even_roas"],
                current_budget=ads["daily_budget"],
                other_active_budget=self.state.live_budget(exclude=sku),
                cfg=self.cfg,
            )
            log.info("%s: %s - %s (spend %.2f, sales %d, roas %.2f)", sku, d.action, d.reason, metrics.spend, metrics.purchases, metrics.roas)
            try:
                if d.action == "PAUSE":
                    self.ads.set_status(ads["campaign_id"], "PAUSED")
                    ads["status"], ads["killed"] = "PAUSED", True
                elif d.action == "SCALE" and d.new_budget:
                    self.ads.set_daily_budget(ads["adset_id"], d.new_budget)
                    ads["daily_budget"] = d.new_budget
            except ApiError as exc:
                log.error("applying %s to %s failed: %s", d.action, sku, exc)
                continue
            results.append((sku, d.action, d.reason))
        self._persist()
        return results

    def process_orders(self) -> list[str]:
        """Forward new paid orders to the supplier exactly once."""
        forwarded = []
        for order in self.shop.paid_unfulfilled_orders():
            if order.id in self.state.orders:
                continue
            try:
                ref = self.supplier.place_order(order)
            except ApiError as exc:
                log.error("supplier rejected order %s: %s", order.name, exc)
                continue
            self.state.orders[order.id] = {"name": order.name, "supplier_ref": ref}
            self._persist()
            forwarded.append(order.name)
            log.info("forwarded order %s -> %s", order.name, ref)
        return forwarded
