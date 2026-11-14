// ============================================================
// PokéSpread JP→FR — app.js
// Structure:
//  1. Constants & Config
//  2. Mock Data (PriceService)
//  3. State Management (AppState)
//  4. Calculation Engine (ArbitrageCalc)
//  5. Render Functions (UI)
//  6. Event Handlers
//  7. Init
// ============================================================

// ============================================================
// 1. CONSTANTS & CONFIG
// ============================================================
const LS_KEY = 'pokespread_parcel';

const PLATFORMS_FR = [
  { key: 'ebayFR',      label: 'eBay FR',      feeType: 'ebay'   },
  { key: 'vinted',      label: 'Vinted',        feeType: 'vinted' },
  { key: 'leboncoin',   label: 'Leboncoin',     feeType: 'vinted' },
  { key: 'cardmarket',  label: 'Cardmarket',    feeType: 'vinted' },
];

const PLATFORM_FEES = { ebay: 0.13, vinted: 0.00 };
const SHIPPING_FIXED = 1.50; // EUR per platform for Vinted/LBC (deducted from net)

// ============================================================
// 2. MOCK DATA (PriceService)
// ============================================================
const PriceService = {
  cards: {
    'sv2a-205': {
      id: 'sv2a-205',
      nameFR: 'Dracaufeu ex SAR',
      nameJP: 'リザードン ex SAR',
      set: 'sv2a',
      number: '205/165',
      rarity: 'SAR',
      image: null,
      japan: { mercari: 8500, snkrdunk: 9200, rushMedia: 8800 },
      france: { ebayFR: 68.00, vinted: 55.00, leboncoin: 52.00, cardmarket: 61.00 },
      liquidity: { score: 9, avgDays: 3 },
      recentSales: [
        { date: '2024-11-10', platform: 'eBay FR',    condition: 'Raw NM', price: 70.00 },
        { date: '2024-11-08', platform: 'Vinted',     condition: 'Raw NM', price: 54.00 },
        { date: '2024-11-05', platform: 'eBay FR',    condition: 'PSA 10', price: 185.00 },
        { date: '2024-11-03', platform: 'Leboncoin',  condition: 'Raw NM', price: 50.00 },
        { date: '2024-10-30', platform: 'Cardmarket', condition: 'Raw NM', price: 60.00 },
      ]
    },
    'sv2a-207': {
      id: 'sv2a-207',
      nameFR: 'Mélodelfe ex SAR',
      nameJP: 'メロエッタ ex SAR',
      set: 'sv2a',
      number: '207/165',
      rarity: 'SAR',
      image: null,
      japan: { mercari: 3200, snkrdunk: 3600, rushMedia: 3400 },
      france: { ebayFR: 42.00, vinted: 34.00, leboncoin: 31.00, cardmarket: 38.00 },
      liquidity: { score: 7, avgDays: 6 },
      recentSales: [
        { date: '2024-11-09', platform: 'eBay FR',    condition: 'Raw NM', price: 43.00 },
        { date: '2024-11-06', platform: 'Vinted',     condition: 'Raw NM', price: 33.00 },
        { date: '2024-11-04', platform: 'Cardmarket', condition: 'Raw NM', price: 37.50 },
        { date: '2024-10-28', platform: 'Leboncoin',  condition: 'Raw NM', price: 30.00 },
        { date: '2024-10-25', platform: 'eBay FR',    condition: 'PSA 10', price: 110.00 },
      ]
    },
    'sv2a-183': {
      id: 'sv2a-183',
      nameFR: 'Pikachu ex SAR',
      nameJP: 'ピカチュウ ex SAR',
      set: 'sv2a',
      number: '183/165',
      rarity: 'SAR',
      image: null,
      japan: { mercari: 12000, snkrdunk: 13500, rushMedia: 12800 },
      france: { ebayFR: 95.00, vinted: 80.00, leboncoin: 72.00, cardmarket: 88.00 },
      liquidity: { score: 10, avgDays: 2 },
      recentSales: [
        { date: '2024-11-11', platform: 'eBay FR',    condition: 'Raw NM', price: 97.00 },
        { date: '2024-11-10', platform: 'Vinted',     condition: 'Raw NM', price: 79.00 },
        { date: '2024-11-07', platform: 'eBay FR',    condition: 'PSA 10', price: 250.00 },
        { date: '2024-11-05', platform: 'Cardmarket', condition: 'Raw NM', price: 86.00 },
        { date: '2024-11-02', platform: 'Leboncoin',  condition: 'Raw NM', price: 70.00 },
      ]
    },
    'sv2a-208': {
      id: 'sv2a-208',
      nameFR: 'Noctali ex SAR',
      nameJP: 'ブラッキー ex SAR',
      set: 'sv2a',
      number: '208/165',
      rarity: 'SAR',
      image: null,
      japan: { mercari: 15000, snkrdunk: 16800, rushMedia: 15500 },
      france: { ebayFR: 130.00, vinted: 110.00, leboncoin: 100.00, cardmarket: 120.00 },
      liquidity: { score: 8, avgDays: 4 },
      recentSales: [
        { date: '2024-11-10', platform: 'eBay FR',    condition: 'Raw NM', price: 132.00 },
        { date: '2024-11-08', platform: 'Vinted',     condition: 'Raw NM', price: 108.00 },
        { date: '2024-11-04', platform: 'eBay FR',    condition: 'PSA 10', price: 320.00 },
        { date: '2024-11-01', platform: 'Cardmarket', condition: 'Raw NM', price: 118.00 },
        { date: '2024-10-29', platform: 'Leboncoin',  condition: 'Raw NM', price: 98.00 },
      ]
    },
    'sv3a-068': {
      id: 'sv3a-068',
      nameFR: 'Dracovish ex SAR',
      nameJP: 'ドラパルト ex SAR',
      set: 'sv3a',
      number: '068/062',
      rarity: 'SAR',
      image: null,
      japan: { mercari: 2200, snkrdunk: 2500, rushMedia: 2350 },
      france: { ebayFR: 22.00, vinted: 17.00, leboncoin: 15.00, cardmarket: 19.00 },
      liquidity: { score: 5, avgDays: 12 },
      recentSales: [
        { date: '2024-11-08', platform: 'eBay FR',    condition: 'Raw NM', price: 23.00 },
        { date: '2024-11-04', platform: 'Vinted',     condition: 'Raw NM', price: 16.50 },
        { date: '2024-10-30', platform: 'Cardmarket', condition: 'Raw NM', price: 18.50 },
        { date: '2024-10-26', platform: 'Leboncoin',  condition: 'Raw NM', price: 14.00 },
        { date: '2024-10-20', platform: 'eBay FR',    condition: 'PSA 9',  price: 48.00 },
      ]
    },
    'sv2a-196': {
      id: 'sv2a-196',
      nameFR: 'Lucario ex SAR',
      nameJP: 'ルカリオ ex SAR',
      set: 'sv2a',
      number: '196/165',
      rarity: 'SAR',
      image: null,
      japan: { mercari: 4800, snkrdunk: 5300, rushMedia: 5000 },
      france: { ebayFR: 55.00, vinted: 45.00, leboncoin: 40.00, cardmarket: 50.00 },
      liquidity: { score: 7, avgDays: 5 },
      recentSales: [
        { date: '2024-11-09', platform: 'eBay FR',    condition: 'Raw NM', price: 57.00 },
        { date: '2024-11-06', platform: 'Vinted',     condition: 'Raw NM', price: 44.00 },
        { date: '2024-11-02', platform: 'Cardmarket', condition: 'Raw NM', price: 49.00 },
        { date: '2024-10-29', platform: 'Leboncoin',  condition: 'Raw NM', price: 39.00 },
        { date: '2024-10-25', platform: 'eBay FR',    condition: 'PSA 10', price: 130.00 },
      ]
    },
    'sv3a-072': {
      id: 'sv3a-072',
      nameFR: 'Palafin ex SAR',
      nameJP: 'イルカマン ex SAR',
      set: 'sv3a',
      number: '072/062',
      rarity: 'SAR',
      image: null,
      japan: { mercari: 1800, snkrdunk: 2100, rushMedia: 1950 },
      france: { ebayFR: 18.00, vinted: 14.00, leboncoin: 12.00, cardmarket: 16.00 },
      liquidity: { score: 4, avgDays: 18 },
      recentSales: [
        { date: '2024-11-07', platform: 'eBay FR',    condition: 'Raw NM', price: 19.00 },
        { date: '2024-11-02', platform: 'Vinted',     condition: 'Raw NM', price: 13.50 },
        { date: '2024-10-28', platform: 'Cardmarket', condition: 'Raw NM', price: 15.50 },
        { date: '2024-10-22', platform: 'Leboncoin',  condition: 'Raw NM', price: 11.50 },
        { date: '2024-10-15', platform: 'eBay FR',    condition: 'PSA 9',  price: 38.00 },
      ]
    },
    'sv2a-178': {
      id: 'sv2a-178',
      nameFR: 'Magnézone ex AR',
      nameJP: 'ジバコイル ex AR',
      set: 'sv2a',
      number: '178/165',
      rarity: 'AR',
      image: null,
      japan: { mercari: 6500, snkrdunk: 7200, rushMedia: 6800 },
      france: { ebayFR: 48.00, vinted: 38.00, leboncoin: 35.00, cardmarket: 44.00 },
      liquidity: { score: 6, avgDays: 8 },
      recentSales: [
        { date: '2024-11-08', platform: 'eBay FR',    condition: 'Raw NM', price: 49.00 },
        { date: '2024-11-05', platform: 'Vinted',     condition: 'Raw NM', price: 37.00 },
        { date: '2024-11-01', platform: 'Cardmarket', condition: 'Raw NM', price: 43.00 },
        { date: '2024-10-27', platform: 'Leboncoin',  condition: 'Raw NM', price: 34.00 },
        { date: '2024-10-22', platform: 'eBay FR',    condition: 'PSA 10', price: 115.00 },
      ]
    },
  },

  getAll() { return Object.values(this.cards); },
  getById(id) { return this.cards[id] || null; },
  search(query) {
    if (!query || query.trim() === '') return [];
    const q = query.toLowerCase().trim();
    return this.getAll().filter(c =>
      c.nameFR.toLowerCase().includes(q) ||
      c.nameJP.toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q) ||
      c.number.toLowerCase().includes(q) ||
      c.set.toLowerCase().includes(q)
    );
  }
};

// ============================================================
// 3. STATE MANAGEMENT (AppState)
// ============================================================
const AppState = {
  activeTab: 'scanner',
  exchangeRate: 163,
  shippingCost: 1.50,
  activeFee: 'vinted',   // 'vinted' | 'ebay'
  selectedCard: null,
  buyPriceJPY: null,
  sortMode: 'profit',    // 'profit' | 'roi'
  rarityFilter: 'all',
  parcel: [],

  init() {
    // Load parcel from localStorage
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) this.parcel = JSON.parse(saved);
    } catch(e) { this.parcel = []; }
  },

  saveParcel() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(this.parcel)); } catch(e) {}
  },

  addToParcel(card, paidJPY) {
    this.parcel.push({ cardId: card.id, paidJPY: Number(paidJPY), addedAt: new Date().toISOString() });
    this.saveParcel();
  },

  removeFromParcel(index) {
    this.parcel.splice(index, 1);
    this.saveParcel();
  },

  clearParcel() {
    this.parcel = [];
    this.saveParcel();
  }
};

// ============================================================
// 4. CALCULATION ENGINE (ArbitrageCalc)
// ============================================================
const ArbitrageCalc = {
  buyPriceEUR(buyJPY, rate) {
    return buyJPY / rate;
  },

  netSell(sellEUR, feeType, shippingCost) {
    const feePct = PLATFORM_FEES[feeType] || 0;
    // For vinted/lbc: deduct shipping fixed cost; for ebay: fee is percentage
    if (feeType === 'ebay') {
      return sellEUR * (1 - feePct);
    } else {
      return sellEUR - shippingCost;
    }
  },

  profit(buyJPY, rate, shippingCost, sellEUR, feeType) {
    const cost = this.buyPriceEUR(buyJPY, rate) + shippingCost;
    const net  = this.netSell(sellEUR, feeType, shippingCost);
    return net - cost;
  },

  roi(buyJPY, rate, shippingCost, sellEUR, feeType) {
    const cost = this.buyPriceEUR(buyJPY, rate) + shippingCost;
    const p    = this.profit(buyJPY, rate, shippingCost, sellEUR, feeType);
    return cost > 0 ? (p / cost) * 100 : 0;
  },

  bestPlatform(card, rate, shippingCost, globalFeeType) {
    let best = null;
    let bestProfit = -Infinity;
    for (const plat of PLATFORMS_FR) {
      const sellEUR  = card.france[plat.key];
      // Always consider each platform with its own fee type,
      // but use the global active fee toggle to pick which fee style to simulate.
      // Per spec: use the active platform fee toggle for calculations.
      const p = this.profit(
        card.japan.mercari, rate, shippingCost, sellEUR, globalFeeType
      );
      if (p > bestProfit) {
        bestProfit = p;
        best = { ...plat, sellEUR, profit: p,
          roi: this.roi(card.japan.mercari, rate, shippingCost, sellEUR, globalFeeType),
          netSell: this.netSell(sellEUR, globalFeeType, shippingCost)
        };
      }
    }
    return best;
  },

  // For detail view: table with all platforms, using their native fee types
  allPlatforms(card, rate, shippingCost, globalFeeType) {
    return PLATFORMS_FR.map(plat => {
      const sellEUR = card.france[plat.key];
      const net = this.netSell(sellEUR, globalFeeType, shippingCost);
      return { ...plat, sellEUR, net,
        profit: this.profit(card.japan.mercari, rate, shippingCost, sellEUR, globalFeeType),
        roi: this.roi(card.japan.mercari, rate, shippingCost, sellEUR, globalFeeType)
      };
    });
  },

  roiClass(roi) {
    if (roi >= 35) return 'high';
    if (roi >= 15) return 'mid';
    return 'low';
  },

  liquidityLabel(score) {
    if (score >= 8) return 'Haute';
    if (score >= 5) return 'Moyenne';
    return 'Faible';
  },

  liquidityClass(score) {
    if (score >= 8) return 'badge-liq-high';
    if (score >= 5) return 'badge-liq-mid';
    return 'badge-liq-low';
  }
};

// ============================================================
// 5. RENDER FUNCTIONS (UI)
// ============================================================
const UI = {

  // --- Helpers ---
  fmt: {
    jpy: v => `¥${Number(v).toLocaleString('fr-FR')}`,
    eur: v => `${Number(v).toFixed(2).replace('.', ',')} €`,
    pct: v => `${v >= 0 ? '+' : ''}${Number(v).toFixed(1)}%`,
  },

  rarityBadge(rarity) {
    const cls = rarity === 'AR' ? 'badge-rarity-AR' : (rarity === 'Gold' ? 'badge-rarity-Gold' : '');
    return `<span class="badge-rarity ${cls}">${rarity}</span>`;
  },

  roiBadge(roi) {
    const cls = roi >= 35 ? 'badge-roi-high' : (roi >= 15 ? 'badge-roi-mid' : 'badge-roi-low');
    const txt = ArbitrageCalc.roiClass(roi) === 'high' ? '🔥' : (ArbitrageCalc.roiClass(roi) === 'mid' ? '⚡' : '⚠️');
    return `<span class="inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full ${cls}">${txt} ${UI.fmt.pct(roi)}</span>`;
  },

  liquidityBadge(score) {
    const cls  = ArbitrageCalc.liquidityClass(score);
    const lbl  = ArbitrageCalc.liquidityLabel(score);
    return `<span class="inline-block text-xs font-bold px-2 py-1 rounded-full ${cls}">${lbl}</span>`;
  },

  stars(score, max = 10) {
    let s = '';
    for (let i = 1; i <= max; i++) {
      s += `<span class="${i <= score ? '' : 'empty'}">★</span>`;
    }
    return `<span class="stars">${s}</span>`;
  },

  // --- Search result mini card ---
  renderSearchResultItem(card) {
    const best = ArbitrageCalc.bestPlatform(card, AppState.exchangeRate, AppState.shippingCost, AppState.activeFee);
    const roi  = best ? best.roi : 0;
    const div  = document.createElement('div');
    div.className = 'search-result-item';
    div.dataset.cardId = card.id;
    div.innerHTML = `
      <div class="w-10 h-10 rounded-lg bg-slate-700 flex items-center justify-center flex-shrink-0 text-lg">🃏</div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="font-bold text-sm text-white truncate">${card.nameFR}</span>
          ${UI.rarityBadge(card.rarity)}
        </div>
        <div class="text-xs text-slate-400">${card.set} · ${card.number}</div>
        <div class="text-xs text-slate-500">${card.nameJP}</div>
      </div>
      <div class="text-right flex-shrink-0">
        ${UI.roiBadge(roi)}
        <div class="text-xs text-slate-400 mt-1">${best ? UI.fmt.eur(best.profit) : '-'}</div>
      </div>
    `;
    div.addEventListener('click', () => {
      AppState.selectedCard = card;
      AppState.buyPriceJPY  = card.japan.mercari;
      UI.renderDetailView();
      document.getElementById('searchResults').classList.add('hidden');
    });
    return div;
  },

  // --- Detailed Card View ---
  renderDetailView() {
    const card  = AppState.selectedCard;
    if (!card) return;
    const rate  = AppState.exchangeRate;
    const ship  = AppState.shippingCost;
    const fee   = AppState.activeFee;
    const buyJPY= AppState.buyPriceJPY || card.japan.mercari;
    const buyEUR= ArbitrageCalc.buyPriceEUR(buyJPY, rate);
    const best  = ArbitrageCalc.bestPlatform(card, rate, ship, fee);
    const allP  = ArbitrageCalc.allPlatforms(card, rate, ship, fee);
    const roi   = best ? best.roi : 0;
    const roiCls= ArbitrageCalc.roiClass(roi);
    const liqLbl= ArbitrageCalc.liquidityLabel(card.liquidity.score);
    const liqCls= ArbitrageCalc.liquidityClass(card.liquidity.score);

    const feeLabel = fee === 'ebay' ? '(−13%)' : '(−1,50 €)';

    const container = document.getElementById('detailView');
    container.classList.remove('hidden');
    container.innerHTML = `
      <!-- Card Header -->
      <div class="detail-section mb-3">
        <div class="flex items-start gap-3">
          <div class="w-14 h-14 rounded-xl bg-slate-700 flex items-center justify-center text-3xl flex-shrink-0">🃏</div>
          <div class="flex-1 min-w-0">
            <h2 class="font-black text-lg text-white leading-tight">${card.nameFR}</h2>
            <p class="text-slate-400 text-sm">${card.nameJP}</p>
            <div class="flex items-center gap-2 mt-1 flex-wrap">
              ${UI.rarityBadge(card.rarity)}
              <span class="text-xs text-slate-500">${card.set} · ${card.number}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Prix d'Achat Japon -->
      <div class="detail-section">
        <div class="detail-section-title">
          <i data-lucide="shopping-cart" style="width:14px;height:14px"></i>
          Prix d'Achat Japon
        </div>
        <div class="buy-price-wrapper mb-2">
          <input type="number" id="buyPriceInput" value="${buyJPY}" min="100" step="100" class="text-white" />
          <span class="text-slate-400 font-bold">¥</span>
          <span class="text-xs text-slate-400 whitespace-nowrap ml-2">≈ <span id="buyEURDisplay">${UI.fmt.eur(buyEUR)}</span></span>
        </div>
        <div class="flex gap-2 flex-wrap">
          <div class="ref-pill" data-ref="${card.japan.mercari}">
            <span class="label">Mercari</span>
            <span class="value">${UI.fmt.jpy(card.japan.mercari)}</span>
          </div>
          <div class="ref-pill" data-ref="${card.japan.snkrdunk}">
            <span class="label">SNKRDUNK</span>
            <span class="value">${UI.fmt.jpy(card.japan.snkrdunk)}</span>
          </div>
          <div class="ref-pill" data-ref="${card.japan.rushMedia}">
            <span class="label">Rush</span>
            <span class="value">${UI.fmt.jpy(card.japan.rushMedia)}</span>
          </div>
        </div>
      </div>

      <!-- Prix de Revente France -->
      <div class="detail-section">
        <div class="detail-section-title">
          <i data-lucide="euro" style="width:14px;height:14px"></i>
          Prix de Revente France
        </div>
        <table class="price-table">
          <thead>
            <tr>
              <th>Plateforme</th>
              <th>Prix</th>
              <th>Après frais ${feeLabel}</th>
            </tr>
          </thead>
          <tbody>
            ${allP.map(p => `
              <tr>
                <td class="font-semibold text-slate-200">${p.label}</td>
                <td class="text-white">${UI.fmt.eur(p.sellEUR)}</td>
                <td class="${p.net >= buyEUR + ship ? 'text-emerald-400' : 'text-red-400'} font-semibold">${UI.fmt.eur(p.net)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <!-- Résultat Arbitrage -->
      <div class="arb-box arb-box-${roiCls} mb-3" id="arbResultBox">
        <div class="flex items-center justify-between mb-2">
          <span class="text-xs font-bold text-slate-400 uppercase tracking-wider">Résultat Arbitrage</span>
          ${UI.roiBadge(roi)}
        </div>
        ${best ? `
        <div class="text-sm font-bold text-slate-200 mb-2">🏆 Meilleure plateforme : <span class="text-white">${best.label}</span></div>
        <div class="grid grid-cols-2 gap-2 text-sm">
          <div>
            <p class="text-slate-400 text-xs">Prix achat</p>
            <p class="font-bold text-white">${UI.fmt.eur(buyEUR)}</p>
          </div>
          <div>
            <p class="text-slate-400 text-xs">Revente nette</p>
            <p class="font-bold text-white">${UI.fmt.eur(best.netSell)}</p>
          </div>
          <div>
            <p class="text-slate-400 text-xs">Profit Net</p>
            <p class="font-black text-lg ${roiCls === 'high' ? 'profit-high' : roiCls === 'mid' ? 'profit-mid' : 'profit-low'}">${UI.fmt.eur(best.profit)}</p>
          </div>
          <div>
            <p class="text-slate-400 text-xs">ROI</p>
            <p class="font-black text-lg ${roiCls === 'high' ? 'profit-high' : roiCls === 'mid' ? 'profit-mid' : 'profit-low'}">${UI.fmt.pct(roi)}</p>
          </div>
        </div>
        ` : '<p class="text-red-400 text-sm">Aucune opportunité calculable.</p>'}
      </div>

      <!-- Liquidité & Vitesse -->
      <div class="detail-section">
        <div class="detail-section-title">
          <i data-lucide="activity" style="width:14px;height:14px"></i>
          Liquidité & Vitesse de Vente
        </div>
        <div class="flex items-center gap-3">
          <div class="${liqCls} inline-block text-xs font-bold px-2 py-1 rounded-full">${liqLbl}</div>
          <div class="text-sm">${UI.stars(card.liquidity.score)}</div>
          <div class="text-xs text-slate-400">${card.liquidity.score}/10</div>
        </div>
        <p class="text-xs text-slate-400 mt-2">⏱ Moyenne : <span class="text-white font-semibold">${card.liquidity.avgDays} jour${card.liquidity.avgDays > 1 ? 's' : ''}</span> pour vendre</p>
      </div>

      <!-- Historique des 5 dernières ventes -->
      <div class="detail-section">
        <div class="detail-section-title">
          <i data-lucide="history" style="width:14px;height:14px"></i>
          Historique des 5 Dernières Ventes
        </div>
        <table class="price-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Plateforme</th>
              <th>État</th>
              <th>Prix</th>
            </tr>
          </thead>
          <tbody>
            ${card.recentSales.map(s => `
              <tr>
                <td class="text-slate-400">${s.date}</td>
                <td class="text-slate-200">${s.platform}</td>
                <td class="text-slate-400">${s.condition}</td>
                <td class="font-semibold text-white">${UI.fmt.eur(s.price)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <!-- Ajouter au Colis -->
      <div class="add-parcel-section mb-6">
        <div class="detail-section-title mb-2">
          <i data-lucide="package-plus" style="width:14px;height:14px"></i>
          Ajouter au Colis Japon
        </div>
        <p class="text-xs text-slate-400 mb-2">Prix réellement payé (¥) :</p>
        <div class="buy-price-wrapper mb-3">
          <input type="number" id="parcelPriceInput" value="${card.japan.mercari}" min="1" step="100" class="text-white" />
          <span class="text-slate-400 font-bold">¥</span>
        </div>
        <button id="addToParcelBtn"
          class="w-full flex items-center justify-center gap-2 bg-poke-red hover:bg-red-700 text-white font-bold py-3 rounded-xl transition-all text-sm active:scale-95">
          <i data-lucide="plus-circle" style="width:18px;height:18px"></i>
          + Ajouter au Colis Japon
        </button>
      </div>
    `;

    // Rebind icons
    lucide.createIcons();

    // Buy price input → live recalc
    const buyInput = document.getElementById('buyPriceInput');
    buyInput.addEventListener('input', () => {
      const val = Number(buyInput.value) || card.japan.mercari;
      AppState.buyPriceJPY = val;
      document.getElementById('buyEURDisplay').textContent = UI.fmt.eur(ArbitrageCalc.buyPriceEUR(val, AppState.exchangeRate));
      UI.updateArbBox(card, val);
    });

    // Ref pill clicks
    container.querySelectorAll('.ref-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const ref = Number(pill.dataset.ref);
        buyInput.value = ref;
        AppState.buyPriceJPY = ref;
        document.getElementById('buyEURDisplay').textContent =
          UI.fmt.eur(ArbitrageCalc.buyPriceEUR(ref, AppState.exchangeRate));
        UI.updateArbBox(card, ref);
        document.getElementById('parcelPriceInput').value = ref;
      });
    });

    // Add to parcel
    document.getElementById('addToParcelBtn').addEventListener('click', () => {
      const paid = Number(document.getElementById('parcelPriceInput').value) || card.japan.mercari;
      AppState.addToParcel(card, paid);
      UI.showToast('✅ Carte ajoutée au colis !', 'emerald');
      UI.updateParcelBadge();
    });
  },

  // Live-update the arbitrage result box when buy price changes
  updateArbBox(card, buyJPY) {
    const rate  = AppState.exchangeRate;
    const ship  = AppState.shippingCost;
    const fee   = AppState.activeFee;
    const buyEUR= ArbitrageCalc.buyPriceEUR(buyJPY, rate);
    const best  = ArbitrageCalc.bestPlatform(card, rate, ship, fee);
    const roi   = best ? ArbitrageCalc.roi(buyJPY, rate, ship, best.sellEUR, fee) : 0;
    const prof  = best ? ArbitrageCalc.profit(buyJPY, rate, ship, best.sellEUR, fee) : 0;
    const netS  = best ? ArbitrageCalc.netSell(best.sellEUR, fee, ship) : 0;
    const roiCls= ArbitrageCalc.roiClass(roi);
    const box   = document.getElementById('arbResultBox');
    if (!box || !best) return;
    box.className = `arb-box arb-box-${roiCls} mb-3`;
    box.innerHTML = `
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-bold text-slate-400 uppercase tracking-wider">Résultat Arbitrage</span>
        ${UI.roiBadge(roi)}
      </div>
      <div class="text-sm font-bold text-slate-200 mb-2">🏆 Meilleure plateforme : <span class="text-white">${best.label}</span></div>
      <div class="grid grid-cols-2 gap-2 text-sm">
        <div>
          <p class="text-slate-400 text-xs">Prix achat</p>
          <p class="font-bold text-white">${UI.fmt.eur(buyEUR)}</p>
        </div>
        <div>
          <p class="text-slate-400 text-xs">Revente nette</p>
          <p class="font-bold text-white">${UI.fmt.eur(netS)}</p>
        </div>
        <div>
          <p class="text-slate-400 text-xs">Profit Net</p>
          <p class="font-black text-lg ${roiCls === 'high' ? 'profit-high' : roiCls === 'mid' ? 'profit-mid' : 'profit-low'}">${UI.fmt.eur(prof)}</p>
        </div>
        <div>
          <p class="text-slate-400 text-xs">ROI</p>
          <p class="font-black text-lg ${roiCls === 'high' ? 'profit-high' : roiCls === 'mid' ? 'profit-mid' : 'profit-low'}">${UI.fmt.pct(roi)}</p>
        </div>
      </div>
    `;
  },

  // --- Opportunities Tab ---
  renderOpportunities() {
    const container = document.getElementById('opportunitiesList');
    let cards = PriceService.getAll();

    // Filter by rarity
    if (AppState.rarityFilter !== 'all') {
      cards = cards.filter(c => c.rarity === AppState.rarityFilter);
    }

    // Sort
    const rate = AppState.exchangeRate;
    const ship = AppState.shippingCost;
    const fee  = AppState.activeFee;
    cards = cards.map(c => {
      const best = ArbitrageCalc.bestPlatform(c, rate, ship, fee);
      return { card: c, best };
    });

    if (AppState.sortMode === 'profit') {
      cards.sort((a, b) => (b.best ? b.best.profit : -999) - (a.best ? a.best.profit : -999));
    } else {
      cards.sort((a, b) => (b.best ? b.best.roi : -999) - (a.best ? a.best.roi : -999));
    }

    container.innerHTML = '';
    if (cards.length === 0) {
      container.innerHTML = `<div class="text-center py-12 text-slate-500">Aucune carte pour ce filtre.</div>`;
      return;
    }

    cards.forEach(({ card, best }) => {
      if (!best) return;
      const roi    = best.roi;
      const roiCls = ArbitrageCalc.roiClass(roi);
      const liqCls = ArbitrageCalc.liquidityClass(card.liquidity.score);
      const liqLbl = ArbitrageCalc.liquidityLabel(card.liquidity.score);
      const buyEUR = ArbitrageCalc.buyPriceEUR(card.japan.mercari, rate);

      const div = document.createElement('div');
      div.className = 'opp-card';
      div.innerHTML = `
        <div class="flex items-start justify-between mb-2">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-bold text-white text-sm">${card.nameFR}</span>
              ${UI.rarityBadge(card.rarity)}
            </div>
            <span class="text-xs text-slate-500">${card.set} · ${card.number}</span>
          </div>
          <span class="inline-block text-xs font-bold px-2 py-1 rounded-full ${liqCls} flex-shrink-0 ml-2">${liqLbl}</span>
        </div>
        <div class="flex items-center justify-between text-xs text-slate-400 mb-2">
          <span>Achat JP : <span class="text-white font-semibold">${UI.fmt.jpy(card.japan.mercari)}</span> ≈ <span class="text-white font-semibold">${UI.fmt.eur(buyEUR)}</span></span>
          <span>Vente FR : <span class="text-white font-semibold">${UI.fmt.eur(best.sellEUR)}</span> <span class="text-slate-500">(${best.label})</span></span>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-sm font-bold ${roiCls === 'high' ? 'profit-high' : roiCls === 'mid' ? 'profit-mid' : 'profit-low'}">${UI.fmt.eur(best.profit)}</span>
          ${UI.roiBadge(roi)}
        </div>
      `;
      div.addEventListener('click', () => {
        AppState.selectedCard   = card;
        AppState.buyPriceJPY    = card.japan.mercari;
        UI.switchTab('scanner');
        setTimeout(() => {
          document.getElementById('searchInput').value = '';
          document.getElementById('searchResults').classList.add('hidden');
          UI.renderDetailView();
        }, 50);
      });
      container.appendChild(div);
    });
  },

  // --- Parcel Tab ---
  renderParcel() {
    const parcel  = AppState.parcel;
    const empty   = document.getElementById('parcelEmpty');
    const summary = document.getElementById('parcelSummary');
    const list    = document.getElementById('parcelList');
    const badge   = document.getElementById('parcelBadge');

    list.innerHTML = '';

    if (parcel.length === 0) {
      empty.classList.remove('hidden');
      summary.classList.add('hidden');
      badge.classList.add('hidden');
      return;
    }

    empty.classList.add('hidden');
    summary.classList.remove('hidden');
    badge.classList.remove('hidden');
    badge.textContent = parcel.length;

    const rate = AppState.exchangeRate;
    const ship = AppState.shippingCost;
    const fee  = AppState.activeFee;

    let totalJPY   = 0;
    let totalResale= 0;
    let totalProfit= 0;

    parcel.forEach((item, idx) => {
      const card   = PriceService.getById(item.cardId);
      if (!card) return;
      const paidJPY= item.paidJPY;
      const paidEUR= ArbitrageCalc.buyPriceEUR(paidJPY, rate);
      const best   = ArbitrageCalc.bestPlatform(card, rate, ship, fee);
      const resale = best ? best.sellEUR : 0;
      const profit = best ? ArbitrageCalc.profit(paidJPY, rate, ship, resale, fee) : 0;
      const roi    = best ? ArbitrageCalc.roi(paidJPY, rate, ship, resale, fee) : 0;
      const roiCls = ArbitrageCalc.roiClass(roi);

      totalJPY   += paidJPY;
      totalResale+= resale;
      totalProfit+= profit;

      const div = document.createElement('div');
      div.className = 'parcel-item';
      div.innerHTML = `
        <div class="flex items-start justify-between mb-2">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-bold text-white text-sm">${card.nameFR}</span>
              ${UI.rarityBadge(card.rarity)}
            </div>
            <span class="text-xs text-slate-500">${card.set} · ${card.number}</span>
          </div>
          <button class="delete-parcel-btn flex-shrink-0 ml-2 p-1 text-slate-500 hover:text-red-400 transition-colors" data-idx="${idx}">
            <i data-lucide="trash-2" style="width:16px;height:16px"></i>
          </button>
        </div>
        <div class="grid grid-cols-3 gap-2 text-xs mt-2">
          <div>
            <p class="text-slate-400">Payé</p>
            <p class="text-white font-semibold">${UI.fmt.jpy(paidJPY)}</p>
            <p class="text-slate-500">${UI.fmt.eur(paidEUR)}</p>
          </div>
          <div>
            <p class="text-slate-400">Revente est.</p>
            <p class="text-white font-semibold">${UI.fmt.eur(resale)}</p>
            <p class="text-slate-500">${best ? best.label : '-'}</p>
          </div>
          <div>
            <p class="text-slate-400">Profit</p>
            <p class="font-bold ${roiCls === 'high' ? 'profit-high' : roiCls === 'mid' ? 'profit-mid' : 'profit-low'}">${UI.fmt.eur(profit)}</p>
            <p class="${roiCls === 'high' ? 'profit-high' : roiCls === 'mid' ? 'profit-mid' : 'profit-low'} text-xs">${UI.fmt.pct(roi)}</p>
          </div>
        </div>
      `;
      list.appendChild(div);
    });

    // Bind delete buttons
    list.querySelectorAll('.delete-parcel-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = Number(e.currentTarget.dataset.idx);
        AppState.removeFromParcel(idx);
        UI.renderParcel();
        UI.showToast('🗑 Carte retirée du colis.', 'slate');
      });
    });

    // Summary
    const totalEUR = totalJPY / rate;
    const globalROI = totalEUR > 0 ? ((totalProfit / totalEUR) * 100) : 0;
    const profitCls = totalProfit >= 0 ? 'profit-high' : 'profit-low';

    document.getElementById('parcelTotalJPY').textContent = UI.fmt.jpy(totalJPY);
    document.getElementById('parcelTotalEUR').textContent = `≈ ${UI.fmt.eur(totalEUR)}`;
    document.getElementById('parcelResale').textContent   = UI.fmt.eur(totalResale);
    document.getElementById('parcelProfit').className = `font-bold text-lg ${profitCls}`;
    document.getElementById('parcelProfit').textContent   = `${UI.fmt.eur(totalProfit)} (${UI.fmt.pct(globalROI)})`;
    document.getElementById('parcelCount').textContent    = parcel.length;

    lucide.createIcons();
  },

  // --- Parcel badge update (without full re-render) ---
  updateParcelBadge() {
    const badge = document.getElementById('parcelBadge');
    if (AppState.parcel.length > 0) {
      badge.classList.remove('hidden');
      badge.textContent = AppState.parcel.length;
    } else {
      badge.classList.add('hidden');
    }
  },

  // --- Tab switching ---
  switchTab(tabName) {
    AppState.activeTab = tabName;
    document.querySelectorAll('.tab-section').forEach(s => s.classList.add('hidden'));
    document.getElementById(`tab-${tabName}`).classList.remove('hidden');
    document.querySelectorAll('.tab-nav').forEach(btn => {
      btn.classList.toggle('active-tab', btn.dataset.tab === tabName);
    });
    if (tabName === 'opportunities') UI.renderOpportunities();
    if (tabName === 'parcel') UI.renderParcel();
  },

  // --- Toast ---
  showToast(message, color = 'slate') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = 'toast';
    const accent = color === 'emerald' ? '#34d399' : color === 'red' ? '#f87171' : '#94a3b8';
    toast.innerHTML = `<span style="color:${accent};font-size:1.1em">●</span> ${message}`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('hide');
      setTimeout(() => toast.remove(), 350);
    }, 2500);
  },

  // --- Global recalc (called when settings change) ---
  recalcAll() {
    if (AppState.selectedCard) {
      UI.updateArbBox(AppState.selectedCard, AppState.buyPriceJPY || AppState.selectedCard.japan.mercari);
      // Re-render buy EUR display
      const disp = document.getElementById('buyEURDisplay');
      if (disp) {
        disp.textContent = UI.fmt.eur(ArbitrageCalc.buyPriceEUR(
          AppState.buyPriceJPY || AppState.selectedCard.japan.mercari,
          AppState.exchangeRate
        ));
      }
      // Update net sell column
      UI.renderDetailView();
    }
    if (AppState.activeTab === 'opportunities') UI.renderOpportunities();
    if (AppState.activeTab === 'parcel') UI.renderParcel();
  }
};

// ============================================================
// 6. EVENT HANDLERS
// ============================================================

// Camera / AI stub
async function analyzeCardImageWithAI(file) {
  // TODO: Replace with Gemini Vision API call
  // Example: const result = await geminiVision.analyze(file, "identify this Pokemon card set and number");
  console.log('AI Analysis stub called with file:', file.name);
  return { detected: 'sv2a 205/165', confidence: 0.94, card: PriceService.cards['sv2a-205'] };
}

function initEventHandlers() {

  // --- Global settings ---
  document.getElementById('exchangeRate').addEventListener('input', e => {
    const val = parseFloat(e.target.value);
    if (val > 0) { AppState.exchangeRate = val; UI.recalcAll(); }
  });

  document.getElementById('shippingCost').addEventListener('input', e => {
    const val = parseFloat(e.target.value);
    if (val >= 0) { AppState.shippingCost = val; UI.recalcAll(); }
  });

  document.getElementById('feeVinted').addEventListener('click', () => {
    AppState.activeFee = 'vinted';
    document.getElementById('feeVinted').classList.add('active-fee');
    document.getElementById('feeEbay').classList.remove('active-fee');
    UI.recalcAll();
  });

  document.getElementById('feeEbay').addEventListener('click', () => {
    AppState.activeFee = 'ebay';
    document.getElementById('feeEbay').classList.add('active-fee');
    document.getElementById('feeVinted').classList.remove('active-fee');
    UI.recalcAll();
  });

  // --- Tab navigation ---
  document.querySelectorAll('.tab-nav').forEach(btn => {
    btn.addEventListener('click', () => UI.switchTab(btn.dataset.tab));
  });

  // --- Search ---
  const searchInput   = document.getElementById('searchInput');
  const searchResults = document.getElementById('searchResults');
  const searchList    = document.getElementById('searchResultsList');
  const detailView    = document.getElementById('detailView');

  searchInput.addEventListener('input', e => {
    const q = e.target.value.trim();
    if (q.length < 1) {
      searchResults.classList.add('hidden');
      return;
    }
    const results = PriceService.search(q);
    searchList.innerHTML = '';
    if (results.length === 0) {
      searchList.innerHTML = `<div class="text-center py-6 text-slate-500 text-sm">Aucune carte trouvée.</div>`;
    } else {
      results.forEach(card => searchList.appendChild(UI.renderSearchResultItem(card)));
    }
    searchResults.classList.remove('hidden');
    detailView.classList.add('hidden');
    detailView.innerHTML = '';
    AppState.selectedCard = null;
  });

  // Clear search results on click outside
  document.addEventListener('click', e => {
    if (!searchResults.contains(e.target) && e.target !== searchInput) {
      searchResults.classList.add('hidden');
    }
  });

  // --- Camera ---
  const cameraBtn     = document.getElementById('cameraBtn');
  const cameraInput   = document.getElementById('cameraInput');
  const cameraPreview = document.getElementById('cameraPreview');
  const cameraImg     = document.getElementById('cameraImg');
  const aiSpinner     = document.getElementById('aiSpinner');
  const aiResult      = document.getElementById('aiResult');
  const aiResultText  = document.getElementById('aiResultText');

  cameraBtn.addEventListener('click', () => cameraInput.click());

  cameraInput.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;

    // Show preview
    const url = URL.createObjectURL(file);
    cameraImg.src = url;
    cameraPreview.classList.remove('hidden');
    aiResult.classList.add('hidden');
    aiSpinner.classList.remove('hidden');
    detailView.classList.add('hidden');
    detailView.innerHTML = '';

    // Simulate analysis delay
    await new Promise(r => setTimeout(r, 1800));

    const result = await analyzeCardImageWithAI(file);
    aiSpinner.classList.add('hidden');
    aiResultText.textContent = `Carte détectée : ${result.detected} (confiance: ${Math.round(result.confidence * 100)}%)`;
    aiResult.classList.remove('hidden');

    // Populate detail view
    if (result.card) {
      AppState.selectedCard = result.card;
      AppState.buyPriceJPY  = result.card.japan.mercari;
      searchInput.value     = result.detected;
      searchResults.classList.add('hidden');
      UI.renderDetailView();
      UI.showToast('📷 Carte identifiée avec succès !', 'emerald');
    }

    cameraInput.value = '';
  });

  // --- Opportunities: sort ---
  document.getElementById('sortProfit').addEventListener('click', () => {
    AppState.sortMode = 'profit';
    document.getElementById('sortProfit').classList.add('active-sort');
    document.getElementById('sortROI').classList.remove('active-sort');
    UI.renderOpportunities();
  });

  document.getElementById('sortROI').addEventListener('click', () => {
    AppState.sortMode = 'roi';
    document.getElementById('sortROI').classList.add('active-sort');
    document.getElementById('sortProfit').classList.remove('active-sort');
    UI.renderOpportunities();
  });

  // --- Opportunities: filter chips ---
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      AppState.rarityFilter = chip.dataset.filter;
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active-chip'));
      chip.classList.add('active-chip');
      UI.renderOpportunities();
    });
  });

  // --- Parcel: export CSV ---
  document.getElementById('exportCSV').addEventListener('click', () => {
    if (AppState.parcel.length === 0) return;
    const rate = AppState.exchangeRate;
    const ship = AppState.shippingCost;
    const fee  = AppState.activeFee;

    const header = 'Carte,Set,Rareté,Prix Payé (¥),Prix Payé (€),Revente Estimée (€),Profit Net (€),ROI (%)';
    const rows = AppState.parcel.map(item => {
      const card    = PriceService.getById(item.cardId);
      if (!card) return '';
      const paidEUR = ArbitrageCalc.buyPriceEUR(item.paidJPY, rate);
      const best    = ArbitrageCalc.bestPlatform(card, rate, ship, fee);
      const resale  = best ? best.sellEUR : 0;
      const profit  = best ? ArbitrageCalc.profit(item.paidJPY, rate, ship, resale, fee) : 0;
      const roi     = best ? ArbitrageCalc.roi(item.paidJPY, rate, ship, resale, fee) : 0;
      return [
        `"${card.nameFR}"`,
        card.set,
        card.rarity,
        item.paidJPY,
        paidEUR.toFixed(2),
        resale.toFixed(2),
        profit.toFixed(2),
        roi.toFixed(1)
      ].join(',');
    }).filter(Boolean);

    const csv  = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `pokespread_colis_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    UI.showToast('📥 CSV exporté avec succès !', 'emerald');
  });

  // --- Parcel: clear ---
  document.getElementById('clearParcel').addEventListener('click', () => {
    if (!confirm('Vider tout le colis ? Cette action est irréversible.')) return;
    AppState.clearParcel();
    UI.renderParcel();
    UI.showToast('🗑 Colis vidé.', 'red');
  });
}

// ============================================================
// 7. INIT
// ============================================================
function init() {
  AppState.init();
  lucide.createIcons();
  initEventHandlers();
  UI.updateParcelBadge();
  // Default tab is scanner — already visible
}

document.addEventListener('DOMContentLoaded', init);
