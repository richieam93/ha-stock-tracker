"""
Stock Tracker Integration for Home Assistant.

Tracks stocks, ETFs, crypto from multiple sources (no API key needed).
Automatically creates sensors, registers custom card, and sets up dashboard.
"""
from __future__ import annotations

import logging
import os
import shutil
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

async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Set up the Stock Tracker component (legacy)."""
    # Nur via Config Flow, kein YAML-Support
    return True


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

    # -------------------------------------------------------------------------
    # CUSTOM CARD AUTOMATISCH REGISTRIEREN
    # -------------------------------------------------------------------------
    await _async_register_custom_card(hass)

    # -------------------------------------------------------------------------
    # DASHBOARD AUTOMATISCH ERSTELLEN (beim ersten Setup)
    # -------------------------------------------------------------------------
    await _async_create_default_dashboard(hass, entry)

    # -------------------------------------------------------------------------
    # Willkommens-Benachrichtigung (nur beim ersten Setup)
    # -------------------------------------------------------------------------
    await _async_show_welcome_notification(hass, entry)

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
# CUSTOM CARD AUTO-REGISTRATION
# =============================================================================

async def _async_register_custom_card(hass: HomeAssistant) -> None:
    """
    Automatically register the custom card as a Lovelace resource.
    
    Follows HACS convention:
    - Copy to /www/community/stock-tracker/
    - Create .gz version
    - Register as /hacsfiles/community/stock-tracker/stock-tracker-card.js
    """
    try:
        # Pfade definieren (HACS-konform)
        www_path = hass.config.path("www")
        community_path = os.path.join(www_path, "community")
        integration_path = os.path.join(community_path, "stock-tracker")
        
        card_source = os.path.join(
            os.path.dirname(__file__),
            "www",
            "stock-tracker-card.js"
        )
        card_dest = os.path.join(integration_path, "stock-tracker-card.js")
        card_dest_gz = f"{card_dest}.gz"

        # Ordner erstellen
        os.makedirs(integration_path, exist_ok=True)

        # Card kopieren (nur wenn Quelle neuer ist oder Ziel nicht existiert)
        if os.path.exists(card_source):
            should_copy = False
            
            if not os.path.exists(card_dest):
                should_copy = True
            else:
                # Prüfen ob Source neuer ist
                source_mtime = os.path.getmtime(card_source)
                dest_mtime = os.path.getmtime(card_dest)
                if source_mtime > dest_mtime:
                    should_copy = True
            
            if should_copy:
                # Original kopieren
                shutil.copy2(card_source, card_dest)
                _LOGGER.info(
                    "Custom card copied to %s",
                    card_dest
                )
                
                # .gz Version erstellen
                await hass.async_add_executor_job(
                    _create_gzip_file,
                    card_dest,
                    card_dest_gz
                )
                _LOGGER.info("Custom card .gz version created")
            else:
                _LOGGER.debug("Custom card already up to date")
        else:
            _LOGGER.warning(
                "Custom card source not found at %s",
                card_source
            )
            return

        # Als static path registrieren (HACS-Pfad)
        # HACS verwendet /hacsfiles/ statt /local/
        hass.http.register_static_path(
            "/hacsfiles/community/stock-tracker",
            integration_path,
            cache_headers=False
        )
        _LOGGER.debug("Custom card registered as /hacsfiles/ path")
        
        # Auch als /local/ registrieren (Fallback)
        hass.http.register_static_path(
            "/local/community/stock-tracker",
            integration_path,
            cache_headers=False
        )
        _LOGGER.debug("Custom card registered as /local/ path")

    except Exception as err:
        _LOGGER.error(
            "Failed to register custom card automatically: %s",
            err
        )


def _create_gzip_file(source_file: str, dest_file: str) -> None:
    """
    Create a gzipped version of the JS file.
    
    This is what HACS does automatically. We replicate it here
    so the card works the same way as HACS-installed cards.
    """
    import gzip
    
    try:
        with open(source_file, "rb") as f_in:
            with gzip.open(dest_file, "wb", compresslevel=9) as f_out:
                shutil.copyfileobj(f_in, f_out)
        
        # Dateigröße loggen
        original_size = os.path.getsize(source_file)
        compressed_size = os.path.getsize(dest_file)
        compression_ratio = (1 - compressed_size / original_size) * 100
        
        _LOGGER.debug(
            "Card compressed: %d bytes → %d bytes (%.1f%% smaller)",
            original_size,
            compressed_size,
            compression_ratio
        )
    except Exception as err:
        _LOGGER.warning("Could not create .gz file: %s", err)

# =============================================================================
# DASHBOARD AUTO-CREATION
# =============================================================================

async def _async_create_default_dashboard(
    hass: HomeAssistant,
    entry: ConfigEntry,
) -> None:
    """Create a default Stock Tracker dashboard on first setup."""
    # Prüfen ob Dashboard schon erstellt wurde
    dashboard_created_key = "dashboard_created"
    
    if entry.data.get(dashboard_created_key):
        _LOGGER.debug("Dashboard already created, skipping")
        return

    try:
        symbols = entry.data.get(CONF_SYMBOLS, [])
        
        if not symbols:
            _LOGGER.debug("No symbols configured, skipping dashboard creation")
            return

        from .dashboard import DashboardGenerator
        generator = DashboardGenerator(hass)
        
        coordinator = hass.data[DOMAIN][entry.entry_id]["coordinator"]
        dashboard_config = generator.generate_dashboard(
            symbols,
            coordinator_data=coordinator.data,
        )
        
        # Dashboard in Executor speichern (async-safe)
        await hass.async_add_executor_job(
            _save_dashboard_yaml,
            hass,
            dashboard_config,
        )
        
        _LOGGER.info("Dashboard YAML created successfully")
        
        # Merken dass Dashboard erstellt wurde
        new_data = dict(entry.data)
        new_data[dashboard_created_key] = True
        hass.config_entries.async_update_entry(entry, data=new_data)

    except Exception as err:
        _LOGGER.warning(
            "Could not create dashboard automatically: %s",
            err
        )


def _save_dashboard_yaml(
    hass: HomeAssistant,
    dashboard_config: dict,
) -> None:
    """
    Save dashboard YAML file (runs in executor, blocking is OK).
    
    This function runs in a thread pool, so blocking I/O is allowed.
    """
    import yaml
    
    dashboards_dir = hass.config.path("dashboards")
    os.makedirs(dashboards_dir, exist_ok=True)
    
    dashboard_file = os.path.join(dashboards_dir, "stock_tracker_auto.yaml")
    
    # Jetzt ist blocking I/O OK, da wir im Executor laufen
    with open(dashboard_file, "w", encoding="utf-8") as f:
        yaml.dump(
            dashboard_config,
            f,
            default_flow_style=False,
            allow_unicode=True,
            sort_keys=False,
        )
    
    _LOGGER.debug("Dashboard YAML saved to %s", dashboard_file)


def _create_gzip_file(source_file: str, dest_file: str) -> None:
    """
    Create a gzipped version of the JS file.
    
    This is what HACS does automatically. We replicate it here
    so the card works the same way as HACS-installed cards.
    
    This function runs in executor, so blocking I/O is allowed.
    """
    import gzip
    
    try:
        with open(source_file, "rb") as f_in:
            with gzip.open(dest_file, "wb", compresslevel=9) as f_out:
                shutil.copyfileobj(f_in, f_out)
        
        # Dateigröße loggen
        original_size = os.path.getsize(source_file)
        compressed_size = os.path.getsize(dest_file)
        compression_ratio = (1 - compressed_size / original_size) * 100
        
        _LOGGER.debug(
            "Card compressed: %d bytes → %d bytes (%.1f%% smaller)",
            original_size,
            compressed_size,
            compression_ratio
        )
    except Exception as err:
        _LOGGER.warning("Could not create .gz file: %s", err)

# =============================================================================
# WELCOME NOTIFICATION
# =============================================================================

async def _async_show_welcome_notification(
    hass: HomeAssistant,
    entry: ConfigEntry,
) -> None:
    """Show a welcome notification on first setup."""
    # Nur beim ersten Setup zeigen
    welcome_shown_key = "welcome_shown"
    
    if entry.data.get(welcome_shown_key):
        return

    try:
        symbols = entry.data.get(CONF_SYMBOLS, [])
        symbol_count = len(symbols)
        
        # Erstes Symbol für Beispiel
        first_symbol = symbols[0] if symbols else "AAPL"
        first_symbol_entity = first_symbol.lower().replace(".", "_").replace("-", "_")

        # Erstelle Benachrichtigung
        title = "🎉 Stock Tracker eingerichtet!"
        
        # Normale String-Formatierung ohne f-string wegen YAML-Code
        symbols_list = ", ".join(symbols)
        sensor_count = symbol_count * 5
        
        message = f"""**Willkommen bei Stock Tracker!**

✅ **{symbol_count} Symbol{"e" if symbol_count != 1 else ""} werden überwacht:**
{symbols_list}

📊 **Was wurde erstellt:**
- {sensor_count} Sensoren (5 pro Aktie)
- Custom Card für Lovelace
- Dashboard "Stock Tracker"

🚀 **Nächste Schritte:**

1. **Dashboard öffnen:** 
   Die Datei wurde gespeichert unter:
   /config/dashboards/stock_tracker_auto.yaml

2. **Custom Card nutzen:**
   Füge dies zu deinem Dashboard hinzu:
   
   type: custom:stock-tracker-card
   entity: sensor.{first_symbol_entity}_price
   display_mode: full

3. **Weitere Aktien hinzufügen:**
   Einstellungen → Geräte & Dienste → Stock Tracker → Optionen

⚠️ **Hinweis - Custom Card Ressource:**
Falls die Card nicht automatisch funktioniert, registriere sie manuell:

Einstellungen → Dashboards → Ressourcen → Ressource hinzufügen
URL: `/hacsfiles/community/stock-tracker/stock-tracker-card.js`
Typ: JavaScript-Modul

💡 **Tipp:** 
Nutze den Service `stock_tracker.search` um neue Aktien zu finden!
"""

        await hass.services.async_call(
            "persistent_notification",
            "create",
            {
                "title": title,
                "message": message,
                "notification_id": f"{DOMAIN}_welcome",
            },
        )

        # Merken dass Benachrichtigung gezeigt wurde
        new_data = dict(entry.data)
        new_data[welcome_shown_key] = True
        hass.config_entries.async_update_entry(entry, data=new_data)

        _LOGGER.info("Welcome notification shown")

    except Exception as err:
        _LOGGER.debug("Could not show welcome notification: %s", err)


# =============================================================================
# SERVICES
# =============================================================================

async def _async_register_services(hass: HomeAssistant) -> None:
    """Register Stock Tracker services."""

    # Service: stock_tracker.add_stock
    async def async_handle_add_stock(call: ServiceCall) -> None:
        """Add a stock symbol to tracking."""
        symbol = call.data["symbol"].upper().strip()

        _LOGGER.info("Service call: Adding stock %s", symbol)

        entry = _get_config_entry(hass)
        if not entry:
            raise HomeAssistantError("Stock Tracker is not configured")

        current_symbols = list(entry.data.get(CONF_SYMBOLS, []))
        if len(current_symbols) >= MAX_SYMBOLS:
            raise HomeAssistantError(
                f"Maximum of {MAX_SYMBOLS} symbols reached"
            )

        if symbol in current_symbols:
            _LOGGER.warning("Symbol %s is already being tracked", symbol)
            return

        from .coordinator import StockDataCoordinator

        is_valid = await hass.async_add_executor_job(
            StockDataCoordinator.validate_symbol, symbol
        )
        if not is_valid:
            raise HomeAssistantError(
                f"Symbol '{symbol}' not found on any data source"
            )

        updated_symbols = current_symbols + [symbol]
        new_data = dict(entry.data)
        new_data[CONF_SYMBOLS] = updated_symbols

        hass.config_entries.async_update_entry(entry, data=new_data)
        
        await hass.services.async_call(
            "persistent_notification",
            "create",
            {
                "title": f"✅ {symbol} hinzugefügt",
                "message": f"Die Aktie **{symbol}** wird jetzt überwacht.\n\n5 neue Sensoren wurden erstellt.",
                "notification_id": f"{DOMAIN}_added_{symbol.lower()}",
            },
        )
        
        _LOGGER.info(
            "Successfully added %s. Total symbols: %d",
            symbol,
            len(updated_symbols)
        )

    hass.services.async_register(
        DOMAIN,
        SERVICE_ADD_STOCK,
        async_handle_add_stock,
        schema=vol.Schema({
            vol.Required("symbol"): cv.string,
        }),
    )

    # Service: stock_tracker.remove_stock
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
        
        _LOGGER.info(
            "Successfully removed %s. Remaining: %d",
            symbol,
            len(updated_symbols)
        )

    hass.services.async_register(
        DOMAIN,
        SERVICE_REMOVE_STOCK,
        async_handle_remove_stock,
        schema=vol.Schema({
            vol.Required("symbol"): cv.string,
        }),
    )

    # Service: stock_tracker.search
    async def async_handle_search(call: ServiceCall) -> dict:
        """Search for stock symbols."""
        query = call.data["query"].strip()
        limit = call.data.get("limit", 10)

        _LOGGER.info("Service call: Searching for '%s'", query)

        from .coordinator import StockDataCoordinator

        results = await hass.async_add_executor_job(
            StockDataCoordinator.search_symbols, query, limit
        )

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

    # Service: stock_tracker.refresh
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

    # Service: stock_tracker.update_database
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