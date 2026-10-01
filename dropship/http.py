from __future__ import annotations

import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

log = logging.getLogger("dropship")


class ApiError(RuntimeError):
    pass


class Client:
    """Minimal JSON HTTP client. In dry-run mode every non-GET request is logged
    and answered with a fake id instead of being sent."""

    def __init__(self, dry_run: bool = True, timeout: int = 30):
        self.dry_run = dry_run
        self.timeout = timeout
        self._counter = 0

    def request(
        self,
        method: str,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        params: dict[str, Any] | None = None,
        body: Any = None,
    ) -> dict[str, Any]:
        method = method.upper()
        if params:
            url = f"{url}?{urllib.parse.urlencode(params)}"

        if self.dry_run and method != "GET":
            self._counter += 1
            log.info("[dry-run] %s %s %s", method, _redact(url), json.dumps(body)[:300] if body else "")
            return {"id": f"dry-run-{self._counter}", "dry_run": True}

        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        for k, v in (headers or {}).items():
            req.add_header(k, v)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read()
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="replace")[:500]
            raise ApiError(f"{method} {_redact(url)} -> {exc.code}: {detail}") from exc
        except urllib.error.URLError as exc:
            raise ApiError(f"{method} {_redact(url)} failed: {exc.reason}") from exc
        return json.loads(raw) if raw else {}


def _redact(url: str) -> str:
    return url.split("access_token=")[0] + ("access_token=***" if "access_token=" in url else "")
