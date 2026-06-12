#!/usr/bin/env python3
"""Backfill reports/aleabito-price-deep-cache.json from Stooq (free, no key).

Used when Yahoo's chart API is rate-limiting. Completes Stooq's standard
proof-of-work handshake (the same SHA-256 challenge a browser solves), then
downloads ~2y of daily closes per target at a polite pace.

Targets come from: node scripts/build-aleabito-dashboard.js --print-deep-targets
Symbols Stooq doesn't carry (.ST/.TO/.AX/.SW/.SZ ...) are skipped and left for
Yahoo to top up once its rate limit lifts.
"""
import hashlib
import io
import json
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, timedelta
from http.cookiejar import CookieJar
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEEP_PATH = ROOT / "reports" / "aleabito-price-deep-cache.json"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
PAUSE_S = 0.6
REQ_TIMEOUT = 15
# Hard wall-clock budget so a hanging host can never blow past the CI job cap.
DEADLINE_S = float(os.environ.get("STOOQ_DEADLINE_S", "540"))
_START = time.monotonic()


def _budget_left():
    return DEADLINE_S - (time.monotonic() - _START)

jar = CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
opener.addheaders = [("User-Agent", UA), ("Accept", "*/*")]


def http_get(url):
    with opener.open(url, timeout=REQ_TIMEOUT) as r:
        return r.read().decode("utf-8", "replace")


def solve_pow(html):
    """Complete Stooq's proof-of-work: find n where sha256(c+n) starts with d zeros."""
    m = re.search(r'const c="([^"]+)",d=(\d+)', html)
    if not m:
        raise RuntimeError("challenge constants not found")
    c, d = m.group(1), int(m.group(2))
    target = "0" * d
    n = 0
    while True:
        if hashlib.sha256((c + str(n)).encode()).hexdigest().startswith(target):
            break
        n += 1
    body = ("c=" + urllib.parse.quote(c, safe="") + "&n=" + str(n)).encode()
    req = urllib.request.Request(
        "https://stooq.com/__verify", data=body, method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA},
    )
    with opener.open(req, timeout=REQ_TIMEOUT) as r:
        ok = 200 <= r.status < 300
    if not ok:
        raise RuntimeError("__verify rejected")
    print("PoW handshake passed (n=%d)" % n, flush=True)


def stooq_symbol(yahoo_symbol):
    s = (yahoo_symbol or "").upper()
    if not s:
        return None
    if s == "BTC-USD":
        return "btcusd"
    if s == "ETH-USD":
        return "ethusd"
    if "." in s:
        base, suf = s.rsplit(".", 1)
        base = base.lower()
        return {
            "L": base + ".uk", "PA": base + ".fr", "DE": base + ".de",
            "T": base + ".jp", "HK": base + ".hk", "US": base + ".us",
        }.get(suf)
    return s.lower() + ".us"


def fetch_csv(sym, d1, d2):
    url = "https://stooq.com/q/d/l/?s=%s&i=d&d1=%s&d2=%s" % (sym, d1, d2)
    text = http_get(url)
    if "__verify" in text and "sha-256" in text.lower() or 'const c="' in text:
        solve_pow(text)
        text = http_get(url)
    return text


def parse_csv(text):
    lines = [l.strip() for l in text.strip().splitlines() if l.strip()]
    if not lines or not lines[0].lower().startswith("date,"):
        return None
    daily = []
    for line in lines[1:]:
        parts = line.split(",")
        if len(parts) < 5:
            continue
        try:
            close = float(parts[4])
        except ValueError:
            continue
        vol = None
        if len(parts) > 5:
            try:
                vol = float(parts[5])
            except ValueError:
                vol = None
        daily.append({"d": parts[0], "c": close, "v": vol})
    return daily if len(daily) >= 2 else None


def main():
    out = subprocess.run(
        ["node", str(ROOT / "scripts" / "build-aleabito-dashboard.js"), "--no-prices", "--print-deep-targets"],
        capture_output=True, text=True, check=True,
    )
    spec = json.loads(out.stdout.strip().splitlines()[-1])
    targets = spec["targets"]          # {ticker: yahooSymbol}
    bench = spec["bench"]              # ["SPY", "SMH"]

    cache = json.load(io.open(DEEP_PATH)) if DEEP_PATH.exists() else {
        "generated_at": None, "provider": "Yahoo Finance chart API (2y)", "series": {}}
    cache.setdefault("series", {})

    today = date.today()
    d1 = (today - timedelta(days=730)).strftime("%Y%m%d")
    d2 = today.strftime("%Y%m%d")

    work = [(b, b) for b in bench] + sorted(targets.items())
    done = skipped = nodata = already = 0
    for key, ysym in work:
        if _budget_left() <= 0:
            print("DEADLINE reached — saving partial progress", flush=True)
            break
        cur = cache["series"].get(key)
        if cur and cur.get("daily"):
            already += 1
            continue
        ssym = stooq_symbol(ysym)
        if not ssym:
            skipped += 1
            print("skip (no stooq market): %-8s %s" % (key, ysym), flush=True)
            continue
        try:
            text = fetch_csv(ssym, d1, d2)
        except Exception as e:
            print("error %-8s %s: %s" % (key, ssym, e), flush=True)
            time.sleep(PAUSE_S)
            continue
        if "Exceeded the daily hits limit" in text:
            print("STOOQ DAILY QUOTA REACHED — saving partial progress", flush=True)
            break
        daily = parse_csv(text)
        if not daily:
            nodata += 1
            print("no data: %-8s %s" % (key, ssym), flush=True)
            time.sleep(PAUSE_S)
            continue
        cache["series"][key] = {
            "symbol": ysym, "currency": "", "exchange": "Stooq",
            "daily": daily, "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        done += 1
        if done % 20 == 0:
            cache["generated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            DEEP_PATH.write_text(json.dumps(cache) + "\n")
            print("progress: %d fetched" % done, flush=True)
        time.sleep(PAUSE_S)

    cache["generated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    DEEP_PATH.write_text(json.dumps(cache) + "\n")
    with_data = sum(1 for v in cache["series"].values() if v.get("daily"))
    print(json.dumps({
        "fetched": done, "already_cached": already, "skipped_market": skipped,
        "no_data": nodata, "series_with_data": with_data,
        "spy": bool(cache["series"].get("SPY", {}).get("daily")),
        "smh": bool(cache["series"].get("SMH", {}).get("daily")),
    }), flush=True)


if __name__ == "__main__":
    main()
