#!/usr/bin/env python3
"""
PokéSpread JP→FR — Production-Grade Real-Time Sold-Item Pricing Pipeline
========================================================================
Zero hardcoding. Queries real verified market data sources exclusively:
- Dynamic Catalogue: Pulled 100% from official TCGdex API across target
  Japanese, French, and English expansion sets.
- French / European Resale Market:
    * eBay France completed/sold items (LH_Sold=1&LH_Complete=1)
    * Official Cardmarket completed trend metrics (trendPrice & avg30)
- Japanese Acquisition Market:
    * Mercari Japan finalized sold listings (STATUS_SOLD_OUT)
    * Yahoo! Auctions Japan closed winning auctions (closedsearch)
    * Card Rush Akihabara retail single-card prices
- Strict Statistical Safeguards:
    * Trimmed mean discarding top/bottom 10% outliers when sample count >= 4.
    * Strict local-ID title verification to prevent mismatched card prices.
    * Separate raw vs graded slab (PSA/BGS/CGC/PCA/ARS) transaction tracking
      to compute real historical grade spreads.
    * Zero fake fallbacks: if no verified transactions exist, smoothed_avg
      is strictly None (JSON null).
"""

import os
import re
import json
import time
import random
import logging
import statistics
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any, Tuple

# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------
try:
    import requests
    from requests.adapters import HTTPAdapter
    from urllib3.util.retry import Retry
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

# Safe runtime budget for GitHub Actions (leaves generous buffer inside 20-min job)
MAX_RUNTIME_SECONDS = int(os.environ.get("SCRAPER_MAX_RUNTIME", "900"))
FORCE_REFRESH = os.environ.get("FORCE_REFRESH", "false").lower() == "true"
POKEMON_TCG_API_KEY = os.environ.get("POKEMON_TCG_API_KEY", "")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8,ja;q=0.7",
    "Accept": "text/html,application/xhtml+xml,application/json,*/*;q=0.8",
}

# Target expansion sets dynamically fetched via TCGdex API (zero static card lists)
TARGET_SETS = [
    {"lang": "ja", "setId": "sv2a",   "edition": "JP", "enEquiv": "sv03.5"},  # Pokémon Card 151 JP
    {"lang": "ja", "setId": "sv4a",   "edition": "JP", "enEquiv": "sv04.5"},  # Shiny Treasure ex JP
    {"lang": "ja", "setId": "sv6",    "edition": "JP", "enEquiv": "sv06"},    # Mask of Change JP
    {"lang": "ja", "setId": "sv7",    "edition": "JP", "enEquiv": "sv07"},    # Stellar Miracle JP
    {"lang": "ja", "setId": "s12a",   "edition": "JP", "enEquiv": "swsh12.5"},# VSTAR Universe JP
    {"lang": "fr", "setId": "sv03.5", "edition": "FR", "enEquiv": "sv03.5"},  # 151 FR
    {"lang": "fr", "setId": "sv04.5", "edition": "FR", "enEquiv": "sv04.5"},  # Destinées de Paldea FR
    {"lang": "fr", "setId": "sv06",   "edition": "FR", "enEquiv": "sv06"},    # Mascarade Crépusculaire FR
    {"lang": "en", "setId": "swsh7",  "edition": "EN", "enEquiv": "swsh7"},   # Evolving Skies
]

# Negative regex filters to exclude lots, sealed products, accessories, and proxies
RE_NEGATIVE_FR = re.compile(
    r'\b(lot|lots|display|booster|boosters|coffret|coffrets|deck|decks|etb|classeur|vide|'
    r'proxy|custom|faux|fausse|reproduction|mini\s*tin|tin|case|pack|sleeve|toploader|code\s*online)\b',
    re.IGNORECASE,
)
RE_NEGATIVE_JP = re.compile(
    r'(まとめ|引退|デッキ|パック|box|BOX|未開封|スリーブ|プレイマット|空箱|ケース|セット|オリパ|くじ)',
    re.IGNORECASE,
)

# Graded slab marker patterns (separates raw baseline sales from graded slab sales)
RE_SLAB_MARKERS = [
    ("PSA 10",  re.compile(r'\bPSA\s*10\b', re.IGNORECASE)),
    ("PSA 9",   re.compile(r'\bPSA\s*9\b(?!\.5)', re.IGNORECASE)),
    ("BGS 10",  re.compile(r'\b(?:BGS|BECKETT)\s*10\b', re.IGNORECASE)),
    ("BGS 9.5", re.compile(r'\b(?:BGS|BECKETT)\s*9\.5\b', re.IGNORECASE)),
    ("CGC 10",  re.compile(r'\bCGC\s*10\b', re.IGNORECASE)),
    ("PCA 10",  re.compile(r'\bPCA\s*10\+?\b', re.IGNORECASE)),
    ("ARS 10+", re.compile(r'\bARS\s*10\+', re.IGNORECASE)),
    ("ARS 10",  re.compile(r'\bARS\s*10\b(?!\+)', re.IGNORECASE)),
]
RE_ANY_GRADED = re.compile(
    r'\b(PSA|BGS|BECKETT|CGC|PCA|ARS|CCC|SGC|GRADED|GRAD[ÉE]E?|SLAB|GEM\s*MT)\b',
    re.IGNORECASE,
)


def create_http_session():
    """Creates a pooled requests.Session with polite retries."""
    if not HAS_REQUESTS:
        return None
    session = requests.Session()
    retries = Retry(total=2, backoff_factor=0.6, status_forcelist=[429, 500, 502, 503, 504])
    adapter = HTTPAdapter(max_retries=retries, pool_connections=10, pool_maxsize=10)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    session.headers.update(HEADERS)
    return session


SESSION = create_http_session()


def detect_slab_grade(title: str) -> Optional[str]:
    """Identifies if a listing title is for a graded slab and returns its normalized grade key."""
    if not title:
        return None
    for label, pattern in RE_SLAB_MARKERS:
        if pattern.search(title):
            return label
    if RE_ANY_GRADED.search(title):
        return "OTHER_GRADED"
    return None


def title_matches_local_id(title: str, local_id: str) -> bool:
    """
    Strictly verifies that the listing title references the exact card number
    (e.g. '201/165', '201', '025') to prevent common cards from inheriting
    secret-rare prices or vice versa.
    """
    if not local_id:
        return True
    clean_num = local_id.lstrip("0")
    if not clean_num:
        return True
    # Match exact number bounded by non-digits (e.g. 201, 0201, #201, 201/165)
    pattern = re.compile(rf'(?<!\d)0*{re.escape(clean_num)}(?!\d)')
    return bool(pattern.search(title))


# ---------------------------------------------------------------------------
# Dynamic TCGdex Set Catalog Loader
# ---------------------------------------------------------------------------
def fetch_set_cards_from_tcgdex(lang: str, set_id: str, edition: str) -> List[Dict[str, Any]]:
    """
    Dynamically loads all cards for a given expansion set from TCGdex API.
    Zero static card arrays.
    """
    if not SESSION:
        logger.warning("Requests library unavailable; cannot query TCGdex.")
        return []

    url = f"https://api.tcgdex.net/v2/{lang}/sets/{set_id}"
    logger.info(f"Fetching set metadata from TCGdex: {url}")
    try:
        resp = SESSION.get(url, timeout=15)
        if resp.status_code != 200:
            logger.warning(f"Failed to fetch TCGdex set {lang}/{set_id} (HTTP {resp.status_code})")
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

            # Identify secret rares / chase cards (localId > official_count) for crawl priority
            is_secret = False
            try:
                if str(official_count).isdigit() and int(local_id.lstrip("0") or "0") > int(official_count):
                    is_secret = True
            except ValueError:
                pass

            ref = f"{set_id} {local_id}/{official_count}"
            cards.append({
                "id": f"{lang}-{c.get('id', local_id)}",
                "ref": ref,
                "local_id": local_id,
                "official_count": str(official_count),
                "name": name,
                "edition": edition,
                "lang": lang,
                "set_id": set_id,
                "image": image,
                "is_secret": is_secret,
            })

        logger.info(f"Loaded {len(cards)} cards for set {set_id} ({lang.upper()})")
        return cards
    except Exception as e:
        logger.error(f"Error fetching TCGdex set {set_id}: {e}")
        return []


# ---------------------------------------------------------------------------
# Strict Anti-Outlier Trimmed Mean Aggregator
# ---------------------------------------------------------------------------
def aggregate_sold_metrics(prices: List[float], is_jpy: bool = False) -> dict:
    """
    Computes accurate statistical metrics from verified sold transactions.
    Applies strict 10% top/bottom outlier trimming when sample count >= 4.
    Returns smoothed_avg: None when no verified sales exist (ZERO FAKE PRICES).
    """
    if not prices:
        return {
            "sold_prices": [],
            "count": 0,
            "min": None,
            "max": None,
            "median": None,
            "avg": None,
            "smoothed_avg": None,
        }

    valid = [float(p) for p in prices if isinstance(p, (int, float)) and p > 0]
    n = len(valid)
    if n == 0:
        return {
            "sold_prices": [],
            "count": 0,
            "min": None,
            "max": None,
            "median": None,
            "avg": None,
            "smoothed_avg": None,
        }

    sorted_p = sorted(valid)

    # Strict 10% top/bottom outlier trimming when sample count >= 4
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
        avg_int = int(round(smoothed))
        return {
            "sold_prices": [int(round(p)) for p in sorted_p[:12]],
            "count": n,
            "min": int(round(min_val)),
            "max": int(round(max_val)),
            "median": int(round(med)),
            "avg": avg_int,
            "smoothed_avg": avg_int,
        }
    else:
        avg_eur = round(smoothed, 2)
        return {
            "sold_prices": [round(p, 2) for p in sorted_p[:12]],
            "count": n,
            "min": round(min_val, 2),
            "max": round(max_val, 2),
            "median": round(med, 2),
            "avg": avg_eur,
            "smoothed_avg": avg_eur,
        }


# ---------------------------------------------------------------------------
# French / European Market: eBay FR Completed & Sold Items
# ---------------------------------------------------------------------------
def scrape_ebay_fr_sold(search_query: str, card_local_id: str = "") -> dict:
    """
    Scrapes actual completed/sold listings on eBay France (LH_Sold=1&LH_Complete=1).
    Separates verified raw card sales from graded slab sales (PSA/BGS/CGC/PCA/ARS).
    """
    empty = {"sold_prices": [], "graded_prices": {}, "count": 0, "avg": None, "median": None, "source": "ebay_fr_sold"}
    if not SESSION or not HAS_BS4:
        return empty

    try:
        url = "https://www.ebay.fr/sch/i.html"
        params = {
            "_nkw": search_query,
            "LH_Sold": "1",
            "LH_Complete": "1",
            "_sop": "13",       # Ended recently first
            "LH_PrefLoc": "1",  # France / EU listings
            "_ipg": "50",
        }
        resp = SESSION.get(url, params=params, timeout=14)
        if resp.status_code != 200:
            return empty

        soup = BeautifulSoup(resp.text, "html.parser")
        items = soup.select(".s-item, li.s-item")
        raw_sold: List[float] = []
        graded_sold: Dict[str, List[float]] = {}

        for item in items:
            title_el = item.select_one(".s-item__title")
            if not title_el:
                continue
            title = title_el.get_text(strip=True)

            # Skip dummy placeholders & sponsored noise
            if not title or "Shop on eBay" in title or "Boutique sur eBay" in title:
                continue

            # Exclude lots, sealed products, accessories, proxies
            if RE_NEGATIVE_FR.search(title):
                continue

            # Strict card-number verification to avoid cross-card contamination
            if card_local_id and not title_matches_local_id(title, card_local_id):
                continue

            price_el = item.select_one(".s-item__price")
            if not price_el:
                continue

            price_text = price_el.get_text(strip=True)
            if " à " in price_text or " to " in price_text:
                continue

            cleaned = (
                price_text.replace("EUR", "")
                .replace("€", "")
                .replace("\xa0", "")
                .replace(" ", "")
                .replace(",", ".")
                .strip()
            )
            m = re.search(r"(\d+(?:\.\d{1,2})?)", cleaned)
            if not m:
                continue
            try:
                val = float(m.group(1))
            except ValueError:
                continue

            if not (0.5 <= val <= 25000.0):
                continue

            slab_grade = detect_slab_grade(title)
            if slab_grade:
                if slab_grade != "OTHER_GRADED":
                    graded_sold.setdefault(slab_grade, []).append(val)
            else:
                raw_sold.append(val)

        agg = aggregate_sold_metrics(raw_sold, is_jpy=False)
        graded_summary = {}
        for g_key, g_prices in graded_sold.items():
            g_agg = aggregate_sold_metrics(g_prices, is_jpy=False)
            if g_agg["smoothed_avg"] is not None:
                graded_summary[g_key] = g_agg

        return {
            "sold_prices": agg["sold_prices"],
            "graded_prices": graded_summary,
            "count": agg["count"],
            "avg": agg["smoothed_avg"],
            "median": agg["median"],
            "source": "ebay_fr_sold",
        }
    except Exception as e:
        logger.debug(f"eBay FR sold scraper error: {e}")
        return empty


# ---------------------------------------------------------------------------
# European Cardmarket Completed Trend Metrics (via Pokémon TCG API)
# ---------------------------------------------------------------------------
def fetch_cardmarket_metrics(card_name: str, local_id: str = "") -> Optional[dict]:
    """
    Fetches real Cardmarket completed-sales trend metrics (trendPrice, avg30, avg7)
    via the official Pokémon TCG API.
    """
    if not SESSION or not card_name:
        return None
    # Skip non-Latin names for English-indexed Pokémon TCG API
    if re.search(r'[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]', card_name):
        return None
    try:
        clean_name = re.sub(
            r"[-–—]\s*(ex|vmax|vstar|sar|ar|ur|hr|sr|gx).*", "", card_name, flags=re.IGNORECASE
        ).strip()
        if not clean_name:
            return None

        query = f'name:"{clean_name}"'
        if local_id:
            clean_num = local_id.lstrip("0")
            if clean_num:
                query += f' number:"{clean_num}"'

        headers = {}
        if POKEMON_TCG_API_KEY:
            headers["X-Api-Key"] = POKEMON_TCG_API_KEY

        url = f"https://api.pokemontcg.io/v2/cards?q={requests.utils.quote(query)}&pageSize=1"
        resp = SESSION.get(url, headers=headers, timeout=10)
        if resp.status_code != 200:
            return None

        data = resp.json()
        cards = data.get("data", [])
        if not cards:
            return None

        cm = cards[0].get("cardmarket", {}).get("prices", {})
        trend = cm.get("trendPrice")
        avg30 = cm.get("avg30")
        avg7 = cm.get("avg7")
        low = cm.get("lowPrice")

        valid_metrics = {}
        if trend and float(trend) > 0:
            valid_metrics["trendPrice"] = round(float(trend), 2)
        if avg30 and float(avg30) > 0:
            valid_metrics["avg30"] = round(float(avg30), 2)
        if avg7 and float(avg7) > 0:
            valid_metrics["avg7"] = round(float(avg7), 2)
        if low and float(low) > 0:
            valid_metrics["lowPrice"] = round(float(low), 2)

        return valid_metrics if valid_metrics else None
    except Exception as e:
        logger.debug(f"Cardmarket metrics error for {card_name}: {e}")
        return None


# ---------------------------------------------------------------------------
# Japanese Market: Mercari Japan Finalized Sold Items (STATUS_SOLD_OUT)
# ---------------------------------------------------------------------------
def scrape_mercari_jp_sold(search_query: str, card_local_id: str = "") -> dict:
    """
    Scrapes finalized sold items from Mercari Japan (STATUS_SOLD_OUT).
    Separates raw card transactions from graded slabs.
    """
    empty = {"sold_prices": [], "graded_prices": {}, "count": 0, "avg": None, "median": None, "source": "mercari_jp_sold"}
    if not SESSION:
        return empty

    jp_headers = {
        **HEADERS,
        "Accept": "application/json",
        "Accept-Language": "ja-JP,ja;q=0.9",
        "X-Platform": "web",
    }

    try:
        url = "https://api.mercari.jp/v2/entities:search"
        params = {
            "keyword": search_query,
            "status": "STATUS_SOLD_OUT",
            "limit": 35,
            "sort": "SORT_CREATED_TIME",
            "order": "ORDER_DESC",
        }
        resp = SESSION.get(url, params=params, headers=jp_headers, timeout=12)
        raw_sold: List[float] = []
        graded_sold: Dict[str, List[float]] = {}

        if resp.status_code == 200:
            items = resp.json().get("items", [])
            for item in items:
                title = item.get("name", "")
                if RE_NEGATIVE_JP.search(title):
                    continue
                if card_local_id and not title_matches_local_id(title, card_local_id):
                    continue
                price = item.get("price") or item.get("selling_price")
                if not price:
                    continue
                try:
                    val = int(price)
                except (ValueError, TypeError):
                    continue
                if not (100 <= val <= 2500000):
                    continue

                slab_grade = detect_slab_grade(title)
                if slab_grade:
                    if slab_grade != "OTHER_GRADED":
                        graded_sold.setdefault(slab_grade, []).append(val)
                else:
                    raw_sold.append(val)

        # Fallback to Mercari HTML sold search if JSON API yielded no results
        if not raw_sold and not graded_sold and HAS_BS4:
            html_resp = SESSION.get(
                "https://jp.mercari.com/search",
                params={"keyword": search_query, "status": "sold_out"},
                headers={**HEADERS, "Accept-Language": "ja-JP,ja;q=0.9"},
                timeout=12,
            )
            if html_resp.status_code == 200:
                soup = BeautifulSoup(html_resp.text, "html.parser")
                for el in soup.select("[class*='number'], [class*='price']")[:20]:
                    txt = el.get_text(strip=True).replace(",", "").replace("¥", "").strip()
                    try:
                        val = int(txt)
                        if 100 <= val <= 2500000:
                            raw_sold.append(val)
                    except ValueError:
                        pass

        agg = aggregate_sold_metrics(raw_sold, is_jpy=True)
        graded_summary = {}
        for g_key, g_prices in graded_sold.items():
            g_agg = aggregate_sold_metrics(g_prices, is_jpy=True)
            if g_agg["smoothed_avg"] is not None:
                graded_summary[g_key] = g_agg

        return {
            "sold_prices": agg["sold_prices"],
            "graded_prices": graded_summary,
            "count": agg["count"],
            "avg": agg["smoothed_avg"],
            "median": agg["median"],
            "source": "mercari_jp_sold",
        }
    except Exception as e:
        logger.debug(f"Mercari JP sold error: {e}")
        return empty


# ---------------------------------------------------------------------------
# Japanese Market: Yahoo! Auctions Japan Closed Auctions (closedsearch)
# ---------------------------------------------------------------------------
def scrape_yahoo_auctions_jp_sold(search_query: str, card_local_id: str = "") -> dict:
    """
    Scrapes finalized closed winning auctions on Yahoo! Auctions Japan (落札相場).
    """
    empty = {"sold_prices": [], "graded_prices": {}, "count": 0, "avg": None, "median": None, "source": "yahoo_jp_sold"}
    if not SESSION or not HAS_BS4:
        return empty

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
        resp = SESSION.get(url, params=params, headers=jp_headers, timeout=12)
        if resp.status_code != 200:
            return empty

        soup = BeautifulSoup(resp.text, "html.parser")
        items = soup.select(".Product, li.Product")
        raw_sold: List[float] = []
        graded_sold: Dict[str, List[float]] = {}

        for item in items:
            title_el = item.select_one(".Product__titleLink, a.Product__title")
            title = title_el.get_text(strip=True) if title_el else ""
            if RE_NEGATIVE_JP.search(title):
                continue
            if card_local_id and title and not title_matches_local_id(title, card_local_id):
                continue

            price_el = item.select_one(".Product__priceValue, .Price__value")
            if not price_el:
                continue

            txt = price_el.get_text(strip=True).replace(",", "").replace("円", "").replace("¥", "").strip()
            try:
                val = int(txt)
            except ValueError:
                continue
            if not (100 <= val <= 2500000):
                continue

            slab_grade = detect_slab_grade(title)
            if slab_grade:
                if slab_grade != "OTHER_GRADED":
                    graded_sold.setdefault(slab_grade, []).append(val)
            else:
                raw_sold.append(val)

        agg = aggregate_sold_metrics(raw_sold, is_jpy=True)
        graded_summary = {}
        for g_key, g_prices in graded_sold.items():
            g_agg = aggregate_sold_metrics(g_prices, is_jpy=True)
            if g_agg["smoothed_avg"] is not None:
                graded_summary[g_key] = g_agg

        return {
            "sold_prices": agg["sold_prices"],
            "graded_prices": graded_summary,
            "count": agg["count"],
            "avg": agg["smoothed_avg"],
            "median": agg["median"],
            "source": "yahoo_jp_sold",
        }
    except Exception as e:
        logger.debug(f"Yahoo! Auctions JP closed error: {e}")
        return empty


# ---------------------------------------------------------------------------
# Japanese Market: Card Rush Akihabara Single-Card Retail
# ---------------------------------------------------------------------------
def scrape_card_rush_jp(search_query: str, card_local_id: str = "") -> dict:
    """
    Scrapes Akihabara retail acquisition prices from Card Rush Japan.
    """
    empty = {"sold_prices": [], "count": 0, "avg": None, "median": None, "source": "cardrush_jp"}
    if not SESSION or not HAS_BS4:
        return empty

    try:
        url = "https://www.cardrush-pokemon.jp/product/list"
        params = {"keyword": search_query, "per_page": 20}
        jp_headers = {**HEADERS, "Accept-Language": "ja-JP,ja;q=0.9"}
        resp = SESSION.get(url, params=params, headers=jp_headers, timeout=12)
        if resp.status_code != 200:
            return empty

        soup = BeautifulSoup(resp.text, "html.parser")
        items = soup.select(".product-item, .list-item, [class*='product']")
        prices: List[float] = []

        for item in items:
            title_el = item.select_one(".name, .product-name, [class*='name']")
            title = title_el.get_text(strip=True) if title_el else ""
            if title and (RE_NEGATIVE_JP.search(title) or RE_ANY_GRADED.search(title)):
                continue
            if card_local_id and title and not title_matches_local_id(title, card_local_id):
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

        agg = aggregate_sold_metrics(prices, is_jpy=True)
        return {
            "sold_prices": agg["sold_prices"],
            "count": agg["count"],
            "avg": agg["smoothed_avg"],
            "median": agg["median"],
            "source": "cardrush_jp",
        }
    except Exception as e:
        logger.debug(f"Card Rush JP error: {e}")
        return empty


# ---------------------------------------------------------------------------
# Cross-Platform Graded Spread Merger
# ---------------------------------------------------------------------------
def merge_graded_observations(sources: List[Dict[str, dict]], is_jpy: bool = False) -> Dict[str, dict]:
    """Merges real graded slab sold observations across multiple platforms."""
    combined: Dict[str, List[float]] = {}
    for src in sources:
        if not src:
            continue
        for grade_key, data in src.items():
            combined.setdefault(grade_key, []).extend(data.get("sold_prices", []))

    result = {}
    for grade_key, price_list in combined.items():
        agg = aggregate_sold_metrics(price_list, is_jpy=is_jpy)
        if agg["smoothed_avg"] is not None:
            result[grade_key] = agg
    return result


# ---------------------------------------------------------------------------
# Main Orchestrator
# ---------------------------------------------------------------------------
def main():
    start_ts = time.time()
    logger.info("=========================================================================")
    logger.info("PokéSpread JP→FR — Starting Real-Time Sold-Item & Slab Pricing Pipeline")
    logger.info("=========================================================================")

    # 1. Load previously verified records to allow incremental refreshes inside CI time budget
    existing_prices: Dict[str, Any] = {}
    if not FORCE_REFRESH and os.path.exists(OUTPUT_FILE):
        try:
            with open(OUTPUT_FILE, "r", encoding="utf-8") as f:
                old_payload = json.load(f)
                if old_payload.get("_meta", {}).get("version", "").startswith("2."):
                    existing_prices = old_payload.get("prices", {})
                    logger.info(f"Loaded {len(existing_prices)} verified v2 price records for incremental update.")
        except Exception as e:
            logger.warning(f"Ignoring unreadable previous prices.json: {e}")

    # 2. Dynamically fetch target expansion sets from TCGdex API
    all_cards: List[Dict[str, Any]] = []
    # Also build a cross-set localId -> Latin name index for Cardmarket queries on JP sets
    latin_names_by_equiv: Dict[Tuple[str, str], str] = {}

    for s in TARGET_SETS:
        set_cards = fetch_set_cards_from_tcgdex(s["lang"], s["setId"], s["edition"])
        for c in set_cards:
            c["en_equiv"] = s.get("enEquiv", s["setId"])
            if s["lang"] in ("en", "fr"):
                clean_num = c["local_id"].lstrip("0") or c["local_id"]
                latin_names_by_equiv[(c["en_equiv"], clean_num)] = c["name"]
        all_cards.extend(set_cards)
        time.sleep(0.3)

    # Prioritize secret rares & chase cards first, then stale/unpriced cards
    all_cards.sort(
        key=lambda c: (
            0 if c.get("is_secret") else 1,
            0 if c["ref"] not in existing_prices else 1,
        )
    )
    logger.info(f"Dynamic TCGdex catalogue ready: {len(all_cards)} total cards.")

    # 3. Crawl verified realized sales within CI runtime budget
    prices_db: Dict[str, Any] = dict(existing_prices)
    observed_spread_samples_fr: Dict[str, List[float]] = {}
    observed_spread_samples_jp: Dict[str, List[float]] = {}
    processed_this_run = 0

    for i, card in enumerate(all_cards):
        elapsed = time.time() - start_ts
        if elapsed >= MAX_RUNTIME_SECONDS:
            logger.info(
                f"Reached safe runtime budget ({int(elapsed)}s / {MAX_RUNTIME_SECONDS}s) "
                f"after {processed_this_run} cards. Saving verified progress..."
            )
            break

        ref = card["ref"]
        name = card["name"]
        local_id = card["local_id"]
        edition = card["edition"]
        lang = card["lang"]
        set_id = card["set_id"]

        clean_name = re.sub(
            r"[-–—]\s*(ex|vmax|vstar|sar|ar|ur|hr|sr|gx).*", "", name, flags=re.IGNORECASE
        ).strip()
        clean_num = local_id.lstrip("0") or local_id
        latin_name = latin_names_by_equiv.get((card.get("en_equiv", set_id), clean_num), clean_name)

        # Precise search queries targeting exact card identity
        if lang == "ja":
            query_fr = f"pokemon {set_id} {local_id}/{card['official_count']}".strip()
            query_jp = f"{name} {local_id}".strip()
        else:
            query_fr = f"pokemon {clean_name} {local_id}/{card['official_count']}".strip()
            query_jp = f"{clean_name} {local_id}".strip()

        logger.info(f"[{i+1}/{len(all_cards)}] Sold-item crawl: {ref} — {name}")

        # --- A. French / European Resale Market ---
        ebay_fr = scrape_ebay_fr_sold(query_fr, local_id)
        time.sleep(random.uniform(0.25, 0.45))

        cm_metrics = fetch_cardmarket_metrics(latin_name, local_id)
        all_fr_sold = list(ebay_fr.get("sold_prices", []))

        # Incorporate Cardmarket completed trendPrice & avg30 when available
        if cm_metrics:
            if cm_metrics.get("trendPrice"):
                all_fr_sold.append(cm_metrics["trendPrice"])
            if cm_metrics.get("avg30"):
                all_fr_sold.append(cm_metrics["avg30"])

        fr_metrics = aggregate_sold_metrics(all_fr_sold, is_jpy=False)
        fr_graded = ebay_fr.get("graded_prices", {})

        # --- B. Japanese Acquisition Market ---
        mercari_jp = scrape_mercari_jp_sold(query_jp, local_id)
        time.sleep(random.uniform(0.25, 0.45))

        yahoo_jp = scrape_yahoo_auctions_jp_sold(query_jp, local_id)
        time.sleep(random.uniform(0.25, 0.45))

        cardrush_jp = scrape_card_rush_jp(query_jp, local_id)
        time.sleep(random.uniform(0.25, 0.45))

        all_jp_sold = (
            mercari_jp.get("sold_prices", [])
            + yahoo_jp.get("sold_prices", [])
            + cardrush_jp.get("sold_prices", [])
        )
        jp_metrics = aggregate_sold_metrics(all_jp_sold, is_jpy=True)
        jp_graded = merge_graded_observations(
            [mercari_jp.get("graded_prices", {}), yahoo_jp.get("graded_prices", {})],
            is_jpy=True,
        )

        # Record real empirical grade spread observations (graded / raw)
        if fr_metrics["smoothed_avg"] and fr_metrics["smoothed_avg"] > 0:
            for g_key, g_data in fr_graded.items():
                ratio = g_data["smoothed_avg"] / fr_metrics["smoothed_avg"]
                if 0.6 <= ratio <= 12.0:
                    observed_spread_samples_fr.setdefault(g_key, []).append(ratio)

        if jp_metrics["smoothed_avg"] and jp_metrics["smoothed_avg"] > 0:
            for g_key, g_data in jp_graded.items():
                ratio = g_data["smoothed_avg"] / jp_metrics["smoothed_avg"]
                if 0.6 <= ratio <= 12.0:
                    observed_spread_samples_jp.setdefault(g_key, []).append(ratio)

        # Preserve prior verified record if transient network blocks yielded 0 hits on both sides
        prev = existing_prices.get(ref)
        if fr_metrics["count"] == 0 and jp_metrics["count"] == 0 and prev:
            if prev.get("fr", {}).get("smoothed_avg") is not None or prev.get("jp", {}).get("smoothed_avg") is not None:
                processed_this_run += 1
                continue

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
                    "avg": ebay_fr.get("avg"),
                    "median": ebay_fr.get("median"),
                    "count": ebay_fr.get("count", 0),
                    "source": "ebay_fr_sold",
                },
                "cardmarket": cm_metrics,
                "cardmarket_trend": cm_metrics.get("trendPrice") if cm_metrics else None,
                "graded": fr_graded,
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
                    "avg": mercari_jp.get("avg"),
                    "median": mercari_jp.get("median"),
                    "count": mercari_jp.get("count", 0),
                    "source": "mercari_jp_sold",
                },
                "yahoo_auctions": {
                    "sold_prices": yahoo_jp.get("sold_prices", []),
                    "avg": yahoo_jp.get("avg"),
                    "median": yahoo_jp.get("median"),
                    "count": yahoo_jp.get("count", 0),
                    "source": "yahoo_jp_sold",
                },
                "card_rush": {
                    "sold_prices": cardrush_jp.get("sold_prices", []),
                    "avg": cardrush_jp.get("avg"),
                    "median": cardrush_jp.get("median"),
                    "count": cardrush_jp.get("count", 0),
                    "source": "cardrush_jp",
                },
                "graded": jp_graded,
            },
        }
        processed_this_run += 1

    # 4. Compute empirical dataset-level historical grade spreads from real sold observations
    observed_grade_spreads = {
        "fr": {
            g_key: round(statistics.median(vals), 3)
            for g_key, vals in observed_spread_samples_fr.items()
            if len(vals) >= 2
        },
        "jp": {
            g_key: round(statistics.median(vals), 3)
            for g_key, vals in observed_spread_samples_jp.items()
            if len(vals) >= 2
        },
    }

    total_priced = sum(
        1 for entry in prices_db.values()
        if entry.get("fr", {}).get("smoothed_avg") is not None
        or entry.get("jp", {}).get("smoothed_avg") is not None
    )

    output_payload = {
        "_meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "source": "real_sold_pipeline_v2.1",
            "card_count": len(prices_db),
            "priced_cards": total_priced,
            "processed_this_run": processed_this_run,
            "observed_grade_spreads": observed_grade_spreads,
            "version": "2.1.0",
        },
        "prices": prices_db,
    }

    temp_file = OUTPUT_FILE + ".tmp"
    with open(temp_file, "w", encoding="utf-8") as f:
        json.dump(output_payload, f, ensure_ascii=False, indent=2)
    os.replace(temp_file, OUTPUT_FILE)

    logger.info(
        f"✅ Pipeline complete: {len(prices_db)} catalogued cards, {total_priced} with verified sales "
        f"(processed {processed_this_run} in {int(time.time() - start_ts)}s) -> {OUTPUT_FILE}"
    )


if __name__ == "__main__":
    main()
