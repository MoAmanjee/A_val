from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Product:
    sku: str
    title: str
    description: str
    category: str
    cost: float  # supplier unit cost
    shipping: float  # supplier shipping cost to customer
    image_url: str
    supplier_rating: float = 0.0
    supplier_orders: int = 0
    supplier_url: str = ""

    @property
    def landed_cost(self) -> float:
        return round(self.cost + self.shipping, 2)


@dataclass
class Economics:
    price: float
    landed_cost: float
    fees: float
    contribution: float  # profit per order before ad spend
    break_even_roas: float  # ROAS at which ad spend eats all contribution
    margin_pct: float


@dataclass
class Order:
    id: str
    name: str
    email: str
    shipping_address: dict
    items: list[dict]  # [{"sku": ..., "quantity": ...}]
