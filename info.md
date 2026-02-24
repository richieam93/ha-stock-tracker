# 📊 Stock Tracker

Track stocks, ETFs, and cryptocurrencies directly in Home Assistant!

## ✨ Features

| Feature | Description |
|---------|-------------|
| 📈 Real-time Stock Prices | Track any stock from NASDAQ, NYSE, XETRA, and more |
| 🪙 Cryptocurrencies | Bitcoin, Ethereum, and 500+ other coins |
| 📊 Technical Indicators | RSI, MACD, Bollinger Bands, Stochastic, ADX |
| 🔮 Trend Analysis | Automatic trend detection with strength indicator |
| 🔍 Smart Search | Search by company name or symbol |
| 🔔 Automations | Price alerts, RSI signals, trend changes |
| 🎨 Custom Card | Beautiful Lovelace card included |
| 🌍 Multi-Language | English & German |
| 🔄 Auto-Update | New stocks available automatically |
| 🔑 No API Key | Works out of the box! |

## 🚀 Quick Start

1. Install via HACS
2. Restart Home Assistant
3. Add the integration: Settings → Devices & Services → Add Integration → Stock Tracker
4. Enter your stock symbols (e.g., `AAPL, MSFT, SAP.DE, BTC-USD`)
5. Use the custom card in your dashboards!

## 📊 Example Card

```yaml
type: custom:stock-tracker-card
entity: sensor.aapl_price
display_mode: compact
show_indicators: true
```

## 🔗 Links

- [📖 Documentation](https://github.com/richieam93/ha-stock-tracker)
- [🐛 Report Issues](https://github.com/richieam93/ha-stock-tracker/issues)
- [💬 Discussions](https://github.com/richieam93/ha-stock-tracker/discussions)

---

<a href="https://www.buymeacoffee.com/geartec" target="_blank">
  <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="40">
</a>