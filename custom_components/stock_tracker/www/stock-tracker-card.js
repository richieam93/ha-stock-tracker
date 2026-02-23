/**
 * Stock Tracker Card for Home Assistant
 * 
 * A custom Lovelace card to display stock data beautifully.
 * 
 * Features:
 * - Compact and full display modes
 * - Live price with color-coded changes
 * - Mini sparkline chart
 * - Technical indicators display
 * - Trend visualization
 * - Click to show more details
 * 
 * Usage:
 *   type: custom:stock-tracker-card
 *   entity: sensor.aapl_price
 *   display_mode: full  # full | compact | mini
 *   show_chart: true
 *   show_indicators: true
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
    this._resizeObserver = null;
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error('Please define an entity');
    }
    
    this._config = {
      entity: config.entity,
      display_mode: config.display_mode || 'full',
      show_chart: config.show_chart !== false,
      show_indicators: config.show_indicators !== false,
      show_details: config.show_details !== false,
      name: config.name || null,
      chart_hours: config.chart_hours || 24,
      tap_action: config.tap_action || 'more-info',
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

  // =========================================================================
  // RENDER
  // =========================================================================

  _render() {
    if (!this._hass || !this._config.entity) return;

    const entity = this._hass.states[this._config.entity];
    if (!entity) {
      this._renderError(`Entity not found: ${this._config.entity}`);
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
      symbol: attrs.symbol || this._extractSymbol(this._config.entity),
      name: this._config.name || attrs.company_name || attrs.symbol || 'Stock',
      price: price,
      currency: attrs.currency || 'USD',
      change: change,
      changePercent: changePercent,
      isPositive: changePercent >= 0,
      previousClose: parseFloat(attrs.previous_close) || 0,
      open: parseFloat(attrs.today_open) || 0,
      high: parseFloat(attrs.today_high) || 0,
      low: parseFloat(attrs.today_low) || 0,
      volume: attrs.volume,
      volumeFormatted: this._formatVolume(attrs.volume),
      marketCap: attrs.market_cap_formatted || this._formatLargeNumber(attrs.market_cap),
      peRatio: attrs.pe_ratio,
      eps: attrs.eps,
      dividendYield: attrs.dividend_yield,
      week52High: attrs['52_week_high'],
      week52Low: attrs['52_week_low'],
      avgDay50: attrs['50_day_avg'],
      avgDay200: attrs['200_day_avg'],
      exchange: attrs.exchange || '',
      sector: attrs.sector || '',
      dataSource: attrs.data_source || '',
      signal: attrs.overall_signal || 'N/A',
      // Trend data
      trendDirection: attrs.trend_direction || 'neutral',
      trendStrength: attrs.trend_strength || 0,
      volatility: attrs.volatility || 0,
      // Indicators
      rsi: attrs.rsi_14,
      rsiSignal: attrs.rsi_signal,
      macdTrend: attrs.macd_trend,
      // Period changes
      weekChange: attrs.week_change_percent,
      monthChange: attrs.month_change_percent,
      ytdChange: attrs.ytd_change_percent,
      // Last updated
      lastUpdated: entity.last_updated
    };
  }

  _extractSymbol(entityId) {
    // sensor.aapl_price -> AAPL
    const match = entityId.match(/sensor\.(.+)_price/);
    return match ? match[1].toUpperCase() : entityId;
  }

  // =========================================================================
  // RENDER MODES
  // =========================================================================

  _renderMini(data) {
    const color = data.isPositive ? 'var(--success-color, #4CAF50)' : 'var(--error-color, #F44336)';
    const arrow = data.isPositive ? '▲' : '▼';

    this.shadowRoot.innerHTML = `
      <style>${this._getMiniStyles()}</style>
      <ha-card class="mini-card" @click="${() => this._handleClick()}">
        <div class="mini-content">
          <span class="symbol">${data.symbol}</span>
          <span class="price">${this._formatPrice(data.price, data.currency)}</span>
          <span class="change" style="color: ${color}">
            ${arrow} ${Math.abs(data.changePercent).toFixed(2)}%
          </span>
        </div>
      </ha-card>
    `;

    this._attachClickHandler();
  }

  _renderCompact(data) {
    const color = data.isPositive ? 'var(--success-color, #4CAF50)' : 'var(--error-color, #F44336)';
    const arrow = data.isPositive ? '▲' : '▼';
    const trendIcon = this._getTrendIcon(data.trendDirection);

    this.shadowRoot.innerHTML = `
      <style>${this._getCompactStyles()}</style>
      <ha-card class="compact-card">
        <div class="header" @click="${() => this._handleClick()}">
          <div class="title-row">
            <span class="symbol">${data.symbol}</span>
            <span class="exchange">${data.exchange}</span>
          </div>
          <div class="name">${data.name}</div>
        </div>
        
        <div class="price-section">
          <div class="price-main">
            <span class="price">${this._formatPrice(data.price, data.currency)}</span>
            <span class="currency">${data.currency}</span>
          </div>
          <div class="change-row">
            <span class="change-abs" style="color: ${color}">
              ${data.isPositive ? '+' : ''}${data.change.toFixed(2)}
            </span>
            <span class="change-pct" style="color: ${color}">
              (${arrow} ${Math.abs(data.changePercent).toFixed(2)}%)
            </span>
          </div>
        </div>

        <div class="footer">
          <div class="stat">
            <span class="label">Trend</span>
            <span class="value">${trendIcon}</span>
          </div>
          <div class="stat">
            <span class="label">Vol</span>
            <span class="value">${data.volumeFormatted}</span>
          </div>
          <div class="stat">
            <span class="label">Signal</span>
            <span class="value signal-${data.signal.toLowerCase().replace('_', '-')}">${data.signal}</span>
          </div>
        </div>
      </ha-card>
    `;

    this._attachClickHandler();
  }

  _renderFull(data) {
    const color = data.isPositive ? 'var(--success-color, #4CAF50)' : 'var(--error-color, #F44336)';
    const bgColor = data.isPositive ? 'rgba(76, 175, 80, 0.1)' : 'rgba(244, 67, 54, 0.1)';
    const arrow = data.isPositive ? '▲' : '▼';
    const trendIcon = this._getTrendIcon(data.trendDirection);

    this.shadowRoot.innerHTML = `
      <style>${this._getFullStyles()}</style>
      <ha-card class="full-card">
        <!-- Header -->
        <div class="header" @click="${() => this._handleClick()}">
          <div class="header-left">
            <div class="symbol-badge">${data.symbol}</div>
            <div class="company-info">
              <span class="company-name">${data.name}</span>
              <span class="exchange-info">${data.exchange}${data.sector ? ' · ' + data.sector : ''}</span>
            </div>
          </div>
          <div class="header-right">
            <div class="trend-badge trend-${data.trendDirection}">
              ${trendIcon} ${this._formatTrend(data.trendDirection)}
            </div>
          </div>
        </div>

        <!-- Price Section -->
        <div class="price-section" style="background: ${bgColor}">
          <div class="price-main">
            <span class="price">${this._formatPrice(data.price, data.currency)}</span>
            <span class="currency">${data.currency}</span>
          </div>
          <div class="price-change" style="color: ${color}">
            <span class="change-value">
              ${data.isPositive ? '+' : ''}${data.change.toFixed(2)}
            </span>
            <span class="change-percent">
              (${arrow} ${Math.abs(data.changePercent).toFixed(2)}%)
            </span>
          </div>
        </div>

        <!-- Chart Placeholder / Sparkline -->
        ${this._config.show_chart ? this._renderSparkline(data) : ''}

        <!-- Day Stats -->
        <div class="stats-grid">
          <div class="stat-item">
            <span class="stat-label">Eröffnung</span>
            <span class="stat-value">${this._formatPrice(data.open, data.currency)}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Vortag</span>
            <span class="stat-value">${this._formatPrice(data.previousClose, data.currency)}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Tageshoch</span>
            <span class="stat-value high">${this._formatPrice(data.high, data.currency)}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Tagestief</span>
            <span class="stat-value low">${this._formatPrice(data.low, data.currency)}</span>
          </div>
        </div>

        <!-- Volume & Market Data -->
        <div class="data-section">
          <div class="data-row">
            <span class="data-label">📊 Volumen</span>
            <span class="data-value">${data.volumeFormatted}</span>
          </div>
          <div class="data-row">
            <span class="data-label">🏛️ Marktkapitalisierung</span>
            <span class="data-value">${data.marketCap || 'N/A'}</span>
          </div>
          ${data.peRatio ? `
          <div class="data-row">
            <span class="data-label">📈 KGV (P/E)</span>
            <span class="data-value">${parseFloat(data.peRatio).toFixed(2)}</span>
          </div>
          ` : ''}
          ${data.dividendYield ? `
          <div class="data-row">
            <span class="data-label">💰 Dividendenrendite</span>
            <span class="data-value">${parseFloat(data.dividendYield).toFixed(2)}%</span>
          </div>
          ` : ''}
        </div>

        <!-- 52 Week Range -->
        ${data.week52Low && data.week52High ? this._render52WeekRange(data) : ''}

        <!-- Period Performance -->
        ${this._renderPeriodPerformance(data)}

        <!-- Technical Indicators -->
        ${this._config.show_indicators ? this._renderIndicators(data) : ''}

        <!-- Footer -->
        <div class="card-footer">
          <span class="data-source">📡 ${data.dataSource || 'Yahoo'}</span>
          <span class="signal-badge signal-${data.signal.toLowerCase().replace('_', '-')}">
            ${this._getSignalIcon(data.signal)} ${data.signal}
          </span>
        </div>
      </ha-card>
    `;

    this._attachClickHandler();
  }

  // =========================================================================
  // RENDER COMPONENTS
  // =========================================================================

  _renderSparkline(data) {
    return `
      <div class="sparkline-container">
        <div class="sparkline-placeholder">
          <span class="sparkline-text">📈 Kursverlauf</span>
          <span class="sparkline-hint">Nutze history-graph für Details</span>
        </div>
      </div>
    `;
  }

  _render52WeekRange(data) {
    const low = data.week52Low;
    const high = data.week52High;
    const current = data.price;
    const range = high - low;
    const position = range > 0 ? ((current - low) / range) * 100 : 50;

    return `
      <div class="range-section">
        <div class="range-header">
          <span class="range-title">52-Wochen Spanne</span>
        </div>
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

  _renderPeriodPerformance(data) {
    const periods = [
      { label: '1W', value: data.weekChange },
      { label: '1M', value: data.monthChange },
      { label: 'YTD', value: data.ytdChange }
    ].filter(p => p.value !== undefined && p.value !== null);

    if (periods.length === 0) return '';

    return `
      <div class="performance-section">
        <div class="performance-header">Performance</div>
        <div class="performance-grid">
          ${periods.map(p => {
            const isPositive = p.value >= 0;
            const color = isPositive ? 'var(--success-color, #4CAF50)' : 'var(--error-color, #F44336)';
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
    if (!data.rsi && !data.macdTrend) return '';

    return `
      <div class="indicators-section">
        <div class="indicators-header">📊 Technische Indikatoren</div>
        <div class="indicators-grid">
          ${data.rsi ? `
          <div class="indicator-item">
            <span class="indicator-label">RSI (14)</span>
            <div class="indicator-value-row">
              <span class="indicator-value">${parseFloat(data.rsi).toFixed(1)}</span>
              <span class="indicator-signal ${this._getRsiClass(data.rsi)}">
                ${this._getRsiLabel(data.rsi)}
              </span>
            </div>
            <div class="rsi-bar">
              <div class="rsi-fill" style="width: ${data.rsi}%"></div>
              <div class="rsi-zones">
                <div class="zone oversold"></div>
                <div class="zone neutral"></div>
                <div class="zone overbought"></div>
              </div>
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
          ${data.trendStrength ? `
          <div class="indicator-item">
            <span class="indicator-label">Trend-Stärke</span>
            <div class="strength-bar">
              <div class="strength-fill" style="width: ${data.trendStrength * 10}%"></div>
            </div>
            <span class="indicator-value">${parseFloat(data.trendStrength).toFixed(1)}/10</span>
          </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  _renderError(message) {
    this.shadowRoot.innerHTML = `
      <style>
        .error-card {
          padding: 16px;
          background: var(--card-background-color);
          border-radius: var(--ha-card-border-radius, 4px);
          color: var(--error-color, #F44336);
        }
      </style>
      <ha-card class="error-card">
        ⚠️ ${message}
      </ha-card>
    `;
  }

  // =========================================================================
  // STYLES
  // =========================================================================

  _getMiniStyles() {
    return `
      :host {
        display: block;
      }
      .mini-card {
        padding: 8px 12px;
        cursor: pointer;
        transition: transform 0.2s, box-shadow 0.2s;
      }
      .mini-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(0,0,0,0.2);
      }
      .mini-content {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .symbol {
        font-weight: bold;
        font-size: 14px;
        color: var(--primary-text-color);
      }
      .price {
        font-size: 14px;
        color: var(--primary-text-color);
      }
      .change {
        font-size: 12px;
        font-weight: 500;
        margin-left: auto;
      }
    `;
  }

  _getCompactStyles() {
    return `
      :host {
        display: block;
      }
      .compact-card {
        padding: 12px;
        cursor: pointer;
      }
      .header {
        margin-bottom: 8px;
      }
      .title-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .symbol {
        font-weight: bold;
        font-size: 18px;
        color: var(--primary-text-color);
      }
      .exchange {
        font-size: 12px;
        color: var(--secondary-text-color);
        background: var(--divider-color);
        padding: 2px 6px;
        border-radius: 4px;
      }
      .name {
        font-size: 12px;
        color: var(--secondary-text-color);
        margin-top: 4px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .price-section {
        margin: 12px 0;
      }
      .price-main {
        display: flex;
        align-items: baseline;
        gap: 4px;
      }
      .price {
        font-size: 28px;
        font-weight: bold;
        color: var(--primary-text-color);
      }
      .currency {
        font-size: 14px;
        color: var(--secondary-text-color);
      }
      .change-row {
        display: flex;
        gap: 8px;
        margin-top: 4px;
      }
      .change-abs, .change-pct {
        font-size: 14px;
        font-weight: 500;
      }
      .footer {
        display: flex;
        justify-content: space-between;
        padding-top: 12px;
        border-top: 1px solid var(--divider-color);
      }
      .stat {
        text-align: center;
      }
      .stat .label {
        display: block;
        font-size: 10px;
        color: var(--secondary-text-color);
        text-transform: uppercase;
      }
      .stat .value {
        font-size: 14px;
        font-weight: 500;
      }
      .signal-buy, .signal-strong-buy {
        color: var(--success-color, #4CAF50);
      }
      .signal-sell, .signal-strong-sell {
        color: var(--error-color, #F44336);
      }
      .signal-hold {
        color: var(--warning-color, #FF9800);
      }
    `;
  }

  _getFullStyles() {
    return `
      :host {
        display: block;
      }
      
      .full-card {
        overflow: hidden;
      }

      /* Header */
      .header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        padding: 16px;
        cursor: pointer;
        background: var(--card-background-color);
      }
      .header-left {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .symbol-badge {
        background: var(--primary-color);
        color: var(--text-primary-color, white);
        padding: 8px 12px;
        border-radius: 8px;
        font-weight: bold;
        font-size: 16px;
      }
      .company-info {
        display: flex;
        flex-direction: column;
      }
      .company-name {
        font-size: 16px;
        font-weight: 500;
        color: var(--primary-text-color);
      }
      .exchange-info {
        font-size: 12px;
        color: var(--secondary-text-color);
      }
      .trend-badge {
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 500;
      }
      .trend-strong_bullish, .trend-bullish {
        background: rgba(76, 175, 80, 0.2);
        color: var(--success-color, #4CAF50);
      }
      .trend-strong_bearish, .trend-bearish {
        background: rgba(244, 67, 54, 0.2);
        color: var(--error-color, #F44336);
      }
      .trend-neutral {
        background: rgba(158, 158, 158, 0.2);
        color: var(--secondary-text-color);
      }

      /* Price Section */
      .price-section {
        padding: 16px;
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
        color: var(--primary-text-color);
      }
      .currency {
        font-size: 18px;
        color: var(--secondary-text-color);
      }
      .price-change {
        margin-top: 8px;
        font-size: 16px;
        font-weight: 500;
      }
      .change-value {
        margin-right: 8px;
      }

      /* Sparkline */
      .sparkline-container {
        padding: 8px 16px;
        background: var(--secondary-background-color);
      }
      .sparkline-placeholder {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 16px;
        border: 1px dashed var(--divider-color);
        border-radius: 8px;
      }
      .sparkline-text {
        font-size: 14px;
        color: var(--secondary-text-color);
      }
      .sparkline-hint {
        font-size: 10px;
        color: var(--disabled-text-color);
        margin-top: 4px;
      }

      /* Stats Grid */
      .stats-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 1px;
        background: var(--divider-color);
        margin: 16px;
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
        font-weight: 500;
        color: var(--primary-text-color);
      }
      .stat-value.high {
        color: var(--success-color, #4CAF50);
      }
      .stat-value.low {
        color: var(--error-color, #F44336);
      }

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
        font-weight: 500;
        color: var(--primary-text-color);
      }

      /* 52 Week Range */
      .range-section {
        padding: 16px;
      }
      .range-header {
        margin-bottom: 12px;
      }
      .range-title {
        font-size: 12px;
        font-weight: 500;
        color: var(--secondary-text-color);
        text-transform: uppercase;
      }
      .range-bar-container {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .range-low, .range-high {
        font-size: 11px;
        color: var(--secondary-text-color);
        min-width: 50px;
      }
      .range-high {
        text-align: right;
      }
      .range-bar {
        flex: 1;
        height: 8px;
        background: var(--divider-color);
        border-radius: 4px;
        position: relative;
        overflow: visible;
      }
      .range-fill {
        height: 100%;
        background: linear-gradient(90deg, var(--error-color, #F44336), var(--warning-color, #FF9800), var(--success-color, #4CAF50));
        border-radius: 4px;
      }
      .range-marker {
        position: absolute;
        top: -4px;
        width: 16px;
        height: 16px;
        background: var(--primary-color);
        border: 2px solid var(--card-background-color);
        border-radius: 50%;
        transform: translateX(-50%);
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      }

      /* Performance Section */
      .performance-section {
        padding: 16px;
        background: var(--secondary-background-color);
      }
      .performance-header {
        font-size: 12px;
        font-weight: 500;
        color: var(--secondary-text-color);
        text-transform: uppercase;
        margin-bottom: 12px;
      }
      .performance-grid {
        display: flex;
        gap: 16px;
      }
      .perf-item {
        flex: 1;
        text-align: center;
        padding: 8px;
        background: var(--card-background-color);
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

      /* Indicators Section */
      .indicators-section {
        padding: 16px;
        border-top: 1px solid var(--divider-color);
      }
      .indicators-header {
        font-size: 14px;
        font-weight: 500;
        color: var(--primary-text-color);
        margin-bottom: 12px;
      }
      .indicators-grid {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .indicator-item {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .indicator-label {
        font-size: 12px;
        color: var(--secondary-text-color);
      }
      .indicator-value-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .indicator-value {
        font-size: 14px;
        font-weight: 500;
        color: var(--primary-text-color);
      }
      .indicator-signal {
        font-size: 11px;
        padding: 2px 6px;
        border-radius: 4px;
      }
      .indicator-signal.oversold {
        background: rgba(76, 175, 80, 0.2);
        color: var(--success-color, #4CAF50);
      }
      .indicator-signal.neutral {
        background: rgba(158, 158, 158, 0.2);
        color: var(--secondary-text-color);
      }
      .indicator-signal.overbought {
        background: rgba(244, 67, 54, 0.2);
        color: var(--error-color, #F44336);
      }
      .indicator-signal.macd-bullish {
        background: rgba(76, 175, 80, 0.2);
        color: var(--success-color, #4CAF50);
      }
      .indicator-signal.macd-bearish {
        background: rgba(244, 67, 54, 0.2);
        color: var(--error-color, #F44336);
      }

      /* RSI Bar */
      .rsi-bar {
        position: relative;
        height: 6px;
        background: var(--divider-color);
        border-radius: 3px;
        margin-top: 4px;
        overflow: hidden;
      }
      .rsi-fill {
        height: 100%;
        background: var(--primary-color);
        border-radius: 3px;
        transition: width 0.3s;
      }
      .rsi-zones {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        display: flex;
      }
      .zone {
        flex: 1;
        opacity: 0.3;
      }
      .zone.oversold {
        background: var(--success-color, #4CAF50);
      }
      .zone.neutral {
        background: var(--warning-color, #FF9800);
        flex: 2;
      }
      .zone.overbought {
        background: var(--error-color, #F44336);
      }

      /* Strength Bar */
      .strength-bar {
        flex: 1;
        height: 6px;
        background: var(--divider-color);
        border-radius: 3px;
        margin: 4px 8px;
      }
      .strength-fill {
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
        font-weight: 500;
        padding: 4px 8px;
        border-radius: 4px;
      }
      .signal-badge.signal-buy, .signal-badge.signal-strong-buy {
        background: rgba(76, 175, 80, 0.2);
        color: var(--success-color, #4CAF50);
      }
      .signal-badge.signal-sell, .signal-badge.signal-strong-sell {
        background: rgba(244, 67, 54, 0.2);
        color: var(--error-color, #F44336);
      }
      .signal-badge.signal-hold {
        background: rgba(255, 152, 0, 0.2);
        color: var(--warning-color, #FF9800);
      }
      .signal-badge.signal-n-a {
        background: var(--divider-color);
        color: var(--secondary-text-color);
      }
    `;
  }

  // =========================================================================
  // HELPERS
  // =========================================================================

  _formatPrice(value, currency) {
    if (value === null || value === undefined || isNaN(value)) return 'N/A';
    
    const formatter = new Intl.NumberFormat('de-DE', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    
    const symbols = {
      'USD': '$',
      'EUR': '€',
      'GBP': '£',
      'JPY': '¥',
      'CHF': 'CHF ',
    };
    
    const symbol = symbols[currency] || currency + ' ';
    return symbol + formatter.format(value);
  }

  _formatVolume(value) {
    if (!value) return 'N/A';
    value = parseFloat(value);
    
    if (value >= 1e9) return (value / 1e9).toFixed(2) + 'B';
    if (value >= 1e6) return (value / 1e6).toFixed(2) + 'M';
    if (value >= 1e3) return (value / 1e3).toFixed(1) + 'K';
    return value.toString();
  }

  _formatLargeNumber(value) {
    if (!value) return 'N/A';
    value = parseFloat(value);
    
    if (value >= 1e12) return (value / 1e12).toFixed(2) + 'T';
    if (value >= 1e9) return (value / 1e9).toFixed(2) + 'B';
    if (value >= 1e6) return (value / 1e6).toFixed(2) + 'M';
    return value.toLocaleString('de-DE');
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
      'strong_bullish': 'Stark steigend',
      'bullish': 'Steigend',
      'neutral': 'Seitwärts',
      'bearish': 'Fallend',
      'strong_bearish': 'Stark fallend',
    };
    return labels[trend] || trend;
  }

  _getSignalIcon(signal) {
    const icons = {
      'STRONG_BUY': '🟢',
      'BUY': '🟩',
      'HOLD': '🟨',
      'SELL': '🟧',
      'STRONG_SELL': '🔴',
    };
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
    const event = new Event('hass-more-info', {
      bubbles: true,
      composed: true
    });
    event.detail = { entityId: this._config.entity };
    this.dispatchEvent(event);
  }

  _attachClickHandler() {
    const card = this.shadowRoot.querySelector('ha-card');
    if (card) {
      card.addEventListener('click', () => this._handleClick());
    }
  }

  // =========================================================================
  // STATIC CONFIG
  // =========================================================================

  static getConfigElement() {
    return document.createElement('stock-tracker-card-editor');
  }

  static getStubConfig() {
    return {
      entity: '',
      display_mode: 'full',
      show_chart: true,
      show_indicators: true
    };
  }
}


// =============================================================================
// CARD EDITOR (für UI-Konfiguration)
// =============================================================================

class StockTrackerCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
  }

  setConfig(config) {
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
  }

  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        .card-config {
          padding: 16px;
        }
        .config-row {
          margin-bottom: 16px;
        }
        label {
          display: block;
          margin-bottom: 4px;
          font-weight: 500;
        }
        input, select {
          width: 100%;
          padding: 8px;
          border: 1px solid var(--divider-color);
          border-radius: 4px;
          background: var(--card-background-color);
          color: var(--primary-text-color);
        }
        .checkbox-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .checkbox-row input {
          width: auto;
        }
      </style>
      <div class="card-config">
        <div class="config-row">
          <label>Entity (Preis-Sensor)</label>
          <input type="text" 
                 id="entity" 
                 value="${this._config.entity || ''}"
                 placeholder="sensor.aapl_price">
        </div>
        <div class="config-row">
          <label>Anzeige-Modus</label>
          <select id="display_mode">
            <option value="full" ${this._config.display_mode === 'full' ? 'selected' : ''}>Vollständig</option>
            <option value="compact" ${this._config.display_mode === 'compact' ? 'selected' : ''}>Kompakt</option>
            <option value="mini" ${this._config.display_mode === 'mini' ? 'selected' : ''}>Mini</option>
          </select>
        </div>
        <div class="config-row checkbox-row">
          <input type="checkbox" 
                 id="show_indicators" 
                 ${this._config.show_indicators !== false ? 'checked' : ''}>
          <label for="show_indicators">Technische Indikatoren anzeigen</label>
        </div>
        <div class="config-row checkbox-row">
          <input type="checkbox" 
                 id="show_chart" 
                 ${this._config.show_chart !== false ? 'checked' : ''}>
          <label for="show_chart">Chart-Bereich anzeigen</label>
        </div>
        <div class="config-row">
          <label>Eigener Name (optional)</label>
          <input type="text" 
                 id="name" 
                 value="${this._config.name || ''}"
                 placeholder="z.B. Apple Aktie">
        </div>
      </div>
    `;

    // Event Listeners
    this.shadowRoot.querySelectorAll('input, select').forEach(el => {
      el.addEventListener('change', (e) => this._valueChanged(e));
    });
  }

  _valueChanged(e) {
    const target = e.target;
    let value = target.type === 'checkbox' ? target.checked : target.value;
    
    const newConfig = { ...this._config };
    newConfig[target.id] = value;
    
    const event = new CustomEvent('config-changed', {
      detail: { config: newConfig },
      bubbles: true,
      composed: true
    });
    this.dispatchEvent(event);
  }
}


// =============================================================================
// REGISTER CARDS
// =============================================================================

customElements.define('stock-tracker-card', StockTrackerCard);
customElements.define('stock-tracker-card-editor', StockTrackerCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'stock-tracker-card',
  name: 'Stock Tracker Card',
  description: 'Display stock data with price, change, trend, and technical indicators',
  preview: true,
  documentationURL: 'https://github.com/your-repo/ha-stock-tracker'
});

console.info(
  '%c STOCK-TRACKER-CARD %c v1.0.0 ',
  'color: white; background: #3498db; font-weight: bold; padding: 2px 4px; border-radius: 2px 0 0 2px;',
  'color: #3498db; background: white; font-weight: bold; padding: 2px 4px; border-radius: 0 2px 2px 0;'
);