/**
 * Stock Tracker Card for Home Assistant
 * Version 2.0 - Erweiterte Konfiguration
 */

class StockTrackerCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
    this._hass = null;
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error('Bitte eine Entity auswählen');
    }
    
    // Erweiterte Konfiguration mit allen Optionen
    this._config = {
      // Pflicht
      entity: config.entity,
      
      // Anzeige-Modus
      display_mode: config.display_mode || 'full',
      
      // Haupt-Optionen
      name: config.name || null,
      show_header: config.show_header !== false,
      show_price: config.show_price !== false,
      show_change: config.show_change !== false,
      show_trend: config.show_trend !== false,
      
      // Detail-Optionen
      show_day_range: config.show_day_range !== false,
      show_52_week_range: config.show_52_week_range !== false,
      show_volume: config.show_volume !== false,
      show_market_cap: config.show_market_cap ?? true,
      show_pe_ratio: config.show_pe_ratio ?? true,
      show_dividend: config.show_dividend ?? true,
      
      // Performance
      show_performance: config.show_performance !== false,
      
      // Technische Analyse
      show_indicators: config.show_indicators ?? true,
      show_signal: config.show_signal !== false,
      
      // Footer
      show_footer: config.show_footer !== false,
      show_source: config.show_source ?? true,
      show_last_update: config.show_last_update ?? false,
      
      // Styling
      compact_numbers: config.compact_numbers ?? true,
      color_positive: config.color_positive || '#4CAF50',
      color_negative: config.color_negative || '#F44336',
      color_neutral: config.color_neutral || '#9E9E9E',
      
      // Verstecke N/A Werte
      hide_unavailable: config.hide_unavailable ?? true,
      
      ...config
    };

    this._render();
  }

  getCardSize() {
    switch (this._config.display_mode) {
      case 'mini': return 1;
      case 'compact': return 2;
      default: return 4;
    }
  }

  _render() {
    if (!this._hass || !this._config.entity) return;

    const entity = this._hass.states[this._config.entity];
    if (!entity) {
      this._renderError(`Entity nicht gefunden: ${this._config.entity}`);
      return;
    }

    const data = this._extractData(entity);
    
    switch (this._config.display_mode) {
      case 'mini':
        this._renderMini(data);
        break;
      case 'compact':
        this._renderCompact(data);
        break;
      default:
        this._renderFull(data);
    }
  }

  _extractData(entity) {
    const attrs = entity.attributes || {};
    const price = parseFloat(entity.state) || 0;
    const change = parseFloat(attrs.change) || 0;
    const changePercent = parseFloat(attrs.change_percent) || 0;
    
    return {
      // Basis
      symbol: attrs.symbol || this._extractSymbol(this._config.entity),
      name: this._config.name || attrs.company_name || attrs.friendly_name || attrs.symbol || 'Unbekannt',
      price: price,
      currency: attrs.currency || 'USD',
      exchange: attrs.exchange || '',
      quoteType: attrs.quote_type || 'EQUITY',
      
      // Änderung
      change: change,
      changePercent: changePercent,
      isPositive: changePercent >= 0,
      
      // Tageswerte
      previousClose: attrs.previous_close,
      open: attrs.today_open,
      high: attrs.today_high,
      low: attrs.today_low,
      
      // Volumen & Markt
      volume: attrs.volume,
      avgVolume: attrs.avg_volume,
      marketCap: attrs.market_cap,
      
      // Fundamentaldaten
      peRatio: attrs.pe_ratio,
      eps: attrs.eps,
      dividendYield: attrs.dividend_yield,
      dividendRate: attrs.dividend_rate,
      
      // 52-Wochen
      week52High: attrs['52_week_high'],
      week52Low: attrs['52_week_low'],
      
      // Performance
      weekChange: attrs.week_change_percent,
      monthChange: attrs.month_change_percent,
      ytdChange: attrs.ytd_change_percent,
      
      // Technische Analyse
      signal: attrs.overall_signal || 'N/A',
      rsi: attrs.rsi_14,
      macdTrend: attrs.macd_trend,
      trendDirection: attrs.trend_direction || 'neutral',
      trendStrength: attrs.trend_strength,
      
      // Meta
      dataSource: attrs.data_source || '',
      dataQuality: attrs.data_quality || '',
      lastUpdated: entity.last_updated,
      
      // Für Checks
      hasMarketCap: attrs.market_cap !== undefined && attrs.market_cap !== null,
      hasPeRatio: attrs.pe_ratio !== undefined && attrs.pe_ratio !== null,
      hasDividend: attrs.dividend_yield !== undefined && attrs.dividend_yield !== null,
      hasVolume: attrs.volume !== undefined && attrs.volume !== null,
      has52Week: attrs['52_week_high'] !== undefined && attrs['52_week_low'] !== undefined,
      hasPerformance: attrs.week_change_percent !== undefined || attrs.month_change_percent !== undefined,
      hasIndicators: attrs.rsi_14 !== undefined || attrs.macd_trend !== undefined,
    };
  }

  _extractSymbol(entityId) {
    const match = entityId.match(/sensor\.(.+?)(?:_price|_change|_trend|_volume|_indicators)?$/);
    return match ? match[1].toUpperCase().replace(/_/g, '.') : entityId;
  }

  // =========================================================================
  // MINI MODE
  // =========================================================================

  _renderMini(data) {
    const color = data.isPositive ? this._config.color_positive : this._config.color_negative;
    const arrow = data.isPositive ? '▲' : '▼';
    const typeIcon = this._getTypeIcon(data.quoteType);

    this.shadowRoot.innerHTML = `
      <style>${this._getBaseStyles()}</style>
      <ha-card class="mini-card">
        <div class="mini-content">
          <span class="mini-icon">${typeIcon}</span>
          <span class="mini-symbol">${data.symbol}</span>
          <span class="mini-price">${this._formatPrice(data.price, data.currency)}</span>
          <span class="mini-change" style="color: ${color}">
            ${arrow} ${Math.abs(data.changePercent).toFixed(2)}%
          </span>
        </div>
      </ha-card>
      <style>
        .mini-card {
          padding: 8px 12px;
          cursor: pointer;
        }
        .mini-content {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .mini-icon {
          font-size: 14px;
        }
        .mini-symbol {
          font-weight: bold;
          font-size: 14px;
        }
        .mini-price {
          font-size: 14px;
          margin-left: auto;
        }
        .mini-change {
          font-size: 12px;
          font-weight: 600;
          min-width: 70px;
          text-align: right;
        }
      </style>
    `;
    this._attachClickHandler();
  }

  // =========================================================================
  // COMPACT MODE
  // =========================================================================

  _renderCompact(data) {
    const color = data.isPositive ? this._config.color_positive : this._config.color_negative;
    const arrow = data.isPositive ? '▲' : '▼';
    const typeIcon = this._getTypeIcon(data.quoteType);
    const trendIcon = this._getTrendIcon(data.trendDirection);

    this.shadowRoot.innerHTML = `
      <style>${this._getBaseStyles()}</style>
      <ha-card class="compact-card">
        ${this._config.show_header ? `
        <div class="compact-header">
          <div class="compact-title">
            <span class="type-icon">${typeIcon}</span>
            <span class="symbol">${data.symbol}</span>
            ${data.exchange ? `<span class="exchange">${data.exchange}</span>` : ''}
          </div>
          <div class="name">${data.name}</div>
        </div>
        ` : ''}
        
        ${this._config.show_price ? `
        <div class="compact-price">
          <div class="price-main">
            <span class="price">${this._formatPrice(data.price, data.currency)}</span>
          </div>
          ${this._config.show_change ? `
          <div class="change-row" style="color: ${color}">
            <span class="change-abs">${data.isPositive ? '+' : ''}${data.change.toFixed(2)}</span>
            <span class="change-pct">(${arrow} ${Math.abs(data.changePercent).toFixed(2)}%)</span>
          </div>
          ` : ''}
        </div>
        ` : ''}

        <div class="compact-footer">
          ${this._config.show_trend ? `
          <div class="stat">
            <span class="stat-label">Trend</span>
            <span class="stat-value">${trendIcon}</span>
          </div>
          ` : ''}
          ${this._config.show_volume && data.hasVolume ? `
          <div class="stat">
            <span class="stat-label">Vol</span>
            <span class="stat-value">${this._formatVolume(data.volume)}</span>
          </div>
          ` : ''}
          ${this._config.show_signal ? `
          <div class="stat">
            <span class="stat-label">Signal</span>
            <span class="stat-value signal-${data.signal.toLowerCase().replace('_', '-')}">${data.signal}</span>
          </div>
          ` : ''}
        </div>
      </ha-card>
      <style>
        .compact-card {
          padding: 16px;
          cursor: pointer;
        }
        .compact-header {
          margin-bottom: 12px;
        }
        .compact-title {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .type-icon {
          font-size: 16px;
        }
        .symbol {
          font-weight: bold;
          font-size: 18px;
        }
        .exchange {
          font-size: 11px;
          color: var(--secondary-text-color);
          background: var(--secondary-background-color);
          padding: 2px 6px;
          border-radius: 4px;
        }
        .name {
          font-size: 13px;
          color: var(--secondary-text-color);
          margin-top: 4px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .compact-price {
          margin: 12px 0;
        }
        .price-main {
          display: flex;
          align-items: baseline;
          gap: 6px;
        }
        .price {
          font-size: 28px;
          font-weight: bold;
        }
        .change-row {
          display: flex;
          gap: 8px;
          margin-top: 4px;
          font-weight: 600;
        }
        .compact-footer {
          display: flex;
          justify-content: space-between;
          padding-top: 12px;
          border-top: 1px solid var(--divider-color);
        }
        .stat {
          text-align: center;
          flex: 1;
        }
        .stat-label {
          display: block;
          font-size: 10px;
          color: var(--secondary-text-color);
          text-transform: uppercase;
          margin-bottom: 2px;
        }
        .stat-value {
          font-size: 13px;
          font-weight: 600;
        }
        .signal-buy, .signal-strong-buy { color: ${this._config.color_positive}; }
        .signal-sell, .signal-strong-sell { color: ${this._config.color_negative}; }
        .signal-hold { color: #FF9800; }
      </style>
    `;
    this._attachClickHandler();
  }

  // =========================================================================
  // FULL MODE
  // =========================================================================

  _renderFull(data) {
    const color = data.isPositive ? this._config.color_positive : this._config.color_negative;
    const bgColor = data.isPositive ? `${this._config.color_positive}15` : `${this._config.color_negative}15`;
    const arrow = data.isPositive ? '▲' : '▼';
    const typeIcon = this._getTypeIcon(data.quoteType);
    const trendIcon = this._getTrendIcon(data.trendDirection);

    this.shadowRoot.innerHTML = `
      <style>${this._getBaseStyles()}</style>
      <ha-card class="full-card">
        
        <!-- HEADER -->
        ${this._config.show_header ? `
        <div class="header">
          <div class="header-left">
            <div class="symbol-badge">${typeIcon} ${data.symbol}</div>
            <div class="company-info">
              <span class="company-name">${data.name}</span>
              <span class="exchange-info">${data.exchange}${data.quoteType !== 'EQUITY' ? ' • ' + this._getTypeLabel(data.quoteType) : ''}</span>
            </div>
          </div>
          ${this._config.show_trend ? `
          <div class="trend-badge trend-${data.trendDirection}">
            ${trendIcon} ${this._formatTrend(data.trendDirection)}
          </div>
          ` : ''}
        </div>
        ` : ''}

        <!-- PRICE SECTION -->
        ${this._config.show_price ? `
        <div class="price-section" style="background: ${bgColor}">
          <div class="price-main">
            <span class="price">${this._formatPrice(data.price, data.currency)}</span>
            <span class="currency">${data.currency}</span>
          </div>
          ${this._config.show_change ? `
          <div class="price-change" style="color: ${color}">
            <span class="change-value">${data.isPositive ? '+' : ''}${data.change.toFixed(2)}</span>
            <span class="change-percent">(${arrow} ${Math.abs(data.changePercent).toFixed(2)}%)</span>
          </div>
          ` : ''}
        </div>
        ` : ''}

        <!-- DAY STATS -->
        ${this._config.show_day_range ? `
        <div class="stats-grid">
          <div class="stat-item">
            <span class="stat-label">Eröffnung</span>
            <span class="stat-value">${this._formatValue(data.open, data.currency)}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Vortag</span>
            <span class="stat-value">${this._formatValue(data.previousClose, data.currency)}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Tageshoch</span>
            <span class="stat-value high">${this._formatValue(data.high, data.currency)}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Tagestief</span>
            <span class="stat-value low">${this._formatValue(data.low, data.currency)}</span>
          </div>
        </div>
        ` : ''}

        <!-- DATA SECTION -->
        <div class="data-section">
          ${this._config.show_volume && data.hasVolume ? `
          <div class="data-row">
            <span class="data-label">📊 Volumen</span>
            <span class="data-value">${this._formatVolume(data.volume)}</span>
          </div>
          ` : ''}
          
          ${this._config.show_market_cap && data.hasMarketCap ? `
          <div class="data-row">
            <span class="data-label">🏛️ Marktkapitalisierung</span>
            <span class="data-value">${this._formatLargeNumber(data.marketCap)}</span>
          </div>
          ` : ''}
          
          ${this._config.show_pe_ratio && data.hasPeRatio ? `
          <div class="data-row">
            <span class="data-label">📈 KGV (P/E)</span>
            <span class="data-value">${parseFloat(data.peRatio).toFixed(2)}</span>
          </div>
          ` : ''}
          
          ${this._config.show_dividend && data.hasDividend ? `
          <div class="data-row">
            <span class="data-label">💰 Dividendenrendite</span>
            <span class="data-value">${parseFloat(data.dividendYield).toFixed(2)}%</span>
          </div>
          ` : ''}
        </div>

        <!-- 52 WEEK RANGE -->
        ${this._config.show_52_week_range && data.has52Week ? this._render52WeekRange(data) : ''}

        <!-- PERFORMANCE -->
        ${this._config.show_performance && data.hasPerformance ? this._renderPerformance(data) : ''}

        <!-- INDICATORS -->
        ${this._config.show_indicators && data.hasIndicators ? this._renderIndicators(data) : ''}

        <!-- FOOTER -->
        ${this._config.show_footer ? `
        <div class="card-footer">
          ${this._config.show_source && data.dataSource ? `
          <span class="data-source">📡 ${data.dataSource}</span>
          ` : '<span></span>'}
          ${this._config.show_signal ? `
          <span class="signal-badge signal-${data.signal.toLowerCase().replace('_', '-')}">
            ${this._getSignalIcon(data.signal)} ${data.signal}
          </span>
          ` : ''}
        </div>
        ` : ''}
      </ha-card>
      ${this._getFullStyles()}
    `;
    this._attachClickHandler();
  }

  _render52WeekRange(data) {
    const low = parseFloat(data.week52Low);
    const high = parseFloat(data.week52High);
    const current = data.price;
    const range = high - low;
    const position = range > 0 ? ((current - low) / range) * 100 : 50;

    return `
      <div class="range-section">
        <div class="range-title">52-Wochen Spanne</div>
        <div class="range-bar-container">
          <span class="range-low">${this._formatPrice(low, data.currency)}</span>
          <div class="range-bar">
            <div class="range-fill" style="width: ${position}%"></div>
            <div class="range-marker" style="left: ${position}%"></div>
          </div>
          <span class="range-high">${this._formatPrice(high, data.currency)}</span>
        </div>
      </div>
    `;
  }

  _renderPerformance(data) {
    const periods = [
      { label: '1W', value: data.weekChange },
      { label: '1M', value: data.monthChange },
      { label: 'YTD', value: data.ytdChange }
    ].filter(p => p.value !== undefined && p.value !== null);

    if (periods.length === 0) return '';

    return `
      <div class="performance-section">
        <div class="section-title">Performance</div>
        <div class="performance-grid">
          ${periods.map(p => {
            const isPositive = parseFloat(p.value) >= 0;
            const color = isPositive ? this._config.color_positive : this._config.color_negative;
            return `
              <div class="perf-item">
                <span class="perf-label">${p.label}</span>
                <span class="perf-value" style="color: ${color}">
                  ${isPositive ? '+' : ''}${parseFloat(p.value).toFixed(2)}%
                </span>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  _renderIndicators(data) {
    return `
      <div class="indicators-section">
        <div class="section-title">📊 Technische Indikatoren</div>
        <div class="indicators-grid">
          ${data.rsi !== undefined ? `
          <div class="indicator-item">
            <span class="indicator-label">RSI (14)</span>
            <div class="indicator-row">
              <span class="indicator-value">${parseFloat(data.rsi).toFixed(1)}</span>
              <span class="indicator-signal ${this._getRsiClass(data.rsi)}">
                ${this._getRsiLabel(data.rsi)}
              </span>
            </div>
            <div class="rsi-bar">
              <div class="rsi-fill" style="width: ${Math.min(100, data.rsi)}%"></div>
            </div>
          </div>
          ` : ''}
          
          ${data.macdTrend ? `
          <div class="indicator-item">
            <span class="indicator-label">MACD</span>
            <span class="indicator-signal macd-${data.macdTrend}">
              ${data.macdTrend === 'bullish' ? '📈 Bullisch' : '📉 Bärisch'}
            </span>
          </div>
          ` : ''}
          
          ${data.trendStrength !== undefined ? `
          <div class="indicator-item">
            <span class="indicator-label">Trend-Stärke</span>
            <div class="indicator-row">
              <div class="strength-bar">
                <div class="strength-fill" style="width: ${parseFloat(data.trendStrength) * 10}%"></div>
              </div>
              <span class="indicator-value">${parseFloat(data.trendStrength).toFixed(1)}/10</span>
            </div>
          </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  _renderError(message) {
    this.shadowRoot.innerHTML = `
      <ha-card style="padding: 16px; border: 1px solid var(--error-color);">
        <div style="display: flex; align-items: center; gap: 12px; color: var(--error-color);">
          <span style="font-size: 24px;">⚠️</span>
          <div>
            <div style="font-weight: bold;">Fehler</div>
            <div style="font-size: 12px; opacity: 0.8;">${message}</div>
          </div>
        </div>
      </ha-card>
    `;
  }

  // =========================================================================
  // STYLES
  // =========================================================================

  _getBaseStyles() {
    return `
      :host {
        display: block;
      }
      ha-card {
        overflow: hidden;
      }
    `;
  }

  _getFullStyles() {
    return `
      <style>
        .full-card {
          cursor: pointer;
        }
        
        /* Header */
        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          padding: 16px;
        }
        .header-left {
          display: flex;
          align-items: center;
          gap: 12px;
          flex: 1;
          min-width: 0;
        }
        .symbol-badge {
          background: var(--primary-color);
          color: white;
          padding: 8px 12px;
          border-radius: 8px;
          font-weight: bold;
          font-size: 14px;
          white-space: nowrap;
        }
        .company-info {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .company-name {
          font-size: 15px;
          font-weight: 500;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .exchange-info {
          font-size: 12px;
          color: var(--secondary-text-color);
        }
        .trend-badge {
          padding: 4px 10px;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 600;
          white-space: nowrap;
        }
        .trend-strong_bullish, .trend-bullish {
          background: ${this._config.color_positive}20;
          color: ${this._config.color_positive};
        }
        .trend-strong_bearish, .trend-bearish {
          background: ${this._config.color_negative}20;
          color: ${this._config.color_negative};
        }
        .trend-neutral {
          background: ${this._config.color_neutral}20;
          color: ${this._config.color_neutral};
        }

        /* Price */
        .price-section {
          padding: 20px 16px;
          text-align: center;
        }
        .price-main {
          display: flex;
          justify-content: center;
          align-items: baseline;
          gap: 8px;
        }
        .price {
          font-size: 36px;
          font-weight: bold;
        }
        .currency {
          font-size: 18px;
          color: var(--secondary-text-color);
        }
        .price-change {
          margin-top: 8px;
          font-size: 16px;
          font-weight: 600;
        }

        /* Stats Grid */
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 1px;
          background: var(--divider-color);
          margin: 0 16px 16px;
          border-radius: 8px;
          overflow: hidden;
        }
        .stat-item {
          display: flex;
          flex-direction: column;
          padding: 12px;
          background: var(--card-background-color);
        }
        .stat-label {
          font-size: 11px;
          color: var(--secondary-text-color);
          text-transform: uppercase;
          margin-bottom: 4px;
        }
        .stat-value {
          font-size: 15px;
          font-weight: 600;
        }
        .stat-value.high { color: ${this._config.color_positive}; }
        .stat-value.low { color: ${this._config.color_negative}; }

        /* Data Section */
        .data-section {
          padding: 0 16px;
        }
        .data-row {
          display: flex;
          justify-content: space-between;
          padding: 10px 0;
          border-bottom: 1px solid var(--divider-color);
        }
        .data-row:last-child {
          border-bottom: none;
        }
        .data-label {
          font-size: 13px;
          color: var(--secondary-text-color);
        }
        .data-value {
          font-size: 13px;
          font-weight: 600;
        }

        /* 52 Week Range */
        .range-section {
          padding: 16px;
          background: var(--secondary-background-color);
        }
        .range-title, .section-title {
          font-size: 12px;
          font-weight: 600;
          color: var(--secondary-text-color);
          text-transform: uppercase;
          margin-bottom: 12px;
        }
        .range-bar-container {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .range-low, .range-high {
          font-size: 11px;
          color: var(--secondary-text-color);
          min-width: 55px;
        }
        .range-high { text-align: right; }
        .range-bar {
          flex: 1;
          height: 8px;
          background: var(--divider-color);
          border-radius: 4px;
          position: relative;
        }
        .range-fill {
          height: 100%;
          background: linear-gradient(90deg, ${this._config.color_negative}, #FF9800, ${this._config.color_positive});
          border-radius: 4px;
        }
        .range-marker {
          position: absolute;
          top: 50%;
          width: 14px;
          height: 14px;
          background: var(--primary-color);
          border: 2px solid white;
          border-radius: 50%;
          transform: translate(-50%, -50%);
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }

        /* Performance */
        .performance-section {
          padding: 16px;
        }
        .performance-grid {
          display: flex;
          gap: 12px;
        }
        .perf-item {
          flex: 1;
          text-align: center;
          padding: 10px;
          background: var(--secondary-background-color);
          border-radius: 8px;
        }
        .perf-label {
          display: block;
          font-size: 11px;
          color: var(--secondary-text-color);
          margin-bottom: 4px;
        }
        .perf-value {
          font-size: 16px;
          font-weight: bold;
        }

        /* Indicators */
        .indicators-section {
          padding: 16px;
          border-top: 1px solid var(--divider-color);
        }
        .indicators-grid {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .indicator-item {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .indicator-label {
          font-size: 12px;
          color: var(--secondary-text-color);
        }
        .indicator-row {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .indicator-value {
          font-size: 14px;
          font-weight: 600;
        }
        .indicator-signal {
          font-size: 11px;
          padding: 3px 8px;
          border-radius: 4px;
          font-weight: 500;
        }
        .indicator-signal.oversold {
          background: ${this._config.color_positive}20;
          color: ${this._config.color_positive};
        }
        .indicator-signal.neutral {
          background: ${this._config.color_neutral}20;
          color: ${this._config.color_neutral};
        }
        .indicator-signal.overbought {
          background: ${this._config.color_negative}20;
          color: ${this._config.color_negative};
        }
        .indicator-signal.macd-bullish {
          background: ${this._config.color_positive}20;
          color: ${this._config.color_positive};
        }
        .indicator-signal.macd-bearish {
          background: ${this._config.color_negative}20;
          color: ${this._config.color_negative};
        }
        .rsi-bar, .strength-bar {
          flex: 1;
          height: 6px;
          background: var(--divider-color);
          border-radius: 3px;
          overflow: hidden;
        }
        .rsi-fill, .strength-fill {
          height: 100%;
          background: var(--primary-color);
          border-radius: 3px;
        }

        /* Footer */
        .card-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          background: var(--secondary-background-color);
          border-top: 1px solid var(--divider-color);
        }
        .data-source {
          font-size: 11px;
          color: var(--disabled-text-color);
        }
        .signal-badge {
          font-size: 12px;
          font-weight: 600;
          padding: 4px 10px;
          border-radius: 6px;
        }
        .signal-badge.signal-buy, .signal-badge.signal-strong-buy {
          background: ${this._config.color_positive}20;
          color: ${this._config.color_positive};
        }
        .signal-badge.signal-sell, .signal-badge.signal-strong-sell {
          background: ${this._config.color_negative}20;
          color: ${this._config.color_negative};
        }
        .signal-badge.signal-hold {
          background: #FF980020;
          color: #FF9800;
        }
        .signal-badge.signal-n-a {
          background: var(--secondary-background-color);
          color: var(--secondary-text-color);
        }
      </style>
    `;
  }

  // =========================================================================
  // HELPERS
  // =========================================================================

  _formatPrice(value, currency) {
    if (value === null || value === undefined || isNaN(value)) return 'N/A';
    const symbols = { 'USD': '$', 'EUR': '€', 'GBP': '£', 'JPY': '¥', 'CHF': 'CHF ' };
    const symbol = symbols[currency] || currency + ' ';
    return symbol + parseFloat(value).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  _formatValue(value, currency) {
    if (value === null || value === undefined) return 'N/A';
    return this._formatPrice(value, currency);
  }

  _formatVolume(value) {
    if (!value) return 'N/A';
    value = parseFloat(value);
    if (value >= 1e9) return (value / 1e9).toFixed(2) + ' Mrd';
    if (value >= 1e6) return (value / 1e6).toFixed(2) + ' Mio';
    if (value >= 1e3) return (value / 1e3).toFixed(1) + 'K';
    return value.toLocaleString('de-DE');
  }

  _formatLargeNumber(value) {
    if (!value) return 'N/A';
    value = parseFloat(value);
    if (value >= 1e12) return (value / 1e12).toFixed(2) + ' Bio';
    if (value >= 1e9) return (value / 1e9).toFixed(2) + ' Mrd';
    if (value >= 1e6) return (value / 1e6).toFixed(2) + ' Mio';
    return value.toLocaleString('de-DE');
  }

  _getTypeIcon(type) {
    const icons = {
      'CRYPTOCURRENCY': '🪙',
      'ETF': '📊',
      'INDEX': '📉',
      'EQUITY': '📈',
      'MUTUALFUND': '🏦',
    };
    return icons[type] || '📈';
  }

  _getTypeLabel(type) {
    const labels = {
      'CRYPTOCURRENCY': 'Krypto',
      'ETF': 'ETF',
      'INDEX': 'Index',
      'EQUITY': 'Aktie',
      'MUTUALFUND': 'Fonds',
    };
    return labels[type] || type;
  }

  _getTrendIcon(trend) {
    const icons = {
      'strong_bullish': '🚀',
      'bullish': '📈',
      'neutral': '➡️',
      'bearish': '📉',
      'strong_bearish': '🔻',
    };
    return icons[trend] || '❓';
  }

  _formatTrend(trend) {
    const labels = {
      'strong_bullish': 'Stark ↑',
      'bullish': 'Steigend',
      'neutral': 'Seitwärts',
      'bearish': 'Fallend',
      'strong_bearish': 'Stark ↓',
    };
    return labels[trend] || trend;
  }

  _getSignalIcon(signal) {
    const icons = { 'STRONG_BUY': '🟢', 'BUY': '🟩', 'HOLD': '🟨', 'SELL': '🟧', 'STRONG_SELL': '🔴' };
    return icons[signal] || '⚪';
  }

  _getRsiClass(rsi) {
    if (rsi < 30) return 'oversold';
    if (rsi > 70) return 'overbought';
    return 'neutral';
  }

  _getRsiLabel(rsi) {
    if (rsi < 30) return 'Überverkauft';
    if (rsi > 70) return 'Überkauft';
    return 'Neutral';
  }

  _handleClick() {
    const event = new Event('hass-more-info', { bubbles: true, composed: true });
    event.detail = { entityId: this._config.entity };
    this.dispatchEvent(event);
  }

  _attachClickHandler() {
    const card = this.shadowRoot.querySelector('ha-card');
    if (card) {
      card.addEventListener('click', () => this._handleClick());
    }
  }

  static getConfigElement() {
    return document.createElement('stock-tracker-card-editor');
  }

  static getStubConfig() {
    return {
      entity: '',
      display_mode: 'compact',
      show_indicators: true,
    };
  }
}