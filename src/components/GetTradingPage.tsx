import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  cancelOrder,
  closePosition,
  getClock,
  getAccount,
  getBars,
  getOrder,
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
import BacktestPanel from './BacktestPanel';
import PortfolioBacktestPanel from './PortfolioBacktestPanel';
import CandleChart from './CandleChart';

const ENV_KEY = 'gettrading.env';
const PROFILES_KEY = 'gettrading.profiles';
const ACTIVE_PROFILE_KEY = 'gettrading.activeProfile';

interface AccountProfile {
  id: string;
  name: string;
  env: 'paper' | 'live';
  // BYO keys for additional Alpaca accounts. When unset the proxy falls back
  // to its server-configured ALPACA_PAPER_* / ALPACA_LIVE_* env vars (the
  // "default" profile).
  keyId?: string;
  secret?: string;
  // Used to display "From $X → $Y" deltas; doesn't change Alpaca's actual
  // account balance.
  startingCash?: number;
  createdAt?: number;
}

const DEFAULT_PROFILE: AccountProfile = {
  id: 'default-paper',
  name: 'Default paper',
  env: 'paper',
};

const DEFAULT_PROFILES: AccountProfile[] = [
  DEFAULT_PROFILE,
  { id: 'default-live', name: 'Default live', env: 'live' },
];

const DEFAULT_PROFILE_IDS = new Set(DEFAULT_PROFILES.map((p) => p.id));
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

type ChartRange = '1m' | '5m' | '1D' | '5D' | '1H' | '1Mo' | '1Y' | '5Y';

const RANGE_ORDER: ChartRange[] = ['1m', '5m', '1D', '5D', '1H', '1Mo', '1Y', '5Y'];

const RANGE_CONFIG: Record<
  ChartRange,
  { timeframe: AlpacaTimeframe; lookbackDays: number; intraday: boolean; label: string }
> = {
  '1m': { timeframe: '1Min', lookbackDays: 1, intraday: true, label: '1-min bars · today' },
  '5m': { timeframe: '5Min', lookbackDays: 1, intraday: true, label: '5-min bars · today' },
  '1D': { timeframe: '5Min', lookbackDays: 2, intraday: true, label: '1 day (5-min bars)' },
  '5D': { timeframe: '15Min', lookbackDays: 8, intraday: true, label: '5 days (15-min bars)' },
  '1H': { timeframe: '1Hour', lookbackDays: 30, intraday: true, label: '1-hour bars · 30 days' },
  '1Mo': { timeframe: '1Day', lookbackDays: 35, intraday: false, label: '1 month (daily)' },
  '1Y': { timeframe: '1Day', lookbackDays: 400, intraday: false, label: '1 year (daily)' },
  '5Y': { timeframe: '1Week', lookbackDays: 1900, intraday: false, label: '5 years (weekly)' },
};

const SL_PCT_KEY = 'gettrading.defaultStopLossPct';
const TP_PCT_KEY = 'gettrading.defaultTakeProfitPct';
const SL_UNIT_KEY = 'gettrading.defaultStopLossUnit';
const TP_UNIT_KEY = 'gettrading.defaultTakeProfitUnit';
const DAILY_GUARD_KEY = 'gettrading.dailyGuard';

interface DailyGuard {
  enabled: boolean;
  // Negative number — fires when day P&L drops to or below this (e.g. -200).
  lossLimit: number | null;
  // Positive number — fires when day P&L rises to or above this (e.g. 500).
  profitTarget: number | null;
  // YYYY-MM-DD of the last day the guard triggered. Used to prevent re-firing
  // during the same session if the user opens new positions after the auto-
  // close. Resets the next day naturally.
  triggeredDate: string | null;
}

const DEFAULT_DAILY_GUARD: DailyGuard = {
  enabled: false,
  lossLimit: null,
  profitTarget: null,
  triggeredDate: null,
};

function readDailyGuard(): DailyGuard {
  if (typeof window === 'undefined') return DEFAULT_DAILY_GUARD;
  try {
    const raw = localStorage.getItem(DAILY_GUARD_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DailyGuard>;
      return {
        enabled: parsed.enabled === true,
        lossLimit:
          typeof parsed.lossLimit === 'number' && Number.isFinite(parsed.lossLimit)
            ? parsed.lossLimit
            : null,
        profitTarget:
          typeof parsed.profitTarget === 'number' &&
          Number.isFinite(parsed.profitTarget)
            ? parsed.profitTarget
            : null,
        triggeredDate:
          typeof parsed.triggeredDate === 'string' ? parsed.triggeredDate : null,
      };
    }
  } catch {
    // ignore
  }
  return DEFAULT_DAILY_GUARD;
}

export type SlTpUnit = 'pct' | 'usd';

// Resolve a default SL/TP "distance" — interpreted as either a percent of the
// last price or a flat dollars-per-share offset — into an absolute price for
// the given side. Long-side SL goes *below* last; short-side SL goes above.
export function slTpFromDefault(
  last: number,
  isLong: boolean,
  slValue: number,
  slUnit: SlTpUnit,
  tpValue: number,
  tpUnit: SlTpUnit,
) {
  const slOffset = slUnit === 'pct' ? last * (slValue / 100) : slValue;
  const tpOffset = tpUnit === 'pct' ? last * (tpValue / 100) : tpValue;
  return {
    sl: isLong ? last - slOffset : last + slOffset,
    tp: isLong ? last + tpOffset : last - tpOffset,
  };
}
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

function readProfiles(): AccountProfile[] {
  if (typeof window === 'undefined') return DEFAULT_PROFILES;
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AccountProfile[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Ensure both built-in defaults are always present (so users can flip
        // between server-keyed paper and live without re-adding them).
        const present = new Set(parsed.map((p) => p.id));
        const merged = [...parsed];
        for (const dp of DEFAULT_PROFILES) {
          if (!present.has(dp.id)) merged.push(dp);
        }
        return merged;
      }
    }
  } catch {
    // ignore
  }
  return DEFAULT_PROFILES;
}

function readActiveProfileId(): string {
  if (typeof window === 'undefined') return DEFAULT_PROFILE.id;
  const stored = localStorage.getItem(ACTIVE_PROFILE_KEY);
  if (stored) return stored;
  // Migrate from legacy ENV_KEY-only setup.
  return localStorage.getItem(ENV_KEY) === 'live' ? 'default-live' : DEFAULT_PROFILE.id;
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
  const [profiles, setProfiles] = useState<AccountProfile[]>(readProfiles);
  const [activeProfileId, setActiveProfileId] = useState<string>(readActiveProfileId);
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [editingProfile, setEditingProfile] = useState<AccountProfile | null>(null);
  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === activeProfileId) ?? profiles[0] ?? DEFAULT_PROFILE,
    [profiles, activeProfileId],
  );
  const env: AlpacaEnv = useMemo(
    () =>
      activeProfile.keyId && activeProfile.secret
        ? {
            env: activeProfile.env,
            keyId: activeProfile.keyId,
            secret: activeProfile.secret,
          }
        : activeProfile.env,
    [activeProfile],
  );
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
  const [defaultSlUnit, setDefaultSlUnit] = useState<SlTpUnit>(() =>
    (typeof window !== 'undefined' && localStorage.getItem(SL_UNIT_KEY)) === 'usd' ? 'usd' : 'pct',
  );
  const [defaultTpUnit, setDefaultTpUnit] = useState<SlTpUnit>(() =>
    (typeof window !== 'undefined' && localStorage.getItem(TP_UNIT_KEY)) === 'usd' ? 'usd' : 'pct',
  );
  const [dailyGuard, setDailyGuard] = useState<DailyGuard>(readDailyGuard);
  // While we're firing the auto-close to prevent the monitoring effect from
  // re-entering before triggeredDate has propagated through state.
  const guardFiringRef = useRef(false);
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
    localStorage.setItem(ENV_KEY, activeProfile.env);
    localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
    localStorage.setItem(ACTIVE_PROFILE_KEY, activeProfileId);
  }, [activeProfile.env, profiles, activeProfileId]);

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
    localStorage.setItem(SL_UNIT_KEY, defaultSlUnit);
  }, [defaultSlUnit]);

  useEffect(() => {
    localStorage.setItem(TP_UNIT_KEY, defaultTpUnit);
  }, [defaultTpUnit]);

  useEffect(() => {
    localStorage.setItem(DAILY_GUARD_KEY, JSON.stringify(dailyGuard));
  }, [dailyGuard]);

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

  // Daily-bar cache keyed by symbol. Used by the Momentum strip to compute
  // each name's trailing consecutive-up-day streak. Daily bars only change at
  // session close, so this refreshes infrequently (every 30 min) and doesn't
  // need to chase the snapshot polling cadence.
  const [dailyBars, setDailyBars] = useState<Record<string, AlpacaBar[]>>({});
  const refreshDailyBars = useCallback(async () => {
    if (watchlist.length === 0) return;
    const CONCURRENCY = 4;
    const fresh: Record<string, AlpacaBar[]> = {};
    for (let i = 0; i < watchlist.length; i += CONCURRENCY) {
      const chunk = watchlist.slice(i, i + CONCURRENCY);
      await Promise.all(
        chunk.map(async (sym) => {
          try {
            // ~20 trading days of headroom for the streak count.
            const bars = await getBars(env, sym, '1Day', 30);
            fresh[sym] = bars;
          } catch {
            // Skip symbols we can't fetch; they just won't appear in the strip.
          }
        }),
      );
    }
    setDailyBars(fresh);
  }, [env, watchlist]);

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
    refreshDailyBars();
    const id = setInterval(refreshDailyBars, 30 * 60_000);
    return () => clearInterval(id);
  }, [refreshDailyBars]);

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
        // Fill-relative SL/TP: if this is a market order with SL or TP
        // attached, the user wants the protective levels measured from the
        // actual fill price (avoids "I asked for $5 below entry but slippage
        // made it $4.80"). Bracket / OTO over-the-wire uses absolute prices
        // computed from a stale snapshot, so we split the request:
        //   1. Submit the primary alone, capturing the SL/TP DISTANCES from
        //      the (snapshot, typed-price) pair.
        //   2. Poll until the primary fills.
        //   3. Submit a separate OCO/SL/TP on the position with prices
        //      recomputed from filled_avg_price using those distances.
        // Limit orders skip this — the limit price already pins the expected
        // fill, so distances measured pre-submit are equivalent.
        const hasBracketIntent =
          (input.order_class === 'bracket' || input.order_class === 'oto') &&
          (input.stop_loss || input.take_profit);
        const isMarket = input.type === 'market';
        const snap = snapshots[input.symbol];
        if (hasBracketIntent && isMarket && snap?.last) {
          const isLong = input.side === 'buy';
          const refPrice = snap.last;
          const slPriceIn = input.stop_loss?.stop_price;
          const tpPriceIn = input.take_profit?.limit_price;
          const slDistance =
            typeof slPriceIn === 'number'
              ? isLong
                ? refPrice - slPriceIn
                : slPriceIn - refPrice
              : null;
          const tpDistance =
            typeof tpPriceIn === 'number'
              ? isLong
                ? tpPriceIn - refPrice
                : refPrice - tpPriceIn
              : null;

          // Strip bracket fields from the primary.
          const primaryInput = {
            ...input,
            order_class: undefined,
            stop_loss: undefined,
            take_profit: undefined,
          };
          const primary = await placeOrder(env, primaryInput);
          notify(
            'ok',
            `${primary.side.toUpperCase()} ${primary.qty ?? ''} ${primary.symbol} submitted, waiting for fill…`,
          );

          // Poll until filled (or terminal). Max ~15s — market orders
          // typically fill in <1s during regular hours.
          const terminalBad = new Set(['canceled', 'rejected', 'expired', 'suspended']);
          let order = primary;
          const deadline = Date.now() + 15_000;
          while (Date.now() < deadline) {
            if (order.status === 'filled' || order.status === 'partially_filled') break;
            if (terminalBad.has(order.status)) {
              throw new Error(`Primary order ${order.status} — SL/TP not attached.`);
            }
            await new Promise((r) => setTimeout(r, 500));
            order = await getOrder(env, primary.id);
          }
          if (order.status !== 'filled' && order.status !== 'partially_filled') {
            notify(
              'err',
              `${primary.symbol} still ${order.status} after 15s — SL/TP not attached. Set them on the position once it fills.`,
            );
            await refreshAccountState();
            return;
          }

          const fillPrice = parseFloat(order.filled_avg_price ?? '0');
          const filledQty = parseFloat(order.filled_qty);
          if (!Number.isFinite(fillPrice) || fillPrice <= 0 || !Number.isFinite(filledQty) || filledQty <= 0) {
            notify('err', 'No fill price/qty available — SL/TP not attached.');
            await refreshAccountState();
            return;
          }

          const slFinal =
            slDistance !== null && slDistance > 0
              ? isLong
                ? fillPrice - slDistance
                : fillPrice + slDistance
              : null;
          const tpFinal =
            tpDistance !== null && tpDistance > 0
              ? isLong
                ? fillPrice + tpDistance
                : fillPrice - tpDistance
              : null;

          const closeSide = isLong ? ('sell' as const) : ('buy' as const);
          try {
            if (slFinal !== null && tpFinal !== null) {
              await placeOrder(env, {
                symbol: input.symbol,
                qty: filledQty,
                side: closeSide,
                type: 'limit',
                time_in_force: 'gtc',
                limit_price: tpFinal,
                order_class: 'oco',
                take_profit: { limit_price: tpFinal },
                stop_loss: { stop_price: slFinal },
              });
              notify(
                'ok',
                `${input.symbol} filled at ${fmtMoney(fillPrice)} — SL ${fmtMoney(slFinal)} / TP ${fmtMoney(tpFinal)} attached`,
              );
            } else if (slFinal !== null) {
              await placeOrder(env, {
                symbol: input.symbol,
                qty: filledQty,
                side: closeSide,
                type: 'stop',
                time_in_force: 'gtc',
                stop_price: slFinal,
              });
              notify(
                'ok',
                `${input.symbol} filled at ${fmtMoney(fillPrice)} — SL ${fmtMoney(slFinal)} attached`,
              );
            } else if (tpFinal !== null) {
              await placeOrder(env, {
                symbol: input.symbol,
                qty: filledQty,
                side: closeSide,
                type: 'limit',
                time_in_force: 'gtc',
                limit_price: tpFinal,
              });
              notify(
                'ok',
                `${input.symbol} filled at ${fmtMoney(fillPrice)} — TP ${fmtMoney(tpFinal)} attached`,
              );
            }
          } catch (attachErr) {
            notify(
              'err',
              `${input.symbol} filled at ${fmtMoney(fillPrice)} BUT SL/TP attach failed: ${(attachErr as Error).message}. Set them manually on the position.`,
            );
          }
          await refreshAccountState();
          await refreshSnapshots();
          return;
        }

        // Default path: limit orders, simple market orders, anything without
        // SL/TP intent. Goes straight through as a single bracket / simple
        // request.
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
    [env, notify, refreshAccountState, refreshSnapshots, snapshots],
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

  // Close every open position and cancel every open order, in parallel.
  // Used by the daily P&L guard when the day's P&L crosses the configured
  // threshold; could be exposed as a manual "panic close" button later.
  const closeEverything = useCallback(async (): Promise<{ closed: number; failed: number }> => {
    const openStatuses = new Set([
      'new',
      'pending_new',
      'accepted',
      'partially_filled',
      'pending_replace',
      'replaced',
      'held',
    ]);
    const openOrders = orders.filter((o) => openStatuses.has(o.status));
    await Promise.allSettled(openOrders.map((o) => cancelOrder(env, o.id)));
    // Brief settle for the cancels — Alpaca needs a beat before the held_for_orders
    // qty is released, otherwise the closes fail with insufficient qty.
    if (openOrders.length > 0) {
      await new Promise((r) => setTimeout(r, 1200));
    }
    const results = await Promise.allSettled(
      positions.map((p) => closePosition(env, p.symbol)),
    );
    const closed = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.length - closed;
    await refreshAccountState();
    return { closed, failed };
  }, [env, orders, positions, refreshAccountState]);

  // ET (America/New_York) calendar date — used by the daily guard so a fire
  // at 9pm ET marks the trading session day, not the next-day UTC date.
  const etToday = useCallback(() => {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts: Record<string, string> = {};
    for (const p of fmt.formatToParts(new Date())) parts[p.type] = p.value;
    return `${parts.year}-${parts.month}-${parts.day}`;
  }, []);

  // Daily P&L guard monitor: on every account refresh, check if day P&L has
  // crossed the configured loss limit or profit target. If so (and the guard
  // is enabled, and hasn't already fired today), close everything.
  useEffect(() => {
    if (!dailyGuard.enabled || !account || positions.length === 0) return;
    if (guardFiringRef.current) return;
    const equity = parseFloat(account.equity);
    const lastEquity = parseFloat(account.last_equity);
    if (!Number.isFinite(equity) || !Number.isFinite(lastEquity)) return;
    const dayPnL = equity - lastEquity;
    const today = etToday();
    if (dailyGuard.triggeredDate === today) return;

    const hitLoss =
      dailyGuard.lossLimit !== null && dayPnL <= dailyGuard.lossLimit;
    const hitProfit =
      dailyGuard.profitTarget !== null && dayPnL >= dailyGuard.profitTarget;
    if (!hitLoss && !hitProfit) return;

    guardFiringRef.current = true;
    const which = hitLoss ? 'loss limit' : 'profit target';
    notify(
      'ok',
      `Daily ${which} hit (${dayPnL >= 0 ? '+' : ''}${fmtMoney(dayPnL)}). Closing all positions…`,
    );
    // Mark triggered immediately (using the same ET date the check uses) so a
    // follow-up refresh during the close doesn't re-enter and stack a second
    // close-everything.
    setDailyGuard((g) => ({ ...g, triggeredDate: today }));
    void (async () => {
      try {
        const { closed, failed } = await closeEverything();
        notify(
          failed === 0 ? 'ok' : 'err',
          `Daily guard closed ${closed}/${closed + failed} position${closed + failed === 1 ? '' : 's'}` +
            (failed > 0 ? ' — some failed, check Orders.' : '.'),
        );
      } catch (e) {
        notify('err', `Daily guard error: ${(e as Error).message}`);
      } finally {
        guardFiringRef.current = false;
      }
    })();
  }, [dailyGuard, account, positions, closeEverything, notify, etToday]);

  const handleSetPositionSLTP = useCallback(
    async (p: AlpacaPosition) => {
      const snap = snapshots[p.symbol];
      const last = snap?.last ?? parseFloat(p.current_price);
      const isLong = p.side === 'long';
      const { sl: slNum, tp: tpNum } = slTpFromDefault(
        last,
        isLong,
        defaultSlPct,
        defaultSlUnit,
        defaultTpPct,
        defaultTpUnit,
      );
      const slDefault = slNum.toFixed(2);
      const tpDefault = tpNum.toFixed(2);
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

  const saveProfile = useCallback(
    (next: AccountProfile) => {
      setProfiles((prev) => {
        const existing = prev.findIndex((p) => p.id === next.id);
        if (existing >= 0) {
          const copy = [...prev];
          copy[existing] = next;
          return copy;
        }
        return [...prev, next];
      });
      setActiveProfileId(next.id);
      setShowProfileEditor(false);
      setEditingProfile(null);
    },
    [],
  );

  const deleteProfile = useCallback(
    (id: string) => {
      if (DEFAULT_PROFILE_IDS.has(id)) return;
      if (!confirm('Delete this account profile? Local-only — Alpaca account is untouched.')) {
        return;
      }
      setProfiles((prev) => prev.filter((p) => p.id !== id));
      setActiveProfileId((cur) => (cur === id ? DEFAULT_PROFILE.id : cur));
      setShowProfileEditor(false);
      setEditingProfile(null);
    },
    [],
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
        <div className="gt-profile-picker">
          <select
            value={activeProfileId}
            onChange={(e) => {
              const next = profiles.find((p) => p.id === e.target.value);
              if (
                next?.env === 'live' &&
                activeProfile.env !== 'live' &&
                !confirm(
                  `Switch to LIVE account "${next.name}"? Real money, real orders.`,
                )
              )
                return;
              setActiveProfileId(e.target.value);
            }}
            title="Active account"
            className={activeProfile.env === 'live' ? 'gt-profile-live' : ''}
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.env}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="gt-link"
            onClick={() => {
              setEditingProfile(null);
              setShowProfileEditor(true);
            }}
            title="Add a new Alpaca account profile"
          >
            + add
          </button>
          <button
            type="button"
            className="gt-link"
            onClick={() => {
              setEditingProfile(activeProfile);
              setShowProfileEditor(true);
            }}
            title="Edit this profile"
          >
            edit
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
        {activeProfile.startingCash && account ? (
          <AccountStat
            label={`vs $${activeProfile.startingCash.toLocaleString()} start`}
            value={(() => {
              const delta = parseFloat(account.equity) - activeProfile.startingCash;
              const pct = (delta / activeProfile.startingCash) * 100;
              return `${delta >= 0 ? '+' : ''}${fmtMoney(delta)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`;
            })()}
            tone={
              parseFloat(account.equity) - activeProfile.startingCash >= 0 ? 'pos' : 'neg'
            }
          />
        ) : null}
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

      <section className="gt-daily-guard">
        <label className="gt-check gt-daily-guard-toggle">
          <input
            type="checkbox"
            checked={dailyGuard.enabled}
            onChange={(e) =>
              setDailyGuard((g) => ({ ...g, enabled: e.target.checked }))
            }
          />
          <strong>Daily P&amp;L guard</strong>
          <span className="gt-muted">
            auto-close all positions when day P&amp;L hits either limit
          </span>
        </label>
        <label className="gt-field gt-inline-field">
          <span>Loss limit ($, negative)</span>
          <input
            type="number"
            step="any"
            placeholder="e.g. -200"
            value={dailyGuard.lossLimit ?? ''}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              setDailyGuard((g) => ({
                ...g,
                lossLimit: Number.isFinite(v) ? v : null,
              }));
            }}
          />
        </label>
        <label className="gt-field gt-inline-field">
          <span>Profit target ($)</span>
          <input
            type="number"
            step="any"
            placeholder="e.g. 500"
            value={dailyGuard.profitTarget ?? ''}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              setDailyGuard((g) => ({
                ...g,
                profitTarget: Number.isFinite(v) ? v : null,
              }));
            }}
          />
        </label>
        {(() => {
          const today = etToday();
          const dayPnL = account
            ? parseFloat(account.equity) - parseFloat(account.last_equity)
            : NaN;
          const triggeredToday = dailyGuard.triggeredDate === today;
          // Status logic (mirrors the guard effect's gate ordering so the user
          // sees the same reasoning the monitor uses).
          let status: { label: string; cls: string } = {
            label: 'disabled',
            cls: 'gt-muted',
          };
          if (dailyGuard.enabled) {
            if (triggeredToday) status = { label: '✓ triggered today', cls: 'gt-muted' };
            else if (!account) status = { label: 'waiting for account', cls: 'gt-muted' };
            else if (positions.length === 0)
              status = { label: 'idle (no open positions to close)', cls: 'gt-muted' };
            else if (dailyGuard.lossLimit === null && dailyGuard.profitTarget === null)
              status = { label: 'set a limit to arm', cls: 'gt-muted' };
            else status = { label: '● armed', cls: 'pos' };
          }
          return (
            <div className="gt-guard-status">
              <span className={status.cls}>{status.label}</span>
              {dailyGuard.enabled && account && Number.isFinite(dayPnL) && (
                <span className="gt-muted">
                  · current day P&amp;L (what's tracked):{' '}
                  <strong className={dayPnL >= 0 ? 'pos' : 'neg'}>
                    {dayPnL >= 0 ? '+' : ''}
                    {fmtMoney(dayPnL)}
                  </strong>
                </span>
              )}
              {triggeredToday && (
                <button
                  type="button"
                  className="gt-link"
                  onClick={() =>
                    setDailyGuard((g) => ({ ...g, triggeredDate: null }))
                  }
                >
                  reset (re-arm same day)
                </button>
              )}
            </div>
          );
        })()}
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
            defaultSlUnit={defaultSlUnit}
            defaultTpUnit={defaultTpUnit}
            onChangeDefaultSlUnit={setDefaultSlUnit}
            onChangeDefaultTpUnit={setDefaultTpUnit}
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

      <MomentumStrip
        symbols={watchlist}
        snapshots={snapshots}
        dailyBars={dailyBars}
        selected={selectedSymbol}
        onSelect={setSelectedSymbol}
      />

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

      <CollapsiblePanel
        wide
        title="Backtester"
        collapsed={collapsed.backtest === undefined ? true : !!collapsed.backtest}
        onToggle={() => toggleCollapsed('backtest')}
      >
        <BacktestPanel env={env} symbols={watchlist} />
      </CollapsiblePanel>

      <CollapsiblePanel
        wide
        title="Portfolio backtester (daily total SL/TP)"
        collapsed={
          collapsed.portfolioBacktest === undefined
            ? true
            : !!collapsed.portfolioBacktest
        }
        onToggle={() => toggleCollapsed('portfolioBacktest')}
      >
        <PortfolioBacktestPanel env={env} symbols={watchlist} />
      </CollapsiblePanel>

      {showProfileEditor && (
        <ProfileEditor
          profile={editingProfile}
          isDefault={
            editingProfile ? DEFAULT_PROFILE_IDS.has(editingProfile.id) : false
          }
          existingIds={profiles.map((p) => p.id)}
          onSave={saveProfile}
          onDelete={
            editingProfile && !DEFAULT_PROFILE_IDS.has(editingProfile.id)
              ? () => deleteProfile(editingProfile.id)
              : undefined
          }
          onCancel={() => {
            setShowProfileEditor(false);
            setEditingProfile(null);
          }}
        />
      )}
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
  defaultSlUnit,
  defaultTpUnit,
  onChangeDefaultSlPct,
  onChangeDefaultTpPct,
  onChangeDefaultSlUnit,
  onChangeDefaultTpUnit,
  onSubmit,
}: {
  busy: boolean;
  symbol: string;
  snapshots: Record<string, AlpacaSnapshot>;
  positions: AlpacaPosition[];
  buyingPower: number;
  defaultSlPct: number;
  defaultTpPct: number;
  defaultSlUnit: SlTpUnit;
  defaultTpUnit: SlTpUnit;
  onChangeDefaultSlPct: (n: number) => void;
  onChangeDefaultTpPct: (n: number) => void;
  onChangeDefaultSlUnit: (u: SlTpUnit) => void;
  onChangeDefaultTpUnit: (u: SlTpUnit) => void;
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
  // SL/TP from the user's default percentages OR per-share $ offsets. Skip
  // after that so live ticks don't overwrite the user's edits.
  useEffect(() => {
    const key = `${sym}|${side}`;
    if (!sym || !snap?.last || computedForRef.current === key) return;
    const { sl, tp } = slTpFromDefault(
      snap.last,
      side === 'buy',
      defaultSlPct,
      defaultSlUnit,
      defaultTpPct,
      defaultTpUnit,
    );
    setStopPrice(sl.toFixed(2));
    setTakePrice(tp.toFixed(2));
    computedForRef.current = key;
  }, [sym, side, snap?.last, defaultSlPct, defaultTpPct, defaultSlUnit, defaultTpUnit]);

  function recomputeFromDefaults() {
    if (!snap?.last) return;
    const { sl, tp } = slTpFromDefault(
      snap.last,
      side === 'buy',
      defaultSlPct,
      defaultSlUnit,
      defaultTpPct,
      defaultTpUnit,
    );
    setStopPrice(sl.toFixed(2));
    setTakePrice(tp.toFixed(2));
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
            <div className="gt-qty-mode" role="group">
              <button
                type="button"
                className={defaultSlUnit === 'pct' ? 'active' : ''}
                onClick={() => onChangeDefaultSlUnit('pct')}
                title="% from entry price"
              >
                %
              </button>
              <button
                type="button"
                className={defaultSlUnit === 'usd' ? 'active' : ''}
                onClick={() => onChangeDefaultSlUnit('usd')}
                title="$ per share — flat dollar offset (e.g. 0.50 = $0.50 below entry)"
              >
                $
              </button>
            </div>
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
            <div className="gt-qty-mode" role="group">
              <button
                type="button"
                className={defaultTpUnit === 'pct' ? 'active' : ''}
                onClick={() => onChangeDefaultTpUnit('pct')}
                title="% from entry price"
              >
                %
              </button>
              <button
                type="button"
                className={defaultTpUnit === 'usd' ? 'active' : ''}
                onClick={() => onChangeDefaultTpUnit('usd')}
                title="$ per share — flat dollar offset (e.g. 0.50 = $0.50 above entry)"
              >
                $
              </button>
            </div>
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
  // Roll up the unrealized P&L across all open positions so the user has a
  // single "where am I right now" number without doing mental math.
  const totalUnrealized = positions.reduce(
    (s, p) => s + (parseFloat(p.unrealized_pl) || 0),
    0,
  );
  const totalMktValue = positions.reduce(
    (s, p) => s + (parseFloat(p.market_value) || 0),
    0,
  );
  const totalCost = positions.reduce((s, p) => {
    const qty = Math.abs(parseFloat(p.qty) || 0);
    const avg = parseFloat(p.avg_entry_price) || 0;
    return s + qty * avg;
  }, 0);
  const totalPct = totalCost > 0 ? (totalUnrealized / totalCost) * 100 : 0;
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
        <tfoot>
          <tr className="gt-totals-row">
            <td colSpan={5} className="gt-totals-label">
              Total ({positions.length} position{positions.length === 1 ? '' : 's'})
            </td>
            <td>{fmtMoney(totalMktValue)}</td>
            <td className={totalUnrealized >= 0 ? 'pos' : 'neg'}>
              {totalUnrealized >= 0 ? '+' : ''}
              {fmtMoney(totalUnrealized)} (
              {totalPct >= 0 ? '+' : ''}
              {totalPct.toFixed(2)}%)
            </td>
            <td></td>
          </tr>
        </tfoot>
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

// Trailing consecutive up-days based on daily bars. "Up day" = today's close
// is strictly greater than the previous trading day's close. Walks backward
// from the most recent bar and stops at the first non-up day. Bars don't have
// to be pre-sorted — we sort by time first.
function consecutiveUpDays(bars: AlpacaBar[] | undefined): number {
  if (!bars || bars.length < 2) return 0;
  const sorted = [...bars].sort((a, b) => a.time.localeCompare(b.time));
  let streak = 0;
  for (let i = sorted.length - 1; i > 0; i--) {
    if (sorted[i].close > sorted[i - 1].close) streak++;
    else break;
  }
  return streak;
}

type MomentumSort = 'streak' | 'pct';

function MomentumStrip({
  symbols,
  snapshots,
  dailyBars,
  selected,
  onSelect,
}: {
  symbols: string[];
  snapshots: Record<string, AlpacaSnapshot>;
  dailyBars: Record<string, AlpacaBar[]>;
  selected: string;
  onSelect: (s: string) => void;
}) {
  const [sortMode, setSortMode] = useState<MomentumSort>('streak');
  const [pctThreshold, setPctThreshold] = useState(2);
  const [streakThreshold, setStreakThreshold] = useState(5);

  // Filter: today's change ≥ pctThreshold AND trailing up-streak ≥ streakThreshold.
  // Streak comes from the daily-bar cache; if we don't have bars for a symbol
  // yet (slow fetch, error), it's excluded — accurate-or-nothing.
  const candidates = useMemo(() => {
    const list: { symbol: string; changePct: number; streak: number }[] = [];
    for (const sym of symbols) {
      const snap = snapshots[sym];
      if (!snap || !Number.isFinite(snap.changePct)) continue;
      const pct = snap.changePct * 100;
      if (pct < pctThreshold) continue;
      const streak = consecutiveUpDays(dailyBars[sym]);
      if (streak < streakThreshold) continue;
      list.push({ symbol: sym, changePct: pct, streak });
    }
    list.sort((a, b) => {
      if (sortMode === 'streak') {
        return b.streak - a.streak || b.changePct - a.changePct;
      }
      return b.changePct - a.changePct || b.streak - a.streak;
    });
    return list;
  }, [symbols, snapshots, dailyBars, sortMode, pctThreshold, streakThreshold]);

  return (
    <section className="gt-momentum">
      <div className="gt-momentum-head">
        <strong>Momentum</strong>
        <span className="gt-muted">
          up ≥
          <input
            type="number"
            step="0.5"
            min="0"
            value={pctThreshold}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (Number.isFinite(v) && v >= 0) setPctThreshold(v);
            }}
            className="gt-mom-input"
          />
          % today AND ≥
          <input
            type="number"
            step="1"
            min="1"
            value={streakThreshold}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (Number.isFinite(v) && v >= 1) setStreakThreshold(v);
            }}
            className="gt-mom-input"
          />
          -day up streak
        </span>
        <div className="gt-side-toggle gt-momentum-sort" role="group">
          <button
            type="button"
            className={sortMode === 'streak' ? 'active' : ''}
            onClick={() => setSortMode('streak')}
            title="Sort by longest up streak first"
          >
            streak ▼
          </button>
          <button
            type="button"
            className={sortMode === 'pct' ? 'active' : ''}
            onClick={() => setSortMode('pct')}
            title="Sort by biggest % gainer first"
          >
            % today ▼
          </button>
        </div>
        <span className="gt-muted gt-momentum-count">
          {candidates.length} match{candidates.length === 1 ? '' : 'es'}
        </span>
      </div>
      {candidates.length === 0 ? (
        <div className="gt-empty gt-momentum-empty">
          No watchlist symbols currently match. Either the filters are too
          tight or no names are trending right now.
        </div>
      ) : (
        <div className="gt-momentum-scroll">
          {candidates.map((c) => (
            <button
              key={c.symbol}
              type="button"
              className={`gt-momentum-tile ${selected === c.symbol ? 'active' : ''}`}
              onClick={() => onSelect(c.symbol)}
              title={`Click to load ${c.symbol} into the order form / chart`}
            >
              <div className="gt-momentum-pct pos">
                +{c.changePct.toFixed(2)}%
              </div>
              <div className="gt-momentum-streak">
                {c.streak}d up
              </div>
              <div className="gt-momentum-sym">{c.symbol}</div>
            </button>
          ))}
        </div>
      )}
    </section>
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

function ProfileEditor({
  profile,
  isDefault,
  existingIds,
  onSave,
  onDelete,
  onCancel,
}: {
  profile: AccountProfile | null;
  isDefault: boolean;
  existingIds: string[];
  onSave: (p: AccountProfile) => void;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const isEdit = profile !== null;
  const [name, setName] = useState(profile?.name ?? '');
  const [env, setEnv] = useState<'paper' | 'live'>(profile?.env ?? 'paper');
  const [keyId, setKeyId] = useState(profile?.keyId ?? '');
  const [secret, setSecret] = useState(profile?.secret ?? '');
  const [startingCash, setStartingCash] = useState(
    profile?.startingCash ? String(profile.startingCash) : '',
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const next: AccountProfile = {
      id: profile?.id ?? `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim(),
      env,
      createdAt: profile?.createdAt ?? Date.now(),
      ...(keyId.trim() && secret.trim()
        ? { keyId: keyId.trim(), secret: secret.trim() }
        : {}),
      ...(startingCash && Number.isFinite(parseFloat(startingCash))
        ? { startingCash: parseFloat(startingCash) }
        : {}),
    };
    // Avoid id collisions if the user does something exotic.
    if (!isEdit && existingIds.includes(next.id)) {
      next.id = `${next.id}-${Math.random().toString(36).slice(2, 6)}`;
    }
    onSave(next);
  }

  return (
    <div className="gt-modal-backdrop" onClick={onCancel}>
      <div className="gt-modal" onClick={(e) => e.stopPropagation()}>
        <form className="gt-modal-form" onSubmit={submit}>
          <h3>{isEdit ? 'Edit account' : 'Add account'}</h3>
          <label className="gt-field">
            <span>Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Strategy A test"
              autoFocus
              required
              disabled={isDefault}
            />
          </label>
          <label className="gt-field">
            <span>Environment</span>
            <select
              value={env}
              onChange={(e) => setEnv(e.target.value as 'paper' | 'live')}
              disabled={isDefault}
            >
              <option value="paper">Paper</option>
              <option value="live">Live</option>
            </select>
          </label>
          {!isDefault && (
            <>
              <label className="gt-field">
                <span>
                  Alpaca API Key ID
                  <em className="gt-est">
                    {' '}
                    optional — leave blank to use default server keys
                  </em>
                </span>
                <input
                  type="text"
                  value={keyId}
                  onChange={(e) => setKeyId(e.target.value)}
                  placeholder="PKxxx... (paper) or AKxxx... (live)"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <label className="gt-field">
                <span>Alpaca API Secret</span>
                <input
                  type="password"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder="paste secret"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <div className="gt-note">
                Keys are stored in your browser's localStorage. Anyone with access to
                this browser profile can read them — only paste keys for accounts
                you own.
              </div>
            </>
          )}
          <label className="gt-field">
            <span>
              Starting cash baseline <em className="gt-est">(optional)</em>
            </span>
            <input
              type="number"
              step="any"
              min="0"
              value={startingCash}
              onChange={(e) => setStartingCash(e.target.value)}
              placeholder="e.g. 1000"
            />
            <div className="gt-note">
              Just a display baseline for "From $X → $Y" tracking. Doesn't change
              Alpaca's actual balance (paper starts at $100,000).
            </div>
          </label>
          <div className="gt-modal-actions">
            {onDelete && (
              <button type="button" className="gt-btn gt-btn-danger" onClick={onDelete}>
                Delete
              </button>
            )}
            <div style={{ flex: 1 }} />
            <button type="button" className="gt-btn" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="gt-btn gt-btn-primary">
              {isEdit ? 'Save' : 'Add account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
