"""
Technical Analysis Module for Stock Tracker.

Calculates all technical indicators from historical price data.
No external TA libraries needed - pure Python/math implementation.

Indicators:
  - RSI (Relative Strength Index)
  - MACD (Moving Average Convergence Divergence)
  - Bollinger Bands
  - SMA (Simple Moving Average)
  - EMA (Exponential Moving Average)
  - Stochastic Oscillator
  - ADX (Average Directional Index)
  - ATR (Average True Range)
  - CCI (Commodity Channel Index)
  - Williams %R
  - Support & Resistance Levels
  - Trend Analysis
  - Volatility Analysis
  - Volume Analysis
"""
from __future__ import annotations

import logging
import math
from typing import Any

from .const import (
    TREND_STRONG_BULLISH,
    TREND_BULLISH,
    TREND_NEUTRAL,
    TREND_BEARISH,
    TREND_STRONG_BEARISH,
    SIGNAL_BUY,
    SIGNAL_HOLD,
    SIGNAL_SELL,
    SIGNAL_STRONG_BUY,
    SIGNAL_STRONG_SELL,
)

_LOGGER = logging.getLogger(__name__)


class TechnicalAnalysis:
    """Calculate technical indicators for stock data."""

    # =========================================================================
    # MAIN ENTRY POINT
    # =========================================================================

    def calculate_all_indicators(
        self,
        closes: list[float],
        highs: list[float] | None = None,
        lows: list[float] | None = None,
        volumes: list[float] | None = None,
    ) -> dict[str, Any]:
        """Calculate all available technical indicators."""
        if not closes or len(closes) < 2:
            return {}

        # None-Werte bereinigen
        closes = self._clean_list(closes)
        highs = self._clean_list(highs) if highs else closes
        lows = self._clean_list(lows) if lows else closes
        volumes = self._clean_list(volumes) if volumes else []

        result = {}

        # --- Moving Averages ---
        for period in [5, 10, 20, 50]:
            sma = self.calc_sma(closes, period)
            if sma is not None:
                result[f"sma_{period}"] = round(sma, 4)

        for period, label in [(12, "ema_12"), (26, "ema_26")]:
            ema = self.calc_ema(closes, period)
            if ema is not None:
                result[label] = round(ema, 4)

        # --- RSI ---
        rsi = self.calc_rsi(closes, 14)
        if rsi is not None:
            result["rsi_14"] = round(rsi, 2)

        # --- MACD ---
        macd_data = self.calc_macd(closes)
        if macd_data:
            result.update(macd_data)

        # --- Bollinger Bands ---
        bb = self.calc_bollinger_bands(closes, 20)
        if bb:
            result.update(bb)

            # Preis-Position innerhalb der Bänder
            current_price = closes[-1]
            if bb["bollinger_upper"] and bb["bollinger_lower"]:
                band_range = bb["bollinger_upper"] - bb["bollinger_lower"]
                if band_range > 0:
                    position = (
                        (current_price - bb["bollinger_lower"]) / band_range
                    )
                    if position > 0.8:
                        result["bollinger_position"] = "near_upper"
                    elif position < 0.2:
                        result["bollinger_position"] = "near_lower"
                    else:
                        result["bollinger_position"] = "middle"

        # --- Stochastic ---
        stoch = self.calc_stochastic(closes, highs, lows)
        if stoch:
            result.update(stoch)

        # --- ADX ---
        adx = self.calc_adx(closes, highs, lows)
        if adx is not None:
            result["adx"] = round(adx, 2)

        # --- ATR ---
        atr = self.calc_atr(closes, highs, lows)
        if atr is not None:
            result["atr"] = round(atr, 4)

        # --- CCI ---
        cci = self.calc_cci(closes, highs, lows)
        if cci is not None:
            result["cci"] = round(cci, 2)

        # --- Williams %R ---
        williams = self.calc_williams_r(closes, highs, lows)
        if williams is not None:
            result["williams_r"] = round(williams, 2)

        # --- Signal Counts ---
        signals = self._count_signals(result, closes)
        result.update(signals)

        return result

    # =========================================================================
    # TREND ANALYSIS
    # =========================================================================

    def calculate_trend(self, closes: list[float]) -> dict[str, Any]:
        """Calculate comprehensive trend analysis."""
        if not closes or len(closes) < 5:
            return {
                "direction": "unknown",
                "strength": 0,
                "confidence": 0,
            }

        closes = self._clean_list(closes)
        current = closes[-1]

        # --- Sub-Trends ---
        short_term = self._calc_sub_trend(closes, 5)
        medium_term = self._calc_sub_trend(closes, 20)
        long_term = self._calc_sub_trend(closes, 50)

        # --- Haupttrend bestimmen ---
        scores = {
            "short": self._trend_score(short_term),
            "medium": self._trend_score(medium_term),
            "long": self._trend_score(long_term),
        }

        # Gewichteter Score (kurzfristig wichtiger)
        weighted_score = (
            scores["short"] * 0.5
            + scores["medium"] * 0.3
            + scores["long"] * 0.2
        )

        # Richtung bestimmen
        if weighted_score > 0.6:
            direction = TREND_STRONG_BULLISH
        elif weighted_score > 0.2:
            direction = TREND_BULLISH
        elif weighted_score < -0.6:
            direction = TREND_STRONG_BEARISH
        elif weighted_score < -0.2:
            direction = TREND_BEARISH
        else:
            direction = TREND_NEUTRAL

        # Stärke (0-10)
        strength = min(abs(weighted_score) * 10, 10)

        # Konfidenz (wie einig sind sich die Sub-Trends)
        score_values = list(scores.values())
        all_same_sign = all(s >= 0 for s in score_values) or all(
            s <= 0 for s in score_values
        )
        confidence = 85 if all_same_sign else 50

        # --- Volatilität ---
        volatility = self._calc_volatility(closes)
        vol_level = (
            "low" if volatility < 15
            else "moderate" if volatility < 30
            else "high" if volatility < 50
            else "very_high"
        )

        # --- Moving Averages für Trend ---
        result = {
            "direction": direction,
            "strength": round(strength, 1),
            "confidence": confidence,
            "short_term": short_term,
            "medium_term": medium_term,
            "long_term": long_term,
            "volatility": round(volatility, 2),
            "volatility_level": vol_level,
        }

        # SMAs hinzufügen
        for period in [5, 10, 20, 50]:
            sma = self.calc_sma(closes, period)
            if sma is not None:
                result[f"sma_{period}"] = round(sma, 4)

        # EMAs hinzufügen
        for period in [12, 26]:
            ema = self.calc_ema(closes, period)
            if ema is not None:
                result[f"ema_{period}"] = round(ema, 4)

        # Support & Resistance
        sr = self.calc_support_resistance(closes)
        result.update(sr)

        return result

    def _calc_sub_trend(self, closes: list[float], period: int) -> str:
        """Calculate trend for a specific period."""
        if len(closes) < period:
            return "neutral"

        recent = closes[-period:]
        current = recent[-1]
        start = recent[0]
        avg = sum(recent) / len(recent)

        if current > avg and current > start:
            change_pct = ((current - start) / start) * 100
            return "strong_up" if change_pct > 5 else "up"
        elif current < avg and current < start:
            change_pct = ((start - current) / start) * 100
            return "strong_down" if change_pct > 5 else "down"
        return "neutral"

    @staticmethod
    def _trend_score(trend: str) -> float:
        """Convert trend string to numeric score."""
        scores = {
            "strong_up": 1.0,
            "up": 0.5,
            "neutral": 0.0,
            "down": -0.5,
            "strong_down": -1.0,
        }
        return scores.get(trend, 0.0)

    # =========================================================================
    # RSI (Relative Strength Index)
    # =========================================================================

    def calc_rsi(self, closes: list[float], period: int = 14) -> float | None:
        """Calculate RSI."""
        if len(closes) < period + 1:
            return None

        deltas = [
            closes[i] - closes[i - 1] for i in range(1, len(closes))
        ]

        gains = [d if d > 0 else 0 for d in deltas]
        losses = [-d if d < 0 else 0 for d in deltas]

        # Erster Durchschnitt
        avg_gain = sum(gains[:period]) / period
        avg_loss = sum(losses[:period]) / period

        # Smoothed RSI (Wilder's method)
        for i in range(period, len(gains)):
            avg_gain = (avg_gain * (period - 1) + gains[i]) / period
            avg_loss = (avg_loss * (period - 1) + losses[i]) / period

        if avg_loss == 0:
            return 100.0

        rs = avg_gain / avg_loss
        rsi = 100.0 - (100.0 / (1.0 + rs))

        return rsi

    # =========================================================================
    # MACD (Moving Average Convergence Divergence)
    # =========================================================================

    def calc_macd(
        self,
        closes: list[float],
        fast: int = 12,
        slow: int = 26,
        signal: int = 9,
    ) -> dict[str, Any] | None:
        """Calculate MACD, Signal Line, and Histogram."""
        if len(closes) < slow + signal:
            return None

        ema_fast = self._calc_ema_series(closes, fast)
        ema_slow = self._calc_ema_series(closes, slow)

        if not ema_fast or not ema_slow:
            return None

        # MACD Linie = EMA(fast) - EMA(slow)
        min_len = min(len(ema_fast), len(ema_slow))
        macd_line = [
            ema_fast[-(min_len - i)] - ema_slow[-(min_len - i)]
            for i in range(min_len)
        ]

        if len(macd_line) < signal:
            return None

        # Signal Linie = EMA(MACD, signal)
        signal_line = self._calc_ema_series(macd_line, signal)

        if not signal_line:
            return None

        macd_value = macd_line[-1]
        signal_value = signal_line[-1]
        histogram = macd_value - signal_value

        # Trend bestimmen
        macd_trend = "bullish" if macd_value > signal_value else "bearish"

        # Crossover Detection
        if len(macd_line) >= 2 and len(signal_line) >= 2:
            prev_macd = macd_line[-2]
            prev_signal = signal_line[-2]

            if prev_macd <= prev_signal and macd_value > signal_value:
                macd_trend = "bullish_crossover"
            elif prev_macd >= prev_signal and macd_value < signal_value:
                macd_trend = "bearish_crossover"

        return {
            "macd": round(macd_value, 4),
            "macd_signal": round(signal_value, 4),
            "macd_histogram": round(histogram, 4),
            "macd_trend": macd_trend,
        }

    # =========================================================================
    # BOLLINGER BANDS
    # =========================================================================

    def calc_bollinger_bands(
        self,
        closes: list[float],
        period: int = 20,
        std_dev: float = 2.0,
    ) -> dict[str, float] | None:
        """Calculate Bollinger Bands."""
        if len(closes) < period:
            return None

        recent = closes[-period:]
        sma = sum(recent) / period

        # Standardabweichung
        variance = sum((x - sma) ** 2 for x in recent) / period
        std = math.sqrt(variance)

        upper = sma + (std_dev * std)
        lower = sma - (std_dev * std)
        width = ((upper - lower) / sma) * 100 if sma != 0 else 0

        return {
            "bollinger_upper": round(upper, 4),
            "bollinger_middle": round(sma, 4),
            "bollinger_lower": round(lower, 4),
            "bollinger_width": round(width, 2),
        }

    # =========================================================================
    # STOCHASTIC OSCILLATOR
    # =========================================================================

    def calc_stochastic(
        self,
        closes: list[float],
        highs: list[float],
        lows: list[float],
        k_period: int = 14,
        d_period: int = 3,
    ) -> dict[str, Any] | None:
        """Calculate Stochastic Oscillator (%K and %D)."""
        if len(closes) < k_period or len(highs) < k_period or len(lows) < k_period:
            return None

        # %K Berechnung
        k_values = []
        for i in range(k_period - 1, len(closes)):
            period_highs = highs[i - k_period + 1: i + 1]
            period_lows = lows[i - k_period + 1: i + 1]

            highest = max(period_highs)
            lowest = min(period_lows)

            if highest - lowest == 0:
                k_values.append(50.0)
            else:
                k = ((closes[i] - lowest) / (highest - lowest)) * 100
                k_values.append(k)

        if len(k_values) < d_period:
            return None

        # %D = SMA von %K
        d_value = sum(k_values[-d_period:]) / d_period
        k_value = k_values[-1]

        # Signal
        if k_value > 80:
            signal = "overbought"
        elif k_value < 20:
            signal = "oversold"
        else:
            signal = "neutral"

        return {
            "stochastic_k": round(k_value, 2),
            "stochastic_d": round(d_value, 2),
            "stochastic_signal": signal,
        }

    # =========================================================================
    # ADX (Average Directional Index)
    # =========================================================================

    def calc_adx(
        self,
        closes: list[float],
        highs: list[float],
        lows: list[float],
        period: int = 14,
    ) -> float | None:
        """Calculate ADX (trend strength indicator)."""
        if len(closes) < period * 2 or len(highs) < period * 2 or len(lows) < period * 2:
            return None

        try:
            tr_list = []
            plus_dm_list = []
            minus_dm_list = []

            for i in range(1, len(closes)):
                # True Range
                tr = max(
                    highs[i] - lows[i],
                    abs(highs[i] - closes[i - 1]),
                    abs(lows[i] - closes[i - 1]),
                )
                tr_list.append(tr)

                # Directional Movement
                up_move = highs[i] - highs[i - 1]
                down_move = lows[i - 1] - lows[i]

                plus_dm = up_move if (up_move > down_move and up_move > 0) else 0
                minus_dm = down_move if (down_move > up_move and down_move > 0) else 0

                plus_dm_list.append(plus_dm)
                minus_dm_list.append(minus_dm)

            if len(tr_list) < period:
                return None

            # Smoothed averages
            atr = sum(tr_list[:period]) / period
            plus_di_sum = sum(plus_dm_list[:period]) / period
            minus_di_sum = sum(minus_dm_list[:period]) / period

            dx_list = []

            for i in range(period, len(tr_list)):
                atr = (atr * (period - 1) + tr_list[i]) / period
                plus_di_sum = (
                    (plus_di_sum * (period - 1) + plus_dm_list[i]) / period
                )
                minus_di_sum = (
                    (minus_di_sum * (period - 1) + minus_dm_list[i]) / period
                )

                if atr == 0:
                    continue

                plus_di = (plus_di_sum / atr) * 100
                minus_di = (minus_di_sum / atr) * 100

                di_sum = plus_di + minus_di
                if di_sum == 0:
                    continue

                dx = (abs(plus_di - minus_di) / di_sum) * 100
                dx_list.append(dx)

            if len(dx_list) < period:
                return None

            # ADX = Smoothed DX
            adx = sum(dx_list[:period]) / period
            for i in range(period, len(dx_list)):
                adx = (adx * (period - 1) + dx_list[i]) / period

            return adx

        except (ZeroDivisionError, ValueError):
            return None

    # =========================================================================
    # ATR (Average True Range)
    # =========================================================================

    def calc_atr(
        self,
        closes: list[float],
        highs: list[float],
        lows: list[float],
        period: int = 14,
    ) -> float | None:
        """Calculate Average True Range."""
        if len(closes) < period + 1 or len(highs) < period + 1 or len(lows) < period + 1:
            return None

        tr_list = []
        for i in range(1, len(closes)):
            tr = max(
                highs[i] - lows[i],
                abs(highs[i] - closes[i - 1]),
                abs(lows[i] - closes[i - 1]),
            )
            tr_list.append(tr)

        if len(tr_list) < period:
            return None

        # Wilder's smoothing
        atr = sum(tr_list[:period]) / period
        for i in range(period, len(tr_list)):
            atr = (atr * (period - 1) + tr_list[i]) / period

        return atr

    # =========================================================================
    # CCI (Commodity Channel Index)
    # =========================================================================

    def calc_cci(
        self,
        closes: list[float],
        highs: list[float],
        lows: list[float],
        period: int = 20,
    ) -> float | None:
        """Calculate CCI."""
        if len(closes) < period or len(highs) < period or len(lows) < period:
            return None

        # Typical Price
        tp_list = [
            (highs[i] + lows[i] + closes[i]) / 3
            for i in range(len(closes))
        ]

        recent_tp = tp_list[-period:]
        tp_avg = sum(recent_tp) / period

        # Mean Deviation
        mean_dev = sum(abs(tp - tp_avg) for tp in recent_tp) / period

        if mean_dev == 0:
            return 0.0

        cci = (tp_list[-1] - tp_avg) / (0.015 * mean_dev)
        return cci

    # =========================================================================
    # WILLIAMS %R
    # =========================================================================

    def calc_williams_r(
        self,
        closes: list[float],
        highs: list[float],
        lows: list[float],
        period: int = 14,
    ) -> float | None:
        """Calculate Williams %R."""
        if len(closes) < period or len(highs) < period or len(lows) < period:
            return None

        highest = max(highs[-period:])
        lowest = min(lows[-period:])

        if highest - lowest == 0:
            return -50.0

        williams_r = ((highest - closes[-1]) / (highest - lowest)) * -100
        return williams_r

    # =========================================================================
    # SUPPORT & RESISTANCE
    # =========================================================================

    def calc_support_resistance(
        self, closes: list[float]
    ) -> dict[str, float]:
        """Calculate basic support and resistance levels."""
        if len(closes) < 20:
            return {}

        recent = closes[-30:] if len(closes) >= 30 else closes
        current = closes[-1]

        # Einfache Methode: Lokale Min/Max finden
        local_highs = []
        local_lows = []

        for i in range(1, len(recent) - 1):
            if recent[i] > recent[i - 1] and recent[i] > recent[i + 1]:
                local_highs.append(recent[i])
            if recent[i] < recent[i - 1] and recent[i] < recent[i + 1]:
                local_lows.append(recent[i])

        result = {}

        # Support Levels (unter aktuellem Preis)
        supports = sorted(
            [l for l in local_lows if l < current], reverse=True
        )
        if supports:
            result["support_1"] = round(supports[0], 4)
            if len(supports) > 1:
                result["support_2"] = round(supports[1], 4)

        # Resistance Levels (über aktuellem Preis)
        resistances = sorted(
            [h for h in local_highs if h > current]
        )
        if resistances:
            result["resistance_1"] = round(resistances[0], 4)
            if len(resistances) > 1:
                result["resistance_2"] = round(resistances[1], 4)

        return result

    # =========================================================================
    # VOLUME ANALYSIS
    # =========================================================================

    def analyze_volume(self, volumes: list[float]) -> dict[str, Any]:
        """Analyze trading volume patterns."""
        if not volumes or len(volumes) < 5:
            return {}

        volumes = self._clean_list(volumes)
        current = volumes[-1] if volumes else 0

        result = {}

        # Durchschnitte
        if len(volumes) >= 5:
            avg_5d = sum(volumes[-5:]) / 5
            result["avg_5d"] = int(avg_5d)

        if len(volumes) >= 20:
            avg_20d = sum(volumes[-20:]) / 20
            result["avg_20d"] = int(avg_20d)

            # Ratio
            if avg_20d > 0:
                ratio = current / avg_20d
                result["ratio"] = round(ratio, 2)

        # Trend (steigt oder fällt das Volumen)
        if len(volumes) >= 10:
            first_half = sum(volumes[-10:-5]) / 5
            second_half = sum(volumes[-5:]) / 5

            if second_half > first_half * 1.2:
                result["trend"] = "increasing"
            elif second_half < first_half * 0.8:
                result["trend"] = "decreasing"
            else:
                result["trend"] = "stable"

        return result

    # =========================================================================
    # OVERALL SIGNAL
    # =========================================================================

    def get_overall_signal(self, indicators: dict[str, Any]) -> str:
        """Calculate overall buy/hold/sell signal from all indicators."""
        if not indicators:
            return "N/A"

        bull = indicators.get("bullish_count", 0)
        bear = indicators.get("bearish_count", 0)
        total = bull + bear + indicators.get("neutral_count", 0)

        if total == 0:
            return "N/A"

        ratio = (bull - bear) / total if total > 0 else 0

        if ratio > 0.5:
            return SIGNAL_STRONG_BUY
        elif ratio > 0.2:
            return SIGNAL_BUY
        elif ratio < -0.5:
            return SIGNAL_STRONG_SELL
        elif ratio < -0.2:
            return SIGNAL_SELL
        return SIGNAL_HOLD

    # =========================================================================
    # HELPER METHODS
    # =========================================================================

    def calc_sma(self, data: list[float], period: int) -> float | None:
        """Calculate Simple Moving Average."""
        if len(data) < period:
            return None
        return sum(data[-period:]) / period

    def calc_ema(self, data: list[float], period: int) -> float | None:
        """Calculate current EMA value."""
        series = self._calc_ema_series(data, period)
        return series[-1] if series else None

    def _calc_ema_series(
        self, data: list[float], period: int
    ) -> list[float]:
        """Calculate EMA series."""
        if len(data) < period:
            return []

        multiplier = 2.0 / (period + 1)

        # Start mit SMA
        ema = sum(data[:period]) / period
        result = [ema]

        for i in range(period, len(data)):
            ema = (data[i] - ema) * multiplier + ema
            result.append(ema)

        return result

    def _calc_volatility(self, closes: list[float]) -> float:
        """Calculate annualized volatility."""
        if len(closes) < 2:
            return 0.0

        # Daily Returns
        returns = [
            (closes[i] - closes[i - 1]) / closes[i - 1]
            for i in range(1, len(closes))
            if closes[i - 1] != 0
        ]

        if not returns:
            return 0.0

        # Standardabweichung der Returns
        avg_return = sum(returns) / len(returns)
        variance = sum((r - avg_return) ** 2 for r in returns) / len(returns)
        daily_vol = math.sqrt(variance)

        # Annualisiert (252 Handelstage)
        annual_vol = daily_vol * math.sqrt(252) * 100

        return annual_vol

    def _count_signals(
        self, indicators: dict[str, Any], closes: list[float]
    ) -> dict[str, int]:
        """Count bullish, bearish, and neutral signals."""
        bull = 0
        bear = 0
        neutral = 0

        current = closes[-1] if closes else 0

        # RSI
        rsi = indicators.get("rsi_14")
        if rsi is not None:
            if rsi < 30:
                bull += 1
            elif rsi > 70:
                bear += 1
            else:
                neutral += 1

        # MACD
        macd_trend = indicators.get("macd_trend")
        if macd_trend:
            if "bullish" in macd_trend:
                bull += 1
            elif "bearish" in macd_trend:
                bear += 1
            else:
                neutral += 1

        # Stochastic
        stoch_signal = indicators.get("stochastic_signal")
        if stoch_signal:
            if stoch_signal == "oversold":
                bull += 1
            elif stoch_signal == "overbought":
                bear += 1
            else:
                neutral += 1

        # SMA Crossovers
        sma_20 = indicators.get("sma_20")
        sma_50 = indicators.get("sma_50")
        if sma_20 and current:
            if current > sma_20:
                bull += 1
            else:
                bear += 1

        if sma_20 and sma_50:
            if sma_20 > sma_50:
                bull += 1  # Golden Cross Tendenz
            else:
                bear += 1  # Death Cross Tendenz

        # Bollinger
        bb_pos = indicators.get("bollinger_position")
        if bb_pos:
            if bb_pos == "near_lower":
                bull += 1
            elif bb_pos == "near_upper":
                bear += 1
            else:
                neutral += 1

        # CCI
        cci = indicators.get("cci")
        if cci is not None:
            if cci < -100:
                bull += 1
            elif cci > 100:
                bear += 1
            else:
                neutral += 1

        return {
            "bullish_count": bull,
            "bearish_count": bear,
            "neutral_count": neutral,
        }

    @staticmethod
    def _clean_list(data: list | None) -> list[float]:
        """Remove None values and convert to float."""
        if not data:
            return []
        result = []
        last_valid = 0.0
        for v in data:
            if v is not None:
                try:
                    last_valid = float(v)
                    result.append(last_valid)
                except (ValueError, TypeError):
                    result.append(last_valid)
            else:
                result.append(last_valid)
        return result