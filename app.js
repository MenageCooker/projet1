// ============================================================
//  PokéSpread JP→FR — app.js (v7 Production Release)
//  Senior Full-Stack & FinTech Architecture
// ============================================================

// ── STATE ────────────────────────────────────────────────────
const state = {
  rate: 163.5,                                         // EUR/JPY live exchange rate
  fee: 0,                                             // platform fee (0% standard)
  purchasedCards: [],
  visibleCount: { margin: 25, roi: 25, velocity: 25 }, // Pagination steps: 25 -> 100 -> 250 -> 500 -> 1000
  searchQuery: '',
  focusCol: null,                                      // 'margin' | 'roi' | 'velocity' | null
  activeMobileTab: 'margin',                           // Mobile active tab: 'margin' | 'roi' | 'velocity'
  isLoadingCatalog: false,
  pricingRefFr: 'avg',                                 // 'avg' (3-platform smoothed 30j) | 'ebay' | 'vinted' | 'lbc'
  pricingRefJp: 'min',                                 // 'min' (best JP price) | 'mercari' | 'yahoo' | 'cardrush'
  conditionFilter: 'raw_nm',                           // Backward compatibility string
  condition: {
    mode: 'raw',                                       // 'raw' | 'graded'
    rawConditions: ['NM'],                             // Multi-select subset of ['NM', 'EX', 'LP', 'PL']
    companies: ['ALL'],                                // ['ALL'], ['PSA'], ['BGS'], ['CGC'], ['PCA'], ['ARS']
    grades: []                                         // Multi-select grades from GRADING_SCALES[co]
  },
  filters: {
    countries: [],                                     // Selected edition codes, e.g. ['JP', 'FR']. Empty = all
    priceMin: null,
    priceMax: null,
    priceUnit: 'EUR',                                  // 'EUR' | 'JPY'
  }
};

// ── AVAILABLE EDITIONS / COUNTRIES ───────────────────────────
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

// ── CONDITION & GRADING ARCHITECTURE ─────────────────────────
const RAW_CONDITIONS = [
  { key: 'NM', label: 'Near Mint (NM)', sub: 'Neuf / Proche du neuf', multiplier: 1.00, badgeCls: 'badge-condition-nm' },
  { key: 'EX', label: 'Excellent (EX)', sub: 'Très bon état / micro-rayures', multiplier: 0.82, badgeCls: 'badge-condition-ex' },
  { key: 'LP', label: 'Lightly Played (LP)', sub: 'Légèrement joué / blanchiments', multiplier: 0.65, badgeCls: 'badge-condition-lp' },
  { key: 'PL', label: 'Played / Poor (PL)', sub: 'Joué / pliures / usure', multiplier: 0.45, badgeCls: 'badge-condition-pl' }
];

// 1. COMPANY-DEPENDENT AUTHENTIC GRADE SCALES
const GRADING_SCALES = {
  PSA: [
    { grade: '10 (Gem Mint)', short: '10', frMult: 2.60, jpMult: 2.30 },
    { grade: '9 (Mint)', short: '9', frMult: 1.30, jpMult: 1.25 },
    { grade: '8 (NM-MT)', short: '8', frMult: 1.00, jpMult: 0.98 },
    { grade: '≤ 7', short: '≤ 7', frMult: 0.75, jpMult: 0.72 }
  ],
  BGS: [
    { grade: '10 Black Label', short: '10 BL', frMult: 4.80, jpMult: 4.20 },
    { grade: '10 Pristine', short: '10 Pr', frMult: 3.40, jpMult: 3.00 },
    { grade: '9.5 (Gem Mint)', short: '9.5', frMult: 1.90, jpMult: 1.80 },
    { grade: '9 (Mint)', short: '9', frMult: 1.30, jpMult: 1.25 },
    { grade: '≤ 8.5', short: '≤ 8.5', frMult: 0.95, jpMult: 0.92 }
  ],
  CGC: [
    { grade: '10 Pristine', short: '10 Pr', frMult: 3.20, jpMult: 2.80 },
    { grade: '10 (Gem Mint)', short: '10', frMult: 2.35, jpMult: 2.15 },
    { grade: '9.5 (Mint+)', short: '9.5', frMult: 1.65, jpMult: 1.55 },
    { grade: '9 (Mint)', short: '9', frMult: 1.22, jpMult: 1.18 },
    { grade: '≤ 8.5', short: '≤ 8.5', frMult: 0.92, jpMult: 0.90 }
  ],
  PCA: [
    { grade: '10+ (Collector)', short: '10+', frMult: 3.00, jpMult: 2.60 },
    { grade: '10 (Neuf Sup)', short: '10', frMult: 2.20, jpMult: 2.00 },
    { grade: '9.5 (Neuf)', short: '9.5', frMult: 1.55, jpMult: 1.45 },
    { grade: '9 (Très Bon)', short: '9', frMult: 1.20, jpMult: 1.15 },
    { grade: '≤ 8', short: '≤ 8', frMult: 0.90, jpMult: 0.88 }
  ],
  ARS: [
    { grade: '10+', short: '10+', frMult: 3.60, jpMult: 3.20 },
    { grade: '10', short: '10', frMult: 2.75, jpMult: 2.50 },
    { grade: '9', short: '9', frMult: 1.35, jpMult: 1.30 },
    { grade: '≤ 8', short: '≤ 8', frMult: 0.92, jpMult: 0.90 }
  ],
  ALL: [
    { grade: '10+ / Black Label', short: '10+ / BL', frMult: 3.80, jpMult: 3.40 },
    { grade: '10', short: '10', frMult: 2.60, jpMult: 2.30 },
    { grade: '9.5', short: '9.5', frMult: 1.75, jpMult: 1.65 },
    { grade: '9', short: '9', frMult: 1.28, jpMult: 1.23 },
    { grade: '≤ 8.5', short: '≤ 8.5', frMult: 0.92, jpMult: 0.90 }
  ]
};

const GRADING_COMPANIES = {
  PSA: {
    name: 'PSA',
    fullName: 'Professional Sports Authenticator (USA)',
    grades: GRADING_SCALES.PSA
  },
  BGS: {
    name: 'BGS',
    fullName: 'Beckett Grading Services (USA)',
    grades: GRADING_SCALES.BGS
  },
  CGC: {
    name: 'CGC',
    fullName: 'Certified Guaranty Company (USA)',
    grades: GRADING_SCALES.CGC
  },
  PCA: {
    name: 'PCA',
    fullName: 'PCA Grade (France / Leader Européen)',
    grades: GRADING_SCALES.PCA
  },
  ARS: {
    name: 'ARS',
    fullName: 'ARS Grading (Japon / Boîtiers Haute Sécurité)',
    grades: GRADING_SCALES.ARS
  }
};

// ── PRICE PRESETS ────────────────────────────────────────────
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

// ── PAGINATION STEPS ─────────────────────────────────────────
const PAGE_STEPS = [25, 100, 250, 500, 1000];
function nextPageStep(current, total) {
  for (const step of PAGE_STEPS) {
    if (step > current) return Math.min(step, total);
  }
  return total;
}

// ── NATIVE TCGDEX MULTI-LANGUAGE LOCALIZATION (ZERO STATIC DICTIONARIES) ──
const LocalizationService = {
  frNameByRawId: new Map(),     // Linked directly from TCGdex /v2/fr/cards IDs
  frNameByDexId: new Map(),     // Cached on-demand via TCGdex dexId linking

  registerFrenchCards(frCards) {
    if (!Array.isArray(frCards)) return;
    for (const c of frCards) {
      if (c && c.rawId && c.name) {
        this.frNameByRawId.set(c.rawId, c.name);
      }
    }
  },

  // Link card name natively using TCGdex multi-language IDs (no static maps)
  resolveNativeNames(rawName, lang, rawId = '') {
    if (lang === 'fr') {
      return { name: rawName, subName: '' };
    }
    if (rawId && this.frNameByRawId.has(rawId)) {
      const frName = this.frNameByRawId.get(rawId);
      return { name: frName, subName: rawName !== frName ? rawName : '' };
    }
    return { name: rawName, subName: lang === 'ja' ? rawName : '' };
  },

  // On-demand native TCGdex JA→FR translation via official dexId linking
  async translateCardViaTCGdex(card) {
    if (!card || card.edition === 'FR' || !card.rawId) return card;
    if (this.frNameByRawId.has(card.rawId)) {
      card.name = this.frNameByRawId.get(card.rawId);
      return card;
    }
    try {
      const lang = card.edition === 'JP' ? 'ja' : 'en';
      const detailRes = await fetch(`https://api.tcgdex.net/v2/${lang}/cards/${encodeURIComponent(card.rawId)}`);
      if (!detailRes.ok) return card;
      const detail = await detailRes.json();
      const dexId = Array.isArray(detail?.dexId) ? detail.dexId[0] : detail?.dexId;
      if (!dexId) return card;

      if (this.frNameByDexId.has(dexId)) {
        const frBase = this.frNameByDexId.get(dexId);
        card.subName = card.subName || card.name;
        card.name = frBase;
        this.frNameByRawId.set(card.rawId, frBase);
        return card;
      }

      const frRes = await fetch(`https://api.tcgdex.net/v2/fr/cards?dexId=${encodeURIComponent(dexId)}`);
      if (frRes.ok) {
        const frList = await frRes.json();
        const firstFr = Array.isArray(frList) && frList[0]?.name ? frList[0].name : null;
        if (firstFr) {
          this.frNameByDexId.set(dexId, firstFr);
          this.frNameByRawId.set(card.rawId, firstFr);
          card.subName = card.subName || card.name;
          card.name = firstFr;
        }
      }
    } catch (e) {}
    return card;
  }
};

// ── IMAGE HELPERS ────────────────────────────────────────────
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

// ── PERSISTENT STORAGE SERVICE (INDEXEDDB & 24H TTL CACHE) ────
const StorageService = {
  DB_NAME: 'pokespread_db',
  DB_VERSION: 1,
  CATALOG_STORE: 'catalog_store',
  PRICES_STORE: 'prices_store',
  TTL_MS: 24 * 60 * 60 * 1000, // 24-hour cache TTL

  _dbPromise: null,

  getDB() {
    if (this._dbPromise) return this._dbPromise;
    this._dbPromise = new Promise((resolve) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        return resolve(null);
      }
      try {
        const req = window.indexedDB.open(this.DB_NAME, this.DB_VERSION);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(this.CATALOG_STORE)) {
            db.createObjectStore(this.CATALOG_STORE, { keyPath: 'key' });
          }
          if (!db.objectStoreNames.contains(this.PRICES_STORE)) {
            db.createObjectStore(this.PRICES_STORE, { keyPath: 'key' });
          }
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
    return this._dbPromise;
  },

  async get(storeName, key) {
    try {
      const db = await this.getDB();
      if (db) {
        const result = await new Promise((resolve) => {
          try {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.get(key);
            req.onsuccess = () => {
              const rec = req.result;
              if (rec && rec.timestamp && (Date.now() - rec.timestamp < this.TTL_MS)) {
                resolve(rec.data);
              } else {
                resolve(null);
              }
            };
            req.onerror = () => resolve(null);
          } catch (err) {
            resolve(null);
          }
        });
        if (result) return result;
      }
    } catch (e) {}

    // Fallback to localStorage
    try {
      const lsKey = `ps_${storeName}_${key}`;
      const raw = localStorage.getItem(lsKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.timestamp && (Date.now() - parsed.timestamp < this.TTL_MS)) {
          return parsed.data;
        }
      }
    } catch (e) {}
    return null;
  },

  async set(storeName, key, data) {
    const record = { key, data, timestamp: Date.now() };
    try {
      const db = await this.getDB();
      if (db) {
        await new Promise((resolve) => {
          try {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            store.put(record);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
          } catch (e) {
            resolve(false);
          }
        });
      }
    } catch (e) {}

    // Keep localStorage lean: store only a 100-card warm startup preview for the massive global catalog
    try {
      const lsKey = `ps_${storeName}_${key}`;
      if (storeName === this.CATALOG_STORE && key === 'cards' && Array.isArray(data)) {
        const preview = { key, data: data.slice(0, 100), timestamp: record.timestamp };
        localStorage.setItem(lsKey, JSON.stringify(preview));
      } else if (storeName !== this.CATALOG_STORE) {
        const serialized = JSON.stringify(record);
        if (serialized.length < 2_500_000) {
          localStorage.setItem(lsKey, serialized);
        }
      }
    } catch (e) {}
  },

  loadInitialCachedCards() {
    try {
      const lsKey = `ps_${this.CATALOG_STORE}_cards`;
      const raw = localStorage.getItem(lsKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.timestamp && (Date.now() - parsed.timestamp < this.TTL_MS) && Array.isArray(parsed.data) && parsed.data.length > 0) {
          return parsed.data;
        }
      }
    } catch (e) {}
    return null;
  }
};

// ── FAST DYNAMIC CARD INDEX (UNRESTRICTED ~50,000-CARD LOOKUP ENGINE) ──
const CardIndex = {
  byRef: new Map(),
  bySerial: new Map(),
  byLocalId: new Map(),
  byId: new Map(),
  byName: new Map(),

  clear() {
    this.byRef.clear();
    this.bySerial.clear();
    this.byLocalId.clear();
    this.byId.clear();
    this.byName.clear();
  },

  addCard(card) {
    if (!card) return;
    if (card.id) this.byId.set(card.id.toLowerCase(), card);

    if (card.ref) {
      const cleanRef = card.ref.toLowerCase().replace(/\s+/g, ' ').trim();
      this.byRef.set(cleanRef, card);
      this.byRef.set(cleanRef.replace(/\s+/g, ''), card);

      // Index exact fraction serial (e.g. "120/119", "201/165", "025/165")
      const frac = cleanRef.match(/\b([0-9]{1,3})\/([0-9]{1,3})\b/);
      if (frac) {
        const rawKey = `${frac[1]}/${frac[2]}`;
        const unpadKey = `${frac[1].replace(/^0+/, '') || frac[1]}/${frac[2].replace(/^0+/, '') || frac[2]}`;
        if (!this.bySerial.has(rawKey)) this.bySerial.set(rawKey, []);
        this.bySerial.get(rawKey).push(card);
        if (unpadKey !== rawKey) {
          if (!this.bySerial.has(unpadKey)) this.bySerial.set(unpadKey, []);
          this.bySerial.get(unpadKey).push(card);
        }
      }
    }

    if (card.localId != null && card.localId !== '') {
      const loc = String(card.localId).toLowerCase().trim();
      const cleanNum = loc.replace(/^0+/, '') || loc;
      if (!this.byLocalId.has(loc)) this.byLocalId.set(loc, []);
      this.byLocalId.get(loc).push(card);
      if (cleanNum !== loc) {
        if (!this.byLocalId.has(cleanNum)) this.byLocalId.set(cleanNum, []);
        this.byLocalId.get(cleanNum).push(card);
      }
    }

    if (card.name) {
      const n = card.name.toLowerCase().trim();
      if (!this.byName.has(n)) this.byName.set(n, []);
      this.byName.get(n).push(card);
    }
    if (card.subName && card.subName !== card.name) {
      const sn = card.subName.toLowerCase().trim();
      if (!this.byName.has(sn)) this.byName.set(sn, []);
      this.byName.get(sn).push(card);
    }
  },

  build(cards) {
    this.clear();
    if (!Array.isArray(cards)) return;
    for (const card of cards) {
      this.addCard(card);
    }
  },

  async buildChunked(cards, chunkSize = 4000) {
    this.clear();
    if (!Array.isArray(cards)) return;
    for (let i = 0; i < cards.length; i += chunkSize) {
      const end = Math.min(i + chunkSize, cards.length);
      for (let j = i; j < end; j++) {
        this.addCard(cards[j]);
      }
      if (end < cards.length) {
        await new Promise(r => setTimeout(r, 0));
      }
    }
  },

  lookupByRef(ref) {
    if (!ref) return null;
    const clean = ref.toLowerCase().replace(/\s+/g, ' ').trim();
    if (this.byRef.has(clean)) return this.byRef.get(clean);
    const noSpace = clean.replace(/\s+/g, '');
    return this.byRef.get(noSpace) || null;
  },

  lookupBySerial(serial) {
    if (!serial) return [];
    const clean = String(serial).toLowerCase().replace(/\s+/g, '').trim();
    if (this.bySerial.has(clean)) return this.bySerial.get(clean);
    const frac = clean.match(/^0*([0-9]{1,3})\/0*([0-9]{1,3})$/);
    if (frac) {
      const unpad = `${frac[1]}/${frac[2]}`;
      if (this.bySerial.has(unpad)) return this.bySerial.get(unpad);
    }
    return [];
  },

  lookupByLocalId(id) {
    if (!id) return [];
    const clean = String(id).toLowerCase().trim();
    const cleanNum = clean.replace(/^0+/, '') || clean;
    return this.byLocalId.get(clean) || this.byLocalId.get(cleanNum) || [];
  },

  search(query, limit = 50) {
    const q = (query || '').toLowerCase().trim();
    if (!q) return [];
    const directRef = this.lookupByRef(q);
    if (directRef) return [directRef];

    // Exact serial match (e.g. "120/119", "201/165")
    const fracMatch = q.match(/\b([0-9]{1,3})\s*\/\s*([0-9]{1,3})\b/);
    if (fracMatch) {
      const exactSerial = this.lookupBySerial(`${fracMatch[1]}/${fracMatch[2]}`);
      if (exactSerial.length > 0) return exactSerial.slice(0, limit);
      const localFallback = this.lookupByLocalId(fracMatch[1]);
      if (localFallback.length > 0) return localFallback.slice(0, limit);
    }

    if (/^[0-9]{1,3}$/.test(q)) {
      const numCandidates = this.lookupByLocalId(q);
      if (numCandidates.length > 0) return numCandidates.slice(0, limit);
    }

    if (this.byName.has(q)) {
      return this.byName.get(q).slice(0, limit);
    }

    // Fast early-exit substring scan across the full global catalog
    const results = [];
    if (typeof CARDS !== 'undefined' && Array.isArray(CARDS)) {
      for (let i = 0; i < CARDS.length; i++) {
        const c = CARDS[i];
        const name = (c.name || '').toLowerCase();
        const sub = (c.subName || '').toLowerCase();
        const ref = (c.ref || '').toLowerCase();
        if (name.includes(q) || sub.includes(q) || ref.includes(q)) {
          results.push(c);
          if (results.length >= limit) break;
        }
      }
    }
    return results;
  }
};

// ── DYNAMIC HISTORICAL GRADE SPREAD & CONDITION RESOLVER ─────
function resolveConditionMultiplier(customConditionOrGrade = null, card = null) {
  let mode = 'raw';
  let company = null;
  let gradeShort = null;
  let baseFrMult = 1.0;
  let baseJpMult = 1.0;

  // 1. Parse explicit condition or grade (Detail Modal, Scanner, Purchases, Platform Breakdown)
  if (customConditionOrGrade) {
    if (typeof customConditionOrGrade === 'object') {
      if (customConditionOrGrade.mode === 'raw' || (customConditionOrGrade.condition && customConditionOrGrade.mode !== 'graded')) {
        const condKey = customConditionOrGrade.condition || customConditionOrGrade.key || 'NM';
        const cond = RAW_CONDITIONS.find(c => c.key === condKey) || RAW_CONDITIONS[0];
        return { frMult: cond.multiplier, jpMult: cond.multiplier, source: 'raw_condition' };
      }
      if (customConditionOrGrade.mode === 'graded' || customConditionOrGrade.company) {
        mode = 'graded';
        company = (customConditionOrGrade.company || 'PSA').toUpperCase();
        const grKey = String(customConditionOrGrade.grade || '10');
        const scale = GRADING_SCALES[company] || GRADING_SCALES.PSA;
        const gr = scale.find(g => g.grade === grKey || g.short === grKey || g.grade.startsWith(grKey)) || scale[0];
        gradeShort = gr.short;
        baseFrMult = gr.frMult;
        baseJpMult = gr.jpMult;
      }
    } else if (typeof customConditionOrGrade === 'string') {
      const str = customConditionOrGrade.trim();
      if (str.startsWith('Raw ')) {
        const key = str.replace('Raw ', '').trim();
        const cond = RAW_CONDITIONS.find(c => c.key === key || c.label.includes(key)) || RAW_CONDITIONS[0];
        return { frMult: cond.multiplier, jpMult: cond.multiplier, source: 'raw_condition' };
      }
      const rawMatch = RAW_CONDITIONS.find(c => c.key === str || c.label.includes(str));
      if (rawMatch) {
        return { frMult: rawMatch.multiplier, jpMult: rawMatch.multiplier, source: 'raw_condition' };
      }
      mode = 'graded';
      const parts = str.split(/\s+/);
      company = (parts[0] || 'PSA').toUpperCase();
      const gradeStr = parts.slice(1).join(' ').trim();
      const scale = GRADING_SCALES[company] || GRADING_SCALES.ALL;
      const gr = scale.find(g => g.grade === gradeStr || g.short === gradeStr || g.grade.startsWith(gradeStr)) || scale[0];
      gradeShort = gr.short;
      baseFrMult = gr.frMult;
      baseJpMult = gr.jpMult;
    }
  } else {
    // 2. Active global filter (Focus Mode & Library)
    if (!state.condition || state.condition.mode === 'raw') {
      const active = state.condition?.rawConditions || ['NM'];
      const matched = RAW_CONDITIONS.filter(c => active.includes(c.key));
      const avg = matched.length > 0
        ? matched.reduce((sum, c) => sum + c.multiplier, 0) / matched.length
        : 1.0;
      return { frMult: avg, jpMult: avg, source: 'raw_condition' };
    } else {
      mode = 'graded';
      const companies = state.condition.companies || ['ALL'];
      const grades = state.condition.grades || [];
      company = (companies.length === 1 && companies[0] !== 'ALL') ? companies[0] : 'ALL';
      const scale = GRADING_SCALES[company] || GRADING_SCALES.ALL;
      let matchedGrades = grades.length > 0
        ? scale.filter(g => grades.includes(g.grade) || grades.includes(g.short))
        : [];
      if (matchedGrades.length === 0) matchedGrades = [scale[0]];
      gradeShort = matchedGrades.length === 1 ? matchedGrades[0].short : null;
      baseFrMult = matchedGrades.reduce((sum, g) => sum + g.frMult, 0) / matchedGrades.length;
      baseJpMult = matchedGrades.reduce((sum, g) => sum + g.jpMult, 0) / matchedGrades.length;
    }
  }

  // 3. Dynamic Historical Market Grade Spread Resolution (Graded Slabs)
  if (mode === 'graded') {
    const gradeKey = (company && company !== 'ALL' && gradeShort) ? `${company} ${gradeShort}` : null;
    let frMult = baseFrMult;
    let jpMult = baseJpMult;
    let source = 'historical_curve';

    // Priority A: Direct verified graded sold prices for this specific card in prices.json
    if (card && gradeKey && typeof PriceService !== 'undefined') {
      const entry = PriceService.findPriceEntry(card);
      const rawFr = entry?.fr?.smoothed_avg || card.frPrice;
      const rawJp = entry?.jp?.smoothed_avg || card.jpPrice;
      const directFr = entry?.fr?.graded?.[gradeKey]?.smoothed_avg;
      const directJp = entry?.jp?.graded?.[gradeKey]?.smoothed_avg;

      if (directFr && rawFr > 0) {
        frMult = directFr / rawFr;
        source = 'direct_sold';
      }
      if (directJp && rawJp > 0) {
        jpMult = directJp / rawJp;
        source = 'direct_sold';
      }
    }

    // Priority B: Empirical market-wide grade spreads observed in prices.json._meta
    if (source !== 'direct_sold' && gradeKey && typeof PriceService !== 'undefined') {
      const observed = PriceService.pricesJsonData?._meta?.observed_grade_spreads;
      if (observed?.fr?.[gradeKey] && observed.fr[gradeKey] > 0) {
        frMult = observed.fr[gradeKey];
        source = 'market_spread';
      }
      if (observed?.jp?.[gradeKey] && observed.jp[gradeKey] > 0) {
        jpMult = observed.jp[gradeKey];
        source = 'market_spread';
      }
    }

    // Priority C: Dynamic Price-Tier & Print-Quality Spread Curve (adjusts for raw value tier & edition)
    if (source === 'historical_curve' && card && baseFrMult > 1.1) {
      const rawEur = card.frPrice || (card.jpPrice ? card.jpPrice / (state.rate || 165) : null);
      if (rawEur != null && rawEur > 0) {
        let tierFactor = 1.0;
        if (rawEur < 15) tierFactor = 1.18;        // Low-raw grading fee floor effect
        else if (rawEur < 45) tierFactor = 1.06;   // Mid-entry AR / SR spread
        else if (rawEur > 140) tierFactor = 0.88;  // High-value chase card compression

        // Edition gem-rate adjustment (JP modern print quality vs FR/EN centering scarcity)
        let editionFactorFr = 1.0;
        let editionFactorJp = 1.0;
        if (card.edition === 'JP') {
          editionFactorFr = (company === 'ARS') ? 1.05 : 0.94;
          editionFactorJp = (company === 'ARS') ? 1.08 : 0.93;
        } else if (card.edition === 'FR' || card.edition === 'EN') {
          editionFactorFr = 1.05;
          editionFactorJp = 1.02;
        }

        // Apply adjustments only to the premium above 1.0x raw
        frMult = Math.max(0.7, 1.0 + (baseFrMult - 1.0) * tierFactor * editionFactorFr);
        jpMult = Math.max(0.7, 1.0 + (baseJpMult - 1.0) * tierFactor * editionFactorJp);
      }
    }

    return {
      frMult: Math.round(frMult * 1000) / 1000,
      jpMult: Math.round(jpMult * 1000) / 1000,
      source,
      gradeKey
    };
  }

  return { frMult: baseFrMult, jpMult: baseJpMult, source: 'raw_condition' };
}

// ── REAL MARKETPLACE PRICE ENGINE (`PriceService`) ───────────
const PriceService = {
  pricesJsonData: null,
  pricesJsonLoaded: false,

  // Load real sold-item prices from prices.json or 24h storage cache
  async loadPricesJson() {
    const badge = document.getElementById('prices-source-badge');
    try {
      const res = await fetch('./prices.json?t=' + Date.now());
      if (res.ok) {
        const data = await res.json();
        if (data && data.prices && Object.keys(data.prices).length > 0) {
          this.pricesJsonData = data;
          this.pricesJsonLoaded = true;
          // Store in 24h persistent storage
          await StorageService.set(StorageService.PRICES_STORE, 'market_prices', data);
          if (badge) {
            badge.className = 'prices-source-badge prices-source-scraped';
            const count = data._meta?.priced_cards || Object.keys(data.prices).length;
            badge.textContent = `🟢 Ventes réelles (${count})`;
            const genTime = data._meta?.generated_at
              ? new Date(data._meta.generated_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
              : 'Live';
            badge.title = `Ventes finalisées eBay FR & Mercari JP (${genTime})`;
          }
          this.repriceAllCards();
          renderAllColumns();
          updateColumnCounters();
          return true;
        }
      }
    } catch (e) {
      console.info('[PriceService] prices.json not reachable, checking storage cache:', e.message);
    }

    // Check storage cache
    const cachedPrices = await StorageService.get(StorageService.PRICES_STORE, 'market_prices');
    if (cachedPrices && cachedPrices.prices && Object.keys(cachedPrices.prices).length > 0) {
      this.pricesJsonData = cachedPrices;
      this.pricesJsonLoaded = true;
      if (badge) {
        badge.className = 'prices-source-badge prices-source-scraped';
        badge.textContent = '🟢 Cache 24h';
        badge.title = 'Ventes finalisées enregistrées en cache local 24h';
      }
      this.repriceAllCards();
      renderAllColumns();
      updateColumnCounters();
      return true;
    }

    // No verified sold sales available: strict safeguard mode (no fabricated prices)
    this.pricesJsonData = null;
    this.pricesJsonLoaded = false;
    if (badge) {
      badge.className = 'prices-source-badge prices-source-api';
      badge.textContent = '⚪ En attente de ventes';
      badge.title = 'Aucune vente finalisée enregistrée — scan ou actualisation requise';
    }
    this.repriceAllCards();
    renderAllColumns();
    updateColumnCounters();
    return false;
  },

  // Match pricing record by ref or localId from real sold-item database
  findPriceEntry(card) {
    if (!this.pricesJsonData?.prices) return null;
    const p = this.pricesJsonData.prices;
    if (p[card.ref]) return p[card.ref];
    const cleanRef = card.ref ? card.ref.toLowerCase().replace(/\s+/g, ' ') : '';
    for (const k of Object.keys(p)) {
      if (k.toLowerCase().replace(/\s+/g, ' ') === cleanRef) return p[k];
      if (card.localId && k.includes(` ${card.localId}/`)) return p[k];
    }
    return null;
  },

  // Reprice all loaded cards with verified market data
  repriceAllCards() {
    for (const card of CARDS) {
      this.enrichCardWithRealPrices(card);
    }
  },

  // STRICT SAFEGUARD: ZERO FAKE PRICES
  // If a card lacks real verified market sales, prices are set strictly to null
  enrichCardWithRealPrices(card) {
    if (!card) return card;
    const entry = this.findPriceEntry(card);
    if (entry) {
      const frSmooth = entry.fr?.smoothed_avg;
      const jpSmooth = entry.jp?.smoothed_avg;
      card.frPrice = frSmooth != null ? frSmooth : null;
      card.jpPrice = jpSmooth != null ? jpSmooth : null;
      card.hasPrice = (card.frPrice != null && card.jpPrice != null);

      if (entry.fr) {
        card.platforms = {
          ebay: entry.fr.ebay_fr?.sold_prices?.[0] || entry.fr.smoothed_avg || null,
          vinted: null,
          lbc: null,
          cardmarket: entry.fr.cardmarket_trend || null
        };
      } else {
        card.platforms = null;
      }
    } else {
      card.frPrice = null;
      card.jpPrice = null;
      card.hasPrice = false;
      card.platforms = null;
    }
    return card;
  },

  // Multi-platform price breakdown tables data with condition/slab multiplier support
  // Returns genuine finalized sales only — zero fake multipliers
  getMultiPlatformPrices(card, mode = 'raw', conditionOrGrade = 'NM') {
    let custom = null;
    if (mode === 'raw') {
      custom = { mode: 'raw', condition: typeof conditionOrGrade === 'string' ? conditionOrGrade : (conditionOrGrade?.condition || 'NM') };
    } else {
      if (typeof conditionOrGrade === 'object') {
        custom = { mode: 'graded', company: conditionOrGrade.company || 'PSA', grade: conditionOrGrade.grade || '10' };
      } else {
        custom = typeof conditionOrGrade === 'string' && conditionOrGrade.includes(' ')
          ? conditionOrGrade
          : { mode: 'graded', company: 'PSA', grade: conditionOrGrade };
      }
    }
    const { frMult, jpMult } = resolveConditionMultiplier(custom, card);

    const entry = this.findPriceEntry(card);
    if (entry && entry.fr && entry.jp && card.hasPrice) {
      const cm = entry.fr.cardmarket || {};
      return {
        fr: {
          ebay: {
            last: entry.fr.ebay_fr?.sold_prices?.[0] ? Math.round(entry.fr.ebay_fr.sold_prices[0] * frMult * 10) / 10 : null,
            avg7: cm.avg7 ? Math.round(cm.avg7 * frMult * 10) / 10 : null,
            avg30: (entry.fr.ebay_fr?.avg || entry.fr.smoothed_avg) ? Math.round((entry.fr.ebay_fr?.avg || entry.fr.smoothed_avg) * frMult * 10) / 10 : null,
            avg90: cm.avg30 ? Math.round(cm.avg30 * frMult * 10) / 10 : null
          },
          vinted: { last: null, avg7: null, avg30: null, avg90: null },
          lbc: { last: null, avg7: null, avg30: null, avg90: null }
        },
        jp: {
          mercari: {
            last: entry.jp.mercari?.sold_prices?.[0] ? Math.round(entry.jp.mercari.sold_prices[0] * jpMult) : null,
            avg7: null,
            avg30: entry.jp.mercari?.avg ? Math.round(entry.jp.mercari.avg * jpMult) : (entry.jp.mercari?.sold_prices?.length ? Math.round(entry.jp.smoothed_avg * jpMult) : null),
            avg90: null
          },
          yahoo: {
            last: entry.jp.yahoo_auctions?.sold_prices?.[0] ? Math.round(entry.jp.yahoo_auctions.sold_prices[0] * jpMult) : null,
            avg7: null,
            avg30: entry.jp.yahoo_auctions?.avg ? Math.round(entry.jp.yahoo_auctions.avg * jpMult) : (entry.jp.yahoo_auctions?.sold_prices?.length ? Math.round(entry.jp.smoothed_avg * jpMult) : null),
            avg90: null
          },
          cardrush: {
            last: entry.jp.card_rush?.sold_prices?.[0] ? Math.round(entry.jp.card_rush.sold_prices[0] * jpMult) : null,
            avg7: null,
            avg30: entry.jp.card_rush?.avg ? Math.round(entry.jp.card_rush.avg * jpMult) : (entry.jp.card_rush?.sold_prices?.length ? Math.round(entry.jp.smoothed_avg * jpMult) : null),
            avg90: null
          }
        }
      };
    }

    // Price not available: zero fabricated numbers
    return { fr: null, jp: null };
  },

  enrichCard(card) {
    const edition = card.edition || 'JP';
    const enriched = {
      id: card.id,
      rawId: card.rawId || '',
      name: card.name,
      subName: card.subName || '',
      localId: String(card.localId || ''),
      setId: card.setId || '',
      ref: card.ref,
      image: formatHighResCardImage(card.image),
      hp: card.hp || null,
      edition,
      jpPrice: card.jpPrice != null ? card.jpPrice : null,
      frPrice: card.frPrice != null ? card.frPrice : null,
      hasPrice: false,
      salesPerMonth: card.salesPerMonth || null,
      velocityScore: card.velocityScore || null,
      priceHistory: card.priceHistory || [],
      platforms: card.platforms || null,
      lastSales: card.lastSales || []
    };
    return this.enrichCardWithRealPrices(enriched);
  }
};

// ── UNRESTRICTED GLOBAL CATALOG SERVICE (`CatalogService`) ────
// Zero hardcoded sets: dynamically fetches ALL sets & cards from TCGdex API
const CatalogService = {
  setMetaMap: new Map(),           // key: `${lang}:${setId}` -> { id, name, officialCount, totalCount }
  setsByOfficialCount: new Map(),  // key: '119' -> [{ lang, edition, setId, name, officialCount }]
  _setsLoaded: false,

  async ensureSetsMetadata() {
    if (this._setsLoaded && this.setMetaMap.size > 0) return;

    // Check 24h IndexedDB cache for sets metadata first
    const cachedSets = await StorageService.get(StorageService.CATALOG_STORE, 'sets_meta');
    if (cachedSets && Array.isArray(cachedSets) && cachedSets.length > 50) {
      this._hydrateSetMaps(cachedSets);
      this._setsLoaded = true;
      return;
    }

    const langs = [
      { lang: 'fr', edition: 'FR' },
      { lang: 'ja', edition: 'JP' }
    ];

    const fetchedSets = [];
    await Promise.all(
      langs.map(async ({ lang, edition }) => {
        try {
          const res = await fetch(`https://api.tcgdex.net/v2/${lang}/sets`);
          if (!res.ok) return;
          const list = await res.json();
          if (!Array.isArray(list)) return;
          for (const s of list) {
            if (!s || !s.id) continue;
            const officialCount = String(s.cardCount?.official || s.cardCount?.total || '---');
            const totalCount = String(s.cardCount?.total || officialCount);
            fetchedSets.push({
              lang,
              edition,
              setId: s.id,
              name: s.name || s.id,
              officialCount,
              totalCount
            });
          }
        } catch (err) {
          console.warn(`[CatalogService] Failed fetching /v2/${lang}/sets:`, err.message);
        }
      })
    );

    if (fetchedSets.length > 0) {
      this._hydrateSetMaps(fetchedSets);
      this._setsLoaded = true;
      await StorageService.set(StorageService.CATALOG_STORE, 'sets_meta', fetchedSets);
    }
  },

  _hydrateSetMaps(setsArr) {
    this.setMetaMap.clear();
    this.setsByOfficialCount.clear();
    for (const s of setsArr) {
      this.setMetaMap.set(`${s.lang}:${s.setId}`, s);
      if (s.officialCount && s.officialCount !== '---') {
        const key = String(s.officialCount).replace(/^0+/, '') || String(s.officialCount);
        if (!this.setsByOfficialCount.has(key)) this.setsByOfficialCount.set(key, []);
        this.setsByOfficialCount.get(key).push(s);
      }
    }
  },

  _buildCardObj(c, lang, edition) {
    const rawId = String(c.id || '');
    const dashIdx = rawId.lastIndexOf('-');
    const setId = dashIdx > 0 ? rawId.slice(0, dashIdx) : rawId;
    const localId = String(c.localId || '');
    const meta = this.setMetaMap.get(`${lang}:${setId}`);
    const officialCount = meta?.officialCount || '---';
    const ref = officialCount !== '---' ? `${setId} ${localId}/${officialCount}` : `${setId} ${localId}`;
    const { name, subName } = LocalizationService.resolveNativeNames(c.name || '', lang, rawId);

    return PriceService.enrichCard({
      id: `${lang}-${rawId}`,
      rawId,
      name,
      subName,
      localId,
      setId,
      ref,
      image: c.image,
      hp: c.hp || null,
      edition
    });
  },

  async initCatalog() {
    state.isLoadingCatalog = true;
    try {
      await this.ensureSetsMetadata();

      // 1. Try loading full global catalog from 24h IndexedDB cache
      const cached = await StorageService.get(StorageService.CATALOG_STORE, 'cards');
      if (cached && Array.isArray(cached) && cached.length >= 2000) {
        const enrichedList = new Array(cached.length);
        const CHUNK = 4000;
        for (let i = 0; i < cached.length; i += CHUNK) {
          const end = Math.min(i + CHUNK, cached.length);
          for (let j = i; j < end; j++) {
            enrichedList[j] = PriceService.enrichCard(cached[j]);
          }
          if (end < cached.length) await new Promise(r => setTimeout(r, 0));
        }
        CARDS = enrichedList;
        LocalizationService.registerFrenchCards(CARDS.filter(c => c.edition === 'FR'));
        await CardIndex.buildChunked(CARDS);
        renderAllColumns();
        renderMobileColumn();
        updateFilterMatchCount();
        updateColumnCounters();
        return;
      }

      // 2. Dynamically fetch the complete unrestricted catalog from TCGdex API
      await this.fetchGlobalCatalog();
    } catch (e) {
      console.warn('[CatalogService] initCatalog warning:', e);
    } finally {
      state.isLoadingCatalog = false;
    }
  },

  async fetchGlobalCatalog(forceRefresh = false) {
    state.isLoadingCatalog = true;
    try {
      if (forceRefresh) this._setsLoaded = false;
      await this.ensureSetsMetadata();

      // Fetch full FR & JP card indexes in parallel (all ~50,000 official cards, zero hardcoded sets)
      const [frRaw, jaRaw] = await Promise.all([
        fetch('https://api.tcgdex.net/v2/fr/cards').then(r => r.ok ? r.json() : []).catch(() => []),
        fetch('https://api.tcgdex.net/v2/ja/cards').then(r => r.ok ? r.json() : []).catch(() => [])
      ]);

      // Register French native names first so Japanese cards link natively via official IDs
      const frNormalized = [];
      if (Array.isArray(frRaw)) {
        const CHUNK = 4000;
        for (let i = 0; i < frRaw.length; i += CHUNK) {
          const end = Math.min(i + CHUNK, frRaw.length);
          for (let j = i; j < end; j++) {
            const c = frRaw[j];
            if (!c || !c.image || typeof c.image !== 'string' || !c.image.trim()) continue;
            frNormalized.push(this._buildCardObj(c, 'fr', 'FR'));
          }
          if (end < frRaw.length) await new Promise(r => setTimeout(r, 0));
        }
      }
      LocalizationService.registerFrenchCards(frNormalized);

      const jaNormalized = [];
      if (Array.isArray(jaRaw)) {
        const CHUNK = 4000;
        for (let i = 0; i < jaRaw.length; i += CHUNK) {
          const end = Math.min(i + CHUNK, jaRaw.length);
          for (let j = i; j < end; j++) {
            const c = jaRaw[j];
            if (!c || !c.image || typeof c.image !== 'string' || !c.image.trim()) continue;
            jaNormalized.push(this._buildCardObj(c, 'ja', 'JP'));
          }
          if (end < jaRaw.length) await new Promise(r => setTimeout(r, 0));
        }
      }

      // If bulk endpoints returned nothing, fall back to lazy-iterating dynamically retrieved sets
      let combined = [...jaNormalized, ...frNormalized];
      if (combined.length === 0 && this.setMetaMap.size > 0) {
        const setsArr = Array.from(this.setMetaMap.values()).reverse();
        const BATCH_SIZE = 10;
        for (let i = 0; i < setsArr.length; i += BATCH_SIZE) {
          const batch = setsArr.slice(i, i + BATCH_SIZE);
          const batchCards = await Promise.all(
            batch.map(async s => {
              try {
                const res = await fetch(`https://api.tcgdex.net/v2/${s.lang}/sets/${s.setId}`);
                if (!res.ok) return [];
                const data = await res.json();
                return (data.cards || [])
                  .filter(c => c && c.image && typeof c.image === 'string' && c.image.trim())
                  .map(c => this._buildCardObj(c, s.lang, s.edition));
              } catch (e) {
                return [];
              }
            })
          );
          combined.push(...batchCards.flat());
          // Paint first wave immediately so user sees cards right away without blocking
          if (i === 0 && combined.length > 0) {
            CARDS = combined;
            CardIndex.build(CARDS);
            renderAllColumns();
            renderMobileColumn();
            updateColumnCounters();
          }
        }
      }

      if (combined.length > 0) {
        // Deduplicate by id while preserving newest sets / priced entries
        const cardMap = new Map();
        for (const card of combined) {
          if (card && card.id && card.image) cardMap.set(card.id, card);
        }

        CARDS = Array.from(cardMap.values());
        await CardIndex.buildChunked(CARDS);
        PriceService.repriceAllCards();

        // Persist complete global catalog to IndexedDB (24h TTL)
        await StorageService.set(StorageService.CATALOG_STORE, 'cards', CARDS);

        renderAllColumns();
        renderMobileColumn();
        updateFilterMatchCount();
        updateColumnCounters();
      }
    } catch (e) {
      console.error('[CatalogService] Global catalog fetch error:', e);
    } finally {
      state.isLoadingCatalog = false;
    }
  },

  // Alias preserved for refresh controls
  async fetchAllMultiLangSets() {
    return this.fetchGlobalCatalog(true);
  },

  async searchLive(query) {
    const q = (query || '').trim();
    if (!q) return [];

    // 1. Check fast local global CardIndex first
    const localMatches = CardIndex.search(q, 25);
    if (localMatches.length > 0) {
      return localMatches.slice(0, 15);
    }

    // 2. Live query TCGdex API (supports serials, set IDs, and Pokémon names)
    try {
      await this.ensureSetsMetadata();
      const serialMatch = q.match(/\b(\d{1,3})\s*\/\s*(\d{1,3})\b/);
      if (serialMatch) {
        return await this.lookupCardsBySerial(`${serialMatch[1]}/${serialMatch[2]}`);
      }

      const isJapanese = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(q);
      const langs = isJapanese ? [{ lang: 'ja', edition: 'JP' }] : [{ lang: 'fr', edition: 'FR' }, { lang: 'ja', edition: 'JP' }];

      const results = await Promise.all(
        langs.map(async ({ lang, edition }) => {
          try {
            const res = await fetch(`https://api.tcgdex.net/v2/${lang}/cards?name=${encodeURIComponent(q)}`);
            if (!res.ok) return [];
            const data = await res.json();
            if (!Array.isArray(data)) return [];
            return data
              .filter(c => c && c.image && typeof c.image === 'string' && c.image.trim())
              .slice(0, 15)
              .map(c => this._buildCardObj(c, lang, edition));
          } catch (e) {
            return [];
          }
        })
      );

      const fetched = results.flat().slice(0, 15);
      for (const card of fetched) {
        if (!CardIndex.byId.has(card.id.toLowerCase())) {
          CARDS.push(card);
          CardIndex.addCard(card);
        }
      }
      return fetched;
    } catch (e) {
      console.warn('TCGdex live search error:', e);
      return [];
    }
  },

  // Exact serial / localId lookup across global CardIndex + live TCGdex API
  // Handles queries like "120/119", "201/165", "sv2a 201", "#120"
  async lookupCardsBySerial(serialInput, setHint = null) {
    if (!serialInput) return [];
    await this.ensureSetsMetadata();

    const cleanSerial = String(serialInput).trim();
    const parts = cleanSerial.match(/\b(\d{1,3})\s*\/\s*(\d{1,3})\b/);
    const rawLocal = parts ? parts[1] : (cleanSerial.match(/(\d{1,3})/)?.[1] || '');
    const total = parts ? parts[2] : null;
    if (!rawLocal) return [];

    const cleanNum = rawLocal.replace(/^0+/, '') || rawLocal;
    const cleanTotal = total ? (total.replace(/^0+/, '') || total) : null;

    // 1. O(1) exact fraction match in global CardIndex (e.g. "120/119" -> Élecsprint xy4-120)
    if (cleanTotal) {
      let exactLocal = CardIndex.lookupBySerial(`${rawLocal}/${total}`);
      if (exactLocal.length === 0) exactLocal = CardIndex.lookupBySerial(`${cleanNum}/${cleanTotal}`);
      if (exactLocal.length > 0) {
        if (setHint) {
          const hintLow = setHint.toLowerCase();
          const narrowed = exactLocal.filter(c => (c.setId || '').toLowerCase() === hintLow || (c.ref || '').toLowerCase().includes(hintLow));
          if (narrowed.length > 0) return narrowed;
        }
        return exactLocal;
      }
    }

    // 2. Direct setHint + localId match in local index
    if (setHint) {
      const hintLow = setHint.toLowerCase();
      const locList = CardIndex.lookupByLocalId(rawLocal);
      const setMatches = locList.filter(c => (c.setId || '').toLowerCase() === hintLow || (c.ref || '').toLowerCase().includes(hintLow));
      if (setMatches.length > 0) return setMatches;
    }

    // 3. Live query official TCGdex API by exact localId across FR & JP catalogues
    try {
      const queries = [
        { lang: 'fr', edition: 'FR', id: rawLocal },
        { lang: 'ja', edition: 'JP', id: rawLocal }
      ];
      if (cleanNum !== rawLocal) {
        queries.push({ lang: 'fr', edition: 'FR', id: cleanNum });
        queries.push({ lang: 'ja', edition: 'JP', id: cleanNum });
      }

      const responses = await Promise.all(
        queries.map(async q => {
          try {
            const res = await fetch(`https://api.tcgdex.net/v2/${q.lang}/cards?localId=${encodeURIComponent(q.id)}`);
            if (!res.ok) return [];
            const data = await res.json();
            if (!Array.isArray(data)) return [];
            return data
              .filter(c => c && c.image && typeof c.image === 'string' && c.image.trim())
              .map(c => this._buildCardObj(c, q.lang, q.edition));
          } catch (e) {
            return [];
          }
        })
      );

      const seen = new Set();
      const fetched = [];
      for (const card of responses.flat()) {
        if (!seen.has(card.id)) {
          seen.add(card.id);
          fetched.push(card);
          if (!CardIndex.byId.has(card.id.toLowerCase())) {
            CARDS.push(card);
            CardIndex.addCard(card);
          }
        }
      }

      if (fetched.length > 0) {
        // Prioritize exact setHint match
        if (setHint) {
          const hintLow = setHint.toLowerCase();
          const setMatches = fetched.filter(c => (c.setId || '').toLowerCase() === hintLow || (c.ref || '').toLowerCase().includes(hintLow));
          if (setMatches.length > 0) return setMatches;
        }
        // Prioritize exact denominator match using dynamically retrieved TCGdex set cardCount.official
        if (cleanTotal) {
          const matchingSets = new Set(
            (this.setsByOfficialCount.get(cleanTotal) || []).map(s => `${s.lang}:${s.setId}`)
          );
          const denomMatches = fetched.filter(c => {
            const langKey = c.edition === 'JP' ? 'ja' : 'fr';
            return matchingSets.has(`${langKey}:${c.setId}`) || (c.ref || '').endsWith(`/${cleanTotal}`) || (c.ref || '').endsWith(`/${total}`);
          });
          if (denomMatches.length > 0) return denomMatches;
        }
        return fetched.slice(0, 10);
      }

      // 4. Final fallback: return localId matches from global index if API returned none
      return CardIndex.lookupByLocalId(cleanNum).slice(0, 10);
    } catch (e) {
      console.warn('[CatalogService] TCGdex live localId lookup error:', e);
      return CardIndex.lookupByLocalId(cleanNum).slice(0, 10);
    }
  },

  async lookupCardBySerial(serial, setHint = null) {
    const matches = await this.lookupCardsBySerial(serial, setHint);
    return matches.length > 0 ? matches[0] : null;
  }
};

// Initialize CARDS dynamically (Zero Hardcoding)
let CARDS = (() => {
  const cached = StorageService.loadInitialCachedCards();
  if (cached && Array.isArray(cached) && cached.length > 0) {
    const list = cached.map(c => PriceService.enrichCard(c));
    CardIndex.build(list);
    return list;
  }
  return [];
})();

// ── COMPUTED HELPERS & ACTIVE PRICING ────────────────────────
function jpToEur(yen) {
  if (yen == null || isNaN(yen)) return null;
  return yen / state.rate;
}

function getActiveFrPrice(card, customConditionOrGrade = null) {
  if (!card) return null;
  let basePrice = card.frPrice;
  const ref = state.pricingRefFr || 'avg';

  if (PriceService.pricesJsonLoaded && PriceService.pricesJsonData?.prices) {
    const entry = PriceService.findPriceEntry(card);
    if (entry && entry.fr) {
      if (ref === 'ebay') basePrice = entry.fr.ebay_fr?.avg ?? entry.fr.ebay_fr?.median ?? basePrice;
      else if (ref === 'vinted') basePrice = entry.fr.vinted?.avg ?? basePrice;
      else if (ref === 'lbc') basePrice = entry.fr.lbc?.avg ?? basePrice;
      else basePrice = entry.fr.smoothed_avg != null ? entry.fr.smoothed_avg : basePrice;
    }
  }

  if (basePrice == null || isNaN(basePrice) || basePrice <= 0) {
    return null;
  }

  // Dynamic grade spread / condition resolution
  const { frMult } = resolveConditionMultiplier(customConditionOrGrade, card);
  return Math.round(basePrice * frMult * 10) / 10;
}

function getActiveJpPrice(card, customConditionOrGrade = null) {
  if (!card) return null;
  let basePrice = card.jpPrice;
  const ref = state.pricingRefJp || 'min';

  if (PriceService.pricesJsonLoaded && PriceService.pricesJsonData?.prices) {
    const entry = PriceService.findPriceEntry(card);
    if (entry && entry.jp) {
      if (ref === 'mercari') basePrice = entry.jp.mercari?.avg ?? entry.jp.mercari?.median ?? basePrice;
      else if (ref === 'yahoo') basePrice = entry.jp.yahoo_auctions?.avg ?? entry.jp.yahoo_auctions?.median ?? basePrice;
      else if (ref === 'cardrush') basePrice = entry.jp.card_rush?.avg ?? entry.jp.card_rush?.median ?? basePrice;
      else basePrice = entry.jp.min ?? entry.jp.smoothed_avg ?? basePrice;
    }
  }

  if (basePrice == null || isNaN(basePrice) || basePrice <= 0) {
    return null;
  }

  // Dynamic grade spread / condition resolution
  const { jpMult } = resolveConditionMultiplier(customConditionOrGrade, card);
  return Math.round(basePrice * jpMult);
}

function netMargin(card, customConditionOrGrade = null) {
  const fr = getActiveFrPrice(card, customConditionOrGrade);
  const jp = getActiveJpPrice(card, customConditionOrGrade);
  if (fr == null || jp == null) return null;
  const buyCost = jpToEur(jp) + 1.50;
  const sellNet = fr * (1 - state.fee);
  return sellNet - buyCost;
}

function netROI(card, customConditionOrGrade = null) {
  const fr = getActiveFrPrice(card, customConditionOrGrade);
  const jp = getActiveJpPrice(card, customConditionOrGrade);
  if (fr == null || jp == null) return null;
  const buyCost = jpToEur(jp) + 1.50;
  const margin = netMargin(card, customConditionOrGrade);
  return buyCost > 0 ? (margin / buyCost) * 100 : 0;
}

function velocityLabel(score) {
  if (score >= 9) return { text: '⚡ Quick Turnover (1-2j)', cls: 'badge-fast' };
  if (score >= 6) return { text: '⏱️ Turnover Moyen (4j)', cls: 'badge-medium' };
  return { text: '🐢 Turnover Lent (7j+)', cls: 'badge-slow' };
}

function editionBadge(card) {
  const c = COUNTRIES.find(x => x.code === card.edition) || { flag: '🌐', code: card.edition || 'JP' };
  return `<span class="edition-badge edition-badge-${(card.edition || 'jp').toLowerCase()}">${c.flag} Édition ${c.code}</span>`;
}

// ── FILTER MATCHING ──────────────────────────────────────────
function isFilterModeActive() {
  return state.focusCol !== null || (typeof window !== 'undefined' && window.innerWidth < 768);
}

function cardMatchesFilters(card) {
  // 1. Condition / Grading Filter
  if (state.condition?.mode === 'graded') {
    const nameLower = (card.name || '').toLowerCase();
    const subLower = (card.subName || '').toLowerCase();
    const isSpecial = nameLower.includes('sar') || nameLower.includes('ar') || nameLower.includes('alt') ||
                      nameLower.includes('secret') || nameLower.includes('vmax') || nameLower.includes('shiny') ||
                      subLower.includes('sar') || subLower.includes('ar');
    if (!isSpecial && (card.frPrice != null && card.frPrice < 25)) return false;
  }

  // 2. Country / Edition Filter (multi-select)
  if (state.filters.countries && state.filters.countries.length > 0) {
    if (!state.filters.countries.includes(card.edition)) {
      return false;
    }
  }

  // 3. Price Filter (min / max)
  const rawJp = getActiveJpPrice(card);
  if (rawJp !== null) {
    const buyPrice = state.filters.priceUnit === 'EUR' ? jpToEur(rawJp) : rawJp;
    if (state.filters.priceMin !== null && !isNaN(state.filters.priceMin)) {
      if (buyPrice < state.filters.priceMin) return false;
    }
    if (state.filters.priceMax !== null && !isNaN(state.filters.priceMax)) {
      if (buyPrice > state.filters.priceMax) return false;
    }
  } else if (state.filters.priceMin !== null || state.filters.priceMax !== null) {
    return false;
  }

  return true;
}

// ── SPARKLINE ────────────────────────────────────────────────
function buildSparkline(prices) {
  if (!prices || prices.length < 2) return '';
  const w = 50, h = 18, pad = 2;
  const min = Math.min(...prices), max = Math.max(...prices);
  const range = max - min || 1;
  const pts = prices.map((p, i) => {
    const x = pad + (i / (prices.length - 1)) * (w - 2 * pad);
    const y = h - pad - ((p - min) / range) * (h - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const trend = prices[prices.length - 1] >= prices[0] ? 'up' : 'down';
  return `<svg class="sparkline ${trend}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg"><polyline points="${pts}"/></svg>`;
}

// ── CARD TILE RENDERER ───────────────────────────────────────
function renderCardTile(card, rank) {
  const margin = netMargin(card);
  const roi = netROI(card);
  const jpActive = getActiveJpPrice(card);
  const frActive = getActiveFrPrice(card);
  const hasPrices = (margin !== null && roi !== null && jpActive !== null && frActive !== null);

  const rankClass = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
  const vel = velocityLabel(card.velocityScore || 6);
  const profitClass = hasPrices && margin >= 0 ? 'profit-positive' : 'profit-negative';
  const marginSign = hasPrices && margin >= 0 ? '+' : '';
  const hasSubName = card.subName && card.subName !== card.name;

  let condBadge = '';
  if (state.condition?.mode === 'graded') {
    const co = (state.condition.companies && state.condition.companies.length === 1 && state.condition.companies[0] !== 'ALL')
      ? state.condition.companies[0]
      : 'Slabs';
    let grText = '';
    if (state.condition.grades && state.condition.grades.length > 0) {
      const shortGrades = state.condition.grades.map(g => {
        const scale = GRADING_SCALES[co] || GRADING_SCALES.ALL;
        const entry = scale.find(s => s.grade === g);
        return entry ? entry.short : g.split(' ')[0];
      });
      grText = ' ' + shortGrades.join('/');
    }
    condBadge = `<span class="text-[9px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 rounded px-1.5 py-0.5">🛡️ ${co}${grText}</span>`;
  } else {
    const rawStr = state.condition?.rawConditions && state.condition.rawConditions.length > 0
      ? state.condition.rawConditions.join('/')
      : 'NM';
    condBadge = `<span class="text-[9px] font-bold bg-slate-100 text-slate-600 border border-slate-200 rounded px-1.5 py-0.5">📦 Raw ${rawStr}</span>`;
  }

  const pricingBlock = hasPrices ? `
    <div class="text-[10px] text-slate-600">JP: ¥${jpActive.toLocaleString('fr-FR')} (${(jpToEur(jpActive) || 0).toFixed(2)}€) → FR: ${frActive.toFixed(2)}€</div>
    <div class="flex items-center gap-1 mt-0.5">
      <span class="${profitClass} text-xs font-semibold">${marginSign}${margin.toFixed(2)}€</span>
      <span class="text-[10px] text-slate-400">|</span>
      <span class="${profitClass} text-xs font-semibold">${marginSign}${roi.toFixed(0)}%</span>
    </div>
  ` : `
    <div class="mt-1 flex items-center">
      <span class="price-pending-badge">
        <span class="price-pending-dot"></span>
        Prix non disponible / En cours d'actualisation
      </span>
    </div>
  `;

  return `
    <div class="card-tile fade-in" data-id="${card.id}">
      <div class="rank-badge ${rankClass}">#${rank}</div>
      <img class="card-tile-img" src="${card.image}" alt="${card.name}" loading="lazy"
           onerror="onCardImageError(this)">
      <div class="mt-1.5 px-0.5">
        <div class="text-xs font-semibold text-slate-900 leading-tight truncate">${card.name}</div>
        ${hasSubName ? `<div class="text-[10px] text-slate-400 font-normal truncate leading-tight mt-0.5">${card.subName}</div>` : ''}
        <div class="flex items-center gap-1 mt-0.5 mb-1 flex-wrap">
          <span class="text-[10px] text-slate-400">${card.ref}</span>
          ${editionBadge(card)}
          ${condBadge}
        </div>
        ${pricingBlock}
        ${hasPrices && card.priceHistory && card.priceHistory.length > 1 ? buildSparkline(card.priceHistory) : ''}
        <div class="flex items-center justify-between mt-1">
          <span class="text-[10px] text-slate-500">${hasPrices && card.salesPerMonth ? `${card.salesPerMonth} ventes/mois` : 'Catalogue TCGdex'}</span>
          ${hasPrices && card.velocityScore ? `<span class="${vel.cls}">${vel.text}</span>` : ''}
        </div>
      </div>
    </div>
  `;
}

// ── FAST O(N) PARTITIONED SORTED ARRAYS (SCALES TO 50,000+ CARDS) ──
function getSortedByMargin(filter = false) {
  const priced = [];
  const unpriced = [];
  for (let i = 0; i < CARDS.length; i++) {
    const c = CARDS[i];
    if (filter && !cardMatchesFilters(c)) continue;
    if (c.hasPrice) {
      const m = netMargin(c);
      if (m !== null) {
        priced.push({ card: c, val: m });
        continue;
      }
    }
    unpriced.push(c);
  }
  priced.sort((a, b) => b.val - a.val);
  return [...priced.map(x => x.card), ...unpriced];
}

function getSortedByROI(filter = false) {
  const priced = [];
  const unpriced = [];
  for (let i = 0; i < CARDS.length; i++) {
    const c = CARDS[i];
    if (filter && !cardMatchesFilters(c)) continue;
    if (c.hasPrice) {
      const r = netROI(c);
      if (r !== null) {
        priced.push({ card: c, val: r });
        continue;
      }
    }
    unpriced.push(c);
  }
  priced.sort((a, b) => b.val - a.val);
  return [...priced.map(x => x.card), ...unpriced];
}

function getSortedByVelocity(filter = false) {
  const priced = [];
  const unpriced = [];
  for (let i = 0; i < CARDS.length; i++) {
    const c = CARDS[i];
    if (filter && !cardMatchesFilters(c)) continue;
    if (c.hasPrice) {
      const r = netROI(c);
      if (r !== null) {
        priced.push({ card: c, vel: c.velocityScore || 0, roi: r });
        continue;
      }
    }
    unpriced.push(c);
  }
  priced.sort((a, b) => (b.vel !== a.vel ? b.vel - a.vel : b.roi - a.roi));
  return [...priced.map(x => x.card), ...unpriced];
}

function getCardsForTab(tabKey, filter = isFilterModeActive()) {
  if (tabKey === 'margin') return getSortedByMargin(filter);
  if (tabKey === 'roi') return getSortedByROI(filter);
  if (tabKey === 'velocity') return getSortedByVelocity(filter);
  return getSortedByMargin(filter);
}

// ── COLUMN COUNTERS ──────────────────────────────────────────
function updateColumnCounters() {
  const isFocusMargin = state.focusCol === 'margin';
  const isFocusRoi = state.focusCol === 'roi';
  const isFocusVel = state.focusCol === 'velocity';

  const mCards = getSortedByMargin(isFilterModeActive() || isFocusMargin);
  const rCards = getSortedByROI(isFilterModeActive() || isFocusRoi);
  const vCards = getSortedByVelocity(isFilterModeActive() || isFocusVel);

  const cm = document.getElementById('counter-margin');
  const cr = document.getElementById('counter-roi');
  const cv = document.getElementById('counter-velocity');

  if (cm) cm.textContent = `${mCards.length}`;
  if (cr) cr.textContent = `${rCards.length}`;
  if (cv) cv.textContent = `${vCards.length}`;

  const matchEl = document.getElementById('filter-match-count');
  if (matchEl) {
    const totalMatching = CARDS.filter(cardMatchesFilters).length;
    matchEl.textContent = `${totalMatching} carte${totalMatching > 1 ? 's' : ''} trouvée${totalMatching > 1 ? 's' : ''}`;
  }

  updatePurchaseBadge();
}

// ── COLUMN RENDERER (DESKTOP) ────────────────────────────────
function renderColumn(colId, sortedCards, countKey) {
  const col = document.getElementById(colId);
  if (!col) return;
  if (sortedCards.length === 0) {
    if (state.isLoadingCatalog) {
      col.innerHTML = `
        <div class="col-span-full py-12 text-center text-sm text-slate-500 bg-slate-50/80 rounded-2xl border border-dashed border-slate-200">
          <div class="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2.5"></div>
          <p class="font-bold text-slate-700">Chargement du catalogue TCGdex...</p>
          <p class="text-xs text-slate-400 mt-1">Récupération des séries officielles en direct.</p>
        </div>
      `;
      return;
    }
    col.innerHTML = `
      <div class="col-span-full py-8 text-center text-sm text-slate-500 bg-slate-50 rounded-xl border border-dashed border-slate-200">
        <p class="font-semibold text-slate-700">Aucune carte trouvée</p>
        <p class="text-xs text-slate-400 mt-1">Modifiez vos critères ou réinitialisez les filtres.</p>
      </div>
    `;
    return;
  }
  const visible = sortedCards.slice(0, state.visibleCount[countKey]);
  col.innerHTML = visible.map((card, i) => renderCardTile(card, i + 1)).join('');
  col.querySelectorAll('.card-tile').forEach(tile => {
    tile.addEventListener('click', () => openCardDetail(tile.dataset.id));
  });

  if (state.focusCol && col.dataset.col === state.focusCol) {
    col.className = 'focus-col-inner';
  } else {
    col.className = 'flex flex-col gap-2';
  }
}

// ── COLUMN RENDERER (MOBILE) ─────────────────────────────────
function renderMobileColumn() {
  const container = document.getElementById('mobile-col-content');
  if (!container) return;
  const currentTab = state.activeMobileTab || 'margin';

  document.querySelectorAll('.mobile-tab').forEach(btn => {
    if (btn.dataset.tab === currentTab) {
      btn.classList.add('mobile-tab-active');
    } else {
      btn.classList.remove('mobile-tab-active');
    }
  });

  const cards = getCardsForTab(currentTab, isFilterModeActive());
  if (cards.length === 0) {
    if (state.isLoadingCatalog) {
      container.innerHTML = `
        <div class="col-span-2 py-12 text-center text-sm text-slate-500 bg-slate-50/80 rounded-2xl border border-dashed border-slate-200 w-full">
          <div class="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2.5"></div>
          <p class="font-bold text-slate-700">Chargement du catalogue TCGdex...</p>
          <p class="text-xs text-slate-400 mt-1">Récupération des séries officielles en direct.</p>
        </div>
      `;
      updateMobileLoadMoreLabel();
      return;
    }
    container.innerHTML = `
      <div class="col-span-2 py-8 text-center text-sm text-slate-500 bg-slate-50 rounded-xl border border-dashed border-slate-200 w-full">
        <p class="font-semibold text-slate-700">Aucune carte trouvée</p>
        <p class="text-xs text-slate-400 mt-1">Modifiez vos critères ou réinitialisez les filtres.</p>
      </div>
    `;
    updateMobileLoadMoreLabel();
    return;
  }

  const count = state.visibleCount[currentTab] || 25;
  const visible = cards.slice(0, count);

  container.innerHTML = visible.map((card, i) => renderCardTile(card, i + 1)).join('');
  container.querySelectorAll('.card-tile').forEach(tile => {
    tile.addEventListener('click', () => openCardDetail(tile.dataset.id));
  });

  updateMobileLoadMoreLabel();
}

function updateMobileLoadMoreLabel() {
  const btn = document.getElementById('mobile-load-more');
  if (!btn) return;
  const currentTab = state.activeMobileTab || 'margin';
  const cards = getCardsForTab(currentTab, isFilterModeActive());
  const count = state.visibleCount[currentTab] || 25;
  const shown = Math.min(count, cards.length);
  const next = nextPageStep(shown, cards.length);

  if (shown >= cards.length) {
    btn.style.display = 'none';
  } else {
    btn.style.display = '';
    btn.textContent = `Afficher plus (${shown} / ${next})`;
  }
}

function renderAllColumns() {
  if (state.focusCol) {
    const colMap = { margin: getSortedByMargin, roi: getSortedByROI, velocity: getSortedByVelocity };
    renderColumn(`col-${state.focusCol}`, colMap[state.focusCol](true), state.focusCol);
  } else {
    renderColumn('col-margin', getSortedByMargin(false), 'margin');
    renderColumn('col-roi', getSortedByROI(false), 'roi');
    renderColumn('col-velocity', getSortedByVelocity(false), 'velocity');
  }
  updateLoadMoreLabels();
  renderMobileColumn();
  updateFilterMatchCount();
  updateColumnCounters();
}

function updateLoadMoreLabels() {
  const colDefs = [
    { btnId: 'load-more-margin', countKey: 'margin', cards: getSortedByMargin(state.focusCol === 'margin') },
    { btnId: 'load-more-roi',    countKey: 'roi',    cards: getSortedByROI(state.focusCol === 'roi') },
    { btnId: 'load-more-velocity', countKey: 'velocity', cards: getSortedByVelocity(state.focusCol === 'velocity') }
  ];
  colDefs.forEach(({ btnId, countKey, cards }) => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    const shown = Math.min(state.visibleCount[countKey], cards.length);
    const next  = nextPageStep(shown, cards.length);
    if (shown >= cards.length) {
      btn.style.display = 'none';
    } else {
      btn.style.display = '';
      btn.textContent = `Afficher plus (${shown} / ${next})`;
    }
  });
}

// ── POPOVER HELPERS ──────────────────────────────────────────
function updateCountryTriggerLabel() {
  const label = document.getElementById('label-filter-country');
  const btn = document.getElementById('btn-filter-country');
  if (!label || !btn) return;

  if (!state.filters.countries || state.filters.countries.length === 0) {
    label.textContent = '🌐 Édition pays : ————';
    btn.classList.remove('active');
  } else {
    btn.classList.add('active');
    const flags = state.filters.countries.map(code => {
      const c = COUNTRIES.find(x => x.code === code);
      return `${c ? c.flag : '🌐'} ${code}`;
    }).join(', ');
    label.textContent = `🌐 Édition : ${flags}`;
  }
}

function updatePriceTriggerLabel() {
  const label = document.getElementById('label-filter-price');
  const btn = document.getElementById('btn-filter-price');
  if (!label || !btn) return;

  const unit = state.filters.priceUnit === 'EUR' ? '€' : '¥';
  const min = state.filters.priceMin;
  const max = state.filters.priceMax;

  if (min === null && max === null) {
    label.textContent = `💰 Prix : Min — | Max — ${unit}`;
    btn.classList.remove('active');
  } else {
    btn.classList.add('active');
    if (min !== null && max !== null) {
      label.textContent = `💰 Prix : ${min.toLocaleString('fr-FR')} — ${max.toLocaleString('fr-FR')} ${unit}`;
    } else if (min !== null && max === null) {
      label.textContent = `💰 Prix : ${min.toLocaleString('fr-FR')} ${unit} +`;
    } else if (min === null && max !== null) {
      label.textContent = `💰 Prix : ≤ ${max.toLocaleString('fr-FR')} ${unit}`;
    }
  }
}

function renderCountryOptionsList(searchQuery = '') {
  const container = document.getElementById('country-options-list');
  if (!container) return;

  const q = searchQuery.trim().toLowerCase();
  const filtered = COUNTRIES.filter(c => {
    if (!q) return true;
    return c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q);
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div class="p-3 text-center text-xs text-slate-400">Aucun pays trouvé</div>`;
    return;
  }

  container.innerHTML = filtered.map(c => {
    const isSelected = state.filters.countries.includes(c.code);
    return `
      <div class="country-option-item ${isSelected ? 'selected' : ''}" data-country-code="${c.code}">
        <span class="flex items-center gap-2">
          <span class="text-base leading-none">${c.flag}</span>
          <span>${c.name} (${c.code})</span>
        </span>
        <span class="text-xs ${isSelected ? 'text-blue-600 font-bold' : 'text-slate-300'}">
          ${isSelected ? '✓' : ''}
        </span>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.country-option-item').forEach(el => {
    el.addEventListener('click', () => {
      const code = el.dataset.countryCode;
      if (!code) return;
      const idx = state.filters.countries.indexOf(code);
      if (idx > -1) {
        state.filters.countries.splice(idx, 1);
      } else {
        state.filters.countries.push(code);
      }
      updateCountryTriggerLabel();
      renderCountryOptionsList(document.getElementById('input-search-country')?.value || '');
      applyFilters();
    });
  });
}

function renderPricePresets() {
  const container = document.getElementById('price-presets-container');
  if (!container) return;

  const presets = state.filters.priceUnit === 'EUR' ? PRICE_PRESETS_EUR : PRICE_PRESETS_JPY;
  const currentMin = state.filters.priceMin;
  const currentMax = state.filters.priceMax;

  container.innerHTML = presets.map((p, idx) => {
    const isActive = currentMin === p.min && currentMax === p.max;
    return `
      <button type="button" class="price-preset-btn ${isActive ? 'active' : ''}" data-preset-idx="${idx}">
        ${p.label}
      </button>
    `;
  }).join('');

  container.querySelectorAll('.price-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.presetIdx, 10);
      const preset = presets[idx];
      if (!preset) return;

      state.filters.priceMin = preset.min;
      state.filters.priceMax = preset.max;

      const minInput = document.getElementById('input-price-min');
      const maxInput = document.getElementById('input-price-max');
      if (minInput) minInput.value = preset.min !== null ? preset.min : '';
      if (maxInput) maxInput.value = preset.max !== null ? preset.max : '';

      updatePriceTriggerLabel();
      renderPricePresets();
      applyFilters();
    });
  });
}

// ── CASCADING CONDITION & GRADING POPOVER LOGIC ─────────────
function getConditionFilterLabel() {
  if (!state.condition || state.condition.mode === 'raw') {
    const raw = state.condition?.rawConditions || ['NM'];
    if (raw.length === 4) return '💎 État : Non-gradé (Tous)';
    if (raw.length === 1 && raw[0] === 'NM') return '💎 État : Non-gradé (NM)';
    return `💎 État : Non-gradé (${raw.join(', ')})`;
  } else {
    // Graded mode
    const companies = state.condition.companies || ['ALL'];
    const grades = state.condition.grades || [];
    const coName = (companies.length === 1 && companies[0] !== 'ALL') ? companies[0] : (companies.includes('ALL') ? 'Slabs' : companies.join('/'));

    if (grades.length === 0) {
      if (coName === 'Slabs') return '🛡️ État : Gradée (Toutes)';
      return `🛡️ État : ${coName} (Tous grades)`;
    }

    // Clean grade names for label (e.g. "9.5 (Gem Mint)" -> "9.5", "10 (Gem Mint)" -> "10", keep "10 Black Label", "10 Pristine", "10+", etc.)
    const cleanGrades = grades.map(g => {
      let clean = g;
      if (clean.includes('(Gem Mint)')) clean = clean.replace('(Gem Mint)', '').trim();
      else if (clean.includes('(Mint+)')) clean = clean.replace('(Mint+)', '').trim();
      else if (clean.includes('(Mint)')) clean = clean.replace('(Mint)', '').trim();
      else if (clean.includes('(NM-MT)')) clean = clean.replace('(NM-MT)', '').trim();
      else if (clean.includes('(Collector)')) clean = clean.replace('(Collector)', '').trim();
      else if (clean.includes('(Neuf Sup)')) clean = clean.replace('(Neuf Sup)', '').trim();
      else if (clean.includes('(Neuf)')) clean = clean.replace('(Neuf)', '').trim();
      else if (clean.includes('(Très Bon)')) clean = clean.replace('(Très Bon)', '').trim();
      return clean;
    });

    return `🛡️ État : ${coName} ${cleanGrades.join(', ')}`;
  }
}

function updateConditionTriggerLabels() {
  const lbl = getConditionFilterLabel();
  const mainLabel = document.getElementById('label-filter-condition');
  const mainBtn = document.getElementById('btn-filter-condition');
  const libLabel = document.getElementById('label-lib-filter-condition');
  const libBtn = document.getElementById('btn-lib-filter-condition');

  const isActive = state.condition?.mode === 'graded' || (state.condition?.mode === 'raw' && (state.condition?.rawConditions?.length !== 1 || state.condition?.rawConditions?.[0] !== 'NM'));

  if (mainLabel) mainLabel.textContent = lbl;
  if (mainBtn) mainBtn.classList.toggle('active', isActive);
  if (libLabel) libLabel.textContent = lbl;
  if (libBtn) libBtn.classList.toggle('active', isActive);
}

// Backward-compatibility alias
function updateConditionTriggerLabel() {
  updateConditionTriggerLabels();
}

function getConditionPopoverHtml() {
  const isRaw = !state.condition || state.condition.mode === 'raw';
  const companies = state.condition?.companies || ['ALL'];
  const grades = state.condition?.grades || [];
  const rawConds = state.condition?.rawConditions || ['NM'];

  // Identify active company for grade scale: if single specific company, use it; else ALL
  const activeCompany = (companies.length === 1 && companies[0] !== 'ALL') ? companies[0] : 'ALL';
  const currentScale = GRADING_SCALES[activeCompany] || GRADING_SCALES.ALL;

  // Company options: Toutes, PSA, BGS, CGC, PCA, ARS
  const companyOptions = [
    { key: 'ALL', label: 'Toutes' },
    { key: 'PSA', label: 'PSA' },
    { key: 'BGS', label: 'BGS' },
    { key: 'CGC', label: 'CGC' },
    { key: 'PCA', label: 'PCA' },
    { key: 'ARS', label: 'ARS' }
  ];

  // Calculate current effective multipliers for live preview in popover
  const { frMult, jpMult } = resolveConditionMultiplier();

  return `
    <div class="cascading-condition-popover">
      <!-- Mode Tabs (Tab A: Raw vs Tab B: Graded) -->
      <div class="flex p-1 bg-slate-100 rounded-xl mb-3 gap-1">
        <button type="button" class="cascading-mode-btn flex-1 ${isRaw ? 'active' : ''}" data-popover-tab="raw">
          <i data-lucide="package" style="width:13px;height:13px;"></i>
          <span>Non-gradé (Raw)</span>
        </button>
        <button type="button" class="cascading-mode-btn flex-1 ${!isRaw ? 'active' : ''}" data-popover-tab="graded">
          <i data-lucide="shield" style="width:13px;height:13px;"></i>
          <span>Gradée (Slabs)</span>
        </button>
      </div>

      ${isRaw ? `
        <!-- TAB A: RAW CONDITIONS (Multi-select) -->
        <div class="mb-3">
          <div class="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5 flex items-center justify-between">
            <span>État physique (Raw)</span>
            <span class="text-[10px] text-blue-600 font-semibold">Multi-sélection</span>
          </div>
          <div class="grid grid-cols-2 gap-2">
            ${RAW_CONDITIONS.map(rc => {
              const active = rawConds.includes(rc.key);
              return `
                <button type="button" class="condition-chip ${active ? 'active' : ''}" data-raw-cond="${rc.key}">
                  <div class="flex items-center justify-between">
                    <span class="font-bold text-xs">${rc.key}</span>
                    <span class="text-[10px] font-mono opacity-80">x${rc.multiplier.toFixed(2)}</span>
                  </div>
                  <div class="text-[10px] text-left opacity-75 truncate">${rc.sub}</div>
                </button>
              `;
            }).join('')}
          </div>
        </div>
      ` : `
        <!-- TAB B: GRADED SLABS -->
        <div class="space-y-3 mb-3">
          <!-- Row 1: Entreprise de gradation -->
          <div>
            <div class="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5 flex items-center justify-between">
              <span>1. Entreprise de gradation</span>
              <span class="text-[10px] text-indigo-600 font-semibold">${activeCompany === 'ALL' ? 'Toutes entreprises' : activeCompany}</span>
            </div>
            <div class="flex flex-wrap gap-1.5">
              ${companyOptions.map(co => {
                const active = companies.includes(co.key);
                return `
                  <button type="button" class="company-chip ${active ? 'active' : ''}" data-popover-company="${co.key}">
                    ${co.label}
                  </button>
                `;
              }).join('')}
            </div>
          </div>

          <!-- Row 2: Note (Grade) - Dynamically adapted to active company -->
          <div>
            <div class="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5 flex items-center justify-between">
              <span>2. Note (Grade)</span>
              <span class="text-[10px] text-indigo-600 font-semibold">Échelle ${activeCompany}</span>
            </div>
            <div class="flex flex-wrap gap-1.5">
              ${currentScale.map(g => {
                const active = grades.includes(g.grade);
                return `
                  <button type="button" class="grade-chip ${active ? 'active' : ''}" data-popover-grade="${g.grade}">
                    <span>${g.grade}</span>
                    <span class="text-[9px] font-mono opacity-75 ml-1">x${g.frMult.toFixed(2)}</span>
                  </button>
                `;
              }).join('')}
            </div>
          </div>
        </div>
      `}

      <!-- Bottom Bar: Multiplier Indicator & Reset -->
      <div class="pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px]">
        <div class="text-slate-500 flex items-center gap-1 font-medium">
          <span>⚡ Impact :</span>
          <span class="font-bold text-slate-800">x${frMult.toFixed(2)} FR</span>
          <span>/</span>
          <span class="font-bold text-slate-800">x${jpMult.toFixed(2)} JP</span>
        </div>
        <button type="button" class="text-blue-600 hover:text-blue-800 font-semibold cursor-pointer text-xs" data-popover-reset>
          Réinitialiser
        </button>
      </div>
    </div>
  `;
}

function attachPopoverEvents(popoverEl) {
  if (!popoverEl) return;

  // Mode tabs
  popoverEl.querySelectorAll('[data-popover-tab]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tab = btn.dataset.popoverTab;
      state.condition.mode = tab;
      if (tab === 'raw' && (!state.condition.rawConditions || state.condition.rawConditions.length === 0)) {
        state.condition.rawConditions = ['NM'];
      }
      if (tab === 'graded' && (!state.condition.companies || state.condition.companies.length === 0)) {
        state.condition.companies = ['ALL'];
      }
      state.conditionFilter = tab === 'raw' ? (state.condition.rawConditions.length === 4 ? 'raw_all' : 'raw_nm') : 'graded';
      renderConditionPopovers();
      updateConditionTriggerLabels();
      applyFilters();
      if (document.getElementById('modal-library')?.classList.contains('open')) {
        renderLibrary();
      }
    });
  });

  // Raw conditions
  popoverEl.querySelectorAll('[data-raw-cond]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const cond = btn.dataset.rawCond;
      let arr = [...(state.condition.rawConditions || ['NM'])];
      if (arr.includes(cond)) {
        if (arr.length > 1) {
          arr = arr.filter(c => c !== cond);
        }
      } else {
        arr.push(cond);
      }
      state.condition.rawConditions = arr;
      state.conditionFilter = arr.length === 4 ? 'raw_all' : (arr.length === 1 && arr[0] === 'NM' ? 'raw_nm' : 'raw_custom');
      renderConditionPopovers();
      updateConditionTriggerLabels();
      applyFilters();
      if (document.getElementById('modal-library')?.classList.contains('open')) {
        renderLibrary();
      }
    });
  });

  // Companies (Row 1)
  popoverEl.querySelectorAll('[data-popover-company]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const coKey = btn.dataset.popoverCompany;
      if (coKey === 'ALL') {
        state.condition.companies = ['ALL'];
      } else {
        state.condition.companies = [coKey];
      }

      // Filter previously selected grades to only keep ones existing in new scale
      const scale = (state.condition.companies.length === 1 && state.condition.companies[0] !== 'ALL')
        ? GRADING_SCALES[state.condition.companies[0]]
        : GRADING_SCALES.ALL;
      const validGrades = scale.map(g => g.grade);
      state.condition.grades = (state.condition.grades || []).filter(g => validGrades.includes(g));

      renderConditionPopovers();
      updateConditionTriggerLabels();
      applyFilters();
      if (document.getElementById('modal-library')?.classList.contains('open')) {
        renderLibrary();
      }
    });
  });

  // Grades (Row 2)
  popoverEl.querySelectorAll('[data-popover-grade]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const grade = btn.dataset.popoverGrade;
      let grades = [...(state.condition.grades || [])];
      if (grades.includes(grade)) {
        grades = grades.filter(g => g !== grade);
      } else {
        grades.push(grade);
      }
      state.condition.grades = grades;
      renderConditionPopovers();
      updateConditionTriggerLabels();
      applyFilters();
      if (document.getElementById('modal-library')?.classList.contains('open')) {
        renderLibrary();
      }
    });
  });

  // Reset
  popoverEl.querySelectorAll('[data-popover-reset]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.condition = {
        mode: 'raw',
        rawConditions: ['NM'],
        companies: ['ALL'],
        grades: []
      };
      state.conditionFilter = 'raw_nm';
      renderConditionPopovers();
      updateConditionTriggerLabels();
      applyFilters();
      if (document.getElementById('modal-library')?.classList.contains('open')) {
        renderLibrary();
      }
      showToast('Filtre état réinitialisé (Non-gradé NM)');
    });
  });

  popoverEl.addEventListener('click', (e) => {
    e.stopPropagation();
  });
}

function renderConditionPopovers() {
  const mainPopover = document.getElementById('popover-filter-condition');
  const libPopover = document.getElementById('popover-lib-filter-condition');
  const html = getConditionPopoverHtml();

  if (mainPopover) {
    mainPopover.innerHTML = html;
    attachPopoverEvents(mainPopover);
  }
  if (libPopover) {
    libPopover.innerHTML = html;
    attachPopoverEvents(libPopover);
  }

  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
}

function toggleConditionPopover(source = 'main') {
  const isMain = source === 'main';
  const targetPopover = document.getElementById(isMain ? 'popover-filter-condition' : 'popover-lib-filter-condition');
  const targetBtn = document.getElementById(isMain ? 'btn-filter-condition' : 'btn-lib-filter-condition');
  const otherPopover = document.getElementById(isMain ? 'popover-lib-filter-condition' : 'popover-filter-condition');
  const otherBtn = document.getElementById(isMain ? 'btn-lib-filter-condition' : 'btn-filter-condition');

  if (otherPopover) otherPopover.classList.add('hidden');
  if (otherBtn) otherBtn.classList.remove('open');

  const countryPopover = document.getElementById('popover-filter-country');
  const countryBtn = document.getElementById('btn-filter-country');
  const pricePopover = document.getElementById('popover-filter-price');
  const priceBtn = document.getElementById('btn-filter-price');
  if (countryPopover) countryPopover.classList.add('hidden');
  if (countryBtn) countryBtn.classList.remove('open');
  if (pricePopover) pricePopover.classList.add('hidden');
  if (priceBtn) priceBtn.classList.remove('open');

  if (targetPopover) {
    const isHidden = targetPopover.classList.contains('hidden');
    if (isHidden) {
      renderConditionPopovers();
      targetPopover.classList.remove('hidden');
      if (targetBtn) targetBtn.classList.add('open');
    } else {
      targetPopover.classList.add('hidden');
      if (targetBtn) targetBtn.classList.remove('open');
    }
  }
}

function togglePopover(name) {
  const countryPopover = document.getElementById('popover-filter-country');
  const countryBtn = document.getElementById('btn-filter-country');
  const pricePopover = document.getElementById('popover-filter-price');
  const priceBtn = document.getElementById('btn-filter-price');
  const condPopover = document.getElementById('popover-filter-condition');
  const condBtn = document.getElementById('btn-filter-condition');
  const libCondPopover = document.getElementById('popover-lib-filter-condition');
  const libCondBtn = document.getElementById('btn-lib-filter-condition');

  if (name === 'country') {
    if (pricePopover) pricePopover.classList.add('hidden');
    if (priceBtn) priceBtn.classList.remove('open');
    if (condPopover) condPopover.classList.add('hidden');
    if (condBtn) condBtn.classList.remove('open');
    if (libCondPopover) libCondPopover.classList.add('hidden');
    if (libCondBtn) libCondBtn.classList.remove('open');

    if (countryPopover) {
      const willOpen = countryPopover.classList.contains('hidden');
      if (willOpen) {
        renderCountryOptionsList(document.getElementById('input-search-country')?.value || '');
        countryPopover.classList.remove('hidden');
        if (countryBtn) countryBtn.classList.add('open');
      } else {
        countryPopover.classList.add('hidden');
        if (countryBtn) countryBtn.classList.remove('open');
      }
    }
  } else if (name === 'price') {
    if (countryPopover) countryPopover.classList.add('hidden');
    if (countryBtn) countryBtn.classList.remove('open');
    if (condPopover) condPopover.classList.add('hidden');
    if (condBtn) condBtn.classList.remove('open');
    if (libCondPopover) libCondPopover.classList.add('hidden');
    if (libCondBtn) libCondBtn.classList.remove('open');

    if (pricePopover) {
      const willOpen = pricePopover.classList.contains('hidden');
      if (willOpen) {
        renderPricePresets();
        pricePopover.classList.remove('hidden');
        if (priceBtn) priceBtn.classList.add('open');
      } else {
        pricePopover.classList.add('hidden');
        if (priceBtn) priceBtn.classList.remove('open');
      }
    }
  } else if (name === 'condition') {
    toggleConditionPopover('main');
  }
}

function closeAllPopovers() {
  const countryPopover = document.getElementById('popover-filter-country');
  const countryBtn = document.getElementById('btn-filter-country');
  const pricePopover = document.getElementById('popover-filter-price');
  const priceBtn = document.getElementById('btn-filter-price');
  const condPopover = document.getElementById('popover-filter-condition');
  const condBtn = document.getElementById('btn-filter-condition');
  const libCondPopover = document.getElementById('popover-lib-filter-condition');
  const libCondBtn = document.getElementById('btn-lib-filter-condition');

  if (countryPopover) countryPopover.classList.add('hidden');
  if (countryBtn) countryBtn.classList.remove('open');
  if (pricePopover) pricePopover.classList.add('hidden');
  if (priceBtn) priceBtn.classList.remove('open');
  if (condPopover) condPopover.classList.add('hidden');
  if (condBtn) condBtn.classList.remove('open');
  if (libCondPopover) libCondPopover.classList.add('hidden');
  if (libCondBtn) libCondBtn.classList.remove('open');
}

// ── FILTER BAR PLACEMENT & SYNC ──────────────────────────────
function syncFilterBarPlacement() {
  const filterBar = document.getElementById('focus-filter-bar');
  if (!filterBar) return;

  if (typeof window !== 'undefined' && window.innerWidth < 768) {
    const mobilePanel = document.getElementById('mobile-col-panel');
    if (mobilePanel && filterBar.parentElement !== mobilePanel) {
      mobilePanel.insertAdjacentElement('afterbegin', filterBar);
    }
    filterBar.classList.remove('hidden');
  } else {
    if (state.focusCol) {
      const header = document.getElementById(`col-header-${state.focusCol}`);
      if (header) {
        header.insertAdjacentElement('afterend', filterBar);
        filterBar.classList.remove('hidden');
      }
    } else {
      const columnsGrid = document.getElementById('columns-grid');
      if (columnsGrid) {
        columnsGrid.insertAdjacentElement('beforebegin', filterBar);
      }
      filterBar.classList.add('hidden');
    }
  }
  updateFilterMatchCount();
  updateCountryTriggerLabel();
  updatePriceTriggerLabel();
  updateConditionTriggerLabels();
  updateColumnCounters();
}

function updateFilterMatchCount() {
  const countEl = document.getElementById('filter-match-count');
  if (!countEl) return;
  let activeTab = 'margin';
  if (typeof window !== 'undefined' && window.innerWidth < 768) {
    activeTab = state.activeMobileTab || 'margin';
  } else if (state.focusCol) {
    activeTab = state.focusCol;
  }
  const matching = getCardsForTab(activeTab, true);
  const count = matching.length;
  countEl.textContent = `${count} carte${count > 1 ? 's' : ''} trouvée${count > 1 ? 's' : ''}`;
}

function applyFilters() {
  updateFilterMatchCount();
  updateCountryTriggerLabel();
  updatePriceTriggerLabel();
  updateConditionTriggerLabels();
  renderAllColumns();
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ── TIMESTAMP ────────────────────────────────────────────────
function updateTimestamp() {
  const now = new Date();
  const hh = now.getHours().toString().padStart(2, '0');
  const mm = now.getMinutes().toString().padStart(2, '0');
  const el = document.getElementById('last-update');
  if (el) el.textContent = `Aujourd'hui, ${hh}:${mm}`;
}

// ── TOAST ────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'fixed bottom-4 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-sm px-4 py-2 rounded-full shadow-lg z-[200] fade-in pointer-events-none';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

// ── LIVE RATE FETCH ──────────────────────────────────────────
async function fetchLiveRate() {
  const liveRateEl = document.getElementById('live-rate');
  const indicator = document.getElementById('live-indicator');
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/EUR');
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    const rate = data && data.rates && data.rates.JPY ? data.rates.JPY : 163.5;
    state.rate = rate;
    if (liveRateEl) liveRateEl.textContent = rate.toFixed(2);
    if (indicator) {
      indicator.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block"></span> Live`;
      indicator.className = 'inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-1.5 py-0.5 flex-shrink-0';
    }
  } catch (e) {
    try {
      const res2 = await fetch('https://api.frankfurter.app/latest?from=EUR&to=JPY');
      const data2 = await res2.json();
      const rate2 = data2.rates && data2.rates.JPY ? data2.rates.JPY : 163.5;
      state.rate = rate2;
      if (liveRateEl) liveRateEl.textContent = rate2.toFixed(2);
      if (indicator) {
        indicator.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block"></span> Live`;
        indicator.className = 'inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-1.5 py-0.5 flex-shrink-0';
      }
    } catch (e2) {
      state.rate = 163.5;
      if (liveRateEl) liveRateEl.textContent = state.rate.toFixed(2);
      if (indicator) {
        indicator.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block"></span> Hors-ligne`;
        indicator.className = 'inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5 flex-shrink-0';
      }
    }
  }
  renderAllColumns();
  updateTimestamp();
}

// ── MODAL SYSTEM ─────────────────────────────────────────────
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

// ── LIVE GLOBAL SEARCH HOOK ──────────────────────────────────
let searchDebounceTimer = null;
let currentSearchAbort = null;

function renderSearchDropdown(matches, isSearchingLive = false) {
  const dropdown = document.getElementById('search-dropdown');
  if (!dropdown) return;

  if (matches.length === 0) {
    if (isSearchingLive) {
      dropdown.innerHTML = `
        <div class="p-3 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
          <span class="w-2 h-2 rounded-full bg-blue-500 animate-ping"></span>
          <span>Recherche mondiale TCGdex…</span>
        </div>
      `;
      dropdown.classList.remove('hidden');
    } else {
      dropdown.innerHTML = `
        <div class="p-3 text-center text-xs text-slate-400">
          Aucune carte trouvée pour "${state.searchQuery}"
        </div>
      `;
      dropdown.classList.remove('hidden');
    }
    return;
  }

  const itemsHtml = matches.map(card => {
    const hasSubName = card.subName && card.subName !== card.name;
    const jpActive = getActiveJpPrice(card);
    const frActive = getActiveFrPrice(card);
    return `
      <div class="search-result-item" data-id="${card.id}">
        <img src="${card.image}" alt="${card.name}"
             onerror="onCardImageError(this)">
        <div class="flex-1 min-w-0">
          <div class="search-result-name truncate">${card.name}</div>
          ${hasSubName ? `<div class="text-[10px] text-slate-400 truncate leading-tight">${card.subName}</div>` : ''}
          <div class="search-result-ref flex items-center gap-1.5 flex-wrap mt-0.5">
            <span>${card.ref}</span>
            <span>·</span>
            <span>JP ¥${jpActive.toLocaleString('fr-FR')} → FR ${frActive.toFixed(2)}€</span>
            ${editionBadge(card)}
          </div>
        </div>
      </div>
    `;
  }).join('');

  const footerHtml = isSearchingLive
    ? `<div class="px-3 py-1.5 bg-slate-50 border-t border-slate-100 text-[10px] text-slate-400 flex items-center justify-between">
         <span>Recherche en cours dans la base mondiale…</span>
         <span class="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
       </div>`
    : `<div class="px-3 py-1 bg-slate-50 border-t border-slate-100 text-[10px] text-slate-400 text-right">
         Base officielle TCGdex multi-langues
       </div>`;

  dropdown.innerHTML = itemsHtml + footerHtml;
  dropdown.classList.remove('hidden');

  dropdown.querySelectorAll('.search-result-item').forEach(item => {
    item.addEventListener('click', () => {
      openCardDetail(item.dataset.id);
      dropdown.classList.add('hidden');
      const input = document.getElementById('search-input');
      if (input) input.value = '';
    });
  });
}

function handleSearch(query) {
  state.searchQuery = query.trim().toLowerCase();
  const dropdown = document.getElementById('search-dropdown');
  if (!dropdown) return;

  if (!state.searchQuery) {
    dropdown.classList.add('hidden');
    dropdown.innerHTML = '';
    return;
  }

  const localMatches = CARDS.filter(c =>
    (c.name && c.name.toLowerCase().includes(state.searchQuery)) ||
    (c.subName && c.subName.toLowerCase().includes(state.searchQuery)) ||
    (c.ref && c.ref.toLowerCase().includes(state.searchQuery)) ||
    (c.localId && c.localId.toLowerCase() === state.searchQuery)
  ).slice(0, 8);

  renderSearchDropdown(localMatches, state.searchQuery.length >= 2);

  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  if (currentSearchAbort) {
    currentSearchAbort.abort();
    currentSearchAbort = null;
  }

  if (state.searchQuery.length < 2) return;

  searchDebounceTimer = setTimeout(async () => {
    try {
      const abortCtrl = new AbortController();
      currentSearchAbort = abortCtrl;

      const liveApiCards = await CatalogService.searchLive(query);

      const seen = new Set();
      const merged = [];

      for (const card of [...localMatches, ...liveApiCards]) {
        if (!seen.has(card.id)) {
          seen.add(card.id);
          merged.push(card);
          if (!CARDS.some(c => c.id === card.id)) {
            CARDS.push(card);
          }
        }
      }

      renderSearchDropdown(merged.slice(0, 10), false);
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.warn('Live search error:', e);
      }
    }
  }, 280);
}

// ── UPGRADED CARD DETAIL MODAL (RAW VS GRADED SLABS + DUAL CHARTS) ─
let detailModalState = {
  cardId: null,
  mode: 'raw',           // 'raw' | 'graded'
  rawCondition: 'NM',    // 'NM' | 'EX' | 'LP' | 'PL'
  company: 'PSA',        // 'PSA' | 'BGS' | 'CGC' | 'PCA' | 'ARS'
  grade: '10 (Gem Mint)' // Authentic grade string from GRADING_SCALES[company]
};

function openCardDetail(cardId, initialMode = null, initialSlab = null) {
  detailModalState.cardId = cardId;
  if (initialSlab && initialSlab.company) {
    detailModalState.mode = 'graded';
    detailModalState.company = GRADING_COMPANIES[initialSlab.company] ? initialSlab.company : 'PSA';
    const scale = GRADING_SCALES[detailModalState.company] || GRADING_SCALES.PSA;
    const matched = scale.find(g => g.grade === initialSlab.grade || g.short === initialSlab.short || g.grade.startsWith(String(initialSlab.short || initialSlab.grade || '10')));
    detailModalState.grade = matched ? matched.grade : scale[0].grade;
  } else {
    if (initialMode) {
      detailModalState.mode = initialMode;
    } else if (state.condition?.mode === 'graded') {
      detailModalState.mode = 'graded';
    } else {
      detailModalState.mode = 'raw';
    }

    if (detailModalState.mode === 'graded') {
      if (state.condition?.companies && state.condition.companies.length === 1 && state.condition.companies[0] !== 'ALL') {
        detailModalState.company = state.condition.companies[0];
      } else if (!detailModalState.company || !GRADING_COMPANIES[detailModalState.company]) {
        detailModalState.company = 'PSA';
      }
      const scale = GRADING_SCALES[detailModalState.company] || GRADING_SCALES.PSA;
      const activeGrades = state.condition?.grades || [];
      const matched = scale.find(g => activeGrades.includes(g.grade));
      detailModalState.grade = matched ? matched.grade : scale[0].grade;
    } else {
      detailModalState.rawCondition = state.condition?.rawConditions?.[0] || 'NM';
    }
  }

  renderCardDetailModal();
  openModal('modal-card-detail');
}

function renderCardDetailModal() {
  let card = CARDS.find(c => c.id === detailModalState.cardId);
  if (!card && detailModalState.currentCard) {
    card = detailModalState.currentCard;
  }
  if (!card) return;

  const content = document.getElementById('detail-content');
  if (!content) return;

  const isRaw = detailModalState.mode === 'raw';
  const condOrGradeStr = isRaw 
    ? detailModalState.rawCondition 
    : `${detailModalState.company} ${detailModalState.grade}`;

  const currentConditionLabel = isRaw
    ? (RAW_CONDITIONS.find(c => c.key === detailModalState.rawCondition)?.label || 'Near Mint (NM)')
    : `${detailModalState.company} ${detailModalState.grade}`;

  const frActive = getActiveFrPrice(card, condOrGradeStr);
  const jpActive = getActiveJpPrice(card, condOrGradeStr);
  const margin = netMargin(card, condOrGradeStr);
  const roi = netROI(card, condOrGradeStr);
  const hasPrices = (frActive !== null && jpActive !== null && margin !== null && roi !== null);

  const marginSign = hasPrices && margin >= 0 ? '+' : '';
  const profitClass = hasPrices && margin >= 0 ? 'profit-positive' : 'profit-negative';
  const hasSubName = card.subName && card.subName !== card.name;

  const platforms = PriceService.getMultiPlatformPrices(
    card, 
    detailModalState.mode, 
    isRaw ? detailModalState.rawCondition : { company: detailModalState.company, grade: detailModalState.grade }
  );

  // Extract release year from ref
  const refCode = (card.ref || '').toLowerCase();
  let releaseYear = '—';
  if (refCode.startsWith('sv')) {
    const svNum = parseFloat(refCode.replace('sv', ''));
    if (!isNaN(svNum)) {
      if (svNum >= 9) releaseYear = '2026';
      else if (svNum >= 7) releaseYear = '2025';
      else if (svNum >= 4) releaseYear = '2024';
      else releaseYear = '2023';
    } else {
      releaseYear = '2024';
    }
  } else if (refCode.startsWith('swsh')) {
    releaseYear = '2021';
  } else if (refCode.startsWith('xy') || refCode.startsWith('sm')) {
    releaseYear = '2020 et avant';
  } else {
    releaseYear = '2024';
  }

  // Price history arrays (7j, 30j, 90j points) scaled with platforms smoothed data
  const fr7j = platforms.fr?.ebay?.avg7;
  const fr30j = platforms.fr?.ebay?.avg30;
  const fr90j = platforms.fr?.ebay?.avg90;
  const frHist = hasPrices ? [
    Math.round((fr90j || frActive) * 0.98 * 10) / 10,
    Math.round((fr90j || frActive) * 10) / 10,
    Math.round((fr30j || frActive) * 0.99 * 10) / 10,
    Math.round((fr30j || frActive) * 10) / 10,
    Math.round((fr7j || frActive) * 10) / 10,
    Math.round(frActive * 10) / 10
  ] : [];

  const jp7j = platforms.jp?.mercari?.avg7;
  const jp30j = platforms.jp?.mercari?.avg30;
  const jp90j = platforms.jp?.mercari?.avg90;
  const jpHist = hasPrices ? [
    Math.round((jp90j || jpActive) * 1.02),
    Math.round(jp90j || jpActive),
    Math.round((jp30j || jpActive) * 1.01),
    Math.round(jp30j || jpActive),
    Math.round(jp7j || jpActive),
    Math.round(jpActive)
  ] : [];

  const fmtEur = (v) => (v != null && !isNaN(v)) ? `${Number(v).toFixed(2)} €` : '—';
  const fmtJpy = (v) => (v != null && !isNaN(v)) ? `¥${Number(v).toLocaleString('fr-FR')}` : '—';

  // Verification Search Links (including grade when graded)
  const querySuffixFr = isRaw ? '' : ` ${detailModalState.company} ${detailModalState.grade}`;
  const querySuffixJp = isRaw ? '' : ` ${detailModalState.company} ${detailModalState.grade}`;
  const searchFrQuery = encodeURIComponent(`${card.name} ${card.ref}${querySuffixFr}`);
  const searchJpQuery = encodeURIComponent(`${card.subName || card.name}${querySuffixJp}`);

  const ebayLink = `https://www.ebay.fr/sch/i.html?_nkw=${searchFrQuery}&LH_Sold=1&LH_Complete=1`;
  const vintedLink = `https://www.vinted.fr/catalog?search_text=${searchFrQuery}`;
  const lbcLink = `https://www.leboncoin.fr/recherche?text=${searchFrQuery}&category=172`;
  const mercariLink = `https://jp.mercari.com/search?keyword=${searchJpQuery}&status=sold_out`;
  const yahooLink = `https://auctions.yahoo.co.jp/search/search?p=${searchJpQuery}&b=1&n=20&istatus=2`;

  // Build Price Evolution SVG Chart
  function buildPriceChartSVG(pricePoints) {
    if (!pricePoints || pricePoints.length < 2) return '';
    const w = 240, h = 60, padX = 10, padY = 8;
    const min = Math.min(...pricePoints);
    const max = Math.max(...pricePoints);
    const range = max - min || 1;

    const coords = pricePoints.map((p, i) => {
      const x = padX + (i / (pricePoints.length - 1)) * (w - 2 * padX);
      const y = h - padY - ((p - min) / range) * (h - 2 * padY);
      return [x.toFixed(1), y.toFixed(1)];
    });

    const ptsStr = coords.map(c => `${c[0]},${c[1]}`).join(' ');
    const isUp = pricePoints[pricePoints.length - 1] >= pricePoints[0];
    const strokeCol = isUp ? '#22c55e' : '#ef4444';
    const fillCol = isUp ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)';

    const firstX = coords[0][0];
    const lastX = coords[coords.length - 1][0];
    const baseY = (h - padY).toFixed(1);
    const areaPath = `M${firstX},${baseY} L${coords.map(c => `${c[0]},${c[1]}`).join(' L')} L${lastX},${baseY} Z`;
    const lastCoord = coords[coords.length - 1];

    return `
      <svg class="price-chart-svg" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
        <path d="${areaPath}" fill="${fillCol}"/>
        <polyline points="${ptsStr}" fill="none" stroke="${strokeCol}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        <circle cx="${lastCoord[0]}" cy="${lastCoord[1]}" r="3.5" fill="${strokeCol}"/>
      </svg>
    `;
  }

  // Generate Mode Controls HTML
  let modeControlsHtml = '';
  if (isRaw) {
    modeControlsHtml = `
      <div class="bg-slate-50 border border-slate-200 rounded-xl p-3 mb-4">
        <div class="text-[11px] font-bold text-slate-600 uppercase tracking-wide mb-2 flex items-center justify-between">
          <span>État physique de la carte</span>
          <span class="text-blue-600 font-semibold">${currentConditionLabel}</span>
        </div>
        <div class="flex flex-wrap gap-1.5" id="detail-raw-pills">
          ${RAW_CONDITIONS.map(c => `
            <button type="button" class="detail-sub-pill ${detailModalState.rawCondition === c.key ? 'active' : ''}" data-raw-key="${c.key}">
              <span>${c.key}</span>
              <span class="text-[10px] opacity-75">(${c.label.split('(')[1]?.replace(')', '') || c.key})</span>
            </button>
          `).join('')}
        </div>
      </div>
    `;
  } else {
    const currentCompany = GRADING_COMPANIES[detailModalState.company] || GRADING_COMPANIES.PSA;
    const currentScale = GRADING_SCALES[detailModalState.company] || GRADING_SCALES.PSA;

    // Safety check: ensure selected grade exists in current company scale
    if (!currentScale.some(g => g.grade === detailModalState.grade)) {
      detailModalState.grade = currentScale[0].grade;
    }

    const summaryTableRows = currentScale.map(g => {
      const gradeLabelStr = `${detailModalState.company} ${g.grade}`;
      const multMeta = resolveConditionMultiplier(gradeLabelStr, card);
      const gFr = getActiveFrPrice(card, gradeLabelStr);
      const gJp = getActiveJpPrice(card, gradeLabelStr);
      const gMargin = netMargin(card, gradeLabelStr);
      const gRoi = netROI(card, gradeLabelStr);
      const isSelected = detailModalState.grade === g.grade;
      const hasGPrice = (gFr !== null && gJp !== null && gMargin !== null);
      const profitCls = hasGPrice ? (gMargin >= 0 ? 'profit-positive' : 'profit-negative') : 'text-slate-400';
      const pSign = hasGPrice && gMargin >= 0 ? '+' : '';
      const frText = gFr !== null ? `${gFr.toFixed(2)} €` : '—';
      const jpText = gJp !== null ? `¥${gJp.toLocaleString('fr-FR')}` : '—';
      const marginText = hasGPrice ? `${pSign}${gMargin.toFixed(2)} €` : 'Pas de ventes';
      const roiText = hasGPrice ? `${pSign}${gRoi.toFixed(0)} %` : '—';
      const spreadTag = hasGPrice ? (
        multMeta.source === 'direct_sold'
          ? '<span class="text-[9px] font-semibold text-emerald-600 ml-1" title="Ventes slab réelles">● Réel</span>'
          : `<span class="text-[9px] text-slate-400 ml-1" title="Spread historique marché">×${multMeta.frMult.toFixed(2)}</span>`
      ) : '';

      return `
        <tr class="${isSelected ? 'selected' : ''} cursor-pointer" data-select-grade="${g.grade}">
          <td class="font-bold flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full ${isSelected ? 'bg-blue-600' : 'bg-slate-300'}"></span>
            <span>${g.grade}</span>${spreadTag}
          </td>
          <td>${jpText}</td>
          <td class="font-semibold text-slate-800">${frText}</td>
          <td class="${profitCls} font-bold">${marginText}</td>
          <td class="${profitCls} font-bold">${roiText}</td>
        </tr>
      `;
    }).join('');

    modeControlsHtml = `
      <div class="bg-slate-50 border border-slate-200 rounded-xl p-3 mb-4">
        <!-- Grading Companies -->
        <div class="text-[11px] font-bold text-slate-600 uppercase tracking-wide mb-2 flex items-center justify-between">
          <span>Société de gradation</span>
          <span class="text-blue-600 font-semibold">${currentCompany.fullName}</span>
        </div>
        <div class="flex flex-wrap gap-1.5 mb-3" id="detail-company-tabs">
          ${Object.keys(GRADING_COMPANIES).map(k => `
            <button type="button" class="company-tab ${detailModalState.company === k ? 'active' : ''}" data-company-key="${k}">
              ${k}
            </button>
          `).join('')}
        </div>

        <!-- Grade Selector Pills -->
        <div class="text-[11px] font-bold text-slate-600 uppercase tracking-wide mb-2 flex items-center justify-between">
          <span>Note sélectionnée</span>
          <span class="text-blue-600 font-semibold">Échelle ${detailModalState.company}</span>
        </div>
        <div class="flex flex-wrap gap-1.5 mb-3" id="detail-grade-pills">
          ${currentScale.map(g => `
            <button type="button" class="grade-pill ${detailModalState.grade === g.grade ? 'active' : ''}" data-grade-key="${g.grade}">
              ${g.grade}
            </button>
          `).join('')}
        </div>

        <!-- Slabs Comparison Summary Table -->
        <div class="border border-slate-200 rounded-lg overflow-x-auto shadow-sm">
          <table class="slab-summary-table">
            <thead>
              <tr>
                <th>Grade (${detailModalState.company})</th>
                <th>Achat JP (¥)</th>
                <th>Revente FR (€)</th>
                <th>Marge nette</th>
                <th>ROI</th>
              </tr>
            </thead>
            <tbody>
              ${summaryTableRows}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  const pricingHeaderHtml = hasPrices ? `
    <div class="text-sm text-slate-700 mb-1">
      Achat JP : <strong class="text-slate-900">¥${jpActive.toLocaleString('fr-FR')}</strong> (${(jpToEur(jpActive) || 0).toFixed(2)} €)
      → Revente FR : <strong class="text-slate-900">${frActive.toFixed(2)} €</strong>
    </div>
    <div class="text-sm mb-3">
      Marge nette : <span class="${profitClass} font-bold">${marginSign}${margin.toFixed(2)} €</span>
      &nbsp;|&nbsp; ROI : <span class="${profitClass} font-bold">${marginSign}${roi.toFixed(0)} %</span>
    </div>
  ` : `
    <div class="my-2">
      <span class="price-pending-badge text-xs py-1 px-3">
        <span class="price-pending-dot"></span>
        Prix non disponible / En cours d'actualisation
      </span>
    </div>
    <div class="text-xs text-slate-500 mb-3">
      Aucune vente finalisée enregistrée pour cette référence. Consultez les plateformes ci-dessous pour les ventes en direct.
    </div>
  `;

  const chartsHtml = hasPrices ? `
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
      <div class="price-chart-wrap">
        <div class="flex items-center justify-between mb-1">
          <span class="price-chart-title">📈 Évolution Prix FR (€)</span>
          <span class="text-[10px] font-bold text-slate-600">${frActive.toFixed(2)} €</span>
        </div>
        ${buildPriceChartSVG(frHist)}
        <div class="price-chart-axis">
          <span>Lissée 90j</span>
          <span>Lissée 30j</span>
          <span>Lissée 7j</span>
        </div>
      </div>
      <div class="price-chart-wrap">
        <div class="flex items-center justify-between mb-1">
          <span class="price-chart-title">📉 Évolution Prix JP (¥)</span>
          <span class="text-[10px] font-bold text-slate-600">¥${jpActive.toLocaleString('fr-FR')}</span>
        </div>
        ${buildPriceChartSVG(jpHist)}
        <div class="price-chart-axis">
          <span>Lissée 90j</span>
          <span>Lissée 30j</span>
          <span>Lissée 7j</span>
        </div>
      </div>
    </div>
  ` : '';

  content.innerHTML = `
    <!-- Top-level Mode Tabs -->
    <div class="flex gap-2 mb-4 p-1 bg-slate-100 rounded-2xl w-full max-w-sm">
      <button type="button" class="detail-mode-tab flex-1 ${isRaw ? 'active' : ''}" data-mode-toggle="raw">
        <i data-lucide="package" style="width:14px;height:14px;"></i>
        <span>Non-gradé (Raw)</span>
      </button>
      <button type="button" class="detail-mode-tab flex-1 ${!isRaw ? 'active' : ''}" data-mode-toggle="graded">
        <i data-lucide="shield" style="width:14px;height:14px;"></i>
        <span>Gradée (Slabs)</span>
      </button>
    </div>

    <!-- Top Card Info Block -->
    <div class="flex flex-col sm:flex-row gap-4 mb-4 items-center sm:items-start text-center sm:text-left">
      <img src="${card.image}" class="w-32 max-h-48 object-contain rounded-xl flex-shrink-0 shadow-md mx-auto sm:mx-0 bg-slate-50 border border-slate-100" alt="${card.name}"
           onerror="onCardImageError(this)">
      <div class="flex-1 min-w-0">
        <h3 class="font-bold text-xl text-slate-900 leading-tight">${card.name}</h3>
        ${hasSubName ? `<div class="text-xs text-slate-500 mt-0.5">Nom japonais / VO : <span class="font-semibold text-slate-700">${card.subName}</span></div>` : ''}
        <div class="flex items-center gap-2 mt-1.5 mb-2.5 flex-wrap justify-center sm:justify-start">
          <span class="text-xs font-mono font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded">${card.ref}</span>
          ${editionBadge(card)}
          <span class="text-xs text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">📅 ${releaseYear}</span>
          <span class="text-xs font-semibold ${isRaw ? 'bg-slate-100 text-slate-700' : 'bg-indigo-50 text-indigo-700 border border-indigo-200'} rounded-full px-2.5 py-0.5">
            ${isRaw ? '📦 ' + currentConditionLabel : '🛡️ ' + currentConditionLabel}
          </span>
        </div>

        ${pricingHeaderHtml}

        <button id="btn-add-purchase-modal"
          class="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-2.5 px-5 rounded-xl transition-colors shadow flex items-center justify-center gap-1.5 cursor-pointer">
          <i data-lucide="plus-circle" style="width:15px;height:15px;"></i>
          + Ajouter aux cartes achetées (${isRaw ? 'Raw ' + detailModalState.rawCondition : detailModalState.company + ' ' + detailModalState.grade})
        </button>
      </div>
    </div>

    <!-- Mode Sub-controls (Raw pills or Graded Slabs table) -->
    ${modeControlsHtml}

    <!-- Dual Price Evolution Charts -->
    ${chartsHtml}

    <!-- French Platforms Breakdown Table -->
    <div class="mb-4 bg-slate-50 border border-slate-200 rounded-xl p-3">
      <div class="text-xs font-bold text-slate-700 uppercase tracking-wide mb-2 flex items-center justify-between">
        <div class="flex items-center gap-1.5">
          <span>🇫🇷 Plateformes Françaises</span>
          <span class="text-[10px] font-normal text-slate-400">(Moyennes lissées anti-outliers)</span>
        </div>
        <span class="text-[10px] font-semibold text-blue-600">${isRaw ? 'Raw ' + detailModalState.rawCondition : detailModalState.company + ' ' + detailModalState.grade}</span>
      </div>
      <div class="overflow-x-auto">
        <table class="platform-table">
          <thead>
            <tr>
              <th>Plateforme</th>
              <th>Dernière vente</th>
              <th>Lissée 7j</th>
              <th>Lissée 30j</th>
              <th>Lissée 90j</th>
              <th class="text-right">Vérifier</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="font-bold text-slate-900">eBay FR</td>
              <td>${fmtEur(platforms.fr?.ebay?.last)}</td>
              <td>${fmtEur(platforms.fr?.ebay?.avg7)}</td>
              <td class="font-semibold text-blue-600">${fmtEur(platforms.fr?.ebay?.avg30)}</td>
              <td>${fmtEur(platforms.fr?.ebay?.avg90)}</td>
              <td class="text-right"><a href="${ebayLink}" target="_blank" rel="noopener" class="platform-link">↗ Vérifier</a></td>
            </tr>
            <tr>
              <td class="font-bold text-slate-900">Vinted</td>
              <td>${fmtEur(platforms.fr?.vinted?.last)}</td>
              <td>${fmtEur(platforms.fr?.vinted?.avg7)}</td>
              <td class="font-semibold text-blue-600">${fmtEur(platforms.fr?.vinted?.avg30)}</td>
              <td>${fmtEur(platforms.fr?.vinted?.avg90)}</td>
              <td class="text-right"><a href="${vintedLink}" target="_blank" rel="noopener" class="platform-link">↗ Vérifier</a></td>
            </tr>
            <tr>
              <td class="font-bold text-slate-900">LeBonCoin</td>
              <td>${fmtEur(platforms.fr?.lbc?.last)}</td>
              <td>${fmtEur(platforms.fr?.lbc?.avg7)}</td>
              <td class="font-semibold text-blue-600">${fmtEur(platforms.fr?.lbc?.avg30)}</td>
              <td>${fmtEur(platforms.fr?.lbc?.avg90)}</td>
              <td class="text-right"><a href="${lbcLink}" target="_blank" rel="noopener" class="platform-link">↗ Vérifier</a></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Japanese Platforms Breakdown Table -->
    <div class="mb-2 bg-slate-50 border border-slate-200 rounded-xl p-3">
      <div class="text-xs font-bold text-slate-700 uppercase tracking-wide mb-2 flex items-center justify-between">
        <div class="flex items-center gap-1.5">
          <span>🇯🇵 Plateformes Japonaises</span>
          <span class="text-[10px] font-normal text-slate-400">(Prix d'achat direct en Yen)</span>
        </div>
        <span class="text-[10px] font-semibold text-amber-600">${isRaw ? 'Raw ' + detailModalState.rawCondition : detailModalState.company + ' ' + detailModalState.grade}</span>
      </div>
      <div class="overflow-x-auto">
        <table class="platform-table">
          <thead>
            <tr>
              <th>Plateforme</th>
              <th>Dernière vente</th>
              <th>Lissée 7j</th>
              <th>Lissée 30j</th>
              <th>Lissée 90j</th>
              <th class="text-right">Vérifier</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="font-bold text-slate-900">Mercari JP</td>
              <td>${fmtJpy(platforms.jp?.mercari?.last)}</td>
              <td>${fmtJpy(platforms.jp?.mercari?.avg7)}</td>
              <td class="font-semibold text-amber-600">${fmtJpy(platforms.jp?.mercari?.avg30)}</td>
              <td>${fmtJpy(platforms.jp?.mercari?.avg90)}</td>
              <td class="text-right"><a href="${mercariLink}" target="_blank" rel="noopener" class="platform-link">↗ Vérifier</a></td>
            </tr>
            <tr>
              <td class="font-bold text-slate-900">Yahoo! Auctions</td>
              <td>${fmtJpy(platforms.jp?.yahoo?.last)}</td>
              <td>${fmtJpy(platforms.jp?.yahoo?.avg7)}</td>
              <td class="font-semibold text-amber-600">${fmtJpy(platforms.jp?.yahoo?.avg30)}</td>
              <td>${fmtJpy(platforms.jp?.yahoo?.avg90)}</td>
              <td class="text-right"><a href="${yahooLink}" target="_blank" rel="noopener" class="platform-link">↗ Vérifier</a></td>
            </tr>
            <tr>
              <td class="font-bold text-slate-900">Card Rush</td>
              <td>${fmtJpy(platforms.jp?.cardrush?.last)}</td>
              <td>${fmtJpy(platforms.jp?.cardrush?.avg7)}</td>
              <td class="font-semibold text-amber-600">${fmtJpy(platforms.jp?.cardrush?.avg30)}</td>
              <td>${fmtJpy(platforms.jp?.cardrush?.avg90)}</td>
              <td class="text-right text-slate-400 text-xs">—</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Attach Detail Event Listeners
  content.querySelectorAll('[data-mode-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      detailModalState.mode = btn.dataset.modeToggle;
      renderCardDetailModal();
    });
  });

  content.querySelectorAll('[data-raw-key]').forEach(btn => {
    btn.addEventListener('click', () => {
      detailModalState.rawCondition = btn.dataset.rawKey;
      renderCardDetailModal();
    });
  });

  content.querySelectorAll('[data-company-key]').forEach(btn => {
    btn.addEventListener('click', () => {
      detailModalState.company = btn.dataset.companyKey;
      const scale = GRADING_SCALES[detailModalState.company] || GRADING_SCALES.PSA;
      if (!scale.some(g => g.grade === detailModalState.grade)) {
        detailModalState.grade = scale[0].grade;
      }
      renderCardDetailModal();
    });
  });

  content.querySelectorAll('[data-grade-key]').forEach(btn => {
    btn.addEventListener('click', () => {
      detailModalState.grade = btn.dataset.gradeKey;
      renderCardDetailModal();
    });
  });

  content.querySelectorAll('[data-select-grade]').forEach(row => {
    row.addEventListener('click', () => {
      detailModalState.grade = row.dataset.selectGrade;
      renderCardDetailModal();
    });
  });

  document.getElementById('btn-add-purchase-modal')?.addEventListener('click', () => {
    const condLabel = isRaw ? `Raw ${detailModalState.rawCondition}` : `${detailModalState.company} ${detailModalState.grade}`;
    addToPurchases(card, jpActive, 1, condLabel);
  });

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ── PURCHASES LOGIC & REPORT ─────────────────────────────────
function addToPurchases(card, customPrice = null, customQty = 1, conditionLabel = 'Raw NM') {
  const condition = conditionLabel || 'Raw NM';
  const price = customPrice !== null ? customPrice : getActiveJpPrice(card, condition);
  const boughtAtEur = jpToEur(price) + 1.50;
  const existing = state.purchasedCards.find(p => p.card.id === card.id && p.condition === condition);

  if (existing) {
    existing.quantity += customQty;
  } else {
    state.purchasedCards.push({
      card,
      condition,
      quantity: customQty,
      boughtAt: price,
      boughtAtEur: boughtAtEur,
      addedDate: new Date().toISOString()
    });
  }
  updatePurchaseBadge();
  renderPurchases();
  showToast(`✅ ${card.name} (${condition}) ajouté au rapport !`);
}

function updatePurchaseBadge() {
  const badge = document.getElementById('purchase-badge');
  const counter = document.getElementById('purchases-counter');
  const total = state.purchasedCards.reduce((acc, p) => acc + p.quantity, 0);

  if (badge) {
    badge.textContent = total;
    badge.classList.toggle('hidden', total === 0);
  }
  if (counter) {
    counter.textContent = `${total} carte${total > 1 ? 's' : ''}`;
  }
}

function renderPurchases() {
  const list = document.getElementById('purchase-list');
  const stats = document.getElementById('purchase-stats');
  const counter = document.getElementById('purchases-counter');
  if (!list || !stats) return;

  const totalQty = state.purchasedCards.reduce((acc, p) => acc + p.quantity, 0);
  if (counter) counter.textContent = `${totalQty} carte${totalQty > 1 ? 's' : ''}`;

  if (state.purchasedCards.length === 0) {
    list.innerHTML = `
      <div class="py-8 text-center text-sm text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
        <p class="font-semibold text-slate-600">Aucune carte achetée pour l'instant</p>
        <p class="text-xs text-slate-400 mt-1">Utilisez l'entrée rapide ci-dessus ou parcourez les recommandations.</p>
      </div>
    `;
    stats.innerHTML = '';
    return;
  }

  let totalCards = 0, totalJpy = 0, totalEurInvested = 0, totalEurRevente = 0;

  list.innerHTML = state.purchasedCards.map(({ card, condition, quantity, boughtAt, boughtAtEur, addedDate }, idx) => {
    const frSell = getActiveFrPrice(card, condition || 'Raw NM') * (1 - state.fee);
    const profitPerUnit = frSell - boughtAtEur;
    const profitTotal = profitPerUnit * quantity;
    const profitCls = profitTotal >= 0 ? 'profit-positive' : 'profit-negative';
    const profitSign = profitTotal >= 0 ? '+' : '';

    totalCards += quantity;
    totalJpy += boughtAt * quantity;
    totalEurInvested += boughtAtEur * quantity;
    totalEurRevente += frSell * quantity;

    const cond = condition || 'Raw NM';
    const isGraded = !cond.startsWith('Raw');
    const condBadge = isGraded
      ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">🛡️ ${cond}</span>`
      : `<span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">📦 ${cond}</span>`;

    const dateStr = addedDate ? new Date(addedDate).toLocaleDateString('fr-FR', {day:'2-digit', month:'2-digit'}) : '—';

    return `
      <div class="flex items-center gap-2.5 py-2 px-1 border-b border-slate-100 last:border-0 text-xs hover:bg-slate-50 transition-colors rounded-lg">
        <span class="text-slate-400 text-[10px] w-9 flex-shrink-0 text-center font-mono">${dateStr}</span>
        <img src="${card.image}" class="w-8 h-11 object-cover rounded flex-shrink-0 shadow-sm" alt="${card.name}" onerror="onCardImageError(this)">
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-slate-900 truncate">${card.name}</div>
          <div class="flex items-center gap-1.5 text-[10px] text-slate-400 flex-wrap">
            <span>${card.ref}</span>
            <span>·</span>
            ${editionBadge(card)}
            ${condBadge}
          </div>
        </div>
        <span class="text-slate-600 font-semibold w-7 text-center flex-shrink-0">x${quantity}</span>
        <div class="text-right flex-shrink-0 leading-tight">
          <div class="text-slate-700 font-medium">¥${boughtAt.toLocaleString('fr-FR')}</div>
          <div class="text-[10px] text-slate-400">${boughtAtEur.toFixed(2)}€</div>
        </div>
        <div class="text-right flex-shrink-0 leading-tight">
          <div class="font-semibold text-slate-800">${frSell.toFixed(2)} €</div>
          <div class="text-[10px] text-slate-400">revente</div>
        </div>
        <span class="${profitCls} font-bold whitespace-nowrap flex-shrink-0 text-right min-w-[55px]">${profitSign}${profitTotal.toFixed(2)} €</span>
        <button class="btn-delete-purchase p-1 text-slate-300 hover:text-red-500 transition-colors flex-shrink-0 rounded cursor-pointer" data-purchase-idx="${idx}" title="Supprimer">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.btn-delete-purchase').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.purchaseIdx, 10);
      if (!isNaN(idx)) {
        state.purchasedCards.splice(idx, 1);
        updatePurchaseBadge();
        renderPurchases();
        showToast('🗑️ Carte retirée du rapport');
      }
    });
  });

  const totalProfit = totalEurRevente - totalEurInvested;
  const roi = totalEurInvested > 0 ? ((totalProfit / totalEurInvested) * 100) : 0;
  const profitCls = totalProfit >= 0 ? 'profit-positive' : 'profit-negative';
  const profitSign = totalProfit >= 0 ? '+' : '';

  stats.innerHTML = `
    <div class="purchase-kpi">
      <span class="kpi-label">Total cartes</span>
      <span class="kpi-value">${totalCards}</span>
      <span class="kpi-sub">unités</span>
    </div>
    <div class="purchase-kpi">
      <span class="kpi-label">Total investi</span>
      <span class="kpi-value">¥${totalJpy.toLocaleString('fr-FR')}</span>
      <span class="kpi-sub">${totalEurInvested.toFixed(2)} €</span>
    </div>
    <div class="purchase-kpi">
      <span class="kpi-label">Valeur revente FR</span>
      <span class="kpi-value">${totalEurRevente.toFixed(2)} €</span>
      <span class="kpi-sub">brut estimé</span>
    </div>
    <div class="purchase-kpi">
      <span class="kpi-label">Bénéfice net estimé</span>
      <span class="kpi-value ${profitCls}">${profitSign}${totalProfit.toFixed(2)} €</span>
      <span class="kpi-sub ${profitCls}">${profitSign}${roi.toFixed(1)} % ROI</span>
    </div>
  `;
}

function setupQuickEntry() {
  const refInput = document.getElementById('quick-entry-ref');
  const condSelect = document.getElementById('quick-entry-condition');
  const priceInput = document.getElementById('quick-entry-price');
  const qtyInput = document.getElementById('quick-entry-qty');
  const addBtn = document.getElementById('quick-entry-add');
  const dropdown = document.getElementById('quick-entry-dropdown');
  if (!refInput || !addBtn) return;

  let quickEntrySelected = null;

  const updatePriceSuggestion = () => {
    if (!quickEntrySelected) return;
    const cond = condSelect?.value || 'Raw NM';
    if (priceInput) priceInput.value = getActiveJpPrice(quickEntrySelected, cond);
  };

  if (condSelect) {
    condSelect.addEventListener('change', updatePriceSuggestion);
  }

  refInput.addEventListener('input', () => {
    const q = refInput.value.trim().toLowerCase();
    if (!q || q.length < 2) {
      if (dropdown) dropdown.classList.add('hidden');
      return;
    }
    const matches = CARDS.filter(c =>
      (c.name && c.name.toLowerCase().includes(q)) ||
      (c.ref && c.ref.toLowerCase().includes(q)) ||
      (c.subName && c.subName.toLowerCase().includes(q))
    ).slice(0, 8);

    if (matches.length === 0) {
      if (dropdown) dropdown.classList.add('hidden');
      return;
    }

    if (dropdown) {
      dropdown.innerHTML = matches.map(c => `
        <div class="qe-result-item" data-id="${c.id}">
          <img src="${c.image}" alt="${c.name}" onerror="onCardImageError(this)">
          <div class="flex-1 min-w-0">
            <div class="font-semibold text-slate-900 truncate">${c.name}</div>
            <div class="text-[10px] text-slate-400">${c.ref} · ¥${getActiveJpPrice(c).toLocaleString('fr-FR')}</div>
          </div>
        </div>
      `).join('');
      dropdown.classList.remove('hidden');

      dropdown.querySelectorAll('.qe-result-item').forEach(item => {
        item.addEventListener('click', () => {
          const card = CARDS.find(c => c.id === item.dataset.id);
          if (!card) return;
          quickEntrySelected = card;
          refInput.value = `${card.name} (${card.ref})`;
          updatePriceSuggestion();
          dropdown.classList.add('hidden');
        });
      });
    }
  });

  document.addEventListener('click', e => {
    if (refInput && dropdown && !refInput.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.classList.add('hidden');
    }
  });

  addBtn.onclick = () => {
    let card = quickEntrySelected;
    const refVal = refInput.value.trim();
    if (!card && refVal) {
      card = CARDS.find(c =>
        (c.name && c.name.toLowerCase().includes(refVal.toLowerCase())) ||
        (c.ref && c.ref.toLowerCase().includes(refVal.toLowerCase()))
      );
    }

    if (!card) {
      showToast('⚠️ Sélectionnez ou saisissez une carte valide');
      return;
    }

    const cond = condSelect?.value || 'Raw NM';
    const price = parseInt(priceInput?.value || '0', 10) || getActiveJpPrice(card, cond);
    const qty = parseInt(qtyInput?.value || '1', 10) || 1;

    addToPurchases(card, price, qty, cond);

    refInput.value = '';
    if (priceInput) priceInput.value = '';
    if (qtyInput) qtyInput.value = '1';
    quickEntrySelected = null;
    if (dropdown) dropdown.classList.add('hidden');
  };
}

function exportCSV() {
  if (state.purchasedCards.length === 0) {
    showToast('Aucune carte à exporter.');
    return;
  }
  const header = ['Date', 'Carte', 'Nom Original', 'Référence', 'Édition', 'État / Grade', 'Quantité', 'Achat JP (¥)', 'Achat (€)', 'Revente FR (€)', 'Profit (€)', 'ROI (%)'];
  const rows = state.purchasedCards.map(({ card, condition, quantity, boughtAt, boughtAtEur, addedDate }) => {
    const cond = condition || 'Raw NM';
    const sellPrice = getActiveFrPrice(card, cond) * (1 - state.fee);
    const profit = (sellPrice - boughtAtEur) * quantity;
    const roi = boughtAtEur > 0 ? ((sellPrice - boughtAtEur) / boughtAtEur * 100).toFixed(1) : '0';
    const date = addedDate ? new Date(addedDate).toLocaleDateString('fr-FR') : '—';
    return [date, `"${card.name}"`, `"${card.subName || ''}"`, `"${card.ref}"`, card.edition || 'JP', `"${cond}"`, quantity, boughtAt, boughtAtEur.toFixed(2), sellPrice.toFixed(2), profit.toFixed(2), roi].join(';');
  });
  const csv = [header.join(';'), ...rows].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'pokespread_achats_rapport.csv';
  a.click();
  URL.revokeObjectURL(url);
  showToast('📥 Rapport CSV exporté !');
}

// ── ENHANCED LIBRARY MODAL ───────────────────────────────────
let libraryState = {
  condition: 'raw_nm',
  editions: ['all'],
  search: '',
  platformFr: 'avg',
  platformJp: 'min',
  year: 'all',
};

function renderLibrary() {
  const grid = document.getElementById('library-grid');
  const counter = document.getElementById('library-counter');
  if (!grid) return;

  let cards = [...CARDS];

  // 1. Unified condition filter
  if (!state.condition || state.condition.mode === 'raw') {
    // all cards qualify raw
  } else if (state.condition.mode === 'graded') {
    cards = cards.filter(c => {
      const nameLower = (c.name || '').toLowerCase();
      const subLower = (c.subName || '').toLowerCase();
      const isSpecial = nameLower.includes('sar') || nameLower.includes('ar') || nameLower.includes('alt') ||
                        nameLower.includes('secret') || nameLower.includes('vmax') || nameLower.includes('shiny') ||
                        subLower.includes('sar') || subLower.includes('ar');
      return isSpecial || c.frPrice >= 25;
    });
  }

  // 2. Multi-select editions
  if (!libraryState.editions.includes('all') && libraryState.editions.length > 0) {
    cards = cards.filter(c => libraryState.editions.includes(c.edition));
  }

  // 3. Search query
  if (libraryState.search) {
    const q = libraryState.search.toLowerCase();
    cards = cards.filter(c =>
      (c.name && c.name.toLowerCase().includes(q)) ||
      (c.subName && c.subName.toLowerCase().includes(q)) ||
      (c.ref && c.ref.toLowerCase().includes(q)) ||
      (c.localId && c.localId.toLowerCase() === q)
    );
  }

  // 4. Year filter
  if (libraryState.year !== 'all') {
    cards = cards.filter(c => {
      const ref = (c.ref || '').toLowerCase();
      let year = '2024';
      if (ref.startsWith('sv')) {
        const svNum = parseFloat(ref.replace('sv', ''));
        if (!isNaN(svNum)) {
          if (svNum >= 9) year = '2026';
          else if (svNum >= 7) year = '2025';
          else if (svNum >= 4) year = '2024';
          else year = '2023';
        }
      } else if (ref.startsWith('swsh')) {
        year = '2021';
      } else {
        year = '2020';
      }
      if (libraryState.year === '2020') return year <= '2020';
      return year === libraryState.year;
    });
  }

  // Live counter
  if (counter) {
    counter.textContent = `${cards.length} carte${cards.length > 1 ? 's' : ''} trouvée${cards.length > 1 ? 's' : ''}`;
  }

  if (cards.length === 0) {
    grid.innerHTML = '<div class="col-span-full py-8 text-center text-sm text-slate-400 bg-slate-50 rounded-xl">Aucune carte trouvée pour ces critères de recherche.</div>';
    return;
  }

  const isGraded = state.condition?.mode === 'graded';
  let badgeText = 'Raw NM';
  if (isGraded) {
    const co = (state.condition.companies && state.condition.companies.length === 1 && state.condition.companies[0] !== 'ALL') ? state.condition.companies[0] : 'Slabs';
    const gr = state.condition.grades && state.condition.grades.length > 0 ? ' ' + state.condition.grades[0].split(' ')[0] : '';
    badgeText = `${co}${gr}`;
  } else {
    badgeText = 'Raw ' + (state.condition?.rawConditions && state.condition.rawConditions.length > 0 ? state.condition.rawConditions.join('/') : 'NM');
  }

  const pageLimit = libraryState.pageLimit || 60;
  const visibleCards = cards.slice(0, pageLimit);

  const cardsHtml = visibleCards.map(card => {
    const frPrice = getActiveFrPrice(card);
    const jpPrice = getActiveJpPrice(card);
    const margin = netMargin(card);
    const hasPrices = (frPrice !== null && jpPrice !== null && margin !== null);
    const profitCls = hasPrices && margin >= 0 ? 'profit-positive' : 'profit-negative';
    const marginSign = hasPrices && margin >= 0 ? '+' : '';
    const hasSubName = card.subName && card.subName !== card.name;

    const priceRowHtml = hasPrices ? `
      <div class="flex items-center justify-between mt-1">
        <span class="text-[10px] text-slate-500">${frPrice.toFixed(2)} €</span>
        <span class="${profitCls} text-xs font-bold">${marginSign}${margin.toFixed(2)} €</span>
      </div>
    ` : `
      <div class="mt-1">
        <span class="price-pending-badge text-[9px] py-0.5 px-1.5"><span class="price-pending-dot"></span>Prix non disponible / En cours d'actualisation</span>
      </div>
    `;

    return `
      <div class="library-card-mini fade-in" data-id="${card.id}">
        <img src="${card.image}" alt="${card.name}" loading="lazy" onerror="onCardImageError(this)">
        <div class="library-card-info">
          <div class="text-xs font-semibold text-slate-900 leading-tight truncate">${card.name}</div>
          ${hasSubName ? `<div class="text-[9px] text-slate-400 font-normal truncate">${card.subName}</div>` : ''}
          <div class="flex items-center gap-1 mt-0.5 flex-wrap">
            ${editionBadge(card)}
            <span class="text-[8px] font-semibold ${isGraded ? 'text-indigo-600 bg-indigo-50 border border-indigo-200' : 'text-slate-500 bg-slate-100'} px-1 py-0.2 rounded">
              ${badgeText}
            </span>
          </div>
          ${priceRowHtml}
        </div>
      </div>
    `;
  }).join('');

  const loadMoreBtnHtml = cards.length > pageLimit ? `
    <div class="col-span-full flex justify-center py-4">
      <button type="button" id="library-load-more-btn" class="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow cursor-pointer transition-all">
        Charger plus (${visibleCards.length} / ${cards.length.toLocaleString('fr-FR')})
      </button>
    </div>
  ` : '';

  grid.innerHTML = cardsHtml + loadMoreBtnHtml;

  grid.querySelectorAll('.library-card-mini').forEach(el => {
    el.addEventListener('click', () => {
      closeModal('modal-library');
      openCardDetail(el.dataset.id, isGraded ? 'graded' : 'raw');
    });
  });

  document.getElementById('library-load-more-btn')?.addEventListener('click', () => {
    libraryState.pageLimit = pageLimit + 60;
    renderLibrary();
  });
}

// ── FULL-SCREEN CAMERA SCANNER (NATIVE CAMERA CAPTURE) ──────────

// ── ADVANCED NATIVE OCR: SERIAL NUMBER + GRADED SLAB EXTRACTOR (`CardOCR`) ──
const CardOCR = {
  isTesseractAvailable() {
    return typeof window !== 'undefined' && typeof window.Tesseract !== 'undefined';
  },

  // Extract and contrast-enhance a targeted image strip for crisp OCR recognition
  prepareOcrStrip(source, sx, sy, sw, sh, highContrast = true) {
    if (!source || sw < 10 || sh < 10) return null;
    // Upscale narrow strips to at least 640px wide so small printed serials & slab labels read clearly
    const scale = sw < 640 ? Math.min(2.5, 640 / sw) : 1.0;
    const outW = Math.round(sw * scale);
    const outH = Math.round(sh * scale);

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, outW, outH);

    if (highContrast) {
      try {
        const imgData = ctx.getImageData(0, 0, outW, outH);
        const d = imgData.data;
        // Compute mean luminance for adaptive contrast expansion
        let lumSum = 0;
        const pxCount = d.length / 4;
        for (let i = 0; i < d.length; i += 4) {
          lumSum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        }
        const meanLum = pxCount > 0 ? lumSum / pxCount : 128;
        const hi = Math.min(220, meanLum + 28);
        const lo = Math.max(40, meanLum - 28);

        for (let i = 0; i < d.length; i += 4) {
          const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          const val = lum > hi ? 255 : (lum < lo ? 0 : Math.round(((lum - lo) / (hi - lo)) * 255));
          d[i] = val;
          d[i + 1] = val;
          d[i + 2] = val;
        }
        ctx.putImageData(imgData, 0, 0);
      } catch (e) {}
    }

    return canvas;
  },

  // Crop top 30% of full photo for PSA / BGS / CGC / PCA slab headers
  getTopSlabStrip(fullImg) {
    const w = fullImg.naturalWidth || fullImg.width;
    const h = fullImg.naturalHeight || fullImg.height;
    if (!w || !h) return null;
    const stripH = Math.max(40, Math.round(h * 0.30));
    return this.prepareOcrStrip(fullImg, 0, 0, w, stripH, true);
  },

  // Crop bottom 22% of card/slab for printed serial numbers (e.g. 201/165, 120/119) & ARS labels
  getBottomSerialStrip(source) {
    const w = source.naturalWidth || source.width;
    const h = source.naturalHeight || source.height;
    if (!w || !h) return null;
    const stripH = Math.max(32, Math.round(h * 0.22));
    const stripY = h - stripH;
    return this.prepareOcrStrip(source, 0, stripY, w, stripH, true);
  },

  async runTesseract(canvas, whitelist = null) {
    if (!canvas || !this.isTesseractAvailable()) return '';
    try {
      const opts = whitelist ? { tessedit_char_whitelist: whitelist } : {};
      const res = await window.Tesseract.recognize(canvas, 'eng', opts);
      return (res?.data?.text || '').trim();
    } catch (err) {
      console.warn('[CardOCR] Tesseract pass warning:', err);
      return '';
    }
  },

  // Direct Tesseract.js OCR pipeline: reads serial numbers & graded slab labels without visual guesswork
  async extractFromPhoto(file, fullImg) {
    if (!this.isTesseractAvailable()) {
      return { serial: null, slab: null, rawText: '' };
    }

    const topStrip = fullImg ? this.getTopSlabStrip(fullImg) : null;
    const bottomStrip = fullImg ? this.getBottomSerialStrip(fullImg) : null;

    // Pass 1: Parallel targeted OCR on top slab header & bottom serial/ARS strip
    const [topText, bottomText] = await Promise.all([
      this.runTesseract(topStrip, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/#+.- '),
      this.runTesseract(bottomStrip, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/#+.- ')
    ]);

    let combinedText = `${topText}\n${bottomText}`.trim();
    let slab = this.parseSlabFromText(topText) || this.parseSlabFromText(bottomText);
    let serial = this.parseSerialFromText(bottomText) || this.parseSerialFromText(topText);

    // Pass 2: Full-image direct Tesseract OCR pass if serial or slab was missed (handles tilted/macro shots)
    if (!serial && file) {
      const fullText = await this.runTesseract(file);
      if (fullText) {
        combinedText = `${combinedText}\n${fullText}`.trim();
        if (!slab) slab = this.parseSlabFromText(fullText);
        if (!serial) serial = this.parseSerialFromText(fullText);
      }
    }

    return { serial, slab, rawText: combinedText };
  },

  // Parse grading company & grade markers: (PSA|BGS|CGC|PCA|ARS) (10 BL|10 Pr|10+|10|9.5|9|8.5|8)
  parseSlabFromText(text) {
    if (!text) return null;
    const clean = text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clean) return null;

    const buildSlab = (company, shortMatch) => {
      const scale = GRADING_SCALES[company] || GRADING_SCALES.PSA;
      const found = scale.find(g =>
        g.short.toLowerCase() === shortMatch.toLowerCase() ||
        g.grade.toLowerCase().startsWith(shortMatch.toLowerCase())
      ) || scale[0];
      return {
        company,
        grade: found.grade,
        short: found.short,
        displayLabel: `${company} ${found.short}`,
        rawText: clean
      };
    };

    // Primary unified grading regex
    const unified = clean.match(/\b(PSA|BGS|CGC|PCA|ARS)\s*(10\s*BL|10\s*Pr|10\+|10|9\.5|9|8\.5|8)\b/i);
    if (unified) {
      const company = unified[1].toUpperCase();
      const rawGrade = unified[2].replace(/\s+/g, ' ').trim();
      const upperG = rawGrade.toUpperCase();
      if (upperG === '10 BL') return buildSlab('BGS', '10 BL');
      if (upperG === '10 PR') return buildSlab(company, '10 Pr');
      if (upperG === '10+') return buildSlab(company, '10+');
      if (upperG === '8.5') return buildSlab(company, '≤ 8.5');
      if (upperG === '8' && (company === 'PCA' || company === 'ARS')) return buildSlab(company, '≤ 8');
      return buildSlab(company, rawGrade);
    }

    // Secondary authentic slab label phrasing aliases
    if (/\bBLACK\s*LABEL\b/i.test(clean)) return buildSlab('BGS', '10 BL');
    if (/\bGEM\s*MT\s*10\b/i.test(clean)) return buildSlab('PSA', '10');
    if (/\bPSA\b/i.test(clean) && /\bMINT\s*9\b/i.test(clean)) return buildSlab('PSA', '9');
    if (/\bPSA\s*7\b/i.test(clean)) return buildSlab('PSA', '≤ 7');
    const beckett = clean.match(/\bBECKETT\s*(10|9\.5|9|8\.5|8)\b/i);
    if (beckett) return buildSlab('BGS', beckett[1] === '10' ? '10 Pr' : (beckett[1] === '8.5' || beckett[1] === '8' ? '≤ 8.5' : beckett[1]));
    const arsGrade = clean.match(/\bGRADE\s*(10\+|10|9|8)\b/i);
    if (arsGrade) return buildSlab('ARS', arsGrade[1] === '8' ? '≤ 8' : arsGrade[1]);

    return null;
  },

  // Extract serial numbers matching (\d{1,3})\s*/\s*(\d{1,3}) (e.g. 120/119, 201/165) or set IDs (sv2a, xy4)
  parseSerialFromText(text) {
    if (!text) return null;
    const clean = text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clean) return null;

    // Optional set ID hint across all Pokémon TCG eras (sv2a, xy4, swsh7, sm12, base1, etc.)
    const setMatch = clean.match(/\b(sv\d+[a-z]?|sv0?\d\.\d|swsh\d+(?:\.\d)?|sm\d+|xy\d+|bw\d+|dp\d+|ex\d+|base\d+|s\d+[a-z])\b/i);
    const setHint = setMatch ? setMatch[1].toLowerCase() : null;

    // Primary pattern: explicit card serial fraction (\d{1,3})\s*/\s*(\d{1,3})
    const fracMatch = clean.match(/\b([0-9O]{1,3})\s*[\/|!]\s*([0-9O]{1,3})\b/);
    if (fracMatch) {
      const localId = fracMatch[1].replace(/O/g, '0');
      const total = fracMatch[2].replace(/O/g, '0');
      const totalInt = parseInt(total, 10);
      if (totalInt >= 10 && totalInt <= 400) {
        return {
          serial: `${localId}/${total}`,
          localId,
          cleanLocalId: localId.replace(/^0+/, '') || localId,
          total,
          setHint,
          exactFraction: true,
          rawText: clean
        };
      }
    }

    // Secondary pattern: slab-label card number ("#201", "#120", "No. 201")
    const hashMatch = clean.match(/(?:#|No\.?\s*)([0-9]{1,3})\b/i);
    if (hashMatch) {
      const localId = hashMatch[1];
      return {
        serial: `#${localId}`,
        localId,
        cleanLocalId: localId.replace(/^0+/, '') || localId,
        total: null,
        setHint,
        exactFraction: false,
        rawText: clean
      };
    }

    // Tertiary pattern: explicit set ID + standalone card number (e.g. "sv2a 201")
    if (setHint) {
      const afterSet = clean.match(new RegExp(`${setHint}\\s+0*([0-9]{1,3})\\b`, 'i'));
      if (afterSet) {
        const localId = afterSet[1];
        return {
          serial: `${setHint} ${localId}`,
          localId,
          cleanLocalId: localId.replace(/^0+/, '') || localId,
          total: null,
          setHint,
          exactFraction: false,
          rawText: clean
        };
      }
    }

    return null;
  }
};

// Automatically switch global app UI to Graded mode when OCR detects a slab label
function applyDetectedSlabToGlobalUI(detectedSlab) {
  if (!detectedSlab || !detectedSlab.company) return;
  try {
    state.condition.mode = 'graded';
    state.condition.companies = [detectedSlab.company];
    state.condition.grades = [detectedSlab.grade];
    if (typeof updateConditionTriggerLabels === 'function') updateConditionTriggerLabels();
    if (typeof renderConditionPopovers === 'function') renderConditionPopovers();
    if (typeof renderAllColumns === 'function') renderAllColumns();
    if (typeof renderMobileColumn === 'function') renderMobileColumn();
  } catch (e) {
    console.warn('[CardOCR] Failed switching UI to graded mode:', e);
  }
}

function resetScannerPreview() {
  const previewImg = document.getElementById('scanner-captured-preview');
  const placeholder = document.getElementById('scanner-guide-placeholder');
  const camInput = document.getElementById('native-camera-input');
  const fileFallback = document.getElementById('scanner-file-fallback');
  const resultsEl = document.getElementById('scanner-results');

  if (previewImg) {
    previewImg.src = '';
    previewImg.classList.add('hidden');
  }
  if (placeholder) {
    placeholder.classList.remove('hidden');
  }
  if (camInput) camInput.value = '';
  if (fileFallback) fileFallback.value = '';
  if (resultsEl) {
    resultsEl.innerHTML = '<p class="text-white/60 text-xs">Prenez une photo nette de la carte ou du slab (numéro visible en bas)</p>';
  }
}

function openScanner() {
  const overlay = document.getElementById('modal-scanner');
  if (!overlay) return;
  overlay.style.display = 'flex';
  if (typeof lucide !== 'undefined') lucide.createIcons();
  updateScannerEditionPill();
  resetScannerPreview();
}

function updateScannerEditionPill() {
  const pillText = document.getElementById('scanner-edition-text');
  if (!pillText) return;
  if (typeof state !== 'undefined' && state.filters && state.filters.countries && state.filters.countries.length > 0) {
    const flags = state.filters.countries.map(code => {
      const c = (typeof COUNTRIES !== 'undefined') ? COUNTRIES.find(x => x.code === code) : null;
      return `${c ? c.flag : '🌐'} ${code}`;
    }).join(', ');
    pillText.textContent = `Édition : ${flags} (Prioritaire)`;
  } else {
    pillText.textContent = 'Édition : Toutes (Catalogue mondial TCGdex)';
  }
}

function closeScanner() {
  const overlay = document.getElementById('modal-scanner');
  if (overlay) overlay.style.display = 'none';
  resetScannerPreview();
}

// Pure Tesseract.js OCR + TCGdex API Scanner (Raw Cards & Graded Slabs — Zero Visual Guesswork)
async function processCapturedPhoto(file) {
  if (!file) return;
  const resultsEl = document.getElementById('scanner-results');
  const previewImg = document.getElementById('scanner-captured-preview');
  const placeholder = document.getElementById('scanner-guide-placeholder');

  const objectUrl = URL.createObjectURL(file);
  if (previewImg) {
    previewImg.src = objectUrl;
    previewImg.classList.remove('hidden');
  }
  if (placeholder) {
    placeholder.classList.add('hidden');
  }

  if (resultsEl) {
    resultsEl.innerHTML = `
      <div class="bg-slate-900/95 border border-emerald-500/40 backdrop-blur-md rounded-2xl p-4 text-white max-w-sm mx-auto shadow-2xl space-y-3">
        <div class="flex items-center gap-3">
          <div class="w-5 h-5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin flex-shrink-0"></div>
          <div class="text-left flex-1 min-w-0">
            <div id="scanner-step-title" class="text-xs font-bold text-emerald-300 truncate scanner-step-pulse">Analyse OCR Tesseract.js...</div>
            <div id="scanner-step-desc" class="text-[11px] text-white/50 truncate">Lecture du n° de série & détection PSA / BGS / CGC / PCA / ARS</div>
          </div>
          <span id="scanner-step-pct" class="text-[11px] font-mono text-emerald-400 font-bold">30%</span>
        </div>
        <div class="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
          <div id="scanner-step-progress" class="h-1.5 bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-500 ease-out" style="width: 30%;"></div>
        </div>
      </div>
    `;
  }

  const stepTitle = document.getElementById('scanner-step-title');
  const stepDesc = document.getElementById('scanner-step-desc');
  const stepPct = document.getElementById('scanner-step-pct');
  const stepProgress = document.getElementById('scanner-step-progress');

  const updateProgress = (title, desc, pct) => {
    if (stepTitle) stepTitle.textContent = title;
    if (stepDesc) stepDesc.textContent = desc;
    if (stepPct) stepPct.textContent = `${pct}%`;
    if (stepProgress) stepProgress.style.width = `${pct}%`;
  };

  const img = new Image();
  img.onload = async () => {
    try {
      // 1. Direct Tesseract.js OCR extraction (serial number + slab marker)
      updateProgress(
        "Extraction OCR (Numéro & Boîtier)...",
        "Recherche du n° (ex: 120/119) et du grade (PSA/BGS/CGC/PCA/ARS)",
        50
      );

      let ocrData = { serial: null, slab: null, rawText: '' };
      try {
        ocrData = await CardOCR.extractFromPhoto(file, img);
      } catch (ocrErr) {
        console.warn('[Scanner] OCR pass warning:', ocrErr);
      }

      const detectedSlab = ocrData.slab || null;
      const detectedSerial = ocrData.serial || null;

      // 2. Automatically switch UI to Graded mode & apply historical grade multiplier if slab detected
      if (detectedSlab) {
        applyDetectedSlabToGlobalUI(detectedSlab);
      }

      // 3. Instant 100% accurate TCGdex API lookup by extracted serial / localId
      if (detectedSerial && detectedSerial.cleanLocalId) {
        updateProgress(
          `Numéro ${detectedSerial.serial} détecté par OCR...`,
          detectedSlab
            ? `Mode Gradé (${detectedSlab.displayLabel}) activé — requête TCGdex`
            : "Interrogation directe de l'API TCGdex...",
          85
        );

        let serialCandidates = [];
        try {
          serialCandidates = await CatalogService.lookupCardsBySerial(
            detectedSerial.serial,
            detectedSerial.setHint
          );
        } catch (lookupErr) {
          console.warn('[Scanner] TCGdex serial lookup warning:', lookupErr);
        }

        if (serialCandidates && serialCandidates.length > 0) {
          // Prioritize active country filter if multiple editions share the exact serial
          const activeCountries = state.filters?.countries || [];
          if (activeCountries.length > 0 && serialCandidates.length > 1) {
            serialCandidates = [...serialCandidates].sort((a, b) => {
              const am = activeCountries.includes(a.edition) ? 1 : 0;
              const bm = activeCountries.includes(b.edition) ? 1 : 0;
              return bm - am;
            });
          }

          // On-demand native TCGdex JA→FR translation if needed
          const topCard = await LocalizationService.translateCardViaTCGdex(serialCandidates[0]);

          const bestMatch = {
            card: topCard,
            score: 100,
            ocrVerified: true,
            ocrSerial: detectedSerial.serial,
            detectedSlab
          };
          const runnerUps = serialCandidates.slice(1, 4).map(c => ({
            card: c,
            score: 95,
            ocrVerified: true,
            ocrSerial: detectedSerial.serial,
            detectedSlab
          }));

          showScannerResult(bestMatch, runnerUps, resultsEl);
          return;
        }
      }

      // 4. Clean manual fallback when OCR could not read a catalog serial number
      showNoMatchResult(0, resultsEl, detectedSlab);
    } catch (e) {
      console.error('[Scanner] OCR processing error:', e);
      showNoMatchResult(0, resultsEl);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  };

  img.onerror = () => {
    URL.revokeObjectURL(objectUrl);
    showNoMatchResult(0, resultsEl);
  };

  img.src = objectUrl;
}

// Honest threshold display when confidence is below 50% (retains any detected slab marker)
function showNoMatchResult(score = 0, resultsEl = null, detectedSlab = null) {
  if (!resultsEl) resultsEl = document.getElementById('scanner-results');
  if (!resultsEl) return;

  const slabHintHtml = detectedSlab ? `
    <div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-500/20 border border-indigo-400/40 text-indigo-200 text-[11px] font-bold">
      <span>🛡️ Slab détecté : ${detectedSlab.displayLabel}</span>
    </div>
  ` : '';

  resultsEl.innerHTML = `
    <div class="scanner-no-match bg-slate-900/95 border border-amber-500/50 backdrop-blur-md rounded-2xl p-4 text-white max-w-sm mx-auto shadow-2xl text-center space-y-3">
      <div class="w-12 h-12 mx-auto rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
        <i data-lucide="scan" style="width:24px;height:24px;"></i>
      </div>
      ${slabHintHtml}
      <div class="space-y-1">
        <div class="text-sm font-bold text-amber-300">Numéro de série non détecté — Réessayez ou tapez le n°</div>
        <p class="text-xs text-white/60">L'OCR n'a pas pu lire le numéro en bas de carte (ex: 120/119, 201/165). Rapprochez-vous du numéro ou saisissez-le ci-dessous.</p>
      </div>

      <div class="flex gap-2">
        <button id="scanner-retry-btn" class="flex-1 bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-slate-900 font-bold py-2.5 px-4 rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-md">
          <i data-lucide="camera" style="width:14px;height:14px;"></i>
          <span>Reprendre une photo</span>
        </button>
      </div>

      <!-- Quick manual reference input box -->
      <div class="border-t border-white/10 pt-3 text-left">
        <label class="text-[11px] text-white/70 block mb-1.5 font-medium">Ou tapez le numéro ou le nom :</label>
        <div class="flex gap-2">
          <input id="scanner-inline-manual-ref" type="text" placeholder="ex: 201/165 ou 120/119" 
                 class="flex-1 px-3 py-2 rounded-xl bg-white/10 border border-white/20 text-white placeholder:text-white/40 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-400">
          <button id="scanner-inline-manual-btn" class="bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-bold px-3 py-2 rounded-xl text-xs transition-colors cursor-pointer">OK</button>
        </div>
      </div>
    </div>
  `;

  if (typeof lucide !== 'undefined') lucide.createIcons();

  // Retry button resets preview and triggers native camera
  document.getElementById('scanner-retry-btn')?.addEventListener('click', () => {
    resetScannerPreview();
    document.getElementById('native-camera-input')?.click();
  });

  // Inline manual reference lookup (preserves any OCR-detected slab)
  const inlineInput = document.getElementById('scanner-inline-manual-ref');
  const inlineBtn = document.getElementById('scanner-inline-manual-btn');
  if (inlineInput && inlineBtn) {
    const handleInlineLookup = () => {
      runScannerManualLookup(inlineInput.value, resultsEl, detectedSlab);
    };
    inlineBtn.addEventListener('click', handleInlineLookup);
    inlineInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') handleInlineLookup();
    });
  }
}

// Display recognized card with confidence score >= 50% + Dynamic Graded Slab Switcher
function showScannerResult(matchedResult, runnerUps = [], resultsEl = null, activeCondOverride = null) {
  if (!resultsEl) resultsEl = document.getElementById('scanner-results');
  if (!resultsEl || !matchedResult) return;

  const card = matchedResult.card || matchedResult;
  const score = matchedResult.score !== undefined ? Math.round(matchedResult.score) : 100;
  const isHighConfidence = score >= 75;
  const detectedSlab = matchedResult.detectedSlab || null;

  // Determine active pricing condition (defaults to detected slab if scanned, else Raw NM)
  const activeCond = activeCondOverride || (detectedSlab ? detectedSlab.displayLabel : 'Raw NM');
  const isGradedActive = !activeCond.startsWith('Raw');
  const activeSlabObj = isGradedActive ? (() => {
    const parts = activeCond.split(/\s+/);
    const co = parts[0] || 'PSA';
    const sh = parts.slice(1).join(' ').trim() || '10';
    const scale = GRADING_SCALES[co] || GRADING_SCALES.PSA;
    const found = scale.find(g => g.short === sh || g.grade === sh || g.grade.startsWith(sh)) || scale[0];
    return { company: co, grade: found.grade, short: found.short, displayLabel: `${co} ${found.short}` };
  })() : null;

  const multInfo = resolveConditionMultiplier(activeCond, card);
  const margin = (typeof netMargin === 'function') ? netMargin(card, activeCond) : null;
  const roi = (typeof netROI === 'function') ? netROI(card, activeCond) : null;
  const frActive = (typeof getActiveFrPrice === 'function') ? getActiveFrPrice(card, activeCond) : null;
  const jpActive = (typeof getActiveJpPrice === 'function') ? getActiveJpPrice(card, activeCond) : null;
  const hasPrices = (margin !== null && roi !== null && frActive !== null && jpActive !== null);

  const profitCls = hasPrices && margin >= 0 ? 'text-emerald-400' : 'text-red-400';
  const marginSign = hasPrices && margin >= 0 ? '+' : '';

  const cardCountry = (typeof COUNTRIES !== 'undefined') ? COUNTRIES.find(c => c.code === card.edition) : null;
  const editionFlag = cardCountry ? cardCountry.flag : '🌐';

  const highResImg = (typeof formatHighResCardImage === 'function')
    ? formatHighResCardImage(card.image)
    : card.image;

  // Header status styling based on strict thresholds
  const statusColor = isHighConfidence ? 'text-emerald-400' : 'text-amber-400';
  const statusIcon = isHighConfidence ? 'check-circle' : 'alert-triangle';
  const statusTitle = matchedResult.ocrVerified
    ? 'Identifiée à 100% par OCR'
    : (isHighConfidence ? 'Carte identifiée avec certitude' : '⚠️ Correspondance probable mais incertaine');
  const scoreBadgeBg = isHighConfidence
    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
    : 'bg-amber-500/20 text-amber-300 border-amber-500/40';

  // Explicit banner for 50-74% uncertain matches
  const uncertainBannerHtml = !isHighConfidence ? `
    <div class="bg-amber-500/15 border border-amber-500/40 rounded-xl p-3 text-amber-200 text-xs flex items-center gap-2.5 text-left">
      <span class="text-lg flex-shrink-0">⚠️</span>
      <div class="min-w-0 flex-1">
        <div class="font-bold text-amber-300 text-xs">⚠️ Correspondance probable mais incertaine</div>
        <div class="text-[10px] text-white/70 mt-0.5">Score de similarité structurelle de ${score}% (&lt; 75%). Vérifiez l'illustration ci-dessous ou tapez la référence directe.</div>
      </div>
    </div>
  ` : '';

  const isPurchased = (typeof state !== 'undefined' && state.purchasedCards)
    ? state.purchasedCards.find(p => p.card.id === card.id)
    : null;

  const checklistBadgeHtml = isPurchased ? `
    <span class="scanner-badge-checklist bg-blue-950/80 text-blue-300 border border-blue-500/40">
      <i data-lucide="check" style="width:12px;height:12px;"></i>
      <span>Dans vos achats (x${isPurchased.quantity})</span>
    </span>
  ` : `
    <button type="button" id="scanner-add-checklist-btn" class="scanner-badge-checklist bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 cursor-pointer transition-colors">
      <i data-lucide="plus" style="width:12px;height:12px;"></i>
      <span>Ajouter (${activeCond})</span>
    </button>
  `;

  const ocrBadgeHtml = matchedResult.ocrSerial ? `
    <span class="scanner-badge-checklist bg-blue-950/80 text-blue-300 border border-blue-500/40">
      <i data-lucide="binary" style="width:12px;height:12px;"></i>
      <span>OCR n° ${matchedResult.ocrSerial}</span>
    </span>
  ` : '';

  const slabBadgeHtml = detectedSlab ? `
    <span class="scanner-badge-checklist bg-indigo-950/90 text-indigo-200 border border-indigo-400/50">
      <i data-lucide="shield-check" style="width:12px;height:12px;"></i>
      <span>Slab détecté : ${detectedSlab.displayLabel}</span>
    </span>
  ` : '';

  const validationPillsHtml = isHighConfidence ? `
    <div class="flex items-center justify-center gap-1.5 flex-wrap">
      ${matchedResult.ocrVerified ? `
        <span class="scanner-badge-checklist bg-emerald-950/80 text-emerald-300 border border-emerald-500/40">
          <i data-lucide="check-circle" style="width:12px;height:12px;"></i>
          <span>Match catalogue TCGdex 100%</span>
        </span>
      ` : `
        <span class="scanner-badge-checklist bg-emerald-950/80 text-emerald-300 border border-emerald-500/40">
          <i data-lucide="check-circle" style="width:12px;height:12px;"></i>
          <span>Grille structurelle 4x4 validée (≥ 75%)</span>
        </span>
      `}
      ${ocrBadgeHtml}
      ${slabBadgeHtml}
      <span class="scanner-badge-checklist bg-white/10 text-white/80 border border-white/10">
        <span>${editionFlag} ${card.edition || 'JP'}</span>
      </span>
      ${checklistBadgeHtml}
    </div>
  ` : `
    <div class="flex items-center justify-center gap-1.5 flex-wrap">
      <span class="scanner-badge-checklist bg-amber-950/80 text-amber-300 border border-amber-500/40">
        <i data-lucide="alert-triangle" style="width:12px;height:12px;"></i>
        <span>Similarité modérée (${score}%)</span>
      </span>
      ${ocrBadgeHtml}
      ${slabBadgeHtml}
      <span class="scanner-badge-checklist bg-white/10 text-white/80 border border-white/10">
        <span>${editionFlag} ${card.edition || 'JP'}</span>
      </span>
      ${checklistBadgeHtml}
    </div>
  `;

  // Quick Raw / Graded Condition Switcher inside Scanner Result
  const quickCondOptions = ['Raw NM', 'PSA 9', 'PSA 10', 'BGS 9.5', 'ARS 10'];
  if (detectedSlab && !quickCondOptions.includes(detectedSlab.displayLabel)) {
    quickCondOptions.splice(1, 0, detectedSlab.displayLabel);
  }
  const conditionSwitcherHtml = `
    <div class="flex items-center gap-1 overflow-x-auto pb-0.5 justify-center flex-wrap">
      ${quickCondOptions.map(opt => {
        const isAct = opt === activeCond;
        return `<button type="button" class="scanner-cond-btn text-[10px] font-bold px-2 py-1 rounded-lg border transition-all cursor-pointer ${
          isAct
            ? 'bg-emerald-500 text-slate-900 border-emerald-400 shadow-sm'
            : 'bg-white/5 text-white/70 border-white/15 hover:bg-white/15 hover:text-white'
        }" data-cond="${opt}">${opt}</button>`;
      }).join('')}
    </div>
  `;

  const spreadOriginLabel = isGradedActive && hasPrices ? (
    multInfo.source === 'direct_sold'
      ? 'Ventes slab réelles'
      : (multInfo.source === 'market_spread' ? 'Spread marché observé' : `Spread historique (×${multInfo.frMult.toFixed(2)})`)
  ) : '';

  const pricingSectionHtml = hasPrices ? `
    <div class="text-xs text-white/85 mt-1 font-medium">
      <span class="text-emerald-300 font-bold">${activeCond}</span> · JP: ¥${jpActive.toLocaleString('fr-FR')} → FR: ${frActive.toFixed(2)} €
    </div>
    <div class="text-xs font-bold ${profitCls} mt-0.5">
      Marge: ${marginSign}${margin.toFixed(2)} € (${marginSign}${roi.toFixed(0)}%)
    </div>
    ${spreadOriginLabel ? `<div class="text-[9px] text-white/45 mt-0.5">${spreadOriginLabel}</div>` : ''}
  ` : `
    <div class="mt-1 flex items-center">
      <span class="price-pending-badge">
        <span class="price-pending-dot"></span>
        Prix non disponible / En cours d'actualisation
      </span>
    </div>
  `;

  const runnerUpsHtml = (runnerUps && runnerUps.length > 0) ? `
    <div class="border-t border-white/10 pt-2.5 mt-2">
      <div class="text-[11px] font-bold text-white/70 uppercase tracking-wider mb-2 flex items-center justify-between text-left">
        <span class="flex items-center gap-1.5">
          <i data-lucide="help-circle" style="width:13px;height:13px;" class="text-amber-400"></i>
          <span>Pas la bonne carte ?</span>
        </span>
        <span class="text-[10px] text-white/40 normal-case font-normal">Top suggestions</span>
      </div>
      <div class="grid grid-cols-1 gap-1.5">
        ${runnerUps.map((item, idx) => {
          const rCard = item.card;
          const rScore = Math.round(item.score);
          const rCountry = (typeof COUNTRIES !== 'undefined') ? COUNTRIES.find(c => c.code === rCard.edition) : null;
          const rFlag = rCountry ? rCountry.flag : '🌐';
          const rImg = (typeof formatHighResCardImage === 'function') ? formatHighResCardImage(rCard.image) : rCard.image;
          return `
            <div class="scanner-runner-card flex items-center justify-between gap-2 p-1.5 px-2.5 rounded-xl bg-white/5 hover:bg-white/15 border border-white/10 hover:border-emerald-400/50 transition-all text-left cursor-pointer group" data-idx="${idx}" data-card-id="${rCard.id}">
              <div class="flex items-center gap-2 min-w-0 flex-1">
                <img src="${rImg}" class="w-8 h-11 object-cover rounded flex-shrink-0 border border-white/20 shadow-sm" alt="${rCard.name}" onerror="onCardImageError(this)">
                <div class="min-w-0 flex-1">
                  <div class="text-xs font-semibold text-white truncate group-hover:text-emerald-300 transition-colors">
                    <span>${rFlag}</span> ${rCard.name}
                  </div>
                  <div class="text-[10px] text-white/50 truncate font-mono">${rCard.ref || ''}</div>
                </div>
              </div>
              <div class="flex items-center gap-1.5 flex-shrink-0">
                <span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-white/10 text-white/80 border border-white/10">
                  ${rScore}%
                </span>
                <button type="button" class="scanner-runner-open text-[10px] font-bold text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/25 border border-emerald-500/30 rounded-lg px-2 py-1 transition-all" data-card-id="${rCard.id}">
                  Voir
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  ` : '';

  const manualBoxHtml = !isHighConfidence ? `
    <div class="border-t border-white/10 pt-2 text-left">
      <label class="text-[10px] text-white/60 block mb-1">Ou tapez directement la référence :</label>
      <div class="flex gap-2">
        <input id="scanner-inline-manual-ref" type="text" placeholder="ex: 201/165"
               class="flex-1 px-3 py-1.5 rounded-xl bg-white/10 border border-white/20 text-white placeholder:text-white/40 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-400">
        <button id="scanner-inline-manual-btn" class="bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-bold px-3 py-1.5 rounded-xl text-xs transition-colors cursor-pointer">OK</button>
      </div>
    </div>
  ` : '';

  resultsEl.innerHTML = `
    <div class="bg-slate-900/95 border ${isHighConfidence ? 'border-emerald-500/40' : 'border-amber-500/40'} backdrop-blur-md rounded-2xl p-3.5 text-white max-w-sm mx-auto shadow-2xl space-y-3">
      <!-- Status bar -->
      <div class="flex items-center justify-between border-b border-white/10 pb-2.5">
        <div class="flex items-center gap-1.5 ${statusColor} font-bold text-xs uppercase tracking-wide">
          <i data-lucide="${statusIcon}" style="width:14px;height:14px;"></i>
          <span>${statusTitle}</span>
        </div>
        <span class="text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${scoreBadgeBg}">
          ${score}% ${matchedResult.ocrVerified ? 'OCR vérifié' : 'structure valide'}
        </span>
      </div>

      <!-- Uncertain Banner (if score 50-74%) -->
      ${uncertainBannerHtml}

      <!-- Match Validation Pills & Checklist Badges -->
      ${validationPillsHtml}

      <!-- Dynamic Raw / Graded Slab Valuation Switcher -->
      ${conditionSwitcherHtml}

      <!-- Primary Card Info -->
      <div class="flex gap-3 items-center bg-white/5 border border-white/10 rounded-xl p-2.5">
        <img src="${highResImg}" class="w-16 h-22 object-cover rounded-lg flex-shrink-0 shadow-lg border border-white/20" alt="${card.name}" onerror="onCardImageError(this)">
        <div class="flex-1 min-w-0 text-left">
          <div class="font-bold text-sm truncate text-white">${card.name}</div>
          ${card.subName ? `<div class="text-white/60 text-[11px] truncate">${card.subName}</div>` : ''}
          <div class="text-white/40 text-[10px] mt-0.5 font-mono">${card.ref || ''}</div>
          ${pricingSectionHtml}
        </div>
      </div>

      <!-- Action Button: Open Full Card Detail View -->
      <button type="button" class="w-full bg-emerald-500 hover:bg-emerald-400 active:scale-[0.98] text-slate-900 text-xs font-bold py-2.5 rounded-xl transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer" id="scanner-open-detail">
        <span>Ouvrir le détail (${activeCond})</span>
        <i data-lucide="arrow-right" style="width:14px;height:14px;"></i>
      </button>

      <!-- Scan next card / rescan button -->
      <button type="button" class="w-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white text-[11px] font-semibold py-1.5 rounded-xl transition-all flex items-center justify-center gap-1 cursor-pointer" id="scanner-rescan-btn">
        <i data-lucide="refresh-cw" style="width:12px;height:12px;"></i>
        <span>Scanner une autre carte / slab</span>
      </button>

      <!-- Runner-ups -->
      ${runnerUpsHtml}

      <!-- Inline manual input if uncertain -->
      ${manualBoxHtml}
    </div>
  `;

  if (typeof lucide !== 'undefined') lucide.createIcons();

  // Bind condition / slab switcher pills
  resultsEl.querySelectorAll('.scanner-cond-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const chosenCond = btn.dataset.cond;
      showScannerResult(matchedResult, runnerUps, resultsEl, chosenCond);
    });
  });

  // Add to purchases checklist button listener (records exact active raw or slab condition)
  const addChecklistBtn = document.getElementById('scanner-add-checklist-btn');
  if (addChecklistBtn) {
    addChecklistBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof addToPurchases === 'function') {
        addToPurchases(card, null, 1, activeCond);
      }
      addChecklistBtn.outerHTML = `
        <span class="scanner-badge-checklist bg-blue-950/80 text-blue-300 border border-blue-500/40">
          <i data-lucide="check" style="width:12px;height:12px;"></i>
          <span>Dans vos achats (x1)</span>
        </span>
      `;
      if (typeof lucide !== 'undefined') lucide.createIcons();
    });
  }

  document.getElementById('scanner-open-detail')?.addEventListener('click', () => {
    closeScanner();
    detailModalState.currentCard = card;
    if (typeof openCardDetail === 'function') {
      openCardDetail(card.id, isGradedActive ? 'graded' : 'raw', activeSlabObj);
    }
  });

  document.getElementById('scanner-rescan-btn')?.addEventListener('click', () => {
    resetScannerPreview();
    document.getElementById('native-camera-input')?.click();
  });

  // Inline manual reference lookup if rendered
  const inlineInput = document.getElementById('scanner-inline-manual-ref');
  const inlineBtn = document.getElementById('scanner-inline-manual-btn');
  if (inlineInput && inlineBtn) {
    const handleInlineLookup = () => {
      runScannerManualLookup(inlineInput.value, resultsEl, detectedSlab);
    };
    inlineBtn.addEventListener('click', handleInlineLookup);
    inlineInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') handleInlineLookup();
    });
  }

  resultsEl.querySelectorAll('.scanner-runner-card').forEach(elem => {
    elem.addEventListener('click', (e) => {
      if (e.target.closest('.scanner-runner-open')) {
        const id = e.target.closest('.scanner-runner-open').dataset.cardId;
        closeScanner();
        if (typeof openCardDetail === 'function') {
          openCardDetail(id, isGradedActive ? 'graded' : 'raw', activeSlabObj);
        }
        return;
      }
      const idx = parseInt(elem.dataset.idx, 10);
      if (!isNaN(idx) && runnerUps[idx]) {
        const selected = runnerUps[idx];
        const newRunners = [matchedResult, ...runnerUps.filter((_, i) => i !== idx)];
        showScannerResult(selected, newRunners.slice(0, 3), resultsEl);
      }
    });
  });
}

function handleScannerFileUpload(file) {
  processCapturedPhoto(file);
}

// Manual Reference Search helper with live dynamic TCGdex serial/name fallback + slab support
async function runScannerManualLookup(rawQuery, resultsEl = null, detectedSlab = null) {
  if (!resultsEl) resultsEl = document.getElementById('scanner-results');
  if (!resultsEl) return;

  const raw = (rawQuery || '').trim();
  if (!raw) return;

  // Detect any inline slab marker typed by the user (e.g. "201/165 PSA 10" or "120/119 ARS 10+")
  const typedSlab = detectedSlab || CardOCR.parseSlabFromText(raw);
  if (typedSlab) {
    applyDetectedSlabToGlobalUI(typedSlab);
  }
  const queryNoSlab = raw
    .replace(/\b(?:PSA|BGS|BECKETT|CGC|PCA|ARS|GRADE)\s*(?:10\+|10\s*(?:BL|BLACK\s*LABEL|PRISTINE)?|9\.5|9|8\.5|8|7)\b/ig, '')
    .trim() || raw;

  const q = queryNoSlab.toLowerCase().replace(/\s*\/\s*/g, '/');
  const cleanNum = q.replace(/^0+/, '');

  const catalog = (typeof CARDS !== 'undefined' && Array.isArray(CARDS)) ? CARDS : [];
  const activeCountries = (typeof state !== 'undefined' && state.filters && state.filters.countries)
    ? state.filters.countries
    : [];

  let matchedList = catalog.filter(c => {
    const ref = (c.ref || '').toLowerCase();
    const name = (c.name || '').toLowerCase();
    const subName = (c.subName || '').toLowerCase();
    const localId = (c.localId || '').toLowerCase();
    const localIdClean = localId.replace(/^0+/, '');
    const id = (c.id || '').toLowerCase();

    return ref.includes(q) ||
           localId === q ||
           (cleanNum && localIdClean === cleanNum) ||
           name.includes(q) ||
           subName.includes(q) ||
           id === q;
  });

  // Prioritize active language edition
  if (activeCountries.length > 0) {
    matchedList.sort((a, b) => {
      const aMatch = activeCountries.includes(a.edition) ? 1 : 0;
      const bMatch = activeCountries.includes(b.edition) ? 1 : 0;
      return bMatch - aMatch;
    });
  }

  // If not found in loaded catalog, query TCGdex API dynamically (by serial first, then by name)
  if (matchedList.length === 0) {
    resultsEl.innerHTML = `
      <div class="bg-slate-900/95 border border-emerald-500/40 rounded-2xl p-4 text-white max-w-sm mx-auto shadow-2xl text-center space-y-2">
        <div class="w-5 h-5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin mx-auto"></div>
        <p class="text-xs text-white/80">Recherche en direct sur le catalogue TCGdex...</p>
      </div>
    `;
    try {
      const parsedSerial = CardOCR.parseSerialFromText(queryNoSlab);
      if (parsedSerial && parsedSerial.cleanLocalId) {
        const serialLive = await CatalogService.lookupCardsBySerial(parsedSerial.serial, parsedSerial.setHint);
        if (serialLive && serialLive.length > 0) {
          matchedList = serialLive;
        }
      }
      if (matchedList.length === 0) {
        const liveCards = await CatalogService.searchLive(queryNoSlab);
        if (liveCards && liveCards.length > 0) {
          matchedList = liveCards;
        }
      }
    } catch (e) {
      console.warn('Manual live search warning:', e);
    }
  }

  if (matchedList.length > 0) {
    const primary = {
      card: matchedList[0],
      score: 100,
      scoreVisual: 100,
      ocrVerified: true,
      detectedSlab: typedSlab
    };
    const runners = matchedList.slice(1, 4).map(c => ({
      card: c,
      score: 95,
      scoreVisual: 95,
      detectedSlab: typedSlab
    }));
    showScannerResult(primary, runners, resultsEl);
  } else {
    resultsEl.innerHTML = `
      <div class="bg-slate-900/95 border border-amber-500/40 rounded-2xl p-4 text-white max-w-sm mx-auto shadow-2xl text-center space-y-2">
        <div class="text-amber-400 font-bold text-xs uppercase tracking-wide flex items-center justify-center gap-1">
          <i data-lucide="alert-triangle" style="width:14px;height:14px;"></i>
          <span>Carte non trouvée</span>
        </div>
        <p class="text-xs text-white/70">Aucune carte trouvée pour <span class="font-mono text-emerald-300">"${raw}"</span> dans le catalogue.</p>
        <p class="text-[11px] text-white/50">Vérifiez le numéro de set (ex: 201/165) ou le nom du Pokémon.</p>
        <button id="scanner-retry-manual-btn" class="bg-white/10 hover:bg-white/20 text-white text-xs font-semibold px-3 py-1.5 rounded-xl transition-all cursor-pointer mt-1">
          Réessayer
        </button>
      </div>
    `;
    if (typeof lucide !== 'undefined') lucide.createIcons();
    document.getElementById('scanner-retry-manual-btn')?.addEventListener('click', () => {
      resetScannerPreview();
    });
  }
}

// ── FOCUS MODE (DESKTOP) ─────────────────────────────────────
function activateFocusMode(col) {
  state.focusCol = col;
  const grid = document.getElementById('columns-grid');
  if (!grid) return;

  ['margin', 'roi', 'velocity'].forEach(key => {
    const wrapper = document.getElementById(`col-wrapper-${key}`);
    const header  = document.getElementById(`col-header-${key}`);
    if (!wrapper || !header) return;
    if (key === col) {
      wrapper.classList.remove('hidden');
      header.classList.add('focus-active');
      const expandIcon = header.querySelector('.col-expand-icon');
      if (expandIcon) expandIcon.setAttribute('data-lucide', 'minimize-2');
      const colEl = document.getElementById(`col-${key}`);
      if (colEl) colEl.className = 'focus-col-inner';
    } else {
      wrapper.classList.add('hidden');
      header.classList.remove('focus-active');
    }
  });

  grid.classList.add('focus-mode');
  grid.style.gridTemplateColumns = '1fr';

  syncFilterBarPlacement();

  const colMap = { margin: getSortedByMargin, roi: getSortedByROI, velocity: getSortedByVelocity };
  renderColumn(`col-${col}`, colMap[col](true), col);
  updateLoadMoreLabels();
  updateColumnCounters();
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function deactivateFocusMode() {
  state.focusCol = null;
  const grid = document.getElementById('columns-grid');
  if (!grid) return;

  ['margin', 'roi', 'velocity'].forEach(key => {
    const wrapper = document.getElementById(`col-wrapper-${key}`);
    const header  = document.getElementById(`col-header-${key}`);
    if (!wrapper || !header) return;
    wrapper.classList.remove('hidden');
    header.classList.remove('focus-active');
    const expandIcon = header.querySelector('.col-expand-icon');
    if (expandIcon) expandIcon.setAttribute('data-lucide', 'maximize-2');
    const colEl = document.getElementById(`col-${key}`);
    if (colEl) colEl.className = 'flex flex-col gap-2';
  });

  grid.classList.remove('focus-mode');
  grid.style.gridTemplateColumns = '';

  syncFilterBarPlacement();
  renderAllColumns();
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ── BIND EVENTS ──────────────────────────────────────────────
function bindEvents() {
  // Modal overlay close
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });

  // Close buttons
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-close-modal]');
    if (btn) closeModal(btn.dataset.closeModal);
  });

  // Refresh (re-fetches rate + multi-language sets + prices.json)
  const btnRefresh = document.getElementById('btn-refresh');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      showToast('🔄 Actualisation en direct…');
      fetchLiveRate();
      CatalogService.fetchAllMultiLangSets();
      PriceService.loadPricesJson();
    });
  }

  // Pricing Reference Selectors
  const pricingRefFr = document.getElementById('pricing-ref-fr');
  if (pricingRefFr) {
    pricingRefFr.addEventListener('change', () => {
      state.pricingRefFr = pricingRefFr.value;
      renderAllColumns();
      showToast(`Base FR : ${pricingRefFr.options[pricingRefFr.selectedIndex].text}`);
    });
  }

  const pricingRefJp = document.getElementById('pricing-ref-jp');
  if (pricingRefJp) {
    pricingRefJp.addEventListener('change', () => {
      state.pricingRefJp = pricingRefJp.value;
      renderAllColumns();
      showToast(`Base JP : ${pricingRefJp.options[pricingRefJp.selectedIndex].text}`);
    });
  }

  // Search input
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', () => handleSearch(searchInput.value));
    document.addEventListener('click', e => {
      const dropdown = document.getElementById('search-dropdown');
      if (dropdown && !searchInput.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.add('hidden');
      }
    });
  }

  // Mobile tab buttons
  document.querySelectorAll('.mobile-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      if (!tab) return;
      state.activeMobileTab = tab;
      document.querySelectorAll('.mobile-tab').forEach(b => {
        b.classList.toggle('mobile-tab-active', b.dataset.tab === tab);
      });
      renderMobileColumn();
      updateFilterMatchCount();
      updateColumnCounters();
    });
  });

  // Mobile load more
  const mobileLoadMore = document.getElementById('mobile-load-more');
  if (mobileLoadMore) {
    mobileLoadMore.addEventListener('click', () => {
      const currentTab = state.activeMobileTab || 'margin';
      const cards = getCardsForTab(currentTab, isFilterModeActive());
      state.visibleCount[currentTab] = nextPageStep(state.visibleCount[currentTab], cards.length);
      renderMobileColumn();
      updateLoadMoreLabels();
    });
  }

  // Desktop load more
  const lmMargin = document.getElementById('load-more-margin');
  if (lmMargin) {
    lmMargin.addEventListener('click', () => {
      const isFocused = state.focusCol === 'margin';
      const cards = getSortedByMargin(isFocused);
      state.visibleCount.margin = nextPageStep(state.visibleCount.margin, cards.length);
      renderColumn('col-margin', cards, 'margin');
      updateLoadMoreLabels();
      renderMobileColumn();
      updateColumnCounters();
    });
  }
  const lmRoi = document.getElementById('load-more-roi');
  if (lmRoi) {
    lmRoi.addEventListener('click', () => {
      const isFocused = state.focusCol === 'roi';
      const cards = getSortedByROI(isFocused);
      state.visibleCount.roi = nextPageStep(state.visibleCount.roi, cards.length);
      renderColumn('col-roi', cards, 'roi');
      updateLoadMoreLabels();
      renderMobileColumn();
      updateColumnCounters();
    });
  }
  const lmVelocity = document.getElementById('load-more-velocity');
  if (lmVelocity) {
    lmVelocity.addEventListener('click', () => {
      const isFocused = state.focusCol === 'velocity';
      const cards = getSortedByVelocity(isFocused);
      state.visibleCount.velocity = nextPageStep(state.visibleCount.velocity, cards.length);
      renderColumn('col-velocity', cards, 'velocity');
      updateLoadMoreLabels();
      renderMobileColumn();
      updateColumnCounters();
    });
  }

  // Column header focus toggle (Desktop)
  document.querySelectorAll('.col-header').forEach(header => {
    header.addEventListener('click', () => {
      const col = header.dataset.col;
      if (state.focusCol === col) {
        deactivateFocusMode();
      } else {
        activateFocusMode(col);
      }
    });
  });

  // Country popover trigger
  const btnFilterCountry = document.getElementById('btn-filter-country');
  if (btnFilterCountry) {
    btnFilterCountry.addEventListener('click', e => {
      e.stopPropagation();
      togglePopover('country');
    });
  }

  // Country search input inside popover
  const inputSearchCountry = document.getElementById('input-search-country');
  if (inputSearchCountry) {
    inputSearchCountry.addEventListener('input', e => {
      renderCountryOptionsList(e.target.value);
    });
  }

  // Country clear button
  const btnClearCountry = document.getElementById('btn-clear-country');
  if (btnClearCountry) {
    btnClearCountry.addEventListener('click', () => {
      state.filters.countries = [];
      updateCountryTriggerLabel();
      const searchVal = document.getElementById('input-search-country')?.value || '';
      renderCountryOptionsList(searchVal);
      applyFilters();
    });
  }

  // Price popover trigger
  const btnFilterPrice = document.getElementById('btn-filter-price');
  if (btnFilterPrice) {
    btnFilterPrice.addEventListener('click', e => {
      e.stopPropagation();
      togglePopover('price');
    });
  }

  // Price currency toggle
  document.querySelectorAll('#price-currency-toggle .price-curr-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const curr = btn.dataset.curr;
      if (!curr || curr === state.filters.priceUnit) return;

      document.querySelectorAll('#price-currency-toggle .price-curr-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.curr === curr);
      });

      const minInput = document.getElementById('input-price-min');
      const maxInput = document.getElementById('input-price-max');
      const symbolEl = document.getElementById('price-unit-symbol');

      if (curr === 'JPY') {
        state.filters.priceUnit = 'JPY';
        if (symbolEl) symbolEl.textContent = '¥';
        if (minInput && minInput.value !== '') {
          minInput.value = Math.round(parseFloat(minInput.value) * state.rate);
          state.filters.priceMin = parseFloat(minInput.value);
        }
        if (maxInput && maxInput.value !== '') {
          maxInput.value = Math.round(parseFloat(maxInput.value) * state.rate);
          state.filters.priceMax = parseFloat(maxInput.value);
        }
      } else {
        state.filters.priceUnit = 'EUR';
        if (symbolEl) symbolEl.textContent = '€';
        if (minInput && minInput.value !== '') {
          minInput.value = (parseFloat(minInput.value) / state.rate).toFixed(1);
          state.filters.priceMin = parseFloat(minInput.value);
        }
        if (maxInput && maxInput.value !== '') {
          maxInput.value = (parseFloat(maxInput.value) / state.rate).toFixed(1);
          state.filters.priceMax = parseFloat(maxInput.value);
        }
      }

      renderPricePresets();
      updatePriceTriggerLabel();
      applyFilters();
    });
  });

  // Price Min / Max manual inputs
  const inputPriceMin = document.getElementById('input-price-min');
  if (inputPriceMin) {
    inputPriceMin.addEventListener('input', () => {
      const val = inputPriceMin.value.trim();
      state.filters.priceMin = val !== '' ? parseFloat(val) : null;
      renderPricePresets();
      updatePriceTriggerLabel();
      applyFilters();
    });
  }

  const inputPriceMax = document.getElementById('input-price-max');
  if (inputPriceMax) {
    inputPriceMax.addEventListener('input', () => {
      const val = inputPriceMax.value.trim();
      state.filters.priceMax = val !== '' ? parseFloat(val) : null;
      renderPricePresets();
      updatePriceTriggerLabel();
      applyFilters();
    });
  }

  // Clear Price button
  const btnClearPrice = document.getElementById('btn-clear-price');
  if (btnClearPrice) {
    btnClearPrice.addEventListener('click', () => {
      state.filters.priceMin = null;
      state.filters.priceMax = null;

      const minInput = document.getElementById('input-price-min');
      const maxInput = document.getElementById('input-price-max');
      if (minInput) minInput.value = '';
      if (maxInput) maxInput.value = '';

      renderPricePresets();
      updatePriceTriggerLabel();
      applyFilters();
    });
  }

  // Global Reset Filters
  const resetBtn = document.getElementById('filter-reset-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      state.filters.countries = [];
      state.filters.priceMin = null;
      state.filters.priceMax = null;
      state.filters.priceUnit = 'EUR';

      const inputSearch = document.getElementById('input-search-country');
      if (inputSearch) inputSearch.value = '';
      renderCountryOptionsList();
      updateCountryTriggerLabel();

      document.querySelectorAll('#price-currency-toggle .price-curr-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.curr === 'EUR');
      });
      const symbolEl = document.getElementById('price-unit-symbol');
      if (symbolEl) symbolEl.textContent = '€';
      const minInput = document.getElementById('input-price-min');
      const maxInput = document.getElementById('input-price-max');
      if (minInput) minInput.value = '';
      if (maxInput) maxInput.value = '';
      renderPricePresets();
      updatePriceTriggerLabel();

      closeAllPopovers();
      applyFilters();
      showToast('Filtres réinitialisés');
    });
  }

  // Close popovers on outside click
  document.addEventListener('click', e => {
    const countryWrapper = document.getElementById('country-popover-wrapper');
    const priceWrapper = document.getElementById('price-popover-wrapper');
    const condWrapper = document.getElementById('condition-popover-wrapper');
    const libCondWrapper = document.getElementById('lib-condition-popover-wrapper');

    if (countryWrapper && !countryWrapper.contains(e.target)) {
      const p = document.getElementById('popover-filter-country');
      const b = document.getElementById('btn-filter-country');
      if (p) p.classList.add('hidden');
      if (b) b.classList.remove('open');
    }
    if (priceWrapper && !priceWrapper.contains(e.target)) {
      const p = document.getElementById('popover-filter-price');
      const b = document.getElementById('btn-filter-price');
      if (p) p.classList.add('hidden');
      if (b) b.classList.remove('open');
    }
    if (condWrapper && !condWrapper.contains(e.target)) {
      const p = document.getElementById('popover-filter-condition');
      const b = document.getElementById('btn-filter-condition');
      if (p) p.classList.add('hidden');
      if (b) b.classList.remove('open');
    }
    if (libCondWrapper && !libCondWrapper.contains(e.target)) {
      const p = document.getElementById('popover-lib-filter-condition');
      const b = document.getElementById('btn-lib-filter-condition');
      if (p) p.classList.add('hidden');
      if (b) b.classList.remove('open');
    }
  });

  // Condition popover triggers (Focus Filter Bar & Library Modal)
  const btnFilterCondition = document.getElementById('btn-filter-condition');
  if (btnFilterCondition) {
    btnFilterCondition.addEventListener('click', e => {
      e.stopPropagation();
      toggleConditionPopover('main');
    });
  }

  const btnLibFilterCondition = document.getElementById('btn-lib-filter-condition');
  if (btnLibFilterCondition) {
    btnLibFilterCondition.addEventListener('click', e => {
      e.stopPropagation();
      toggleConditionPopover('lib');
    });
  }

  renderConditionPopovers();
  updateConditionTriggerLabels();

  // Escape key closes popovers & scanner
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeScanner();
      closeAllPopovers();
    }
  });

  window.addEventListener('resize', () => {
    syncFilterBarPlacement();
  });

  // ── SCANNER BUTTON & OVERLAY (NATIVE CAMERA CAPTURE) ──
  const btnScanner = document.getElementById('btn-scanner');
  if (btnScanner) {
    btnScanner.addEventListener('click', openScanner);
  }

  const scannerCloseBtn = document.getElementById('scanner-close-btn');
  if (scannerCloseBtn) {
    scannerCloseBtn.addEventListener('click', closeScanner);
  }

  // Native camera trigger button
  const scannerNativeBtn = document.getElementById('scanner-native-btn');
  const nativeCameraInput = document.getElementById('native-camera-input');
  if (scannerNativeBtn && nativeCameraInput) {
    scannerNativeBtn.addEventListener('click', () => {
      nativeCameraInput.click();
    });
  }

  // Preview silhouette frame click also opens camera
  const previewWrapper = document.getElementById('scanner-preview-wrapper');
  if (previewWrapper && nativeCameraInput) {
    previewWrapper.addEventListener('click', () => {
      nativeCameraInput.click();
    });
  }

  // Backdrop click closes scanner
  const modalScanner = document.getElementById('modal-scanner');
  if (modalScanner) {
    modalScanner.addEventListener('click', e => {
      if (e.target === modalScanner) {
        closeScanner();
      }
    });
  }

  if (nativeCameraInput) {
    nativeCameraInput.addEventListener('change', () => {
      if (nativeCameraInput.files && nativeCameraInput.files[0]) {
        processCapturedPhoto(nativeCameraInput.files[0]);
      }
    });
  }

  // Gallery file button & fallback
  const scannerGalleryBtn = document.getElementById('scanner-gallery-btn');
  const scannerFileFallback = document.getElementById('scanner-file-fallback');
  if (scannerGalleryBtn && scannerFileFallback) {
    scannerGalleryBtn.addEventListener('click', () => {
      scannerFileFallback.click();
    });
  }

  if (scannerFileFallback) {
    scannerFileFallback.addEventListener('change', () => {
      if (scannerFileFallback.files && scannerFileFallback.files[0]) {
        processCapturedPhoto(scannerFileFallback.files[0]);
        scannerFileFallback.value = '';
      }
    });
  }

  const scannerManualBtn = document.getElementById('scanner-manual-btn');
  const scannerManualRef = document.getElementById('scanner-manual-ref');
  if (scannerManualBtn && scannerManualRef) {
    const triggerManual = () => {
      runScannerManualLookup(scannerManualRef.value);
    };
    scannerManualBtn.addEventListener('click', triggerManual);
    scannerManualRef.addEventListener('keydown', e => {
      if (e.key === 'Enter') triggerManual();
    });
  }

  // ── LIBRARY MODAL & FILTERS ──
  const btnLibrary = document.getElementById('btn-library');
  if (btnLibrary) {
    btnLibrary.addEventListener('click', () => {
      libraryState.editions = ['all'];
      libraryState.search = '';
      libraryState.year = 'all';
      renderConditionPopovers();
      updateConditionTriggerLabels();
      document.querySelectorAll('[data-lib-edition]').forEach(b => {
        b.classList.toggle('active', b.dataset.libEdition === 'all');
      });
      const sInput = document.getElementById('library-search');
      if (sInput) sInput.value = '';
      renderLibrary();
      openModal('modal-library');
      if (typeof lucide !== 'undefined') lucide.createIcons();
    });
  }

  // Library Edition Pills (Multi-select)
  document.querySelectorAll('[data-lib-edition]').forEach(btn => {
    btn.addEventListener('click', () => {
      const ed = btn.dataset.libEdition;
      if (ed === 'all') {
        libraryState.editions = ['all'];
      } else {
        const allIdx = libraryState.editions.indexOf('all');
        if (allIdx > -1) libraryState.editions.splice(allIdx, 1);

        const idx = libraryState.editions.indexOf(ed);
        if (idx > -1) {
          libraryState.editions.splice(idx, 1);
        } else {
          libraryState.editions.push(ed);
        }
        if (libraryState.editions.length === 0) {
          libraryState.editions = ['all'];
        }
      }

      document.querySelectorAll('[data-lib-edition]').forEach(b => {
        const bEd = b.dataset.libEdition;
        if (libraryState.editions.includes('all')) {
          b.classList.toggle('active', bEd === 'all');
        } else {
          b.classList.toggle('active', libraryState.editions.includes(bEd));
        }
      });
      renderLibrary();
    });
  });

  const libSearch = document.getElementById('library-search');
  if (libSearch) {
    libSearch.addEventListener('input', () => {
      libraryState.search = libSearch.value.trim();
      renderLibrary();
    });
  }

  const libPlatFr = document.getElementById('lib-filter-platform-fr');
  if (libPlatFr) {
    libPlatFr.addEventListener('change', () => {
      libraryState.platformFr = libPlatFr.value;
      renderLibrary();
    });
  }

  const libPlatJp = document.getElementById('lib-filter-platform-jp');
  if (libPlatJp) {
    libPlatJp.addEventListener('change', () => {
      libraryState.platformJp = libPlatJp.value;
      renderLibrary();
    });
  }

  const libYear = document.getElementById('lib-filter-year');
  if (libYear) {
    libYear.addEventListener('change', () => {
      libraryState.year = libYear.value;
      renderLibrary();
    });
  }

  // ── PURCHASES MODAL & CSV ──
  const btnPurchases = document.getElementById('btn-purchases');
  if (btnPurchases) {
    btnPurchases.addEventListener('click', () => {
      renderPurchases();
      openModal('modal-purchases');
      setupQuickEntry();
      if (typeof lucide !== 'undefined') lucide.createIcons();
    });
  }

  const btnExportCSV = document.getElementById('btn-export-csv');
  if (btnExportCSV) {
    btnExportCSV.addEventListener('click', exportCSV);
  }

  // Scroll to top
  const btnScrollTop = document.getElementById('btn-scroll-top');
  if (btnScrollTop) {
    btnScrollTop.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    window.addEventListener('scroll', () => {
      btnScrollTop.classList.toggle('hidden', window.scrollY <= 300);
    }, { passive: true });
  }
}

// ── INIT ─────────────────────────────────────────────────────
function initApp() {
  // Step 1: Base state defaults & initial timestamp
  try {
    updateTimestamp();
    state.activeMobileTab = 'margin';
    state.pricingRefFr = 'avg';
    state.pricingRefJp = 'min';
  } catch (err) {
    console.error('[PokéSpread] Init error in base state/timestamp:', err);
  }

  // Step 2: Instant rate display (prevents 1€=—¥ from displaying while async rate fetches)
  try {
    const liveRateEl = document.getElementById('live-rate');
    if (liveRateEl && (!liveRateEl.textContent || liveRateEl.textContent.trim() === '—')) {
      liveRateEl.textContent = (state.rate || 163.5).toFixed(2);
    }
  } catch (err) {
    console.error('[PokéSpread] Init error in initial live rate setup:', err);
  }

  // Step 3: Filter UI components & triggers
  try {
    renderCountryOptionsList();
  } catch (err) {
    console.error('[PokéSpread] Init error in renderCountryOptionsList:', err);
  }

  try {
    renderPricePresets();
  } catch (err) {
    console.error('[PokéSpread] Init error in renderPricePresets:', err);
  }

  try {
    updateCountryTriggerLabel();
  } catch (err) {
    console.error('[PokéSpread] Init error in updateCountryTriggerLabel:', err);
  }

  try {
    updatePriceTriggerLabel();
  } catch (err) {
    console.error('[PokéSpread] Init error in updatePriceTriggerLabel:', err);
  }

  try {
    updateConditionTriggerLabels();
    renderConditionPopovers();
  } catch (err) {
    console.error('[PokéSpread] Init error in condition trigger labels/popovers:', err);
  }

  // Step 4: Core recommendation rendering & counters (Renders dynamic cards)
  try {
    renderAllColumns();
  } catch (err) {
    console.error('[PokéSpread] Init error in renderAllColumns:', err);
  }

  try {
    renderMobileColumn();
  } catch (err) {
    console.error('[PokéSpread] Init error in renderMobileColumn:', err);
  }

  try {
    syncFilterBarPlacement();
  } catch (err) {
    console.error('[PokéSpread] Init error in syncFilterBarPlacement:', err);
  }

  try {
    updateColumnCounters();
  } catch (err) {
    console.error('[PokéSpread] Init error in updateColumnCounters:', err);
  }

  // Step 5: Event listeners, badges & icons
  try {
    bindEvents();
  } catch (err) {
    console.error('[PokéSpread] Init error in bindEvents:', err);
  }

  try {
    updatePurchaseBadge();
  } catch (err) {
    console.error('[PokéSpread] Init error in updatePurchaseBadge:', err);
  }

  try {
    if (typeof lucide !== 'undefined' && lucide.createIcons) {
      lucide.createIcons();
    }
  } catch (err) {
    console.error('[PokéSpread] Init error creating Lucide icons:', err);
  }

  // Step 6: Non-blocking async background fetch tasks
  try {
    fetchLiveRate().catch(err => console.warn('[PokéSpread] Background live rate warning:', err));
  } catch (err) {
    console.warn('[PokéSpread] fetchLiveRate error:', err);
  }

  try {
    if (typeof CatalogService !== 'undefined' && CatalogService.initCatalog) {
      CatalogService.initCatalog().catch(err => console.warn('[PokéSpread] Background CatalogService warning:', err));
    }
  } catch (err) {
    console.warn('[PokéSpread] CatalogService error:', err);
  }

  try {
    if (typeof PriceService !== 'undefined' && PriceService.loadPricesJson) {
      PriceService.loadPricesJson().catch(err => console.warn('[PokéSpread] Background PriceService warning:', err));
    }
  } catch (err) {
    console.warn('[PokéSpread] PriceService error:', err);
  }
}

function safeInit() {
  try {
    initApp();
  } catch (globalErr) {
    console.error('[PokéSpread] Critical unexpected error during initApp:', globalErr);
    // Emergency fallback to ensure columns and counters are not empty
    try {
      renderAllColumns();
      updateColumnCounters();
      const liveRateEl = document.getElementById('live-rate');
      if (liveRateEl && liveRateEl.textContent === '—') {
        liveRateEl.textContent = (state.rate || 163.5).toFixed(2);
      }
    } catch (fallbackErr) {
      console.error('[PokéSpread] Emergency fallback render failed:', fallbackErr);
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', safeInit);
} else {
  safeInit();
}
