from __future__ import annotations

import csv
import math
from pathlib import Path

from .config import Config
from .models import Economics, Product


def load_products(path: str | Path) -> list[Product]:
    products = []
    with open(path, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            products.append(
                Product(
                    sku=row["sku"].strip(),
                    title=row["title"].strip(),
                    description=row.get("description", "").strip(),
                    category=row.get("category", "").strip(),
                    cost=float(row["cost"]),
                    shipping=float(row.get("shipping") or 0),
                    image_url=row.get("image_url", "").strip(),
                    supplier_rating=float(row.get("supplier_rating") or 0),
                    supplier_orders=int(float(row.get("supplier_orders") or 0)),
                    supplier_url=row.get("supplier_url", "").strip(),
                )
            )
    return products


def compute_economics(p: Product, cfg: Config) -> Economics:
    landed = p.landed_cost
    raw = (landed + cfg.payment_fee_fixed + cfg.target_profit_per_order) / (1 - cfg.payment_fee_pct)
    price = round(math.ceil(raw) - 0.01, 2)
    fees = round(price * cfg.payment_fee_pct + cfg.payment_fee_fixed, 2)
    contribution = round(price - landed - fees, 2)
    break_even_roas = round(price / contribution, 2) if contribution > 0 else float("inf")
    return Economics(
        price=price,
        landed_cost=landed,
        fees=fees,
        contribution=contribution,
        break_even_roas=break_even_roas,
        margin_pct=round(contribution / price, 3) if price else 0.0,
    )


def passes_filters(p: Product, econ: Economics, cfg: Config) -> bool:
    return (
        p.supplier_rating >= cfg.min_supplier_rating
        and p.supplier_orders >= cfg.min_supplier_orders
        and cfg.min_price <= econ.price <= cfg.max_price
        and econ.contribution >= cfg.min_contribution
        and bool(p.image_url)
    )


def score(p: Product, econ: Economics) -> float:
    """Higher is better: rewards proven demand, supplier quality and margin."""
    demand = math.log10(p.supplier_orders + 1)
    return round(demand * p.supplier_rating * econ.margin_pct * 100, 2)


def rank_products(products: list[Product], cfg: Config) -> list[tuple[Product, Economics, float]]:
    ranked = []
    for p in products:
        econ = compute_economics(p, cfg)
        if passes_filters(p, econ, cfg):
            ranked.append((p, econ, score(p, econ)))
    ranked.sort(key=lambda t: t[2], reverse=True)
    return ranked
