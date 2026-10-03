#!/usr/bin/env python3
"""Render the two menu boards the bot sends on WhatsApp.

Reads a JSON list of categories produced from db/menu.ts:

  npx tsx -e "import {writeFileSync} from 'node:fs'; import {MOCHACHOS_MENU} from './db/menu.ts'; const data = MOCHACHOS_MENU.categories.map(c => ({name:c.name, description:c.description??'', items:c.items.map(i => ({name:i.name, price:(i.priceCents/100).toFixed(2), meal:i.mealUpgradeCents==null?null:((i.priceCents+i.mealUpgradeCents)/100).toFixed(2)}))})); writeFileSync('public/menu/menu.json', JSON.stringify(data));"

Then: python3 scripts/render-menu-boards.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "menu"
DATA = OUT / "menu.json"

W, H = 2000, 1400
RED = (196, 16, 32)
GOLD = (245, 197, 24)
INK = (28, 24, 20)
CREAM = (255, 248, 239)
MUTED = (90, 78, 70)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def draw_page(categories: list[dict], page: int, pages: int) -> Image.Image:
    image = Image.new("RGB", (W, H), CREAM)
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, W, 118), fill=RED)
    draw.rectangle((0, 118, W, 128), fill=GOLD)
    draw.text((48, 28), "MOCHACHOS", font=font(54, True), fill=(255, 255, 255))
    draw.text((430, 44), "POTCHEFSTROOM CBD", font=font(28, True), fill=GOLD)
    draw.text((48, 148), "17 Nelson Mandela Dr, CBD, Potchefstroom  ·  Collection  ·  Prices in Rand", font=font(22), fill=MUTED)
    draw.text((W - 220, 148), f"Page {page} of {pages}", font=font(22, True), fill=RED)

    columns = 2
    col_w = (W - 80) // columns
    x0 = 40
    y = 200
    col = 0
    title_f = font(26, True)
    item_f = font(20)
    price_f = font(20, True)

    for category in categories:
        block_h = 36 + 28 * max(1, len(category["items"])) + 18
        if y + block_h > H - 40:
            col += 1
            y = 200
            if col >= columns:
                break
        x = x0 + col * col_w
        draw.text((x, y), category["name"].upper(), font=title_f, fill=RED)
        y += 34
        for item in category["items"]:
            label = item["name"]
            if item.get("meal"):
                label = f"{label}   meal R{item['meal']}"
            price = f"R{item['price']}"
            draw.text((x, y), label[:62], font=item_f, fill=INK)
            draw.text((x + col_w - 130, y), price, font=price_f, fill=INK)
            y += 28
        y += 16

    draw.text((48, H - 36), "Flame-grilled. Ask for Lemon & Herb, Mild, Hot, Extra Hot or Dynamite.", font=font(18), fill=MUTED)
    return image


def main() -> None:
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else DATA
    categories = json.loads(source.read_text())
    # The board is two pages: grill and burgers, then the rest of the menu.
    split = 4
    pages = [categories[:split], categories[split:]]
    images = [draw_page(page, i + 1, len(pages)) for i, page in enumerate(pages)]
    OUT.mkdir(parents=True, exist_ok=True)
    images[0].save(OUT / "mochachos-menu-1.jpg", quality=86, optimize=True)
    images[1].save(OUT / "mochachos-menu-2.jpg", quality=86, optimize=True)
    images[0].save(OUT / "mochachos-menu.pdf", save_all=True, append_images=images[1:])
    print(f"Wrote menu boards to {OUT}")


if __name__ == "__main__":
    main()
