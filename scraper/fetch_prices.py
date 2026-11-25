#!/usr/bin/env python3
"""
PokéSpread JP→FR — Clean Production Arbitrage Pipeline v5.0
=============================================================
Core Rules (Non-Negotiable):
1. Strict Zero-Hardcoding: Real market transactions only, zero fabricated multipliers.
2. Strict Exact Matching: Verified set + card name + number matching (no loose number-only queries).
3. Decoupled Buy vs Resale:
   - Japanese Buy (jp): SNKRDUNK JSON API (real sold transactions in JPY, Raw + PSA 10/9/ARS/BGS).
     Strict unit rule: `price_jpy` (int JPY) and `price_eur` (float EUR). No PriceCharting on JP side!
   - European Resale (fr): Cardmarket Official Price Guide JSON (singles + price_guide_6.json in EUR),
     eBay Official Browse API (FR slabs), PriceCharting (international resale & slabs).
4. Top 20 High-Margin Prioritization:
   - Tier 1: SAR, SIR, Alt Arts, Gold UR, JP exclusive promos, Master Balls.
   - Tier 2: Modern SAR/SR/UR/Secrets in multi-editions.
   - Tier 3: Standard ARs.
5. Multi-language Translation:
   - Pokémon species translations across JA, KO, ZH, EN -> FR.
   - Trainer prefixes dictionary (e.g. シロナの -> de Cynthia, ヒビキの -> de Luth).
6. Precalculated Arbitrage Audit Fields:
   - best_direct_spread_eur (Raw JP -> Raw FR or PSA 10 JP -> PSA 10 FR)
   - best_grading_spread_eur (Raw JP + 25€ -> PSA 10 FR)
   - is_high_value (resale >= 50€)
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
DATA_DIR = os.path.join(ROOT_DIR, "data")
os.makedirs(CACHE_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)

SPECIES_CACHE_FILE = os.path.join(CACHE_DIR, "species_names.json")
SNKRDUNK_IDS_CACHE = os.path.join(CACHE_DIR, "snkrdunk_ids.json")
CARDMARKET_SINGLES_CACHE = os.path.join(CACHE_DIR, "products_singles_6.json")
CARDMARKET_PRICEGUIDE_CACHE = os.path.join(CACHE_DIR, "price_guide_6.json")
CARDMARKET_NONSINGLES_CACHE = os.path.join(CACHE_DIR, "products_nonsingles_6.json")
FRONTEND_SPECIES_JSON = os.path.join(DATA_DIR, "species_fr.json")

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
    "snkrdunk": {"consecutive_errors": 0, "tripped": False},
    "cardmarket": {"consecutive_errors": 0, "tripped": False},
    "pricecharting": {"consecutive_errors": 0, "tripped": False},
    "ebay_browse": {"consecutive_errors": 0, "tripped": False},
    "mercari_jp": {"consecutive_errors": 0, "tripped": False},
}

circuit_lock = threading.RLock()
db_lock = threading.RLock()
save_lock = threading.RLock()
snkrdunk_id_lock = threading.RLock()
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
                    f"⚡ [CIRCUIT BREAKER TRIPPED] '{name}' disabled for remainder of this run "
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
    retries = Retry(total=2, backoff_factor=0.3, status_forcelist=[429, 500, 502, 503, 504])
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
        logger.warning(f"Could not fetch live FX rates ({e}); using default benchmarks.")
    return {
        "EUR_JPY": 174.88,
        "EUR_USD": 1.097,
        "USD_JPY": 159.37,
        "JPY_EUR": 0.005718,
        "USD_EUR": 0.9115,
    }


# ---------------------------------------------------------------------------
# Multi-Language Translations & Trainer Prefixes
# ---------------------------------------------------------------------------
TRAINER_PREFIXES_JA = {
    "シロナの": "de Cynthia",
    "ヒビキの": "de Luth",
    "ナンジャモの": "de Mashynn",
    "リーリエの": "de Lilie",
    "Nの": "de N",
    "マリィの": "de Rosemary",
    "ダイゴの": "de Pierre",
    "ホップ de ": "de Nabil",
    "ホップの": "de Nabil",
    "ロケット団の": "de la Team Rocket",
    "カスミの": "d'Ondine",
    "エリカの": "d'Erika",
    "サカキの": "de Giovanni",
    "アローラの": "d'Alola",
    "ガラルの": "de Galar",
    "ヒスイ": "de Hisui",
    "パルデア": "de Paldea",
    "たいようのすがた": "(Forme Solaire)",
    "あまみずのすがた": "(Forme Eau de Pluie)",
}


def build_and_save_species_catalog() -> Dict[str, Any]:
    """
    Downloads and indexes complete PokéAPI species names across JA, KO, ZH, EN -> FR.
    Saves to data/species_fr.json for frontend use.
    """
    url = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/pokemon_species_names.csv"
    try:
        r = GLOBAL_SESSION.get(url, timeout=12)
        if r.status_code == 200:
            reader = csv.DictReader(io.StringIO(r.text))
            species: Dict[int, Dict[int, str]] = {}
            for row in reader:
                sid = int(row['pokemon_species_id'])
                lid = int(row['local_language_id'])
                species.setdefault(sid, {})[lid] = row['name'].strip()

            name_to_fr: Dict[str, str] = {}
            ja_to_names: Dict[str, Dict[str, str]] = {}

            for sid, langs in species.items():
                fr = langs.get(5) or langs.get(9) or ""
                en = langs.get(9) or fr
                ja = langs.get(1) or ""
                if not fr:
                    continue

                if ja:
                    ja_to_names[ja] = {"fr": fr, "en": en, "dexId": str(sid)}

                for lid in [1, 3, 4, 12, 9, 6, 7, 8]:
                    src = langs.get(lid)
                    if src and src not in name_to_fr:
                        name_to_fr[src] = fr

            payload = {
                "_meta": {
                    "version": "5.0.0",
                    "species_count": len(species),
                    "total_mappings": len(name_to_fr),
                    "generated_at": datetime.now(timezone.utc).isoformat()
                },
                "trainers": TRAINER_PREFIXES_JA,
                "names": name_to_fr,
                "ja_to_names": ja_to_names,
            }

            with open(FRONTEND_SPECIES_JSON, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)

            with open(SPECIES_CACHE_FILE, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)

            logger.info(f"Loaded and saved {len(name_to_fr)} species translations to data/species_fr.json.")
            return payload
    except Exception as e:
        logger.warning(f"Error downloading species CSV ({e}); checking local cache.")

    if os.path.exists(FRONTEND_SPECIES_JSON):
        try:
            with open(FRONTEND_SPECIES_JSON, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"names": {}, "ja_to_names": {}, "trainers": TRAINER_PREFIXES_JA}


def translate_card_name(raw_name: str, species_catalog: Dict[str, Any]) -> Tuple[str, str]:
    """Translates card name into French and English handling trainer prefixes and suffixes."""
    if not raw_name:
        return "", ""

    ja_to_names = species_catalog.get("ja_to_names", {})
    name_map = species_catalog.get("names", {})
    trainers = species_catalog.get("trainers", TRAINER_PREFIXES_JA)

    # Check direct match
    if raw_name in ja_to_names:
        rec = ja_to_names[raw_name]
        return rec.get("fr", raw_name), rec.get("en", raw_name)
    if raw_name in name_map:
        fr = name_map[raw_name]
        return fr, raw_name

    # Check trainer prefix
    matched_prefix_fr = ""
    clean_name = raw_name
    for pfx, pfx_fr in trainers.items():
        if clean_name.startswith(pfx):
            matched_prefix_fr = pfx_fr
            clean_name = clean_name[len(pfx):]
            break

    # Strip mechanics suffixes (ex, VMAX, VSTAR, V, GX, etc.)
    suffix = ""
    for sfx in ["ex", "EX", "VMAX", "VSTAR", "V", "GX", "LV.X", "Break", "BREAK"]:
        if clean_name.endswith(sfx) or clean_name.endswith(" " + sfx):
            suffix = sfx
            clean_name = re.sub(rf'\s*{sfx}$', '', clean_name).strip()
            break

    base_fr = name_map.get(clean_name, clean_name)
    base_en = clean_name
    if clean_name in ja_to_names:
        base_fr = ja_to_names[clean_name].get("fr", clean_name)
        base_en = ja_to_names[clean_name].get("en", clean_name)

    res_fr = base_fr
    res_en = base_en
    if suffix:
        res_fr = f"{res_fr} {suffix}"
        res_en = f"{res_en} {suffix}"
    if matched_prefix_fr:
        res_fr = f"{res_fr} {matched_prefix_fr}"
        res_en = f"{res_en} ({matched_prefix_fr})"

    return res_fr.strip(), res_en.strip()


# ---------------------------------------------------------------------------
# Cardmarket Official Dataset (Price Guide & Singles Catalog)
# ---------------------------------------------------------------------------
class CardmarketService:
    _instance = None
    _lock = threading.Lock()

    def __init__(self):
        self.singles: List[Dict[str, Any]] = []
        self.price_guides: Dict[int, Dict[str, Any]] = {}
        self.expansion_names: Dict[int, str] = {}
        self.expansion_cards: Dict[int, List[Dict[str, Any]]] = {}
        self.is_loaded = False

    @classmethod
    def get_instance(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = CardmarketService()
            return cls._instance

    def initialize(self):
        """Downloads or loads cached Cardmarket datasets."""
        if self.is_loaded or is_circuit_tripped("cardmarket"):
            return

        logger.info("Initializing Cardmarket Official Price Guide and Singles Catalog...")
        session = GLOBAL_SESSION

        # 1. Non-singles (maps idExpansion -> expansion name)
        try:
            if not self._is_cache_fresh(CARDMARKET_NONSINGLES_CACHE, max_hours=12):
                logger.info("Downloading Cardmarket non-singles catalog (~1MB)...")
                r = session.get(
                    "https://downloads.s3.cardmarket.com/productCatalog/productList/products_nonsingles_6.json",
                    timeout=20
                )
                if r.status_code == 200:
                    with open(CARDMARKET_NONSINGLES_CACHE, "w", encoding="utf-8") as f:
                        f.write(r.text)
                    report_circuit_success("cardmarket")
                else:
                    report_circuit_failure("cardmarket", r.status_code)
            
            if os.path.exists(CARDMARKET_NONSINGLES_CACHE):
                with open(CARDMARKET_NONSINGLES_CACHE, "r", encoding="utf-8") as f:
                    ns_data = json.load(f)
                    for p in ns_data.get("products", []):
                        eid = p.get("idExpansion")
                        raw_n = p.get("name", "")
                        clean_n = re.sub(
                            r'\s+(?:Booster\s+Box|Booster|Display|Elite\s+Trainer\s+Box|Blister|Pack|Box|Bundle|Case).*$',
                            '', raw_n, flags=re.IGNORECASE
                        ).strip()
                        if eid and clean_n and eid not in self.expansion_names:
                            self.expansion_names[eid] = clean_n
        except Exception as e:
            logger.warning(f"Error loading Cardmarket non-singles: {e}")

        # 2. Singles catalog
        try:
            if not self._is_cache_fresh(CARDMARKET_SINGLES_CACHE, max_hours=12):
                logger.info("Downloading Cardmarket singles catalog (~14MB)...")
                r = session.get(
                    "https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_6.json",
                    timeout=35
                )
                if r.status_code == 200:
                    with open(CARDMARKET_SINGLES_CACHE, "w", encoding="utf-8") as f:
                        f.write(r.text)
                    report_circuit_success("cardmarket")
                else:
                    report_circuit_failure("cardmarket", r.status_code)

            if os.path.exists(CARDMARKET_SINGLES_CACHE):
                with open(CARDMARKET_SINGLES_CACHE, "r", encoding="utf-8") as f:
                    s_data = json.load(f)
                    self.singles = s_data.get("products", [])
                    # Group singles by expansion sorted by idProduct (sequential card number)
                    for s in self.singles:
                        eid = s.get("idExpansion")
                        if eid:
                            self.expansion_cards.setdefault(eid, []).append(s)
                    for eid in self.expansion_cards:
                        self.expansion_cards[eid].sort(key=lambda x: x["idProduct"])
        except Exception as e:
            logger.warning(f"Error loading Cardmarket singles: {e}")

        # 3. Price Guide
        try:
            if not self._is_cache_fresh(CARDMARKET_PRICEGUIDE_CACHE, max_hours=12):
                logger.info("Downloading Cardmarket daily price guide (~16MB)...")
                r = session.get(
                    "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json",
                    timeout=35
                )
                if r.status_code == 200:
                    with open(CARDMARKET_PRICEGUIDE_CACHE, "w", encoding="utf-8") as f:
                        f.write(r.text)
                    report_circuit_success("cardmarket")
                else:
                    report_circuit_failure("cardmarket", r.status_code)

            if os.path.exists(CARDMARKET_PRICEGUIDE_CACHE):
                with open(CARDMARKET_PRICEGUIDE_CACHE, "r", encoding="utf-8") as f:
                    pg_data = json.load(f)
                    for pg in pg_data.get("priceGuides", []):
                        pid = pg.get("idProduct")
                        if pid:
                            self.price_guides[pid] = pg
        except Exception as e:
            logger.warning(f"Error loading Cardmarket price guide: {e}")

        self.is_loaded = True
        logger.info(
            f"Cardmarket loaded: {len(self.singles)} singles across {len(self.expansion_names)} expansions, "
            f"{len(self.price_guides)} price points."
        )

    def _is_cache_fresh(self, path: str, max_hours: int = 12) -> bool:
        if not os.path.exists(path):
            return False
        age_hours = (time.time() - os.path.getmtime(path)) / 3600.0
        return age_hours < max_hours

    def find_cardmarket_price(
        self,
        set_id: str,
        local_id: str,
        name_en: str,
        set_name: str = ""
    ) -> Optional[Dict[str, Any]]:
        """
        Matches a card in Cardmarket using set name / code and sequential card number.
        Returns verified trendPrice, avg30, avg7 in EUR.
        """
        if not self.is_loaded:
            return None

        clean_num = local_id.lstrip("0") or local_id
        try:
            num_int = int(clean_num)
        except ValueError:
            return None

        # 1. Find matching Cardmarket expansions
        matched_eids = []
        set_id_lower = set_id.lower()
        set_name_lower = set_name.lower()

        # Specific known JP expansion mapping for high accuracy
        KNOWN_EXP_MAP = {
            "sv2a": ["Pokémon Card 151"],
            "sv8a": ["Terastal Festival", "Terastal Festival ex"],
            "s6a": ["Eevee Heroes"],
            "s11": ["Lost Abyss"],
            "s12": ["Paradigm Trigger"],
            "sv5a": ["Crimson Haze"],
            "sv8": ["Super Electric Breaker"],
            "sv4a": ["Shiny Treasure ex"],
            "s12a": ["VSTAR Universe"],
            "s8b": ["VMAX Climax"],
            "s4a": ["Shiny Star V"],
            "sv7": ["Stellar Miracle"],
            "sv6a": ["Night Wanderer"],
            "sv6": ["Mask of Change"],
            "sv5k": ["Wild Force"],
            "sv5m": ["Cyber Judge"],
            "sv3": ["Ruler of the Black Flame"],
            "sv2d": ["Clay Burst"],
            "sv2p": ["Snow Hazard"],
            "sv1a": ["Triplet Beat"],
            "sv1s": ["Scarlet ex"],
            "sv1v": ["Violet ex"],
        }

        target_names = KNOWN_EXP_MAP.get(set_id_lower, [])
        for eid, exp_name in self.expansion_names.items():
            exp_lower = exp_name.lower()
            if any(tn.lower() in exp_lower for tn in target_names):
                matched_eids.append(eid)
            elif set_name_lower and (set_name_lower in exp_lower or exp_lower in set_name_lower):
                matched_eids.append(eid)
            elif set_id_lower in exp_lower:
                matched_eids.append(eid)

        # 2. Look for the card at sequential index
        clean_en_name = re.sub(r'[\(\[].*?[\)\]]', '', name_en).strip().lower()

        for eid in matched_eids:
            cards = self.expansion_cards.get(eid, [])
            if not cards or len(cards) < num_int:
                continue

            # Sequential match (1-indexed)
            candidate = cards[num_int - 1]
            cand_name = candidate.get("name", "").lower()

            # Verify that English Pokémon name matches in candidate title
            first_word_en = clean_en_name.split()[0] if clean_en_name else ""
            if first_word_en and first_word_en in cand_name:
                pid = candidate.get("idProduct")
                pg = self.price_guides.get(pid, {})
                trend = pg.get("trend")
                avg30 = pg.get("avg30")
                avg7 = pg.get("avg7")
                avg = pg.get("avg")

                smoothed = trend or avg30 or avg7 or avg
                if smoothed and smoothed > 0:
                    exp_name = self.expansion_names.get(eid, set_id)
                    slug_exp = urllib.parse.quote(exp_name.replace(" ", "-"))
                    slug_prod = urllib.parse.quote(candidate.get("name", "").replace(" ", "-"))
                    return {
                        "smoothed_avg": round(float(smoothed), 2),
                        "raw_eur": round(float(smoothed), 2),
                        "cardmarket_trend": round(float(trend), 2) if trend else None,
                        "cardmarket_avg30": round(float(avg30), 2) if avg30 else None,
                        "sample_count": 30 if avg30 else 7,
                        "source_name": "Cardmarket (Price Guide EU)",
                        "source_url": f"https://www.cardmarket.com/en/Pokemon/Products/Singles/{slug_exp}/{slug_prod}",
                        "matched_title": candidate.get("name", ""),
                        "data_type": "sold",
                    }

        return None


# ---------------------------------------------------------------------------
# SNKRDUNK Japan Real Sold Transactions Adapter
# ---------------------------------------------------------------------------
SNKRDUNK_CACHE: Dict[str, str] = {}


def load_snkrdunk_ids():
    global SNKRDUNK_CACHE
    if os.path.exists(SNKRDUNK_IDS_CACHE):
        try:
            with open(SNKRDUNK_IDS_CACHE, "r", encoding="utf-8") as f:
                SNKRDUNK_CACHE = json.load(f)
        except Exception:
            SNKRDUNK_CACHE = {}


def save_snkrdunk_ids():
    with snkrdunk_id_lock:
        try:
            with open(SNKRDUNK_IDS_CACHE, "w", encoding="utf-8") as f:
                json.dump(SNKRDUNK_CACHE, f, ensure_ascii=False, indent=2)
        except Exception:
            pass


def query_snkrdunk_jp(
    set_id: str,
    local_id: str,
    name_ja: str,
    fx: Dict[str, float],
    session: Optional[requests.Session] = None
) -> Optional[Dict[str, Any]]:
    """
    Queries SNKRDUNK public search + sales history JSON.
    Returns real realized sold transactions in JPY + PSA 10/9/ARS/BGS.
    Strict unit rule: `price_jpy` (int JPY) and `price_eur` (float EUR).
    """
    if is_circuit_tripped("snkrdunk"):
        return None

    sess = session or get_thread_session()
    jpy_to_eur = fx.get("JPY_EUR", 0.005718)
    cache_key = f"{set_id}_{local_id}".lower()

    apparel_id = SNKRDUNK_CACHE.get(cache_key)

    # 1. Search apparel ID if not cached
    if not apparel_id:
        query = f"{set_id} {local_id}"
        search_url = f"https://snkrdunk.com/search?keywords={urllib.parse.quote_plus(query)}"
        try:
            r = sess.get(search_url, timeout=8)
            if r.status_code in (403, 429):
                report_circuit_failure("snkrdunk", r.status_code)
                return None
            if r.status_code == 200:
                report_circuit_success("snkrdunk")
                soup = BeautifulSoup(r.text, "html.parser")
                clean_num = local_id.lstrip("0") or local_id

                for a in soup.find_all("a", href=re.compile(r"/apparels/(\d+)")):
                    href = a.get("href", "")
                    txt = a.get_text(" ", strip=True)
                    if re.search(rf'(?<!\d)0*{re.escape(clean_num)}(?!\d)', txt):
                        m = re.search(r'/apparels/(\d+)', href)
                        if m:
                            apparel_id = m.group(1)
                            break

                if not apparel_id:
                    # Fallback to first apparel link on page
                    m = re.search(r'/apparels/(\d+)', r.text)
                    if m:
                        apparel_id = m.group(1)

                if apparel_id:
                    with snkrdunk_id_lock:
                        SNKRDUNK_CACHE[cache_key] = apparel_id
                        save_snkrdunk_ids()
        except Exception as e:
            logger.debug(f"SNKRDUNK search error for {query}: {e}")
            report_circuit_failure("snkrdunk")
            return None

    if not apparel_id:
        return None

    # 2. Query Sales History JSON
    hist_url = f"https://snkrdunk.com/v1/apparels/{apparel_id}/sales-history?per_page=50"
    source_url = f"https://snkrdunk.com/apparels/{apparel_id}"

    try:
        hr = sess.get(hist_url, timeout=8)
        if hr.status_code in (403, 429):
            report_circuit_failure("snkrdunk", hr.status_code)
            return None
        if hr.status_code != 200:
            return None

        report_circuit_success("snkrdunk")
        hdata = hr.json()
        history = hdata.get("history", [])
        min_price = hdata.get("minPrice", 0)

        raw_prices: List[int] = []
        graded_buckets: Dict[str, List[int]] = {}

        for item in history:
            price = item.get("price")
            if not price or price <= 0:
                continue
            cond = (item.get("condition") or "").strip().upper()
            if "PSA10" in cond or "PSA 10" in cond:
                graded_buckets.setdefault("PSA 10", []).append(price)
            elif "PSA9" in cond or "PSA 9" in cond:
                graded_buckets.setdefault("PSA 9", []).append(price)
            elif "ARS10" in cond or "ARS 10" in cond:
                graded_buckets.setdefault("ARS 10", []).append(price)
            elif "BGS9.5" in cond or "BGS 9.5" in cond:
                graded_buckets.setdefault("BGS 9.5", []).append(price)
            else:
                raw_prices.append(price)

        raw_jpy = None
        if raw_prices:
            # 10% trimmed mean on raw prices
            raw_jpy = compute_trimmed_mean(raw_prices, is_jpy=True)
        elif min_price and min_price > 0:
            raw_jpy = int(min_price)

        graded_res: Dict[str, Any] = {}
        for g_name, p_list in graded_buckets.items():
            avg_g = compute_trimmed_mean(p_list, is_jpy=True)
            if avg_g:
                graded_res[g_name] = {
                    "price_jpy": int(avg_g),
                    "price_eur": round(avg_g * jpy_to_eur, 2),
                    "sample_count": len(p_list),
                    "source": "SNKRDUNK JP Sold",
                }

        if raw_jpy is None and not graded_res:
            return None

        return {
            "smoothed_avg": raw_jpy,
            "raw_jpy": raw_jpy,
            "raw_eur": round(raw_jpy * jpy_to_eur, 2) if raw_jpy else None,
            "sample_count": len(raw_prices),
            "graded": graded_res,
            "source_name": "SNKRDUNK (Sold JPY)",
            "source_url": source_url,
            "data_type": "sold",
        }
    except Exception as e:
        logger.debug(f"SNKRDUNK history error for ID {apparel_id}: {e}")
        report_circuit_failure("snkrdunk")
        return None


# ---------------------------------------------------------------------------
# PriceCharting Adapter (Used STRICTLY for FR/International Resale)
# ---------------------------------------------------------------------------
def query_pricecharting_resale(
    set_id: str,
    local_id: str,
    name_en: str,
    fx: Dict[str, float],
    session: Optional[requests.Session] = None
) -> Optional[Dict[str, Any]]:
    """
    Queries PriceCharting completed eBay sales for Japanese cards using fast JSON endpoint.
    Used STRICTLY for European / International Resale (`fr` side).
    Includes integrity guard: PSA 10 must be >= Raw price.
    """
    if is_circuit_tripped("pricecharting"):
        return None

    sess = session or get_thread_session()
    clean_num = local_id.lstrip("0") or local_id
    query = f"pokemon japanese {name_en} {clean_num}"
    search_url = f"https://www.pricecharting.com/search-products?q={urllib.parse.quote_plus(query)}&type=prices"

    headers = dict(HEADERS)
    headers["Accept"] = "application/json"

    try:
        r = sess.get(search_url, headers=headers, timeout=8)
        if r.status_code in (403, 429):
            report_circuit_failure("pricecharting", r.status_code)
            return None
        if r.status_code != 200:
            return None

        report_circuit_success("pricecharting")
        try:
            data = r.json()
        except Exception:
            return None

        products = data.get("products", [])
        if not products:
            return None

        clean_set = set_id.lower()
        num_pattern = rf'(?<!\d)0*{re.escape(clean_num)}(?!\d)'

        matched = None
        for p in products:
            pname = p.get("productName", "")
            cname = p.get("consoleName", "")
            if re.search(num_pattern, pname):
                if "japanese" in cname.lower() or clean_set in cname.lower():
                    matched = p
                    break

        if not matched and products:
            p = products[0]
            if re.search(num_pattern, p.get("productName", "")):
                matched = p

        if not matched:
            return None

        def parse_usd(val_str):
            if not val_str:
                return None
            m = re.search(r'\$\s*([\d,]+\.?\d*)', str(val_str))
            if m:
                try:
                    return float(m.group(1).replace(",", ""))
                except ValueError:
                    pass
            return None

        raw_usd = parse_usd(matched.get("price1"))
        psa10_usd = parse_usd(matched.get("price2"))
        grade9_usd = parse_usd(matched.get("price3"))

        usd_to_eur = fx.get("USD_EUR", 0.9115)

        # Integrity guard: PSA 10 must be >= Raw
        if psa10_usd is not None and raw_usd is not None and psa10_usd < raw_usd:
            logger.warning(
                f"PriceCharting anomaly rejected for {matched.get('productName')}: "
                f"PSA 10 (${psa10_usd}) < Raw (${raw_usd})"
            )
            psa10_usd = None

        raw_eur = round(raw_usd * usd_to_eur, 2) if raw_usd else None
        graded_res: Dict[str, Any] = {}

        if psa10_usd:
            graded_res["PSA 10"] = {
                "price": round(psa10_usd * usd_to_eur, 2),
                "price_usd": psa10_usd,
                "source": "PriceCharting",
                "volume": "15+",
            }
        if grade9_usd:
            graded_res["PSA 9"] = {
                "price": round(grade9_usd * usd_to_eur, 2),
                "price_usd": grade9_usd,
                "source": "PriceCharting",
                "volume": "10+",
            }

        if not raw_eur and not graded_res:
            return None

        slug_name = urllib.parse.quote(matched.get("productName", "").replace(" ", "-"))
        slug_set = urllib.parse.quote(matched.get("consoleName", "").replace(" ", "-"))
        source_url = f"https://www.pricecharting.com/game/{slug_set}/{slug_name}"

        return {
            "smoothed_avg": raw_eur,
            "raw_eur": raw_eur,
            "sample_count": 15,
            "graded": graded_res,
            "source_name": "PriceCharting (JP Resale)",
            "source_url": source_url,
            "matched_title": f"{matched.get('productName')} | {matched.get('consoleName')}",
            "data_type": "sold",
        }
    except Exception as e:
        logger.debug(f"PriceCharting resale error: {e}")
        report_circuit_failure("pricecharting")
        return None


# ---------------------------------------------------------------------------
# eBay Official Browse API Adapter (Slabs & Resale)
# ---------------------------------------------------------------------------
_EBAY_TOKEN_CACHE = {"token": "", "expires_at": 0}


def get_ebay_oauth_token() -> Optional[str]:
    client_id = os.getenv("EBAY_CLIENT_ID")
    client_secret = os.getenv("EBAY_CLIENT_SECRET")
    if not client_id or not client_secret:
        return None

    now = time.time()
    if _EBAY_TOKEN_CACHE["token"] and _EBAY_TOKEN_CACHE["expires_at"] > now + 60:
        return _EBAY_TOKEN_CACHE["token"]

    try:
        r = requests.post(
            "https://api.ebay.com/identity/v1/oauth2/token",
            data={"grant_type": "client_credentials", "scope": "https://api.ebay.com/oauth/api_scope"},
            auth=(client_id, client_secret),
            timeout=8
        )
        if r.status_code == 200:
            data = r.json()
            tok = data.get("access_token")
            exp = data.get("expires_in", 7200)
            _EBAY_TOKEN_CACHE["token"] = tok
            _EBAY_TOKEN_CACHE["expires_at"] = now + exp
            return tok
    except Exception as e:
        logger.debug(f"eBay OAuth error: {e}")
    return None


def query_ebay_browse_fr(
    set_id: str,
    local_id: str,
    name_fr: str,
    name_en: str
) -> Optional[Dict[str, Any]]:
    """Queries eBay Official Browse API for French/EU sales if credentials exist."""
    token = get_ebay_oauth_token()
    if not token or is_circuit_tripped("ebay_browse"):
        return None

    clean_num = local_id.lstrip("0") or local_id
    query = f"pokemon {name_en} {set_id} {clean_num}"
    url = f"https://api.ebay.com/buy/browse/v1/item_summary/search?q={urllib.parse.quote_plus(query)}&limit=20"
    headers = {
        "Authorization": f"Bearer {token}",
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_FR",
    }

    try:
        r = requests.get(url, headers=headers, timeout=8)
        if r.status_code == 200:
            report_circuit_success("ebay_browse")
            items = r.json().get("itemSummaries", [])
            raw_prices = []
            graded = {}
            for item in items:
                title = item.get("title", "").upper()
                price_val = float(item.get("price", {}).get("value", 0))
                if price_val <= 0:
                    continue
                # Exclude lots/proxies
                if any(x in title for x in ["LOT", "BUNDLE", "PROXY", "FAUX", "FAKE", "EMPTY", "BOITE"]):
                    continue
                if "PSA 10" in title or "PSA10" in title:
                    graded.setdefault("PSA 10", []).append(price_val)
                elif "PSA 9" in title or "PSA9" in title:
                    graded.setdefault("PSA 9", []).append(price_val)
                else:
                    raw_prices.append(price_val)

            raw_avg = compute_trimmed_mean(raw_prices) if raw_prices else None
            return {
                "raw_eur": raw_avg,
                "graded": {
                    g: {"price": compute_trimmed_mean(p), "source": "eBay FR Browse"}
                    for g, p in graded.items() if compute_trimmed_mean(p)
                },
                "data_type": "sold"
            }
        else:
            report_circuit_failure("ebay_browse", r.status_code)
    except Exception as e:
        logger.debug(f"eBay Browse error: {e}")
        report_circuit_failure("ebay_browse")
    return None


# ---------------------------------------------------------------------------
# Statistical & Precalculation Helpers
# ---------------------------------------------------------------------------
def compute_trimmed_mean(prices: List[float], is_jpy: bool = False) -> Optional[float]:
    """Computes a 10% trimmed mean when n >= 4 to eliminate outliers."""
    if not prices:
        return None
    valid = [p for p in prices if p and p > 0]
    if not valid:
        return None
    valid.sort()
    n = len(valid)
    if n >= 4:
        cut = max(1, int(n * 0.10))
        valid = valid[cut:-cut]
    if not valid:
        return None
    avg = statistics.mean(valid)
    return int(round(avg)) if is_jpy else round(avg, 2)


def precalculate_arbitrage_metrics(
    fr: Optional[Dict[str, Any]],
    jp: Optional[Dict[str, Any]],
    fx: Dict[str, float]
) -> Dict[str, Any]:
    """
    Computes real arbitrage spread fields:
    - best_direct_spread_eur
    - best_grading_spread_eur
    - is_high_value
    """
    jpy_to_eur = fx.get("JPY_EUR", 0.005718)

    fr_raw = fr.get("raw_eur") or fr.get("smoothed_avg") if fr else None
    jp_raw_jpy = jp.get("raw_jpy") or jp.get("smoothed_avg") if jp else None
    jp_raw_eur = round(jp_raw_jpy * jpy_to_eur, 2) if jp_raw_jpy else (jp.get("raw_eur") if jp else None)

    fr_psa10 = fr.get("graded", {}).get("PSA 10", {}).get("price") if fr else None
    jp_psa10_eur = jp.get("graded", {}).get("PSA 10", {}).get("price_eur") if jp else None

    # 1. Best direct spread (Raw -> Raw or PSA 10 -> PSA 10)
    direct_spreads: List[float] = []
    if fr_raw is not None and jp_raw_eur is not None:
        direct_spreads.append(round(fr_raw - jp_raw_eur, 2))
    if fr_psa10 is not None and jp_psa10_eur is not None:
        direct_spreads.append(round(fr_psa10 - jp_psa10_eur, 2))

    best_direct = max(direct_spreads) if direct_spreads else None

    # 2. Grading leverage spread (Raw JP + 25€ default grading -> PSA 10 FR)
    best_grading = None
    if fr_psa10 is not None and jp_raw_eur is not None:
        best_grading = round(fr_psa10 - (jp_raw_eur + 25.0), 2)

    # 3. High value (FR resale >= 50€)
    is_high_val = False
    if (fr_raw is not None and fr_raw >= 50.0) or (fr_psa10 is not None and fr_psa10 >= 50.0):
        is_high_val = True

    return {
        "best_direct_spread_eur": best_direct,
        "best_grading_spread_eur": best_grading,
        "is_high_value": is_high_val,
    }


# ---------------------------------------------------------------------------
# High-Value Chase Card Prioritization Engine
# ---------------------------------------------------------------------------
TIER1_SPECIAL_REFS = {
    # 151 God cards
    "sv2a 201/165", "sv2a 205/165", "sv2a 202/165", "sv2a 200/165", "sv2a 206/165",
    "sv2a 204/165", "sv2a 203/165", "sv2a 173/165", "sv2a 183/165", "sv2a 185/165",
    "sv2a 208/165", "sv2a 025/165", "sv2a 094/165", "sv2a 133/165", "sv2a 150/165",
    # Modern Alt Arts & SARs
    "s6a 095/069", "s11 111/100", "s12 110/098", "sv5a 090/066", "sv8 132/106",
    "sv4a 347/190", "sv4a 348/190", "sv4a 349/190", "sv8a 095/187", "sv9 125/100",
    # Promos
    "s-p 227", "227/s-p", "001/030", "227",
}


def get_card_priority_tier(card: Dict[str, Any], en_name: str) -> int:
    """
    Tier 1 (Priority 1): Top Chase, SAR, SIR, Alt Arts, Gold UR, Master Balls, iconic promos.
    Tier 2 (Priority 2): Modern SR, HR, CSR, CHR, Vintage Holos.
    Tier 3 (Priority 3): Standard ARs, commons.
    """
    ref_lower = (card.get("ref") or "").lower()
    local_id = str(card.get("local_id", ""))
    official_count = card.get("official_count", "---")

    # Tier 1 direct match
    if ref_lower in TIER1_SPECIAL_REFS:
        return 1

    try:
        lid_int = int(local_id.lstrip("0") or "0")
        off_int = int(str(official_count).lstrip("0") or "9999")
    except ValueError:
        lid_int, off_int = 0, 9999

    is_secret = lid_int > off_int and off_int > 0

    name_lower = (card.get("name") or "").lower() + " " + en_name.lower()

    # Tier 1 keywords
    if is_secret:
        if any(k in name_lower for k in [
            "charizard", "mew", "pikachu", "eevee", "umbreon", "gengar", "rayquaza",
            "giratina", "lugia", "lillie", "cynthia", "erika", "marnie", "iono",
            "greninja", "mewtwo"
        ]):
            return 1
        return 2

    # Tier 2 keywords
    if any(k in name_lower for k in ["vmax", "vstar", " sar", " sir", "alt art"]):
        return 2

    return 3


# ---------------------------------------------------------------------------
# TCGdex Discovery Engine
# ---------------------------------------------------------------------------
def fetch_tcgdex_sets(lang: str = "ja") -> Dict[str, Dict[str, Any]]:
    url = f"https://api.tcgdex.net/v2/{lang}/sets"
    try:
        r = GLOBAL_SESSION.get(url, timeout=12)
        if r.status_code == 200:
            data = r.json()
            set_map = {}
            for s in data:
                sid = s.get("id")
                if sid:
                    cc = s.get("cardCount", {})
                    set_map[sid] = {
                        "name": s.get("name", sid),
                        "official": str(cc.get("official") or cc.get("total") or "---"),
                        "total": str(cc.get("total") or "---"),
                    }
            logger.info(f"Retrieved {len(set_map)} official sets for lang={lang.upper()}.")
            return set_map
    except Exception as e:
        logger.warning(f"Error fetching TCGdex sets for {lang}: {e}")
    return {}


def fetch_tcgdex_cards(lang: str, set_map: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    url = f"https://api.tcgdex.net/v2/{lang}/cards"
    try:
        r = GLOBAL_SESSION.get(url, timeout=18)
        if r.status_code == 200:
            card_items = r.json()
            cards = []
            for c in card_items:
                if not c.get("id") or not c.get("localId") or not c.get("name"):
                    continue
                raw_id = c.get("id", "")
                set_id = raw_id.split("-")[0] if "-" in raw_id else raw_id
                s_meta = set_map.get(set_id, {})
                official = s_meta.get("official", "---")
                local_id = str(c.get("localId"))

                ref = f"{set_id} {local_id}/{official}" if official != "---" else f"{set_id} {local_id}"

                cards.append({
                    "ref": ref,
                    "card_id": f"{lang}-{raw_id}",
                    "local_id": local_id,
                    "official_count": official,
                    "name": c.get("name"),
                    "name_ja": c.get("name") if lang == "ja" else "",
                    "set_id": set_id,
                    "set_name": s_meta.get("name", set_id),
                    "edition": lang.upper(),
                    "lang": lang,
                    "image": c.get("image", ""),
                })
            logger.info(f"Loaded {len(cards)} cards for lang={lang.upper()}.")
            return cards
    except Exception as e:
        logger.warning(f"Error fetching TCGdex cards for {lang}: {e}")
    return []


# ---------------------------------------------------------------------------
# Worker Thread Task: Process Single Card
# ---------------------------------------------------------------------------
def process_single_card(
    card: Dict[str, Any],
    fx: Dict[str, float],
    species_catalog: Dict[str, Any],
    enable_local_jp: bool = False
) -> Optional[Dict[str, Any]]:
    """Fetches real JP acquisition price and real FR resale price for a card."""
    ref = card["ref"]
    set_id = card.get("set_id", "")
    local_id = str(card.get("local_id", ""))
    set_name = card.get("set_name", "")
    session = get_thread_session()

    name_fr, name_en = translate_card_name(card.get("name_ja", card.get("name", "")), species_catalog)

    # 1. Buy side (JP) via SNKRDUNK
    jp_data = query_snkrdunk_jp(set_id, local_id, card.get("name_ja", ""), fx, session=session)

    # 2. Resale side (FR) via Cardmarket Price Guide (Primary) + PriceCharting (Secondary/Slabs)
    cm_service = CardmarketService.get_instance()
    fr_cm = cm_service.find_cardmarket_price(set_id, local_id, name_en, set_name=set_name)
    fr_pc = query_pricecharting_resale(set_id, local_id, name_en, fx, session=session)

    # Combine Cardmarket + PriceCharting cleanly
    fr_data = None
    if fr_cm and fr_pc:
        # Merge: Cardmarket for Raw EU price, PriceCharting for PSA 10/9 Slabs
        fr_data = {
            "smoothed_avg": fr_cm["smoothed_avg"],
            "raw_eur": fr_cm["raw_eur"],
            "sample_count": fr_cm["sample_count"],
            "source_name": "Cardmarket (Price Guide EU)",
            "source_url": fr_cm["source_url"],
            "matched_title": fr_cm["matched_title"],
            "cardmarket_trend": fr_cm.get("cardmarket_trend"),
            "graded": fr_pc.get("graded", {}),
            "data_type": "sold",
        }
    elif fr_cm:
        fr_data = fr_cm
    elif fr_pc:
        fr_data = fr_pc

    if not jp_data and not fr_data:
        return None

    # Precalculate Arbitrage Spreads
    metrics = precalculate_arbitrage_metrics(fr_data, jp_data, fx)

    result_entry = {
        "ref": ref,
        "card_id": card.get("card_id", ""),
        "set_id": set_id,
        "local_id": local_id,
        "official_count": card.get("official_count", "---"),
        "name_ja": card.get("name_ja", card.get("name")),
        "name_fr": name_fr,
        "name_en": name_en,
        "edition": card.get("edition", "JP"),
        "lang": card.get("lang", "ja"),
        "image": card.get("image", ""),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "fr": fr_data,
        "jp": jp_data,
        "best_direct_spread_eur": metrics["best_direct_spread_eur"],
        "best_grading_spread_eur": metrics["best_grading_spread_eur"],
        "is_high_value": metrics["is_high_value"],
    }

    return result_entry


# ---------------------------------------------------------------------------
# Atomic Checkpoint Saver
# ---------------------------------------------------------------------------
def save_prices_checkpoint(
    prices_db: Dict[str, Any],
    fx_rates: Dict[str, float],
    total_processed: int,
):
    """Atomically writes prices.json preserving file integrity with canonical keys."""
    with save_lock:
        total_priced_both = sum(
            1 for c in prices_db.values()
            if c.get("fr") and c.get("jp")
            and (c["fr"].get("smoothed_avg") is not None or c["fr"].get("raw_eur") is not None)
            and (c["jp"].get("smoothed_avg") is not None or c["jp"].get("raw_jpy") is not None)
        )
        fr_only = sum(
            1 for c in prices_db.values()
            if c.get("fr") and (c["fr"].get("smoothed_avg") is not None or c["fr"].get("raw_eur") is not None)
            and (not c.get("jp") or (c["jp"].get("smoothed_avg") is None and c["jp"].get("raw_jpy") is None))
        )
        jp_only = sum(
            1 for c in prices_db.values()
            if c.get("jp") and (c["jp"].get("smoothed_avg") is not None or c["jp"].get("raw_jpy") is not None)
            and (not c.get("fr") or (c["fr"].get("smoothed_avg") is None and c["fr"].get("raw_eur") is None))
        )

        payload = {
            "_meta": {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "version": "5.0.0",
                "source": "pokespread_verified_sold_pipeline_v5",
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
    parser = argparse.ArgumentParser(description="PokéSpread JP→FR v5.0 Price Scraper")
    parser.add_argument("--test", type=int, default=0, help="Test run with N high-value cards")
    parser.add_argument("--force-refresh", action="store_true", help="Ignore previous cached prices")
    parser.add_argument("--local-jp", action="store_true", help="Enable local JP scraping sources")
    parser.add_argument("--max-workers", type=int, default=5, help="Concurrent worker count")
    return parser.parse_args()


def main():
    args = parse_arguments()
    logger.info("==========================================================================")
    logger.info("PokéSpread JP→FR — Clean Production Pipeline v5.0 (High-Margin Arbitrage)")
    logger.info("==========================================================================")

    # 1. Live Exchange Rates
    fx_rates = fetch_live_fx_rates()

    # 2. PokéAPI Species Translations
    species_catalog = build_and_save_species_catalog()

    # 3. Initialize Cardmarket
    cm_service = CardmarketService.get_instance()
    cm_service.initialize()

    # 4. Load SNKRDUNK cache
    load_snkrdunk_ids()

    # 5. Load Existing Database with Single Canonical Key
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

    # 6. Fetch Sets and Cards from TCGdex
    set_map_ja = fetch_tcgdex_sets("ja")
    cards_ja = fetch_tcgdex_cards("ja", set_map_ja)

    if not cards_ja:
        logger.error("No Japanese cards discovered. Exiting.")
        sys.exit(1)

    # 7. Sort Cards by Priority Tier (Tier 1 First)
    for c in cards_ja:
        _, en_n = translate_card_name(c.get("name_ja", c["name"]), species_catalog)
        c["tier"] = get_card_priority_tier(c, en_n)

    cards_ja.sort(key=lambda c: (0 if c["ref"].lower() in TIER1_SPECIAL_REFS else c["tier"]))

    if args.test > 0:
        logger.info(f"🧪 Running in TEST mode with {args.test} top priority cards...")
        queue = cards_ja[:args.test]
    else:
        queue = cards_ja

    logger.info(f"Starting worker pool ({args.max_workers} threads) for {len(queue)} target cards...")

    prices_db = dict(existing_prices)
    total_processed = 0
    start_time = time.time()

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.max_workers) as executor:
        future_map = {
            executor.submit(
                process_single_card, card, fx_rates, species_catalog, args.local_jp
            ): card
            for card in queue
        }

        for future in concurrent.futures.as_completed(future_map):
            card = future_map[future]
            total_processed += 1
            try:
                result = future.result()
                if result:
                    with db_lock:
                        prices_db[result["ref"]] = result
            except Exception as e:
                logger.error(f"Error processing {card.get('ref')}: {e}")

            if total_processed % 10 == 0 or total_processed == len(queue):
                save_prices_checkpoint(prices_db, fx_rates, total_processed)
                elapsed = int(time.time() - start_time)
                logger.info(f"[{total_processed}/{len(queue)}] Checkpoint saved ({elapsed}s elapsed)")

    # Print Summary Table
    total_priced_both = sum(
        1 for c in prices_db.values()
        if c.get("fr") and c.get("jp")
        and (c["fr"].get("smoothed_avg") or c["fr"].get("raw_eur"))
        and (c["jp"].get("smoothed_avg") or c["jp"].get("raw_jpy"))
    )

    print("\n" + "=" * 80)
    print("POKÉSPREAD v5.0 RUN SUMMARY & VERIFICATION TABLE")
    print("=" * 80)
    print(f"Cards in Database:       {len(prices_db)}")
    print(f"Total Priced (Both):     {total_priced_both}")
    print(f"Processed this Run:      {total_processed}")
    print(f"Circuit Breakers:        {[k for k, v in CIRCUIT_BREAKERS.items() if v['tripped']] or 'None'}")
    print("=" * 80)

    print("\nSAMPLE CARD ARBITRAGE RESULTS:")
    print(f"{'Ref':<16} | {'FR Name':<22} | {'JP Buy (¥)':<12} | {'JP Buy (€)':<12} | {'FR Sell (€)':<12} | {'PSA 10 (€)':<12}")
    print("-" * 96)
    sample_cards = list(prices_db.values())[:10]
    for c in sample_cards:
        ref = c.get("ref", "")
        fr_name = c.get("name_fr") or c.get("name", "")
        jp_buy_yen = c.get("jp", {}).get("raw_jpy")
        jp_buy_eur = c.get("jp", {}).get("raw_eur")
        fr_sell_eur = c.get("fr", {}).get("raw_eur") or c.get("fr", {}).get("smoothed_avg")
        psa10_eur = c.get("fr", {}).get("graded", {}).get("PSA 10", {}).get("price")

        print(
            f"{ref:<16} | {fr_name[:20]:<22} | "
            f"{(str(jp_buy_yen) + '¥') if jp_buy_yen else '---':<12} | "
            f"{(str(jp_buy_eur) + '€') if jp_buy_eur else '---':<12} | "
            f"{(str(fr_sell_eur) + '€') if fr_sell_eur else '---':<12} | "
            f"{(str(psa10_eur) + '€') if psa10_eur else '---':<12}"
        )
    print("=" * 96 + "\n")


if __name__ == "__main__":
    main()
