"""
Symbol Database for Stock Tracker.

Manages a local SQLite database of stock symbols for fast searching.
Auto-updates from public sources (no API key needed).

Features:
  - Fast local search with FTS5 (Full-Text Search)
  - Auto-download from NASDAQ, NYSE, XETRA
  - Daily delta updates
  - On-demand symbol validation
"""
from __future__ import annotations

import csv
import io
import json
import logging
import os
import sqlite3
from datetime import datetime, timedelta
from typing import Any

import requests

from homeassistant.core import HomeAssistant

from .const import DOMAIN, DB_FILENAME

_LOGGER = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )
}


# =============================================================================
# PUBLIC SYMBOL SOURCES (No API Key Required)
# =============================================================================

SYMBOL_SOURCES = {
    "nasdaq": {
        "name": "NASDAQ",
        "url": "https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&exchange=NASDAQ",
        "parser": "_parse_nasdaq_response",
    },
    "nyse": {
        "name": "NYSE",
        "url": "https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&exchange=NYSE",
        "parser": "_parse_nasdaq_response",
    },
    "amex": {
        "name": "AMEX",
        "url": "https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=5000&exchange=AMEX",
        "parser": "_parse_nasdaq_response",
    },
}

# Backup: FTP-Quellen falls API nicht verfügbar
BACKUP_SOURCES = {
    "nasdaq_ftp": {
        "name": "NASDAQ (FTP)",
        "url": "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqtraded.txt",
        "parser": "_parse_nasdaq_ftp",
    },
}

# Bekannte Krypto-Symbole (statisch, da keine gute kostenlose Quelle)
CRYPTO_SYMBOLS = [
    ("BTC-USD", "Bitcoin", "CRYPTO", "USD"),
    ("ETH-USD", "Ethereum", "CRYPTO", "USD"),
    ("BNB-USD", "Binance Coin", "CRYPTO", "USD"),
    ("XRP-USD", "Ripple", "CRYPTO", "USD"),
    ("ADA-USD", "Cardano", "CRYPTO", "USD"),
    ("SOL-USD", "Solana", "CRYPTO", "USD"),
    ("DOGE-USD", "Dogecoin", "CRYPTO", "USD"),
    ("DOT-USD", "Polkadot", "CRYPTO", "USD"),
    ("MATIC-USD", "Polygon", "CRYPTO", "USD"),
    ("AVAX-USD", "Avalanche", "CRYPTO", "USD"),
    ("LINK-USD", "Chainlink", "CRYPTO", "USD"),
    ("UNI-USD", "Uniswap", "CRYPTO", "USD"),
    ("ATOM-USD", "Cosmos", "CRYPTO", "USD"),
    ("LTC-USD", "Litecoin", "CRYPTO", "USD"),
    ("ALGO-USD", "Algorand", "CRYPTO", "USD"),
    ("XLM-USD", "Stellar", "CRYPTO", "USD"),
    ("VET-USD", "VeChain", "CRYPTO", "USD"),
    ("MANA-USD", "Decentraland", "CRYPTO", "USD"),
    ("SAND-USD", "The Sandbox", "CRYPTO", "USD"),
    ("AAVE-USD", "Aave", "CRYPTO", "USD"),
    ("FTM-USD", "Fantom", "CRYPTO", "USD"),
    ("NEAR-USD", "NEAR Protocol", "CRYPTO", "USD"),
    ("ICP-USD", "Internet Computer", "CRYPTO", "USD"),
    ("FIL-USD", "Filecoin", "CRYPTO", "USD"),
    ("HBAR-USD", "Hedera", "CRYPTO", "USD"),
    ("APE-USD", "ApeCoin", "CRYPTO", "USD"),
    ("ARB-USD", "Arbitrum", "CRYPTO", "USD"),
    ("OP-USD", "Optimism", "CRYPTO", "USD"),
    ("SUI-USD", "Sui", "CRYPTO", "USD"),
    ("SEI-USD", "Sei", "CRYPTO", "USD"),
]

# Bekannte deutsche Aktien
GERMAN_SYMBOLS = [
    ("SAP.DE", "SAP SE", "XETRA", "EUR"),
    ("SIE.DE", "Siemens AG", "XETRA", "EUR"),
    ("ALV.DE", "Allianz SE", "XETRA", "EUR"),
    ("DTE.DE", "Deutsche Telekom", "XETRA", "EUR"),
    ("BAS.DE", "BASF SE", "XETRA", "EUR"),
    ("BAY.DE", "Bayer AG", "XETRA", "EUR"),
    ("BMW.DE", "BMW AG", "XETRA", "EUR"),
    ("VOW3.DE", "Volkswagen AG", "XETRA", "EUR"),
    ("MBG.DE", "Mercedes-Benz", "XETRA", "EUR"),
    ("ADS.DE", "Adidas AG", "XETRA", "EUR"),
    ("DBK.DE", "Deutsche Bank", "XETRA", "EUR"),
    ("MRK.DE", "Merck KGaA", "XETRA", "EUR"),
    ("IFX.DE", "Infineon Technologies", "XETRA", "EUR"),
    ("MUV2.DE", "Munich Re", "XETRA", "EUR"),
    ("RWE.DE", "RWE AG", "XETRA", "EUR"),
    ("HEN3.DE", "Henkel AG", "XETRA", "EUR"),
    ("FRE.DE", "Fresenius SE", "XETRA", "EUR"),
    ("DPW.DE", "Deutsche Post", "XETRA", "EUR"),
    ("BEI.DE", "Beiersdorf AG", "XETRA", "EUR"),
    ("CON.DE", "Continental AG", "XETRA", "EUR"),
    ("HEI.DE", "HeidelbergCement", "XETRA", "EUR"),
    ("ENR.DE", "Siemens Energy", "XETRA", "EUR"),
    ("ZAL.DE", "Zalando SE", "XETRA", "EUR"),
    ("PAH3.DE", "Porsche Automobil", "XETRA", "EUR"),
    ("P911.DE", "Porsche AG", "XETRA", "EUR"),
    ("AIR.DE", "Airbus SE", "XETRA", "EUR"),
    ("SHL.DE", "Siemens Healthineers", "XETRA", "EUR"),
    ("SY1.DE", "Symrise AG", "XETRA", "EUR"),
    ("QIA.DE", "QIAGEN NV", "XETRA", "EUR"),
    ("DTG.DE", "Daimler Truck", "XETRA", "EUR"),
]

# Bekannte Indizes
INDEX_SYMBOLS = [
    ("^GSPC", "S&P 500", "INDEX", "USD"),
    ("^DJI", "Dow Jones Industrial", "INDEX", "USD"),
    ("^IXIC", "NASDAQ Composite", "INDEX", "USD"),
    ("^GDAXI", "DAX 40", "INDEX", "EUR"),
    ("^FTSE", "FTSE 100", "INDEX", "GBP"),
    ("^N225", "Nikkei 225", "INDEX", "JPY"),
    ("^HSI", "Hang Seng", "INDEX", "HKD"),
    ("^STOXX50E", "Euro Stoxx 50", "INDEX", "EUR"),
    ("^RUT", "Russell 2000", "INDEX", "USD"),
    ("^VIX", "CBOE Volatility Index", "INDEX", "USD"),
]

# Bekannte Währungspaare
CURRENCY_SYMBOLS = [
    ("EURUSD=X", "EUR/USD", "FOREX", "USD"),
    ("GBPUSD=X", "GBP/USD", "FOREX", "USD"),
    ("USDJPY=X", "USD/JPY", "FOREX", "JPY"),
    ("USDCHF=X", "USD/CHF", "FOREX", "CHF"),
    ("AUDUSD=X", "AUD/USD", "FOREX", "USD"),
    ("USDCAD=X", "USD/CAD", "FOREX", "CAD"),
    ("EURGBP=X", "EUR/GBP", "FOREX", "GBP"),
    ("EURJPY=X", "EUR/JPY", "FOREX", "JPY"),
    ("EURCHF=X", "EUR/CHF", "FOREX", "CHF"),
    ("GBPJPY=X", "GBP/JPY", "FOREX", "JPY"),
]

# Bekannte ETFs
ETF_SYMBOLS = [
    ("SPY", "SPDR S&P 500 ETF", "NYSE", "USD"),
    ("QQQ", "Invesco QQQ Trust", "NASDAQ", "USD"),
    ("IWM", "iShares Russell 2000", "NYSE", "USD"),
    ("VTI", "Vanguard Total Stock Market", "NYSE", "USD"),
    ("VOO", "Vanguard S&P 500", "NYSE", "USD"),
    ("DIA", "SPDR Dow Jones", "NYSE", "USD"),
    ("GLD", "SPDR Gold Trust", "NYSE", "USD"),
    ("SLV", "iShares Silver Trust", "NYSE", "USD"),
    ("TLT", "iShares 20+ Year Treasury", "NASDAQ", "USD"),
    ("EEM", "iShares MSCI Emerging Markets", "NYSE", "USD"),
    ("VEA", "Vanguard FTSE Developed Markets", "NYSE", "USD"),
    ("VWO", "Vanguard FTSE Emerging Markets", "NYSE", "USD"),
    ("ARKK", "ARK Innovation ETF", "NYSE", "USD"),
    ("XLK", "Technology Select Sector", "NYSE", "USD"),
    ("XLF", "Financial Select Sector", "NYSE", "USD"),
    ("XLE", "Energy Select Sector", "NYSE", "USD"),
    ("XLV", "Health Care Select Sector", "NYSE", "USD"),
    ("IEFA", "iShares Core MSCI EAFE", "NYSE", "USD"),
    ("AGG", "iShares Core US Aggregate Bond", "NYSE", "USD"),
    ("BND", "Vanguard Total Bond Market", "NASDAQ", "USD"),
]


class SymbolDatabase:
    """Manages local SQLite database of stock symbols."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the symbol database."""
        self.hass = hass
        self._db_path = os.path.join(
            hass.config.config_dir, ".storage", DB_FILENAME
        )
        self._ensure_db()

    # =========================================================================
    # DATABASE INITIALIZATION
    # =========================================================================

    def _ensure_db(self) -> None:
        """Ensure database exists and has correct schema."""
        os.makedirs(os.path.dirname(self._db_path), exist_ok=True)

        conn = self._get_connection()
        try:
            cursor = conn.cursor()

            # Haupttabelle
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS symbols (
                    symbol TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    exchange TEXT DEFAULT '',
                    currency TEXT DEFAULT 'USD',
                    country TEXT DEFAULT '',
                    sector TEXT DEFAULT '',
                    industry TEXT DEFAULT '',
                    asset_type TEXT DEFAULT 'EQUITY',
                    market_cap REAL DEFAULT 0,
                    last_updated TEXT DEFAULT '',
                    active INTEGER DEFAULT 1
                )
            """)

            # Full-Text Search Index
            cursor.execute("""
                CREATE VIRTUAL TABLE IF NOT EXISTS symbols_fts
                USING fts5(
                    symbol,
                    name,
                    exchange,
                    sector,
                    industry,
                    content='symbols',
                    content_rowid='rowid'
                )
            """)

            # Trigger für FTS Sync
            cursor.execute("""
                CREATE TRIGGER IF NOT EXISTS symbols_ai
                AFTER INSERT ON symbols
                BEGIN
                    INSERT INTO symbols_fts(
                        rowid, symbol, name, exchange, sector, industry
                    )
                    VALUES (
                        new.rowid, new.symbol, new.name,
                        new.exchange, new.sector, new.industry
                    );
                END
            """)

            cursor.execute("""
                CREATE TRIGGER IF NOT EXISTS symbols_ad
                AFTER DELETE ON symbols
                BEGIN
                    INSERT INTO symbols_fts(
                        symbols_fts, rowid, symbol, name,
                        exchange, sector, industry
                    )
                    VALUES (
                        'delete', old.rowid, old.symbol, old.name,
                        old.exchange, old.sector, old.industry
                    );
                END
            """)

            cursor.execute("""
                CREATE TRIGGER IF NOT EXISTS symbols_au
                AFTER UPDATE ON symbols
                BEGIN
                    INSERT INTO symbols_fts(
                        symbols_fts, rowid, symbol, name,
                        exchange, sector, industry
                    )
                    VALUES (
                        'delete', old.rowid, old.symbol, old.name,
                        old.exchange, old.sector, old.industry
                    );
                    INSERT INTO symbols_fts(
                        rowid, symbol, name, exchange, sector, industry
                    )
                    VALUES (
                        new.rowid, new.symbol, new.name,
                        new.exchange, new.sector, new.industry
                    );
                END
            """)

            # Metadaten-Tabelle
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS db_meta (
                    key TEXT PRIMARY KEY,
                    value TEXT
                )
            """)

            conn.commit()

            # Prüfe ob DB leer ist → Initial-Download
            cursor.execute("SELECT COUNT(*) FROM symbols")
            count = cursor.fetchone()[0]

            if count == 0:
                _LOGGER.info("Empty database, loading initial symbols...")
                self._load_initial_symbols(conn)

        finally:
            conn.close()

    def _get_connection(self) -> sqlite3.Connection:
        """Get SQLite connection."""
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        return conn

    # =========================================================================
    # INITIAL SYMBOL LOADING
    # =========================================================================

    def _load_initial_symbols(self, conn: sqlite3.Connection) -> None:
        """Load initial symbols into database."""
        cursor = conn.cursor()
        loaded = 0

        # 1. Statische Listen laden (immer verfügbar)
        static_sources = [
            CRYPTO_SYMBOLS,
            GERMAN_SYMBOLS,
            INDEX_SYMBOLS,
            CURRENCY_SYMBOLS,
            ETF_SYMBOLS,
        ]

        for source in static_sources:
            for symbol, name, exchange, currency in source:
                try:
                    cursor.execute(
                        """INSERT OR IGNORE INTO symbols
                        (symbol, name, exchange, currency, last_updated)
                        VALUES (?, ?, ?, ?, ?)""",
                        (symbol, name, exchange, currency,
                         datetime.now().isoformat()),
                    )
                    loaded += 1
                except sqlite3.Error:
                    continue

        # 2. Online-Quellen laden
        for source_key, source_info in SYMBOL_SOURCES.items():
            try:
                symbols = self._download_source(source_info)
                for sym_data in symbols:
                    try:
                        cursor.execute(
                            """INSERT OR IGNORE INTO symbols
                            (symbol, name, exchange, currency, sector,
                             industry, market_cap, last_updated)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                            (
                                sym_data["symbol"],
                                sym_data["name"],
                                sym_data.get("exchange", ""),
                                sym_data.get("currency", "USD"),
                                sym_data.get("sector", ""),
                                sym_data.get("industry", ""),
                                sym_data.get("market_cap", 0),
                                datetime.now().isoformat(),
                            ),
                        )
                        loaded += 1
                    except sqlite3.Error:
                        continue

                _LOGGER.info(
                    "Loaded %s symbols from %s",
                    len(symbols),
                    source_info["name"],
                )

            except Exception as err:
                _LOGGER.warning(
                    "Failed to load %s: %s",
                    source_info["name"],
                    err,
                )

        conn.commit()

        # FTS Index neu aufbauen
        try:
            cursor.execute("INSERT INTO symbols_fts(symbols_fts) VALUES('rebuild')")
            conn.commit()
        except sqlite3.Error:
            pass

        # Metadaten speichern
        cursor.execute(
            "INSERT OR REPLACE INTO db_meta (key, value) VALUES (?, ?)",
            ("last_full_update", datetime.now().isoformat()),
        )
        cursor.execute(
            "INSERT OR REPLACE INTO db_meta (key, value) VALUES (?, ?)",
            ("symbol_count", str(loaded)),
        )
        conn.commit()

        _LOGGER.info("Loaded %d symbols into database", loaded)

    # =========================================================================
    # ONLINE SOURCE DOWNLOAD
    # =========================================================================

    def _download_source(
        self, source_info: dict
    ) -> list[dict[str, Any]]:
        """Download symbols from an online source."""
        url = source_info["url"]
        parser = source_info["parser"]

        response = requests.get(url, headers=HEADERS, timeout=30)
        response.raise_for_status()

        # Parser-Methode aufrufen
        parser_method = getattr(self, parser)
        return parser_method(response)

    def _parse_nasdaq_response(
        self, response: requests.Response
    ) -> list[dict[str, Any]]:
        """Parse NASDAQ API screener response."""
        symbols = []

        try:
            data = response.json()
            rows = (
                data.get("data", {})
                .get("table", {})
                .get("rows", [])
            )

            for row in rows:
                symbol = row.get("symbol", "").strip()
                name = row.get("name", "").strip()

                if not symbol or not name:
                    continue

                # Market Cap bereinigen
                market_cap_str = row.get("marketCap", "0")
                market_cap = self._parse_market_cap(market_cap_str)

                symbols.append({
                    "symbol": symbol,
                    "name": name,
                    "exchange": row.get("exchange", ""),
                    "currency": "USD",
                    "sector": row.get("sector", ""),
                    "industry": row.get("industry", ""),
                    "market_cap": market_cap,
                    "country": row.get("country", "US"),
                })

        except (json.JSONDecodeError, KeyError) as err:
            _LOGGER.error("Error parsing NASDAQ response: %s", err)

        return symbols

    def _parse_nasdaq_ftp(
        self, response: requests.Response
    ) -> list[dict[str, Any]]:
        """Parse NASDAQ FTP symbol list (backup source)."""
        symbols = []

        try:
            reader = csv.reader(
                io.StringIO(response.text), delimiter="|"
            )

            header = next(reader, None)
            if not header:
                return symbols

            for row in reader:
                if len(row) < 4:
                    continue

                symbol = row[1].strip() if len(row) > 1 else ""
                name = row[2].strip() if len(row) > 2 else ""

                if (
                    not symbol
                    or not name
                    or symbol == "Symbol"
                    or len(symbol) > 10
                ):
                    continue

                # Test-Symbole ignorieren
                test_flag = row[6].strip() if len(row) > 6 else "N"
                if test_flag == "Y":
                    continue

                symbols.append({
                    "symbol": symbol,
                    "name": name,
                    "exchange": "NASDAQ",
                    "currency": "USD",
                })

        except Exception as err:
            _LOGGER.error("Error parsing NASDAQ FTP: %s", err)

        return symbols

    # =========================================================================
    # SEARCH
    # =========================================================================

    def search(
        self,
        query: str,
        limit: int = 10,
        asset_type: str | None = None,
    ) -> list[dict[str, Any]]:
        """Search for symbols in local database."""
        if not query or len(query.strip()) < 1:
            return []

        query = query.strip()
        results = []

        conn = self._get_connection()
        try:
            cursor = conn.cursor()

            # 1. Exakte Symbol-Suche
            cursor.execute(
                "SELECT * FROM symbols WHERE symbol = ? AND active = 1",
                (query.upper(),),
            )
            exact = cursor.fetchone()
            if exact:
                results.append(dict(exact))

            # 2. FTS-Suche (Fuzzy)
            fts_query = f'"{query}"*'
            try:
                sql = """
                    SELECT s.*
                    FROM symbols_fts fts
                    JOIN symbols s ON s.rowid = fts.rowid
                    WHERE symbols_fts MATCH ?
                    AND s.active = 1
                """
                params = [fts_query]

                if asset_type:
                    sql += " AND s.asset_type = ?"
                    params.append(asset_type)

                sql += " ORDER BY s.market_cap DESC LIMIT ?"
                params.append(limit * 2)

                cursor.execute(sql, params)

                for row in cursor.fetchall():
                    row_dict = dict(row)
                    # Duplikat vermeiden
                    if not any(
                        r["symbol"] == row_dict["symbol"]
                        for r in results
                    ):
                        results.append(row_dict)

            except sqlite3.OperationalError:
                # FTS nicht verfügbar, LIKE-Fallback
                sql = """
                    SELECT * FROM symbols
                    WHERE (symbol LIKE ? OR name LIKE ?)
                    AND active = 1
                """
                params = [f"%{query}%", f"%{query}%"]

                if asset_type:
                    sql += " AND asset_type = ?"
                    params.append(asset_type)

                sql += " ORDER BY market_cap DESC LIMIT ?"
                params.append(limit * 2)

                cursor.execute(sql, params)

                for row in cursor.fetchall():
                    row_dict = dict(row)
                    if not any(
                        r["symbol"] == row_dict["symbol"]
                        for r in results
                    ):
                        results.append(row_dict)

        finally:
            conn.close()

        return results[:limit]

    # =========================================================================
    # SYMBOL MANAGEMENT
    # =========================================================================

    def add_symbol(
        self,
        symbol: str,
        name: str = "",
        exchange: str = "",
        currency: str = "USD",
        **kwargs,
    ) -> bool:
        """Add or update a symbol in database."""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(
                """INSERT OR REPLACE INTO symbols
                (symbol, name, exchange, currency, sector, industry,
                 asset_type, market_cap, last_updated, active)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)""",
                (
                    symbol.upper(),
                    name or symbol,
                    exchange,
                    currency,
                    kwargs.get("sector", ""),
                    kwargs.get("industry", ""),
                    kwargs.get("asset_type", "EQUITY"),
                    kwargs.get("market_cap", 0),
                    datetime.now().isoformat(),
                ),
            )
            conn.commit()
            return True
        except sqlite3.Error as err:
            _LOGGER.error("Error adding symbol %s: %s", symbol, err)
            return False
        finally:
            conn.close()

    def get_symbol_info(self, symbol: str) -> dict[str, Any] | None:
        """Get info for a specific symbol."""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT * FROM symbols WHERE symbol = ?",
                (symbol.upper(),),
            )
            row = cursor.fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def get_symbol_count(self) -> int:
        """Get total number of symbols in database."""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM symbols WHERE active = 1")
            return cursor.fetchone()[0]
        finally:
            conn.close()

    # =========================================================================
    # DATABASE UPDATE
    # =========================================================================

    def update(self) -> int:
        """Update symbol database from all sources. Returns count updated."""
        _LOGGER.info("Starting symbol database update...")
        total_updated = 0

        conn = self._get_connection()
        try:
            cursor = conn.cursor()

            for source_key, source_info in SYMBOL_SOURCES.items():
                try:
                    symbols = self._download_source(source_info)

                    for sym_data in symbols:
                        try:
                            cursor.execute(
                                """INSERT OR REPLACE INTO symbols
                                (symbol, name, exchange, currency, sector,
                                 industry, market_cap, last_updated, active)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)""",
                                (
                                    sym_data["symbol"],
                                    sym_data["name"],
                                    sym_data.get("exchange", ""),
                                    sym_data.get("currency", "USD"),
                                    sym_data.get("sector", ""),
                                    sym_data.get("industry", ""),
                                    sym_data.get("market_cap", 0),
                                    datetime.now().isoformat(),
                                ),
                            )
                            total_updated += 1
                        except sqlite3.Error:
                            continue

                    _LOGGER.info(
                        "Updated %d symbols from %s",
                        len(symbols),
                        source_info["name"],
                    )

                except Exception as err:
                    _LOGGER.warning(
                        "Failed to update from %s: %s",
                        source_info["name"],
                        err,
                    )

            conn.commit()

            # FTS Index neu aufbauen
            try:
                cursor.execute(
                    "INSERT INTO symbols_fts(symbols_fts) VALUES('rebuild')"
                )
                conn.commit()
            except sqlite3.Error:
                pass

            # Meta aktualisieren
            cursor.execute(
                "INSERT OR REPLACE INTO db_meta (key, value) VALUES (?, ?)",
                ("last_full_update", datetime.now().isoformat()),
            )
            cursor.execute(
                "INSERT OR REPLACE INTO db_meta (key, value) VALUES (?, ?)",
                ("symbol_count", str(self.get_symbol_count())),
            )
            conn.commit()

        finally:
            conn.close()

        _LOGGER.info("Database update complete: %d symbols", total_updated)
        return total_updated

    def needs_update(self) -> bool:
        """Check if database needs an update (older than 24h)."""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT value FROM db_meta WHERE key = 'last_full_update'"
            )
            row = cursor.fetchone()

            if not row:
                return True

            last_update = datetime.fromisoformat(row[0])
            return datetime.now() - last_update > timedelta(hours=24)

        except Exception:
            return True
        finally:
            conn.close()

    # =========================================================================
    # HELPERS
    # =========================================================================

    @staticmethod
    def _parse_market_cap(value: str) -> float:
        """Parse market cap string to float."""
        if not value or value == "N/A":
            return 0

        try:
            value = str(value).replace(",", "").replace("$", "").strip()

            multipliers = {
                "T": 1_000_000_000_000,
                "B": 1_000_000_000,
                "M": 1_000_000,
                "K": 1_000,
            }

            for suffix, mult in multipliers.items():
                if value.upper().endswith(suffix):
                    return float(value[:-1]) * mult

            return float(value)
        except (ValueError, TypeError):
            return 0

    def get_db_stats(self) -> dict[str, Any]:
        """Get database statistics."""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()

            stats = {}

            # Gesamtanzahl
            cursor.execute(
                "SELECT COUNT(*) FROM symbols WHERE active = 1"
            )
            stats["total_symbols"] = cursor.fetchone()[0]

            # Pro Exchange
            cursor.execute("""
                SELECT exchange, COUNT(*) as count
                FROM symbols WHERE active = 1
                GROUP BY exchange
                ORDER BY count DESC
            """)
            stats["by_exchange"] = {
                row[0]: row[1] for row in cursor.fetchall()
            }

            # DB Dateigröße
            stats["db_size_bytes"] = os.path.getsize(self._db_path)
            stats["db_size_mb"] = round(
                stats["db_size_bytes"] / (1024 * 1024), 2
            )

            # Letztes Update
            cursor.execute(
                "SELECT value FROM db_meta WHERE key = 'last_full_update'"
            )
            row = cursor.fetchone()
            stats["last_update"] = row[0] if row else "Never"

            return stats

        finally:
            conn.close()