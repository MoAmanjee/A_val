from __future__ import annotations

from dataclasses import dataclass

from .config import Config
from .meta_ads import Metrics


@dataclass
class Decision:
    action: str  # WAIT | KEEP | PAUSE | SCALE
    reason: str
    new_budget: float | None = None


def decide(
    m: Metrics,
    *,
    contribution: float,
    break_even_roas: float,
    current_budget: float,
    other_active_budget: float,
    cfg: Config,
) -> Decision:
    """Rule-based ad optimizer.

    contribution: profit per order before ad spend; it is the most we can pay per sale.
    other_active_budget: summed daily budget of all other active campaigns, used to
    enforce the global cap before scaling.
    """
    kill_spend = cfg.kill_spend_multiple * contribution

    if m.purchases == 0:
        if m.spend >= kill_spend:
            return Decision("PAUSE", f"spent {m.spend:.2f} (>= {kill_spend:.2f}) with no sales")
        return Decision("WAIT", f"spent {m.spend:.2f} of {kill_spend:.2f} allowance, no sales yet")

    if m.roas < break_even_roas and m.spend >= kill_spend:
        return Decision("PAUSE", f"ROAS {m.roas:.2f} below break-even {break_even_roas:.2f}")

    if m.purchases >= cfg.scale_min_purchases and m.roas >= break_even_roas * cfg.scale_roas_multiple:
        ceiling = min(cfg.max_daily_budget_per_product, cfg.max_total_daily_budget - other_active_budget)
        new_budget = round(min(current_budget * cfg.scale_step, ceiling), 2)
        if new_budget > current_budget:
            return Decision(
                "SCALE",
                f"ROAS {m.roas:.2f} >= {break_even_roas * cfg.scale_roas_multiple:.2f} over {m.purchases} sales",
                new_budget,
            )
        return Decision("KEEP", "profitable but at budget cap")

    return Decision("KEEP", f"ROAS {m.roas:.2f} vs break-even {break_even_roas:.2f}")
