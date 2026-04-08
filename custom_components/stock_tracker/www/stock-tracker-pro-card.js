/**
 * Stock Tracker Pro Card v1.0.0
 *
 * Feature-rich dashboard card for Home Assistant.
 * - Auto-discovery of stock tracker price entities
 * - Tiles / table / performance views
 * - Search, sort, filters, grouping
 * - Portfolio support via holdings map
 * - Summary metrics and top/worst movers
 * - Refresh button and more-info interaction
 */

class StockTrackerProCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
    this._hass = null;
    this._search = '';
    this._sortBy = 'change';
    this._sortOrder = 'desc';
    this._typeFilter = 'all';
    this._viewMode = 'tiles';
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  setConfig(config) {
    this._config = {
      title: config.title || '📈 Stock Tracker Pro',
      entities: config.entities || [],
      entity_prefix: config.entity_prefix || null,
      view_mode: config.view_mode || 'tiles',
      max_items: Number(config.max_items) || 12,
      show_header: config.show_header !== false,
      show_summary: config.show_summary !== false,
      show_search: config.show_search !== false,
      show_top_bottom: config.show_top_bottom !== false,
      show_market_status: config.show_market_status !== false,
      show_portfolio: config.show_portfolio || false,
      compact_numbers: config.compact_numbers !== false,
      popup_on_click: config.popup_on_click !== false,
      refresh_button: config.refresh_button !== false,
      sort_by: config.sort_by || 'change',
      sort_order: config.sort_order || 'desc',
      holdings: config.holdings || {},
      favorites: config.favorites || [],
      color_positive: config.color_positive || '#4CAF50',
      color_negative: config.color_negative || '#F44336',
      color_neutral: config.color_neutral || '#FF9800',
    };

    this._sortBy = this._config.sort_by;
    this._sortOrder = this._config.sort_order;
    this._viewMode = this._config.view_mode;
    this._render();
  }

  getCardSize() {
    return this._viewMode === 'table' ? 8 : 6;
  }

  _findEntities() {
    if (!this._hass) return [];
    let ids = [];

    if (this._config.entities.length) {
      ids = this._config.entities;
    } else {
      ids = Object.keys(this._hass.states).filter((entityId) => {
        if (!entityId.startsWith('sensor.')) return false;
        if (!entityId.endsWith('_price')) return false;
        const attrs = this._hass.states[entityId]?.attributes || {};
        return attrs.symbol !== undefined && attrs.currency !== undefined;
      });
    }

    if (this._config.entity_prefix) {
      ids = ids.filter((id) => id.startsWith(this._config.entity_prefix));
    }

    return ids.filter((id) => this._hass.states[id]);
  }

  _assetType(attrs) {
    const raw = String(attrs.quote_type || attrs.asset_type || 'STOCK').toUpperCase();
    if (raw === 'CRYPTOCURRENCY') return 'CRYPTO';
    if (raw === 'EQUITY') return 'STOCK';
    return raw;
  }

  _extract(entityId) {
    const state = this._hass.states[entityId];
    if (!state) return null;

    const a = state.attributes || {};
    const price = parseFloat(state.state);
    const changePct = parseFloat(a.change_percent);
    const changeAbs = parseFloat(a.change);
    const symbol = a.symbol || entityId.replace(/^sensor\./, '').replace(/_price$/, '').toUpperCase();
    const holdings = Number(this._config.holdings?.[symbol] || 0);
    const value = holdings && Number.isFinite(price) ? holdings * price : 0;
    const rsi = a.rsi_14 != null ? parseFloat(a.rsi_14) : null;
    const weekChange = a.week_change_percent != null ? parseFloat(a.week_change_percent) : null;
    const monthChange = a.month_change_percent != null ? parseFloat(a.month_change_percent) : null;
    const isFavorite = this._config.favorites.includes(symbol);

    return {
      entityId,
      symbol,
      name: a.company_name || a.friendly_name || symbol,
      price: Number.isFinite(price) ? price : 0,
      currency: a.currency || 'USD',
      changePct: Number.isFinite(changePct) ? changePct : 0,
      changeAbs: Number.isFinite(changeAbs) ? changeAbs : 0,
      marketCap: a.market_cap_formatted || this._formatCompact(a.market_cap),
      volume: this._formatCompact(a.volume),
      exchange: a.exchange || '',
      sector: a.sector || '',
      type: this._assetType(a),
      signal: a.overall_signal || 'N/A',
      rsi,
      weekChange,
      monthChange,
      high: a.today_high,
      low: a.today_low,
      previousClose: a.previous_close,
      source: a.data_source || '',
      trend: a.trend_direction || 'neutral',
      holdings,
      value,
      lastUpdated: state.last_updated,
      isFavorite,
    };
  }

  _formatPrice(value, currency = 'USD') {
    if (value == null || isNaN(value)) return 'N/A';
    const abs = Math.abs(value);
    let digits = 2;
    if (abs > 0 && abs < 1) digits = abs >= 0.01 ? 4 : 6;
    const symbols = { USD: '$', EUR: '€', CHF: 'CHF ', GBP: '£', JPY: '¥' };
    return `${symbols[currency] || `${currency} `}${new Intl.NumberFormat('de-DE', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value)}`;
  }

  _formatCompact(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n === 0) return '—';
    if (!this._config.compact_numbers) return n.toLocaleString('de-DE');
    if (Math.abs(n) >= 1e12) return `${(n / 1e12).toFixed(2)} Bio.`;
    if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)} Mrd.`;
    if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)} Mio.`;
    if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
    return n.toLocaleString('de-DE');
  }

  _changeClass(value) {
    if (value > 0) return 'positive';
    if (value < 0) return 'negative';
    return 'neutral';
  }

  _signalClass(value) {
    const v = String(value || '').toUpperCase();
    if (v.includes('BUY')) return 'positive';
    if (v.includes('SELL')) return 'negative';
    return 'neutral';
  }

  _rsiClass(value) {
    if (value == null || isNaN(value)) return 'neutral';
    if (value < 30) return 'positive';
    if (value > 70) return 'negative';
    return 'neutral';
  }

  _sortAssets(assets) {
    const mult = this._sortOrder === 'asc' ? 1 : -1;
    const val = (asset) => {
      switch (this._sortBy) {
        case 'name': return asset.name.toLowerCase();
        case 'price': return asset.price;
        case 'value': return asset.value;
        case 'rsi': return asset.rsi ?? -999;
        case 'week': return asset.weekChange ?? -999;
        case 'month': return asset.monthChange ?? -999;
        case 'symbol': return asset.symbol.toLowerCase();
        case 'change':
        default: return asset.changePct;
      }
    };

    return assets.slice().sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      if (typeof av === 'string') return av.localeCompare(bv) * mult;
      return ((av ?? 0) - (bv ?? 0)) * mult;
    });
  }

  _filteredAssets() {
    let assets = this._findEntities().map((id) => this._extract(id)).filter(Boolean);

    if (this._typeFilter !== 'all') {
      assets = assets.filter((a) => a.type === this._typeFilter);
    }

    if (this._search) {
      const q = this._search.toLowerCase();
      assets = assets.filter((a) =>
        a.symbol.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        a.exchange.toLowerCase().includes(q) ||
        a.sector.toLowerCase().includes(q)
      );
    }

    assets = this._sortAssets(assets);
    return assets.slice(0, this._config.max_items);
  }

  _summary(assets) {
    const tracked = assets.length;
    const positive = assets.filter((a) => a.changePct > 0).length;
    const negative = assets.filter((a) => a.changePct < 0).length;
    const totalValue = assets.reduce((sum, a) => sum + (a.value || 0), 0);
    const avgChange = tracked ? assets.reduce((sum, a) => sum + (a.changePct || 0), 0) / tracked : 0;
    const best = tracked ? assets.reduce((best, a) => a.changePct > best.changePct ? a : best, assets[0]) : null;
    const worst = tracked ? assets.reduce((worst, a) => a.changePct < worst.changePct ? a : worst, assets[0]) : null;
    return { tracked, positive, negative, totalValue, avgChange, best, worst };
  }

  _renderSummary(summary) {
    return `
      <div class="summary-grid">
        <div class="summary-item"><span>Assets</span><strong>${summary.tracked}</strong></div>
        <div class="summary-item"><span>Steigend</span><strong class="positive">${summary.positive}</strong></div>
        <div class="summary-item"><span>Fallend</span><strong class="negative">${summary.negative}</strong></div>
        <div class="summary-item"><span>Ø Änderung</span><strong class="${this._changeClass(summary.avgChange)}">${summary.avgChange.toFixed(2)}%</strong></div>
        <div class="summary-item"><span>Portfolio</span><strong>${this._formatCompact(summary.totalValue)}</strong></div>
        <div class="summary-item"><span>Bester Wert</span><strong class="positive">${summary.best ? `${summary.best.symbol} ${summary.best.changePct.toFixed(2)}%` : '—'}</strong></div>
      </div>
    `;
  }

  _renderTopBottom(summary) {
    if (!summary.best || !summary.worst) return '';
    return `
      <div class="top-bottom">
        <div class="mini-panel">
          <div class="mini-title">🚀 Top Performer</div>
          <div class="mini-main">${summary.best.symbol}</div>
          <div class="positive">${summary.best.changePct.toFixed(2)}%</div>
        </div>
        <div class="mini-panel">
          <div class="mini-title">🧯 Schwächster Wert</div>
          <div class="mini-main">${summary.worst.symbol}</div>
          <div class="negative">${summary.worst.changePct.toFixed(2)}%</div>
        </div>
      </div>
    `;
  }

  _renderTiles(assets) {
    return `
      <div class="tiles">
        ${assets.map((asset) => `
          <div class="tile ${this._changeClass(asset.changePct)}" data-entity="${asset.entityId}">
            <div class="tile-top">
              <div>
                <div class="tile-symbol">${asset.isFavorite ? '⭐ ' : ''}${asset.symbol}</div>
                <div class="tile-name">${asset.name}</div>
              </div>
              <div class="pill ${this._signalClass(asset.signal)}">${asset.signal}</div>
            </div>
            <div class="tile-price">${this._formatPrice(asset.price, asset.currency)}</div>
            <div class="tile-change ${this._changeClass(asset.changePct)}">${asset.changePct >= 0 ? '+' : ''}${asset.changePct.toFixed(2)}%</div>
            <div class="tile-meta">
              <span>${asset.type}</span>
              <span>${asset.exchange || asset.source || '—'}</span>
              <span>RSI <strong class="${this._rsiClass(asset.rsi)}">${asset.rsi != null ? asset.rsi.toFixed(0) : '—'}</strong></span>
            </div>
            <div class="tile-stats">
              <div><span>Volumen</span><strong>${asset.volume}</strong></div>
              <div><span>Market Cap</span><strong>${asset.marketCap}</strong></div>
              <div><span>7T</span><strong class="${this._changeClass(asset.weekChange || 0)}">${asset.weekChange != null ? asset.weekChange.toFixed(2) + '%' : '—'}</strong></div>
              <div><span>30T</span><strong class="${this._changeClass(asset.monthChange || 0)}">${asset.monthChange != null ? asset.monthChange.toFixed(2) + '%' : '—'}</strong></div>
            </div>
            ${this._config.show_portfolio && asset.holdings ? `
              <div class="portfolio-row">
                <span>${asset.holdings} Stk.</span>
                <strong>${this._formatPrice(asset.value, asset.currency)}</strong>
              </div>
            ` : ''}
          </div>
        `).join('')}
      </div>
    `;
  }

  _renderTable(assets) {
    return `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Preis</th>
              <th>24h</th>
              <th>7T</th>
              <th>30T</th>
              <th>RSI</th>
              <th>Signal</th>
              <th>Typ</th>
            </tr>
          </thead>
          <tbody>
            ${assets.map((asset) => `
              <tr data-entity="${asset.entityId}">
                <td><strong>${asset.symbol}</strong><div class="row-sub">${asset.name}</div></td>
                <td>${this._formatPrice(asset.price, asset.currency)}</td>
                <td class="${this._changeClass(asset.changePct)}">${asset.changePct >= 0 ? '+' : ''}${asset.changePct.toFixed(2)}%</td>
                <td class="${this._changeClass(asset.weekChange || 0)}">${asset.weekChange != null ? asset.weekChange.toFixed(2) + '%' : '—'}</td>
                <td class="${this._changeClass(asset.monthChange || 0)}">${asset.monthChange != null ? asset.monthChange.toFixed(2) + '%' : '—'}</td>
                <td class="${this._rsiClass(asset.rsi)}">${asset.rsi != null ? asset.rsi.toFixed(1) : '—'}</td>
                <td><span class="pill ${this._signalClass(asset.signal)}">${asset.signal}</span></td>
                <td>${asset.type}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  _renderPerformance(assets) {
    return `
      <div class="performance-list">
        ${assets.map((asset) => {
          const width = Math.max(6, Math.min(100, Math.abs(asset.changePct) * 8));
          const sign = asset.changePct >= 0 ? '+' : '';
          return `
            <div class="perf-row" data-entity="${asset.entityId}">
              <div class="perf-main">
                <div class="perf-left">
                  <strong>${asset.symbol}</strong>
                  <span>${asset.name}</span>
                </div>
                <div class="perf-right ${this._changeClass(asset.changePct)}">${sign}${asset.changePct.toFixed(2)}%</div>
              </div>
              <div class="bar-track">
                <div class="bar ${this._changeClass(asset.changePct)}" style="width:${width}%"></div>
              </div>
              <div class="perf-meta">
                <span>${this._formatPrice(asset.price, asset.currency)}</span>
                <span>RSI ${asset.rsi != null ? asset.rsi.toFixed(0) : '—'}</span>
                <span>${asset.signal}</span>
                <span>${asset.type}</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  _renderControls() {
    return `
      <div class="toolbar">
        <div class="toolbar-left">
          ${this._config.show_search ? `<input id="search" type="text" placeholder="Suchen…" value="${this._search}">` : ''}
          <select id="typeFilter">
            <option value="all" ${this._typeFilter === 'all' ? 'selected' : ''}>Alle</option>
            <option value="STOCK" ${this._typeFilter === 'STOCK' ? 'selected' : ''}>Aktien</option>
            <option value="ETF" ${this._typeFilter === 'ETF' ? 'selected' : ''}>ETF</option>
            <option value="CRYPTO" ${this._typeFilter === 'CRYPTO' ? 'selected' : ''}>Krypto</option>
            <option value="INDEX" ${this._typeFilter === 'INDEX' ? 'selected' : ''}>Indizes</option>
          </select>
          <select id="sortBy">
            <option value="change" ${this._sortBy === 'change' ? 'selected' : ''}>24h</option>
            <option value="price" ${this._sortBy === 'price' ? 'selected' : ''}>Preis</option>
            <option value="week" ${this._sortBy === 'week' ? 'selected' : ''}>7T</option>
            <option value="month" ${this._sortBy === 'month' ? 'selected' : ''}>30T</option>
            <option value="rsi" ${this._sortBy === 'rsi' ? 'selected' : ''}>RSI</option>
            <option value="name" ${this._sortBy === 'name' ? 'selected' : ''}>Name</option>
            <option value="value" ${this._sortBy === 'value' ? 'selected' : ''}>Portfolio</option>
          </select>
          <button id="orderBtn" class="icon-btn" title="Sortierreihenfolge">${this._sortOrder === 'asc' ? '↑' : '↓'}</button>
        </div>
        <div class="toolbar-right">
          <button class="view-btn ${this._viewMode === 'tiles' ? 'active' : ''}" data-view="tiles">Kacheln</button>
          <button class="view-btn ${this._viewMode === 'table' ? 'active' : ''}" data-view="table">Tabelle</button>
          <button class="view-btn ${this._viewMode === 'performance' ? 'active' : ''}" data-view="performance">Performance</button>
          ${this._config.refresh_button ? '<button id="refreshBtn" class="icon-btn" title="Aktualisieren">⟳</button>' : ''}
        </div>
      </div>
    `;
  }

  _render() {
    if (!this._hass) return;

    const assets = this._filteredAssets();
    const summary = this._summary(assets);

    let content = '<div class="empty">Keine passenden Assets gefunden.</div>';
    if (assets.length) {
      if (this._viewMode === 'table') content = this._renderTable(assets);
      else if (this._viewMode === 'performance') content = this._renderPerformance(assets);
      else content = this._renderTiles(assets);
    }

    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; }
        ha-card {
          padding:16px;
          border-radius:16px;
          background: var(--ha-card-background, var(--card-background-color, #1f1f1f));
        }
        .header {
          display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:14px;
        }
        .title { font-size:1.2rem; font-weight:700; }
        .subtitle { color: var(--secondary-text-color); font-size:0.86rem; }
        .toolbar { display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; margin:12px 0 16px; }
        .toolbar-left, .toolbar-right { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
        input, select, button {
          border-radius:10px; border:1px solid rgba(127,127,127,0.25); background:rgba(127,127,127,0.08);
          color:var(--primary-text-color); padding:8px 10px; font:inherit;
        }
        input { min-width:170px; }
        button { cursor:pointer; }
        .icon-btn { min-width:40px; }
        .view-btn.active { outline:2px solid var(--primary-color); }
        .summary-grid {
          display:grid; grid-template-columns:repeat(auto-fit, minmax(120px, 1fr)); gap:10px; margin-bottom:12px;
        }
        .summary-item, .mini-panel {
          background:rgba(127,127,127,0.08); padding:12px; border-radius:14px;
        }
        .summary-item span, .mini-title, .row-sub, .tile-name, .perf-left span, .subtitle { color:var(--secondary-text-color); }
        .summary-item strong { display:block; margin-top:6px; font-size:1.05rem; }
        .top-bottom { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:10px; margin-bottom:14px; }
        .mini-main { font-size:1.1rem; font-weight:700; margin:6px 0; }
        .tiles { display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:12px; }
        .tile {
          background:rgba(127,127,127,0.07); border-radius:16px; padding:14px; border:1px solid rgba(127,127,127,0.12);
          cursor:pointer; transition:transform .15s ease, border-color .15s ease;
        }
        .tile:hover, tr:hover, .perf-row:hover { transform:translateY(-1px); border-color:rgba(127,127,127,0.28); }
        .tile-top, .perf-main, .portfolio-row { display:flex; justify-content:space-between; gap:8px; align-items:flex-start; }
        .tile-symbol { font-size:1.02rem; font-weight:700; }
        .tile-price { margin-top:10px; font-size:1.3rem; font-weight:700; }
        .tile-change { margin-top:4px; font-size:1rem; font-weight:700; }
        .tile-meta, .perf-meta {
          display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; font-size:0.83rem; color:var(--secondary-text-color);
        }
        .tile-stats { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:8px; margin-top:12px; }
        .tile-stats div { background:rgba(127,127,127,0.06); padding:10px; border-radius:12px; }
        .tile-stats span { display:block; font-size:0.78rem; color:var(--secondary-text-color); margin-bottom:4px; }
        .portfolio-row { margin-top:12px; padding-top:10px; border-top:1px solid rgba(127,127,127,0.15); }
        .pill {
          display:inline-flex; align-items:center; justify-content:center; padding:4px 8px; border-radius:999px;
          font-size:0.75rem; font-weight:700; background:rgba(127,127,127,0.14);
        }
        .positive { color:${this._config.color_positive}; }
        .negative { color:${this._config.color_negative}; }
        .neutral { color:${this._config.color_neutral}; }
        .pill.positive { background:rgba(76,175,80,0.16); }
        .pill.negative { background:rgba(244,67,54,0.16); }
        .pill.neutral { background:rgba(255,152,0,0.16); }
        table { width:100%; border-collapse:collapse; }
        th, td { padding:10px 8px; text-align:left; border-bottom:1px solid rgba(127,127,127,0.12); }
        tr { cursor:pointer; }
        .table-wrap { overflow:auto; }
        .performance-list { display:flex; flex-direction:column; gap:10px; }
        .perf-row { background:rgba(127,127,127,0.07); border-radius:14px; padding:12px; cursor:pointer; }
        .bar-track { height:10px; background:rgba(127,127,127,0.12); border-radius:999px; overflow:hidden; margin-top:10px; }
        .bar { height:100%; border-radius:999px; background:currentColor; }
        .empty { padding:18px 8px; color:var(--secondary-text-color); }
        @media (max-width: 640px) {
          .top-bottom { grid-template-columns:1fr; }
          .tiles { grid-template-columns:1fr; }
          .toolbar { flex-direction:column; align-items:stretch; }
          .toolbar-left, .toolbar-right { width:100%; }
          input, select { flex:1; }
        }
      </style>
      <ha-card>
        ${this._config.show_header ? `
          <div class="header">
            <div>
              <div class="title">${this._config.title}</div>
              <div class="subtitle">${assets.length} sichtbare Assets · Sortierung: ${this._sortBy}</div>
            </div>
            ${this._config.show_market_status ? `<div class="pill neutral">Live Monitor</div>` : ''}
          </div>
        ` : ''}
        ${this._renderControls()}
        ${this._config.show_summary ? this._renderSummary(summary) : ''}
        ${this._config.show_top_bottom ? this._renderTopBottom(summary) : ''}
        ${content}
      </ha-card>
    `;

    this._attachListeners();
  }

  _attachListeners() {
    const search = this.shadowRoot.getElementById('search');
    if (search) {
      search.addEventListener('input', (e) => {
        this._search = e.target.value || '';
        this._render();
      });
    }

    const typeFilter = this.shadowRoot.getElementById('typeFilter');
    if (typeFilter) {
      typeFilter.addEventListener('change', (e) => {
        this._typeFilter = e.target.value;
        this._render();
      });
    }

    const sortBy = this.shadowRoot.getElementById('sortBy');
    if (sortBy) {
      sortBy.addEventListener('change', (e) => {
        this._sortBy = e.target.value;
        this._render();
      });
    }

    const orderBtn = this.shadowRoot.getElementById('orderBtn');
    if (orderBtn) {
      orderBtn.addEventListener('click', () => {
        this._sortOrder = this._sortOrder === 'asc' ? 'desc' : 'asc';
        this._render();
      });
    }

    this.shadowRoot.querySelectorAll('.view-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this._viewMode = btn.dataset.view;
        this._render();
      });
    });

    const refreshBtn = this.shadowRoot.getElementById('refreshBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        if (!this._hass) return;
        try {
          await this._hass.callService('stock_tracker', 'refresh', {});
        } catch (err) {
          console.error('Stock Tracker refresh failed', err);
        }
      });
    }

    this.shadowRoot.querySelectorAll('[data-entity]').forEach((el) => {
      el.addEventListener('click', () => this._openMoreInfo(el.dataset.entity));
    });
  }

  _openMoreInfo(entityId) {
    if (!this._config.popup_on_click || !entityId) return;
    const ev = new Event('hass-more-info', { bubbles: true, composed: true });
    ev.detail = { entityId };
    this.dispatchEvent(ev);
  }

  static getConfigElement() {
    return document.createElement('stock-tracker-pro-card-editor');
  }

  static getStubConfig() {
    return {
      title: '📈 Stock Tracker Pro',
      view_mode: 'tiles',
      show_summary: true,
      show_search: true,
      show_top_bottom: true,
      refresh_button: true,
    };
  }
}

class StockTrackerProCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
    this._hass = null;
  }

  setConfig(config) {
    this._config = { ...config };
    if (this._hass) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  _getEntities() {
    if (!this._hass) return [];
    return Object.keys(this._hass.states)
      .filter((entityId) => entityId.startsWith('sensor.') && entityId.endsWith('_price'))
      .filter((entityId) => {
        const attrs = this._hass.states[entityId]?.attributes || {};
        return attrs.symbol !== undefined && attrs.currency !== undefined;
      })
      .sort();
  }

  _render() {
    const c = this._config || {};
    const entities = this._getEntities();
    const selected = new Set(c.entities || []);

    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; padding:8px 0; }
        .wrap { display:flex; flex-direction:column; gap:12px; }
        .field, .entity-list { display:flex; flex-direction:column; gap:6px; }
        input, select {
          padding:10px; border-radius:10px; border:1px solid rgba(127,127,127,0.25);
          background:rgba(127,127,127,0.08); color:var(--primary-text-color); font:inherit;
        }
        .checks { display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:8px; }
        .check { display:flex; gap:8px; align-items:center; }
        .entity-list { max-height:220px; overflow:auto; padding:8px; border:1px solid rgba(127,127,127,0.14); border-radius:12px; }
        .entity-item { display:flex; gap:8px; align-items:center; }
      </style>
      <div class="wrap">
        <div class="field"><label>Titel</label><input id="title" type="text" value="${c.title || ''}"></div>
        <div class="field">
          <label>Ansicht</label>
          <select id="view_mode">
            <option value="tiles" ${(c.view_mode || 'tiles') === 'tiles' ? 'selected' : ''}>Kacheln</option>
            <option value="table" ${c.view_mode === 'table' ? 'selected' : ''}>Tabelle</option>
            <option value="performance" ${c.view_mode === 'performance' ? 'selected' : ''}>Performance</option>
          </select>
        </div>
        <div class="field">
          <label>Sortierung</label>
          <select id="sort_by">
            <option value="change" ${(c.sort_by || 'change') === 'change' ? 'selected' : ''}>24h</option>
            <option value="price" ${c.sort_by === 'price' ? 'selected' : ''}>Preis</option>
            <option value="week" ${c.sort_by === 'week' ? 'selected' : ''}>7 Tage</option>
            <option value="month" ${c.sort_by === 'month' ? 'selected' : ''}>30 Tage</option>
            <option value="rsi" ${c.sort_by === 'rsi' ? 'selected' : ''}>RSI</option>
            <option value="name" ${c.sort_by === 'name' ? 'selected' : ''}>Name</option>
          </select>
        </div>
        <div class="field"><label>Max. Assets</label><input id="max_items" type="number" min="1" max="100" value="${c.max_items || 12}"></div>
        <div class="checks">
          ${[
            ['show_header', 'Header', c.show_header !== false],
            ['show_summary', 'Summary', c.show_summary !== false],
            ['show_search', 'Suche', c.show_search !== false],
            ['show_top_bottom', 'Top/Bottom', c.show_top_bottom !== false],
            ['show_market_status', 'Status-Badge', c.show_market_status !== false],
            ['refresh_button', 'Refresh-Button', c.refresh_button !== false],
            ['popup_on_click', 'Popup bei Klick', c.popup_on_click !== false],
          ].map(([id, label, checked]) => `
            <label class="check"><input id="${id}" type="checkbox" ${checked ? 'checked' : ''}> ${label}</label>
          `).join('')}
        </div>
        <div class="field">
          <label>Entities auswählen (leer = Auto-Discovery)</label>
          <div class="entity-list">
            ${entities.map((entityId) => `
              <label class="entity-item"><input class="entity-checkbox" data-entity="${entityId}" type="checkbox" ${selected.has(entityId) ? 'checked' : ''}> ${entityId}</label>
            `).join('') || '<div>Keine passenden Entities gefunden.</div>'}
          </div>
        </div>
      </div>
    `;

    const onChange = () => {
      const q = (id) => this.shadowRoot.getElementById(id);
      const chosen = [...this.shadowRoot.querySelectorAll('.entity-checkbox:checked')].map((el) => el.dataset.entity);
      this._config = {
        ...this._config,
        title: q('title')?.value || '📈 Stock Tracker Pro',
        view_mode: q('view_mode')?.value || 'tiles',
        sort_by: q('sort_by')?.value || 'change',
        max_items: Number(q('max_items')?.value || 12),
        show_header: q('show_header')?.checked,
        show_summary: q('show_summary')?.checked,
        show_search: q('show_search')?.checked,
        show_top_bottom: q('show_top_bottom')?.checked,
        show_market_status: q('show_market_status')?.checked,
        refresh_button: q('refresh_button')?.checked,
        popup_on_click: q('popup_on_click')?.checked,
        entities: chosen,
      };
      this.dispatchEvent(new CustomEvent('config-changed', {
        detail: { config: this._config },
        bubbles: true,
        composed: true,
      }));
    };

    this.shadowRoot.querySelectorAll('input, select').forEach((el) => el.addEventListener('change', onChange));
    const title = this.shadowRoot.getElementById('title');
    if (title) title.addEventListener('input', onChange);
  }
}

if (!customElements.get('stock-tracker-pro-card')) {
  customElements.define('stock-tracker-pro-card', StockTrackerProCard);
  console.info(
    '%c 📈 STOCK-TRACKER-PRO-CARD %c v1.0.0 ',
    'color:white;background:#3949ab;font-weight:bold;padding:2px 6px;border-radius:3px 0 0 3px',
    'color:#3949ab;background:white;font-weight:bold;padding:2px 6px;border-radius:0 3px 3px 0;border:1px solid #3949ab'
  );
}

if (!customElements.get('stock-tracker-pro-card-editor')) {
  customElements.define('stock-tracker-pro-card-editor', StockTrackerProCardEditor);
}

window.customCards = window.customCards || [];
if (!window.customCards.find((c) => c.type === 'stock-tracker-pro-card')) {
  window.customCards.push({
    type: 'stock-tracker-pro-card',
    name: 'Stock Tracker Pro Card',
    description: 'Advanced market monitor with filters, search, portfolio view, top movers and performance mode',
    preview: true,
    documentationURL: 'https://github.com/richieam93/ha-stock-tracker',
  });
}
