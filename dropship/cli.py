from __future__ import annotations

import argparse
import logging
import sys
import time

from .config import Config, load_dotenv
from .fulfillment import build_supplier
from .http import ApiError, Client
from .meta_ads import MetaAds
from .pipeline import Pipeline
from .shopify import Shopify
from .sourcing import load_products, rank_products
from .state import State

log = logging.getLogger("dropship")


def build_pipeline(cfg: Config, live: bool) -> Pipeline:
    client = Client(dry_run=not live)
    return Pipeline(
        cfg, client, State(cfg.state_file), Shopify(cfg, client), MetaAds(cfg, client), build_supplier(cfg, client)
    )


def cmd_source(args: argparse.Namespace, cfg: Config) -> int:
    from .sourcing import compute_economics

    ranked = rank_products(load_products(args.catalog), cfg)
    if not ranked:
        print("No products pass the filters.")
        return 1
    print(f"{'SKU':<12}{'PRICE':>8}{'PROFIT':>8}{'B/E ROAS':>10}{'SCORE':>8}  TITLE")
    for p, e, s in ranked[: args.top]:
        print(f"{p.sku:<12}{e.price:>8.2f}{e.contribution:>8.2f}{e.break_even_roas:>10.2f}{s:>8.1f}  {p.title}")
    return 0


def _run_cycle(pipe: Pipeline, args: argparse.Namespace) -> None:
    for step, fn in (
        ("orders", pipe.process_orders),
        ("optimize", pipe.optimize),
        ("launch", lambda: pipe.launch(load_products(args.catalog), args.limit)),
    ):
        try:
            fn()
        except ApiError as exc:
            log.error("%s step failed: %s", step, exc)


def main(argv: list[str] | None = None) -> int:
    load_dotenv()
    parser = argparse.ArgumentParser(prog="dropship", description="Automated dropshipping: list, advertise, optimize, fulfill.")
    parser.add_argument("--live", action="store_true", help="Actually call APIs and spend money. Default is dry-run.")
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("source", help="Rank products from a catalog CSV")
    s.add_argument("catalog")
    s.add_argument("--top", type=int, default=10)

    s = sub.add_parser("launch", help="List top products on Shopify and create Meta test ads")
    s.add_argument("catalog")
    s.add_argument("--limit", type=int, default=1)

    sub.add_parser("optimize", help="Pause losing ads, scale winning ones")
    sub.add_parser("orders", help="Forward new paid Shopify orders to the supplier")

    s = sub.add_parser("run", help="Run orders + optimize + launch, once or on a loop")
    s.add_argument("catalog")
    s.add_argument("--limit", type=int, default=1, help="Max new products per cycle")
    s.add_argument("--interval", type=int, default=0, help="Seconds between cycles; 0 = run once")

    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    cfg = Config.from_env()

    if args.cmd == "source":
        return cmd_source(args, cfg)

    if args.live:
        missing = cfg.missing_for_live()
        if missing:
            print(f"Cannot go live; missing env vars: {', '.join(missing)}", file=sys.stderr)
            return 2
    else:
        log.info("DRY RUN: no write requests will be sent. Use --live to execute.")

    pipe = build_pipeline(cfg, args.live)
    try:
        if args.cmd == "launch":
            pipe.launch(load_products(args.catalog), args.limit)
        elif args.cmd == "optimize":
            pipe.optimize()
        elif args.cmd == "orders":
            pipe.process_orders()
        elif args.cmd == "run":
            while True:
                _run_cycle(pipe, args)
                if not args.interval:
                    break
                time.sleep(args.interval)
    except ApiError as exc:
        log.error("%s", exc)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
