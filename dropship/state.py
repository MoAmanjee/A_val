from __future__ import annotations

import json
from pathlib import Path
from typing import Any


class State:
    """Tiny JSON-file store: launched products and already-forwarded orders."""

    def __init__(self, path: str):
        self.path = Path(path)
        self.data: dict[str, Any] = {"products": {}, "orders": {}}
        if self.path.exists():
            self.data.update(json.loads(self.path.read_text()))

    @property
    def products(self) -> dict[str, dict]:
        return self.data["products"]

    @property
    def orders(self) -> dict[str, dict]:
        return self.data["orders"]

    def live_products(self) -> dict[str, dict]:
        """Launched products that have not been killed. Paused-at-launch campaigns
        count too, because the owner may switch them on at any time."""
        return {k: v for k, v in self.products.items() if not v["ads"].get("killed")}

    def live_budget(self, exclude: str | None = None) -> float:
        return sum(v["ads"]["daily_budget"] for k, v in self.live_products().items() if k != exclude)

    def save(self) -> None:
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.data, indent=2))
        tmp.replace(self.path)
