# BLZ Flow Alert v9

## Digital Surge BLZ/AUD alerts

The dashboard now reads Digital Surge's public BLZ ticker (no API key). It shows the indicative AUD buy and sell quotes separately. The sell quote is checked about once a minute; alerts fire when it moves at least 5% over a fully observed hour or 10% versus the ticker's 24-hour reference. The existing `MOVE_1H_PCT` and `MOVE_24H_PCT` settings apply. Telegram delivers alerts in the background when already configured.

Optional: set `DS_BLZ_SELL_TARGET_AUD` in Render's environment variables to an AUD price per BLZ, such as `0.025`. The app sends one alert when the indicative sell quote reaches or exceeds that target, then rearms after it falls more than 0.5% below it. Leave it unset to watch percentage moves only. This does not place an order. Quotes are indicative and may differ from an executed sale, especially in a fast move.

Digital Surge's public ticker provides prices, not its order book or identifiable deposit-wallet flows. The Digital Surge feed is separate from the exchange-pressure score. If its API is unavailable, the dashboard marks the feed unavailable and does not generate Digital Surge alerts from old prices.

## DOGE and ADA price alerts

The current build adds Dogecoin and Cardano price cards and movement alerts. The server checks CoinGecko about once per minute. It records a move when either coin changes at least 5% over a fully observed hour or 10% over CoinGecko's 24-hour window. A six-hour cooldown and threshold reset prevent repeated alerts for one continuing move. Set `MOVE_1H_PCT` and `MOVE_24H_PCT` as Render environment variables to change the defaults. Existing Telegram settings deliver these alerts while the app is closed; browser notifications work only while open. The DOGE and ADA cards show USD and AUD quotes. One-hour comparison starts after the server collects an hour of prices.

DOGE and ADA alerts use price data. BLZ retains its existing blockchain flow, order-book and Spike Watch features. A price move alone does not establish its cause. The free price feed can lag or be rate limited, and an idle server cannot deliver immediate alerts.

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
3. The public blockchain feeds work without an API key. You can optionally set `ETH_RPC_URL` and `BSC_RPC_URL` to use another RPC provider.
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


# iPhone Home Screen edition

This build is a Progressive Web App (PWA). Once it is deployed to an HTTPS address:

1. Open that address in Safari on the iPhone.
2. Tap Share.
3. Tap Add to Home Screen.
4. Tap Add.
5. Launch BLZ Alert from the new Home Screen icon.
6. Use the in-app notification control to grant notifications where supported.

The server must remain online for continuous market/on-chain monitoring. The included `render.yaml` and `Dockerfile` make cloud deployment straightforward.

## Production checklist
- The default public Ethereum and BNB Chain RPC feeds require no API key.
- Configure Telegram for reliable background alerts if desired.
- Configure verified exchange/deposit addresses for exchange-flow classification.
- Keep API secrets in hosting environment variables, never in `public/`.
- Use an HTTPS deployment.

## v6 reliability update

The server owns blockchain scanning; opening several dashboards no longer starts several scans. The dashboard reads status, events and markets concurrently, shows the time of the last successful Ethereum check and reports feed errors. Browser alerts operate only while the app is open; use Telegram for background delivery.

## v7 no-key monitoring

V7 reads BLZ transfers from public Ethereum and BNB Chain RPC feeds, so the dashboard no longer displays “setup needed” when no Etherscan key exists. Telegram remains optional. The dashboard shows “live” after its first successful Ethereum scan and reports when it is catching up.

## GitHub upload layout

This edition is arranged for the existing BLZ-Flow-Alert repository: upload the files in this folder into the repository root. All PWA assets sit alongside server.js. GitHub's upload page should show server.js, package.json, index.html and the other assets at the top level before committing. Do not upload the ZIP itself as the app deployment.
