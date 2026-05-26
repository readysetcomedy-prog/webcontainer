import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  cancelOrder,
  closePosition,
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
const WATCHLIST_DEFAULTS_VERSION = '2';
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
  // +20 most fluid US large-caps (highest dollar-volume)
  'LLY', 'UNH', 'V', 'MA', 'HD', 'COST', 'WMT',
  'XOM', 'CVX', 'BAC', 'WFC',
  'DIS', 'ABBV', 'ORCL', 'CRM',
  'INTC', 'MU', 'QCOM', 'SNOW', 'SHOP',
];

const MAX_WATCHLIST = 75;

type ChartRange = '1D' | '5D' | '1H';

const RANGE_CONFIG: Record<
  ChartRange,
  { timeframe: AlpacaTimeframe; lookbackDays: number; intraday: boolean; label: string }
> = {
  '1D': { timeframe: '5Min', lookbackDays: 2, intraday: true, label: '1 day' },
  '5D': { timeframe: '15Min', lookbackDays: 8, intraday: true, label: '5 days' },
  '1H': { timeframe: '1Hour', lookbackDays: 30, intraday: true, label: '1 hour bars · 30 days' },
};

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
  return v === '5D' || v === '1H' || v === '1D' ? v : '1D';
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
        listOrders(env, 'all', 50),
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
    setTimeout(() => setToast(null), 4000);
  }, []);

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
        await closePosition(env, symbol);
        notify('ok', `${symbol} close order submitted`);
        await refreshAccountState();
      } catch (e) {
        notify('err', (e as Error).message);
      }
    },
    [env, notify, refreshAccountState],
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
              {(['1D', '5D', '1H'] as ChartRange[]).map((r) => (
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

function OrderEntry({
  busy,
  symbol: externalSymbol,
  snapshots,
  onSubmit,
}: {
  busy: boolean;
  symbol: string;
  snapshots: Record<string, AlpacaSnapshot>;
  onSubmit: (input: {
    symbol: string;
    qty?: number;
    side: OrderSide;
    type: OrderType;
    time_in_force: TimeInForce;
    limit_price?: number;
  }) => void;
}) {
  const [symbol, setSymbol] = useState(externalSymbol);
  const [side, setSide] = useState<OrderSide>('buy');
  const [type, setType] = useState<OrderType>('market');
  const [qty, setQty] = useState('1');
  const [limit, setLimit] = useState('');
  const [tif, setTif] = useState<TimeInForce>('day');

  // Sync from parent (chip / watchlist row click). Keeps other fields intact.
  useEffect(() => {
    setSymbol(externalSymbol);
  }, [externalSymbol]);

  const sym = symbol.trim().toUpperCase();
  const snap = snapshots[sym];

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!sym) return;
    const qtyNum = parseFloat(qty);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) return;
    const payload = {
      symbol: sym,
      qty: qtyNum,
      side,
      type,
      time_in_force: tif,
      ...(type === 'limit' || type === 'stop_limit'
        ? { limit_price: parseFloat(limit) }
        : {}),
    };
    onSubmit(payload);
  }

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
        <span>Qty</span>
        <input
          type="number"
          min="0"
          step="any"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
        />
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
      <button
        type="submit"
        className={`gt-submit ${side}`}
        disabled={busy || !sym}
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
}: {
  positions: AlpacaPosition[];
  snapshots: Record<string, AlpacaSnapshot>;
  onClose: (symbol: string) => void;
  onSelect: (symbol: string) => void;
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
                <td>{fmtNum(p.qty, 0)}</td>
                <td>{fmtMoney(p.avg_entry_price)}</td>
                <td>{fmtMoney(lastPrice)}</td>
                <td>{fmtMoney(p.market_value)}</td>
                <td className={pl >= 0 ? 'pos' : 'neg'}>
                  {fmtMoney(p.unrealized_pl)} ({fmtPct(p.unrealized_plpc)})
                </td>
                <td>
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

function OrdersTable({
  orders,
  onCancel,
}: {
  orders: AlpacaOrder[];
  onCancel: (id: string) => void;
}) {
  if (orders.length === 0) {
    return <div className="gt-empty">No orders yet.</div>;
  }
  return (
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
            <th></th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => {
            const cancellable = [
              'new',
              'accepted',
              'pending_new',
              'partially_filled',
            ].includes(o.status);
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
  );
}

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
  const lastPrices = useRef<Record<string, number>>({});

  const rows = useMemo(
    () =>
      symbols.map((s) => {
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
      }),
    [symbols, snapshots],
  );

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
              <th>%</th>
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
