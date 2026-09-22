# BLZ Flow Alert v2

A self-hosted BLZ whale-flow monitor for Ethereum and BNB Chain.

## New in v2

- Large / major / critical transfer severity levels.
- Rolling 15-minute, 1-hour, 6-hour and 24-hour BLZ flow statistics.
- Net exchange-flow calculation.
- Statistical anomaly score for transfers versus the previous 24 hours of observed activity.
- Persistent state so restarts do not wipe the recent dashboard.
- Exchange-wallet labels using `address|label` syntax.
- Optional immediate Telegram alerts.
- Browser/device notifications and a mobile-friendly PWA dashboard.

## What “exchange inflow” means

The app only calls a transfer an exchange inflow when the destination address is in your verified exchange-address list. Do not add guessed addresses. An inflow is not proof of an imminent sale; it is simply a useful on-chain signal.

## BLZ contracts

- Ethereum: `0x5732046a883704404f284ce41ffadd5b007fd668`
- BNB Smart Chain: `0x935a544bf5816e3a7c13db2efe3009ffda0acda2`

## Run

1. Install Node.js 20+.
2. Copy `.env.example` to `.env`.
3. Add an Etherscan API key.
4. Optionally add independently verified exchange wallets, for example `0xabc...|Coinbase,0xdef...|KuCoin`.
5. Optionally add a Telegram bot token and chat ID.
6. Run `npm install` and then `npm start`.
7. Open `http://localhost:3000`.

For true 24/7 alerts, deploy the server on an always-on host with HTTPS. iPhone browser notifications are subject to iOS/PWA behavior; Telegram is the more reliable immediate-alert path in this version.

## v3 early-move detector

v3 adds a transparent 0–100 **Spike Watch** activity score. It combines:
- 15-minute transfer-volume acceleration versus the rest of the last hour
- number of major/critical whale transfers in the last hour
- statistically unusual transfers
- net exchange inflow/outflow
- 15-minute and 1-hour BLZ price momentum sampled by the app

Levels are Normal, Watch, Elevated, and High. A High transition can trigger a Telegram and browser notification. The score is deliberately an activity detector, not a promise that price will rise and not an automated buy/sell recommendation.

The quality of exchange-flow signals depends on the exchange-address list you configure. Only label wallets whose ownership you have verified.

## v4 — Multi-exchange market pressure

V4 adds public order-book feeds for Coinbase BLZ/USD, Kraken BLZ/USD, KuCoin BLZ/USDT and Gate BLZ/USDT. It calculates bid/ask depth, order-book imbalance, spread and cross-exchange price divergence, then feeds those measurements into Spike Watch.

Binance is intentionally not used as a current BLZ market source because Binance delisted BLZ spot pairs in December 2024. Exchange APIs can change or rate-limit public endpoints; the dashboard marks an unavailable venue rather than treating missing data as a signal.

The score is an activity/market-pressure indicator, not a prediction and not a buy/sell instruction. Thin books can change rapidly and displayed depth can be cancelled before execution.
