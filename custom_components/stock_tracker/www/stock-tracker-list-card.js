/**
 * Stock Tracker List Card v1.0 for Home Assistant
 *
 * A comprehensive list/table view for all your tracked assets.
 *
 * Features:
 * - Table view with all assets
 * - Mini sparkline charts
 * - Color-coded performance (green/red)
 * - Sortable columns
 * - Portfolio value calculation
 * - Grouping by asset type
 * - Click for popup detail view
 * - Heatmap mode
 * - Best/Worst performers
 * - Market status indicators
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
    if (!config.entities && !config.entity_prefix) {
      throw new Error('Please define entities or entity_prefix');
    }

    this._config = {
      // Entities
      entities: config.entities || [],
      entity_prefix: config.entity_prefix || null,
      
      // Display
      title: config.title || '📊 Portfolio',
      display_mode: config.display_mode || 'table', // table | compact | heatmap
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
      holdings: config.holdings || {}, // { "AAPL": 10, "BTC-USD": 0.5 }
      
      // Sorting & Filtering
      sort_by: config.sort_by || 'name', // name | price | change | market_cap | type
      sort_order: config.sort_order || 'asc',
      group_by: config.group_by || null, // null | type | sector
      filter_type: config.filter_type || null, // null | STOCK | CRYPTO | FOREX | etc.
      
      // Performance period
      performance_period: config.performance_period || '24h', // 24h | 7d | 30d
      
      // Appearance
      compact: config.compact || false,
      max_items: config.max_items || 50,
      columns: config.columns || ['name', 'price', 'change', 'sparkline'],
      
      // Colors
      color_positive: config.color_positive || '#4CAF50',
      color_negative: config.color_negative || '#F44336',
      color_neutral: config.color_neutral || '#9E9E9E',
      
      // Interaction
      popup_on_click: config.popup_on_click !== false,
      popup_mode: config.popup_mode || 'native', // native | bubble | browser-mod
      popup_card_config: config.popup_card_config || {},
      
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
    // Or find by prefix
    else if (this._config.entity_prefix) {
      const prefix = this._config.entity_prefix;
      entityIds = Object.keys(this._hass.states).filter(id => 
        id.startsWith(`sensor.${prefix}`) && id.endsWith('_price')
      );
    }
    // Or find all stock tracker entities
    else {
      entityIds = Object.keys(this._hass.states).filter(id => {
        if (!id.startsWith('sensor.')) return false;
        const state = this._hass.states[id];
        const attrs = state?.attributes || {};
        return attrs.data_source !== undefined || attrs.overall_signal !== undefined;
      });
    }

    return entityIds.filter(id => this._hass.states[id]);
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

    // Get holdings if configured
    const symbol = attrs.symbol || this._extractSymbol(entityId);
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
      sparklineData: historyCloses.slice(-24), // Last 24 data points
      high24h: attrs.today_high,
      low24h: attrs.today_low,
      week52High: attrs['52_week_high'],
      week52Low: attrs['52_week_low'],
      ath: attrs.ath,
      athChangePercent: attrs.ath_change_percent,
    };
  }

  _extractSymbol(entityId) {
    const match = entityId.match(/sensor\.(.+)_price/);
    if (match) {
      return match[1].toUpperCase().replace(/_/g, '-');
    }
    return entityId;
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

    // Filter by type
    if (this._config.filter_type) {
      filtered = filtered.filter(a => a.assetType === this._config.filter_type);
    }

    // Limit items
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
    let totalCost = 0; // Would need purchase prices
    let totalChange = 0;

    for (const asset of assets) {
      if (asset.holdingsValue > 0) {
        totalValue += asset.holdingsValue;
        // Calculate weighted change
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

    // Extract data for all entities
    let assets = entityIds
      .map(id => this._extractAssetData(id))
      .filter(a => a !== null);

    // Filter and sort
    assets = this._filterAssets(assets);
    assets = this._sortAssets(assets);

    // Calculate totals
    const totals = this._calculateTotals(assets);

    // Render based on mode
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
      // Group header (if grouping enabled)
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

      // Asset rows
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
                ${cc.show_asset_type ? `<th class="col-type" @click="sort:type">Typ</th>` : ''}
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

    // Calculate size based on market cap or equal
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

      /* Header */
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

      /* Empty State */
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

      /* Totals */
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

      /* Performers */
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

      /* Type badges */
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

      /* Signal badges */
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

      /* Status badges */
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

      /* Sparkline */
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
      // Green gradient
      const r = Math.round(76 - intensity * 30);
      const g = Math.round(175 - intensity * 50);
      const b = Math.round(80 - intensity * 30);
      return `rgb(${r}, ${g}, ${b})`;
    } else {
      // Red gradient
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
    // Row clicks (popup)
    this.shadowRoot.querySelectorAll('[data-entity]').forEach(el => {
      el.addEventListener('click', (e) => {
        const entityId = el.dataset.entity;
        if (entityId) {
          this._handleRowClick(entityId);
        }
      });
    });

    // Sort headers
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

    // View mode toggle
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
// CARD EDITOR - MIT KORREKTEM LAYOUT
// =============================================================================

class StockTrackerListCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
    this._hass = null;
  }

  setConfig(config) {
    this._config = { 
      ...config,
      entities: config.entities ? [...config.entities] : []
    };
    this._render();
  }

  set hass(hass) {
    const firstTime = !this._hass;
    this._hass = hass;
    if (firstTime) {
      this._render();
    }
  }

  get _entities() {
    return this._config.entities || [];
  }

  set _entities(value) {
    this._config.entities = value;
  }

  _getStockEntities() {
    if (!this._hass || !this._hass.states) return [];

    const entities = [];

    for (const [entityId, state] of Object.entries(this._hass.states)) {
      if (!entityId.startsWith('sensor.')) continue;
      if (!entityId.endsWith('_price')) continue;

      const attrs = state.attributes || {};
      
      const isStockSensor = (
        attrs.symbol !== undefined ||
        attrs.data_source !== undefined ||
        attrs.overall_signal !== undefined ||
        attrs.change_percent !== undefined
      );

      if (isStockSensor) {
        const symbol = attrs.symbol || entityId;
        const name = attrs.company_name || attrs.friendly_name || symbol;
        const price = state.state;
        const currency = attrs.currency || 'USD';
        const assetType = attrs.asset_type || attrs.quote_type || 'STOCK';

        let typeIcon = '📈';
        if (assetType === 'CRYPTOCURRENCY' || assetType === 'CRYPTO') typeIcon = '🪙';
        else if (assetType === 'FOREX') typeIcon = '💱';
        else if (assetType === 'COMMODITY') typeIcon = '🛢️';
        else if (assetType === 'INDEX') typeIcon = '📊';
        else if (assetType === 'ETF') typeIcon = '📦';
        else if (assetType === 'BOND') typeIcon = '📜';

        entities.push({
          id: entityId,
          symbol: symbol,
          name: name,
          type: assetType,
          typeIcon: typeIcon,
          price: price,
          currency: currency,
        });
      }
    }

    entities.sort((a, b) => {
      if (a.type !== b.type) {
        const typeOrder = { 'INDEX': 0, 'STOCK': 1, 'ETF': 2, 'CRYPTO': 3, 'CRYPTOCURRENCY': 3, 'FOREX': 4, 'COMMODITY': 5, 'BOND': 6 };
        return (typeOrder[a.type] || 99) - (typeOrder[b.type] || 99);
      }
      return a.symbol.localeCompare(b.symbol);
    });

    return entities;
  }

  _render() {
    if (!this._hass) {
      this.shadowRoot.innerHTML = '<div style="padding:16px">Lade...</div>';
      return;
    }

    const c = this._config;
    const allEntities = this._getStockEntities();
    const selectedEntities = this._entities;

    const typeLabels = {
      'INDEX': '📊 Indizes',
      'STOCK': '📈 Aktien',
      'ETF': '📦 ETFs',
      'CRYPTO': '🪙 Krypto',
      'CRYPTOCURRENCY': '🪙 Krypto',
      'FOREX': '💱 Devisen',
      'COMMODITY': '🛢️ Rohstoffe',
      'BOND': '📜 Anleihen',
      'OTHER': '📋 Sonstige',
    };

    // WICHTIG: Keine Gruppierung mehr - flache Liste für bessere Übersicht
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block !important;
        }
        
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
        
        .checkbox-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 4px 0;
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
        }
        
        details {
          border: 1px solid var(--divider-color, #e0e0e0);
          border-radius: 8px;
          overflow: visible;
        }
        
        details[open] {
          overflow: visible;
        }
        
        summary {
          padding: 12px 14px;
          font-weight: 600;
          font-size: 13px;
          cursor: pointer;
          background: var(--secondary-background-color);
          user-select: none;
          list-style: none;
        }
        
        summary::-webkit-details-marker {
          display: none;
        }
        
        summary::before {
          content: "▶ ";
          font-size: 10px;
        }
        
        details[open] summary::before {
          content: "▼ ";
        }
        
        .group {
          padding: 12px 14px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        
        /* ========== ENTITY SELECTION - FIXED ========== */
        .entity-section {
          border: 1px solid var(--divider-color, #e0e0e0);
          border-radius: 8px;
          overflow: hidden;
        }
        
        .entity-header {
          padding: 12px 14px;
          background: var(--secondary-background-color);
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
        }
        
        .entity-header-title {
          font-weight: 600;
          font-size: 14px;
        }
        
        .entity-header-actions {
          display: flex;
          gap: 8px;
        }
        
        .action-btn {
          padding: 6px 12px;
          border: 1px solid var(--divider-color);
          border-radius: 6px;
          background: var(--card-background-color);
          cursor: pointer;
          font-size: 12px;
          color: var(--primary-text-color);
        }
        
        .action-btn:hover {
          background: var(--primary-color);
          color: white;
          border-color: var(--primary-color);
        }
        
        .selected-count {
          padding: 8px 12px;
          background: var(--primary-color);
          color: white;
          font-size: 13px;
          text-align: center;
        }
        
        .selected-count.warning {
          background: #ff9800;
        }
        
        /* ENTITY LIST - DAS IST DER WICHTIGE TEIL */
        .entity-list {
          max-height: 350px;        /* Feste maximale Höhe */
          min-height: 200px;        /* Mindesthöhe */
          overflow-y: auto !important;  /* Scrollbar */
          overflow-x: hidden;
          display: block !important;
          background: var(--card-background-color);
        }
        
        .entity-item {
          display: flex !important;
          align-items: center;
          padding: 12px 14px;
          gap: 12px;
          border-bottom: 1px solid var(--divider-color, rgba(0,0,0,0.08));
          cursor: pointer;
          transition: background 0.15s;
          min-height: 48px;
          box-sizing: border-box;
        }
        
        .entity-item:last-child {
          border-bottom: none;
        }
        
        .entity-item:hover {
          background: var(--secondary-background-color);
        }
        
        .entity-item.selected {
          background: rgba(76, 175, 80, 0.15);
        }
        
        .entity-item input[type="checkbox"] {
          width: 20px;
          height: 20px;
          cursor: pointer;
          flex-shrink: 0;
          accent-color: var(--primary-color, #03a9f4);
        }
        
        .entity-icon {
          font-size: 20px;
          flex-shrink: 0;
          width: 28px;
          text-align: center;
        }
        
        .entity-info {
          flex: 1;
          min-width: 0;
          overflow: hidden;
        }
        
        .entity-symbol {
          font-weight: 600;
          font-size: 14px;
          color: var(--primary-text-color);
        }
        
        .entity-name {
          font-size: 11px;
          color: var(--secondary-text-color);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        
        .entity-price {
          font-size: 12px;
          color: var(--secondary-text-color);
          flex-shrink: 0;
          text-align: right;
        }
        
        .entity-type-badge {
          font-size: 10px;
          padding: 2px 6px;
          border-radius: 4px;
          background: var(--secondary-background-color);
          color: var(--secondary-text-color);
          flex-shrink: 0;
        }
        
        .no-entities {
          padding: 30px 20px;
          text-align: center;
          color: var(--secondary-text-color);
        }
        
        .no-entities p {
          margin: 8px 0;
        }
        
        /* Scrollbar Styling */
        .entity-list::-webkit-scrollbar {
          width: 8px;
        }
        
        .entity-list::-webkit-scrollbar-track {
          background: var(--secondary-background-color);
        }
        
        .entity-list::-webkit-scrollbar-thumb {
          background: var(--divider-color);
          border-radius: 4px;
        }
        
        .entity-list::-webkit-scrollbar-thumb:hover {
          background: var(--primary-color);
        }
      </style>
      
      <div class="editor">
      
        <!-- ========== ENTITY AUSWAHL ========== -->
        <div class="entity-section">
          <div class="entity-header">
            <span class="entity-header-title">📊 Assets auswählen</span>
            <div class="entity-header-actions">
              <button type="button" class="action-btn" id="btn-select-all">✓ Alle</button>
              <button type="button" class="action-btn" id="btn-select-none">✗ Keine</button>
            </div>
          </div>
          
          <div class="selected-count ${selectedEntities.length === 0 ? 'warning' : ''}" id="selected-count">
            ${selectedEntities.length === 0 
              ? '⚠️ Keine Assets ausgewählt'
              : `✅ ${selectedEntities.length} von ${allEntities.length} Assets ausgewählt`
            }
          </div>
          
          ${allEntities.length === 0 ? `
            <div class="no-entities">
              <p>⚠️ Keine Stock Tracker Sensoren gefunden.</p>
              <p>Füge zuerst Assets über die Stock Tracker Integration hinzu.</p>
            </div>
          ` : `
            <div class="entity-list" id="entity-list">
              ${allEntities.map(e => {
                const isChecked = selectedEntities.includes(e.id);
                return `
                  <div class="entity-item ${isChecked ? 'selected' : ''}" data-entity-id="${e.id}">
                    <input type="checkbox" 
                           class="entity-checkbox"
                           data-entity="${e.id}" 
                           ${isChecked ? 'checked' : ''}>
                    <span class="entity-icon">${e.typeIcon}</span>
                    <div class="entity-info">
                      <div class="entity-symbol">${e.symbol}</div>
                      <div class="entity-name">${e.name}</div>
                    </div>
                    <span class="entity-type-badge">${e.type}</span>
                    <span class="entity-price">${e.price} ${e.currency}</span>
                  </div>
                `;
              }).join('')}
            </div>
          `}
        </div>

        <!-- ========== TITEL ========== -->
        <div class="field">
          <label>📋 Titel</label>
          <input type="text" id="title" value="${c.title || '📊 Portfolio'}" placeholder="Portfolio">
        </div>

        <!-- ========== ANZEIGE-MODUS ========== -->
        <div class="field">
          <label>🎨 Anzeige-Modus</label>
          <select id="display_mode">
            <option value="table" ${c.display_mode === 'table' ? 'selected' : ''}>Tabelle</option>
            <option value="compact" ${c.display_mode === 'compact' ? 'selected' : ''}>Kompakt (Kacheln)</option>
            <option value="heatmap" ${c.display_mode === 'heatmap' ? 'selected' : ''}>Heatmap</option>
          </select>
        </div>

        <!-- ========== SPALTEN ========== -->
        <details>
          <summary>👁️ Sichtbare Spalten</summary>
          <div class="group">
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
              <label for="show_market_cap">Marktkapitalisierung</label>
            </div>
            <div class="checkbox-row">
              <input type="checkbox" id="show_volume" ${c.show_volume ? 'checked' : ''}>
              <label for="show_volume">Volumen</label>
            </div>
            <div class="checkbox-row">
              <input type="checkbox" id="show_signal" ${c.show_signal ? 'checked' : ''}>
              <label for="show_signal">Trading-Signal</label>
            </div>
            <div class="checkbox-row">
              <input type="checkbox" id="show_market_status" ${c.show_market_status ? 'checked' : ''}>
              <label for="show_market_status">Markt-Status</label>
            </div>
            <div class="checkbox-row">
              <input type="checkbox" id="show_asset_type" ${c.show_asset_type !== false ? 'checked' : ''}>
              <label for="show_asset_type">Asset-Typ Icon</label>
            </div>
          </div>
        </details>

        <!-- ========== SORTIERUNG ========== -->
        <details>
          <summary>📊 Sortierung</summary>
          <div class="group">
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
                <option value="asc" ${c.sort_order === 'asc' ? 'selected' : ''}>Aufsteigend</option>
                <option value="desc" ${c.sort_order === 'desc' ? 'selected' : ''}>Absteigend</option>
              </select>
            </div>
            <div class="field">
              <label>Gruppieren</label>
              <select id="group_by">
                <option value="" ${!c.group_by ? 'selected' : ''}>Keine</option>
                <option value="type" ${c.group_by === 'type' ? 'selected' : ''}>Nach Typ</option>
              </select>
            </div>
          </div>
        </details>

        <!-- ========== WEITERE ========== -->
        <details>
          <summary>⚙️ Weitere Optionen</summary>
          <div class="group">
            <div class="checkbox-row">
              <input type="checkbox" id="show_header" ${c.show_header !== false ? 'checked' : ''}>
              <label for="show_header">Header anzeigen</label>
            </div>
            <div class="checkbox-row">
              <input type="checkbox" id="popup_on_click" ${c.popup_on_click !== false ? 'checked' : ''}>
              <label for="popup_on_click">Popup bei Klick</label>
            </div>
            <div class="checkbox-row">
              <input type="checkbox" id="show_top_performers" ${c.show_top_performers ? 'checked' : ''}>
              <label for="show_top_performers">Top Performer zeigen</label>
            </div>
            <div class="checkbox-row">
              <input type="checkbox" id="show_worst_performers" ${c.show_worst_performers ? 'checked' : ''}>
              <label for="show_worst_performers">Schlechteste zeigen</label>
            </div>
            <div class="checkbox-row">
              <input type="checkbox" id="show_total_value" ${c.show_total_value ? 'checked' : ''}>
              <label for="show_total_value">Portfolio-Wert zeigen</label>
            </div>
            <div class="field">
              <label>Max. Anzahl</label>
              <select id="max_items">
                <option value="10" ${c.max_items === 10 ? 'selected' : ''}>10</option>
                <option value="25" ${c.max_items === 25 ? 'selected' : ''}>25</option>
                <option value="50" ${(c.max_items || 50) === 50 ? 'selected' : ''}>50</option>
                <option value="100" ${c.max_items === 100 ? 'selected' : ''}>100</option>
              </select>
            </div>
          </div>
        </details>
        
      </div>
    `;

    this._attachListeners();
  }

  _attachListeners() {
    // Entity Checkboxen
    this.shadowRoot.querySelectorAll('.entity-checkbox').forEach(cb => {
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', (e) => {
        const item = cb.closest('.entity-item');
        if (item) item.classList.toggle('selected', cb.checked);
        this._toggleEntity(cb.dataset.entity, cb.checked);
      });
    });

    // Entity Item Klick
    this.shadowRoot.querySelectorAll('.entity-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.type === 'checkbox') return;
        const cb = item.querySelector('.entity-checkbox');
        if (cb) {
          cb.checked = !cb.checked;
          item.classList.toggle('selected', cb.checked);
          this._toggleEntity(cb.dataset.entity, cb.checked);
        }
      });
    });

    // Alle auswählen
    const btnAll = this.shadowRoot.getElementById('btn-select-all');
    if (btnAll) {
      btnAll.addEventListener('click', () => this._selectAll(true));
    }

    // Keine auswählen
    const btnNone = this.shadowRoot.getElementById('btn-select-none');
    if (btnNone) {
      btnNone.addEventListener('click', () => this._selectAll(false));
    }

    // Andere Form-Elemente
    this.shadowRoot.querySelectorAll('input:not(.entity-checkbox), select').forEach(el => {
      el.addEventListener('change', () => this._saveConfig());
      if (el.type === 'text') {
        let t;
        el.addEventListener('input', () => {
          clearTimeout(t);
          t = setTimeout(() => this._saveConfig(), 300);
        });
      }
    });
  }

  _toggleEntity(entityId, checked) {
    if (!entityId) return;
    
    let entities = [...this._entities];
    const idx = entities.indexOf(entityId);
    
    if (checked && idx === -1) {
      entities.push(entityId);
    } else if (!checked && idx !== -1) {
      entities.splice(idx, 1);
    }
    
    this._entities = entities;
    this._updateCount();
    this._fireConfigChanged();
  }

  _selectAll(select) {
    this.shadowRoot.querySelectorAll('.entity-checkbox').forEach(cb => {
      cb.checked = select;
      const item = cb.closest('.entity-item');
      if (item) item.classList.toggle('selected', select);
    });
    
    if (select) {
      const all = [];
      this.shadowRoot.querySelectorAll('.entity-checkbox').forEach(cb => {
        if (cb.dataset.entity) all.push(cb.dataset.entity);
      });
      this._entities = all;
    } else {
      this._entities = [];
    }
    
    this._updateCount();
    this._fireConfigChanged();
  }

  _updateCount() {
    const el = this.shadowRoot.getElementById('selected-count');
    if (!el) return;
    
    const total = this.shadowRoot.querySelectorAll('.entity-checkbox').length;
    const sel = this._entities.length;
    
    el.className = 'selected-count' + (sel === 0 ? ' warning' : '');
    el.textContent = sel === 0 
      ? '⚠️ Keine Assets ausgewählt'
      : `✅ ${sel} von ${total} Assets ausgewählt`;
  }

  _saveConfig() {
    const get = (id) => {
      const el = this.shadowRoot.getElementById(id);
      if (!el) return undefined;
      if (el.type === 'checkbox') return el.checked;
      return el.value;
    };

    this._config = {
      entities: [...this._entities],
      title: get('title') || '📊 Portfolio',
      display_mode: get('display_mode') || 'table',
      show_header: get('show_header'),
      show_24h_change: get('show_24h_change'),
      show_7d_change: get('show_7d_change'),
      show_30d_change: get('show_30d_change'),
      show_sparkline: get('show_sparkline'),
      show_market_cap: get('show_market_cap'),
      show_volume: get('show_volume'),
      show_signal: get('show_signal'),
      show_market_status: get('show_market_status'),
      show_asset_type: get('show_asset_type'),
      sort_by: get('sort_by') || 'name',
      sort_order: get('sort_order') || 'asc',
      group_by: get('group_by') || null,
      show_top_performers: get('show_top_performers'),
      show_worst_performers: get('show_worst_performers'),
      show_total_value: get('show_total_value'),
      popup_on_click: get('popup_on_click'),
      max_items: parseInt(get('max_items')) || 50,
    };

    this._fireConfigChanged();
  }

  _fireConfigChanged() {
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: { ...this._config } },
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
    '%c 📊 STOCK-TRACKER-LIST-CARD %c v1.0.0 ',
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