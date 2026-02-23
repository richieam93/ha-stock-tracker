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
from homeassistant.const import Platform, EVENT_HOMEASSISTANT_STARTED
from homeassistant.core import HomeAssistant, ServiceCall, callback, Event
from homeassistant.exceptions import ConfigEntryNotReady, HomeAssistantError
from homeassistant.helpers import config_validation as cv

from .const import (
    DOMAIN,
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

CARD_URL = "/local/community/stock-tracker/stock-tracker-card.js"


# =============================================================================
# SETUP
# =============================================================================

async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Set up the Stock Tracker component."""
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Stock Tracker from a config entry."""
    hass.data.setdefault(DOMAIN, {})

    _LOGGER.info(
        "Setting up Stock Tracker with symbols: %s",
        entry.data.get(CONF_SYMBOLS, []),
    )

    # Coordinator erstellen
    from .coordinator import StockDataCoordinator

    symbols = entry.data.get(CONF_SYMBOLS, [])
    scan_interval = entry.data.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL)

    coordinator = StockDataCoordinator(
        hass=hass,
        symbols=symbols,
        update_interval=scan_interval,
    )

    try:
        await coordinator.async_config_entry_first_refresh()
    except Exception as err:
        _LOGGER.error("Failed to fetch initial data: %s", err)
        raise ConfigEntryNotReady(
            f"Could not connect to data source: {err}"
        ) from err

    hass.data[DOMAIN][entry.entry_id] = {
        "coordinator": coordinator,
        "symbols": list(symbols),
    }

    # Sensor Platform laden
    await hass.config_entries.async_forward_entry_setups(
        entry, [Platform.SENSOR]
    )

    # Update Listener
    entry.async_on_unload(
        entry.add_update_listener(_async_update_listener)
    )

    # Services registrieren (nur einmal)
    if not hass.services.has_service(DOMAIN, SERVICE_ADD_STOCK):
        await _async_register_services(hass)

    # Custom Card kopieren (in Executor)
    await hass.async_add_executor_job(_copy_custom_card, hass)

    # Auto-Register + Dashboard NACH dem Start
    async def _setup_frontend(event: Event) -> None:
        """Register card and dashboard after HA is fully started."""
        await _async_register_lovelace_resource(hass)
        await _async_create_dashboard(hass, entry)
        await _async_show_welcome_notification(hass, entry)

    # Prüfe ob HA schon gestartet ist
    if hass.is_running:
        await _async_register_lovelace_resource(hass)
        await _async_create_dashboard(hass, entry)
        await _async_show_welcome_notification(hass, entry)
    else:
        hass.bus.async_listen_once(
            EVENT_HOMEASSISTANT_STARTED,
            _setup_frontend,
        )

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
    """Handle config entry updates."""
    _LOGGER.info("Config updated, reloading Stock Tracker")
    await hass.config_entries.async_reload(entry.entry_id)


# =============================================================================
# CUSTOM CARD: KOPIEREN (Executor - Blocking OK)
# =============================================================================

def _copy_custom_card(hass: HomeAssistant) -> bool:
    """Copy custom card files to www/community/ directory (runs in executor)."""
    import gzip

    card_source = os.path.join(
        os.path.dirname(__file__),
        "www",
        "stock-tracker-card.js",
    )

    www_path = hass.config.path("www")
    target_dir = os.path.join(www_path, "community", "stock-tracker")
    card_dest = os.path.join(target_dir, "stock-tracker-card.js")
    card_dest_gz = os.path.join(target_dir, "stock-tracker-card.js.gz")

    if not os.path.exists(card_source):
        _LOGGER.warning("Card source not found: %s", card_source)
        return False

    os.makedirs(target_dir, exist_ok=True)

    # Prüfen ob Kopieren nötig
    should_copy = not os.path.exists(card_dest)
    if not should_copy:
        if os.path.getmtime(card_source) > os.path.getmtime(card_dest):
            should_copy = True

    if not should_copy:
        _LOGGER.debug("Card already up to date")
        return True

    # Kopieren
    try:
        shutil.copy2(card_source, card_dest)
        _LOGGER.info("Card copied to %s", card_dest)
    except Exception as err:
        _LOGGER.error("Failed to copy card: %s", err)
        return False

    # .gz erstellen
    try:
        with open(card_dest, "rb") as f_in:
            with gzip.open(card_dest_gz, "wb", compresslevel=9) as f_out:
                shutil.copyfileobj(f_in, f_out)
        _LOGGER.info("Card .gz created")
    except Exception as err:
        _LOGGER.warning("Could not create .gz: %s", err)

    return True


# =============================================================================
# LOVELACE RESOURCE AUTO-REGISTRIEREN
# =============================================================================

async def _async_register_lovelace_resource(hass: HomeAssistant) -> None:
    """Automatically register the custom card as Lovelace resource."""
    try:
        # Prüfe ob Lovelace verfügbar ist
        if "lovelace" not in hass.data:
            _LOGGER.debug("Lovelace not available yet")
            return

        lovelace = hass.data["lovelace"]
        resources = lovelace.get("resources")

        if resources is None:
            _LOGGER.debug("Lovelace resources not available")
            return

        # Prüfe ob schon registriert
        existing_urls = [
            r.get("url", "") for r in resources.async_items()
        ]

        if CARD_URL in existing_urls:
            _LOGGER.debug("Card resource already registered")
            return

        # Auch alternative URLs prüfen
        alt_urls = [
            "/hacsfiles/community/stock-tracker/stock-tracker-card.js",
            "/local/stock-tracker-card.js",
        ]
        for alt_url in alt_urls:
            if alt_url in existing_urls:
                _LOGGER.debug("Card already registered under %s", alt_url)
                return

        # Resource registrieren
        await resources.async_create_item({
            "res_type": "module",
            "url": CARD_URL,
        })

        _LOGGER.info(
            "✅ Custom card auto-registered as Lovelace resource: %s",
            CARD_URL,
        )

    except Exception as err:
        _LOGGER.warning(
            "Could not auto-register Lovelace resource: %s", err
        )


# =============================================================================
# DASHBOARD AUTO-ERSTELLEN (mit Sidebar-Link)
# =============================================================================

async def _async_create_dashboard(
    hass: HomeAssistant,
    entry: ConfigEntry,
) -> None:
    """Create Stock Tracker dashboard in sidebar."""
    dashboard_key = "dashboard_created"

    if entry.data.get(dashboard_key):
        return

    try:
        if "lovelace" not in hass.data:
            _LOGGER.debug("Lovelace not available for dashboard creation")
            return

        lovelace = hass.data["lovelace"]
        dashboards = lovelace.get("dashboards")

        if dashboards is None:
            _LOGGER.debug("Lovelace dashboards not available")
            return

        # Prüfe ob Dashboard schon existiert
        existing_paths = [
            d.get("url_path", "") for d in dashboards.async_items()
        ]

        if "stock-tracker" in existing_paths:
            _LOGGER.debug("Dashboard already exists")
            # Trotzdem als erstellt markieren
            new_data = dict(entry.data)
            new_data[dashboard_key] = True
            hass.config_entries.async_update_entry(entry, data=new_data)
            return

        # Dashboard in Sidebar erstellen
        await dashboards.async_create_item({
            "url_path": "stock-tracker",
            "mode": "storage",
            "title": "📊 Aktien",
            "icon": "mdi:chart-line",
            "show_in_sidebar": True,
            "require_admin": False,
        })

        _LOGGER.info("✅ Dashboard 'Stock Tracker' created in sidebar")

        # Dashboard mit Cards befüllen
        await _async_populate_dashboard(hass, entry)

        # Als erstellt markieren
        new_data = dict(entry.data)
        new_data[dashboard_key] = True
        hass.config_entries.async_update_entry(entry, data=new_data)

    except Exception as err:
        _LOGGER.warning("Could not create dashboard: %s", err)


async def _async_populate_dashboard(
    hass: HomeAssistant,
    entry: ConfigEntry,
) -> None:
    """Populate the dashboard with stock cards."""
    try:
        symbols = entry.data.get(CONF_SYMBOLS, [])

        if not symbols:
            return

        # Dashboard Config bauen
        cards = []

        # Header
        cards.append({
            "type": "markdown",
            "content": "# 📊 Stock Tracker\n"
                       "Aktualisierung: "
                       "{{ now().strftime('%H:%M:%S') }}",
        })

        # Stock Cards
        stock_cards = []
        for symbol in symbols:
            sensor_name = _symbol_to_entity(symbol)
            stock_cards.append({
                "type": "custom:stock-tracker-card",
                "entity": f"sensor.{sensor_name}_price",
                "display_mode": "compact",
            })

        if stock_cards:
            cards.append({
                "type": "grid",
                "columns": 2,
                "square": False,
                "cards": stock_cards,
            })

        # Entities Card als Fallback
        entity_list = []
        for symbol in symbols:
            sensor_name = _symbol_to_entity(symbol)
            entity_list.append(f"sensor.{sensor_name}_price")
            entity_list.append(f"sensor.{sensor_name}_change")

        cards.append({
            "type": "entities",
            "title": "📈 Alle Kurse",
            "entities": entity_list,
        })

        # History Graph
        history_entities = []
        for symbol in symbols[:5]:
            sensor_name = _symbol_to_entity(symbol)
            history_entities.append({
                "entity": f"sensor.{sensor_name}_price",
                "name": symbol,
            })

        if history_entities:
            cards.append({
                "type": "history-graph",
                "title": "📉 Kursverlauf",
                "hours_to_show": 24,
                "entities": history_entities,
            })

        # Config speichern
        dashboard_config = {
            "views": [
                {
                    "title": "Übersicht",
                    "path": "default_view",
                    "cards": cards,
                }
            ],
        }

        # Über Lovelace-Storage speichern
        from homeassistant.components.lovelace import dashboard as ll_dashboard

        # Finde das richtige Dashboard-Objekt
        lovelace = hass.data["lovelace"]
        
        # Dashboard Config speichern über WebSocket-kompatible Methode
        config_key = f"lovelace.stock-tracker"
        
        from homeassistant.helpers.storage import Store
        
        store = Store(hass, 1, config_key)
        await store.async_save({"data": dashboard_config})

        _LOGGER.info("Dashboard populated with %d symbols", len(symbols))

    except Exception as err:
        _LOGGER.warning("Could not populate dashboard: %s", err)


# =============================================================================
# WELCOME NOTIFICATION
# =============================================================================

async def _async_show_welcome_notification(
    hass: HomeAssistant,
    entry: ConfigEntry,
) -> None:
    """Show welcome notification on first setup."""
    welcome_key = "welcome_shown"

    if entry.data.get(welcome_key):
        return

    try:
        symbols = entry.data.get(CONF_SYMBOLS, [])
        symbol_count = len(symbols)
        symbols_list = ", ".join(symbols)
        sensor_count = symbol_count * 5
        first_entity = _symbol_to_entity(symbols[0]) if symbols else "aapl"

        title = "🎉 Stock Tracker eingerichtet!"

        message = (
            "**Willkommen bei Stock Tracker!**\n\n"
            f"✅ **{symbol_count} Symbole werden überwacht:**\n"
            f"{symbols_list}\n\n"
            f"📊 **{sensor_count} Sensoren erstellt** (5 pro Aktie)\n\n"
            "🎨 **Custom Card** automatisch registriert\n\n"
            "📋 **Dashboard** in der Seitenleiste unter '📊 Aktien'\n\n"
            "🚀 **Card in beliebigem Dashboard nutzen:**\n"
            "```\n"
            "type: custom:stock-tracker-card\n"
            f"entity: sensor.{first_entity}_price\n"
            "```\n\n"
            "💡 Weitere Aktien: Einstellungen → Geräte & Dienste → "
            "Stock Tracker → Konfigurieren"
        )

        await hass.services.async_call(
            "persistent_notification",
            "create",
            {
                "title": title,
                "message": message,
                "notification_id": f"{DOMAIN}_welcome",
            },
        )

        new_data = dict(entry.data)
        new_data[welcome_key] = True
        hass.config_entries.async_update_entry(entry, data=new_data)

    except Exception as err:
        _LOGGER.debug("Could not show welcome: %s", err)


# =============================================================================
# SERVICES
# =============================================================================

async def _async_register_services(hass: HomeAssistant) -> None:
    """Register Stock Tracker services."""

    async def async_handle_add_stock(call: ServiceCall) -> None:
        """Add a stock symbol."""
        symbol = call.data["symbol"].upper().strip()
        entry = _get_config_entry(hass)
        if not entry:
            raise HomeAssistantError("Stock Tracker is not configured")

        current = list(entry.data.get(CONF_SYMBOLS, []))
        if len(current) >= MAX_SYMBOLS:
            raise HomeAssistantError(f"Maximum {MAX_SYMBOLS} symbols")
        if symbol in current:
            return

        from .coordinator import StockDataCoordinator
        valid = await hass.async_add_executor_job(
            StockDataCoordinator.validate_symbol, symbol
        )
        if not valid:
            raise HomeAssistantError(f"Symbol '{symbol}' not found")

        updated = current + [symbol]
        new_data = dict(entry.data)
        new_data[CONF_SYMBOLS] = updated
        hass.config_entries.async_update_entry(entry, data=new_data)

        await hass.services.async_call(
            "persistent_notification", "create",
            {
                "title": f"✅ {symbol} hinzugefügt",
                "message": f"**{symbol}** wird jetzt überwacht.",
                "notification_id": f"{DOMAIN}_added_{symbol.lower()}",
            },
        )

    hass.services.async_register(
        DOMAIN, SERVICE_ADD_STOCK, async_handle_add_stock,
        schema=vol.Schema({vol.Required("symbol"): cv.string}),
    )

    async def async_handle_remove_stock(call: ServiceCall) -> None:
        """Remove a stock symbol."""
        symbol = call.data["symbol"].upper().strip()
        entry = _get_config_entry(hass)
        if not entry:
            raise HomeAssistantError("Not configured")

        current = list(entry.data.get(CONF_SYMBOLS, []))
        if symbol not in current:
            raise HomeAssistantError(f"'{symbol}' not tracked")
        if len(current) <= 1:
            raise HomeAssistantError("Cannot remove last symbol")

        updated = [s for s in current if s != symbol]
        new_data = dict(entry.data)
        new_data[CONF_SYMBOLS] = updated
        hass.config_entries.async_update_entry(entry, data=new_data)

    hass.services.async_register(
        DOMAIN, SERVICE_REMOVE_STOCK, async_handle_remove_stock,
        schema=vol.Schema({vol.Required("symbol"): cv.string}),
    )

    async def async_handle_search(call: ServiceCall) -> None:
        """Search for symbols."""
        query = call.data["query"].strip()
        limit = call.data.get("limit", 10)

        from .coordinator import StockDataCoordinator
        results = await hass.async_add_executor_job(
            StockDataCoordinator.search_symbols, query, limit
        )

        if results:
            text = "\n".join(
                f"**{r['symbol']}** - {r['name']} ({r.get('exchange', '')})"
                for r in results
            )
        else:
            text = "Keine Ergebnisse."

        await hass.services.async_call(
            "persistent_notification", "create",
            {
                "title": f"🔍 Suche: '{query}'",
                "message": text,
                "notification_id": f"{DOMAIN}_search",
            },
        )

    hass.services.async_register(
        DOMAIN, SERVICE_SEARCH, async_handle_search,
        schema=vol.Schema({
            vol.Required("query"): cv.string,
            vol.Optional("limit", default=10): vol.All(
                vol.Coerce(int), vol.Range(min=1, max=50)
            ),
        }),
    )

    async def async_handle_refresh(call: ServiceCall) -> None:
        """Force refresh."""
        for entry_data in hass.data.get(DOMAIN, {}).values():
            coordinator = entry_data.get("coordinator")
            if coordinator:
                await coordinator.async_request_refresh()

    hass.services.async_register(
        DOMAIN, SERVICE_REFRESH, async_handle_refresh,
        schema=vol.Schema({}),
    )

    async def async_handle_update_db(call: ServiceCall) -> None:
        """Update symbol database."""
        try:
            from .symbol_db import SymbolDatabase
            db = SymbolDatabase(hass)
            count = await hass.async_add_executor_job(db.update)
            await hass.services.async_call(
                "persistent_notification", "create",
                {
                    "title": "📊 DB aktualisiert",
                    "message": f"{count} Symbole.",
                    "notification_id": f"{DOMAIN}_db",
                },
            )
        except Exception as err:
            raise HomeAssistantError(f"DB update failed: {err}") from err

    hass.services.async_register(
        DOMAIN, SERVICE_UPDATE_DB, async_handle_update_db,
        schema=vol.Schema({}),
    )

    _LOGGER.info("Services registered")


# =============================================================================
# HELPERS
# =============================================================================

@callback
def _get_config_entry(hass: HomeAssistant) -> ConfigEntry | None:
    """Get config entry."""
    entries = hass.config_entries.async_entries(DOMAIN)
    return entries[0] if entries else None


def _symbol_to_entity(symbol: str) -> str:
    """Convert symbol to entity name part."""
    return (
        symbol.lower()
        .replace(".", "_")
        .replace("-", "_")
        .replace("^", "")
        .replace("=", "_")
    )