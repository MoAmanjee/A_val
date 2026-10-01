from __future__ import annotations

import csv
import logging
from pathlib import Path
from typing import Protocol

from .config import Config
from .http import Client
from .models import Order

log = logging.getLogger("dropship")


class Supplier(Protocol):
    def place_order(self, order: Order) -> str:
        """Submit the order to the supplier and return a supplier reference."""


class ManualSupplier:
    """Appends orders to a CSV you can upload to / paste into your supplier's bulk
    order tool. Safe default: nothing is purchased automatically."""

    FIELDS = ["order_id", "order_name", "sku", "quantity", "name", "address1", "address2", "city", "province", "zip", "country", "phone", "email"]

    def __init__(self, path: str):
        self.path = Path(path)

    def place_order(self, order: Order) -> str:
        new_file = not self.path.exists()
        a = order.shipping_address
        with open(self.path, "a", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=self.FIELDS)
            if new_file:
                w.writeheader()
            for item in order.items:
                w.writerow(
                    {
                        "order_id": order.id,
                        "order_name": order.name,
                        "sku": item["sku"],
                        "quantity": item["quantity"],
                        "name": a.get("name", ""),
                        "address1": a.get("address1", ""),
                        "address2": a.get("address2", ""),
                        "city": a.get("city", ""),
                        "province": a.get("province", ""),
                        "zip": a.get("zip", ""),
                        "country": a.get("country_code", ""),
                        "phone": a.get("phone", ""),
                        "email": order.email,
                    }
                )
        return f"manual:{order.id}"


class HttpSupplier:
    """Posts a JSON order to a supplier endpoint. The payload is generic; adapt
    `_payload` to your supplier's API schema (CJdropshipping, Zendrop, a custom agent, ...)."""

    def __init__(self, cfg: Config, client: Client):
        self.cfg = cfg
        self.client = client

    def _payload(self, order: Order) -> dict:
        return {
            "external_order_id": order.id,
            "order_name": order.name,
            "email": order.email,
            "shipping_address": order.shipping_address,
            "items": order.items,
        }

    def place_order(self, order: Order) -> str:
        resp = self.client.request(
            "POST",
            self.cfg.supplier_order_url,
            headers={"Authorization": f"Bearer {self.cfg.supplier_api_key}"},
            body=self._payload(order),
        )
        return str(resp.get("id") or resp.get("order_id") or "")


def build_supplier(cfg: Config, client: Client) -> Supplier:
    if cfg.supplier_mode == "http":
        return HttpSupplier(cfg, client)
    if client.dry_run:
        return _DryRunSupplier()
    return ManualSupplier(cfg.orders_outbox)


class _DryRunSupplier:
    def place_order(self, order: Order) -> str:
        log.info("[dry-run] would send order %s (%d items) to supplier", order.name, len(order.items))
        return f"dry-run:{order.id}"
