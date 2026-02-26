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
// CARD EDITOR
// =============================================================================

class StockTrackerListCardEditor extends HTMLElement {
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
    this._hass = hass;
    if (!this.shadowRoot.querySelector('.editor')) {
      this._render();
    }
  }

  _getStockEntities() {
    if (!this._hass || !this._hass.states) return [];

    const entities = [];

    for (const [entityId, state] of Object.entries(this._hass.states)) {
      if (!entityId.startsWith('sensor.')) continue;
      if (!entityId.endsWith('_price')) continue;

      const attrs = state.attributes || {};
      
      // Prüfe ob es ein Stock Tracker Sensor ist

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

    // Sortieren nach Typ und Symbol
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
    const selectedEntities = c.entities || [];

    // Gruppiere Entities nach Typ für bessere Übersicht
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
      'CRYPTOCURRENCY': '🪙 Krypto',
      'FOREX': '💱 Devisen',
      'COMMODITY': '🛢️ Rohstoffe',
      'BOND': '📜 Anleihen',
      'OTHER': '📋 Sonstige',
    };

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
          padding: 10px 12px;
          border: 1px solid var(--divider-color, #e0e0e0);
          border-radius: 8px;
          background: var(--card-background-color);
          font-size: 14px;
          color: var(--primary-text-color);
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
        }
        .checkbox-row label {
          cursor: pointer;
          user-select: none;
        }
        details {
          border: 1px solid var(--divider-color, #e0e0e0);
          border-radius: 8px;
          overflow: hidden;
        }
        summary {
          padding: 12px 14px;
          font-weight: 600;
          font-size: 13px;
          cursor: pointer;
          background: var(--secondary-background-color);
          user-select: none;
        }
        .group {
          padding: 12px 14px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        
        /* Entity Selection */
        .entity-selection {
          border: 1px solid var(--divider-color, #e0e0e0);
          border-radius: 8px;
          max-height: 450px;
          overflow-y: auto;
        }
        .entity-group {
          border-bottom: 1px solid var(--divider-color, #e0e0e0);
        }
        .entity-group:last-child {
          border-bottom: none;
        }
        .entity-group-header {
          padding: 8px 12px;
          background: var(--secondary-background-color);
          font-weight: 600;
          font-size: 12px;
          color: var(--secondary-text-color);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .select-all-btn {
          font-size: 11px;
          padding: 2px 8px;
          border: 1px solid var(--divider-color);
          border-radius: 4px;
          background: var(--card-background-color);
          cursor: pointer;
        }
        .select-all-btn:hover {
          background: var(--primary-color);
          color: white;
          border-color: var(--primary-color);
        }
        .entity-item {
          display: flex;
          align-items: center;
          padding: 8px 12px;
          gap: 10px;
          border-bottom: 1px solid var(--divider-color, #e0e0e0);
        }
        .entity-item:last-child {
          border-bottom: none;
        }
        .entity-item:hover {
          background: var(--secondary-background-color);
        }
        .entity-item input {
          width: 16px;
          height: 16px;
          cursor: pointer;
        }
        .entity-item .icon {
          font-size: 16px;
        }
        .entity-item .info {
          flex: 1;
          min-width: 0;
        }
        .entity-item .symbol {
          font-weight: 600;
          font-size: 13px;
        }
        .entity-item .name {
          font-size: 11px;
          color: var(--secondary-text-color);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .entity-item .price {
          font-size: 12px;
          color: var(--secondary-text-color);
        }
        
        .selected-count {
          padding: 8px 12px;
          background: var(--primary-color);
          color: white;
          border-radius: 6px;
          font-size: 13px;
          text-align: center;
        }
        
        .no-entities {
          padding: 20px;
          text-align: center;
          color: var(--secondary-text-color);
        }
        
        .info-box {
          background: rgba(33, 150, 243, 0.1);
          border: 1px solid rgba(33, 150, 243, 0.3);
          border-radius: 8px;
          padding: 12px;
          font-size: 12px;
        }
      </style>
      
      <div class="editor">
        <!-- ENTITIES AUSWAHL -->
        <details open>
          <summary>📊 Assets auswählen</summary>
          <div class="group">
            ${allEntities.length === 0 ? `
              <div class="no-entities">
                <p>Keine Stock Tracker Sensoren gefunden.</p>
                <p style="font-size:11px">Füge zuerst Assets über Stock Tracker hinzu.</p>
              </div>
            ` : `
              <div class="selected-count">
                ${selectedEntities.length} von ${allEntities.length} Assets ausgewählt
              </div>
              <div class="entity-selection">
                ${Object.entries(groupedEntities).map(([type, entities]) => `
                  <div class="entity-group">
                    <div class="entity-group-header">
                      <span>${typeLabels[type] || type}</span>
                      <button class="select-all-btn" data-type="${type}">Alle</button>
                    </div>
                    ${entities.map(e => `
                      <div class="entity-item">
                        <input type="checkbox" 
                               class="entity-checkbox"
                               data-entity="${e.id}" 
                               ${selectedEntities.includes(e.id) ? 'checked' : ''}>
                        <span class="icon">${e.typeIcon}</span>
                        <div class="info">
                          <div class="symbol">${e.symbol}</div>
                          <div class="name">${e.name}</div>
                        </div>
                        <span class="price">${e.price} ${e.currency}</span>
                      </div>
                    `).join('')}
                  </div>
                `).join('')}
              </div>
            `}
          </div>
        </details>

        <!-- TITEL & MODUS -->
        <div class="field">
          <label>📊 Titel</label>
          <input type="text" id="title" value="${c.title || '📊 Portfolio'}" placeholder="Portfolio">
        </div>

        <div class="field">
          <label>🎨 Anzeige-Modus</label>
          <select id="display_mode">
            <option value="table" ${c.display_mode === 'table' ? 'selected' : ''}>Tabelle</option>
            <option value="compact" ${c.display_mode === 'compact' ? 'selected' : ''}>Kompakt (Kacheln)</option>
            <option value="heatmap" ${c.display_mode === 'heatmap' ? 'selected' : ''}>Heatmap</option>
          </select>
        </div>

        <!-- SICHTBARE SPALTEN -->
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
              <label for="show_sparkline">Mini-Chart (Sparkline)</label>
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

        <!-- SORTIERUNG -->
        <details>
          <summary>📊 Sortierung & Gruppierung</summary>
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
              <label>Sortier-Reihenfolge</label>
              <select id="sort_order">
                <option value="asc" ${c.sort_order === 'asc' ? 'selected' : ''}>Aufsteigend (A-Z, 0-9)</option>
                <option value="desc" ${c.sort_order === 'desc' ? 'selected' : ''}>Absteigend (Z-A, 9-0)</option>
              </select>
            </div>
            <div class="field">
              <label>Gruppieren nach</label>
              <select id="group_by">
                <option value="" ${!c.group_by ? 'selected' : ''}>Keine Gruppierung</option>
                <option value="type" ${c.group_by === 'type' ? 'selected' : ''}>Asset-Typ</option>
                <option value="sector" ${c.group_by === 'sector' ? 'selected' : ''}>Sektor</option>
              </select>
            </div>
          </div>
        </details>

        <!-- PERFORMER -->
        <details>
          <summary>🏆 Performer-Anzeige</summary>
          <div class="group">
            <div class="checkbox-row">
              <input type="checkbox" id="show_top_performers" ${c.show_top_performers ? 'checked' : ''}>
              <label for="show_top_performers">Top Performer anzeigen</label>
            </div>
            <div class="checkbox-row">
              <input type="checkbox" id="show_worst_performers" ${c.show_worst_performers ? 'checked' : ''}>
              <label for="show_worst_performers">Schlechteste Performer anzeigen</label>
            </div>
            <div class="field">
              <label>Anzahl Performer</label>
              <select id="performers_count">
                <option value="3" ${(c.performers_count || 3) === 3 ? 'selected' : ''}>3</option>
                <option value="5" ${c.performers_count === 5 ? 'selected' : ''}>5</option>
                <option value="10" ${c.performers_count === 10 ? 'selected' : ''}>10</option>
              </select>
            </div>
          </div>
        </details>

        <!-- PORTFOLIO -->
        <details>
          <summary>💰 Portfolio-Wert</summary>
          <div class="group">
            <div class="checkbox-row">
              <input type="checkbox" id="show_total_value" ${c.show_total_value ? 'checked' : ''}>
              <label for="show_total_value">Portfolio-Gesamtwert anzeigen</label>
            </div>
            <div class="checkbox-row">
              <input type="checkbox" id="show_total_change" ${c.show_total_change ? 'checked' : ''}>
              <label for="show_total_change">Tagesänderung anzeigen</label>
            </div>
            <div class="info-box">
              💡 <strong>Holdings konfigurieren:</strong><br><br>
              Um den Portfolio-Wert zu berechnen, füge Holdings im YAML-Modus hinzu:<br>
              <code style="font-size:11px">
              holdings:<br>
              &nbsp;&nbsp;AAPL: 10<br>
              &nbsp;&nbsp;BTC-USD: 0.5<br>
              &nbsp;&nbsp;MSFT: 25
              </code>
            </div>
          </div>
        </details>

        <!-- WEITERE OPTIONEN -->
        <details>
          <summary>⚙️ Weitere Optionen</summary>
          <div class="group">
            <div class="checkbox-row">
              <input type="checkbox" id="show_header" ${c.show_header !== false ? 'checked' : ''}>
              <label for="show_header">Header anzeigen</label>
            </div>
            <div class="checkbox-row">
              <input type="checkbox" id="popup_on_click" ${c.popup_on_click !== false ? 'checked' : ''}>
              <label for="popup_on_click">Popup bei Klick öffnen</label>
            </div>
            <div class="field">
              <label>Maximale Anzahl Assets</label>
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
    // Entity checkboxes
    this.shadowRoot.querySelectorAll('.entity-checkbox').forEach(cb => {
      cb.addEventListener('change', () => this._updateEntities());
    });

    // Select all buttons
    this.shadowRoot.querySelectorAll('.select-all-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const type = btn.dataset.type;
        const checkboxes = this.shadowRoot.querySelectorAll(
          `.entity-group:has([data-type="${type}"]) .entity-checkbox, ` +
          `.entity-item input[data-entity*="${type.toLowerCase()}"]`
        );
        
        // Finde alle Checkboxen in dieser Gruppe
        const groupDiv = btn.closest('.entity-group');
        const groupCheckboxes = groupDiv.querySelectorAll('.entity-checkbox');
        
        // Toggle: Wenn alle gecheckt, alle unchecken, sonst alle checken
        const allChecked = Array.from(groupCheckboxes).every(cb => cb.checked);
        groupCheckboxes.forEach(cb => cb.checked = !allChecked);
        
        this._updateEntities();
      });
    });

    // Other form elements
    this.shadowRoot.querySelectorAll('input:not(.entity-checkbox), select').forEach(el => {
      el.addEventListener('change', () => this._valueChanged());
      if (el.type === 'text') {
        let timeout;
        el.addEventListener('input', () => {
          clearTimeout(timeout);
          timeout = setTimeout(() => this._valueChanged(), 500);
        });
      }
    });
  }

  _updateEntities() {
    const selected = [];
    this.shadowRoot.querySelectorAll('.entity-checkbox:checked').forEach(cb => {
      selected.push(cb.dataset.entity);
    });

    this._config.entities = selected;
    this._fireConfigChanged();
    
    // Update count display
    const countEl = this.shadowRoot.querySelector('.selected-count');
    if (countEl) {
      const total = this.shadowRoot.querySelectorAll('.entity-checkbox').length;
      countEl.textContent = `${selected.length} von ${total} Assets ausgewählt`;
    }
  }

  _valueChanged() {
    const getValue = (id) => {
      const el = this.shadowRoot.getElementById(id);
      if (!el) return undefined;
      if (el.type === 'checkbox') return el.checked;
      if (el.type === 'number') return parseInt(el.value) || undefined;
      return el.value;
    };

    const newConfig = {
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
      performers_count: parseInt(getValue('performers_count')) || 3,
      show_total_value: getValue('show_total_value'),
      show_total_change: getValue('show_total_change'),
      popup_on_click: getValue('popup_on_click'),
      max_items: parseInt(getValue('max_items')) || 50,
    };

    this._config = newConfig;
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