"""
Data Update Coordinator for Stock Tracker.

Fetches stock data from multiple sources with automatic fallback.
Sources (no API key needed):
  1. Yahoo Finance (yfinance library)
  2. Yahoo Finance Search API
  3. Google Finance (web scraping)
  4. Fallback: Basic data from multiple sources

v2.0 Changes:
  - Market cap fix: multiple fallbacks + calculation from supply
  - Crypto supply data (circulating, total, max)
  - Better data enrichment for all sources
"""
from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

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

# HTTP Headers für Web Requests
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )
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
        """Fetch data from data sources (called by HA automatically)."""
        try:
            data = await self.hass.async_add_executor_job(
                self._fetch_all_symbols
            )
            return data
        except Exception as err:
            raise UpdateFailed(
                f"Error fetching stock data: {err}"
            ) from err

    def _fetch_all_symbols(self) -> dict[str, Any]:
        """Fetch data for all symbols (runs in executor thread)."""
        result = {}

        for symbol in self.symbols:
            try:
                stock_data = self._fetch_symbol_data(symbol)

                if stock_data:
                    # Post-processing: ensure market_cap is calculated
                    stock_data = self._ensure_market_cap(stock_data)
                    result[symbol] = stock_data
                    _LOGGER.debug(
                        "Fetched data for %s: price=%s, market_cap=%s",
                        symbol,
                        stock_data.get("price"),
                        stock_data.get("market_cap"),
                    )
                else:
                    _LOGGER.warning("No data returned for %s", symbol)
                    result[symbol] = self._empty_data(symbol)

            except Exception as err:
                _LOGGER.error(
                    "Error fetching %s: %s", symbol, err
                )
                result[symbol] = self._empty_data(symbol)

        return result

    # =========================================================================
    # ENSURE MARKET CAP (Post-Processing)
    # =========================================================================

    def _ensure_market_cap(self, data: dict[str, Any]) -> dict[str, Any]:
        """
        Ensure market_cap has a value.
        
        Fallback chain:
        1. Already set from source -> use it
        2. Calculate from circulating_supply * price
        3. Calculate from shares_outstanding * price
        4. Try fetching from Yahoo info API
        """
        mc = data.get("market_cap")
        price = data.get("price")

        # Already have valid market cap
        if mc is not None and mc != 0 and mc != "N/A":
            try:
                if float(mc) > 0:
                    return data
            except (ValueError, TypeError):
                pass

        if not price or price <= 0:
            return data

        # Fallback 1: circulating_supply * price (crypto)
        circ_supply = data.get("circulating_supply")
        if circ_supply and float(circ_supply) > 0:
            calculated_mc = float(circ_supply) * float(price)
            data["market_cap"] = calculated_mc
            _LOGGER.debug(
                "Market cap calculated from supply for %s: %s",
                data.get("symbol"), calculated_mc
            )
            return data

        # Fallback 2: shares_outstanding * price (stocks)
        shares = data.get("shares_outstanding")
        if shares and float(shares) > 0:
            calculated_mc = float(shares) * float(price)
            data["market_cap"] = calculated_mc
            _LOGGER.debug(
                "Market cap calculated from shares for %s: %s",
                data.get("symbol"), calculated_mc
            )
            return data

        # Fallback 3: Try fetching from Yahoo ticker.info directly
        symbol = data.get("symbol")
        if symbol and data.get("data_source") != SOURCE_YAHOO:
            try:
                ticker = yf.Ticker(symbol)
                info = ticker.info or {}
                
                mc_from_info = info.get("marketCap")
                if mc_from_info and mc_from_info > 0:
                    data["market_cap"] = mc_from_info
                    _LOGGER.debug(
                        "Market cap fetched from Yahoo fallback for %s: %s",
                        symbol, mc_from_info
                    )
                    
                    # Also grab supply data if missing
                    if not data.get("circulating_supply"):
                        cs = info.get("circulatingSupply")
                        if cs:
                            data["circulating_supply"] = cs
                    if not data.get("total_supply"):
                        ts = info.get("totalSupply") 
                        if ts:
                            data["total_supply"] = ts
                    if not data.get("max_supply"):
                        ms = info.get("maxSupply")
                        if ms:
                            data["max_supply"] = ms
                    if not data.get("shares_outstanding"):
                        so = info.get("sharesOutstanding")
                        if so:
                            data["shares_outstanding"] = so
                            
            except Exception as err:
                _LOGGER.debug(
                    "Yahoo fallback for market_cap failed for %s: %s",
                    symbol, err
                )

        return data

    # =========================================================================
    # MULTI-SOURCE FETCH WITH FALLBACK
    # =========================================================================

    def _fetch_symbol_data(self, symbol: str) -> dict[str, Any] | None:
        """
        Fetch data for a single symbol with multi-source fallback.

        Priority:
          1. Yahoo Finance (yfinance) - most reliable
          2. Yahoo Finance Search API - backup
          3. Google Finance - fallback
        """
        sources = self._get_source_order(symbol)

        for source in sources:
            try:
                if source == SOURCE_YAHOO:
                    data = self._fetch_yahoo(symbol)
                elif source == SOURCE_GOOGLE:
                    data = self._fetch_google(symbol)
                elif source == SOURCE_INVESTING:
                    data = self._fetch_investing(symbol)
                else:
                    continue

                if data and data.get("price") is not None:
                    data["data_source"] = source
                    data["data_quality"] = "good"

                    # Technische Analyse hinzufügen
                    data = self._enrich_with_analysis(symbol, data)

                    return data

            except Exception as err:
                _LOGGER.debug(
                    "Source %s failed for %s: %s",
                    source, symbol, err,
                )
                self._mark_source_failed(symbol, source)
                continue

        _LOGGER.warning(
            "All sources failed for %s", symbol
        )
        return None

    def _get_source_order(self, symbol: str) -> list[str]:
        """Get ordered list of sources to try."""
        if self.preferred_source != SOURCE_AUTO:
            sources = [self.preferred_source]
            for s in [SOURCE_YAHOO, SOURCE_GOOGLE, SOURCE_INVESTING]:
                if s not in sources:
                    sources.append(s)
            return sources

        # Auto-Modus: Yahoo zuerst
        failed = self._failed_sources.get(symbol, [])

        sources = [SOURCE_YAHOO, SOURCE_GOOGLE, SOURCE_INVESTING]

        # Fehlgeschlagene Quellen ans Ende
        for failed_source in failed:
            if failed_source in sources:
                sources.remove(failed_source)
                sources.append(failed_source)

        return sources

    def _mark_source_failed(self, symbol: str, source: str) -> None:
        """Mark a source as failed for a symbol."""
        if symbol not in self._failed_sources:
            self._failed_sources[symbol] = []
        if source not in self._failed_sources[symbol]:
            self._failed_sources[symbol].append(source)

        # Reset nach 3 Fehlversuchen
        if len(self._failed_sources[symbol]) >= 3:
            self._failed_sources[symbol] = []

    # =========================================================================
    # SOURCE 1: YAHOO FINANCE (yfinance library)
    # =========================================================================

    def _fetch_yahoo(self, symbol: str) -> dict[str, Any] | None:
        """Fetch stock data from Yahoo Finance using yfinance."""
        ticker = yf.Ticker(symbol)

        # Basis-Info abrufen
        info = ticker.info
        if not info:
            return None

        price = info.get("regularMarketPrice") or info.get("currentPrice")
        prev_close = info.get("regularMarketPreviousClose") or info.get("previousClose")

        if price is None and prev_close is None:
            return None

        if price is None:
            price = prev_close

        # Änderung berechnen
        change = None
        change_percent = None
        if price and prev_close:
            change = round(price - prev_close, 4)
            change_percent = round((change / prev_close) * 100, 4)

        # Historische Daten für technische Analyse
        history = self._get_history_safe(ticker, period="3mo")

        # Market Cap - multiple Fallbacks
        market_cap = (
            info.get("marketCap")
            or info.get("market_cap")
            or info.get("MarketCap")
            or None
        )

        # Circulating Supply (Krypto)
        circulating_supply = (
            info.get("circulatingSupply")
            or info.get("circulating_supply")
            or None
        )
        total_supply = (
            info.get("totalSupply")
            or info.get("total_supply")
            or None
        )
        max_supply = (
            info.get("maxSupply")
            or info.get("max_supply")
            or None
        )

        # Shares Outstanding (Aktien)
        shares_outstanding = (
            info.get("sharesOutstanding")
            or info.get("shares_outstanding")
            or None
        )

        # Wenn market_cap fehlt aber supply/shares vorhanden -> berechnen
        if (not market_cap or market_cap == 0) and price:
            if circulating_supply and circulating_supply > 0:
                market_cap = circulating_supply * price
            elif shares_outstanding and shares_outstanding > 0:
                market_cap = shares_outstanding * price

        data = {
            # === Identifikation ===
            "symbol": symbol,
            "company_name": info.get("shortName") or info.get("longName", symbol),
            "long_name": info.get("longName", ""),
            "exchange": info.get("exchange", "N/A"),
            "currency": info.get("currency", "USD"),
            "sector": info.get("sector", ""),
            "industry": info.get("industry", ""),
            "country": info.get("country", ""),
            "website": info.get("website", ""),

            # === Preisdaten ===
            "price": price,
            "change": change,
            "change_percent": change_percent,
            "previous_close": prev_close,
            "today_open": info.get("regularMarketOpen") or info.get("open"),
            "today_high": info.get("regularMarketDayHigh") or info.get("dayHigh"),
            "today_low": info.get("regularMarketDayLow") or info.get("dayLow"),

            # === Volumen ===
            "volume": info.get("regularMarketVolume") or info.get("volume"),
            "avg_volume": info.get("averageVolume"),
            "avg_volume_10d": info.get("averageDailyVolume10Day"),

            # === Marktdaten ===
            "market_cap": market_cap,
            "enterprise_value": info.get("enterpriseValue"),
            "shares_outstanding": shares_outstanding,
            "float_shares": info.get("floatShares"),

            # === Supply (Krypto) ===
            "circulating_supply": circulating_supply,
            "total_supply": total_supply,
            "max_supply": max_supply,

            # === Fundamentaldaten ===
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

            # === Bereiche ===
            "52_week_high": info.get("fiftyTwoWeekHigh"),
            "52_week_low": info.get("fiftyTwoWeekLow"),
            "50_day_avg": info.get("fiftyDayAverage"),
            "200_day_avg": info.get("twoHundredDayAverage"),

            # === Meta ===
            "beta": info.get("beta"),
            "target_price": info.get("targetMeanPrice"),
            "recommendation": info.get("recommendationKey", ""),
            "number_of_analysts": info.get("numberOfAnalystOpinions"),
            "next_earnings_date": str(info.get("earningsTimestamp", "")),
            "quote_type": info.get("quoteType", "EQUITY"),

            # === Historische Daten ===
            "history_dates": [],
            "history_closes": [],
            "history_volumes": [],
            "history_highs": [],
            "history_lows": [],
        }

        # Historische Daten einbinden
        if history is not None and not history.empty:
            data["history_dates"] = (
                history.index.strftime("%Y-%m-%d").tolist()
            )
            data["history_closes"] = [
                round(v, 4) for v in history["Close"].tolist()
            ]
            data["history_volumes"] = history["Volume"].tolist()
            data["history_highs"] = [
                round(v, 4) for v in history["High"].tolist()
            ]
            data["history_lows"] = [
                round(v, 4) for v in history["Low"].tolist()
            ]

        # Zeitraum-Performance
        if history is not None and not history.empty:
            data.update(self._calculate_period_changes(history, price))

        return data

    # =========================================================================
    # SOURCE 2: GOOGLE FINANCE (Web Scraping Fallback)
    # =========================================================================

    def _fetch_google(self, symbol: str) -> dict[str, Any] | None:
        """Fetch basic stock data from Google Finance (fallback)."""
        try:
            from bs4 import BeautifulSoup

            url = f"https://www.google.com/finance/quote/{symbol}"

            if "." not in symbol and ":" not in symbol:
                for exchange in ["NASDAQ", "NYSE"]:
                    test_url = (
                        f"https://www.google.com/finance/quote/"
                        f"{symbol}:{exchange}"
                    )
                    try:
                        response = requests.get(
                            test_url, headers=HEADERS, timeout=10
                        )
                        if response.status_code == 200 and "data-last-price" in response.text:
                            url = test_url
                            break
                    except Exception:
                        continue

            response = requests.get(url, headers=HEADERS, timeout=10)

            if response.status_code != 200:
                return None

            soup = BeautifulSoup(response.text, "html.parser")

            price_element = soup.find("div", {"data-last-price": True})
            if not price_element:
                return None

            price = float(price_element["data-last-price"])

            change = None
            change_percent = None
            change_element = soup.find("div", {"data-last-normal-market-change": True})
            if change_element:
                try:
                    change = float(change_element.get("data-last-normal-market-change", 0))
                    change_pct_str = change_element.get(
                        "data-last-normal-market-change-percent", "0"
                    )
                    change_percent = float(change_pct_str.strip("%"))
                except (ValueError, TypeError):
                    pass

            name_element = soup.find("div", class_="zzDege")
            company_name = name_element.text if name_element else symbol

            currency_element = soup.find("div", {"data-currency-code": True})
            currency = (
                currency_element["data-currency-code"]
                if currency_element
                else "USD"
            )

            prev_close = price - change if change else None

            # Market cap: try to extract from Google page
            market_cap = None
            try:
                # Google Finance shows market cap in the details section
                detail_divs = soup.find_all("div", class_="P6K39c")
                for div in detail_divs:
                    label = div.find("div", class_="mfs7Fc")
                    value = div.find("div", class_="YMlKec")
                    if label and value:
                        label_text = label.text.strip().lower()
                        if "market cap" in label_text or "marktkapitalisierung" in label_text:
                            market_cap = self._parse_google_market_cap(value.text.strip())
                            break
            except Exception:
                pass

            return {
                "symbol": symbol,
                "company_name": company_name,
                "long_name": company_name,
                "exchange": "Google Finance",
                "currency": currency,
                "sector": "",
                "industry": "",
                "country": "",
                "website": "",
                "price": price,
                "change": change,
                "change_percent": change_percent,
                "previous_close": prev_close,
                "today_open": None,
                "today_high": None,
                "today_low": None,
                "volume": None,
                "avg_volume": None,
                "avg_volume_10d": None,
                "market_cap": market_cap,
                "enterprise_value": None,
                "shares_outstanding": None,
                "float_shares": None,
                "circulating_supply": None,
                "total_supply": None,
                "max_supply": None,
                "pe_ratio": None,
                "forward_pe": None,
                "peg_ratio": None,
                "eps": None,
                "forward_eps": None,
                "dividend_yield": None,
                "dividend_rate": None,
                "payout_ratio": None,
                "book_value": None,
                "price_to_book": None,
                "revenue": None,
                "profit_margin": None,
                "operating_margin": None,
                "return_on_equity": None,
                "52_week_high": None,
                "52_week_low": None,
                "50_day_avg": None,
                "200_day_avg": None,
                "beta": None,
                "target_price": None,
                "recommendation": "",
                "number_of_analysts": None,
                "next_earnings_date": "",
                "quote_type": "EQUITY",
                "history_dates": [],
                "history_closes": [],
                "history_volumes": [],
                "history_highs": [],
                "history_lows": [],
            }

        except ImportError:
            _LOGGER.error("beautifulsoup4 not installed")
            return None
        except Exception as err:
            _LOGGER.debug("Google Finance fetch error: %s", err)
            return None

    @staticmethod
    def _parse_google_market_cap(text: str) -> float | None:
        """Parse Google Finance market cap text like '2.89T USD' or '156.3B'."""
        if not text:
            return None
        try:
            text = text.replace(",", "").replace("$", "").replace("€", "").strip()
            # Remove currency codes
            for cur in ["USD", "EUR", "GBP", "JPY", "CHF"]:
                text = text.replace(cur, "").strip()
            
            multipliers = {
                "T": 1_000_000_000_000,
                "B": 1_000_000_000,
                "Mrd": 1_000_000_000,
                "Bio": 1_000_000_000_000,
                "M": 1_000_000,
                "Mio": 1_000_000,
                "K": 1_000,
            }
            
            for suffix, mult in multipliers.items():
                if text.upper().endswith(suffix.upper()):
                    num_part = text[:len(text) - len(suffix)].strip()
                    return float(num_part) * mult
            
            return float(text)
        except (ValueError, TypeError):
            return None

    # =========================================================================
    # SOURCE 3: INVESTING.COM (Yahoo v8 API Fallback)
    # =========================================================================

    def _fetch_investing(self, symbol: str) -> dict[str, Any] | None:
        """Fetch data from Yahoo Finance v8 chart API + supplementary info."""
        try:
            # Step 1: Chart API for price data + history
            url = (
                f"https://query1.finance.yahoo.com/v8/finance/chart/"
                f"{symbol}?range=3mo&interval=1d"
            )

            response = requests.get(url, headers=HEADERS, timeout=10)

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
            change_pct = (
                round((change / prev_close) * 100, 4)
                if change and prev_close
                else None
            )

            # Historische Daten
            quotes = indicators.get("quote", [{}])[0]
            closes = quotes.get("close", [])
            volumes = quotes.get("volume", [])
            highs = quotes.get("high", [])
            lows = quotes.get("low", [])

            from datetime import datetime
            dates = [
                datetime.fromtimestamp(ts).strftime("%Y-%m-%d")
                for ts in timestamps
            ] if timestamps else []

            clean_closes = [
                round(c, 4) if c is not None else 0
                for c in closes
            ]
            clean_volumes = [v if v is not None else 0 for v in volumes]
            clean_highs = [
                round(h, 4) if h is not None else 0
                for h in highs
            ]
            clean_lows = [
                round(lo, 4) if lo is not None else 0
                for lo in lows
            ]

            # Step 2: Try to get supplementary data (market cap, supply, etc.)
            # via Yahoo v10 or v7 quoteSummary API
            supplementary = self._fetch_supplementary_data(symbol)

            market_cap = supplementary.get("market_cap")
            circulating_supply = supplementary.get("circulating_supply")
            total_supply = supplementary.get("total_supply")
            max_supply = supplementary.get("max_supply")
            shares_outstanding = supplementary.get("shares_outstanding")
            pe_ratio = supplementary.get("pe_ratio")
            eps = supplementary.get("eps")
            dividend_yield = supplementary.get("dividend_yield")
            avg_volume = supplementary.get("avg_volume")
            week52_high = supplementary.get("52_week_high") or meta.get("fiftyTwoWeekHigh")
            week52_low = supplementary.get("52_week_low") or meta.get("fiftyTwoWeekLow")
            day50_avg = supplementary.get("50_day_avg")
            day200_avg = supplementary.get("200_day_avg")

            # Calculate market cap if still missing
            if (not market_cap or market_cap == 0) and price:
                if circulating_supply and circulating_supply > 0:
                    market_cap = circulating_supply * price
                elif shares_outstanding and shares_outstanding > 0:
                    market_cap = shares_outstanding * price

            return {
                "symbol": symbol,
                "company_name": meta.get("shortName", symbol),
                "long_name": meta.get("longName", ""),
                "exchange": meta.get("exchangeName", "N/A"),
                "currency": meta.get("currency", "USD"),
                "sector": supplementary.get("sector", ""),
                "industry": supplementary.get("industry", ""),
                "country": "",
                "website": "",
                "price": price,
                "change": change,
                "change_percent": change_pct,
                "previous_close": prev_close,
                "today_open": meta.get("regularMarketOpen"),
                "today_high": meta.get("regularMarketDayHigh"),
                "today_low": meta.get("regularMarketDayLow"),
                "volume": meta.get("regularMarketVolume"),
                "avg_volume": avg_volume,
                "avg_volume_10d": None,
                "market_cap": market_cap,
                "enterprise_value": None,
                "shares_outstanding": shares_outstanding,
                "float_shares": None,
                "circulating_supply": circulating_supply,
                "total_supply": total_supply,
                "max_supply": max_supply,
                "pe_ratio": pe_ratio,
                "forward_pe": None,
                "peg_ratio": None,
                "eps": eps,
                "forward_eps": None,
                "dividend_yield": dividend_yield,
                "dividend_rate": None,
                "payout_ratio": None,
                "book_value": None,
                "price_to_book": None,
                "revenue": None,
                "profit_margin": None,
                "operating_margin": None,
                "return_on_equity": None,
                "52_week_high": week52_high,
                "52_week_low": week52_low,
                "50_day_avg": day50_avg,
                "200_day_avg": day200_avg,
                "beta": None,
                "target_price": None,
                "recommendation": "",
                "number_of_analysts": None,
                "next_earnings_date": "",
                "quote_type": meta.get("instrumentType", "EQUITY"),
                "history_dates": dates,
                "history_closes": clean_closes,
                "history_volumes": clean_volumes,
                "history_highs": clean_highs,
                "history_lows": clean_lows,
            }

        except Exception as err:
            _LOGGER.debug("Investing fallback fetch error: %s", err)
            return None

    def _fetch_supplementary_data(self, symbol: str) -> dict[str, Any]:
        """
        Fetch supplementary data like market cap, supply, PE ratio.
        Uses Yahoo v7 quote API which returns more data than v8 chart API.
        """
        result = {}
        
        try:
            # Yahoo v7 quote API - returns market cap, supply data, fundamentals
            url = (
                f"https://query1.finance.yahoo.com/v7/finance/quote"
                f"?symbols={symbol}&fields=marketCap,sharesOutstanding,"
                f"circulatingSupply,totalSupply,maxSupply,"
                f"trailingPE,epsTrailingTwelveMonths,dividendYield,"
                f"averageVolume,fiftyTwoWeekHigh,fiftyTwoWeekLow,"
                f"fiftyDayAverage,twoHundredDayAverage,"
                f"sector,industry"
            )
            
            response = requests.get(url, headers=HEADERS, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                quote_response = data.get("quoteResponse", {})
                quotes = quote_response.get("result", [])
                
                if quotes:
                    q = quotes[0]
                    
                    result["market_cap"] = q.get("marketCap")
                    result["shares_outstanding"] = q.get("sharesOutstanding")
                    result["circulating_supply"] = q.get("circulatingSupply")
                    result["total_supply"] = q.get("totalSupply")
                    result["max_supply"] = q.get("maxSupply")
                    result["pe_ratio"] = q.get("trailingPE")
                    result["eps"] = q.get("epsTrailingTwelveMonths")
                    result["avg_volume"] = q.get("averageVolume") or q.get("averageDailyVolume3Month")
                    result["52_week_high"] = q.get("fiftyTwoWeekHigh")
                    result["52_week_low"] = q.get("fiftyTwoWeekLow")
                    result["50_day_avg"] = q.get("fiftyDayAverage")
                    result["200_day_avg"] = q.get("twoHundredDayAverage")
                    result["sector"] = q.get("sector", "")
                    result["industry"] = q.get("industry", "")
                    
                    div_yield = q.get("dividendYield")
                    if div_yield:
                        result["dividend_yield"] = round(div_yield * 100, 2)

                    _LOGGER.debug(
                        "Supplementary data fetched for %s: mc=%s, supply=%s",
                        symbol,
                        result.get("market_cap"),
                        result.get("circulating_supply"),
                    )
                    
        except Exception as err:
            _LOGGER.debug(
                "Supplementary data fetch failed for %s: %s",
                symbol, err
            )
        
        return result

    # =========================================================================
    # TECHNICAL ANALYSIS ENRICHMENT
    # =========================================================================

    def _enrich_with_analysis(
        self, symbol: str, data: dict[str, Any]
    ) -> dict[str, Any]:
        """Add technical analysis to stock data."""
        closes = data.get("history_closes", [])
        highs = data.get("history_highs", [])
        lows = data.get("history_lows", [])
        volumes = data.get("history_volumes", [])

        if not closes or len(closes) < 5:
            data["trend"] = {
                "direction": "unknown",
                "strength": 0,
                "confidence": 0,
            }
            data["indicators"] = {}
            return data

        # Trend-Analyse
        data["trend"] = self._technical.calculate_trend(closes)

        # Technische Indikatoren
        data["indicators"] = self._technical.calculate_all_indicators(
            closes=closes,
            highs=highs,
            lows=lows,
            volumes=volumes,
        )

        # Volumen-Analyse
        data["volume_analysis"] = self._technical.analyze_volume(volumes)

        # Gesamtsignal
        data["overall_signal"] = self._technical.get_overall_signal(
            data["indicators"]
        )

        return data

    # =========================================================================
    # PERIOD CHANGES
    # =========================================================================

    def _calculate_period_changes(
        self, history, current_price: float
    ) -> dict[str, float | None]:
        """Calculate price changes for different periods."""
        result = {}

        closes = history["Close"]

        if len(closes) < 2:
            return result

        # 1 Woche
        if len(closes) >= 5:
            week_ago = closes.iloc[-5]
            result["week_change"] = round(current_price - week_ago, 4)
            result["week_change_percent"] = round(
                ((current_price - week_ago) / week_ago) * 100, 2
            )

        # 1 Monat
        if len(closes) >= 21:
            month_ago = closes.iloc[-21]
            result["month_change"] = round(current_price - month_ago, 4)
            result["month_change_percent"] = round(
                ((current_price - month_ago) / month_ago) * 100, 2
            )

        # 3 Monate
        if len(closes) >= 63:
            quarter_ago = closes.iloc[-63]
            result["quarter_change"] = round(current_price - quarter_ago, 4)
            result["quarter_change_percent"] = round(
                ((current_price - quarter_ago) / quarter_ago) * 100, 2
            )

        # YTD
        try:
            from datetime import datetime
            current_year = datetime.now().year
            ytd_data = closes[closes.index.year == current_year]
            if not ytd_data.empty:
                year_start = ytd_data.iloc[0]
                result["ytd_change"] = round(
                    current_price - year_start, 4
                )
                result["ytd_change_percent"] = round(
                    ((current_price - year_start) / year_start) * 100, 2
                )
        except Exception:
            pass

        return result

    # =========================================================================
    # HELPER METHODS
    # =========================================================================

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
        """Convert decimal to percentage safely."""
        if value is not None:
            try:
                return round(float(value) * 100, 2)
            except (ValueError, TypeError):
                pass
        return None

    def _empty_data(self, symbol: str) -> dict[str, Any]:
        """Return empty data structure for a failed symbol."""
        return {
            "symbol": symbol,
            "company_name": symbol,
            "price": None,
            "change": None,
            "change_percent": None,
            "market_cap": None,
            "circulating_supply": None,
            "total_supply": None,
            "max_supply": None,
            "shares_outstanding": None,
            "data_source": "none",
            "data_quality": "unavailable",
            "trend": {"direction": "unknown", "strength": 0},
            "indicators": {},
            "volume_analysis": {},
            "overall_signal": "N/A",
        }

    # =========================================================================
    # SYMBOL MANAGEMENT
    # =========================================================================

    def add_symbol(self, symbol: str) -> None:
        """Add a symbol to tracking."""
        symbol = symbol.upper().strip()
        if symbol not in self.symbols:
            self.symbols.append(symbol)
            _LOGGER.info("Added symbol: %s", symbol)

    def remove_symbol(self, symbol: str) -> None:
        """Remove a symbol from tracking."""
        symbol = symbol.upper().strip()
        if symbol in self.symbols:
            self.symbols.remove(symbol)
            _LOGGER.info("Removed symbol: %s", symbol)

    # =========================================================================
    # STATIC METHODS
    # =========================================================================

    @staticmethod
    def validate_symbol(symbol: str) -> bool:
        """Validate if a symbol exists."""
        try:
            ticker = yf.Ticker(symbol.upper().strip())
            info = ticker.info
            return bool(
                info
                and (
                    info.get("regularMarketPrice") is not None
                    or info.get("previousClose") is not None
                    or info.get("shortName") is not None
                )
            )
        except Exception:
            return False

    @staticmethod
    def search_symbols(query: str, limit: int = 10) -> list[dict[str, Any]]:
        """Search for symbols."""
        results = []

        try:
            url = "https://query2.finance.yahoo.com/v1/finance/search"
            params = {
                "q": query,
                "quotesCount": limit,
                "newsCount": 0,
                "listsCount": 0,
                "enableFuzzyQuery": True,
            }

            response = requests.get(
                url, params=params, headers=HEADERS, timeout=10
            )

            if response.status_code == 200:
                data = response.json()
                for quote in data.get("quotes", []):
                    results.append({
                        "symbol": quote.get("symbol", ""),
                        "name": quote.get("shortname", quote.get("longname", "")),
                        "exchange": quote.get("exchange", ""),
                        "type": quote.get("quoteType", ""),
                    })

        except Exception as err:
            _LOGGER.debug("Symbol search error: %s", err)

            try:
                ticker = yf.Ticker(query.upper())
                info = ticker.info
                if info and info.get("shortName"):
                    results.append({
                        "symbol": query.upper(),
                        "name": info.get("shortName", query.upper()),
                        "exchange": info.get("exchange", ""),
                        "type": info.get("quoteType", ""),
                    })
            except Exception:
                pass

        return results[:limit]