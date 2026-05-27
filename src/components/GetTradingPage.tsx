import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  cancelOrder,
  closePosition,
  getClock,
  getAccount,
  getBars,
  getSnapshots,
  listOrders,
  listPositions,
  placeOrder,
} from '../lib/alpaca';
import type {
  AlpacaAccount,
  AlpacaBar,
  AlpacaEnv,
  AlpacaOrder,
  AlpacaPosition,
  AlpacaSnapshot,
  AlpacaTimeframe,
  OrderSide,
  OrderType,
  TimeInForce,
} from '../lib/alpaca';
import CandleChart from './CandleChart';

const ENV_KEY = 'gettrading.env';
const WATCHLIST_KEY = 'gettrading.watchlist';
const WATCHLIST_VERSION_KEY = 'gettrading.watchlistDefaultsVersion';
// Bump this whenever DEFAULT_WATCHLIST gets new symbols so existing users
// get the additions merged in on next load.
const WATCHLIST_DEFAULTS_VERSION = '4';
const CHART_SYMBOL_KEY = 'gettrading.chartSymbol';
const CHART_RANGE_KEY = 'gettrading.chartRange';
const COLLAPSED_KEY = 'gettrading.collapsed';

const DEFAULT_WATCHLIST = [
  // Mega-cap tech
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA',
  // Momentum / high-volume movers
  'AMD', 'AVGO', 'NFLX', 'COIN', 'MSTR', 'PLTR', 'SMCI',
  // Indices / ETFs
  'SPY', 'QQQ', 'IWM',
  // Leveraged ETFs (high movement)
  'TQQQ', 'SQQQ',
  // Banks & misc movers
  'JPM', 'GS',
  // Retail-favorite / meme
  'GME', 'AMC', 'SOFI', 'UBER',
  // Most fluid US large-caps (highest dollar-volume)
  'LLY', 'UNH', 'V', 'MA', 'HD', 'COST', 'WMT',
  'XOM', 'CVX', 'BAC', 'WFC',
  'DIS', 'ABBV', 'ORCL', 'CRM',
  'INTC', 'MU', 'QCOM', 'SNOW', 'SHOP',
  // +30: Chinese ADRs, EVs, miners, healthcare, consumer staples, semis,
  // SaaS, sector ETFs
  'TSM', 'BABA', 'BIDU', 'NIO', 'RIVN',
  'F', 'GM',
  'HOOD', 'RIOT', 'MARA',
  'PFE', 'MRK', 'JNJ',
  'SBUX', 'MCD', 'NKE', 'KO', 'PEP',
  'AMAT', 'ASML', 'LRCX',
  'CRWD', 'NET', 'DDOG',
  'ARKK', 'DIA', 'XLE', 'XLF', 'GLD', 'TLT',
  // +50 next batch: more sector ETFs, fintech/SaaS, recent IPOs, crypto-adj,
  // cannabis, regional ETFs, vol products, energy, banks, megacaps not yet
  // covered.
  'XLU', 'XLI', 'XLY', 'XLP', 'XLV', 'XLB', 'XBI', 'SMH', 'SOXX', 'KWEB',
  'EWZ', 'EEM', 'VXX', 'UVXY',
  'SQ', 'PYPL', 'ROKU', 'DKNG', 'ABNB', 'ZM', 'TTD', 'DOCU', 'PINS', 'SNAP',
  'LYFT', 'DASH', 'CVNA', 'AFRM', 'UPST',
  'CLSK', 'CIFR', 'BITF', 'WULF', 'GBTC', 'BITO',
  'TLRY', 'CGC',
  'BIIB', 'VRTX',
  'OXY', 'USO',
  'C', 'MS', 'AXP', 'SCHW',
  'ADBE', 'TXN', 'CSCO', 'VZ', 'T', 'TMUS',
];

const MAX_WATCHLIST = 150;

type ChartRange = '1D' | '5D' | '1H' | '1Mo' | '1Y' | '5Y';

const RANGE_ORDER: ChartRange[] = ['1D', '5D', '1H', '1Mo', '1Y', '5Y'];

const RANGE_CONFIG: Record<
  ChartRange,
  { timeframe: AlpacaTimeframe; lookbackDays: number; intraday: boolean; label: string }
> = {
  '1D': { timeframe: '5Min', lookbackDays: 2, intraday: true, label: '1 day (5-min bars)' },
  '5D': { timeframe: '15Min', lookbackDays: 8, intraday: true, label: '5 days (15-min bars)' },
  '1H': { timeframe: '1Hour', lookbackDays: 30, intraday: true, label: '1-hour bars · 30 days' },
  '1Mo': { timeframe: '1Day', lookbackDays: 35, intraday: false, label: '1 month (daily)' },
  '1Y': { timeframe: '1Day', lookbackDays: 400, intraday: false, label: '1 year (daily)' },
  '5Y': { timeframe: '1Week', lookbackDays: 1900, intraday: false, label: '5 years (weekly)' },
};

const SL_PCT_KEY = 'gettrading.defaultStopLossPct';
const TP_PCT_KEY = 'gettrading.defaultTakeProfitPct';
const SIGNAL_SETTINGS_KEY = 'gettrading.signalSettings';
const SIGNAL_NOTIFY_KEY = 'gettrading.signalNotify';
const SIGNAL_COOLDOWN_MS = 5 * 60 * 1000;
const SIGNAL_MAX = 50;

interface SignalSettings {
  bigMoverPct: number;
  positionPnlPct: number;
}

type SignalSeverity = 'normal' | 'high';

interface Signal {
  id: string;
  ts: number;
  symbol: string;
  type: 'bigmover' | 'position';
  message: string;
  severity: SignalSeverity;
}

function readSignalSettings(): SignalSettings {
  if (typeof window === 'undefined') return { bigMoverPct: 3, positionPnlPct: 5 };
  try {
    const raw = localStorage.getItem(SIGNAL_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SignalSettings>;
      return {
        bigMoverPct:
          typeof parsed.bigMoverPct === 'number' && parsed.bigMoverPct > 0
            ? parsed.bigMoverPct
            : 3,
        positionPnlPct:
          typeof parsed.positionPnlPct === 'number' && parsed.positionPnlPct > 0
            ? parsed.positionPnlPct
            : 5,
      };
    }
  } catch {
    // ignore
  }
  return { bigMoverPct: 3, positionPnlPct: 5 };
}

function readPct(key: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback;
  const raw = localStorage.getItem(key);
  const v = raw == null ? NaN : parseFloat(raw);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function readEnv(): AlpacaEnv {
  if (typeof window === 'undefined') return 'paper';
  return localStorage.getItem(ENV_KEY) === 'live' ? 'live' : 'paper';
}

function readWatchlist(): string[] {
  if (typeof window === 'undefined') return DEFAULT_WATCHLIST;
  let stored: string[] | null = null;
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        stored = parsed.map((s) => String(s).toUpperCase());
      }
    }
  } catch {
    // ignore
  }
  const storedVersion = localStorage.getItem(WATCHLIST_VERSION_KEY);

  // Fresh install: take the defaults wholesale.
  if (!stored) {
    localStorage.setItem(WATCHLIST_VERSION_KEY, WATCHLIST_DEFAULTS_VERSION);
    return DEFAULT_WATCHLIST;
  }

  // Existing user on an older defaults version: merge new defaults in
  // (preserving any symbols they added themselves).
  if (storedVersion !== WATCHLIST_DEFAULTS_VERSION) {
    const merged = [...stored];
    for (const sym of DEFAULT_WATCHLIST) {
      if (!merged.includes(sym)) merged.push(sym);
    }
    localStorage.setItem(WATCHLIST_VERSION_KEY, WATCHLIST_DEFAULTS_VERSION);
    return merged;
  }

  return stored.length > 0 ? stored : DEFAULT_WATCHLIST;
}

function readCollapsed(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    if (raw) return JSON.parse(raw) as Record<string, boolean>;
  } catch {
    // ignore
  }
  return {};
}

function readChartRange(): ChartRange {
  if (typeof window === 'undefined') return '1D';
  const v = localStorage.getItem(CHART_RANGE_KEY);
  return (RANGE_ORDER as string[]).includes(v ?? '') ? (v as ChartRange) : '1D';
}

function fmtMoney(n: number | string | null | undefined, currency = 'USD') {
  if (n === null || n === undefined || n === '') return '—';
  const v = typeof n === 'string' ? parseFloat(n) : n;
  if (!Number.isFinite(v)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(v);
}

function fmtPct(n: number | string | null | undefined) {
  if (n === null || n === undefined || n === '') return '—';
  const v = typeof n === 'string' ? parseFloat(n) : n;
  if (!Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(2)}%`;
}

function fmtNum(n: number | string | null | undefined, digits = 2) {
  if (n === null || n === undefined || n === '') return '—';
  const v = typeof n === 'string' ? parseFloat(n) : n;
  if (!Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}

export default function GetTradingPage() {
  const [env, setEnv] = useState<AlpacaEnv>(readEnv);
  const [account, setAccount] = useState<AlpacaAccount | null>(null);
  const [positions, setPositions] = useState<AlpacaPosition[]>([]);
  const [orders, setOrders] = useState<AlpacaOrder[]>([]);
  const [watchlist, setWatchlist] = useState<string[]>(readWatchlist);
  const [snapshots, setSnapshots] = useState<Record<string, AlpacaSnapshot>>({});
  const [selectedSymbol, setSelectedSymbol] = useState<string>(
    () => localStorage.getItem(CHART_SYMBOL_KEY) ?? readWatchlist()[0] ?? 'AAPL',
  );
  const [chartRange, setChartRange] = useState<ChartRange>(readChartRange);
  const [defaultSlPct, setDefaultSlPct] = useState<number>(() => readPct(SL_PCT_KEY, 5));
  const [defaultTpPct, setDefaultTpPct] = useState<number>(() => readPct(TP_PCT_KEY, 10));
  const [signalSettings, setSignalSettings] = useState<SignalSettings>(readSignalSettings);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [notifyEnabled, setNotifyEnabled] = useState<boolean>(() =>
    typeof window === 'undefined'
      ? false
      : localStorage.getItem(SIGNAL_NOTIFY_KEY) === '1',
  );
  const signalCooldownRef = useRef<Record<string, number>>({});
  const [bars, setBars] = useState<AlpacaBar[]>([]);
  const [barsLoading, setBarsLoading] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(readCollapsed);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  useEffect(() => {
    localStorage.setItem(ENV_KEY, env);
  }, [env]);

  useEffect(() => {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist));
  }, [watchlist]);

  useEffect(() => {
    localStorage.setItem(CHART_SYMBOL_KEY, selectedSymbol);
  }, [selectedSymbol]);

  useEffect(() => {
    localStorage.setItem(CHART_RANGE_KEY, chartRange);
  }, [chartRange]);

  useEffect(() => {
    localStorage.setItem(SL_PCT_KEY, String(defaultSlPct));
  }, [defaultSlPct]);

  useEffect(() => {
    localStorage.setItem(TP_PCT_KEY, String(defaultTpPct));
  }, [defaultTpPct]);

  useEffect(() => {
    localStorage.setItem(SIGNAL_SETTINGS_KEY, JSON.stringify(signalSettings));
  }, [signalSettings]);

  useEffect(() => {
    localStorage.setItem(SIGNAL_NOTIFY_KEY, notifyEnabled ? '1' : '0');
  }, [notifyEnabled]);

  // Detect signals whenever snapshots or positions update. Per (symbol,type)
  // cooldown keeps the same condition from spamming the feed.
  useEffect(() => {
    if (Object.keys(snapshots).length === 0) return;
    const now = Date.now();
    const fired: Signal[] = [];
    const fire = (key: string, s: Omit<Signal, 'id' | 'ts'>) => {
      const last = signalCooldownRef.current[key] ?? 0;
      if (now - last < SIGNAL_COOLDOWN_MS) return;
      signalCooldownRef.current[key] = now;
      fired.push({ ...s, id: `${key}:${now}`, ts: now });
    };

    for (const sym of watchlist) {
      const snap = snapshots[sym];
      if (!snap || !Number.isFinite(snap.changePct)) continue;
      const pct = snap.changePct * 100;
      if (Math.abs(pct) >= signalSettings.bigMoverPct) {
        fire(`${sym}:bigmover`, {
          symbol: sym,
          type: 'bigmover',
          severity: Math.abs(pct) >= signalSettings.bigMoverPct * 2 ? 'high' : 'normal',
          message: `${sym} ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}% today (${fmtMoney(snap.last)})`,
        });
      }
    }

    for (const pos of positions) {
      const plpc = parseFloat(pos.unrealized_plpc) * 100;
      const pl = parseFloat(pos.unrealized_pl);
      if (!Number.isFinite(plpc)) continue;
      if (Math.abs(plpc) >= signalSettings.positionPnlPct) {
        fire(`${pos.symbol}:position`, {
          symbol: pos.symbol,
          type: 'position',
          severity: Math.abs(plpc) >= signalSettings.positionPnlPct * 2 ? 'high' : 'normal',
          message: `${pos.symbol} position ${plpc >= 0 ? '+' : ''}${plpc.toFixed(2)}% (${pl >= 0 ? '+' : ''}${fmtMoney(pl)})`,
        });
      }
    }

    if (fired.length > 0) {
      setSignals((prev) => [...fired, ...prev].slice(0, SIGNAL_MAX));
      if (notifyEnabled && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        for (const s of fired) {
          new Notification(`GetTrading: ${s.symbol}`, { body: s.message });
        }
      }
    }
  }, [snapshots, positions, watchlist, signalSettings, notifyEnabled]);

  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed));
  }, [collapsed]);

  const toggleCollapsed = useCallback((key: string) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const refreshAccountState = useCallback(async () => {
    try {
      const [acct, pos, ord] = await Promise.all([
        getAccount(env),
        listPositions(env),
        listOrders(env, 'all', 500),
      ]);
      setAccount(acct);
      setPositions(pos);
      setOrders(ord);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [env]);

  const refreshSnapshots = useCallback(async () => {
    const symbols = Array.from(
      new Set([...watchlist, ...positions.map((p) => p.symbol), selectedSymbol]),
    ).filter(Boolean);
    if (symbols.length === 0) return;
    try {
      const snaps = await getSnapshots(env, symbols);
      setSnapshots(snaps);
    } catch {
      // non-fatal: keep showing stale data
    }
  }, [env, watchlist, positions, selectedSymbol]);

  const refreshBars = useCallback(async () => {
    if (!selectedSymbol) return;
    setBarsLoading(true);
    try {
      const { timeframe, lookbackDays } = RANGE_CONFIG[chartRange];
      const b = await getBars(env, selectedSymbol, timeframe, lookbackDays);
      setBars(b);
    } catch (e) {
      setError((e as Error).message);
      setBars([]);
    } finally {
      setBarsLoading(false);
    }
  }, [env, selectedSymbol, chartRange]);

  useEffect(() => {
    refreshAccountState();
    const id = setInterval(refreshAccountState, 15_000);
    return () => clearInterval(id);
  }, [refreshAccountState]);

  useEffect(() => {
    refreshSnapshots();
    const id = setInterval(refreshSnapshots, 6_000);
    return () => clearInterval(id);
  }, [refreshSnapshots]);

  useEffect(() => {
    refreshBars();
  }, [refreshBars]);

  const notify = useCallback((kind: 'ok' | 'err', msg: string) => {
    setToast({ kind, msg });
    // Errors stick around longer so brief failures (e.g. "fractional
    // orders cannot be sold short") aren't missed.
    setTimeout(() => setToast(null), kind === 'err' ? 8000 : 4000);
  }, []);

  const enableNotifications = useCallback(async () => {
    if (typeof Notification === 'undefined') {
      notify('err', 'This browser does not support notifications.');
      return;
    }
    if (Notification.permission === 'granted') {
      setNotifyEnabled(true);
      return;
    }
    const result = await Notification.requestPermission();
    if (result === 'granted') {
      setNotifyEnabled(true);
      notify('ok', 'Browser notifications enabled.');
    } else {
      notify('err', 'Notification permission denied. Check browser settings.');
    }
  }, [notify]);

  const handlePlaceOrder = useCallback(
    async (input: Parameters<typeof placeOrder>[1]) => {
      setBusy(true);
      try {
        const o = await placeOrder(env, input);
        notify(
          'ok',
          `${o.side.toUpperCase()} ${o.qty ?? ''} ${o.symbol} submitted (${o.status})`,
        );
        await refreshAccountState();
        await refreshSnapshots();
      } catch (e) {
        notify('err', (e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [env, notify, refreshAccountState, refreshSnapshots],
  );

  const handleCancelOrder = useCallback(
    async (id: string) => {
      try {
        await cancelOrder(env, id);
        notify('ok', `Order ${id.slice(0, 8)} canceled`);
        await refreshAccountState();
      } catch (e) {
        notify('err', (e as Error).message);
      }
    },
    [env, notify, refreshAccountState],
  );

  const handleClosePosition = useCallback(
    async (symbol: string) => {
      if (!confirm(`Close entire ${symbol} position at market?`)) return;
      try {
        // Working orders (SL/TP bracket children, unfilled limits, etc.)
        // reserve the position qty under held_for_orders, which makes the
        // close request fail with 40310000 "insufficient qty available".
        // Cancel any open orders on this symbol first.
        const openStatuses = new Set([
          'new',
          'pending_new',
          'accepted',
          'partially_filled',
          'pending_replace',
          'replaced',
          'held',
        ]);
        const openOnSymbol = orders.filter(
          (o) => o.symbol === symbol && openStatuses.has(o.status),
        );
        for (const o of openOnSymbol) {
          try {
            await cancelOrder(env, o.id);
          } catch {
            // best-effort: a stale/already-canceled order shouldn't block
            // the close.
          }
        }
        // Alpaca takes a beat to release the held_for_orders qty after a
        // cancel transitions through pending_cancel → canceled. Retry the
        // close itself with backoff instead of guessing a fixed sleep.
        let closed: AlpacaOrder | null = null;
        let lastErr: Error | null = null;
        const attempts = openOnSymbol.length > 0 ? 6 : 1;
        for (let i = 0; i < attempts; i++) {
          try {
            closed = await closePosition(env, symbol);
            break;
          } catch (e) {
            lastErr = e as Error;
            if (!/insufficient qty/i.test(lastErr.message) || i === attempts - 1) {
              throw lastErr;
            }
            await new Promise((r) => setTimeout(r, 500 + i * 500));
          }
        }
        if (!closed) throw lastErr ?? new Error('close failed');
        // closePosition just queues a market order. If the market is closed
        // it sits at "accepted" until the next session — without that detail
        // the toast looks like "closed!" while the position is still on the
        // table. Surface market state in the message.
        let msg =
          openOnSymbol.length > 0
            ? `${symbol} close submitted (canceled ${openOnSymbol.length} open order${openOnSymbol.length === 1 ? '' : 's'} first)`
            : `${symbol} close order submitted`;
        try {
          const clock = await getClock(env);
          if (!clock.is_open) {
            const next = new Date(clock.next_open);
            const when = next.toLocaleString(undefined, {
              weekday: 'short',
              hour: 'numeric',
              minute: '2-digit',
            });
            msg += ` — market closed, fills at next open (${when})`;
          }
        } catch {
          // best-effort; clock isn't critical
        }
        notify('ok', msg);
        await refreshAccountState();
      } catch (e) {
        notify('err', (e as Error).message);
      }
    },
    [env, notify, orders, refreshAccountState],
  );

  const handleSetPositionSLTP = useCallback(
    async (p: AlpacaPosition) => {
      const snap = snapshots[p.symbol];
      const last = snap?.last ?? parseFloat(p.current_price);
      const isLong = p.side === 'long';
      const slDefault = (last * (isLong ? 1 - defaultSlPct / 100 : 1 + defaultSlPct / 100)).toFixed(2);
      const tpDefault = (last * (isLong ? 1 + defaultTpPct / 100 : 1 - defaultTpPct / 100)).toFixed(2);
      const slStr = prompt(
        `Stop loss for ${p.symbol} (${p.side}, last ${fmtMoney(last)}):`,
        slDefault,
      );
      if (slStr === null) return;
      const tpStr = prompt(`Take profit for ${p.symbol}:`, tpDefault);
      if (tpStr === null) return;
      const sl = parseFloat(slStr);
      const tp = parseFloat(tpStr);
      if (!Number.isFinite(sl) || !Number.isFinite(tp)) {
        notify('err', 'Invalid stop or target price.');
        return;
      }
      try {
        await placeOrder(env, {
          symbol: p.symbol,
          qty: Math.abs(parseFloat(p.qty)),
          side: isLong ? 'sell' : 'buy',
          type: 'limit',
          time_in_force: 'gtc',
          limit_price: tp,
          order_class: 'oco',
          take_profit: { limit_price: tp },
          stop_loss: { stop_price: sl },
        });
        notify('ok', `${p.symbol} SL/TP placed (OCO ${fmtMoney(sl)} / ${fmtMoney(tp)})`);
        await refreshAccountState();
      } catch (e) {
        notify('err', (e as Error).message);
      }
    },
    [env, snapshots, defaultSlPct, defaultTpPct, notify, refreshAccountState],
  );

  const chartSnap = snapshots[selectedSymbol];
  const rangeCfg = RANGE_CONFIG[chartRange];

  return (
    <div className="gt-shell">
      <header className="gt-header">
        <a className="gt-back" href="/app">
          ← Editor
        </a>
        <h1 className="gt-title">GetTrading</h1>
        <div className="gt-env-toggle" role="group" aria-label="Environment">
          <button
            className={env === 'paper' ? 'active' : ''}
            onClick={() => setEnv('paper')}
          >
            Paper
          </button>
          <button
            className={env === 'live' ? 'active live' : ''}
            onClick={() => {
              if (
                confirm(
                  'Switch to LIVE trading? Real money, real orders. Make sure your live keys are set in Supabase.',
                )
              ) {
                setEnv('live');
              }
            }}
          >
            Live
          </button>
        </div>
      </header>

      {error && <div className="gt-error">{error}</div>}
      {toast && <div className={`gt-toast ${toast.kind}`}>{toast.msg}</div>}

      <section className="gt-account">
        <AccountStat label="Equity" value={fmtMoney(account?.equity)} />
        <AccountStat
          label="Buying power"
          value={fmtMoney(account?.buying_power)}
        />
        <AccountStat label="Cash" value={fmtMoney(account?.cash)} />
        <AccountStat
          label="Day P&L"
          value={
            account
              ? fmtMoney(
                  parseFloat(account.equity) - parseFloat(account.last_equity),
                )
              : '—'
          }
          tone={
            account &&
            parseFloat(account.equity) - parseFloat(account.last_equity) >= 0
              ? 'pos'
              : 'neg'
          }
        />
        <AccountStat
          label="Status"
          value={account?.status ?? '—'}
          tone={
            account?.trading_blocked || account?.account_blocked
              ? 'neg'
              : 'pos'
          }
        />
      </section>

      <div className="gt-grid">
        <section className="gt-panel">
          <h2>Place order</h2>
          <OrderEntry
            busy={busy}
            symbol={selectedSymbol}
            snapshots={snapshots}
            positions={positions}
            buyingPower={parseFloat(account?.buying_power ?? '0') || 0}
            defaultSlPct={defaultSlPct}
            defaultTpPct={defaultTpPct}
            onChangeDefaultSlPct={setDefaultSlPct}
            onChangeDefaultTpPct={setDefaultTpPct}
            onSubmit={handlePlaceOrder}
          />
        </section>

        <section className="gt-panel">
          <h2>Positions</h2>
          <PositionsTable
            positions={positions}
            snapshots={snapshots}
            onClose={handleClosePosition}
            onSelect={setSelectedSymbol}
            onSetSLTP={handleSetPositionSLTP}
          />
        </section>

        <section className="gt-panel">
          <header className="gt-panel-header">
            <h2 style={{ margin: 0 }}>Watchlist</h2>
            <button
              type="button"
              className="gt-link"
              onClick={() => {
                if (confirm('Reset watchlist to the default 45 symbols?')) {
                  setWatchlist(DEFAULT_WATCHLIST);
                }
              }}
              title="Restore the default watchlist"
            >
              Reset
            </button>
          </header>
          <Watchlist
            symbols={watchlist}
            snapshots={snapshots}
            selected={selectedSymbol}
            onAdd={(s) =>
              setWatchlist((prev) =>
                prev.includes(s) ? prev : [...prev, s].slice(0, MAX_WATCHLIST),
              )
            }
            onRemove={(s) =>
              setWatchlist((prev) => prev.filter((x) => x !== s))
            }
            onSelect={setSelectedSymbol}
          />
        </section>
      </div>

      <CollapsiblePanel
        wide
        title={`Signals${signals.length ? ` (${signals.length})` : ''}`}
        collapsed={!!collapsed.signals}
        onToggle={() => toggleCollapsed('signals')}
        headerRight={
          <div className="gt-signal-controls">
            <label>
              Mover ≥
              <input
                type="number"
                step="0.5"
                min="0.5"
                value={signalSettings.bigMoverPct}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (Number.isFinite(v) && v > 0) {
                    setSignalSettings((s) => ({ ...s, bigMoverPct: v }));
                  }
                }}
              />
              %
            </label>
            <label>
              Position ≥
              <input
                type="number"
                step="0.5"
                min="0.5"
                value={signalSettings.positionPnlPct}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (Number.isFinite(v) && v > 0) {
                    setSignalSettings((s) => ({ ...s, positionPnlPct: v }));
                  }
                }}
              />
              %
            </label>
            {notifyEnabled ? (
              <span className="gt-notify-on" title="Browser notifications enabled">
                🔔
              </span>
            ) : (
              <button
                type="button"
                className="gt-link"
                onClick={enableNotifications}
              >
                enable notifications
              </button>
            )}
            {signals.length > 0 && (
              <button
                type="button"
                className="gt-link"
                onClick={() => {
                  setSignals([]);
                  signalCooldownRef.current = {};
                }}
              >
                clear
              </button>
            )}
          </div>
        }
      >
        <SignalsFeed
          signals={signals}
          onSelect={setSelectedSymbol}
          onDismiss={(id) =>
            setSignals((prev) => prev.filter((s) => s.id !== id))
          }
          watchedCount={watchlist.length}
        />
      </CollapsiblePanel>

      <CollapsiblePanel
        wide
        title="Chart"
        collapsed={!!collapsed.chart}
        onToggle={() => toggleCollapsed('chart')}
        headerRight={
          <div className="gt-chart-meta">
            <span className="gt-sym">{selectedSymbol}</span>
            {chartSnap && (
              <>
                <span>{fmtMoney(chartSnap.last)}</span>
                <span
                  className={chartSnap.change >= 0 ? 'pos' : 'neg'}
                >
                  {chartSnap.change >= 0 ? '+' : ''}
                  {fmtNum(chartSnap.change)} ({fmtPct(chartSnap.changePct)})
                </span>
              </>
            )}
            <div className="gt-tf-toggle" role="group" aria-label="Timeframe">
              {RANGE_ORDER.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={chartRange === r ? 'active' : ''}
                  onClick={() => setChartRange(r)}
                  title={RANGE_CONFIG[r].label}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        }
      >
        <CandleChart
          bars={bars}
          loading={barsLoading}
          intraday={rangeCfg.intraday}
        />
        <SymbolStrip
          symbols={watchlist}
          snapshots={snapshots}
          selected={selectedSymbol}
          onSelect={setSelectedSymbol}
        />
      </CollapsiblePanel>

      <CollapsiblePanel
        wide
        title="Orders (recent 50)"
        collapsed={!!collapsed.orders}
        onToggle={() => toggleCollapsed('orders')}
      >
        <OrdersTable orders={orders} onCancel={handleCancelOrder} />
      </CollapsiblePanel>
    </div>
  );
}

function CollapsiblePanel({
  title,
  collapsed,
  onToggle,
  wide,
  headerRight,
  children,
}: {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  wide?: boolean;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={`gt-panel ${wide ? 'gt-panel-wide' : ''}`}>
      <header className="gt-panel-header">
        <button
          type="button"
          className="gt-collapse-toggle"
          onClick={onToggle}
          aria-expanded={!collapsed}
        >
          <span className={`gt-caret ${collapsed ? 'collapsed' : ''}`}>▾</span>
          <h2>{title}</h2>
        </button>
        {headerRight && <div className="gt-panel-right">{headerRight}</div>}
      </header>
      {!collapsed && <div className="gt-panel-body">{children}</div>}
    </section>
  );
}

function AccountStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'pos' | 'neg';
}) {
  return (
    <div className="gt-stat">
      <div className="gt-stat-label">{label}</div>
      <div className={`gt-stat-value ${tone ?? ''}`}>{value}</div>
    </div>
  );
}

type QtyMode = 'shares' | 'dollars' | 'pct';

function OrderEntry({
  busy,
  symbol: externalSymbol,
  snapshots,
  positions,
  buyingPower,
  defaultSlPct,
  defaultTpPct,
  onChangeDefaultSlPct,
  onChangeDefaultTpPct,
  onSubmit,
}: {
  busy: boolean;
  symbol: string;
  snapshots: Record<string, AlpacaSnapshot>;
  positions: AlpacaPosition[];
  buyingPower: number;
  defaultSlPct: number;
  defaultTpPct: number;
  onChangeDefaultSlPct: (n: number) => void;
  onChangeDefaultTpPct: (n: number) => void;
  onSubmit: (input: import('../lib/alpaca').PlaceOrderInput) => void;
}) {
  const [symbol, setSymbol] = useState(externalSymbol);
  const [side, setSide] = useState<OrderSide>('buy');
  const [type, setType] = useState<OrderType>('market');
  const [qtyMode, setQtyMode] = useState<QtyMode>('shares');
  const [qty, setQty] = useState('0.1');
  const [limit, setLimit] = useState('');
  const [tif, setTif] = useState<TimeInForce>('day');
  const [stopPrice, setStopPrice] = useState('');
  const [takePrice, setTakePrice] = useState('');
  const computedForRef = useRef<string>('');

  // Sync symbol from parent (chip / watchlist row click). Mark SL/TP as needing
  // recompute for the new symbol.
  useEffect(() => {
    setSymbol(externalSymbol);
    computedForRef.current = '';
  }, [externalSymbol]);

  const sym = symbol.trim().toUpperCase();
  const snap = snapshots[sym];

  // When we first get a price for the current (symbol, side) combo, compute
  // SL/TP from the user's default percentages. Skip after that so live ticks
  // don't overwrite the user's edits.
  useEffect(() => {
    const key = `${sym}|${side}`;
    if (!sym || !snap?.last || computedForRef.current === key) return;
    const slMul = side === 'buy' ? 1 - defaultSlPct / 100 : 1 + defaultSlPct / 100;
    const tpMul = side === 'buy' ? 1 + defaultTpPct / 100 : 1 - defaultTpPct / 100;
    setStopPrice((snap.last * slMul).toFixed(2));
    setTakePrice((snap.last * tpMul).toFixed(2));
    computedForRef.current = key;
  }, [sym, side, snap?.last, defaultSlPct, defaultTpPct]);

  function recomputeFromDefaults() {
    if (!snap?.last) return;
    const slMul = side === 'buy' ? 1 - defaultSlPct / 100 : 1 + defaultSlPct / 100;
    const tpMul = side === 'buy' ? 1 + defaultTpPct / 100 : 1 - defaultTpPct / 100;
    setStopPrice((snap.last * slMul).toFixed(2));
    setTakePrice((snap.last * tpMul).toFixed(2));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!sym) return;
    const qtyNum = parseFloat(qty);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) return;
    const sl = parseFloat(stopPrice);
    const tp = parseFloat(takePrice);
    const hasSL = Number.isFinite(sl) && sl > 0;
    const hasTP = Number.isFinite(tp) && tp > 0;
    // % buying power mode resolves to a notional $ amount.
    const notional =
      qtyMode === 'pct'
        ? buyingPower * (qtyNum / 100)
        : qtyMode === 'dollars'
        ? qtyNum
        : null;
    if (qtyMode !== 'shares' && (!Number.isFinite(notional!) || notional! <= 0)) return;
    // Fractional / notional orders on Alpaca require day TIF and don't support
    // bracket/OTO/OCO. Detect and silently downgrade so we don't get a 422.
    const isFractional =
      qtyMode !== 'shares' || qtyNum !== Math.floor(qtyNum);
    const effectiveTif: TimeInForce = isFractional
      ? 'day'
      : hasSL || hasTP
      ? tif === 'day' || tif === 'gtc'
        ? tif
        : 'day'
      : tif;
    const payload: import('../lib/alpaca').PlaceOrderInput = {
      symbol: sym,
      side,
      type,
      time_in_force: effectiveTif,
      ...(notional !== null
        ? { notional: Math.round(notional * 100) / 100 }
        : { qty: qtyNum }),
      ...(type === 'limit' || type === 'stop_limit'
        ? { limit_price: parseFloat(limit) }
        : {}),
    };
    if (!isFractional) {
      if (hasSL && hasTP) {
        payload.order_class = 'bracket';
        payload.stop_loss = { stop_price: sl };
        payload.take_profit = { limit_price: tp };
      } else if (hasSL) {
        payload.order_class = 'oto';
        payload.stop_loss = { stop_price: sl };
      } else if (hasTP) {
        payload.order_class = 'oto';
        payload.take_profit = { limit_price: tp };
      }
    }
    onSubmit(payload);
  }

  const qtyNum = parseFloat(qty);
  const isFractional =
    qtyMode !== 'shares' ||
    (Number.isFinite(qtyNum) && qtyNum > 0 && qtyNum !== Math.floor(qtyNum));
  const pctNotional =
    qtyMode === 'pct' && Number.isFinite(qtyNum)
      ? buyingPower * (qtyNum / 100)
      : null;
  const estDollars =
    qtyMode === 'shares' && snap?.last && Number.isFinite(qtyNum)
      ? qtyNum * snap.last
      : qtyMode === 'pct' && pctNotional !== null
      ? pctNotional
      : null;
  const estShares =
    qtyMode === 'dollars' && snap?.last && Number.isFinite(qtyNum)
      ? qtyNum / snap.last
      : qtyMode === 'pct' && pctNotional !== null && snap?.last
      ? pctNotional / snap.last
      : null;

  const sl = parseFloat(stopPrice);
  const tp = parseFloat(takePrice);
  const slPctActual =
    Number.isFinite(sl) && snap?.last ? ((sl - snap.last) / snap.last) * 100 : null;
  const tpPctActual =
    Number.isFinite(tp) && snap?.last ? ((tp - snap.last) / snap.last) * 100 : null;

  // Alpaca rejects fractional shorts entirely ("fractional orders cannot be
  // sold short", code 42210000). A fractional sell only succeeds if it's
  // closing/reducing an existing long position of at least the requested size.
  // Detect the invalid case here so the user gets a clear inline reason
  // instead of a flash of red toast after submit.
  const heldLongQty = (() => {
    if (!sym) return 0;
    const p = positions.find((x) => x.symbol === sym);
    if (!p || p.side !== 'long') return 0;
    const n = parseFloat(p.qty);
    return Number.isFinite(n) ? n : 0;
  })();
  const intendedShares =
    qtyMode === 'shares'
      ? qtyNum
      : snap?.last && Number.isFinite(qtyNum)
      ? qtyNum / snap.last
      : null;
  const fractionalShortBlocked =
    side === 'sell' &&
    isFractional &&
    intendedShares !== null &&
    Number.isFinite(intendedShares) &&
    intendedShares > heldLongQty + 1e-9;

  return (
    <form className="gt-order-form" onSubmit={submit}>
      <label className="gt-field gt-field-wide">
        <span>Symbol</span>
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          placeholder="AAPL"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      {snap && (
        <div className="gt-quote-hint">
          Bid {fmtMoney(snap.bid)} · Ask {fmtMoney(snap.ask)} ·{' '}
          <span className={snap.change >= 0 ? 'pos' : 'neg'}>
            {fmtPct(snap.changePct)}
          </span>
        </div>
      )}
      <div className="gt-side-toggle" role="group">
        <button
          type="button"
          className={side === 'buy' ? 'active buy' : ''}
          onClick={() => setSide('buy')}
        >
          Buy
        </button>
        <button
          type="button"
          className={side === 'sell' ? 'active sell' : ''}
          onClick={() => setSide('sell')}
        >
          Sell
        </button>
      </div>
      <label className="gt-field">
        <span>
          {qtyMode === 'shares'
            ? 'Qty (shares)'
            : qtyMode === 'dollars'
            ? 'Notional ($)'
            : '% of buying power'}
          {estDollars !== null && (
            <em className="gt-est">≈ {fmtMoney(estDollars)}</em>
          )}
          {estShares !== null && (
            <em className="gt-est">≈ {estShares.toFixed(4)} sh</em>
          )}
        </span>
        <div className="gt-qty-row">
          <input
            type="number"
            min="0"
            step="any"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
          <div className="gt-qty-mode" role="group">
            <button
              type="button"
              className={qtyMode === 'shares' ? 'active' : ''}
              onClick={() => setQtyMode('shares')}
              title="Quantity in shares (can be fractional)"
            >
              sh
            </button>
            <button
              type="button"
              className={qtyMode === 'dollars' ? 'active' : ''}
              onClick={() => setQtyMode('dollars')}
              title="Dollar amount (notional)"
            >
              $
            </button>
            <button
              type="button"
              className={qtyMode === 'pct' ? 'active' : ''}
              onClick={() => setQtyMode('pct')}
              title="Percentage of buying power"
            >
              %
            </button>
          </div>
        </div>
      </label>
      <label className="gt-field">
        <span>Type</span>
        <select value={type} onChange={(e) => setType(e.target.value as OrderType)}>
          <option value="market">Market</option>
          <option value="limit">Limit</option>
        </select>
      </label>
      {type === 'limit' && (
        <label className="gt-field">
          <span>Limit price</span>
          <input
            type="number"
            step="any"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
          />
        </label>
      )}
      <label className="gt-field">
        <span>TIF</span>
        <select
          value={tif}
          onChange={(e) => setTif(e.target.value as TimeInForce)}
        >
          <option value="day">Day</option>
          <option value="gtc">GTC</option>
          <option value="ioc">IOC</option>
          <option value="fok">FOK</option>
        </select>
      </label>
      <div
        className={`gt-bracket gt-field-wide ${isFractional ? 'disabled' : ''}`}
      >
        <div className="gt-bracket-row">
          <label className="gt-field">
            <span>
              Stop loss{' '}
              {slPctActual !== null && !isFractional && (
                <em className={slPctActual < 0 ? 'neg' : 'pos'}>
                  {slPctActual > 0 ? '+' : ''}
                  {slPctActual.toFixed(1)}%
                </em>
              )}
            </span>
            <input
              type="number"
              step="any"
              value={stopPrice}
              onChange={(e) => setStopPrice(e.target.value)}
              placeholder={isFractional ? 'n/a (fractional)' : 'off'}
              disabled={isFractional}
            />
          </label>
          <label className="gt-field">
            <span>
              Take profit{' '}
              {tpPctActual !== null && !isFractional && (
                <em className={tpPctActual >= 0 ? 'pos' : 'neg'}>
                  {tpPctActual > 0 ? '+' : ''}
                  {tpPctActual.toFixed(1)}%
                </em>
              )}
            </span>
            <input
              type="number"
              step="any"
              value={takePrice}
              onChange={(e) => setTakePrice(e.target.value)}
              placeholder={isFractional ? 'n/a (fractional)' : 'off'}
              disabled={isFractional}
            />
          </label>
        </div>
        {isFractional && (
          <div className="gt-note">
            SL/TP unavailable on fractional orders — use the SL/TP
            button on the position after it fills.
          </div>
        )}
        <div className="gt-bracket-defaults">
          <span className="gt-defaults-label">Defaults</span>
          <label>
            SL
            <input
              type="number"
              step="any"
              value={defaultSlPct}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v) && v > 0) onChangeDefaultSlPct(v);
              }}
            />
            %
          </label>
          <label>
            TP
            <input
              type="number"
              step="any"
              value={defaultTpPct}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v) && v > 0) onChangeDefaultTpPct(v);
              }}
            />
            %
          </label>
          <button
            type="button"
            className="gt-link"
            onClick={recomputeFromDefaults}
            disabled={!snap?.last || isFractional}
            title="Recompute SL/TP from defaults at current price"
          >
            apply
          </button>
        </div>
      </div>
      {fractionalShortBlocked && (
        <div className="gt-warn">
          Alpaca doesn't allow fractional shorts. To sell {sym}:
          {heldLongQty > 0
            ? ` you hold ${heldLongQty} share${heldLongQty === 1 ? '' : 's'} — sell at most that, or switch to whole shares to open a short.`
            : ` you don't have a position, so switch to whole shares (1+) to open a short.`}
        </div>
      )}
      <button
        type="submit"
        className={`gt-submit ${side}`}
        disabled={busy || !sym || fractionalShortBlocked}
      >
        {busy ? 'Submitting…' : `${side === 'buy' ? 'Buy' : 'Sell'} ${sym || ''}`}
      </button>
    </form>
  );
}

function PositionsTable({
  positions,
  snapshots,
  onClose,
  onSelect,
  onSetSLTP,
}: {
  positions: AlpacaPosition[];
  snapshots: Record<string, AlpacaSnapshot>;
  onClose: (symbol: string) => void;
  onSelect: (symbol: string) => void;
  onSetSLTP: (p: AlpacaPosition) => void;
}) {
  if (positions.length === 0) {
    return <div className="gt-empty">No open positions.</div>;
  }
  return (
    <div className="gt-table-wrap">
      <table className="gt-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Side</th>
            <th>Qty</th>
            <th>Avg</th>
            <th>Last</th>
            <th>Mkt value</th>
            <th>Unrealized</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => {
            const lastPrice =
              snapshots[p.symbol]?.last ?? parseFloat(p.current_price);
            const pl = parseFloat(p.unrealized_pl);
            const qtyNum = parseFloat(p.qty);
            const qtyDisplay = Number.isInteger(qtyNum)
              ? String(qtyNum)
              : qtyNum.toFixed(4);
            const isLong = p.side === 'long';
            return (
              <tr key={p.asset_id}>
                <td>
                  <button
                    className="gt-sym gt-link"
                    onClick={() => onSelect(p.symbol)}
                  >
                    {p.symbol}
                  </button>
                </td>
                <td className={isLong ? 'pos' : 'neg'}>
                  {isLong ? 'LONG' : 'SHORT'}
                </td>
                <td>{qtyDisplay}</td>
                <td>{fmtMoney(p.avg_entry_price)}</td>
                <td>{fmtMoney(lastPrice)}</td>
                <td>{fmtMoney(p.market_value)}</td>
                <td className={pl >= 0 ? 'pos' : 'neg'}>
                  {fmtMoney(p.unrealized_pl)} ({fmtPct(p.unrealized_plpc)})
                </td>
                <td>
                  <button
                    className="gt-link"
                    onClick={() => onSetSLTP(p)}
                    title="Set stop loss / take profit (OCO)"
                  >
                    SL/TP
                  </button>{' '}
                  <button
                    className="gt-link"
                    onClick={() => onClose(p.symbol)}
                  >
                    Close
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface Lot {
  qty: number;
  price: number;
  side: 'long' | 'short';
}

// FIFO-matches fills per symbol and returns realized P&L per *closing* order.
// Opening fills get null (no realized P&L until they're closed). Returns a map
// of orderId → realized $ amount (or null).
function computeRealizedPnL(orders: AlpacaOrder[]): Map<string, number | null> {
  const out = new Map<string, number | null>();
  // Process oldest fill first so the FIFO inventory matches actual sequence.
  const chronological = [...orders].sort((a, b) => {
    const at = new Date(a.filled_at || a.submitted_at).getTime();
    const bt = new Date(b.filled_at || b.submitted_at).getTime();
    return at - bt;
  });
  const inventory: Record<string, Lot[]> = {};

  for (const o of chronological) {
    if (o.status !== 'filled' && o.status !== 'partially_filled') {
      out.set(o.id, null);
      continue;
    }
    const fillQty = parseFloat(o.filled_qty);
    const fillPrice = parseFloat(o.filled_avg_price ?? '0');
    if (!Number.isFinite(fillQty) || fillQty <= 0 || !Number.isFinite(fillPrice) || fillPrice <= 0) {
      out.set(o.id, null);
      continue;
    }
    const lots = inventory[o.symbol] ?? (inventory[o.symbol] = []);
    const firstLotSide = lots[0]?.side;
    const isClosingLong = firstLotSide === 'long' && o.side === 'sell';
    const isClosingShort = firstLotSide === 'short' && o.side === 'buy';

    if (!isClosingLong && !isClosingShort) {
      // Opening fill (or adding to existing same-side position).
      lots.push({
        qty: fillQty,
        price: fillPrice,
        side: o.side === 'buy' ? 'long' : 'short',
      });
      out.set(o.id, null);
      continue;
    }

    let realized = 0;
    let remaining = fillQty;
    const closingSide = isClosingLong ? 'long' : 'short';
    while (remaining > 0 && lots.length > 0 && lots[0].side === closingSide) {
      const lot = lots[0];
      const match = Math.min(remaining, lot.qty);
      realized += isClosingLong
        ? (fillPrice - lot.price) * match
        : (lot.price - fillPrice) * match;
      lot.qty -= match;
      remaining -= match;
      if (lot.qty < 1e-9) lots.shift();
    }
    // Any remaining qty after fully consuming opposite-side inventory flips the
    // position (e.g. sold more than the long lots — opens a short).
    if (remaining > 0) {
      lots.push({
        qty: remaining,
        price: fillPrice,
        side: o.side === 'buy' ? 'long' : 'short',
      });
    }
    out.set(o.id, realized);
  }
  return out;
}

function OrdersTable({
  orders,
  onCancel,
}: {
  orders: AlpacaOrder[];
  onCancel: (id: string) => void;
}) {
  const [symbolFilter, setSymbolFilter] = useState('');
  const [sideFilter, setSideFilter] = useState<'all' | 'buy' | 'sell'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'filled' | 'open' | 'canceled'>(
    'all',
  );
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // FIFO-matched realized P&L per order. Computed across *all* orders (not
  // just the filtered view) so closing trades reference the correct entry lot
  // even when filters hide earlier opens.
  const pnlByOrderId = useMemo(() => computeRealizedPnL(orders), [orders]);

  const filtered = useMemo(() => {
    const sym = symbolFilter.trim().toUpperCase();
    const fromTs = fromDate ? new Date(fromDate + 'T00:00:00').getTime() : null;
    // toDate is inclusive — extend to end of day.
    const toTs = toDate ? new Date(toDate + 'T23:59:59.999').getTime() : null;
    const openSet = new Set([
      'new',
      'accepted',
      'pending_new',
      'partially_filled',
      'pending_replace',
      'replaced',
      'held',
    ]);
    return orders.filter((o) => {
      if (sym && !o.symbol.includes(sym)) return false;
      if (sideFilter !== 'all' && o.side !== sideFilter) return false;
      if (statusFilter === 'filled' && o.status !== 'filled') return false;
      if (statusFilter === 'canceled' && o.status !== 'canceled') return false;
      if (statusFilter === 'open' && !openSet.has(o.status)) return false;
      if (fromTs || toTs) {
        const ts = new Date(o.submitted_at).getTime();
        if (fromTs && ts < fromTs) return false;
        if (toTs && ts > toTs) return false;
      }
      return true;
    });
  }, [orders, symbolFilter, sideFilter, statusFilter, fromDate, toDate]);

  const hasFilters =
    symbolFilter || sideFilter !== 'all' || statusFilter !== 'all' || fromDate || toDate;

  // Sum of realized P&L over the visible (filtered) orders.
  let visiblePnL = 0;
  let visiblePnLCount = 0;
  for (const o of filtered) {
    const v = pnlByOrderId.get(o.id);
    if (typeof v === 'number') {
      visiblePnL += v;
      visiblePnLCount += 1;
    }
  }

  return (
    <>
      <div className="gt-order-filters">
        <input
          className="gt-filter-input"
          type="text"
          placeholder="Symbol"
          value={symbolFilter}
          onChange={(e) => setSymbolFilter(e.target.value)}
        />
        <select
          value={sideFilter}
          onChange={(e) => setSideFilter(e.target.value as typeof sideFilter)}
        >
          <option value="all">All sides</option>
          <option value="buy">Buy</option>
          <option value="sell">Sell</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
        >
          <option value="all">All statuses</option>
          <option value="filled">Filled</option>
          <option value="open">Open</option>
          <option value="canceled">Canceled</option>
        </select>
        <label className="gt-filter-date">
          From
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </label>
        <label className="gt-filter-date">
          To
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </label>
        {hasFilters && (
          <button
            type="button"
            className="gt-link"
            onClick={() => {
              setSymbolFilter('');
              setSideFilter('all');
              setStatusFilter('all');
              setFromDate('');
              setToDate('');
            }}
          >
            clear
          </button>
        )}
        <span className="gt-filter-count">
          {filtered.length}/{orders.length}
        </span>
      </div>
      {visiblePnLCount > 0 && (
        <div className="gt-pnl-summary">
          Realized P&L on closed trades
          {hasFilters ? ' (filtered)' : ''}:{' '}
          <strong className={visiblePnL >= 0 ? 'pos' : 'neg'}>
            {visiblePnL >= 0 ? '+' : ''}
            {fmtMoney(visiblePnL)}
          </strong>{' '}
          <span className="gt-muted">
            across {visiblePnLCount} close{visiblePnLCount === 1 ? '' : 's'}
          </span>
        </div>
      )}
      {filtered.length === 0 ? (
        <div className="gt-empty">
          {orders.length === 0 ? 'No orders yet.' : 'No orders match filters.'}
        </div>
      ) : (
        <div className="gt-table-wrap">
          <table className="gt-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Symbol</th>
                <th>Side</th>
                <th>Type</th>
                <th>Qty</th>
                <th>Limit</th>
                <th>Status</th>
                <th>Filled</th>
                <th>P&amp;L</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => {
                const cancellable = [
                  'new',
                  'accepted',
                  'pending_new',
                  'partially_filled',
                ].includes(o.status);
                const pnl = pnlByOrderId.get(o.id);
                return (
                  <tr key={o.id}>
                    <td>{new Date(o.submitted_at).toLocaleString()}</td>
                    <td className="gt-sym">{o.symbol}</td>
                    <td className={o.side === 'buy' ? 'pos' : 'neg'}>
                      {o.side.toUpperCase()}
                    </td>
                    <td>{o.type}</td>
                    <td>{o.qty ?? '—'}</td>
                    <td>{o.limit_price ? fmtMoney(o.limit_price) : '—'}</td>
                    <td>{o.status}</td>
                    <td>
                      {o.filled_qty}
                      {o.filled_avg_price ? ` @ ${fmtMoney(o.filled_avg_price)}` : ''}
                    </td>
                    <td className={typeof pnl === 'number' ? (pnl >= 0 ? 'pos' : 'neg') : ''}>
                      {typeof pnl === 'number'
                        ? `${pnl >= 0 ? '+' : ''}${fmtMoney(pnl)}`
                        : '—'}
                    </td>
                    <td>
                      {cancellable && (
                        <button className="gt-link" onClick={() => onCancel(o.id)}>
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

type PctSort = 'none' | 'pct_desc' | 'pct_asc';

function Watchlist({
  symbols,
  snapshots,
  selected,
  onAdd,
  onRemove,
  onSelect,
}: {
  symbols: string[];
  snapshots: Record<string, AlpacaSnapshot>;
  selected: string;
  onAdd: (s: string) => void;
  onRemove: (s: string) => void;
  onSelect: (s: string) => void;
}) {
  const [input, setInput] = useState('');
  const [pctSort, setPctSort] = useState<PctSort>('none');
  const lastPrices = useRef<Record<string, number>>({});

  const rows = useMemo(() => {
    const base = symbols.map((s) => {
      const snap = snapshots[s];
      const last = snap?.last;
      const prev = lastPrices.current[s];
      if (last !== undefined && last > 0) lastPrices.current[s] = last;
      const tickDir =
        last !== undefined && prev !== undefined && last !== prev
          ? last > prev
            ? 'up'
            : 'down'
          : 'flat';
      return { symbol: s, snap, last, tickDir };
    });
    if (pctSort === 'none') return base;
    return [...base].sort((a, b) => {
      const aHas =
        a.snap && Number.isFinite(a.snap.changePct);
      const bHas =
        b.snap && Number.isFinite(b.snap.changePct);
      // Symbols without snapshot data sink to the bottom regardless of direction.
      if (!aHas && !bHas) return 0;
      if (!aHas) return 1;
      if (!bHas) return -1;
      const diff = b.snap!.changePct - a.snap!.changePct;
      return pctSort === 'pct_desc' ? diff : -diff;
    });
  }, [symbols, snapshots, pctSort]);

  const cyclePctSort = () =>
    setPctSort((cur) =>
      cur === 'none' ? 'pct_desc' : cur === 'pct_desc' ? 'pct_asc' : 'none',
    );
  const pctSortIndicator =
    pctSort === 'pct_desc' ? ' ▼' : pctSort === 'pct_asc' ? ' ▲' : '';

  return (
    <div>
      <form
        className="gt-watch-add"
        onSubmit={(e) => {
          e.preventDefault();
          const v = input.trim().toUpperCase();
          if (v) onAdd(v);
          setInput('');
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Add symbol…"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit">Add</button>
      </form>
      <div className="gt-table-wrap gt-watch-scroll">
        <table className="gt-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Last</th>
              <th
                className="gt-sortable"
                onClick={cyclePctSort}
                title={
                  pctSort === 'none'
                    ? 'Sort by gainers first'
                    : pctSort === 'pct_desc'
                    ? 'Sort by losers first'
                    : 'Clear sort'
                }
              >
                %{pctSortIndicator}
              </th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.symbol}
                className={selected === r.symbol ? 'gt-row-selected' : ''}
              >
                <td>
                  <button
                    className="gt-sym gt-link"
                    onClick={() => onSelect(r.symbol)}
                  >
                    {r.symbol}
                  </button>
                </td>
                <td className={`gt-${r.tickDir}`}>{fmtMoney(r.last)}</td>
                <td
                  className={
                    r.snap && r.snap.change >= 0 ? 'pos' : r.snap ? 'neg' : ''
                  }
                >
                  {r.snap ? fmtPct(r.snap.changePct) : '—'}
                </td>
                <td>
                  <button className="gt-link" onClick={() => onRemove(r.symbol)}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SignalsFeed({
  signals,
  onSelect,
  onDismiss,
  watchedCount,
}: {
  signals: Signal[];
  onSelect: (s: string) => void;
  onDismiss: (id: string) => void;
  watchedCount: number;
}) {
  if (signals.length === 0) {
    return (
      <div className="gt-empty">
        Watching {watchedCount} symbols. No signals yet — adjust the thresholds
        above if you want to be alerted on smaller moves.
      </div>
    );
  }
  return (
    <ul className="gt-signal-list">
      {signals.map((s) => (
        <li key={s.id} className={`gt-signal gt-signal-${s.severity}`}>
          <time className="gt-signal-time">
            {new Date(s.ts).toLocaleTimeString()}
          </time>
          <button
            className="gt-sym gt-link"
            onClick={() => onSelect(s.symbol)}
            title="Use this symbol in the order form"
          >
            {s.symbol}
          </button>
          <span className="gt-signal-msg">{s.message}</span>
          <button
            className="gt-link gt-signal-dismiss"
            onClick={() => onDismiss(s.id)}
            title="Dismiss"
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}

function SymbolStrip({
  symbols,
  snapshots,
  selected,
  onSelect,
}: {
  symbols: string[];
  snapshots: Record<string, AlpacaSnapshot>;
  selected: string;
  onSelect: (s: string) => void;
}) {
  return (
    <div className="gt-strip-wrap">
      <div className="gt-strip">
        {symbols.map((s) => {
          const snap = snapshots[s];
          const pct = snap?.changePct;
          const dir = pct === undefined ? 'flat' : pct >= 0 ? 'pos' : 'neg';
          return (
            <button
              key={s}
              type="button"
              className={`gt-chip ${selected === s ? 'active' : ''} ${dir}`}
              onClick={() => onSelect(s)}
            >
              <span className="gt-chip-sym">{s}</span>
              <span className="gt-chip-pct">
                {pct === undefined ? '—' : fmtPct(pct)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
