/**
 * Stock Tracker Card v2.0 for Home Assistant
 *
 * Enhanced custom Lovelace card for stocks, crypto, ETFs & indices.
 *
 * New in v2.0:
 * - Market cap fix with multiple fallbacks & calculation
 * - Auto decimal places for small-price assets (crypto)
 * - Portfolio tracking (holdings, purchase price, P/L)
 * - Price alerts with visual indicators
 * - Mini sparkline chart from HA history
 * - Supply info for crypto assets
 * - Moving averages display (50/200 day)
 * - 20+ configurable options via visual editor
 * - Collapsible editor sections
 * - Better animations and mobile layout
 */

class StockTrackerCard extends HTMLElement {
  // =========================================================================
  // LIFECYCLE
  // =========================================================================

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
    this._hass = null;
    this._historyData = [];
    this._lastHistoryFetch = 0;
    this._previousPrice = null;
  }

  set hass(hass) {
    const prev = this._hass;
    this._hass = hass;

    if (prev && this._config.entity) {
      const os = prev.states[this._config.entity];
      if (os) this._previousPrice = parseFloat(os.state);
    }

    this._render();

    if (this._config.show_chart) {
      this._fetchHistory();
    }
  }

  setConfig(config) {
    if (!config.entity) throw new Error('Please define an entity');

    this._config = {
      entity: config.entity,
      display_mode: config.display_mode || 'full',
      name: config.name || null,

      // Section visibility
      show_header: config.show_header !== false,
      show_day_stats: config.show_day_stats !== false,
      show_volume: config.show_volume !== false,
      show_market_cap: config.show_market_cap !== false,
      show_52week: config.show_52week !== false,
      show_performance: config.show_performance !== false,
      show_indicators: config.show_indicators !== false,
      show_signal: config.show_signal !== false,
      show_footer: config.show_footer !== false,
      show_chart: config.show_chart || false,
      show_supply: config.show_supply || false,
      show_fundamentals: config.show_fundamentals !== false,
      show_moving_averages: config.show_moving_averages || false,
      show_portfolio: !!(config.holdings),
      show_alerts: !!(config.price_alert_high || config.price_alert_low),

      // Chart
      chart_hours: parseInt(config.chart_hours) || 24,
      chart_height: parseInt(config.chart_height) || 80,
      chart_color: config.chart_color || 'auto',
      chart_fill: config.chart_fill !== false,

      // Formatting
      decimal_places: config.decimal_places !== undefined ? config.decimal_places : 'auto',
      compact_numbers: config.compact_numbers !== false,

      // Portfolio
      holdings: config.holdings != null ? parseFloat(config.holdings) : null,
      purchase_price: config.purchase_price != null ? parseFloat(config.purchase_price) : null,

      // Alerts
      price_alert_high: config.price_alert_high != null ? parseFloat(config.price_alert_high) : null,
      price_alert_low: config.price_alert_low != null ? parseFloat(config.price_alert_low) : null,

      // Colors
      color_positive: config.color_positive || '#4CAF50',
      color_negative: config.color_negative || '#F44336',
      color_neutral: config.color_neutral || '#FF9800',

      update_animation: config.update_animation !== false,
      tap_action: config.tap_action || 'more-info',
    };

    this._render();
  }

  getCardSize() {
    switch (this._config.display_mode) {
      case 'mini': return 1;
      case 'compact': return 3;
      default: return 5;
    }
  }

  // =========================================================================
  // DATA EXTRACTION
  // =========================================================================

  _extractData(entity) {
    const a = entity.attributes || {};
    const price = parseFloat(entity.state) || 0;
    const change = parseFloat(a.change) || 0;
    const changePct = parseFloat(a.change_percent) || 0;
    const isCrypto = (a.quote_type || '').toUpperCase() === 'CRYPTOCURRENCY';

    // --- Market Cap: multiple fallbacks ---
    let marketCap = null;
    const mcRaw = a.market_cap_formatted || a.market_cap || a.marketCap
      || a.market_capitalization || a.MarketCap || a.mcap || null;

    if (mcRaw && mcRaw !== 'N/A' && mcRaw !== 'None' && mcRaw !== '0') {
      const mcNum = parseFloat(String(mcRaw).replace(/[^0-9.eE+-]/g, ''));
      if (!isNaN(mcNum) && mcNum > 0) {
        marketCap = typeof mcRaw === 'string' && /[TMBK]/i.test(mcRaw)
          ? mcRaw : this._formatLargeNumber(mcNum);
      } else if (typeof mcRaw === 'string' && mcRaw.length > 1) {
        marketCap = mcRaw;
      }
    }

    // Fallback: calculate from circulating supply
    if (!marketCap || marketCap === 'N/A') {
      const supply = parseFloat(a.circulating_supply || a.circulatingSupply || 0);
      if (supply > 0 && price > 0) {
        marketCap = this._formatLargeNumber(supply * price);
      }
    }

    // --- Circulating / Max supply ---
    const circSupply = parseFloat(a.circulating_supply || a.circulatingSupply || 0);
    const totalSupply = parseFloat(a.total_supply || a.totalSupply || 0);
    const maxSupply = parseFloat(a.max_supply || a.maxSupply || 0);

    return {
      symbol: a.symbol || this._extractSymbol(this._config.entity),
      name: this._config.name || a.company_name || a.friendly_name || a.symbol || 'Stock',
      price, currency: a.currency || 'USD',
      change, changePercent: changePct,
      isPositive: changePct >= 0,
      previousClose: parseFloat(a.previous_close) || 0,
      open: parseFloat(a.today_open) || 0,
      high: parseFloat(a.today_high) || 0,
      low: parseFloat(a.today_low) || 0,
      volume: a.volume,
      volumeFormatted: this._formatVolume(a.volume),
      marketCap: marketCap || 'N/A',
      peRatio: a.pe_ratio, eps: a.eps,
      dividendYield: a.dividend_yield,
      week52High: parseFloat(a['52_week_high']) || null,
      week52Low: parseFloat(a['52_week_low']) || null,
      avgDay50: parseFloat(a['50_day_avg']) || null,
      avgDay200: parseFloat(a['200_day_avg']) || null,
      exchange: a.exchange || '', sector: a.sector || '',
      quoteType: (a.quote_type || 'EQUITY').toUpperCase(),
      isCrypto,
      dataSource: a.data_source || '',
      dataQuality: a.data_quality || '',
      signal: a.overall_signal || 'N/A',
      trendDirection: a.trend_direction || 'neutral',
      trendStrength: parseFloat(a.trend_strength) || 0,
      volatility: parseFloat(a.volatility) || 0,
      rsi: a.rsi_14 != null ? parseFloat(a.rsi_14) : null,
      rsiSignal: a.rsi_signal,
      macdTrend: a.macd_trend,
      weekChange: a.week_change_percent != null ? parseFloat(a.week_change_percent) : null,
      monthChange: a.month_change_percent != null ? parseFloat(a.month_change_percent) : null,
      ytdChange: a.ytd_change_percent != null ? parseFloat(a.ytd_change_percent) : null,
      lastUpdated: entity.last_updated,
      circSupply, totalSupply, maxSupply,
    };
  }

  _extractSymbol(entityId) {
    const m = entityId.match(/sensor\.(.+?)_price/);
    return m ? m[1].toUpperCase().replace(/_/g, '-') : entityId;
  }

  // =========================================================================
  // FORMATTING HELPERS
  // =========================================================================

  _getDecimals(price) {
    const dp = this._config.decimal_places;
    if (dp !== 'auto' && dp !== undefined) return parseInt(dp) || 2;
    const abs = Math.abs(price);
    if (abs === 0) return 2;
    if (abs >= 1) return 2;
    if (abs >= 0.01) return 4;
    if (abs >= 0.0001) return 6;
    return 8;
  }

  _formatPrice(value, currency, forceDecimals) {
    if (value == null || isNaN(value)) return 'N/A';
    const dec = forceDecimals != null ? forceDecimals : this._getDecimals(value);
    const symbols = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', CHF: 'CHF ' };
    const sym = symbols[currency] || currency + ' ';
    return sym + new Intl.NumberFormat('de-DE', {
      minimumFractionDigits: dec, maximumFractionDigits: dec
    }).format(value);
  }

  _formatVolume(v) {
    if (!v) return 'N/A';
    v = parseFloat(v);
    if (v >= 1e9) return (v / 1e9).toFixed(2) + ' Mrd.';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + ' Mio.';
    if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return v.toLocaleString('de-DE');
  }

  _formatLargeNumber(v) {
    if (!v) return null;
    v = parseFloat(v);
    if (isNaN(v) || v === 0) return null;
    if (v >= 1e12) return (v / 1e12).toFixed(2) + ' Bio.';
    if (v >= 1e9) return (v / 1e9).toFixed(2) + ' Mrd.';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + ' Mio.';
    return v.toLocaleString('de-DE');
  }

  _formatSupply(v) {
    if (!v || v === 0) return null;
    if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    return v.toLocaleString('de-DE');
  }

  _getTrendIcon(t) {
    return { strong_bullish:'🚀', bullish:'📈', neutral:'➡️', bearish:'📉', strong_bearish:'🔻' }[t] || '❓';
  }
  _formatTrend(t) {
    return { strong_bullish:'Stark ↑', bullish:'Steigend', neutral:'Seitwärts', bearish:'Fallend', strong_bearish:'Stark ↓' }[t] || t;
  }
  _getSignalIcon(s) {
    return { STRONG_BUY:'🟢', BUY:'🟩', HOLD:'🟨', SELL:'🟧', STRONG_SELL:'🔴' }[s] || '⚪';
  }
  _getRsiClass(rsi) { return rsi < 30 ? 'oversold' : rsi > 70 ? 'overbought' : 'neutral'; }
  _getRsiLabel(rsi) { return rsi < 30 ? 'Überverkauft' : rsi > 70 ? 'Überkauft' : 'Neutral'; }
  _getTypeIcon(qt) {
    return { CRYPTOCURRENCY:'🪙', ETF:'📊', INDEX:'📉', MUTUALFUND:'🏦' }[qt] || '📈';
  }

  // =========================================================================
  // CHART – HISTORY FETCH & SPARKLINE
  // =========================================================================

  async _fetchHistory() {
    if (!this._hass || !this._config.entity || !this._config.show_chart) return;
    const now = Date.now();
    if (now - this._lastHistoryFetch < 60000) return;
    this._lastHistoryFetch = now;

    const hours = this._config.chart_hours;
    const start = new Date(now - hours * 3600000);

    try {
      const result = await this._hass.callWS({
        type: 'history/history_during_period',
        start_time: start.toISOString(),
        end_time: new Date(now).toISOString(),
        entity_ids: [this._config.entity],
        minimal_response: true,
        no_attributes: true,
      });
      const arr = result[this._config.entity] || [];
      this._historyData = arr.map(i => parseFloat(i.s)).filter(v => !isNaN(v));
    } catch (e1) {
      try {
        const resp = await this._hass.callApi(
          'GET',
          `history/period/${start.toISOString()}?filter_entity_id=${this._config.entity}&minimal_response&no_attributes`
        );
        if (resp && resp[0]) {
          this._historyData = resp[0].map(i => parseFloat(i.state)).filter(v => !isNaN(v));
        }
      } catch (e2) {
        this._historyData = [];
      }
    }
    this._updateChartElement();
  }

  _updateChartElement() {
    const el = this.shadowRoot.getElementById('sparkline-container');
    if (el) el.innerHTML = this._buildSparklineSVG(this._historyData);
  }

  _buildSparklineSVG(data) {
    if (!data || data.length < 2) {
      return `<div style="text-align:center;padding:12px 0;font-size:11px;color:var(--secondary-text-color);">Keine Chart-Daten verfügbar</div>`;
    }
    const w = 300, h = this._config.chart_height || 80;
    const min = Math.min(...data), max = Math.max(...data);
    const range = max - min || 1;
    const pad = 3, ch = h - pad * 2;

    const pts = data.map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = pad + ch - ((v - min) / range) * ch;
      return [x, y];
    });
    const pStr = pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    const isUp = data[data.length - 1] >= data[0];
    const cc = this._config;
    const lc = cc.chart_color === 'auto'
      ? (isUp ? cc.color_positive : cc.color_negative)
      : (cc.chart_color || '#03a9f4');

    let svg = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="width:100%;height:${h}px;display:block;">`;
    if (cc.chart_fill !== false) {
      const fp = `${pts[0][0].toFixed(1)},${h} ${pStr} ${pts[pts.length-1][0].toFixed(1)},${h}`;
      svg += `<polygon points="${fp}" fill="${lc}" opacity="0.12"/>`;
    }
    svg += `<polyline points="${pStr}" fill="none" stroke="${lc}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    const last = pts[pts.length - 1];
    svg += `<circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.5" fill="${lc}"/>`;

    // Min/max labels
    const minPt = pts.reduce((a, b) => a[1] > b[1] ? a : b);  // highest y = lowest price
    const maxPt = pts.reduce((a, b) => a[1] < b[1] ? a : b);
    svg += `<text x="${maxPt[0] < w/2 ? maxPt[0]+4 : maxPt[0]-4}" y="${maxPt[1]-4}" fill="${lc}" font-size="9" text-anchor="${maxPt[0] < w/2 ? 'start':'end'}">${max.toFixed(this._getDecimals(max))}</text>`;
    svg += `<text x="${minPt[0] < w/2 ? minPt[0]+4 : minPt[0]-4}" y="${minPt[1]+12}" fill="${lc}" font-size="9" text-anchor="${minPt[0] < w/2 ? 'start':'end'}">${min.toFixed(this._getDecimals(min))}</text>`;

    svg += '</svg>';
    return svg;
  }

  // =========================================================================
  // RENDER
  // =========================================================================

  _render() {
    if (!this._hass || !this._config.entity) return;
    const entity = this._hass.states[this._config.entity];
    if (!entity) { this._renderError(`Entity nicht gefunden: ${this._config.entity}`); return; }
    const data = this._extractData(entity);

    switch (this._config.display_mode) {
      case 'mini': this._renderMini(data); break;
      case 'compact': this._renderCompact(data); break;
      default: this._renderFull(data); break;
    }
  }

  // ---- MINI ----
  _renderMini(d) {
    const cc = this._config;
    const col = d.isPositive ? cc.color_positive : cc.color_negative;
    const arr = d.isPositive ? '▲' : '▼';
    this.shadowRoot.innerHTML = `
      <style>${this._getMiniStyles()}</style>
      <ha-card class="mini-card">
        <div class="mini-row">
          <span class="type-icon">${this._getTypeIcon(d.quoteType)}</span>
          <span class="sym">${d.symbol}</span>
          <span class="price">${this._formatPrice(d.price, d.currency)}</span>
          <span class="chg" style="color:${col}">${arr} ${Math.abs(d.changePercent).toFixed(2)}%</span>
          ${cc.show_signal ? `<span class="sig sig-${d.signal.toLowerCase().replace('_','-')}">${this._getSignalIcon(d.signal)}</span>` : ''}
        </div>
        ${d.price > 0 && cc.show_alerts ? this._renderAlertDot(d) : ''}
      </ha-card>`;
    this._attachClickHandler();
  }

  // ---- COMPACT ----
  _renderCompact(d) {
    const cc = this._config;
    const col = d.isPositive ? cc.color_positive : cc.color_negative;
    const arr = d.isPositive ? '▲' : '▼';

    this.shadowRoot.innerHTML = `
      <style>${this._getCompactStyles()}</style>
      <ha-card class="compact-card">
        <div class="top">
          <div class="left">
            <div class="sym-row">
              <span class="type-icon">${this._getTypeIcon(d.quoteType)}</span>
              <span class="sym">${d.symbol}</span>
              <span class="exch">${d.exchange}</span>
            </div>
            <div class="name">${d.name}</div>
          </div>
          ${cc.show_signal ? `<span class="sig sig-${d.signal.toLowerCase().replace('_','-')}">${this._getSignalIcon(d.signal)} ${d.signal}</span>` : ''}
        </div>
        <div class="price-row">
          <div>
            <span class="price">${this._formatPrice(d.price, d.currency)}</span>
            <span class="cur">${d.currency}</span>
          </div>
          <div class="chg-row" style="color:${col}">
            ${d.isPositive ? '+' : ''}${d.change.toFixed(this._getDecimals(d.change))}
            (${arr} ${Math.abs(d.changePercent).toFixed(2)}%)
          </div>
        </div>
        ${cc.show_chart ? `<div class="chart-area" id="sparkline-container">${this._buildSparklineSVG(this._historyData)}</div>` : ''}
        ${cc.show_alerts ? this._renderAlertBanner(d) : ''}
        <div class="bottom">
          <div class="st"><span class="sl">Trend</span><span class="sv">${this._getTrendIcon(d.trendDirection)}</span></div>
          <div class="st"><span class="sl">Vol</span><span class="sv">${d.volumeFormatted}</span></div>
          ${cc.show_market_cap ? `<div class="st"><span class="sl">MCap</span><span class="sv">${d.marketCap}</span></div>` : ''}
        </div>
        ${this._renderPortfolioCompact(d)}
      </ha-card>`;
    this._attachClickHandler();
  }

  // ---- FULL ----
  _renderFull(d) {
    const cc = this._config;
    const col = d.isPositive ? cc.color_positive : cc.color_negative;
    const bgCol = d.isPositive ? cc.color_positive + '18' : cc.color_negative + '18';
    const arr = d.isPositive ? '▲' : '▼';
    const dec = this._getDecimals(d.price);

    this.shadowRoot.innerHTML = `
      <style>${this._getFullStyles()}</style>
      <ha-card class="full-card ${cc.update_animation && this._previousPrice != null && this._previousPrice !== d.price ? 'price-flash' : ''}">

        <!-- HEADER -->
        ${cc.show_header ? `
        <div class="header">
          <div class="h-left">
            <div class="sym-badge">${this._getTypeIcon(d.quoteType)} ${d.symbol}</div>
            <div class="c-info">
              <span class="c-name">${d.name}</span>
              <span class="c-exch">${d.exchange}${d.sector ? ' · ' + d.sector : ''}</span>
            </div>
          </div>
          <div class="h-right">
            <div class="trend-badge trend-${d.trendDirection}">
              ${this._getTrendIcon(d.trendDirection)} ${this._formatTrend(d.trendDirection)}
            </div>
          </div>
        </div>` : ''}

        <!-- ALERTS BANNER -->
        ${cc.show_alerts ? this._renderAlertBanner(d) : ''}

        <!-- PRICE -->
        <div class="price-section" style="background:${bgCol}">
          <div class="p-main">
            <span class="price">${this._formatPrice(d.price, d.currency)}</span>
            <span class="cur">${d.currency}</span>
          </div>
          <div class="p-change" style="color:${col}">
            <span>${d.isPositive ? '+' : ''}${d.change.toFixed(dec)}</span>
            <span>(${arr} ${Math.abs(d.changePercent).toFixed(2)}%)</span>
          </div>
        </div>

        <!-- CHART -->
        ${cc.show_chart ? `
        <div class="chart-section">
          <div class="section-title">📈 Kursverlauf (${cc.chart_hours}h)</div>
          <div id="sparkline-container">${this._buildSparklineSVG(this._historyData)}</div>
        </div>` : ''}

        <!-- PORTFOLIO -->
        ${this._renderPortfolioFull(d)}

        <!-- DAY STATS -->
        ${cc.show_day_stats ? `
        <div class="stats-grid">
          <div class="s-item"><span class="s-label">Eröffnung</span><span class="s-val">${this._formatPrice(d.open, d.currency)}</span></div>
          <div class="s-item"><span class="s-label">Vortag</span><span class="s-val">${this._formatPrice(d.previousClose, d.currency)}</span></div>
          <div class="s-item"><span class="s-label">Tageshoch</span><span class="s-val high">${this._formatPrice(d.high, d.currency)}</span></div>
          <div class="s-item"><span class="s-label">Tagestief</span><span class="s-val low">${this._formatPrice(d.low, d.currency)}</span></div>
        </div>` : ''}

        <!-- MARKET DATA -->
        <div class="data-section">
          ${cc.show_volume ? `<div class="d-row"><span class="d-lbl">📊 Volumen</span><span class="d-val">${d.volumeFormatted}</span></div>` : ''}
          ${cc.show_market_cap ? `<div class="d-row"><span class="d-lbl">🏛️ Marktkapitalisierung</span><span class="d-val">${d.marketCap}</span></div>` : ''}
          ${cc.show_fundamentals && d.peRatio ? `<div class="d-row"><span class="d-lbl">📈 KGV (P/E)</span><span class="d-val">${parseFloat(d.peRatio).toFixed(2)}</span></div>` : ''}
          ${cc.show_fundamentals && d.eps ? `<div class="d-row"><span class="d-lbl">💵 EPS</span><span class="d-val">${parseFloat(d.eps).toFixed(2)} ${d.currency}</span></div>` : ''}
          ${cc.show_fundamentals && d.dividendYield ? `<div class="d-row"><span class="d-lbl">💰 Dividendenrendite</span><span class="d-val">${parseFloat(d.dividendYield).toFixed(2)}%</span></div>` : ''}
        </div>

        <!-- SUPPLY (CRYPTO) -->
        ${cc.show_supply && d.isCrypto ? this._renderSupply(d) : ''}

        <!-- 52-WEEK -->
        ${cc.show_52week && d.week52Low != null && d.week52High != null ? this._render52WeekRange(d) : ''}

        <!-- MOVING AVERAGES -->
        ${cc.show_moving_averages ? this._renderMovingAverages(d) : ''}

        <!-- PERFORMANCE -->
        ${cc.show_performance ? this._renderPeriodPerformance(d) : ''}

        <!-- INDICATORS -->
        ${cc.show_indicators ? this._renderIndicators(d) : ''}

        <!-- FOOTER -->
        ${cc.show_footer ? `
        <div class="card-footer">
          <span class="src">📡 ${d.dataSource || 'Yahoo'}${d.dataQuality ? ' · ' + d.dataQuality : ''}</span>
          ${cc.show_signal ? `
          <span class="sig-badge sig-${d.signal.toLowerCase().replace('_','-')}">
            ${this._getSignalIcon(d.signal)} ${d.signal}
          </span>` : ''}
        </div>` : ''}
      </ha-card>`;
    this._attachClickHandler();
  }

  // =========================================================================
  // RENDER COMPONENTS
  // =========================================================================

  _renderAlertBanner(d) {
    const cc = this._config;
    const alerts = [];
    if (cc.price_alert_high != null && d.price >= cc.price_alert_high) {
      alerts.push({ type: 'high', icon: '🔔', msg: `Preis über ${this._formatPrice(cc.price_alert_high, d.currency)}!`, color: cc.color_negative });
    }
    if (cc.price_alert_low != null && d.price <= cc.price_alert_low) {
      alerts.push({ type: 'low', icon: '🔔', msg: `Preis unter ${this._formatPrice(cc.price_alert_low, d.currency)}!`, color: cc.color_positive });
    }
    if (alerts.length === 0) return '';
    return alerts.map(a => `
      <div class="alert-banner" style="background:${a.color}18;border-left:3px solid ${a.color};color:${a.color}">
        ${a.icon} ${a.msg}
      </div>`).join('');
  }

  _renderAlertDot(d) {
    const cc = this._config;
    if (cc.price_alert_high != null && d.price >= cc.price_alert_high)
      return `<span class="alert-dot" style="background:${cc.color_negative}" title="Preis über Alarm!"></span>`;
    if (cc.price_alert_low != null && d.price <= cc.price_alert_low)
      return `<span class="alert-dot" style="background:${cc.color_positive}" title="Preis unter Alarm!"></span>`;
    return '';
  }

  _renderPortfolioCompact(d) {
    const cc = this._config;
    if (!cc.holdings || cc.holdings <= 0) return '';
    const totalVal = d.price * cc.holdings;
    let plHtml = '';
    if (cc.purchase_price && cc.purchase_price > 0) {
      const invested = cc.purchase_price * cc.holdings;
      const pl = totalVal - invested;
      const plPct = (pl / invested) * 100;
      const isUp = pl >= 0;
      const plCol = isUp ? cc.color_positive : cc.color_negative;
      plHtml = `<div class="st"><span class="sl">G/V</span><span class="sv" style="color:${plCol}">${isUp ? '+' : ''}${plPct.toFixed(2)}%</span></div>`;
    }
    return `
      <div class="bottom portfolio-row">
        <div class="st"><span class="sl">Stk.</span><span class="sv">${cc.holdings}</span></div>
        <div class="st"><span class="sl">Wert</span><span class="sv">${this._formatPrice(totalVal, d.currency)}</span></div>
        ${plHtml}
      </div>`;
  }

  _renderPortfolioFull(d) {
    const cc = this._config;
    if (!cc.holdings || cc.holdings <= 0) return '';
    const totalVal = d.price * cc.holdings;
    let rows = `
      <div class="d-row"><span class="d-lbl">📦 Bestand</span><span class="d-val">${cc.holdings.toLocaleString('de-DE')}</span></div>
      <div class="d-row"><span class="d-lbl">💎 Aktueller Wert</span><span class="d-val bold">${this._formatPrice(totalVal, d.currency)}</span></div>`;
    if (cc.purchase_price && cc.purchase_price > 0) {
      const invested = cc.purchase_price * cc.holdings;
      const pl = totalVal - invested;
      const plPct = (pl / invested) * 100;
      const isUp = pl >= 0;
      const plCol = isUp ? cc.color_positive : cc.color_negative;
      rows += `
        <div class="d-row"><span class="d-lbl">🏷️ Kaufpreis</span><span class="d-val">${this._formatPrice(cc.purchase_price, d.currency)}</span></div>
        <div class="d-row"><span class="d-lbl">💰 Investiert</span><span class="d-val">${this._formatPrice(invested, d.currency)}</span></div>
        <div class="d-row"><span class="d-lbl">📊 Gewinn / Verlust</span><span class="d-val bold" style="color:${plCol}">${isUp ? '+' : ''}${this._formatPrice(pl, d.currency)} (${isUp ? '+' : ''}${plPct.toFixed(2)}%)</span></div>`;
    }
    return `
      <div class="portfolio-section">
        <div class="section-title">💼 Portfolio</div>
        <div class="data-section">${rows}</div>
      </div>`;
  }

  _renderSupply(d) {
    if (!d.circSupply && !d.totalSupply && !d.maxSupply) return '';
    let rows = '';
    if (d.circSupply) rows += `<div class="d-row"><span class="d-lbl">🔄 Umlaufmenge</span><span class="d-val">${this._formatSupply(d.circSupply)}</span></div>`;
    if (d.totalSupply && d.totalSupply !== d.circSupply) rows += `<div class="d-row"><span class="d-lbl">📦 Gesamtmenge</span><span class="d-val">${this._formatSupply(d.totalSupply)}</span></div>`;
    if (d.maxSupply) rows += `<div class="d-row"><span class="d-lbl">🔒 Max. Menge</span><span class="d-val">${this._formatSupply(d.maxSupply)}</span></div>`;
    if (d.circSupply && d.maxSupply && d.maxSupply > 0) {
      const pct = (d.circSupply / d.maxSupply) * 100;
      rows += `
        <div class="d-row">
          <span class="d-lbl">📊 Ausgabequote</span>
          <span class="d-val">${pct.toFixed(1)}%</span>
        </div>
        <div class="supply-bar"><div class="supply-fill" style="width:${Math.min(100, pct)}%"></div></div>`;
    }
    if (!rows) return '';
    return `
      <div class="supply-section">
        <div class="section-title">🪙 Supply</div>
        <div class="data-section">${rows}</div>
      </div>`;
  }

  _render52WeekRange(d) {
    const lo = d.week52Low, hi = d.week52High, cur = d.price;
    const rng = hi - lo;
    const pos = rng > 0 ? ((cur - lo) / rng) * 100 : 50;
    return `
      <div class="range-section">
        <div class="section-title">52-Wochen Spanne</div>
        <div class="range-bar-ct">
          <span class="r-lo">${this._formatPrice(lo, d.currency)}</span>
          <div class="range-bar">
            <div class="range-fill" style="width:${pos}%"></div>
            <div class="range-marker" style="left:${pos}%"></div>
          </div>
          <span class="r-hi">${this._formatPrice(hi, d.currency)}</span>
        </div>
      </div>`;
  }

  _renderMovingAverages(d) {
    if (!d.avgDay50 && !d.avgDay200) return '';
    const dec = this._getDecimals(d.price);
    let rows = '';
    if (d.avgDay50) {
      const diff50 = ((d.price - d.avgDay50) / d.avgDay50) * 100;
      const col50 = diff50 >= 0 ? this._config.color_positive : this._config.color_negative;
      rows += `<div class="d-row"><span class="d-lbl">MA 50</span><span class="d-val">${this._formatPrice(d.avgDay50, d.currency)} <small style="color:${col50}">(${diff50 >= 0 ? '+' : ''}${diff50.toFixed(2)}%)</small></span></div>`;
    }
    if (d.avgDay200) {
      const diff200 = ((d.price - d.avgDay200) / d.avgDay200) * 100;
      const col200 = diff200 >= 0 ? this._config.color_positive : this._config.color_negative;
      rows += `<div class="d-row"><span class="d-lbl">MA 200</span><span class="d-val">${this._formatPrice(d.avgDay200, d.currency)} <small style="color:${col200}">(${diff200 >= 0 ? '+' : ''}${diff200.toFixed(2)}%)</small></span></div>`;
    }
    if (d.avgDay50 && d.avgDay200) {
      const cross = d.avgDay50 > d.avgDay200 ? '🟢 Golden Cross' : '🔴 Death Cross';
      rows += `<div class="d-row"><span class="d-lbl">MA Kreuzung</span><span class="d-val">${cross}</span></div>`;
    }
    return `
      <div class="ma-section">
        <div class="section-title">📐 Gleitende Durchschnitte</div>
        <div class="data-section">${rows}</div>
      </div>`;
  }

  _renderPeriodPerformance(d) {
    const periods = [
      { label: '1W', value: d.weekChange },
      { label: '1M', value: d.monthChange },
      { label: 'YTD', value: d.ytdChange },
    ].filter(p => p.value != null);
    if (periods.length === 0) return '';
    const cc = this._config;
    return `
      <div class="perf-section">
        <div class="section-title">Performance</div>
        <div class="perf-grid">
          ${periods.map(p => {
            const isUp = p.value >= 0;
            const col = isUp ? cc.color_positive : cc.color_negative;
            return `<div class="perf-item"><span class="perf-lbl">${p.label}</span><span class="perf-val" style="color:${col}">${isUp ? '+' : ''}${parseFloat(p.value).toFixed(2)}%</span></div>`;
          }).join('')}
        </div>
      </div>`;
  }

  _renderIndicators(d) {
    if (!d.rsi && !d.macdTrend && !d.trendStrength) return '';
    const cc = this._config;
    return `
      <div class="ind-section">
        <div class="section-title">📊 Technische Indikatoren</div>
        <div class="ind-grid">
          ${d.rsi != null ? `
          <div class="ind-item">
            <span class="ind-lbl">RSI (14)</span>
            <div class="ind-val-row">
              <span class="ind-val">${d.rsi.toFixed(1)}</span>
              <span class="ind-sig ${this._getRsiClass(d.rsi)}">${this._getRsiLabel(d.rsi)}</span>
            </div>
            <div class="bar"><div class="bar-fill rsi-fill" style="width:${Math.min(100, d.rsi)}%;background:${d.rsi < 30 ? cc.color_positive : d.rsi > 70 ? cc.color_negative : cc.color_neutral}"></div></div>
          </div>` : ''}
          ${d.macdTrend ? `
          <div class="ind-item">
            <span class="ind-lbl">MACD</span>
            <span class="ind-sig macd-${d.macdTrend}">${d.macdTrend === 'bullish' ? '📈 Bullisch' : '📉 Bärisch'}</span>
          </div>` : ''}
          ${d.trendStrength ? `
          <div class="ind-item">
            <span class="ind-lbl">Trend-Stärke</span>
            <div class="bar"><div class="bar-fill" style="width:${d.trendStrength * 10}%"></div></div>
            <span class="ind-val">${d.trendStrength.toFixed(1)}/10</span>
          </div>` : ''}
          ${d.volatility ? `
          <div class="ind-item">
            <span class="ind-lbl">Volatilität</span>
            <span class="ind-val">${(d.volatility * 100).toFixed(2)}%</span>
          </div>` : ''}
        </div>
      </div>`;
  }

  _renderError(msg) {
    this.shadowRoot.innerHTML = `
      <style>.err{padding:16px;border:1px solid var(--error-color,#F44336);border-radius:12px;background:var(--card-background-color)}
      .err-c{display:flex;align-items:center;gap:12px;color:var(--error-color,#F44336)}
      .err-t{font-weight:bold;margin-bottom:4px}.err-m{font-size:12px;opacity:.8}</style>
      <ha-card class="err"><div class="err-c"><span style="font-size:24px">⚠️</span><div><div class="err-t">Fehler</div><div class="err-m">${msg}</div></div></div></ha-card>`;
  }

  // =========================================================================
  // STYLES
  // =========================================================================

  _getMiniStyles() {
    return `
      :host{display:block}
      .mini-card{padding:8px 12px;cursor:pointer;transition:transform .2s,box-shadow .2s;position:relative}
      .mini-card:hover{transform:translateY(-1px);box-shadow:0 4px 8px rgba(0,0,0,.15)}
      .mini-row{display:flex;align-items:center;gap:10px}
      .type-icon{font-size:16px}
      .sym{font-weight:bold;font-size:14px;color:var(--primary-text-color)}
      .price{font-size:14px;color:var(--primary-text-color)}
      .chg{font-size:12px;font-weight:500;margin-left:auto}
      .sig{font-size:14px;margin-left:4px}
      .alert-dot{width:8px;height:8px;border-radius:50%;position:absolute;top:6px;right:6px;animation:pulse 1.5s infinite}
      @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
    `;
  }

  _getCompactStyles() {
    return `
      :host{display:block}
      .compact-card{padding:16px;cursor:pointer}
      .top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px}
      .left{flex:1;min-width:0}
      .sym-row{display:flex;align-items:center;gap:6px}
      .type-icon{font-size:16px}
      .sym{font-weight:bold;font-size:17px;color:var(--primary-text-color)}
      .exch{font-size:10px;color:var(--secondary-text-color);background:var(--secondary-background-color,#f5f5f5);padding:2px 6px;border-radius:4px}
      .name{font-size:12px;color:var(--secondary-text-color);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .sig{font-size:11px;padding:3px 8px;border-radius:5px;font-weight:600;white-space:nowrap}
      .sig-buy,.sig-strong-buy{background:rgba(76,175,80,.12);color:#4CAF50}
      .sig-sell,.sig-strong-sell{background:rgba(244,67,54,.12);color:#F44336}
      .sig-hold{background:rgba(255,152,0,.12);color:#FF9800}
      .sig-n-a{background:var(--secondary-background-color);color:var(--secondary-text-color)}
      .price-row{margin:10px 0}
      .price{font-size:26px;font-weight:bold;color:var(--primary-text-color)}
      .cur{font-size:13px;color:var(--secondary-text-color);margin-left:4px}
      .chg-row{font-size:14px;font-weight:500;margin-top:4px}
      .chart-area{margin:8px 0;border-radius:6px;overflow:hidden;background:var(--secondary-background-color,#f5f5f5)}
      .alert-banner{padding:6px 10px;margin:6px 0;border-radius:6px;font-size:12px;font-weight:500}
      .bottom,.portfolio-row{display:flex;justify-content:space-between;padding-top:10px;border-top:1px solid var(--divider-color,#e0e0e0);margin-top:6px}
      .st{text-align:center;flex:1}
      .sl{display:block;font-size:10px;color:var(--secondary-text-color);text-transform:uppercase;margin-bottom:2px}
      .sv{font-size:13px;font-weight:600}
    `;
  }

  _getFullStyles() {
    const cc = this._config;
    return `
      :host{display:block}
      .full-card{overflow:hidden}
      .full-card.price-flash{animation:flash .6s ease-out}
      @keyframes flash{0%{box-shadow:0 0 20px rgba(3,169,244,.5)}100%{box-shadow:none}}

      /* Header */
      .header{display:flex;justify-content:space-between;align-items:flex-start;padding:16px;cursor:pointer}
      .h-left{display:flex;align-items:center;gap:12px;flex:1;min-width:0}
      .sym-badge{background:var(--primary-color,#03a9f4);color:white;padding:8px 12px;border-radius:8px;font-weight:bold;font-size:13px;flex-shrink:0;white-space:nowrap}
      .c-info{display:flex;flex-direction:column;min-width:0}
      .c-name{font-size:14px;font-weight:500;color:var(--primary-text-color);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .c-exch{font-size:11px;color:var(--secondary-text-color)}
      .trend-badge{padding:4px 10px;border-radius:6px;font-size:11px;font-weight:600;white-space:nowrap}
      .trend-strong_bullish,.trend-bullish{background:${cc.color_positive}20;color:${cc.color_positive}}
      .trend-strong_bearish,.trend-bearish{background:${cc.color_negative}20;color:${cc.color_negative}}
      .trend-neutral{background:rgba(158,158,158,.15);color:var(--secondary-text-color)}

      /* Alerts */
      .alert-banner{padding:8px 12px;margin:0 16px 8px;border-radius:8px;font-size:13px;font-weight:500;animation:pulse-bg 2s infinite}
      @keyframes pulse-bg{0%,100%{opacity:1}50%{opacity:.7}}

      /* Price */
      .price-section{padding:20px 16px;text-align:center}
      .p-main{display:flex;justify-content:center;align-items:baseline;gap:8px}
      .price{font-size:34px;font-weight:bold;color:var(--primary-text-color)}
      .cur{font-size:16px;color:var(--secondary-text-color)}
      .p-change{margin-top:6px;font-size:15px;font-weight:600}

      /* Chart */
      .chart-section{padding:0 16px 12px}
      .chart-section svg{border-radius:6px;background:var(--secondary-background-color,#f5f5f5)}

      /* Section Title */
      .section-title{font-size:12px;font-weight:600;color:var(--secondary-text-color);text-transform:uppercase;margin-bottom:10px;padding:0 16px;letter-spacing:.5px}
      .chart-section .section-title,.range-section .section-title{padding:0}

      /* Stats Grid */
      .stats-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:1px;background:var(--divider-color,#e0e0e0);margin:0 16px 16px;border-radius:8px;overflow:hidden}
      .s-item{display:flex;flex-direction:column;padding:10px 12px;background:var(--card-background-color)}
      .s-label{font-size:10px;color:var(--secondary-text-color);text-transform:uppercase;margin-bottom:3px}
      .s-val{font-size:14px;font-weight:600;color:var(--primary-text-color)}
      .s-val.high{color:${cc.color_positive}}
      .s-val.low{color:${cc.color_negative}}

      /* Data Rows */
      .data-section{padding:0 16px 8px}
      .d-row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--divider-color,#e0e0e0)}
      .d-row:last-child{border-bottom:none}
      .d-lbl{font-size:13px;color:var(--secondary-text-color)}
      .d-val{font-size:13px;font-weight:600;color:var(--primary-text-color);text-align:right}
      .d-val.bold{font-weight:700}
      .d-val small{font-size:11px;font-weight:500}

      /* Portfolio */
      .portfolio-section{border-top:2px solid var(--primary-color,#03a9f4);padding-top:12px;margin-top:4px}

      /* Supply bar */
      .supply-section{padding-top:8px}
      .supply-bar{height:6px;background:var(--divider-color,#e0e0e0);border-radius:3px;margin:4px 16px 12px;overflow:hidden}
      .supply-fill{height:100%;background:var(--primary-color,#03a9f4);border-radius:3px;transition:width .5s}

      /* 52-Week Range */
      .range-section{padding:12px 16px;background:var(--secondary-background-color,#f5f5f5)}
      .range-bar-ct{display:flex;align-items:center;gap:8px}
      .r-lo,.r-hi{font-size:11px;color:var(--secondary-text-color);min-width:55px}
      .r-hi{text-align:right}
      .range-bar{flex:1;height:8px;background:var(--divider-color,#e0e0e0);border-radius:4px;position:relative}
      .range-fill{height:100%;background:linear-gradient(90deg,${cc.color_negative} 0%,${cc.color_neutral} 50%,${cc.color_positive} 100%);border-radius:4px}
      .range-marker{position:absolute;top:50%;width:14px;height:14px;background:var(--primary-color,#03a9f4);border:2px solid white;border-radius:50%;transform:translate(-50%,-50%);box-shadow:0 2px 4px rgba(0,0,0,.3)}

      /* MA */
      .ma-section{padding-top:8px}

      /* Performance */
      .perf-section{padding:12px 16px}
      .perf-grid{display:flex;gap:10px}
      .perf-item{flex:1;text-align:center;padding:10px 6px;background:var(--secondary-background-color,#f5f5f5);border-radius:8px}
      .perf-lbl{display:block;font-size:11px;color:var(--secondary-text-color);margin-bottom:4px}
      .perf-val{font-size:15px;font-weight:bold}

      /* Indicators */
      .ind-section{padding:12px 16px;border-top:1px solid var(--divider-color,#e0e0e0)}
      .ind-grid{display:flex;flex-direction:column;gap:12px}
      .ind-item{display:flex;flex-direction:column;gap:4px}
      .ind-lbl{font-size:12px;color:var(--secondary-text-color)}
      .ind-val-row{display:flex;align-items:center;gap:10px}
      .ind-val{font-size:14px;font-weight:600;color:var(--primary-text-color)}
      .ind-sig{font-size:11px;padding:3px 8px;border-radius:4px;font-weight:500}
      .ind-sig.oversold{background:${cc.color_positive}20;color:${cc.color_positive}}
      .ind-sig.neutral{background:rgba(158,158,158,.15);color:var(--secondary-text-color)}
      .ind-sig.overbought{background:${cc.color_negative}20;color:${cc.color_negative}}
      .ind-sig.macd-bullish{background:${cc.color_positive}20;color:${cc.color_positive}}
      .ind-sig.macd-bearish{background:${cc.color_negative}20;color:${cc.color_negative}}
      .bar{height:6px;background:var(--divider-color,#e0e0e0);border-radius:3px;overflow:hidden}
      .bar-fill{height:100%;border-radius:3px;background:var(--primary-color,#03a9f4);transition:width .5s}

      /* Footer */
      .card-footer{display:flex;justify-content:space-between;align-items:center;padding:10px 16px;background:var(--secondary-background-color,#f5f5f5);border-top:1px solid var(--divider-color,#e0e0e0)}
      .src{font-size:11px;color:var(--disabled-text-color,#9e9e9e)}
      .sig-badge{font-size:12px;font-weight:600;padding:4px 10px;border-radius:6px}
      .sig-badge.sig-buy,.sig-badge.sig-strong-buy{background:${cc.color_positive}20;color:${cc.color_positive}}
      .sig-badge.sig-sell,.sig-badge.sig-strong-sell{background:${cc.color_negative}20;color:${cc.color_negative}}
      .sig-badge.sig-hold{background:${cc.color_neutral}20;color:${cc.color_neutral}}
      .sig-badge.sig-n-a{background:var(--secondary-background-color);color:var(--secondary-text-color)}
    `;
  }

  // =========================================================================
  // INTERACTION
  // =========================================================================

  _handleClick() {
    const ev = new Event('hass-more-info', { bubbles: true, composed: true });
    ev.detail = { entityId: this._config.entity };
    this.dispatchEvent(ev);
  }

  _attachClickHandler() {
    const card = this.shadowRoot.querySelector('ha-card');
    if (card) {
      card.style.cursor = 'pointer';
      card.addEventListener('click', () => this._handleClick());
    }
  }

  static getConfigElement() { return document.createElement('stock-tracker-card-editor'); }
  static getStubConfig() { return { entity: '', display_mode: 'full', show_chart: false, show_indicators: true }; }
}


// =============================================================================
// CARD EDITOR v2.0 – with collapsible sections & many more options
// =============================================================================

class StockTrackerCardEditor extends HTMLElement {
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
    const first = !this._hass;
    this._hass = hass;
    if (first || !this.shadowRoot.querySelector('.editor')) this._render();
  }

  _getStockEntities() {
    if (!this._hass || !this._hass.states) return [];
    const entities = [];
    for (const [id, state] of Object.entries(this._hass.states)) {
      if (!id.startsWith('sensor.')) continue;
      const a = state.attributes || {};
      if (a.symbol !== undefined && (a.change_percent !== undefined || a.previous_close !== undefined || a.data_source !== undefined || a.overall_signal !== undefined || a.company_name !== undefined)) {
        const qt = (a.quote_type || 'EQUITY').toUpperCase();
        const icon = { CRYPTOCURRENCY:'🪙', ETF:'📊', INDEX:'📉', MUTUALFUND:'🏦' }[qt] || '📈';
        const sym = a.symbol || id;
        const name = a.company_name || a.friendly_name || sym;
        const price = state.state;
        const cur = a.currency || 'USD';
        const chg = a.change_percent;
        let label = `${icon} ${sym}`;
        if (name && name !== sym && !name.includes(sym)) label += ` – ${name}`;
        if (price && price !== 'unavailable' && price !== 'unknown') {
          label += ` (${parseFloat(price).toFixed(2)} ${cur}`;
          if (chg != null) label += `, ${parseFloat(chg) >= 0 ? '+' : ''}${parseFloat(chg).toFixed(2)}%`;
          label += ')';
        }
        entities.push({ id, symbol: sym, name, label, type: qt });
      }
    }
    entities.sort((a, b) => {
      const ord = { INDEX:0, EQUITY:1, ETF:2, CRYPTOCURRENCY:3 };
      if (a.type !== b.type) return (ord[a.type] || 99) - (ord[b.type] || 99);
      return a.symbol.localeCompare(b.symbol);
    });
    return entities;
  }

  _render() {
    if (!this._hass) { this.shadowRoot.innerHTML = '<div style="padding:16px;text-align:center;color:var(--secondary-text-color)">Lade...</div>'; return; }

    const entities = this._getStockEntities();
    const c = this._config;

    // Build entity options
    let entityOpts = '<option value="">-- Bitte wählen --</option>';
    let curType = '';
    const typeLabels = { INDEX:'📉 Indizes', EQUITY:'📈 Aktien', ETF:'📊 ETFs', CRYPTOCURRENCY:'🪙 Kryptowährungen' };
    entities.forEach(e => {
      if (e.type !== curType) {
        if (curType) entityOpts += '</optgroup>';
        entityOpts += `<optgroup label="${typeLabels[e.type] || e.type}">`;
        curType = e.type;
      }
      entityOpts += `<option value="${e.id}" ${e.id === c.entity ? 'selected' : ''}>${e.label.replace(/</g,'&lt;')}</option>`;
    });
    if (curType) entityOpts += '</optgroup>';

    const chk = (key, def = true) => (c[key] !== undefined ? c[key] : def) ? 'checked' : '';
    const val = (key, def = '') => c[key] != null ? c[key] : def;

    this.shadowRoot.innerHTML = `
      <style>
        .editor{display:flex;flex-direction:column;gap:12px;padding:16px;font-size:14px}
        .field{display:flex;flex-direction:column;gap:5px}
        .field label{font-weight:500;font-size:13px;color:var(--primary-text-color)}
        .field .hint{font-size:11px;color:var(--secondary-text-color)}
        select,input[type="text"],input[type="number"]{width:100%;padding:9px 11px;border:1px solid var(--divider-color,#e0e0e0);border-radius:8px;background:var(--card-background-color,white);color:var(--primary-text-color);font-size:13px;box-sizing:border-box}
        select:focus,input:focus{outline:none;border-color:var(--primary-color,#03a9f4);box-shadow:0 0 0 2px rgba(3,169,244,.2)}
        optgroup{font-weight:bold}
        details{border:1px solid var(--divider-color,#e0e0e0);border-radius:8px;overflow:hidden}
        summary{padding:10px 14px;font-weight:600;font-size:13px;cursor:pointer;background:var(--secondary-background-color,#f5f5f5);color:var(--primary-text-color);user-select:none;list-style:none;display:flex;align-items:center;gap:8px}
        summary::-webkit-details-marker{display:none}
        summary::before{content:'▶';font-size:10px;transition:transform .2s;display:inline-block}
        details[open] summary::before{transform:rotate(90deg)}
        .group{padding:12px 14px;display:flex;flex-direction:column;gap:10px}
        .chk-row{display:flex;align-items:center;gap:9px;padding:4px 0}
        .chk-row input[type="checkbox"]{width:16px;height:16px;cursor:pointer;flex-shrink:0}
        .chk-row label{font-size:13px;cursor:pointer;user-select:none;color:var(--primary-text-color)}
        .row{display:flex;gap:10px}
        .row .field{flex:1}
        .info{background:rgba(33,150,243,.08);border:1px solid rgba(33,150,243,.25);border-radius:8px;padding:10px 12px;font-size:12px;color:var(--primary-text-color);line-height:1.5}
        .info strong{color:var(--primary-color,#03a9f4)}
        .no-ent{text-align:center;padding:20px;color:var(--secondary-text-color)}
        .no-ent .icon{font-size:32px;margin-bottom:8px}
        .sep{height:1px;background:var(--divider-color,#e0e0e0);margin:4px 0}
      </style>

      <div class="editor">

        ${entities.length === 0 ? `
          <div class="no-ent">
            <div class="icon">📊</div>
            <div>Keine Aktien-Sensoren gefunden.</div>
            <div style="margin-top:8px;font-size:12px">Füge zuerst Assets über Stock Tracker hinzu:<br>Einstellungen → Geräte & Dienste → Stock Tracker</div>
          </div>
        ` : `

        <!-- GRUNDEINSTELLUNGEN -->
        <details open>
          <summary>⚙️ Grundeinstellungen</summary>
          <div class="group">
            <div class="field">
              <label>Asset auswählen</label>
              <select id="entity">${entityOpts}</select>
              <span class="hint">${entities.length} Assets verfügbar</span>
            </div>
            <div class="field">
              <label>Anzeige-Modus</label>
              <select id="display_mode">
                <option value="full" ${val('display_mode','full') === 'full' ? 'selected' : ''}>Vollständig – Alle Details</option>
                <option value="compact" ${val('display_mode') === 'compact' ? 'selected' : ''}>Kompakt – Kurs + Änderung</option>
                <option value="mini" ${val('display_mode') === 'mini' ? 'selected' : ''}>Mini – Nur eine Zeile</option>
              </select>
            </div>
            <div class="field">
              <label>Eigener Name <span class="hint">(optional)</span></label>
              <input type="text" id="name" value="${val('name')}" placeholder="z.B. Mein Bitcoin">
            </div>
          </div>
        </details>

        <!-- SEKTIONEN EIN/AUS -->
        <details>
          <summary>👁️ Sichtbare Bereiche</summary>
          <div class="group">
            <div class="chk-row"><input type="checkbox" id="show_header" ${chk('show_header')}><label for="show_header">Header (Symbol, Name, Trend)</label></div>
            <div class="chk-row"><input type="checkbox" id="show_day_stats" ${chk('show_day_stats')}><label for="show_day_stats">Tagesstatistiken (Eröffnung, Hoch, Tief)</label></div>
            <div class="chk-row"><input type="checkbox" id="show_volume" ${chk('show_volume')}><label for="show_volume">Volumen</label></div>
            <div class="chk-row"><input type="checkbox" id="show_market_cap" ${chk('show_market_cap')}><label for="show_market_cap">Marktkapitalisierung</label></div>
            <div class="chk-row"><input type="checkbox" id="show_fundamentals" ${chk('show_fundamentals')}><label for="show_fundamentals">Fundamentaldaten (KGV, EPS, Dividende)</label></div>
            <div class="chk-row"><input type="checkbox" id="show_52week" ${chk('show_52week')}><label for="show_52week">52-Wochen Spanne</label></div>
            <div class="chk-row"><input type="checkbox" id="show_moving_averages" ${chk('show_moving_averages', false)}><label for="show_moving_averages">Gleitende Durchschnitte (MA 50/200)</label></div>
            <div class="chk-row"><input type="checkbox" id="show_performance" ${chk('show_performance')}><label for="show_performance">Performance (1W, 1M, YTD)</label></div>
            <div class="chk-row"><input type="checkbox" id="show_indicators" ${chk('show_indicators')}><label for="show_indicators">Technische Indikatoren (RSI, MACD)</label></div>
            <div class="chk-row"><input type="checkbox" id="show_signal" ${chk('show_signal')}><label for="show_signal">Signal-Badge (Buy/Sell/Hold)</label></div>
            <div class="chk-row"><input type="checkbox" id="show_supply" ${chk('show_supply', false)}><label for="show_supply">Supply-Info (Krypto)</label></div>
            <div class="chk-row"><input type="checkbox" id="show_footer" ${chk('show_footer')}><label for="show_footer">Footer (Datenquelle)</label></div>
          </div>
        </details>

        <!-- CHART -->
        <details>
          <summary>📈 Chart-Einstellungen</summary>
          <div class="group">
            <div class="chk-row"><input type="checkbox" id="show_chart" ${chk('show_chart', false)}><label for="show_chart">Sparkline-Chart anzeigen</label></div>
            <div class="row">
              <div class="field">
                <label>Zeitraum (Stunden)</label>
                <select id="chart_hours">
                  <option value="6" ${val('chart_hours',24) == 6 ? 'selected' : ''}>6h</option>
                  <option value="12" ${val('chart_hours',24) == 12 ? 'selected' : ''}>12h</option>
                  <option value="24" ${val('chart_hours',24) == 24 ? 'selected' : ''}>24h</option>
                  <option value="48" ${val('chart_hours',24) == 48 ? 'selected' : ''}>48h</option>
                  <option value="72" ${val('chart_hours',24) == 72 ? 'selected' : ''}>72h</option>
                  <option value="168" ${val('chart_hours',24) == 168 ? 'selected' : ''}>1 Woche</option>
                </select>
              </div>
              <div class="field">
                <label>Höhe (px)</label>
                <input type="number" id="chart_height" value="${val('chart_height', 80)}" min="40" max="200" step="10">
              </div>
            </div>
            <div class="field">
              <label>Chart-Farbe</label>
              <select id="chart_color">
                <option value="auto" ${val('chart_color','auto') === 'auto' ? 'selected' : ''}>Automatisch (Grün/Rot)</option>
                <option value="#03a9f4" ${val('chart_color') === '#03a9f4' ? 'selected' : ''}>Blau</option>
                <option value="#9C27B0" ${val('chart_color') === '#9C27B0' ? 'selected' : ''}>Lila</option>
                <option value="#FF9800" ${val('chart_color') === '#FF9800' ? 'selected' : ''}>Orange</option>
                <option value="#607D8B" ${val('chart_color') === '#607D8B' ? 'selected' : ''}>Grau</option>
              </select>
            </div>
            <div class="chk-row"><input type="checkbox" id="chart_fill" ${chk('chart_fill')}><label for="chart_fill">Fläche unter dem Chart füllen</label></div>
          </div>
        </details>

        <!-- PORTFOLIO -->
        <details>
          <summary>💼 Portfolio-Tracking</summary>
          <div class="group">
            <div class="info">
              Gib deine Stückzahl und optional den Kaufpreis ein, um den aktuellen Wert und Gewinn/Verlust zu sehen.
            </div>
            <div class="row">
              <div class="field">
                <label>Stückzahl / Coins</label>
                <input type="number" id="holdings" value="${val('holdings', '')}" min="0" step="any" placeholder="z.B. 1000">
              </div>
              <div class="field">
                <label>Kaufpreis pro Stück</label>
                <input type="number" id="purchase_price" value="${val('purchase_price', '')}" min="0" step="any" placeholder="z.B. 0.05">
              </div>
            </div>
          </div>
        </details>

        <!-- PREIS-ALARME -->
        <details>
          <summary>🔔 Preis-Alarme</summary>
          <div class="group">
            <div class="info">
              Setze Schwellwerte für visuelle Alarme direkt auf der Karte. (Keine Push-Benachrichtigung – nur visuell.)
            </div>
            <div class="row">
              <div class="field">
                <label>Alarm: Preis über</label>
                <input type="number" id="price_alert_high" value="${val('price_alert_high', '')}" min="0" step="any" placeholder="z.B. 0.10">
              </div>
              <div class="field">
                <label>Alarm: Preis unter</label>
                <input type="number" id="price_alert_low" value="${val('price_alert_low', '')}" min="0" step="any" placeholder="z.B. 0.02">
              </div>
            </div>
          </div>
        </details>

        <!-- FORMAT & STYLE -->
        <details>
          <summary>🎨 Format & Darstellung</summary>
          <div class="group">
            <div class="field">
              <label>Dezimalstellen</label>
              <select id="decimal_places">
                <option value="auto" ${val('decimal_places','auto') === 'auto' ? 'selected' : ''}>Automatisch (optimal für Krypto)</option>
                <option value="0" ${val('decimal_places') === 0 || val('decimal_places') === '0' ? 'selected' : ''}>0</option>
                <option value="2" ${val('decimal_places') === 2 || val('decimal_places') === '2' ? 'selected' : ''}>2</option>
                <option value="4" ${val('decimal_places') === 4 || val('decimal_places') === '4' ? 'selected' : ''}>4</option>
                <option value="6" ${val('decimal_places') === 6 || val('decimal_places') === '6' ? 'selected' : ''}>6</option>
                <option value="8" ${val('decimal_places') === 8 || val('decimal_places') === '8' ? 'selected' : ''}>8</option>
              </select>
              <span class="hint">Automatisch passt Dezimalstellen an den Preis an (nützlich bei Krypto mit kleinen Preisen)</span>
            </div>
            <div class="row">
              <div class="field">
                <label>Farbe Positiv</label>
                <input type="text" id="color_positive" value="${val('color_positive','#4CAF50')}" placeholder="#4CAF50">
              </div>
              <div class="field">
                <label>Farbe Negativ</label>
                <input type="text" id="color_negative" value="${val('color_negative','#F44336')}" placeholder="#F44336">
              </div>
            </div>
            <div class="chk-row"><input type="checkbox" id="update_animation" ${chk('update_animation')}><label for="update_animation">Animation bei Preis-Updates</label></div>
          </div>
        </details>

        `}

        <div class="info">
          💡 <strong>Tipps:</strong><br><br>
          • Weitere Assets: Einstellungen → Geräte & Dienste → Stock Tracker → <strong>Konfigurieren</strong><br>
          • Marktkapitalisierung wird automatisch berechnet wenn Supply-Daten vorhanden<br>
          • Im <strong>Mini</strong>-Modus lassen sich viele Karten nebeneinander platzieren
        </div>
      </div>
    `;

    this._attachEventListeners();
  }

  _attachEventListeners() {
    // All selects and checkboxes
    this.shadowRoot.querySelectorAll('select, input[type="checkbox"]').forEach(el => {
      el.addEventListener('change', e => this._valueChanged(e));
    });

    // Text and number inputs with debounce
    this.shadowRoot.querySelectorAll('input[type="text"], input[type="number"]').forEach(el => {
      let t;
      el.addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => this._valueChanged(e), 500); });
      el.addEventListener('blur', e => { clearTimeout(t); this._valueChanged(e); });
    });
  }

  _valueChanged(e) {
    if (!this._config) return;
    const t = e.target;
    const id = t.id;
    let value;

    if (t.type === 'checkbox') {
      value = t.checked;
    } else if (t.type === 'number') {
      value = t.value === '' ? undefined : parseFloat(t.value);
    } else {
      value = t.value;
    }

    const nc = { ...this._config };

    // Remove keys if empty/undefined
    if (value === '' || value === undefined) {
      delete nc[id];
    } else {
      nc[id] = value;
    }

    this._config = nc;

    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: nc },
      bubbles: true, composed: true,
    }));
  }
}


// =============================================================================
// REGISTER
// =============================================================================

if (!customElements.get('stock-tracker-card')) {
  customElements.define('stock-tracker-card', StockTrackerCard);
  console.info(
    '%c 📊 STOCK-TRACKER-CARD %c v2.0.0 ',
    'color:white;background:#1976d2;font-weight:bold;padding:2px 6px;border-radius:3px 0 0 3px',
    'color:#1976d2;background:white;font-weight:bold;padding:2px 6px;border-radius:0 3px 3px 0;border:1px solid #1976d2'
  );
}

if (!customElements.get('stock-tracker-card-editor')) {
  customElements.define('stock-tracker-card-editor', StockTrackerCardEditor);
}

window.customCards = window.customCards || [];
if (!window.customCards.find(c => c.type === 'stock-tracker-card')) {
  window.customCards.push({
    type: 'stock-tracker-card',
    name: 'Stock Tracker Card',
    description: 'Aktien, Krypto, ETFs & Indizes mit Portfolio-Tracking, Charts, Alarmen und technischen Indikatoren',
    preview: true,
    documentationURL: 'https://github.com/richieam93/ha-stock-tracker',
  });
}