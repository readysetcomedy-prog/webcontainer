import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  cancelOrder,
  closePosition,
  getAccount,
  getLatestQuotes,
  getLatestTrades,
  listOrders,
  listPositions,
  placeOrder,
} from '../lib/alpaca';
import type {
  AlpacaAccount,
  AlpacaEnv,
  AlpacaOrder,
  AlpacaPosition,
  LatestQuote,
  LatestTrade,
  OrderSide,
  OrderType,
  TimeInForce,
} from '../lib/alpaca';

const ENV_KEY = 'gettrading.env';
const WATCHLIST_KEY = 'gettrading.watchlist';
const DEFAULT_WATCHLIST = ['AAPL', 'MSFT', 'NVDA', 'SPY', 'TSLA'];

function readEnv(): AlpacaEnv {
  if (typeof window === 'undefined') return 'paper';
  return localStorage.getItem(ENV_KEY) === 'live' ? 'live' : 'paper';
}

function readWatchlist(): string[] {
  if (typeof window === 'undefined') return DEFAULT_WATCHLIST;
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY);
    if (!raw) return DEFAULT_WATCHLIST;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((s) => String(s).toUpperCase());
  } catch {
    // ignore
  }
  return DEFAULT_WATCHLIST;
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
  const [quotes, setQuotes] = useState<Record<string, LatestQuote>>({});
  const [trades, setTrades] = useState<Record<string, LatestTrade>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  useEffect(() => {
    localStorage.setItem(ENV_KEY, env);
  }, [env]);

  useEffect(() => {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist));
  }, [watchlist]);

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

  const refreshQuotes = useCallback(async () => {
    const symbols = Array.from(
      new Set([...watchlist, ...positions.map((p) => p.symbol)]),
    ).filter(Boolean);
    if (symbols.length === 0) return;
    try {
      const [q, t] = await Promise.all([
        getLatestQuotes(env, symbols),
        getLatestTrades(env, symbols),
      ]);
      setQuotes(q);
      setTrades(t);
    } catch {
      // Quote feed errors aren't fatal — show stale data quietly.
    }
  }, [env, watchlist, positions]);

  useEffect(() => {
    refreshAccountState();
    const id = setInterval(refreshAccountState, 15_000);
    return () => clearInterval(id);
  }, [refreshAccountState]);

  useEffect(() => {
    refreshQuotes();
    const id = setInterval(refreshQuotes, 5_000);
    return () => clearInterval(id);
  }, [refreshQuotes]);

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
        await refreshQuotes();
      } catch (e) {
        notify('err', (e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [env, notify, refreshAccountState, refreshQuotes],
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
                  'Switch to LIVE trading? Real money, real orders. Make sure your live keys are set in Netlify env.',
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
          <OrderEntry busy={busy} quotes={quotes} onSubmit={handlePlaceOrder} />
        </section>

        <section className="gt-panel">
          <h2>Positions</h2>
          <PositionsTable
            positions={positions}
            quotes={quotes}
            trades={trades}
            onClose={handleClosePosition}
          />
        </section>

        <section className="gt-panel">
          <h2>Watchlist</h2>
          <Watchlist
            symbols={watchlist}
            quotes={quotes}
            trades={trades}
            onAdd={(s) =>
              setWatchlist((prev) =>
                prev.includes(s) ? prev : [...prev, s].slice(0, 25),
              )
            }
            onRemove={(s) =>
              setWatchlist((prev) => prev.filter((x) => x !== s))
            }
          />
        </section>

        <section className="gt-panel gt-panel-wide">
          <h2>Orders (recent 50)</h2>
          <OrdersTable orders={orders} onCancel={handleCancelOrder} />
        </section>
      </div>
    </div>
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
  quotes,
  onSubmit,
}: {
  busy: boolean;
  quotes: Record<string, LatestQuote>;
  onSubmit: (input: {
    symbol: string;
    qty?: number;
    side: OrderSide;
    type: OrderType;
    time_in_force: TimeInForce;
    limit_price?: number;
  }) => void;
}) {
  const [symbol, setSymbol] = useState('');
  const [side, setSide] = useState<OrderSide>('buy');
  const [type, setType] = useState<OrderType>('market');
  const [qty, setQty] = useState('1');
  const [limit, setLimit] = useState('');
  const [tif, setTif] = useState<TimeInForce>('day');

  const sym = symbol.trim().toUpperCase();
  const q = quotes[sym];

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
      {q && (
        <div className="gt-quote-hint">
          Bid {fmtMoney(q.bidPrice)} · Ask {fmtMoney(q.askPrice)}
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
  quotes,
  trades,
  onClose,
}: {
  positions: AlpacaPosition[];
  quotes: Record<string, LatestQuote>;
  trades: Record<string, LatestTrade>;
  onClose: (symbol: string) => void;
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
              trades[p.symbol]?.price ??
              (quotes[p.symbol]
                ? (quotes[p.symbol].bidPrice + quotes[p.symbol].askPrice) / 2
                : parseFloat(p.current_price));
            const pl = parseFloat(p.unrealized_pl);
            return (
              <tr key={p.asset_id}>
                <td className="gt-sym">{p.symbol}</td>
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
            const cancellable = ['new', 'accepted', 'pending_new', 'partially_filled'].includes(
              o.status,
            );
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
  quotes,
  trades,
  onAdd,
  onRemove,
}: {
  symbols: string[];
  quotes: Record<string, LatestQuote>;
  trades: Record<string, LatestTrade>;
  onAdd: (s: string) => void;
  onRemove: (s: string) => void;
}) {
  const [input, setInput] = useState('');
  const lastPrices = useRef<Record<string, number>>({});

  const rows = useMemo(
    () =>
      symbols.map((s) => {
        const last =
          trades[s]?.price ??
          (quotes[s]
            ? (quotes[s].bidPrice + quotes[s].askPrice) / 2
            : undefined);
        const prev = lastPrices.current[s];
        if (last !== undefined) lastPrices.current[s] = last;
        const dir =
          last !== undefined && prev !== undefined
            ? last > prev
              ? 'up'
              : last < prev
              ? 'down'
              : 'flat'
            : 'flat';
        return { symbol: s, last, dir };
      }),
    [symbols, quotes, trades],
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
      <div className="gt-table-wrap">
        <table className="gt-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Last</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol}>
                <td className="gt-sym">{r.symbol}</td>
                <td className={`gt-${r.dir}`}>{fmtMoney(r.last)}</td>
                <td>
                  <button className="gt-link" onClick={() => onRemove(r.symbol)}>
                    Remove
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
