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
      trendDirection: attrs.trend_direction || 'neutral',
      trendStrength: attrs.trend_strength || 0,
      volatility: attrs.volatility || 0,
      rsi: attrs.rsi_14,
      rsiSignal: attrs.rsi_signal,
      macdTrend: attrs.macd_trend,
      weekChange: attrs.week_change_percent,
      monthChange: attrs.month_change_percent,
      ytdChange: attrs.ytd_change_percent,
      lastUpdated: entity.last_updated
    };
  }

  _extractSymbol(entityId) {
    const match = entityId.match(/sensor\.(.+)_price/);
    return match ? match[1].toUpperCase().replace(/_/g, '.') : entityId;
  }

  // =========================================================================
  // RENDER MODES
  // =========================================================================

  _renderMini(data) {
    const color = data.isPositive ? '#4CAF50' : '#F44336';
    const arrow = data.isPositive ? '▲' : '▼';

    this.shadowRoot.innerHTML = `
      <style>${this._getMiniStyles()}</style>
      <ha-card class="mini-card">
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
    const color = data.isPositive ? '#4CAF50' : '#F44336';
    const arrow = data.isPositive ? '▲' : '▼';
    const trendIcon = this._getTrendIcon(data.trendDirection);

    this.shadowRoot.innerHTML = `
      <style>${this._getCompactStyles()}</style>
      <ha-card class="compact-card">
        <div class="header">
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
    const color = data.isPositive ? '#4CAF50' : '#F44336';
    const bgColor = data.isPositive ? 'rgba(76, 175, 80, 0.1)' : 'rgba(244, 67, 54, 0.1)';
    const arrow = data.isPositive ? '▲' : '▼';
    const trendIcon = this._getTrendIcon(data.trendDirection);

    this.shadowRoot.innerHTML = `
      <style>${this._getFullStyles()}</style>
      <ha-card class="full-card">
        <!-- Header -->
        <div class="header">
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
            const color = isPositive ? '#4CAF50' : '#F44336';
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
          background: var(--card-background-color, #fff);
          border-radius: var(--ha-card-border-radius, 12px);
          border: 1px solid var(--error-color, #F44336);
        }
        .error-content {
          display: flex;
          align-items: center;
          gap: 12px;
          color: var(--error-color, #F44336);
        }
        .error-icon {
          font-size: 24px;
        }
        .error-text {
          flex: 1;
        }
        .error-title {
          font-weight: bold;
          margin-bottom: 4px;
        }
        .error-message {
          font-size: 12px;
          opacity: 0.8;
        }
      </style>
      <ha-card class="error-card">
        <div class="error-content">
          <span class="error-icon">⚠️</span>
          <div class="error-text">
            <div class="error-title">Fehler</div>
            <div class="error-message">${message}</div>
          </div>
        </div>
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
        box-shadow: var(--ha-card-box-shadow, 0 4px 8px rgba(0,0,0,0.2));
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
        padding: 16px;
        cursor: pointer;
      }
      .header {
        margin-bottom: 12px;
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
        font-size: 11px;
        color: var(--secondary-text-color);
        background: var(--secondary-background-color, #f5f5f5);
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
      .price-section {
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
        border-top: 1px solid var(--divider-color, #e0e0e0);
      }
      .stat {
        text-align: center;
        flex: 1;
      }
      .stat .label {
        display: block;
        font-size: 10px;
        color: var(--secondary-text-color);
        text-transform: uppercase;
        margin-bottom: 2px;
      }
      .stat .value {
        font-size: 13px;
        font-weight: 600;
      }
      .signal-buy, .signal-strong-buy {
        color: #4CAF50;
      }
      .signal-sell, .signal-strong-sell {
        color: #F44336;
      }
      .signal-hold {
        color: #FF9800;
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
        flex: 1;
        min-width: 0;
      }
      .symbol-badge {
        background: var(--primary-color, #03a9f4);
        color: white;
        padding: 8px 12px;
        border-radius: 8px;
        font-weight: bold;
        font-size: 14px;
        flex-shrink: 0;
      }
      .company-info {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .company-name {
        font-size: 15px;
        font-weight: 500;
        color: var(--primary-text-color);
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
        background: rgba(76, 175, 80, 0.15);
        color: #4CAF50;
      }
      .trend-strong_bearish, .trend-bearish {
        background: rgba(244, 67, 54, 0.15);
        color: #F44336;
      }
      .trend-neutral {
        background: rgba(158, 158, 158, 0.15);
        color: var(--secondary-text-color);
      }

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
        color: var(--primary-text-color);
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
      .change-value {
        margin-right: 8px;
      }

      .stats-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 1px;
        background: var(--divider-color, #e0e0e0);
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
        color: var(--primary-text-color);
      }
      .stat-value.high {
        color: #4CAF50;
      }
      .stat-value.low {
        color: #F44336;
      }

      .data-section {
        padding: 0 16px 16px;
      }
      .data-row {
        display: flex;
        justify-content: space-between;
        padding: 10px 0;
        border-bottom: 1px solid var(--divider-color, #e0e0e0);
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
        color: var(--primary-text-color);
      }

      .range-section {
        padding: 16px;
        background: var(--secondary-background-color, #f5f5f5);
      }
      .range-title {
        font-size: 12px;
        font-weight: 600;
        color: var(--secondary-text-color);
        text-transform: uppercase;
        margin-bottom: 12px;
        display: block;
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
      .range-high {
        text-align: right;
      }
      .range-bar {
        flex: 1;
        height: 8px;
        background: var(--divider-color, #e0e0e0);
        border-radius: 4px;
        position: relative;
      }
      .range-fill {
        height: 100%;
        background: linear-gradient(90deg, #F44336 0%, #FF9800 50%, #4CAF50 100%);
        border-radius: 4px;
      }
      .range-marker {
        position: absolute;
        top: 50%;
        width: 14px;
        height: 14px;
        background: var(--primary-color, #03a9f4);
        border: 2px solid white;
        border-radius: 50%;
        transform: translate(-50%, -50%);
        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
      }

      .performance-section {
        padding: 16px;
      }
      .performance-header {
        font-size: 12px;
        font-weight: 600;
        color: var(--secondary-text-color);
        text-transform: uppercase;
        margin-bottom: 12px;
      }
      .performance-grid {
        display: flex;
        gap: 12px;
      }
      .perf-item {
        flex: 1;
        text-align: center;
        padding: 10px;
        background: var(--secondary-background-color, #f5f5f5);
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

      .indicators-section {
        padding: 16px;
        border-top: 1px solid var(--divider-color, #e0e0e0);
      }
      .indicators-header {
        font-size: 14px;
        font-weight: 600;
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
        gap: 6px;
      }
      .indicator-label {
        font-size: 12px;
        color: var(--secondary-text-color);
      }
      .indicator-value-row {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .indicator-value {
        font-size: 14px;
        font-weight: 600;
        color: var(--primary-text-color);
      }
      .indicator-signal {
        font-size: 11px;
        padding: 3px 8px;
        border-radius: 4px;
        font-weight: 500;
      }
      .indicator-signal.oversold {
        background: rgba(76, 175, 80, 0.15);
        color: #4CAF50;
      }
      .indicator-signal.neutral {
        background: rgba(158, 158, 158, 0.15);
        color: var(--secondary-text-color);
      }
      .indicator-signal.overbought {
        background: rgba(244, 67, 54, 0.15);
        color: #F44336;
      }
      .indicator-signal.macd-bullish {
        background: rgba(76, 175, 80, 0.15);
        color: #4CAF50;
      }
      .indicator-signal.macd-bearish {
        background: rgba(244, 67, 54, 0.15);
        color: #F44336;
      }

      .rsi-bar, .strength-bar {
        height: 6px;
        background: var(--divider-color, #e0e0e0);
        border-radius: 3px;
        overflow: hidden;
      }
      .rsi-fill {
        height: 100%;
        background: var(--primary-color, #03a9f4);
        border-radius: 3px;
      }
      .strength-fill {
        height: 100%;
        background: var(--primary-color, #03a9f4);
        border-radius: 3px;
      }

      .card-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 16px;
        background: var(--secondary-background-color, #f5f5f5);
        border-top: 1px solid var(--divider-color, #e0e0e0);
      }
      .data-source {
        font-size: 11px;
        color: var(--disabled-text-color, #9e9e9e);
      }
      .signal-badge {
        font-size: 12px;
        font-weight: 600;
        padding: 4px 10px;
        border-radius: 6px;
      }
      .signal-badge.signal-buy, .signal-badge.signal-strong-buy {
        background: rgba(76, 175, 80, 0.15);
        color: #4CAF50;
      }
      .signal-badge.signal-sell, .signal-badge.signal-strong-sell {
        background: rgba(244, 67, 54, 0.15);
        color: #F44336;
      }
      .signal-badge.signal-hold {
        background: rgba(255, 152, 0, 0.15);
        color: #FF9800;
      }
      .signal-badge.signal-n-a {
        background: var(--secondary-background-color, #f5f5f5);
        color: var(--secondary-text-color);
      }
    `;
  }

  // =========================================================================
  // HELPERS
  // =========================================================================

  _formatPrice(value, currency) {
    if (value === null || value === undefined || isNaN(value)) return 'N/A';
    
    const symbols = { 'USD': '$', 'EUR': '€', 'GBP': '£', 'JPY': '¥', 'CHF': 'CHF ' };
    const symbol = symbols[currency] || currency + ' ';
    
    return symbol + new Intl.NumberFormat('de-DE', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
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
      'strong_bullish': 'Stark ↑',
      'bullish': 'Steigend',
      'neutral': 'Seitwärts',
      'bearish': 'Fallend',
      'strong_bearish': 'Stark ↓',
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
    const event = new Event('hass-more-info', { bubbles: true, composed: true });
    event.detail = { entityId: this._config.entity };
    this.dispatchEvent(event);
  }

  _attachClickHandler() {
    const card = this.shadowRoot.querySelector('ha-card');
    if (card) {
      card.style.cursor = 'pointer';
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
      display_mode: 'compact',
      show_chart: true,
      show_indicators: true
    };
  }
}


// =============================================================================
// CARD EDITOR 
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
    if (this._hass) {
      this._render();
    }
  }

  set hass(hass) {
    const firstTime = !this._hass;
    this._hass = hass;
    
    if (firstTime || !this.shadowRoot.querySelector('.editor')) {
      this._render();
    }
  }

  _getStockEntities() {
    if (!this._hass || !this._hass.states) {
      console.log('Stock Tracker Editor: hass oder states nicht verfügbar');
      return [];
    }

    const entities = [];

    for (const [entityId, state] of Object.entries(this._hass.states)) {
      // Nur Sensoren
      if (!entityId.startsWith('sensor.')) {
        continue;
      }

      const attrs = state.attributes || {};
      
      // Prüfe ob es ein Stock Tracker Sensor ist anhand der Attribute
      // Das ist die zuverlässigste Methode!
      const isStockSensor = (
        attrs.symbol !== undefined &&
        (
          attrs.change_percent !== undefined ||
          attrs.previous_close !== undefined ||
          attrs.data_source !== undefined ||
          attrs.overall_signal !== undefined ||
          attrs.company_name !== undefined
        )
      );

      if (isStockSensor) {
        const symbol = attrs.symbol || entityId;
        const name = attrs.company_name || attrs.friendly_name || symbol;
        const price = state.state;
        const currency = attrs.currency || 'USD';
        const change = attrs.change_percent;
        const quoteType = attrs.quote_type || 'EQUITY';

        // Icon basierend auf Typ
        let typeIcon = '📈';
        if (quoteType === 'CRYPTOCURRENCY') typeIcon = '🪙';
        else if (quoteType === 'ETF') typeIcon = '📊';
        else if (quoteType === 'INDEX') typeIcon = '📉';

        let label = `${typeIcon} ${symbol}`;
        if (name && name !== symbol && !name.includes(symbol)) {
          label += ` - ${name}`;
        }
        if (price && price !== 'unavailable' && price !== 'unknown') {
          label += ` (${parseFloat(price).toFixed(2)} ${currency}`;
          if (change !== undefined && change !== null) {
            const sign = parseFloat(change) >= 0 ? '+' : '';
            label += `, ${sign}${parseFloat(change).toFixed(2)}%`;
          }
          label += ')';
        }

        entities.push({
          id: entityId,
          symbol: symbol,
          name: name,
          label: label,
          type: quoteType,
        });
      }
    }

    // Sortieren: Erst nach Typ, dann alphabetisch
    entities.sort((a, b) => {
      if (a.type !== b.type) {
        const typeOrder = { 'INDEX': 0, 'EQUITY': 1, 'ETF': 2, 'CRYPTOCURRENCY': 3 };
        return (typeOrder[a.type] || 99) - (typeOrder[b.type] || 99);
      }
      return a.symbol.localeCompare(b.symbol);
    });
    
    console.log('Stock Tracker Editor: Gefundene Entities:', entities.length, entities);
    return entities;
  }

  _render() {
    if (!this._hass) {
      this.shadowRoot.innerHTML = `
        <div style="padding: 16px; text-align: center; color: var(--secondary-text-color);">
          Lade...
        </div>
      `;
      return;
    }

    const stockEntities = this._getStockEntities();
    const currentEntity = this._config.entity || '';
    const currentMode = this._config.display_mode || 'compact';
    const showIndicators = this._config.show_indicators !== false;
    const showChart = this._config.show_chart !== false;
    const customName = this._config.name || '';

    // Entity-Optionen HTML erstellen mit Gruppierung
    let entityOptionsHtml = '<option value="">-- Bitte wählen --</option>';
    
    let currentType = '';
    stockEntities.forEach(e => {
      // Gruppierung nach Typ
      if (e.type !== currentType) {
        if (currentType !== '') {
          entityOptionsHtml += '</optgroup>';
        }
        const typeLabels = {
          'INDEX': '📉 Indizes',
          'EQUITY': '📈 Aktien',
          'ETF': '📊 ETFs',
          'CRYPTOCURRENCY': '🪙 Kryptowährungen'
        };
        entityOptionsHtml += `<optgroup label="${typeLabels[e.type] || e.type}">`;
        currentType = e.type;
      }
      
      const selected = e.id === currentEntity ? 'selected' : '';
      const safeLabel = e.label.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      entityOptionsHtml += `<option value="${e.id}" ${selected}>${safeLabel}</option>`;
    });
    if (currentType !== '') {
      entityOptionsHtml += '</optgroup>';
    }

    this.shadowRoot.innerHTML = `
      <style>
        .editor {
          display: flex;
          flex-direction: column;
          gap: 16px;
          padding: 16px;
        }
        .field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .field label {
          font-weight: 500;
          font-size: 14px;
          color: var(--primary-text-color);
        }
        .field .hint {
          font-size: 11px;
          color: var(--secondary-text-color);
        }
        select, input[type="text"] {
          width: 100%;
          padding: 10px 12px;
          border: 1px solid var(--divider-color, #e0e0e0);
          border-radius: 8px;
          background: var(--card-background-color, white);
          color: var(--primary-text-color);
          font-size: 14px;
          box-sizing: border-box;
        }
        select:focus, input[type="text"]:focus {
          outline: none;
          border-color: var(--primary-color, #03a9f4);
          box-shadow: 0 0 0 2px rgba(3, 169, 244, 0.2);
        }
        optgroup {
          font-weight: bold;
          color: var(--primary-text-color);
        }
        .checkbox-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 0;
        }
        .checkbox-row input[type="checkbox"] {
          width: 18px;
          height: 18px;
          cursor: pointer;
          flex-shrink: 0;
        }
        .checkbox-row label {
          font-size: 14px;
          color: var(--primary-text-color);
          cursor: pointer;
          user-select: none;
        }
        .info-box {
          background: rgba(33, 150, 243, 0.1);
          border: 1px solid rgba(33, 150, 243, 0.3);
          border-radius: 8px;
          padding: 12px;
          font-size: 12px;
          color: var(--primary-text-color);
        }
        .info-box strong {
          color: var(--primary-color, #03a9f4);
        }
        .no-entities {
          text-align: center;
          padding: 20px;
          color: var(--secondary-text-color);
        }
        .no-entities .icon {
          font-size: 32px;
          margin-bottom: 8px;
        }
      </style>
      
      <div class="editor">
        ${stockEntities.length === 0 ? `
          <div class="no-entities">
            <div class="icon">📊</div>
            <div>Keine Aktien-Sensoren gefunden.</div>
            <div style="margin-top: 8px; font-size: 12px;">
              Füge zuerst Aktien über Stock Tracker hinzu:<br>
              Einstellungen → Geräte & Dienste → Stock Tracker
            </div>
          </div>
        ` : `
          <div class="field">
            <label>📊 Aktie / Index / Krypto auswählen</label>
            <select id="entity">
              ${entityOptionsHtml}
            </select>
            <span class="hint">${stockEntities.length} Assets verfügbar (Aktien, Indizes, ETFs, Krypto)</span>
          </div>

          <div class="field">
            <label>🎨 Anzeige-Modus</label>
            <select id="display_mode">
              <option value="full" ${currentMode === 'full' ? 'selected' : ''}>
                Vollständig - Alle Details
              </option>
              <option value="compact" ${currentMode === 'compact' ? 'selected' : ''}>
                Kompakt - Kurs + Änderung
              </option>
              <option value="mini" ${currentMode === 'mini' ? 'selected' : ''}>
                Mini - Nur eine Zeile
              </option>
            </select>
          </div>

          <div class="checkbox-row">
            <input type="checkbox" id="show_indicators" ${showIndicators ? 'checked' : ''}>
            <label for="show_indicators">📈 Technische Indikatoren anzeigen</label>
          </div>

          <div class="checkbox-row">
            <input type="checkbox" id="show_chart" ${showChart ? 'checked' : ''}>
            <label for="show_chart">📉 Chart-Bereich anzeigen</label>
          </div>

          <div class="field">
            <label>Eigener Name (optional)</label>
            <input type="text" id="name" value="${customName}" placeholder="z.B. Mein Portfolio Header">
          </div>
        `}

        <div class="info-box">
          💡 <strong>Tipp:</strong> Indizes wie DAX (^GDAXI) oder Dow Jones (^DJI) können als Überschrift für dein Dashboard verwendet werden!<br><br>
          Weitere Assets hinzufügen unter:<br>
          Einstellungen → Geräte & Dienste → Stock Tracker → <strong>Konfigurieren</strong>
        </div>
      </div>
    `;

    this._attachEventListeners();
  }

  _attachEventListeners() {
    const entitySelect = this.shadowRoot.getElementById('entity');
    if (entitySelect) {
      entitySelect.addEventListener('change', (e) => this._valueChanged(e));
    }

    const modeSelect = this.shadowRoot.getElementById('display_mode');
    if (modeSelect) {
      modeSelect.addEventListener('change', (e) => this._valueChanged(e));
    }

    const indicatorsCheckbox = this.shadowRoot.getElementById('show_indicators');
    if (indicatorsCheckbox) {
      indicatorsCheckbox.addEventListener('change', (e) => this._valueChanged(e));
    }

    const chartCheckbox = this.shadowRoot.getElementById('show_chart');
    if (chartCheckbox) {
      chartCheckbox.addEventListener('change', (e) => this._valueChanged(e));
    }

    const nameInput = this.shadowRoot.getElementById('name');
    if (nameInput) {
      let timeout;
      nameInput.addEventListener('input', (e) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => this._valueChanged(e), 500);
      });
      nameInput.addEventListener('blur', (e) => {
        clearTimeout(timeout);
        this._valueChanged(e);
      });
    }
  }

  _valueChanged(e) {
    if (!this._config) return;

    const target = e.target;
    const id = target.id;
    const value = target.type === 'checkbox' ? target.checked : target.value;

    const newConfig = { ...this._config };

    if (value === '' && id === 'name') {
      delete newConfig.name;
    } else {
      newConfig[id] = value;
    }

    this._config = newConfig;

    const event = new CustomEvent('config-changed', {
      detail: { config: newConfig },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(event);
  }
}



// =============================================================================
// REGISTER CUSTOM ELEMENTS
// =============================================================================

if (!customElements.get('stock-tracker-card')) {
  customElements.define('stock-tracker-card', StockTrackerCard);
  console.info(
    '%c 📊 STOCK-TRACKER-CARD %c v1.2.1 ',
    'color: white; background: #1976d2; font-weight: bold; padding: 2px 6px; border-radius: 3px 0 0 3px;',
    'color: #1976d2; background: white; font-weight: bold; padding: 2px 6px; border-radius: 0 3px 3px 0; border: 1px solid #1976d2;'
  );
}

if (!customElements.get('stock-tracker-card-editor')) {
  customElements.define('stock-tracker-card-editor', StockTrackerCardEditor);
}

// Für Lovelace Card Picker
window.customCards = window.customCards || [];
if (!window.customCards.find(c => c.type === 'stock-tracker-card')) {
  window.customCards.push({
    type: 'stock-tracker-card',
    name: 'Stock Tracker Card',
    description: 'Zeigt Aktienkurse mit Preis, Änderung, Trend und technischen Indikatoren',
    preview: true,
    documentationURL: 'https://github.com/richieam93/ha-stock-tracker',
  });
}