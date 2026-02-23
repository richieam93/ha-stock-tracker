"""Constants for Stock Tracker integration."""

# =============================================================================
# DOMAIN
# =============================================================================
DOMAIN = "stock_tracker"
PLATFORMS = ["sensor"]

# =============================================================================
# CONFIG KEYS
# =============================================================================
CONF_SYMBOLS = "symbols"
CONF_SCAN_INTERVAL = "scan_interval"
CONF_DATA_SOURCE = "data_source"
CONF_EXCHANGES = "exchanges"
CONF_SHOW_INDICATORS = "show_indicators"
CONF_CURRENCY_CONVERT = "currency_convert"

# =============================================================================
# DEFAULTS
# =============================================================================
DEFAULT_SCAN_INTERVAL = 300  # 5 Minuten
DEFAULT_DATA_SOURCE = "auto"
DEFAULT_CURRENCY = "USD"

# =============================================================================
# DATA SOURCES
# =============================================================================
SOURCE_YAHOO = "yahoo"
SOURCE_GOOGLE = "google"
SOURCE_INVESTING = "investing"
SOURCE_AUTO = "auto"

AVAILABLE_SOURCES = {
    SOURCE_AUTO: "Automatisch (Best Available)",
    SOURCE_YAHOO: "Yahoo Finance",
    SOURCE_GOOGLE: "Google Finance",
    SOURCE_INVESTING: "Investing.com",
}

# =============================================================================
# EXCHANGES (für DB Download Auswahl)
# =============================================================================
EXCHANGE_US = "us"
EXCHANGE_DE = "de"
EXCHANGE_UK = "uk"
EXCHANGE_EU = "eu"
EXCHANGE_CRYPTO = "crypto"

AVAILABLE_EXCHANGES = {
    EXCHANGE_US: "🇺🇸 US Börsen (NASDAQ, NYSE)",
    EXCHANGE_DE: "🇩🇪 Deutsche Börse (XETRA, Frankfurt)",
    EXCHANGE_UK: "🇬🇧 London Stock Exchange",
    EXCHANGE_EU: "🇪🇺 Euronext (Paris, Amsterdam)",
    EXCHANGE_CRYPTO: "🪙 Kryptowährungen",
}

# =============================================================================
# SENSOR TYPES
# =============================================================================
SENSOR_PRICE = "price"
SENSOR_CHANGE = "change"
SENSOR_TREND = "trend"
SENSOR_VOLUME = "volume"
SENSOR_INDICATORS = "indicators"

SENSOR_TYPES = [
    SENSOR_PRICE,
    SENSOR_CHANGE,
    SENSOR_TREND,
    SENSOR_VOLUME,
    SENSOR_INDICATORS,
]

# =============================================================================
# MARKET DATA ATTRIBUTES
# =============================================================================
ATTR_SYMBOL = "symbol"
ATTR_COMPANY_NAME = "company_name"
ATTR_EXCHANGE = "exchange"
ATTR_CURRENCY = "currency"
ATTR_SECTOR = "sector"
ATTR_INDUSTRY = "industry"

ATTR_CURRENT_PRICE = "current_price"
ATTR_CHANGE = "change"
ATTR_CHANGE_PERCENT = "change_percent"
ATTR_PREVIOUS_CLOSE = "previous_close"
ATTR_OPEN = "today_open"
ATTR_HIGH = "today_high"
ATTR_LOW = "today_low"

ATTR_VOLUME = "volume"
ATTR_AVG_VOLUME = "avg_volume"
ATTR_MARKET_CAP = "market_cap"

ATTR_PE_RATIO = "pe_ratio"
ATTR_EPS = "eps"
ATTR_DIVIDEND_YIELD = "dividend_yield"

ATTR_52_WEEK_HIGH = "52_week_high"
ATTR_52_WEEK_LOW = "52_week_low"
ATTR_50_DAY_AVG = "50_day_avg"
ATTR_200_DAY_AVG = "200_day_avg"

# =============================================================================
# TREND CONSTANTS
# =============================================================================
TREND_STRONG_BULLISH = "strong_bullish"
TREND_BULLISH = "bullish"
TREND_NEUTRAL = "neutral"
TREND_BEARISH = "bearish"
TREND_STRONG_BEARISH = "strong_bearish"

# =============================================================================
# SIGNAL CONSTANTS
# =============================================================================
SIGNAL_BUY = "BUY"
SIGNAL_HOLD = "HOLD"
SIGNAL_SELL = "SELL"
SIGNAL_STRONG_BUY = "STRONG_BUY"
SIGNAL_STRONG_SELL = "STRONG_SELL"

# =============================================================================
# SERVICES
# =============================================================================
SERVICE_ADD_STOCK = "add_stock"
SERVICE_REMOVE_STOCK = "remove_stock"
SERVICE_SEARCH = "search"
SERVICE_UPDATE_DB = "update_database"
SERVICE_REFRESH = "refresh"

# =============================================================================
# STORAGE
# =============================================================================
STORAGE_KEY = f"{DOMAIN}_symbols"
STORAGE_VERSION = 1
DB_FILENAME = "stock_tracker_symbols.db"

# =============================================================================
# ICONS
# =============================================================================
ICON_TRENDING_UP = "mdi:trending-up"
ICON_TRENDING_DOWN = "mdi:trending-down"
ICON_TRENDING_NEUTRAL = "mdi:trending-neutral"
ICON_CHART = "mdi:chart-line"
ICON_VOLUME = "mdi:chart-bar"
ICON_INDICATORS = "mdi:chart-timeline-variant"
ICON_ROCKET = "mdi:rocket-launch"
ICON_ALERT = "mdi:alert-octagon"

# =============================================================================
# RATE LIMITING
# =============================================================================
MIN_SCAN_INTERVAL = 60       # Minimum 1 Minute
MAX_SCAN_INTERVAL = 3600     # Maximum 1 Stunde
MAX_SYMBOLS = 50             # Maximum Symbole pro Instanz
SEARCH_DEBOUNCE = 500        # Millisekunden