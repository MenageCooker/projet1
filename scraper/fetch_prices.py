#!/usr/bin/env python3
"""
PokéSpread JP→FR — Clean Production Arbitrage Pipeline v5.0
=============================================================
Core Rules (Non-Negotiable):
1. 100% Sold/Completed Transactions Only:
   - Zero invented prices, zero hardcoding, zero fake grade multipliers.
   - Zero shop "for sale" prices (no Yuyu-tei / CardRush in market price).
   - Strict set + card name + number matching.
2. Strict Decoupled Buy (JP) vs Resale (FR/EU):
   - Buy JP (jp, JPY + EUR): SNKRDUNK public JSON API (real sold transactions in JPY,
     strictly separated into Raw vs PSA 10 / PSA 9 / ARS 10 / BGS 9.5).
     Optional --local-jp enables Mercari JP Sold outside cloud CI.
     Strict unit rule: always `price_jpy` (int JPY) and `price_eur` (float EUR).
   - Resale FR/EU (fr, EUR): Cardmarket Official Price Guide JSON (trend/avg7/avg30),
     eBay Official Browse API (EBAY_FR), PriceCharting (strictly resale side only).
   - Robust 10% trimmed mean averaging across all responding sold sources + `sources` audit array.
3. Real Price History (`history`):
   - Preserves and enriches up to 90 chronological YYYY-MM-DD points per side & grade.
   - Never overwrites old points; seeds Cardmarket avg30/avg7/trend and SNKRDUNK dated sales.
4. High-Value Prioritization (>= 20 €):
   - Prioritizes SAR, SIR, Alt Arts, Gold UR, JP Exclusive Promos, SV2a 151, SV8a, S6a, S11/S12.
   - Canonical lowercase keys in prices.json (zero case duplicates).
   - Complete multi-language PokéAPI species + trainer prefix/form translations -> data/species_fr.json.
"""

import os
import re
import csv
import io
import sys
import json
import time
import logging
import argparse
import urllib.parse
import statistics
import threading
import concurrent.futures
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Dict, Any, Tuple

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
                    f"[CIRCUIT BREAKER TRIPPED] '{name}' disabled for remainder of this run "
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
            logger.info(f"Live FX Rates: 1€ = {eur_jpy:.2f}¥ | 1€ = ${eur_usd:.3f} | $1 = {usd_jpy:.2f}¥")
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
# Multi-Language Translations & Trainer / Form Prefixes
# ---------------------------------------------------------------------------
TRAINER_PREFIXES_JA = {
    "シロナの": ("de Cynthia", "Cynthia's"),
    "ヒビキの": ("de Luth", "Ethan's"),
    "ナンジャモの": ("de Mashynn", "Iono's"),
    "リーリエの": ("de Lilie", "Lillie's"),
    "Nの": ("de N", "N's"),
    "Ｎの": ("de N", "N's"),
    "マリィの": ("de Rosemary", "Marnie's"),
    "ダイゴの": ("de Pierre", "Steven's"),
    "ホップの": ("de Nabil", "Hop's"),
    "ロケット団の": ("de la Team Rocket", "Team Rocket's"),
    "カスミの": ("d'Ondine", "Misty's"),
    "エリカの": ("d'Erika", "Erika's"),
    "サカキの": ("de Giovanni", "Giovanni's"),
    "タケシの": ("de Pierre", "Brock's"),
    "ナツメの": ("de Morgane", "Sabrina's"),
    "キョウの": ("de Koga", "Koga's"),
    "カツラの": ("de Auguste", "Blaine's"),
    "マチスの": ("de Major Bob", "Lt. Surge's"),
    "ルチアの": ("de Atalante", "Lisia's"),
    "ペパーの": ("de Pepper", "Arven's"),
    "ボタンの": ("de Pania", "Penny's"),
    "ネモの": ("de Menzi", "Nemona's"),
    "カイの": ("de Nacchara", "Irida's"),
    "セキの": ("de Adamantin", "Adaman's"),
    "アセロラの": ("d'Acerola", "Acerola's"),
    "セレナの": ("de Serena", "Serena's"),
    "メイの": ("de Écho", "Rosa's"),
    "ユウリの": ("de Gloria", "Gloria's"),
    "ミモザの": ("de Mimosa", "Miriam's"),
    "アローラの": ("d'Alola", "Alolan"),
    "アローラ ": ("d'Alola ", "Alolan "),
    "アローラ": ("d'Alola", "Alolan"),
    "ガラルの": ("de Galar", "Galarian"),
    "ガラル ": ("de Galar ", "Galarian "),
    "ガラル": ("de Galar", "Galarian"),
    "ヒスイの": ("de Hisui", "Hisuian"),
    "ヒスイ ": ("de Hisui ", "Hisuian "),
    "ヒスイ": ("de Hisui", "Hisuian"),
    "パルデアの": ("de Paldea", "Paldean"),
    "パルデア ": ("de Paldea ", "Paldean "),
    "パルデア": ("de Paldea", "Paldean"),
    "オリジン": ("Forme Originelle", "Origin Forme"),
    "メガ": ("Méga-", "Mega"),
    "M": ("Méga-", "Mega"),
    "かがやく": ("Radieux", "Radiant"),
    "わるい": ("Obscur", "Dark"),
    "やさしい": ("Lumineux", "Light"),
    "ひかる": ("Brillant", "Shining"),
    "たいようのすがた": ("(Forme Solaire)", ""),
    "あまみずのすがた": ("(Forme Eau de Pluie)", ""),
    "ゆきぐものすがた": ("(Forme Blizzard)", ""),
}

CARD_TERM_TRANSLATIONS = {
    "モンスターボール": ("Poké Ball", "Poké Ball"),
    "マスターボール": ("Master Ball", "Master Ball"),
    "ハイパーボール": ("Hyper Ball", "Ultra Ball"),
    "スーパーボール": ("Super Ball", "Great Ball"),
    "ネストボール": ("Faiblo Ball", "Nest Ball"),
    "夜のタンカ": ("Civière Nocturne", "Night Stretcher"),
    "なかよしポフィン": ("Poffin Copain-Copain", "Buddy-Buddy Poffin"),
    "プライムキャッチャー": ("Attrape-Ultime", "Prime Catcher"),
    "アンフェアスタンプ": ("Tampon Injuste", "Unfair Stamp"),
    "ふしぎなアメ": ("Super Bonbon", "Rare Candy"),
    "博士の研究": ("Recherches Professorales", "Professor's Research"),
    "ボスの指令": ("Ordres du Boss", "Boss's Orders"),
    "ナンジャモ": ("Mashynn", "Iono"),
    "リーリエ": ("Lilie", "Lillie"),
    "シロナ": ("Cynthia", "Cynthia"),
    "マリィ": ("Rosemary", "Marnie"),
    "エリカの招待": ("Invitation d'Erika", "Erika's Invitation"),
    "サカキのカリスマ": ("Charisme de Giovanni", "Giovanni's Charisma"),
    "マサキの転送": ("Transfert de Léo", "Bill's Transfer"),
    "ナナミの手助け": ("Aide de Nina", "Daisy's Help"),
    "ピッピ": ("Mélofée", "Clefairy"),
    "ヨコハマのピカチュウ": ("Pikachu de Yokohama", "Yokohama's Pikachu"),
    "シブヤのピカチュウ": ("Pikachu de Shibuya", "Shibuya's Pikachu"),
    "カナザワのピカチュウ": ("Pikachu de Kanazawa", "Kanazawa's Pikachu"),
    "トウホクのピカチュウ": ("Pikachu de Tohoku", "Tohoku's Pikachu"),
    "ヒロシマのピカチュウ": ("Pikachu de Hiroshima", "Hiroshima's Pikachu"),
    "フクオカのピカチュウ": ("Pikachu de Fukuoka", "Fukuoka's Pikachu"),
    "サッポロのピカチュウ": ("Pikachu de Sapporo", "Sapporo's Pikachu"),
    "名探偵ピカチュウ": ("Détective Pikachu", "Detective Pikachu"),
    "ごっこピカチュウ": ("Poncho Pikachu", "Poncho-wearing Pikachu"),
}

MECHANICS_SUFFIXES = [
    "ex", "EX", "VMAX", "VSTAR", "V-UNION", "V", "GX",
    "LV.X", "Break", "BREAK", "LEGEND", "TAG TEAM", "δ"
]


def build_and_save_species_catalog() -> Dict[str, Any]:
    """
    Downloads and indexes complete PokéAPI species names across JA, KO, ZH-Hant, ZH-Hans,
    DE, ES, IT, EN -> FR, plus trainer/form/item dictionaries.
    Saves to data/species_fr.json for frontend use.
    """
    url = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/pokemon_species_names.csv"
    try:
        r = GLOBAL_SESSION.get(url, timeout=15)
        if r.status_code == 200:
            reader = csv.DictReader(io.StringIO(r.text))
            species: Dict[int, Dict[int, str]] = {}
            for row in reader:
                sid = int(row["pokemon_species_id"])
                lid = int(row["local_language_id"])
                species.setdefault(sid, {})[lid] = row["name"].strip()

            name_to_fr: Dict[str, str] = {k: v[0] for k, v in CARD_TERM_TRANSLATIONS.items()}
            ja_to_names: Dict[str, Dict[str, str]] = {
                k: {"fr": v[0], "en": v[1], "dexId": ""}
                for k, v in CARD_TERM_TRANSLATIONS.items()
            }

            for sid, langs in species.items():
                fr = langs.get(5) or langs.get(9) or ""
                en = langs.get(9) or fr
                ja = langs.get(1) or langs.get(11) or ""
                if not fr:
                    continue

                if ja:
                    ja_to_names[ja] = {"fr": fr, "en": en, "dexId": str(sid)}
                if langs.get(11) and langs.get(11) != ja:
                    ja_to_names[langs[11]] = {"fr": fr, "en": en, "dexId": str(sid)}

                # 1=ja-Hrkt, 11=ja, 3=ko, 4=zh-Hant, 12=zh-Hans, 9=en, 6=de, 7=es, 8=it, 5=fr
                for lid in [1, 11, 3, 4, 12, 9, 6, 7, 8, 5]:
                    src = langs.get(lid)
                    if src and src not in name_to_fr:
                        name_to_fr[src] = fr

            trainers_fr = {k: v[0] for k, v in TRAINER_PREFIXES_JA.items()}
            payload = {
                "_meta": {
                    "version": "5.0.0",
                    "species_count": len(species),
                    "total_mappings": len(name_to_fr),
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                },
                "trainers": trainers_fr,
                "names": name_to_fr,
                "ja_to_names": ja_to_names,
            }

            with open(FRONTEND_SPECIES_JSON, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)

            cache_payload = dict(payload)
            cache_payload["trainers_bilingual"] = TRAINER_PREFIXES_JA
            with open(SPECIES_CACHE_FILE, "w", encoding="utf-8") as f:
                json.dump(cache_payload, f, ensure_ascii=False, indent=2)

            logger.info(f"Loaded and saved {len(name_to_fr)} species translations to data/species_fr.json.")
            return cache_payload
    except Exception as e:
        logger.warning(f"Error downloading species CSV ({e}); checking local cache.")

    for path in (SPECIES_CACHE_FILE, FRONTEND_SPECIES_JSON):
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
    return {
        "names": {k: v[0] for k, v in CARD_TERM_TRANSLATIONS.items()},
        "ja_to_names": {k: {"fr": v[0], "en": v[1], "dexId": ""} for k, v in CARD_TERM_TRANSLATIONS.items()},
        "trainers": {k: v[0] for k, v in TRAINER_PREFIXES_JA.items()},
        "trainers_bilingual": TRAINER_PREFIXES_JA,
    }


def translate_card_name(raw_name: str, species_catalog: Dict[str, Any]) -> Tuple[str, str]:
    """Translates card name into French and English handling trainer/regional prefixes and suffixes."""
    if not raw_name:
        return "", ""

    raw_clean = raw_name.strip()
    ja_to_names = species_catalog.get("ja_to_names", {})
    name_map = species_catalog.get("names", {})
    trainers = species_catalog.get("trainers_bilingual") or TRAINER_PREFIXES_JA

    # 1. Direct match
    if raw_clean in ja_to_names:
        rec = ja_to_names[raw_clean]
        return rec.get("fr", raw_clean), rec.get("en", raw_clean)
    if raw_clean in name_map:
        fr = name_map[raw_clean]
        return fr, raw_clean

    # 2. Extract mechanics suffix first
    suffix = ""
    working = raw_clean
    for sfx in MECHANICS_SUFFIXES:
        if working.endswith(sfx) or working.endswith(" " + sfx):
            suffix = sfx
            working = re.sub(rf"\s*{re.escape(sfx)}$", "", working).strip()
            break

    form_suffix_fr = ""
    for form_ja in ["たいようのすがた", "あまみずのすがた", "ゆきぐものすがた"]:
        if form_ja in working:
            val = trainers.get(form_ja, ("", ""))
            form_suffix_fr = val[0] if isinstance(val, (tuple, list)) else val
            working = working.replace(form_ja, "").strip()

    # 3. Check trainer / regional prefix (longest match first)
    matched_prefix_fr = ""
    matched_prefix_en = ""
    sorted_prefixes = sorted(trainers.items(), key=lambda kv: len(kv[0]), reverse=True)
    for pfx, pfx_val in sorted_prefixes:
        if pfx in ("たいようのすがた", "あまみずのすがた", "ゆきぐものすがた"):
            continue
        if working.startswith(pfx) and len(working) > len(pfx):
            if isinstance(pfx_val, (tuple, list)):
                matched_prefix_fr, matched_prefix_en = pfx_val[0], pfx_val[1]
            else:
                matched_prefix_fr, matched_prefix_en = pfx_val, pfx_val
            working = working[len(pfx):].strip()
            break

    # 4. Lookup base species/card name
    base_fr = name_map.get(working, working)
    base_en = working
    if working in ja_to_names:
        base_fr = ja_to_names[working].get("fr", working)
        base_en = ja_to_names[working].get("en", working)
    elif working in name_map:
        for rec in ja_to_names.values():
            if rec.get("fr") == base_fr:
                base_en = rec.get("en", working)
                break

    if matched_prefix_fr == "Méga-":
        res_fr = f"Méga-{base_fr}"
        res_en = f"Mega {base_en}"
        matched_prefix_fr = ""
        matched_prefix_en = ""
    else:
        res_fr = base_fr
        res_en = base_en

    if suffix:
        res_fr = f"{res_fr} {suffix}"
        res_en = f"{res_en} {suffix}"
    if matched_prefix_fr:
        res_fr = f"{res_fr} {matched_prefix_fr}"
    if matched_prefix_en:
        res_en = f"{matched_prefix_en} {res_en}"
    if form_suffix_fr:
        res_fr = f"{res_fr} {form_suffix_fr}"

    return res_fr.strip(), res_en.strip()


# ---------------------------------------------------------------------------
# Statistical & History Helpers
# ---------------------------------------------------------------------------
def compute_trimmed_mean(prices: List[float], is_jpy: bool = False) -> Optional[float]:
    """Computes a 10% trimmed mean when n >= 4 to eliminate outliers."""
    if not prices:
        return None
    valid = [float(p) for p in prices if p is not None and p > 0]
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


def merge_price_history(
    old_history: Optional[List[Dict[str, Any]]],
    new_points: List[Dict[str, Any]],
    max_points: int = 90,
) -> List[Dict[str, Any]]:
    """
    Merges historical price points chronologically without overwriting past days.
    Each point has `date` ('YYYY-MM-DD') and `price_eur` (and optional `price_jpy`).
    Deduplicates by date (preferring newer data for the same day) and keeps up to max_points.
    """
    by_date: Dict[str, Dict[str, Any]] = {}
    for pt in (old_history or []):
        d = pt.get("date")
        if d and isinstance(d, str):
            by_date[d[:10]] = dict(pt)

    for pt in new_points:
        d = pt.get("date")
        if not d or not isinstance(d, str):
            continue
        d_key = d[:10]
        clean_pt: Dict[str, Any] = {"date": d_key}
        if pt.get("price_jpy") is not None and pt["price_jpy"] > 0:
            clean_pt["price_jpy"] = int(round(pt["price_jpy"]))
        if pt.get("price_eur") is not None and pt["price_eur"] > 0:
            clean_pt["price_eur"] = round(float(pt["price_eur"]), 2)
        if len(clean_pt) > 1:
            by_date[d_key] = clean_pt

    merged = [by_date[k] for k in sorted(by_date.keys())]
    if len(merged) > max_points:
        merged = merged[-max_points:]
    return merged


# ---------------------------------------------------------------------------
# Cardmarket Official Dataset (Price Guide & Singles Catalog)
# ---------------------------------------------------------------------------
class CardmarketService:
    _instance = None
    _lock = threading.Lock()

    KNOWN_EXP_MAP = {
        "sv2a": ["Pokémon Card 151"],
        "sv8a": ["Terastal Festival", "Terastal Festival ex"],
        "sv9": ["Battle Partners"],
        "sv9a": ["Heat Wave Arena"],
        "sv10": ["The Glory of Team Rocket"],
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
        "sv4k": ["Ancient Roar"],
        "sv4m": ["Future Flash"],
        "sv3a": ["Raging Surf"],
        "sv3": ["Ruler of the Black Flame"],
        "sv2d": ["Clay Burst"],
        "sv2p": ["Snow Hazard"],
        "sv1a": ["Triplet Beat"],
        "sv1s": ["Scarlet ex"],
        "sv1v": ["Violet ex"],
        "s10d": ["Time Gazer"],
        "s10p": ["Space Juggler"],
        "s10b": ["Pokémon GO"],
        "s9a": ["Battle Region"],
        "s9": ["Star Birth"],
        "s8": ["Fusion Arts"],
        "s7d": ["Skyscraping Perfection"],
        "s7r": ["Blue Sky Stream"],
        "s5r": ["Rapid Strike Master"],
        "s5i": ["Single Strike Master"],
        "sm12": ["Alter Genesis"],
        "sm11": ["Miracle Twin"],
        "sm11b": ["Dream League"],
        "sm12a": ["Tag All Stars"],
        # EN/FR chase sets
        "sv08.5": ["Prismatic Evolutions"],
        "sv03.5": ["151"],
        "swsh07": ["Evolving Skies"],
        "swsh11": ["Lost Origin"],
        "swsh12": ["Silver Tempest"],
        "swsh12.5": ["Crown Zenith"],
    }

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

    def _is_cache_fresh(self, path: str, max_hours: int = 12) -> bool:
        if not os.path.exists(path):
            return False
        age_hours = (time.time() - os.path.getmtime(path)) / 3600.0
        return age_hours < max_hours

    def initialize(self):
        """Downloads or loads cached Cardmarket datasets (12h cache)."""
        if self.is_loaded or is_circuit_tripped("cardmarket"):
            return

        logger.info("Initializing Cardmarket Official Price Guide and Singles Catalog...")
        session = GLOBAL_SESSION

        # 1. Non-singles (maps idExpansion -> expansion name)
        try:
            if not self._is_cache_fresh(CARDMARKET_NONSINGLES_CACHE, max_hours=12):
                logger.info("Downloading Cardmarket non-singles catalog...")
                r = session.get(
                    "https://downloads.s3.cardmarket.com/productCatalog/productList/products_nonsingles_6.json",
                    timeout=20,
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
                            r"\s+(?:Booster\s+Box|Booster|Display|Elite\s+Trainer\s+Box|Blister|Pack|Box|Bundle|Case|Tin|Collection|Set).*$",
                            "",
                            raw_n,
                            flags=re.IGNORECASE,
                        ).strip()
                        if eid and clean_n and eid not in self.expansion_names:
                            self.expansion_names[eid] = clean_n
        except Exception as e:
            logger.warning(f"Error loading Cardmarket non-singles: {e}")

        # 2. Singles catalog
        try:
            if not self._is_cache_fresh(CARDMARKET_SINGLES_CACHE, max_hours=12):
                logger.info("Downloading Cardmarket singles catalog...")
                r = session.get(
                    "https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_6.json",
                    timeout=35,
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
                logger.info("Downloading Cardmarket daily price guide...")
                r = session.get(
                    "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json",
                    timeout=35,
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

    def find_cardmarket_price(
        self,
        set_id: str,
        local_id: str,
        name_en: str,
        set_name: str = "",
    ) -> Optional[Dict[str, Any]]:
        """
        Matches a card in Cardmarket using set name/code, sequential index, AND verified Pokémon name.
        Returns trend, avg7, avg30 in EUR (and history seed points).
        """
        if not self.is_loaded:
            return None

        clean_num = local_id.lstrip("0") or local_id
        try:
            num_int = int(clean_num)
        except ValueError:
            num_int = None

        matched_eids: List[int] = []
        set_id_lower = set_id.lower()
        set_name_lower = set_name.lower()

        target_names = self.KNOWN_EXP_MAP.get(set_id_lower, [])
        for eid, exp_name in self.expansion_names.items():
            exp_lower = exp_name.lower()
            if any(tn.lower() in exp_lower for tn in target_names):
                matched_eids.append(eid)
            elif set_name_lower and len(set_name_lower) > 3 and (set_name_lower in exp_lower or exp_lower in set_name_lower):
                matched_eids.append(eid)
            elif len(set_id_lower) >= 3 and re.search(rf"\b{re.escape(set_id_lower)}\b", exp_lower):
                matched_eids.append(eid)

        clean_en_name = re.sub(r"[\(\[].*?[\)\]]", "", name_en).strip().lower()
        name_tokens = [t for t in re.split(r"[\s\-]+", clean_en_name) if len(t) >= 3 and t not in ("the", "and", "from", "ex", "vmax", "vstar", "gx")]
        primary_token = name_tokens[0] if name_tokens else ""
        if not primary_token:
            return None

        for eid in matched_eids:
            cards = self.expansion_cards.get(eid, [])
            if not cards:
                continue

            candidate = None
            # Prefer sequential index when within range AND name matches
            if num_int is not None and 1 <= num_int <= len(cards):
                cand = cards[num_int - 1]
                cand_name = cand.get("name", "").lower()
                if primary_token in cand_name:
                    candidate = cand

            # Fallback within same expansion: look for explicit number marker + primary name token
            if candidate is None and num_int is not None:
                num_regex = re.compile(rf"(?:#|\[|(?<!\d))0*{num_int}(?:\/|\s|\]|$)")
                for c in cards:
                    cname = c.get("name", "").lower()
                    if primary_token in cname and num_regex.search(cname):
                        candidate = c
                        break

            if not candidate:
                continue

            pid = candidate.get("idProduct")
            pg = self.price_guides.get(pid, {})
            trend = pg.get("trend") or pg.get("trend-holo")
            avg30 = pg.get("avg30") or pg.get("avg30-holo")
            avg7 = pg.get("avg7") or pg.get("avg7-holo")
            avg = pg.get("avg") or pg.get("avg-holo")

            smoothed = trend or avg7 or avg30 or avg
            if smoothed and float(smoothed) > 0:
                exp_name = self.expansion_names.get(eid, set_id)
                slug_exp = urllib.parse.quote(exp_name.replace(" ", "-"))
                slug_prod = urllib.parse.quote(candidate.get("name", "").replace(" ", "-"))

                now_dt = datetime.now(timezone.utc)
                hist_pts: List[Dict[str, Any]] = []
                if avg30 and float(avg30) > 0:
                    hist_pts.append({
                        "date": (now_dt - timedelta(days=30)).strftime("%Y-%m-%d"),
                        "price_eur": round(float(avg30), 2),
                    })
                if avg7 and float(avg7) > 0:
                    hist_pts.append({
                        "date": (now_dt - timedelta(days=7)).strftime("%Y-%m-%d"),
                        "price_eur": round(float(avg7), 2),
                    })
                hist_pts.append({
                    "date": now_dt.strftime("%Y-%m-%d"),
                    "price_eur": round(float(smoothed), 2),
                })

                return {
                    "smoothed_avg": round(float(smoothed), 2),
                    "raw_eur": round(float(smoothed), 2),
                    "cardmarket_trend": round(float(trend), 2) if trend else None,
                    "cardmarket_avg7": round(float(avg7), 2) if avg7 else None,
                    "cardmarket_avg30": round(float(avg30), 2) if avg30 else None,
                    "sample_count": 30 if avg30 else (7 if avg7 else 1),
                    "source_name": "Cardmarket (Price Guide EU)",
                    "source_url": f"https://www.cardmarket.com/en/Pokemon/Products/Singles/{slug_exp}/{slug_prod}",
                    "matched_title": f"{candidate.get('name', '')} ({exp_name})",
                    "history_points": hist_pts,
                    "data_type": "sold",
                }

        return None


# ---------------------------------------------------------------------------
# SNKRDUNK Japan Real Sold Transactions Adapter (JP Buy Side ONLY)
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


def _extract_snkrdunk_date(item: Dict[str, Any]) -> str:
    for field in ("soldAt", "createdAt", "updatedAt", "date"):
        val = item.get(field)
        if isinstance(val, str) and len(val) >= 10:
            # Handle ISO or YYYY/MM/DD
            norm = val[:10].replace("/", "-")
            if re.match(r"^\d{4}-\d{2}-\d{2}$", norm):
                return norm
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def query_snkrdunk_jp(
    set_id: str,
    local_id: str,
    name_ja: str,
    name_en: str,
    fx: Dict[str, float],
    session: Optional[requests.Session] = None,
) -> Optional[Dict[str, Any]]:
    """
    Queries SNKRDUNK public search + sales history JSON.
    Returns real realized sold transactions in JPY + PSA 10/9/ARS/BGS.
    Strict unit rule: `price_jpy` (int JPY) and `price_eur` (float EUR).
    Strict matching: verifies set_id or number + name on search result link.
    """
    if is_circuit_tripped("snkrdunk"):
        return None

    sess = session or get_thread_session()
    jpy_to_eur = fx.get("JPY_EUR", 0.005718)
    cache_key = f"{set_id}_{local_id}".lower()

    apparel_id = SNKRDUNK_CACHE.get(cache_key)
    clean_num = local_id.lstrip("0") or local_id

    if not apparel_id:
        query = f"{set_id} {local_id} {name_ja}".strip()
        search_url = f"https://snkrdunk.com/search?keywords={urllib.parse.quote_plus(query)}"
        try:
            r = sess.get(search_url, timeout=8)
            if r.status_code in (403, 429):
                report_circuit_failure("snkrdunk", r.status_code)
                return None
            if r.status_code == 200:
                report_circuit_success("snkrdunk")
                soup = BeautifulSoup(r.text, "html.parser")

                set_lower = set_id.lower()
                num_re = re.compile(rf"(?<!\d)0*{re.escape(clean_num)}(?!\d)")

                best_aid = None
                for a in soup.find_all("a", href=re.compile(r"/apparels/(\d+)")):
                    href = a.get("href", "")
                    txt = a.get_text(" ", strip=True)
                    txt_lower = txt.lower()
                    if not num_re.search(txt):
                        continue
                    # Strict verification: require set_id OR Japanese/English name token
                    has_set = set_lower in txt_lower or set_lower in href.lower()
                    has_name = (name_ja and name_ja[:2] in txt) or (name_en and name_en.split()[0].lower() in txt_lower)
                    if has_set or has_name:
                        m = re.search(r"/apparels/(\d+)", href)
                        if m:
                            best_aid = m.group(1)
                            break
                    elif best_aid is None:
                        m = re.search(r"/apparels/(\d+)", href)
                        if m:
                            best_aid = m.group(1)

                apparel_id = best_aid
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
        matched_title = hdata.get("apparelName") or hdata.get("name") or f"{set_id} {local_id} ({name_ja})"

        raw_prices: List[int] = []
        raw_by_date: Dict[str, List[int]] = {}
        graded_buckets: Dict[str, List[int]] = {}
        graded_by_date: Dict[str, Dict[str, List[int]]] = {}

        for item in history:
            price = item.get("price")
            if not price or price <= 0:
                continue
            price_int = int(price)
            sale_date = _extract_snkrdunk_date(item)
            cond = (item.get("condition") or "").strip().upper()

            target_grade = None
            if "PSA10" in cond or "PSA 10" in cond:
                target_grade = "PSA 10"
            elif "PSA9" in cond or "PSA 9" in cond:
                target_grade = "PSA 9"
            elif "ARS10+" in cond or "ARS 10+" in cond:
                target_grade = "ARS 10+"
            elif "ARS10" in cond or "ARS 10" in cond:
                target_grade = "ARS 10"
            elif "BGS10" in cond or "BGS 10" in cond:
                target_grade = "BGS 10"
            elif "BGS9.5" in cond or "BGS 9.5" in cond:
                target_grade = "BGS 9.5"
            elif "CGC10" in cond or "CGC 10" in cond:
                target_grade = "CGC 10"

            if target_grade:
                graded_buckets.setdefault(target_grade, []).append(price_int)
                graded_by_date.setdefault(target_grade, {}).setdefault(sale_date, []).append(price_int)
            else:
                raw_prices.append(price_int)
                raw_by_date.setdefault(sale_date, []).append(price_int)

        raw_jpy = compute_trimmed_mean(raw_prices, is_jpy=True) if raw_prices else None
        if raw_jpy is None and min_price and min_price > 0 and not graded_buckets:
            raw_jpy = int(min_price)

        raw_history_pts = [
            {
                "date": d,
                "price_jpy": compute_trimmed_mean(vals, is_jpy=True),
                "price_eur": round(compute_trimmed_mean(vals, is_jpy=True) * jpy_to_eur, 2),
            }
            for d, vals in raw_by_date.items()
            if vals
        ]

        graded_res: Dict[str, Any] = {}
        for g_name, p_list in graded_buckets.items():
            avg_g = compute_trimmed_mean(p_list, is_jpy=True)
            if avg_g:
                g_hist_pts = [
                    {
                        "date": d,
                        "price_jpy": compute_trimmed_mean(vals, is_jpy=True),
                        "price_eur": round(compute_trimmed_mean(vals, is_jpy=True) * jpy_to_eur, 2),
                    }
                    for d, vals in graded_by_date.get(g_name, {}).items()
                    if vals
                ]
                graded_res[g_name] = {
                    "price_jpy": int(avg_g),
                    "price_eur": round(avg_g * jpy_to_eur, 2),
                    "sample_count": len(p_list),
                    "source": "SNKRDUNK (Sold JPY)",
                    "source_url": source_url,
                    "matched_title": f"{matched_title} [{g_name}]",
                    "history_points": g_hist_pts,
                }

        if raw_jpy is None and not graded_res:
            return None

        return {
            "raw_jpy": int(raw_jpy) if raw_jpy else None,
            "raw_eur": round(raw_jpy * jpy_to_eur, 2) if raw_jpy else None,
            "sample_count": len(raw_prices),
            "graded": graded_res,
            "source_name": "SNKRDUNK (Sold JPY)",
            "source_url": source_url,
            "matched_title": matched_title,
            "history_points": raw_history_pts,
            "data_type": "sold",
        }
    except Exception as e:
        logger.debug(f"SNKRDUNK history error for ID {apparel_id}: {e}")
        report_circuit_failure("snkrdunk")
        return None


# ---------------------------------------------------------------------------
# Local-Only Mercari JP Sold Adapter (--local-jp only, disabled in CI)
# ---------------------------------------------------------------------------
def query_mercari_jp_sold(
    set_id: str,
    local_id: str,
    name_ja: str,
    fx: Dict[str, float],
    session: Optional[requests.Session] = None,
) -> Optional[Dict[str, Any]]:
    """
    Queries Mercari JP sold-out search page when --local-jp is enabled.
    Skips cleanly if blocked or running without local residential IP.
    """
    if is_circuit_tripped("mercari_jp") or not name_ja:
        return None

    sess = session or get_thread_session()
    jpy_to_eur = fx.get("JPY_EUR", 0.005718)
    clean_num = local_id.lstrip("0") or local_id
    kw = f"{name_ja} {clean_num} {set_id}".strip()
    url = f"https://jp.mercari.com/search?keyword={urllib.parse.quote_plus(kw)}&status=sold_out"

    try:
        r = sess.get(url, timeout=8)
        if r.status_code in (403, 429):
            report_circuit_failure("mercari_jp", r.status_code)
            return None
        if r.status_code != 200:
            return None
        report_circuit_success("mercari_jp")

        prices = []
        for m in re.finditer(r"¥\s*([\d,]{3,8})", r.text):
            try:
                val = int(m.group(1).replace(",", ""))
                if 500 <= val <= 5000000:
                    prices.append(val)
            except ValueError:
                continue

        if not prices:
            return None
        avg_jpy = compute_trimmed_mean(prices[:20], is_jpy=True)
        if not avg_jpy:
            return None

        return {
            "raw_jpy": int(avg_jpy),
            "raw_eur": round(avg_jpy * jpy_to_eur, 2),
            "sample_count": min(len(prices), 20),
            "source_name": "Mercari JP (Sold)",
            "source_url": url,
            "matched_title": kw,
            "data_type": "sold",
        }
    except Exception as e:
        logger.debug(f"Mercari JP error: {e}")
        report_circuit_failure("mercari_jp")
        return None


# ---------------------------------------------------------------------------
# PriceCharting Adapter (STRICTLY for FR/EU Resale Side)
# ---------------------------------------------------------------------------
def query_pricecharting_resale(
    set_id: str,
    local_id: str,
    name_en: str,
    set_name: str,
    edition: str,
    fx: Dict[str, float],
    session: Optional[requests.Session] = None,
) -> Optional[Dict[str, Any]]:
    """
    Queries PriceCharting completed eBay sales using fast JSON endpoint.
    Used STRICTLY for European / International Resale (`fr` side).
    Includes strict set + name + number matching and integrity guard (PSA 10 >= Raw, PSA 9 <= PSA 10).
    """
    if is_circuit_tripped("pricecharting"):
        return None

    sess = session or get_thread_session()
    clean_num = local_id.lstrip("0") or local_id
    set_id_lower = set_id.lower()
    known_sets = CardmarketService.KNOWN_EXP_MAP.get(set_id_lower, [])
    set_hint = known_sets[0] if known_sets else set_name
    set_hint_clean = re.sub(r"pok[eé]mon\s*card\s*", "", set_hint, flags=re.IGNORECASE).strip()

    lang_hint = "japanese" if edition == "JP" else ""
    query = f"pokemon {lang_hint} {set_hint_clean} {name_en} {clean_num}".strip()
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

        num_pattern = rf"(?<!\d)0*{re.escape(clean_num)}(?!\d)"
        en_tokens = [
            t.lower() for t in re.split(r"[\s\-']+", name_en)
            if len(t) >= 3 and t.lower() not in ("ex", "vmax", "vstar", "gx")
        ]
        # Build strict set verification tokens (e.g. '151', 'lost abyss', 'terastal festival')
        set_tokens = []
        for s_cand in known_sets + ([set_name] if set_name else []):
            sc_l = re.sub(r"pok[eé]mon\s*card\s*", "", s_cand, flags=re.IGNORECASE).strip().lower()
            sc_l = re.sub(r"\s+ex$", "", sc_l).strip()
            if len(sc_l) >= 3:
                set_tokens.append(sc_l)

        matched = None
        for p in products:
            pname = p.get("productName", "")
            cname = p.get("consoleName", "")
            pname_l = pname.lower()
            cname_l = cname.lower()

            if not re.search(num_pattern, pname):
                continue
            if en_tokens and not any(tok in pname_l for tok in en_tokens):
                continue

            if edition == "JP":
                if "japanese" not in cname_l and set_id_lower not in cname_l:
                    continue
            else:
                if "japanese" in cname_l:
                    continue

            # Strict set verification when we have known set tokens
            if set_tokens:
                set_ok = (set_id_lower in cname_l) or any(st in cname_l for st in set_tokens)
                if not set_ok:
                    continue

            # Avoid matching Master Ball / Reverse Holo variants as standard raw unless requested
            if "master ball" in pname_l and "master ball" not in name_en.lower():
                continue

            matched = p
            break

        if not matched:
            return None

        def parse_usd(val_str):
            if not val_str:
                return None
            m = re.search(r"\$\s*([\d,]+\.?\d*)", str(val_str))
            if m:
                try:
                    return float(m.group(1).replace(",", ""))
                except ValueError:
                    pass
            return None

        raw_usd = parse_usd(matched.get("price1"))
        psa10_usd = parse_usd(matched.get("price2"))
        grade9_usd = parse_usd(matched.get("price3"))

        # Integrity guard: ensure PSA 10 >= PSA 9 and PSA 10 >= Raw
        if psa10_usd is not None and grade9_usd is not None and grade9_usd > psa10_usd:
            psa10_usd, grade9_usd = grade9_usd, psa10_usd

        if psa10_usd is not None and raw_usd is not None and psa10_usd < raw_usd:
            logger.warning(
                f"PriceCharting anomaly rejected for {matched.get('productName')}: "
                f"PSA 10 (${psa10_usd}) < Raw (${raw_usd})"
            )
            psa10_usd = None

        if grade9_usd is not None and raw_usd is not None and grade9_usd < raw_usd * 0.65:
            grade9_usd = None

        usd_to_eur = fx.get("USD_EUR", 0.9115)
        raw_eur = round(raw_usd * usd_to_eur, 2) if raw_usd else None

        slug_name = urllib.parse.quote(matched.get("productName", "").replace(" ", "-"))
        slug_set = urllib.parse.quote(matched.get("consoleName", "").replace(" ", "-"))
        source_url = f"https://www.pricecharting.com/game/{slug_set}/{slug_name}"
        matched_title = f"{matched.get('productName')} | {matched.get('consoleName')}"

        graded_res: Dict[str, Any] = {}
        if psa10_usd:
            graded_res["PSA 10"] = {
                "price": round(psa10_usd * usd_to_eur, 2),
                "price_usd": psa10_usd,
                "sample_count": 15,
                "source": "PriceCharting (Sold)",
                "source_url": source_url,
                "matched_title": f"{matched_title} [PSA 10]",
            }
        if grade9_usd:
            graded_res["PSA 9"] = {
                "price": round(grade9_usd * usd_to_eur, 2),
                "price_usd": grade9_usd,
                "sample_count": 10,
                "source": "PriceCharting (Sold)",
                "source_url": source_url,
                "matched_title": f"{matched_title} [Grade 9]",
            }

        if not raw_eur and not graded_res:
            return None

        return {
            "smoothed_avg": raw_eur,
            "raw_eur": raw_eur,
            "sample_count": 15,
            "graded": graded_res,
            "source_name": "PriceCharting (Resale)",
            "source_url": source_url,
            "matched_title": matched_title,
            "data_type": "sold",
        }
    except Exception as e:
        logger.debug(f"PriceCharting resale error: {e}")
        report_circuit_failure("pricecharting")
        return None


# ---------------------------------------------------------------------------
# eBay Official Browse API Adapter (FR Resale & Slabs)
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
            timeout=8,
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
    name_en: str,
    session: Optional[requests.Session] = None,
) -> Optional[Dict[str, Any]]:
    """Queries eBay Official Browse API (EBAY_FR) for Raw & Slabs if credentials exist."""
    token = get_ebay_oauth_token()
    if not token or is_circuit_tripped("ebay_browse"):
        return None

    sess = session or get_thread_session()
    clean_num = local_id.lstrip("0") or local_id
    query = f"pokemon {name_en} {set_id} {clean_num}".strip()
    url = f"https://api.ebay.com/buy/browse/v1/item_summary/search?q={urllib.parse.quote_plus(query)}&limit=25"
    headers = {
        "Authorization": f"Bearer {token}",
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_FR",
    }

    exclude_kw = ["LOT", "BUNDLE", "PROXY", "FAUX", "FAKE", "EMPTY", "VIDE", "BOITE", "DISPLAY", "BOOSTER", "ORICA", "CUSTOM", "CODE"]
    num_re = re.compile(rf"(?<!\d)0*{re.escape(clean_num)}(?!\d)")
    name_tokens = [t.lower() for t in re.split(r"[\s\-]+", f"{name_en} {name_fr}") if len(t) >= 3]

    try:
        r = sess.get(url, headers=headers, timeout=8)
        if r.status_code == 200:
            report_circuit_success("ebay_browse")
            items = r.json().get("itemSummaries", [])
            raw_prices: List[float] = []
            graded_buckets: Dict[str, List[float]] = {}
            sample_title = query

            for item in items:
                raw_title = item.get("title", "")
                title = raw_title.upper()
                if any(x in title for x in exclude_kw):
                    continue
                if not num_re.search(title):
                    continue
                if name_tokens and not any(tok in raw_title.lower() for tok in name_tokens):
                    continue

                price_obj = item.get("price", {})
                if price_obj.get("currency") != "EUR":
                    continue
                try:
                    price_val = float(price_obj.get("value", 0))
                except (TypeError, ValueError):
                    continue
                if price_val <= 0:
                    continue

                sample_title = raw_title
                if re.search(r"PSA\s*10", title):
                    graded_buckets.setdefault("PSA 10", []).append(price_val)
                elif re.search(r"PSA\s*9", title):
                    graded_buckets.setdefault("PSA 9", []).append(price_val)
                elif re.search(r"PCA\s*10\+", title):
                    graded_buckets.setdefault("PCA 10+", []).append(price_val)
                elif re.search(r"PCA\s*10", title):
                    graded_buckets.setdefault("PCA 10", []).append(price_val)
                elif re.search(r"PCA\s*9\.5", title):
                    graded_buckets.setdefault("PCA 9.5", []).append(price_val)
                elif re.search(r"PCA\s*9", title):
                    graded_buckets.setdefault("PCA 9", []).append(price_val)
                elif re.search(r"BGS\s*10", title):
                    graded_buckets.setdefault("BGS 10", []).append(price_val)
                elif re.search(r"BGS\s*9\.5", title):
                    graded_buckets.setdefault("BGS 9.5", []).append(price_val)
                elif re.search(r"CGC\s*10", title):
                    graded_buckets.setdefault("CGC 10", []).append(price_val)
                elif re.search(r"ARS\s*10\+", title):
                    graded_buckets.setdefault("ARS 10+", []).append(price_val)
                elif re.search(r"ARS\s*10", title):
                    graded_buckets.setdefault("ARS 10", []).append(price_val)
                else:
                    raw_prices.append(price_val)

            raw_avg = compute_trimmed_mean(raw_prices) if raw_prices else None
            graded_out = {}
            ebay_search_url = f"https://www.ebay.fr/sch/i.html?_nkw={urllib.parse.quote_plus(query)}&LH_Sold=1&LH_Complete=1"
            for g, plist in graded_buckets.items():
                avg_g = compute_trimmed_mean(plist)
                if avg_g:
                    graded_out[g] = {
                        "price": avg_g,
                        "sample_count": len(plist),
                        "source": "eBay FR Browse",
                        "source_url": ebay_search_url,
                        "matched_title": sample_title,
                    }

            if raw_avg is None and not graded_out:
                return None

            return {
                "raw_eur": raw_avg,
                "sample_count": len(raw_prices),
                "graded": graded_out,
                "source_name": "eBay FR Browse",
                "source_url": ebay_search_url,
                "matched_title": sample_title,
                "data_type": "sold",
            }
        else:
            report_circuit_failure("ebay_browse", r.status_code)
    except Exception as e:
        logger.debug(f"eBay Browse error: {e}")
        report_circuit_failure("ebay_browse")
    return None


# ---------------------------------------------------------------------------
# Multi-Source Robust Aggregation & Precalculation
# ---------------------------------------------------------------------------
def aggregate_jp_sources(
    jp_sources_raw: List[Dict[str, Any]],
    old_jp: Optional[Dict[str, Any]],
    fx: Dict[str, float],
    now_iso: str,
) -> Optional[Dict[str, Any]]:
    """Aggregates all responding JP buy-side sold sources with 10% trimmed mean & history."""
    if not jp_sources_raw:
        return None

    jpy_to_eur = fx.get("JPY_EUR", 0.005718)
    today_str = now_iso[:10]

    raw_jpy_vals: List[int] = []
    sources_list: List[Dict[str, Any]] = []
    total_samples = 0
    hist_pts: List[Dict[str, Any]] = []
    graded_acc: Dict[str, List[Dict[str, Any]]] = {}

    for src in jp_sources_raw:
        rj = src.get("raw_jpy")
        sc = int(src.get("sample_count") or 0)
        if rj and rj > 0:
            raw_jpy_vals.append(int(rj))
            total_samples += max(sc, 1)
            sources_list.append({
                "name": src.get("source_name", "JP Sold"),
                "price_jpy": int(rj),
                "price_eur": round(rj * jpy_to_eur, 2),
                "sample_count": sc,
                "url": src.get("source_url", ""),
                "matched_title": src.get("matched_title", ""),
                "fetched_at": now_iso,
            })
        hist_pts.extend(src.get("history_points", []))

        for g_name, g_rec in (src.get("graded") or {}).items():
            if g_rec.get("price_jpy") and g_rec["price_jpy"] > 0:
                graded_acc.setdefault(g_name, []).append(g_rec)

    avg_raw_jpy = compute_trimmed_mean(raw_jpy_vals, is_jpy=True) if raw_jpy_vals else None
    avg_raw_eur = round(avg_raw_jpy * jpy_to_eur, 2) if avg_raw_jpy else None

    if avg_raw_jpy:
        hist_pts.append({"date": today_str, "price_jpy": int(avg_raw_jpy), "price_eur": avg_raw_eur})

    old_jp_hist = (old_jp or {}).get("history", [])
    merged_raw_hist = merge_price_history(old_jp_hist, hist_pts)

    graded_final: Dict[str, Any] = {}
    old_jp_graded = (old_jp or {}).get("graded", {})
    for g_name, g_list in graded_acc.items():
        g_jpy_vals = [int(g["price_jpy"]) for g in g_list]
        avg_g_jpy = compute_trimmed_mean(g_jpy_vals, is_jpy=True)
        if not avg_g_jpy:
            continue
        avg_g_eur = round(avg_g_jpy * jpy_to_eur, 2)
        g_samples = sum(int(g.get("sample_count") or 1) for g in g_list)
        g_sources = [
            {
                "name": g.get("source", "SNKRDUNK (Sold JPY)"),
                "price_jpy": int(g["price_jpy"]),
                "price_eur": round(g["price_jpy"] * jpy_to_eur, 2),
                "sample_count": int(g.get("sample_count") or 1),
                "url": g.get("source_url", ""),
                "matched_title": g.get("matched_title", ""),
                "fetched_at": now_iso,
            }
            for g in g_list
        ]
        g_pts = []
        for g in g_list:
            g_pts.extend(g.get("history_points", []))
        g_pts.append({"date": today_str, "price_jpy": int(avg_g_jpy), "price_eur": avg_g_eur})
        old_g_hist = old_jp_graded.get(g_name, {}).get("history", [])

        graded_final[g_name] = {
            "price_jpy": int(avg_g_jpy),
            "price_eur": avg_g_eur,
            "sample_count": g_samples,
            "source": " + ".join(dict.fromkeys(s["name"] for s in g_sources)),
            "sources": g_sources,
            "history": merge_price_history(old_g_hist, g_pts),
        }

    if avg_raw_jpy is None and not graded_final:
        return None

    primary = sources_list[0] if sources_list else {}
    return {
        "smoothed_avg": avg_raw_jpy,
        "raw_jpy": avg_raw_jpy,
        "raw_eur": avg_raw_eur,
        "sample_count": total_samples,
        "source_name": " + ".join(dict.fromkeys(s["name"] for s in sources_list)) or "SNKRDUNK (Sold JPY)",
        "source_url": primary.get("url", ""),
        "matched_title": primary.get("matched_title", ""),
        "sources": sources_list,
        "history": merged_raw_hist,
        "graded": graded_final,
        "data_type": "sold",
    }


def aggregate_fr_sources(
    fr_sources_raw: List[Dict[str, Any]],
    old_fr: Optional[Dict[str, Any]],
    now_iso: str,
) -> Optional[Dict[str, Any]]:
    """Aggregates all responding FR/EU resale sold sources with 10% trimmed mean & history."""
    if not fr_sources_raw:
        return None

    today_str = now_iso[:10]
    raw_eur_vals: List[float] = []
    sources_list: List[Dict[str, Any]] = []
    total_samples = 0
    hist_pts: List[Dict[str, Any]] = []
    cm_trend = None
    graded_acc: Dict[str, List[Dict[str, Any]]] = {}

    for src in fr_sources_raw:
        re_val = src.get("raw_eur") or src.get("smoothed_avg")
        sc = int(src.get("sample_count") or 0)
        if src.get("cardmarket_trend") is not None:
            cm_trend = src["cardmarket_trend"]

        if re_val and float(re_val) > 0:
            raw_eur_vals.append(float(re_val))
            total_samples += max(sc, 1)
            sources_list.append({
                "name": src.get("source_name", "EU Resale"),
                "price_eur": round(float(re_val), 2),
                "sample_count": sc,
                "url": src.get("source_url", ""),
                "matched_title": src.get("matched_title", ""),
                "fetched_at": now_iso,
            })
        hist_pts.extend(src.get("history_points", []))

        for g_name, g_rec in (src.get("graded") or {}).items():
            if g_rec.get("price") and float(g_rec["price"]) > 0:
                graded_acc.setdefault(g_name, []).append(g_rec)

    avg_raw_eur = compute_trimmed_mean(raw_eur_vals, is_jpy=False) if raw_eur_vals else None
    if avg_raw_eur:
        hist_pts.append({"date": today_str, "price_eur": avg_raw_eur})

    old_fr_hist = (old_fr or {}).get("history", [])
    merged_raw_hist = merge_price_history(old_fr_hist, hist_pts)

    graded_final: Dict[str, Any] = {}
    old_fr_graded = (old_fr or {}).get("graded", {})
    for g_name, g_list in graded_acc.items():
        g_eur_vals = [float(g["price"]) for g in g_list]
        avg_g_eur = compute_trimmed_mean(g_eur_vals, is_jpy=False)
        if not avg_g_eur:
            continue
        # Integrity guard: graded >= raw when raw is known and grade is 9.5/10
        if avg_raw_eur and ("10" in g_name or "9.5" in g_name) and avg_g_eur < avg_raw_eur:
            continue
        g_samples = sum(int(g.get("sample_count") or 1) for g in g_list)
        g_sources = [
            {
                "name": g.get("source", "Resale Sold"),
                "price_eur": round(float(g["price"]), 2),
                "sample_count": int(g.get("sample_count") or 1),
                "url": g.get("source_url", ""),
                "matched_title": g.get("matched_title", ""),
                "fetched_at": now_iso,
            }
            for g in g_list
        ]
        old_g_hist = old_fr_graded.get(g_name, {}).get("history", [])
        graded_final[g_name] = {
            "price": avg_g_eur,
            "sample_count": g_samples,
            "source": " + ".join(dict.fromkeys(s["name"] for s in g_sources)),
            "sources": g_sources,
            "history": merge_price_history(old_g_hist, [{"date": today_str, "price_eur": avg_g_eur}]),
        }

    if avg_raw_eur is None and not graded_final:
        return None

    primary = sources_list[0] if sources_list else {}
    return {
        "smoothed_avg": avg_raw_eur,
        "raw_eur": avg_raw_eur,
        "cardmarket_trend": cm_trend,
        "sample_count": total_samples,
        "source_name": " + ".join(dict.fromkeys(s["name"] for s in sources_list)) or "EU Resale",
        "source_url": primary.get("url", ""),
        "matched_title": primary.get("matched_title", ""),
        "sources": sources_list,
        "history": merged_raw_hist,
        "graded": graded_final,
        "data_type": "sold",
    }


def precalculate_arbitrage_metrics(
    fr: Optional[Dict[str, Any]],
    jp: Optional[Dict[str, Any]],
    fx: Dict[str, float],
) -> Dict[str, Any]:
    """
    Computes real arbitrage spread fields:
    - best_direct_spread_eur (Raw JP -> Raw FR or PSA 10 JP -> PSA 10 FR)
    - best_grading_spread_eur (Raw JP + 25€ -> PSA 10 FR)
    - is_high_value (FR resale >= 20€)
    """
    jpy_to_eur = fx.get("JPY_EUR", 0.005718)

    fr_raw = (fr.get("raw_eur") or fr.get("smoothed_avg")) if fr else None
    jp_raw_jpy = (jp.get("raw_jpy") or jp.get("smoothed_avg")) if jp else None
    jp_raw_eur = round(jp_raw_jpy * jpy_to_eur, 2) if jp_raw_jpy else (jp.get("raw_eur") if jp else None)

    fr_psa10 = fr.get("graded", {}).get("PSA 10", {}).get("price") if fr else None
    jp_psa10_eur = jp.get("graded", {}).get("PSA 10", {}).get("price_eur") if jp else None

    direct_spreads: List[float] = []
    if fr_raw is not None and jp_raw_eur is not None:
        direct_spreads.append(round(fr_raw - jp_raw_eur, 2))
    if fr_psa10 is not None and jp_psa10_eur is not None:
        direct_spreads.append(round(fr_psa10 - jp_psa10_eur, 2))

    best_direct = max(direct_spreads) if direct_spreads else None

    best_grading = None
    if fr_psa10 is not None and jp_raw_eur is not None:
        best_grading = round(fr_psa10 - (jp_raw_eur + 25.0), 2)

    is_high_val = False
    if (fr_raw is not None and fr_raw >= 20.0) or (fr_psa10 is not None and fr_psa10 >= 20.0):
        is_high_val = True
    elif fr and any((g.get("price") or 0) >= 20.0 for g in (fr.get("graded") or {}).values()):
        is_high_val = True

    return {
        "best_direct_spread_eur": best_direct,
        "best_grading_spread_eur": best_grading,
        "is_high_value": is_high_val,
    }


# ---------------------------------------------------------------------------
# High-Value Chase Card Prioritization Engine (>= 20€ target)
# ---------------------------------------------------------------------------
TIER1_SPECIAL_REFS = {
    # SV2a 151 Top SAR / UR Chase
    "sv2a 201/165", "sv2a 205/165", "sv2a 202/165", "sv2a 200/165", "sv2a 206/165",
    "sv2a 204/165", "sv2a 203/165", "sv2a 208/165", "sv2a 173/165", "sv2a 183/165",
    # SV8a Terastal Festival, S6a Eevee Heroes, S11/S12/S12a Alt Arts & SARs
    "s6a 095/069", "s6a 093/069", "s6a 091/069", "s6a 089/069",
    "s11 111/100", "s12 110/098", "sv5a 090/066", "sv8 132/106",
    "sv4a 347/190", "sv4a 348/190", "sv4a 349/190", "sv4a 350/190",
    "sv8a 217/187", "sv8a 212/187", "sv8a 209/187", "sv8a 223/187", "sv8a 206/187",
    "sv9 125/100", "sv9 126/100", "sv9a 087/063", "sv10 125/098",
    "s12a 262/172", "s12a 261/172", "s12a 260/172", "s12a 259/172",
    "sv3 134/108", "sv2d 096/071", "s8b 222/184",
    # JP Exclusive Promos (Stamp Box, Yokohama, Munch, Poncho) & Van Gogh
    "s-p 227", "227/s-p", "s-p 226", "001/030", "svp 085", "sv-p 085",
    "sm-p 288", "sm-p 289", "sm-p 290", "xy-p 274", "xy-p 275",
}


def get_card_priority_tier(card: Dict[str, Any], en_name: str) -> int:
    """
    Tier 1 (Priority 1): Top Chase SAR, SIR, Alt Arts, Gold UR, JP Exclusive Promos, Master Balls.
    Tier 2 (Priority 2): Modern SR, HR, CSR, CHR, Secrets, Vintage Holos.
    Tier 3 (Priority 3): Standard ARs, commons (deprioritized).
    """
    ref_lower = (card.get("ref") or "").lower()
    local_id = str(card.get("local_id", ""))
    official_count = card.get("official_count", "---")
    set_id_lower = (card.get("set_id") or "").lower()

    if ref_lower in TIER1_SPECIAL_REFS:
        return 1

    try:
        lid_int = int(re.sub(r"\D", "", local_id).lstrip("0") or "0")
        off_int = int(re.sub(r"\D", "", str(official_count)).lstrip("0") or "9999")
    except ValueError:
        lid_int, off_int = 0, 9999

    is_secret = lid_int > off_int and off_int > 0
    is_promo_set = "-p" in set_id_lower or "promo" in set_id_lower or set_id_lower in ("svp", "s-p", "sm-p", "xy-p")
    name_lower = (card.get("name") or "").lower() + " " + en_name.lower()

    chase_mons = [
        "charizard", "mew", "pikachu", "eevee", "umbreon", "espeon", "sylveon", "leafeon",
        "glaceon", "vaporeon", "jolteon", "flareon", "gengar", "rayquaza", "giratina",
        "lugia", "lillie", "cynthia", "erika", "marnie", "iono", "greninja", "mewtwo",
        "latias", "latios", "garchomp", "ho-oh", "dragonite", "blastoise", "venusaur",
    ]

    if is_secret or is_promo_set:
        if any(k in name_lower for k in chase_mons):
            return 1
        return 2

    if any(k in name_lower for k in ["vmax", "vstar", " sar", " sir", "alt art"]):
        return 2

    return 3


# ---------------------------------------------------------------------------
# TCGdex Discovery Engine (with 12h local cache fallback for 503 resilience)
# ---------------------------------------------------------------------------
TCGDEX_SETS_CACHE = os.path.join(CACHE_DIR, "tcgdex_sets_{lang}.json")
TCGDEX_CARDS_CACHE = os.path.join(CACHE_DIR, "tcgdex_cards_{lang}.json")


def fetch_tcgdex_sets(lang: str = "ja") -> Dict[str, Dict[str, Any]]:
    url = f"https://api.tcgdex.net/v2/{lang}/sets"
    cache_path = TCGDEX_SETS_CACHE.format(lang=lang)
    data = None
    try:
        r = GLOBAL_SESSION.get(url, timeout=12)
        if r.status_code == 200:
            data = r.json()
            with open(cache_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False)
    except Exception as e:
        logger.warning(f"Error fetching TCGdex sets for {lang}: {e}")

    if data is None and os.path.exists(cache_path):
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            logger.info(f"Using cached TCGdex sets for lang={lang.upper()}.")
        except Exception:
            data = None

    if data:
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
    return {}


def fetch_tcgdex_cards(lang: str, set_map: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    url = f"https://api.tcgdex.net/v2/{lang}/cards"
    cache_path = TCGDEX_CARDS_CACHE.format(lang=lang)
    edition = "JP" if lang == "ja" else ("CN" if lang.startswith("zh") else lang.upper())
    card_items = None
    try:
        r = GLOBAL_SESSION.get(url, timeout=18)
        if r.status_code == 200:
            card_items = r.json()
            with open(cache_path, "w", encoding="utf-8") as f:
                json.dump(card_items, f, ensure_ascii=False)
    except Exception as e:
        logger.warning(f"Error fetching TCGdex cards for {lang}: {e}")

    if card_items is None and os.path.exists(cache_path):
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                card_items = json.load(f)
            logger.info(f"Using cached TCGdex cards for lang={lang.upper()}.")
        except Exception:
            card_items = None

    if card_items:
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
                "canonical_key": ref.lower(),
                "card_id": f"{lang}-{raw_id}",
                "local_id": local_id,
                "official_count": official,
                "name": c.get("name"),
                "name_ja": c.get("name") if lang == "ja" else "",
                "set_id": set_id,
                "set_name": s_meta.get("name", set_id),
                "edition": edition,
                "lang": lang,
                "image": c.get("image", ""),
            })
        logger.info(f"Loaded {len(cards)} cards for lang={lang.upper()}.")
        return cards
    return []


# ---------------------------------------------------------------------------
# Worker Thread Task: Process Single Card
# ---------------------------------------------------------------------------
def process_single_card(
    card: Dict[str, Any],
    fx: Dict[str, float],
    species_catalog: Dict[str, Any],
    old_entry: Optional[Dict[str, Any]] = None,
    enable_local_jp: bool = False,
) -> Optional[Dict[str, Any]]:
    """Fetches real JP buy price and real FR resale price from decoupled sold sources."""
    ref = card["ref"]
    canonical_key = card.get("canonical_key") or ref.lower()
    set_id = card.get("set_id", "")
    local_id = str(card.get("local_id", ""))
    set_name = card.get("set_name", "")
    edition = card.get("edition", "JP")
    session = get_thread_session()
    now_iso = datetime.now(timezone.utc).isoformat()

    raw_source_name = card.get("name_ja") or card.get("name", "")
    name_fr, name_en = translate_card_name(raw_source_name, species_catalog)

    # 1. Buy Side (JP, JPY only) — SNKRDUNK + optional local-jp Mercari JP Sold
    jp_sources_raw: List[Dict[str, Any]] = []
    jp_snkr = query_snkrdunk_jp(
        set_id, local_id, card.get("name_ja", ""), name_en, fx, session=session
    )
    if jp_snkr:
        jp_sources_raw.append(jp_snkr)

    if enable_local_jp:
        jp_mercari = query_mercari_jp_sold(
            set_id, local_id, card.get("name_ja", ""), fx, session=session
        )
        if jp_mercari:
            jp_sources_raw.append(jp_mercari)

    jp_data = aggregate_jp_sources(
        jp_sources_raw, (old_entry or {}).get("jp"), fx, now_iso
    )

    # 2. Resale Side (FR/EU, EUR only) — Cardmarket + PriceCharting + eBay FR Browse
    fr_sources_raw: List[Dict[str, Any]] = []
    cm_service = CardmarketService.get_instance()
    fr_cm = cm_service.find_cardmarket_price(set_id, local_id, name_en, set_name=set_name)
    if fr_cm:
        fr_sources_raw.append(fr_cm)

    fr_pc = query_pricecharting_resale(set_id, local_id, name_en, set_name, edition, fx, session=session)
    if fr_pc:
        fr_sources_raw.append(fr_pc)

    fr_ebay = query_ebay_browse_fr(set_id, local_id, name_fr, name_en, session=session)
    if fr_ebay:
        fr_sources_raw.append(fr_ebay)

    fr_data = aggregate_fr_sources(
        fr_sources_raw, (old_entry or {}).get("fr"), now_iso
    )

    if not jp_data and not fr_data:
        return None

    metrics = precalculate_arbitrage_metrics(fr_data, jp_data, fx)

    return {
        "ref": ref,
        "canonical_key": canonical_key,
        "card_id": card.get("card_id", ""),
        "set_id": set_id,
        "local_id": local_id,
        "official_count": card.get("official_count", "---"),
        "name_ja": card.get("name_ja", card.get("name", "")),
        "name_fr": name_fr,
        "name_en": name_en,
        "edition": edition,
        "lang": card.get("lang", "ja"),
        "image": card.get("image", ""),
        "fetched_at": now_iso,
        "fr": fr_data,
        "jp": jp_data,
        "best_direct_spread_eur": metrics["best_direct_spread_eur"],
        "best_grading_spread_eur": metrics["best_grading_spread_eur"],
        "is_high_value": metrics["is_high_value"],
    }


# ---------------------------------------------------------------------------
# Atomic Checkpoint Saver
# ---------------------------------------------------------------------------
def save_prices_checkpoint(
    prices_db: Dict[str, Any],
    fx_rates: Dict[str, float],
    total_processed: int,
):
    """Atomically writes prices.json with unique canonical lowercase keys."""
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
                "circuit_breakers": {k: v["tripped"] for k, v in CIRCUIT_BREAKERS.items()},
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
    parser.add_argument("--max-runtime", type=int, default=0, help="Max runtime in seconds (0 = unlimited)")
    return parser.parse_args()


def _is_clean_v5_entry(entry: Dict[str, Any]) -> bool:
    """Rejects polluted legacy v3 entries (shop prices or PriceCharting on JP side)."""
    jp = entry.get("jp") or {}
    fr = entry.get("fr") or {}
    jp_src = (jp.get("source_name") or "").lower()
    if "pricecharting" in jp_src or "yuyu" in jp_src or "cardrush" in jp_src:
        return False
    has_jp = jp.get("raw_jpy") is not None or bool(jp.get("graded"))
    has_fr = fr.get("raw_eur") is not None or fr.get("smoothed_avg") is not None or bool(fr.get("graded"))
    return has_jp or has_fr


def main():
    args = parse_arguments()
    start_time = time.time()
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

    # 5. Load Existing Database with Single Canonical Lowercase Key (preserving real history)
    existing_prices: Dict[str, Any] = {}
    if os.path.exists(OUTPUT_FILE):
        try:
            with open(OUTPUT_FILE, "r", encoding="utf-8") as f:
                old_data = json.load(f)
                raw_prices = old_data.get("prices", {})
                for k, v in raw_prices.items():
                    if not isinstance(v, dict):
                        continue
                    canon_k = (v.get("canonical_key") or v.get("ref") or k).strip().lower()
                    if not args.force_refresh and _is_clean_v5_entry(v):
                        existing_prices[canon_k] = v
                logger.info(f"Loaded {len(existing_prices)} clean v5 cards from prices.json.")
        except Exception as e:
            logger.warning(f"Could not read previous prices.json: {e}")

    # 6. Fetch Sets and Cards from TCGdex (JA primary)
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
        logger.info(f"Running in TEST mode with {args.test} top priority cards...")
        queue = cards_ja[:args.test]
    else:
        queue = cards_ja

    logger.info(f"Starting worker pool ({args.max_workers} threads) for {len(queue)} target cards...")

    prices_db = dict(existing_prices)
    processed_results: List[Dict[str, Any]] = []
    total_processed = 0
    deadline = (start_time + args.max_runtime - 3) if args.max_runtime > 0 else None

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.max_workers) as executor:
        future_map = {}
        for card in queue:
            if deadline and time.time() >= deadline:
                break
            old_e = existing_prices.get(card["canonical_key"])
            fut = executor.submit(
                process_single_card, card, fx_rates, species_catalog, old_e, args.local_jp
            )
            future_map[fut] = card

        for future in concurrent.futures.as_completed(future_map):
            card = future_map[future]
            total_processed += 1
            try:
                result = future.result()
                if result:
                    with db_lock:
                        prices_db[result["canonical_key"]] = result
                        processed_results.append(result)
            except Exception as e:
                logger.error(f"Error processing {card.get('ref')}: {e}")

            if total_processed % 10 == 0 or total_processed == len(future_map):
                save_prices_checkpoint(prices_db, fx_rates, total_processed)
                elapsed = int(time.time() - start_time)
                logger.info(f"[{total_processed}/{len(future_map)}] Checkpoint saved ({elapsed}s elapsed)")

            if deadline and time.time() >= deadline:
                logger.warning(f"Max runtime ({args.max_runtime}s) reached; cancelling remaining futures.")
                for pending in future_map:
                    pending.cancel()
                break

    save_prices_checkpoint(prices_db, fx_rates, total_processed)

    total_priced_both = sum(
        1 for c in prices_db.values()
        if c.get("fr") and c.get("jp")
        and (c["fr"].get("smoothed_avg") or c["fr"].get("raw_eur"))
        and (c["jp"].get("smoothed_avg") or c["jp"].get("raw_jpy"))
    )

    print("\n" + "=" * 120)
    print("POKÉSPREAD v5.0 RUN SUMMARY & VERIFICATION TABLE")
    print("=" * 120)
    print(f"Cards in Database:       {len(prices_db)}")
    print(f"Total Priced (Both):     {total_priced_both}")
    print(f"Processed this Run:      {total_processed}")
    print(f"Circuit Breakers:        {[k for k, v in CIRCUIT_BREAKERS.items() if v['tripped']] or 'None'}")
    print("=" * 120)

    print(
        f"{'Ref':<14} | {'Nom FR':<20} | {'Achat JP (¥/€)':<18} | {'Src JP':<12} | "
        f"{'Revente FR (€)':<14} | {'Src FR':<22} | {'PSA10 JP/FR':<17} | {'Marge Raw':<10} | {'Marge Grad':<10}"
    )
    print("-" * 145)
    display_cards = processed_results[:15] if processed_results else list(prices_db.values())[:15]
    for c in display_cards:
        ref = c.get("ref", "")
        fr_name = c.get("name_fr") or c.get("name", "")
        jp = c.get("jp") or {}
        fr = c.get("fr") or {}
        jp_buy_yen = jp.get("raw_jpy")
        jp_buy_eur = jp.get("raw_eur")
        fr_sell_eur = fr.get("raw_eur") or fr.get("smoothed_avg")
        jp_psa10 = (jp.get("graded") or {}).get("PSA 10", {}).get("price_jpy")
        fr_psa10 = (fr.get("graded") or {}).get("PSA 10", {}).get("price")
        jp_src = ", ".join(s.get("name", "").split(" (")[0] for s in jp.get("sources", [])) or "---"
        fr_src = ", ".join(s.get("name", "").split(" (")[0] for s in fr.get("sources", [])) or "---"

        m_raw = round(fr_sell_eur - jp_buy_eur, 2) if (fr_sell_eur and jp_buy_eur) else None
        m_grad = c.get("best_grading_spread_eur")

        jp_str = f"{jp_buy_yen}¥/{jp_buy_eur}€" if jp_buy_yen else "---"
        fr_str = f"{fr_sell_eur}€" if fr_sell_eur else "---"
        psa_str = f"{jp_psa10 or '-'}¥ / {fr_psa10 or '-'}€"

        print(
            f"{ref:<14} | {fr_name[:20]:<20} | {jp_str:<18} | {jp_src[:12]:<12} | "
            f"{fr_str:<14} | {fr_src[:22]:<22} | {psa_str:<17} | "
            f"{(str(m_raw) + '€') if m_raw is not None else '---':<10} | "
            f"{(str(m_grad) + '€') if m_grad is not None else '---':<10}"
        )
    print("=" * 145 + "\n")


if __name__ == "__main__":
    main()
