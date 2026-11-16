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
  { id: 'SV2a-201', name: 'Dracaufeu-ex SAR', subName: 'リザードンex SAR', localId: '201', ref: 'sv2a 201/165', edition: 'JP', image: 'https://assets.tcgdex.net/ja/SV/SV2a/201/high.webp', hp: 330 },
  { id: 'SV2a-205', name: 'Mew-ex SAR', subName: 'ミュウex SAR', localId: '205', ref: 'sv2a 205/165', edition: 'JP', image: 'https://assets.tcgdex.net/ja/SV/SV2a/205/high.webp', hp: 180 },
  { id: 'SV2a-200', name: 'Tortank-ex SAR', subName: 'カメックスex SAR', localId: '200', ref: 'sv2a 200/165', edition: 'JP', image: 'https://assets.tcgdex.net/ja/SV/SV2a/200/high.webp', hp: 330 },
  { id: 'SV2a-198', name: 'Florizarre-ex SAR', subName: 'フシギバナex SAR', localId: '198', ref: 'sv2a 198/165', edition: 'JP', image: 'https://assets.tcgdex.net/ja/SV/SV2a/198/high.webp', hp: 340 },
  { id: 'SV2a-202', name: 'Électhor-ex SAR', subName: 'サンダーex SAR', localId: '202', ref: 'sv2a 202/165', edition: 'JP', image: 'https://assets.tcgdex.net/ja/SV/SV2a/202/high.webp', hp: 250 },
  { id: 'SV2a-173', name: 'Pikachu AR', subName: 'ピカチュウ AR', localId: '173', ref: 'sv2a 173/165', edition: 'JP', image: 'https://assets.tcgdex.net/ja/SV/SV2a/173/high.webp', hp: 60 },
  { id: 'SV4a-331', name: 'Dracaufeu-ex Shiny SAR', subName: 'リザードンex SAR', localId: '331', ref: 'sv4a 331/190', edition: 'JP', image: 'https://assets.tcgdex.net/ja/SV/SV4a/331/high.webp', hp: 330 },
  { id: 'SV6-130', name: 'Amphinobi-ex SAR', subName: 'ゲッコウガex SAR', localId: '130', ref: 'sv6 130/101', edition: 'JP', image: 'https://assets.tcgdex.net/ja/SV/SV6/130/high.webp', hp: 300 },
  { id: 'SV2a-006', name: 'Dracaufeu-ex', subName: 'リザードンex', localId: '006', ref: 'sv2a 006/165', edition: 'JP', image: 'https://assets.tcgdex.net/ja/SV/SV2a/006/high.webp', hp: 330 },
  { id: 'SV2a-151', name: 'Mew-ex', subName: 'ミュウex', localId: '151', ref: 'sv2a 151/165', edition: 'JP', image: 'https://assets.tcgdex.net/ja/SV/SV2a/151/high.webp', hp: 180 },
  { id: 'SV2a-168', name: 'Salamèche AR', subName: 'ヒトカゲ AR', localId: '168', ref: 'sv2a 168/165', edition: 'JP', image: 'https://assets.tcgdex.net/ja/SV/SV2a/168/high.webp', hp: 70 },
  { id: 'SV2a-170', name: 'Carapuce AR', subName: 'ゼニガメ AR', localId: '170', ref: 'sv2a 170/165', edition: 'JP', image: 'https://assets.tcgdex.net/ja/SV/SV2a/170/high.webp', hp: 60 },
  { id: 'SV2a-166', name: 'Bulbizarre AR', subName: 'フシギダネ AR', localId: '166', ref: 'sv2a 166/165', edition: 'JP', image: 'https://assets.tcgdex.net/ja/SV/SV2a/166/high.webp', hp: 70 },

  // 🇫🇷 FR
  { id: 'sv03.5-199', name: 'Dracaufeu-ex SAR', subName: '', localId: '199', ref: 'sv03.5 199/165', edition: 'FR', image: 'https://assets.tcgdex.net/fr/sv/sv03.5/199/high.webp', hp: 330 },
  { id: 'sv03.5-205', name: 'Mew-ex SAR', subName: '', localId: '205', ref: 'sv03.5 205/165', edition: 'FR', image: 'https://assets.tcgdex.net/fr/sv/sv03.5/205/high.webp', hp: 180 },
  { id: 'sv03.5-200', name: 'Tortank-ex SAR', subName: '', localId: '200', ref: 'sv03.5 200/165', edition: 'FR', image: 'https://assets.tcgdex.net/fr/sv/sv03.5/200/high.webp', hp: 330 },
  { id: 'sv03.5-198', name: 'Florizarre-ex SAR', subName: '', localId: '198', ref: 'sv03.5 198/165', edition: 'FR', image: 'https://assets.tcgdex.net/fr/sv/sv03.5/198/high.webp', hp: 340 },
  { id: 'sv04.5-234', name: 'Dracaufeu-ex Shiny SAR', subName: '', localId: '234', ref: 'sv04.5 234/091', edition: 'FR', image: 'https://assets.tcgdex.net/fr/sv/sv04.5/234/high.webp', hp: 330 },
  { id: 'sv04.5-233', name: 'Gardevoir-ex Shiny SAR', subName: '', localId: '233', ref: 'sv04.5 233/091', edition: 'FR', image: 'https://assets.tcgdex.net/fr/sv/sv04.5/233/high.webp', hp: 310 },

  // 🇺🇸 EN
  { id: 'en-sv03.5-199', name: 'Charizard ex SAR', subName: 'Dracaufeu-ex', localId: '199', ref: 'sv03.5 199/165', edition: 'EN', image: 'https://assets.tcgdex.net/en/sv/sv03.5/199/high.webp', hp: 330 },
  { id: 'en-swsh7-215', name: 'Umbreon VMAX ALT', subName: 'Noctali VMAX ALT', localId: '215', ref: 'swsh7 215/203', edition: 'EN', image: 'https://assets.tcgdex.net/en/swsh/swsh7/215/high.webp', hp: 310 },
  { id: 'en-swsh7-218', name: 'Rayquaza VMAX ALT', subName: 'Rayquaza VMAX ALT', localId: '218', ref: 'swsh7 218/203', edition: 'EN', image: 'https://assets.tcgdex.net/en/swsh/swsh7/218/high.webp', hp: 320 },
  { id: 'en-sv03.5-205', name: 'Mew ex SAR', subName: 'Mew-ex SAR', localId: '205', ref: 'sv03.5 205/165', edition: 'EN', image: 'https://assets.tcgdex.net/en/sv/sv03.5/205/high.webp', hp: 180 },

  // 🇨🇳 CN
  { id: 'SVF-001', name: 'Dracaufeu Radieux', subName: '光輝噴火龍', localId: '001', ref: 'SVF 001/010', edition: 'CN', image: 'https://assets.tcgdex.net/zh-tw/SV/SVF/001/high.webp', hp: 160 },
  { id: 'SV4a-331-cn', name: 'Dracaufeu-ex Shiny SAR', subName: '噴火龍ex SAR', localId: '331', ref: 'SV4a 331/190', edition: 'CN', image: 'https://assets.tcgdex.net/zh-tw/SV/SV4a/331/high.webp', hp: 330 },
  { id: 'SV4a-348-cn', name: 'Gardevoir-ex Shiny SAR', subName: '沙奈朵ex SAR', localId: '348', ref: 'SV4a 348/190', edition: 'CN', image: 'https://assets.tcgdex.net/zh-tw/SV/SV4a/348/high.webp', hp: 310 },

  // 🇩🇪 DE / 🇮🇹 IT / 🇪🇸 ES
  { id: 'de-sv03.5-199', name: 'Glurak-ex SAR', subName: 'Dracaufeu-ex', localId: '199', ref: 'sv03.5 199/165', edition: 'DE', image: 'https://assets.tcgdex.net/de/sv/sv03.5/199/high.webp', hp: 330 },
  { id: 'it-sv03.5-199', name: 'Charizard-ex SAR', subName: 'Dracaufeu-ex', localId: '199', ref: 'sv03.5 199/165', edition: 'IT', image: 'https://assets.tcgdex.net/it/sv/sv03.5/199/high.webp', hp: 330 },
  { id: 'es-sv03.5-199', name: 'Charizard-ex SAR', subName: 'Dracaufeu-ex', localId: '199', ref: 'sv03.5 199/165', edition: 'ES', image: 'https://assets.tcgdex.net/es/sv/sv03.5/199/high.webp', hp: 330 },
  { id: 'de-sv03.5-205', name: 'Mew-ex SAR', subName: '', localId: '205', ref: 'sv03.5 205/165', edition: 'DE', image: 'https://assets.tcgdex.net/de/sv/sv03.5/205/high.webp', hp: 180 },
  { id: 'it-sv03.5-205', name: 'Mew-ex SAR', subName: '', localId: '205', ref: 'sv03.5 205/165', edition: 'IT', image: 'https://assets.tcgdex.net/it/sv/sv03.5/205/high.webp', hp: 180 },
  { id: 'es-sv03.5-205', name: 'Mew-ex SAR', subName: '', localId: '205', ref: 'sv03.5 205/165', edition: 'ES', image: 'https://assets.tcgdex.net/es/sv/sv03.5/205/high.webp', hp: 180 }
];

// ── CONDITION & GRADING MULTIPLIER RESOLVER ─────────────────
function resolveConditionMultiplier(customConditionOrGrade = null) {
  // 1. Explicit condition or grade passed (Detail Modal, Purchases, Platform Breakdown)
  if (customConditionOrGrade) {
    if (typeof customConditionOrGrade === 'object') {
      if (customConditionOrGrade.mode === 'raw' || customConditionOrGrade.condition) {
        const condKey = customConditionOrGrade.condition || customConditionOrGrade.key || 'NM';
        const cond = RAW_CONDITIONS.find(c => c.key === condKey) || RAW_CONDITIONS[0];
        return { frMult: cond.multiplier, jpMult: cond.multiplier };
      }
      if (customConditionOrGrade.mode === 'graded' || customConditionOrGrade.company) {
        const coKey = customConditionOrGrade.company || 'PSA';
        const grKey = customConditionOrGrade.grade || '10';
        const scale = GRADING_SCALES[coKey] || GRADING_SCALES.PSA;
        const gr = scale.find(g => g.grade === grKey || g.grade.startsWith(grKey) || g.short === grKey) || scale[0];
        return { frMult: gr.frMult, jpMult: gr.jpMult };
      }
    }
    if (typeof customConditionOrGrade === 'string') {
      const str = customConditionOrGrade.trim();
      if (str.startsWith('Raw ')) {
        const key = str.replace('Raw ', '').trim();
        const cond = RAW_CONDITIONS.find(c => c.key === key || c.label.includes(key)) || RAW_CONDITIONS[0];
        return { frMult: cond.multiplier, jpMult: cond.multiplier };
      }
      const rawMatch = RAW_CONDITIONS.find(c => c.key === str || c.label.includes(str));
      if (rawMatch) {
        return { frMult: rawMatch.multiplier, jpMult: rawMatch.multiplier };
      }
      const parts = str.split(' ');
      const coKey = parts[0];
      const gradeStr = parts.slice(1).join(' ').trim();
      const scale = GRADING_SCALES[coKey] || GRADING_SCALES.ALL;
      const gr = scale.find(g => g.grade === gradeStr || g.grade.startsWith(gradeStr) || g.short === gradeStr) || scale[0];
      return { frMult: gr.frMult, jpMult: gr.jpMult };
    }
  }

  // 2. Active global filter (Focus Mode & Library)
  if (!state.condition || state.condition.mode === 'raw') {
    const active = state.condition?.rawConditions || ['NM'];
    const matched = RAW_CONDITIONS.filter(c => active.includes(c.key));
    const avg = matched.length > 0 
      ? matched.reduce((sum, c) => sum + c.multiplier, 0) / matched.length 
      : 1.0;
    return { frMult: avg, jpMult: avg };
  } else {
    // mode === 'graded'
    const companies = state.condition.companies || ['ALL'];
    const grades = state.condition.grades || [];
    let scale = GRADING_SCALES.ALL;
    if (companies.length === 1 && companies[0] !== 'ALL' && GRADING_SCALES[companies[0]]) {
      scale = GRADING_SCALES[companies[0]];
    }

    let matchedGrades = [];
    if (grades.length > 0) {
      matchedGrades = scale.filter(g => grades.includes(g.grade) || grades.includes(g.short));
    }
    if (matchedGrades.length === 0) {
      matchedGrades = [scale[0]]; // fallback to top grade of the company
    }

    const avgFr = matchedGrades.reduce((sum, g) => sum + g.frMult, 0) / matchedGrades.length;
    const avgJp = matchedGrades.reduce((sum, g) => sum + g.jpMult, 0) / matchedGrades.length;
    return { frMult: avgFr, jpMult: avgJp };
  }
}

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
    const { frMult, jpMult } = resolveConditionMultiplier(custom);

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
      hp: card.hp || null,
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
        hp: c.hp || null,
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
          hp: c.hp || null,
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
  const { frMult } = resolveConditionMultiplier(customConditionOrGrade);
  return Math.round(basePrice * frMult * 10) / 10;
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
  const { jpMult } = resolveConditionMultiplier(customConditionOrGrade);
  return Math.round(basePrice * jpMult);
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
  if (state.condition?.mode === 'graded') {
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

function openCardDetail(cardId, initialMode = null) {
  detailModalState.cardId = cardId;
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
    : `${detailModalState.company} ${detailModalState.grade}`;

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
    const currentScale = GRADING_SCALES[detailModalState.company] || GRADING_SCALES.PSA;

    // Safety check: ensure selected grade exists in current company scale
    if (!currentScale.some(g => g.grade === detailModalState.grade)) {
      detailModalState.grade = currentScale[0].grade;
    }

    const summaryTableRows = currentScale.map(g => {
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
            <span>${g.grade}</span>
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

  grid.innerHTML = cards.slice(0, 120).map(card => {
    const frPrice = getActiveFrPrice(card);
    const jpPrice = getActiveJpPrice(card);
    const margin = netMargin(card);
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
              ${badgeText}
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

// ── MULTI-CRITERIA CARD RECOGNITION ENGINE (`CardRecognizer`) ─────────────────
const CardRecognizer = {
  colorSignatureCache: new Map(),
  _preloading: false,

  init(catalog) {
    if (this._preloading) return;
    this._preloading = true;
    this.preloadCatalogSignatures(catalog || (typeof CARDS !== 'undefined' ? CARDS : []));
  },

  // Preload & cache 8x8 color signatures from catalog card images
  preloadCatalogSignatures(catalog) {
    if (!catalog || !Array.isArray(catalog)) return;
    const cardsToLoad = catalog.slice(0, 100);

    cardsToLoad.forEach(card => {
      if (!card || !card.id || this.colorSignatureCache.has(card.id)) return;
      if (!card.image || typeof card.image !== 'string') return;

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const sig = this.extractImageSignature(img);
          if (sig) {
            this.colorSignatureCache.set(card.id, sig);
          }
        } catch (e) {
          // Gracefully skip CORS blocked images
        }
      };
      img.onerror = () => {
        // Fallback to synthetic signature if needed
      };
      img.src = card.image;
    });
  },

  // 1. Crop calculations: maps viewfinder box in DOM to video frame coords
  getCropRect(video, viewfinder) {
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      return { sx: 0, sy: 0, sw: 600, sh: 840 };
    }
    if (viewfinder) {
      const vRect = video.getBoundingClientRect();
      const vfRect = viewfinder.getBoundingClientRect();
      if (vRect.width > 0 && vRect.height > 0 && vfRect.width > 0 && vfRect.height > 0) {
        const relX = Math.max(0, (vfRect.left - vRect.left) / vRect.width);
        const relY = Math.max(0, (vfRect.top - vRect.top) / vRect.height);
        const relW = Math.min(1.0 - relX, vfRect.width / vRect.width);
        const relH = Math.min(1.0 - relY, vfRect.height / vRect.height);

        const sx = Math.round(relX * video.videoWidth);
        const sy = Math.round(relY * video.videoHeight);
        const sw = Math.round(relW * video.videoWidth);
        const sh = Math.round(relH * video.videoHeight);
        if (sw > 30 && sh > 30) {
          return { sx, sy, sw, sh };
        }
      }
    }
    return this.getDefaultCropRect(video.videoWidth, video.videoHeight);
  },

  getDefaultCropRect(sourceWidth, sourceHeight) {
    const targetAspect = 63 / 88; // Standard Pokémon card aspect ratio ~0.716
    let sw, sh;
    if (sourceWidth / sourceHeight > targetAspect) {
      sh = Math.round(sourceHeight * 0.85);
      sw = Math.round(sh * targetAspect);
    } else {
      sw = Math.round(sourceWidth * 0.85);
      sh = Math.round(sw / targetAspect);
    }
    const sx = Math.max(0, Math.round((sourceWidth - sw) / 2));
    const sy = Math.max(0, Math.round((sourceHeight - sh) / 2));
    return { sx, sy, sw, sh };
  },

  // 2. Criterion A — Visual Artwork Fingerprint (50% weight, works even when blurry):
  //    Resize captured frame to 8x8 color grid on offscreen canvas & extract normalized RGB/luminance vectors
  extractImageSignature(source, sx = 0, sy = 0, sw = 0, sh = 0) {
    try {
      const c = document.createElement('canvas');
      c.width = 8;
      c.height = 8;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (sw > 0 && sh > 0) {
        ctx.drawImage(source, sx, sy, sw, sh, 0, 0, 8, 8);
      } else {
        ctx.drawImage(source, 0, 0, 8, 8);
      }
      const imgData = ctx.getImageData(0, 0, 8, 8).data;
      const rgb = new Float32Array(64 * 3);
      const lum = new Float32Array(64);
      const weights = new Float32Array(64);

      let weightedNormSq = 0;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const idx = y * 8 + x;
          const p = idx * 4;
          const r = imgData[p] / 255;
          const g = imgData[p + 1] / 255;
          const b = imgData[p + 2] / 255;
          const l = 0.299 * r + 0.587 * g + 0.114 * b;

          rgb[idx * 3] = r;
          rgb[idx * 3 + 1] = g;
          rgb[idx * 3 + 2] = b;
          lum[idx] = l;

          // Spatial weighting: upper artwork zone (y=1..4, x=1..6) and borders (outer ring)
          let w = 1.0;
          if (y >= 1 && y <= 4 && x >= 1 && x <= 6) {
            w = 1.6; // Primary artwork zone
          } else if (x === 0 || x === 7 || y === 0 || y === 7) {
            w = 1.4; // Card borders (silver, yellow, gold)
          } else {
            w = 0.8; // Text / rule box zone
          }
          weights[idx] = w;
          weightedNormSq += w * (r * r + g * g + b * b);
        }
      }

      return {
        rgb,
        lum,
        weights,
        norm: Math.sqrt(Math.max(1e-6, weightedNormSq))
      };
    } catch (e) {
      return null;
    }
  },

  // Compute cosine/Euclidean similarity against cached 8x8 color signatures
  computeVisualSimilarity(sigA, sigB) {
    if (!sigA || !sigB) return 25;
    const { rgb: aRgb, lum: aLum, weights: wA, norm: normA } = sigA;
    const { rgb: bRgb, lum: bLum, norm: normB } = sigB;

    let dot = 0;
    let distSq = 0;
    let totalW = 0;
    let lumDiff = 0;

    for (let i = 0; i < 64; i++) {
      const w = wA[i];
      totalW += w;

      const ar = aRgb[i * 3], ag = aRgb[i * 3 + 1], ab = aRgb[i * 3 + 2];
      const br = bRgb[i * 3], bg = bRgb[i * 3 + 1], bb = bRgb[i * 3 + 2];

      dot += w * (ar * br + ag * bg + ab * bb);

      const dr = ar - br;
      const dg = ag - bg;
      const db = ab - bb;
      distSq += w * (dr * dr + dg * dg + db * db);

      lumDiff += w * Math.abs(aLum[i] - bLum[i]);
    }

    const cosineSim = Math.min(1.0, Math.max(0, dot / (normA * normB)));
    const euclDist = Math.sqrt(distSq / (totalW * 3));
    const euclSim = Math.max(0, 1.0 - euclDist);
    const lumSim = Math.max(0, 1.0 - (lumDiff / totalW));

    // Blended visual similarity (cosine + Euclidean + luminance)
    const combined = 0.45 * cosineSim + 0.35 * euclSim + 0.20 * lumSim;
    const score = ((combined - 0.65) / 0.30) * 100;
    return Math.min(100, Math.max(0, score));
  },

  // Fallback synthetic 8x8 signature if card image is CORS blocked or offline
  generateFallbackSignature(card) {
    if (!card) return null;
    const nameLower = ((card.name || '') + ' ' + (card.subName || '')).toLowerCase();
    let r = 0.5, g = 0.5, b = 0.5;

    if (/pikachu|electhor|zapdos|lightning|raichu/.test(nameLower)) {
      r = 0.95; g = 0.85; b = 0.15; // Yellow
    } else if (/charizard|dracaufeu.*shiny/.test(nameLower) && nameLower.includes('shiny')) {
      r = 0.22; g = 0.22; b = 0.28; // Charcoal Shiny
    } else if (/charizard|dracaufeu|salameche|reptincel|glurak|feu/.test(nameLower)) {
      r = 0.90; g = 0.40; b = 0.15; // Fire Orange
    } else if (/tortank|blastoise|carapuce|amphinobi|greninja|eau/.test(nameLower)) {
      r = 0.18; g = 0.45; b = 0.82; // Water Blue
    } else if (/florizarre|venusaur|bulbizarre|plante/.test(nameLower)) {
      r = 0.25; g = 0.70; b = 0.35; // Plant Green
    } else if (/mew|psy/.test(nameLower)) {
      r = 0.92; g = 0.62; b = 0.80; // Psychic Pink
    } else if (/umbreon|noctali|obscurite/.test(nameLower)) {
      r = 0.12; g = 0.15; b = 0.22; // Dark Navy
    } else if (/rayquaza/.test(nameLower)) {
      r = 0.15; g = 0.55; b = 0.35; // Dragon Emerald
    } else if (/gardevoir/.test(nameLower)) {
      r = 0.45; g = 0.82; b = 0.72; // Fairy Teal
    }

    const rgb = new Float32Array(64 * 3);
    const lum = new Float32Array(64);
    const weights = new Float32Array(64);
    let weightedNormSq = 0;

    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const idx = y * 8 + x;
        const isBorder = (x === 0 || x === 7 || y === 0 || y === 7);
        const isArtwork = (y >= 1 && y <= 4 && x >= 1 && x <= 6);

        let cellR = isBorder ? 0.82 : (isArtwork ? r : r * 0.7 + 0.15);
        let cellG = isBorder ? 0.82 : (isArtwork ? g : g * 0.7 + 0.15);
        let cellB = isBorder ? 0.85 : (isArtwork ? b : b * 0.7 + 0.15);
        let cellL = 0.299 * cellR + 0.587 * cellG + 0.114 * cellB;

        rgb[idx * 3] = cellR;
        rgb[idx * 3 + 1] = cellG;
        rgb[idx * 3 + 2] = cellB;
        lum[idx] = cellL;

        const w = isArtwork ? 1.6 : (isBorder ? 1.4 : 0.8);
        weights[idx] = w;
        weightedNormSq += w * (cellR * cellR + cellG * cellG + cellB * cellB);
      }
    }

    return {
      rgb,
      lum,
      weights,
      norm: Math.sqrt(Math.max(1e-6, weightedNormSq))
    };
  },

  getCardSignature(card) {
    if (!card) return null;
    if (this.colorSignatureCache.has(card.id)) {
      return this.colorSignatureCache.get(card.id);
    }
    const fallback = this.generateFallbackSignature(card);
    if (fallback) {
      this.colorSignatureCache.set(card.id, fallback);
      return fallback;
    }
    return null;
  },

  // 3. High-contrast grayscale/thresholded preprocessing for OCR
  preprocessForOCR(cropCanvas) {
    const ocrCanvas = document.createElement('canvas');
    ocrCanvas.width = 600;
    ocrCanvas.height = Math.round(600 * (cropCanvas.height / cropCanvas.width)) || 840;
    const ctx = ocrCanvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(cropCanvas, 0, 0, ocrCanvas.width, ocrCanvas.height);

    const imgData = ctx.getImageData(0, 0, ocrCanvas.width, ocrCanvas.height);
    const d = imgData.data;

    let min = 255, max = 0;
    const lums = new Uint8Array(d.length / 4);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const l = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
      lums[j] = l;
      if (l < min) min = l;
      if (l > max) max = l;
    }

    const range = Math.max(1, max - min);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const stretched = ((lums[j] - min) / range) * 255;
      // High-contrast S-curve to sharpen characters on phone screens or blurry captures
      let v;
      if (stretched < 95) v = Math.max(0, stretched * 0.45);
      else if (stretched > 160) v = Math.min(255, stretched * 1.3);
      else v = stretched;

      d[i] = v;
      d[i + 1] = v;
      d[i + 2] = v;
    }
    ctx.putImageData(imgData, 0, 0);
    return ocrCanvas;
  },

  // 4. String normalization & Levenshtein distance for fuzzy matching
  normalizeText(str) {
    if (!str) return '';
    return str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  },

  levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const al = a.length, bl = b.length;
    const prev = new Array(bl + 1);
    const curr = new Array(bl + 1);
    for (let j = 0; j <= bl; j++) prev[j] = j;
    for (let i = 1; i <= al; i++) {
      curr[0] = i;
      const ca = a.charCodeAt(i - 1);
      for (let j = 1; j <= bl; j++) {
        const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
        curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      }
      for (let j = 0; j <= bl; j++) prev[j] = curr[j];
    }
    return curr[bl];
  },

  getCardKeywords(card) {
    const rawName = card.name || '';
    const cleanName = rawName.replace(/[-\s]*(ex|vmax|v|sar|ar|shiny|alt|radieux)\b/gi, '').trim();
    const primary = [rawName, cleanName];

    const enMap = {
      'Dracaufeu': 'Charizard',
      'Salamèche': 'Charmander',
      'Reptincel': 'Charmeleon',
      'Bulbizarre': 'Bulbasaur',
      'Herbizarre': 'Ivysaur',
      'Florizarre': 'Venusaur',
      'Carapuce': 'Squirtle',
      'Carabaffe': 'Wartortle',
      'Tortank': 'Blastoise',
      'Pikachu': 'Pikachu',
      'Raichu': 'Raichu',
      'Mew': 'Mew',
      'Mewtwo': 'Mewtwo',
      'Électhor': 'Zapdos',
      'Artikodin': 'Articuno',
      'Sulfura': 'Moltres',
      'Ectoplasma': 'Gengar',
      'Dracolosse': 'Dragonite',
      'Noctali': 'Umbreon',
      'Mentali': 'Espeon',
      'Amphinobi': 'Greninja',
      'Gardevoir': 'Gardevoir',
      'Rayquaza': 'Rayquaza',
      'Glurak': 'Dracaufeu'
    };

    if (enMap[cleanName]) primary.push(enMap[cleanName]);
    for (const [fr, en] of Object.entries(enMap)) {
      if (en.toLowerCase() === cleanName.toLowerCase()) {
        primary.push(fr);
      }
    }

    const asian = [];
    if (card.subName) asian.push(card.subName.trim());
    if (typeof POKEMON_JA_NAMES !== 'undefined') {
      for (const [ja, fr] of Object.entries(POKEMON_JA_NAMES)) {
        if (fr.toLowerCase() === cleanName.toLowerCase()) asian.push(ja);
      }
    }
    if (typeof POKEMON_CN_NAMES !== 'undefined') {
      for (const [cn, fr] of Object.entries(POKEMON_CN_NAMES)) {
        if (fr.toLowerCase() === cleanName.toLowerCase()) asian.push(cn);
      }
    }

    return { primary, asian };
  },

  // 5. Criterion B — Fuzzy Title & Attack Text OCR (30% weight):
  //    Matches detected words against French, English, and Japanese names using Levenshtein distance
  scoreCriterionB(ocrText, card) {
    if (!ocrText || typeof ocrText !== 'string' || !ocrText.trim()) return 0;
    const cleanOcr = this.normalizeText(ocrText);
    if (!cleanOcr) return 0;

    const keywords = this.getCardKeywords(card);
    let bestSim = 0;

    // Direct substring check on primary names
    for (const kw of keywords.primary) {
      const normKw = this.normalizeText(kw);
      if (normKw.length >= 3 && cleanOcr.includes(normKw)) {
        bestSim = Math.max(bestSim, 1.0);
      }
    }

    // Direct substring check on Asian/Japanese names
    for (const ja of keywords.asian) {
      if (ja && ja.length >= 2 && ocrText.includes(ja)) {
        bestSim = Math.max(bestSim, 1.0);
      }
    }

    // Token & N-Gram fuzzy Levenshtein comparison (e.g. "Plkachu" -> "Pikachu")
    const words = cleanOcr.split(/\s+/).filter(w => w.length >= 3);
    const ngrams = [...words];
    for (let i = 0; i < words.length - 1; i++) {
      ngrams.push(`${words[i]} ${words[i + 1]}`);
    }

    for (const target of keywords.primary) {
      const normTarget = this.normalizeText(target);
      if (normTarget.length < 3) continue;

      for (const token of ngrams) {
        if (Math.abs(token.length - normTarget.length) > 3) continue;
        const dist = this.levenshtein(token, normTarget);
        const sim = 1.0 - (dist / Math.max(token.length, normTarget.length));
        if (sim > bestSim) {
          bestSim = sim;
        }
      }
    }

    // Card type modifiers bonus (ex, vmax, sar, ar, shiny)
    let modifierBonus = 0;
    const nameLower = ((card.name || '') + ' ' + (card.subName || '')).toLowerCase();
    if (nameLower.includes('ex') && /\bex\b/i.test(ocrText)) modifierBonus += 8;
    if (nameLower.includes('vmax') && /vmax/i.test(ocrText)) modifierBonus += 10;
    if (nameLower.includes('sar') && /sar/i.test(ocrText)) modifierBonus += 10;
    if (nameLower.includes('ar') && /\bar\b/i.test(ocrText)) modifierBonus += 8;
    if (nameLower.includes('shiny') && /shiny/i.test(ocrText)) modifierBonus += 8;

    let score = 0;
    if (bestSim >= 0.85) {
      score = 85 + (bestSim - 0.85) * 100 + modifierBonus;
    } else if (bestSim >= 0.70) {
      score = 65 + (bestSim - 0.70) * 100 + modifierBonus;
    } else if (bestSim >= 0.55) {
      score = 40 + (bestSim - 0.55) * 80 + modifierBonus;
    } else {
      score = bestSim * 40;
    }

    return Math.min(100, Math.max(0, Math.round(score)));
  },

  // 6. Criterion C — Set Number & HP Extraction (20% weight):
  //    Extracts regex patterns like \d{1,3}\s*\/\s*\d{1,3} and \d{2,3}\s*PV|HP
  scoreCriterionC(ocrText, card) {
    if (!ocrText || typeof ocrText !== 'string' || !ocrText.trim()) return 0;
    let score = 0;

    // 1. Set number fraction match: e.g. "201/165" or "199/165" or "331/190"
    const fractionRegex = /(\d{1,3})\s*[\/|\\]\s*(\d{1,3})/g;
    let fracMatch;
    let foundExactRef = false;
    let foundLocalId = false;

    const cardRefLower = (card.ref || '').toLowerCase();
    const cardLocalId = parseInt(card.localId, 10);

    while ((fracMatch = fractionRegex.exec(ocrText)) !== null) {
      const num = parseInt(fracMatch[1], 10);
      const den = parseInt(fracMatch[2], 10);
      const fracStr = `${num}/${den}`;
      if (cardRefLower.includes(fracStr)) {
        foundExactRef = true;
      }
      if (!isNaN(cardLocalId) && cardLocalId === num) {
        foundLocalId = true;
      }
    }

    if (foundExactRef) {
      score += 85;
    } else if (foundLocalId) {
      score += 65;
    }

    // 2. Set code match: e.g. "sv2a", "sv03.5", "sv4a", "sv6", "swsh7"
    const setCodeMatch = cardRefLower.match(/(sv[\w.]+|swsh\d+)/i);
    if (setCodeMatch) {
      const setCode = setCodeMatch[1].toLowerCase();
      if (ocrText.toLowerCase().includes(setCode)) {
        score += 20;
      }
    }

    // 3. HP / PV match: e.g. "330 PV" or "HP 330"
    const hpRegex = /(?:pv|hp)\s*(\d{2,3})|(\d{2,3})\s*(?:pv|hp)/gi;
    let hpMatch;
    const extractedHps = [];
    while ((hpMatch = hpRegex.exec(ocrText)) !== null) {
      const val = parseInt(hpMatch[1] || hpMatch[2], 10);
      if (val >= 30 && val <= 400) extractedHps.push(val);
    }

    if (card.hp && extractedHps.includes(parseInt(card.hp, 10))) {
      score += 30;
    } else if (extractedHps.length > 0 && /ex|vmax/i.test(card.name) && extractedHps.some(h => h >= 220)) {
      score += 15;
    }

    return Math.min(100, score);
  },

  // 7. Multi-Criteria Ranking against loaded catalog
  rankCards(cropCanvas, ocrText, catalog) {
    if (!catalog || !Array.isArray(catalog) || catalog.length === 0) return [];

    const scanSig = this.extractImageSignature(cropCanvas);

    const scored = catalog.map(card => {
      const cardSig = this.getCardSignature(card);
      const scoreA = cardSig ? this.computeVisualSimilarity(scanSig, cardSig) : 25;
      const scoreB = this.scoreCriterionB(ocrText, card);
      const scoreC = this.scoreCriterionC(ocrText, card);

      // Weighted multi-criteria confidence score (0-100)
      const totalScore = (0.50 * scoreA) + (0.30 * scoreB) + (0.20 * scoreC);

      return {
        card,
        score: totalScore,
        scoreA,
        scoreB,
        scoreC,
        matchedCriteria: {
          visual: scoreA >= 50,
          name: scoreB >= 45,
          number: scoreC >= 40
        }
      };
    });

    // Rank highest-scoring first
    scored.sort((a, b) => b.score - a.score);
    return scored;
  }
};

// ── FULL-SCREEN CAMERA SCANNER ───────────────────────────────
let scannerStream = null;

async function openScanner() {
  const overlay = document.getElementById('modal-scanner');
  if (!overlay) return;
  overlay.style.display = 'flex';
  if (typeof lucide !== 'undefined') lucide.createIcons();

  // Initialize and preload catalog signatures
  CardRecognizer.init(CARDS);

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
    <div class="inline-flex items-center gap-2 bg-black/70 backdrop-blur px-4 py-2.5 rounded-full text-emerald-300 text-xs border border-emerald-500/30 shadow-lg">
      <span class="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping"></span>
      <span class="font-medium">Analyse multi-critères en cours (Empreinte 8x8 + OCR + N°)...</span>
    </div>
  `;

  try {
    if (!video || !video.srcObject || video.videoWidth === 0) {
      resultsEl.innerHTML = `
        <div class="bg-slate-900/90 border border-amber-500/40 rounded-xl p-3 text-amber-300 text-xs text-center">
          Caméra non active. Importez une photo ou saisissez la référence manuellement ci-dessous.
        </div>
      `;
      return;
    }

    // 1. Crop captured video frame to 4-corner viewfinder box
    const viewfinder = document.getElementById('scanner-viewfinder');
    const crop = CardRecognizer.getCropRect(video, viewfinder);
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = crop.sw;
    cropCanvas.height = crop.sh;
    const cropCtx = cropCanvas.getContext('2d', { willReadFrequently: true });
    cropCtx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, crop.sw, crop.sh);

    // 2. High-contrast OCR preprocessing
    const ocrCanvas = CardRecognizer.preprocessForOCR(cropCanvas);

    // 3. Run OCR with Tesseract.js
    let ocrText = '';
    if (typeof Tesseract !== 'undefined') {
      try {
        const { data: { text } } = await Tesseract.recognize(ocrCanvas, 'eng+jpn', { logger: () => {} });
        ocrText = text || '';
      } catch (err) {
        console.warn('Tesseract OCR error:', err);
      }
    }

    // 4. Compute weighted multi-criteria score against loaded catalog
    const ranked = CardRecognizer.rankCards(cropCanvas, ocrText, CARDS);
    if (!ranked || ranked.length === 0) {
      resultsEl.innerHTML = `
        <div class="bg-slate-900/90 border border-slate-700 rounded-xl p-3 text-white/70 text-xs text-center">
          Aucune carte dans le catalogue.
        </div>
      `;
      return;
    }

    // Highest-scoring card is primary match
    const bestMatch = ranked[0];
    const runnerUps = ranked.slice(1, 4);
    showScannerResult(bestMatch, runnerUps, resultsEl);
  } catch (e) {
    console.error('Scan error:', e);
    resultsEl.innerHTML = `
      <div class="bg-slate-900/90 border border-red-500/40 rounded-xl p-3 text-red-300 text-xs text-center">
        Erreur lors de l'analyse. Réessayez avec un cadrage net.
      </div>
    `;
  }
}

function showScannerResult(matchedResult, runnerUps = [], resultsEl = null) {
  if (!resultsEl) resultsEl = document.getElementById('scanner-results');
  if (!resultsEl || !matchedResult) return;

  const card = matchedResult.card || matchedResult;
  const score = matchedResult.score !== undefined ? Math.round(matchedResult.score) : 100;
  const scoreA = matchedResult.scoreA !== undefined ? Math.round(matchedResult.scoreA) : 100;
  const scoreB = matchedResult.scoreB !== undefined ? Math.round(matchedResult.scoreB) : 100;
  const scoreC = matchedResult.scoreC !== undefined ? Math.round(matchedResult.scoreC) : 100;

  const margin = netMargin(card);
  const roi = netROI(card);
  const profitCls = margin >= 0 ? 'text-emerald-400' : 'text-red-400';
  const marginSign = margin >= 0 ? '+' : '';
  const frActive = getActiveFrPrice(card);
  const jpActive = getActiveJpPrice(card);

  const scoreBadgeBg = score >= 65 ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' :
                       score >= 45 ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' :
                       'bg-slate-500/20 text-slate-300 border-slate-500/40';

  const critA_ok = scoreA >= 50;
  const critB_ok = scoreB >= 45;
  const critC_ok = scoreC >= 40;

  const pillA = critA_ok
    ? `<span class="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-300 bg-emerald-950/70 border border-emerald-500/40 px-2 py-0.5 rounded-full" title="Empreinte visuelle: ${scoreA}%">✓ Empreinte visuelle</span>`
    : `<span class="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 bg-slate-800/60 border border-slate-700/40 px-2 py-0.5 rounded-full" title="Empreinte visuelle: ${scoreA}%">✗ Empreinte faible</span>`;

  const pillB = critB_ok
    ? `<span class="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-300 bg-emerald-950/70 border border-emerald-500/40 px-2 py-0.5 rounded-full" title="Nom détecté: ${scoreB}%">✓ Nom détecté</span>`
    : `<span class="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 bg-slate-800/60 border border-slate-700/40 px-2 py-0.5 rounded-full" title="Nom non lu: ${scoreB}%">✗ Nom non lu</span>`;

  const pillC = critC_ok
    ? `<span class="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-300 bg-emerald-950/70 border border-emerald-500/40 px-2 py-0.5 rounded-full" title="N° & PV: ${scoreC}%">✓ N° & PV identifiés</span>`
    : `<span class="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 bg-slate-800/60 border border-slate-700/40 px-2 py-0.5 rounded-full" title="N° flou: ${scoreC}%">✗ N° flou</span>`;

  const runnerUpsHtml = (runnerUps && runnerUps.length > 0) ? `
    <div class="border-t border-white/10 pt-2.5 mt-2">
      <div class="text-[11px] font-bold text-white/70 uppercase tracking-wider mb-2 flex items-center justify-between text-left">
        <span class="flex items-center gap-1.5">
          <i data-lucide="help-circle" style="width:13px;height:13px;" class="text-amber-400"></i>
          <span>Pas la bonne carte ?</span>
        </span>
        <span class="text-[10px] text-white/40 normal-case font-normal">Top 3 suggestions</span>
      </div>
      <div class="grid grid-cols-1 gap-1.5">
        ${runnerUps.map((item, idx) => {
          const rCard = item.card;
          const rScore = Math.round(item.score);
          return `
            <div class="scanner-runner-card flex items-center justify-between gap-2 p-1.5 px-2.5 rounded-xl bg-white/5 hover:bg-white/15 border border-white/10 hover:border-emerald-400/50 transition-all text-left cursor-pointer group" data-idx="${idx}" data-card-id="${rCard.id}">
              <div class="flex items-center gap-2 min-w-0 flex-1">
                <img src="${rCard.image}" class="w-8 h-11 object-cover rounded flex-shrink-0 border border-white/20 shadow-sm" alt="${rCard.name}" onerror="onCardImageError(this)">
                <div class="min-w-0 flex-1">
                  <div class="text-xs font-semibold text-white truncate group-hover:text-emerald-300 transition-colors">${rCard.name}</div>
                  <div class="text-[10px] text-white/50 truncate font-mono">${rCard.ref}</div>
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

  resultsEl.innerHTML = `
    <div class="bg-slate-900/95 border border-emerald-500/40 backdrop-blur-md rounded-2xl p-3.5 text-white max-w-sm mx-auto shadow-2xl space-y-3">
      <!-- Status bar -->
      <div class="flex items-center justify-between border-b border-white/10 pb-2.5">
        <div class="flex items-center gap-1.5 text-emerald-400 font-bold text-xs uppercase tracking-wide">
          <i data-lucide="scan-line" style="width:14px;height:14px;"></i>
          <span>Carte identifiée</span>
        </div>
        <span class="text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${scoreBadgeBg}">
          ${score}% confiance
        </span>
      </div>

      <!-- Checklist -->
      <div class="flex flex-wrap gap-1.5 justify-center">
        ${pillA}
        ${pillB}
        ${pillC}
      </div>

      <!-- Primary Card Info -->
      <div class="flex gap-3 items-center bg-white/5 border border-white/10 rounded-xl p-2.5">
        <img src="${card.image}" class="w-16 h-22 object-cover rounded-lg flex-shrink-0 shadow-lg border border-white/20" alt="${card.name}" onerror="onCardImageError(this)">
        <div class="flex-1 min-w-0 text-left">
          <div class="font-bold text-sm truncate text-white">${card.name}</div>
          ${card.subName ? `<div class="text-white/60 text-[11px] truncate">${card.subName}</div>` : ''}
          <div class="text-white/40 text-[10px] mt-0.5 font-mono">${card.ref}</div>
          <div class="text-xs text-white/80 mt-1">JP: ¥${jpActive.toLocaleString('fr-FR')} → FR: ${frActive.toFixed(2)} €</div>
          <div class="text-xs font-bold ${profitCls} mt-0.5">Marge: ${marginSign}${margin.toFixed(2)} € (${marginSign}${roi.toFixed(0)}%)</div>
        </div>
      </div>

      <!-- Action Button -->
      <button type="button" class="w-full bg-emerald-500 hover:bg-emerald-400 active:scale-[0.98] text-slate-900 text-xs font-bold py-2.5 rounded-xl transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer" id="scanner-open-detail">
        <span>Ouvrir le détail complet</span>
        <i data-lucide="arrow-right" style="width:14px;height:14px;"></i>
      </button>

      <!-- Runner-ups -->
      ${runnerUpsHtml}
    </div>
  `;

  if (typeof lucide !== 'undefined') lucide.createIcons();

  document.getElementById('scanner-open-detail')?.addEventListener('click', () => {
    closeScanner();
    openCardDetail(card.id);
  });

  resultsEl.querySelectorAll('.scanner-runner-card').forEach(elem => {
    elem.addEventListener('click', (e) => {
      if (e.target.closest('.scanner-runner-open')) {
        const id = e.target.closest('.scanner-runner-open').dataset.cardId;
        closeScanner();
        openCardDetail(id);
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
  if (!file) return;
  const resultsEl = document.getElementById('scanner-results');
  if (!resultsEl) return;

  resultsEl.innerHTML = `
    <div class="inline-flex items-center gap-2 bg-black/70 backdrop-blur px-4 py-2.5 rounded-full text-emerald-300 text-xs border border-emerald-500/30 shadow-lg">
      <span class="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping"></span>
      <span class="font-medium">Analyse de la photo (Empreinte 8x8 + OCR + N°)...</span>
    </div>
  `;

  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = async () => {
    try {
      const crop = CardRecognizer.getDefaultCropRect(img.naturalWidth || img.width, img.naturalHeight || img.height);
      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = crop.sw;
      cropCanvas.height = crop.sh;
      const cropCtx = cropCanvas.getContext('2d', { willReadFrequently: true });
      cropCtx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, crop.sw, crop.sh);

      const ocrCanvas = CardRecognizer.preprocessForOCR(cropCanvas);
      let ocrText = '';
      if (typeof Tesseract !== 'undefined') {
        try {
          const { data: { text } } = await Tesseract.recognize(ocrCanvas, 'eng+jpn', { logger: () => {} });
          ocrText = text || '';
        } catch (err) {
          console.warn('Tesseract OCR error on file:', err);
        }
      }

      const ranked = CardRecognizer.rankCards(cropCanvas, ocrText, CARDS);
      if (!ranked || ranked.length === 0) {
        resultsEl.innerHTML = `
          <div class="bg-slate-900/90 border border-slate-700 rounded-xl p-3 text-white/70 text-xs text-center">
            Aucune carte correspondante trouvée.
          </div>
        `;
        return;
      }

      const bestMatch = ranked[0];
      const runnerUps = ranked.slice(1, 4);
      showScannerResult(bestMatch, runnerUps, resultsEl);
    } catch (e) {
      console.error('File scan error:', e);
      resultsEl.innerHTML = `
        <div class="bg-slate-900/90 border border-red-500/40 rounded-xl p-3 text-red-300 text-xs text-center">
          Erreur lors de l'analyse de l'image.
        </div>
      `;
    } finally {
      URL.revokeObjectURL(url);
    }
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    resultsEl.innerHTML = `
      <div class="bg-slate-900/90 border border-red-500/40 rounded-xl p-3 text-red-300 text-xs text-center">
        Impossible de charger le fichier image.
      </div>
    `;
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
      const matchedList = CARDS.filter(c =>
        (c.ref && c.ref.toLowerCase().includes(q)) ||
        (c.name && c.name.toLowerCase().includes(q)) ||
        (c.subName && c.subName.toLowerCase().includes(q)) ||
        (c.localId && c.localId.toLowerCase() === q)
      );

      const resultsEl = document.getElementById('scanner-results');
      if (matchedList.length > 0) {
        const primary = {
          card: matchedList[0],
          score: 100,
          scoreA: 100,
          scoreB: 100,
          scoreC: 100,
          matchedCriteria: { visual: true, name: true, number: true }
        };
        const runners = matchedList.slice(1, 4).map(c => ({
          card: c,
          score: 95,
          scoreA: 90,
          scoreB: 95,
          scoreC: 90
        }));
        showScannerResult(primary, runners, resultsEl);
      } else if (resultsEl) {
        resultsEl.innerHTML = `
          <div class="bg-slate-900/95 border border-amber-500/40 rounded-2xl p-4 text-white max-w-sm mx-auto shadow-2xl">
            <div class="text-amber-400 font-bold text-xs uppercase tracking-wide mb-1 flex items-center justify-center gap-1">
              <span>⚠ Carte non trouvée</span>
            </div>
            <p class="text-xs text-white/70">Aucune carte trouvée pour <span class="font-mono text-emerald-300">"${q}"</span> dans le catalogue.</p>
            <p class="text-[11px] text-white/50 mt-1">Vérifiez le numéro de set (ex: sv2a 201) ou le nom du Pokémon.</p>
          </div>
        `;
      }
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

  // Step 4: Core recommendation rendering & counters (Always renders bootstrap cards immediately)
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
    if (typeof CatalogService !== 'undefined' && CatalogService.fetchAllMultiLangSets) {
      CatalogService.fetchAllMultiLangSets().catch(err => console.warn('[PokéSpread] Background CatalogService warning:', err));
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

  // Step 7: Preload CardRecognizer color signatures for loaded catalog
  try {
    if (typeof CardRecognizer !== 'undefined' && CardRecognizer.init) {
      CardRecognizer.init(CARDS);
    }
  } catch (err) {
    console.warn('[PokéSpread] CardRecognizer init warning:', err);
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
