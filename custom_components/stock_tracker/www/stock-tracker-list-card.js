/**
 * Stock Tracker List Card v1.0.2 for Home Assistant
 *
 * A comprehensive list/table view for all your tracked assets.
 */

class StockTrackerListCard extends HTMLElement {
  // =========================================================================
  // LIFECYCLE
  // =========================================================================

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
    this._hass = null;
    this._sortColumn = 'name';
    this._sortDirection = 'asc';
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  setConfig(config) {
    // Erlaube leere Konfiguration für Auto-Discovery
    this._config = {
      // Entities
      entities: config.entities || [],
      entity_prefix: config.entity_prefix || null,
      
      // Display
      title: config.title || '📊 Portfolio',
      display_mode: config.display_mode || 'table',
      show_header: config.show_header !== false,
      show_sparkline: config.show_sparkline !== false,
      show_market_cap: config.show_market_cap || false,
      show_volume: config.show_volume || false,
      show_signal: config.show_signal || false,
      show_market_status: config.show_market_status || false,
      show_asset_type: config.show_asset_type !== false,
      show_24h_change: config.show_24h_change !== false,
      show_7d_change: config.show_7d_change || false,
      show_30d_change: config.show_30d_change || false,
      
      // Portfolio
      show_total_value: config.show_total_value || false,
      show_total_change: config.show_total_change || false,
      holdings: config.holdings || {},
      
      // Sorting & Filtering
      sort_by: config.sort_by || 'name',
      sort_order: config.sort_order || 'asc',
      group_by: config.group_by || null,
      filter_type: config.filter_type || null,
      
      // Appearance
      max_items: config.max_items || 50,
      
      // Colors
      color_positive: config.color_positive || '#4CAF50',
      color_negative: config.color_negative || '#F44336',
      color_neutral: config.color_neutral || '#9E9E9E',
      
      // Interaction
      popup_on_click: config.popup_on_click !== false,
      
      // Special views
      show_top_performers: config.show_top_performers || false,
      show_worst_performers: config.show_worst_performers || false,
      performers_count: config.performers_count || 3,
    };

    this._sortColumn = this._config.sort_by;
    this._sortDirection = this._config.sort_order;

    this._render();
  }

  getCardSize() {
    const entities = this._getEntities();
    if (this._config.display_mode === 'compact') {
      return Math.ceil(entities.length / 2) + 1;
    }
    return Math.min(entities.length + 2, 10);
  }

  // =========================================================================
  // DATA EXTRACTION
  // =========================================================================

  _getEntities() {
    if (!this._hass) return [];

    let entityIds = [];

    // Get from explicit list
    if (this._config.entities && this._config.entities.length > 0) {
      entityIds = this._config.entities;
    }
    // Or find all stock tracker entities automatically
    else {
      entityIds = this._findAllStockTrackerEntities();
    }

    return entityIds.filter(id => this._hass.states[id]);
  }

  _findAllStockTrackerEntities() {
    if (!this._hass) return [];
    
    const entities = [];
    
    for (const [entityId, state] of Object.entries(this._hass.states)) {
      if (!entityId.startsWith('sensor.')) continue;
      
      const attrs = state.attributes || {};
      
      // Erkenne Stock Tracker Entities anhand ihrer Attribute
      const isStockTracker = (
        attrs.data_source !== undefined ||
        attrs.change_percent !== undefined ||
        attrs.overall_signal !== undefined ||
        (attrs.symbol !== undefined && attrs.currency !== undefined) ||
        attrs.previous_close !== undefined ||
        attrs.market_cap !== undefined
      );
      
      if (isStockTracker) {
        entities.push(entityId);
      }
    }
    
    return entities;
  }

  _extractAssetData(entityId) {
    const state = this._hass.states[entityId];
    if (!state) return null;

    const attrs = state.attributes || {};
    const price = parseFloat(state.state) || 0;
    const change = parseFloat(attrs.change) || 0;
    const changePercent = parseFloat(attrs.change_percent) || 0;
    const weekChange = parseFloat(attrs.week_change_percent) || null;
    const monthChange = parseFloat(attrs.month_change_percent) || null;

    // Get symbol from attributes or entity ID
    let symbol = attrs.symbol || '';
    if (!symbol) {
      // Versuche Symbol aus Entity-ID zu extrahieren
      const match = entityId.match(/sensor\.([^_]+)/);
      if (match) {
        symbol = match[1].toUpperCase().replace(/_/g, '-');
      }
    }

    const holdings = this._config.holdings[symbol] || 0;
    const holdingsValue = holdings * price;

    // Determine asset type
    let assetType = attrs.asset_type || attrs.quote_type || 'STOCK';
    if (assetType === 'CRYPTOCURRENCY') assetType = 'CRYPTO';
    if (assetType === 'EQUITY') assetType = 'STOCK';

    // Get sparkline data
    const historyCloses = attrs.history_closes || [];

    return {
      entityId,
      symbol,
      name: attrs.company_name || attrs.friendly_name || symbol,
      price,
      currency: attrs.currency || 'USD',
      change,
      changePercent,
      weekChange,
      monthChange,
      isPositive: changePercent >= 0,
      volume: attrs.volume,
      volumeFormatted: this._formatVolume(attrs.volume),
      marketCap: attrs.market_cap,
      marketCapFormatted: attrs.market_cap_formatted || this._formatMarketCap(attrs.market_cap),
      assetType,
      sector: attrs.sector || '',
      exchange: attrs.exchange || '',
      signal: attrs.overall_signal || 'N/A',
      marketStatus: attrs.market_status || {},
      dataSource: attrs.data_source || '',
      holdings,
      holdingsValue,
      sparklineData: historyCloses.slice(-24),
      high24h: attrs.today_high,
      low24h: attrs.today_low,
      week52High: attrs['52_week_high'],
      week52Low: attrs['52_week_low'],
      ath: attrs.ath,
      athChangePercent: attrs.ath_change_percent,
    };
  }

  // =========================================================================
  // SORTING & FILTERING
  // =========================================================================

  _sortAssets(assets) {
    const col = this._sortColumn;
    const dir = this._sortDirection === 'asc' ? 1 : -1;

    return assets.sort((a, b) => {
      let valA, valB;

      switch (col) {
        case 'name':
        case 'symbol':
          valA = (a.symbol || '').toLowerCase();
          valB = (b.symbol || '').toLowerCase();
          return valA.localeCompare(valB) * dir;
        
        case 'price':
          valA = a.price || 0;
          valB = b.price || 0;
          break;
        
        case 'change':
        case 'change_percent':
          valA = a.changePercent || 0;
          valB = b.changePercent || 0;
          break;
        
        case 'market_cap':
          valA = a.marketCap || 0;
          valB = b.marketCap || 0;
          break;
        
        case 'volume':
          valA = a.volume || 0;
          valB = b.volume || 0;
          break;
        
        case 'type':
          valA = a.assetType || '';
          valB = b.assetType || '';
          return valA.localeCompare(valB) * dir;
        
        case 'holdings':
        case 'value':
          valA = a.holdingsValue || 0;
          valB = b.holdingsValue || 0;
          break;
        
        default:
          return 0;
      }

      return (valA - valB) * dir;
    });
  }

  _filterAssets(assets) {
    let filtered = assets;

    if (this._config.filter_type) {
      filtered = filtered.filter(a => a.assetType === this._config.filter_type);
    }

    if (this._config.max_items) {
      filtered = filtered.slice(0, this._config.max_items);
    }

    return filtered;
  }

  _groupAssets(assets) {
    if (!this._config.group_by) {
      return { 'All Assets': assets };
    }

    const groups = {};
    
    for (const asset of assets) {
      let groupKey;
      
      switch (this._config.group_by) {
        case 'type':
          groupKey = this._getTypeLabel(asset.assetType);
          break;
        case 'sector':
          groupKey = asset.sector || 'Other';
          break;
        default:
          groupKey = 'All';
      }

      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }
      groups[groupKey].push(asset);
    }

    return groups;
  }

  // =========================================================================
  // CALCULATIONS
  // =========================================================================

  _calculateTotals(assets) {
    let totalValue = 0;
    let totalChange = 0;

    for (const asset of assets) {
      if (asset.holdingsValue > 0) {
        totalValue += asset.holdingsValue;
        totalChange += (asset.changePercent / 100) * asset.holdingsValue;
      }
    }

    const totalChangePercent = totalValue > 0 ? (totalChange / totalValue) * 100 : 0;

    return {
      totalValue,
      totalChangePercent,
      totalChangeAbs: totalChange,
      assetsWithHoldings: assets.filter(a => a.holdings > 0).length,
    };
  }

  _getTopPerformers(assets, count = 3) {
    return [...assets]
      .filter(a => a.changePercent !== null)
      .sort((a, b) => b.changePercent - a.changePercent)
      .slice(0, count);
  }

  _getWorstPerformers(assets, count = 3) {
    return [...assets]
      .filter(a => a.changePercent !== null)
      .sort((a, b) => a.changePercent - b.changePercent)
      .slice(0, count);
  }

  // =========================================================================
  // RENDER
  // =========================================================================

  _render() {
    if (!this._hass) return;

    const entityIds = this._getEntities();
    
    if (entityIds.length === 0) {
      this._renderEmpty();
      return;
    }

    let assets = entityIds
      .map(id => this._extractAssetData(id))
      .filter(a => a !== null);

    assets = this._filterAssets(assets);
    assets = this._sortAssets(assets);

    const totals = this._calculateTotals(assets);

    switch (this._config.display_mode) {
      case 'compact':
        this._renderCompact(assets, totals);
        break;
      case 'heatmap':
        this._renderHeatmap(assets, totals);
        break;
      default:
        this._renderTable(assets, totals);
    }
  }

  _renderEmpty() {
    this.shadowRoot.innerHTML = `
      <style>${this._getBaseStyles()}</style>
      <ha-card>
        <div class="empty-state">
          <div class="empty-icon">📊</div>
          <div class="empty-title">Keine Assets gefunden</div>
          <div class="empty-text">
            Füge Assets über Stock Tracker hinzu oder konfiguriere die Entities in der Karte.
          </div>
        </div>
      </ha-card>
    `;
  }

  // =========================================================================
  // TABLE VIEW
  // =========================================================================

  _renderTable(assets, totals) {
    const groups = this._groupAssets(assets);
    const cc = this._config;

    let tableContent = '';

    for (const [groupName, groupAssets] of Object.entries(groups)) {
      if (cc.group_by) {
        tableContent += `
          <tr class="group-header">
            <td colspan="10">
              <span class="group-icon">${this._getTypeIcon(groupName)}</span>
              <span class="group-name">${groupName}</span>
              <span class="group-count">(${groupAssets.length})</span>
            </td>
          </tr>
        `;
      }

      for (const asset of groupAssets) {
        tableContent += this._renderTableRow(asset);
      }
    }

    this.shadowRoot.innerHTML = `
      <style>${this._getBaseStyles()}${this._getTableStyles()}</style>
      <ha-card>
        ${cc.show_header ? this._renderHeader(assets, totals) : ''}
        
        ${cc.show_top_performers || cc.show_worst_performers ? this._renderPerformers(assets) : ''}
        
        <div class="table-container">
          <table class="asset-table">
            <thead>
              <tr>
                ${cc.show_asset_type ? `<th class="col-type">Typ</th>` : ''}
                <th class="col-name sortable" data-sort="name">
                  Name ${this._getSortIcon('name')}
                </th>
                <th class="col-price sortable" data-sort="price">
                  Preis ${this._getSortIcon('price')}
                </th>
                ${cc.show_24h_change ? `
                  <th class="col-change sortable" data-sort="change">
                    24h ${this._getSortIcon('change')}
                  </th>
                ` : ''}
                ${cc.show_7d_change ? `<th class="col-change">7d</th>` : ''}
                ${cc.show_30d_change ? `<th class="col-change">30d</th>` : ''}
                ${cc.show_sparkline ? `<th class="col-sparkline">Chart</th>` : ''}
                ${cc.show_market_cap ? `
                  <th class="col-mcap sortable" data-sort="market_cap">
                    MCap ${this._getSortIcon('market_cap')}
                  </th>
                ` : ''}
                ${cc.show_volume ? `<th class="col-volume">Vol</th>` : ''}
                ${cc.show_signal ? `<th class="col-signal">Signal</th>` : ''}
                ${cc.show_market_status ? `<th class="col-status">Status</th>` : ''}
                ${Object.keys(cc.holdings).length > 0 ? `
                  <th class="col-holdings sortable" data-sort="holdings">
                    Wert ${this._getSortIcon('holdings')}
                  </th>
                ` : ''}
              </tr>
            </thead>
            <tbody>
              ${tableContent}
            </tbody>
          </table>
        </div>
        
        ${cc.show_total_value && totals.assetsWithHoldings > 0 ? this._renderTotals(totals) : ''}
      </ha-card>
    `;

    this._attachEventListeners();
  }

  _renderTableRow(asset) {
    const cc = this._config;
    const changeColor = asset.isPositive ? cc.color_positive : cc.color_negative;
    const changeIcon = asset.isPositive ? '▲' : '▼';

    return `
      <tr class="asset-row" data-entity="${asset.entityId}">
        ${cc.show_asset_type ? `
          <td class="col-type">
            <span class="type-badge type-${asset.assetType.toLowerCase()}">
              ${this._getTypeIcon(asset.assetType)}
            </span>
          </td>
        ` : ''}
        
        <td class="col-name">
          <div class="name-cell">
            <span class="symbol">${asset.symbol}</span>
            <span class="name">${this._truncate(asset.name, 20)}</span>
          </div>
        </td>
        
        <td class="col-price">
          <span class="price">${this._formatPrice(asset.price, asset.currency)}</span>
        </td>
        
        ${cc.show_24h_change ? `
          <td class="col-change" style="color: ${changeColor}">
            <span class="change-icon">${changeIcon}</span>
            <span class="change-value">${Math.abs(asset.changePercent).toFixed(2)}%</span>
          </td>
        ` : ''}
        
        ${cc.show_7d_change ? `
          <td class="col-change" style="color: ${asset.weekChange >= 0 ? cc.color_positive : cc.color_negative}">
            ${asset.weekChange !== null ? `${asset.weekChange >= 0 ? '+' : ''}${asset.weekChange.toFixed(2)}%` : '-'}
          </td>
        ` : ''}
        
        ${cc.show_30d_change ? `
          <td class="col-change" style="color: ${asset.monthChange >= 0 ? cc.color_positive : cc.color_negative}">
            ${asset.monthChange !== null ? `${asset.monthChange >= 0 ? '+' : ''}${asset.monthChange.toFixed(2)}%` : '-'}
          </td>
        ` : ''}
        
        ${cc.show_sparkline ? `
          <td class="col-sparkline">
            ${this._renderSparkline(asset.sparklineData, asset.isPositive)}
          </td>
        ` : ''}
        
        ${cc.show_market_cap ? `
          <td class="col-mcap">${asset.marketCapFormatted || '-'}</td>
        ` : ''}
        
        ${cc.show_volume ? `
          <td class="col-volume">${asset.volumeFormatted || '-'}</td>
        ` : ''}
        
        ${cc.show_signal ? `
          <td class="col-signal">
            <span class="signal-badge signal-${asset.signal.toLowerCase().replace('_', '-')}">
              ${this._getSignalIcon(asset.signal)}
            </span>
          </td>
        ` : ''}
        
        ${cc.show_market_status ? `
          <td class="col-status">
            <span class="status-badge status-${asset.marketStatus?.status || 'unknown'}">
              ${this._getStatusIcon(asset.marketStatus?.status)}
            </span>
          </td>
        ` : ''}
        
        ${Object.keys(cc.holdings).length > 0 ? `
          <td class="col-holdings">
            ${asset.holdings > 0 ? `
              <div class="holdings-cell">
                <span class="holdings-value">${this._formatPrice(asset.holdingsValue, asset.currency)}</span>
                <span class="holdings-qty">${asset.holdings} Stk.</span>
              </div>
            ` : '-'}
          </td>
        ` : ''}
      </tr>
    `;
  }

  // =========================================================================
  // COMPACT VIEW
  // =========================================================================

  _renderCompact(assets, totals) {
    const cc = this._config;

    const cards = assets.map(asset => {
      const changeColor = asset.isPositive ? cc.color_positive : cc.color_negative;
      const changeIcon = asset.isPositive ? '▲' : '▼';

      return `
        <div class="compact-card" data-entity="${asset.entityId}">
          <div class="compact-header">
            <span class="type-icon">${this._getTypeIcon(asset.assetType)}</span>
            <span class="symbol">${asset.symbol}</span>
          </div>
          <div class="compact-price">${this._formatPrice(asset.price, asset.currency)}</div>
          <div class="compact-change" style="color: ${changeColor}">
            ${changeIcon} ${Math.abs(asset.changePercent).toFixed(2)}%
          </div>
          ${cc.show_sparkline ? `
            <div class="compact-sparkline">
              ${this._renderSparkline(asset.sparklineData, asset.isPositive)}
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    this.shadowRoot.innerHTML = `
      <style>${this._getBaseStyles()}${this._getCompactStyles()}</style>
      <ha-card>
        ${cc.show_header ? this._renderHeader(assets, totals) : ''}
        <div class="compact-grid">
          ${cards}
        </div>
        ${cc.show_total_value && totals.assetsWithHoldings > 0 ? this._renderTotals(totals) : ''}
      </ha-card>
    `;

    this._attachEventListeners();
  }

  // =========================================================================
  // HEATMAP VIEW
  // =========================================================================

  _renderHeatmap(assets, totals) {
    const cc = this._config;
    const maxMcap = Math.max(...assets.map(a => a.marketCap || 1));

    const tiles = assets.map(asset => {
      const changePercent = asset.changePercent || 0;
      const bgColor = this._getHeatmapColor(changePercent);
      const size = asset.marketCap ? Math.max(60, Math.min(150, (asset.marketCap / maxMcap) * 150)) : 80;

      return `
        <div class="heatmap-tile" 
             data-entity="${asset.entityId}"
             style="background-color: ${bgColor}; min-width: ${size}px; min-height: ${size}px;">
          <div class="tile-symbol">${asset.symbol}</div>
          <div class="tile-change">${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%</div>
          <div class="tile-price">${this._formatPrice(asset.price, asset.currency)}</div>
        </div>
      `;
    }).join('');

    this.shadowRoot.innerHTML = `
      <style>${this._getBaseStyles()}${this._getHeatmapStyles()}</style>
      <ha-card>
        ${cc.show_header ? this._renderHeader(assets, totals) : ''}
        <div class="heatmap-container">
          ${tiles}
        </div>
        ${cc.show_total_value && totals.assetsWithHoldings > 0 ? this._renderTotals(totals) : ''}
      </ha-card>
    `;

    this._attachEventListeners();
  }

  // =========================================================================
  // SHARED COMPONENTS
  // =========================================================================

  _renderHeader(assets, totals) {
    const cc = this._config;
    const totalAssets = assets.length;
    const positiveCount = assets.filter(a => a.changePercent > 0).length;
    const negativeCount = assets.filter(a => a.changePercent < 0).length;

    return `
      <div class="card-header">
        <div class="header-left">
          <h2 class="title">${cc.title}</h2>
          <div class="subtitle">
            ${totalAssets} Assets • 
            <span style="color: ${cc.color_positive}">▲${positiveCount}</span> 
            <span style="color: ${cc.color_negative}">▼${negativeCount}</span>
          </div>
        </div>
        <div class="header-right">
          <div class="view-toggle">
            <button class="view-btn ${cc.display_mode === 'table' ? 'active' : ''}" data-mode="table" title="Tabelle">
              ☰
            </button>
            <button class="view-btn ${cc.display_mode === 'compact' ? 'active' : ''}" data-mode="compact" title="Kompakt">
              ▦
            </button>
            <button class="view-btn ${cc.display_mode === 'heatmap' ? 'active' : ''}" data-mode="heatmap" title="Heatmap">
              ▩
            </button>
          </div>
        </div>
      </div>
    `;
  }

  _renderTotals(totals) {
    const cc = this._config;
    const changeColor = totals.totalChangePercent >= 0 ? cc.color_positive : cc.color_negative;

    return `
      <div class="totals-bar">
        <div class="total-item">
          <span class="total-label">💰 Portfolio-Wert</span>
          <span class="total-value">${this._formatPrice(totals.totalValue, 'EUR')}</span>
        </div>
        ${cc.show_total_change ? `
          <div class="total-item">
            <span class="total-label">📈 Heute</span>
            <span class="total-value" style="color: ${changeColor}">
              ${totals.totalChangePercent >= 0 ? '+' : ''}${totals.totalChangePercent.toFixed(2)}%
            </span>
          </div>
        ` : ''}
        <div class="total-item">
          <span class="total-label">📊 Assets</span>
          <span class="total-value">${totals.assetsWithHoldings}</span>
        </div>
      </div>
    `;
  }

  _renderPerformers(assets) {
    const cc = this._config;
    let content = '';

    if (cc.show_top_performers) {
      const top = this._getTopPerformers(assets, cc.performers_count);
      content += `
        <div class="performers-section">
          <div class="performers-title">🚀 Top Performer</div>
          <div class="performers-list">
            ${top.map(a => `
              <div class="performer-item positive" data-entity="${a.entityId}">
                <span class="performer-symbol">${a.symbol}</span>
                <span class="performer-change">+${a.changePercent.toFixed(2)}%</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    if (cc.show_worst_performers) {
      const worst = this._getWorstPerformers(assets, cc.performers_count);
      content += `
        <div class="performers-section">
          <div class="performers-title">📉 Schlechteste</div>
          <div class="performers-list">
            ${worst.map(a => `
              <div class="performer-item negative" data-entity="${a.entityId}">
                <span class="performer-symbol">${a.symbol}</span>
                <span class="performer-change">${a.changePercent.toFixed(2)}%</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    return `<div class="performers-container">${content}</div>`;
  }

  _renderSparkline(data, isPositive) {
    if (!data || data.length < 2) {
      return '<div class="sparkline-empty">-</div>';
    }

    const width = 60;
    const height = 24;
    const padding = 2;

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;

    const points = data.map((val, i) => {
      const x = padding + (i / (data.length - 1)) * (width - 2 * padding);
      const y = padding + (1 - (val - min) / range) * (height - 2 * padding);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

    const color = isPositive ? this._config.color_positive : this._config.color_negative;

    return `
      <svg class="sparkline" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <polyline
          points="${points}"
          fill="none"
          stroke="${color}"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
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

      .card-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px;
        border-bottom: 1px solid var(--divider-color, #e0e0e0);
      }

      .header-left .title {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        color: var(--primary-text-color);
      }

      .header-left .subtitle {
        font-size: 12px;
        color: var(--secondary-text-color);
        margin-top: 4px;
      }

      .view-toggle {
        display: flex;
        gap: 4px;
      }

      .view-btn {
        width: 32px;
        height: 32px;
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: 6px;
        background: var(--card-background-color);
        cursor: pointer;
        font-size: 14px;
        transition: all 0.2s;
      }

      .view-btn:hover {
        background: var(--secondary-background-color);
      }

      .view-btn.active {
        background: var(--primary-color);
        color: white;
        border-color: var(--primary-color);
      }

      .empty-state {
        padding: 40px 20px;
        text-align: center;
      }

      .empty-icon {
        font-size: 48px;
        margin-bottom: 16px;
      }

      .empty-title {
        font-size: 18px;
        font-weight: 600;
        color: var(--primary-text-color);
        margin-bottom: 8px;
      }

      .empty-text {
        font-size: 14px;
        color: var(--secondary-text-color);
      }

      .totals-bar {
        display: flex;
        justify-content: space-around;
        padding: 16px;
        background: var(--secondary-background-color);
        border-top: 1px solid var(--divider-color);
      }

      .total-item {
        text-align: center;
      }

      .total-label {
        display: block;
        font-size: 11px;
        color: var(--secondary-text-color);
        margin-bottom: 4px;
      }

      .total-value {
        font-size: 16px;
        font-weight: 700;
        color: var(--primary-text-color);
      }

      .performers-container {
        display: flex;
        gap: 16px;
        padding: 12px 16px;
        background: var(--secondary-background-color);
        overflow-x: auto;
      }

      .performers-section {
        flex: 1;
        min-width: 150px;
      }

      .performers-title {
        font-size: 11px;
        font-weight: 600;
        color: var(--secondary-text-color);
        margin-bottom: 8px;
      }

      .performers-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .performer-item {
        display: flex;
        justify-content: space-between;
        padding: 6px 10px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 12px;
      }

      .performer-item.positive {
        background: ${this._config.color_positive}15;
      }

      .performer-item.negative {
        background: ${this._config.color_negative}15;
      }

      .performer-item.positive .performer-change {
        color: ${this._config.color_positive};
      }

      .performer-item.negative .performer-change {
        color: ${this._config.color_negative};
      }

      .performer-symbol {
        font-weight: 600;
      }

      .type-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border-radius: 6px;
        font-size: 12px;
      }

      .type-badge.type-stock { background: #2196F315; }
      .type-badge.type-crypto { background: #FF980015; }
      .type-badge.type-forex { background: #4CAF5015; }
      .type-badge.type-commodity { background: #9C27B015; }
      .type-badge.type-index { background: #607D8B15; }
      .type-badge.type-bond { background: #79554815; }
      .type-badge.type-etf { background: #00BCD415; }

      .signal-badge {
        font-size: 14px;
      }

      .signal-badge.signal-strong-buy,
      .signal-badge.signal-buy {
        color: ${this._config.color_positive};
      }

      .signal-badge.signal-strong-sell,
      .signal-badge.signal-sell {
        color: ${this._config.color_negative};
      }

      .status-badge {
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 4px;
      }

      .status-badge.status-open {
        background: ${this._config.color_positive}20;
        color: ${this._config.color_positive};
      }

      .status-badge.status-closed,
      .status-badge.status-after_hours,
      .status-badge.status-pre_market {
        background: ${this._config.color_neutral}20;
        color: ${this._config.color_neutral};
      }

      .sparkline {
        display: block;
      }

      .sparkline-empty {
        color: var(--secondary-text-color);
        font-size: 12px;
      }
    `;
  }

  _getTableStyles() {
    return `
      .table-container {
        overflow-x: auto;
      }

      .asset-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }

      .asset-table th {
        text-align: left;
        padding: 10px 12px;
        font-size: 11px;
        font-weight: 600;
        color: var(--secondary-text-color);
        text-transform: uppercase;
        background: var(--secondary-background-color);
        border-bottom: 1px solid var(--divider-color);
        white-space: nowrap;
      }

      .asset-table th.sortable {
        cursor: pointer;
        user-select: none;
      }

      .asset-table th.sortable:hover {
        color: var(--primary-color);
      }

      .sort-icon {
        margin-left: 4px;
        font-size: 10px;
      }

      .asset-table td {
        padding: 12px;
        border-bottom: 1px solid var(--divider-color);
        vertical-align: middle;
      }

      .asset-row {
        cursor: pointer;
        transition: background 0.2s;
      }

      .asset-row:hover {
        background: var(--secondary-background-color);
      }

      .group-header td {
        background: var(--secondary-background-color);
        font-weight: 600;
        font-size: 12px;
        padding: 8px 12px;
      }

      .group-icon {
        margin-right: 8px;
      }

      .group-count {
        color: var(--secondary-text-color);
        font-weight: normal;
      }

      .name-cell {
        display: flex;
        flex-direction: column;
      }

      .name-cell .symbol {
        font-weight: 600;
        color: var(--primary-text-color);
      }

      .name-cell .name {
        font-size: 11px;
        color: var(--secondary-text-color);
        margin-top: 2px;
      }

      .col-price .price {
        font-weight: 600;
      }

      .col-change {
        font-weight: 600;
        white-space: nowrap;
      }

      .change-icon {
        font-size: 10px;
        margin-right: 2px;
      }

      .holdings-cell {
        display: flex;
        flex-direction: column;
      }

      .holdings-value {
        font-weight: 600;
      }

      .holdings-qty {
        font-size: 11px;
        color: var(--secondary-text-color);
      }

      .col-sparkline {
        width: 70px;
      }

      .col-mcap,
      .col-volume {
        text-align: right;
        color: var(--secondary-text-color);
      }

      .col-signal,
      .col-status {
        text-align: center;
      }
    `;
  }

  _getCompactStyles() {
    return `
      .compact-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 12px;
        padding: 16px;
      }

      .compact-card {
        background: var(--secondary-background-color);
        border-radius: 12px;
        padding: 12px;
        cursor: pointer;
        transition: transform 0.2s, box-shadow 0.2s;
      }

      .compact-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      }

      .compact-header {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 8px;
      }

      .compact-header .type-icon {
        font-size: 14px;
      }

      .compact-header .symbol {
        font-weight: 600;
        font-size: 14px;
        color: var(--primary-text-color);
      }

      .compact-price {
        font-size: 18px;
        font-weight: 700;
        color: var(--primary-text-color);
        margin-bottom: 4px;
      }

      .compact-change {
        font-size: 13px;
        font-weight: 600;
      }

      .compact-sparkline {
        margin-top: 8px;
      }
    `;
  }

  _getHeatmapStyles() {
    return `
      .heatmap-container {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        padding: 16px;
      }

      .heatmap-tile {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 8px;
        border-radius: 8px;
        cursor: pointer;
        transition: transform 0.2s, box-shadow 0.2s;
        color: white;
        text-shadow: 0 1px 2px rgba(0,0,0,0.3);
        flex: 1;
      }

      .heatmap-tile:hover {
        transform: scale(1.05);
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 1;
      }

      .tile-symbol {
        font-weight: 700;
        font-size: 14px;
      }

      .tile-change {
        font-size: 12px;
        font-weight: 600;
        margin: 4px 0;
      }

      .tile-price {
        font-size: 10px;
        opacity: 0.9;
      }
    `;
  }

  // =========================================================================
  // HELPERS
  // =========================================================================

  _formatPrice(value, currency) {
    if (value === null || value === undefined || isNaN(value)) return '-';
    
    const decimals = value < 1 ? 4 : value < 100 ? 2 : 2;
    const symbols = { USD: '$', EUR: '€', GBP: '£', CHF: 'CHF ', JPY: '¥' };
    const symbol = symbols[currency] || currency + ' ';
    
    return symbol + new Intl.NumberFormat('de-DE', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  }

  _formatVolume(value) {
    if (!value) return null;
    value = parseFloat(value);
    if (value >= 1e9) return (value / 1e9).toFixed(2) + 'B';
    if (value >= 1e6) return (value / 1e6).toFixed(2) + 'M';
    if (value >= 1e3) return (value / 1e3).toFixed(1) + 'K';
    return value.toLocaleString('de-DE');
  }

  _formatMarketCap(value) {
    if (!value) return null;
    value = parseFloat(value);
    if (value >= 1e12) return (value / 1e12).toFixed(2) + 'T';
    if (value >= 1e9) return (value / 1e9).toFixed(2) + 'B';
    if (value >= 1e6) return (value / 1e6).toFixed(2) + 'M';
    return value.toLocaleString('de-DE');
  }

  _truncate(str, maxLength) {
    if (!str) return '';
    return str.length > maxLength ? str.substring(0, maxLength) + '...' : str;
  }

  _getTypeIcon(type) {
    const icons = {
      STOCK: '📈',
      CRYPTO: '🪙',
      CRYPTOCURRENCY: '🪙',
      FOREX: '💱',
      COMMODITY: '🛢️',
      INDEX: '📊',
      ETF: '📦',
      BOND: '📜',
    };
    return icons[type] || icons[type?.toUpperCase()] || '📈';
  }

  _getTypeLabel(type) {
    const labels = {
      STOCK: 'Aktien',
      CRYPTO: 'Krypto',
      CRYPTOCURRENCY: 'Krypto',
      FOREX: 'Devisen',
      COMMODITY: 'Rohstoffe',
      INDEX: 'Indizes',
      ETF: 'ETFs',
      BOND: 'Anleihen',
    };
    return labels[type] || labels[type?.toUpperCase()] || type;
  }

  _getSignalIcon(signal) {
    const icons = {
      STRONG_BUY: '🟢',
      BUY: '🟩',
      HOLD: '🟨',
      SELL: '🟧',
      STRONG_SELL: '🔴',
    };
    return icons[signal] || '⚪';
  }

  _getStatusIcon(status) {
    const icons = {
      open: '🟢',
      closed: '🔴',
      pre_market: '🟡',
      after_hours: '🟠',
    };
    return icons[status] || '⚪';
  }

  _getSortIcon(column) {
    if (this._sortColumn !== column) return '';
    return `<span class="sort-icon">${this._sortDirection === 'asc' ? '▲' : '▼'}</span>`;
  }

  _getHeatmapColor(changePercent) {
    const intensity = Math.min(Math.abs(changePercent) / 10, 1);
    
    if (changePercent >= 0) {
      const r = Math.round(76 - intensity * 30);
      const g = Math.round(175 - intensity * 50);
      const b = Math.round(80 - intensity * 30);
      return `rgb(${r}, ${g}, ${b})`;
    } else {
      const r = Math.round(244 - intensity * 50);
      const g = Math.round(67 - intensity * 30);
      const b = Math.round(54 - intensity * 20);
      return `rgb(${r}, ${g}, ${b})`;
    }
  }

  // =========================================================================
  // EVENT HANDLERS
  // =========================================================================

  _attachEventListeners() {
    this.shadowRoot.querySelectorAll('[data-entity]').forEach(el => {
      el.addEventListener('click', (e) => {
        const entityId = el.dataset.entity;
        if (entityId) {
          this._handleRowClick(entityId);
        }
      });
    });

    this.shadowRoot.querySelectorAll('th.sortable').forEach(th => {
      th.addEventListener('click', (e) => {
        const column = th.dataset.sort;
        if (column) {
          if (this._sortColumn === column) {
            this._sortDirection = this._sortDirection === 'asc' ? 'desc' : 'asc';
          } else {
            this._sortColumn = column;
            this._sortDirection = 'asc';
          }
          this._render();
        }
      });
    });

    this.shadowRoot.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const mode = btn.dataset.mode;
        if (mode && mode !== this._config.display_mode) {
          this._config.display_mode = mode;
          this._render();
        }
      });
    });
  }

  _handleRowClick(entityId) {
    if (!this._config.popup_on_click) return;

    const event = new Event('hass-more-info', {
      bubbles: true,
      composed: true,
    });
    event.detail = { entityId };
    this.dispatchEvent(event);
  }

  // =========================================================================
  // CARD CONFIG
  // =========================================================================

  static getConfigElement() {
    return document.createElement('stock-tracker-list-card-editor');
  }

  static getStubConfig() {
    return {
      title: '📊 Portfolio',
      display_mode: 'table',
      show_sparkline: true,
      show_24h_change: true,
      popup_on_click: true,
    };
  }
}


// =============================================================================
// CARD EDITOR - STABILISIERT (kein Flackern mehr)
// =============================================================================

class StockTrackerListCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
    this._hass = null;
    this._expandedGroups = new Set();
    this._expandedSections = new Set(['entities']); // Standard: Entities offen
    this._rendered = false;
  }

  setConfig(config) {
    this._config = { ...config };
    // Nur neu rendern wenn schon einmal gerendert wurde
    if (this._rendered && this._hass) {
      this._updateValues();
    }
  }

  set hass(hass) {
    const firstRender = !this._hass;
    this._hass = hass;
    
    // Nur beim ersten Mal komplett rendern
    if (firstRender || !this._rendered) {
      this._render();
      this._rendered = true;
    }
  }

  /**
   * Findet ALLE Stock Tracker Entities
   */
  _getStockEntities() {
    if (!this._hass || !this._hass.states) return [];

    const entities = [];

    for (const [entityId, state] of Object.entries(this._hass.states)) {
      if (!entityId.startsWith('sensor.')) continue;

      const attrs = state.attributes || {};
      
      const isStockSensor = (
        attrs.data_source !== undefined ||
        attrs.change_percent !== undefined ||
        attrs.overall_signal !== undefined ||
        attrs.previous_close !== undefined ||
        (attrs.symbol !== undefined && attrs.currency !== undefined) ||
        attrs.market_cap !== undefined ||
        attrs.today_high !== undefined ||
        attrs.today_low !== undefined ||
        attrs.history_closes !== undefined ||
        attrs.asset_type !== undefined ||
        attrs.quote_type !== undefined
      );

      if (isStockSensor) {
        let symbol = attrs.symbol || '';
        if (!symbol) {
          const match = entityId.match(/sensor\.([a-zA-Z0-9_-]+?)(?:_price|_trend)?$/);
          if (match) {
            symbol = match[1].toUpperCase().replace(/_/g, '-');
          }
        }

        let assetType = attrs.asset_type || attrs.quote_type || 'STOCK';
        if (assetType === 'CRYPTOCURRENCY') assetType = 'CRYPTO';
        if (assetType === 'EQUITY') assetType = 'STOCK';

        let typeIcon = '📈';
        if (assetType === 'CRYPTO') typeIcon = '🪙';
        else if (assetType === 'FOREX') typeIcon = '💱';
        else if (assetType === 'COMMODITY') typeIcon = '🛢️';
        else if (assetType === 'INDEX') typeIcon = '📊';
        else if (assetType === 'ETF') typeIcon = '📦';
        else if (assetType === 'BOND') typeIcon = '📜';

        entities.push({
          id: entityId,
          symbol: symbol || entityId.replace('sensor.', ''),
          name: attrs.company_name || attrs.friendly_name || symbol || entityId,
          type: assetType,
          typeIcon: typeIcon,
          price: state.state,
          currency: attrs.currency || 'USD',
          changePercent: attrs.change_percent,
        });
      }
    }

    entities.sort((a, b) => {
      const typeOrder = { 'INDEX': 0, 'STOCK': 1, 'ETF': 2, 'CRYPTO': 3, 'FOREX': 4, 'COMMODITY': 5, 'BOND': 6, 'OTHER': 99 };
      const aOrder = typeOrder[a.type] ?? 99;
      const bOrder = typeOrder[b.type] ?? 99;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.symbol.localeCompare(b.symbol);
    });

    return entities;
  }

  /**
   * Aktualisiert nur die Werte ohne komplett neu zu rendern
   */
  _updateValues() {
    const c = this._config;
    const selectedEntities = c.entities || [];

    // Update checkboxes
    this.shadowRoot.querySelectorAll('.entity-checkbox').forEach(cb => {
      cb.checked = selectedEntities.includes(cb.dataset.entity);
    });

    // Update form values
    const setVal = (id, val) => {
      const el = this.shadowRoot.getElementById(id);
      if (el) {
        if (el.type === 'checkbox') {
          el.checked = val;
        } else {
          el.value = val;
        }
      }
    };

    setVal('title', c.title || '📊 Portfolio');
    setVal('display_mode', c.display_mode || 'table');
    setVal('show_header', c.show_header !== false);
    setVal('show_24h_change', c.show_24h_change !== false);
    setVal('show_7d_change', c.show_7d_change || false);
    setVal('show_30d_change', c.show_30d_change || false);
    setVal('show_sparkline', c.show_sparkline !== false);
    setVal('show_market_cap', c.show_market_cap || false);
    setVal('show_volume', c.show_volume || false);
    setVal('show_signal', c.show_signal || false);
    setVal('show_market_status', c.show_market_status || false);
    setVal('show_asset_type', c.show_asset_type !== false);
    setVal('sort_by', c.sort_by || 'name');
    setVal('sort_order', c.sort_order || 'asc');
    setVal('group_by', c.group_by || '');
    setVal('show_top_performers', c.show_top_performers || false);
    setVal('show_worst_performers', c.show_worst_performers || false);
    setVal('show_total_value', c.show_total_value || false);
    setVal('popup_on_click', c.popup_on_click !== false);
    setVal('max_items', c.max_items || 50);

    this._updateEntityDisplay();
  }

  /**
   * Aktualisiert nur die Entity-Anzeige (Counts, Styling)
   */
  _updateEntityDisplay() {
    const selected = [];
    this.shadowRoot.querySelectorAll('.entity-checkbox:checked').forEach(cb => {
      selected.push(cb.dataset.entity);
    });

    // Update badge
    const badge = this.shadowRoot.querySelector('.entity-count-badge');
    if (badge) {
      const total = this.shadowRoot.querySelectorAll('.entity-checkbox').length;
      badge.textContent = `${selected.length} von ${total} Assets ausgewählt`;
    }

    // Update header count
    const header = this.shadowRoot.querySelector('[data-section="entities"] .section-count');
    if (header) {
      const total = this.shadowRoot.querySelectorAll('.entity-checkbox').length;
      header.textContent = `${selected.length}/${total}`;
    }

    // Update group counts and buttons
    this.shadowRoot.querySelectorAll('.entity-group').forEach(group => {
      const checkboxes = group.querySelectorAll('.entity-checkbox');
      const checkedCount = group.querySelectorAll('.entity-checkbox:checked').length;
      const totalCount = checkboxes.length;
      
      const countSpan = group.querySelector('.entity-group-count');
      if (countSpan) {
        countSpan.textContent = `(${checkedCount}/${totalCount})`;
      }
      
      const btn = group.querySelector('.select-group-btn');
      if (btn) {
        btn.textContent = checkedCount === totalCount ? 'Keine' : 'Alle';
      }
    });

    // Update item styling
    this.shadowRoot.querySelectorAll('.entity-item').forEach(item => {
      const cb = item.querySelector('.entity-checkbox');
      item.classList.toggle('selected', cb && cb.checked);
    });
  }

  _render() {
    if (!this._hass) {
      this.shadowRoot.innerHTML = '<div style="padding:16px">Lade Home Assistant...</div>';
      return;
    }

    const c = this._config;
    const allEntities = this._getStockEntities();
    const selectedEntities = c.entities || [];

    // Gruppiere nach Typ
    const groupedEntities = {};
    allEntities.forEach(e => {
      const type = e.type || 'OTHER';
      if (!groupedEntities[type]) groupedEntities[type] = [];
      groupedEntities[type].push(e);
    });

    const typeLabels = {
      'INDEX': '📊 Indizes',
      'STOCK': '📈 Aktien',
      'ETF': '📦 ETFs',
      'CRYPTO': '🪙 Krypto',
      'FOREX': '💱 Devisen',
      'COMMODITY': '🛢️ Rohstoffe',
      'BOND': '📜 Anleihen',
      'OTHER': '📋 Sonstige',
    };

    // Initial alle Entity-Gruppen expandieren
    if (this._expandedGroups.size === 0) {
      Object.keys(groupedEntities).forEach(type => this._expandedGroups.add(type));
    }

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
        }
        
        .editor {
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 16px;
        }
        
        /* Sections */
        .section {
          border: 1px solid var(--divider-color, #e0e0e0);
          border-radius: 8px;
          overflow: hidden;
        }
        
        .section-header {
          padding: 12px 14px;
          font-weight: 600;
          font-size: 14px;
          cursor: pointer;
          background: var(--secondary-background-color);
          display: flex;
          justify-content: space-between;
          align-items: center;
          user-select: none;
        }
        
        .section-header:hover {
          background: var(--divider-color);
        }
        
        .section-header .expand-arrow {
          font-size: 10px;
          transition: transform 0.2s;
        }
        
        .section.collapsed .expand-arrow {
          transform: rotate(-90deg);
        }
        
        .section-content {
          padding: 14px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          border-top: 1px solid var(--divider-color);
        }
        
        .section.collapsed .section-content {
          display: none;
        }
        
        /* Form Elements */
        .field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        
        .field label {
          font-weight: 500;
          font-size: 13px;
          color: var(--primary-text-color);
        }
        
        select, input[type="text"] {
          padding: 10px 12px;
          border: 1px solid var(--divider-color, #e0e0e0);
          border-radius: 8px;
          background: var(--card-background-color);
          font-size: 14px;
          color: var(--primary-text-color);
          width: 100%;
          box-sizing: border-box;
        }
        
        select:focus, input[type="text"]:focus {
          outline: none;
          border-color: var(--primary-color);
        }
        
        .checkbox-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 6px 0;
        }
        
        .checkbox-row input[type="checkbox"] {
          width: 18px;
          height: 18px;
          cursor: pointer;
          flex-shrink: 0;
        }
        
        .checkbox-row label {
          cursor: pointer;
          user-select: none;
          font-size: 13px;
          flex: 1;
        }
        
        /* Entity Selection */
        .entity-actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        
        .entity-action-btn {
          padding: 8px 14px;
          border: 1px solid var(--divider-color);
          border-radius: 20px;
          background: var(--card-background-color);
          cursor: pointer;
          font-size: 12px;
          transition: all 0.15s;
          white-space: nowrap;
        }
        
        .entity-action-btn:hover {
          background: var(--primary-color);
          color: white;
          border-color: var(--primary-color);
        }
        
        .entity-count-badge {
          background: var(--primary-color);
          color: white;
          padding: 10px 14px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          text-align: center;
        }
        
        .entity-list {
          border: 1px solid var(--divider-color);
          border-radius: 8px;
          max-height: 400px;
          overflow-y: auto;
        }
        
        .entity-group {
          border-bottom: 1px solid var(--divider-color);
        }
        
        .entity-group:last-child {
          border-bottom: none;
        }
        
        .entity-group-header {
          padding: 10px 12px;
          background: var(--secondary-background-color);
          font-weight: 600;
          font-size: 13px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          cursor: pointer;
          user-select: none;
          position: sticky;
          top: 0;
          z-index: 1;
        }
        
        .entity-group-header:hover {
          background: var(--divider-color);
        }
        
        .entity-group-info {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .entity-group-count {
          font-size: 11px;
          color: var(--secondary-text-color);
          font-weight: normal;
        }
        
        .group-expand-icon {
          font-size: 10px;
          transition: transform 0.2s;
        }
        
        .entity-group.collapsed .group-expand-icon {
          transform: rotate(-90deg);
        }
        
        .entity-group.collapsed .entity-group-items {
          display: none;
        }
        
        .entity-group-items {
          /* Keine max-height hier, da parent schon scrollbar */
        }
        
        .entity-item {
          display: flex;
          align-items: center;
          padding: 10px 12px;
          gap: 10px;
          cursor: pointer;
          border-bottom: 1px solid var(--divider-color);
          transition: background 0.1s;
        }
        
        .entity-item:last-child {
          border-bottom: none;
        }
        
        .entity-item:hover {
          background: rgba(var(--rgb-primary-color, 33, 150, 243), 0.08);
        }
        
        .entity-item.selected {
          background: rgba(var(--rgb-primary-color, 33, 150, 243), 0.15);
        }
        
        .entity-item input[type="checkbox"] {
          width: 18px;
          height: 18px;
          cursor: pointer;
          flex-shrink: 0;
        }
        
        .entity-item .icon {
          font-size: 20px;
          flex-shrink: 0;
          width: 24px;
          text-align: center;
        }
        
        .entity-item .info {
          flex: 1;
          min-width: 0;
          overflow: hidden;
        }
        
        .entity-item .symbol {
          font-weight: 600;
          font-size: 14px;
          color: var(--primary-text-color);
        }
        
        .entity-item .name {
          font-size: 11px;
          color: var(--secondary-text-color);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        
        .entity-item .price-info {
          text-align: right;
          flex-shrink: 0;
        }
        
        .entity-item .price {
          font-size: 13px;
          font-weight: 500;
          color: var(--primary-text-color);
        }
        
        .entity-item .change {
          font-size: 11px;
          font-weight: 600;
        }
        
        .entity-item .change.positive {
          color: #4CAF50;
        }
        
        .entity-item .change.negative {
          color: #F44336;
        }
        
        .select-group-btn {
          font-size: 11px;
          padding: 4px 10px;
          border: 1px solid var(--divider-color);
          border-radius: 4px;
          background: var(--card-background-color);
          cursor: pointer;
          transition: all 0.15s;
        }
        
        .select-group-btn:hover {
          background: var(--primary-color);
          color: white;
          border-color: var(--primary-color);
        }
        
        .no-entities {
          padding: 40px 20px;
          text-align: center;
          color: var(--secondary-text-color);
        }
        
        .no-entities .icon {
          font-size: 48px;
          margin-bottom: 12px;
        }
        
        .no-entities .title {
          font-weight: 600;
          font-size: 16px;
          margin-bottom: 8px;
          color: var(--primary-text-color);
        }
        
        .checkbox-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 4px 16px;
        }
        
        @media (max-width: 400px) {
          .checkbox-grid {
            grid-template-columns: 1fr;
          }
        }
      </style>
      
      <div class="editor">
        
        <!-- ENTITIES AUSWAHL -->
        <div class="section ${this._expandedSections.has('entities') ? '' : 'collapsed'}" data-section="entities">
          <div class="section-header">
            <span>📊 Assets auswählen</span>
            <span style="display:flex;align-items:center;gap:8px;">
              <span class="section-count">${selectedEntities.length}/${allEntities.length}</span>
              <span class="expand-arrow">▼</span>
            </span>
          </div>
          <div class="section-content">
            ${allEntities.length === 0 ? `
              <div class="no-entities">
                <div class="icon">📊</div>
                <div class="title">Keine Stock Tracker Sensoren gefunden</div>
                <div>Stelle sicher, dass die Stock Tracker Integration installiert ist und Assets hinzugefügt wurden.</div>
              </div>
            ` : `
              <div class="entity-actions">
                <button class="entity-action-btn" data-action="select-all">✓ Alle (${allEntities.length})</button>
                <button class="entity-action-btn" data-action="select-none">✗ Keine</button>
                ${Object.entries(groupedEntities).map(([type, list]) => `
                  <button class="entity-action-btn" data-action="select-type" data-type="${type}">
                    ${typeLabels[type]?.split(' ')[0] || '📋'} ${list.length}
                  </button>
                `).join('')}
              </div>
              
              <div class="entity-count-badge">
                ${selectedEntities.length} von ${allEntities.length} Assets ausgewählt
              </div>
              
              <div class="entity-list">
                ${Object.entries(groupedEntities).map(([type, entities]) => {
                  const selectedInGroup = entities.filter(e => selectedEntities.includes(e.id)).length;
                  const isExpanded = this._expandedGroups.has(type);
                  return `
                    <div class="entity-group ${isExpanded ? '' : 'collapsed'}" data-group-type="${type}">
                      <div class="entity-group-header">
                        <div class="entity-group-info">
                          <span class="group-expand-icon">▼</span>
                          <span>${typeLabels[type] || type}</span>
                          <span class="entity-group-count">(${selectedInGroup}/${entities.length})</span>
                        </div>
                        <button class="select-group-btn" data-type="${type}">
                          ${selectedInGroup === entities.length ? 'Keine' : 'Alle'}
                        </button>
                      </div>
                      <div class="entity-group-items">
                        ${entities.map(e => {
                          const isSelected = selectedEntities.includes(e.id);
                          const changeNum = parseFloat(e.changePercent) || 0;
                          const changeClass = changeNum >= 0 ? 'positive' : 'negative';
                          const changeText = !isNaN(changeNum) && changeNum !== 0 
                            ? `${changeNum >= 0 ? '+' : ''}${changeNum.toFixed(2)}%` 
                            : '';
                          return `
                            <div class="entity-item ${isSelected ? 'selected' : ''}" data-entity-id="${e.id}">
                              <input type="checkbox" 
                                     class="entity-checkbox"
                                     data-entity="${e.id}" 
                                     ${isSelected ? 'checked' : ''}>
                              <span class="icon">${e.typeIcon}</span>
                              <div class="info">
                                <div class="symbol">${e.symbol}</div>
                                <div class="name" title="${e.name}">${e.name}</div>
                              </div>
                              <div class="price-info">
                                <div class="price">${e.price} ${e.currency}</div>
                                ${changeText ? `<div class="change ${changeClass}">${changeText}</div>` : ''}
                              </div>
                            </div>
                          `;
                        }).join('')}
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            `}
          </div>
        </div>

        <!-- ANZEIGE -->
        <div class="section ${this._expandedSections.has('display') ? '' : 'collapsed'}" data-section="display">
          <div class="section-header">
            <span>🎨 Anzeige</span>
            <span class="expand-arrow">▼</span>
          </div>
          <div class="section-content">
            <div class="field">
              <label>Titel</label>
              <input type="text" id="title" value="${c.title || '📊 Portfolio'}">
            </div>
            <div class="field">
              <label>Anzeige-Modus</label>
              <select id="display_mode">
                <option value="table" ${c.display_mode === 'table' ? 'selected' : ''}>📋 Tabelle</option>
                <option value="compact" ${c.display_mode === 'compact' ? 'selected' : ''}>🔲 Kompakt (Kacheln)</option>
                <option value="heatmap" ${c.display_mode === 'heatmap' ? 'selected' : ''}>🗺️ Heatmap</option>
              </select>
            </div>
          </div>
        </div>

        <!-- SPALTEN -->
        <div class="section ${this._expandedSections.has('columns') ? '' : 'collapsed'}" data-section="columns">
          <div class="section-header">
            <span>👁️ Sichtbare Spalten</span>
            <span class="expand-arrow">▼</span>
          </div>
          <div class="section-content">
            <div class="checkbox-grid">
              <div class="checkbox-row">
                <input type="checkbox" id="show_asset_type" ${c.show_asset_type !== false ? 'checked' : ''}>
                <label for="show_asset_type">Asset-Typ</label>
              </div>
              <div class="checkbox-row">
                <input type="checkbox" id="show_24h_change" ${c.show_24h_change !== false ? 'checked' : ''}>
                <label for="show_24h_change">24h Änderung</label>
              </div>
              <div class="checkbox-row">
                <input type="checkbox" id="show_7d_change" ${c.show_7d_change ? 'checked' : ''}>
                <label for="show_7d_change">7d Änderung</label>
              </div>
              <div class="checkbox-row">
                <input type="checkbox" id="show_30d_change" ${c.show_30d_change ? 'checked' : ''}>
                <label for="show_30d_change">30d Änderung</label>
              </div>
              <div class="checkbox-row">
                <input type="checkbox" id="show_sparkline" ${c.show_sparkline !== false ? 'checked' : ''}>
                <label for="show_sparkline">Mini-Chart</label>
              </div>
              <div class="checkbox-row">
                <input type="checkbox" id="show_market_cap" ${c.show_market_cap ? 'checked' : ''}>
                <label for="show_market_cap">Marktkapital.</label>
              </div>
              <div class="checkbox-row">
                <input type="checkbox" id="show_volume" ${c.show_volume ? 'checked' : ''}>
                <label for="show_volume">Volumen</label>
              </div>
              <div class="checkbox-row">
                <input type="checkbox" id="show_signal" ${c.show_signal ? 'checked' : ''}>
                <label for="show_signal">Signal</label>
              </div>
              <div class="checkbox-row">
                <input type="checkbox" id="show_market_status" ${c.show_market_status ? 'checked' : ''}>
                <label for="show_market_status">Markt-Status</label>
              </div>
            </div>
          </div>
        </div>

        <!-- SORTIERUNG -->
        <div class="section ${this._expandedSections.has('sorting') ? '' : 'collapsed'}" data-section="sorting">
          <div class="section-header">
            <span>📊 Sortierung</span>
            <span class="expand-arrow">▼</span>
          </div>
          <div class="section-content">
            <div class="field">
              <label>Sortieren nach</label>
              <select id="sort_by">
                <option value="name" ${c.sort_by === 'name' ? 'selected' : ''}>Name</option>
                <option value="price" ${c.sort_by === 'price' ? 'selected' : ''}>Preis</option>
                <option value="change" ${c.sort_by === 'change' ? 'selected' : ''}>Änderung</option>
                <option value="market_cap" ${c.sort_by === 'market_cap' ? 'selected' : ''}>Marktkapitalisierung</option>
                <option value="type" ${c.sort_by === 'type' ? 'selected' : ''}>Asset-Typ</option>
              </select>
            </div>
            <div class="field">
              <label>Reihenfolge</label>
              <select id="sort_order">
                <option value="asc" ${c.sort_order === 'asc' ? 'selected' : ''}>Aufsteigend ↑</option>
                <option value="desc" ${c.sort_order === 'desc' ? 'selected' : ''}>Absteigend ↓</option>
              </select>
            </div>
            <div class="field">
              <label>Gruppieren</label>
              <select id="group_by">
                <option value="" ${!c.group_by ? 'selected' : ''}>Keine Gruppierung</option>
                <option value="type" ${c.group_by === 'type' ? 'selected' : ''}>Nach Asset-Typ</option>
                <option value="sector" ${c.group_by === 'sector' ? 'selected' : ''}>Nach Sektor</option>
              </select>
            </div>
          </div>
        </div>

        <!-- OPTIONEN -->
        <div class="section ${this._expandedSections.has('options') ? '' : 'collapsed'}" data-section="options">
          <div class="section-header">
            <span>⚙️ Optionen</span>
            <span class="expand-arrow">▼</span>
          </div>
          <div class="section-content">
            <div class="checkbox-grid">
              <div class="checkbox-row">
                <input type="checkbox" id="show_header" ${c.show_header !== false ? 'checked' : ''}>
                <label for="show_header">Header</label>
              </div>
              <div class="checkbox-row">
                <input type="checkbox" id="popup_on_click" ${c.popup_on_click !== false ? 'checked' : ''}>
                <label for="popup_on_click">Popup bei Klick</label>
              </div>
              <div class="checkbox-row">
                <input type="checkbox" id="show_top_performers" ${c.show_top_performers ? 'checked' : ''}>
                <label for="show_top_performers">Top Performer</label>
              </div>
              <div class="checkbox-row">
                <input type="checkbox" id="show_worst_performers" ${c.show_worst_performers ? 'checked' : ''}>
                <label for="show_worst_performers">Worst Performer</label>
              </div>
              <div class="checkbox-row">
                <input type="checkbox" id="show_total_value" ${c.show_total_value ? 'checked' : ''}>
                <label for="show_total_value">Portfolio-Wert</label>
              </div>
            </div>
            <div class="field">
              <label>Max. Anzahl Assets</label>
              <select id="max_items">
                <option value="10" ${c.max_items === 10 ? 'selected' : ''}>10</option>
                <option value="25" ${c.max_items === 25 ? 'selected' : ''}>25</option>
                <option value="50" ${(c.max_items || 50) === 50 ? 'selected' : ''}>50</option>
                <option value="100" ${c.max_items === 100 ? 'selected' : ''}>100</option>
              </select>
            </div>
          </div>
        </div>
        
      </div>
    `;

    this._attachListeners();
  }

  _attachListeners() {
    // Section headers (expand/collapse)
    this.shadowRoot.querySelectorAll('.section-header').forEach(header => {
      header.addEventListener('click', (e) => {
        e.stopPropagation();
        const section = header.closest('.section');
        const sectionName = section.dataset.section;
        
        section.classList.toggle('collapsed');
        
        if (section.classList.contains('collapsed')) {
          this._expandedSections.delete(sectionName);
        } else {
          this._expandedSections.add(sectionName);
        }
      });
    });

    // Entity group headers (expand/collapse)
    this.shadowRoot.querySelectorAll('.entity-group-header').forEach(header => {
      header.addEventListener('click', (e) => {
        // Ignoriere Klicks auf den Button
        if (e.target.closest('.select-group-btn')) return;
        
        e.stopPropagation();
        const group = header.closest('.entity-group');
        const type = group.dataset.groupType;
        
        group.classList.toggle('collapsed');
        
        if (group.classList.contains('collapsed')) {
          this._expandedGroups.delete(type);
        } else {
          this._expandedGroups.add(type);
        }
      });
    });

    // Entity items (click to toggle)
    this.shadowRoot.querySelectorAll('.entity-item').forEach(item => {
      item.addEventListener('click', (e) => {
        // Ignoriere direkte Checkbox-Klicks
        if (e.target.type === 'checkbox') return;
        
        e.stopPropagation();
        const checkbox = item.querySelector('.entity-checkbox');
        if (checkbox) {
          checkbox.checked = !checkbox.checked;
          this._onEntityChange();
        }
      });
    });

    // Entity checkboxes
    this.shadowRoot.querySelectorAll('.entity-checkbox').forEach(cb => {
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        this._onEntityChange();
      });
    });

    // Select group buttons
    this.shadowRoot.querySelectorAll('.select-group-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        
        const type = btn.dataset.type;
        const group = btn.closest('.entity-group');
        const checkboxes = group.querySelectorAll('.entity-checkbox');
        
        const allChecked = Array.from(checkboxes).every(cb => cb.checked);
        checkboxes.forEach(cb => cb.checked = !allChecked);
        
        this._onEntityChange();
      });
    });

    // Quick action buttons
    this.shadowRoot.querySelectorAll('.entity-action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        
        const action = btn.dataset.action;
        
        if (action === 'select-all') {
          this.shadowRoot.querySelectorAll('.entity-checkbox').forEach(cb => cb.checked = true);
        } else if (action === 'select-none') {
          this.shadowRoot.querySelectorAll('.entity-checkbox').forEach(cb => cb.checked = false);
        } else if (action === 'select-type') {
          const type = btn.dataset.type;
          // Erst alle aus
          this.shadowRoot.querySelectorAll('.entity-checkbox').forEach(cb => cb.checked = false);
          // Dann nur die des Typs an
          const group = this.shadowRoot.querySelector(`[data-group-type="${type}"]`);
          if (group) {
            group.querySelectorAll('.entity-checkbox').forEach(cb => cb.checked = true);
            // Gruppe expandieren
            group.classList.remove('collapsed');
            this._expandedGroups.add(type);
          }
        }
        
        this._onEntityChange();
      });
    });

    // Form elements
    this.shadowRoot.querySelectorAll('select').forEach(el => {
      el.addEventListener('change', (e) => {
        e.stopPropagation();
        this._onFormChange();
      });
    });

    this.shadowRoot.querySelectorAll('input[type="checkbox"]:not(.entity-checkbox)').forEach(el => {
      el.addEventListener('change', (e) => {
        e.stopPropagation();
        this._onFormChange();
      });
    });

    this.shadowRoot.querySelectorAll('input[type="text"]').forEach(el => {
      let timeout;
      el.addEventListener('input', (e) => {
        e.stopPropagation();
        clearTimeout(timeout);
        timeout = setTimeout(() => this._onFormChange(), 300);
      });
    });
  }

  _onEntityChange() {
    const selected = [];
    this.shadowRoot.querySelectorAll('.entity-checkbox:checked').forEach(cb => {
      selected.push(cb.dataset.entity);
    });

    this._config = { ...this._config, entities: selected };
    this._fireConfigChanged();
    this._updateEntityDisplay();
  }

  _onFormChange() {
    const getValue = (id) => {
      const el = this.shadowRoot.getElementById(id);
      if (!el) return undefined;
      if (el.type === 'checkbox') return el.checked;
      return el.value;
    };

    this._config = {
      ...this._config,
      title: getValue('title'),
      display_mode: getValue('display_mode'),
      show_header: getValue('show_header'),
      show_24h_change: getValue('show_24h_change'),
      show_7d_change: getValue('show_7d_change'),
      show_30d_change: getValue('show_30d_change'),
      show_sparkline: getValue('show_sparkline'),
      show_market_cap: getValue('show_market_cap'),
      show_volume: getValue('show_volume'),
      show_signal: getValue('show_signal'),
      show_market_status: getValue('show_market_status'),
      show_asset_type: getValue('show_asset_type'),
      sort_by: getValue('sort_by'),
      sort_order: getValue('sort_order'),
      group_by: getValue('group_by') || null,
      show_top_performers: getValue('show_top_performers'),
      show_worst_performers: getValue('show_worst_performers'),
      show_total_value: getValue('show_total_value'),
      popup_on_click: getValue('popup_on_click'),
      max_items: parseInt(getValue('max_items')) || 50,
    };

    this._fireConfigChanged();
  }

  _fireConfigChanged() {
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: this._config },
      bubbles: true,
      composed: true,
    }));
  }
}

// =============================================================================
// REGISTER
// =============================================================================

if (!customElements.get('stock-tracker-list-card')) {
  customElements.define('stock-tracker-list-card', StockTrackerListCard);
  console.info(
    '%c 📊 STOCK-TRACKER-LIST-CARD %c v1.0.2 ',
    'color:white;background:#4CAF50;font-weight:bold;padding:2px 6px;border-radius:3px 0 0 3px',
    'color:#4CAF50;background:white;font-weight:bold;padding:2px 6px;border-radius:0 3px 3px 0;border:1px solid #4CAF50'
  );
}

if (!customElements.get('stock-tracker-list-card-editor')) {
  customElements.define('stock-tracker-list-card-editor', StockTrackerListCardEditor);
}

window.customCards = window.customCards || [];
if (!window.customCards.find(c => c.type === 'stock-tracker-list-card')) {
  window.customCards.push({
    type: 'stock-tracker-list-card',
    name: 'Stock Tracker List Card',
    description: 'Listenansicht für alle Assets mit Sparklines, Sortierung, Gruppierung und Portfolio-Wert',
    preview: true,
    documentationURL: 'https://github.com/richieam93/ha-stock-tracker',
  });
}