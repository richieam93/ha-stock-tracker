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
from homeassistant.helpers.storage import Store

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
STORAGE_VERSION = 1
STORAGE_KEY = f"{DOMAIN}_internal"


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

    # Update Listener für Symbol-Änderungen
    entry.async_on_unload(
        entry.add_update_listener(_async_update_listener)
    )

    # Services registrieren (nur einmal)
    if not hass.services.has_service(DOMAIN, SERVICE_ADD_STOCK):
        await _async_register_services(hass)

    # Custom Card kopieren (in Executor)
    await hass.async_add_executor_job(_copy_custom_card, hass)

    # Auto-Setup nach dem Start
    async def _setup_frontend(event: Event | None = None) -> None:
        """Register card and dashboard after HA is fully started."""
        await _async_register_lovelace_resource(hass)
        await _async_setup_dashboard(hass, entry)
        await _async_show_welcome_notification(hass, entry)

    # Prüfe ob HA schon gestartet ist
    if hass.is_running:
        await _setup_frontend()
    else:
        hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STARTED, _setup_frontend)

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
    """Handle config entry updates - Rebuild dashboard when symbols change."""
    _LOGGER.info("Config updated, reloading Stock Tracker")
    
    # Dashboard aktualisieren (bevor Reload)
    await _async_update_dashboard(hass, entry)
    
    # Integration neu laden
    await hass.config_entries.async_reload(entry.entry_id)


# =============================================================================
# INTERNAL STORAGE (für Flags ohne Reload-Loop)
# =============================================================================

async def _async_get_internal_data(hass: HomeAssistant) -> dict:
    """Get internal storage data."""
    store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
    data = await store.async_load()
    return data or {}


async def _async_save_internal_data(hass: HomeAssistant, data: dict) -> None:
    """Save internal storage data."""
    store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
    await store.async_save(data)


async def _async_set_flag(hass: HomeAssistant, key: str, value: Any) -> None:
    """Set a flag in internal storage."""
    data = await _async_get_internal_data(hass)
    data[key] = value
    await _async_save_internal_data(hass, data)


async def _async_get_flag(hass: HomeAssistant, key: str, default: Any = None) -> Any:
    """Get a flag from internal storage."""
    data = await _async_get_internal_data(hass)
    return data.get(key, default)


# =============================================================================
# CUSTOM CARD: KOPIEREN
# =============================================================================

def _copy_custom_card(hass: HomeAssistant) -> bool:
    """Copy custom card files to www/community/ directory."""
    import gzip

    # Zielpfad
    www_path = hass.config.path("www")
    target_dir = os.path.join(www_path, "community", "stock-tracker")
    
    # Zielordner erstellen
    os.makedirs(target_dir, exist_ok=True)

    # Liste der zu kopierenden Karten
    card_files = [
        "stock-tracker-card.js",
        "stock-tracker-list-card.js",
    ]

    success = True

    for card_file in card_files:
        # Quellpfad (innerhalb der Integration)
        card_source = os.path.join(
            os.path.dirname(__file__),
            "www",
            card_file,
        )

        card_dest = os.path.join(target_dir, card_file)
        card_dest_gz = os.path.join(target_dir, card_file + ".gz")

        # Prüfe ob Quelle existiert
        if not os.path.exists(card_source):
            _LOGGER.warning(
                "Card source not found: %s",
                card_source
            )
            # Erstelle www-Ordner in der Integration falls nicht vorhanden
            www_integration = os.path.join(os.path.dirname(__file__), "www")
            os.makedirs(www_integration, exist_ok=True)
            continue

        # Prüfen ob Kopieren nötig
        should_copy = not os.path.exists(card_dest)
        if not should_copy:
            try:
                if os.path.getmtime(card_source) > os.path.getmtime(card_dest):
                    should_copy = True
            except OSError:
                should_copy = True

        if not should_copy:
            _LOGGER.debug("Card %s already up to date", card_file)
            continue

        # Kopieren
        try:
            shutil.copy2(card_source, card_dest)
            _LOGGER.info("Card copied to %s", card_dest)
        except Exception as err:
            _LOGGER.error("Failed to copy card %s: %s", card_file, err)
            success = False
            continue

        # .gz erstellen für schnelleres Laden
        try:
            with open(card_dest, "rb") as f_in:
                with gzip.open(card_dest_gz, "wb", compresslevel=9) as f_out:
                    shutil.copyfileobj(f_in, f_out)
            _LOGGER.debug("Card %s.gz created", card_file)
        except Exception as err:
            _LOGGER.debug("Could not create .gz for %s: %s", card_file, err)

    return success


# =============================================================================
# LOVELACE RESOURCE AUTO-REGISTRIEREN
# =============================================================================

CARD_URL = "/local/community/stock-tracker/stock-tracker-card.js"
LIST_CARD_URL = "/local/community/stock-tracker/stock-tracker-list-card.js"


async def _async_register_lovelace_resource(hass: HomeAssistant) -> None:
    """Automatically register the custom cards as Lovelace resources."""
    try:
        # Warte kurz damit Lovelace initialisiert ist
        if "lovelace" not in hass.data:
            _LOGGER.debug("Lovelace not available yet")
            return

        lovelace = hass.data["lovelace"]
        resources = getattr(lovelace, "resources", None)

        if resources is None:
            _LOGGER.info(
                "Auto-registration not possible. Add resources manually:\n"
                "  URL: %s\n"
                "  URL: %s\n"
                "  Type: JavaScript Module",
                CARD_URL,
                LIST_CARD_URL,
            )
            return

        # Warte bis Resources geladen
        if hasattr(resources, "loaded") and not resources.loaded:
            await resources.async_load()

        # Prüfe welche schon registriert sind
        existing_urls = set()
        try:
            for r in resources.async_items():
                url = r.get("url", "") if isinstance(r, dict) else getattr(r, "url", "")
                existing_urls.add(url)
        except Exception:
            pass

        # Alle bekannten URLs für beide Karten
        card_urls = [
            (CARD_URL, "stock-tracker-card"),
            (LIST_CARD_URL, "stock-tracker-list-card"),
        ]

        for card_url, card_name in card_urls:
            # Bekannte URL-Varianten prüfen
            known_urls = {
                card_url,
                f"/hacsfiles/stock-tracker/{card_name}.js",
                f"/local/{card_name}.js",
                f"/local/community/stock-tracker/{card_name}.js",
            }

            if existing_urls & known_urls:
                _LOGGER.debug("Card %s already registered", card_name)
                continue

            # Resource registrieren
            try:
                await resources.async_create_item({
                    "res_type": "module",
                    "url": card_url,
                })
                _LOGGER.info("✅ Custom card auto-registered: %s", card_url)
            except Exception as err:
                _LOGGER.warning("Could not register %s: %s", card_name, err)

    except Exception as err:
        _LOGGER.warning(
            "Could not auto-register Lovelace resources: %s", err
        )

# =============================================================================
# DASHBOARD AUTO-ERSTELLEN UND AKTUALISIEREN
# =============================================================================

async def _async_setup_dashboard(
    hass: HomeAssistant,
    entry: ConfigEntry,
) -> None:
    """Set up the Stock Tracker dashboard."""
    # Prüfe ob Dashboard schon erstellt wurde
    dashboard_created = await _async_get_flag(hass, "dashboard_created", False)
    
    if not dashboard_created:
        # Erstmaliges Setup
        await _async_create_dashboard(hass, entry)
        await _async_set_flag(hass, "dashboard_created", True)
    
    # Dashboard-Inhalt immer aktualisieren
    await _async_update_dashboard(hass, entry)


async def _async_create_dashboard(
    hass: HomeAssistant,
    entry: ConfigEntry,
) -> None:
    """Create the Stock Tracker dashboard in sidebar."""
    try:
        # Dashboard via WebSocket-API erstellen
        # Das ist der zuverlässigste Weg
        
        dashboard_config = {
            "url_path": "stock-tracker",
            "mode": "storage",
            "title": "📊 Aktien",
            "icon": "mdi:chart-line",
            "show_in_sidebar": True,
            "require_admin": False,
        }

        # Versuche Dashboard zu erstellen
        try:
            await hass.services.async_call(
                "lovelace",
                "create_dashboard",
                dashboard_config,
                blocking=True,
            )
            _LOGGER.info("✅ Dashboard 'Aktien' created in sidebar")
        except Exception as err:
            # Service existiert nicht - manuell versuchen
            _LOGGER.debug("create_dashboard service not available: %s", err)
            await _async_create_dashboard_manual(hass, dashboard_config)

    except Exception as err:
        _LOGGER.warning("Could not create dashboard: %s", err)


async def _async_create_dashboard_manual(
    hass: HomeAssistant,
    config: dict,
) -> None:
    """Create dashboard manually via lovelace storage."""
    try:
        if "lovelace" not in hass.data:
            return
            
        lovelace = hass.data["lovelace"]
        dashboards = getattr(lovelace, "dashboards", None)
        
        if dashboards is None:
            _LOGGER.debug("Dashboards not available")
            return

        # Prüfe ob schon existiert
        existing = []
        try:
            existing = [
                d.get("url_path", "") if isinstance(d, dict) else getattr(d, "url_path", "")
                for d in dashboards.async_items()
            ]
        except Exception:
            pass

        if "stock-tracker" in existing:
            _LOGGER.debug("Dashboard already exists")
            return

        # Dashboard erstellen
        try:
            await dashboards.async_create_item({
                "url_path": "stock-tracker",
                "mode": "storage",
                "title": "📊 Aktien",
                "icon": "mdi:chart-line",
                "show_in_sidebar": True,
                "require_admin": False,
            })
            _LOGGER.info("✅ Dashboard manually created")
        except Exception as err:
            _LOGGER.debug("Manual dashboard creation failed: %s", err)

    except Exception as err:
        _LOGGER.warning("Manual dashboard creation error: %s", err)


async def _async_update_dashboard(
    hass: HomeAssistant,
    entry: ConfigEntry,
) -> None:
    """Update dashboard content with current symbols."""
    symbols = entry.data.get(CONF_SYMBOLS, [])
    
    if not symbols:
        return

    try:
        # Dashboard-Config generieren
        dashboard_config = _build_dashboard_config(symbols)
        
        # Config in Storage speichern
        store = Store(hass, 1, "lovelace.stock-tracker")
        await store.async_save({"data": {"config": dashboard_config}})
        
        _LOGGER.info(
            "✅ Dashboard updated with %d symbols: %s",
            len(symbols),
            ", ".join(symbols)
        )
        
        # Event feuern damit Frontend aktualisiert (optional)
        hass.bus.async_fire("lovelace_updated", {"url_path": "stock-tracker"})

    except Exception as err:
        _LOGGER.warning("Could not update dashboard: %s", err)


def _build_dashboard_config(symbols: list[str]) -> dict:
    """Build complete dashboard configuration."""
    
    def clean_symbol(symbol: str) -> str:
        """Convert symbol to entity name."""
        return (
            symbol.lower()
            .replace(".", "_")
            .replace("-", "_")
            .replace("^", "")
            .replace("=", "_")
        )

    # === VIEW 1: ÜBERSICHT ===
    overview_cards = []
    
    # Header Card
    overview_cards.append({
        "type": "markdown",
        "content": (
            "# 📊 Stock Tracker\n"
            f"**{len(symbols)} Aktien** werden überwacht\n\n"
            "Letzte Aktualisierung: {{ now().strftime('%H:%M:%S') }}"
        ),
    })

    # Aktien-Cards im Grid
    stock_cards = []
    for symbol in symbols:
        sensor_name = clean_symbol(symbol)
        stock_cards.append({
            "type": "custom:stock-tracker-card",
            "entity": f"sensor.{sensor_name}_price",
            "display_mode": "compact",
        })

    if stock_cards:
        # Grid mit 2 Spalten
        overview_cards.append({
            "type": "grid",
            "columns": 2,
            "square": False,
            "cards": stock_cards,
        })

    # Fallback Entities Card (falls Custom Card nicht funktioniert)
    entity_list = []
    for symbol in symbols:
        sensor_name = clean_symbol(symbol)
        entity_list.append({
            "entity": f"sensor.{sensor_name}_price",
            "name": symbol,
        })

    overview_cards.append({
        "type": "entities",
        "title": "📈 Alle Kurse",
        "entities": entity_list,
        "state_color": True,
    })

    # History Graph
    if symbols:
        history_entities = []
        for symbol in symbols[:5]:  # Max 5 im Graph
            sensor_name = clean_symbol(symbol)
            history_entities.append({
                "entity": f"sensor.{sensor_name}_price",
                "name": symbol,
            })

        overview_cards.append({
            "type": "history-graph",
            "title": "📉 Kursverlauf (24h)",
            "hours_to_show": 24,
            "entities": history_entities,
        })

    # === VIEW 2: PERFORMANCE ===
    performance_cards = []
    
    performance_cards.append({
        "type": "markdown",
        "content": "# 📈 Tagesperformance",
    })

    # Change-Sensoren
    change_entities = []
    for symbol in symbols:
        sensor_name = clean_symbol(symbol)
        change_entities.append({
            "entity": f"sensor.{sensor_name}_change",
            "name": symbol,
        })

    performance_cards.append({
        "type": "entities",
        "title": "Änderung heute",
        "entities": change_entities,
        "state_color": True,
    })

    # Trend-Sensoren
    trend_entities = []
    for symbol in symbols:
        sensor_name = clean_symbol(symbol)
        trend_entities.append({
            "entity": f"sensor.{sensor_name}_trend",
            "name": symbol,
        })

    performance_cards.append({
        "type": "entities",
        "title": "🔮 Trends",
        "entities": trend_entities,
    })

    # === VIEW 3: TECHNISCHE ANALYSE ===
    analysis_cards = []
    
    analysis_cards.append({
        "type": "markdown",
        "content": "# ⚡ Technische Analyse\nRSI, MACD und weitere Indikatoren",
    })

    # Indikatoren-Sensoren
    indicator_entities = []
    for symbol in symbols:
        sensor_name = clean_symbol(symbol)
        indicator_entities.append({
            "entity": f"sensor.{sensor_name}_indicators",
            "name": f"{symbol} Signal",
        })

    analysis_cards.append({
        "type": "entities",
        "title": "📊 Trading-Signale",
        "entities": indicator_entities,
    })

    # RSI Gauges
    rsi_cards = []
    for symbol in symbols[:6]:  # Max 6 Gauges
        sensor_name = clean_symbol(symbol)
        rsi_cards.append({
            "type": "gauge",
            "entity": f"sensor.{sensor_name}_price",
            "name": f"{symbol} RSI",
            "needle": True,
            "min": 0,
            "max": 100,
            "segments": [
                {"from": 0, "color": "#43a047"},
                {"from": 30, "color": "#ffa600"},
                {"from": 70, "color": "#db4437"},
            ],
        })

    if rsi_cards:
        analysis_cards.append({
            "type": "horizontal-stack",
            "cards": rsi_cards[:3],  # Erste Reihe
        })
        if len(rsi_cards) > 3:
            analysis_cards.append({
                "type": "horizontal-stack",
                "cards": rsi_cards[3:6],  # Zweite Reihe
            })

    # Volume
    volume_entities = []
    for symbol in symbols:
        sensor_name = clean_symbol(symbol)
        volume_entities.append({
            "entity": f"sensor.{sensor_name}_volume",
            "name": symbol,
        })

    analysis_cards.append({
        "type": "entities",
        "title": "📦 Handelsvolumen",
        "entities": volume_entities,
    })

    # === VIEW 4: DETAILS (pro Aktie expandierbar) ===
    details_cards = []
    
    details_cards.append({
        "type": "markdown",
        "content": "# 🔍 Detailansicht\nKlicke auf eine Aktie für mehr Infos",
    })

    for symbol in symbols:
        sensor_name = clean_symbol(symbol)
        details_cards.append({
            "type": "vertical-stack",
            "cards": [
                {
                    "type": "custom:stock-tracker-card",
                    "entity": f"sensor.{sensor_name}_price",
                    "display_mode": "full",
                    "show_indicators": True,
                    "show_chart": True,
                },
            ],
        })

    # === DASHBOARD CONFIG ===
    return {
        "views": [
            {
                "title": "Übersicht",
                "path": "overview",
                "icon": "mdi:view-dashboard",
                "cards": overview_cards,
            },
            {
                "title": "Performance",
                "path": "performance",
                "icon": "mdi:chart-line",
                "cards": performance_cards,
            },
            {
                "title": "Analyse",
                "path": "analysis",
                "icon": "mdi:chart-timeline-variant",
                "cards": analysis_cards,
            },
            {
                "title": "Details",
                "path": "details",
                "icon": "mdi:magnify",
                "cards": details_cards,
            },
        ],
    }


# =============================================================================
# WELCOME NOTIFICATION
# =============================================================================

async def _async_show_welcome_notification(
    hass: HomeAssistant,
    entry: ConfigEntry,
) -> None:
    """Show welcome notification on first setup."""
    welcome_shown = await _async_get_flag(hass, "welcome_shown", False)

    if welcome_shown:
        return

    try:
        symbols = entry.data.get(CONF_SYMBOLS, [])
        symbol_count = len(symbols)
        symbols_list = ", ".join(symbols)
        sensor_count = symbol_count * 5

        title = "🎉 Stock Tracker ist bereit!"

        message = (
            "**Willkommen bei Stock Tracker!**\n\n"
            f"✅ **{symbol_count} Symbole** werden überwacht:\n"
            f"`{symbols_list}`\n\n"
            f"📊 **{sensor_count} Sensoren** erstellt (5 pro Aktie)\n\n"
            "🎨 **Custom Card** automatisch registriert\n\n"
            "📋 **Dashboard** findest du in der Seitenleiste unter **📊 Aktien**\n\n"
            "---\n\n"
            "💡 **Weitere Aktien hinzufügen:**\n"
            "Einstellungen → Geräte & Dienste → Stock Tracker → **Konfigurieren**\n\n"
            "🚀 Oder per Service:\n"
            "```yaml\n"
            "service: stock_tracker.add_stock\n"
            "data:\n"
            "  symbol: MSFT\n"
            "```"
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

        await _async_set_flag(hass, "welcome_shown", True)

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
            raise HomeAssistantError(f"Maximum {MAX_SYMBOLS} symbols reached")
        
        if symbol in current:
            _LOGGER.info("Symbol %s already tracked", symbol)
            return

        # Validierung
        from .coordinator import StockDataCoordinator
        valid = await hass.async_add_executor_job(
            StockDataCoordinator.validate_symbol, symbol
        )
        if not valid:
            raise HomeAssistantError(f"Symbol '{symbol}' not found")

        # Notification VOR dem Reload
        await hass.services.async_call(
            "persistent_notification", "create",
            {
                "title": f"✅ {symbol} hinzugefügt",
                "message": (
                    f"**{symbol}** wird jetzt überwacht.\n\n"
                    "Das Dashboard wird automatisch aktualisiert."
                ),
                "notification_id": f"{DOMAIN}_added_{symbol.lower()}",
            },
        )

        # Config updaten (triggert Reload + Dashboard-Update)
        updated = current + [symbol]
        new_data = dict(entry.data)
        new_data[CONF_SYMBOLS] = updated
        hass.config_entries.async_update_entry(entry, data=new_data)

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

        await hass.services.async_call(
            "persistent_notification", "create",
            {
                "title": f"🗑️ {symbol} entfernt",
                "message": f"**{symbol}** wird nicht mehr überwacht.",
                "notification_id": f"{DOMAIN}_removed_{symbol.lower()}",
            },
        )

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
                f"• **{r['symbol']}** - {r['name']} ({r.get('exchange', '')})"
                for r in results
            )
        else:
            text = "Keine Ergebnisse gefunden."

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
        """Force refresh all data."""
        for entry_data in hass.data.get(DOMAIN, {}).values():
            coordinator = entry_data.get("coordinator")
            if coordinator:
                await coordinator.async_request_refresh()
        
        await hass.services.async_call(
            "persistent_notification", "create",
            {
                "title": "🔄 Daten aktualisiert",
                "message": "Alle Aktiendaten wurden neu geladen.",
                "notification_id": f"{DOMAIN}_refresh",
            },
        )

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
                    "title": "📊 Datenbank aktualisiert",
                    "message": f"{count} Symbole in der Datenbank.",
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
    """Get the config entry."""
    entries = hass.config_entries.async_entries(DOMAIN)
    return entries[0] if entries else None