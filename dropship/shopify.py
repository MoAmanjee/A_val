from __future__ import annotations

from typing import Any

from .config import Config
from .content import Listing, slugify
from .http import Client
from .models import Order, Product


class Shopify:
    def __init__(self, cfg: Config, client: Client):
        self.cfg = cfg
        self.client = client
        self.base = f"https://{cfg.shopify_domain}/admin/api/{cfg.shopify_api_version}"
        self.headers = {"X-Shopify-Access-Token": cfg.shopify_token}

    def _req(self, method: str, path: str, **kw: Any) -> dict[str, Any]:
        return self.client.request(method, f"{self.base}{path}", headers=self.headers, **kw)

    def create_product(self, p: Product, listing: Listing, price: float) -> dict[str, str]:
        payload = {
            "product": {
                "title": listing.title,
                "body_html": listing.body_html,
                "product_type": p.category,
                "status": "active",
                "variants": [
                    {
                        "sku": p.sku,
                        "price": f"{price:.2f}",
                        "requires_shipping": True,
                        "inventory_management": None,
                    }
                ],
                "images": [{"src": p.image_url}] if p.image_url else [],
            }
        }
        resp = self._req("POST", "/products.json", body=payload)
        product = resp.get("product") or {}
        product_id = str(product.get("id", resp.get("id", "")))
        handle = product.get("handle") or slugify(listing.title)
        return {
            "shopify_product_id": product_id,
            "url": f"https://{self.cfg.shopify_domain}/products/{handle}",
        }

    def paid_unfulfilled_orders(self) -> list[Order]:
        resp = self._req(
            "GET",
            "/orders.json",
            params={"status": "open", "financial_status": "paid", "fulfillment_status": "unfulfilled", "limit": 50},
        )
        orders = []
        for o in resp.get("orders", []):
            orders.append(
                Order(
                    id=str(o["id"]),
                    name=o.get("name", ""),
                    email=o.get("email") or "",
                    shipping_address=o.get("shipping_address") or {},
                    items=[
                        {"sku": li.get("sku") or "", "quantity": li.get("quantity", 1)}
                        for li in o.get("line_items", [])
                    ],
                )
            )
        return orders

    def mark_fulfilled(self, order_id: str, tracking_number: str, carrier: str) -> dict[str, Any]:
        fo = self._req("GET", f"/orders/{order_id}/fulfillment_orders.json")
        ids = [{"fulfillment_order_id": f["id"]} for f in fo.get("fulfillment_orders", []) if f.get("status") == "open"]
        payload = {
            "fulfillment": {
                "line_items_by_fulfillment_order": ids,
                "tracking_info": {"number": tracking_number, "company": carrier},
                "notify_customer": True,
            }
        }
        return self._req("POST", "/fulfillments.json", body=payload)
