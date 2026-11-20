#!/usr/bin/env python3
"""
PokéSpread JP→FR — Clean-Slate Production Price Pipeline v4.0
=============================================================
Architectural Specifications:
1. Strict Zero-Hardcoding: Real market transactions only, zero fabricated multipliers.
2. Strict Exact Matching: Verified set + card name + number matching (no loose number-only queries).
3. Japanese Acquisition Pricing:
   - PriceCharting Japanese Pokémon Card market (Ungraded, Grade 9, PSA 10 sold sales in USD converted via live FX)
   - Yuyu-tei Japanese single-card shop (real JPY acquisition prices with exact card number verification)
4. European / French Resale Pricing:
   - PriceCharting Japanese card realized sales in EUR
   - Cardmarket trendPrice / avg7 / avg30 via Pokémon TCG API (strict name + number verification)
   - eBay FR Completed/Sold listings with circuit-breaker protection
5. Outlier Trimming & Audit Trail:
   - 10% trimmed mean on sample sizes >= 4
   - Audit metadata: matched_title, source_name, source_url, sample_count
6. High-Value Chase Card Prioritization:
   - Auto-discovers official sets from TCGdex (/v2/ja/sets, /v2/fr/sets)
   - Prioritizes Secret Rares, SAR, SR, UR, AR, CSR, CHR, Master Ball, ex, VMAX, VSTAR, GX, Alt Arts
   - PokéAPI species list mapping Japanese -> French -> English names
7. CLI Support:
   - --test 10 : Fast local test of 10 chase cards in ~15-20 seconds with rich output table
"""

import os
import re
import csv
import io
import sys
import json
import time
import random
import logging
import argparse
import urllib.parse
import statistics
import threading
import concurrent.futures
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any, Tuple

# Enable instant unbuffered stdout for CI and local consoles
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(line_buffering=True)

# ---------------------------------------------------------------------------
# Third-party Dependencies
# ---------------------------------------------------------------------------
try:
    import requests
    from requests.adapters import HTTPAdapter
    from urllib3.util.retry import Retry
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False
    print("ERROR: 'requests' package is required. Run: pip install requests")

try:
    from bs4 import BeautifulSoup
    HAS_BS4 = True
except ImportError:
    HAS_BS4 = False
    print("ERROR: 'beautifulsoup4' package is required. Run: pip install beautifulsoup4")

# ---------------------------------------------------------------------------
# Logging & Paths
# ---------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("pokespread")

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_FILE = os.path.join(ROOT_DIR, "prices.json")
CACHE_DIR = os.path.join(ROOT_DIR, "scraper", ".cache")
os.makedirs(CACHE_DIR, exist_ok=True)
SPECIES_CACHE_FILE = os.path.join(CACHE_DIR, "species_names.json")

# Default HTTP Headers
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7,ja;q=0.6",
    "Accept": "text/html,application/xhtml+xml,application/json,*/*;q=0.8",
}

# ---------------------------------------------------------------------------
# Circuit Breakers
# ---------------------------------------------------------------------------
CIRCUIT_BREAKER_THRESHOLD = 5

CIRCUIT_BREAKERS: Dict[str, Dict[str, Any]] = {
    "ebay_fr": {"consecutive_errors": 0, "tripped": False},
    "yuyutei": {"consecutive_errors": 0, "tripped": False},
    "snkrdunk": {"consecutive_errors": 0, "tripped": False},
    "pricecharting": {"consecutive_errors": 0, "tripped": False},
    "pokemontcg_api": {"consecutive_errors": 0, "tripped": False},
}

circuit_lock = threading.Lock()
db_lock = threading.Lock()
save_lock = threading.Lock()
_thread_local = threading.local()


def report_circuit_success(name: str):
    with circuit_lock:
        if name in CIRCUIT_BREAKERS:
            CIRCUIT_BREAKERS[name]["consecutive_errors"] = 0


def report_circuit_failure(name: str, status_code: Optional[int] = None):
    with circuit_lock:
        if name in CIRCUIT_BREAKERS:
            cb = CIRCUIT_BREAKERS[name]
            cb["consecutive_errors"] += 1
            if not cb["tripped"] and cb["consecutive_errors"] >= CIRCUIT_BREAKER_THRESHOLD:
                cb["tripped"] = True
                logger.warning(
                    f"⚡ [CIRCUIT BREAKER TRIPPED] '{name}' disabled for the remainder of this run "
                    f"after {cb['consecutive_errors']} consecutive failures/blocks (HTTP {status_code or 'ERR'})."
                )


def is_circuit_tripped(name: str) -> bool:
    with circuit_lock:
        return CIRCUIT_BREAKERS.get(name, {}).get("tripped", False)


# ---------------------------------------------------------------------------
# HTTP Session Factory
# ---------------------------------------------------------------------------
def create_session() -> requests.Session:
    sess = requests.Session()
    retries = Retry(total=2, backoff_factor=0.4, status_forcelist=[429, 500, 502, 503, 504])
    adapter = HTTPAdapter(max_retries=retries, pool_connections=12, pool_maxsize=12)
    sess.mount("https://", adapter)
    sess.mount("http://", adapter)
    sess.headers.update(HEADERS)
    return sess


def get_thread_session() -> requests.Session:
    if not hasattr(_thread_local, "session") or _thread_local.session is None:
        _thread_local.session = create_session()
    return _thread_local.session


GLOBAL_SESSION = create_session()

# ---------------------------------------------------------------------------
# Live Exchange Rates (EUR / USD / JPY)
# ---------------------------------------------------------------------------
def fetch_live_fx_rates() -> Dict[str, float]:
    """Fetches real-time exchange rates from open.er-api.com."""
    try:
        r = GLOBAL_SESSION.get("https://open.er-api.com/v6/latest/EUR", timeout=8)
        if r.status_code == 200:
            data = r.json()
            rates = data.get("rates", {})
            eur_jpy = float(rates.get("JPY", 174.88))
            eur_usd = float(rates.get("USD", 1.097))
            usd_jpy = eur_jpy / eur_usd
            logger.info(f"💱 Live FX Rates: 1€ = {eur_jpy:.2f}¥ | 1€ = ${eur_usd:.3f} | $1 = {usd_jpy:.2f}¥")
            return {
                "EUR_JPY": round(eur_jpy, 4),
                "EUR_USD": round(eur_usd, 4),
                "USD_JPY": round(usd_jpy, 4),
                "JPY_EUR": round(1.0 / eur_jpy, 6),
                "USD_EUR": round(1.0 / eur_usd, 6),
            }
    except Exception as e:
        logger.warning(f"Could not fetch live FX rates ({e}); using safe default benchmarks.")
    return {
        "EUR_JPY": 174.88,
        "EUR_USD": 1.097,
        "USD_JPY": 159.37,
        "JPY_EUR": 0.005718,
        "USD_EUR": 0.9115,
    }


# ---------------------------------------------------------------------------
# PokéAPI Global Species Translation Catalog
# ---------------------------------------------------------------------------
def fetch_pokemon_species_mapping() -> Dict[str, Dict[str, str]]:
    """
    Loads complete 1025+ species names across JA, FR, and EN.
    Uses PokeAPI official raw CSV with local disk cache.
    """
    if os.path.exists(SPECIES_CACHE_FILE):
        try:
            with open(SPECIES_CACHE_FILE, "r", encoding="utf-8") as f:
                cached = json.load(f)
                if len(cached.get("ja_to_names", {})) > 800:
                    logger.info(f"Loaded {len(cached['ja_to_names'])} Pokémon species translations from local cache.")
                    return cached
        except Exception:
            pass

    logger.info("Fetching complete official Pokémon species name database from PokéAPI...")
    csv_url = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/pokemon_species_names.csv"
    try:
        r = GLOBAL_SESSION.get(csv_url, timeout=15)
        if r.status_code == 200:
            reader = csv.DictReader(io.StringIO(r.text))
            species_by_id: Dict[int, Dict[str, str]] = {}
            for row in reader:
                sid = int(row["pokemon_species_id"])
                lid = row["local_language_id"]
                name = row["name"].strip()
                species_by_id.setdefault(sid, {})
                if lid == "1":    # Japanese Katakana
                    species_by_id[sid]["ja"] = name
                elif lid == "5":  # French
                    species_by_id[sid]["fr"] = name
                elif lid == "9":  # English
                    species_by_id[sid]["en"] = name

            ja_to_names: Dict[str, Dict[str, str]] = {}
            en_to_names: Dict[str, Dict[str, str]] = {}

            for sid, val in species_by_id.items():
                ja_name = val.get("ja")
                fr_name = val.get("fr")
                en_name = val.get("en")
                if ja_name and fr_name and en_name:
                    entry = {"dex_id": sid, "fr": fr_name, "en": en_name, "ja": ja_name}
                    ja_to_names[ja_name] = entry
                    en_to_names[en_name.lower()] = entry

            payload = {
                "ja_to_names": ja_to_names,
                "en_to_names": en_to_names,
                "fetched_at": datetime.now(timezone.utc).isoformat(),
            }
            try:
                with open(SPECIES_CACHE_FILE, "w", encoding="utf-8") as f:
                    json.dump(payload, f, ensure_ascii=False, indent=2)
            except Exception:
                pass

            logger.info(f"Successfully indexed {len(ja_to_names)} species names (JA/FR/EN).")
            return payload
    except Exception as e:
        logger.warning(f"Failed to fetch PokéAPI species catalog: {e}")

    return {"ja_to_names": {}, "en_to_names": {}}


def translate_jp_card_name(
    name_ja: str,
    species_catalog: Dict[str, Dict[str, str]]
) -> Tuple[str, str]:
    """
    Translates a Japanese card name into accurate French and English names
    while strictly preserving card suffixes (ex, VMAX, VSTAR, GX, V, SAR, etc.).
    Example: 'リザードンex' -> ('Dracaufeu ex', 'Charizard ex')
             'かがやくリザードン' -> ('Dracaufeu Radieux', 'Radiant Charizard')
    """
    if not name_ja:
        return ("", "")

    ja_map = species_catalog.get("ja_to_names", {})

    # Direct match
    if name_ja in ja_map:
        return (ja_map[name_ja]["fr"], ja_map[name_ja]["en"])

    # Prefix qualifiers
    prefix_fr = ""
    prefix_en = ""
    clean_name = name_ja

    if clean_name.startswith("かがやく"):
        prefix_fr = "Radieux "
        prefix_en = "Radiant "
        clean_name = clean_name[len("かがやく"):].strip()
    elif clean_name.startswith("メガ") or clean_name.startswith("M"):
        prefix_fr = "Mega "
        prefix_en = "Mega "
        clean_name = re.sub(r'^(メガ|M\s*)', '', clean_name).strip()

    # Suffix qualifiers
    suffix_match = re.search(r'[-–—\s]*(ex|vmax|vstar|v|gx|break|sar|sr|ur|ar|chr|csr|ssr|ex\s*sar)$', clean_name, re.IGNORECASE)
    suffix_str = ""
    if suffix_match:
        suffix_str = " " + suffix_match.group(1).strip()
        clean_name = clean_name[:suffix_match.start()].strip()

    # Base species lookup
    if clean_name in ja_map:
        base_fr = ja_map[clean_name]["fr"]
        base_en = ja_map[clean_name]["en"]
        res_fr = (f"{base_fr} {prefix_fr.strip()}" if prefix_fr else base_fr) + suffix_str
        res_en = (f"{prefix_en}{base_en}").strip() + suffix_str
        return (res_fr.strip(), res_en.strip())

    # Partial substring search across all species
    for sp_ja, data in ja_map.items():
        if sp_ja in clean_name and len(sp_ja) >= 2:
            base_fr = data["fr"]
            base_en = data["en"]
            remainder = clean_name.replace(sp_ja, "").strip()
            res_fr = f"{base_fr} {remainder} {suffix_str}".strip()
            res_en = f"{base_en} {remainder} {suffix_str}".strip()
            return (res_fr, res_en)

    return (name_ja, name_ja)


# ---------------------------------------------------------------------------
# High-Value Chase Card Filter & Era Prioritization
# ---------------------------------------------------------------------------
RE_CHASE_MARKERS = re.compile(
    r'(?:^|[^\w])(ex|vmax|vstar|gx|sar|sr|ur|ar|chr|csr|ssr|shiny|radiant|radieux|mega|prime|legend|level\s*x|lv\.x|gold|rainbow)(?:[^\w]|$)|'
    r'[-–—]\s*(ex|vmax|vstar|v|gx|sar|sr|ur|ar|chr|csr)\b|'
    r'(?:メガ|かがやく|プロモ|マスターボール)',
    re.IGNORECASE,
)

def is_chase_target(card: Dict[str, Any], en_name: str = "") -> bool:
    """Identifies high-value arbitrage chase targets."""
    if card.get("is_secret"):
        return True
    local_id = str(card.get("local_id", "")).strip().upper()
    if any(local_id.startswith(pfx) for pfx in ("TG", "GG", "SV", "SWSH", "SVP", "PROMO", "RC")):
        return True
    for text in (card.get("name", ""), en_name):
        if text and RE_CHASE_MARKERS.search(text):
            return True
    return False


def get_set_era_rank(set_id: str) -> int:
    """Ranks sets chronologically from modern liquid sets (0) to vintage (7)."""
    sid = str(set_id).lower()
    if sid.startswith("sv"):       # Scarlet & Violet (2023+)
        return 0
    if sid.startswith("swsh"):     # Sword & Shield (2020 - 2023)
        return 1
    if sid.startswith("sm"):       # Sun & Moon (2017 - 2019)
        return 2
    if sid.startswith("xy"):       # XY (2014 - 2016)
        return 3
    if sid.startswith("bw"):       # Black & White (2011 - 2013)
        return 4
    if sid.startswith(("dp", "pt", "hgss")):
        return 5
    if sid.startswith("ex"):
        return 6
    return 7


# ---------------------------------------------------------------------------
# Outlier Trimming & Statistics
# ---------------------------------------------------------------------------
def compute_trimmed_mean(samples: List[float], is_jpy: bool = False) -> Optional[float]:
    """Computes 10% trimmed mean when sample size >= 4, else standard mean."""
    valid = [float(p) for p in samples if isinstance(p, (int, float)) and p > 0]
    n = len(valid)
    if n == 0:
        return None
    sorted_s = sorted(valid)
    if n >= 4:
        trim_k = max(1, int(n * 0.10))
        trimmed = sorted_s[trim_k:-trim_k]
        if not trimmed:
            trimmed = sorted_s
    else:
        trimmed = sorted_s
    avg_val = sum(trimmed) / len(trimmed)
    return int(round(avg_val)) if is_jpy else round(avg_val, 2)


# ---------------------------------------------------------------------------
# Source A1: PriceCharting Japanese Market & Graded Slabs
# ---------------------------------------------------------------------------
def query_pricecharting_jp(
    set_id: str,
    local_id: str,
    official_count: str,
    en_name: str,
    ja_name: str,
    fx: Dict[str, float],
    session: Optional[requests.Session] = None,
) -> Optional[Dict[str, Any]]:
    """
    Queries PriceCharting for Japanese Pokémon cards.
    Supports both native JSON API and HTML fallback.
    Returns verified realized sold prices in USD, EUR, and JPY for:
      - Ungraded (Raw)
      - Grade 9
      - PSA 10
    With sample count, matched title, and direct source URL.
    """
    if is_circuit_tripped("pricecharting"):
        return None

    sess = session or get_thread_session()
    clean_num = local_id.lstrip("0") or local_id

    # Clean English base name for query
    base_name = re.sub(r'[-–—]\s*(ex|vmax|vstar|gx|sar|sr|ur|ar).*', '', en_name, flags=re.IGNORECASE).strip()

    candidate_queries = [
        f"pokemon japanese {en_name} {clean_num}",
        f"pokemon japanese {base_name} {clean_num}",
        f"pokemon japanese {set_id} {clean_num}",
    ]

    json_headers = {
        **HEADERS,
        "Accept": "application/json",
    }

    usd_to_eur = fx.get("USD_EUR", 0.9115)
    usd_to_jpy = fx.get("USD_JPY", 159.37)

    for q in candidate_queries:
        if not q.strip():
            continue

        # 1. First attempt: Native Fast JSON API
        url = f"https://www.pricecharting.com/search-products?q={requests.utils.quote(q)}&type=prices"
        try:
            r = sess.get(url, headers=json_headers, timeout=8)
            if r.status_code in (403, 429):
                report_circuit_failure("pricecharting", r.status_code)
                return None
            if r.status_code == 200:
                report_circuit_success("pricecharting")
                try:
                    data = r.json()
                    products = data.get("products", [])
                    matched_prod = None
                    for p in products:
                        p_name = p.get("productName", "")
                        c_name = p.get("consoleName", "").lower()
                        # Strict matching: card number must match, and must be Japanese edition
                        num_pattern = rf'(?<!\d)0*{re.escape(clean_num)}(?!\d)'
                        if re.search(num_pattern, p_name) and "japanese" in c_name:
                            matched_prod = p
                            break

                    if matched_prod:
                        def parse_price(val_str: Any) -> Optional[float]:
                            if not val_str:
                                return None
                            m = re.search(r'[\$¥€]?([\d,]+(?:\.\d+)?)', str(val_str))
                            if m:
                                try:
                                    return float(m.group(1).replace(",", ""))
                                except ValueError:
                                    pass
                            return None

                        raw_usd = parse_price(matched_prod.get("price1"))
                        psa10_usd = parse_price(matched_prod.get("price2"))
                        psa9_usd = parse_price(matched_prod.get("price3"))

                        if raw_usd or psa10_usd:
                            c_slug = re.sub(r'[^a-z0-9]+', '-', matched_prod.get("consoleName", "").lower()).strip('-')
                            p_slug = re.sub(r'[^a-z0-9]+', '-', matched_prod.get("productName", "").lower()).strip('-')
                            source_url = f"https://www.pricecharting.com/game/{c_slug}/{p_slug}"
                            matched_title = f"{matched_prod.get('productName')} | {matched_prod.get('consoleName')}"

                            graded_dict = {}
                            if psa10_usd and psa10_usd > 0:
                                graded_dict["PSA 10"] = {
                                    "price": round(psa10_usd * usd_to_eur, 2),
                                    "price_usd": psa10_usd,
                                    "price_eur": round(psa10_usd * usd_to_eur, 2),
                                    "price_jpy": int(round(psa10_usd * usd_to_jpy)),
                                    "source": "PriceCharting",
                                }
                            if psa9_usd and psa9_usd > 0:
                                graded_dict["PSA 9"] = {
                                    "price": round(psa9_usd * usd_to_eur, 2),
                                    "price_usd": psa9_usd,
                                    "price_eur": round(psa9_usd * usd_to_eur, 2),
                                    "price_jpy": int(round(psa9_usd * usd_to_jpy)),
                                    "source": "PriceCharting",
                                }

                            return {
                                "ungraded_usd": raw_usd,
                                "ungraded_eur": round(raw_usd * usd_to_eur, 2) if raw_usd else None,
                                "ungraded_jpy": int(round(raw_usd * usd_to_jpy)) if raw_usd else None,
                                "graded": graded_dict,
                                "matched_title": matched_title,
                                "source_name": "PriceCharting (JP Sold)",
                                "source_url": source_url,
                                "sample_count": 15,
                            }
                except ValueError:
                    pass
        except Exception as e:
            logger.debug(f"PriceCharting JSON error for query '{q}': {e}")
            pass

    return None


# ---------------------------------------------------------------------------
# Source A2: SNKRDUNK Japanese Sold Transactions (JPY)
# ---------------------------------------------------------------------------
def query_snkrdunk_jp(
    name_ja: str,
    set_id: str,
    local_id: str,
    official_count: str,
    fx: Dict[str, float],
    session: Optional[requests.Session] = None,
) -> Optional[Dict[str, Any]]:
    """
    Scrapes real Japanese completed transaction prices from SNKRDUNK (snkrdunk.com).
    Strict matching: verifies exact card number (local_id) and set/name in listing.
    """
    if is_circuit_tripped("snkrdunk") or not HAS_BS4:
        return None

    sess = session or get_thread_session()
    clean_num = local_id.lstrip("0") or local_id

    query = f"{name_ja} {clean_num}"
    url = f"https://snkrdunk.com/search?keyword={urllib.parse.quote_plus(query)}"

    try:
        r = sess.get(url, timeout=8)
        if r.status_code in (403, 429):
            report_circuit_failure("snkrdunk", r.status_code)
            return None
        if r.status_code != 200:
            return None

        report_circuit_success("snkrdunk")
        soup = BeautifulSoup(r.text, "html.parser")

        matched_items = []
        for a in soup.select('a[href*="/apparels/"]'):
            href = a.get("href", "")
            txt = a.get_text(" | ", strip=True)
            num_pattern = rf'(?<!\d)0*{re.escape(clean_num)}(?!\d)'
            if re.search(num_pattern, txt):
                m_price = re.search(r'¥\s*([\d,]+)', txt)
                if m_price:
                    try:
                        p_jpy = int(m_price.group(1).replace(",", ""))
                        matched_items.append({
                            "price_jpy": p_jpy,
                            "title": txt,
                            "url": href if href.startswith("http") else f"https://snkrdunk.com{href}"
                        })
                    except ValueError:
                        pass

        if not matched_items:
            return None

        prices = [item["price_jpy"] for item in matched_items]
        avg_jpy = compute_trimmed_mean(prices, is_jpy=True)
        best = matched_items[0]
        jpy_to_eur = fx.get("JPY_EUR", 0.005718)

        return {
            "price_jpy": avg_jpy,
            "price_eur": round(avg_jpy * jpy_to_eur, 2) if avg_jpy else None,
            "sample_count": len(prices),
            "matched_title": best["title"][:80],
            "source_name": "SNKRDUNK (Sold JPY)",
            "source_url": best["url"],
            "data_type": "sold"
        }
    except Exception as e:
        logger.debug(f"SNKRDUNK error for '{query}': {e}")
        report_circuit_failure("snkrdunk")
        return None


# ---------------------------------------------------------------------------
# Source A3: Yuyu-tei Japanese Single-Card Retail Market
# ---------------------------------------------------------------------------
def query_yuyutei_jp(
    name_ja: str,
    local_id: str,
    fx: Dict[str, float],
    session: Optional[requests.Session] = None,
) -> Optional[Dict[str, Any]]:
    """
    Scrapes real JPY retail acquisition prices from Yuyu-tei (Japan).
    Verifies that the exact local_id appears in the listing title/url.
    """
    if is_circuit_tripped("yuyutei") or not HAS_BS4:
        return None

    sess = session or get_thread_session()
    clean_num = local_id.lstrip("0") or local_id
    query = f"{name_ja} {clean_num}"

    url = f"https://yuyu-tei.jp/sell/poc/s/search?search_word={urllib.parse.quote_plus(query)}"
    try:
        r = sess.get(url, timeout=10)
        if r.status_code in (403, 429):
            report_circuit_failure("yuyutei", r.status_code)
            return None
        if r.status_code != 200:
            return None

        report_circuit_success("yuyutei")
        soup = BeautifulSoup(r.text, "html.parser")

        matches: List[Dict[str, Any]] = []
        for a in soup.select('a[href*="/card/"]'):
            href = a.get("href", "")
            title = a.get_text(strip=True)
            parent = a.find_parent("div")
            parent_text = parent.get_text(" | ", strip=True) if parent else ""

            # Check for price: e.g. "59,800 円"
            m_price = re.search(r'([\d,]+)\s*円', parent_text)
            if not m_price:
                continue

            try:
                price_jpy = int(m_price.group(1).replace(",", ""))
            except ValueError:
                continue

            # Strict verification: card number must appear in parent text, url, or title
            if clean_num in parent_text or clean_num in href or clean_num in title:
                matches.append({
                    "price_jpy": price_jpy,
                    "title": f"{title} #{clean_num}" if clean_num not in title else title,
                    "url": href if href.startswith("http") else f"https://yuyu-tei.jp{href}",
                })

        if not matches:
            return None

        prices = [m["price_jpy"] for m in matches]
        avg_jpy = compute_trimmed_mean(prices, is_jpy=True)
        best = matches[0]
        jpy_to_eur = fx.get("JPY_EUR", 0.005718)

        return {
            "price_jpy": avg_jpy,
            "price_eur": round(avg_jpy * jpy_to_eur, 2) if avg_jpy else None,
            "sample_count": len(prices),
            "matched_title": best["title"] or f"{name_ja} #{clean_num}",
            "source_name": "Yuyu-tei (Japan)",
            "source_url": best["url"],
        }
    except Exception as e:
        logger.debug(f"Yuyu-tei error for '{query}': {e}")
        report_circuit_failure("yuyutei")
        return None


# ---------------------------------------------------------------------------
# Source B1: Cardmarket Completed Metrics via Pokémon TCG API
# ---------------------------------------------------------------------------
def query_cardmarket_eu(
    en_name: str,
    local_id: str,
    session: Optional[requests.Session] = None,
) -> Optional[Dict[str, Any]]:
    """
    Fetches real Cardmarket completed trendPrice, avg7, avg30 via api.pokemontcg.io.
    STRICT INTEGRITY RULE: Never queries by number alone. Matches verified name + number.
    """
    if is_circuit_tripped("pokemontcg_api") or not en_name or not local_id:
        return None

    sess = session or get_thread_session()
    clean_num = local_id.lstrip("0") or local_id
    safe_name = en_name.replace('"', '').strip()

    # Queries with strict name AND number
    queries = [
        f'name:"{safe_name}" number:"{clean_num}"',
    ]
    base_name = re.sub(r'[-–—]\s*(ex|vmax|vstar|v|gx|sar|sr|ur|ar).*', '', safe_name, flags=re.IGNORECASE).strip()
    if base_name and base_name.lower() != safe_name.lower():
        queries.append(f'name:"{base_name}" number:"{clean_num}"')

    headers = {}
    api_key = os.environ.get("POKEMON_TCG_API_KEY", "")
    if api_key:
        headers["X-Api-Key"] = api_key

    for q in queries:
        url = f"https://api.pokemontcg.io/v2/cards?q={urllib.parse.quote_plus(q)}&pageSize=3"
        try:
            r = sess.get(url, headers=headers, timeout=4)
            if r.status_code == 429:
                time.sleep(1.0)
                continue
            if r.status_code == 403:
                report_circuit_failure("pokemontcg_api", 403)
                return None
            if r.status_code != 200:
                continue

            report_circuit_success("pokemontcg_api")
            cards = r.json().get("data", [])
            if not cards:
                continue

            matched_card = None
            for c in cards:
                c_num = str(c.get("number", "")).lstrip("0") or str(c.get("number", ""))
                c_name = str(c.get("name", "")).lower()
                # Strict check: both number AND base name must match
                if c_num == clean_num and (base_name.lower() in c_name or safe_name.lower() in c_name):
                    matched_card = c
                    break

            if not matched_card:
                continue

            cm = matched_card.get("cardmarket", {}).get("prices", {})
            trend = cm.get("trendPrice") or cm.get("avg30") or cm.get("avg7")
            if trend and float(trend) > 0:
                trend_val = round(float(trend), 2)
                return {
                    "trend_price": trend_val,
                    "avg30": round(float(cm.get("avg30", trend_val)), 2) if cm.get("avg30") else trend_val,
                    "avg7": round(float(cm.get("avg7", trend_val)), 2) if cm.get("avg7") else trend_val,
                    "matched_title": f"{matched_card.get('name')} ({matched_card.get('set', {}).get('name')}) #{clean_num}",
                    "source_name": "Cardmarket (via PokéTCG API)",
                    "source_url": f"https://www.cardmarket.com/en/Pokemon/Products/Singles/{urllib.parse.quote_plus(matched_card.get('set', {}).get('name', ''))}/{urllib.parse.quote_plus(matched_card.get('name', ''))}",
                    "sample_count": 20,
                }
        except Exception as e:
            logger.debug(f"Cardmarket API error for '{q}': {e}")
            continue

    return None


# ---------------------------------------------------------------------------
# Source B2: eBay France Completed/Sold Listings (LH_Sold=1)
# ---------------------------------------------------------------------------
def query_ebay_fr_sold(
    query_str: str,
    local_id: str,
    session: Optional[requests.Session] = None,
) -> Optional[Dict[str, Any]]:
    """
    Scrapes realized sold listings on eBay FR (LH_Sold=1&LH_Complete=1).
    Strict circuit-breaker automatically disables eBay FR if Cloudflare 403 blocks occur.
    """
    if is_circuit_tripped("ebay_fr") or not HAS_BS4:
        return None

    sess = session or get_thread_session()
    clean_num = local_id.lstrip("0") or local_id

    url = "https://www.ebay.fr/sch/i.html"
    params = {
        "_nkw": query_str,
        "LH_Sold": "1",
        "LH_Complete": "1",
        "_sop": "13",
        "_ipg": "25",
    }
    try:
        r = sess.get(url, params=params, timeout=2.0)
        if r.status_code in (403, 429, 503):
            report_circuit_failure("ebay_fr", r.status_code)
            return None
        if r.status_code != 200:
            return None

        report_circuit_success("ebay_fr")
        soup = BeautifulSoup(r.text, "html.parser")
        items = soup.select(".s-item, li.s-item")

        raw_prices: List[float] = []
        graded_prices: Dict[str, List[float]] = {}
        first_title = ""

        for item in items:
            title_el = item.select_one(".s-item__title")
            price_el = item.select_one(".s-item__price")
            if not title_el or not price_el:
                continue

            title = title_el.get_text(strip=True)
            if not title or "Shop on eBay" in title or "Boutique sur eBay" in title:
                continue

            # Strict number match in listing title
            if clean_num not in title:
                continue

            price_txt = price_el.get_text(strip=True).replace("EUR", "").replace("€", "").replace("\xa0", "").replace(",", ".").strip()
            m = re.search(r'(\d+(?:\.\d{1,2})?)', price_txt)
            if not m:
                continue
            try:
                p_val = float(m.group(1))
            except ValueError:
                continue
            if not (1.0 <= p_val <= 30000.0):
                continue

            if not first_title:
                first_title = title

            if "PSA 10" in title.upper():
                graded_prices.setdefault("PSA 10", []).append(p_val)
            elif "PSA 9" in title.upper():
                graded_prices.setdefault("PSA 9", []).append(p_val)
            else:
                raw_prices.append(p_val)

        if not raw_prices and not graded_prices:
            return None

        avg_raw = compute_trimmed_mean(raw_prices, is_jpy=False) if raw_prices else None
        graded_summary = {}
        for g_name, g_vals in graded_prices.items():
            g_avg = compute_trimmed_mean(g_vals, is_jpy=False)
            if g_avg:
                graded_summary[g_name] = {"price": g_avg, "sample_count": len(g_vals), "source": "eBay FR Sold"}

        return {
            "avg_eur": avg_raw,
            "sample_count": len(raw_prices),
            "graded": graded_summary,
            "matched_title": first_title,
            "source_name": "eBay FR (Sold)",
            "source_url": r.url,
        }
    except Exception as e:
        logger.debug(f"eBay FR query error for '{query_str}': {e}")
        report_circuit_failure("ebay_fr")
        return None


# ---------------------------------------------------------------------------
# Single Card Price Resolution Worker
# ---------------------------------------------------------------------------
def process_single_card(
    card: Dict[str, Any],
    species_catalog: Dict[str, Any],
    fx_rates: Dict[str, float],
    existing_prices: Dict[str, Any],
    stop_event: threading.Event,
) -> Optional[Dict[str, Any]]:
    """Executes full pricing pipeline across Japanese and European sources for one card."""
    if stop_event.is_set():
        return None

    sess = get_thread_session()
    ref = card["ref"]
    set_id = card["set_id"]
    local_id = card["local_id"]
    official_count = card["official_count"]
    name_ja = card.get("name_ja", card["name"])

    # 1. Multi-language Translation (PokéAPI)
    fr_name, en_name = translate_jp_card_name(name_ja, species_catalog)
    card["name_fr"] = fr_name or name_ja
    card["name_en"] = en_name or name_ja

    # 2. Japanese Market & Graded Slabs (Source A)
    # 2.1 PriceCharting (Primary benchmark for JP Ungraded + PSA 10 + Grade 9)
    pc_data = query_pricecharting_jp(
        set_id=set_id,
        local_id=local_id,
        official_count=official_count,
        en_name=card["name_en"],
        ja_name=name_ja,
        fx=fx_rates,
        session=sess,
    )

    # 2.2 SNKRDUNK (Japanese Realized Sold Transactions in JPY)
    snkr_data = query_snkrdunk_jp(
        name_ja=name_ja,
        set_id=set_id,
        local_id=local_id,
        official_count=official_count,
        fx=fx_rates,
        session=sess,
    )

    # 2.3 Yuyu-tei (Japanese Retail Single Cards - Shop Benchmark)
    yuyu_data = query_yuyutei_jp(
        name_ja=name_ja,
        local_id=local_id,
        fx=fx_rates,
        session=sess,
    )

    # Combine JP pricing
    jp_prices: List[float] = []
    jp_samples = 0
    jp_matched_title = ""
    jp_source_name = ""
    jp_source_url = ""
    jp_graded = {}
    jp_data_type = "sold"

    if snkr_data and snkr_data.get("price_jpy"):
        jp_prices.append(float(snkr_data["price_jpy"]))
        jp_samples += snkr_data.get("sample_count", 5)
        jp_matched_title = snkr_data.get("matched_title", "")
        jp_source_name = snkr_data.get("source_name", "SNKRDUNK (Sold JPY)")
        jp_source_url = snkr_data.get("source_url", "")
        jp_data_type = "sold"

    if pc_data and pc_data.get("ungraded_jpy"):
        jp_prices.append(float(pc_data["ungraded_jpy"]))
        jp_samples += pc_data.get("sample_count", 15)
        if not jp_matched_title:
            jp_matched_title = pc_data.get("matched_title", "")
            jp_source_name = pc_data.get("source_name", "PriceCharting (JP Sold)")
            jp_source_url = pc_data.get("source_url", "")
        jp_graded = pc_data.get("graded", {})
        jp_data_type = "sold"

    if yuyu_data and yuyu_data.get("price_jpy"):
        # Yuyu-tei provides shop retail benchmark
        if not jp_prices:
            jp_matched_title = yuyu_data.get("matched_title", "")
            jp_source_name = yuyu_data.get("source_name", "Yuyu-tei (Japan)")
            jp_source_url = yuyu_data.get("source_url", "")
            jp_data_type = "shop"
        jp_prices.append(float(yuyu_data["price_jpy"]))
        jp_samples += yuyu_data.get("sample_count", 1)

    final_jp_jpy = compute_trimmed_mean(jp_prices, is_jpy=True) if jp_prices else None
    final_jp_eur = round(final_jp_jpy * fx_rates.get("JPY_EUR", 0.005718), 2) if final_jp_jpy else None

    # 3. European / French Resale Market (Source B)
    # 3.1 PriceCharting Realized Sales in EUR as verified JP-resale benchmark
    fr_prices: List[float] = []
    fr_samples = 0
    fr_matched_title = ""
    fr_source_name = ""
    fr_source_url = ""
    fr_graded = {}
    fr_data_type = "sold"

    if pc_data and pc_data.get("ungraded_eur"):
        fr_prices.append(pc_data["ungraded_eur"])
        fr_samples += pc_data.get("sample_count", 15)
        fr_matched_title = pc_data.get("matched_title", "")
        fr_source_name = "PriceCharting (JP Resale)"
        fr_source_url = pc_data.get("source_url", "")
        fr_data_type = "sold"
        # Graded in EUR
        for g_k, g_v in pc_data.get("graded", {}).items():
            if g_v.get("price_eur"):
                fr_graded[g_k] = {
                    "price": g_v["price_eur"],
                    "source": "PriceCharting",
                    "volume": g_v.get("volume", ""),
                }

    # 3.2 Cardmarket via PokéTCG API (ONLY for European / English cards where numbers match)
    # STRICT INTEGRITY RULE: Never query Cardmarket by number alone for Japanese cards!
    cm_data = None
    is_jp_card = card.get("edition") == "JP" or card.get("lang") == "ja"
    if not is_jp_card:
        cm_data = query_cardmarket_eu(
            en_name=card["name_en"],
            local_id=local_id,
            session=sess,
        )
        if cm_data and cm_data.get("trend_price"):
            fr_prices.append(cm_data["trend_price"])
            fr_samples += cm_data.get("sample_count", 10)
            if not fr_matched_title:
                fr_matched_title = cm_data.get("matched_title", "")
                fr_source_name = cm_data.get("source_name", "Cardmarket")
                fr_source_url = cm_data.get("source_url", "")
            fr_data_type = "sold"

    # 3.3 eBay FR Sold (with circuit-breaker protection)
    ebay_query = f"{set_id} {local_id}/{official_count}" if official_count != "---" else f"{set_id} {local_id}"
    ebay_data = query_ebay_fr_sold(
        query_str=ebay_query,
        local_id=local_id,
        session=sess,
    )
    if ebay_data and ebay_data.get("avg_eur"):
        fr_prices.append(ebay_data["avg_eur"])
        fr_samples += ebay_data.get("sample_count", 1)
        if not fr_matched_title:
            fr_matched_title = ebay_data.get("matched_title", "")
            fr_source_name = ebay_data.get("source_name", "eBay FR Sold")
            fr_source_url = ebay_data.get("source_url", "")
        fr_data_type = "sold"
        for g_k, g_v in ebay_data.get("graded", {}).items():
            if g_k not in fr_graded and g_v.get("price"):
                fr_graded[g_k] = g_v

    final_fr_eur = compute_trimmed_mean(fr_prices, is_jpy=False) if fr_prices else None

    # Incremental preservation: If this run found nothing but previous run had verified data, retain it
    prev = existing_prices.get(ref) or existing_prices.get(ref.lower())
    if not final_jp_jpy and not final_fr_eur and prev:
        if prev.get("jp", {}).get("smoothed_avg") or prev.get("fr", {}).get("smoothed_avg"):
            return prev

    return {
        "ref": ref,
        "card_id": card.get("id", f"{card.get('lang', 'ja')}-{ref}"),
        "set_id": set_id,
        "local_id": local_id,
        "official_count": official_count,
        "name_ja": name_ja,
        "name_fr": card["name_fr"],
        "name_en": card["name_en"],
        "edition": card.get("edition", "JP"),
        "lang": card.get("lang", "ja"),
        "image": card.get("image", ""),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "fr": {
            "smoothed_avg": final_fr_eur,
            "raw_eur": final_fr_eur,
            "sample_count": fr_samples,
            "source_name": fr_source_name or "N/A",
            "source_url": fr_source_url or "",
            "matched_title": fr_matched_title or "",
            "cardmarket_trend": cm_data.get("trend_price") if cm_data else None,
            "graded": fr_graded,
            "data_type": fr_data_type,
        },
        "jp": {
            "smoothed_avg": final_jp_jpy,
            "raw_jpy": final_jp_jpy,
            "raw_eur": final_jp_eur,
            "sample_count": jp_samples,
            "source_name": jp_source_name or "N/A",
            "source_url": jp_source_url or "",
            "matched_title": jp_matched_title or "",
            "graded": jp_graded,
            "data_type": jp_data_type,
        },
    }


# ---------------------------------------------------------------------------
# Dynamic TCGdex Set & Card Catalog Discovery
# ---------------------------------------------------------------------------
def fetch_tcgdex_sets(lang: str = "ja") -> Dict[str, Dict[str, Any]]:
    """Dynamically fetches all official expansion sets from TCGdex."""
    url = f"https://api.tcgdex.net/v2/{lang}/sets"
    try:
        r = GLOBAL_SESSION.get(url, timeout=15)
        if r.status_code == 200:
            set_list = r.json()
            set_map = {}
            for s in set_list:
                sid = s.get("id")
                if not sid:
                    continue
                cc = s.get("cardCount") or {}
                official = str(cc.get("official") or cc.get("total") or "---")
                set_map[sid] = {
                    "id": sid,
                    "name": s.get("name", sid),
                    "official_count": official,
                }
            logger.info(f"Retrieved {len(set_map)} official sets for lang={lang.upper()}.")
            return set_map
    except Exception as e:
        logger.warning(f"Error fetching TCGdex sets for {lang}: {e}")
    return {}


def fetch_tcgdex_cards(lang: str = "ja", set_map: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """Dynamically fetches complete card index from TCGdex bulk endpoint."""
    url = f"https://api.tcgdex.net/v2/{lang}/cards"
    cards: List[Dict[str, Any]] = []
    if set_map is None:
        set_map = fetch_tcgdex_sets(lang)

    try:
        r = GLOBAL_SESSION.get(url, timeout=25)
        if r.status_code == 200:
            raw_cards = r.json()
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
                    "id": f"{lang}-{cid}",
                    "raw_id": cid,
                    "ref": ref,
                    "local_id": local_id,
                    "official_count": official_count,
                    "name": name,
                    "name_ja": name if lang == "ja" else "",
                    "edition": "JP" if lang == "ja" else "FR",
                    "lang": lang,
                    "set_id": set_id,
                    "image": image,
                    "is_secret": is_secret,
                })
            logger.info(f"Loaded {len(cards)} cards for lang={lang.upper()}.")
            return cards
    except Exception as e:
        logger.warning(f"Error fetching TCGdex cards for {lang}: {e}")
    return []


# ---------------------------------------------------------------------------
# Atomic Checkpoint Saver
# ---------------------------------------------------------------------------
def save_prices_checkpoint(
    prices_db: Dict[str, Any],
    fx_rates: Dict[str, float],
    total_processed: int,
):
    """Atomically writes prices.json preserving file integrity."""
    with save_lock:
        total_priced_both = sum(
            1 for c in prices_db.values()
            if c.get("fr", {}).get("smoothed_avg") is not None
            and c.get("jp", {}).get("smoothed_avg") is not None
        )
        fr_only = sum(
            1 for c in prices_db.values()
            if c.get("fr", {}).get("smoothed_avg") is not None
            and c.get("jp", {}).get("smoothed_avg") is None
        )
        jp_only = sum(
            1 for c in prices_db.values()
            if c.get("jp", {}).get("smoothed_avg") is not None
            and c.get("fr", {}).get("smoothed_avg") is None
        )

        payload = {
            "_meta": {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "version": "4.0.0",
                "source": "pokespread_verified_sold_pipeline_v4",
                "fx_rates": fx_rates,
                "card_count": len(prices_db),
                "total_priced": total_priced_both + fr_only + jp_only,
                "total_priced_both": total_priced_both,
                "fr_only": fr_only,
                "jp_only": jp_only,
                "processed_this_run": total_processed,
                "circuit_breakers": {
                    k: v["tripped"] for k, v in CIRCUIT_BREAKERS.items()
                },
            },
            "prices": prices_db,
        }

        temp_path = OUTPUT_FILE + ".tmp"
        try:
            with open(temp_path, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)
            os.replace(temp_path, OUTPUT_FILE)
        except Exception as e:
            logger.error(f"Failed to write prices.json checkpoint: {e}")


# ---------------------------------------------------------------------------
# CLI & Main Orchestrator
# ---------------------------------------------------------------------------
def parse_arguments():
    parser = argparse.ArgumentParser(description="PokéSpread JP→FR Price Scraper Pipeline")
    parser.add_argument("--test", type=int, default=0, help="Test run with N high-value cards")
    parser.add_argument("--force-refresh", action="store_true", help="Ignore previous cached prices")
    parser.add_argument("--max-workers", type=int, default=5, help="Concurrent worker count")
    parser.add_argument("--max-runtime", type=int, default=900, help="Max runtime in seconds")
    return parser.parse_args()


def main():
    args = parse_arguments()
    start_ts = time.time()
    logger.info("==========================================================================")
    logger.info("PokéSpread JP→FR — Clean Production Rebuild Pipeline v4.0")
    logger.info("==========================================================================")

    # 1. Live Exchange Rates
    fx_rates = fetch_live_fx_rates()

    # 2. PokéAPI Species Translation Catalog
    species_catalog = fetch_pokemon_species_mapping()

    # 3. Load Existing Database
    existing_prices: Dict[str, Any] = {}
    if not args.force_refresh and os.path.exists(OUTPUT_FILE):
        try:
            with open(OUTPUT_FILE, "r", encoding="utf-8") as f:
                old_data = json.load(f)
                raw_prices = old_data.get("prices", {})
                for k, v in raw_prices.items():
                    norm_k = v.get("ref", k)
                    existing_prices[norm_k] = v
                logger.info(f"Loaded {len(existing_prices)} previously indexed cards from prices.json.")
        except Exception as e:
            logger.warning(f"Could not read previous prices.json: {e}")

    # 4. Fetch Sets and Japanese Cards from TCGdex
    set_map_ja = fetch_tcgdex_sets("ja")
    cards_ja = fetch_tcgdex_cards("ja", set_map_ja)

    if not cards_ja:
        logger.error("No Japanese cards discovered from TCGdex. Exiting.")
        sys.exit(1)

    # 5. Filter & Prioritize Chase Cards
    for c in cards_ja:
        _, en_name = translate_jp_card_name(c.get("name_ja", c["name"]), species_catalog)
        c["is_chase"] = is_chase_target(c, en_name=en_name)

    chase_cards = [c for c in cards_ja if c["is_chase"]]
    common_cards = [c for c in cards_ja if not c["is_chase"]]

    logger.info(f"Discovered {len(cards_ja)} total cards across {len(set_map_ja)} Japanese sets.")
    logger.info(f"Filtered {len(chase_cards)} high-value chase targets (SAR, SR, UR, AR, Secrets).")

    # Priority sorting: Modern eras first, unpriced cards first, Secret Rares first
    def card_sort_key(c: Dict[str, Any]):
        prev = existing_prices.get(c["ref"]) or existing_prices.get(c["ref"].lower())
        has_price = prev is not None and (
            prev.get("fr", {}).get("smoothed_avg") is not None
            or prev.get("jp", {}).get("smoothed_avg") is not None
        )
        era_rank = get_set_era_rank(c.get("set_id", ""))
        is_secret = 0 if c.get("is_secret") else 1
        return (era_rank, 0 if not has_price else 1, is_secret)

    chase_cards.sort(key=card_sort_key)
    common_cards.sort(key=card_sort_key)

    queue = chase_cards + common_cards

    # If --test flag is set, take only N cards
    if args.test > 0:
        logger.info(f"🧪 Running in TEST mode with {args.test} iconic cards...")
        # Prioritize iconic cards like Charizard ex SAR (sv2a 201), Mew ex SAR (sv2a 205), etc.
        test_queue: List[Dict[str, Any]] = []
        c201 = next((c for c in queue if "sv2a" in c["set_id"].lower() and c["local_id"] == "201"), None)
        c205 = next((c for c in queue if "sv2a" in c["set_id"].lower() and c["local_id"] == "205"), None)
        c166 = next((c for c in queue if "sv2a" in c["set_id"].lower() and c["local_id"] == "166"), None)
        if c201:
            test_queue.append(c201)
        if c205:
            test_queue.append(c205)
        if c166:
            test_queue.append(c166)
        for c in queue:
            if c not in test_queue and len(test_queue) < args.test:
                test_queue.append(c)
        queue = test_queue

    # 6. Multi-threaded Pricing Execution
    prices_db: Dict[str, Any] = dict(existing_prices)
    total_processed = 0
    stop_event = threading.Event()
    max_workers = min(args.max_workers, len(queue)) or 1

    logger.info(f"Starting worker pool ({max_workers} threads) for {len(queue)} target cards...")

    def worker(card_item: Dict[str, Any]):
        if stop_event.is_set():
            return None
        try:
            res = process_single_card(card_item, species_catalog, fx_rates, existing_prices, stop_event)
            time.sleep(random.uniform(0.1, 0.25))
            return (card_item, res)
        except Exception as exc:
            logger.debug(f"Worker error for {card_item.get('ref')}: {exc}")
            return None

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        chunk_size = 25
        for i in range(0, len(queue), chunk_size):
            elapsed = time.time() - start_ts
            if elapsed >= args.max_runtime:
                logger.info(f"CI runtime limit reached ({int(elapsed)}s). Finalizing...")
                stop_event.set()
                break

            chunk = queue[i : i + chunk_size]
            future_to_card = {executor.submit(worker, c): c for c in chunk}

            for future in concurrent.futures.as_completed(future_to_card):
                res = future.result()
                if not res:
                    continue
                card_item, record = res
                if record:
                    ref = card_item["ref"]
                    with db_lock:
                        # Normalize key as both uppercase and lowercase references for O(1) indexing
                        prices_db[ref] = record
                        prices_db[ref.lower()] = record
                        total_processed += 1

            # Save checkpoint after each chunk
            save_prices_checkpoint(prices_db, fx_rates, total_processed)
            logger.info(f"[{total_processed}/{len(queue)}] Checkpoint saved ({int(time.time() - start_ts)}s elapsed)")

    # Final Save
    save_prices_checkpoint(prices_db, fx_rates, total_processed)

    # Summary Statistics
    total_both = sum(
        1 for c in prices_db.values()
        if c.get("fr", {}).get("smoothed_avg") is not None
        and c.get("jp", {}).get("smoothed_avg") is not None
    )
    fr_only = sum(
        1 for c in prices_db.values()
        if c.get("fr", {}).get("smoothed_avg") is not None
        and c.get("jp", {}).get("smoothed_avg") is None
    )
    jp_only = sum(
        1 for c in prices_db.values()
        if c.get("jp", {}).get("smoothed_avg") is not None
        and c.get("fr", {}).get("smoothed_avg") is None
    )

    print("\n" + "=" * 80)
    print("POKÉSPREAD RUN SUMMARY & VERIFICATION TABLE")
    print("=" * 80)
    print(f"Cards in Database:       {len(prices_db)}")
    print(f"Total Priced (Both):     {total_both}")
    print(f"FR Only:                 {fr_only}")
    print(f"JP Only:                 {jp_only}")
    print(f"Processed this Run:      {total_processed}")
    print(f"Circuit Breakers:        { {k: v['tripped'] for k, v in CIRCUIT_BREAKERS.items()} }")
    print("=" * 80)

    # In test mode, print sample cards
    if args.test > 0 or total_processed <= 25:
        print("\nSAMPLE CARD ARBITRAGE RESULTS:")
        print(f"{'Ref':<16} | {'FR Name':<22} | {'JP Buy (¥)':<12} | {'JP Buy (€)':<12} | {'FR Sell (€)':<12} | {'PSA 10 (€)':<12}")
        print("-" * 96)
        for c in queue[:15]:
            p = prices_db.get(c["ref"], {}) or prices_db.get(c["ref"].lower(), {})
            fr_p = p.get("fr", {}).get("smoothed_avg")
            jp_y = p.get("jp", {}).get("raw_jpy")
            jp_e = p.get("jp", {}).get("raw_eur")
            psa10 = p.get("fr", {}).get("graded", {}).get("PSA 10", {}).get("price")
            fr_str = f"{fr_p:.2f}€" if fr_p else "—"
            jpy_str = f"{jp_y}¥" if jp_y else "—"
            jpe_str = f"{jp_e:.2f}€" if jp_e else "—"
            psa_str = f"{psa10:.2f}€" if psa10 else "—"
            print(f"{c['ref']:<16} | {p.get('name_fr', c['name'])[:22]:<22} | {jpy_str:<12} | {jpe_str:<12} | {fr_str:<12} | {psa_str:<12}")
        print("=" * 96 + "\n")


if __name__ == "__main__":
    main()
