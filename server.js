import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

dotenv.config();
const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.json());
// Serve only PWA assets; keep server code, state and configuration private.
for (const asset of ["index.html", "manifest.json", "sw.js", "icon-192.png", "icon-512.png", "apple-touch-icon.png"]) {
  app.get(`/${asset}`, (_req, res) => res.sendFile(path.join(__dirname, asset)));
}

const PORT = Number(process.env.PORT || 3000);
const POLL_SECONDS = Math.max(5, Number(process.env.POLL_SECONDS || 10));
const DEFAULT_THRESHOLD = Number(process.env.DEFAULT_THRESHOLD_BLZ || 100000);
const MAJOR_THRESHOLD = Number(process.env.MAJOR_THRESHOLD_BLZ || 250000);
const CRITICAL_THRESHOLD = Number(process.env.CRITICAL_THRESHOLD_BLZ || 1000000);
const COINGECKO_ID = process.env.COINGECKO_ID || "bluzelle";
const BLZ_CONTRACT_ETH = "0x5732046a883704404f284ce41ffadd5b007fd668";
const BLZ_CONTRACT_BSC = "0x935a544bf5816e3a7c13db2efe3009ffda0acda2";
const STATE_FILE = path.join(__dirname, "state.json");

function parseAddressBook(raw, chain) {
  return String(raw || "").split(",").map(s => s.trim()).filter(Boolean).map(item => {
    const [address, label] = item.split("|");
    return { chain, address: address.toLowerCase(), label: label || "Exchange wallet" };
  });
}
const addressBook = [
  ...parseAddressBook(process.env.ETH_EXCHANGE_ADDRESSES, "eth"),
  ...parseAddressBook(process.env.BSC_EXCHANGE_ADDRESSES, "bsc")
];
const exchangeMap = new Map(addressBook.map(x => [`${x.chain}:${x.address}`, x.label]));

let state = { lastBlock: { eth: 0, bsc: 0 }, recent: [], history: [], stats: {}, priceHistory: [], signal: null, signalHistory: [], updatedAt: null };
try { state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) }; } catch {}
let price = null;
let lastPriceAt = 0;
let marketState = { venues: [], aggregate: null, history: [], updatedAt: null };
let scanPromise = null;
let scanError = null;
let chainHealth = { eth: null, bsc: null };

const MARKET_VENUES = [
  { id:'coinbase', label:'Coinbase', pair:'BLZ-USD', quote:'USD', url:'https://api.exchange.coinbase.com/products/BLZ-USD' },
  { id:'kraken', label:'Kraken', pair:'BLZUSD', quote:'USD', url:'https://api.kraken.com/0/public' },
  { id:'kucoin', label:'KuCoin', pair:'BLZ-USDT', quote:'USDT', url:'https://api.kucoin.com/api/v1' },
  { id:'gate', label:'Gate', pair:'BLZ_USDT', quote:'USDT', url:'https://api.gateio.ws/api/v4' }
];
function safeNum(x){ const n=Number(x); return Number.isFinite(n)?n:0; }
function bookMetrics(bids=[], asks=[], depth=15){
  const b=bids.slice(0,depth).map(x=>[safeNum(x[0]),safeNum(x[1])]).filter(x=>x[0]&&x[1]);
  const a=asks.slice(0,depth).map(x=>[safeNum(x[0]),safeNum(x[1])]).filter(x=>x[0]&&x[1]);
  if(!b.length||!a.length) return {bidDepthUsd:0,askDepthUsd:0,imbalance:0,spreadPct:0,mid:0};
  const bidDepthUsd=b.reduce((z,x)=>z+x[0]*x[1],0), askDepthUsd=a.reduce((z,x)=>z+x[0]*x[1],0);
  const total=bidDepthUsd+askDepthUsd, imbalance=total?(bidDepthUsd-askDepthUsd)/total:0;
  const bestBid=b[0][0], bestAsk=a[0][0], mid=(bestBid+bestAsk)/2;
  return {bidDepthUsd,askDepthUsd,imbalance,spreadPct:mid?((bestAsk-bestBid)/mid)*100:0,mid};
}
async function fetchVenue(v){
  try{
    if(v.id==='coinbase'){
      const [ticker,book]=await Promise.all([axios.get(`${v.url}/ticker`,{timeout:5000}),axios.get(`${v.url}/book?level=2`,{timeout:5000})]);
      const m=bookMetrics(book.data?.bids||[],book.data?.asks||[]); return {...v,ok:true,price:safeNum(ticker.data?.price),volume24h:safeNum(ticker.data?.volume),...m};
    }
    if(v.id==='kraken'){
      const [ticker,book]=await Promise.all([axios.get(`${v.url}/Ticker`,{params:{pair:v.pair},timeout:5000}),axios.get(`${v.url}/Depth`,{params:{pair:v.pair,count:25},timeout:5000})]);
      const t=Object.values(ticker.data?.result||{})[0]||{}, b=Object.values(book.data?.result||{})[0]||{}; const m=bookMetrics(b.bids||[],b.asks||[]);
      return {...v,ok:true,price:safeNum(t.c?.[0]),volume24h:safeNum(t.v?.[1]),...m};
    }
    if(v.id==='kucoin'){
      const [ticker,book]=await Promise.all([axios.get(`${v.url}/market/stats`,{params:{symbol:v.pair},timeout:5000}),axios.get(`${v.url}/market/orderbook/level2_20`,{params:{symbol:v.pair},timeout:5000})]);
      const t=ticker.data?.data||{}, b=book.data?.data||{}; const m=bookMetrics(b.bids||[],b.asks||[]);
      return {...v,ok:true,price:safeNum(t.last),volume24h:safeNum(t.vol),...m};
    }
    if(v.id==='gate'){
      const [ticker,book]=await Promise.all([axios.get(`${v.url}/spot/tickers`,{params:{currency_pair:v.pair},timeout:5000}),axios.get(`${v.url}/spot/order_book`,{params:{currency_pair:v.pair,limit:20},timeout:5000})]);
      const t=ticker.data?.[0]||{}, b=book.data||{}; const m=bookMetrics(b.bids||[],b.asks||[]);
      return {...v,ok:true,price:safeNum(t.last),volume24h:safeNum(t.base_volume),...m};
    }
  }catch(e){ return {...v,ok:false,error:String(e.response?.status||e.code||'unavailable')}; }
  return {...v,ok:false,error:'unsupported'};
}
async function getMarkets(){
  const venues=await Promise.all(MARKET_VENUES.map(fetchVenue)); const live=venues.filter(x=>x.ok&&x.price>0);
  const totalDepth=live.reduce((z,x)=>z+x.bidDepthUsd+x.askDepthUsd,0);
  const imbalance=totalDepth?live.reduce((z,x)=>z+x.imbalance*(x.bidDepthUsd+x.askDepthUsd),0)/totalDepth:0;
  const prices=live.map(x=>x.price), avg=prices.length?prices.reduce((a,b)=>a+b,0)/prices.length:0;
  const divergencePct=avg&&prices.length>1?((Math.max(...prices)-Math.min(...prices))/avg)*100:0;
  const spreadPct=live.length?live.reduce((z,x)=>z+x.spreadPct,0)/live.length:0;
  const aggregate={liveVenues:live.length,totalVenues:venues.length,imbalance,divergencePct,avgSpreadPct:spreadPct,bidDepthUsd:live.reduce((z,x)=>z+x.bidDepthUsd,0),askDepthUsd:live.reduce((z,x)=>z+x.askDepthUsd,0),at:Date.now()};
  marketState={venues,aggregate,history:[...(marketState.history||[]),aggregate].filter(x=>Date.now()-x.at<=24*60*60e3).slice(-2000),updatedAt:Date.now()};
  return marketState;
}
function marketMomentum(){
  const h=marketState.history||[], now=Date.now();
  const cur=h[h.length-1]; if(!cur) return {imbalance:0,depthAcceleration:1};
  const old=h.find(x=>now-x.at>=15*60e3) || h[0];
  const curDepth=(cur.bidDepthUsd||0)+(cur.askDepthUsd||0), oldDepth=(old?.bidDepthUsd||0)+(old?.askDepthUsd||0);
  return {imbalance:cur.imbalance||0,depthAcceleration:oldDepth?curDepth/oldDepth:1};
}

function saveState() {
  state.updatedAt = Date.now();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}
function exchangeLabel(chain, address) { return exchangeMap.get(`${chain}:${String(address).toLowerCase()}`) || null; }
function severity(amount, exchangeInflow, anomalyScore) {
  if (amount >= CRITICAL_THRESHOLD || (exchangeInflow && amount >= MAJOR_THRESHOLD) || anomalyScore >= 6) return "critical";
  if (amount >= MAJOR_THRESHOLD || exchangeInflow || anomalyScore >= 3) return "major";
  return "large";
}
function computeStats() {
  const now = Date.now();
  const windows = { m15: 15*60e3, h1: 60*60e3, h6: 6*60*60e3, h24: 24*60*60e3 };
  const out = {};
  for (const [name, ms] of Object.entries(windows)) {
    const rows = state.history.filter(x => now - x.time <= ms);
    const inflows = rows.filter(x => x.exchangeInflow);
    const outflows = rows.filter(x => x.exchangeOutflow);
    out[name] = {
      transfers: rows.length,
      volume: rows.reduce((a,x)=>a+x.amount,0),
      exchangeInflow: inflows.reduce((a,x)=>a+x.amount,0),
      exchangeOutflow: outflows.reduce((a,x)=>a+x.amount,0),
      netExchangeFlow: inflows.reduce((a,x)=>a+x.amount,0)-outflows.reduce((a,x)=>a+x.amount,0)
    };
  }
  state.stats = out;
  return out;
}
function anomalyScore(amount) {
  const cutoff = Date.now() - 24*60*60e3;
  const vals = state.history.filter(x => x.time >= cutoff).map(x => x.amount).filter(Number.isFinite);
  if (vals.length < 10) return 0;
  const mean = vals.reduce((a,b)=>a+b,0)/vals.length;
  const variance = vals.reduce((a,b)=>a+(b-mean)**2,0)/vals.length;
  const sd = Math.sqrt(variance);
  return sd ? Math.max(0,(amount-mean)/sd) : 0;
}


function pctMove(ms) {
  const rows=(state.priceHistory||[]).filter(x=>Date.now()-x.at<=ms && Number.isFinite(x.usd));
  if(rows.length<2) return 0;
  const a=rows[0].usd,b=rows[rows.length-1].usd; return a ? ((b-a)/a)*100 : 0;
}
function flowAcceleration() {
  const s=state.stats||{};
  const v15=s.m15?.volume||0, v1=s.h1?.volume||0;
  const priorHourly=Math.max(1,(v1-v15)/0.75);
  return (v15*4)/priorHourly;
}
function computeSignal() {
  const s=computeStats(), h1=s.h1||{}, h24=s.h24||{}, m15=s.m15||{};
  const accel=flowAcceleration(), p15=pctMove(15*60e3), p60=pctMove(60*60e3);
  const recent=(state.history||[]).filter(x=>Date.now()-x.time<=60*60e3);
  const major=recent.filter(x=>x.severity==='major'||x.severity==='critical').length;
  const anomalous=recent.filter(x=>(x.anomalyScore||0)>=3).length;
  const inflowRatio=h1.volume ? h1.exchangeInflow/h1.volume : 0;
  const outflowRatio=h1.volume ? h1.exchangeOutflow/h1.volume : 0;
  let score=0; const reasons=[];
  if(accel>=2){score+=20;reasons.push(`transfer activity ${accel.toFixed(1)}× recent pace`)}
  if(accel>=4) score+=10;
  if(major>=2){score+=15;reasons.push(`${major} major/critical transfers in 1h`)}
  if(anomalous>=2){score+=15;reasons.push(`${anomalous} statistically unusual transfers in 1h`)}
  if(h1.netExchangeFlow<0 && outflowRatio>=0.25){score+=15;reasons.push(`net exchange outflow ${Math.round(Math.abs(h1.netExchangeFlow)).toLocaleString()} BLZ`)}
  if(h1.netExchangeFlow>0 && inflowRatio>=0.25){score-=10;reasons.push(`net exchange inflow ${Math.round(h1.netExchangeFlow).toLocaleString()} BLZ`)}
  if(p15>=2){score+=15;reasons.push(`price +${p15.toFixed(1)}% in 15m`)}
  if(p60>=5){score+=15;reasons.push(`price +${p60.toFixed(1)}% in 1h`)}
  if(p15<=-2){score-=10;reasons.push(`price ${p15.toFixed(1)}% in 15m`)}
  const mm=marketMomentum(), ma=marketState.aggregate||{};
  if(ma.liveVenues>=2 && mm.imbalance>=0.20){score+=15;reasons.push(`buy-side order-book imbalance +${(mm.imbalance*100).toFixed(0)}% across ${ma.liveVenues} venues`)}
  if(ma.liveVenues>=2 && mm.imbalance<=-0.20){score-=10;reasons.push(`sell-side order-book imbalance ${(mm.imbalance*100).toFixed(0)}%`)}
  if(ma.divergencePct>=2){score+=10;reasons.push(`cross-exchange price divergence ${ma.divergencePct.toFixed(1)}%`)}
  if(ma.avgSpreadPct>=2){reasons.push(`thin liquidity: average spread ${ma.avgSpreadPct.toFixed(1)}%`)}
  score=Math.max(0,Math.min(100,score));
  const level=score>=70?'high':score>=45?'elevated':score>=25?'watch':'normal';
  const signal={score,level,reasons:reasons.slice(0,5),metrics:{flowAcceleration:accel,price15m:p15,price1h:p60,majorTransfers1h:major,anomalies1h:anomalous,netExchangeFlow1h:h1.netExchangeFlow||0,orderBookImbalance:(marketState.aggregate?.imbalance||0),priceDivergencePct:(marketState.aggregate?.divergencePct||0),liveVenues:(marketState.aggregate?.liveVenues||0)},at:Date.now()};
  const prev=state.signal; state.signal=signal;
  if(!prev || prev.level!==level || Math.abs(prev.score-score)>=15) state.signalHistory=[signal,...(state.signalHistory||[])].slice(0,100);
  return signal;
}

async function getPrice() {
  try {
    const r = await axios.get("https://api.coingecko.com/api/v3/simple/price", { params: { ids: COINGECKO_ID, vs_currencies: "usd,aud", include_24hr_change: "true" }, timeout: 7000 });
    const p = r.data?.[COINGECKO_ID];
    if (p) {
      price = { usd: p.usd, aud: p.aud, change24h: p.usd_24h_change, at: Date.now() };
      state.priceHistory = [...(state.priceHistory||[]), price].filter(x => Date.now()-x.at <= 24*60*60e3).slice(-1000);
    }
  } catch {}
  lastPriceAt = Date.now();
  return price;
}
async function getLatestBlock(chain) {
  if (!process.env.ETHERSCAN_API_KEY) return 0;
  try {
    const chainid = chain === "eth" ? 1 : 56;
    const r = await axios.get("https://api.etherscan.io/v2/api", { params: { chainid, module: "proxy", action: "eth_blockNumber", apikey: process.env.ETHERSCAN_API_KEY }, timeout: 6000 });
    return parseInt(r.data?.result || "0x0", 16);
  } catch { return 0; }
}
async function scanEvm(chain, startBlock) {
  if (!process.env.ETHERSCAN_API_KEY) return { events: [], latest: startBlock };
  const chainid = chain === "eth" ? 1 : 56;
  const contract = chain === "eth" ? BLZ_CONTRACT_ETH : BLZ_CONTRACT_BSC;
  try {
    const r = await axios.get("https://api.etherscan.io/v2/api", { params: { chainid, module: "account", action: "tokentx", contractaddress: contract, startblock: Math.max(0,startBlock), endblock: 999999999, page: 1, offset: 100, sort: "asc", apikey: process.env.ETHERSCAN_API_KEY }, timeout: 8000 });
    if (!Array.isArray(r.data?.result)) {
      if (String(r.data?.message || '').toLowerCase().includes('no transactions')) return { events: [], latest: startBlock, ok: true };
      throw new Error(String(r.data?.result || r.data?.message || 'Explorer unavailable').slice(0, 120));
    }
    const events = r.data.result.map(x => {
      const amount = Number(x.value) / 10 ** Number(x.tokenDecimal || 18);
      const to = String(x.to).toLowerCase(), from = String(x.from).toLowerCase();
      const toExchange = exchangeLabel(chain,to), fromExchange = exchangeLabel(chain,from);
      return { chain, hash:x.hash, logIndex:String(x.logIndex ?? x.transactionIndex ?? '0'), block:Number(x.blockNumber), time:Number(x.timeStamp)*1000, from,to,amount,
        exchangeInflow:Boolean(toExchange), exchangeOutflow:Boolean(fromExchange), exchangeName:toExchange||fromExchange||null,
        url: chain === "eth" ? `https://etherscan.io/tx/${x.hash}` : `https://bscscan.com/tx/${x.hash}` };
    });
    // Advance within a block only when the next block is known to be outside the page.
    // Re-reading the last block is safe because ingest deduplicates transaction logs.
    return { events, latest: events.length ? Math.max(...events.map(e=>e.block)) : startBlock, ok: true, pageFull: events.length === 100 };
  } catch (e) { return { events: [], latest:startBlock, ok: false, error: e.message }; }
}
async function sendTelegram(e) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return;
  const kind = e.exchangeInflow ? `EXCHANGE INFLOW${e.exchangeName ? ` → ${e.exchangeName}` : ""}` : e.exchangeOutflow ? `EXCHANGE OUTFLOW${e.exchangeName ? ` ← ${e.exchangeName}` : ""}` : "LARGE TRANSFER";
  const aud = price?.aud ? ` (~A$${Math.round(e.amount*price.aud).toLocaleString()})` : "";
  const text = `🚨 BLZ ${e.severity.toUpperCase()}\n${kind}\n${Math.round(e.amount).toLocaleString()} BLZ${aud}\n${e.chain.toUpperCase()} • anomaly ${e.anomalyScore.toFixed(1)}σ\n${e.url}`;
  try { await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, { chat_id:process.env.TELEGRAM_CHAT_ID, text, disable_web_page_preview:true }, { timeout:6000 }); } catch {}
}
function ingest(events) {
  const alerts=[];
  for (const e of events) {
    if (state.history.some(x=>x.hash===e.hash && x.chain===e.chain && x.logIndex===e.logIndex)) continue;
    const score=anomalyScore(e.amount); e.anomalyScore=score;
    e.severity=severity(e.amount,e.exchangeInflow,score);
    state.history.unshift(e);
    if (e.amount >= DEFAULT_THRESHOLD || e.exchangeInflow || e.exchangeOutflow || score >= 3) { state.recent.unshift(e); alerts.push(e); }
  }
  state.history=state.history.filter(x=>Date.now()-x.time<=7*24*60*60e3).slice(0,5000);
  state.recent=state.recent.slice(0,150); computeStats(); computeSignal(); saveState();
  return alerts;
}
async function scanOnce() {
  if (!state.lastBlock.eth) state.lastBlock.eth=Math.max(0,(await getLatestBlock("eth"))-2);
  if (String(process.env.WATCH_BSC).toLowerCase()==="true" && !state.lastBlock.bsc) state.lastBlock.bsc=Math.max(0,(await getLatestBlock("bsc"))-2);
  const alerts=[];
  for (const chain of ["eth", ...(String(process.env.WATCH_BSC).toLowerCase()==="true"?["bsc"]:[])]) {
    const r=await scanEvm(chain,state.lastBlock[chain]);
    chainHealth[chain] = r.ok ? { ok:true, at:Date.now(), pageFull: r.pageFull || false } : { ok:false, error:r.error, at:Date.now() };
    if (r.ok) { state.lastBlock[chain]=r.latest; alerts.push(...ingest(r.events)); }
  }
  if (!price || Date.now()-lastPriceAt>30000) await getPrice();
  await getMarkets();
  const previousLevel=state.signal?.level;
  const sig=computeSignal();
  if (sig.level === "high" && previousLevel !== "high" && process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    const text=`⚡ BLZ SPIKE WATCH: HIGH (${sig.score}/100)\n${sig.reasons.map(x=>'• '+x).join('\n')}\nSignal only — not a buy/sell recommendation.`;
    try { await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {chat_id:process.env.TELEGRAM_CHAT_ID,text}, {timeout:6000}); } catch {}
  }
  for (const e of alerts) await sendTelegram(e);
  saveState();
  scanError = null;
  return alerts;
}
function scan() {
  if (!scanPromise) scanPromise = scanOnce().catch(e => { scanError = e.message; throw e; }).finally(() => { scanPromise = null; });
  return scanPromise;
}

app.get("/api/status", async (_req,res)=>{ if(!price||Date.now()-lastPriceAt>30000) await getPrice(); res.set('Cache-Control','no-store'); res.json({ok:true,price,pollSeconds:POLL_SECONDS,thresholds:{large:DEFAULT_THRESHOLD,major:MAJOR_THRESHOLD,critical:CRITICAL_THRESHOLD},exchangeWallets:addressBook.length,stats:computeStats(),signal:computeSignal(),lastBlocks:state.lastBlock,updatedAt:state.updatedAt,telegramConfigured:Boolean(process.env.TELEGRAM_BOT_TOKEN&&process.env.TELEGRAM_CHAT_ID),markets:marketState.aggregate,chainHealth,scanError,monitoringConfigured:Boolean(process.env.ETHERSCAN_API_KEY)}); });
app.get("/api/events", (_req,res)=>res.json({events:state.recent}));
app.get("/api/markets", async (_req,res)=>{ if(!marketState.updatedAt||Date.now()-marketState.updatedAt>15000) await getMarkets(); res.json(marketState); });
app.get("/api/signal", (_req,res)=>res.json({signal:computeSignal(),history:state.signalHistory||[]}));
app.post("/api/scan", (_req,res)=>res.status(405).json({error:'Scanning runs on the server; refresh /api/status for results.'}));
app.get("*", (_req,res)=>res.sendFile(path.join(__dirname,"index.html")));

setInterval(()=>scan().catch(()=>{}),POLL_SECONDS*1000); scan().catch(()=>{});
app.listen(PORT,()=>console.log(`BLZ Flow Alert running on http://localhost:${PORT}`));
