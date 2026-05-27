import { getBars, AlpacaBar, AlpacaEnv } from './alpaca';

// Returns the ET (America/New_York) calendar date and wall-clock h/m for a UTC
// timestamp. Used for filtering bars to specific times-of-day relative to the
// US trading session.
export function etParts(utcIso: string): { date: string; h: number; m: number } {
  const d = new Date(utcIso);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) parts[p.type] = p.value;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    h: parseInt(parts.hour, 10),
    m: parseInt(parts.minute, 10),
  };
}

export type BacktestVariant = 'A' | 'B' | 'C';

export const VARIANT_LABELS: Record<BacktestVariant, string> = {
  A: 'Up ≥2% from prev close',
  B: 'Opening-range breakout (9:30–9:45 high)',
  C: 'A + volume ≥2× 20-day avg',
};

export interface BacktestConfig {
  symbols: string[];
  lookbackDays: number;
  entryHourET: number;
  entryMinuteET: number;
  exitHourET: number;
  exitMinuteET: number;
  stopLossPct: number;
  takeProfitPct: number;
  positionSize: number;
  variants: BacktestVariant[];
  upPct: number;
  volMultiple: number;
  orbStartMinutes: number;
}

export interface BacktestTrade {
  symbol: string;
  variant: BacktestVariant;
  date: string;
  entryTime: string;
  entryPrice: number;
  exitTime: string;
  exitPrice: number;
  exitReason: 'sl' | 'tp' | 'eod';
  shares: number;
  pnl: number;
  pnlPct: number;
}

export interface BacktestVariantResult {
  variant: BacktestVariant;
  label: string;
  trades: BacktestTrade[];
  totalPnL: number;
  totalTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  bestTrade: number;
  worstTrade: number;
  exitReasons: { sl: number; tp: number; eod: number };
  // Sum of $ deployed across all trades (positionSize * count), useful as a
  // denominator for "total return on deployed capital".
  capitalDeployed: number;
}

export interface BacktestResult {
  config: BacktestConfig;
  variants: BacktestVariantResult[];
  symbolErrors: Record<string, string>;
  symbolsProcessed: number;
  durationMs: number;
}

// Find the bar whose ET wall-clock matches the given hour:minute exactly. With
// 5-minute bars, the 11:00 entry candle is the bar timestamped 11:00 ET (which
// represents 11:00–11:05).
function findBarAtET(bars: AlpacaBar[], hh: number, mm: number): AlpacaBar | null {
  for (const b of bars) {
    const p = etParts(b.time);
    if (p.h === hh && p.m === mm) return b;
  }
  return null;
}

// Group a symbol's bars by ET trading date.
function groupBarsByETDate(bars: AlpacaBar[]): Map<string, AlpacaBar[]> {
  const out = new Map<string, AlpacaBar[]>();
  for (const b of bars) {
    const { date } = etParts(b.time);
    const arr = out.get(date) ?? [];
    arr.push(b);
    out.set(date, arr);
  }
  // Sort each day's bars chronologically just in case.
  for (const arr of out.values()) arr.sort((a, b) => a.time.localeCompare(b.time));
  return out;
}

function isAtOrAfterET(barTime: string, hh: number, mm: number): boolean {
  const p = etParts(barTime);
  return p.h > hh || (p.h === hh && p.m >= mm);
}

function isInETRange(
  barTime: string,
  startH: number,
  startM: number,
  endH: number,
  endM: number,
): boolean {
  const p = etParts(barTime);
  const cur = p.h * 60 + p.m;
  return cur >= startH * 60 + startM && cur < endH * 60 + endM;
}

function simulateTrade(
  symbol: string,
  variant: BacktestVariant,
  date: string,
  entryBar: AlpacaBar,
  todayBars: AlpacaBar[],
  config: BacktestConfig,
): BacktestTrade {
  const entryPrice = entryBar.close;
  const shares = config.positionSize / entryPrice;
  const slPrice = entryPrice * (1 - config.stopLossPct);
  const tpPrice = entryPrice * (1 + config.takeProfitPct);
  const after = todayBars.filter((b) => b.time > entryBar.time);

  const finalize = (
    exitBar: AlpacaBar,
    exitPrice: number,
    reason: 'sl' | 'tp' | 'eod',
  ): BacktestTrade => {
    const pnl = (exitPrice - entryPrice) * shares;
    return {
      symbol,
      variant,
      date,
      entryTime: entryBar.time,
      entryPrice,
      exitTime: exitBar.time,
      exitPrice,
      exitReason: reason,
      shares,
      pnl,
      pnlPct: (exitPrice - entryPrice) / entryPrice,
    };
  };

  for (const bar of after) {
    if (isAtOrAfterET(bar.time, config.exitHourET, config.exitMinuteET)) {
      return finalize(bar, bar.open, 'eod');
    }
    // If a bar gaps through both levels, assume worst-case (SL hits first).
    const hitSL = bar.low <= slPrice;
    const hitTP = bar.high >= tpPrice;
    if (hitSL && hitTP) {
      const fill = bar.open <= slPrice ? bar.open : slPrice;
      return finalize(bar, fill, 'sl');
    }
    if (hitSL) {
      const fill = bar.open <= slPrice ? bar.open : slPrice;
      return finalize(bar, fill, 'sl');
    }
    if (hitTP) {
      const fill = bar.open >= tpPrice ? bar.open : tpPrice;
      return finalize(bar, fill, 'tp');
    }
  }

  // No EOD bar found (e.g. truncated session). Use last available bar.
  const last = after[after.length - 1] ?? entryBar;
  return finalize(last, last.close, 'eod');
}

function statsFor(
  variant: BacktestVariant,
  trades: BacktestTrade[],
  positionSize: number,
): BacktestVariantResult {
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const exitReasons = { sl: 0, tp: 0, eod: 0 };
  let totalPnL = 0;
  let best = 0;
  let worst = 0;
  for (const t of trades) {
    totalPnL += t.pnl;
    exitReasons[t.exitReason]++;
    if (t.pnl > best) best = t.pnl;
    if (t.pnl < worst) worst = t.pnl;
  }
  return {
    variant,
    label: VARIANT_LABELS[variant],
    trades,
    totalPnL,
    totalTrades: trades.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    avgWin: wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0,
    avgLoss: losses.length ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0,
    bestTrade: best,
    worstTrade: worst,
    exitReasons,
    capitalDeployed: trades.length * positionSize,
  };
}

export async function runBacktest(
  env: AlpacaEnv,
  config: BacktestConfig,
  onProgress?: (done: number, total: number) => void,
): Promise<BacktestResult> {
  const t0 = Date.now();
  const errors: Record<string, string> = {};
  const tradesByVariant: Record<BacktestVariant, BacktestTrade[]> = {
    A: [],
    B: [],
    C: [],
  };
  let symbolsProcessed = 0;
  const total = config.symbols.length;

  // Fetch + simulate per symbol in chunks. Chunked to keep concurrency under
  // Alpaca's rate limits while not serializing everything.
  const CONCURRENCY = 3;
  for (let i = 0; i < config.symbols.length; i += CONCURRENCY) {
    const chunk = config.symbols.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (sym) => {
        try {
          const bars = await getBars(env, sym, '5Min', config.lookbackDays);
          processSymbol(sym, bars, config, tradesByVariant);
        } catch (e) {
          errors[sym] = (e as Error).message;
        } finally {
          symbolsProcessed++;
          onProgress?.(symbolsProcessed, total);
        }
      }),
    );
  }

  const variants = config.variants.map((v) =>
    statsFor(v, tradesByVariant[v], config.positionSize),
  );

  return {
    config,
    variants,
    symbolErrors: errors,
    symbolsProcessed,
    durationMs: Date.now() - t0,
  };
}

function processSymbol(
  symbol: string,
  bars: AlpacaBar[],
  config: BacktestConfig,
  tradesByVariant: Record<BacktestVariant, BacktestTrade[]>,
) {
  if (bars.length === 0) return;
  const byDate = groupBarsByETDate(bars);
  const dates = [...byDate.keys()].sort();
  const volByDate: Record<string, number> = {};

  for (let di = 0; di < dates.length; di++) {
    const date = dates[di];
    const todayBars = byDate.get(date)!;
    if (di === 0) continue; // need prev close

    const prevBars = byDate.get(dates[di - 1])!;
    const prevClose = prevBars[prevBars.length - 1]?.close;
    if (!prevClose) continue;

    const entryBar = findBarAtET(todayBars, config.entryHourET, config.entryMinuteET);
    if (!entryBar) continue;
    const entryPrice = entryBar.close;

    // Cumulative volume from session open through the entry bar.
    const volBeforeEntry = todayBars
      .filter((b) => !isAtOrAfterET(b.time, config.entryHourET, config.entryMinuteET + 1))
      .reduce((s, b) => s + b.volume, 0);
    volByDate[date] = volBeforeEntry;

    const upRatio = (entryPrice - prevClose) / prevClose;
    const aQualifies = upRatio >= config.upPct;

    // Variant B: opening-range breakout.
    let bQualifies = false;
    if (config.variants.includes('B')) {
      const orStart = 9 * 60 + 30;
      const orEnd = orStart + config.orbStartMinutes;
      const orbBars = todayBars.filter((b) =>
        isInETRange(b.time, 9, 30, Math.floor(orEnd / 60), orEnd % 60),
      );
      const orbHigh = orbBars.length ? Math.max(...orbBars.map((b) => b.high)) : null;
      if (orbHigh !== null) {
        const window = todayBars.filter(
          (b) =>
            isInETRange(
              b.time,
              Math.floor(orEnd / 60),
              orEnd % 60,
              config.entryHourET,
              config.entryMinuteET + 1,
            ) && b.close > orbHigh,
        );
        bQualifies = window.length > 0;
      }
    }

    // Variant C: A AND volume confirmation.
    let cQualifies = false;
    if (config.variants.includes('C') && aQualifies) {
      const lookback = dates.slice(Math.max(0, di - 20), di);
      const histVols = lookback
        .map((d) => volByDate[d])
        .filter((v): v is number => v !== undefined);
      if (histVols.length >= 5) {
        const avgVol = histVols.reduce((s, v) => s + v, 0) / histVols.length;
        cQualifies = volBeforeEntry >= config.volMultiple * avgVol;
      }
    }

    for (const variant of config.variants) {
      const qualifies =
        variant === 'A' ? aQualifies : variant === 'B' ? bQualifies : cQualifies;
      if (!qualifies) continue;
      const trade = simulateTrade(symbol, variant, date, entryBar, todayBars, config);
      tradesByVariant[variant].push(trade);
    }
  }
}
