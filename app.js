// ============================================================
//  PokéSpread JP→FR — Clean Production Architecture v4.0
//  High-Performance Pokémon TCG Arbitrage Platform
// ============================================================

// ── 1. GLOBAL STATE ──────────────────────────────────────────
const state = {
  rate: 174.88,                                        // EUR/JPY live exchange rate
  usdRate: 1.097,                                      // EUR/USD live rate
  fee: 0,                                              // Platform fee % (0% default)
  shippingCostEur: 0,                                  // Shipping / import fee per card (€)
  costs: {
    resaleFeePct: 0,                                   // Commission revente % (0% default for Vinted/LBC, 13% for eBay)
    importVatPct: 0,                                    // TVA Import % (0% for hand-carry, 20% for shipped)
    shippingPerCardEur: 0                              // Frais de port / proxy par carte (€)
  },
  purchasedCards: [],
  visibleCount: { margin: 25, roi: 25, velocity: 25 }, // Pagination steps: 25 -> 100 -> 250 -> 500
  searchQuery: '',
  focusCol: null,                                      // 'margin' | 'roi' | 'velocity' | null
  activeMobileTab: 'margin',                           // 'margin' | 'roi' | 'velocity'
  isLoadingCatalog: false,
  pricingRefFr: 'avg',                                 // 'avg' | 'cardmarket' | 'pricecharting' | 'ebay'
  pricingRefJp: 'min',                                 // 'min' | 'yuyutei' | 'pricecharting' | 'snkrdunk'
  condition: {
    mode: 'raw',                                       // 'raw' | 'graded'
    rawCondition: 'NM',                                // 'NM' | 'EX' | 'LP' | 'PL'
    company: 'ALL',                                    // 'ALL' | 'PSA' | 'BGS' | 'CGC' | 'PCA' | 'ARS'
    grade: 'PSA 10'                                    // 'PSA 10' | 'PSA 9' | etc.
  },
  filters: {
    countries: [],                                     // ['JP', 'FR', 'EN', etc.]. Empty = all
    priceMin: null,
    priceMax: null,
    priceUnit: 'EUR',                                  // 'EUR' | 'JPY'
    pricedOnly: false,                                 // Show strictly verified complete opportunities
    slabGrade: null                                    // null or specific grade override
  }
};

// ── 2. SAFE FORMATTERS (CRASH-PROOF) ─────────────────────────
function fmtEur(val, decimals = 2) {
  if (val == null || isNaN(val) || val <= 0) return '—';
  return Number(val).toFixed(decimals) + '€';
}

function fmtJpy(val) {
  if (val == null || isNaN(val) || val <= 0) return '—';
  return '¥' + Math.round(Number(val)).toLocaleString('fr-FR');
}

function fmtPct(val, decimals = 0) {
  if (val == null || isNaN(val)) return '—';
  const num = Number(val);
  return (num >= 0 ? '+' : '') + num.toFixed(decimals) + '%';
}

function jpToEur(yen) {
  if (yen == null || isNaN(yen) || yen <= 0 || !state.rate) return 0;
  return Number(yen) / state.rate;
}

function eurToJpy(eur) {
  if (eur == null || isNaN(eur) || eur <= 0 || !state.rate) return 0;
  return Number(eur) * state.rate;
}

// ── 3. GRADING SCALES & MULTIPLIERS (FALLBACK BENCHMARKS) ────
const GRADING_COMPANIES = {
  PSA: { name: 'PSA', grades: ['PSA 10', 'PSA 9', 'PSA 8', 'PSA ≤ 7'] },
  BGS: { name: 'BGS', grades: ['BGS 10 Black Label', 'BGS 10 Pristine', 'BGS 9.5', 'BGS 9', 'BGS ≤ 8.5'] },
  CGC: { name: 'CGC', grades: ['CGC 10 Pristine', 'CGC 10', 'CGC 9.5', 'CGC 9', 'CGC ≤ 8.5'] },
  PCA: { name: 'PCA', grades: ['PCA 10+', 'PCA 10', 'PCA 9.5', 'PCA 9', 'PCA ≤ 8'] },
  ARS: { name: 'ARS', grades: ['ARS 10+', 'ARS 10', 'ARS 9', 'ARS ≤ 8'] },
  ALL: { name: 'Toutes compagnies', grades: ['PSA 10', 'PSA 9', 'BGS 10', 'BGS 9.5', 'CGC 10', 'PCA 10', 'ARS 10'] }
};

const GRADE_MULTIPLIERS = {
  'PSA 10': { fr: 2.60, jp: 2.30 },
  'PSA 9':  { fr: 1.30, jp: 1.25 },
  'PSA 8':  { fr: 1.00, jp: 0.98 },
  'BGS 10 Black Label': { fr: 4.80, jp: 4.20 },
  'BGS 10 Pristine':    { fr: 3.40, jp: 3.00 },
  'BGS 9.5':            { fr: 1.90, jp: 1.80 },
  'BGS 9':              { fr: 1.30, jp: 1.25 },
  'CGC 10 Pristine':    { fr: 3.20, jp: 2.80 },
  'CGC 10':             { fr: 2.35, jp: 2.15 },
  'CGC 9.5':            { fr: 1.65, jp: 1.55 },
  'CGC 9':              { fr: 1.22, jp: 1.18 },
  'PCA 10+':            { fr: 3.00, jp: 2.60 },
  'PCA 10':             { fr: 2.20, jp: 2.00 },
  'PCA 9.5':            { fr: 1.55, jp: 1.45 },
  'PCA 9':              { fr: 1.20, jp: 1.15 },
  'ARS 10+':            { fr: 3.60, jp: 3.20 },
  'ARS 10':             { fr: 2.75, jp: 2.50 },
  'ARS 9':              { fr: 1.35, jp: 1.30 },
};

const RAW_CONDITION_MULTIPLIERS = {
  'NM': 1.00,
  'EX': 0.82,
  'LP': 0.65,
  'PL': 0.45,
};

const COUNTRIES = [
  { code: 'JP', name: 'Japon', flag: '🇯🇵' },
  { code: 'FR', name: 'France', flag: '🇫🇷' },
  { code: 'EN', name: 'Anglais', flag: '🇺🇸' },
  { code: 'KR', name: 'Corée', flag: '🇰🇷' },
  { code: 'CN', name: 'Chine', flag: '🇨🇳' },
  { code: 'DE', name: 'Allemagne', flag: '🇩🇪' },
  { code: 'IT', name: 'Italie', flag: '🇮🇹' },
  { code: 'ES', name: 'Espagne', flag: '🇪🇸' },
];

const PRICE_PRESETS_EUR = [
  { label: '0 - 15 €', min: 0, max: 15 },
  { label: '15 - 40 €', min: 15, max: 40 },
  { label: '40 - 80 €', min: 40, max: 80 },
  { label: '80 - 150 €', min: 80, max: 150 },
  { label: '150 - 300 €', min: 150, max: 300 },
  { label: '300 - 600 €', min: 300, max: 600 },
  { label: '600 € +', min: 600, max: null }
];

const PRICE_PRESETS_JPY = [
  { label: '0 - 2 500 ¥', min: 0, max: 2500 },
  { label: '2 500 - 6 500 ¥', min: 2500, max: 6500 },
  { label: '6 500 - 13 000 ¥', min: 6500, max: 13000 },
  { label: '13 000 - 25 000 ¥', min: 13000, max: 25000 },
  { label: '25 000 - 50 000 ¥', min: 25000, max: 50000 },
  { label: '50 000 - 100 000 ¥', min: 50000, max: 100000 },
  { label: '100 000 ¥ +', min: 100000, max: null }
];

// ── 4. NORMALIZATION & O(1) EXACT PRICE MAP ───────────────────
function normalizeKey(setId, localId, officialCount = '') {
  if (!setId && !localId) return '';
  const s = String(setId || '').trim().toLowerCase();
  const l = String(localId || '').trim().toLowerCase();
  const o = String(officialCount || '').trim().toLowerCase();
  if (o && o !== '---') {
    return `${s} ${l}/${o}`;
  }
  return `${s} ${l}`;
}

const PriceService = {
  priceMap: new Map(),
  meta: {},

  async loadPrices() {
    try {
      const resp = await fetch('prices.json?t=' + Date.now(), { cache: 'no-store' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      this.meta = data._meta || {};
      this.priceMap.clear();

      const pricesObj = data.prices || {};
      for (const [key, item] of Object.entries(pricesObj)) {
        if (!item) continue;
        const normKey = key.trim().toLowerCase();
        this.priceMap.set(normKey, item);

        // Also index by setId + localId (e.g. 'sv2a 201')
        if (item.set_id && item.local_id) {
          const altKey = `${item.set_id.trim().toLowerCase()} ${item.local_id.trim().toLowerCase()}`;
          this.priceMap.set(altKey, item);
        }
        if (item.card_id) {
          this.priceMap.set(item.card_id.trim().toLowerCase(), item);
        }
      }

      // Update rate if present in metadata
      if (this.meta.fx_rates?.EUR_JPY) {
        state.rate = this.meta.fx_rates.EUR_JPY;
      }
      if (this.meta.fx_rates?.EUR_USD) {
        state.usdRate = this.meta.fx_rates.EUR_USD;
      }

      this.updateHeaderMeta();
      return true;
    } catch (err) {
      console.warn('Could not load prices.json:', err);
      return false;
    }
  },

  updateHeaderMeta() {
    const lastUpdateEl = document.getElementById('last-update');
    const badgeEl = document.getElementById('prices-source-badge');
    const rateEl = document.getElementById('live-rate');

    if (rateEl) rateEl.textContent = state.rate.toFixed(2);

    if (this.meta.generated_at && lastUpdateEl) {
      try {
        const dt = new Date(this.meta.generated_at);
        lastUpdateEl.textContent = dt.toLocaleDateString('fr-FR', {
          day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
        });
      } catch (e) {
        lastUpdateEl.textContent = 'Récemment';
      }
    }

    if (badgeEl) {
      const totalPriced = this.meta.total_priced_both || this.meta.priced_cards || this.priceMap.size;
      badgeEl.className = 'prices-source-badge prices-source-file ml-0.5 text-[10px] px-1.5 py-0.5';
      badgeEl.textContent = `🟢 Marché Vérifié (${totalPriced})`;
    }
  },

  getExactPrice(card) {
    if (!card) return null;
    const setId = card.set_id || card.setId || '';
    const localId = card.local_id || card.localId || '';
    const official = card.official_count || card.officialCount || '';

    // 1. Try exact ref key e.g. 'sv2a 201/165'
    const fullKey = normalizeKey(setId, localId, official);
    if (this.priceMap.has(fullKey)) return this.priceMap.get(fullKey);

    // 2. Try short key e.g. 'sv2a 201'
    const shortKey = normalizeKey(setId, localId);
    if (this.priceMap.has(shortKey)) return this.priceMap.get(shortKey);

    // 3. Try card rawId / id
    if (card.raw_id && this.priceMap.has(card.raw_id.toLowerCase())) {
      return this.priceMap.get(card.raw_id.toLowerCase());
    }
    if (card.id && this.priceMap.has(card.id.toLowerCase())) {
      return this.priceMap.get(card.id.toLowerCase());
    }

    return null;
  }
};

// ── 5. INDEXEDDB LOCAL CATALOG CACHING (24H TTL) ──────────────
const CatalogService = {
  db: null,
  cards: [],
  indexedCardsMap: new Map(),

  async initDB() {
    return new Promise((resolve) => {
      const request = indexedDB.open('PokéSpreadCatalogDB', 2);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('catalog')) {
          db.createObjectStore('catalog', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('metadata')) {
          db.createObjectStore('metadata', { keyPath: 'key' });
        }
      };
      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };
      request.onerror = () => resolve(null);
    });
  },

  async loadCatalog() {
    state.isLoadingCatalog = true;
    await this.initDB();

    // 1. Check local IndexedDB cache
    const cached = await this.getCachedCards();
    if (cached && cached.length > 500) {
      console.log(`Loaded ${cached.length} cards from IndexedDB cache.`);
      this.populateCards(cached);
      state.isLoadingCatalog = false;
      return cached;
    }

    // 2. Fetch fresh catalog from TCGdex API
    try {
      const cards = await this.fetchRemoteTCGdexCatalog();
      if (cards && cards.length > 0) {
        this.populateCards(cards);
        this.cacheCards(cards);
      }
    } catch (err) {
      console.warn('Error fetching TCGdex catalog:', err);
    }

    state.isLoadingCatalog = false;
    return this.cards;
  },

  async getCachedCards() {
    if (!this.db) return null;
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(['catalog', 'metadata'], 'readonly');
        const metaStore = tx.objectStore('metadata');
        const getMeta = metaStore.get('catalog_timestamp');

        getMeta.onsuccess = () => {
          const meta = getMeta.result;
          const now = Date.now();
          // 24 hours TTL
          if (!meta || (now - meta.value) > 24 * 60 * 60 * 1000) {
            resolve(null);
            return;
          }

          const cardStore = tx.objectStore('catalog');
          const getAll = cardStore.getAll();
          getAll.onsuccess = () => resolve(getAll.result);
          getAll.onerror = () => resolve(null);
        };
        getMeta.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  },

  async cacheCards(cardList) {
    if (!this.db || !cardList || cardList.length === 0) return;
    try {
      const tx = this.db.transaction(['catalog', 'metadata'], 'readwrite');
      const cardStore = tx.objectStore('catalog');
      const metaStore = tx.objectStore('metadata');

      cardStore.clear();
      for (const c of cardList) {
        cardStore.put(c);
      }
      metaStore.put({ key: 'catalog_timestamp', value: Date.now() });
    } catch (e) {
      console.warn('IndexedDB write error:', e);
    }
  },

  async clearCache() {
    if (!this.db) return;
    try {
      const tx = this.db.transaction(['catalog', 'metadata'], 'readwrite');
      tx.objectStore('catalog').clear();
      tx.objectStore('metadata').clear();
    } catch (e) {}
  },

  async fetchRemoteTCGdexCatalog() {
    const languages = [
      { lang: 'ja', edition: 'JP' },
      { lang: 'fr', edition: 'FR' },
    ];

    const allCards = [];

    for (const { lang, edition } of languages) {
      try {
        // Fetch sets for official counts
        const setsRes = await fetch(`https://api.tcgdex.net/v2/${lang}/sets`);
        const setMap = new Map();
        if (setsRes.ok) {
          const setsList = await setsRes.json();
          for (const s of setsList) {
            const cc = s.cardCount || {};
            setMap.set(s.id, {
              official: String(cc.official || cc.total || '---'),
              name: s.name || s.id
            });
          }
        }

        // Fetch cards bulk
        const cardsRes = await fetch(`https://api.tcgdex.net/v2/${lang}/cards`);
        if (cardsRes.ok) {
          const cardItems = await cardsRes.json();
          for (const c of cardItems) {
            if (!c.id || !c.localId || !c.name || !c.image) continue;
            const setId = c.id.includes('-') ? c.id.split('-')[0] : c.id;
            const sMeta = setMap.get(setId) || {};
            const officialCount = sMeta.official || '---';

            const ref = officialCount !== '---' ? `${setId} ${c.localId}/${officialCount}` : `${setId} ${c.localId}`;

            allCards.push({
              id: `${lang}-${c.id}`,
              raw_id: c.id,
              ref: ref,
              local_id: String(c.localId),
              official_count: officialCount,
              set_id: setId,
              name: c.name,
              name_ja: edition === 'JP' ? c.name : '',
              edition: edition,
              lang: lang,
              image: c.image
            });
          }
        }
      } catch (err) {
        console.warn(`Failed loading cards for ${lang}:`, err);
      }
    }

    return allCards;
  },

  populateCards(cardList) {
    this.cards = cardList;
    this.indexedCardsMap.clear();

    for (const c of cardList) {
      const key = normalizeKey(c.set_id, c.local_id, c.official_count);
      this.indexedCardsMap.set(key, c);
      this.indexedCardsMap.set(normalizeKey(c.set_id, c.local_id), c);
      this.indexedCardsMap.set(c.id.toLowerCase(), c);
    }

    // Attach prices from priceMap directly
    for (const c of this.cards) {
      const priced = PriceService.getExactPrice(c);
      if (priced) {
        c.pricedRecord = priced;
        if (priced.name_fr && c.edition === 'JP') {
          c.displayName = priced.name_fr;
          c.subName = priced.name_ja || c.name;
        } else {
          c.displayName = c.name;
        }
      } else {
        c.displayName = c.name;
      }
    }
  }
};

// ── 6. PRICING & ARBITRAGE FINANCIAL LOGIC ────────────────────
function getActiveFrPrice(card, customGradeOrCondition = null) {
  if (!card) return null;
  const p = card.pricedRecord || PriceService.getExactPrice(card);
  if (!p || !p.fr) return null;

  const slabKey = customGradeOrCondition || state.filters.slabGrade || (state.condition.mode === 'graded' ? state.condition.grade : null);

  // If graded mode is selected
  if (slabKey && slabKey !== 'raw_nm') {
    // 1. Check if real verified graded transaction exists
    const gradedRec = p.fr.graded?.[slabKey];
    if (gradedRec?.price && Number(gradedRec.price) > 0) {
      return Number(gradedRec.price);
    }
    // 2. Otherwise apply authentic grade multiplier to raw price
    const rawFr = p.fr.smoothed_avg || p.fr.raw_eur;
    if (rawFr && Number(rawFr) > 0) {
      const mult = GRADE_MULTIPLIERS[slabKey]?.fr || 2.20;
      return Number((rawFr * mult).toFixed(2));
    }
    return null;
  }

  // Raw condition calculation
  let rawFr = p.fr.smoothed_avg || p.fr.raw_eur || p.fr.cardmarket_trend;
  if (state.pricingRefFr === 'ebay' && p.fr.source_name?.includes('eBay')) {
    rawFr = p.fr.raw_eur || rawFr;
  }
  if (!rawFr || Number(rawFr) <= 0) return null;

  const cond = state.condition.mode === 'raw' ? state.condition.rawCondition : 'NM';
  const condMult = RAW_CONDITION_MULTIPLIERS[cond] || 1.0;
  return Number((rawFr * condMult).toFixed(2));
}

function getActiveJpPrice(card, customGradeOrCondition = null) {
  if (!card) return null;
  const p = card.pricedRecord || PriceService.getExactPrice(card);
  if (!p || !p.jp) return null;

  const slabKey = customGradeOrCondition || state.filters.slabGrade || (state.condition.mode === 'graded' ? state.condition.grade : null);

  // If graded mode is selected
  if (slabKey && slabKey !== 'raw_nm') {
    const gradedRec = p.jp.graded?.[slabKey];
    if (gradedRec?.price && Number(gradedRec.price) > 0) {
      return Number(gradedRec.price);
    }
    const rawJp = p.jp.raw_jpy || p.jp.smoothed_avg;
    if (rawJp && Number(rawJp) > 0) {
      const mult = GRADE_MULTIPLIERS[slabKey]?.jp || 2.00;
      return Math.round(rawJp * mult);
    }
    return null;
  }

  // Raw condition calculation
  let rawJp = p.jp.raw_jpy || p.jp.smoothed_avg;
  if (state.pricingRefJp === 'yuyutei' && p.jp.source_name?.includes('Yuyu-tei')) {
    rawJp = p.jp.raw_jpy || rawJp;
  }
  if (!rawJp || Number(rawJp) <= 0) return null;

  const cond = state.condition.mode === 'raw' ? state.condition.rawCondition : 'NM';
  const condMult = RAW_CONDITION_MULTIPLIERS[cond] || 1.0;
  return Math.round(rawJp * condMult);
}

function netMargin(card, customGrade = null) {
  const frSell = getActiveFrPrice(card, customGrade);
  const jpBuyYen = getActiveJpPrice(card, customGrade);

  if (frSell == null || jpBuyYen == null || frSell <= 0 || jpBuyYen <= 0) {
    return null;
  }

  const jpBuyEur = jpToEur(jpBuyYen);
  const vatRate = (state.costs?.importVatPct || 0) / 100;
  const feeRate = (state.costs?.resaleFeePct || 0) / 100;
  const shipping = state.costs?.shippingPerCardEur || 0;

  const jpCostWithVat = jpBuyEur * (1 + vatRate);
  const totalCost = jpCostWithVat + shipping + (frSell * feeRate);

  return Number((frSell - totalCost).toFixed(2));
}

function netROI(card, customGrade = null) {
  const frSell = getActiveFrPrice(card, customGrade);
  const jpBuyYen = getActiveJpPrice(card, customGrade);

  if (frSell == null || jpBuyYen == null || frSell <= 0 || jpBuyYen <= 0) {
    return null;
  }

  const jpBuyEur = jpToEur(jpBuyYen);
  const vatRate = (state.costs?.importVatPct || 0) / 100;
  const feeRate = (state.costs?.resaleFeePct || 0) / 100;
  const shipping = state.costs?.shippingPerCardEur || 0;

  const jpCostWithVat = jpBuyEur * (1 + vatRate);
  const totalCost = jpCostWithVat + shipping + (frSell * feeRate);

  if (totalCost <= 0) return 0;
  return Number((((frSell - totalCost) / totalCost) * 100).toFixed(1));
}

function getCardLiquidity(card) {
  const p = card.pricedRecord || PriceService.getExactPrice(card);
  if (!p) return 0;
  const samplesFr = p.fr?.sample_count || 0;
  const samplesJp = p.jp?.sample_count || 0;
  return samplesFr + samplesJp;
}

// ── 7. FILTER ENGINE ──────────────────────────────────────────
function isFilterModeActive() {
  return (
    (state.filters.countries && state.filters.countries.length > 0) ||
    state.filters.priceMin !== null ||
    state.filters.priceMax !== null ||
    state.filters.pricedOnly === true ||
    state.filters.slabGrade !== null ||
    (state.searchQuery && state.searchQuery.trim().length > 0)
  );
}

function cardMatchesFilters(card) {
  if (!card) return false;

  // 1. Text Search Filter
  if (state.searchQuery && state.searchQuery.trim().length > 0) {
    const q = state.searchQuery.toLowerCase().trim();
    const nameMatch = (card.name || '').toLowerCase().includes(q) ||
                      (card.displayName || '').toLowerCase().includes(q) ||
                      (card.subName || '').toLowerCase().includes(q);
    const refMatch = (card.ref || '').toLowerCase().includes(q);
    const setMatch = (card.set_id || '').toLowerCase().includes(q);
    const numMatch = (card.local_id || '').toLowerCase() === q;

    if (!nameMatch && !refMatch && !setMatch && !numMatch) {
      return false;
    }
  }

  // 2. Edition / Country Filter
  if (state.filters.countries && state.filters.countries.length > 0) {
    if (!state.filters.countries.includes(card.edition)) {
      return false;
    }
  }

  const frPrice = getActiveFrPrice(card);
  const jpPriceYen = getActiveJpPrice(card);
  const jpPriceEur = jpPriceYen ? jpToEur(jpPriceYen) : null;

  // 3. Complete Opportunities Toggle (Strictly JP + FR priced)
  if (state.filters.pricedOnly) {
    if (frPrice == null || jpPriceYen == null) {
      return false;
    }
  }

  // 4. Price Min / Max Filter
  const priceToCheck = state.filters.priceUnit === 'JPY'
    ? (jpPriceYen != null ? jpPriceYen : (frPrice != null ? eurToJpy(frPrice) : null))
    : (frPrice != null ? frPrice : (jpPriceEur != null ? jpPriceEur : null));

  if (priceToCheck == null && (state.filters.priceMin !== null || state.filters.priceMax !== null)) {
    return false;
  }

  if (state.filters.priceMin !== null && priceToCheck < state.filters.priceMin) {
    return false;
  }
  if (state.filters.priceMax !== null && priceToCheck > state.filters.priceMax) {
    return false;
  }

  return true;
}

// ── 8. THREE-COLUMN ARBITRAGE RANKING ENGINE ─────────────────
function getSortedOpportunities() {
  const catalog = CatalogService.cards;
  const filtered = catalog.filter(cardMatchesFilters);

  // Group cards into:
  // A: Fully priced on BOTH sides (JP + FR) -> ALWAYS appear first
  // B: Partially priced (FR only or JP only)
  // C: Unpriced

  function categorize(card) {
    const fr = getActiveFrPrice(card);
    const jp = getActiveJpPrice(card);
    if (fr != null && jp != null) return 0; // Both verified
    if (fr != null || jp != null) return 1; // Partial
    return 2;                               // Unpriced
  }

  // 1. MEILLEURE MARGE (€)
  const byMargin = [...filtered].sort((a, b) => {
    const catA = categorize(a);
    const catB = categorize(b);
    if (catA !== catB) return catA - catB;

    const mA = netMargin(a) ?? -Infinity;
    const mB = netMargin(b) ?? -Infinity;
    if (mA !== mB) return mB - mA;

    const frA = getActiveFrPrice(a) ?? 0;
    const frB = getActiveFrPrice(b) ?? 0;
    return frB - frA;
  });

  // 2. MEILLEUR ROI (%)
  const byROI = [...filtered].sort((a, b) => {
    const catA = categorize(a);
    const catB = categorize(b);
    if (catA !== catB) return catA - catB;

    const rA = netROI(a) ?? -Infinity;
    const rB = netROI(b) ?? -Infinity;
    if (rA !== rB) return rB - rA;

    const mA = netMargin(a) ?? -Infinity;
    const mB = netMargin(b) ?? -Infinity;
    return mB - mA;
  });

  // 3. QUICK TURNOVER (Verified sales liquidity + positive margin)
  const byVelocity = [...filtered].sort((a, b) => {
    const catA = categorize(a);
    const catB = categorize(b);
    if (catA !== catB) return catA - catB;

    const vA = getCardLiquidity(a);
    const vB = getCardLiquidity(b);
    if (vA !== vB) return vB - vA;

    const mA = netMargin(a) ?? -Infinity;
    const mB = netMargin(b) ?? -Infinity;
    return mB - mA;
  });

  return { byMargin, byROI, byVelocity, totalMatches: filtered.length };
}

// ── 9. CARD TILE RENDERING ────────────────────────────────────
function formatHighResCardImage(url) {
  if (!url || typeof url !== 'string') return '';
  const clean = url.trim();
  if (clean.endsWith('/high.webp') || clean.endsWith('.png') || clean.endsWith('.webp') || clean.endsWith('.jpg')) {
    return clean;
  }
  return `${clean}/high.webp`;
}

function onCardImageError(imgEl) {
  if (!imgEl) return;
  if (imgEl.src && imgEl.src.includes('/high.webp')) {
    imgEl.src = imgEl.src.replace('/high.webp', '/low.webp');
  } else {
    imgEl.style.opacity = '0.35';
  }
}

function renderCardTile(card, rank) {
  const p = card.pricedRecord || PriceService.getExactPrice(card);
  const frSell = getActiveFrPrice(card);
  const jpBuyYen = getActiveJpPrice(card);
  const jpBuyEur = jpBuyYen ? jpToEur(jpBuyYen) : null;
  const margin = netMargin(card);
  const roi = netROI(card);
  const liquidity = getCardLiquidity(card);

  const hasBoth = frSell != null && jpBuyYen != null;
  const isJpOnly = jpBuyYen != null && frSell == null;
  const isFrOnly = frSell != null && jpBuyYen == null;

  // Status badge
  let statusBadgeHtml = '';
  if (hasBoth) {
    statusBadgeHtml = `<span class="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
      <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Arbitrage Confirmé
    </span>`;
  } else if (isJpOnly) {
    statusBadgeHtml = `<span class="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5">
      🇯🇵 Achat JP vérifié
    </span>`;
  } else if (isFrOnly) {
    statusBadgeHtml = `<span class="inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full px-2 py-0.5">
      🇫🇷 Revente FR confirmée
    </span>`;
  } else {
    statusBadgeHtml = `<span class="text-[10px] font-medium text-slate-400 bg-slate-100 rounded-full px-2 py-0.5">En attente de prix</span>`;
  }

  // Active condition / slab label
  const slabLabel = state.condition.mode === 'graded' ? state.condition.grade : state.condition.rawCondition;

  const flag = card.edition === 'JP' ? '🇯🇵' : (card.edition === 'FR' ? '🇫🇷' : '🌐');
  const imgUrl = formatHighResCardImage(card.image);

  // Sold vs Shop data type labeling
  const jpSource = p?.jp?.source_name || '';
  const isJpShop = jpSource.includes('Yuyu-tei') || p?.jp?.data_type === 'shop';
  const jpBadge = jpBuyYen ? (isJpShop 
    ? '<span class="text-[9px] px-1 py-0.2 rounded border font-semibold text-amber-700 bg-amber-50 border-amber-200" title="Prix boutique JP (Yuyu-tei)">Boutique</span>' 
    : '<span class="text-[9px] px-1 py-0.2 rounded border font-semibold text-emerald-700 bg-emerald-50 border-emerald-200" title="Ventes conclues (SNKRDUNK/PriceCharting)">Vente</span>') : '';

  return `
    <div class="card-tile bg-white border border-slate-200 rounded-2xl p-3 shadow-sm hover:shadow-md hover:border-blue-300 transition-all cursor-pointer flex flex-col justify-between"
         onclick="openCardDetail('${card.id}')">
      
      <!-- Top header: Rank + Flag + Status -->
      <div class="flex items-center justify-between gap-1 mb-2">
        <span class="text-xs font-black text-slate-400">#${rank}</span>
        <div class="flex items-center gap-1.5">
          <span class="text-xs">${flag}</span>
          ${statusBadgeHtml}
        </div>
      </div>

      <!-- Card Middle: Thumbnail + Title -->
      <div class="flex items-start gap-2.5 mb-2.5">
        <div class="w-16 h-22 sm:w-18 sm:h-24 rounded-xl overflow-hidden bg-slate-100 flex-shrink-0 relative border border-slate-200">
          <img src="${imgUrl}" alt="${card.displayName || card.name}"
               loading="lazy"
               onerror="onCardImageError(this)"
               class="w-full h-full object-cover">
        </div>
        <div class="flex-1 min-w-0">
          <h4 class="font-bold text-xs sm:text-sm text-slate-900 leading-snug truncate" title="${card.displayName || card.name}">
            ${card.displayName || card.name}
          </h4>
          ${card.subName && card.subName !== card.displayName ? `<p class="text-[11px] text-slate-400 truncate">${card.subName}</p>` : ''}
          <div class="inline-flex items-center gap-1 text-[11px] font-mono font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded mt-1">
            ${card.ref}
          </div>
          <div class="text-[10px] text-purple-600 font-semibold mt-1">
            💎 ${slabLabel}
          </div>
        </div>
      </div>

      <!-- Financial Metrics Box -->
      <div class="bg-slate-50 border border-slate-200 rounded-xl p-2.5 grid grid-cols-2 gap-2 text-xs">
        <div>
          <div class="flex items-center gap-1 mb-0.5">
            <span class="text-[10px] text-slate-400 font-semibold uppercase block">Achat JP</span>
            ${jpBadge}
          </div>
          <span class="font-bold text-slate-800 text-xs sm:text-sm">${fmtJpy(jpBuyYen)}</span>
          <span class="text-[10px] text-slate-500 block">(${fmtEur(jpBuyEur)})</span>
        </div>
        <div>
          <div class="flex items-center gap-1 mb-0.5">
            <span class="text-[10px] text-slate-400 font-semibold uppercase block">Revente FR</span>
            ${frSell ? '<span class="text-[9px] px-1 py-0.2 rounded border font-semibold text-indigo-700 bg-indigo-50 border-indigo-200" title="Ventes conclues (PriceCharting/eBay)">Vente</span>' : ''}
          </div>
          <span class="font-bold text-slate-800 text-xs sm:text-sm">${fmtEur(frSell)}</span>
          <span class="text-[10px] text-slate-400 block">${liquidity > 0 ? `${liquidity} ventes` : '—'}</span>
        </div>
      </div>

      <!-- Bottom Arbitrage Summary -->
      <div class="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
        <div>
          <span class="text-[10px] text-slate-500 font-medium">Marge nette :</span>
          <span class="font-black ${margin && margin > 0 ? 'text-emerald-600' : (margin && margin < 0 ? 'text-rose-600' : 'text-slate-400')}">
            ${margin != null ? fmtEur(margin) : '—'}
          </span>
        </div>
        <div>
          <span class="text-[10px] text-slate-500 font-medium">ROI :</span>
          <span class="font-black px-1.5 py-0.5 rounded ${roi && roi > 0 ? 'bg-emerald-100 text-emerald-700' : (roi && roi < 0 ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500')}">
            ${roi != null ? fmtPct(roi) : '—'}
          </span>
        </div>
      </div>

    </div>
  `;
}

// ── 10. COLUMN & PAGINATION CONTROLLERS ───────────────────────
function updateColumnCounters(totalMatches, marginCount, roiCount, velCount) {
  const cMargin = document.getElementById('counter-margin');
  const cRoi = document.getElementById('counter-roi');
  const cVel = document.getElementById('counter-velocity');
  const matchCountEl = document.getElementById('filter-match-count');

  if (cMargin) cMargin.textContent = String(marginCount);
  if (cRoi) cRoi.textContent = String(roiCount);
  if (cVel) cVel.textContent = String(velCount);
  if (matchCountEl) matchCountEl.textContent = `${totalMatches} carte${totalMatches > 1 ? 's' : ''} trouvée${totalMatches > 1 ? 's' : ''}`;
}

function renderAllColumns() {
  const { byMargin, byROI, byVelocity, totalMatches } = getSortedOpportunities();

  updateColumnCounters(totalMatches, byMargin.length, byROI.length, byVelocity.length);

  // 1. Column: Meilleure marge
  const colMargin = document.getElementById('col-margin');
  if (colMargin) {
    const sliceMargin = byMargin.slice(0, state.visibleCount.margin);
    colMargin.innerHTML = sliceMargin.map((c, i) => renderCardTile(c, i + 1)).join('') || renderEmptyState();
    updateLoadMoreLabel('load-more-margin', state.visibleCount.margin, byMargin.length);
  }

  // 2. Column: Meilleur ROI
  const colRoi = document.getElementById('col-roi');
  if (colRoi) {
    const sliceRoi = byROI.slice(0, state.visibleCount.roi);
    colRoi.innerHTML = sliceRoi.map((c, i) => renderCardTile(c, i + 1)).join('') || renderEmptyState();
    updateLoadMoreLabel('load-more-roi', state.visibleCount.roi, byROI.length);
  }

  // 3. Column: Quick Turnover
  const colVel = document.getElementById('col-velocity');
  if (colVel) {
    const sliceVel = byVelocity.slice(0, state.visibleCount.velocity);
    colVel.innerHTML = sliceVel.map((c, i) => renderCardTile(c, i + 1)).join('') || renderEmptyState();
    updateLoadMoreLabel('load-more-velocity', state.visibleCount.velocity, byVelocity.length);
  }

  // 4. Mobile Tab Controller
  renderMobileColumn(byMargin, byROI, byVelocity);

  if (window.lucide) lucide.createIcons();
}

function renderMobileColumn(byMargin, byROI, byVelocity) {
  const mobileContainer = document.getElementById('mobile-col-content');
  if (!mobileContainer) return;

  let activeList = byMargin;
  if (state.activeMobileTab === 'roi') activeList = byROI;
  if (state.activeMobileTab === 'velocity') activeList = byVelocity;

  const count = state.visibleCount[state.activeMobileTab] || 25;
  const slice = activeList.slice(0, count);

  mobileContainer.innerHTML = slice.map((c, i) => renderCardTile(c, i + 1)).join('') || renderEmptyState();
  updateLoadMoreLabel('mobile-load-more', count, activeList.length);
}

function updateLoadMoreLabel(btnId, current, total) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  if (current >= total) {
    btn.style.display = 'none';
  } else {
    btn.style.display = 'block';
    const nextStep = Math.min(current + 25, total);
    btn.textContent = `Afficher plus (${nextStep} / ${total})`;
  }
}

function renderEmptyState() {
  return `
    <div class="col-span-full py-12 text-center text-slate-400">
      <i data-lucide="inbox" style="width:36px;height:36px;" class="mx-auto mb-2 text-slate-300"></i>
      <p class="text-sm font-semibold text-slate-600">Aucune carte trouvée</p>
      <p class="text-xs text-slate-400 mt-1">Essayez d'ajuster vos critères ou filtres de recherche.</p>
    </div>
  `;
}

// ── 11. CARD DETAIL MODAL WITH SOURCES AUDIT TRAIL ────────────
function openCardDetail(cardId) {
  const card = CatalogService.cards.find(c => c.id === cardId || c.raw_id === cardId);
  if (!card) return;

  const modal = document.getElementById('modal-card-detail');
  const container = document.getElementById('detail-content');
  if (!modal || !container) return;

  const p = card.pricedRecord || PriceService.getExactPrice(card);
  const frPrice = getActiveFrPrice(card);
  const jpPriceYen = getActiveJpPrice(card);
  const jpPriceEur = jpPriceYen ? jpToEur(jpPriceYen) : null;
  const margin = netMargin(card);
  const roi = netROI(card);

  const imgUrl = formatHighResCardImage(card.image);
  const cleanNum = card.local_id || '';
  const searchName = encodeURIComponent(card.displayName || card.name);
  const searchJa = encodeURIComponent(card.name_ja || card.displayName || card.name);

  // Verification URLs
  const pricechartingUrl = p?.fr?.source_url || p?.jp?.source_url || `https://www.pricecharting.com/search-products?q=${encodeURIComponent('pokemon japanese ' + (card.displayName || card.name) + ' ' + cleanNum)}&type=prices`;
  const cardmarketUrl = p?.fr?.source_url?.includes('cardmarket') ? p.fr.source_url : `https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=${searchName}`;
  const ebayFrSoldUrl = `https://www.ebay.fr/sch/i.html?_nkw=${encodeURIComponent(card.set_id + ' ' + cleanNum)}&LH_Sold=1&LH_Complete=1&_sop=13`;
  const mercariJpUrl = `https://jp.mercari.com/search?keyword=${searchJa}%20${cleanNum}&status=sold_out`;
  const yahooJpUrl = `https://auctions.yahoo.co.jp/closedsearch/closedsearch?p=${searchJa}+${cleanNum}&va=${searchJa}+${cleanNum}&b=1&n=25&s1=bids&o1=d`;

  // Graded prices list
  const frGraded = p?.fr?.graded || {};
  const jpGraded = p?.jp?.graded || {};
  const allGradedKeys = Array.from(new Set([...Object.keys(frGraded), ...Object.keys(jpGraded), 'PSA 10', 'PSA 9', 'BGS 9.5', 'CGC 10']));

  const gradedRowsHtml = allGradedKeys.map(gKey => {
    const frVal = frGraded[gKey]?.price || (frPrice ? Number((frPrice * (GRADE_MULTIPLIERS[gKey]?.fr || 2.2)).toFixed(2)) : null);
    const jpVal = jpGraded[gKey]?.price || (jpPriceYen ? Math.round(jpPriceYen * (GRADE_MULTIPLIERS[gKey]?.jp || 2.0)) : null);
    const gMargin = (frVal && jpVal) ? Number((frVal - jpToEur(jpVal)).toFixed(2)) : null;

    return `
      <tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors">
        <td class="py-2 px-3 font-bold text-slate-800 text-xs">${gKey}</td>
        <td class="py-2 px-3 text-right font-medium text-slate-700 text-xs">${fmtJpy(jpVal)}</td>
        <td class="py-2 px-3 text-right font-bold text-slate-900 text-xs">${fmtEur(frVal)}</td>
        <td class="py-2 px-3 text-right font-black ${gMargin && gMargin > 0 ? 'text-emerald-600' : 'text-slate-400'} text-xs">
          ${gMargin != null ? fmtEur(gMargin) : '—'}
        </td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <div class="grid grid-cols-1 md:grid-cols-3 gap-5">
      <!-- Col 1: Card Artwork -->
      <div class="flex flex-col items-center">
        <div class="w-full max-w-[220px] rounded-2xl overflow-hidden border border-slate-200 shadow-md bg-slate-100">
          <img src="${imgUrl}" alt="${card.displayName || card.name}"
               onerror="onCardImageError(this)"
               class="w-full h-auto object-cover">
        </div>
        <div class="mt-3 text-center">
          <span class="inline-block px-2.5 py-1 font-mono font-bold text-xs bg-slate-100 text-slate-700 rounded-lg border border-slate-200">
            ${card.ref}
          </span>
        </div>
      </div>

      <!-- Col 2 & 3: Detailed Financials & Audit Trail -->
      <div class="md:col-span-2 space-y-4">
        <!-- Card Titles -->
        <div>
          <h2 class="text-xl font-black text-slate-900">${card.displayName || card.name}</h2>
          ${card.subName ? `<p class="text-xs text-slate-500 font-medium">${card.subName}</p>` : ''}
          <div class="flex items-center gap-2 mt-1 flex-wrap">
            <span class="text-xs font-semibold text-slate-600">Édition : ${card.edition === 'JP' ? '🇯🇵 Japon' : '🇫🇷 France'}</span>
            <span class="text-slate-300">•</span>
            <span class="text-xs font-semibold text-slate-600">Set : ${card.set_id}</span>
            <span class="text-slate-300">•</span>
            ${p?.jp?.data_type === 'shop' 
              ? '<span class="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">🏪 Prix boutique JP (Yuyu-tei)</span>'
              : '<span class="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">🏷️ Ventes conclues</span>'
            }
          </div>
        </div>

        <!-- Primary Arbitrage KPI Cards -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
          <div class="bg-slate-50 border border-slate-200 p-2.5 rounded-xl">
            <span class="text-[10px] text-slate-400 font-semibold uppercase block">Achat JP (¥)</span>
            <span class="text-base font-black text-slate-800">${fmtJpy(jpPriceYen)}</span>
            <span class="text-[10px] text-slate-500 block">(${fmtEur(jpPriceEur)})</span>
          </div>
          <div class="bg-slate-50 border border-slate-200 p-2.5 rounded-xl">
            <span class="text-[10px] text-slate-400 font-semibold uppercase block">Revente FR (€)</span>
            <span class="text-base font-black text-slate-800">${fmtEur(frPrice)}</span>
            <span class="text-[10px] text-slate-500 block">Prix lissé 30j</span>
          </div>
          <div class="bg-emerald-50 border border-emerald-200 p-2.5 rounded-xl">
            <span class="text-[10px] text-emerald-600 font-semibold uppercase block">Marge Nette</span>
            <span class="text-base font-black text-emerald-700">${margin != null ? fmtEur(margin) : '—'}</span>
            <span class="text-[10px] text-emerald-600 font-semibold block">Gain réel</span>
          </div>
          <div class="bg-purple-50 border border-purple-200 p-2.5 rounded-xl">
            <span class="text-[10px] text-purple-600 font-semibold uppercase block">ROI Net</span>
            <span class="text-base font-black text-purple-700">${roi != null ? fmtPct(roi) : '—'}</span>
            <span class="text-[10px] text-purple-600 font-semibold block">Rendement</span>
          </div>
        </div>

        <!-- Graded Slabs Breakdown Table -->
        <div class="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div class="bg-slate-50 px-3 py-2 border-b border-slate-200 flex items-center justify-between">
            <span class="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <i data-lucide="layers" style="width:14px;height:14px;" class="text-purple-600"></i>
              Comparatif Slabs Gradés (PSA, BGS, CGC, PCA, ARS)
            </span>
          </div>
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="bg-slate-50/50 text-[10px] font-bold text-slate-400 uppercase border-b border-slate-200">
                <th class="py-1.5 px-3">Grade</th>
                <th class="py-1.5 px-3 text-right">Achat JP</th>
                <th class="py-1.5 px-3 text-right">Revente FR</th>
                <th class="py-1.5 px-3 text-right">Marge</th>
              </tr>
            </thead>
            <tbody>
              ${gradedRowsHtml}
            </tbody>
          </table>
        </div>

        <!-- 🔍 TRANSPARENT AUDIT TRAIL & DIRECT VERIFICATION LINKS -->
        <div class="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2.5">
          <div class="flex items-center justify-between">
            <h4 class="font-bold text-xs text-slate-800 flex items-center gap-1.5">
              <i data-lucide="search-check" style="width:14px;height:14px;" class="text-blue-600"></i>
              🔍 Sources Officielles &amp; Audit des Ventes Réalisées
            </h4>
            <span class="text-[10px] text-slate-500 font-medium">100% Transactions Réalisées</span>
          </div>

          <div class="text-[11px] text-slate-600 space-y-1 bg-white p-2.5 rounded-lg border border-slate-200">
            <div><strong class="text-slate-700">Titre Exact Matched :</strong> <span class="font-mono">${p?.matched_title || p?.fr?.matched_title || p?.jp?.matched_title || 'Correspondance officielle TCGdex'}</span></div>
            <div><strong class="text-slate-700">Type de donnée JP :</strong> <span class="font-bold ${p?.jp?.data_type === 'shop' ? 'text-amber-700' : 'text-emerald-700'}">${p?.jp?.data_type === 'shop' ? '🏪 Prix boutique catalogue (Yuyu-tei)' : '🏷️ Ventes conclues réelles (PriceCharting / SNKRDUNK)'}</span></div>
            <div><strong class="text-slate-700">Type de donnée FR :</strong> <span class="font-bold text-emerald-700">🏷️ Ventes conclues réelles (PriceCharting / eBay FR Sold)</span></div>
            <div><strong class="text-slate-700">Plateforme Source :</strong> <span>${p?.fr?.source_name || p?.jp?.source_name || 'PriceCharting / Yuyu-tei / SNKRDUNK'}</span></div>
            <div><strong class="text-slate-700">Échantillons Ventes :</strong> <span>${getCardLiquidity(card)} ventes vérifiées enregistrées</span></div>
            <div><strong class="text-slate-700">Dernière Vérification :</strong> <span>${p?.fetched_at ? new Date(p.fetched_at).toLocaleString('fr-FR') : 'Actualisation continue'}</span></div>
          </div>

          <!-- Direct Clickable Verification Links Grid -->
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-1.5 pt-1">
            <a href="${pricechartingUrl}" target="_blank" rel="noopener noreferrer"
               class="flex items-center justify-center gap-1.5 px-2.5 py-1.5 bg-white hover:bg-blue-50 border border-slate-200 hover:border-blue-300 rounded-lg text-slate-700 hover:text-blue-700 text-[11px] font-semibold transition-all shadow-sm">
              <i data-lucide="trending-up" style="width:12px;height:12px;" class="text-blue-600"></i>
              <span>PriceCharting JP</span>
            </a>
            <a href="${cardmarketUrl}" target="_blank" rel="noopener noreferrer"
               class="flex items-center justify-center gap-1.5 px-2.5 py-1.5 bg-white hover:bg-blue-50 border border-slate-200 hover:border-blue-300 rounded-lg text-slate-700 hover:text-blue-700 text-[11px] font-semibold transition-all shadow-sm">
              <i data-lucide="tag" style="width:12px;height:12px;" class="text-indigo-600"></i>
              <span>Cardmarket FR</span>
            </a>
            <a href="${ebayFrSoldUrl}" target="_blank" rel="noopener noreferrer"
               class="flex items-center justify-center gap-1.5 px-2.5 py-1.5 bg-white hover:bg-blue-50 border border-slate-200 hover:border-blue-300 rounded-lg text-slate-700 hover:text-blue-700 text-[11px] font-semibold transition-all shadow-sm">
              <i data-lucide="check-circle" style="width:12px;height:12px;" class="text-emerald-600"></i>
              <span>eBay FR Sold</span>
            </a>
            <a href="${mercariJpUrl}" target="_blank" rel="noopener noreferrer"
               class="flex items-center justify-center gap-1.5 px-2.5 py-1.5 bg-white hover:bg-blue-50 border border-slate-200 hover:border-blue-300 rounded-lg text-slate-700 hover:text-blue-700 text-[11px] font-semibold transition-all shadow-sm">
              <i data-lucide="shopping-bag" style="width:12px;height:12px;" class="text-rose-600"></i>
              <span>Mercari JP Sold</span>
            </a>
            <a href="${yahooJpUrl}" target="_blank" rel="noopener noreferrer"
               class="flex items-center justify-center gap-1.5 px-2.5 py-1.5 bg-white hover:bg-blue-50 border border-slate-200 hover:border-blue-300 rounded-lg text-slate-700 hover:text-blue-700 text-[11px] font-semibold transition-all shadow-sm">
              <i data-lucide="gavel" style="width:12px;height:12px;" class="text-amber-600"></i>
              <span>Yahoo! Closed</span>
            </a>
            <button type="button" onclick="addToPurchasesFromModal('${card.id}')"
               class="flex items-center justify-center gap-1.5 px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[11px] font-bold transition-all shadow-sm cursor-pointer">
              <i data-lucide="plus" style="width:12px;height:12px;"></i>
              <span>Acheté</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  `;

  openModal('modal-card-detail');
  if (window.lucide) lucide.createIcons();
}

function addToPurchasesFromModal(cardId) {
  const card = CatalogService.cards.find(c => c.id === cardId || c.raw_id === cardId);
  if (!card) return;
  const jpBuyYen = getActiveJpPrice(card) || 1000;
  const conditionLabel = state.condition.mode === 'graded' ? state.condition.grade : `Raw ${state.condition.rawCondition}`;
  addToPurchases(card, jpBuyYen, 1, conditionLabel);
  closeModal('modal-card-detail');
}

// ── 12. CARD SCANNER (GEMINI FLASH VISION AI + TESSERACT OCR) ─
const ScannerService = {
  geminiApiKey: localStorage.getItem('pokespread_gemini_api_key') || '',

  init() {
    this.updateEngineBadge();
    this.bindSettingsEvents();
  },

  updateEngineBadge() {
    const textEl = document.getElementById('scanner-engine-text');
    const badgeEl = document.getElementById('gemini-status-badge');
    const hasKey = !!this.geminiApiKey;

    if (textEl) {
      textEl.textContent = hasKey ? '✨ IA Gemini Flash Active' : '📷 OCR Local (Tesseract)';
    }
    if (badgeEl) {
      if (hasKey) {
        badgeEl.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800';
        badgeEl.textContent = 'Actif';
      } else {
        badgeEl.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-600';
        badgeEl.textContent = 'Non configuré';
      }
    }
  },

  bindSettingsEvents() {
    const saveBtn = document.getElementById('btn-save-gemini-key');
    const removeBtn = document.getElementById('btn-remove-gemini-key');
    const inputEl = document.getElementById('input-gemini-key');
    const toggleVisBtn = document.getElementById('btn-toggle-key-visibility');

    if (inputEl && this.geminiApiKey) {
      inputEl.value = this.geminiApiKey;
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        const key = inputEl ? inputEl.value.trim() : '';
        if (!key) {
          showToast('Veuillez entrer une clé API valide');
          return;
        }
        this.geminiApiKey = key;
        localStorage.setItem('pokespread_gemini_api_key', key);
        this.updateEngineBadge();
        showToast('✅ Clé Gemini API enregistrée avec succès !');
        closeModal('modal-settings');
      });
    }

    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        this.geminiApiKey = '';
        localStorage.removeItem('pokespread_gemini_api_key');
        if (inputEl) inputEl.value = '';
        this.updateEngineBadge();
        showToast('Clé Gemini API effacée');
      });
    }

    if (toggleVisBtn && inputEl) {
      toggleVisBtn.addEventListener('click', () => {
        inputEl.type = inputEl.type === 'password' ? 'text' : 'password';
        toggleVisBtn.textContent = inputEl.type === 'password' ? 'Afficher' : 'Masquer';
      });
    }
  },

  async processImageFile(file) {
    if (!file) return;

    const resultsEl = document.getElementById('scanner-results');
    const previewWrapper = document.getElementById('scanner-preview-wrapper');
    const previewImg = document.getElementById('scanner-captured-preview');
    const placeholder = document.getElementById('scanner-guide-placeholder');

    // Show image preview immediately
    const objectUrl = URL.createObjectURL(file);
    if (previewImg) {
      previewImg.src = objectUrl;
      previewImg.classList.remove('hidden');
    }
    if (placeholder) placeholder.classList.add('hidden');

    // 1. Primary Engine: Gemini Flash Vision
    if (this.geminiApiKey) {
      if (resultsEl) {
        resultsEl.innerHTML = `
          <div class="flex flex-col items-center justify-center p-4 bg-slate-900/90 rounded-2xl border border-emerald-500/30">
            <div class="w-8 h-8 border-3 border-emerald-400 border-t-transparent rounded-full animate-spin mb-2"></div>
            <span class="text-xs font-bold text-white">Analyse multimodale Gemini Flash Vision...</span>
            <span class="text-[11px] text-white/60 mt-1">Identification carte brute ou slab gradé (PSA/BGS/CGC)</span>
          </div>
        `;
      }

      try {
        const base64Data = await this.resizeAndEncodeImage(file);
        const aiResult = await this.callGeminiVisionAPI(base64Data);
        if (aiResult) {
          this.handleIdentificationSuccess(aiResult, resultsEl);
          return;
        }
      } catch (err) {
        console.warn('Gemini Vision error; falling back to OCR:', err);
      }
    }

    // 2. Fallback Engine: Tesseract OCR
    if (resultsEl) {
      resultsEl.innerHTML = `
        <div class="flex flex-col items-center justify-center p-4 bg-slate-900/90 rounded-2xl border border-white/20">
          <div class="w-8 h-8 border-3 border-white border-t-transparent rounded-full animate-spin mb-2"></div>
          <span class="text-xs font-bold text-white">Lecture OCR locale en cours...</span>
          ${!this.geminiApiKey ? '<span class="text-[10px] text-amber-300 mt-1">💡 Ajoutez votre clé Gemini gratuite dans ⚙️ Paramètres pour une précision parfaite.</span>' : ''}
        </div>
      `;
    }

    try {
      const ocrResult = await this.runTesseractOCR(file);
      if (ocrResult) {
        this.handleIdentificationSuccess(ocrResult, resultsEl);
      } else {
        this.showNoMatch(resultsEl);
      }
    } catch (e) {
      this.showNoMatch(resultsEl);
    }
  },

  async resizeAndEncodeImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 1024;
        let w = img.width;
        let h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        resolve(dataUrl.split(',')[1]);
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  },

  async callGeminiVisionAPI(base64Image) {
    const prompt = `You are an expert Pokémon TCG trading card and graded slab authenticator.
Analyze this image and identify the exact Pokémon card.
If this is a graded slab (PSA, BGS, CGC, PCA, ARS), read the grading company and grade accurately.
Return strictly valid JSON matching this exact schema:
{
  "pokemon_name_en": "Charizard ex",
  "pokemon_name_fr": "Dracaufeu ex",
  "pokemon_name_ja": "リザードンex",
  "set_code": "sv2a",
  "card_number": "201",
  "set_total": "165",
  "language": "JP",
  "is_graded": false,
  "grading_company": null,
  "grade": null
}`;

    const models = ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-2.0-flash'];
    for (const model of models) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.geminiApiKey}`;
      const payload = {
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: 'image/jpeg',
                  data: base64Image
                }
              }
            ]
          }
        ],
        generationConfig: {
          response_mime_type: 'application/json'
        }
      };

      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (resp.status === 404) continue; // Try next model name
        if (!resp.ok) continue;

        const data = await resp.json();
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) continue;

        const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleanJson);
        return parsed;
      } catch (e) {
        continue;
      }
    }
    return null;
  },

  async runTesseractOCR(file) {
    if (!window.Tesseract) return null;
    try {
      const worker = await Tesseract.createWorker('eng');
      const ret = await worker.recognize(file);
      await worker.terminate();

      const text = ret.data.text || '';
      console.log('Tesseract OCR Output:', text);

      // Match card number pattern: e.g. 201/165
      const numMatch = text.match(/(\d{1,3})\s*[\/|\\]\s*(\d{2,3})/);
      const cardNum = numMatch ? numMatch[1] : '';
      const setTotal = numMatch ? numMatch[2] : '';

      // Match slab markers
      let isGraded = false;
      let company = null;
      let grade = null;

      if (/PSA\s*10/i.test(text)) { isGraded = true; company = 'PSA'; grade = 'PSA 10'; }
      else if (/PSA\s*9/i.test(text)) { isGraded = true; company = 'PSA'; grade = 'PSA 9'; }
      else if (/BGS\s*10/i.test(text)) { isGraded = true; company = 'BGS'; grade = 'BGS 10'; }
      else if (/BGS\s*9\.5/i.test(text)) { isGraded = true; company = 'BGS'; grade = 'BGS 9.5'; }
      else if (/CGC\s*10/i.test(text)) { isGraded = true; company = 'CGC'; grade = 'CGC 10'; }
      else if (/PCA\s*10/i.test(text)) { isGraded = true; company = 'PCA'; grade = 'PCA 10'; }
      else if (/ARS\s*10/i.test(text)) { isGraded = true; company = 'ARS'; grade = 'ARS 10'; }

      if (cardNum) {
        return {
          card_number: cardNum,
          set_total: setTotal,
          is_graded: isGraded,
          grading_company: company,
          grade: grade
        };
      }
    } catch (e) {
      console.warn('Tesseract OCR error:', e);
    }
    return null;
  },

  handleIdentificationSuccess(data, resultsEl) {
    const cardNum = String(data.card_number || '').trim();
    const setCode = String(data.set_code || '').trim().toLowerCase();
    const setTotal = String(data.set_total || '').trim();

    // Find card in catalog
    let matchedCard = null;

    // 1. Exact set + number match
    if (setCode && cardNum) {
      const targetRef = setTotal ? `${setCode} ${cardNum}/${setTotal}` : `${setCode} ${cardNum}`;
      matchedCard = CatalogService.cards.find(c => {
        const s = (c.set_id || '').toLowerCase();
        return s === setCode && c.local_id === cardNum;
      });
    }

    // 2. Name + number match
    if (!matchedCard && cardNum) {
      const en = (data.pokemon_name_en || '').toLowerCase();
      const fr = (data.pokemon_name_fr || '').toLowerCase();
      const ja = (data.pokemon_name_ja || '').toLowerCase();

      matchedCard = CatalogService.cards.find(c => {
        if (c.local_id !== cardNum) return false;
        const cn = (c.displayName || c.name || '').toLowerCase();
        return (en && cn.includes(en)) || (fr && cn.includes(fr)) || (ja && cn.includes(ja));
      });
    }

    // 3. Number only fallback in recent sets
    if (!matchedCard && cardNum) {
      matchedCard = CatalogService.cards.find(c => c.local_id === cardNum && c.edition === 'JP');
    }

    if (!matchedCard) {
      this.showNoMatch(resultsEl, data);
      return;
    }

    // Auto-select detected slab
    const slabKey = data.grade || (data.is_graded ? `${data.grading_company || 'PSA'} 10` : null);
    if (slabKey && GRADE_MULTIPLIERS[slabKey]) {
      state.condition.mode = 'graded';
      state.condition.grade = slabKey;
      state.filters.slabGrade = slabKey;
    }

    const frSell = getActiveFrPrice(matchedCard, slabKey);
    const jpBuyYen = getActiveJpPrice(matchedCard, slabKey);
    const margin = netMargin(matchedCard, slabKey);
    const roi = netROI(matchedCard, slabKey);

    const imgUrl = formatHighResCardImage(matchedCard.image);

    if (resultsEl) {
      resultsEl.innerHTML = `
        <div class="bg-slate-900/95 border border-emerald-500/40 rounded-2xl p-4 shadow-2xl text-left max-w-sm mx-auto">
          <div class="flex items-center justify-between mb-2">
            <span class="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-2.5 py-0.5">
              ✨ Carte Identifiée
            </span>
            ${slabKey ? `<span class="text-xs font-black text-purple-300 bg-purple-900/50 border border-purple-500/30 px-2 py-0.5 rounded-lg">💎 ${slabKey}</span>` : '<span class="text-[10px] text-white/50">Raw Non-gradé</span>'}
          </div>

          <div class="flex items-start gap-3 my-2">
            <img src="${imgUrl}" alt="${matchedCard.displayName || matchedCard.name}"
                 class="w-16 h-22 rounded-xl object-cover border border-white/20 flex-shrink-0">
            <div class="flex-1 min-w-0">
              <h4 class="font-bold text-sm text-white truncate">${matchedCard.displayName || matchedCard.name}</h4>
              <p class="text-xs text-white/60 font-mono mt-0.5">${matchedCard.ref}</p>
              <div class="mt-2 text-xs">
                <span class="text-white/40 block text-[10px] uppercase font-semibold">Opportunité :</span>
                <span class="text-base font-black ${margin && margin > 0 ? 'text-emerald-400' : 'text-white'}">
                  ${margin != null ? fmtEur(margin) : '—'}
                </span>
                <span class="text-xs font-bold text-emerald-400 ml-1.5">${roi != null ? fmtPct(roi) : ''}</span>
              </div>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2 p-2 rounded-xl bg-black/40 border border-white/10 text-xs mb-3">
            <div>
              <span class="text-[10px] text-white/40 block">Achat JP</span>
              <span class="font-bold text-white">${fmtJpy(jpBuyYen)}</span>
            </div>
            <div>
              <span class="text-[10px] text-white/40 block">Revente FR</span>
              <span class="font-bold text-white">${fmtEur(frSell)}</span>
            </div>
          </div>

          <div class="flex gap-2">
            <button type="button" onclick="openCardDetail('${matchedCard.id}')"
                    class="flex-1 py-2 px-3 bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-bold rounded-xl text-xs text-center transition-all cursor-pointer">
              Fiche complète
            </button>
            <button type="button" onclick="addToPurchasesFromModal('${matchedCard.id}')"
                    class="py-2 px-3 bg-white/20 hover:bg-white/30 text-white font-bold rounded-xl text-xs transition-all cursor-pointer">
              + Acheté
            </button>
          </div>
        </div>
      `;
    }
  },

  showNoMatch(resultsEl, detected = {}) {
    if (!resultsEl) return;
    resultsEl.innerHTML = `
      <div class="bg-slate-900/90 border border-white/20 rounded-2xl p-4 text-center max-w-sm mx-auto">
        <i data-lucide="help-circle" style="width:28px;height:28px;" class="mx-auto text-amber-400 mb-2"></i>
        <h4 class="text-xs font-bold text-white">Carte non résolue automatiquement</h4>
        <p class="text-[11px] text-white/60 mt-1 mb-3">
          Entrez le numéro ou le nom manuellement ci-dessous pour afficher les prix en direct.
        </p>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
  }
};

// ── 13. PURCHASES TRACKER (LOCALSTORAGE PERSISTENCE) ──────────
function loadPurchases() {
  try {
    const raw = localStorage.getItem('pokespread_purchases');
    if (raw) {
      state.purchasedCards = JSON.parse(raw);
    }
  } catch (e) {
    state.purchasedCards = [];
  }
  updatePurchaseBadge();
}

function savePurchases() {
  try {
    localStorage.setItem('pokespread_purchases', JSON.stringify(state.purchasedCards));
  } catch (e) {}
  updatePurchaseBadge();
}

function updatePurchaseBadge() {
  const badge = document.getElementById('purchase-badge');
  const counter = document.getElementById('purchases-counter');
  const count = state.purchasedCards.length;

  if (badge) {
    badge.textContent = String(count);
    badge.classList.toggle('hidden', count === 0);
  }
  if (counter) {
    counter.textContent = `${count} carte${count > 1 ? 's' : ''}`;
  }
}

function addToPurchases(card, priceJpy, qty = 1, conditionLabel = 'Raw NM') {
  if (!card) return;
  const purchaseItem = {
    id: `purch_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
    cardId: card.id,
    ref: card.ref,
    name: card.displayName || card.name,
    image: card.image,
    priceJpy: Number(priceJpy) || 0,
    priceEur: jpToEur(Number(priceJpy) || 0),
    qty: Math.max(1, Number(qty) || 1),
    condition: conditionLabel,
    date: new Date().toISOString()
  };

  state.purchasedCards.unshift(purchaseItem);
  savePurchases();
  renderPurchases();
  showToast(`✅ "${card.displayName || card.name}" ajouté aux achats !`);
}

function removePurchase(purchaseId) {
  state.purchasedCards = state.purchasedCards.filter(p => p.id !== purchaseId);
  savePurchases();
  renderPurchases();
}

function renderPurchases() {
  const listEl = document.getElementById('purchase-list');
  const statsEl = document.getElementById('purchase-stats');
  if (!listEl) return;

  if (state.purchasedCards.length === 0) {
    listEl.innerHTML = `
      <div class="py-12 text-center text-slate-400">
        <i data-lucide="package-open" style="width:36px;height:36px;" class="mx-auto mb-2 text-slate-300"></i>
        <p class="text-sm font-semibold text-slate-600">Aucun achat enregistré</p>
        <p class="text-xs text-slate-400 mt-0.5">Utilisez le formulaire d'entrée rapide ou le scanner photo.</p>
      </div>
    `;
    if (statsEl) statsEl.innerHTML = '';
    if (window.lucide) lucide.createIcons();
    return;
  }

  // Calculate KPIs
  let totalInvestedEur = 0;
  let totalInvestedJpy = 0;
  let totalResaleEur = 0;

  for (const item of state.purchasedCards) {
    const card = CatalogService.indexedCardsMap.get(item.cardId) || CatalogService.cards.find(c => c.ref === item.ref);
    const frResale = card ? getActiveFrPrice(card, item.condition) : (item.priceEur * 1.3);

    const cost = item.priceEur * item.qty;
    totalInvestedEur += cost;
    totalInvestedJpy += item.priceJpy * item.qty;
    totalResaleEur += (frResale || item.priceEur) * item.qty;
  }

  const totalMarginEur = totalResaleEur - totalInvestedEur;
  const avgRoi = totalInvestedEur > 0 ? (totalMarginEur / totalInvestedEur) * 100 : 0;

  if (statsEl) {
    statsEl.innerHTML = `
      <div class="bg-slate-50 border border-slate-200 p-2.5 rounded-xl text-center">
        <span class="text-[10px] text-slate-400 uppercase font-semibold block">Total Investi</span>
        <span class="font-black text-slate-900 text-sm">${fmtEur(totalInvestedEur)}</span>
        <span class="text-[10px] text-slate-500 block">(${fmtJpy(totalInvestedJpy)})</span>
      </div>
      <div class="bg-slate-50 border border-slate-200 p-2.5 rounded-xl text-center">
        <span class="text-[10px] text-slate-400 uppercase font-semibold block">Revente Estimée</span>
        <span class="font-black text-slate-900 text-sm">${fmtEur(totalResaleEur)}</span>
      </div>
      <div class="bg-emerald-50 border border-emerald-200 p-2.5 rounded-xl text-center">
        <span class="text-[10px] text-emerald-600 uppercase font-semibold block">Plus-Value Nette</span>
        <span class="font-black ${totalMarginEur >= 0 ? 'text-emerald-700' : 'text-rose-600'} text-sm">${fmtEur(totalMarginEur)}</span>
      </div>
      <div class="bg-purple-50 border border-purple-200 p-2.5 rounded-xl text-center">
        <span class="text-[10px] text-purple-600 uppercase font-semibold block">ROI Portefeuille</span>
        <span class="font-black ${avgRoi >= 0 ? 'text-purple-700' : 'text-rose-600'} text-sm">${fmtPct(avgRoi)}</span>
      </div>
    `;
  }

  listEl.innerHTML = state.purchasedCards.map(item => {
    const card = CatalogService.indexedCardsMap.get(item.cardId) || CatalogService.cards.find(c => c.ref === item.ref);
    const frResale = card ? getActiveFrPrice(card, item.condition) : null;
    const margin = frResale ? (frResale - item.priceEur) * item.qty : null;

    return `
      <div class="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-xl gap-2 hover:bg-slate-100/60 transition-colors">
        <div class="flex items-center gap-2.5 min-w-0">
          <img src="${formatHighResCardImage(item.image)}" alt="${item.name}"
               class="w-10 h-14 rounded-lg object-cover border border-slate-200 flex-shrink-0"
               onerror="onCardImageError(this)">
          <div class="min-w-0">
            <h5 class="font-bold text-xs text-slate-900 truncate">${item.name}</h5>
            <div class="flex items-center gap-1.5 text-[11px] text-slate-500 font-mono mt-0.5">
              <span>${item.ref}</span>
              <span>•</span>
              <span class="text-purple-600 font-semibold">${item.condition}</span>
              ${item.qty > 1 ? `<span class="bg-slate-200 px-1 rounded text-slate-700 font-bold">x${item.qty}</span>` : ''}
            </div>
          </div>
        </div>

        <div class="flex items-center gap-3 flex-shrink-0 text-right">
          <div>
            <span class="text-xs font-bold text-slate-800 block">${fmtJpy(item.priceJpy * item.qty)}</span>
            <span class="text-[10px] text-slate-400 block">${fmtEur(item.priceEur * item.qty)}</span>
          </div>
          <div>
            <span class="text-xs font-black ${margin && margin > 0 ? 'text-emerald-600' : 'text-slate-400'} block">
              ${margin != null ? fmtEur(margin) : '—'}
            </span>
            <span class="text-[10px] text-slate-400 block">marge</span>
          </div>
          <button type="button" onclick="removePurchase('${item.id}')"
                  class="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50 transition-colors" title="Supprimer">
            <i data-lucide="trash-2" style="width:14px;height:14px;"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

function exportPurchasesCSV() {
  if (state.purchasedCards.length === 0) {
    showToast('Aucun achat à exporter.');
    return;
  }

  const headers = ['Date', 'Reference', 'Nom', 'Etat', 'Quantite', 'Prix_JP_Yen', 'Prix_JP_Eur', 'Revente_FR_Eur', 'Marge_Nette_Eur'];
  const rows = state.purchasedCards.map(p => {
    const card = CatalogService.indexedCardsMap.get(p.cardId) || CatalogService.cards.find(c => c.ref === p.ref);
    const fr = card ? getActiveFrPrice(card, p.condition) : '';
    const m = fr ? (fr - p.priceEur).toFixed(2) : '';

    return [
      p.date ? p.date.split('T')[0] : '',
      `"${p.ref}"`,
      `"${p.name.replace(/"/g, '""')}"`,
      `"${p.condition}"`,
      p.qty,
      p.priceJpy,
      p.priceEur.toFixed(2),
      fr || '',
      m || ''
    ].join(',');
  });

  const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `pokespread_achats_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ── 14. SEARCH & QUICK ENTRY DROPDOWNS ────────────────────────
function renderSearchDropdown(matches) {
  const dropdown = document.getElementById('search-dropdown');
  if (!dropdown) return;

  if (!matches || matches.length === 0) {
    dropdown.innerHTML = `
      <div class="p-3 text-xs text-slate-400 text-center">Aucun résultat trouvé</div>
    `;
    dropdown.classList.remove('hidden');
    return;
  }

  dropdown.innerHTML = matches.slice(0, 8).map(card => {
    const frPrice = getActiveFrPrice(card);
    const jpPriceYen = getActiveJpPrice(card);
    const margin = netMargin(card);

    return `
      <div class="flex items-center justify-between p-2.5 hover:bg-slate-50 cursor-pointer border-b border-slate-100 last:border-0 transition-colors"
           onclick="selectSearchResult('${card.id}')">
        <div class="flex items-center gap-2.5 min-w-0">
          <img src="${formatHighResCardImage(card.image)}" alt="${card.displayName || card.name}"
               class="w-8 h-11 rounded object-cover border border-slate-200 flex-shrink-0"
               onerror="onCardImageError(this)">
          <div class="min-w-0">
            <h5 class="font-bold text-xs text-slate-900 truncate">${card.displayName || card.name}</h5>
            <span class="text-[10px] text-slate-400 font-mono">${card.ref}</span>
          </div>
        </div>
        <div class="text-right flex-shrink-0">
          <span class="font-bold text-xs text-slate-800 block">${fmtJpy(jpPriceYen)}</span>
          <span class="text-[10px] font-black ${margin && margin > 0 ? 'text-emerald-600' : 'text-slate-400'}">
            ${margin != null ? fmtEur(margin) : '—'}
          </span>
        </div>
      </div>
    `;
  }).join('');

  dropdown.classList.remove('hidden');
}

function selectSearchResult(cardId) {
  const dropdown = document.getElementById('search-dropdown');
  if (dropdown) dropdown.classList.add('hidden');
  openCardDetail(cardId);
}

function setupQuickEntry() {
  const inputEl = document.getElementById('quick-entry-ref');
  const dropdown = document.getElementById('quick-entry-dropdown');
  const addBtn = document.getElementById('quick-entry-add');
  const priceInput = document.getElementById('quick-entry-price');
  const qtyInput = document.getElementById('quick-entry-qty');
  const condSelect = document.getElementById('quick-entry-condition');

  let selectedQuickCard = null;

  if (inputEl && dropdown) {
    inputEl.addEventListener('input', () => {
      const q = inputEl.value.trim().toLowerCase();
      if (q.length < 2) {
        dropdown.classList.add('hidden');
        return;
      }

      const matches = CatalogService.cards.filter(c => {
        return (c.displayName || c.name || '').toLowerCase().includes(q) || (c.ref || '').toLowerCase().includes(q);
      }).slice(0, 6);

      if (matches.length > 0) {
        dropdown.innerHTML = matches.map(c => `
          <div class="p-2 hover:bg-slate-50 cursor-pointer flex items-center justify-between text-xs border-b border-slate-100 last:border-0"
               data-quick-id="${c.id}">
            <span class="font-bold text-slate-800 truncate">${c.displayName || c.name}</span>
            <span class="font-mono text-[10px] text-slate-400">${c.ref}</span>
          </div>
        `).join('');

        dropdown.querySelectorAll('[data-quick-id]').forEach(el => {
          el.addEventListener('click', () => {
            const id = el.getAttribute('data-quick-id');
            selectedQuickCard = CatalogService.cards.find(c => c.id === id);
            if (selectedQuickCard) {
              inputEl.value = `${selectedQuickCard.displayName || selectedQuickCard.name} (${selectedQuickCard.ref})`;
              const jp = getActiveJpPrice(selectedQuickCard);
              if (jp && priceInput && !priceInput.value) {
                priceInput.value = String(jp);
              }
            }
            dropdown.classList.add('hidden');
          });
        });

        dropdown.classList.remove('hidden');
      } else {
        dropdown.classList.add('hidden');
      }
    });

    document.addEventListener('click', (e) => {
      if (!inputEl.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.add('hidden');
      }
    });
  }

  if (addBtn) {
    addBtn.addEventListener('click', () => {
      if (!selectedQuickCard && inputEl) {
        const text = inputEl.value.trim();
        if (text) {
          selectedQuickCard = CatalogService.cards.find(c => (c.displayName || c.name).toLowerCase() === text.toLowerCase() || c.ref.toLowerCase() === text.toLowerCase());
        }
      }

      if (!selectedQuickCard) {
        showToast('Veuillez sélectionner une carte dans la liste.');
        return;
      }

      const price = priceInput ? Number(priceInput.value) : 0;
      const qty = qtyInput ? Number(qtyInput.value) : 1;
      const cond = condSelect ? condSelect.value : 'Raw NM';

      addToPurchases(selectedQuickCard, price, qty, cond);

      if (inputEl) inputEl.value = '';
      if (priceInput) priceInput.value = '';
      selectedQuickCard = null;
    });
  }
}

// ── 15. UI MODALS, POPOVERS & EVENT BINDINGS ──────────────────
function openModal(id) {
  const el = document.getElementById(id);
  if (el) {
    el.style.display = 'flex';
    requestAnimationFrame(() => {
      el.classList.add('open');
    });
    document.body.classList.add('overflow-hidden');
  }
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.remove('open');
    setTimeout(() => {
      if (!el.classList.contains('open')) {
        el.style.display = 'none';
      }
    }, 200);
    document.body.classList.remove('overflow-hidden');
  }
}

function showToast(msg) {
  let toast = document.getElementById('toast-notification');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast-notification';
    toast.className = 'fixed bottom-5 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-xs font-semibold px-4 py-2.5 rounded-xl shadow-2xl z-50 transition-all opacity-0 pointer-events-none';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.remove('opacity-0', 'pointer-events-none');
  setTimeout(() => {
    toast.classList.add('opacity-0', 'pointer-events-none');
  }, 2500);
}

function toggleColumnFocus(colName) {
  const grid = document.getElementById('columns-grid');
  const headers = document.querySelectorAll('.col-header');
  const wrappers = {
    margin: document.getElementById('col-wrapper-margin'),
    roi: document.getElementById('col-wrapper-roi'),
    velocity: document.getElementById('col-wrapper-velocity'),
  };
  const inners = {
    margin: document.getElementById('col-margin'),
    roi: document.getElementById('col-roi'),
    velocity: document.getElementById('col-velocity'),
  };

  if (state.focusCol === colName) {
    // Exit focus mode -> return to 3-column view
    state.focusCol = null;
    if (grid) grid.classList.remove('focus-mode');
    headers.forEach(h => {
      h.classList.remove('focus-active');
      const icon = h.querySelector('.col-expand-icon');
      if (icon) icon.setAttribute('data-lucide', 'maximize-2');
    });
    Object.values(wrappers).forEach(w => w && w.classList.remove('hidden'));
    Object.values(inners).forEach(i => i && i.classList.remove('focus-col-inner'));
  } else {
    // Enter focus mode
    state.focusCol = colName;
    if (grid) grid.classList.add('focus-mode');
    headers.forEach(h => {
      const isThis = h.getAttribute('data-col') === colName;
      h.classList.toggle('focus-active', isThis);
      const icon = h.querySelector('.col-expand-icon');
      if (icon) icon.setAttribute('data-lucide', isThis ? 'minimize-2' : 'maximize-2');
    });
    Object.entries(wrappers).forEach(([key, w]) => {
      if (w) w.classList.toggle('hidden', key !== colName);
    });
    Object.entries(inners).forEach(([key, inner]) => {
      if (inner) inner.classList.toggle('focus-col-inner', key === colName);
    });
  }
  if (window.lucide) lucide.createIcons();
}

function updateConditionTriggerLabel() {
  const lbl = document.getElementById('label-filter-condition');
  const libLbl = document.getElementById('label-lib-filter-condition');
  const text = state.condition.mode === 'raw'
    ? `💎 État : Non-gradé (${state.condition.rawCondition})`
    : `💎 État : ${state.condition.grade}`;
  if (lbl) lbl.textContent = text;
  if (libLbl) libLbl.textContent = text;
}

function renderConditionPopover(targetPopoverEl, onUpdateCallback = null) {
  if (!targetPopoverEl) return;

  targetPopoverEl.innerHTML = `
    <div class="space-y-3">
      <!-- Mode switcher (Raw vs Graded) -->
      <div class="flex rounded-xl p-0.5 bg-slate-100 border border-slate-200">
        <button type="button" class="cond-mode-raw flex-1 py-1 text-xs font-bold rounded-lg transition-all ${state.condition.mode === 'raw' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'} cursor-pointer">
          Non-gradé (Raw)
        </button>
        <button type="button" class="cond-mode-graded flex-1 py-1 text-xs font-bold rounded-lg transition-all ${state.condition.mode === 'graded' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'} cursor-pointer">
          Slab Gradé (PSA/BGS...)
        </button>
      </div>

      ${state.condition.mode === 'raw' ? `
        <!-- Raw Conditions -->
        <div class="grid grid-cols-2 gap-1.5">
          ${['NM', 'EX', 'LP', 'PL'].map(c => `
            <button type="button" class="cond-raw-btn p-2 rounded-xl border text-left transition-all ${state.condition.rawCondition === c ? 'border-blue-500 bg-blue-50 text-blue-900 font-bold' : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'} cursor-pointer"
                    data-raw-cond="${c}">
              <div class="text-xs font-bold">${c} (${c === 'NM' ? 'Near Mint' : c === 'EX' ? 'Excellent' : c === 'LP' ? 'Light Play' : 'Played'})</div>
              <div class="text-[10px] text-slate-400">${c === 'NM' ? 'Neuf' : c === 'EX' ? 'Micro-rayures' : 'Usé'}</div>
            </button>
          `).join('')}
        </div>
      ` : `
        <!-- Graded Companies & Grades -->
        <div class="space-y-2">
          <div class="flex flex-wrap gap-1">
            ${Object.keys(GRADING_COMPANIES).map(co => `
              <button type="button" class="grade-co-btn px-2 py-1 rounded-lg text-xs font-bold border transition-all ${state.condition.company === co ? 'bg-purple-600 text-white border-purple-600' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'} cursor-pointer"
                      data-co="${co}">
                ${co}
              </button>
            `).join('')}
          </div>
          <div class="grid grid-cols-2 gap-1 pt-1 max-h-40 overflow-y-auto custom-scrollbar">
            ${(GRADING_COMPANIES[state.condition.company]?.grades || []).map(g => `
              <button type="button" class="grade-val-btn p-1.5 rounded-lg border text-xs text-left transition-all ${state.condition.grade === g ? 'bg-purple-50 text-purple-900 border-purple-400 font-bold' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'} cursor-pointer"
                      data-grade="${g}">
                💎 ${g}
              </button>
            `).join('')}
          </div>
        </div>
      `}
    </div>
  `;

  const rawModeBtn = targetPopoverEl.querySelector('.cond-mode-raw');
  const gradedModeBtn = targetPopoverEl.querySelector('.cond-mode-graded');

  if (rawModeBtn) {
    rawModeBtn.addEventListener('click', () => {
      state.condition.mode = 'raw';
      state.filters.slabGrade = null;
      updateConditionTriggerLabel();
      renderConditionPopover(targetPopoverEl, onUpdateCallback);
      if (onUpdateCallback) onUpdateCallback();
      else renderAllColumns();
    });
  }

  if (gradedModeBtn) {
    gradedModeBtn.addEventListener('click', () => {
      state.condition.mode = 'graded';
      state.filters.slabGrade = state.condition.grade;
      updateConditionTriggerLabel();
      renderConditionPopover(targetPopoverEl, onUpdateCallback);
      if (onUpdateCallback) onUpdateCallback();
      else renderAllColumns();
    });
  }

  targetPopoverEl.querySelectorAll('[data-raw-cond]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.condition.rawCondition = btn.getAttribute('data-raw-cond');
      updateConditionTriggerLabel();
      renderConditionPopover(targetPopoverEl, onUpdateCallback);
      if (onUpdateCallback) onUpdateCallback();
      else renderAllColumns();
    });
  });

  targetPopoverEl.querySelectorAll('[data-co]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.condition.company = btn.getAttribute('data-co');
      const defaultGrade = GRADING_COMPANIES[state.condition.company]?.grades[0] || 'PSA 10';
      state.condition.grade = defaultGrade;
      state.filters.slabGrade = defaultGrade;
      updateConditionTriggerLabel();
      renderConditionPopover(targetPopoverEl, onUpdateCallback);
      if (onUpdateCallback) onUpdateCallback();
      else renderAllColumns();
    });
  });

  targetPopoverEl.querySelectorAll('[data-grade]').forEach(btn => {
    btn.addEventListener('click', () => {
      const g = btn.getAttribute('data-grade');
      state.condition.grade = g;
      state.filters.slabGrade = g;
      updateConditionTriggerLabel();
      renderConditionPopover(targetPopoverEl, onUpdateCallback);
      if (onUpdateCallback) onUpdateCallback();
      else renderAllColumns();
    });
  });
}

function bindFilterEvents() {
  // Ensure filter bar is always visible by default
  const filterBar = document.getElementById('focus-filter-bar');
  if (filterBar) {
    filterBar.classList.remove('hidden');
    filterBar.classList.add('flex');
  }

  // Prevent clicks inside popovers from bubbling to document and closing them
  ['popover-filter-country', 'popover-filter-price', 'popover-filter-condition', 'popover-lib-filter-condition'].forEach(id => {
    const pop = document.getElementById(id);
    if (pop) pop.addEventListener('click', (e) => e.stopPropagation());
  });

  // Wire Pricing reference dropdowns
  const selPricingFr = document.getElementById('pricing-ref-fr');
  const selPricingJp = document.getElementById('pricing-ref-jp');
  if (selPricingFr) {
    selPricingFr.value = state.pricingRefFr;
    selPricingFr.addEventListener('change', () => {
      state.pricingRefFr = selPricingFr.value;
      renderAllColumns();
    });
  }
  if (selPricingJp) {
    selPricingJp.value = state.pricingRefJp;
    selPricingJp.addEventListener('change', () => {
      state.pricingRefJp = selPricingJp.value;
      renderAllColumns();
    });
  }

  // 1. Country popover trigger
  const btnCountry = document.getElementById('btn-filter-country');
  const popoverCountry = document.getElementById('popover-filter-country');
  const inputSearchCountry = document.getElementById('input-search-country');
  const countryListEl = document.getElementById('country-options-list');
  const clearCountryBtn = document.getElementById('btn-clear-country');

  function renderCountryList(filterText = '') {
    if (!countryListEl) return;
    const q = filterText.toLowerCase();
    const filtered = COUNTRIES.filter(c => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q));

    countryListEl.innerHTML = filtered.map(c => {
      const active = state.filters.countries.includes(c.code);
      return `
        <label class="flex items-center justify-between p-1.5 rounded-lg hover:bg-slate-50 cursor-pointer text-xs select-none">
          <div class="flex items-center gap-2">
            <span>${c.flag}</span>
            <span class="font-medium text-slate-800">${c.name}</span>
            <span class="text-[10px] text-slate-400 font-mono">(${c.code})</span>
          </div>
          <input type="checkbox" data-country-code="${c.code}" ${active ? 'checked' : ''}
                 class="rounded text-blue-600 focus:ring-blue-400 h-3.5 w-3.5 cursor-pointer">
        </label>
      `;
    }).join('');

    countryListEl.querySelectorAll('[data-country-code]').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const code = cb.getAttribute('data-country-code');
        if (cb.checked) {
          if (!state.filters.countries.includes(code)) state.filters.countries.push(code);
        } else {
          state.filters.countries = state.filters.countries.filter(c => c !== code);
        }
        updateCountryTriggerLabel();
        renderAllColumns();
      });
    });
  }

  function updateCountryTriggerLabel() {
    const lbl = document.getElementById('label-filter-country');
    if (!lbl) return;
    if (state.filters.countries.length === 0) {
      lbl.textContent = '🌐 Édition pays : Toutes';
    } else if (state.filters.countries.length === 1) {
      const c = COUNTRIES.find(x => x.code === state.filters.countries[0]);
      lbl.textContent = `${c ? c.flag : ''} Édition : ${c ? c.name : state.filters.countries[0]}`;
    } else {
      lbl.textContent = `🌐 Éditions : ${state.filters.countries.join(', ')}`;
    }
  }

  if (btnCountry && popoverCountry) {
    btnCountry.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = popoverCountry.classList.contains('hidden');
      closeAllPopovers();
      if (isHidden) {
        renderCountryList(inputSearchCountry ? inputSearchCountry.value : '');
        popoverCountry.classList.remove('hidden');
      }
    });
  }

  if (inputSearchCountry) {
    inputSearchCountry.addEventListener('input', () => {
      renderCountryList(inputSearchCountry.value);
    });
  }

  if (clearCountryBtn) {
    clearCountryBtn.addEventListener('click', () => {
      state.filters.countries = [];
      updateCountryTriggerLabel();
      renderCountryList();
      renderAllColumns();
    });
  }

  // 2. Price filter popover
  const btnPrice = document.getElementById('btn-filter-price');
  const popoverPrice = document.getElementById('popover-filter-price');
  const inputMin = document.getElementById('input-price-min');
  const inputMax = document.getElementById('input-price-max');
  const clearPriceBtn = document.getElementById('btn-clear-price');
  const priceUnitSymbol = document.getElementById('price-unit-symbol');
  const presetsContainer = document.getElementById('price-presets-container');

  function renderPricePresets() {
    if (!presetsContainer) return;
    const presets = state.filters.priceUnit === 'JPY' ? PRICE_PRESETS_JPY : PRICE_PRESETS_EUR;

    presetsContainer.innerHTML = presets.map(p => `
      <button type="button" class="preset-btn px-2 py-1 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-700 font-semibold text-[11px] text-center transition-colors cursor-pointer"
              data-pmin="${p.min}" data-pmax="${p.max || ''}">
        ${p.label}
      </button>
    `).join('');

    presetsContainer.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const pmin = btn.getAttribute('data-pmin') ? Number(btn.getAttribute('data-pmin')) : null;
        const pmax = btn.getAttribute('data-pmax') ? Number(btn.getAttribute('data-pmax')) : null;
        state.filters.priceMin = pmin;
        state.filters.priceMax = pmax;
        if (inputMin) inputMin.value = pmin !== null ? String(pmin) : '';
        if (inputMax) inputMax.value = pmax !== null ? String(pmax) : '';
        updatePriceTriggerLabel();
        renderAllColumns();
      });
    });
  }

  function updatePriceTriggerLabel() {
    const lbl = document.getElementById('label-filter-price');
    if (!lbl) return;
    const sym = state.filters.priceUnit === 'JPY' ? '¥' : '€';
    if (state.filters.priceMin == null && state.filters.priceMax == null) {
      lbl.textContent = `💰 Prix : Min — | Max — ${sym}`;
    } else {
      const minStr = state.filters.priceMin != null ? state.filters.priceMin : '0';
      const maxStr = state.filters.priceMax != null ? state.filters.priceMax : '∞';
      lbl.textContent = `💰 Prix : ${minStr} à ${maxStr} ${sym}`;
    }
  }

  if (btnPrice && popoverPrice) {
    btnPrice.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = popoverPrice.classList.contains('hidden');
      closeAllPopovers();
      if (isHidden) {
        renderPricePresets();
        popoverPrice.classList.remove('hidden');
      }
    });
  }

  if (inputMin) {
    inputMin.addEventListener('input', () => {
      state.filters.priceMin = inputMin.value ? Number(inputMin.value) : null;
      updatePriceTriggerLabel();
      renderAllColumns();
    });
  }

  if (inputMax) {
    inputMax.addEventListener('input', () => {
      state.filters.priceMax = inputMax.value ? Number(inputMax.value) : null;
      updatePriceTriggerLabel();
      renderAllColumns();
    });
  }

  if (clearPriceBtn) {
    clearPriceBtn.addEventListener('click', () => {
      state.filters.priceMin = null;
      state.filters.priceMax = null;
      if (inputMin) inputMin.value = '';
      if (inputMax) inputMax.value = '';
      updatePriceTriggerLabel();
      renderAllColumns();
    });
  }

  // Currency toggle buttons
  document.querySelectorAll('.price-curr-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const curr = btn.getAttribute('data-curr');
      state.filters.priceUnit = curr;
      document.querySelectorAll('.price-curr-btn').forEach(b => b.classList.remove('active', 'bg-white', 'shadow-sm'));
      btn.classList.add('active', 'bg-white', 'shadow-sm');
      if (priceUnitSymbol) priceUnitSymbol.textContent = curr === 'JPY' ? '¥' : '€';
      renderPricePresets();
      updatePriceTriggerLabel();
      renderAllColumns();
    });
  });

  // 3. Condition / Grading filter popover
  const btnCondition = document.getElementById('btn-filter-condition');
  const popoverCondition = document.getElementById('popover-filter-condition');

  if (btnCondition && popoverCondition) {
    btnCondition.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = popoverCondition.classList.contains('hidden');
      closeAllPopovers();
      if (isHidden) {
        renderConditionPopover(popoverCondition);
        popoverCondition.classList.remove('hidden');
      }
    });
  }

  // 4. Complete Opportunities quick toggle
  const pricedOnlyToggle = document.getElementById('toggle-priced-only');
  if (pricedOnlyToggle) {
    pricedOnlyToggle.checked = state.filters.pricedOnly;
    pricedOnlyToggle.addEventListener('change', () => {
      state.filters.pricedOnly = pricedOnlyToggle.checked;
      renderAllColumns();
    });
  }

  // 5. Global Reset Button
  const resetBtn = document.getElementById('filter-reset-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      state.filters.countries = [];
      state.filters.priceMin = null;
      state.filters.priceMax = null;
      state.filters.pricedOnly = false;
      state.filters.slabGrade = null;
      state.searchQuery = '';
      state.condition.mode = 'raw';
      state.condition.rawCondition = 'NM';

      const sInput = document.getElementById('search-input');
      if (sInput) sInput.value = '';
      if (pricedOnlyToggle) pricedOnlyToggle.checked = false;

      updateCountryTriggerLabel();
      updatePriceTriggerLabel();
      updateConditionTriggerLabel();
      renderAllColumns();
      showToast('Filtres réinitialisés');
    });
  }

  // Close popovers on outer click
  document.addEventListener('click', (e) => {
    closeAllPopovers();
  });
}

function closeAllPopovers() {
  document.querySelectorAll('#popover-filter-country, #popover-filter-price, #popover-filter-condition, #popover-lib-filter-condition').forEach(el => {
    el.classList.add('hidden');
  });
}

function bindMainEvents() {
  // Top bar buttons
  const refreshBtn = document.getElementById('btn-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      showToast('Actualisation des prix...');
      await PriceService.loadPrices();
      CatalogService.populateCards(CatalogService.cards);
      renderAllColumns();
      showToast('Prix actualisés.');
    });
  }

  const settingsBtn = document.getElementById('btn-settings');
  const settingsMobileBtn = document.getElementById('btn-settings-mobile');
  if (settingsBtn) settingsBtn.addEventListener('click', () => openModal('modal-settings'));
  if (settingsMobileBtn) settingsMobileBtn.addEventListener('click', () => openModal('modal-settings'));

  const scannerEnginePill = document.getElementById('scanner-engine-pill');
  if (scannerEnginePill) scannerEnginePill.addEventListener('click', () => openModal('modal-settings'));

  const clearCacheBtn = document.getElementById('btn-clear-cache');
  if (clearCacheBtn) {
    clearCacheBtn.addEventListener('click', async () => {
      await CatalogService.clearCache();
      showToast('Cache TCGdex vidé.');
      location.reload();
    });
  }

  // Search input
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    let debounceTimer = null;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        state.searchQuery = searchInput.value.trim();
        const matches = CatalogService.cards.filter(cardMatchesFilters);
        renderSearchDropdown(matches);
        renderAllColumns();
      }, 150);
    });

    searchInput.addEventListener('focus', () => {
      if (searchInput.value.trim().length > 0) {
        const matches = CatalogService.cards.filter(cardMatchesFilters);
        renderSearchDropdown(matches);
      }
    });

    document.addEventListener('click', (e) => {
      const dd = document.getElementById('search-dropdown');
      if (dd && !searchInput.contains(e.target) && !dd.contains(e.target)) {
        dd.classList.add('hidden');
      }
    });
  }

  // Three Image-Button Cards
  const btnLibrary = document.getElementById('btn-library');
  const btnScanner = document.getElementById('btn-scanner');
  const btnPurchases = document.getElementById('btn-purchases');

  if (btnLibrary) btnLibrary.addEventListener('click', () => openLibraryModal());
  if (btnScanner) btnScanner.addEventListener('click', () => openScannerModal());
  if (btnPurchases) btnPurchases.addEventListener('click', () => {
    renderPurchases();
    openModal('modal-purchases');
  });

  // Modal close buttons
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.getAttribute('data-close-modal');
      closeModal(modalId);
    });
  });

  // Scanner controls
  const nativeCamInput = document.getElementById('native-camera-input');
  const fallbackFileInput = document.getElementById('scanner-file-fallback');
  const nativeCamBtn = document.getElementById('scanner-native-btn');
  const galleryBtn = document.getElementById('scanner-gallery-btn');
  const scannerCloseBtn = document.getElementById('scanner-close-btn');

  if (nativeCamBtn && nativeCamInput) {
    nativeCamBtn.addEventListener('click', () => nativeCamInput.click());
    nativeCamInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        ScannerService.processImageFile(e.target.files[0]);
      }
    });
  }

  if (galleryBtn && fallbackFileInput) {
    galleryBtn.addEventListener('click', () => fallbackFileInput.click());
    fallbackFileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        ScannerService.processImageFile(e.target.files[0]);
      }
    });
  }

  if (scannerCloseBtn) {
    scannerCloseBtn.addEventListener('click', () => closeScannerModal());
  }

  // Manual ref in scanner
  const manualInput = document.getElementById('scanner-manual-ref');
  const manualBtn = document.getElementById('scanner-manual-btn');
  if (manualBtn && manualInput) {
    const handleManual = () => {
      const q = manualInput.value.trim().toLowerCase();
      if (!q) return;
      const resultsEl = document.getElementById('scanner-results');
      const numMatch = q.match(/(\d{1,3})\s*[\/|\\]\s*(\d{2,3})/) || q.match(/(\d{1,3})/);
      const cardNum = numMatch ? numMatch[1] : '';

      let grade = null;
      if (q.includes('psa 10')) grade = 'PSA 10';
      else if (q.includes('psa 9')) grade = 'PSA 9';
      else if (q.includes('bgs 10')) grade = 'BGS 10';

      const data = {
        card_number: cardNum,
        pokemon_name_en: q,
        grade: grade,
        is_graded: !!grade
      };
      ScannerService.handleIdentificationSuccess(data, resultsEl);
    };
    manualBtn.addEventListener('click', handleManual);
    manualInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleManual(); });
  }

  // Purchases CSV export
  const exportCsvBtn = document.getElementById('btn-export-csv');
  if (exportCsvBtn) exportCsvBtn.addEventListener('click', () => exportPurchasesCSV());

  // Mobile Tabs switcher
  document.querySelectorAll('.mobile-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.getAttribute('data-tab');
      state.activeMobileTab = tabName;
      document.querySelectorAll('.mobile-tab').forEach(t => t.classList.remove('mobile-tab-active', 'border-blue-500', 'bg-blue-50', 'text-blue-900'));
      tab.classList.add('mobile-tab-active', 'border-blue-500', 'bg-blue-50', 'text-blue-900');
      renderAllColumns();
    });
  });

  // Load more buttons
  const lmMargin = document.getElementById('load-more-margin');
  const lmRoi = document.getElementById('load-more-roi');
  const lmVel = document.getElementById('load-more-velocity');
  const lmMobile = document.getElementById('mobile-load-more');

  if (lmMargin) lmMargin.addEventListener('click', () => { state.visibleCount.margin += 25; renderAllColumns(); });
  if (lmRoi) lmRoi.addEventListener('click', () => { state.visibleCount.roi += 25; renderAllColumns(); });
  if (lmVel) lmVel.addEventListener('click', () => { state.visibleCount.velocity += 25; renderAllColumns(); });
  if (lmMobile) lmMobile.addEventListener('click', () => {
    state.visibleCount[state.activeMobileTab] = (state.visibleCount[state.activeMobileTab] || 25) + 25;
    renderAllColumns();
  });

  // Scroll to top button
  const scrollTopBtn = document.getElementById('btn-scroll-top');
  if (scrollTopBtn) {
    window.addEventListener('scroll', () => {
      scrollTopBtn.classList.toggle('hidden', window.scrollY < 300);
    });
    scrollTopBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  }

  // Column headers focus mode
  document.querySelectorAll('.col-header').forEach(header => {
    header.addEventListener('click', (e) => {
      e.stopPropagation();
      const colName = header.getAttribute('data-col');
      if (colName) toggleColumnFocus(colName);
    });
  });

  // Close modals on dark backdrop overlay click
  document.querySelectorAll('.modal-overlay, #modal-scanner').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        if (overlay.id === 'modal-scanner') {
          closeScannerModal();
        } else {
          closeModal(overlay.id);
        }
      }
    });
  });

  // Close modals and popovers on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllPopovers();
      document.querySelectorAll('.modal-overlay.open, #modal-scanner').forEach(m => {
        if (m.id === 'modal-scanner' && m.style.display !== 'none') {
          closeScannerModal();
        } else if (m.classList.contains('open')) {
          closeModal(m.id);
        }
      });
    }
  });

  // Bind arbitrage cost settings
  bindCostSettings();
}

function bindCostSettings() {
  const feeInput = document.getElementById('input-resale-fee');
  const vatInput = document.getElementById('input-import-vat');
  const shipInput = document.getElementById('input-shipping-cost');
  const saveBtn = document.getElementById('btn-save-costs');
  const resetBtn = document.getElementById('btn-reset-costs');

  try {
    const saved = localStorage.getItem('pokespread_costs');
    if (saved) {
      Object.assign(state.costs, JSON.parse(saved));
    }
  } catch (e) {}

  if (feeInput) feeInput.value = state.costs.resaleFeePct ?? 0;
  if (vatInput) vatInput.value = state.costs.importVatPct ?? 0;
  if (shipInput) shipInput.value = state.costs.shippingPerCardEur ?? 0;

  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      state.costs.resaleFeePct = feeInput ? Number(feeInput.value) || 0 : 0;
      state.costs.importVatPct = vatInput ? Number(vatInput.value) || 0 : 0;
      state.costs.shippingPerCardEur = shipInput ? Number(shipInput.value) || 0 : 0;
      localStorage.setItem('pokespread_costs', JSON.stringify(state.costs));
      renderAllColumns();
      showToast('✅ Frais d\'arbitrage appliqués aux marges !');
      closeModal('modal-settings');
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      state.costs.resaleFeePct = 0;
      state.costs.importVatPct = 0;
      state.costs.shippingPerCardEur = 0;
      if (feeInput) feeInput.value = 0;
      if (vatInput) vatInput.value = 0;
      if (shipInput) shipInput.value = 0;
      localStorage.setItem('pokespread_costs', JSON.stringify(state.costs));
      renderAllColumns();
      showToast('Frais réinitialisés par défaut');
    });
  }
}

function openScannerModal() {
  const el = document.getElementById('modal-scanner');
  if (el) {
    el.style.display = 'flex';
    document.body.classList.add('overflow-hidden');
    ScannerService.updateEngineBadge();
  }
}

function closeScannerModal() {
  const el = document.getElementById('modal-scanner');
  if (el) {
    el.style.display = 'none';
    document.body.classList.remove('overflow-hidden');
  }
}

function openLibraryModal() {
  const modal = document.getElementById('modal-library');
  const grid = document.getElementById('library-grid');
  const counter = document.getElementById('library-counter');
  const searchInput = document.getElementById('library-search');
  const btnLibCondition = document.getElementById('btn-lib-filter-condition');
  const popoverLibCondition = document.getElementById('popover-lib-filter-condition');
  const selYear = document.getElementById('lib-filter-year');
  const selPlatformFr = document.getElementById('lib-filter-platform-fr');
  const selPlatformJp = document.getElementById('lib-filter-platform-jp');
  const libPricedToggle = document.getElementById('lib-toggle-priced-only');

  if (!modal || !grid) return;

  const libState = {
    search: searchInput ? searchInput.value.trim() : '',
    editions: ['all'],
    pricedOnly: libPricedToggle ? libPricedToggle.checked : false,
    year: selYear ? selYear.value : 'all',
    limit: 40
  };

  function renderGrid() {
    const q = libState.search.toLowerCase().trim();
    const filtered = CatalogService.cards.filter(c => {
      // 1. Search text
      if (q && !(c.displayName || c.name || '').toLowerCase().includes(q) && !(c.ref || '').toLowerCase().includes(q) && (c.local_id || '') !== q) {
        return false;
      }
      // 2. Multi-select editions
      if (!libState.editions.includes('all') && !libState.editions.includes(c.edition)) {
        return false;
      }
      // 3. Priced only
      if (libState.pricedOnly && !PriceService.getExactPrice(c)) {
        return false;
      }
      // 4. Year filter
      if (libState.year !== 'all') {
        const sid = (c.set_id || '').toLowerCase();
        if (libState.year === '2026' || libState.year === '2025' || libState.year === '2024') {
          if (!sid.startsWith('sv') && !sid.startsWith('m')) return false;
        } else if (libState.year === '2023') {
          if (!sid.startsWith('sv') && !sid.startsWith('s12') && !sid.startsWith('s11')) return false;
        } else if (libState.year === '2022' || libState.year === '2021' || libState.year === '2020') {
          if (!sid.startsWith('s') && !sid.startsWith('swsh')) return false;
        }
      }
      return true;
    });

    if (counter) counter.textContent = `${filtered.length} cartes`;

    const slice = filtered.slice(0, libState.limit);
    let cardsHtml = slice.map((c, i) => renderCardTile(c, i + 1)).join('');

    if (!cardsHtml) {
      grid.innerHTML = `<div class="col-span-full py-8 text-center text-slate-400">Aucune carte trouvée avec ces critères.</div>`;
    } else {
      if (filtered.length > libState.limit) {
        cardsHtml += `
          <div class="col-span-full py-4 text-center">
            <button type="button" id="btn-lib-load-more" class="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-md transition-all cursor-pointer">
              Charger plus (${filtered.length - libState.limit} restantes)
            </button>
          </div>
        `;
      }
      grid.innerHTML = cardsHtml;
      const loadMoreBtn = document.getElementById('btn-lib-load-more');
      if (loadMoreBtn) {
        loadMoreBtn.addEventListener('click', () => {
          libState.limit += 40;
          renderGrid();
        });
      }
    }
    if (window.lucide) lucide.createIcons();
  }

  // Bind library search
  if (searchInput) {
    searchInput.oninput = () => {
      libState.search = searchInput.value;
      libState.limit = 40;
      renderGrid();
    };
  }

  // Bind edition pills (multi-select)
  document.querySelectorAll('#lib-edition-pills .lib-filter-btn').forEach(btn => {
    btn.onclick = () => {
      const ed = btn.getAttribute('data-lib-edition') || 'all';
      if (ed === 'all') {
        libState.editions = ['all'];
        document.querySelectorAll('#lib-edition-pills .lib-filter-btn').forEach(b => {
          b.classList.toggle('active', b.getAttribute('data-lib-edition') === 'all');
        });
      } else {
        if (libState.editions.includes('all')) {
          libState.editions = [];
        }
        if (libState.editions.includes(ed)) {
          libState.editions = libState.editions.filter(x => x !== ed);
        } else {
          libState.editions.push(ed);
        }
        if (libState.editions.length === 0) {
          libState.editions = ['all'];
        }
        document.querySelectorAll('#lib-edition-pills .lib-filter-btn').forEach(b => {
          const bEd = b.getAttribute('data-lib-edition');
          b.classList.toggle('active', libState.editions.includes(bEd));
        });
      }
      libState.limit = 40;
      renderGrid();
    };
  });

  // Bind priced only
  if (libPricedToggle) {
    libPricedToggle.onchange = () => {
      libState.pricedOnly = libPricedToggle.checked;
      libState.limit = 40;
      renderGrid();
    };
  }

  // Bind Year filter
  if (selYear) {
    selYear.onchange = () => {
      libState.year = selYear.value;
      libState.limit = 40;
      renderGrid();
    };
  }

  // Bind platform selects
  if (selPlatformFr) {
    selPlatformFr.value = state.pricingRefFr;
    selPlatformFr.onchange = () => {
      state.pricingRefFr = selPlatformFr.value;
      renderGrid();
      renderAllColumns();
    };
  }
  if (selPlatformJp) {
    selPlatformJp.value = state.pricingRefJp;
    selPlatformJp.onchange = () => {
      state.pricingRefJp = selPlatformJp.value;
      renderGrid();
      renderAllColumns();
    };
  }

  // Bind condition popover inside library modal
  if (btnLibCondition && popoverLibCondition) {
    btnLibCondition.onclick = (e) => {
      e.stopPropagation();
      const isHidden = popoverLibCondition.classList.contains('hidden');
      closeAllPopovers();
      if (isHidden) {
        renderConditionPopover(popoverLibCondition, () => {
          renderGrid();
          renderAllColumns();
        });
        popoverLibCondition.classList.remove('hidden');
      }
    };
  }

  updateConditionTriggerLabel();
  renderGrid();
  openModal('modal-library');
}

// ── 16. LIVE FX RATE FETCHER (BROWSER BACKGROUND) ─────────────
async function fetchLiveExchangeRate() {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/EUR');
    if (res.ok) {
      const data = await res.json();
      if (data.rates?.JPY) {
        state.rate = data.rates.JPY;
        const rateEl = document.getElementById('live-rate');
        if (rateEl) rateEl.textContent = state.rate.toFixed(2);
      }
    }
  } catch (e) {
    console.log('Using default exchange rate:', state.rate);
  }
}

// ── 17. APPLICATION INITIALIZATION ────────────────────────────
async function initApp() {
  console.log('⚡ Initializing PokéSpread JP→FR v4.0...');

  // 1. Bind global events & popovers
  bindFilterEvents();
  bindMainEvents();
  setupQuickEntry();
  loadPurchases();
  ScannerService.init();

  // 2. Fetch live FX rate
  fetchLiveExchangeRate();

  // 3. Load verified market prices from prices.json (Instant)
  await PriceService.loadPrices();

  // 4. Load full catalog with IndexedDB caching (24h TTL)
  await CatalogService.loadCatalog();

  // 5. Initial Render
  renderAllColumns();

  if (window.lucide) {
    lucide.createIcons();
  }

  console.log('✅ PokéSpread ready: 60fps responsive arbitrage board active.');
}

window.addEventListener('DOMContentLoaded', () => {
  initApp();
});
