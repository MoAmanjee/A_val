from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass

from .config import Config
from .http import ApiError, Client
from .models import Product

log = logging.getLogger("dropship")


@dataclass
class AdCopy:
    primary_text: str
    headline: str
    description: str


@dataclass
class Listing:
    title: str
    body_html: str


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def template_listing(p: Product) -> Listing:
    body = (
        f"<p>{p.description or p.title}</p>"
        "<ul>"
        "<li>Free tracked shipping</li>"
        "<li>30-day hassle-free returns</li>"
        "<li>Secure checkout</li>"
        "</ul>"
    )
    return Listing(title=p.title, body_html=body)


def template_ad_copy(p: Product, price: float) -> list[AdCopy]:
    desc = p.description or p.title
    return [
        AdCopy(
            primary_text=f"{desc}\n\nOnly ${price:.2f} with free shipping. Order today.",
            headline=p.title[:40],
            description="Free shipping",
        ),
        AdCopy(
            primary_text=f"Meet the {p.title}. {desc}\n\nTap to see why people love it.",
            headline=f"Get the {p.title}"[:40],
            description=f"Now ${price:.2f}",
        ),
    ]


def _llm_json(cfg: Config, client: Client, prompt: str) -> dict | None:
    if not cfg.openai_api_key:
        return None
    try:
        resp = client.request(
            "POST",
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {cfg.openai_api_key}"},
            body={
                "model": cfg.openai_model,
                "response_format": {"type": "json_object"},
                "messages": [{"role": "user", "content": prompt}],
            },
        )
        return json.loads(resp["choices"][0]["message"]["content"])
    except (ApiError, KeyError, ValueError) as exc:
        log.warning("LLM copy failed, using templates: %s", exc)
        return None


def generate_content(p: Product, price: float, cfg: Config) -> tuple[Listing, list[AdCopy]]:
    """Uses an LLM when OPENAI_API_KEY is set (always a real call, even in dry-run,
    since it is read-only and cheap); otherwise falls back to templates."""
    listing, copies = template_listing(p), template_ad_copy(p, price)
    if not cfg.openai_api_key:
        return listing, copies

    reader = Client(dry_run=False)
    prompt = (
        "You write honest e-commerce copy. No false claims, no medical/health claims, "
        "no fake scarcity or fake reviews. Product: "
        f"{p.title}. Details: {p.description}. Price: ${price:.2f}.\n"
        'Return JSON: {"title": str, "body_html": str (short, <p> and <ul> only), '
        '"ads": [{"primary_text": str, "headline": str (<=40 chars), "description": str (<=30 chars)}] (3 items)}'
    )
    data = _llm_json(cfg, reader, prompt)
    if not data:
        return listing, copies
    try:
        listing = Listing(title=data["title"][:255], body_html=data["body_html"])
        copies = [
            AdCopy(a["primary_text"], a["headline"][:40], a["description"][:30]) for a in data["ads"]
        ] or copies
    except (KeyError, TypeError):
        log.warning("LLM returned unexpected shape, using templates")
    return listing, copies
