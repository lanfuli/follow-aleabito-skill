#!/usr/bin/env python3
"""Backfill reports/aleabito-price-deep-cache.json from the Nasdaq public API.

Free, keyless, and not subject to Yahoo's rate limiting. Covers US-listed
tickers (the vast majority of targets) plus the SPY/SMH ETF benchmarks.
Foreign listings (.ST/.TO/.PA/.L/.DE/.T ...) aren't on Nasdaq and are left
for Yahoo to top up once its rate limit lifts.

Targets: node scripts/build-aleabito-dashboard.js --no-prices --print-deep-targets
Writes the same {d,c,v} daily shape the dashboard's computeTrackRecord reads.
"""
import io
import json
import os
import subprocess
import time
import urllib.request
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEEP_PATH = ROOT / "reports" / "aleabito-price-deep-cache.json"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
PAUSE_S = float(os.environ.get("NASDAQ_PAUSE_S", "0.4"))
REQ_TIMEOUT = 20
DEADLINE_S = float(os.environ.get("NASDAQ_DEADLINE_S", "1200"))
_START = time.monotonic()


def _budget_left():
    return DEADLINE_S - (time.monotonic() - _START)


def http_json(url):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Origin": "https://www.nasdaq.com",
        "Referer": "https://www.nasdaq.com/",
    })
    with urllib.request.urlopen(req, timeout=REQ_TIMEOUT) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def num(s):
    s = str(s).replace("$", "").replace(",", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def fetch_rows(symbol, assetclass, d1, d2):
    url = ("https://api.nasdaq.com/api/quote/%s/historical?assetclass=%s"
           "&fromdate=%s&todate=%s&limit=9999" % (symbol, assetclass, d1, d2))
    j = http_json(url)
    tbl = ((j or {}).get("data") or {}).get("tradesTable") or {}
    return tbl.get("rows") or []


def parse(rows):
    daily = []
    for r in rows:
        ds = r.get("date", "")
        c = num(r.get("close"))
        if not ds or c is None:
            continue
        mm, dd, yy = ds.split("/")
        daily.append({"d": "%s-%s-%s" % (yy, mm, dd), "c": c, "v": num(r.get("volume"))})
    daily.sort(key=lambda x: x["d"])          # Nasdaq returns newest-first
    return daily if len(daily) >= 2 else None


def nasdaq_symbol(ticker, ysym):
    # Nasdaq only carries US listings; skip anything with a foreign Yahoo suffix.
    if "." in str(ysym):
        return None
    return ticker.replace(".", "/")          # class shares: BRK.B -> BRK/B


def main():
    out = subprocess.run(
        ["node", str(ROOT / "scripts" / "build-aleabito-dashboard.js"),
         "--no-prices", "--print-deep-targets"],
        capture_output=True, text=True, check=True,
    )
    spec = json.loads(out.stdout.strip().splitlines()[-1])
    targets = spec["targets"]
    bench = spec["bench"]

    cache = json.load(io.open(DEEP_PATH)) if DEEP_PATH.exists() else {
        "generated_at": None, "provider": "Nasdaq + Yahoo", "series": {}}
    cache.setdefault("series", {})

    today = date.today()
    d1 = (today - timedelta(days=760)).strftime("%Y-%m-%d")
    d2 = today.strftime("%Y-%m-%d")

    work = [(b, b, "etf") for b in bench] + [(k, v, "stocks") for k, v in sorted(targets.items())]
    done = skipped = nodata = already = 0
    for key, ysym, primary in work:
        if _budget_left() <= 0:
            print("DEADLINE reached — saving partial", flush=True)
            break
        cur = cache["series"].get(key)
        if cur and cur.get("daily"):
            already += 1
            continue
        sym = key if primary == "etf" else nasdaq_symbol(key, ysym)
        if not sym:
            skipped += 1
            continue
        daily = None
        for ac in ([primary] + (["etf"] if primary == "stocks" else ["stocks"])):
            try:
                rows = fetch_rows(sym, ac, d1, d2)
            except Exception as e:
                print("err %-8s %s: %s" % (key, ac, type(e).__name__), flush=True)
                rows = []
            daily = parse(rows)
            if daily:
                break
            time.sleep(PAUSE_S)
        if not daily:
            nodata += 1
            print("no data: %-8s" % key, flush=True)
            time.sleep(PAUSE_S)
            continue
        cache["series"][key] = {
            "symbol": ysym, "currency": "USD", "exchange": "Nasdaq",
            "daily": daily, "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        done += 1
        if done % 20 == 0:
            cache["generated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            DEEP_PATH.write_text(json.dumps(cache) + "\n")
            print("progress: %d fetched (%d to go)" % (done, len(work) - done - already - skipped - nodata), flush=True)
        time.sleep(PAUSE_S)

    cache["generated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    DEEP_PATH.write_text(json.dumps(cache) + "\n")
    with_data = sum(1 for v in cache["series"].values() if v.get("daily"))
    print(json.dumps({
        "fetched": done, "already": already, "skipped_foreign": skipped, "no_data": nodata,
        "series_with_data": with_data,
        "spy": bool(cache["series"].get("SPY", {}).get("daily")),
        "smh": bool(cache["series"].get("SMH", {}).get("daily")),
    }), flush=True)


if __name__ == "__main__":
    main()
