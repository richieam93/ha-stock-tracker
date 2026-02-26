"""
Data Update Coordinator for Stock Tracker.

Fetches data from multiple sources with automatic fallback.
Sources (no API key needed):
  - Crypto: CoinGecko, CoinPaprika
  - Stocks: Yahoo Finance (yfinance), Yahoo v8 Chart API
  - Forex: Yahoo Finance
  - Commodities: Yahoo Finance
  - Bonds: Yahoo Finance
  
Automatically detects asset type and uses best source.
All symbols are searchable - stocks, crypto, forex, commodities!
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import requests
import yfinance as yf

from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import (
    DataUpdateCoordinator,
    UpdateFailed,
)

from .const import (
    DOMAIN,
    SOURCE_YAHOO,
    SOURCE_GOOGLE,
    SOURCE_INVESTING,
    SOURCE_AUTO,
    DEFAULT_SCAN_INTERVAL,
)
from .technical import TechnicalAnalysis

_LOGGER = logging.getLogger(__name__)

# HTTP Headers
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
}


# =============================================================================
# ASSET TYPE DEFINITIONS
# =============================================================================

class AssetType:
    """Asset type constants."""
    STOCK = "STOCK"
    CRYPTO = "CRYPTOCURRENCY"
    FOREX = "FOREX"
    COMMODITY = "COMMODITY"
    INDEX = "INDEX"
    ETF = "ETF"
    BOND = "BOND"
    UNKNOWN = "UNKNOWN"


# =============================================================================
# SYMBOL MAPPINGS
# =============================================================================

# Forex pairs (Yahoo Finance format)
FOREX_SYMBOLS = {
    # Major pairs
    "EURUSD": "EURUSD=X",
    "EUR/USD": "EURUSD=X",
    "GBPUSD": "GBPUSD=X",
    "GBP/USD": "GBPUSD=X",
    "USDJPY": "USDJPY=X",
    "USD/JPY": "USDJPY=X",
    "USDCHF": "USDCHF=X",
    "USD/CHF": "USDCHF=X",
    "AUDUSD": "AUDUSD=X",
    "AUD/USD": "AUDUSD=X",
    "USDCAD": "USDCAD=X",
    "USD/CAD": "USDCAD=X",
    "NZDUSD": "NZDUSD=X",
    "NZD/USD": "NZDUSD=X",
    
    # EUR crosses
    "EURGBP": "EURGBP=X",
    "EUR/GBP": "EURGBP=X",
    "EURJPY": "EURJPY=X",
    "EUR/JPY": "EURJPY=X",
    "EURCHF": "EURCHF=X",
    "EUR/CHF": "EURCHF=X",
    "EURAUD": "EURAUD=X",
    "EUR/AUD": "EURAUD=X",
    "EURCAD": "EURCAD=X",
    "EUR/CAD": "EURCAD=X",
    
    # GBP crosses
    "GBPJPY": "GBPJPY=X",
    "GBP/JPY": "GBPJPY=X",
    "GBPCHF": "GBPCHF=X",
    "GBP/CHF": "GBPCHF=X",
    
    # CHF crosses
    "CHFJPY": "CHFJPY=X",
    "CHF/JPY": "CHFJPY=X",
    
    # Other
    "USDSEK": "USDSEK=X",
    "USD/SEK": "USDSEK=X",
    "USDNOK": "USDNOK=X",
    "USD/NOK": "USDNOK=X",
    "USDDKK": "USDDKK=X",
    "USD/DKK": "USDDKK=X",
    "USDPLN": "USDPLN=X",
    "USD/PLN": "USDPLN=X",
    "USDTRY": "USDTRY=X",
    "USD/TRY": "USDTRY=X",
    "USDMXN": "USDMXN=X",
    "USD/MXN": "USDMXN=X",
    "USDZAR": "USDZAR=X",
    "USD/ZAR": "USDZAR=X",
    "USDSGD": "USDSGD=X",
    "USD/SGD": "USDSGD=X",
    "USDHKD": "USDHKD=X",
    "USD/HKD": "USDHKD=X",
}

# Commodity symbols (Yahoo Finance format)
COMMODITY_SYMBOLS = {
    # Precious Metals
    "GOLD": "GC=F",
    "XAUUSD": "GC=F",
    "XAU/USD": "GC=F",
    "SILVER": "SI=F",
    "XAGUSD": "SI=F",
    "XAG/USD": "SI=F",
    "PLATINUM": "PL=F",
    "PALLADIUM": "PA=F",
    
    # Energy
    "OIL": "CL=F",
    "CRUDE": "CL=F",
    "WTI": "CL=F",
    "BRENT": "BZ=F",
    "NATURALGAS": "NG=F",
    "NATGAS": "NG=F",
    "GASOLINE": "RB=F",
    "HEATINGOIL": "HO=F",
    
    # Agriculture
    "CORN": "ZC=F",
    "WHEAT": "ZW=F",
    "SOYBEAN": "ZS=F",
    "COFFEE": "KC=F",
    "SUGAR": "SB=F",
    "COTTON": "CT=F",
    "COCOA": "CC=F",
    "LUMBER": "LBS=F",
    "OATS": "ZO=F",
    
    # Livestock
    "CATTLE": "LE=F",
    "HOGS": "HE=F",
    
    # Industrial Metals
    "COPPER": "HG=F",
    "ALUMINUM": "ALI=F",
}

# Bond/Treasury symbols
BOND_SYMBOLS = {
    # US Treasuries
    "US10Y": "^TNX",
    "US30Y": "^TYX",
    "US5Y": "^FVX",
    "US2Y": "^IRX",
    
    # German Bunds
    "BUND": "FGBL=F",
    "DE10Y": "^DEGY",
    
    # ETFs for bonds
    "TLT": "TLT",      # 20+ Year Treasury
    "IEF": "IEF",      # 7-10 Year Treasury
    "SHY": "SHY",      # 1-3 Year Treasury
    "AGG": "AGG",      # US Aggregate Bond
    "BND": "BND",      # Total Bond Market
    "LQD": "LQD",      # Investment Grade Corporate
    "HYG": "HYG",      # High Yield Corporate
}

# Index symbols
INDEX_SYMBOLS = {
    # US
    "SPX": "^GSPC",
    "SP500": "^GSPC",
    "S&P500": "^GSPC",
    "DOW": "^DJI",
    "DJIA": "^DJI",
    "NASDAQ": "^IXIC",
    "NDX": "^NDX",
    "NASDAQ100": "^NDX",
    "RUSSELL": "^RUT",
    "RUSSELL2000": "^RUT",
    "VIX": "^VIX",
    
    # Europe
    "DAX": "^GDAXI",
    "DAX40": "^GDAXI",
    "FTSE": "^FTSE",
    "FTSE100": "^FTSE",
    "CAC": "^FCHI",
    "CAC40": "^FCHI",
    "STOXX50": "^STOXX50E",
    "EUROSTOXX": "^STOXX50E",
    "SMI": "^SSMI",
    "IBEX": "^IBEX",
    "AEX": "^AEX",
    
    # Asia
    "NIKKEI": "^N225",
    "N225": "^N225",
    "HANGSENG": "^HSI",
    "HSI": "^HSI",
    "SHANGHAI": "000001.SS",
    "KOSPI": "^KS11",
    "ASX": "^AXJO",
    "ASX200": "^AXJO",
    "SENSEX": "^BSESN",
    "NIFTY": "^NSEI",
}

# Crypto mapping (Yahoo Symbol -> CoinGecko ID)
CRYPTO_MAPPING = {
    # Top Cryptos
    "BTC": "bitcoin",
    "ETH": "ethereum",
    "BNB": "binancecoin",
    "XRP": "ripple",
    "ADA": "cardano",
    "SOL": "solana",
    "DOGE": "dogecoin",
    "DOT": "polkadot",
    "MATIC": "matic-network",
    "AVAX": "avalanche-2",
    "LINK": "chainlink",
    "UNI": "uniswap",
    "ATOM": "cosmos",
    "LTC": "litecoin",
    "ALGO": "algorand",
    "XLM": "stellar",
    "VET": "vechain",
    "MANA": "decentraland",
    "SAND": "the-sandbox",
    "AAVE": "aave",
    "FTM": "fantom",
    "NEAR": "near",
    "ICP": "internet-computer",
    "FIL": "filecoin",
    "HBAR": "hedera-hashgraph",
    "APE": "apecoin",
    "ARB": "arbitrum",
    "OP": "optimism",
    "SUI": "sui",
    "SEI": "sei-network",
    "CHZ": "chiliz",
    "SHIB": "shiba-inu",
    "TRX": "tron",
    "ETC": "ethereum-classic",
    "XMR": "monero",
    "BCH": "bitcoin-cash",
    "PEPE": "pepe",
    "IMX": "immutable-x",
    "INJ": "injective-protocol",
    "RUNE": "thorchain",
    "GRT": "the-graph",
    "MKR": "maker",
    "THETA": "theta-token",
    "FET": "fetch-ai",
    "RENDER": "render-token",
    "TIA": "celestia",
    "STX": "stacks",
    "EGLD": "elrond-erd-2",
    "FLOW": "flow",
    "AXS": "axie-infinity",
    "NEO": "neo",
    "KAVA": "kava",
    "XTZ": "tezos",
    "EOS": "eos",
    "CAKE": "pancakeswap-token",
    "CRV": "curve-dao-token",
    "GALA": "gala",
    "ENJ": "enjincoin",
    "1INCH": "1inch",
    "COMP": "compound-governance-token",
    "SNX": "havven",
    "BAT": "basic-attention-token",
    "ZEC": "zcash",
    "DASH": "dash",
    "WAVES": "waves",
    "IOTA": "iota",
    "ZIL": "zilliqa",
    "ENS": "ethereum-name-service",
    "LDO": "lido-dao",
    "RPL": "rocket-pool",
    "GMX": "gmx",
    "DYDX": "dydx",
    "CRO": "crypto-com-chain",
    "QNT": "quant-network",
    "MINA": "mina-protocol",
    "WOO": "woo-network",
    "ROSE": "oasis-network",
    "CELO": "celo",
    "ONE": "harmony",
    "IOTX": "iotex",
    "JASMY": "jasmycoin",
    "HOT": "holotoken",
    "ANKR": "ankr",
    "AUDIO": "audius",
    "MASK": "mask-network",
    "STORJ": "storj",
    "SKL": "skale",
    "OCEAN": "ocean-protocol",
    "FLUX": "zelcash",
    "ICX": "icon",
    "ONT": "ontology",
    "ZRX": "0x",
    "WIF": "dogwifcoin",
    "BONK": "bonk",
    "JUP": "jupiter-exchange-solana",
    "PYTH": "pyth-network",
    "JTO": "jito-governance-token",
    "TAO": "bittensor",
    "KAS": "kaspa",
    "TON": "the-open-network",
    "NOT": "notcoin",
    "FLOKI": "floki",
    "WLD": "worldcoin-wld",
    "STRK": "starknet",
    "BLUR": "blur",
    "PENDLE": "pendle",
    "BOME": "book-of-meme",
}

# Market hours (for market status)
MARKET_HOURS = {
    "NYSE": {
        "timezone": "America/New_York",
        "open": "09:30",
        "close": "16:00",
        "days": [0, 1, 2, 3, 4],  # Mon-Fri
    },
    "NASDAQ": {
        "timezone": "America/New_York",
        "open": "09:30",
        "close": "16:00",
        "days": [0, 1, 2, 3, 4],
    },
    "XETRA": {
        "timezone": "Europe/Berlin",
        "open": "09:00",
        "close": "17:30",
        "days": [0, 1, 2, 3, 4],
    },
    "LSE": {
        "timezone": "Europe/London",
        "open": "08:00",
        "close": "16:30",
        "days": [0, 1, 2, 3, 4],
    },
    "CRYPTO": {
        "timezone": "UTC",
        "open": "00:00",
        "close": "23:59",
        "days": [0, 1, 2, 3, 4, 5, 6],  # 24/7
    },
    "FOREX": {
        "timezone": "UTC",
        "open": "00:00",
        "close": "23:59",
        "days": [0, 1, 2, 3, 4],  # Mon-Fri (24h)
    },
}


# =============================================================================
# STOCK DATA COORDINATOR
# =============================================================================

class StockDataCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Coordinator to fetch and manage stock data."""

    def __init__(
        self,
        hass: HomeAssistant,
        symbols: list[str],
        update_interval: int = DEFAULT_SCAN_INTERVAL,
        preferred_source: str = SOURCE_AUTO,
    ) -> None:
        """Initialize the coordinator."""
        self.symbols = [s.upper().strip() for s in symbols]
        self.preferred_source = preferred_source
        self._failed_sources: dict[str, list[str]] = {}
        self._technical = TechnicalAnalysis()

        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=timedelta(seconds=update_interval),
        )

        _LOGGER.info(
            "StockDataCoordinator initialized with %d symbols: %s",
            len(self.symbols),
            ", ".join(self.symbols),
        )

    # =========================================================================
    # MAIN UPDATE METHOD
    # =========================================================================

    async def _async_update_data(self) -> dict[str, Any]:
        """Fetch data from data sources."""
        try:
            data = await self.hass.async_add_executor_job(
                self._fetch_all_symbols
            )
            return data
        except Exception as err:
            raise UpdateFailed(f"Error fetching stock data: {err}") from err

    def _fetch_all_symbols(self) -> dict[str, Any]:
        """Fetch data for all symbols."""
        result = {}

        for symbol in self.symbols:
            try:
                # Normalize symbol and detect asset type
                normalized_symbol, asset_type = self._normalize_symbol(symbol)
                
                # Fetch based on asset type
                if asset_type == AssetType.CRYPTO:
                    stock_data = self._fetch_crypto(normalized_symbol)
                elif asset_type == AssetType.FOREX:
                    stock_data = self._fetch_forex(normalized_symbol)
                elif asset_type == AssetType.COMMODITY:
                    stock_data = self._fetch_commodity(normalized_symbol)
                elif asset_type == AssetType.BOND:
                    stock_data = self._fetch_bond(normalized_symbol)
                elif asset_type == AssetType.INDEX:
                    stock_data = self._fetch_index(normalized_symbol)
                else:
                    stock_data = self._fetch_stock(normalized_symbol)

                if stock_data and stock_data.get("price") is not None:
                    # Keep original symbol as key
                    stock_data["original_symbol"] = symbol
                    stock_data["asset_type"] = asset_type
                    
                    # Add market status
                    stock_data["market_status"] = self._get_market_status(
                        stock_data.get("exchange", ""),
                        asset_type
                    )
                    
                    # Add technical analysis
                    stock_data = self._enrich_with_analysis(symbol, stock_data)
                    
                    result[symbol] = stock_data
                    _LOGGER.debug(
                        "Fetched %s (%s): price=%s, source=%s",
                        symbol,
                        asset_type,
                        stock_data.get("price"),
                        stock_data.get("data_source"),
                    )
                else:
                    _LOGGER.warning("No data for %s", symbol)
                    result[symbol] = self._empty_data(symbol, asset_type)

            except Exception as err:
                _LOGGER.error("Error fetching %s: %s", symbol, err)
                result[symbol] = self._empty_data(symbol)

        return result

    # =========================================================================
    # SYMBOL NORMALIZATION & ASSET TYPE DETECTION
    # =========================================================================

    def _normalize_symbol(self, symbol: str) -> tuple[str, str]:
        """
        Normalize symbol and detect asset type.
        Returns (normalized_symbol, asset_type).
        """
        symbol = symbol.upper().strip()
        
        # Check Forex
        if symbol in FOREX_SYMBOLS:
            return FOREX_SYMBOLS[symbol], AssetType.FOREX
        if symbol.endswith("=X"):
            return symbol, AssetType.FOREX
        
        # Check for forex patterns (XXXYYY or XXX/YYY)
        forex_pattern = r"^([A-Z]{3})/?([A-Z]{3})$"
        forex_match = re.match(forex_pattern, symbol.replace("/", ""))
        if forex_match and len(symbol.replace("/", "")) == 6:
            normalized = f"{forex_match.group(1)}{forex_match.group(2)}=X"
            if normalized.replace("=X", "") in ["EURUSD", "GBPUSD", "USDJPY", "USDCHF", 
                                                  "AUDUSD", "USDCAD", "EURGBP", "EURJPY",
                                                  "EURCHF", "GBPJPY"]:
                return normalized, AssetType.FOREX
        
        # Check Commodity
        if symbol in COMMODITY_SYMBOLS:
            return COMMODITY_SYMBOLS[symbol], AssetType.COMMODITY
        if symbol.endswith("=F"):
            return symbol, AssetType.COMMODITY
        
        # Check Bond
        if symbol in BOND_SYMBOLS:
            return BOND_SYMBOLS[symbol], AssetType.BOND
        
        # Check Index
        if symbol in INDEX_SYMBOLS:
            return INDEX_SYMBOLS[symbol], AssetType.INDEX
        if symbol.startswith("^"):
            return symbol, AssetType.INDEX
        
        # Check Crypto patterns
        crypto_patterns = [
            r"^([A-Z0-9]{2,10})[-/]?(USD|EUR|GBP|USDT|BTC|ETH)$",
            r"^([A-Z0-9]{2,10})(USD|EUR|USDT)$",
        ]
        
        for pattern in crypto_patterns:
            match = re.match(pattern, symbol)
            if match:
                base = match.group(1)
                if base in CRYPTO_MAPPING:
                    # Normalize to XXX-USD format
                    quote = match.group(2) if len(match.groups()) > 1 else "USD"
                    return f"{base}-{quote}", AssetType.CRYPTO
        
        # Check if base is a known crypto
        base = self._extract_crypto_base(symbol)
        if base in CRYPTO_MAPPING:
            return symbol if "-" in symbol else f"{base}-USD", AssetType.CRYPTO
        
        # Default to stock
        return symbol, AssetType.STOCK

    def _extract_crypto_base(self, symbol: str) -> str:
        """Extract base crypto symbol (e.g., BTC-USD -> BTC)."""
        symbol = symbol.upper()
        
        for suffix in ["-USD", "-EUR", "-GBP", "-BTC", "-ETH", "-USDT", "USD", "EUR", "USDT"]:
            if symbol.endswith(suffix):
                return symbol[:-len(suffix)]
        
        return symbol

    def _get_coingecko_id(self, symbol: str) -> str | None:
        """Get CoinGecko ID from symbol. Auto-searches if not in mapping."""
        base = self._extract_crypto_base(symbol)
        
        if base in CRYPTO_MAPPING:
            return CRYPTO_MAPPING[base]
        
        # Auto-search CoinGecko
        coingecko_id = self._search_coingecko_id(base)
        if coingecko_id:
            CRYPTO_MAPPING[base] = coingecko_id
            _LOGGER.info("Auto-discovered CoinGecko ID for %s: %s", base, coingecko_id)
            return coingecko_id
        
        return None

    def _search_coingecko_id(self, symbol: str) -> str | None:
        """Search CoinGecko for a coin by symbol."""
        try:
            url = "https://api.coingecko.com/api/v3/search"
            params = {"query": symbol}
            
            response = requests.get(url, params=params, headers=HEADERS, timeout=10)
            
            if response.status_code == 429:
                _LOGGER.warning("CoinGecko rate limit hit")
                return None
                
            if response.status_code != 200:
                return None
            
            data = response.json()
            coins = data.get("coins", [])
            
            if not coins:
                return None
            
            symbol_upper = symbol.upper()
            for coin in coins:
                if coin.get("symbol", "").upper() == symbol_upper:
                    return coin.get("id")
            
            return coins[0].get("id")
            
        except Exception as err:
            _LOGGER.debug("CoinGecko search error for %s: %s", symbol, err)
            return None

    # =========================================================================
    # MARKET STATUS
    # =========================================================================

    def _get_market_status(self, exchange: str, asset_type: str) -> dict[str, Any]:
        """Get current market status (open/closed/pre-market/after-hours)."""
        now = datetime.now(ZoneInfo("UTC"))
        
        # Determine which market hours to use
        if asset_type == AssetType.CRYPTO:
            market_key = "CRYPTO"
        elif asset_type == AssetType.FOREX:
            market_key = "FOREX"
        elif exchange in MARKET_HOURS:
            market_key = exchange
        elif "NYSE" in exchange or "NASDAQ" in exchange or exchange in ["NMS", "NYQ", "NGM"]:
            market_key = "NYSE"
        elif "XETRA" in exchange or "GER" in exchange or "FRA" in exchange:
            market_key = "XETRA"
        elif "LSE" in exchange or "LON" in exchange:
            market_key = "LSE"
        else:
            market_key = "NYSE"  # Default
        
        market_info = MARKET_HOURS.get(market_key, MARKET_HOURS["NYSE"])
        
        try:
            tz = ZoneInfo(market_info["timezone"])
            local_now = now.astimezone(tz)
            
            # Check if market day
            if local_now.weekday() not in market_info["days"]:
                return {
                    "status": "closed",
                    "reason": "weekend",
                    "next_open": self._get_next_open(market_info, local_now),
                }
            
            # Parse open/close times
            open_time = datetime.strptime(market_info["open"], "%H:%M").time()
            close_time = datetime.strptime(market_info["close"], "%H:%M").time()
            current_time = local_now.time()
            
            # Check status
            if current_time < open_time:
                return {
                    "status": "pre_market",
                    "opens_in": str(datetime.combine(local_now.date(), open_time) - datetime.combine(local_now.date(), current_time)),
                }
            elif current_time > close_time:
                return {
                    "status": "after_hours",
                    "closed_since": str(datetime.combine(local_now.date(), current_time) - datetime.combine(local_now.date(), close_time)),
                }
            else:
                return {
                    "status": "open",
                    "closes_in": str(datetime.combine(local_now.date(), close_time) - datetime.combine(local_now.date(), current_time)),
                }
                
        except Exception as err:
            _LOGGER.debug("Error getting market status: %s", err)
            return {"status": "unknown"}

    def _get_next_open(self, market_info: dict, local_now: datetime) -> str:
        """Calculate next market open time."""
        try:
            open_time = datetime.strptime(market_info["open"], "%H:%M").time()
            
            # Find next trading day
            next_day = local_now + timedelta(days=1)
            while next_day.weekday() not in market_info["days"]:
                next_day += timedelta(days=1)
            
            next_open = datetime.combine(next_day.date(), open_time)
            return next_open.strftime("%Y-%m-%d %H:%M")
        except Exception:
            return "unknown"

    # =========================================================================
    # FOREX FETCHING
    # =========================================================================

    def _fetch_forex(self, symbol: str) -> dict[str, Any] | None:
        """Fetch forex data from Yahoo Finance."""
        try:
            ticker = yf.Ticker(symbol)
            info = ticker.info
            
            if not info:
                return None

            price = info.get("regularMarketPrice") or info.get("bid") or info.get("ask")
            prev_close = info.get("regularMarketPreviousClose") or info.get("previousClose")

            if price is None:
                return None

            change = None
            change_percent = None
            if price and prev_close:
                change = round(price - prev_close, 6)
                change_percent = round((change / prev_close) * 100, 4)

            # Get history
            history = self._get_history_safe(ticker, period="1mo")
            
            # Parse currency pair
            base_currency = symbol[:3] if len(symbol) >= 6 else ""
            quote_currency = symbol[3:6] if len(symbol) >= 6 else ""
            
            # Clean up for =X symbols
            if "=" in symbol:
                clean = symbol.replace("=X", "")
                base_currency = clean[:3]
                quote_currency = clean[3:6] if len(clean) >= 6 else "USD"

            data = {
                "symbol": symbol,
                "company_name": f"{base_currency}/{quote_currency}",
                "long_name": info.get("shortName", f"{base_currency}/{quote_currency}"),
                "exchange": "Forex",
                "currency": quote_currency,
                "base_currency": base_currency,
                "quote_currency": quote_currency,
                "sector": "Currency",
                "industry": "Foreign Exchange",
                "country": "",
                "quote_type": AssetType.FOREX,

                "price": price,
                "change": change,
                "change_percent": change_percent,
                "previous_close": prev_close,
                "today_open": info.get("regularMarketOpen") or info.get("open"),
                "today_high": info.get("regularMarketDayHigh") or info.get("dayHigh"),
                "today_low": info.get("regularMarketDayLow") or info.get("dayLow"),

                "volume": info.get("regularMarketVolume"),
                "avg_volume": info.get("averageVolume"),

                "bid": info.get("bid"),
                "ask": info.get("ask"),
                "bid_size": info.get("bidSize"),
                "ask_size": info.get("askSize"),

                "52_week_high": info.get("fiftyTwoWeekHigh"),
                "52_week_low": info.get("fiftyTwoWeekLow"),
                "50_day_avg": info.get("fiftyDayAverage"),
                "200_day_avg": info.get("twoHundredDayAverage"),

                "data_source": "yahoo",
                "data_quality": "good",

                "history_dates": [],
                "history_closes": [],
                "history_volumes": [],
                "history_highs": [],
                "history_lows": [],
            }

            # Add history
            if history is not None and not history.empty:
                data["history_dates"] = history.index.strftime("%Y-%m-%d").tolist()
                data["history_closes"] = [round(v, 6) for v in history["Close"].tolist()]
                data["history_volumes"] = history["Volume"].tolist() if "Volume" in history else []
                data["history_highs"] = [round(v, 6) for v in history["High"].tolist()]
                data["history_lows"] = [round(v, 6) for v in history["Low"].tolist()]
                data.update(self._calculate_period_changes(history, price))

            return data

        except Exception as err:
            _LOGGER.debug("Forex fetch error for %s: %s", symbol, err)
            return None

    # =========================================================================
    # COMMODITY FETCHING
    # =========================================================================

    def _fetch_commodity(self, symbol: str) -> dict[str, Any] | None:
        """Fetch commodity data from Yahoo Finance."""
        try:
            ticker = yf.Ticker(symbol)
            info = ticker.info
            
            if not info:
                return None

            price = info.get("regularMarketPrice") or info.get("previousClose")
            prev_close = info.get("regularMarketPreviousClose") or info.get("previousClose")

            if price is None:
                return None

            change = None
            change_percent = None
            if price and prev_close:
                change = round(price - prev_close, 4)
                change_percent = round((change / prev_close) * 100, 4)

            history = self._get_history_safe(ticker, period="3mo")
            
            # Determine commodity category
            commodity_name = info.get("shortName", symbol)
            category = "Commodity"
            if any(x in symbol.upper() for x in ["GC", "SI", "PL", "PA", "XAU", "XAG"]):
                category = "Precious Metals"
            elif any(x in symbol.upper() for x in ["CL", "BZ", "NG", "RB", "HO"]):
                category = "Energy"
            elif any(x in symbol.upper() for x in ["ZC", "ZW", "ZS", "KC", "SB", "CT", "CC"]):
                category = "Agriculture"
            elif any(x in symbol.upper() for x in ["HG", "ALI"]):
                category = "Industrial Metals"

            data = {
                "symbol": symbol,
                "company_name": commodity_name,
                "long_name": info.get("longName", commodity_name),
                "exchange": info.get("exchange", "COMEX"),
                "currency": info.get("currency", "USD"),
                "sector": "Commodities",
                "industry": category,
                "country": "",
                "quote_type": AssetType.COMMODITY,

                "price": price,
                "change": change,
                "change_percent": change_percent,
                "previous_close": prev_close,
                "today_open": info.get("regularMarketOpen") or info.get("open"),
                "today_high": info.get("regularMarketDayHigh") or info.get("dayHigh"),
                "today_low": info.get("regularMarketDayLow") or info.get("dayLow"),

                "volume": info.get("regularMarketVolume") or info.get("volume"),
                "avg_volume": info.get("averageVolume"),
                "open_interest": info.get("openInterest"),

                "52_week_high": info.get("fiftyTwoWeekHigh"),
                "52_week_low": info.get("fiftyTwoWeekLow"),
                "50_day_avg": info.get("fiftyDayAverage"),
                "200_day_avg": info.get("twoHundredDayAverage"),

                # Futures-specific
                "contract_size": info.get("contractSize"),
                "expiration_date": info.get("expireDate"),

                "data_source": "yahoo",
                "data_quality": "good",

                "history_dates": [],
                "history_closes": [],
                "history_volumes": [],
                "history_highs": [],
                "history_lows": [],
            }

            if history is not None and not history.empty:
                data["history_dates"] = history.index.strftime("%Y-%m-%d").tolist()
                data["history_closes"] = [round(v, 4) for v in history["Close"].tolist()]
                data["history_volumes"] = history["Volume"].tolist()
                data["history_highs"] = [round(v, 4) for v in history["High"].tolist()]
                data["history_lows"] = [round(v, 4) for v in history["Low"].tolist()]
                data.update(self._calculate_period_changes(history, price))

            return data

        except Exception as err:
            _LOGGER.debug("Commodity fetch error for %s: %s", symbol, err)
            return None

    # =========================================================================
    # BOND FETCHING
    # =========================================================================

    def _fetch_bond(self, symbol: str) -> dict[str, Any] | None:
        """Fetch bond/treasury data from Yahoo Finance."""
        try:
            ticker = yf.Ticker(symbol)
            info = ticker.info
            
            if not info:
                return None

            price = info.get("regularMarketPrice") or info.get("previousClose")
            prev_close = info.get("regularMarketPreviousClose") or info.get("previousClose")

            if price is None:
                return None

            change = None
            change_percent = None
            if price and prev_close:
                change = round(price - prev_close, 4)
                change_percent = round((change / prev_close) * 100, 4)

            history = self._get_history_safe(ticker, period="3mo")

            data = {
                "symbol": symbol,
                "company_name": info.get("shortName", symbol),
                "long_name": info.get("longName", info.get("shortName", symbol)),
                "exchange": info.get("exchange", "Bond"),
                "currency": info.get("currency", "USD"),
                "sector": "Fixed Income",
                "industry": "Bonds & Treasuries",
                "country": "",
                "quote_type": AssetType.BOND,

                "price": price,  # For bonds, this might be yield
                "change": change,
                "change_percent": change_percent,
                "previous_close": prev_close,
                "today_open": info.get("regularMarketOpen"),
                "today_high": info.get("regularMarketDayHigh"),
                "today_low": info.get("regularMarketDayLow"),

                "volume": info.get("regularMarketVolume"),
                "avg_volume": info.get("averageVolume"),

                "52_week_high": info.get("fiftyTwoWeekHigh"),
                "52_week_low": info.get("fiftyTwoWeekLow"),
                "50_day_avg": info.get("fiftyDayAverage"),
                "200_day_avg": info.get("twoHundredDayAverage"),

                # Bond-specific
                "yield": price if symbol.startswith("^") else None,

                "data_source": "yahoo",
                "data_quality": "good",

                "history_dates": [],
                "history_closes": [],
                "history_volumes": [],
                "history_highs": [],
                "history_lows": [],
            }

            if history is not None and not history.empty:
                data["history_dates"] = history.index.strftime("%Y-%m-%d").tolist()
                data["history_closes"] = [round(v, 4) for v in history["Close"].tolist()]
                data["history_volumes"] = history["Volume"].tolist() if "Volume" in history else []
                data["history_highs"] = [round(v, 4) for v in history["High"].tolist()]
                data["history_lows"] = [round(v, 4) for v in history["Low"].tolist()]
                data.update(self._calculate_period_changes(history, price))

            return data

        except Exception as err:
            _LOGGER.debug("Bond fetch error for %s: %s", symbol, err)
            return None

    # =========================================================================
    # INDEX FETCHING
    # =========================================================================

    def _fetch_index(self, symbol: str) -> dict[str, Any] | None:
        """Fetch index data from Yahoo Finance."""
        try:
            ticker = yf.Ticker(symbol)
            info = ticker.info
            
            if not info:
                return None

            price = info.get("regularMarketPrice") or info.get("previousClose")
            prev_close = info.get("regularMarketPreviousClose") or info.get("previousClose")

            if price is None:
                return None

            change = None
            change_percent = None
            if price and prev_close:
                change = round(price - prev_close, 2)
                change_percent = round((change / prev_close) * 100, 4)

            history = self._get_history_safe(ticker, period="3mo")

            data = {
                "symbol": symbol,
                "company_name": info.get("shortName", symbol),
                "long_name": info.get("longName", info.get("shortName", symbol)),
                "exchange": info.get("exchange", "Index"),
                "currency": info.get("currency", "USD"),
                "sector": "Index",
                "industry": "Market Index",
                "country": "",
                "quote_type": AssetType.INDEX,

                "price": price,
                "change": change,
                "change_percent": change_percent,
                "previous_close": prev_close,
                "today_open": info.get("regularMarketOpen") or info.get("open"),
                "today_high": info.get("regularMarketDayHigh") or info.get("dayHigh"),
                "today_low": info.get("regularMarketDayLow") or info.get("dayLow"),

                "volume": info.get("regularMarketVolume"),
                "avg_volume": info.get("averageVolume"),

                "52_week_high": info.get("fiftyTwoWeekHigh"),
                "52_week_low": info.get("fiftyTwoWeekLow"),
                "50_day_avg": info.get("fiftyDayAverage"),
                "200_day_avg": info.get("twoHundredDayAverage"),

                "ytd_return": info.get("ytdReturn"),

                "data_source": "yahoo",
                "data_quality": "good",

                "history_dates": [],
                "history_closes": [],
                "history_volumes": [],
                "history_highs": [],
                "history_lows": [],
            }

            if history is not None and not history.empty:
                data["history_dates"] = history.index.strftime("%Y-%m-%d").tolist()
                data["history_closes"] = [round(v, 2) for v in history["Close"].tolist()]
                data["history_volumes"] = history["Volume"].tolist()
                data["history_highs"] = [round(v, 2) for v in history["High"].tolist()]
                data["history_lows"] = [round(v, 2) for v in history["Low"].tolist()]
                data.update(self._calculate_period_changes(history, price))

            return data

        except Exception as err:
            _LOGGER.debug("Index fetch error for %s: %s", symbol, err)
            return None

    # =========================================================================
    # CRYPTO FETCHING (CoinGecko + CoinPaprika)
    # =========================================================================

    def _fetch_crypto(self, symbol: str) -> dict[str, Any] | None:
        """Fetch crypto data from CoinGecko, fallback to CoinPaprika, then yfinance."""
        
        # Try CoinGecko first
        data = self._fetch_coingecko(symbol)
        if data and data.get("price"):
            data["data_source"] = "coingecko"
            return data
        
        # Fallback to CoinPaprika
        data = self._fetch_coinpaprika(symbol)
        if data and data.get("price"):
            data["data_source"] = "coinpaprika"
            return data
        
        # Last fallback: yfinance
        data = self._fetch_yahoo(symbol)
        if data and data.get("price"):
            return data
        
        return None

    def _fetch_coingecko(self, symbol: str) -> dict[str, Any] | None:
        """Fetch crypto data from CoinGecko API."""
        coingecko_id = self._get_coingecko_id(symbol)
        
        if not coingecko_id:
            _LOGGER.debug("No CoinGecko ID found for %s", symbol)
            return None
        
        try:
            url = f"https://api.coingecko.com/api/v3/coins/{coingecko_id}"
            params = {
                "localization": "false",
                "tickers": "false",
                "community_data": "false",
                "developer_data": "false",
                "sparkline": "true",
            }
            
            response = requests.get(url, params=params, headers=HEADERS, timeout=15)
            
            if response.status_code == 429:
                _LOGGER.warning("CoinGecko rate limit hit for %s", symbol)
                return None
            
            if response.status_code != 200:
                _LOGGER.debug("CoinGecko error for %s: HTTP %s", symbol, response.status_code)
                return None
            
            coin = response.json()
            market_data = coin.get("market_data", {})
            
            # Determine quote currency
            quote_currency = "usd"
            if "-EUR" in symbol.upper():
                quote_currency = "eur"
            elif "-GBP" in symbol.upper():
                quote_currency = "gbp"
            elif "-CHF" in symbol.upper():
                quote_currency = "chf"
            
            price = market_data.get("current_price", {}).get(quote_currency)
            if not price:
                return None
            
            change_24h = market_data.get("price_change_percentage_24h")
            change_abs = market_data.get("price_change_24h")
            market_cap = market_data.get("market_cap", {}).get(quote_currency)
            
            sparkline = market_data.get("sparkline_7d", {}).get("price", [])
            
            data = {
                "symbol": symbol,
                "company_name": coin.get("name", symbol),
                "long_name": coin.get("name", ""),
                "exchange": "Crypto",
                "currency": quote_currency.upper(),
                "sector": "Cryptocurrency",
                "industry": coin.get("categories", ["Cryptocurrency"])[0] if coin.get("categories") else "Cryptocurrency",
                "country": "",
                "website": coin.get("links", {}).get("homepage", [""])[0] if coin.get("links", {}).get("homepage") else "",
                "quote_type": AssetType.CRYPTO,

                "price": price,
                "change": change_abs,
                "change_percent": change_24h,
                "previous_close": price - change_abs if change_abs else None,
                "today_open": None,
                "today_high": market_data.get("high_24h", {}).get(quote_currency),
                "today_low": market_data.get("low_24h", {}).get(quote_currency),

                "volume": market_data.get("total_volume", {}).get(quote_currency),
                "avg_volume": None,

                "market_cap": market_cap,
                "market_cap_formatted": self._format_market_cap(market_cap) if market_cap else "N/A",
                "circulating_supply": market_data.get("circulating_supply"),
                "total_supply": market_data.get("total_supply"),
                "max_supply": market_data.get("max_supply"),
                "fully_diluted_valuation": market_data.get("fully_diluted_valuation", {}).get(quote_currency),

                "52_week_high": market_data.get("ath", {}).get(quote_currency),
                "52_week_low": market_data.get("atl", {}).get(quote_currency),
                "ath": market_data.get("ath", {}).get(quote_currency),
                "ath_date": market_data.get("ath_date", {}).get(quote_currency),
                "ath_change_percent": market_data.get("ath_change_percentage", {}).get(quote_currency),
                "atl": market_data.get("atl", {}).get(quote_currency),
                "atl_date": market_data.get("atl_date", {}).get(quote_currency),

                "week_change_percent": market_data.get("price_change_percentage_7d"),
                "month_change_percent": market_data.get("price_change_percentage_30d"),
                "ytd_change_percent": market_data.get("price_change_percentage_1y"),

                "market_cap_rank": coin.get("market_cap_rank"),
                "coingecko_rank": coin.get("coingecko_rank"),
                "coingecko_id": coingecko_id,

                "data_source": "coingecko",
                "data_quality": "good",

                "history_dates": [],
                "history_closes": sparkline[-60:] if sparkline else [],
                "history_volumes": [],
                "history_highs": [],
                "history_lows": [],
            }
            
            return data
            
        except Exception as err:
            _LOGGER.debug("CoinGecko fetch error for %s: %s", symbol, err)
            return None

    def _fetch_coinpaprika(self, symbol: str) -> dict[str, Any] | None:
        """Fetch crypto data from CoinPaprika API (fallback)."""
        base = self._extract_crypto_base(symbol)
        
        try:
            search_url = f"https://api.coinpaprika.com/v1/search?q={base}&limit=5"
            search_resp = requests.get(search_url, headers=HEADERS, timeout=10)
            
            if search_resp.status_code != 200:
                return None
            
            search_data = search_resp.json()
            currencies = search_data.get("currencies", [])
            
            if not currencies:
                return None
            
            coin_id = None
            for currency in currencies:
                if currency.get("symbol", "").upper() == base.upper():
                    coin_id = currency.get("id")
                    break
            
            if not coin_id:
                coin_id = currencies[0].get("id")
            
            if not coin_id:
                return None
            
            ticker_url = f"https://api.coinpaprika.com/v1/tickers/{coin_id}"
            ticker_resp = requests.get(ticker_url, headers=HEADERS, timeout=10)
            
            if ticker_resp.status_code != 200:
                return None
            
            ticker = ticker_resp.json()
            quotes = ticker.get("quotes", {}).get("USD", {})
            
            price = quotes.get("price")
            if not price:
                return None
            
            market_cap = quotes.get("market_cap")
            
            data = {
                "symbol": symbol,
                "company_name": ticker.get("name", symbol),
                "long_name": ticker.get("name", ""),
                "exchange": "Crypto",
                "currency": "USD",
                "sector": "Cryptocurrency",
                "industry": "Cryptocurrency",
                "quote_type": AssetType.CRYPTO,

                "price": price,
                "change": None,
                "change_percent": quotes.get("percent_change_24h"),
                "previous_close": None,
                "today_high": None,
                "today_low": None,

                "volume": quotes.get("volume_24h"),

                "market_cap": market_cap,
                "market_cap_formatted": self._format_market_cap(market_cap) if market_cap else "N/A",
                "circulating_supply": ticker.get("circulating_supply"),
                "total_supply": ticker.get("total_supply"),
                "max_supply": ticker.get("max_supply"),

                "52_week_high": quotes.get("ath_price"),
                "ath": quotes.get("ath_price"),
                "ath_date": quotes.get("ath_date"),
                "ath_change_percent": quotes.get("percent_from_price_ath"),

                "week_change_percent": quotes.get("percent_change_7d"),
                "month_change_percent": quotes.get("percent_change_30d"),
                "ytd_change_percent": quotes.get("percent_change_1y"),

                "market_cap_rank": ticker.get("rank"),

                "data_source": "coinpaprika",
                "data_quality": "good",

                "history_dates": [],
                "history_closes": [],
                "history_volumes": [],
                "history_highs": [],
                "history_lows": [],
            }
            
            return data
            
        except Exception as err:
            _LOGGER.debug("CoinPaprika fetch error for %s: %s", symbol, err)
            return None

    # =========================================================================
    # STOCK FETCHING (yfinance + Yahoo v8)
    # =========================================================================

    def _fetch_stock(self, symbol: str) -> dict[str, Any] | None:
        """Fetch stock data from Yahoo Finance."""
        
        data = self._fetch_yahoo(symbol)
        if data and data.get("price"):
            return data
        
        data = self._fetch_yahoo_v8(symbol)
        if data and data.get("price"):
            return data
        
        return None

    def _fetch_yahoo(self, symbol: str) -> dict[str, Any] | None:
        """Fetch stock data from Yahoo Finance using yfinance."""
        try:
            ticker = yf.Ticker(symbol)
            info = ticker.info
            
            if not info:
                return None

            price = info.get("regularMarketPrice") or info.get("currentPrice")
            prev_close = info.get("regularMarketPreviousClose") or info.get("previousClose")

            if price is None and prev_close is None:
                return None

            if price is None:
                price = prev_close

            change = None
            change_percent = None
            if price and prev_close:
                change = round(price - prev_close, 4)
                change_percent = round((change / prev_close) * 100, 4)

            history = self._get_history_safe(ticker, period="3mo")

            market_cap = info.get("marketCap")
            circulating_supply = info.get("circulatingSupply")
            shares_outstanding = info.get("sharesOutstanding")

            if not market_cap and price:
                if circulating_supply and circulating_supply > 0:
                    market_cap = circulating_supply * price
                elif shares_outstanding and shares_outstanding > 0:
                    market_cap = shares_outstanding * price

            data = {
                "symbol": symbol,
                "company_name": info.get("shortName") or info.get("longName", symbol),
                "long_name": info.get("longName", ""),
                "exchange": info.get("exchange", "N/A"),
                "currency": info.get("currency", "USD"),
                "sector": info.get("sector", ""),
                "industry": info.get("industry", ""),
                "country": info.get("country", ""),
                "website": info.get("website", ""),
                "quote_type": info.get("quoteType", AssetType.STOCK),

                "price": price,
                "change": change,
                "change_percent": change_percent,
                "previous_close": prev_close,
                "today_open": info.get("regularMarketOpen") or info.get("open"),
                "today_high": info.get("regularMarketDayHigh") or info.get("dayHigh"),
                "today_low": info.get("regularMarketDayLow") or info.get("dayLow"),

                "volume": info.get("regularMarketVolume") or info.get("volume"),
                "avg_volume": info.get("averageVolume"),
                "avg_volume_10d": info.get("averageDailyVolume10Day"),

                "market_cap": market_cap,
                "market_cap_formatted": self._format_market_cap(market_cap) if market_cap else "N/A",
                "enterprise_value": info.get("enterpriseValue"),
                "shares_outstanding": shares_outstanding,
                "float_shares": info.get("floatShares"),
                "circulating_supply": circulating_supply,

                "pe_ratio": info.get("trailingPE"),
                "forward_pe": info.get("forwardPE"),
                "peg_ratio": info.get("pegRatio"),
                "eps": info.get("trailingEps"),
                "forward_eps": info.get("forwardEps"),
                "dividend_yield": self._safe_percent(info.get("dividendYield")),
                "dividend_rate": info.get("dividendRate"),
                "payout_ratio": self._safe_percent(info.get("payoutRatio")),
                "book_value": info.get("bookValue"),
                "price_to_book": info.get("priceToBook"),
                "revenue": info.get("totalRevenue"),
                "profit_margin": self._safe_percent(info.get("profitMargins")),
                "operating_margin": self._safe_percent(info.get("operatingMargins")),
                "return_on_equity": self._safe_percent(info.get("returnOnEquity")),

                "52_week_high": info.get("fiftyTwoWeekHigh"),
                "52_week_low": info.get("fiftyTwoWeekLow"),
                "50_day_avg": info.get("fiftyDayAverage"),
                "200_day_avg": info.get("twoHundredDayAverage"),

                "beta": info.get("beta"),
                "target_price": info.get("targetMeanPrice"),
                "recommendation": info.get("recommendationKey", ""),
                "number_of_analysts": info.get("numberOfAnalystOpinions"),

                "data_source": "yahoo",
                "data_quality": "good",

                "history_dates": [],
                "history_closes": [],
                "history_volumes": [],
                "history_highs": [],
                "history_lows": [],
            }

            if history is not None and not history.empty:
                data["history_dates"] = history.index.strftime("%Y-%m-%d").tolist()
                data["history_closes"] = [round(v, 4) for v in history["Close"].tolist()]
                data["history_volumes"] = history["Volume"].tolist()
                data["history_highs"] = [round(v, 4) for v in history["High"].tolist()]
                data["history_lows"] = [round(v, 4) for v in history["Low"].tolist()]
                data.update(self._calculate_period_changes(history, price))

            return data

        except Exception as err:
            _LOGGER.debug("yfinance error for %s: %s", symbol, err)
            return None

    def _fetch_yahoo_v8(self, symbol: str) -> dict[str, Any] | None:
        """Fetch data from Yahoo v8 Chart API (fallback)."""
        try:
            url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
            params = {"range": "3mo", "interval": "1d"}
            
            response = requests.get(url, params=params, headers=HEADERS, timeout=15)
            
            if response.status_code != 200:
                return None

            json_data = response.json()
            chart = json_data.get("chart", {})
            result = chart.get("result", [])

            if not result:
                return None

            result = result[0]
            meta = result.get("meta", {})
            indicators = result.get("indicators", {})
            timestamps = result.get("timestamp", [])

            price = meta.get("regularMarketPrice")
            if price is None:
                return None

            prev_close = meta.get("chartPreviousClose") or meta.get("previousClose")
            change = round(price - prev_close, 4) if prev_close else None
            change_pct = round((change / prev_close) * 100, 4) if change and prev_close else None

            quotes = indicators.get("quote", [{}])[0]
            closes = quotes.get("close", [])
            volumes = quotes.get("volume", [])
            highs = quotes.get("high", [])
            lows = quotes.get("low", [])

            from datetime import datetime
            dates = [datetime.fromtimestamp(ts).strftime("%Y-%m-%d") for ts in timestamps] if timestamps else []

            data = {
                "symbol": symbol,
                "company_name": meta.get("shortName", symbol),
                "long_name": meta.get("longName", ""),
                "exchange": meta.get("exchangeName", "N/A"),
                "currency": meta.get("currency", "USD"),
                "quote_type": meta.get("instrumentType", AssetType.STOCK),

                "price": price,
                "change": change,
                "change_percent": change_pct,
                "previous_close": prev_close,
                "today_open": meta.get("regularMarketOpen"),
                "today_high": meta.get("regularMarketDayHigh"),
                "today_low": meta.get("regularMarketDayLow"),

                "volume": meta.get("regularMarketVolume"),

                "52_week_high": meta.get("fiftyTwoWeekHigh"),
                "52_week_low": meta.get("fiftyTwoWeekLow"),

                "data_source": "yahoo_v8",
                "data_quality": "good",

                "history_dates": dates,
                "history_closes": [round(c, 4) if c else 0 for c in closes],
                "history_volumes": [v if v else 0 for v in volumes],
                "history_highs": [round(h, 4) if h else 0 for h in highs],
                "history_lows": [round(lo, 4) if lo else 0 for lo in lows],
            }

            return data

        except Exception as err:
            _LOGGER.debug("Yahoo v8 error for %s: %s", symbol, err)
            return None

    # =========================================================================
    # TECHNICAL ANALYSIS
    # =========================================================================

    def _enrich_with_analysis(self, symbol: str, data: dict[str, Any]) -> dict[str, Any]:
        """Add technical analysis to data."""
        closes = data.get("history_closes", [])
        highs = data.get("history_highs", [])
        lows = data.get("history_lows", [])
        volumes = data.get("history_volumes", [])

        if not closes or len(closes) < 5:
            data["trend"] = {"direction": "unknown", "strength": 0, "confidence": 0}
            data["indicators"] = {}
            data["overall_signal"] = "N/A"
            return data

        data["trend"] = self._technical.calculate_trend(closes)
        data["indicators"] = self._technical.calculate_all_indicators(
            closes=closes, highs=highs, lows=lows, volumes=volumes
        )
        data["volume_analysis"] = self._technical.analyze_volume(volumes)
        data["overall_signal"] = self._technical.get_overall_signal(data["indicators"])

        return data

    # =========================================================================
    # HELPER METHODS
    # =========================================================================

    def _calculate_period_changes(self, history, current_price: float) -> dict[str, float | None]:
        """Calculate price changes for different periods."""
        result = {}
        closes = history["Close"]

        if len(closes) < 2:
            return result

        if len(closes) >= 5:
            week_ago = closes.iloc[-5]
            result["week_change_percent"] = round(((current_price - week_ago) / week_ago) * 100, 2)

        if len(closes) >= 21:
            month_ago = closes.iloc[-21]
            result["month_change_percent"] = round(((current_price - month_ago) / month_ago) * 100, 2)

        if len(closes) >= 63:
            quarter_ago = closes.iloc[-63]
            result["quarter_change_percent"] = round(((current_price - quarter_ago) / quarter_ago) * 100, 2)

        try:
            current_year = datetime.now().year
            ytd_data = closes[closes.index.year == current_year]
            if not ytd_data.empty:
                year_start = ytd_data.iloc[0]
                result["ytd_change_percent"] = round(((current_price - year_start) / year_start) * 100, 2)
        except Exception:
            pass

        return result

    def _get_history_safe(self, ticker, period: str = "3mo"):
        """Safely get historical data."""
        try:
            history = ticker.history(period=period)
            if history is not None and not history.empty:
                return history
        except Exception as err:
            _LOGGER.debug("History fetch error: %s", err)
        return None

    @staticmethod
    def _safe_percent(value) -> float | None:
        """Convert decimal to percentage."""
        if value is not None:
            try:
                return round(float(value) * 100, 2)
            except (ValueError, TypeError):
                pass
        return None

    @staticmethod
    def _format_market_cap(value) -> str:
        """Format market cap to readable string."""
        try:
            value = float(value)
            if value <= 0:
                return "N/A"
            if value >= 1_000_000_000_000:
                return f"{value / 1_000_000_000_000:.2f}T"
            elif value >= 1_000_000_000:
                return f"{value / 1_000_000_000:.2f}B"
            elif value >= 1_000_000:
                return f"{value / 1_000_000:.2f}M"
            elif value >= 1_000:
                return f"{value / 1_000:.2f}K"
            return f"{value:.2f}"
        except (ValueError, TypeError):
            return "N/A"

    def _empty_data(self, symbol: str, asset_type: str = AssetType.UNKNOWN) -> dict[str, Any]:
        """Return empty data structure."""
        return {
            "symbol": symbol,
            "company_name": symbol,
            "price": None,
            "change": None,
            "change_percent": None,
            "market_cap": None,
            "market_cap_formatted": "N/A",
            "asset_type": asset_type,
            "data_source": "none",
            "data_quality": "unavailable",
            "trend": {"direction": "unknown", "strength": 0},
            "indicators": {},
            "overall_signal": "N/A",
            "market_status": {"status": "unknown"},
        }

    # =========================================================================
    # SYMBOL MANAGEMENT
    # =========================================================================

    def add_symbol(self, symbol: str) -> None:
        """Add a symbol."""
        symbol = symbol.upper().strip()
        if symbol not in self.symbols:
            self.symbols.append(symbol)
            _LOGGER.info("Added symbol: %s", symbol)

    def remove_symbol(self, symbol: str) -> None:
        """Remove a symbol."""
        symbol = symbol.upper().strip()
        if symbol in self.symbols:
            self.symbols.remove(symbol)
            _LOGGER.info("Removed symbol: %s", symbol)

    # =========================================================================
    # STATIC METHODS (for config flow & services)
    # =========================================================================

    @staticmethod
    def validate_symbol(symbol: str) -> bool:
        """Validate if a symbol exists."""
        symbol = symbol.upper().strip()
        
        # Check known mappings first
        if symbol in FOREX_SYMBOLS or symbol in COMMODITY_SYMBOLS or symbol in BOND_SYMBOLS or symbol in INDEX_SYMBOLS:
            return True
        
        # Check crypto
        base = symbol.split("-")[0] if "-" in symbol else symbol
        if base in CRYPTO_MAPPING:
            return True
        
        # Try CoinGecko search for crypto
        crypto_patterns = [r"^[A-Z0-9]{2,10}-USD$", r"^[A-Z0-9]{2,10}-EUR$"]
        if any(re.match(p, symbol) for p in crypto_patterns):
            try:
                url = f"https://api.coingecko.com/api/v3/search?query={base}"
                response = requests.get(url, headers=HEADERS, timeout=10)
                if response.status_code == 200:
                    data = response.json()
                    coins = data.get("coins", [])
                    for coin in coins:
                        if coin.get("symbol", "").upper() == base:
                            return True
                    return len(coins) > 0
            except Exception:
                pass
        
        # Validate via yfinance
        try:
            ticker = yf.Ticker(symbol)
            info = ticker.info
            return bool(info and (
                info.get("regularMarketPrice") is not None
                or info.get("previousClose") is not None
                or info.get("shortName") is not None
            ))
        except Exception:
            return False

    @staticmethod
    def search_symbols(query: str, limit: int = 10) -> list[dict[str, Any]]:
        """Search for all asset types."""
        results = []
        query_upper = query.upper().strip()
        
        if not query:
            return results

        # 1. Check Forex mappings
        for key, symbol in FOREX_SYMBOLS.items():
            if query_upper in key:
                results.append({
                    "symbol": symbol,
                    "name": key.replace("/", " / ") if "/" in key else f"{key[:3]} / {key[3:]}",
                    "exchange": "Forex",
                    "type": AssetType.FOREX,
                    "source": "mapping",
                })

        # 2. Check Commodity mappings
        for key, symbol in COMMODITY_SYMBOLS.items():
            if query_upper in key:
                results.append({
                    "symbol": symbol,
                    "name": key.title(),
                    "exchange": "Commodities",
                    "type": AssetType.COMMODITY,
                    "source": "mapping",
                })

        # 3. Check Index mappings
        for key, symbol in INDEX_SYMBOLS.items():
            if query_upper in key:
                results.append({
                    "symbol": symbol,
                    "name": key,
                    "exchange": "Index",
                    "type": AssetType.INDEX,
                    "source": "mapping",
                })

        # 4. Search CoinGecko (crypto)
        try:
            url = "https://api.coingecko.com/api/v3/search"
            params = {"query": query}
            
            response = requests.get(url, params=params, headers=HEADERS, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                coins = data.get("coins", [])
                
                for coin in coins[:limit]:
                    symbol = coin.get("symbol", "").upper()
                    name = coin.get("name", symbol)
                    
                    results.append({
                        "symbol": f"{symbol}-USD",
                        "name": name,
                        "exchange": "Crypto",
                        "type": AssetType.CRYPTO,
                        "source": "coingecko",
                        "coingecko_id": coin.get("id"),
                        "market_cap_rank": coin.get("market_cap_rank"),
                    })
                    
                    results.append({
                        "symbol": f"{symbol}-EUR",
                        "name": f"{name} (EUR)",
                        "exchange": "Crypto",
                        "type": AssetType.CRYPTO,
                        "source": "coingecko",
                        "coingecko_id": coin.get("id"),
                    })
                        
        except Exception as err:
            _LOGGER.debug("CoinGecko search error: %s", err)

        # 5. Search Yahoo Finance (stocks, ETFs)
        try:
            url = "https://query2.finance.yahoo.com/v1/finance/search"
            params = {"q": query, "quotesCount": limit, "newsCount": 0}

            response = requests.get(url, params=params, headers=HEADERS, timeout=10)

            if response.status_code == 200:
                data = response.json()
                for quote in data.get("quotes", []):
                    symbol = quote.get("symbol", "")
                    quote_type = quote.get("quoteType", "EQUITY")
                    
                    if any(r["symbol"] == symbol for r in results):
                        continue
                    
                    if quote_type == "CRYPTOCURRENCY":
                        continue
                    
                    if symbol:
                        results.append({
                            "symbol": symbol,
                            "name": quote.get("shortname", quote.get("longname", symbol)),
                            "exchange": quote.get("exchange", ""),
                            "type": quote_type,
                            "source": "yahoo",
                        })
        except Exception as err:
            _LOGGER.debug("Yahoo search error: %s", err)

        # Sort by type priority and name
        def sort_key(item):
            type_order = {
                AssetType.CRYPTO: 0,
                AssetType.STOCK: 1,
                AssetType.ETF: 2,
                AssetType.INDEX: 3,
                AssetType.FOREX: 4,
                AssetType.COMMODITY: 5,
                AssetType.BOND: 6,
            }
            rank = item.get("market_cap_rank") or 9999
            return (type_order.get(item.get("type"), 99), rank, item.get("name", ""))
        
        results.sort(key=sort_key)
        
        # Remove duplicates
        seen = set()
        unique = []
        for r in results:
            if r["symbol"] not in seen:
                seen.add(r["symbol"])
                unique.append(r)
        
        return unique[:limit * 2]