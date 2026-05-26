// Typed client for the Alpaca proxy at /api/alpaca/*.
// Keys never live in the browser — the Netlify Function injects them.

export type AlpacaEnv = 'paper' | 'live';

export interface AlpacaAccount {
  id: string;
  account_number: string;
  status: string;
  currency: string;
  cash: string;
  portfolio_value: string;
  equity: string;
  buying_power: string;
  last_equity: string;
  daytrade_count: number;
  pattern_day_trader: boolean;
  trading_blocked: boolean;
  account_blocked: boolean;
}

export interface AlpacaPosition {
  asset_id: string;
  symbol: string;
  exchange: string;
  asset_class: string;
  qty: string;
  avg_entry_price: string;
  side: 'long' | 'short';
  market_value: string;
  cost_basis: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  current_price: string;
  lastday_price: string;
  change_today: string;
}

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit';
export type TimeInForce = 'day' | 'gtc' | 'opg' | 'cls' | 'ioc' | 'fok';

export interface AlpacaOrder {
  id: string;
  client_order_id: string;
  created_at: string;
  updated_at: string;
  submitted_at: string;
  filled_at: string | null;
  symbol: string;
  asset_class: string;
  qty: string | null;
  filled_qty: string;
  type: OrderType;
  side: OrderSide;
  time_in_force: TimeInForce;
  limit_price: string | null;
  stop_price: string | null;
  status: string;
  filled_avg_price: string | null;
}

export interface PlaceOrderInput {
  symbol: string;
  qty?: number;
  notional?: number;
  side: OrderSide;
  type: OrderType;
  time_in_force: TimeInForce;
  limit_price?: number;
  stop_price?: number;
  extended_hours?: boolean;
}

export interface LatestQuote {
  symbol: string;
  bidPrice: number;
  askPrice: number;
  bidSize: number;
  askSize: number;
  timestamp: string;
}

export interface LatestTrade {
  symbol: string;
  price: number;
  size: number;
  timestamp: string;
}

async function call<T>(
  env: AlpacaEnv,
  target: 'trading' | 'data',
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {
    'x-alpaca-env': env,
    'x-alpaca-target': target,
  };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`/api/alpaca/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const msg =
      (parsed as { message?: string; error?: string })?.message ??
      (parsed as { error?: string })?.error ??
      `Alpaca ${res.status}`;
    throw new Error(msg);
  }
  return parsed as T;
}

export function getAccount(env: AlpacaEnv) {
  return call<AlpacaAccount>(env, 'trading', 'GET', 'v2/account');
}

export function listPositions(env: AlpacaEnv) {
  return call<AlpacaPosition[]>(env, 'trading', 'GET', 'v2/positions');
}

export function listOrders(env: AlpacaEnv, status: 'open' | 'closed' | 'all' = 'all', limit = 50) {
  return call<AlpacaOrder[]>(
    env,
    'trading',
    'GET',
    `v2/orders?status=${status}&limit=${limit}&direction=desc`,
  );
}

export function placeOrder(env: AlpacaEnv, input: PlaceOrderInput) {
  return call<AlpacaOrder>(env, 'trading', 'POST', 'v2/orders', input);
}

export function cancelOrder(env: AlpacaEnv, orderId: string) {
  return call<void>(env, 'trading', 'DELETE', `v2/orders/${orderId}`);
}

export function closePosition(env: AlpacaEnv, symbol: string) {
  return call<AlpacaOrder>(env, 'trading', 'DELETE', `v2/positions/${symbol}`);
}

export async function getLatestQuotes(env: AlpacaEnv, symbols: string[]) {
  if (symbols.length === 0) return {} as Record<string, LatestQuote>;
  const list = symbols.map((s) => s.trim().toUpperCase()).filter(Boolean).join(',');
  const res = await call<{ quotes: Record<string, RawQuote> }>(
    env,
    'data',
    'GET',
    `v2/stocks/quotes/latest?symbols=${encodeURIComponent(list)}&feed=iex`,
  );
  const out: Record<string, LatestQuote> = {};
  for (const [sym, q] of Object.entries(res.quotes ?? {})) {
    out[sym] = {
      symbol: sym,
      bidPrice: q.bp,
      askPrice: q.ap,
      bidSize: q.bs,
      askSize: q.as,
      timestamp: q.t,
    };
  }
  return out;
}

export async function getLatestTrades(env: AlpacaEnv, symbols: string[]) {
  if (symbols.length === 0) return {} as Record<string, LatestTrade>;
  const list = symbols.map((s) => s.trim().toUpperCase()).filter(Boolean).join(',');
  const res = await call<{ trades: Record<string, RawTrade> }>(
    env,
    'data',
    'GET',
    `v2/stocks/trades/latest?symbols=${encodeURIComponent(list)}&feed=iex`,
  );
  const out: Record<string, LatestTrade> = {};
  for (const [sym, t] of Object.entries(res.trades ?? {})) {
    out[sym] = { symbol: sym, price: t.p, size: t.s, timestamp: t.t };
  }
  return out;
}

interface RawQuote {
  bp: number;
  ap: number;
  bs: number;
  as: number;
  t: string;
}

interface RawTrade {
  p: number;
  s: number;
  t: string;
}
