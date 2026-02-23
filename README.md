# 📊 Stock Tracker for Home Assistant

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg?style=for-the-badge)](https://github.com/hacs/integration)
[![GitHub Release](https://img.shields.io/github/release/yourusername/ha-stock-tracker.svg?style=for-the-badge)](https://github.com/yourusername/ha-stock-tracker/releases)
[![GitHub License](https://img.shields.io/github/license/yourusername/ha-stock-tracker.svg?style=for-the-badge)](LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/yourusername/ha-stock-tracker.svg?style=for-the-badge)](https://github.com/yourusername/ha-stock-tracker/stargazers)

> 🚀 **Track stocks, ETFs, crypto, and indices in Home Assistant - No API key required!**

![Stock Tracker Dashboard](docs/screenshots/dashboard.png)

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 📈 **Real-time Stock Prices** | Track any stock from NASDAQ, NYSE, XETRA, and more |
| 🪙 **Cryptocurrencies** | Bitcoin, Ethereum, and 500+ other coins |
| 📊 **Technical Indicators** | RSI, MACD, Bollinger Bands, Stochastic, ADX |
| 🔮 **Trend Analysis** | Automatic trend detection with strength indicator |
| 🔍 **Smart Search** | Search by company name or symbol |
| 🔔 **Automations** | Price alerts, RSI signals, trend changes |
| 🎨 **Custom Card** | Beautiful Lovelace card included |
| 📱 **Dashboard** | Auto-generated dashboards |
| 🌍 **Multi-Language** | English & German |
| 🔑 **No API Key** | Works out of the box! |

---

## 📦 Installation

### HACS (Recommended)

1. Open **HACS** in Home Assistant
2. Click **Integrations**
3. Click the **3 dots** in the top right corner
4. Select **Custom repositories**
5. Add this repository URL: `https://github.com/yourusername/ha-stock-tracker`
6. Select category: **Integration**
7. Click **Add**
8. Search for **Stock Tracker** and install it
9. **Restart Home Assistant**

### Manual Installation

1. Download the latest release from [GitHub Releases](https://github.com/yourusername/ha-stock-tracker/releases)
2. Extract and copy the `custom_components/stock_tracker` folder to your `config/custom_components/` directory
3. Copy `www/stock-tracker-card.js` to your `config/www/` directory
4. Restart Home Assistant

---

## ⚙️ Configuration

### Step 1: Add Integration

1. Go to **Settings** → **Devices & Services**
2. Click **+ Add Integration**
3. Search for **Stock Tracker**
4. Follow the setup wizard

### Step 2: Search & Add Stocks

![Config Flow](docs/screenshots/config_flow.png)

You can either:
- **Search by name**: Type "Apple" or "Tesla"
- **Enter symbols directly**: `AAPL, MSFT, TSLA, SAP.DE, BTC-USD`

### Step 3: Configure Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Update Interval | How often to fetch new data | 300s (5 min) |
| Data Source | Yahoo Finance, Google, Auto | Auto |
| Show Indicators | Enable RSI, MACD, etc. | Yes |

---

## 📊 Supported Symbols

### Stocks

| Exchange | Format | Examples |
|----------|--------|----------|
| 🇺🇸 NASDAQ/NYSE | `SYMBOL` | `AAPL`, `MSFT`, `TSLA`, `GOOGL` |
| 🇩🇪 XETRA | `SYMBOL.DE` | `SAP.DE`, `BMW.DE`, `SIE.DE` |
| 🇬🇧 London | `SYMBOL.L` | `HSBA.L`, `BP.L` |
| 🇫🇷 Paris | `SYMBOL.PA` | `AIR.PA`, `OR.PA` |

### Crypto

| Type | Format | Examples |
|------|--------|----------|
| Major Coins | `SYMBOL-USD` | `BTC-USD`, `ETH-USD`, `SOL-USD` |
| EUR Pairs | `SYMBOL-EUR` | `BTC-EUR`, `ETH-EUR` |

### Indices

| Index | Symbol |
|-------|--------|
| S&P 500 | `^GSPC` |
| Dow Jones | `^DJI` |
| NASDAQ | `^IXIC` |
| DAX 40 | `^GDAXI` |
| FTSE 100 | `^FTSE` |

### Forex

| Pair | Symbol |
|------|--------|
| EUR/USD | `EURUSD=X` |
| GBP/USD | `GBPUSD=X` |
| USD/JPY | `USDJPY=X` |

---

## 🔢 Sensors Created

For each stock symbol, **5 sensors** are automatically created:

### 1. Price Sensor (`sensor.SYMBOL_price`)

**State:** Current stock price

**Attributes:**
- `symbol` - Ticker symbol
- `company_name` - Company name
- `exchange` - Stock exchange
- `currency` - Currency (USD, EUR, etc.)
- `change` - Absolute change today
- `change_percent` - Percentage change today
- `previous_close` - Yesterday's closing price
- `today_open` - Today's opening price
- `today_high` - Today's high
- `today_low` - Today's low
- `volume` - Trading volume
- `market_cap` - Market capitalization
- `pe_ratio` - Price/Earnings ratio
- `eps` - Earnings per share
- `dividend_yield` - Dividend yield %
- `52_week_high` - 52-week high
- `52_week_low` - 52-week low
- `50_day_avg` - 50-day moving average
- `200_day_avg` - 200-day moving average
- `week_change_percent` - 1-week change %
- `month_change_percent` - 1-month change %
- `ytd_change_percent` - Year-to-date change %

### 2. Change Sensor (`sensor.SYMBOL_change`)

**State:** Daily change in percent

**Attributes:**
- `absolute_change` - Change in currency
- `change_direction` - up/down/flat
- `change_magnitude` - small/moderate/large

### 3. Trend Sensor (`sensor.SYMBOL_trend`)

**State:** `strong_bullish`, `bullish`, `neutral`, `bearish`, `strong_bearish`

**Attributes:**
- `trend_direction` - Current trend
- `trend_strength` - Strength (0-10)
- `trend_confidence` - Confidence %
- `volatility` - Volatility %
- `short_term_trend` - 5-day trend
- `medium_term_trend` - 20-day trend
- `long_term_trend` - 50-day trend
- `support_1`, `support_2` - Support levels
- `resistance_1`, `resistance_2` - Resistance levels

### 4. Volume Sensor (`sensor.SYMBOL_volume`)

**State:** Current trading volume

**Attributes:**
- `volume_formatted` - Human-readable volume (e.g., "52.3M")
- `avg_volume` - Average volume
- `volume_ratio` - Today vs. average
- `volume_level` - very_low/low/normal/high/very_high

### 5. Indicators Sensor (`sensor.SYMBOL_indicators`)

**State:** `STRONG_BUY`, `BUY`, `HOLD`, `SELL`, `STRONG_SELL`

**Attributes:**
- `rsi_14` - RSI (14 days)
- `rsi_signal` - oversold/neutral/overbought
- `macd` - MACD value
- `macd_signal` - MACD signal line
- `macd_histogram` - MACD histogram
- `macd_trend` - bullish/bearish
- `bollinger_upper` - Upper Bollinger Band
- `bollinger_middle` - Middle Band (SMA20)
- `bollinger_lower` - Lower Bollinger Band
- `stochastic_k` - Stochastic %K
- `stochastic_d` - Stochastic %D
- `adx` - Average Directional Index
- `atr_14` - Average True Range
- `cci_20` - Commodity Channel Index
- `williams_r` - Williams %R
- `sma_5`, `sma_10`, `sma_20`, `sma_50` - Simple Moving Averages
- `ema_12`, `ema_26` - Exponential Moving Averages
- `bullish_indicators` - Count of bullish signals
- `bearish_indicators` - Count of bearish signals

---

## 🎨 Custom Card

### Installation

The custom card is automatically registered. Just add it to your dashboard:

```yaml
type: custom:stock-tracker-card
entity: sensor.aapl_price
display_mode: full  # full, compact, or mini
show_chart: true
show_indicators: true