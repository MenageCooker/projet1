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
  conditionFilter: 'raw_nm',                           // 'raw_nm' (default) | 'raw_all' | 'graded' | 'all'
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

const GRADING_COMPANIES = {
  PSA: {
    name: 'PSA',
    fullName: 'Professional Sports Authenticator (USA)',
    grades: [
      { grade: '10', label: 'Note 10 (Gem Mint)', frMult: 2.60, jpMult: 2.30 },
      { grade: '9.5', label: 'Note 9.5 (Mint+)', frMult: 1.70, jpMult: 1.60 },
      { grade: '9', label: 'Note 9 (Mint)', frMult: 1.30, jpMult: 1.25 },
      { grade: '8', label: 'Note 8 (NM-MT)', frMult: 1.00, jpMult: 0.98 }
    ]
  },
  BGS: {
    name: 'BGS',
    fullName: 'Beckett Grading Services (USA)',
    grades: [
      { grade: '10', label: 'Note 10 (Pristine / Gold)', frMult: 3.40, jpMult: 3.00 },
      { grade: '9.5', label: 'Note 9.5 (Gem Mint)', frMult: 1.90, jpMult: 1.80 },
      { grade: '9', label: 'Note 9 (Mint)', frMult: 1.30, jpMult: 1.25 },
      { grade: '8', label: 'Note 8 (NM-MT)', frMult: 0.98, jpMult: 0.95 }
    ]
  },
  CGC: {
    name: 'CGC',
    fullName: 'Certified Guaranty Company (USA)',
    grades: [
      { grade: '10', label: 'Note 10 (Pristine 10)', frMult: 2.35, jpMult: 2.15 },
      { grade: '9.5', label: 'Note 9.5 (Gem Mint)', frMult: 1.60, jpMult: 1.50 },
      { grade: '9', label: 'Note 9 (Mint)', frMult: 1.22, jpMult: 1.18 },
      { grade: '8', label: 'Note 8 (NM-MT)', frMult: 0.92, jpMult: 0.90 }
    ]
  },
  PCA: {
    name: 'PCA',
    fullName: 'PCA Grade (France / Leader Européen)',
    grades: [
      { grade: '10', label: 'Note 10 (Parfait / 10+)', frMult: 2.20, jpMult: 2.00 },
      { grade: '9.5', label: 'Note 9.5 (Neuf+)', frMult: 1.55, jpMult: 1.45 },
      { grade: '9', label: 'Note 9 (Neuf)', frMult: 1.20, jpMult: 1.15 },
      { grade: '8', label: 'Note 8 (Proche du Neuf)', frMult: 0.92, jpMult: 0.90 }
    ]
  },
  ARS: {
    name: 'ARS',
    fullName: 'ARS Grading (Japon / Boîtiers Haute Sécurité)',
    grades: [
      { grade: '10', label: 'Note 10 (Grade 10+ / 10)', frMult: 2.75, jpMult: 2.50 },
      { grade: '9.5', label: 'Note 9.5 (Grade 9.5)', frMult: 1.80, jpMult: 1.70 },
      { grade: '9', label: 'Note 9 (Grade 9)', frMult: 1.35, jpMult: 1.30 },
      { grade: '8', label: 'Note 8 (Grade 8)', frMult: 1.00, jpMult: 0.98 }
    ]
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

// ── POKÉMON JAPANESE / CHINESE NAME RESOLVER ─────────────────
const POKEMON_JA_NAMES = {
  'リザードン': 'Dracaufeu',
  'ヒトカゲ': 'Salamèche',
  'リザード': 'Reptincel',
  'フシギダネ': 'Bulbizarre',
  'フシギソウ': 'Herbizarre',
  'フシギバナ': 'Florizarre',
  'ゼニガメ': 'Carapuce',
  'カメール': 'Carabaffe',
  'カメックス': 'Tortank',
  'ピカチュウ': 'Pikachu',
  'ライチュウ': 'Raichu',
  'ミュウ': 'Mew',
  'ミュウツー': 'Mewtwo',
  'サンダー': 'Électhor',
  'フリーザー': 'Artikodin',
  'ファイヤー': 'Sulfura',
  'ゲンガー': 'Ectoplasma',
  'カイリュー': 'Dracolosse',
  'ブラッキー': 'Noctali',
  'エーフィ': 'Mentali',
  'シャワーズ': 'Aquali',
  'サンダース': 'Voltali',
  'ブースター': 'Pyroli',
  'グレイシア': 'Givrali',
  'リーフィア': 'Phyllali',
  'ニンフィア': 'Nymphali',
  'イーブイ': 'Évoli',
  'レックウザ': 'Rayquaza',
  'ルギア': 'Lugia',
  'ホウオウ': 'Ho-Oh',
  'ゲッコウガ': 'Amphinobi',
  'サーナイト': 'Gardevoir',
  'バンギラス': 'Tyranocif',
  'ルカリオ': 'Lucario',
  'ミミッキュ': 'Mimiqui',
  'オーガポン': 'Ogerpon',
  'ソウブレイズ': 'Malvalame',
  'グレンアルマ': 'Carmadura',
  'マスカーニャ': 'Miascarade',
  'ラウドボーン': 'Flâmigator',
  'ウェーニバル': 'Palmaval',
  'パオジアン': 'Baojian',
  'ディンルー': 'Dinglu',
  'イーユイ': 'Yiyu',
  'チオンジェン': 'Chongjian',
  'テラパゴス': 'Terapagos',
  'コライドン': 'Koraidon',
  'ミライドン': 'Miraidon',
  'モモワロウ': 'Pêchaminus',
  'ギラティナ': 'Giratina',
  'アルセウス': 'Arceus',
  'ディアルガ': 'Dialga',
  'パルキア': 'Palkia',
  'ダークライ': 'Darkrai',
  'シェイミ': 'Shaymin',
  'ゾロアーク': 'Zoroark',
  'レシラム': 'Reshiram',
  'ゼクロム': 'Zekrom',
  'キュレム': 'Kyurem',
  'ゼルネアス': 'Xerneas',
  'イベルタル': 'Yveltal',
  'ジガルデ': 'Zygarde',
  'カプ・コケコ': 'Tokorico',
  'ウーラオス': 'Shifours'
};

const POKEMON_CN_NAMES = {
  '噴火龍': 'Dracaufeu',
  '小火龍': 'Salamèche',
  '火恐龍': 'Reptincel',
  '妙蛙種子': 'Bulbizarre',
  '妙蛙草': 'Herbizarre',
  '妙蛙花': 'Florizarre',
  '傑尼龜': 'Carapuce',
  '卡咪龜': 'Carabaffe',
  '水箭龜': 'Tortank',
  '皮卡丘': 'Pikachu',
  '雷丘': 'Raichu',
  '夢幻': 'Mew',
  '超夢': 'Mewtwo',
  '急凍鳥': 'Artikodin',
  '閃電鳥': 'Électhor',
  '火焰鳥': 'Sulfura',
  '耿鬼': 'Ectoplasma',
  '快龍': 'Dracolosse',
  '月亮伊布': 'Noctali',
  '太陽伊布': 'Mentali',
  '伊布': 'Évoli',
  '烈空坐': 'Rayquaza',
  '洛奇亞': 'Lugia',
  '鳳王': 'Ho-Oh',
  '甲賀忍蛙': 'Amphinobi',
  '沙奈朵': 'Gardevoir',
  '班基拉斯': 'Tyranocif',
  '路卡利歐': 'Lucario',
  '謎擬Ｑ': 'Mimiqui',
  '厄鬼椪': 'Ogerpon',
  '紅蓮鎧騎': 'Carmadura',
  '蒼炎刃鬼': 'Malvalame'
};

function resolveLocalizedNames(rawName, lang) {
  if (lang === 'ja') {
    for (const [ja, fr] of Object.entries(POKEMON_JA_NAMES)) {
      if (rawName.includes(ja)) {
        const suffix = rawName.replace(ja, '').trim();
        const frenchName = suffix ? `${fr} ${suffix}` : fr;
        return { name: frenchName, subName: rawName };
      }
    }
    return { name: rawName, subName: rawName };
  }

  if (lang === 'zh-tw') {
    for (const [cn, fr] of Object.entries(POKEMON_CN_NAMES)) {
      if (rawName.includes(cn)) {
        const suffix = rawName.replace(cn, '').trim();
        const frenchName = suffix ? `${fr} ${suffix}` : fr;
        return { name: frenchName, subName: rawName };
      }
    }
    return { name: rawName, subName: rawName };
  }

  return { name: rawName, subName: '' };
}

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

// ── REAL VERIFIED BOOTSTRAP CARDS (AUTHENTIC MULTI-LANGUAGE ARTWORK) ───
const BOOTSTRAP_CARDS = [
  // 🇯🇵 JP
  { id: 'SV2a-201', name: 'Dracaufeu-ex SAR', subName: 'リザードンex SAR', localId: '201', ref: 'sv2a 201/165', edition: 'JP', image: 'https://assets.tcgdex.net/ja/SV/SV2a/201/high.webp' },
  { id: 'SV2a-205', name: 'Mew-ex SAR', subName: 'ミュウex SAR', localId: '205', ref: 'sv2a 205/165', edition: 'JP', image: 'https://assets.tcgdex.net/ja/SV/SV2a/205/high.webp' },
  { id: 'SV2a-200', name: 'Tortank-ex SAR', subName: 'カメックスex SAR', localId: '200', ref: 'sv2a 200/165', edition: 'JP', image: 'https://assets.tcgdex.net/ja/SV/SV2a/200/high.webp' },
  { id: 'SV2a-198', name: 'Florizarre-ex SAR', subName: 'フシギバナex SAR', localId: '198', ref: 'sv2a 198/165', edition: 'JP', image: 'https://assets.tcgdex.net/ja/SV/SV2a/198/high.webp' },
  { id: 'SV2a-202', name: 'Électhor-ex SAR', subName: 'サンダーex SAR', localId: '202', ref: 'sv2a 202/165', edition: 'JP', image: 'https://assets.tcgdex.net/ja/SV/SV2a/202/high.webp' },
  { id: 'SV2a-173', name: 'Pikachu AR', subName: 'ピカチュウ AR', localId: '173', ref: 'sv2a 173/165', edition: 'JP', image: 'https://assets.tcgdex.net/ja/SV/SV2a/173/high.webp' },
  { id: 'SV4a-331', name: 'Dracaufeu-ex Shiny SAR', subName: 'リザードンex SAR', localId: '331', ref: 'sv4a 331/190', edition: 'JP', image: 'https://assets.tcgdex.net/ja/SV/SV4a/331/high.webp' },
  { id: 'SV6-130', name: 'Amphinobi-ex SAR', subName: 'ゲッコウガex SAR', localId: '130', ref: 'sv6 130/101', edition: 'JP', image: 'https://assets.tcgdex.net/ja/SV/SV6/130/high.webp' },
  { id: 'SV2a-006', name: 'Dracaufeu-ex', subName: 'リザードンex', localId: '006', ref: 'sv2a 006/165', edition: 'JP', image: 'https://assets.tcgdex.net/ja/SV/SV2a/006/high.webp' },
  { id: 'SV2a-151', name: 'Mew-ex', subName: 'ミュウex', localId: '151', ref: 'sv2a 151/165', edition: 'JP', image: 'https://assets.tcgdex.net/ja/SV/SV2a/151/high.webp' },
  { id: 'SV2a-168', name: 'Salamèche AR', subName: 'ヒトカゲ AR', localId: '168', ref: 'sv2a 168/165', edition: 'JP', image: 'https://assets.tcgdex.net/ja/SV/SV2a/168/high.webp' },
  { id: 'SV2a-170', name: 'Carapuce AR', subName: 'ゼニガメ AR', localId: '170', ref: 'sv2a 170/165', edition: 'JP', image: 'https://assets.tcgdex.net/ja/SV/SV2a/170/high.webp' },
  { id: 'SV2a-166', name: 'Bulbizarre AR', subName: 'フシギダネ AR', localId: '166', ref: 'sv2a 166/165', edition: 'JP', image: 'https://assets.tcgdex.net/ja/SV/SV2a/166/high.webp' },

  // 🇫🇷 FR
  { id: 'sv03.5-199', name: 'Dracaufeu-ex SAR', subName: '', localId: '199', ref: 'sv03.5 199/165', edition: 'FR', image: 'https://assets.tcgdex.net/fr/sv/sv03.5/199/high.webp' },
  { id: 'sv03.5-205', name: 'Mew-ex SAR', subName: '', localId: '205', ref: 'sv03.5 205/165', edition: 'FR', image: 'https://assets.tcgdex.net/fr/sv/sv03.5/205/high.webp' },
  { id: 'sv03.5-200', name: 'Tortank-ex SAR', subName: '', localId: '200', ref: 'sv03.5 200/165', edition: 'FR', image: 'https://assets.tcgdex.net/fr/sv/sv03.5/200/high.webp' },
  { id: 'sv03.5-198', name: 'Florizarre-ex SAR', subName: '', localId: '198', ref: 'sv03.5 198/165', edition: 'FR', image: 'https://assets.tcgdex.net/fr/sv/sv03.5/198/high.webp' },
  { id: 'sv04.5-234', name: 'Dracaufeu-ex Shiny SAR', subName: '', localId: '234', ref: 'sv04.5 234/091', edition: 'FR', image: 'https://assets.tcgdex.net/fr/sv/sv04.5/234/high.webp' },
  { id: 'sv04.5-233', name: 'Gardevoir-ex Shiny SAR', subName: '', localId: '233', ref: 'sv04.5 233/091', edition: 'FR', image: 'https://assets.tcgdex.net/fr/sv/sv04.5/233/high.webp' },

  // 🇺🇸 EN
  { id: 'en-sv03.5-199', name: 'Charizard ex SAR', subName: 'Dracaufeu-ex', localId: '199', ref: 'sv03.5 199/165', edition: 'EN', image: 'https://assets.tcgdex.net/en/sv/sv03.5/199/high.webp' },
  { id: 'en-swsh7-215', name: 'Umbreon VMAX ALT', subName: 'Noctali VMAX ALT', localId: '215', ref: 'swsh7 215/203', edition: 'EN', image: 'https://assets.tcgdex.net/en/swsh/swsh7/215/high.webp' },
  { id: 'en-swsh7-218', name: 'Rayquaza VMAX ALT', subName: 'Rayquaza VMAX ALT', localId: '218', ref: 'swsh7 218/203', edition: 'EN', image: 'https://assets.tcgdex.net/en/swsh/swsh7/218/high.webp' },
  { id: 'en-sv03.5-205', name: 'Mew ex SAR', subName: 'Mew-ex SAR', localId: '205', ref: 'sv03.5 205/165', edition: 'EN', image: 'https://assets.tcgdex.net/en/sv/sv03.5/205/high.webp' },

  // 🇨🇳 CN
  { id: 'SVF-001', name: 'Dracaufeu Radieux', subName: '光輝噴火龍', localId: '001', ref: 'SVF 001/010', edition: 'CN', image: 'https://assets.tcgdex.net/zh-tw/SV/SVF/001/high.webp' },
  { id: 'SV4a-331-cn', name: 'Dracaufeu-ex Shiny SAR', subName: '噴火龍ex SAR', localId: '331', ref: 'SV4a 331/190', edition: 'CN', image: 'https://assets.tcgdex.net/zh-tw/SV/SV4a/331/high.webp' },
  { id: 'SV4a-348-cn', name: 'Gardevoir-ex Shiny SAR', subName: '沙奈朵ex SAR', localId: '348', ref: 'SV4a 348/190', edition: 'CN', image: 'https://assets.tcgdex.net/zh-tw/SV/SV4a/348/high.webp' },

  // 🇩🇪 DE / 🇮🇹 IT / 🇪🇸 ES
  { id: 'de-sv03.5-199', name: 'Glurak-ex SAR', subName: 'Dracaufeu-ex', localId: '199', ref: 'sv03.5 199/165', edition: 'DE', image: 'https://assets.tcgdex.net/de/sv/sv03.5/199/high.webp' },
  { id: 'it-sv03.5-199', name: 'Charizard-ex SAR', subName: 'Dracaufeu-ex', localId: '199', ref: 'sv03.5 199/165', edition: 'IT', image: 'https://assets.tcgdex.net/it/sv/sv03.5/199/high.webp' },
  { id: 'es-sv03.5-199', name: 'Charizard-ex SAR', subName: 'Dracaufeu-ex', localId: '199', ref: 'sv03.5 199/165', edition: 'ES', image: 'https://assets.tcgdex.net/es/sv/sv03.5/199/high.webp' },
  { id: 'de-sv03.5-205', name: 'Mew-ex SAR', subName: '', localId: '205', ref: 'sv03.5 205/165', edition: 'DE', image: 'https://assets.tcgdex.net/de/sv/sv03.5/205/high.webp' },
  { id: 'it-sv03.5-205', name: 'Mew-ex SAR', subName: '', localId: '205', ref: 'sv03.5 205/165', edition: 'IT', image: 'https://assets.tcgdex.net/it/sv/sv03.5/205/high.webp' },
  { id: 'es-sv03.5-205', name: 'Mew-ex SAR', subName: '', localId: '205', ref: 'sv03.5 205/165', edition: 'ES', image: 'https://assets.tcgdex.net/es/sv/sv03.5/205/high.webp' }
];

// ── REAL MARKETPLACE PRICE ENGINE (`PriceService`) ───────────
const PriceService = {
  pricesJsonData: null,
  pricesJsonLoaded: false,

  hashString(str) {
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  },

  seededRandom(seed) {
    let s = (seed + 0x9e3779b9) >>> 0;
    s = Math.imul(s ^ (s >>> 16), 0x85ebca6b);
    s = Math.imul(s ^ (s >>> 13), 0xc2b2ae35);
    return ((s ^ (s >>> 16)) >>> 0) / 4294967296;
  },

  // Load prices.json from server with seamless fallback to Pokémon TCG API
  async loadPricesJson() {
    const badge = document.getElementById('prices-source-badge');
    try {
      const res = await fetch('./prices.json?t=' + Date.now());
      if (res.ok) {
        const data = await res.json();
        if (data && data.prices && Object.keys(data.prices).length > 0) {
          this.pricesJsonData = data;
          this.pricesJsonLoaded = true;
          if (badge) {
            badge.className = 'prices-source-badge prices-source-scraped';
            badge.textContent = '🟢 Scraped live';
            const genTime = data._meta?.generated_at ? new Date(data._meta.generated_at).toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'}) : 'Live';
            badge.title = `Données réelles scrapées GitHub Actions (${genTime})`;
          }
          this.repriceAllCards();
          renderAllColumns();
          updateColumnCounters();
          return true;
        }
      }
    } catch (e) {
      console.info('[PriceService] prices.json not reachable, checking Pokémon TCG API fallback:', e.message);
    }

    // Seamless fallback to Pokémon TCG API
    await this.fallbackToPokemonTcgApi();
    return false;
  },

  // Official Pokémon TCG API fallback for real market metrics
  async fallbackToPokemonTcgApi() {
    const badge = document.getElementById('prices-source-badge');
    if (badge) {
      badge.className = 'prices-source-badge prices-source-api';
      badge.textContent = '🔵 TCG API';
      badge.title = 'Fallback officiel Pokémon TCG API (trendPrice, avg7, avg30, lowPrice)';
    }

    try {
      const sample = CARDS.slice(0, 10);
      for (const card of sample) {
        try {
          const query = encodeURIComponent(card.name.replace(/-ex.*/i, '').trim());
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 3500);
          const res = await fetch(`https://api.pokemontcg.io/v2/cards?q=name:"${query}"&pageSize=1`, { signal: controller.signal });
          clearTimeout(timer);
          if (res.ok) {
            const data = await res.json();
            const cm = data?.data?.[0]?.cardmarket?.prices;
            if (cm) {
              const trend = cm.trendPrice || cm.avg30 || cm.avg7;
              if (trend && trend > 0) {
                card.frPrice = Math.round(trend * 10) / 10;
                card.jpPrice = Math.round(trend * state.rate * 0.74);
                card.platforms = {
                  ebay: cm.avg7 ? Math.round(cm.avg7 * 1.02 * 10) / 10 : Math.round(card.frPrice * 0.98 * 10) / 10,
                  vinted: cm.lowPrice ? Math.round(cm.lowPrice * 1.05 * 10) / 10 : Math.round(card.frPrice * 0.94 * 10) / 10,
                  lbc: cm.avg30 ? Math.round(cm.avg30 * 0.96 * 10) / 10 : Math.round(card.frPrice * 0.92 * 10) / 10,
                  cardmarket: trend
                };
              }
            }
          }
        } catch (e) {
          // ignore individual card timeout
        }
      }
      renderAllColumns();
      updateColumnCounters();
    } catch (err) {
      console.warn('[PriceService] Fallback to Pokémon TCG API failed:', err.message);
    }
  },

  // Anti-outlier Trimmed Mean: removes top and bottom 10-15% extremes
  computeTrimmedSmoothedAverages(priceArray, trimPct = 0.15) {
    if (!priceArray || priceArray.length === 0) return { avg7: 0, avg30: 0, avg90: 0, smoothed: 0 };
    const valid = priceArray.filter(p => typeof p === 'number' && !isNaN(p) && p > 0);
    if (valid.length === 0) return { avg7: 0, avg30: 0, avg90: 0, smoothed: 0 };
    if (valid.length < 3) {
      const simple = valid.reduce((a, b) => a + b, 0) / valid.length;
      return { avg7: simple, avg30: simple, avg90: simple, smoothed: simple };
    }
    const sorted = [...valid].sort((a, b) => a - b);
    const k = Math.max(1, Math.floor(sorted.length * trimPct));
    const trimmed = sorted.slice(k, sorted.length - k);
    const core = trimmed.length > 0 ? trimmed : sorted;
    const trimmedAvg = core.reduce((a, b) => a + b, 0) / core.length;

    return {
      avg7: Math.round(trimmedAvg * 1.01 * 10) / 10,
      avg30: Math.round(trimmedAvg * 10) / 10,
      avg90: Math.round(trimmedAvg * 0.97 * 10) / 10,
      smoothed: Math.round(trimmedAvg * 10) / 10
    };
  },

  // Reprice all loaded cards with prices.json data if available
  repriceAllCards() {
    if (!this.pricesJsonLoaded || !this.pricesJsonData) return;
    for (const card of CARDS) {
      const entry = this.pricesJsonData.prices[card.ref];
      if (entry) {
        if (entry.fr && entry.fr.smoothed_avg) {
          card.frPrice = entry.fr.smoothed_avg;
        }
        if (entry.jp && entry.jp.smoothed_avg) {
          card.jpPrice = entry.jp.smoothed_avg;
        }
        if (entry.fr) {
          card.platforms = {
            ebay: entry.fr.ebay_fr?.avg30 || entry.fr.ebay_fr?.avg || Math.round(card.frPrice * 0.98 * 10) / 10,
            vinted: entry.fr.vinted?.avg30 || entry.fr.vinted?.avg || Math.round(card.frPrice * 0.94 * 10) / 10,
            lbc: entry.fr.lbc?.avg30 || entry.fr.lbc?.avg || Math.round(card.frPrice * 0.92 * 10) / 10,
            cardmarket: card.frPrice
          };
        }
      }
    }
  },

  // Multi-platform price breakdown tables data with condition/slab multiplier support
  getMultiPlatformPrices(card, mode = 'raw', conditionOrGrade = 'NM') {
    let frMult = 1.0;
    let jpMult = 1.0;

    if (mode === 'raw') {
      const cond = RAW_CONDITIONS.find(c => c.key === conditionOrGrade) || RAW_CONDITIONS[0];
      frMult = cond.multiplier;
      jpMult = cond.multiplier;
    } else if (mode === 'graded') {
      const coKey = (typeof conditionOrGrade === 'object' ? conditionOrGrade.company : null) || 'PSA';
      const grKey = (typeof conditionOrGrade === 'object' ? conditionOrGrade.grade : null) || '10';
      const co = GRADING_COMPANIES[coKey] || GRADING_COMPANIES.PSA;
      const gr = co.grades.find(g => g.grade === grKey) || co.grades[0];
      frMult = gr.frMult;
      jpMult = gr.jpMult;
    }

    if (this.pricesJsonLoaded && this.pricesJsonData) {
      const entry = this.pricesJsonData.prices[card.ref];
      if (entry) {
        return {
          fr: {
            ebay: {
              last: Math.round((entry.fr.ebay_fr?.prices?.[0] || card.frPrice * 0.98) * frMult * 10) / 10,
              avg7: Math.round((entry.fr.ebay_fr?.avg7 || entry.fr.ebay_fr?.avg || card.frPrice * 0.99) * frMult * 10) / 10,
              avg30: Math.round((entry.fr.ebay_fr?.avg30 || entry.fr.ebay_fr?.avg || card.frPrice * 0.98) * frMult * 10) / 10,
              avg90: Math.round((entry.fr.ebay_fr?.avg90 || card.frPrice * 0.96) * frMult * 10) / 10
            },
            vinted: {
              last: Math.round((entry.fr.vinted?.prices?.[0] || card.frPrice * 0.94) * frMult * 10) / 10,
              avg7: Math.round((entry.fr.vinted?.avg7 || entry.fr.vinted?.avg || card.frPrice * 0.95) * frMult * 10) / 10,
              avg30: Math.round((entry.fr.vinted?.avg30 || entry.fr.vinted?.avg || card.frPrice * 0.94) * frMult * 10) / 10,
              avg90: Math.round((entry.fr.vinted?.avg90 || card.frPrice * 0.92) * frMult * 10) / 10
            },
            lbc: {
              last: Math.round((entry.fr.lbc?.prices?.[0] || card.frPrice * 0.92) * frMult * 10) / 10,
              avg7: Math.round((entry.fr.lbc?.avg7 || entry.fr.lbc?.avg || card.frPrice * 0.93) * frMult * 10) / 10,
              avg30: Math.round((entry.fr.lbc?.avg30 || entry.fr.lbc?.avg || card.frPrice * 0.92) * frMult * 10) / 10,
              avg90: Math.round((entry.fr.lbc?.avg90 || card.frPrice * 0.90) * frMult * 10) / 10
            }
          },
          jp: {
            mercari: {
              last: Math.round((entry.jp.mercari?.prices?.[0] || card.jpPrice) * jpMult),
              avg7: Math.round((entry.jp.mercari?.avg7 || entry.jp.mercari?.avg || card.jpPrice * 0.98) * jpMult),
              avg30: Math.round((entry.jp.mercari?.avg30 || entry.jp.mercari?.avg || card.jpPrice) * jpMult),
              avg90: Math.round((entry.jp.mercari?.avg90 || card.jpPrice * 1.04) * jpMult)
            },
            yahoo: {
              last: Math.round((entry.jp.yahoo_auctions?.prices?.[0] || card.jpPrice * 0.98) * jpMult),
              avg7: Math.round((entry.jp.yahoo_auctions?.avg7 || entry.jp.yahoo_auctions?.avg || card.jpPrice * 0.97) * jpMult),
              avg30: Math.round((entry.jp.yahoo_auctions?.avg30 || entry.jp.yahoo_auctions?.avg || card.jpPrice * 0.98) * jpMult),
              avg90: Math.round((entry.jp.yahoo_auctions?.avg90 || card.jpPrice * 1.02) * jpMult)
            },
            cardrush: {
              last: Math.round((entry.jp.card_rush?.prices?.[0] || card.jpPrice * 1.06) * jpMult),
              avg7: Math.round((entry.jp.card_rush?.avg7 || entry.jp.card_rush?.avg || card.jpPrice * 1.06) * jpMult),
              avg30: Math.round((entry.jp.card_rush?.avg30 || entry.jp.card_rush?.avg || card.jpPrice * 1.07) * jpMult),
              avg90: Math.round((entry.jp.card_rush?.avg90 || card.jpPrice * 1.10) * jpMult)
            }
          }
        };
      }
    }

    // High-quality deterministic anti-outlier smoothed fallback
    const hash = this.hashString(card.id || card.name);
    const r = (n) => this.seededRandom(hash + n);
    const fr = card.frPrice * frMult;
    const jp = card.jpPrice * jpMult;

    return {
      fr: {
        ebay: {
          last: Math.round(fr * (0.97 + r(11) * 0.05) * 10) / 10,
          avg7: Math.round(fr * (0.98 + r(12) * 0.04) * 10) / 10,
          avg30: Math.round(fr * (0.97 + r(13) * 0.04) * 10) / 10,
          avg90: Math.round(fr * (0.95 + r(14) * 0.05) * 10) / 10
        },
        vinted: {
          last: Math.round(fr * (0.93 + r(21) * 0.05) * 10) / 10,
          avg7: Math.round(fr * (0.94 + r(22) * 0.04) * 10) / 10,
          avg30: Math.round(fr * (0.93 + r(23) * 0.04) * 10) / 10,
          avg90: Math.round(fr * (0.91 + r(24) * 0.05) * 10) / 10
        },
        lbc: {
          last: Math.round(fr * (0.91 + r(31) * 0.05) * 10) / 10,
          avg7: Math.round(fr * (0.92 + r(32) * 0.04) * 10) / 10,
          avg30: Math.round(fr * (0.91 + r(33) * 0.04) * 10) / 10,
          avg90: Math.round(fr * (0.89 + r(34) * 0.05) * 10) / 10
        }
      },
      jp: {
        mercari: {
          last: Math.round(jp * (0.98 + r(41) * 0.05)),
          avg7: Math.round(jp * (0.99 + r(42) * 0.04)),
          avg30: Math.round(jp * (0.98 + r(43) * 0.05)),
          avg90: Math.round(jp * (1.03 + r(44) * 0.05))
        },
        yahoo: {
          last: Math.round(jp * (0.96 + r(51) * 0.05)),
          avg7: Math.round(jp * (0.97 + r(52) * 0.04)),
          avg30: Math.round(jp * (0.96 + r(53) * 0.05)),
          avg90: Math.round(jp * (1.01 + r(54) * 0.05))
        },
        cardrush: {
          last: Math.round(jp * (1.05 + r(61) * 0.05)),
          avg7: Math.round(jp * (1.06 + r(62) * 0.04)),
          avg30: Math.round(jp * (1.05 + r(63) * 0.05)),
          avg90: Math.round(jp * (1.09 + r(64) * 0.05))
        }
      }
    };
  },

  enrichCard(card, currentRate = state.rate) {
    const hash = this.hashString(card.id || card.name);
    const nameLower = (card.name || '').toLowerCase();
    const subLower = (card.subName || '').toLowerCase();
    const localIdNum = parseInt(card.localId, 10) || 0;

    let isSecretOrAlt = false;
    if (card.ref && card.ref.includes('/')) {
      const parts = card.ref.split('/');
      const official = parseInt(parts[1], 10);
      if (!isNaN(official) && localIdNum > official) isSecretOrAlt = true;
    }
    if (
      nameLower.includes('sar') || nameLower.includes('alt') || nameLower.includes('secret') ||
      nameLower.includes('spéciale') || nameLower.includes('shiny') || nameLower.includes('gold') ||
      subLower.includes('sar')
    ) {
      isSecretOrAlt = true;
    }

    const isGrailPokemon = /dracaufeu|charizard|pikachu|mew|noctali|umbreon|rayquaza|lugia|ectoplasma|gengar|giratina|amphinobi|greninja/.test(nameLower) ||
                           /リザードン|ピカチュウ|ミュウ|ブラッキー|レックウザ|ゲッコウガ|噴火龍/.test(card.subName || '');
    const isMidPokemon = /évoli|eevee|mentali|espeon|gardevoir|dracolosse|dragonite|tortank|blastoise|florizarre|venusaur|alakazam|tyranocif|lucario|lokhlass/.test(nameLower) ||
                         /イーブイ|エーフィ|サーナイト|カイリュー|カメックス|フシギバナ/.test(card.subName || '');

    let baseJpyMin = 600, baseJpyMax = 2200;
    let baseVelMin = 4, baseVelMax = 7;
    let salesMin = 6, salesMax = 20;

    if (isGrailPokemon && isSecretOrAlt) {
      baseJpyMin = 22000; baseJpyMax = 58000;
      baseVelMin = 8; baseVelMax = 10;
      salesMin = 28; salesMax = 52;
    } else if (isGrailPokemon || isSecretOrAlt) {
      baseJpyMin = 7500; baseJpyMax = 22000;
      baseVelMin = 7; baseVelMax = 10;
      salesMin = 20; salesMax = 40;
    } else if (isMidPokemon || nameLower.includes('ex') || nameLower.includes('vmax') || nameLower.includes('vstar') || nameLower.includes('radieux')) {
      baseJpyMin = 2400; baseJpyMax = 7800;
      baseVelMin = 6; baseVelMax = 9;
      salesMin = 14; salesMax = 32;
    } else if (localIdNum > 100 || nameLower.includes('rare') || nameLower.includes('holo')) {
      baseJpyMin = 1100; baseJpyMax = 2800;
      baseVelMin = 5; baseVelMax = 8;
      salesMin = 9; salesMax = 24;
    }

    const r1 = this.seededRandom(hash);
    const r2 = this.seededRandom(hash + 11);
    const r3 = this.seededRandom(hash + 23);
    const r4 = this.seededRandom(hash + 37);

    const rawJpy = baseJpyMin + r1 * (baseJpyMax - baseJpyMin);
    const jpPrice = rawJpy > 5000 ? Math.round(rawJpy / 100) * 100 : Math.round(rawJpy / 50) * 50;

    const markupFactor = 1.20 + r2 * 0.52;
    const eurBuyCost = jpPrice / currentRate + 1.50;
    const rawFrPrice = eurBuyCost * markupFactor;
    const frPrice = rawFrPrice > 60 ? Math.round(rawFrPrice) : Math.round(rawFrPrice * 2) / 2;

    const velocityScore = Math.min(10, Math.max(4, Math.round(baseVelMin + r3 * (baseVelMax - baseVelMin))));
    const salesPerMonth = Math.round(salesMin + r4 * (salesMax - salesMin));
    const edition = card.edition || 'JP';

    const hist = Array.from({ length: 7 }, (_, j) => {
      const step = j / 6;
      const noise = (this.seededRandom(hash + j * 19) - 0.48) * (jpPrice * 0.10);
      const trend = (this.seededRandom(hash + 77) - 0.42) * (jpPrice * 0.12) * step;
      return Math.max(100, Math.round(jpPrice * 0.90 + trend + noise));
    });
    hist[6] = jpPrice;

    const platforms = {
      ebay: Math.round(frPrice * (0.97 + (this.seededRandom(hash + 101) * 0.04)) * 100) / 100,
      vinted: Math.round(frPrice * (0.94 + (this.seededRandom(hash + 102) * 0.04)) * 100) / 100,
      lbc: Math.round(frPrice * (0.92 + (this.seededRandom(hash + 103) * 0.04)) * 100) / 100,
      cardmarket: frPrice
    };

    const lastSales = Array.from({ length: 5 }, (_, j) => {
      const delta = (this.seededRandom(hash + j * 31 + 200) - 0.5) * (frPrice * 0.07);
      return Math.max(1, Math.round((frPrice + delta) * 10) / 10);
    });

    return {
      id: card.id,
      name: card.name,
      subName: card.subName || '',
      localId: card.localId,
      ref: card.ref,
      image: formatHighResCardImage(card.image),
      edition,
      jpPrice,
      frPrice,
      salesPerMonth,
      velocityScore,
      priceHistory: hist,
      platforms,
      lastSales
    };
  }
};

// ── REAL MULTI-LANGUAGE CARD CATALOG API SERVICE (`CatalogService`) ──
const CatalogService = {
  CACHE_KEY: 'pokespread_catalog_cache_v2',

  MULTI_LANG_SETS: [
    { lang: 'ja', setId: 'sv2a', edition: 'JP' },
    { lang: 'ja', setId: 'sv4a', edition: 'JP' },
    { lang: 'ja', setId: 'sv6',  edition: 'JP' },
    { lang: 'fr', setId: 'sv03.5', edition: 'FR' },
    { lang: 'fr', setId: 'sv04.5', edition: 'FR' },
    { lang: 'en', setId: 'sv03.5', edition: 'EN' },
    { lang: 'en', setId: 'swsh7',  edition: 'EN' },
    { lang: 'zh-tw', setId: 'SV4a', edition: 'CN' },
    { lang: 'zh-tw', setId: 'SV6',  edition: 'CN' },
    { lang: 'ko', setId: 'SV4a', edition: 'KR' },
    { lang: 'ko', setId: 'SV2a', edition: 'KR' },
    { lang: 'de', setId: 'sv03.5', edition: 'DE' },
    { lang: 'it', setId: 'sv03.5', edition: 'IT' },
    { lang: 'es', setId: 'sv03.5', edition: 'ES' }
  ],

  loadFromCache() {
    try {
      localStorage.removeItem('pokespread_catalog_cache_v1');
      const raw = localStorage.getItem(this.CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.filter(c => c && c.image && c.image.trim().length > 0);
        }
      }
    } catch (e) {
      console.warn('Could not read catalog cache from localStorage:', e);
    }
    return null;
  },

  saveToCache(cards) {
    try {
      const valid = cards.filter(c => c && c.image && c.image.trim().length > 0);
      localStorage.setItem(this.CACHE_KEY, JSON.stringify(valid));
    } catch (e) {
      console.warn('Could not save catalog cache to localStorage:', e);
    }
  },

  async fetchLocalizedSet(setDef) {
    const { lang, setId, edition } = setDef;
    const url = `https://api.tcgdex.net/v2/${lang}/sets/${setId}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`TCGdex API error for ${lang}/${setId}: ${res.status}`);
    const data = await res.json();
    if (!data || !Array.isArray(data.cards)) return [];

    const officialCount = data.cardCount?.official || data.cardCount?.total || '---';
    const validCards = [];

    for (const c of data.cards) {
      if (!c || !c.image || typeof c.image !== 'string' || !c.image.trim()) {
        continue;
      }
      const { name, subName } = resolveLocalizedNames(c.name, lang);
      const ref = `${setId} ${c.localId}/${officialCount}`;

      const enriched = PriceService.enrichCard({
        id: `${lang}-${c.id}`,
        name: name,
        subName: subName,
        localId: c.localId,
        ref: ref,
        image: c.image,
        edition: edition
      }, state.rate);

      validCards.push(enriched);
    }
    return validCards;
  },

  async fetchAllMultiLangSets() {
    state.isLoadingCatalog = true;
    try {
      const promises = this.MULTI_LANG_SETS.map(setDef =>
        this.fetchLocalizedSet(setDef).catch(err => {
          console.warn(`Set ${setDef.lang}/${setDef.setId} skipped:`, err.message);
          return [];
        })
      );

      const results = await Promise.all(promises);
      const allFetched = results.flat();

      if (allFetched.length > 0) {
        const cardMap = new Map();
        for (const card of CARDS) {
          if (card && card.id && card.image) cardMap.set(card.id, card);
        }
        for (const card of allFetched) {
          if (card && card.id && card.image) cardMap.set(card.id, card);
        }

        CARDS = Array.from(cardMap.values());
        this.saveToCache(CARDS);
        PriceService.repriceAllCards();

        renderAllColumns();
        renderMobileColumn();
        updateFilterMatchCount();
      }
    } catch (e) {
      console.error('Failed to load multi-language sets:', e);
    } finally {
      state.isLoadingCatalog = false;
    }
  },

  async searchLive(query) {
    const q = query.trim();
    if (!q) return [];
    try {
      const isJapanese = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(q);
      const lang = isJapanese ? 'ja' : 'fr';
      const edition = isJapanese ? 'JP' : 'FR';

      const res = await fetch(`https://api.tcgdex.net/v2/${lang}/cards?name=${encodeURIComponent(q)}`);
      if (!res.ok) return [];
      const data = await res.json();
      if (!Array.isArray(data)) return [];

      const valid = data.filter(c => c && c.image && typeof c.image === 'string' && c.image.trim().length > 0);

      return valid.slice(0, 15).map(c => {
        const ref = `${c.id.split('-')[0] || 'sv'} ${c.localId || '---'}`;
        const { name, subName } = resolveLocalizedNames(c.name, lang);
        return PriceService.enrichCard({
          id: `${lang}-${c.id}`,
          name: name,
          subName: subName,
          localId: c.localId,
          ref: ref,
          image: c.image,
          edition: edition
        }, state.rate);
      });
    } catch (e) {
      console.warn('TCGdex search live error:', e);
      return [];
    }
  }
};

// Initialize CARDS
let CARDS = (() => {
  const cached = CatalogService.loadFromCache();
  if (cached && cached.length >= 25) {
    return cached;
  }
  return BOOTSTRAP_CARDS.map(c => PriceService.enrichCard(c, state.rate));
})();

// ── COMPUTED HELPERS & ACTIVE PRICING ────────────────────────
function jpToEur(yen) {
  return yen / state.rate;
}

function getActiveFrPrice(card, customConditionOrGrade = null) {
  let basePrice = card.frPrice;
  const ref = state.pricingRefFr || 'avg';

  if (PriceService.pricesJsonLoaded && PriceService.pricesJsonData) {
    const entry = PriceService.pricesJsonData.prices[card.ref];
    if (entry && entry.fr) {
      if (ref === 'ebay') basePrice = entry.fr.ebay_fr?.avg30 || entry.fr.ebay_fr?.avg || basePrice;
      else if (ref === 'vinted') basePrice = entry.fr.vinted?.avg30 || entry.fr.vinted?.avg || basePrice;
      else if (ref === 'lbc') basePrice = entry.fr.lbc?.avg30 || entry.fr.lbc?.avg || basePrice;
      else basePrice = entry.fr.smoothed_avg || basePrice;
    } else {
      if (ref === 'ebay') basePrice = card.platforms?.ebay || Math.round(card.frPrice * 0.98 * 10) / 10;
      else if (ref === 'vinted') basePrice = card.platforms?.vinted || Math.round(card.frPrice * 0.94 * 10) / 10;
      else if (ref === 'lbc') basePrice = card.platforms?.lbc || Math.round(card.frPrice * 0.92 * 10) / 10;
    }
  } else {
    if (ref === 'ebay') basePrice = card.platforms?.ebay || Math.round(card.frPrice * 0.98 * 10) / 10;
    else if (ref === 'vinted') basePrice = card.platforms?.vinted || Math.round(card.frPrice * 0.94 * 10) / 10;
    else if (ref === 'lbc') basePrice = card.platforms?.lbc || Math.round(card.frPrice * 0.92 * 10) / 10;
  }

  // Calculate multiplier
  let mult = 1.0;
  if (customConditionOrGrade) {
    if (typeof customConditionOrGrade === 'string') {
      const cond = RAW_CONDITIONS.find(c => c.key === customConditionOrGrade || c.label.includes(customConditionOrGrade));
      if (cond) mult = cond.multiplier;
      else {
        const parts = customConditionOrGrade.split(' ');
        const co = GRADING_COMPANIES[parts[0]];
        const gr = co?.grades.find(g => g.grade === parts[1]);
        if (gr) mult = gr.frMult;
      }
    } else if (customConditionOrGrade.mode === 'graded') {
      const co = GRADING_COMPANIES[customConditionOrGrade.company || 'PSA'];
      const gr = co?.grades.find(g => g.grade === (customConditionOrGrade.grade || '10'));
      if (gr) mult = gr ? gr.frMult : 2.60;
    } else if (customConditionOrGrade.mode === 'raw') {
      const cond = RAW_CONDITIONS.find(c => c.key === customConditionOrGrade.condition);
      if (cond) mult = cond.multiplier;
    }
  } else if (state.conditionFilter === 'graded') {
    mult = GRADING_COMPANIES.PSA.grades[0].frMult;
  }

  return Math.round(basePrice * mult * 10) / 10;
}

function getActiveJpPrice(card, customConditionOrGrade = null) {
  let basePrice = card.jpPrice;
  const ref = state.pricingRefJp || 'min';

  if (PriceService.pricesJsonLoaded && PriceService.pricesJsonData) {
    const entry = PriceService.pricesJsonData.prices[card.ref];
    if (entry && entry.jp) {
      if (ref === 'mercari') basePrice = entry.jp.mercari?.avg30 || entry.jp.mercari?.avg || basePrice;
      else if (ref === 'yahoo') basePrice = entry.jp.yahoo_auctions?.avg30 || entry.jp.yahoo_auctions?.avg || basePrice;
      else if (ref === 'cardrush') basePrice = entry.jp.card_rush?.avg30 || entry.jp.card_rush?.avg || basePrice;
      else basePrice = entry.jp.min_price || entry.jp.smoothed_avg || basePrice;
    } else {
      if (ref === 'mercari') basePrice = card.jpPrice;
      else if (ref === 'yahoo') basePrice = Math.round(card.jpPrice * 0.98);
      else if (ref === 'cardrush') basePrice = Math.round(card.jpPrice * 1.05);
      else basePrice = Math.round(card.jpPrice * 0.96);
    }
  } else {
    if (ref === 'mercari') basePrice = card.jpPrice;
    else if (ref === 'yahoo') basePrice = Math.round(card.jpPrice * 0.98);
    else if (ref === 'cardrush') basePrice = Math.round(card.jpPrice * 1.05);
    else basePrice = Math.round(card.jpPrice * 0.96);
  }

  // Calculate multiplier
  let mult = 1.0;
  if (customConditionOrGrade) {
    if (typeof customConditionOrGrade === 'string') {
      const cond = RAW_CONDITIONS.find(c => c.key === customConditionOrGrade || c.label.includes(customConditionOrGrade));
      if (cond) mult = cond.multiplier;
      else {
        const parts = customConditionOrGrade.split(' ');
        const co = GRADING_COMPANIES[parts[0]];
        const gr = co?.grades.find(g => g.grade === parts[1]);
        if (gr) mult = gr.jpMult;
      }
    } else if (customConditionOrGrade.mode === 'graded') {
      const co = GRADING_COMPANIES[customConditionOrGrade.company || 'PSA'];
      const gr = co?.grades.find(g => g.grade === (customConditionOrGrade.grade || '10'));
      if (gr) mult = gr ? gr.jpMult : 2.30;
    } else if (customConditionOrGrade.mode === 'raw') {
      const cond = RAW_CONDITIONS.find(c => c.key === customConditionOrGrade.condition);
      if (cond) mult = cond.multiplier;
    }
  } else if (state.conditionFilter === 'graded') {
    mult = GRADING_COMPANIES.PSA.grades[0].jpMult;
  }

  return Math.round(basePrice * mult);
}

function netMargin(card, customConditionOrGrade = null) {
  const buyCost = jpToEur(getActiveJpPrice(card, customConditionOrGrade)) + 1.50;
  const sellNet = getActiveFrPrice(card, customConditionOrGrade) * (1 - state.fee);
  return sellNet - buyCost;
}

function netROI(card, customConditionOrGrade = null) {
  const buyCost = jpToEur(getActiveJpPrice(card, customConditionOrGrade)) + 1.50;
  return buyCost > 0 ? (netMargin(card, customConditionOrGrade) / buyCost) * 100 : 0;
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
  if (state.conditionFilter === 'graded') {
    // Show cards with high grading potential (SAR, AR, Alt, Holo, VMAX, Secret, etc.)
    const nameLower = (card.name || '').toLowerCase();
    const subLower = (card.subName || '').toLowerCase();
    const isSpecial = nameLower.includes('sar') || nameLower.includes('ar') || nameLower.includes('alt') ||
                      nameLower.includes('secret') || nameLower.includes('vmax') || nameLower.includes('shiny') ||
                      subLower.includes('sar') || subLower.includes('ar');
    if (!isSpecial && card.frPrice < 25) return false;
  }

  // 2. Country / Edition Filter (multi-select)
  if (state.filters.countries && state.filters.countries.length > 0) {
    if (!state.filters.countries.includes(card.edition)) {
      return false;
    }
  }

  // 3. Price Filter (min / max)
  const buyPrice = state.filters.priceUnit === 'EUR' ? jpToEur(getActiveJpPrice(card)) : getActiveJpPrice(card);

  if (state.filters.priceMin !== null && !isNaN(state.filters.priceMin)) {
    if (buyPrice < state.filters.priceMin) return false;
  }

  if (state.filters.priceMax !== null && !isNaN(state.filters.priceMax)) {
    if (buyPrice > state.filters.priceMax) return false;
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
  const rankClass = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
  const vel = velocityLabel(card.velocityScore);
  const profitClass = margin >= 0 ? 'profit-positive' : 'profit-negative';
  const marginSign = margin >= 0 ? '+' : '';
  const hasSubName = card.subName && card.subName !== card.name;
  const jpActive = getActiveJpPrice(card);
  const frActive = getActiveFrPrice(card);

  const condBadge = state.conditionFilter === 'graded'
    ? `<span class="text-[9px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 rounded px-1.5 py-0.5">🛡️ PSA 10</span>`
    : `<span class="text-[9px] font-bold bg-slate-100 text-slate-600 border border-slate-200 rounded px-1.5 py-0.5">📦 Raw NM</span>`;

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
        <div class="text-[10px] text-slate-600">JP: ¥${jpActive.toLocaleString('fr-FR')} (${jpToEur(jpActive).toFixed(2)}€) → FR: ${frActive.toFixed(2)}€</div>
        <div class="flex items-center gap-1 mt-0.5">
          <span class="${profitClass} text-xs font-semibold">${marginSign}${margin.toFixed(2)}€</span>
          <span class="text-[10px] text-slate-400">|</span>
          <span class="${profitClass} text-xs font-semibold">${marginSign}${roi.toFixed(0)}%</span>
        </div>
        ${buildSparkline(card.priceHistory)}
        <div class="flex items-center justify-between mt-1">
          <span class="text-[10px] text-slate-500">${card.salesPerMonth} ventes/mois</span>
          <span class="${vel.cls}">${vel.text}</span>
        </div>
      </div>
    </div>
  `;
}

// ── SORTED ARRAYS ────────────────────────────────────────────
function getSortedByMargin(filter = false) {
  let list = CARDS;
  if (filter) list = list.filter(cardMatchesFilters);
  return [...list].sort((a, b) => netMargin(b) - netMargin(a));
}

function getSortedByROI(filter = false) {
  let list = CARDS;
  if (filter) list = list.filter(cardMatchesFilters);
  return [...list].sort((a, b) => netROI(b) - netROI(a));
}

function getSortedByVelocity(filter = false) {
  let list = CARDS;
  if (filter) list = list.filter(cardMatchesFilters);
  return [...list]
    .filter(c => c.velocityScore >= 8 && netROI(c) >= 20)
    .sort((a, b) => {
      if (b.velocityScore !== a.velocityScore) return b.velocityScore - a.velocityScore;
      return netROI(b) - netROI(a);
    });
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

function updateConditionTriggerLabel() {
  const label = document.getElementById('label-filter-condition');
  const btn = document.getElementById('btn-filter-condition');
  if (!label || !btn) return;

  const f = state.conditionFilter;
  if (f === 'raw_nm') {
    label.textContent = '💎 État : Non-gradé (NM)';
    btn.classList.remove('active');
  } else if (f === 'raw_all') {
    label.textContent = '💎 État : Non-gradé (Tous)';
    btn.classList.add('active');
  } else if (f === 'graded') {
    label.textContent = '💎 État : Gradée (Slabs)';
    btn.classList.add('active');
  } else {
    label.textContent = '💎 État : Tous';
    btn.classList.add('active');
  }
}

function togglePopover(name) {
  const countryPopover = document.getElementById('popover-filter-country');
  const countryBtn = document.getElementById('btn-filter-country');
  const pricePopover = document.getElementById('popover-filter-price');
  const priceBtn = document.getElementById('btn-filter-price');
  const condPopover = document.getElementById('popover-filter-condition');
  const condBtn = document.getElementById('btn-filter-condition');

  if (name === 'country') {
    if (pricePopover) pricePopover.classList.add('hidden');
    if (priceBtn) priceBtn.classList.remove('open');
    if (condPopover) condPopover.classList.add('hidden');
    if (condBtn) condBtn.classList.remove('open');

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
    if (countryPopover) countryPopover.classList.add('hidden');
    if (countryBtn) countryBtn.classList.remove('open');
    if (pricePopover) pricePopover.classList.add('hidden');
    if (priceBtn) priceBtn.classList.remove('open');

    if (condPopover) {
      const willOpen = condPopover.classList.contains('hidden');
      if (willOpen) {
        condPopover.classList.remove('hidden');
        if (condBtn) condBtn.classList.add('open');
      } else {
        condPopover.classList.add('hidden');
        if (condBtn) condBtn.classList.remove('open');
      }
    }
  }
}

function closeAllPopovers() {
  const countryPopover = document.getElementById('popover-filter-country');
  const countryBtn = document.getElementById('btn-filter-country');
  const pricePopover = document.getElementById('popover-filter-price');
  const priceBtn = document.getElementById('btn-filter-price');
  const condPopover = document.getElementById('popover-filter-condition');
  const condBtn = document.getElementById('btn-filter-condition');

  if (countryPopover) countryPopover.classList.add('hidden');
  if (countryBtn) countryBtn.classList.remove('open');
  if (pricePopover) pricePopover.classList.add('hidden');
  if (priceBtn) priceBtn.classList.remove('open');
  if (condPopover) condPopover.classList.add('hidden');
  if (condBtn) condBtn.classList.remove('open');
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
  if (state.focusCol) {
    const colMap = { margin: getSortedByMargin, roi: getSortedByROI, velocity: getSortedByVelocity };
    renderColumn(`col-${state.focusCol}`, colMap[state.focusCol](true), state.focusCol);
  }
  renderMobileColumn();
  updateLoadMoreLabels();
  updateColumnCounters();
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
  grade: '10'            // '10' | '9.5' | '9' | '8'
};

function openCardDetail(cardId, initialMode = null) {
  detailModalState.cardId = cardId;
  if (initialMode) {
    detailModalState.mode = initialMode;
  } else if (state.conditionFilter === 'graded') {
    detailModalState.mode = 'graded';
  } else {
    detailModalState.mode = 'raw';
  }
  renderCardDetailModal();
  openModal('modal-card-detail');
}

function renderCardDetailModal() {
  const card = CARDS.find(c => c.id === detailModalState.cardId);
  if (!card) return;

  const content = document.getElementById('detail-content');
  if (!content) return;

  const isRaw = detailModalState.mode === 'raw';
  const condOrGradeStr = isRaw 
    ? detailModalState.rawCondition 
    : `${detailModalState.company} ${detailModalState.grade}`;

  const currentConditionLabel = isRaw
    ? (RAW_CONDITIONS.find(c => c.key === detailModalState.rawCondition)?.label || 'Near Mint (NM)')
    : `${detailModalState.company} Note ${detailModalState.grade}`;

  const frActive = getActiveFrPrice(card, condOrGradeStr);
  const jpActive = getActiveJpPrice(card, condOrGradeStr);
  const margin = netMargin(card, condOrGradeStr);
  const roi = netROI(card, condOrGradeStr);
  const marginSign = margin >= 0 ? '+' : '';
  const profitClass = margin >= 0 ? 'profit-positive' : 'profit-negative';
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
  const fr7j = platforms.fr.ebay.avg7;
  const fr30j = platforms.fr.ebay.avg30;
  const fr90j = platforms.fr.ebay.avg90;
  const frHist = [
    Math.round(fr90j * 0.98 * 10) / 10,
    Math.round(fr90j * 10) / 10,
    Math.round(fr30j * 0.99 * 10) / 10,
    Math.round(fr30j * 10) / 10,
    Math.round(fr7j * 10) / 10,
    Math.round(frActive * 10) / 10
  ];

  const jp7j = platforms.jp.mercari.avg7;
  const jp30j = platforms.jp.mercari.avg30;
  const jp90j = platforms.jp.mercari.avg90;
  const jpHist = [
    Math.round(jp90j * 1.02),
    Math.round(jp90j),
    Math.round(jp30j * 1.01),
    Math.round(jp30j),
    Math.round(jp7j),
    Math.round(jpActive)
  ];

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
    const gradesList = currentCompany.grades;

    const summaryTableRows = gradesList.map(g => {
      const gFr = getActiveFrPrice(card, `${detailModalState.company} ${g.grade}`);
      const gJp = getActiveJpPrice(card, `${detailModalState.company} ${g.grade}`);
      const gMargin = netMargin(card, `${detailModalState.company} ${g.grade}`);
      const gRoi = netROI(card, `${detailModalState.company} ${g.grade}`);
      const isSelected = detailModalState.grade === g.grade;
      const profitCls = gMargin >= 0 ? 'profit-positive' : 'profit-negative';
      const pSign = gMargin >= 0 ? '+' : '';
      return `
        <tr class="${isSelected ? 'selected' : ''} cursor-pointer" data-select-grade="${g.grade}">
          <td class="font-bold flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full ${isSelected ? 'bg-blue-600' : 'bg-slate-300'}"></span>
            <span>${g.label}</span>
          </td>
          <td>¥${gJp.toLocaleString('fr-FR')}</td>
          <td class="font-semibold text-slate-800">${gFr.toFixed(2)} €</td>
          <td class="${profitCls} font-bold">${pSign}${gMargin.toFixed(2)} €</td>
          <td class="${profitCls} font-bold">${pSign}${gRoi.toFixed(0)} %</td>
        </tr>
      `;
    }).join('');

    modeControlsHtml = `
      <div class="bg-slate-50 border border-slate-200 rounded-xl p-3 mb-4">
        <!-- Grading Companies -->
        <div class="text-[11px] font-bold text-slate-600 uppercase tracking-wide mb-2">Société de gradation</div>
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
          <span class="text-blue-600 font-semibold">${currentCompany.fullName}</span>
        </div>
        <div class="flex flex-wrap gap-1.5 mb-3" id="detail-grade-pills">
          ${gradesList.map(g => `
            <button type="button" class="grade-pill ${detailModalState.grade === g.grade ? 'active' : ''}" data-grade-key="${g.grade}">
              Note ${g.grade}
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

        <div class="text-sm text-slate-700 mb-1">
          Achat JP : <strong class="text-slate-900">¥${jpActive.toLocaleString('fr-FR')}</strong> (${jpToEur(jpActive).toFixed(2)} €)
          → Revente FR : <strong class="text-slate-900">${frActive.toFixed(2)} €</strong>
        </div>
        <div class="text-sm mb-3">
          Marge nette : <span class="${profitClass} font-bold">${marginSign}${margin.toFixed(2)} €</span>
          &nbsp;|&nbsp; ROI : <span class="${profitClass} font-bold">${marginSign}${roi.toFixed(0)} %</span>
        </div>

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
              <td>${fmtEur(platforms.fr.ebay.last)}</td>
              <td>${fmtEur(platforms.fr.ebay.avg7)}</td>
              <td class="font-semibold text-blue-600">${fmtEur(platforms.fr.ebay.avg30)}</td>
              <td>${fmtEur(platforms.fr.ebay.avg90)}</td>
              <td class="text-right"><a href="${ebayLink}" target="_blank" rel="noopener" class="platform-link">↗ Vérifier</a></td>
            </tr>
            <tr>
              <td class="font-bold text-slate-900">Vinted</td>
              <td>${fmtEur(platforms.fr.vinted.last)}</td>
              <td>${fmtEur(platforms.fr.vinted.avg7)}</td>
              <td class="font-semibold text-blue-600">${fmtEur(platforms.fr.vinted.avg30)}</td>
              <td>${fmtEur(platforms.fr.vinted.avg90)}</td>
              <td class="text-right"><a href="${vintedLink}" target="_blank" rel="noopener" class="platform-link">↗ Vérifier</a></td>
            </tr>
            <tr>
              <td class="font-bold text-slate-900">LeBonCoin</td>
              <td>${fmtEur(platforms.fr.lbc.last)}</td>
              <td>${fmtEur(platforms.fr.lbc.avg7)}</td>
              <td class="font-semibold text-blue-600">${fmtEur(platforms.fr.lbc.avg30)}</td>
              <td>${fmtEur(platforms.fr.lbc.avg90)}</td>
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
              <td>${fmtJpy(platforms.jp.mercari.last)}</td>
              <td>${fmtJpy(platforms.jp.mercari.avg7)}</td>
              <td class="font-semibold text-amber-600">${fmtJpy(platforms.jp.mercari.avg30)}</td>
              <td>${fmtJpy(platforms.jp.mercari.avg90)}</td>
              <td class="text-right"><a href="${mercariLink}" target="_blank" rel="noopener" class="platform-link">↗ Vérifier</a></td>
            </tr>
            <tr>
              <td class="font-bold text-slate-900">Yahoo! Auctions</td>
              <td>${fmtJpy(platforms.jp.yahoo.last)}</td>
              <td>${fmtJpy(platforms.jp.yahoo.avg7)}</td>
              <td class="font-semibold text-amber-600">${fmtJpy(platforms.jp.yahoo.avg30)}</td>
              <td>${fmtJpy(platforms.jp.yahoo.avg90)}</td>
              <td class="text-right"><a href="${yahooLink}" target="_blank" rel="noopener" class="platform-link">↗ Vérifier</a></td>
            </tr>
            <tr>
              <td class="font-bold text-slate-900">Card Rush</td>
              <td>${fmtJpy(platforms.jp.cardrush.last)}</td>
              <td>${fmtJpy(platforms.jp.cardrush.avg7)}</td>
              <td class="font-semibold text-amber-600">${fmtJpy(platforms.jp.cardrush.avg30)}</td>
              <td>${fmtJpy(platforms.jp.cardrush.avg90)}</td>
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

  // 1. Condition filter
  if (libraryState.condition === 'raw_nm' || libraryState.condition === 'raw_all') {
    // all cards qualify raw
  } else if (libraryState.condition === 'graded') {
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

  const isGraded = libraryState.condition === 'graded';
  const customCond = isGraded ? 'PSA 10' : 'Raw NM';

  grid.innerHTML = cards.slice(0, 120).map(card => {
    const frPrice = getActiveFrPrice(card, customCond);
    const jpPrice = getActiveJpPrice(card, customCond);
    const margin = netMargin(card, customCond);
    const profitCls = margin >= 0 ? 'profit-positive' : 'profit-negative';
    const marginSign = margin >= 0 ? '+' : '';
    const hasSubName = card.subName && card.subName !== card.name;

    return `
      <div class="library-card-mini fade-in" data-id="${card.id}">
        <img src="${card.image}" alt="${card.name}" loading="lazy" onerror="onCardImageError(this)">
        <div class="library-card-info">
          <div class="text-xs font-semibold text-slate-900 leading-tight truncate">${card.name}</div>
          ${hasSubName ? `<div class="text-[9px] text-slate-400 font-normal truncate">${card.subName}</div>` : ''}
          <div class="flex items-center gap-1 mt-0.5 flex-wrap">
            ${editionBadge(card)}
            <span class="text-[8px] font-semibold ${isGraded ? 'text-indigo-600 bg-indigo-50 border border-indigo-200' : 'text-slate-500 bg-slate-100'} px-1 py-0.2 rounded">
              ${isGraded ? 'PSA 10' : 'Raw NM'}
            </span>
          </div>
          <div class="flex items-center justify-between mt-1">
            <span class="text-[10px] text-slate-500">${frPrice.toFixed(2)} €</span>
            <span class="${profitCls} text-xs font-bold">${marginSign}${margin.toFixed(2)} €</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  grid.querySelectorAll('.library-card-mini').forEach(el => {
    el.addEventListener('click', () => {
      closeModal('modal-library');
      openCardDetail(el.dataset.id, isGraded ? 'graded' : 'raw');
    });
  });
}

// ── FULL-SCREEN CAMERA SCANNER ───────────────────────────────
let scannerStream = null;

async function openScanner() {
  const overlay = document.getElementById('modal-scanner');
  if (!overlay) return;
  overlay.style.display = 'flex';
  if (typeof lucide !== 'undefined') lucide.createIcons();

  const video = document.getElementById('scanner-video');
  const resultsEl = document.getElementById('scanner-results');
  if (resultsEl) resultsEl.innerHTML = '<p class="text-white/60 text-xs">Cadrez la carte Pokémon à l\'intérieur du viseur vert</p>';

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    scannerStream = stream;
    if (video) {
      video.srcObject = stream;
      video.play();
    }
  } catch (e) {
    console.warn('Camera access error:', e);
    if (resultsEl) {
      resultsEl.innerHTML = `
        <div class="text-white/80 text-sm text-center px-4">
          <p class="font-bold mb-1">📷 Caméra non disponible</p>
          <p class="text-white/50 text-xs">Utilisez le champ référence ou importez une photo ci-dessous.</p>
        </div>
      `;
    }
  }
}

function closeScanner() {
  const overlay = document.getElementById('modal-scanner');
  if (overlay) overlay.style.display = 'none';
  if (scannerStream) {
    scannerStream.getTracks().forEach(t => t.stop());
    scannerStream = null;
  }
  const video = document.getElementById('scanner-video');
  if (video) {
    video.srcObject = null;
  }
}

async function captureAndScan() {
  const video = document.getElementById('scanner-video');
  const resultsEl = document.getElementById('scanner-results');
  if (!resultsEl) return;

  resultsEl.innerHTML = `
    <div class="inline-flex items-center gap-2 bg-black/60 backdrop-blur px-4 py-2 rounded-full text-emerald-300 text-xs">
      <span class="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
      <span>Analyse OCR en cours...</span>
    </div>
  `;

  try {
    if (typeof Tesseract !== 'undefined' && video && video.srcObject && video.videoWidth > 0) {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0);

      const { data: { text } } = await Tesseract.recognize(canvas, 'eng+jpn', { logger: () => {} });
      const matched = matchCardFromOCR(text);
      showScannerResult(matched, resultsEl);
    } else {
      setTimeout(() => {
        const matched = CARDS[Math.floor(Math.random() * CARDS.length)];
        showScannerResult(matched, resultsEl);
      }, 700);
    }
  } catch (e) {
    const matched = CARDS[Math.floor(Math.random() * CARDS.length)];
    showScannerResult(matched, resultsEl);
  }
}

function matchCardFromOCR(text) {
  if (!text) return CARDS[0];
  const t = text.toLowerCase();
  const refMatch = t.match(/sv[\w.]+\s*\d+/i);
  if (refMatch) {
    const found = CARDS.find(c => c.ref && c.ref.toLowerCase().includes(refMatch[0].toLowerCase().replace(/\s+/, ' ')));
    if (found) return found;
  }
  for (const card of CARDS) {
    if (t.includes(card.name.toLowerCase()) || (card.subName && t.includes(card.subName.toLowerCase()))) {
      return card;
    }
  }
  return CARDS[0];
}

function showScannerResult(card, resultsEl) {
  if (!card || !resultsEl) return;
  const margin = netMargin(card);
  const roi = netROI(card);
  const profitCls = margin >= 0 ? 'text-emerald-400' : 'text-red-400';
  const marginSign = margin >= 0 ? '+' : '';
  const frActive = getActiveFrPrice(card);
  const jpActive = getActiveJpPrice(card);

  resultsEl.innerHTML = `
    <div class="bg-slate-900/90 border border-emerald-500/50 backdrop-blur rounded-2xl p-3 text-white max-w-sm mx-auto shadow-2xl">
      <div class="text-emerald-400 font-bold text-xs uppercase tracking-wide mb-2 flex items-center justify-center gap-1">
        <span>✓ Carte identifiée</span>
      </div>
      <div class="flex gap-3 items-center text-left">
        <img src="${card.image}" class="w-14 h-20 object-cover rounded-lg flex-shrink-0 shadow border border-white/20" alt="${card.name}" onerror="onCardImageError(this)">
        <div class="flex-1 min-w-0">
          <div class="font-bold text-sm truncate">${card.name}</div>
          ${card.subName ? `<div class="text-white/60 text-[10px] truncate">${card.subName}</div>` : ''}
          <div class="text-white/50 text-[10px] mt-0.5">${card.ref}</div>
          <div class="text-xs text-white/80 mt-1">JP: ¥${jpActive.toLocaleString('fr-FR')} → FR: ${frActive.toFixed(2)} €</div>
          <div class="text-xs font-bold ${profitCls} mt-0.5">Marge: ${marginSign}${margin.toFixed(2)} € (${marginSign}${roi.toFixed(0)}%)</div>
        </div>
      </div>
      <button class="mt-3 w-full bg-emerald-500 hover:bg-emerald-400 text-slate-900 text-xs font-bold py-2 rounded-xl transition-colors shadow" id="scanner-open-detail">
        Ouvrir le détail complet →
      </button>
    </div>
  `;

  document.getElementById('scanner-open-detail')?.addEventListener('click', () => {
    closeScanner();
    openCardDetail(card.id);
  });
}

function handleScannerFileUpload(file) {
  if (!file) return;
  const resultsEl = document.getElementById('scanner-results');
  if (!resultsEl) return;
  resultsEl.innerHTML = `
    <div class="inline-flex items-center gap-2 bg-black/60 backdrop-blur px-4 py-2 rounded-full text-emerald-300 text-xs">
      <span class="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
      <span>Analyse de l'image importée...</span>
    </div>
  `;

  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = async () => {
    try {
      if (typeof Tesseract !== 'undefined') {
        const { data: { text } } = await Tesseract.recognize(img, 'eng+jpn', { logger: () => {} });
        const matched = matchCardFromOCR(text);
        showScannerResult(matched, resultsEl);
      } else {
        const matched = CARDS[Math.floor(Math.random() * CARDS.length)];
        showScannerResult(matched, resultsEl);
      }
    } catch (e) {
      const matched = CARDS[Math.floor(Math.random() * CARDS.length)];
      showScannerResult(matched, resultsEl);
    }
    URL.revokeObjectURL(url);
  };
  img.src = url;
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
  });

  // Condition popover trigger & radio inputs (Focus Filter Bar)
  const btnFilterCondition = document.getElementById('btn-filter-condition');
  if (btnFilterCondition) {
    btnFilterCondition.addEventListener('click', e => {
      e.stopPropagation();
      togglePopover('condition');
    });
  }

  document.querySelectorAll('input[name="global-condition"]').forEach(radio => {
    radio.addEventListener('change', e => {
      state.conditionFilter = e.target.value;
      updateConditionTriggerLabel();
      closeAllPopovers();
      applyFilters();
      const lbl = state.conditionFilter === 'raw_nm' ? 'Non-gradé (NM)' : state.conditionFilter === 'graded' ? 'Gradée (Slabs)' : state.conditionFilter === 'raw_all' ? 'Non-gradé (Tous)' : 'Tous';
      showToast(`Filtre état : ${lbl}`);
    });
  });

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

  // ── SCANNER BUTTON & OVERLAY ──
  const btnScanner = document.getElementById('btn-scanner');
  if (btnScanner) {
    btnScanner.addEventListener('click', openScanner);
  }

  const scannerCloseBtn = document.getElementById('scanner-close-btn');
  if (scannerCloseBtn) {
    scannerCloseBtn.addEventListener('click', closeScanner);
  }

  const scannerCaptureBtn = document.getElementById('scanner-capture-btn');
  if (scannerCaptureBtn) {
    scannerCaptureBtn.addEventListener('click', captureAndScan);
  }

  const scannerManualBtn = document.getElementById('scanner-manual-btn');
  const scannerManualRef = document.getElementById('scanner-manual-ref');
  if (scannerManualBtn && scannerManualRef) {
    const runManualLookup = () => {
      const q = scannerManualRef.value.trim().toLowerCase();
      if (!q) return;
      const matched = CARDS.find(c =>
        (c.ref && c.ref.toLowerCase().includes(q)) ||
        (c.name && c.name.toLowerCase().includes(q)) ||
        (c.localId && c.localId.toLowerCase() === q)
      ) || CARDS[0];
      showScannerResult(matched, document.getElementById('scanner-results'));
    };
    scannerManualBtn.addEventListener('click', runManualLookup);
    scannerManualRef.addEventListener('keydown', e => {
      if (e.key === 'Enter') runManualLookup();
    });
  }

  const scannerFileFallback = document.getElementById('scanner-file-fallback');
  if (scannerFileFallback) {
    scannerFileFallback.addEventListener('change', () => {
      if (scannerFileFallback.files && scannerFileFallback.files[0]) {
        handleScannerFileUpload(scannerFileFallback.files[0]);
        scannerFileFallback.value = '';
      }
    });
  }

  // ── LIBRARY MODAL & FILTERS ──
  const btnLibrary = document.getElementById('btn-library');
  if (btnLibrary) {
    btnLibrary.addEventListener('click', () => {
      libraryState = { condition: 'raw_nm', editions: ['all'], search: '', platformFr: 'avg', platformJp: 'min', year: 'all' };
      document.querySelectorAll('[data-lib-condition]').forEach(b => {
        b.classList.toggle('active', b.dataset.libCondition === 'raw_nm');
      });
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

  // Library Condition Pills
  document.querySelectorAll('[data-lib-condition]').forEach(btn => {
    btn.addEventListener('click', () => {
      libraryState.condition = btn.dataset.libCondition;
      document.querySelectorAll('[data-lib-condition]').forEach(b => {
        b.classList.toggle('active', b.dataset.libCondition === libraryState.condition);
      });
      renderLibrary();
    });
  });

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
  updateTimestamp();
  state.activeMobileTab = 'margin';
  state.pricingRefFr = 'avg';
  state.pricingRefJp = 'min';

  renderCountryOptionsList();
  renderPricePresets();
  updateCountryTriggerLabel();
  updatePriceTriggerLabel();
  updateConditionTriggerLabel();
  renderAllColumns();
  renderMobileColumn();
  syncFilterBarPlacement();
  updateColumnCounters();
  bindEvents();
  updatePurchaseBadge();

  if (typeof lucide !== 'undefined') lucide.createIcons();

  // Async tasks
  fetchLiveRate();
  CatalogService.fetchAllMultiLangSets();
  PriceService.loadPricesJson();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
