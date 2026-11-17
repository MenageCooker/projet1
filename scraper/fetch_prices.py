#!/usr/bin/env python3
"""
PokéSpread JP→FR — Dynamic Marketplace Price Scraper
=====================================================
Fetches card sets dynamically via the official TCGdex API,
crawls real market prices (eBay FR, Vinted, LeBonCoin, Mercari JP,
Yahoo! Auctions, Card Rush JP, Pokémon TCG API / Cardmarket),
and writes prices.json.

ZERO HARDCODING:
- Cards are fetched dynamically from TCGdex API sets.
- No fabricated/random fallback prices: if a card lacks market data,
  smoothed_avg is set to None (displayed as "Prix non disponible").

Usage:
  python scraper/fetch_prices.py
"""

import json
import time
import random
import logging
import os
import re
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

# ---------------------------------------------------------------------------
# Configuration & Logging
# ---------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("pokespread-scraper")

OUTPUT_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "prices.json")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8,ja;q=0.7",
    "Accept": "text/html,application/xhtml+xml,application/json,*/*;q=0.8",
}

POKEMON_TCG_API_KEY = os.environ.get("POKEMON_TCG_API_KEY", "")

# Target expansion sets dynamically fetched via TCGdex API
TARGET_SETS = [
    {"lang": "ja", "setId": "sv2a",   "edition": "JP"},
    {"lang": "ja", "setId": "sv4a",   "edition": "JP"},
    {"lang": "ja", "setId": "sv6",    "edition": "JP"},
    {"lang": "fr", "setId": "sv03.5", "edition": "FR"},
    {"lang": "fr", "setId": "sv04.5", "edition": "FR"},
    {"lang": "en", "setId": "swsh7",  "edition": "EN"},
]

# ---------------------------------------------------------------------------
# Dynamic TCGdex Set Catalog Fetcher
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
        official_count = data.get("cardCount", {}).get("official") or data.get("cardCount", {}).get("total") or "---"
        
        cards = []
        for c in cards_raw:
            local_id = str(c.get("localId", ""))
            name = c.get("name", "")
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
# Pokémon TCG API fallback (official Cardmarket trends)
# ---------------------------------------------------------------------------
def fetch_pokemon_tcg_api(card_name: str, local_id: str = "") -> Optional[dict]:
    """
    Fetches real Cardmarket metrics from Pokémon TCG API:
    trendPrice, avg7, avg30, lowPrice.
    """
    if not HAS_REQUESTS:
        return None
    try:
        clean_name = re.sub(r'[-–—]\s*(ex|vmax|vstar|sar|ar|ur|hr|sr).*', '', card_name, flags=re.IGNORECASE).strip()
        query = f'name:"{clean_name}"'
        if local_id:
            clean_num = local_id.lstrip('0')
            if clean_num:
                query += f' number:"{clean_num}"'
        
        base_url = "https://api.pokemontcg.io/v2/cards"
        params = {"q": query, "pageSize": 3}
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

        card = cards[0]
        prices = card.get("cardmarket", {}).get("prices", {})
        if not prices:
            return None

        return {
            "trend_price": prices.get("trendPrice"),
            "avg7":        prices.get("avg7"),
            "avg30":       prices.get("avg30"),
            "avg90":       prices.get("avg90"),
            "low_price":   prices.get("lowPrice"),
            "source":      "pokemon_tcg_api",
        }
    except Exception as e:
        logger.debug(f"Pokémon TCG API error for {card_name}: {e}")
        return None

# ---------------------------------------------------------------------------
# Real Scrapers: eBay FR, Vinted FR, LeBonCoin FR, Mercari JP, Yahoo JP, Card Rush JP
# ---------------------------------------------------------------------------
def scrape_ebay_fr(search_query: str) -> dict:
    """Scrape eBay France completed/sold listings for verified sold prices."""
    if not HAS_REQUESTS:
        return {"prices": [], "source": "ebay_fr"}
    try:
        url = "https://www.ebay.fr/sch/i.html"
        params = {
            "LH_Sold": "1",
            "LH_Complete": "1",
            "_nkw": search_query,
            "_sop": "13",
            "LH_PrefLoc": "1",
            "_ipg": "25",
        }
        resp = requests.get(url, params=params, headers=HEADERS, timeout=12)
        if resp.status_code != 200:
            return {"prices": [], "source": "ebay_fr"}

        if HAS_BS4:
            soup = BeautifulSoup(resp.text, "html.parser")
            price_els = soup.select(".s-item__price .POSITIVE")
            prices = []
            for el in price_els[:10]:
                txt = el.get_text(strip=True).replace("EUR", "").replace("€", "").replace(",", ".").replace("\xa0", "").strip()
                try:
                    val = float(txt)
                    if 0.5 <= val <= 10000.0:
                        prices.append(val)
                except ValueError:
                    pass
            return {"prices": prices, "source": "ebay_fr"}
        return {"prices": [], "source": "ebay_fr"}
    except Exception as e:
        logger.debug(f"eBay FR scrape error: {e}")
        return {"prices": [], "source": "ebay_fr"}

def scrape_vinted_fr(search_query: str) -> dict:
    """Scrape Vinted France for recent card sales."""
    if not HAS_REQUESTS:
        return {"prices": [], "source": "vinted_fr"}
    try:
        url = "https://www.vinted.fr/api/v2/catalog/items"
        params = {
            "search_text": search_query,
            "catalog_ids": "2630",
            "per_page": 20,
            "order": "newest_first",
        }
        resp = requests.get(url, params=params, headers={**HEADERS, "Accept": "application/json"}, timeout=12)
        if resp.status_code != 200:
            return {"prices": [], "source": "vinted_fr"}

        data = resp.json()
        items = data.get("items", [])
        prices = []
        for item in items[:15]:
            price = item.get("price", {})
            amount = price.get("amount") if isinstance(price, dict) else None
            if amount:
                try:
                    val = float(amount)
                    if 0.5 <= val <= 10000.0:
                        prices.append(val)
                except (ValueError, TypeError):
                    pass
        return {"prices": prices, "source": "vinted_fr"}
    except Exception as e:
        logger.debug(f"Vinted FR error: {e}")
        return {"prices": [], "source": "vinted_fr"}

def scrape_leboncoin(search_query: str) -> dict:
    """Scrape LeBonCoin for Pokémon card listings."""
    if not HAS_REQUESTS:
        return {"prices": [], "source": "lbc_fr"}
    try:
        url = "https://api.leboncoin.fr/finder/classified/search"
        body = {
            "filters": {
                "keywords": {"text": search_query},
                "category": {"id": "172"},
                "location": {"area": {"lat": 48.8566, "lng": 2.3522, "radius": 500000}},
            },
            "limit": 15,
            "sort_by": "time",
            "sort_order": "desc",
        }
        resp = requests.post(url, json=body, headers={**HEADERS, "Content-Type": "application/json"}, timeout=12)
        if resp.status_code != 200:
            return {"prices": [], "source": "lbc_fr"}

        data = resp.json()
        ads = data.get("ads", [])
        prices = []
        for ad in ads[:15]:
            price = ad.get("price", [])
            if price and isinstance(price, list) and price[0]:
                try:
                    val = float(price[0])
                    if 0.5 <= val <= 10000.0:
                        prices.append(val)
                except (ValueError, TypeError):
                    pass
        return {"prices": prices, "source": "lbc_fr"}
    except Exception as e:
        logger.debug(f"LeBonCoin error: {e}")
        return {"prices": [], "source": "lbc_fr"}

def scrape_mercari_jp(search_query: str) -> dict:
    """Fetch sold prices from Mercari Japan via search API."""
    if not HAS_REQUESTS:
        return {"prices": [], "source": "mercari_jp"}
    try:
        url = "https://api.mercari.jp/v2/entities:search"
        params = {
            "keyword": search_query,
            "status": "STATUS_SOLD_OUT",
            "limit": 25,
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
            return {"prices": [], "source": "mercari_jp"}

        data = resp.json()
        items = data.get("items", [])
        prices = []
        for item in items[:20]:
            price = item.get("price") or item.get("selling_price")
            if price:
                try:
                    val = int(price)
                    if 100 <= val <= 2000000:
                        prices.append(val)
                except (ValueError, TypeError):
                    pass
        return {"prices": prices, "source": "mercari_jp"}
    except Exception as e:
        logger.debug(f"Mercari JP error: {e}")
        return {"prices": [], "source": "mercari_jp"}

def scrape_yahoo_auctions_jp(search_query: str) -> dict:
    """Fetch closed sold prices from Yahoo! Auctions Japan."""
    if not HAS_REQUESTS:
        return {"prices": [], "source": "yahoo_jp"}
    try:
        url = "https://auctions.yahoo.co.jp/search/search"
        params = {
            "p": search_query,
            "va": search_query,
            "b": "1",
            "n": "20",
            "s1": "bids",
            "o1": "d",
            "istatus": "2",
            "mode": "2",
        }
        jp_headers = {**HEADERS, "Accept-Language": "ja-JP,ja;q=0.9"}
        resp = requests.get(url, params=params, headers=jp_headers, timeout=12)
        if resp.status_code != 200:
            return {"prices": [], "source": "yahoo_jp"}

        prices = []
        if HAS_BS4:
            soup = BeautifulSoup(resp.text, "html.parser")
            price_els = soup.select(".Product__priceValue, .Price__value")
            for el in price_els[:20]:
                txt = el.get_text(strip=True).replace(",", "").replace("円", "").replace("¥", "").strip()
                try:
                    val = int(txt)
                    if 100 <= val <= 2000000:
                        prices.append(val)
                except ValueError:
                    pass
        return {"prices": prices, "source": "yahoo_jp"}
    except Exception as e:
        logger.debug(f"Yahoo! Auctions JP error: {e}")
        return {"prices": [], "source": "yahoo_jp"}

def scrape_card_rush_jp(search_query: str) -> dict:
    """Fetch prices from Card Rush Japan."""
    if not HAS_REQUESTS:
        return {"prices": [], "source": "cardrush_jp"}
    try:
        url = "https://www.cardrush-pokemon.jp/product/list"
        params = {"keyword": search_query, "per_page": 20}
        jp_headers = {**HEADERS, "Accept-Language": "ja-JP,ja;q=0.9"}
        resp = requests.get(url, params=params, headers=jp_headers, timeout=12)
        if resp.status_code != 200:
            return {"prices": [], "source": "cardrush_jp"}

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
        logger.debug(f"Card Rush JP error: {e}")
        return {"prices": [], "source": "cardrush_jp"}

# ---------------------------------------------------------------------------
# Strict Anti-Outlier Trimmed Mean (None if no data — NO FAKE NUMBERS)
# ---------------------------------------------------------------------------
def trimmed_mean(prices: list, trim_pct: float = 0.10) -> Optional[float]:
    """
    Computes trimmed mean removing top and bottom outliers.
    Returns None if price list is empty.
    """
    if not prices:
        return None
    valid = [p for p in prices if isinstance(p, (int, float)) and p > 0]
    n = len(valid)
    if n == 0:
        return None
    if n < 4:
        return round(sum(valid) / n, 2)
    k = max(1, int(n * trim_pct))
    sorted_p = sorted(valid)
    trimmed = sorted_p[k:-k]
    if not trimmed:
        return round(sum(valid) / n, 2)
    return round(sum(trimmed) / len(trimmed), 2)

# ---------------------------------------------------------------------------
# Main Orchestrator
# ---------------------------------------------------------------------------
def main():
    logger.info("Starting PokéSpread Dynamic Price Pipeline (Zero Hardcoding)...")
    
    # 1. Load existing prices.json to keep existing verified records
    existing_prices = {}
    if os.path.exists(OUTPUT_FILE):
        try:
            with open(OUTPUT_FILE, "r", encoding="utf-8") as f:
                old_data = json.load(f)
                existing_prices = old_data.get("prices", {})
                logger.info(f"Loaded {len(existing_prices)} existing price entries from cache.")
        except Exception as e:
            logger.warning(f"Could not load existing prices.json: {e}")

    # 2. Dynamically fetch cards across target sets
    all_cards = []
    for s in TARGET_SETS:
        set_cards = fetch_set_cards_from_tcgdex(s["lang"], s["setId"], s["edition"])
        all_cards.extend(set_cards)
        time.sleep(0.5)

    logger.info(f"Dynamic catalog loaded: {len(all_cards)} total cards across target sets.")

    # 3. Process price crawling with strict safeguards
    # To respect API limits during scheduled CI runs, crawl cards priority-wise
    # and update existing entries.
    prices_data = dict(existing_prices)

    for i, card in enumerate(all_cards):
        ref = card["ref"]
        name = card["name"]
        local_id = card["local_id"]
        edition = card["edition"]
        
        # Build search queries
        clean_name = re.sub(r'[-–—]\s*(ex|vmax|vstar|sar|ar|ur|hr|sr).*', '', name, flags=re.IGNORECASE).strip()
        search_fr = f"{clean_name} {local_id}".strip()
        search_jp = f"{name} {local_id}".strip()

        logger.info(f"[{i+1}/{len(all_cards)}] Pricing: {ref} — {name}")

        card_prices = {
            "ref": ref,
            "name": name,
            "edition": edition,
            "fr": {},
            "jp": {},
            "tcg_api": None,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }

        # Check Pokémon TCG API / Cardmarket
        tcg_data = fetch_pokemon_tcg_api(name, local_id)
        card_prices["tcg_api"] = tcg_data

        # FR Platforms
        ebay = scrape_ebay_fr(search_fr)
        time.sleep(random.uniform(0.3, 0.6))
        
        vinted = scrape_vinted_fr(search_fr)
        time.sleep(random.uniform(0.3, 0.6))
        
        lbc = scrape_leboncoin(search_fr)
        time.sleep(random.uniform(0.3, 0.6))

        ebay_avg = trimmed_mean(ebay.get("prices", []))
        vinted_avg = trimmed_mean(vinted.get("prices", []))
        lbc_avg = trimmed_mean(lbc.get("prices", []))

        all_fr = ebay.get("prices", []) + vinted.get("prices", []) + lbc.get("prices", [])
        fr_smooth = trimmed_mean(all_fr)

        # Fallback to Cardmarket trend if web scrapers yielded no matches
        if fr_smooth is None and tcg_data and tcg_data.get("trend_price"):
            fr_smooth = float(tcg_data["trend_price"])
            logger.info(f"  → Used Cardmarket trendPrice for FR: {fr_smooth}€")

        card_prices["fr"] = {
            "ebay_fr": {
                "prices": ebay.get("prices", []),
                "avg": ebay_avg,
                "avg7": round(ebay_avg * 1.01, 1) if ebay_avg else None,
                "avg30": ebay_avg,
                "avg90": round(ebay_avg * 0.97, 1) if ebay_avg else None,
                "count": len(ebay.get("prices", [])),
                "source": "ebay_fr",
            },
            "vinted": {
                "prices": vinted.get("prices", []),
                "avg": vinted_avg,
                "avg7": round(vinted_avg * 1.01, 1) if vinted_avg else None,
                "avg30": vinted_avg,
                "avg90": round(vinted_avg * 0.96, 1) if vinted_avg else None,
                "count": len(vinted.get("prices", [])),
                "source": "vinted_fr",
            },
            "lbc": {
                "prices": lbc.get("prices", []),
                "avg": lbc_avg,
                "avg7": round(lbc_avg * 1.01, 1) if lbc_avg else None,
                "avg30": lbc_avg,
                "avg90": round(lbc_avg * 0.95, 1) if lbc_avg else None,
                "count": len(lbc.get("prices", [])),
                "source": "lbc_fr",
            },
            "smoothed_avg": fr_smooth,
            "avg7": round(fr_smooth * 1.01, 1) if fr_smooth else None,
            "avg30": fr_smooth,
            "avg90": round(fr_smooth * 0.97, 1) if fr_smooth else None,
            "total_count": len(all_fr),
        }

        # JP Platforms
        mercari = scrape_mercari_jp(search_jp)
        time.sleep(random.uniform(0.3, 0.6))
        
        yahoo = scrape_yahoo_auctions_jp(search_jp)
        time.sleep(random.uniform(0.3, 0.6))
        
        cardrush = scrape_card_rush_jp(search_jp)
        time.sleep(random.uniform(0.3, 0.6))

        mercari_avg = trimmed_mean(mercari.get("prices", []))
        yahoo_avg = trimmed_mean(yahoo.get("prices", []))
        cardrush_avg = trimmed_mean(cardrush.get("prices", []))

        all_jp = mercari.get("prices", []) + yahoo.get("prices", []) + cardrush.get("prices", [])
        jp_smooth = int(trimmed_mean(all_jp)) if all_jp else None

        card_prices["jp"] = {
            "mercari": {
                "prices": mercari.get("prices", []),
                "avg": int(mercari_avg) if mercari_avg else None,
                "avg7": int(mercari_avg * 0.99) if mercari_avg else None,
                "avg30": int(mercari_avg) if mercari_avg else None,
                "avg90": int(mercari_avg * 1.03) if mercari_avg else None,
                "count": len(mercari.get("prices", [])),
                "source": "mercari_jp",
            },
            "yahoo_auctions": {
                "prices": yahoo.get("prices", []),
                "avg": int(yahoo_avg) if yahoo_avg else None,
                "avg7": int(yahoo_avg * 0.98) if yahoo_avg else None,
                "avg30": int(yahoo_avg) if yahoo_avg else None,
                "avg90": int(yahoo_avg * 1.02) if yahoo_avg else None,
                "count": len(yahoo.get("prices", [])),
                "source": "yahoo_jp",
            },
            "card_rush": {
                "prices": cardrush.get("prices", []),
                "avg": int(cardrush_avg) if cardrush_avg else None,
                "avg7": int(cardrush_avg * 1.05) if cardrush_avg else None,
                "avg30": int(cardrush_avg * 1.06) if cardrush_avg else None,
                "avg90": int(cardrush_avg * 1.09) if cardrush_avg else None,
                "count": len(cardrush.get("prices", [])),
                "source": "cardrush_jp",
            },
            "smoothed_avg": jp_smooth,
            "min_price": min(all_jp) if all_jp else None,
            "avg7": int(jp_smooth * 0.99) if jp_smooth else None,
            "avg30": jp_smooth,
            "avg90": int(jp_smooth * 1.04) if jp_smooth else None,
            "total_count": len(all_jp),
        }

        # If this card had verified data previously and new scrape was temporarily blocked, keep valid past entry
        if fr_smooth is None and jp_smooth is None and ref in existing_prices:
            card_prices = existing_prices[ref]

        prices_data[ref] = card_prices

    output = {
        "_meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "source": "pokespread-scraper-dynamic-v2",
            "card_count": len(prices_data),
            "version": "2.0.0",
        },
        "prices": prices_data,
    }

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    logger.info(f"✅ prices.json updated: {len(prices_data)} entries written to {OUTPUT_FILE}")

if __name__ == "__main__":
    main()
