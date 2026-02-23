"""
Dashboard Auto-Generator for Stock Tracker.

Automatically creates Lovelace dashboards when stocks are added.
Creates overview, detail, and portfolio views.
"""
from __future__ import annotations

import logging
from typing import Any

from homeassistant.core import HomeAssistant

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


class DashboardGenerator:
    """Generates Lovelace dashboard configurations for stocks."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the dashboard generator."""
        self.hass = hass

    # =========================================================================
    # FULL DASHBOARD
    # =========================================================================

    def generate_dashboard(
        self,
        symbols: list[str],
        coordinator_data: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Generate complete dashboard config for all tracked symbols."""
        views = []

        # View 1: Übersicht aller Aktien
        views.append(self._build_overview_view(symbols, coordinator_data))

        # View 2: Detail-Ansicht pro Aktie
        for symbol in symbols:
            stock_data = (
                coordinator_data.get(symbol) if coordinator_data else None
            )
            views.append(
                self._build_detail_view(symbol, stock_data)
            )

        # View 3: Technische Analyse
        views.append(self._build_indicators_view(symbols))

        return {
            "title": "📊 Stock Tracker",
            "views": views,
        }

    # =========================================================================
    # VIEW 1: ÜBERSICHT
    # =========================================================================

    def _build_overview_view(
        self,
        symbols: list[str],
        data: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Build the main overview view with all stocks."""
        cards = []

        # --- Header ---
        cards.append({
            "type": "markdown",
            "content": (
                "# 📊 Stock Tracker\n"
                f"Überwache **{len(symbols)}** Symbole | "
                "Aktualisierung: `{{ now().strftime('%H:%M:%S') }}`"
            ),
        })

        # --- Alle Aktien als kompakte Grid-Cards ---
        stock_cards = []
        for symbol in symbols:
            stock_cards.append(
                self._build_stock_mini_card(symbol, data)
            )

        # Grid Layout (2 Spalten)
        if stock_cards:
            cards.append({
                "type": "grid",
                "columns": 2,
                "square": False,
                "cards": stock_cards,
            })

        # --- Preis-History Graph ---
        price_entities = [
            {"entity": f"sensor.{symbol.lower().replace('.', '_').replace('-', '_').replace('^', '')}_price"}
            for symbol in symbols[:5]  # Max 5 im Graph
        ]

        if price_entities:
            cards.append({
                "type": "history-graph",
                "title": "📈 Kursverlauf (24h)",
                "hours_to_show": 24,
                "entities": price_entities,
            })

        # --- Performance Vergleich (Änderungen) ---
        change_entities = [
            {
                "entity": f"sensor.{self._sensor_name(symbol)}_change",
                "name": symbol,
            }
            for symbol in symbols
        ]

        if change_entities:
            cards.append({
                "type": "entities",
                "title": "📊 Tagesperformance",
                "entities": change_entities,
            })

        return {
            "title": "Übersicht",
            "path": "overview",
            "icon": "mdi:view-dashboard",
            "cards": cards,
        }

    # =========================================================================
    # VIEW 2: DETAIL PRO AKTIE
    # =========================================================================

    def _build_detail_view(
        self,
        symbol: str,
        data: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Build detail view for a single stock."""
        sensor_base = self._sensor_name(symbol)
        company = symbol

        if data:
            company = data.get("company_name", symbol)

        cards = []

        # --- Header ---
        cards.append({
            "type": "markdown",
            "content": f"# {company} ({symbol})",
        })

        # --- Haupt-Kennzahlen (horizontal) ---
        cards.append({
            "type": "horizontal-stack",
            "cards": [
                {
                    "type": "entity",
                    "entity": f"sensor.{sensor_base}_price",
                    "name": "Kurs",
                    "icon": "mdi:currency-usd",
                },
                {
                    "type": "entity",
                    "entity": f"sensor.{sensor_base}_change",
                    "name": "Heute",
                    "icon": "mdi:percent",
                },
                {
                    "type": "entity",
                    "entity": f"sensor.{sensor_base}_trend",
                    "name": "Trend",
                    "icon": "mdi:trending-up",
                },
            ],
        })

        # --- Detaillierte Kennzahlen ---
        cards.append({
            "type": "entities",
            "title": "📊 Marktdaten",
            "show_header_toggle": False,
            "entities": [
                {
                    "entity": f"sensor.{sensor_base}_price",
                    "type": "attribute",
                    "attribute": "previous_close",
                    "name": "Vortagesschluss",
                    "icon": "mdi:clock-outline",
                },
                {
                    "entity": f"sensor.{sensor_base}_price",
                    "type": "attribute",
                    "attribute": "today_open",
                    "name": "Eröffnung",
                    "icon": "mdi:door-open",
                },
                {
                    "entity": f"sensor.{sensor_base}_price",
                    "type": "attribute",
                    "attribute": "today_high",
                    "name": "Tageshoch",
                    "icon": "mdi:arrow-up",
                },
                {
                    "entity": f"sensor.{sensor_base}_price",
                    "type": "attribute",
                    "attribute": "today_low",
                    "name": "Tagestief",
                    "icon": "mdi:arrow-down",
                },
                {
                    "entity": f"sensor.{sensor_base}_volume",
                    "name": "Volumen",
                    "icon": "mdi:chart-bar",
                },
            ],
        })

        # --- Fundamentaldaten ---
        cards.append({
            "type": "entities",
            "title": "💰 Fundamentaldaten",
            "show_header_toggle": False,
            "entities": [
                {
                    "entity": f"sensor.{sensor_base}_price",
                    "type": "attribute",
                    "attribute": "market_cap_formatted",
                    "name": "Marktkapitalisierung",
                    "icon": "mdi:bank",
                },
                {
                    "entity": f"sensor.{sensor_base}_price",
                    "type": "attribute",
                    "attribute": "pe_ratio",
                    "name": "KGV (P/E)",
                    "icon": "mdi:calculator",
                },
                {
                    "entity": f"sensor.{sensor_base}_price",
                    "type": "attribute",
                    "attribute": "eps",
                    "name": "Gewinn/Aktie (EPS)",
                    "icon": "mdi:cash",
                },
                {
                    "entity": f"sensor.{sensor_base}_price",
                    "type": "attribute",
                    "attribute": "dividend_yield",
                    "name": "Dividendenrendite",
                    "icon": "mdi:percent",
                },
                {
                    "entity": f"sensor.{sensor_base}_price",
                    "type": "attribute",
                    "attribute": "52_week_high",
                    "name": "52-Wochen Hoch",
                    "icon": "mdi:trophy",
                },
                {
                    "entity": f"sensor.{sensor_base}_price",
                    "type": "attribute",
                    "attribute": "52_week_low",
                    "name": "52-Wochen Tief",
                    "icon": "mdi:arrow-down-bold",
                },
            ],
        })

        # --- Performance-Zeiträume ---
        cards.append({
            "type": "entities",
            "title": "📈 Performance",
            "show_header_toggle": False,
            "entities": [
                {
                    "entity": f"sensor.{sensor_base}_price",
                    "type": "attribute",
                    "attribute": "week_change_percent",
                    "name": "1 Woche",
                    "icon": "mdi:calendar-week",
                    "suffix": "%",
                },
                {
                    "entity": f"sensor.{sensor_base}_price",
                    "type": "attribute",
                    "attribute": "month_change_percent",
                    "name": "1 Monat",
                    "icon": "mdi:calendar-month",
                    "suffix": "%",
                },
                {
                    "entity": f"sensor.{sensor_base}_price",
                    "type": "attribute",
                    "attribute": "ytd_change_percent",
                    "name": "Year-to-Date",
                    "icon": "mdi:calendar",
                    "suffix": "%",
                },
            ],
        })

        # --- Kurs-History ---
        cards.append({
            "type": "history-graph",
            "title": "📉 Kursverlauf (7 Tage)",
            "hours_to_show": 168,
            "entities": [
                {"entity": f"sensor.{sensor_base}_price"},
            ],
        })

        # --- RSI Gauge ---
        cards.append({
            "type": "horizontal-stack",
            "cards": [
                {
                    "type": "gauge",
                    "entity": f"sensor.{sensor_base}_indicators",
                    "name": "RSI (14)",
                    "needle": True,
                    "min": 0,
                    "max": 100,
                    "severity": {
                        "green": 30,
                        "yellow": 50,
                        "red": 70,
                    },
                    "attribute": "rsi_14",
                    "unit": "",
                },
                {
                    "type": "gauge",
                    "entity": f"sensor.{sensor_base}_trend",
                    "name": "Trend-Stärke",
                    "needle": True,
                    "min": 0,
                    "max": 10,
                    "severity": {
                        "red": 0,
                        "yellow": 3,
                        "green": 6,
                    },
                    "attribute": "trend_strength",
                    "unit": "/10",
                },
            ],
        })

        # --- Analyse-Zusammenfassung ---
        cards.append({
            "type": "markdown",
            "title": "🔮 Analyse",
            "content": (
                "**Signal:** "
                "{{ state_attr('sensor." + sensor_base + "_indicators', 'analysis_summary') "
                "| default('Keine Daten') }}\n\n"
                "**Trend:** "
                "{{ state_attr('sensor." + sensor_base + "_trend', 'summary') "
                "| default('Keine Daten') }}"
            ),
        })

        return {
            "title": symbol,
            "path": f"stock-{symbol.lower().replace('.', '-').replace('^', '')}",
            "icon": "mdi:chart-line",
            "cards": cards,
        }

    # =========================================================================
    # VIEW 3: TECHNISCHE INDIKATOREN
    # =========================================================================

    def _build_indicators_view(
        self, symbols: list[str]
    ) -> dict[str, Any]:
        """Build technical indicators overview for all stocks."""
        cards = []

        cards.append({
            "type": "markdown",
            "content": "# ⚡ Technische Analyse",
        })

        # --- Indikatoren-Tabelle ---
        indicator_entities = []
        for symbol in symbols:
            sensor_base = self._sensor_name(symbol)
            indicator_entities.append({
                "entity": f"sensor.{sensor_base}_indicators",
                "name": f"{symbol} Signal",
            })

        if indicator_entities:
            cards.append({
                "type": "entities",
                "title": "📊 Signale Übersicht",
                "entities": indicator_entities,
            })

        # --- Trend-Übersicht ---
        trend_entities = []
        for symbol in symbols:
            sensor_base = self._sensor_name(symbol)
            trend_entities.append({
                "entity": f"sensor.{sensor_base}_trend",
                "name": f"{symbol} Trend",
            })

        if trend_entities:
            cards.append({
                "type": "entities",
                "title": "🔮 Trends",
                "entities": trend_entities,
            })

        # --- RSI Gauges (Grid) ---
        rsi_cards = []
        for symbol in symbols[:6]:  # Max 6 Gauges
            sensor_base = self._sensor_name(symbol)
            rsi_cards.append({
                "type": "gauge",
                "entity": f"sensor.{sensor_base}_indicators",
                "name": f"{symbol} RSI",
                "needle": True,
                "min": 0,
                "max": 100,
                "severity": {
                    "green": 30,
                    "yellow": 50,
                    "red": 70,
                },
                "attribute": "rsi_14",
                "unit": "",
            })

        if rsi_cards:
            cards.append({
                "type": "grid",
                "columns": 3,
                "square": True,
                "title": "📊 RSI Übersicht",
                "cards": rsi_cards,
            })

        # --- Volume Vergleich ---
        volume_entities = []
        for symbol in symbols:
            sensor_base = self._sensor_name(symbol)
            volume_entities.append({
                "entity": f"sensor.{sensor_base}_volume",
                "name": symbol,
            })

        if volume_entities:
            cards.append({
                "type": "entities",
                "title": "📦 Volumen",
                "entities": volume_entities,
            })

        return {
            "title": "Indikatoren",
            "path": "indicators",
            "icon": "mdi:chart-timeline-variant",
            "cards": cards,
        }

    # =========================================================================
    # MINI STOCK CARD (für Übersicht)
    # =========================================================================

    def _build_stock_mini_card(
        self,
        symbol: str,
        data: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Build a compact stock card for the overview grid."""
        sensor_base = self._sensor_name(symbol)

        return {
            "type": "vertical-stack",
            "cards": [
                {
                    "type": "entity",
                    "entity": f"sensor.{sensor_base}_price",
                    "name": symbol,
                    "icon": "mdi:chart-line",
                },
                {
                    "type": "horizontal-stack",
                    "cards": [
                        {
                            "type": "entity",
                            "entity": f"sensor.{sensor_base}_change",
                            "name": "Heute",
                            "icon": "mdi:percent",
                        },
                        {
                            "type": "entity",
                            "entity": f"sensor.{sensor_base}_trend",
                            "name": "Trend",
                        },
                    ],
                },
            ],
        }

    # =========================================================================
    # PORTFOLIO DASHBOARD
    # =========================================================================

    def generate_portfolio_dashboard(
        self,
        symbols: list[str],
    ) -> dict[str, Any]:
        """Generate a portfolio-focused dashboard."""
        cards = []

        # Header
        cards.append({
            "type": "markdown",
            "content": (
                "# 💼 Mein Portfolio\n"
                f"**{len(symbols)}** Positionen | "
                "Stand: `{{ now().strftime('%d.%m.%Y %H:%M') }}`"
            ),
        })

        # Alle Positionen
        position_entities = []
        for symbol in symbols:
            sensor_base = self._sensor_name(symbol)
            position_entities.append({
                "entity": f"sensor.{sensor_base}_price",
                "secondary_info": "last-changed",
            })

        cards.append({
            "type": "entities",
            "title": "📊 Positionen",
            "entities": position_entities,
        })

        # Performance-Tabelle
        change_entities = []
        for symbol in symbols:
            sensor_base = self._sensor_name(symbol)
            change_entities.append({
                "entity": f"sensor.{sensor_base}_change",
                "name": symbol,
            })

        cards.append({
            "type": "entities",
            "title": "📈 Tagesperformance",
            "entities": change_entities,
        })

        # History aller Aktien
        history_entities = [
            {"entity": f"sensor.{self._sensor_name(s)}_price"}
            for s in symbols[:5]
        ]

        cards.append({
            "type": "history-graph",
            "title": "📉 Kursverlauf (7 Tage)",
            "hours_to_show": 168,
            "entities": history_entities,
        })

        return {
            "title": "💼 Portfolio",
            "views": [
                {
                    "title": "Portfolio",
                    "path": "portfolio",
                    "icon": "mdi:briefcase",
                    "cards": cards,
                }
            ],
        }

    # =========================================================================
    # WATCHLIST DASHBOARD
    # =========================================================================

    def generate_watchlist_dashboard(
        self, symbols: list[str]
    ) -> dict[str, Any]:
        """Generate a simple watchlist dashboard."""
        entities = []
        for symbol in symbols:
            sensor_base = self._sensor_name(symbol)
            entities.append({
                "entity": f"sensor.{sensor_base}_price",
                "secondary_info": "last-changed",
            })

        cards = [
            {
                "type": "markdown",
                "content": f"# 👁️ Watchlist ({len(symbols)} Aktien)",
            },
            {
                "type": "entities",
                "title": "Kurse",
                "show_header_toggle": False,
                "entities": entities,
            },
        ]

        return {
            "title": "👁️ Watchlist",
            "views": [
                {
                    "title": "Watchlist",
                    "path": "watchlist",
                    "icon": "mdi:eye",
                    "cards": cards,
                }
            ],
        }

    # =========================================================================
    # EXPORT DASHBOARD AS YAML
    # =========================================================================

    def export_yaml(
        self,
        dashboard: dict[str, Any],
    ) -> str:
        """Export dashboard config as YAML string."""
        import yaml

        return yaml.dump(
            dashboard,
            default_flow_style=False,
            allow_unicode=True,
            sort_keys=False,
        )

    # =========================================================================
    # APPLY DASHBOARD TO HOME ASSISTANT
    # =========================================================================

    async def async_create_dashboard(
        self,
        symbols: list[str],
        coordinator_data: dict[str, Any] | None = None,
        dashboard_type: str = "overview",
    ) -> bool:
        """Create or update a Lovelace dashboard in Home Assistant."""
        try:
            if dashboard_type == "portfolio":
                config = self.generate_portfolio_dashboard(symbols)
            elif dashboard_type == "watchlist":
                config = self.generate_watchlist_dashboard(symbols)
            else:
                config = self.generate_dashboard(
                    symbols, coordinator_data
                )

            # Dashboard über Lovelace Storage speichern
            url_path = f"stock-tracker-{dashboard_type}"

            # Prüfe ob Dashboard schon existiert
            dashboards = self.hass.data.get("lovelace_dashboards", {})

            await self.hass.services.async_call(
                "lovelace",
                "save_config",
                {
                    "config": config,
                    "url_path": url_path,
                },
                blocking=True,
            )

            _LOGGER.info(
                "Dashboard '%s' created/updated with %d symbols",
                dashboard_type,
                len(symbols),
            )
            return True

        except Exception as err:
            _LOGGER.error("Failed to create dashboard: %s", err)
            return False

    # =========================================================================
    # HELPERS
    # =========================================================================

    @staticmethod
    def _sensor_name(symbol: str) -> str:
        """Convert stock symbol to valid sensor entity name."""
        return (
            symbol.lower()
            .replace(".", "_")
            .replace("-", "_")
            .replace("^", "")
            .replace("=", "_")
            .replace(" ", "_")
        )