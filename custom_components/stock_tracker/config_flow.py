"""Config flow for Stock Tracker integration."""
from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.data_entry_flow import FlowResult

from .const import (
    DOMAIN,
    CONF_SYMBOLS,
    CONF_SCAN_INTERVAL,
    CONF_DATA_SOURCE,
    CONF_SHOW_INDICATORS,
    DEFAULT_SCAN_INTERVAL,
    DEFAULT_DATA_SOURCE,
    AVAILABLE_SOURCES,
    MIN_SCAN_INTERVAL,
    MAX_SCAN_INTERVAL,
    MAX_SYMBOLS,
)

_LOGGER = logging.getLogger(__name__)


# =============================================================================
# SYMBOL VALIDATION (Blocking - wird im Executor aufgerufen)
# =============================================================================

def _validate_symbols(symbols: list[str]) -> tuple[list[str], list[str]]:
    """
    Validate stock symbols via Yahoo Finance.
    Returns (valid_symbols, invalid_symbols).
    """
    import yfinance as yf

    valid = []
    invalid = []

    for symbol in symbols:
        symbol = symbol.upper().strip()
        if not symbol:
            continue

        try:
            ticker = yf.Ticker(symbol)
            info = ticker.info

            # Prüfe ob gültige Daten vorhanden
            has_price = info.get("regularMarketPrice") is not None
            has_prev_close = info.get("previousClose") is not None
            has_name = info.get("shortName") is not None

            if has_price or has_prev_close or has_name:
                valid.append(symbol)
                _LOGGER.debug("Symbol %s is valid: %s", symbol, info.get("shortName"))
            else:
                invalid.append(symbol)
                _LOGGER.debug("Symbol %s has no data", symbol)

        except Exception as err:
            _LOGGER.debug("Symbol %s validation error: %s", symbol, err)
            invalid.append(symbol)

    return valid, invalid


def _search_yahoo(query: str, limit: int = 10) -> list[dict[str, Any]]:
    """
    Search for stock symbols via Yahoo Finance.
    Returns list of matching symbols.
    """
    import yfinance as yf

    results = []
    query = query.strip()

    if not query:
        return results

    try:
        # Methode 1: Direkte Suche via yfinance
        ticker = yf.Ticker(query.upper())
        info = ticker.info

        if info and info.get("shortName"):
            results.append({
                "symbol": query.upper(),
                "name": info.get("shortName", query.upper()),
                "long_name": info.get("longName", ""),
                "exchange": info.get("exchange", "N/A"),
                "currency": info.get("currency", "USD"),
                "sector": info.get("sector", ""),
                "industry": info.get("industry", ""),
                "price": info.get("regularMarketPrice"),
                "change_percent": info.get("regularMarketChangePercent"),
                "market_cap": info.get("marketCap"),
            })
    except Exception as err:
        _LOGGER.debug("Direct search for %s failed: %s", query, err)

    try:
        # Methode 2: Yahoo Finance Screener / Search
        import requests

        url = "https://query2.finance.yahoo.com/v1/finance/search"
        params = {
            "q": query,
            "quotesCount": limit,
            "newsCount": 0,
            "listsCount": 0,
            "enableFuzzyQuery": True,
            "quotesQueryId": "tss_match_phrase_query",
        }
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                          "AppleWebKit/537.36 (KHTML, like Gecko) "
                          "Chrome/120.0.0.0 Safari/537.36"
        }

        response = requests.get(url, params=params, headers=headers, timeout=10)

        if response.status_code == 200:
            data = response.json()
            quotes = data.get("quotes", [])

            # Existierende Symbole aus results sammeln
            existing_symbols = {r["symbol"] for r in results}

            for quote in quotes:
                symbol = quote.get("symbol", "")
                if symbol and symbol not in existing_symbols:
                    results.append({
                        "symbol": symbol,
                        "name": quote.get("shortname", quote.get("longname", symbol)),
                        "long_name": quote.get("longname", ""),
                        "exchange": quote.get("exchange", "N/A"),
                        "currency": quote.get("currency", "USD"),
                        "sector": quote.get("sector", ""),
                        "industry": quote.get("industry", ""),
                        "type": quote.get("quoteType", "EQUITY"),
                        "price": None,
                        "change_percent": None,
                        "market_cap": None,
                    })

    except Exception as err:
        _LOGGER.debug("Yahoo search API error: %s", err)

    return results[:limit]


# =============================================================================
# CONFIG FLOW (Ersteinrichtung)
# =============================================================================

class StockTrackerConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle the config flow for Stock Tracker."""

    VERSION = 1

    def __init__(self) -> None:
        """Initialize the config flow."""
        self._symbols: list[str] = []
        self._search_results: list[dict] = []
        self._errors: dict[str, str] = {}

    # -------------------------------------------------------------------------
    # Step 1: Symbol eingeben / suchen
    # -------------------------------------------------------------------------
    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Handle the initial step - search and add symbols."""
        errors: dict[str, str] = {}

        if user_input is not None:
            search_query = user_input.get("search_query", "").strip()
            direct_symbols = user_input.get("direct_symbols", "").strip()

            # Option A: Direkte Symbol-Eingabe (z.B. "AAPL, MSFT, TSLA")
            if direct_symbols:
                symbols = [
                    s.strip().upper()
                    for s in direct_symbols.split(",")
                    if s.strip()
                ]

                if not symbols:
                    errors["base"] = "no_symbols"
                elif len(symbols) > MAX_SYMBOLS:
                    errors["base"] = "too_many_symbols"
                else:
                    # Symbole validieren
                    valid, invalid = await self.hass.async_add_executor_job(
                        _validate_symbols, symbols
                    )

                    if invalid:
                        errors["base"] = "invalid_symbols"
                        self._errors["invalid_list"] = ", ".join(invalid)
                    elif valid:
                        self._symbols = valid
                        return await self.async_step_settings()

            # Option B: Suche nach Name (z.B. "Apple")
            elif search_query:
                self._search_results = await self.hass.async_add_executor_job(
                    _search_yahoo, search_query, 10
                )

                if self._search_results:
                    return await self.async_step_select_symbol()
                else:
                    errors["base"] = "no_results"

            else:
                errors["base"] = "no_input"

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({
                vol.Optional(
                    "search_query",
                    description={"suggested_value": ""},
                ): str,
                vol.Optional(
                    "direct_symbols",
                    description={"suggested_value": ""},
                ): str,
            }),
            errors=errors,
            description_placeholders={
                "invalid_symbols": self._errors.get("invalid_list", ""),
            },
        )

    # -------------------------------------------------------------------------
    # Step 2: Symbol aus Suchergebnissen auswählen
    # -------------------------------------------------------------------------
    async def async_step_select_symbol(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Select symbols from search results."""
        errors: dict[str, str] = {}

        if user_input is not None:
            selected = user_input.get("selected_symbols", [])

            if not selected:
                errors["base"] = "no_selection"
            else:
                # selected kann ein String oder Liste sein
                if isinstance(selected, str):
                    selected = [selected]

                self._symbols = selected
                return await self.async_step_settings()

        # Suchergebnisse als Auswahloptionen formatieren
        options = {}
        for result in self._search_results:
            symbol = result["symbol"]
            name = result.get("name", symbol)
            exchange = result.get("exchange", "")
            price = result.get("price")

            label = f"{symbol} - {name}"
            if exchange:
                label += f" ({exchange})"
            if price:
                label += f" | {result.get('currency', '$')}{price}"

            options[symbol] = label

        if not options:
            return await self.async_step_user()

        return self.async_show_form(
            step_id="select_symbol",
            data_schema=vol.Schema({
                vol.Required("selected_symbols"): vol.In(options),
            }),
            errors=errors,
        )

    # -------------------------------------------------------------------------
    # Step 3: Einstellungen
    # -------------------------------------------------------------------------
    async def async_step_settings(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Configure settings."""
        if user_input is not None:
            # Prüfe ob schon eine Instanz existiert
            await self.async_set_unique_id(DOMAIN)
            self._abort_if_unique_id_configured()

            # Config Entry erstellen
            return self.async_create_entry(
                title=f"Stock Tracker ({len(self._symbols)} Symbole)",
                data={
                    CONF_SYMBOLS: self._symbols,
                    CONF_SCAN_INTERVAL: user_input.get(
                        CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL
                    ),
                    CONF_DATA_SOURCE: user_input.get(
                        CONF_DATA_SOURCE, DEFAULT_DATA_SOURCE
                    ),
                    CONF_SHOW_INDICATORS: user_input.get(
                        CONF_SHOW_INDICATORS, True
                    ),
                },
            )

        symbols_preview = ", ".join(self._symbols)

        return self.async_show_form(
            step_id="settings",
            data_schema=vol.Schema({
                vol.Optional(
                    CONF_SCAN_INTERVAL,
                    default=DEFAULT_SCAN_INTERVAL,
                ): vol.All(
                    vol.Coerce(int),
                    vol.Range(min=MIN_SCAN_INTERVAL, max=MAX_SCAN_INTERVAL),
                ),
                vol.Optional(
                    CONF_DATA_SOURCE,
                    default=DEFAULT_DATA_SOURCE,
                ): vol.In(AVAILABLE_SOURCES),
                vol.Optional(
                    CONF_SHOW_INDICATORS,
                    default=True,
                ): bool,
            }),
            description_placeholders={
                "selected_symbols": symbols_preview,
                "symbol_count": str(len(self._symbols)),
            },
        )

    # -------------------------------------------------------------------------
    # Options Flow verknüpfen
    # -------------------------------------------------------------------------
    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: config_entries.ConfigEntry,
    ) -> StockTrackerOptionsFlow:
        """Get the options flow handler."""
        return StockTrackerOptionsFlow(config_entry)


# =============================================================================
# OPTIONS FLOW (Nach Einrichtung: Symbole verwalten)
# =============================================================================

class StockTrackerOptionsFlow(config_entries.OptionsFlow):
    """Handle options flow for Stock Tracker."""

    def __init__(self, config_entry: config_entries.ConfigEntry) -> None:
        """Initialize options flow."""
        self.config_entry = config_entry
        self._search_results: list[dict] = []

    # -------------------------------------------------------------------------
    # Haupt-Menü
    # -------------------------------------------------------------------------
    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Show the main options menu."""
        current_symbols = self.config_entry.data.get(CONF_SYMBOLS, [])
        symbol_count = len(current_symbols)

        if user_input is not None:
            action = user_input.get("action")

            if action == "add":
                return await self.async_step_add_symbol()
            elif action == "remove":
                return await self.async_step_remove_symbol()
            elif action == "settings":
                return await self.async_step_change_settings()
            elif action == "view":
                # Zeige aktuelle Symbole als Notification
                symbol_list = "\n".join(
                    f"• **{s}**" for s in current_symbols
                )
                await self.hass.services.async_call(
                    "persistent_notification",
                    "create",
                    {
                        "title": f"📊 Überwachte Aktien ({symbol_count})",
                        "message": symbol_list,
                        "notification_id": f"{DOMAIN}_symbol_list",
                    },
                )
                return self.async_abort(reason="symbols_displayed")

        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema({
                vol.Required("action", default="add"): vol.In({
                    "add": f"➕ Aktie hinzufügen (aktuell: {symbol_count})",
                    "remove": "➖ Aktie entfernen",
                    "settings": "⚙️ Einstellungen ändern",
                    "view": f"👁️ Aktuelle Symbole anzeigen ({symbol_count})",
                }),
            }),
            description_placeholders={
                "current_symbols": ", ".join(current_symbols),
                "symbol_count": str(symbol_count),
            },
        )

    # -------------------------------------------------------------------------
    # Symbol hinzufügen (mit Suche)
    # -------------------------------------------------------------------------
    async def async_step_add_symbol(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Add a new stock symbol."""
        errors: dict[str, str] = {}
        current_symbols = list(self.config_entry.data.get(CONF_SYMBOLS, []))

        if user_input is not None:
            search_query = user_input.get("search_query", "").strip()
            direct_symbol = user_input.get("direct_symbol", "").strip()

            if direct_symbol:
                # Direkte Eingabe
                new_symbols = [
                    s.strip().upper()
                    for s in direct_symbol.split(",")
                    if s.strip()
                ]

                # Duplikate entfernen
                new_symbols = [s for s in new_symbols if s not in current_symbols]

                if not new_symbols:
                    errors["base"] = "already_tracked"
                elif len(current_symbols) + len(new_symbols) > MAX_SYMBOLS:
                    errors["base"] = "too_many_symbols"
                else:
                    valid, invalid = await self.hass.async_add_executor_job(
                        _validate_symbols, new_symbols
                    )

                    if invalid:
                        errors["base"] = "invalid_symbols"
                    elif valid:
                        updated = current_symbols + valid
                        return self._save_symbols(updated)

            elif search_query:
                # Suche
                self._search_results = await self.hass.async_add_executor_job(
                    _search_yahoo, search_query, 10
                )

                # Bereits überwachte Symbole ausfiltern
                self._search_results = [
                    r for r in self._search_results
                    if r["symbol"] not in current_symbols
                ]

                if self._search_results:
                    return await self.async_step_select_from_search()
                else:
                    errors["base"] = "no_results"
            else:
                errors["base"] = "no_input"

        return self.async_show_form(
            step_id="add_symbol",
            data_schema=vol.Schema({
                vol.Optional("search_query"): str,
                vol.Optional("direct_symbol"): str,
            }),
            errors=errors,
            description_placeholders={
                "current_count": str(len(current_symbols)),
                "max_count": str(MAX_SYMBOLS),
            },
        )

    # -------------------------------------------------------------------------
    # Aus Suchergebnissen auswählen
    # -------------------------------------------------------------------------
    async def async_step_select_from_search(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Select from search results."""
        if user_input is not None:
            selected = user_input.get("selected_symbol")

            if selected:
                if isinstance(selected, str):
                    selected = [selected]

                current_symbols = list(
                    self.config_entry.data.get(CONF_SYMBOLS, [])
                )
                updated = current_symbols + selected
                return self._save_symbols(updated)

        # Optionen bauen
        options = {}
        for result in self._search_results:
            symbol = result["symbol"]
            name = result.get("name", symbol)
            exchange = result.get("exchange", "")

            label = f"{symbol} - {name}"
            if exchange:
                label += f" ({exchange})"

            options[symbol] = label

        return self.async_show_form(
            step_id="select_from_search",
            data_schema=vol.Schema({
                vol.Required("selected_symbol"): vol.In(options),
            }),
        )

    # -------------------------------------------------------------------------
    # Symbol entfernen
    # -------------------------------------------------------------------------
    async def async_step_remove_symbol(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Remove a stock symbol."""
        current_symbols = list(self.config_entry.data.get(CONF_SYMBOLS, []))

        if not current_symbols:
            return self.async_abort(reason="no_symbols")

        if user_input is not None:
            to_remove = user_input.get("remove_symbol")

            if to_remove:
                if isinstance(to_remove, str):
                    to_remove = [to_remove]

                updated = [s for s in current_symbols if s not in to_remove]

                if not updated:
                    return self.async_abort(reason="cannot_remove_all")

                return self._save_symbols(updated)

        # Auswahloptionen
        options = {s: s for s in current_symbols}

        return self.async_show_form(
            step_id="remove_symbol",
            data_schema=vol.Schema({
                vol.Required("remove_symbol"): vol.In(options),
            }),
        )

    # -------------------------------------------------------------------------
    # Einstellungen ändern
    # -------------------------------------------------------------------------
    async def async_step_change_settings(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Change integration settings."""
        if user_input is not None:
            new_data = dict(self.config_entry.data)
            new_data[CONF_SCAN_INTERVAL] = user_input[CONF_SCAN_INTERVAL]
            new_data[CONF_DATA_SOURCE] = user_input[CONF_DATA_SOURCE]
            new_data[CONF_SHOW_INDICATORS] = user_input[CONF_SHOW_INDICATORS]

            self.hass.config_entries.async_update_entry(
                self.config_entry, data=new_data
            )
            return self.async_create_entry(title="", data={})

        current_interval = self.config_entry.data.get(
            CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL
        )
        current_source = self.config_entry.data.get(
            CONF_DATA_SOURCE, DEFAULT_DATA_SOURCE
        )
        current_indicators = self.config_entry.data.get(
            CONF_SHOW_INDICATORS, True
        )

        return self.async_show_form(
            step_id="change_settings",
            data_schema=vol.Schema({
                vol.Required(
                    CONF_SCAN_INTERVAL,
                    default=current_interval,
                ): vol.All(
                    vol.Coerce(int),
                    vol.Range(min=MIN_SCAN_INTERVAL, max=MAX_SCAN_INTERVAL),
                ),
                vol.Required(
                    CONF_DATA_SOURCE,
                    default=current_source,
                ): vol.In(AVAILABLE_SOURCES),
                vol.Required(
                    CONF_SHOW_INDICATORS,
                    default=current_indicators,
                ): bool,
            }),
        )

    # -------------------------------------------------------------------------
    # Helper: Symbole speichern und Config updaten
    # -------------------------------------------------------------------------
    def _save_symbols(self, symbols: list[str]) -> FlowResult:
        """Save updated symbols to config entry."""
        new_data = dict(self.config_entry.data)
        new_data[CONF_SYMBOLS] = symbols

        self.hass.config_entries.async_update_entry(
            self.config_entry, data=new_data
        )

        _LOGGER.info(
            "Symbols updated: %s (total: %d)",
            ", ".join(symbols),
            len(symbols),
        )

        return self.async_create_entry(title="", data={})