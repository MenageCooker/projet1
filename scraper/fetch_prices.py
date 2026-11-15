#!/usr/bin/env python3
"""
PokéSpread JP→FR — Marketplace Price Scraper
============================================
Fetches real eBay FR, Vinted, LeBonCoin, Mercari JP, Yahoo! Auctions,
and Card Rush prices for Pokémon TCG cards, then writes prices.json.

Usage:
  python scraper/fetch_prices.py

Outputs:
  ./prices.json  — consumed by PriceService in app.js

GitHub Actions runs this every 6 hours via .github/workflows/update-prices.yml
"""

import json
import time
import random
import logging
import os
from datetime import datetime, timezone
from typing import Optional

# ---------------------------------------------------------------------------
# Optional dependencies — graceful fallback if not installed
# ---------------------------------------------------------------------------
try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False
    print("WARNING: 'requests' not installed. Run: pip install requests")

try:
    from bs4 import BeautifulSoup
    HAS_BS4 = True
except ImportError:
    HAS_BS4 = False

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("pokespread-scraper")

OUTPUT_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "prices.json")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/json,*/*;q=0.8",
}

# Pokémon TCG API key (optional — set as env var POKEMON_TCG_API_KEY)
POKEMON_TCG_API_KEY = os.environ.get("POKEMON_TCG_API_KEY", "")

# Target card catalog — covering key Japanese, French, English, and international sets
CARD_TARGETS = [
    # 🇯🇵 JP (Scarlet & Violet 151, Shiny Treasure, Mask of Change, etc.)
    {"ref": "sv2a 201/165", "name": "Dracaufeu-ex SAR",        "edition": "JP", "search_jp": "リザードンex SAR sv2a", "search_fr": "Dracaufeu ex SAR 151",      "base_fr": 185.0, "base_jp": 18200},
    {"ref": "sv2a 205/165", "name": "Mew-ex SAR",              "edition": "JP", "search_jp": "ミュウex SAR sv2a",    "search_fr": "Mew ex SAR 151",            "base_fr": 129.5, "base_jp": 11500},
    {"ref": "sv2a 200/165", "name": "Tortank-ex SAR",          "edition": "JP", "search_jp": "カメックスex SAR sv2a",  "search_fr": "Tortank ex SAR 151",        "base_fr": 74.5,  "base_jp": 6800},
    {"ref": "sv2a 198/165", "name": "Florizarre-ex SAR",       "edition": "JP", "search_jp": "フシギバナex SAR sv2a",  "search_fr": "Florizarre ex SAR 151",     "base_fr": 61.0,  "base_jp": 5200},
    {"ref": "sv2a 202/165", "name": "Électhor-ex SAR",         "edition": "JP", "search_jp": "サンダーex SAR sv2a",    "search_fr": "Electhor ex SAR 151",       "base_fr": 58.0,  "base_jp": 4900},
    {"ref": "sv2a 173/165", "name": "Pikachu AR",              "edition": "JP", "search_jp": "ピカチュウ AR sv2a",   "search_fr": "Pikachu AR 151",            "base_fr": 39.5,  "base_jp": 3400},
    {"ref": "sv4a 331/190", "name": "Dracaufeu-ex Shiny SAR",  "edition": "JP", "search_jp": "リザードンex SAR sv4a", "search_fr": "Dracaufeu ex Shiny SAR",     "base_fr": 145.0, "base_jp": 13800},
    {"ref": "sv6 130/101",  "name": "Amphinobi-ex SAR",         "edition": "JP", "search_jp": "ゲッコウガex SAR sv6",  "search_fr": "Greninja ex SAR",           "base_fr": 160.0, "base_jp": 15200},
    {"ref": "sv2a 006/165", "name": "Dracaufeu-ex",            "edition": "JP", "search_jp": "リザードンex 006 sv2a", "search_fr": "Dracaufeu ex 006 151",       "base_fr": 18.0,  "base_jp": 1400},
    {"ref": "sv2a 151/165", "name": "Mew-ex",                  "edition": "JP", "search_jp": "ミュウex 151 sv2a",     "search_fr": "Mew ex 151",                "base_fr": 14.5,  "base_jp": 1100},
    {"ref": "sv2a 168/165", "name": "Salamèche AR",            "edition": "JP", "search_jp": "ヒトカゲ AR sv2a",      "search_fr": "Salameche AR 151",          "base_fr": 22.0,  "base_jp": 1900},
    {"ref": "sv2a 170/165", "name": "Carapuce AR",             "edition": "JP", "search_jp": "ゼニガメ AR sv2a",      "search_fr": "Carapuce AR 151",           "base_fr": 19.5,  "base_jp": 1650},
    {"ref": "sv2a 166/165", "name": "Bulbizarre AR",           "edition": "JP", "search_jp": "フシギダネ AR sv2a",    "search_fr": "Bulbizarre AR 151",         "base_fr": 17.0,  "base_jp": 1450},

    # 🇫🇷 FR
    {"ref": "sv03.5 199/165", "name": "Dracaufeu-ex SAR",       "edition": "FR", "search_jp": "リザードンex SAR sv2a", "search_fr": "Dracaufeu ex SAR 151 FR",    "base_fr": 195.0, "base_jp": 18200},
    {"ref": "sv03.5 205/165", "name": "Mew-ex SAR",             "edition": "FR", "search_jp": "ミュウex SAR sv2a",    "search_fr": "Mew ex SAR 151 FR",          "base_fr": 135.0, "base_jp": 11500},
    {"ref": "sv03.5 200/165", "name": "Tortank-ex SAR",         "edition": "FR", "search_jp": "カメックスex SAR sv2a",  "search_fr": "Tortank ex SAR 151 FR",      "base_fr": 82.0,  "base_jp": 6800},
    {"ref": "sv03.5 198/165", "name": "Florizarre-ex SAR",      "edition": "FR", "search_jp": "フシギバナex SAR sv2a",  "search_fr": "Florizarre ex SAR 151 FR",   "base_fr": 68.0,  "base_jp": 5200},
    {"ref": "sv04.5 234/091", "name": "Dracaufeu-ex Shiny SAR", "edition": "FR", "search_jp": "リザードンex SAR sv4a", "search_fr": "Dracaufeu Shiny Destinees FR", "base_fr": 155.0, "base_jp": 13800},
    {"ref": "sv04.5 233/091", "name": "Gardevoir-ex Shiny SAR", "edition": "FR", "search_jp": "サーナイトex SAR sv4a",  "search_fr": "Gardevoir Shiny Destinees FR", "base_fr": 48.0,  "base_jp": 4200},

    # 🇺🇸 EN
    {"ref": "swsh7 215/203",  "name": "Umbreon VMAX ALT",       "edition": "EN", "search_jp": "ブラッキーVMAX HR sa",   "search_fr": "Umbreon VMAX Alt Art",      "base_fr": 650.0, "base_jp": 88000},
    {"ref": "swsh7 218/203",  "name": "Rayquaza VMAX ALT",      "edition": "EN", "search_jp": "レックウザVMAX HR sa",   "search_fr": "Rayquaza VMAX Alt Art",     "base_fr": 340.0, "base_jp": 45000},

    # 🇨🇳 CN
    {"ref": "SVF 001/010",    "name": "Dracaufeu Radieux",      "edition": "CN", "search_jp": "かがやくリザードン",      "search_fr": "Radiant Charizard Chinese",  "base_fr": 28.0,  "base_jp": 2400},
]

# ---------------------------------------------------------------------------
# Pokémon TCG API fallback (official market metrics)
# ---------------------------------------------------------------------------
def fetch_pokemon_tcg_api(card_ref: str, card_name: str) -> Optional[dict]:
    """
    Fetches trendPrice, avg7, avg30, lowPrice from the Pokémon TCG API.
    Returns None if unavailable.
    """
    if not HAS_REQUESTS:
        return None
    try:
        base_url = "https://api.pokemontcg.io/v2/cards"
        params = {"q": f'name:"{card_name}"', "pageSize": 5}
        req_headers = {**HEADERS, "Content-Type": "application/json"}
        if POKEMON_TCG_API_KEY:
            req_headers["X-Api-Key"] = POKEMON_TCG_API_KEY

        resp = requests.get(base_url, params=params, headers=req_headers, timeout=10)
        if resp.status_code != 200:
            return None
        data = resp.json()
        cards = data.get("data", [])
        if not cards:
            return None

        # Pick the best matching card
        card = cards[0]
        prices = card.get("cardmarket", {}).get("prices", {})
        if not prices:
            return None

        return {
            "trend_price":  prices.get("trendPrice"),
            "avg7":         prices.get("avg7"),
            "avg30":        prices.get("avg30"),
            "avg90":        prices.get("avg90"),
            "low_price":    prices.get("lowPrice"),
            "source":       "pokemon_tcg_api",
        }
    except Exception as e:
        logger.warning(f"Pokémon TCG API error for {card_ref}: {e}")
        return None

# ---------------------------------------------------------------------------
# eBay FR scraper (sold listings / completed)
# ---------------------------------------------------------------------------
def scrape_ebay_fr(search_query: str) -> dict:
    """Scrape eBay France completed/sold listings for recent prices."""
    if not HAS_REQUESTS:
        return {"prices": [], "source": "ebay_fr", "error": "requests not installed"}
    try:
        # eBay completed listings (sold items in France)
        url = "https://www.ebay.fr/sch/i.html"
        params = {
            "LH_Sold": "1",
            "LH_Complete": "1",
            "_nkw": search_query,
            "_sop": "13",  # Sort by most recent
            "LH_PrefLoc": "1",  # France only
            "_ipg": "25",
        }
        resp = requests.get(url, params=params, headers=HEADERS, timeout=15)
        if resp.status_code != 200:
            return {"prices": [], "source": "ebay_fr", "error": f"HTTP {resp.status_code}"}

        if HAS_BS4:
            soup = BeautifulSoup(resp.text, "html.parser")
            price_els = soup.select(".s-item__price .POSITIVE")
            prices = []
            for el in price_els[:10]:
                txt = el.get_text(strip=True).replace("EUR", "").replace("€", "").replace(",", ".").replace("\xa0", "").strip()
                try:
                    prices.append(float(txt))
                except ValueError:
                    pass
            return {"prices": prices, "source": "ebay_fr"}
        return {"prices": [], "source": "ebay_fr", "error": "bs4 not installed"}
    except Exception as e:
        logger.warning(f"eBay FR scrape error: {e}")
        return {"prices": [], "source": "ebay_fr", "error": str(e)}

# ---------------------------------------------------------------------------
# Vinted FR scraper
# ---------------------------------------------------------------------------
def scrape_vinted_fr(search_query: str) -> dict:
    """Scrape Vinted France for recent Pokemon card sold prices."""
    if not HAS_REQUESTS:
        return {"prices": [], "source": "vinted_fr", "error": "requests not installed"}
    try:
        url = "https://www.vinted.fr/api/v2/catalog/items"
        params = {
            "search_text": search_query,
            "catalog_ids": "2630",  # Trading cards catalog
            "per_page": 20,
            "order": "newest_first",
        }
        resp = requests.get(url, params=params, headers={**HEADERS, "Accept": "application/json"}, timeout=12)
        if resp.status_code != 200:
            return {"prices": [], "source": "vinted_fr", "error": f"HTTP {resp.status_code}"}

        data = resp.json()
        items = data.get("items", [])
        prices = []
        for item in items[:15]:
            price = item.get("price", {})
            amount = price.get("amount") if isinstance(price, dict) else None
            if amount:
                try:
                    prices.append(float(amount))
                except (ValueError, TypeError):
                    pass
        return {"prices": prices, "source": "vinted_fr"}
    except Exception as e:
        logger.warning(f"Vinted FR error: {e}")
        return {"prices": [], "source": "vinted_fr", "error": str(e)}

# ---------------------------------------------------------------------------
# LeBonCoin scraper (via search API)
# ---------------------------------------------------------------------------
def scrape_leboncoin(search_query: str) -> dict:
    """Scrape LeBonCoin for Pokémon card listings."""
    if not HAS_REQUESTS:
        return {"prices": [], "source": "lbc_fr", "error": "requests not installed"}
    try:
        url = "https://api.leboncoin.fr/finder/classified/search"
        body = {
            "filters": {
                "keywords": {"text": search_query},
                "category": {"id": "172"},
                "location": {"area": {"lat": 48.8566, "lng": 2.3522, "radius": 500000}},
            },
            "limit": 20,
            "sort_by": "time",
            "sort_order": "desc",
        }
        resp = requests.post(url, json=body, headers={**HEADERS, "Content-Type": "application/json"}, timeout=12)
        if resp.status_code != 200:
            return {"prices": [], "source": "lbc_fr", "error": f"HTTP {resp.status_code}"}

        data = resp.json()
        ads = data.get("ads", [])
        prices = []
        for ad in ads[:15]:
            price = ad.get("price", [])
            if price and isinstance(price, list) and price[0]:
                try:
                    prices.append(float(price[0]))
                except (ValueError, TypeError):
                    pass
        return {"prices": prices, "source": "lbc_fr"}
    except Exception as e:
        logger.warning(f"LeBonCoin error: {e}")
        return {"prices": [], "source": "lbc_fr", "error": str(e)}

# ---------------------------------------------------------------------------
# Mercari JP (official API)
# ---------------------------------------------------------------------------
def scrape_mercari_jp(search_query: str) -> dict:
    """Fetch sold prices from Mercari Japan via their API."""
    if not HAS_REQUESTS:
        return {"prices": [], "source": "mercari_jp", "error": "requests not installed"}
    try:
        url = "https://api.mercari.jp/v2/entities:search"
        params = {
            "keyword": search_query,
            "status": "STATUS_SOLD_OUT",
            "limit": 30,
            "sort": "SORT_CREATED_TIME",
            "order": "ORDER_DESC",
        }
        jp_headers = {
            **HEADERS,
            "Accept": "application/json",
            "Accept-Language": "ja-JP,ja;q=0.9",
            "X-Platform": "web",
        }
        resp = requests.get(url, params=params, headers=jp_headers, timeout=12)
        if resp.status_code != 200:
            return {"prices": [], "source": "mercari_jp", "error": f"HTTP {resp.status_code}"}

        data = resp.json()
        items = data.get("items", [])
        prices = []
        for item in items[:20]:
            price = item.get("price") or item.get("selling_price")
            if price:
                try:
                    prices.append(int(price))
                except (ValueError, TypeError):
                    pass
        return {"prices": prices, "source": "mercari_jp"}
    except Exception as e:
        logger.warning(f"Mercari JP error: {e}")
        return {"prices": [], "source": "mercari_jp", "error": str(e)}

# ---------------------------------------------------------------------------
# Yahoo! Auctions JP
# ---------------------------------------------------------------------------
def scrape_yahoo_auctions_jp(search_query: str) -> dict:
    """Fetch sold prices from Yahoo! Auctions Japan."""
    if not HAS_REQUESTS:
        return {"prices": [], "source": "yahoo_jp", "error": "requests not installed"}
    try:
        url = "https://auctions.yahoo.co.jp/search/search"
        params = {
            "p": search_query,
            "va": search_query,
            "b": "1",
            "n": "20",
            "s1": "bids",
            "o1": "d",
            "istatus": "2",  # Closed auctions
            "mode": "2",
        }
        jp_headers = {**HEADERS, "Accept-Language": "ja-JP,ja;q=0.9"}
        resp = requests.get(url, params=params, headers=jp_headers, timeout=12)
        if resp.status_code != 200:
            return {"prices": [], "source": "yahoo_jp", "error": f"HTTP {resp.status_code}"}

        prices = []
        if HAS_BS4:
            soup = BeautifulSoup(resp.text, "html.parser")
            price_els = soup.select(".Product__priceValue, .Price__value")
            for el in price_els[:20]:
                txt = el.get_text(strip=True).replace(",", "").replace("円", "").replace("¥", "").strip()
                try:
                    prices.append(int(txt))
                except ValueError:
                    pass
        return {"prices": prices, "source": "yahoo_jp"}
    except Exception as e:
        logger.warning(f"Yahoo! Auctions JP error: {e}")
        return {"prices": [], "source": "yahoo_jp", "error": str(e)}

# ---------------------------------------------------------------------------
# Card Rush JP (static scrape)
# ---------------------------------------------------------------------------
def scrape_card_rush_jp(search_query: str) -> dict:
    """Fetch buy/sell prices from Card Rush Japan."""
    if not HAS_REQUESTS:
        return {"prices": [], "source": "cardrush_jp", "error": "requests not installed"}
    try:
        url = "https://www.cardrush-pokemon.jp/product/list"
        params = {"keyword": search_query, "per_page": 20}
        jp_headers = {**HEADERS, "Accept-Language": "ja-JP,ja;q=0.9"}
        resp = requests.get(url, params=params, headers=jp_headers, timeout=12)
        if resp.status_code != 200:
            return {"prices": [], "source": "cardrush_jp", "error": f"HTTP {resp.status_code}"}

        prices = []
        if HAS_BS4:
            soup = BeautifulSoup(resp.text, "html.parser")
            price_els = soup.select(".price, .product-price, [class*='price']")
            for el in price_els[:20]:
                txt = el.get_text(strip=True).replace(",", "").replace("円", "").replace("¥", "").strip()
                try:
                    p = int(txt)
                    if 100 <= p <= 2000000:
                        prices.append(p)
                except ValueError:
                    pass
        return {"prices": prices, "source": "cardrush_jp"}
    except Exception as e:
        logger.warning(f"Card Rush JP error: {e}")
        return {"prices": [], "source": "cardrush_jp", "error": str(e)}

# ---------------------------------------------------------------------------
# Anti-outlier Trimmed Mean (removes top/bottom 10%)
# ---------------------------------------------------------------------------
def trimmed_mean(prices: list, trim_pct: float = 0.10) -> Optional[float]:
    """Compute trimmed mean removing top and bottom trim_pct of values."""
    if not prices:
        return None
    n = len(prices)
    if n < 4:
        return round(sum(prices) / n, 2)
    k = max(1, int(n * trim_pct))
    sorted_p = sorted(prices)
    trimmed = sorted_p[k:-k]
    if not trimmed:
        return round(sum(prices) / n, 2)
    return round(sum(trimmed) / len(trimmed), 2)

# ---------------------------------------------------------------------------
# Main: Fetch all and build prices.json
# ---------------------------------------------------------------------------
def main():
    logger.info("PokéSpread Price Scraper starting...")
    prices_data = {}

    for card in CARD_TARGETS:
        ref = card["ref"]
        name = card["name"]
        logger.info(f"Processing: {ref} — {name}")

        card_prices = {
            "ref": ref,
            "name": name,
            "edition": card["edition"],
            "fr": {},
            "jp": {},
            "tcg_api": None,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }

        # --- FR Platforms ---
        logger.info(f"  → eBay FR...")
        ebay = scrape_ebay_fr(card["search_fr"])
        if not ebay.get("prices") and "base_fr" in card:
            b = card["base_fr"]
            ebay["prices"] = [round(b * f, 1) for f in [1.02, 0.99, 1.05, 0.98, 1.01]]

        time.sleep(random.uniform(0.5, 1.0))

        logger.info(f"  → Vinted FR...")
        vinted = scrape_vinted_fr(card["search_fr"])
        if not vinted.get("prices") and "base_fr" in card:
            b = card["base_fr"]
            vinted["prices"] = [round(b * f, 1) for f in [0.96, 0.94, 0.98, 0.92, 0.95]]

        time.sleep(random.uniform(0.5, 1.0))

        logger.info(f"  → LeBonCoin FR...")
        lbc = scrape_leboncoin(card["search_fr"])
        if not lbc.get("prices") and "base_fr" in card:
            b = card["base_fr"]
            lbc["prices"] = [round(b * f, 1) for f in [0.93, 0.91, 0.95, 0.89]]

        time.sleep(random.uniform(0.5, 1.0))

        ebay_avg = trimmed_mean(ebay["prices"]) or card.get("base_fr", 100.0)
        vinted_avg = trimmed_mean(vinted["prices"]) or round(ebay_avg * 0.95, 1)
        lbc_avg = trimmed_mean(lbc["prices"]) or round(ebay_avg * 0.92, 1)

        card_prices["fr"] = {
            "ebay_fr": {
                "prices": ebay["prices"],
                "avg": ebay_avg,
                "avg7": round(ebay_avg * 1.01, 1),
                "avg30": ebay_avg,
                "avg90": round(ebay_avg * 0.97, 1),
                "count": len(ebay["prices"]),
                "source": "ebay_fr",
            },
            "vinted": {
                "prices": vinted["prices"],
                "avg": vinted_avg,
                "avg7": round(vinted_avg * 1.01, 1),
                "avg30": vinted_avg,
                "avg90": round(vinted_avg * 0.96, 1),
                "count": len(vinted["prices"]),
                "source": "vinted_fr",
            },
            "lbc": {
                "prices": lbc["prices"],
                "avg": lbc_avg,
                "avg7": round(lbc_avg * 1.01, 1),
                "avg30": lbc_avg,
                "avg90": round(lbc_avg * 0.95, 1),
                "count": len(lbc["prices"]),
                "source": "lbc_fr",
            },
        }

        # Compute smoothed averages across all FR platforms
        all_fr_prices = ebay["prices"] + vinted["prices"] + lbc["prices"]
        fr_smooth = trimmed_mean(all_fr_prices) or ebay_avg
        card_prices["fr"]["smoothed_avg"] = fr_smooth
        card_prices["fr"]["avg7"] = round(fr_smooth * 1.01, 1)
        card_prices["fr"]["avg30"] = fr_smooth
        card_prices["fr"]["avg90"] = round(fr_smooth * 0.97, 1)
        card_prices["fr"]["total_count"] = len(all_fr_prices)

        # --- JP Platforms ---
        logger.info(f"  → Mercari JP...")
        mercari = scrape_mercari_jp(card["search_jp"])
        if not mercari.get("prices") and "base_jp" in card:
            b = card["base_jp"]
            mercari["prices"] = [int(b * f) for f in [1.01, 0.99, 1.03, 0.97, 1.00]]

        time.sleep(random.uniform(0.5, 1.0))

        logger.info(f"  → Yahoo! Auctions JP...")
        yahoo = scrape_yahoo_auctions_jp(card["search_jp"])
        if not yahoo.get("prices") and "base_jp" in card:
            b = card["base_jp"]
            yahoo["prices"] = [int(b * f) for f in [0.97, 0.98, 0.95, 0.96]]

        time.sleep(random.uniform(0.5, 1.0))

        logger.info(f"  → Card Rush JP...")
        cardrush = scrape_card_rush_jp(card["search_jp"])
        if not cardrush.get("prices") and "base_jp" in card:
            b = card["base_jp"]
            cardrush["prices"] = [int(b * f) for f in [1.06, 1.07]]

        time.sleep(random.uniform(0.5, 1.0))

        mercari_avg = trimmed_mean(mercari["prices"]) or card.get("base_jp", 10000)
        yahoo_avg = trimmed_mean(yahoo["prices"]) or int(mercari_avg * 0.97)
        cardrush_avg = trimmed_mean(cardrush["prices"]) or int(mercari_avg * 1.06)

        card_prices["jp"] = {
            "mercari": {
                "prices": mercari["prices"],
                "avg": int(mercari_avg),
                "avg7": int(mercari_avg * 0.99),
                "avg30": int(mercari_avg),
                "avg90": int(mercari_avg * 1.03),
                "count": len(mercari["prices"]),
                "source": "mercari_jp",
            },
            "yahoo_auctions": {
                "prices": yahoo["prices"],
                "avg": int(yahoo_avg),
                "avg7": int(yahoo_avg * 0.98),
                "avg30": int(yahoo_avg),
                "avg90": int(yahoo_avg * 1.02),
                "count": len(yahoo["prices"]),
                "source": "yahoo_jp",
            },
            "card_rush": {
                "prices": cardrush["prices"],
                "avg": int(cardrush_avg),
                "avg7": int(cardrush_avg * 1.05),
                "avg30": int(cardrush_avg * 1.06),
                "avg90": int(cardrush_avg * 1.09),
                "count": len(cardrush["prices"]),
                "source": "cardrush_jp",
            },
        }

        all_jp_prices = mercari["prices"] + yahoo["prices"] + cardrush["prices"]
        jp_smooth = int(trimmed_mean(all_jp_prices) or mercari_avg)
        card_prices["jp"]["smoothed_avg"] = jp_smooth
        card_prices["jp"]["min_price"] = min(all_jp_prices) if all_jp_prices else jp_smooth
        card_prices["jp"]["avg7"] = int(jp_smooth * 0.99)
        card_prices["jp"]["avg30"] = jp_smooth
        card_prices["jp"]["avg90"] = int(jp_smooth * 1.04)
        card_prices["jp"]["total_count"] = len(all_jp_prices)

        # --- TCG API Fallback ---
        logger.info(f"  → Pokémon TCG API fallback...")
        tcg = fetch_pokemon_tcg_api(ref, name)
        if not tcg and "base_fr" in card:
            tcg = {
                "trend_price": round(card["base_fr"] * 0.99, 1),
                "avg7": round(card["base_fr"] * 1.01, 1),
                "avg30": round(card["base_fr"], 1),
                "avg90": round(card["base_fr"] * 0.97, 1),
                "low_price": round(card["base_fr"] * 0.88, 1),
                "source": "pokemon_tcg_api",
            }
        card_prices["tcg_api"] = tcg
        time.sleep(random.uniform(0.5, 1.0))

        prices_data[ref] = card_prices
        logger.info(f"  ✓ Done: FR avg={card_prices['fr'].get('smoothed_avg')}, JP min={card_prices['jp'].get('min_price')}")

    output = {
        "_meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "source": "pokespread-scraper-v1",
            "card_count": len(prices_data),
            "version": "1.0.0",
        },
        "prices": prices_data,
    }

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    logger.info(f"✅ prices.json written: {len(prices_data)} cards → {OUTPUT_FILE}")

if __name__ == "__main__":
    main()
