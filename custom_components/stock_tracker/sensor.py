"""
Sensor platform for Stock Tracker.

Creates 5 sensors per stock symbol:
  1. Price Sensor     - Current stock price + all fundamental data
  2. Change Sensor    - Daily change in percent
  3. Trend Sensor     - Trend analysis (bullish/bearish/neutral)
  4. Volume Sensor    - Trading volume
  5. Indicators Sensor - Technical indicators (RSI, MACD, etc.)

v2.0 Changes:
  - Added circulating_supply, total_supply, max_supply attributes
  - Market cap now always has a value (calculated from supply if needed)
  - Better formatting for large numbers
"""
from __future__ import annotations

import logging
from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import (
    DOMAIN,
    CONF_SYMBOLS,
    CONF_SHOW_INDICATORS,
    SENSOR_PRICE,
    SENSOR_CHANGE,
    SENSOR_TREND,
    SENSOR_VOLUME,
    SENSOR_INDICATORS,
    ICON_CHART,
    ICON_VOLUME,
    ICON_INDICATORS,
    ICON_TRENDING_UP,
    ICON_TRENDING_DOWN,
    ICON_TRENDING_NEUTRAL,
    ICON_ROCKET,
    ICON_ALERT,
)
from .coordinator import StockDataCoordinator

_LOGGER = logging.getLogger(__name__)


# =============================================================================
# SENSOR SETUP
# =============================================================================

async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up Stock Tracker sensors from a config entry."""
    coordinator: StockDataCoordinator = (
        hass.data[DOMAIN][entry.entry_id]["coordinator"]
    )
    symbols = entry.data.get(CONF_SYMBOLS, [])
    show_indicators = entry.data.get(CONF_SHOW_INDICATORS, True)

    entities = []

    for symbol in symbols:
        entities.append(StockPriceSensor(coordinator, symbol))
        entities.append(StockChangeSensor(coordinator, symbol))
        entities.append(StockTrendSensor(coordinator, symbol))
        entities.append(StockVolumeSensor(coordinator, symbol))

        if show_indicators:
            entities.append(StockIndicatorsSensor(coordinator, symbol))

    async_add_entities(entities, update_before_add=True)

    _LOGGER.info(
        "Created %d sensors for %d symbols",
        len(entities),
        len(symbols),
    )


# =============================================================================
# BASE SENSOR CLASS
# =============================================================================

class StockBaseSensor(CoordinatorEntity, SensorEntity):
    """Base class for all stock sensors."""

    _attr_has_entity_name = False

    def __init__(
        self,
        coordinator: StockDataCoordinator,
        symbol: str,
        sensor_type: str,
    ) -> None:
        """Initialize the base sensor."""
        super().__init__(coordinator)
        self._symbol = symbol.upper()
        self._sensor_type = sensor_type
        
        clean_symbol = self._clean_symbol(symbol)
        self._attr_unique_id = f"{DOMAIN}_{clean_symbol}_{sensor_type}"

    @staticmethod
    def _clean_symbol(symbol: str) -> str:
        """Convert symbol to clean entity name."""
        return (
            symbol.lower()
            .replace(".", "_")
            .replace("-", "_")
            .replace("^", "")
            .replace("=", "_")
            .replace(" ", "_")
        )

    @property
    def device_info(self):
        """Return device info."""
        data = self._get_data()
        company = data.get("company_name", self._symbol) if data else self._symbol

        return {
            "identifiers": {(DOMAIN, self._symbol)},
            "name": f"{self._symbol} ({company})",
            "manufacturer": "Stock Tracker",
            "model": "Stock Sensor",
        }

    def _get_data(self) -> dict[str, Any] | None:
        """Get data for this symbol."""
        if self.coordinator.data:
            return self.coordinator.data.get(self._symbol)
        return None

    def _safe_get(self, key: str, default=None):
        """Safely get a value."""
        data = self._get_data()
        if data:
            return data.get(key, default)
        return default


# =============================================================================
# SENSOR 1: STOCK PRICE (Hauptsensor)
# =============================================================================

class StockPriceSensor(StockBaseSensor):
    """
    Main stock price sensor.

    State: Current stock price
    Attributes: All fundamental data, market data, company info, supply data
    """

    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(
        self,
        coordinator: StockDataCoordinator,
        symbol: str,
    ) -> None:
        """Initialize price sensor."""
        super().__init__(coordinator, symbol, SENSOR_PRICE)

    @property
    def name(self) -> str:
        return f"{self._symbol} Price"

    @property
    def native_value(self) -> float | None:
        """Return current stock price."""
        return self._safe_get("price")

    @property
    def native_unit_of_measurement(self) -> str | None:
        """Return currency as unit."""
        return self._safe_get("currency", "USD")

    @property
    def icon(self) -> str:
        """Return icon based on price direction."""
        change = self._safe_get("change")
        if change is not None:
            if change > 0:
                return ICON_TRENDING_UP
            elif change < 0:
                return ICON_TRENDING_DOWN
        return ICON_CHART

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return all stock data as attributes."""
        data = self._get_data()
        if not data:
            return {"symbol": self._symbol}

        attrs = {}

        # --- Identifikation ---
        self._add_attr(attrs, data, "symbol")
        self._add_attr(attrs, data, "company_name")
        self._add_attr(attrs, data, "exchange")
        self._add_attr(attrs, data, "currency")
        self._add_attr(attrs, data, "sector")
        self._add_attr(attrs, data, "industry")
        self._add_attr(attrs, data, "country")
        self._add_attr(attrs, data, "quote_type")

        # --- Preisdaten ---
        self._add_attr(attrs, data, "change")
        self._add_attr(attrs, data, "change_percent")
        self._add_attr(attrs, data, "previous_close")
        self._add_attr(attrs, data, "today_open")
        self._add_attr(attrs, data, "today_high")
        self._add_attr(attrs, data, "today_low")

        # --- Volumen ---
        self._add_attr(attrs, data, "volume")
        self._add_attr(attrs, data, "avg_volume")

        # --- Marktdaten (FIXED!) ---
        mc = data.get("market_cap")
        mc_fmt = data.get("market_cap_formatted")
        if mc is not None:
            try:
                mc_float = float(mc)
                if mc_float > 0:
                    attrs["market_cap"] = mc
                    attrs["market_cap_formatted"] = mc_fmt if mc_fmt and mc_fmt != "N/A" else self._format_large_number(mc)
            except (ValueError, TypeError):
                pass
        
        self._add_attr(attrs, data, "shares_outstanding")

        # --- Supply (Krypto) ---
        self._add_attr(attrs, data, "circulating_supply")
        self._add_attr(attrs, data, "total_supply")
        self._add_attr(attrs, data, "max_supply")

        # --- Fundamentaldaten ---
        self._add_attr(attrs, data, "pe_ratio")
        self._add_attr(attrs, data, "forward_pe")
        self._add_attr(attrs, data, "eps")
        self._add_attr(attrs, data, "dividend_yield")
        self._add_attr(attrs, data, "dividend_rate")
        self._add_attr(attrs, data, "payout_ratio")
        self._add_attr(attrs, data, "price_to_book")
        self._add_attr(attrs, data, "profit_margin")
        self._add_attr(attrs, data, "return_on_equity")

        # --- Bereiche ---
        self._add_attr(attrs, data, "52_week_high")
        self._add_attr(attrs, data, "52_week_low")
        self._add_attr(attrs, data, "50_day_avg")
        self._add_attr(attrs, data, "200_day_avg")

        # --- Zeitraum-Performance ---
        self._add_attr(attrs, data, "week_change_percent")
        self._add_attr(attrs, data, "month_change_percent")
        self._add_attr(attrs, data, "quarter_change_percent")
        self._add_attr(attrs, data, "ytd_change_percent")

        # --- Analysten ---
        self._add_attr(attrs, data, "target_price")
        self._add_attr(attrs, data, "recommendation")
        self._add_attr(attrs, data, "number_of_analysts")
        self._add_attr(attrs, data, "beta")

        # --- Crypto-spezifisch ---
        self._add_attr(attrs, data, "ath")
        self._add_attr(attrs, data, "ath_change_percent")
        self._add_attr(attrs, data, "atl")
        self._add_attr(attrs, data, "market_cap_rank")
        self._add_attr(attrs, data, "coingecko_id")

        # --- Meta ---
        self._add_attr(attrs, data, "data_source")
        self._add_attr(attrs, data, "data_quality")
        self._add_attr(attrs, data, "overall_signal")

        return attrs

    @staticmethod
    def _add_attr(
        attrs: dict, data: dict, key: str, attr_name: str | None = None
    ) -> None:
        """Add attribute if value exists and is not None."""
        value = data.get(key)
        if value is not None and value != "" and value != "N/A":
            attrs[attr_name or key] = value

    @staticmethod
    def _add_attr_formatted(
        attrs: dict, data: dict, key: str, formatter, attr_name: str | None = None
    ) -> None:
        """Add formatted attribute."""
        value = data.get(key)
        if value is not None:
            attrs[attr_name or key] = value
            formatted = formatter(value)
            if formatted and formatted != "N/A":
                attrs[f"{attr_name or key}_formatted"] = formatted

    @staticmethod
    def _format_large_number(value) -> str:
        """Format large numbers (e.g., 2890000000000 -> '2.89T')."""
        if value is None:
            return "N/A"
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
            return str(value)
        except (ValueError, TypeError):
            return str(value)


# =============================================================================
# SENSOR 2: STOCK CHANGE
# =============================================================================

class StockChangeSensor(StockBaseSensor):
    """Daily change percentage sensor."""

    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_native_unit_of_measurement = "%"

    def __init__(self, coordinator: StockDataCoordinator, symbol: str) -> None:
        super().__init__(coordinator, symbol, SENSOR_CHANGE)

    @property
    def name(self) -> str:
        return f"{self._symbol} Change"

    @property
    def native_value(self) -> float | None:
        value = self._safe_get("change_percent")
        if value is not None:
            return round(value, 2)
        return None

    @property
    def icon(self) -> str:
        value = self.native_value
        if value is not None:
            if value > 2:
                return "mdi:arrow-up-bold-circle"
            elif value > 0:
                return "mdi:arrow-up-bold"
            elif value < -2:
                return "mdi:arrow-down-bold-circle"
            elif value < 0:
                return "mdi:arrow-down-bold"
        return "mdi:arrow-right-bold"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        data = self._get_data()
        if not data:
            return {}

        attrs = {"symbol": self._symbol}

        change = data.get("change")
        if change is not None:
            attrs["absolute_change"] = round(change, 4)
            attrs["currency"] = data.get("currency", "USD")

        change_pct = data.get("change_percent")
        if change_pct is not None:
            if abs(change_pct) > 5:
                attrs["change_magnitude"] = "very_large"
            elif abs(change_pct) > 2:
                attrs["change_magnitude"] = "large"
            elif abs(change_pct) > 0.5:
                attrs["change_magnitude"] = "moderate"
            else:
                attrs["change_magnitude"] = "small"

            attrs["change_direction"] = (
                "up" if change_pct > 0
                else "down" if change_pct < 0
                else "flat"
            )

        for period in [
            "week_change_percent",
            "month_change_percent",
            "quarter_change_percent",
            "ytd_change_percent",
        ]:
            value = data.get(period)
            if value is not None:
                attrs[period] = round(value, 2)

        return attrs


# =============================================================================
# SENSOR 3: STOCK TREND
# =============================================================================

class StockTrendSensor(StockBaseSensor):
    """Trend analysis sensor."""

    def __init__(self, coordinator: StockDataCoordinator, symbol: str) -> None:
        super().__init__(coordinator, symbol, SENSOR_TREND)

    @property
    def name(self) -> str:
        return f"{self._symbol} Trend"

    @property
    def native_value(self) -> str | None:
        data = self._get_data()
        if data and data.get("trend"):
            return data["trend"].get("direction", "unknown")
        return "unknown"

    @property
    def icon(self) -> str:
        value = self.native_value
        icons = {
            "strong_bullish": ICON_ROCKET,
            "bullish": ICON_TRENDING_UP,
            "neutral": ICON_TRENDING_NEUTRAL,
            "bearish": ICON_TRENDING_DOWN,
            "strong_bearish": ICON_ALERT,
        }
        return icons.get(value, ICON_TRENDING_NEUTRAL)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        data = self._get_data()
        if not data:
            return {}

        attrs = {"symbol": self._symbol}

        trend = data.get("trend", {})
        if trend:
            attrs["trend_direction"] = trend.get("direction")
            attrs["trend_strength"] = trend.get("strength")
            attrs["trend_confidence"] = trend.get("confidence")
            attrs["volatility"] = trend.get("volatility")
            attrs["volatility_level"] = trend.get("volatility_level")
            attrs["short_term_trend"] = trend.get("short_term")
            attrs["medium_term_trend"] = trend.get("medium_term")
            attrs["long_term_trend"] = trend.get("long_term")

            for ma_key in ["sma_5", "sma_10", "sma_20", "sma_50", "ema_12", "ema_26"]:
                value = trend.get(ma_key)
                if value is not None:
                    attrs[ma_key] = value

            for sr_key in ["support_1", "support_2", "resistance_1", "resistance_2"]:
                value = trend.get(sr_key)
                if value is not None:
                    attrs[sr_key] = value

        price = data.get("price")
        avg_50 = data.get("50_day_avg")
        avg_200 = data.get("200_day_avg")

        if price and avg_50:
            attrs["above_50d_avg"] = price > avg_50
            attrs["distance_50d_avg_pct"] = round(
                ((price - avg_50) / avg_50) * 100, 2
            )
        if price and avg_200:
            attrs["above_200d_avg"] = price > avg_200
            attrs["distance_200d_avg_pct"] = round(
                ((price - avg_200) / avg_200) * 100, 2
            )

        attrs["overall_signal"] = data.get("overall_signal", "N/A")
        attrs["summary"] = self._build_summary(data)

        return {k: v for k, v in attrs.items() if v is not None}

    def _build_summary(self, data: dict) -> list[str]:
        signals = []
        trend = data.get("trend", {})
        indicators = data.get("indicators", {})

        direction = trend.get("direction", "unknown")
        strength = trend.get("strength", 0)

        if direction == "strong_bullish":
            signals.append(f"🚀 Starker Aufwärtstrend (Stärke: {strength}/10)")
        elif direction == "bullish":
            signals.append(f"📈 Aufwärtstrend (Stärke: {strength}/10)")
        elif direction == "bearish":
            signals.append(f"📉 Abwärtstrend (Stärke: {strength}/10)")
        elif direction == "strong_bearish":
            signals.append(f"🔻 Starker Abwärtstrend (Stärke: {strength}/10)")
        else:
            signals.append("➡️ Seitwärtsbewegung")

        rsi = indicators.get("rsi_14")
        if rsi is not None:
            if rsi > 70:
                signals.append(f"⚠️ RSI {rsi:.0f}: Überkauft")
            elif rsi < 30:
                signals.append(f"💡 RSI {rsi:.0f}: Überverkauft (Kaufchance?)")
            else:
                signals.append(f"✅ RSI {rsi:.0f}: Neutral")

        macd_trend = indicators.get("macd_trend")
        if macd_trend == "bullish":
            signals.append("📈 MACD: Kaufsignal")
        elif macd_trend == "bearish":
            signals.append("📉 MACD: Verkaufssignal")

        vol_level = trend.get("volatility_level")
        if vol_level == "high":
            signals.append("⚡ Hohe Volatilität - Vorsicht!")
        elif vol_level == "low":
            signals.append("😴 Niedrige Volatilität")

        overall = data.get("overall_signal", "N/A")
        signals.append(f"💡 Gesamtsignal: {overall}")

        return signals


# =============================================================================
# SENSOR 4: STOCK VOLUME
# =============================================================================

class StockVolumeSensor(StockBaseSensor):
    """Trading volume sensor."""

    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, coordinator: StockDataCoordinator, symbol: str) -> None:
        super().__init__(coordinator, symbol, SENSOR_VOLUME)

    @property
    def name(self) -> str:
        return f"{self._symbol} Volume"

    @property
    def native_value(self) -> int | None:
        return self._safe_get("volume")

    @property
    def native_unit_of_measurement(self) -> str:
        return "shares"

    @property
    def icon(self) -> str:
        return ICON_VOLUME

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        data = self._get_data()
        if not data:
            return {}

        attrs = {"symbol": self._symbol}

        volume = data.get("volume")
        avg_volume = data.get("avg_volume")

        if volume is not None:
            attrs["volume"] = volume
            attrs["volume_formatted"] = self._format_volume(volume)

        if avg_volume is not None:
            attrs["avg_volume"] = avg_volume
            attrs["avg_volume_formatted"] = self._format_volume(avg_volume)

            if volume and avg_volume > 0:
                ratio = round(volume / avg_volume, 2)
                attrs["volume_ratio"] = ratio
                attrs["volume_vs_average"] = f"{round(ratio * 100)}%"

                if ratio > 2:
                    attrs["volume_level"] = "very_high"
                elif ratio > 1.5:
                    attrs["volume_level"] = "high"
                elif ratio > 0.8:
                    attrs["volume_level"] = "normal"
                elif ratio > 0.5:
                    attrs["volume_level"] = "low"
                else:
                    attrs["volume_level"] = "very_low"

        price = data.get("price")
        if volume and price:
            turnover = volume * price
            attrs["turnover"] = turnover
            attrs["turnover_formatted"] = self._format_volume(turnover)

        vol_analysis = data.get("volume_analysis", {})
        if vol_analysis:
            attrs["volume_trend"] = vol_analysis.get("trend")
            attrs["avg_volume_5d"] = vol_analysis.get("avg_5d")
            attrs["avg_volume_20d"] = vol_analysis.get("avg_20d")

        return {k: v for k, v in attrs.items() if v is not None}

    @staticmethod
    def _format_volume(value) -> str:
        if value is None:
            return "N/A"
        try:
            value = float(value)
            if value >= 1_000_000_000:
                return f"{value / 1_000_000_000:.2f}B"
            elif value >= 1_000_000:
                return f"{value / 1_000_000:.2f}M"
            elif value >= 1_000:
                return f"{value / 1_000:.1f}K"
            return str(int(value))
        except (ValueError, TypeError):
            return str(value)


# =============================================================================
# SENSOR 5: STOCK INDICATORS
# =============================================================================

class StockIndicatorsSensor(StockBaseSensor):
    """Technical indicators sensor."""

    def __init__(self, coordinator: StockDataCoordinator, symbol: str) -> None:
        super().__init__(coordinator, symbol, SENSOR_INDICATORS)

    @property
    def name(self) -> str:
        return f"{self._symbol} Indicators"

    @property
    def native_value(self) -> str | None:
        return self._safe_get("overall_signal", "N/A")

    @property
    def icon(self) -> str:
        signal = self.native_value
        if signal in ("BUY", "STRONG_BUY"):
            return "mdi:thumb-up"
        elif signal in ("SELL", "STRONG_SELL"):
            return "mdi:thumb-down"
        return ICON_INDICATORS

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        data = self._get_data()
        if not data:
            return {}

        attrs = {"symbol": self._symbol}
        indicators = data.get("indicators", {})

        if not indicators:
            attrs["status"] = "Nicht genug Daten für Analyse"
            return attrs

        # === RSI ===
        rsi = indicators.get("rsi_14")
        if rsi is not None:
            attrs["rsi_14"] = round(rsi, 2)
            if rsi > 80:
                attrs["rsi_signal"] = "strong_overbought"
                attrs["rsi_interpretation"] = "Stark überkauft - Korrektur möglich"
            elif rsi > 70:
                attrs["rsi_signal"] = "overbought"
                attrs["rsi_interpretation"] = "Überkauft - Vorsicht"
            elif rsi < 20:
                attrs["rsi_signal"] = "strong_oversold"
                attrs["rsi_interpretation"] = "Stark überverkauft - Einstiegschance?"
            elif rsi < 30:
                attrs["rsi_signal"] = "oversold"
                attrs["rsi_interpretation"] = "Überverkauft - Kaufsignal möglich"
            else:
                attrs["rsi_signal"] = "neutral"
                attrs["rsi_interpretation"] = "Neutral"

        # === MACD ===
        macd = indicators.get("macd")
        macd_signal = indicators.get("macd_signal")
        macd_hist = indicators.get("macd_histogram")
        if macd is not None:
            attrs["macd"] = round(macd, 4)
            attrs["macd_signal_line"] = (
                round(macd_signal, 4) if macd_signal else None
            )
            attrs["macd_histogram"] = (
                round(macd_hist, 4) if macd_hist else None
            )
            attrs["macd_trend"] = indicators.get("macd_trend")

            if indicators.get("macd_trend") == "bullish":
                attrs["macd_interpretation"] = "Kaufsignal - MACD über Signallinie"
            else:
                attrs["macd_interpretation"] = "Verkaufssignal - MACD unter Signallinie"

        # === Bollinger Bands ===
        bb_upper = indicators.get("bollinger_upper")
        bb_lower = indicators.get("bollinger_lower")
        bb_middle = indicators.get("bollinger_middle")
        if bb_upper is not None:
            attrs["bollinger_upper"] = round(bb_upper, 2)
            attrs["bollinger_middle"] = (
                round(bb_middle, 2) if bb_middle else None
            )
            attrs["bollinger_lower"] = round(bb_lower, 2)
            attrs["bollinger_width"] = indicators.get("bollinger_width")
            attrs["bollinger_position"] = indicators.get("bollinger_position")

            price = data.get("price")
            if price:
                if price > bb_upper:
                    attrs["bollinger_interpretation"] = (
                        "Preis über oberem Band - mögliche Korrektur"
                    )
                elif price < bb_lower:
                    attrs["bollinger_interpretation"] = (
                        "Preis unter unterem Band - möglicher Einstieg"
                    )
                else:
                    attrs["bollinger_interpretation"] = "Preis innerhalb der Bänder"

        # === Stochastic ===
        stoch_k = indicators.get("stochastic_k")
        stoch_d = indicators.get("stochastic_d")
        if stoch_k is not None:
            attrs["stochastic_k"] = round(stoch_k, 2)
            attrs["stochastic_d"] = (
                round(stoch_d, 2) if stoch_d else None
            )
            attrs["stochastic_signal"] = indicators.get("stochastic_signal")

        # === Moving Averages ===
        for ma in ["sma_5", "sma_10", "sma_20", "sma_50"]:
            value = indicators.get(ma)
            if value is not None:
                attrs[ma] = round(value, 2)

        for ema in ["ema_12", "ema_26"]:
            value = indicators.get(ema)
            if value is not None:
                attrs[ema] = round(value, 2)

        # === ADX ===
        adx = indicators.get("adx")
        if adx is not None:
            attrs["adx"] = round(adx, 2)
            if adx > 50:
                attrs["adx_interpretation"] = "Sehr starker Trend"
            elif adx > 25:
                attrs["adx_interpretation"] = "Starker Trend"
            elif adx > 20:
                attrs["adx_interpretation"] = "Moderater Trend"
            else:
                attrs["adx_interpretation"] = "Schwacher/Kein Trend"

        # === ATR ===
        atr = indicators.get("atr")
        if atr is not None:
            attrs["atr_14"] = round(atr, 4)

        # === CCI ===
        cci = indicators.get("cci")
        if cci is not None:
            attrs["cci_20"] = round(cci, 2)

        # === Williams %R ===
        williams = indicators.get("williams_r")
        if williams is not None:
            attrs["williams_r"] = round(williams, 2)

        # === Signal-Zusammenfassung ===
        bull_count = indicators.get("bullish_count", 0)
        bear_count = indicators.get("bearish_count", 0)
        neutral_count = indicators.get("neutral_count", 0)

        attrs["bullish_indicators"] = bull_count
        attrs["bearish_indicators"] = bear_count
        attrs["neutral_indicators"] = neutral_count

        attrs["analysis_summary"] = self._build_indicator_summary(attrs, data)

        return {k: v for k, v in attrs.items() if v is not None}

    def _build_indicator_summary(self, attrs: dict, data: dict) -> list[str]:
        summary = []

        rsi_signal = attrs.get("rsi_signal")
        rsi_value = attrs.get("rsi_14")
        if rsi_signal and rsi_value:
            emoji = "📈" if "oversold" in rsi_signal else (
                "📉" if "overbought" in rsi_signal else "📊"
            )
            summary.append(f"{emoji} RSI: {rsi_value:.1f} ({rsi_signal})")

        macd_trend = attrs.get("macd_trend")
        if macd_trend:
            emoji = "📈" if macd_trend == "bullish" else "📉"
            summary.append(f"{emoji} MACD: {macd_trend}")

        bb_pos = attrs.get("bollinger_position")
        if bb_pos:
            summary.append(f"📊 Bollinger: {bb_pos}")

        adx_interp = attrs.get("adx_interpretation")
        if adx_interp:
            summary.append(f"💪 ADX: {adx_interp}")

        stoch_signal = attrs.get("stochastic_signal")
        if stoch_signal:
            summary.append(f"📊 Stochastic: {stoch_signal}")

        overall = data.get("overall_signal", "N/A")
        bull = attrs.get("bullish_indicators", 0)
        bear = attrs.get("bearish_indicators", 0)
        summary.append(
            f"💡 Signal: {overall} "
            f"(📈{bull} vs 📉{bear})"
        )

        return summary