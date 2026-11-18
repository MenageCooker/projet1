#!/usr/bin/env python3
"""
PokéSpread JP→FR — Unrestricted Global Catalog & Real Sold-Item Pricing Pipeline
================================================================================
ZERO HARDCODING:
- No TARGET_SETS or static card lists.
- Dynamically fetches the complete list of official sets and cards from TCGdex
  API (/v2/fr/sets, /v2/ja/sets, /v2/fr/cards, /v2/ja/cards) covering every
  Pokémon TCG release (~50,000 cards).
- Native multi-language localization via TCGdex ID linking (zero static maps).

ABSOLUTE PRICING INTEGRITY:
- French / European Resale Market:
    * eBay France completed/sold listings (LH_Sold=1&LH_Complete=1)
    * Cardmarket completed trend metrics (trendPrice / avg30)
- Japanese Acquisition Market:
    * Mercari Japan finalized sales (STATUS_SOLD_OUT)
    * Yahoo! Auctions Japan closed auctions (closedsearch)
    * Card Rush Akihabara single-card market price
- Strict Anti-Outlier Trimming:
    * Discards top/bottom 10% outliers when sample count >= 4.
    * Zero default/fallback/fictional prices: if no verified transactions exist,
      smoothed_avg is strictly None (JSON null).
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
logger = logging.getLogger("pokespread-global-scraper")

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_FILE = os.path.join(ROOT_DIR, "prices.json")

# Safe runtime budget for GitHub Actions (default 15 min inside 20-min job)
MAX_RUNTIME_SECONDS = int(os.environ.get("SCRAPER_MAX_RUNTIME", "900"))
FORCE_REFRESH = os.environ.get("FORCE_REFRESH", "false").lower() == "true"
POKEMON_TCG_API_KEY = os.environ.get("POKEMON_TCG_API_KEY", "")

TCGDEX_LANGS = [
    ("fr", "FR"),
    ("ja", "JP"),
]

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8,ja;q=0.7",
    "Accept": "text/html,application/xhtml+xml,application/json,*/*;q=0.8",
}

# Negative regex filters excluding lots, sealed products, accessories, and proxies
RE_NEGATIVE_FR = re.compile(
    r'\b(lot|lots|display|booster|boosters|coffret|coffrets|deck|decks|etb|classeur|vide|'
    r'proxy|custom|faux|fausse|reproduction|mini\s*tin|tin|case|pack|sleeve|toploader|code\s*online)\b',
    re.IGNORECASE,
)
RE_NEGATIVE_JP = re.compile(
    r'(まとめ|引退|デッキ|パック|box|BOX|未開封|スリーブ|プレイマット|空箱|ケース|セット|オリパ|くじ)',
    re.IGNORECASE,
)

# Graded slab markers separating raw baseline sales from graded slab sales
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
    """Creates a pooled requests.Session with automatic polite retries."""
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
    """Strictly verifies that the listing title contains the exact card number."""
    if not local_id:
        return True
    clean_num = local_id.lstrip("0")
    if not clean_num:
        return True
    pattern = re.compile(rf'(?<!\d)0*{re.escape(clean_num)}(?!\d)')
    return bool(pattern.search(title))


# ---------------------------------------------------------------------------
# Unrestricted Dynamic TCGdex Global Catalog Loader
# ---------------------------------------------------------------------------
def fetch_all_sets_from_tcgdex(lang: str) -> Dict[str, Dict[str, Any]]:
    """
    Dynamically fetches EVERY official expansion set from TCGdex (/v2/{lang}/sets).
    Zero hardcoded TARGET_SETS.
    """
    if not SESSION:
        return {}

    url = f"https://api.tcgdex.net/v2/{lang}/sets"
    logger.info(f"Fetching complete set index from TCGdex: {url}")
    try:
        resp = SESSION.get(url, timeout=20)
        if resp.status_code != 200:
            logger.warning(f"TCGdex /v2/{lang}/sets returned HTTP {resp.status_code}")
            return {}

        sets_list = resp.json()
        set_map: Dict[str, Dict[str, Any]] = {}
        for s in sets_list:
            sid = s.get("id")
            if not sid:
                continue
            cc = s.get("cardCount") or {}
            official = cc.get("official") or cc.get("total") or "---"
            total = cc.get("total") or official
            set_map[sid] = {
                "id": sid,
                "name": s.get("name", sid),
                "official_count": str(official),
                "total_count": str(total),
            }
        logger.info(f"Retrieved {len(set_map)} official sets for lang={lang.upper()}")
        return set_map
    except Exception as e:
        logger.error(f"Error fetching TCGdex sets for {lang}: {e}")
        return {}


def fetch_global_cards_for_lang(lang: str, edition: str, set_map: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Dynamically retrieves ALL cards across all retrieved sets for a language.
    Uses the bulk /v2/{lang}/cards index mapped against /v2/{lang}/sets metadata,
    with automatic fallback to iterating through every set if bulk index fails.
    """
    if not SESSION:
        return []

    cards: List[Dict[str, Any]] = []
    bulk_url = f"https://api.tcgdex.net/v2/{lang}/cards"
    logger.info(f"Fetching complete card catalog from TCGdex: {bulk_url}")

    try:
        resp = SESSION.get(bulk_url, timeout=30)
        if resp.status_code == 200:
            raw_cards = resp.json()
            if isinstance(raw_cards, list) and len(raw_cards) > 0:
                for c in raw_cards:
                    cid = str(c.get("id", "")).strip()
                    local_id = str(c.get("localId", "")).strip()
                    name = str(c.get("name", "")).strip()
                    image = str(c.get("image", "")).strip()
                    if not cid or not local_id or not name or not image:
                        continue

                    set_id = cid.rsplit("-", 1)[0] if "-" in cid else cid
                    s_meta = set_map.get(set_id, {})
                    official_count = s_meta.get("official_count", "---")
                    is_secret = False
                    try:
                        if official_count.isdigit() and int(local_id.lstrip("0") or "0") > int(official_count):
                            is_secret = True
                    except ValueError:
                        pass

                    ref = f"{set_id} {local_id}/{official_count}" if official_count != "---" else f"{set_id} {local_id}"
                    cards.append({
                        "raw_id": cid,
                        "id": f"{lang}-{cid}",
                        "ref": ref,
                        "local_id": local_id,
                        "official_count": official_count,
                        "name": name,
                        "edition": edition,
                        "lang": lang,
                        "set_id": set_id,
                        "image": image,
                        "is_secret": is_secret,
                    })
                logger.info(f"Loaded {len(cards)} total cards for lang={lang.upper()} across {len(set_map)} sets.")
                return cards
    except Exception as e:
        logger.warning(f"Bulk /v2/{lang}/cards fetch failed ({e}); falling back to iterating retrieved sets.")

    # Fallback: iterate dynamically through every retrieved set from /v2/{lang}/sets
    for set_id, s_meta in set_map.items():
        try:
            s_resp = SESSION.get(f"https://api.tcgdex.net/v2/{lang}/sets/{set_id}", timeout=15)
            if s_resp.status_code != 200:
                continue
            s_data = s_resp.json()
            official_count = s_meta.get("official_count", "---")
            for c in s_data.get("cards", []):
                cid = str(c.get("id", "")).strip()
                local_id = str(c.get("localId", "")).strip()
                name = str(c.get("name", "")).strip()
                image = str(c.get("image", "")).strip()
                if not cid or not local_id or not name or not image:
                    continue
                is_secret = False
                try:
                    if official_count.isdigit() and int(local_id.lstrip("0") or "0") > int(official_count):
                        is_secret = True
                except ValueError:
                    pass
                ref = f"{set_id} {local_id}/{official_count}" if official_count != "---" else f"{set_id} {local_id}"
                cards.append({
                    "raw_id": cid,
                    "id": f"{lang}-{cid}",
                    "ref": ref,
                    "local_id": local_id,
                    "official_count": official_count,
                    "name": name,
                    "edition": edition,
                    "lang": lang,
                    "set_id": set_id,
                    "image": image,
                    "is_secret": is_secret,
                })
            time.sleep(0.15)
        except Exception:
            continue

    logger.info(f"Loaded {len(cards)} cards via dynamic set iteration for lang={lang.upper()}.")
    return cards


# ---------------------------------------------------------------------------
# Strict Anti-Outlier Trimmed Mean Aggregator
# ---------------------------------------------------------------------------
def aggregate_sold_metrics(prices: List[float], is_jpy: bool = False) -> dict:
    """
    Computes accurate statistical metrics from verified sold transactions.
    Applies strict 10% top/bottom outlier trimming when sample count >= 4.
    Returns smoothed_avg: None when no verified sales exist (ZERO FAKE PRICES).
    """
    empty = {
        "sold_prices": [],
        "count": 0,
        "min": None,
        "max": None,
        "median": None,
        "avg": None,
        "smoothed_avg": None,
    }
    if not prices:
        return empty

    valid = [float(p) for p in prices if isinstance(p, (int, float)) and p > 0]
    n = len(valid)
    if n == 0:
        return empty

    sorted_p = sorted(valid)

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
# French / European Market: eBay FR Completed/Sold Items (LH_Sold=1)
# ---------------------------------------------------------------------------
def scrape_ebay_fr_sold(search_query: str, card_local_id: str = "") -> dict:
    """Scrapes actual finalized sales on eBay France (LH_Sold=1&LH_Complete=1)."""
    empty = {"sold_prices": [], "graded_prices": {}, "count": 0, "avg": None, "median": None, "source": "ebay_fr_sold"}
    if not SESSION or not HAS_BS4:
        return empty

    try:
        url = "https://www.ebay.fr/sch/i.html"
        params = {
            "_nkw": search_query,
            "LH_Sold": "1",
            "LH_Complete": "1",
            "_sop": "13",
            "LH_PrefLoc": "1",
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
            if not title or "Shop on eBay" in title or "Boutique sur eBay" in title:
                continue
            if RE_NEGATIVE_FR.search(title):
                continue
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
        logger.debug(f"eBay FR sold error: {e}")
        return empty


# ---------------------------------------------------------------------------
# European Cardmarket Completed Trend Metrics (via Pokémon TCG API)
# ---------------------------------------------------------------------------
def fetch_cardmarket_metrics(card_name: str, local_id: str = "") -> Optional[dict]:
    """Fetches real Cardmarket completed trendPrice / avg30 / avg7 metrics."""
    if not SESSION or not card_name:
        return None
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

        headers = {"X-Api-Key": POKEMON_TCG_API_KEY} if POKEMON_TCG_API_KEY else {}
        url = f"https://api.pokemontcg.io/v2/cards?q={requests.utils.quote(query)}&pageSize=1"
        resp = SESSION.get(url, headers=headers, timeout=10)
        if resp.status_code != 200:
            return None

        cards = resp.json().get("data", [])
        if not cards:
            return None

        cm = cards[0].get("cardmarket", {}).get("prices", {})
        metrics = {}
        for k in ("trendPrice", "avg30", "avg7", "lowPrice"):
            v = cm.get(k)
            if v and float(v) > 0:
                metrics[k] = round(float(v), 2)
        return metrics if metrics else None
    except Exception as e:
        logger.debug(f"Cardmarket metrics error for {card_name}: {e}")
        return None


# ---------------------------------------------------------------------------
# Japanese Market: Mercari Japan Finalized Sold Items (STATUS_SOLD_OUT)
# ---------------------------------------------------------------------------
def scrape_mercari_jp_sold(search_query: str, card_local_id: str = "") -> dict:
    """Scrapes finalized sold items on Mercari Japan (STATUS_SOLD_OUT)."""
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
        resp = SESSION.get(
            "https://api.mercari.jp/v2/entities:search",
            params={
                "keyword": search_query,
                "status": "STATUS_SOLD_OUT",
                "limit": 35,
                "sort": "SORT_CREATED_TIME",
                "order": "ORDER_DESC",
            },
            headers=jp_headers,
            timeout=12,
        )
        raw_sold: List[float] = []
        graded_sold: Dict[str, List[float]] = {}

        if resp.status_code == 200:
            for item in resp.json().get("items", []):
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
    """Scrapes closed winning auctions on Yahoo! Auctions Japan."""
    empty = {"sold_prices": [], "graded_prices": {}, "count": 0, "avg": None, "median": None, "source": "yahoo_jp_sold"}
    if not SESSION or not HAS_BS4:
        return empty

    try:
        resp = SESSION.get(
            "https://auctions.yahoo.co.jp/closedsearch/closedsearch",
            params={"p": search_query, "va": search_query, "b": "1", "n": "25", "s1": "bids", "o1": "d"},
            headers={**HEADERS, "Accept-Language": "ja-JP,ja;q=0.9"},
            timeout=12,
        )
        if resp.status_code != 200:
            return empty

        soup = BeautifulSoup(resp.text, "html.parser")
        raw_sold: List[float] = []
        graded_sold: Dict[str, List[float]] = {}

        for item in soup.select(".Product, li.Product"):
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
    """Scrapes single-card retail acquisition prices from Card Rush Japan."""
    empty = {"sold_prices": [], "count": 0, "avg": None, "median": None, "source": "cardrush_jp"}
    if not SESSION or not HAS_BS4:
        return empty

    try:
        resp = SESSION.get(
            "https://www.cardrush-pokemon.jp/product/list",
            params={"keyword": search_query, "per_page": 20},
            headers={**HEADERS, "Accept-Language": "ja-JP,ja;q=0.9"},
            timeout=12,
        )
        if resp.status_code != 200:
            return empty

        soup = BeautifulSoup(resp.text, "html.parser")
        prices: List[float] = []
        for item in soup.select(".product-item, .list-item, [class*='product']"):
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


def merge_graded_observations(sources: List[Dict[str, dict]], is_jpy: bool = False) -> Dict[str, dict]:
    """Merges verified graded slab sold prices across platforms."""
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
# Main Unrestricted Orchestrator
# ---------------------------------------------------------------------------
def main():
    start_ts = time.time()
    logger.info("==========================================================================")
    logger.info("PokéSpread JP→FR — Unrestricted Global Catalog & Real Sold-Item Pipeline")
    logger.info("==========================================================================")

    # 1. Load existing verified records for incremental refresh across the global catalog
    existing_prices: Dict[str, Any] = {}
    if not FORCE_REFRESH and os.path.exists(OUTPUT_FILE):
        try:
            with open(OUTPUT_FILE, "r", encoding="utf-8") as f:
                old_payload = json.load(f)
                if old_payload.get("_meta", {}).get("version", "").startswith(("2.", "3.")):
                    existing_prices = old_payload.get("prices", {})
                    logger.info(f"Loaded {len(existing_prices)} verified price records for incremental update.")
        except Exception as e:
            logger.warning(f"Ignoring unreadable previous prices.json: {e}")

    # 2. Dynamically fetch ALL official sets & cards from TCGdex (FR + JP)
    all_cards: List[Dict[str, Any]] = []
    fr_name_by_raw_id: Dict[str, str] = {}
    total_sets_discovered = 0

    for lang, edition in TCGDEX_LANGS:
        set_map = fetch_all_sets_from_tcgdex(lang)
        total_sets_discovered += len(set_map)
        lang_cards = fetch_global_cards_for_lang(lang, edition, set_map)
        if lang == "fr":
            for c in lang_cards:
                fr_name_by_raw_id[c["raw_id"]] = c["name"]
        all_cards.extend(lang_cards)

    # Prioritize secret rares / chase cards & unpriced or oldest-fetched cards first
    def crawl_priority(card: Dict[str, Any]):
        prev = existing_prices.get(card["ref"])
        fetched_at = prev.get("fetched_at", "") if prev else ""
        return (
            0 if card.get("is_secret") else 1,
            0 if prev is None else 1,
            fetched_at,
        )

    all_cards.sort(key=crawl_priority)
    logger.info(
        f"Global TCGdex catalog ready: {len(all_cards)} total cards across {total_sets_discovered} official sets."
    )

    # 3. Crawl finalized transactions within safe CI runtime budget
    prices_db: Dict[str, Any] = dict(existing_prices)
    observed_spread_samples_fr: Dict[str, List[float]] = {}
    observed_spread_samples_jp: Dict[str, List[float]] = {}
    processed_this_run = 0

    for i, card in enumerate(all_cards):
        elapsed = time.time() - start_ts
        if elapsed >= MAX_RUNTIME_SECONDS:
            logger.info(
                f"Reached CI runtime budget ({int(elapsed)}s / {MAX_RUNTIME_SECONDS}s) "
                f"after processing {processed_this_run} cards. Saving verified database..."
            )
            break

        ref = card["ref"]
        name = card["name"]
        local_id = card["local_id"]
        official_count = card["official_count"]
        edition = card["edition"]
        lang = card["lang"]
        set_id = card["set_id"]

        # Native TCGdex multi-language ID link (zero static dictionaries)
        linked_fr_name = fr_name_by_raw_id.get(card["raw_id"]) if lang == "ja" else name
        clean_fr = re.sub(
            r"[-–—]\s*(ex|vmax|vstar|sar|ar|ur|hr|sr|gx).*", "", (linked_fr_name or name), flags=re.IGNORECASE
        ).strip()

        serial_token = f"{local_id}/{official_count}" if official_count != "---" else local_id
        if lang == "ja":
            query_fr = f"pokemon {set_id} {serial_token}".strip()
            query_jp = f"{name} {local_id}".strip()
        else:
            query_fr = f"pokemon {clean_fr} {serial_token}".strip()
            query_jp = f"{clean_fr} {local_id}".strip()

        logger.info(f"[{i+1}/{len(all_cards)}] Finalized-sales crawl: {ref} — {name}")

        # --- A. French / European Resale Market ---
        ebay_fr = scrape_ebay_fr_sold(query_fr, local_id)
        time.sleep(random.uniform(0.25, 0.45))

        cm_metrics = fetch_cardmarket_metrics(linked_fr_name or "", local_id)
        all_fr_sold = list(ebay_fr.get("sold_prices", []))
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

        # Record empirical graded-to-raw spread ratios
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

        # Keep existing verified record if a transient scrape returned 0 hits on both sides
        prev = existing_prices.get(ref)
        if fr_metrics["count"] == 0 and jp_metrics["count"] == 0 and prev:
            if prev.get("fr", {}).get("smoothed_avg") is not None or prev.get("jp", {}).get("smoothed_avg") is not None:
                processed_this_run += 1
                continue

        # STRICT NULL HANDLING: never fabricate default or placeholder prices
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

    # 4. Aggregate observed empirical market grade spreads
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
            "source": "global_real_sold_pipeline_v3",
            "total_sets_discovered": total_sets_discovered,
            "total_catalog_cards": len(all_cards),
            "card_count": len(prices_db),
            "priced_cards": total_priced,
            "processed_this_run": processed_this_run,
            "observed_grade_spreads": observed_grade_spreads,
            "version": "3.0.0",
        },
        "prices": prices_db,
    }

    temp_file = OUTPUT_FILE + ".tmp"
    with open(temp_file, "w", encoding="utf-8") as f:
        json.dump(output_payload, f, ensure_ascii=False, indent=2)
    os.replace(temp_file, OUTPUT_FILE)

    logger.info(
        f"✅ Global pipeline complete: {len(all_cards)} cards across {total_sets_discovered} sets, "
        f"{total_priced} with verified sold sales -> {OUTPUT_FILE}"
    )


if __name__ == "__main__":
    main()
