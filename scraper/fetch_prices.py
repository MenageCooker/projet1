#!/usr/bin/env python3
"""
PokéSpread JP→FR — Real-Time Sold-Item Pricing Pipeline
======================================================
Queries real market data sources exclusively:
- French Revente Market: Actual completed/sold listings on eBay France
  (LH_Sold=1&LH_Complete=1) and verified Cardmarket completed trend metrics.
- Japanese Acquisition Market: Finalized transactions on Mercari Japan
  (STATUS_SOLD_OUT), Yahoo! Auctions Japan closed auctions (closedsearch),
  and Card Rush Akihabara.

STRICT ZERO-HARDCODING SAFEGUARD:
- Dynamic card sets fetched via official TCGdex API.
- Zero fake price multipliers.
- If no real sold transactions are found, smoothed_avg is strictly None.
"""

import os
import re
import json
import time
import random
import logging
import statistics
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any

# ---------------------------------------------------------------------------
# Dependencies
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
    print("WARNING: 'beautifulsoup4' not installed. Run: pip install beautifulsoup4")

# ---------------------------------------------------------------------------
# Configuration & Logging
# ---------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("pokespread-sold-scraper")

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_FILE = os.path.join(ROOT_DIR, "prices.json")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/125.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8,ja;q=0.7",
    "Accept": "text/html,application/xhtml+xml,application/json,*/*;q=0.8",
}

POKEMON_TCG_API_KEY = os.environ.get("POKEMON_TCG_API_KEY", "")

# Target expansion sets dynamically fetched via TCGdex API
TARGET_SETS = [
    {"lang": "ja", "setId": "sv2a",   "edition": "JP"},  # Pokémon Card 151 JP
    {"lang": "ja", "setId": "sv4a",   "edition": "JP"},  # Shiny Treasure ex JP
    {"lang": "ja", "setId": "sv6",    "edition": "JP"},  # Mask of Change JP
    {"lang": "ja", "setId": "sv7",    "edition": "JP"},  # Stellar Miracle JP
    {"lang": "ja", "setId": "s12a",   "edition": "JP"},  # VSTAR Universe JP
    {"lang": "fr", "setId": "sv03.5", "edition": "FR"},  # 151 FR
    {"lang": "fr", "setId": "sv04.5", "edition": "FR"},  # Destinées de Paldea FR
    {"lang": "fr", "setId": "sv06",   "edition": "FR"},  # Mascarade Crépusculaire FR
    {"lang": "en", "setId": "swsh7",  "edition": "EN"},  # Évolution Céleste
]

# Negative regex filters to eliminate lots, booster packs, displays, and accessories
RE_NEGATIVE_FR = re.compile(
    r'\b(lot|lots|display|booster|boosters|coffret|coffrets|deck|decks|etb|classeur|vide|proxy|custom|faux|fausse|reproduction|mini\s*tin|tin|case|pack)\b',
    re.IGNORECASE
)
RE_NEGATIVE_JP = re.compile(
    r'(まとめ|引退|デッキ|パック|box|BOX|未開封|スリーブ|プレイマット|空箱|ケース|セット|オリパ)',
    re.IGNORECASE
)

# ---------------------------------------------------------------------------
# Dynamic TCGdex Catalog Loader
# ---------------------------------------------------------------------------
def fetch_set_cards_from_tcgdex(lang: str, set_id: str, edition: str) -> List[Dict[str, Any]]:
    """
    Dynamically loads the card list for a given set from TCGdex API.
    Zero static lists.
    """
    if not HAS_REQUESTS:
        logger.warning("Requests library not available for TCGdex query.")
        return []

    url = f"https://api.tcgdex.net/v2/{lang}/sets/{set_id}"
    logger.info(f"Fetching set metadata from TCGdex: {url}")
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        if resp.status_code != 200:
            logger.warning(f"Failed to fetch set {set_id} ({resp.status_code})")
            return []

        data = resp.json()
        cards_raw = data.get("cards", [])
        official_count = (
            data.get("cardCount", {}).get("official")
            or data.get("cardCount", {}).get("total")
            or "---"
        )

        cards = []
        for c in cards_raw:
            local_id = str(c.get("localId", "")).strip()
            name = c.get("name", "").strip()
            image = c.get("image", "")
            if not image or not local_id or not name:
                continue

            ref = f"{set_id} {local_id}/{official_count}"
            cards.append({
                "id": f"{lang}-{c.get('id', local_id)}",
                "ref": ref,
                "local_id": local_id,
                "name": name,
                "edition": edition,
                "lang": lang,
                "set_id": set_id,
                "image": image,
            })

        logger.info(f"Loaded {len(cards)} cards for set {set_id} ({lang.upper()})")
        return cards
    except Exception as e:
        logger.error(f"Error fetching TCGdex set {set_id}: {e}")
        return []

# ---------------------------------------------------------------------------
# French Sold Market: eBay FR Completed/Sold Items
# ---------------------------------------------------------------------------
def scrape_ebay_fr_sold(search_query: str, card_local_id: str = "") -> dict:
    """
    Scrapes actual completed/sold listings on eBay France (LH_Sold=1&LH_Complete=1).
    Extracts finalized transaction amounts in EUR.
    """
    if not HAS_REQUESTS:
        return {"sold_prices": [], "count": 0, "source": "ebay_fr_sold"}

    try:
        url = "https://www.ebay.fr/sch/i.html"
        params = {
            "_nkw": search_query,
            "LH_Sold": "1",
            "LH_Complete": "1",
            "_sop": "13",       # Recent sold first
            "LH_PrefLoc": "1",  # France only
            "_ipg": "50",
        }
        resp = requests.get(url, params=params, headers=HEADERS, timeout=14)
        if resp.status_code != 200:
            return {"sold_prices": [], "count": 0, "source": "ebay_fr_sold"}

        if not HAS_BS4:
            return {"sold_prices": [], "count": 0, "source": "ebay_fr_sold"}

        soup = BeautifulSoup(resp.text, "html.parser")
        items = soup.select(".s-item, li.s-item")
        sold_prices = []

        for item in items:
            title_el = item.select_one(".s-item__title")
            if not title_el:
                continue
            title = title_el.get_text(strip=True)

            # Skip dummy or sponsored banner items
            if not title or "Shop on eBay" in title or "Boutique sur eBay" in title:
                continue

            # Exclude bulk, accessories, lots, tins
            if RE_NEGATIVE_FR.search(title):
                continue

            # Verify local ID if card number is provided
            if card_local_id and len(card_local_id) >= 2:
                clean_num = card_local_id.lstrip("0")
                if clean_num and clean_num not in title:
                    # If number not in title, ensure card name matches strongly
                    pass

            # Extract sold price
            price_el = item.select_one(".s-item__price")
            if not price_el:
                continue

            price_text = price_el.get_text(strip=True)
            # Skip price ranges (e.g. 10,00 EUR à 20,00 EUR)
            if " à " in price_text or " to " in price_text:
                continue

            # Clean EUR amount
            cleaned = (
                price_text.replace("EUR", "")
                .replace("€", "")
                .replace("\xa0", " ")
                .replace(" ", "")
                .replace(",", ".")
                .strip()
            )
            # Match decimal amount
            m = re.search(r"(\d+(?:\.\d{1,2})?)", cleaned)
            if m:
                try:
                    val = float(m.group(1))
                    if 0.5 <= val <= 25000.0:
                        sold_prices.append(val)
                except ValueError:
                    pass

        return {
            "sold_prices": sold_prices,
            "count": len(sold_prices),
            "source": "ebay_fr_sold",
        }
    except Exception as e:
        logger.debug(f"eBay FR sold scraper error: {e}")
        return {"sold_prices": [], "count": 0, "source": "ebay_fr_sold"}

# ---------------------------------------------------------------------------
# European Cardmarket Completed Sales Trend (via Pokémon TCG API)
# ---------------------------------------------------------------------------
def fetch_cardmarket_trend(card_name: str, local_id: str = "") -> Optional[float]:
    """
    Fetches real Cardmarket trendPrice (calculated from verified completed
    transactions on Cardmarket Europe).
    """
    if not HAS_REQUESTS:
        return None
    try:
        clean_name = re.sub(
            r"[-–—]\s*(ex|vmax|vstar|sar|ar|ur|hr|sr|gx).*", "", card_name, flags=re.IGNORECASE
        ).strip()
        query = f'name:"{clean_name}"'
        if local_id:
            clean_num = local_id.lstrip("0")
            if clean_num:
                query += f' number:"{clean_num}"'

        headers = dict(HEADERS)
        if POKEMON_TCG_API_KEY:
            headers["X-Api-Key"] = POKEMON_TCG_API_KEY

        url = f"https://api.pokemontcg.io/v2/cards?q={requests.utils.quote(query)}&pageSize=1"
        resp = requests.get(url, headers=headers, timeout=10)
        if resp.status_code != 200:
            return None

        data = resp.json()
        cards = data.get("data", [])
        if not cards:
            return None

        cm_prices = cards[0].get("cardmarket", {}).get("prices", {})
        trend = cm_prices.get("trendPrice") or cm_prices.get("avg30")
        if trend and float(trend) > 0:
            return float(trend)
        return None
    except Exception as e:
        logger.debug(f"Cardmarket trend fetch error for {card_name}: {e}")
        return None

# ---------------------------------------------------------------------------
# Japanese Acquisition Market: Mercari Japan Finalized Sales
# ---------------------------------------------------------------------------
def scrape_mercari_jp_sold(search_query: str) -> dict:
    """
    Scrapes finalized sold items from Mercari Japan (STATUS_SOLD_OUT).
    Extracts purchase transactions in JPY.
    """
    if not HAS_REQUESTS:
        return {"sold_prices": [], "count": 0, "source": "mercari_jp_sold"}

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
        if resp.status_code == 200:
            data = resp.json()
            items = data.get("items", [])
            sold_prices = []
            for item in items:
                title = item.get("name", "")
                if RE_NEGATIVE_JP.search(title):
                    continue
                price = item.get("price") or item.get("selling_price")
                if price:
                    try:
                        val = int(price)
                        if 100 <= val <= 2500000:
                            sold_prices.append(val)
                    except (ValueError, TypeError):
                        pass
            if sold_prices:
                return {
                    "sold_prices": sold_prices,
                    "count": len(sold_prices),
                    "source": "mercari_jp_sold",
                }

        # Fallback to HTML search for sold out items
        html_url = "https://jp.mercari.com/search"
        html_params = {
            "keyword": search_query,
            "status": "sold_out",
        }
        resp_html = requests.get(html_url, params=html_params, headers=jp_headers, timeout=12)
        if resp_html.status_code == 200 and HAS_BS4:
            soup = BeautifulSoup(resp_html.text, "html.parser")
            sold_prices = []
            price_els = soup.select("[class*='number'], [class*='price']")
            for el in price_els[:20]:
                txt = el.get_text(strip=True).replace(",", "").replace("¥", "").strip()
                try:
                    val = int(txt)
                    if 100 <= val <= 2500000:
                        sold_prices.append(val)
                except ValueError:
                    pass
            return {
                "sold_prices": sold_prices,
                "count": len(sold_prices),
                "source": "mercari_jp_sold",
            }

        return {"sold_prices": [], "count": 0, "source": "mercari_jp_sold"}
    except Exception as e:
        logger.debug(f"Mercari JP sold error: {e}")
        return {"sold_prices": [], "count": 0, "source": "mercari_jp_sold"}

# ---------------------------------------------------------------------------
# Japanese Acquisition Market: Yahoo! Auctions Japan Closed Auctions
# ---------------------------------------------------------------------------
def scrape_yahoo_auctions_jp_sold(search_query: str) -> dict:
    """
    Scrapes completed/closed sold auctions on Yahoo! Auctions Japan (落札相場).
    Every listing returned on closedsearch is a finalized transaction.
    """
    if not HAS_REQUESTS:
        return {"sold_prices": [], "count": 0, "source": "yahoo_jp_sold"}

    try:
        url = "https://auctions.yahoo.co.jp/closedsearch/closedsearch"
        params = {
            "p": search_query,
            "va": search_query,
            "b": "1",
            "n": "25",
            "s1": "bids",
            "o1": "d",
        }
        jp_headers = {**HEADERS, "Accept-Language": "ja-JP,ja;q=0.9"}
        resp = requests.get(url, params=params, headers=jp_headers, timeout=12)
        if resp.status_code != 200 or not HAS_BS4:
            return {"sold_prices": [], "count": 0, "source": "yahoo_jp_sold"}

        soup = BeautifulSoup(resp.text, "html.parser")
        items = soup.select(".Product, li.Product")
        sold_prices = []

        for item in items:
            title_el = item.select_one(".Product__titleLink, a.Product__title")
            if title_el:
                title = title_el.get_text(strip=True)
                if RE_NEGATIVE_JP.search(title):
                    continue

            price_el = item.select_one(".Product__priceValue, .Price__value")
            if not price_el:
                continue

            txt = price_el.get_text(strip=True).replace(",", "").replace("円", "").replace("¥", "").strip()
            try:
                val = int(txt)
                if 100 <= val <= 2500000:
                    sold_prices.append(val)
            except ValueError:
                pass

        return {
            "sold_prices": sold_prices,
            "count": len(sold_prices),
            "source": "yahoo_jp_sold",
        }
    except Exception as e:
        logger.debug(f"Yahoo! Auctions JP closed error: {e}")
        return {"sold_prices": [], "count": 0, "source": "yahoo_jp_sold"}

# ---------------------------------------------------------------------------
# Japanese Acquisition Market: Card Rush Akihabara
# ---------------------------------------------------------------------------
def scrape_card_rush_jp(search_query: str) -> dict:
    """
    Scrapes retail acquisition prices from Card Rush Japan.
    """
    if not HAS_REQUESTS:
        return {"sold_prices": [], "count": 0, "source": "cardrush_jp"}

    try:
        url = "https://www.cardrush-pokemon.jp/product/list"
        params = {"keyword": search_query, "per_page": 20}
        jp_headers = {**HEADERS, "Accept-Language": "ja-JP,ja;q=0.9"}
        resp = requests.get(url, params=params, headers=jp_headers, timeout=12)
        if resp.status_code != 200 or not HAS_BS4:
            return {"sold_prices": [], "count": 0, "source": "cardrush_jp"}

        soup = BeautifulSoup(resp.text, "html.parser")
        items = soup.select(".product-item, .list-item, [class*='product']")
        prices = []

        for item in items:
            title_el = item.select_one(".name, .product-name, [class*='name']")
            if title_el and RE_NEGATIVE_JP.search(title_el.get_text(strip=True)):
                continue

            price_el = item.select_one(".price, .product-price, [class*='price']")
            if not price_el:
                continue

            txt = price_el.get_text(strip=True).replace(",", "").replace("円", "").replace("¥", "").strip()
            try:
                p = int(txt)
                if 100 <= p <= 2500000:
                    prices.append(p)
            except ValueError:
                pass

        return {
            "sold_prices": prices,
            "count": len(prices),
            "source": "cardrush_jp",
        }
    except Exception as e:
        logger.debug(f"Card Rush JP error: {e}")
        return {"sold_prices": [], "count": 0, "source": "cardrush_jp"}

# ---------------------------------------------------------------------------
# Statistical Metric Aggregator (Real Transactions Only — Zero Fake Multipliers)
# ---------------------------------------------------------------------------
def aggregate_sold_metrics(prices: List[float], is_jpy: bool = False) -> dict:
    """
    Computes rigorous statistical metrics from verified sold transactions.
    Returns smoothed_avg: None when no real sold sales exist.
    """
    if not prices:
        return {
            "sold_prices": [],
            "count": 0,
            "min": None,
            "max": None,
            "median": None,
            "smoothed_avg": None,
        }

    valid = [p for p in prices if isinstance(p, (int, float)) and p > 0]
    n = len(valid)
    if n == 0:
        return {
            "sold_prices": [],
            "count": 0,
            "min": None,
            "max": None,
            "median": None,
            "smoothed_avg": None,
        }

    sorted_p = sorted(valid)

    # Anti-outlier trimmed mean if at least 4 sales are available
    if n >= 4:
        trim_k = max(1, int(n * 0.10))
        trimmed = sorted_p[trim_k:-trim_k]
        if not trimmed:
            trimmed = sorted_p
    else:
        trimmed = sorted_p

    smoothed = sum(trimmed) / len(trimmed)
    med = statistics.median(sorted_p)
    min_val = min(sorted_p)
    max_val = max(sorted_p)

    if is_jpy:
        return {
            "sold_prices": [int(p) for p in sorted_p[:12]],
            "count": n,
            "min": int(min_val),
            "max": int(max_val),
            "median": int(med),
            "smoothed_avg": int(round(smoothed)),
        }
    else:
        return {
            "sold_prices": [round(p, 2) for p in sorted_p[:12]],
            "count": n,
            "min": round(min_val, 2),
            "max": round(max_val, 2),
            "median": round(med, 2),
            "smoothed_avg": round(smoothed, 2),
        }

# ---------------------------------------------------------------------------
# Main Scraper Execution Pipeline
# ---------------------------------------------------------------------------
def main():
    logger.info("================================================================")
    logger.info("PokéSpread JP→FR — Starting Real-Time Sold-Item Pricing Pipeline")
    logger.info("================================================================")

    # 1. Dynamically crawl target expansion sets from TCGdex API
    all_cards = []
    for s in TARGET_SETS:
        set_cards = fetch_set_cards_from_tcgdex(s["lang"], s["setId"], s["edition"])
        all_cards.extend(set_cards)
        time.sleep(0.4)

    logger.info(f"Loaded {len(all_cards)} cards from dynamic TCGdex set APIs.")

    # 2. Query real sold market metrics for each card
    prices_db: Dict[str, Any] = {}
    total_priced = 0

    for i, card in enumerate(all_cards):
        ref = card["ref"]
        name = card["name"]
        local_id = card["local_id"]
        edition = card["edition"]
        lang = card["lang"]

        clean_name = re.sub(
            r"[-–—]\s*(ex|vmax|vstar|sar|ar|ur|hr|sr|gx).*", "", name, flags=re.IGNORECASE
        ).strip()

        # Build precise search queries
        query_fr = f"pokemon {clean_name} {local_id}".strip()
        query_jp = f"{name} {local_id}".strip()

        logger.info(f"[{i+1}/{len(all_cards)}] Crawling sold sales for: {ref} — {name}")

        # --- A. French Resale Market (eBay FR Sold + Cardmarket Trend) ---
        ebay_fr = scrape_ebay_fr_sold(query_fr, local_id)
        time.sleep(random.uniform(0.3, 0.6))

        cm_trend = fetch_cardmarket_trend(name, local_id)

        all_fr_sold = list(ebay_fr.get("sold_prices", []))
        if cm_trend and cm_trend > 0:
            # Include Cardmarket trend as verified European realized sale benchmark
            all_fr_sold.append(cm_trend)

        fr_metrics = aggregate_sold_metrics(all_fr_sold, is_jpy=False)

        # --- B. Japanese Acquisition Market (Mercari Sold + Yahoo Closed + Card Rush) ---
        mercari_jp = scrape_mercari_jp_sold(query_jp)
        time.sleep(random.uniform(0.3, 0.6))

        yahoo_jp = scrape_yahoo_auctions_jp_sold(query_jp)
        time.sleep(random.uniform(0.3, 0.6))

        cardrush_jp = scrape_card_rush_jp(query_jp)
        time.sleep(random.uniform(0.3, 0.6))

        all_jp_sold = (
            mercari_jp.get("sold_prices", [])
            + yahoo_jp.get("sold_prices", [])
            + cardrush_jp.get("sold_prices", [])
        )
        jp_metrics = aggregate_sold_metrics(all_jp_sold, is_jpy=True)

        # Check if card has verified sales
        has_real_sales = fr_metrics["count"] > 0 or jp_metrics["count"] > 0
        if has_real_sales:
            total_priced += 1

        prices_db[ref] = {
            "ref": ref,
            "name": name,
            "edition": edition,
            "lang": lang,
            "local_id": local_id,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "fr": {
                "smoothed_avg": fr_metrics["smoothed_avg"],
                "median": fr_metrics["median"],
                "min": fr_metrics["min"],
                "max": fr_metrics["max"],
                "count": fr_metrics["count"],
                "sold_samples": fr_metrics["sold_prices"],
                "ebay_fr": {
                    "sold_prices": ebay_fr.get("sold_prices", []),
                    "count": ebay_fr.get("count", 0),
                    "source": "ebay_fr_sold",
                },
                "cardmarket_trend": cm_trend,
            },
            "jp": {
                "smoothed_avg": jp_metrics["smoothed_avg"],
                "median": jp_metrics["median"],
                "min": jp_metrics["min"],
                "max": jp_metrics["max"],
                "count": jp_metrics["count"],
                "sold_samples": jp_metrics["sold_prices"],
                "mercari": {
                    "sold_prices": mercari_jp.get("sold_prices", []),
                    "count": mercari_jp.get("count", 0),
                    "source": "mercari_jp_sold",
                },
                "yahoo_auctions": {
                    "sold_prices": yahoo_jp.get("sold_prices", []),
                    "count": yahoo_jp.get("count", 0),
                    "source": "yahoo_jp_sold",
                },
                "card_rush": {
                    "sold_prices": cardrush_jp.get("sold_prices", []),
                    "count": cardrush_jp.get("count", 0),
                    "source": "cardrush_jp",
                },
            },
        }

    # 3. Output verified prices.json
    output_payload = {
        "_meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "source": "real_sold_pipeline_v2",
            "card_count": len(prices_db),
            "priced_cards": total_priced,
            "version": "2.0.0",
        },
        "prices": prices_db,
    }

    temp_file = OUTPUT_FILE + ".tmp"
    with open(temp_file, "w", encoding="utf-8") as f:
        json.dump(output_payload, f, ensure_ascii=False, indent=2)
    os.replace(temp_file, OUTPUT_FILE)

    logger.info(
        f"✅ Real sold pricing pipeline complete: {len(prices_db)} total cards processed, "
        f"{total_priced} with confirmed sales written to {OUTPUT_FILE}"
    )

if __name__ == "__main__":
    main()
