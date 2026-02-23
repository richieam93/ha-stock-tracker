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
from homeassistant.components.lovelace import _register_panel

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
    
    Steps:
    1. Copy stock-tracker-card.js to /www/ folder
    2. Register as static path
    3. Add to Lovelace resources (if possible)
    """
    try:
        # Pfade definieren
        www_path = hass.config.path("www")
        card_source = os.path.join(
            os.path.dirname(__file__),
            "www",
            "stock-tracker-card.js"
        )
        card_dest = os.path.join(www_path, "stock-tracker-card.js")

        # www-Ordner erstellen falls nicht vorhanden
        os.makedirs(www_path, exist_ok=True)

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
                shutil.copy2(card_source, card_dest)
                _LOGGER.info(
                    "Custom card copied to %s",
                    card_dest
                )
            else:
                _LOGGER.debug("Custom card already up to date")
        else:
            _LOGGER.warning(
                "Custom card source not found at %s",
                card_source
            )
            return

        # Als static path registrieren (HTTP-Zugriff)
        hass.http.register_static_path(
            "/local/stock-tracker-card.js",
            card_dest,
            cache_headers=False
        )
        _LOGGER.debug("Custom card registered as static path")

        # Versuche als Lovelace Resource zu registrieren
        # (Funktioniert nur wenn Lovelace im Storage-Modus läuft)
        await _async_add_lovelace_resource(hass)

    except Exception as err:
        _LOGGER.error(
            "Failed to register custom card automatically: %s",
            err
        )


async def _async_add_lovelace_resource(hass: HomeAssistant) -> None:
    """Add custom card to Lovelace resources."""
    try:
        # Prüfe ob Lovelace bereit ist
        if "lovelace" not in hass.data:
            _LOGGER.debug("Lovelace not ready yet, skipping resource registration")
            return

        # Resource URL
        resource_url = "/local/stock-tracker-card.js"

        # Prüfe ob Resource schon existiert
        # (Diese Methode funktioniert nur im Storage-Modus)
        lovelace_config = hass.data.get("lovelace")
        
        if lovelace_config is None:
            _LOGGER.debug("Lovelace config not available")
            return

        # Versuche die Resource hinzuzufügen
        # Wichtig: Dies kann fehlschlagen wenn Lovelace im YAML-Modus läuft
        try:
            # Verwende die Lovelace-interne Methode falls verfügbar
            from homeassistant.components.lovelace.resources import (
                ResourceStorageCollection,
            )
            
            resources: ResourceStorageCollection | None = lovelace_config.get(
                "resources"
            )
            
            if resources:
                # Prüfe ob Resource schon existiert
                existing = [
                    r for r in resources.async_items()
                    if r.get("url") == resource_url
                ]
                
                if not existing:
                    await resources.async_create_item({
                        "res_type": "module",
                        "url": resource_url,
                    })
                    _LOGGER.info("Custom card added to Lovelace resources")
                else:
                    _LOGGER.debug("Custom card already in Lovelace resources")
            else:
                _LOGGER.debug("Lovelace resources not available")
                
        except ImportError:
            _LOGGER.debug("Could not import Lovelace resources module")
        except Exception as err:
            _LOGGER.debug(
                "Could not add card to Lovelace resources: %s",
                err
            )

    except Exception as err:
        _LOGGER.debug(
            "Could not add Lovelace resource automatically: %s",
            err
        )


# =============================================================================
# DASHBOARD AUTO-CREATION
# =============================================================================

async def _async_create_default_dashboard(
    hass: HomeAssistant,
    entry: ConfigEntry,
) -> None:
    """
    Create a default Stock Tracker dashboard on first setup.
    
    Only creates if:
    - First time setup
    - User has symbols configured
    - Dashboard doesn't already exist
    """
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

        # Dashboard Config generieren
        coordinator = hass.data[DOMAIN][entry.entry_id]["coordinator"]
        dashboard_config = generator.generate_dashboard(
            symbols,
            coordinator_data=coordinator.data,
        )

        # Dashboard URL/ID
        dashboard_url = "stock-tracker"

        # Versuche Dashboard zu erstellen
        # Methode hängt davon ab ob Lovelace im Storage- oder YAML-Modus läuft
        created = await _async_create_lovelace_dashboard(
            hass,
            dashboard_url,
            dashboard_config,
        )

        if created:
            # Merken dass Dashboard erstellt wurde
            new_data = dict(entry.data)
            new_data[dashboard_created_key] = True
            hass.config_entries.async_update_entry(entry, data=new_data)

            _LOGGER.info("Stock Tracker dashboard created successfully")
        else:
            _LOGGER.debug("Dashboard creation skipped (YAML mode or already exists)")

    except Exception as err:
        _LOGGER.warning(
            "Could not create dashboard automatically: %s",
            err
        )


async def _async_create_lovelace_dashboard(
    hass: HomeAssistant,
    url_path: str,
    config: dict,
) -> bool:
    """
    Create a Lovelace dashboard.
    
    Returns True if created, False if skipped.
    """
    try:
        # Prüfe ob Lovelace bereit ist
        if "lovelace" not in hass.data:
            _LOGGER.debug("Lovelace not ready")
            return False

        lovelace_config = hass.data["lovelace"]

        # Prüfe ob im Storage-Modus
        mode = lovelace_config.get("mode")
        if mode != "storage":
            _LOGGER.debug(
                "Lovelace is in %s mode, cannot create dashboard automatically",
                mode
            )
            # Speichere Dashboard-YAML in Datei für manuelle Installation
            await _async_save_dashboard_yaml(hass, url_path, config)
            return False

        # Prüfe ob Dashboard schon existiert
        dashboards = lovelace_config.get("dashboards", {})
        if url_path in dashboards:
            _LOGGER.debug("Dashboard %s already exists", url_path)
            return False

        # Erstelle Dashboard via Lovelace API
        from homeassistant.components.lovelace.dashboard import (
            LovelaceYAML,
        )

        # Dashboard erstellen
        # Dies erstellt ein neues Dashboard im Storage
        try:
            # Verwende die interne Lovelace-Methode
            await hass.services.async_call(
                "lovelace",
                "save_config",
                {
                    "config": config,
                    "url_path": url_path,
                },
                blocking=True,
            )
            
            _LOGGER.info("Dashboard created via Lovelace service")
            return True
            
        except Exception as err:
            _LOGGER.debug("Could not create via service: %s", err)
            
            # Alternative: Direkter Zugriff auf Storage
            try:
                from homeassistant.components.lovelace.storage import (
                    LovelaceStorage,
                )
                
                storage = LovelaceStorage(hass, url_path)
                await storage.async_save(config)
                
                _LOGGER.info("Dashboard created via direct storage access")
                return True
                
            except Exception as err2:
                _LOGGER.debug("Could not create via storage: %s", err2)
                return False

    except Exception as err:
        _LOGGER.error("Error creating dashboard: %s", err)
        return False


async def _async_save_dashboard_yaml(
    hass: HomeAssistant,
    url_path: str,
    config: dict,
) -> None:
    """Save dashboard config as YAML file for manual installation."""
    try:
        import yaml
        
        # Speichere in dashboards-Ordner
        dashboards_dir = hass.config.path("dashboards")
        os.makedirs(dashboards_dir, exist_ok=True)
        
        yaml_file = os.path.join(
            dashboards_dir,
            f"{url_path}.yaml"
        )
        
        # Schreibe YAML
        with open(yaml_file, "w", encoding="utf-8") as f:
            yaml.dump(
                config,
                f,
                default_flow_style=False,
                allow_unicode=True,
                sort_keys=False,
            )
        
        _LOGGER.info(
            "Dashboard YAML saved to %s for manual installation",
            yaml_file
        )
        
    except Exception as err:
        _LOGGER.debug("Could not save dashboard YAML: %s", err)


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

        # Erstelle Benachrichtigung
        title = "🎉 Stock Tracker eingerichtet!"
        
        message = f"""
**Willkommen bei Stock Tracker!**

✅ **{symbol_count} Symbol{"e" if symbol_count != 1 else ""} werden überwacht:**
{", ".join(symbols)}

📊 **Was wurde erstellt:**
- {symbol_count * 5} Sensoren (5 pro Aktie)
- Custom Card für Lovelace
- Dashboard "Stock Tracker"

🚀 **Nächste Schritte:**

1. **Dashboard öffnen:** 
   Seitenleiste → "Stock Tracker"

2. **Custom Card nutzen:**
   ```yaml
   type: custom:stock-tracker-card
   entity: sensor.{symbols[0].lower().replace(".", "_").replace("-", "_")}_price