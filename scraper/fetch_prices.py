#!/usr/bin/env python3
"""
PokéSpread JP→FR — High-Value Arbitrage Price Pipeline & Market Scraper
========================================================================
OPTIMIZED ARBITRAGE ARCHITECTURE:
1. High-Value / Chase Cards Prioritization:
   - Filters and prioritizes cards so CI runtime is 100% focused on profitable targets.
   - All Secret Rares (local_id > official_count).
   - All Ultra Rares & Chase cards matching: ex, VMAX, VSTAR, V, GX, EX, SAR,
     SR, UR, AR, CHR, CSR, Shiny, Radiant, Mega, etc.
   - Sorted by newest sets first (SV, SWSH, SM...) for maximal arbitrage liquidity.

2. Reliable European & International Pricing (Cardmarket & TCGplayer via Pokémon TCG API):
   - Dynamically indexes English card names from TCGdex (/v2/en/cards) mapped
     by raw_id (e.g. 'xy4-120' -> 'Manectric-EX', 'sv2a-201' -> 'Charizard ex').
   - Resolves real Cardmarket trendPrice, avg30, and avg7 in EUR.
   - Extracts secondary TCGplayer market prices (USD) benchmark.

3. Anti-Bot Circuit Breakers & Concurrency:
   - Automatic circuit breaker (disables a scraper after 8 consecutive zero-item/blocked hits).
   - ThreadPoolExecutor(max_workers=6) with thread-local HTTP sessions and polite pacing.
   - Incremental atomic checkpoint saves preserving previous verified records.
   - Strict safeguard: Zero fabricated fallback prices. Real sales or null.
"""

import os
import re
import json
import time
import random
import logging
import statistics
import threading
import concurrent.futures
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
logger = logging.getLogger("pokespread-scraper")

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_FILE = os.path.join(ROOT_DIR, "prices.json")

# Safe runtime budget for GitHub Actions (default 15 min inside 20-min job)
MAX_RUNTIME_SECONDS = int(os.environ.get("SCRAPER_MAX_RUNTIME", "900"))
MAX_WORKERS = int(os.environ.get("SCRAPER_MAX_WORKERS", "6"))
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

# Chase / High-value card identification regex
RE_CHASE_KEYWORDS = re.compile(
    r'(?:^|[^\w])(ex|vmax|vstar|gx|sar|sr|ur|ar|chr|csr|shiny|radiant|radieux|mega|prime|legend|level\s*x|lv\.x|gold|rainbow)(?:[^\w]|$)|'
    r'(?:^|[^\w])v(?:[^\w]|$)|'
    r'[-–—]\s*(ex|vmax|vstar|v|gx|sar|sr|ur|ar|chr|csr)\b|'
    r'(?:^|\s)M\s+[A-Z]|'
    r'(?:メガ|かがやく|プロモ|マスターボール)',
    re.IGNORECASE,
)

# ---------------------------------------------------------------------------
# Thread-Safe State & Session Management + Circuit Breakers
# ---------------------------------------------------------------------------
_thread_local = threading.local()
db_lock = threading.Lock()
anti_bot_lock = threading.Lock()
save_lock = threading.Lock()

CIRCUIT_BREAKER_THRESHOLD = 8

CIRCUIT_BREAKERS: Dict[str, Dict[str, Any]] = {
    "ebay_fr": {"consecutive_zeros": 0, "tripped": False},
    "mercari_jp": {"consecutive_zeros": 0, "tripped": False},
    "yahoo_jp": {"consecutive_zeros": 0, "tripped": False},
    "cardrush_jp": {"consecutive_zeros": 0, "tripped": False},
}


def create_http_session() -> Optional[requests.Session]:
    """Creates a pooled requests.Session with automatic polite retries."""
    if not HAS_REQUESTS:
        return None
    session = requests.Session()
    retries = Retry(total=2, backoff_factor=0.6, status_forcelist=[429, 500, 502, 503, 504])
    adapter = HTTPAdapter(max_retries=retries, pool_connections=15, pool_maxsize=15)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    session.headers.update(HEADERS)
    return session


def get_thread_session() -> Optional[requests.Session]:
    """Returns a thread-local HTTP session ensuring socket thread-safety."""
    if not HAS_REQUESTS:
        return None
    if not hasattr(_thread_local, "session") or _thread_local.session is None:
        _thread_local.session = create_http_session()
    return _thread_local.session


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
# Chase / High-Value Filter & Era Ranking
# ---------------------------------------------------------------------------
def is_chase_card(card: Dict[str, Any], en_name: str = "") -> bool:
    """Identifies high-value arbitrage cards (Ultra Rares, Secrets, Alt Arts, Graded Targets)."""
    if card.get("is_secret"):
        return True
    local_id = str(card.get("local_id", "")).strip().upper()
    if any(local_id.startswith(pfx) for pfx in ("TG", "GG", "SV", "SWSH", "SVP", "PROMO", "RC")):
        return True
    for text in (card.get("name", ""), en_name):
        if text and RE_CHASE_KEYWORDS.search(text):
            return True
    return False


def get_set_era_rank(set_id: str) -> int:
    """Ranks Pokémon TCG eras newest to oldest for optimal liquidity."""
    sid = str(set_id).lower()
    if sid.startswith("sv"):       # Scarlet & Violet (2023 - present)
        return 0
    if sid.startswith("swsh"):     # Sword & Shield (2020 - 2023)
        return 1
    if sid.startswith("sm"):       # Sun & Moon (2017 - 2019)
        return 2
    if sid.startswith("xy"):       # XY (2014 - 2016)
        return 3
    if sid.startswith("bw"):       # Black & White (2011 - 2013)
        return 4
    if sid.startswith(("dp", "pt", "hgss")):  # Diamond/Pearl/Platinum/HGSS (2007 - 2010)
        return 5
    if sid.startswith("ex"):       # EX series (2003 - 2007)
        return 6
    if sid.startswith(("base", "neo", "ecard", "gym", "col")):  # Vintage (1996 - 2002)
        return 7
    return 8


# ---------------------------------------------------------------------------
# Dynamic TCGdex Global Catalog & English Card Mapping
# ---------------------------------------------------------------------------
def fetch_all_sets_from_tcgdex(lang: str, session: Optional[requests.Session] = None) -> Dict[str, Dict[str, Any]]:
    """
    Dynamically fetches EVERY official expansion set from TCGdex (/v2/{lang}/sets).
    Zero hardcoded TARGET_SETS.
    """
    sess = session or SESSION
    if not sess:
        return {}

    url = f"https://api.tcgdex.net/v2/{lang}/sets"
    logger.info(f"Fetching complete set index from TCGdex: {url}")
    try:
        resp = sess.get(url, timeout=20)
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


def fetch_tcgdex_en_cards(session: Optional[requests.Session] = None) -> Dict[str, str]:
    """
    Fetches the English card catalog from TCGdex (/v2/en/cards)
    to build an exact mapping: raw_id -> en_name (e.g. 'xy4-120' -> 'Manectric-EX').
    Allows querying api.pokemontcg.io with accurate English names for Cardmarket data.
    """
    sess = session or SESSION
    if not sess:
        return {}

    url = "https://api.tcgdex.net/v2/en/cards"
    logger.info(f"Fetching English card catalog for Cardmarket mapping: {url}")
    try:
        resp = sess.get(url, timeout=30)
        if resp.status_code == 200:
            raw_cards = resp.json()
            en_map: Dict[str, str] = {}
            for c in raw_cards:
                cid = str(c.get("id", "")).strip()
                name = str(c.get("name", "")).strip()
                if cid and name:
                    en_map[cid] = name
            logger.info(f"Loaded {len(en_map)} English card name mappings from TCGdex.")
            return en_map
        logger.warning(f"TCGdex /v2/en/cards returned HTTP {resp.status_code}")
    except Exception as e:
        logger.warning(f"Could not load English cards from TCGdex: {e}")
    return {}


def fetch_global_cards_for_lang(
    lang: str,
    edition: str,
    set_map: Dict[str, Dict[str, Any]],
    session: Optional[requests.Session] = None,
) -> List[Dict[str, Any]]:
    """
    Dynamically retrieves ALL cards across all retrieved sets for a language.
    Uses the bulk /v2/{lang}/cards index mapped against /v2/{lang}/sets metadata.
    """
    sess = session or SESSION
    if not sess:
        return []

    cards: List[Dict[str, Any]] = []
    bulk_url = f"https://api.tcgdex.net/v2/{lang}/cards"
    logger.info(f"Fetching complete card catalog from TCGdex: {bulk_url}")

    try:
        resp = sess.get(bulk_url, timeout=30)
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
        logger.warning(f"Bulk /v2/{lang}/cards fetch failed ({e}); falling back to set iteration.")

    # Fallback: iterate dynamically through every retrieved set from /v2/{lang}/sets
    for set_id, s_meta in set_map.items():
        try:
            s_resp = sess.get(f"https://api.tcgdex.net/v2/{lang}/sets/{set_id}", timeout=15)
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
            time.sleep(0.10)
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
def scrape_ebay_fr_sold(
    search_query: str,
    card_local_id: str = "",
    session: Optional[requests.Session] = None,
) -> dict:
    """Scrapes actual finalized sales on eBay France (LH_Sold=1&LH_Complete=1)."""
    empty = {"sold_prices": [], "graded_prices": {}, "count": 0, "avg": None, "median": None, "source": "ebay_fr_sold"}
    if CIRCUIT_BREAKERS["ebay_fr"]["tripped"]:
        return empty

    sess = session or get_thread_session()
    if not sess or not HAS_BS4:
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
        resp = sess.get(url, params=params, timeout=12)
        if resp.status_code != 200:
            with anti_bot_lock:
                cb = CIRCUIT_BREAKERS["ebay_fr"]
                cb["consecutive_zeros"] += 1
                if not cb["tripped"] and cb["consecutive_zeros"] >= CIRCUIT_BREAKER_THRESHOLD:
                    cb["tripped"] = True
                    logger.warning(
                        f"⚡ [CIRCUIT BREAKER] eBay FR disabled for remainder of run "
                        f"({cb['consecutive_zeros']} consecutive error/empty responses / IP block)."
                    )
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

        with anti_bot_lock:
            cb = CIRCUIT_BREAKERS["ebay_fr"]
            if agg["count"] > 0:
                cb["consecutive_zeros"] = 0
            else:
                cb["consecutive_zeros"] += 1
                if not cb["tripped"] and cb["consecutive_zeros"] >= CIRCUIT_BREAKER_THRESHOLD:
                    cb["tripped"] = True
                    logger.warning(
                        f"⚡ [CIRCUIT BREAKER] eBay FR disabled for remainder of run "
                        f"({cb['consecutive_zeros']} consecutive zero-item responses / possible IP block)."
                    )

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
        with anti_bot_lock:
            cb = CIRCUIT_BREAKERS["ebay_fr"]
            cb["consecutive_zeros"] += 1
            if not cb["tripped"] and cb["consecutive_zeros"] >= CIRCUIT_BREAKER_THRESHOLD:
                cb["tripped"] = True
                logger.warning(
                    f"⚡ [CIRCUIT BREAKER] eBay FR disabled for remainder of run "
                    f"({cb['consecutive_zeros']} consecutive errors / possible IP block)."
                )
        return empty


# ---------------------------------------------------------------------------
# European Cardmarket & TCGplayer Completed Metrics (via Pokémon TCG API)
# ---------------------------------------------------------------------------
def fetch_cardmarket_metrics(
    card_name: str,
    local_id: str = "",
    en_name: str = "",
    set_id: str = "",
    session: Optional[requests.Session] = None,
) -> Optional[dict]:
    """
    Fetches real Cardmarket completed trendPrice / avg30 / avg7 metrics via api.pokemontcg.io.
    Also extracts secondary TCGplayer market prices (USD) benchmark from the exact same response.
    Reliable anti-bot-free pricing source.
    """
    sess = session or get_thread_session()
    if not sess:
        return None

    # Priority target: English name if available, otherwise card_name if latin
    target_name = en_name.strip() if en_name else card_name.strip()
    if not target_name or re.search(r'[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]', target_name):
        target_name = ""

    clean_num = local_id.lstrip("0") if local_id else ""
    if not clean_num and local_id:
        clean_num = local_id.strip()

    # Build queries to try in priority order
    queries_to_try: List[str] = []

    if target_name and clean_num:
        safe_name = target_name.replace('"', '').strip()
        queries_to_try.append(f'name:"{safe_name}" number:"{clean_num}"')

        # Base name without suffix (ex, vmax, vstar, v, gx, sar, etc.)
        base_name = re.sub(
            r'[-–—]?\s*(ex|vmax|vstar|v|gx|sar|sr|ur|ar|chr|csr|radiant|radieux).*',
            '',
            safe_name,
            flags=re.IGNORECASE,
        ).strip()
        if base_name and base_name.lower() != safe_name.lower():
            queries_to_try.append(f'name:"{base_name}" number:"{clean_num}"')

    if target_name and not queries_to_try:
        safe_name = target_name.replace('"', '').strip()
        queries_to_try.append(f'name:"{safe_name}"')

    if not queries_to_try and clean_num:
        queries_to_try.append(f'number:"{clean_num}"')

    headers = {"X-Api-Key": POKEMON_TCG_API_KEY} if POKEMON_TCG_API_KEY else {}

    for q in queries_to_try:
        try:
            url = f"https://api.pokemontcg.io/v2/cards?q={requests.utils.quote(q)}&pageSize=5"
            resp = sess.get(url, headers=headers, timeout=10)
            if resp.status_code == 429:
                time.sleep(1.0)
                continue
            if resp.status_code != 200:
                continue

            cards_data = resp.json().get("data", [])
            if not cards_data:
                continue

            best_card = None
            if len(cards_data) == 1:
                best_card = cards_data[0]
            else:
                for c in cards_data:
                    c_num = str(c.get("number", "")).lstrip("0")
                    if clean_num and c_num == clean_num:
                        best_card = c
                        break
                if not best_card:
                    best_card = cards_data[0]

            # 1. Extract Cardmarket prices (EUR)
            cm = best_card.get("cardmarket", {}).get("prices", {})
            cm_metrics = {}
            for k in ("trendPrice", "avg30", "avg7", "avg1", "lowPrice", "averageSellPrice", "reverseHoloTrend"):
                v = cm.get(k)
                if v is not None:
                    try:
                        fv = float(v)
                        if fv > 0:
                            cm_metrics[k] = round(fv, 2)
                    except (ValueError, TypeError):
                        pass

            # 2. Extract TCGplayer prices (USD) as secondary verified market benchmark
            tcg_obj = best_card.get("tcgplayer", {}).get("prices", {})
            tcg_metrics = {}
            primary_usd = None
            if isinstance(tcg_obj, dict):
                for r_key, p_dict in tcg_obj.items():
                    if isinstance(p_dict, dict):
                        m_val = p_dict.get("market") or p_dict.get("mid")
                        if m_val is not None:
                            try:
                                fm = float(m_val)
                                if fm > 0:
                                    tcg_metrics[r_key] = {
                                        "market": round(fm, 2),
                                        "low": round(float(p_dict.get("low", 0)), 2) if p_dict.get("low") else None,
                                        "mid": round(float(p_dict.get("mid", 0)), 2) if p_dict.get("mid") else None,
                                    }
                                    if primary_usd is None:
                                        primary_usd = round(fm, 2)
                            except (ValueError, TypeError):
                                pass

            if cm_metrics or tcg_metrics:
                return {
                    "cardmarket": cm_metrics if cm_metrics else None,
                    "tcgplayer": tcg_metrics if tcg_metrics else None,
                    "trendPrice": cm_metrics.get("trendPrice") if cm_metrics else None,
                    "avg30": cm_metrics.get("avg30") if cm_metrics else None,
                    "avg7": cm_metrics.get("avg7") if cm_metrics else None,
                    "tcgplayer_usd": primary_usd,
                }
        except Exception as e:
            logger.debug(f"Cardmarket query error for '{q}': {e}")
            continue

    return None


# ---------------------------------------------------------------------------
# Japanese Market: Mercari Japan Finalized Sold Items (STATUS_SOLD_OUT)
# ---------------------------------------------------------------------------
def scrape_mercari_jp_sold(
    search_query: str,
    card_local_id: str = "",
    session: Optional[requests.Session] = None,
) -> dict:
    """Scrapes finalized sold items on Mercari Japan (STATUS_SOLD_OUT)."""
    empty = {"sold_prices": [], "graded_prices": {}, "count": 0, "avg": None, "median": None, "source": "mercari_jp_sold"}
    if CIRCUIT_BREAKERS["mercari_jp"]["tripped"]:
        return empty

    sess = session or get_thread_session()
    if not sess:
        return empty

    jp_headers = {
        **HEADERS,
        "Accept": "application/json",
        "Accept-Language": "ja-JP,ja;q=0.9",
        "X-Platform": "web",
    }

    try:
        resp = sess.get(
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
            html_resp = sess.get(
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

        with anti_bot_lock:
            cb = CIRCUIT_BREAKERS["mercari_jp"]
            if agg["count"] > 0:
                cb["consecutive_zeros"] = 0
            else:
                cb["consecutive_zeros"] += 1
                if not cb["tripped"] and cb["consecutive_zeros"] >= CIRCUIT_BREAKER_THRESHOLD:
                    cb["tripped"] = True
                    logger.warning(
                        f"⚡ [CIRCUIT BREAKER] Mercari JP disabled for remainder of run "
                        f"({cb['consecutive_zeros']} consecutive zero-item responses / datacenter IP block)."
                    )

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
        with anti_bot_lock:
            cb = CIRCUIT_BREAKERS["mercari_jp"]
            cb["consecutive_zeros"] += 1
            if not cb["tripped"] and cb["consecutive_zeros"] >= CIRCUIT_BREAKER_THRESHOLD:
                cb["tripped"] = True
                logger.warning(
                    f"⚡ [CIRCUIT BREAKER] Mercari JP disabled for remainder of run "
                    f"({cb['consecutive_zeros']} consecutive errors / datacenter IP block)."
                )
        return empty


# ---------------------------------------------------------------------------
# Japanese Market: Yahoo! Auctions Japan Closed Auctions (closedsearch)
# ---------------------------------------------------------------------------
def scrape_yahoo_auctions_jp_sold(
    search_query: str,
    card_local_id: str = "",
    session: Optional[requests.Session] = None,
) -> dict:
    """Scrapes closed winning auctions on Yahoo! Auctions Japan."""
    empty = {"sold_prices": [], "graded_prices": {}, "count": 0, "avg": None, "median": None, "source": "yahoo_jp_sold"}
    if CIRCUIT_BREAKERS["yahoo_jp"]["tripped"]:
        return empty

    sess = session or get_thread_session()
    if not sess or not HAS_BS4:
        return empty

    try:
        resp = sess.get(
            "https://auctions.yahoo.co.jp/closedsearch/closedsearch",
            params={"p": search_query, "va": search_query, "b": "1", "n": "25", "s1": "bids", "o1": "d"},
            headers={**HEADERS, "Accept-Language": "ja-JP,ja;q=0.9"},
            timeout=12,
        )
        if resp.status_code != 200:
            with anti_bot_lock:
                cb = CIRCUIT_BREAKERS["yahoo_jp"]
                cb["consecutive_zeros"] += 1
                if not cb["tripped"] and cb["consecutive_zeros"] >= CIRCUIT_BREAKER_THRESHOLD:
                    cb["tripped"] = True
                    logger.warning(
                        f"⚡ [CIRCUIT BREAKER] Yahoo! Auctions JP disabled for remainder of run "
                        f"({cb['consecutive_zeros']} consecutive error/empty responses / datacenter IP block)."
                    )
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

        with anti_bot_lock:
            cb = CIRCUIT_BREAKERS["yahoo_jp"]
            if agg["count"] > 0:
                cb["consecutive_zeros"] = 0
            else:
                cb["consecutive_zeros"] += 1
                if not cb["tripped"] and cb["consecutive_zeros"] >= CIRCUIT_BREAKER_THRESHOLD:
                    cb["tripped"] = True
                    logger.warning(
                        f"⚡ [CIRCUIT BREAKER] Yahoo! Auctions JP disabled for remainder of run "
                        f"({cb['consecutive_zeros']} consecutive zero-item responses / datacenter IP block)."
                    )

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
        with anti_bot_lock:
            cb = CIRCUIT_BREAKERS["yahoo_jp"]
            cb["consecutive_zeros"] += 1
            if not cb["tripped"] and cb["consecutive_zeros"] >= CIRCUIT_BREAKER_THRESHOLD:
                cb["tripped"] = True
                logger.warning(
                    f"⚡ [CIRCUIT BREAKER] Yahoo! Auctions JP disabled for remainder of run "
                    f"({cb['consecutive_zeros']} consecutive errors / datacenter IP block)."
                )
        return empty


# ---------------------------------------------------------------------------
# Japanese Market: Card Rush Akihabara Single-Card Retail
# ---------------------------------------------------------------------------
def scrape_card_rush_jp(
    search_query: str,
    card_local_id: str = "",
    session: Optional[requests.Session] = None,
) -> dict:
    """Scrapes single-card retail acquisition prices from Card Rush Japan."""
    empty = {"sold_prices": [], "count": 0, "avg": None, "median": None, "source": "cardrush_jp"}
    if CIRCUIT_BREAKERS["cardrush_jp"]["tripped"]:
        return empty

    sess = session or get_thread_session()
    if not sess or not HAS_BS4:
        return empty

    try:
        resp = sess.get(
            "https://www.cardrush-pokemon.jp/product/list",
            params={"keyword": search_query, "per_page": 20},
            headers={**HEADERS, "Accept-Language": "ja-JP,ja;q=0.9"},
            timeout=12,
        )
        if resp.status_code != 200:
            with anti_bot_lock:
                cb = CIRCUIT_BREAKERS["cardrush_jp"]
                cb["consecutive_zeros"] += 1
                if not cb["tripped"] and cb["consecutive_zeros"] >= CIRCUIT_BREAKER_THRESHOLD:
                    cb["tripped"] = True
                    logger.warning(
                        f"⚡ [CIRCUIT BREAKER] Card Rush JP disabled for remainder of run "
                        f"({cb['consecutive_zeros']} consecutive error/empty responses / datacenter IP block)."
                    )
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

        with anti_bot_lock:
            cb = CIRCUIT_BREAKERS["cardrush_jp"]
            if agg["count"] > 0:
                cb["consecutive_zeros"] = 0
            else:
                cb["consecutive_zeros"] += 1
                if not cb["tripped"] and cb["consecutive_zeros"] >= CIRCUIT_BREAKER_THRESHOLD:
                    cb["tripped"] = True
                    logger.warning(
                        f"⚡ [CIRCUIT BREAKER] Card Rush JP disabled for remainder of run "
                        f"({cb['consecutive_zeros']} consecutive zero-item responses / datacenter IP block)."
                    )

        return {
            "sold_prices": agg["sold_prices"],
            "count": agg["count"],
            "avg": agg["smoothed_avg"],
            "median": agg["median"],
            "source": "cardrush_jp",
        }
    except Exception as e:
        logger.debug(f"Card Rush JP error: {e}")
        with anti_bot_lock:
            cb = CIRCUIT_BREAKERS["cardrush_jp"]
            cb["consecutive_zeros"] += 1
            if not cb["tripped"] and cb["consecutive_zeros"] >= CIRCUIT_BREAKER_THRESHOLD:
                cb["tripped"] = True
                logger.warning(
                    f"⚡ [CIRCUIT BREAKER] Card Rush JP disabled for remainder of run "
                    f"({cb['consecutive_zeros']} consecutive errors / datacenter IP block)."
                )
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
# Worker Task: Single Card Finalized Sales Crawl
# ---------------------------------------------------------------------------
def scrape_single_card(
    card: Dict[str, Any],
    fr_name_by_raw_id: Dict[str, str],
    en_name_by_raw_id: Dict[str, str],
    existing_prices: Dict[str, Any],
    stop_event: threading.Event,
) -> Optional[Dict[str, Any]]:
    """Crawls finalized sales across European and Japanese markets for one card."""
    if stop_event.is_set():
        return None

    sess = get_thread_session()
    ref = card["ref"]
    name = card["name"]
    local_id = card["local_id"]
    official_count = card["official_count"]
    edition = card["edition"]
    lang = card["lang"]
    set_id = card["set_id"]

    # Multi-language naming resolution (TCGdex direct linking)
    linked_fr_name = fr_name_by_raw_id.get(card["raw_id"]) if lang == "ja" else name
    linked_en_name = en_name_by_raw_id.get(card["raw_id"], "")

    clean_fr = re.sub(
        r"[-–—]\s*(ex|vmax|vstar|sar|ar|ur|hr|sr|gx).*",
        "",
        (linked_fr_name or name),
        flags=re.IGNORECASE,
    ).strip()

    serial_token = f"{local_id}/{official_count}" if official_count != "---" else local_id
    if lang == "ja":
        query_fr = f"pokemon {set_id} {serial_token}".strip()
        query_jp = f"{name} {local_id}".strip()
    else:
        query_fr = f"pokemon {clean_fr} {serial_token}".strip()
        query_jp = f"{clean_fr} {local_id}".strip()

    # --- A. French / European Resale Market ---
    if not CIRCUIT_BREAKERS["ebay_fr"]["tripped"]:
        ebay_fr = scrape_ebay_fr_sold(query_fr, local_id, session=sess)
        time.sleep(random.uniform(0.08, 0.15))
    else:
        ebay_fr = {"sold_prices": [], "graded_prices": {}, "count": 0, "avg": None, "median": None, "source": "ebay_fr_sold"}

    api_metrics = fetch_cardmarket_metrics(
        card_name=(linked_fr_name or name),
        local_id=local_id,
        en_name=linked_en_name,
        set_id=set_id,
        session=sess,
    )

    cm_metrics = api_metrics.get("cardmarket") if api_metrics else None
    tcg_metrics = api_metrics.get("tcgplayer") if api_metrics else None
    tcg_usd = api_metrics.get("tcgplayer_usd") if api_metrics else None

    all_fr_sold = list(ebay_fr.get("sold_prices", []))
    if cm_metrics:
        if cm_metrics.get("trendPrice"):
            all_fr_sold.append(cm_metrics["trendPrice"])
        if cm_metrics.get("avg30"):
            all_fr_sold.append(cm_metrics["avg30"])
    elif tcg_usd:
        # Fallback benchmark: TCGplayer USD converted to EUR (~0.92 EUR/USD)
        eur_est = round(tcg_usd * 0.92, 2)
        all_fr_sold.append(eur_est)

    fr_metrics = aggregate_sold_metrics(all_fr_sold, is_jpy=False)
    fr_graded = ebay_fr.get("graded_prices", {})

    # --- B. Japanese Acquisition Market ---
    if not CIRCUIT_BREAKERS["mercari_jp"]["tripped"]:
        mercari_jp = scrape_mercari_jp_sold(query_jp, local_id, session=sess)
        time.sleep(random.uniform(0.08, 0.15))
    else:
        mercari_jp = {"sold_prices": [], "graded_prices": {}, "count": 0, "avg": None, "median": None, "source": "mercari_jp_sold"}

    if not CIRCUIT_BREAKERS["yahoo_jp"]["tripped"]:
        yahoo_jp = scrape_yahoo_auctions_jp_sold(query_jp, local_id, session=sess)
        time.sleep(random.uniform(0.08, 0.15))
    else:
        yahoo_jp = {"sold_prices": [], "graded_prices": {}, "count": 0, "avg": None, "median": None, "source": "yahoo_jp_sold"}

    if not CIRCUIT_BREAKERS["cardrush_jp"]["tripped"]:
        cardrush_jp = scrape_card_rush_jp(query_jp, local_id, session=sess)
    else:
        cardrush_jp = {"sold_prices": [], "count": 0, "avg": None, "median": None, "source": "cardrush_jp"}

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

    # Incremental Preservation: keep existing verified record if scrape returned 0 hits
    prev = existing_prices.get(ref)
    if fr_metrics["count"] == 0 and jp_metrics["count"] == 0 and prev:
        if prev.get("fr", {}).get("smoothed_avg") is not None or prev.get("jp", {}).get("smoothed_avg") is not None:
            return prev

    # Strict Safeguard: Zero fabricated prices. Real sales or null.
    return {
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
            "tcgplayer": tcg_metrics,
            "tcgplayer_usd": tcg_usd,
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


# ---------------------------------------------------------------------------
# Checkpoint Database Saver
# ---------------------------------------------------------------------------
def save_database_checkpoint(
    prices_db: Dict[str, Any],
    spreads_fr: Dict[str, List[float]],
    spreads_jp: Dict[str, List[float]],
    total_sets: int,
    total_catalog: int,
    total_chase: int,
    processed: int,
):
    """Atomically commits current verified price database to prices.json."""
    with save_lock:
        observed_grade_spreads = {
            "fr": {
                g_key: round(statistics.median(vals), 3)
                for g_key, vals in spreads_fr.items()
                if len(vals) >= 2
            },
            "jp": {
                g_key: round(statistics.median(vals), 3)
                for g_key, vals in spreads_jp.items()
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
                "total_sets_discovered": total_sets,
                "total_catalog_cards": total_catalog,
                "total_chase_cards": total_chase,
                "card_count": len(prices_db),
                "priced_cards": total_priced,
                "processed_this_run": processed,
                "circuit_breakers": {
                    k: v["tripped"] for k, v in CIRCUIT_BREAKERS.items()
                },
                "observed_grade_spreads": observed_grade_spreads,
                "version": "3.2.0",
            },
            "prices": prices_db,
        }

        temp_file = OUTPUT_FILE + ".tmp"
        try:
            with open(temp_file, "w", encoding="utf-8") as f:
                json.dump(output_payload, f, ensure_ascii=False, indent=2)
            os.replace(temp_file, OUTPUT_FILE)
        except Exception as e:
            logger.error(f"Error saving prices.json checkpoint: {e}")


# ---------------------------------------------------------------------------
# Main Orchestrator
# ---------------------------------------------------------------------------
def main():
    start_ts = time.time()
    logger.info("==========================================================================")
    logger.info("PokéSpread JP→FR — High-Value Arbitrage Pipeline (Multi-Threaded)")
    logger.info("==========================================================================")

    # 1. Load existing verified records for incremental refresh
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

    # 2. Dynamically fetch English catalog mapping for Cardmarket & TCGplayer
    en_name_by_raw_id = fetch_tcgdex_en_cards()

    # 3. Dynamically fetch ALL official sets & cards from TCGdex (FR + JP)
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

    # 4. Filter and sort strictly targeting high-value chase cards first
    for card in all_cards:
        en_name = en_name_by_raw_id.get(card["raw_id"], "")
        card["en_name"] = en_name
        card["is_chase"] = is_chase_card(card, en_name=en_name)

    chase_cards = [c for c in all_cards if c["is_chase"]]
    common_cards = [c for c in all_cards if not c["is_chase"]]

    logger.info(
        f"Global catalog: {len(all_cards)} cards across {total_sets_discovered} sets. "
        f"Identified {len(chase_cards)} high-value chase cards (Secrets, Ultra Rares, Alt Arts)."
    )

    def crawl_priority(card: Dict[str, Any]):
        prev = existing_prices.get(card["ref"])
        has_price = prev is not None and (
            prev.get("fr", {}).get("smoothed_avg") is not None
            or prev.get("jp", {}).get("smoothed_avg") is not None
        )
        fetched_at = prev.get("fetched_at", "") if prev else ""
        era_rank = get_set_era_rank(card.get("set_id", ""))
        is_secret = 0 if card.get("is_secret") else 1

        return (
            era_rank,                      # 1. Newest eras first (SV, SWSH, SM, XY...)
            0 if not has_price else 1,     # 2. Unpriced / missing prices first
            is_secret,                     # 3. Secret rares first within era
            fetched_at,                    # 4. Oldest fetched first
        )

    chase_cards.sort(key=crawl_priority)
    common_cards.sort(key=crawl_priority)

    # Chase cards are prioritized at the front of the queue
    queue_cards = chase_cards + common_cards

    # 5. Concurrent Crawl with ThreadPoolExecutor(max_workers=6)
    prices_db: Dict[str, Any] = dict(existing_prices)
    observed_spread_samples_fr: Dict[str, List[float]] = {}
    observed_spread_samples_jp: Dict[str, List[float]] = {}
    processed_count = 0
    stop_event = threading.Event()

    def worker_task(card_item: Dict[str, Any]):
        if stop_event.is_set():
            return None
        try:
            res = scrape_single_card(
                card_item,
                fr_name_by_raw_id,
                en_name_by_raw_id,
                existing_prices,
                stop_event,
            )
            return (card_item, res)
        except Exception as exc:
            logger.debug(f"Card crawl error for {card_item.get('ref')}: {exc}")
            return None

    logger.info(
        f"Starting multi-threaded scraping with {MAX_WORKERS} workers "
        f"(Runtime budget: {MAX_RUNTIME_SECONDS}s)..."
    )

    chunk_size = 30
    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        for chunk_start in range(0, len(queue_cards), chunk_size):
            elapsed = time.time() - start_ts
            if elapsed >= MAX_RUNTIME_SECONDS:
                logger.info(
                    f"Reached CI runtime budget ({int(elapsed)}s / {MAX_RUNTIME_SECONDS}s) "
                    f"after processing {processed_count} cards. Finalizing database..."
                )
                stop_event.set()
                break

            chunk = queue_cards[chunk_start : chunk_start + chunk_size]
            future_to_card = {executor.submit(worker_task, card): card for card in chunk}

            for future in concurrent.futures.as_completed(future_to_card):
                if time.time() - start_ts >= MAX_RUNTIME_SECONDS and not stop_event.is_set():
                    logger.info("Runtime threshold reached. Signalling workers to complete...")
                    stop_event.set()

                result = future.result()
                if not result:
                    continue
                card_item, record = result
                if record:
                    ref = card_item["ref"]
                    with db_lock:
                        prices_db[ref] = record
                        processed_count += 1

                        fr_smooth = record.get("fr", {}).get("smoothed_avg")
                        if fr_smooth and fr_smooth > 0:
                            for g_key, g_data in record.get("fr", {}).get("graded", {}).items():
                                g_smooth = g_data.get("smoothed_avg")
                                if g_smooth:
                                    ratio = g_smooth / fr_smooth
                                    if 0.6 <= ratio <= 12.0:
                                        observed_spread_samples_fr.setdefault(g_key, []).append(ratio)

                        jp_smooth = record.get("jp", {}).get("smoothed_avg")
                        if jp_smooth and jp_smooth > 0:
                            for g_key, g_data in record.get("jp", {}).get("graded", {}).items():
                                g_smooth = g_data.get("smoothed_avg")
                                if g_smooth:
                                    ratio = g_smooth / jp_smooth
                                    if 0.6 <= ratio <= 12.0:
                                        observed_spread_samples_jp.setdefault(g_key, []).append(ratio)

            # Checkpoint save after each chunk
            save_database_checkpoint(
                prices_db,
                observed_spread_samples_fr,
                observed_spread_samples_jp,
                total_sets_discovered,
                len(all_cards),
                len(chase_cards),
                processed_count,
            )
            logger.info(
                f"[{processed_count}/{len(queue_cards)}] Checkpoint committed "
                f"({int(time.time() - start_ts)}s elapsed)"
            )

    # 6. Final atomic save
    save_database_checkpoint(
        prices_db,
        observed_spread_samples_fr,
        observed_spread_samples_jp,
        total_sets_discovered,
        len(all_cards),
        len(chase_cards),
        processed_count,
    )

    total_priced = sum(
        1 for entry in prices_db.values()
        if entry.get("fr", {}).get("smoothed_avg") is not None
        or entry.get("jp", {}).get("smoothed_avg") is not None
    )

    logger.info(
        f"✅ Scraper completed: {processed_count} cards processed this run, "
        f"{total_priced} total cards with verified sold transactions -> {OUTPUT_FILE}"
    )


if __name__ == "__main__":
    main()
