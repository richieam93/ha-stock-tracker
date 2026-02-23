"""
Stock Tracker Integration for Home Assistant.

Tracks stocks, ETFs, crypto from multiple sources (no API key needed).
Automatically creates sensors when user selects symbols.
"""
from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall, callback
from homeassistant.exceptions import ConfigEntryNotReady, HomeAssistantError
from homeassistant.helpers import config_validation as cv

from .const import (
    DOMAIN,
    PLATFORMS,
    CONF_SYMBOLS,
    CONF_SCAN_INTERVAL,
    DEFAULT_SCAN_INTERVAL,
    SERVICE_ADD_STOCK,
    SERVICE_REMOVE_STOCK,
    SERVICE_SEARCH,
    SERVICE_UPDATE_DB,
    SERVICE_REFRESH,
    MAX_SYMBOLS,
)

_LOGGER = logging.getLogger(__name__)


# =============================================================================
# SETUP
# =============================================================================

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Stock Tracker from a config entry."""
    hass.data.setdefault(DOMAIN, {})

    _LOGGER.info(
        "Setting up Stock Tracker with symbols: %s",
        entry.data.get(CONF_SYMBOLS, []),
    )

    # -------------------------------------------------------------------------
    # Coordinator erstellen
    # -------------------------------------------------------------------------
    from .coordinator import StockDataCoordinator

    symbols = entry.data.get(CONF_SYMBOLS, [])
    scan_interval = entry.data.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL)

    coordinator = StockDataCoordinator(
        hass=hass,
        symbols=symbols,
        update_interval=scan_interval,
    )

    # Erste Daten laden
    try:
        await coordinator.async_config_entry_first_refresh()
    except Exception as err:
        _LOGGER.error("Failed to fetch initial data: %s", err)
        raise ConfigEntryNotReady(f"Could not connect to data source: {err}") from err

    # Coordinator speichern
    hass.data[DOMAIN][entry.entry_id] = {
        "coordinator": coordinator,
        "symbols": list(symbols),
    }

    # -------------------------------------------------------------------------
    # Sensor Platform laden
    # -------------------------------------------------------------------------
    await hass.config_entries.async_forward_entry_setups(
        entry, [Platform.SENSOR]
    )

    # -------------------------------------------------------------------------
    # Update Listener (wenn User Symbole ändert)
    # -------------------------------------------------------------------------
    entry.async_on_unload(
        entry.add_update_listener(_async_update_listener)
    )

    # -------------------------------------------------------------------------
    # Services registrieren (nur einmal)
    # -------------------------------------------------------------------------
    if not hass.services.has_service(DOMAIN, SERVICE_ADD_STOCK):
        await _async_register_services(hass)

    _LOGGER.info("Stock Tracker setup complete with %d symbols", len(symbols))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    _LOGGER.info("Unloading Stock Tracker")

    unload_ok = await hass.config_entries.async_unload_platforms(
        entry, [Platform.SENSOR]
    )

    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id, None)

    # Services entfernen wenn keine Einträge mehr
    if not hass.data.get(DOMAIN):
        for service in [
            SERVICE_ADD_STOCK,
            SERVICE_REMOVE_STOCK,
            SERVICE_SEARCH,
            SERVICE_UPDATE_DB,
            SERVICE_REFRESH,
        ]:
            if hass.services.has_service(DOMAIN, service):
                hass.services.async_remove(DOMAIN, service)

    return unload_ok


async def _async_update_listener(
    hass: HomeAssistant, entry: ConfigEntry
) -> None:
    """Handle config entry updates (symbol added/removed)."""
    _LOGGER.info("Config updated, reloading Stock Tracker")
    await hass.config_entries.async_reload(entry.entry_id)


# =============================================================================
# SERVICES
# =============================================================================

async def _async_register_services(hass: HomeAssistant) -> None:
    """Register Stock Tracker services."""

    # -------------------------------------------------------------------------
    # Service: stock_tracker.add_stock
    # -------------------------------------------------------------------------
    async def async_handle_add_stock(call: ServiceCall) -> None:
        """Add a stock symbol to tracking."""
        symbol = call.data["symbol"].upper().strip()

        _LOGGER.info("Service call: Adding stock %s", symbol)

        # Finde den aktiven Config Entry
        entry = _get_config_entry(hass)
        if not entry:
            raise HomeAssistantError("Stock Tracker is not configured")

        # Prüfe Maximum
        current_symbols = list(entry.data.get(CONF_SYMBOLS, []))
        if len(current_symbols) >= MAX_SYMBOLS:
            raise HomeAssistantError(
                f"Maximum of {MAX_SYMBOLS} symbols reached"
            )

        # Prüfe ob bereits vorhanden
        if symbol in current_symbols:
            _LOGGER.warning("Symbol %s is already being tracked", symbol)
            return

        # Symbol validieren
        from .coordinator import StockDataCoordinator

        is_valid = await hass.async_add_executor_job(
            StockDataCoordinator.validate_symbol, symbol
        )
        if not is_valid:
            raise HomeAssistantError(
                f"Symbol '{symbol}' not found on any data source"
            )

        # Symbol hinzufügen
        updated_symbols = current_symbols + [symbol]
        new_data = dict(entry.data)
        new_data[CONF_SYMBOLS] = updated_symbols

        hass.config_entries.async_update_entry(entry, data=new_data)
        _LOGGER.info("Successfully added %s. Total symbols: %d", symbol, len(updated_symbols))

    hass.services.async_register(
        DOMAIN,
        SERVICE_ADD_STOCK,
        async_handle_add_stock,
        schema=vol.Schema({
            vol.Required("symbol"): cv.string,
        }),
    )

    # -------------------------------------------------------------------------
    # Service: stock_tracker.remove_stock
    # -------------------------------------------------------------------------
    async def async_handle_remove_stock(call: ServiceCall) -> None:
        """Remove a stock symbol from tracking."""
        symbol = call.data["symbol"].upper().strip()

        _LOGGER.info("Service call: Removing stock %s", symbol)

        entry = _get_config_entry(hass)
        if not entry:
            raise HomeAssistantError("Stock Tracker is not configured")

        current_symbols = list(entry.data.get(CONF_SYMBOLS, []))

        if symbol not in current_symbols:
            raise HomeAssistantError(f"Symbol '{symbol}' is not being tracked")

        if len(current_symbols) <= 1:
            raise HomeAssistantError("Cannot remove last symbol")

        updated_symbols = [s for s in current_symbols if s != symbol]
        new_data = dict(entry.data)
        new_data[CONF_SYMBOLS] = updated_symbols

        hass.config_entries.async_update_entry(entry, data=new_data)
        _LOGGER.info("Successfully removed %s. Remaining: %d", symbol, len(updated_symbols))

    hass.services.async_register(
        DOMAIN,
        SERVICE_REMOVE_STOCK,
        async_handle_remove_stock,
        schema=vol.Schema({
            vol.Required("symbol"): cv.string,
        }),
    )

    # -------------------------------------------------------------------------
    # Service: stock_tracker.search
    # -------------------------------------------------------------------------
    async def async_handle_search(call: ServiceCall) -> dict:
        """Search for a stock symbol."""
        query = call.data["query"].strip()
        limit = call.data.get("limit", 10)

        _LOGGER.info("Service call: Searching for '%s'", query)

        from .coordinator import StockDataCoordinator

        results = await hass.async_add_executor_job(
            StockDataCoordinator.search_symbols, query, limit
        )

        # Persistent Notification mit Ergebnissen
        if results:
            result_text = "\n".join(
                f"**{r['symbol']}** - {r['name']} ({r.get('exchange', 'N/A')})"
                for r in results
            )
            await hass.services.async_call(
                "persistent_notification",
                "create",
                {
                    "title": f"🔍 Suchergebnisse für '{query}'",
                    "message": result_text,
                    "notification_id": f"{DOMAIN}_search_results",
                },
            )
        else:
            await hass.services.async_call(
                "persistent_notification",
                "create",
                {
                    "title": f"🔍 Suchergebnisse für '{query}'",
                    "message": "Keine Ergebnisse gefunden.",
                    "notification_id": f"{DOMAIN}_search_results",
                },
            )

        return {"results": results}

    hass.services.async_register(
        DOMAIN,
        SERVICE_SEARCH,
        async_handle_search,
        schema=vol.Schema({
            vol.Required("query"): cv.string,
            vol.Optional("limit", default=10): vol.All(
                vol.Coerce(int), vol.Range(min=1, max=50)
            ),
        }),
    )

    # -------------------------------------------------------------------------
    # Service: stock_tracker.refresh
    # -------------------------------------------------------------------------
    async def async_handle_refresh(call: ServiceCall) -> None:
        """Force refresh all stock data."""
        _LOGGER.info("Service call: Force refresh")

        for entry_data in hass.data.get(DOMAIN, {}).values():
            coordinator = entry_data.get("coordinator")
            if coordinator:
                await coordinator.async_request_refresh()

    hass.services.async_register(
        DOMAIN,
        SERVICE_REFRESH,
        async_handle_refresh,
        schema=vol.Schema({}),
    )

    # -------------------------------------------------------------------------
    # Service: stock_tracker.update_database
    # -------------------------------------------------------------------------
    async def async_handle_update_db(call: ServiceCall) -> None:
        """Update the symbol database."""
        _LOGGER.info("Service call: Update symbol database")

        try:
            from .symbol_db import SymbolDatabase

            db = SymbolDatabase(hass)
            count = await hass.async_add_executor_job(db.update)

            await hass.services.async_call(
                "persistent_notification",
                "create",
                {
                    "title": "📊 Symbol-Datenbank aktualisiert",
                    "message": f"Es wurden {count} Symbole aktualisiert.",
                    "notification_id": f"{DOMAIN}_db_update",
                },
            )
        except Exception as err:
            raise HomeAssistantError(f"Database update failed: {err}") from err

    hass.services.async_register(
        DOMAIN,
        SERVICE_UPDATE_DB,
        async_handle_update_db,
        schema=vol.Schema({}),
    )

    _LOGGER.info("Stock Tracker services registered")


# =============================================================================
# HELPERS
# =============================================================================

@callback
def _get_config_entry(hass: HomeAssistant) -> ConfigEntry | None:
    """Get the first (and usually only) config entry for Stock Tracker."""
    entries = hass.config_entries.async_entries(DOMAIN)
    return entries[0] if entries else None