import { getBars, getBarsRange, AlpacaBar, AlpacaEnv } from './alpaca';

export type SlTpUnit = 'pct' | 'usd';

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

export type BacktestVariant = 'A' | 'B' | 'C' | 'D' | 'E';

export const VARIANT_LABELS: Record<BacktestVariant, string> = {
  A: 'Up ≥2% from prev close',
  B: 'Opening-range breakout (9:30–9:45 high)',
  C: 'A + volume ≥2× 20-day avg',
  D: 'A + SPY positive intraday + stock above 10-day trend',
  E: 'Scalp: first green bar after a red bar (re-entry per signal)',
};

export interface BacktestConfig {
  symbols: string[];
  // Period — provide either lookbackDays (trailing) or startDate+endDate
  // (absolute). startDate / endDate are YYYY-MM-DD in ET. If both lookback and
  // range are present, range wins.
  lookbackDays?: number;
  startDate?: string;
  endDate?: string;
  entryHourET: number;
  entryMinuteET: number;
  exitHourET: number;
  exitMinuteET: number;
  // stopLossPct / takeProfitPct are interpreted by stopLossUnit / takeProfitUnit:
  //   'pct' → percent distance from entry  (5 = 5%)
  //   'usd' → flat dollars-per-share offset (5 = $5 below/above entry)
  // Both are *always* measured from the simulated fill (entryBar.close), so the
  // SL/TP distance is exactly what you typed regardless of the underlying
  // stock's price.
  stopLossPct: number;
  takeProfitPct: number;
  stopLossUnit?: SlTpUnit;
  takeProfitUnit?: SlTpUnit;
  positionSize: number;
  variants: BacktestVariant[];
  upPct: number;
  volMultiple: number;
  orbStartMinutes: number;
  // When true, ignore the EOD time exit entirely — every trade is held until
  // it hits SL or TP, even across multiple sessions and overnight gaps. Lets
  // you test "what if I never closed early".
  disableEOD?: boolean;
}

export interface BacktestPeriod {
  startDate: string;
  endDate: string;
  source: 'range' | 'lookback';
}

export interface BacktestTrade {
  symbol: string;
  variant: BacktestVariant;
  date: string;
  entryTime: string;
  entryPrice: number;
  exitTime: string;
  exitPrice: number;
  // 'eod' = forced close at end-of-day time exit.
  // 'window' = ran out of bar data without hitting SL/TP (only with disableEOD).
  exitReason: 'sl' | 'tp' | 'eod' | 'window';
  shares: number;
  pnl: number;
  pnlPct: number;
  // Number of trading sessions held (1 = entry and exit same day).
  daysHeld: number;
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
  exitReasons: { sl: number; tp: number; eod: number; window: number };
  // Sum of $ deployed across all trades (positionSize * count), useful as a
  // denominator for "total return on deployed capital".
  capitalDeployed: number;
  avgDaysHeld: number;
}

export interface BacktestResult {
  config: BacktestConfig;
  period: BacktestPeriod;
  variants: BacktestVariantResult[];
  symbolErrors: Record<string, string>;
  symbolsProcessed: number;
  durationMs: number;
}

function isoDateAddDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function resolvePeriod(config: BacktestConfig): BacktestPeriod {
  if (config.startDate && config.endDate) {
    return { startDate: config.startDate, endDate: config.endDate, source: 'range' };
  }
  if (config.startDate) {
    return {
      startDate: config.startDate,
      endDate: todayIsoDate(),
      source: 'range',
    };
  }
  const lookback = config.lookbackDays ?? 90;
  const endDate = todayIsoDate();
  const startDate = isoDateAddDays(endDate, -lookback);
  return { startDate, endDate, source: 'lookback' };
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
  futureBars: AlpacaBar[],
  config: BacktestConfig,
): BacktestTrade {
  const entryPrice = entryBar.close;
  const shares = config.positionSize / entryPrice;
  // SL/TP distance: pct mode multiplies entryPrice (config value already
  // converted to a decimal, e.g. 0.05 for 5%); usd mode treats the value as a
  // flat dollar offset per share. All distances are measured from the
  // simulated fill, so "5 pips" / "5 USD" is exactly 5 below the entry.
  const slUnit: SlTpUnit = config.stopLossUnit ?? 'pct';
  const tpUnit: SlTpUnit = config.takeProfitUnit ?? 'pct';
  const slDistance =
    slUnit === 'usd' ? config.stopLossPct : entryPrice * config.stopLossPct;
  const tpDistance =
    tpUnit === 'usd' ? config.takeProfitPct : entryPrice * config.takeProfitPct;
  const slPrice = entryPrice - slDistance;
  const tpPrice = entryPrice + tpDistance;

  const finalize = (
    exitBar: AlpacaBar,
    exitPrice: number,
    reason: 'sl' | 'tp' | 'eod' | 'window',
  ): BacktestTrade => {
    const pnl = (exitPrice - entryPrice) * shares;
    const entryDate = etParts(entryBar.time).date;
    const exitDate = etParts(exitBar.time).date;
    // daysHeld: count of distinct ET dates touched, so same-day = 1.
    const daysHeld = exitDate === entryDate
      ? 1
      : Math.max(1, Math.round((new Date(exitDate).getTime() - new Date(entryDate).getTime()) / 86_400_000) + 1);
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
      daysHeld,
    };
  };

  for (const bar of futureBars) {
    // EOD check (only when not disabled). Same-day only: if held overnight,
    // entry-day's EOD has already passed.
    if (!config.disableEOD) {
      const sameDay = etParts(bar.time).date === etParts(entryBar.time).date;
      if (
        sameDay &&
        isAtOrAfterET(bar.time, config.exitHourET, config.exitMinuteET)
      ) {
        return finalize(bar, bar.open, 'eod');
      }
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

  // Ran off the end of available data without hitting SL/TP/EOD.
  const last = futureBars[futureBars.length - 1] ?? entryBar;
  return finalize(last, last.close, config.disableEOD ? 'window' : 'eod');
}

function statsFor(
  variant: BacktestVariant,
  trades: BacktestTrade[],
  positionSize: number,
): BacktestVariantResult {
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const exitReasons = { sl: 0, tp: 0, eod: 0, window: 0 };
  let totalPnL = 0;
  let best = 0;
  let worst = 0;
  let daysSum = 0;
  for (const t of trades) {
    totalPnL += t.pnl;
    exitReasons[t.exitReason]++;
    if (t.pnl > best) best = t.pnl;
    if (t.pnl < worst) worst = t.pnl;
    daysSum += t.daysHeld;
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
    avgDaysHeld: trades.length ? daysSum / trades.length : 0,
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
    D: [],
    E: [],
  };
  let symbolsProcessed = 0;
  const total = config.symbols.length;
  const period = resolvePeriod(config);

  // Variant D needs the broad-market regime at 11 AM ET on each backtest day.
  // Pre-fetch SPY across the full window once and build a date → spyChangePct
  // map; if SPY fetch fails we still run, but D evaluates as "never qualifies".
  // SPY's bars are also used to derive the cumulative intraday move at the
  // entry hour, not just the prev-close → 11 AM bar.
  const spyByDate = new Map<string, number>();
  if (config.variants.includes('D')) {
    try {
      const spyBars = await getBarsRange(
        env,
        'SPY',
        '5Min',
        period.startDate,
        period.endDate,
      );
      const spyDays = groupBarsByETDate(spyBars);
      const sortedDates = [...spyDays.keys()].sort();
      for (let i = 1; i < sortedDates.length; i++) {
        const todayBarsSpy = spyDays.get(sortedDates[i])!;
        const prevBarsSpy = spyDays.get(sortedDates[i - 1])!;
        const prevCloseSpy = prevBarsSpy[prevBarsSpy.length - 1]?.close;
        const entryBarSpy = findBarAtET(
          todayBarsSpy,
          config.entryHourET,
          config.entryMinuteET,
        );
        if (prevCloseSpy && entryBarSpy && prevCloseSpy > 0) {
          spyByDate.set(
            sortedDates[i],
            (entryBarSpy.close - prevCloseSpy) / prevCloseSpy,
          );
        }
      }
    } catch (e) {
      errors['SPY'] = `regime filter unavailable: ${(e as Error).message}`;
    }
  }

  // Fetch bars across the resolved [startDate, endDate] window. Use getBarsRange
  // for both modes — lookback mode just resolves to a trailing range — so the
  // engine has one code path. Suppress 'getBars' unused warning if applicable.
  void getBars;

  const CONCURRENCY = 3;
  for (let i = 0; i < config.symbols.length; i += CONCURRENCY) {
    const chunk = config.symbols.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (sym) => {
        try {
          const bars = await getBarsRange(
            env,
            sym,
            '5Min',
            period.startDate,
            period.endDate,
          );
          processSymbol(sym, bars, config, tradesByVariant, spyByDate);
          if (config.variants.includes('E')) {
            processSymbolScalp(sym, bars, config, tradesByVariant);
          }
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
    period,
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
  spyByDate: Map<string, number>,
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

    // Variant D: regime + trend filter on top of A. Three gates:
    //   1. Same direction signal as A (up ≥ upPct from prev close at 11 ET).
    //   2. SPY is positive intraday at 11 ET (broad market is supportive).
    //   3. Stock's price 10 sessions ago was below today's prev close
    //      (positive 10-day trend on the stock itself — basic relative
    //      strength filter, no SMA library needed).
    // Each filter has solid academic backing for momentum-style trades; the
    // combination cuts out chop-period entries that the user's 30-vs-90 day
    // observation suggested was the killer.
    let dQualifies = false;
    if (config.variants.includes('D') && aQualifies) {
      const spyChange = spyByDate.get(date);
      const spyOk = spyChange !== undefined && spyChange > 0;
      const tenAgoIdx = di - 10;
      const tenAgoClose =
        tenAgoIdx >= 0
          ? byDate.get(dates[tenAgoIdx])?.slice(-1)[0]?.close
          : undefined;
      const trendOk = tenAgoClose !== undefined && prevClose > tenAgoClose;
      dQualifies = spyOk && trendOk;
    }

    for (const variant of config.variants) {
      const qualifies =
        variant === 'A'
          ? aQualifies
          : variant === 'B'
          ? bQualifies
          : variant === 'C'
          ? cQualifies
          : dQualifies;
      if (!qualifies) continue;
      // With disableEOD, the trade can span multiple sessions, so we feed it
      // the full forward window. Without it, sticking to same-day bars is
      // cheaper and equivalent.
      const futureBars = config.disableEOD
        ? bars.filter((b) => b.time > entryBar.time)
        : todayBars.filter((b) => b.time > entryBar.time);
      const trade = simulateTrade(symbol, variant, date, entryBar, futureBars, config);
      tradesByVariant[variant].push(trade);
    }
  }
}

// Scalp scanner — walks every bar of every session looking for the simple
// "first green bar after a red bar" pattern. Unlike processSymbol, which fires
// at most one entry per symbol per day at the configured entry hour, this
// allows MANY trades per session: each completed trade re-arms the scanner
// for the next signal. Position state is single-slot — while in a trade we
// ignore new signals until SL/TP/EOD closes it.
function processSymbolScalp(
  symbol: string,
  bars: AlpacaBar[],
  config: BacktestConfig,
  tradesByVariant: Record<BacktestVariant, BacktestTrade[]>,
) {
  if (bars.length === 0) return;
  const slUnit: SlTpUnit = config.stopLossUnit ?? 'pct';
  const tpUnit: SlTpUnit = config.takeProfitUnit ?? 'pct';
  const byDate = groupBarsByETDate(bars);
  const dates = [...byDate.keys()].sort();

  for (const date of dates) {
    const todayBars = byDate.get(date)!;
    let inPosition:
      | {
          entryBar: AlpacaBar;
          entryPrice: number;
          slPrice: number;
          tpPrice: number;
        }
      | null = null;
    let prevBar: AlpacaBar | null = null;

    for (let i = 0; i < todayBars.length; i++) {
      const bar = todayBars[i];

      // EOD time check: if not holding-until-SL-or-TP, close any open position
      // at the configured exit ET and stop scanning for the day.
      const pastEOD =
        !config.disableEOD &&
        isAtOrAfterET(bar.time, config.exitHourET, config.exitMinuteET);

      if (inPosition) {
        if (pastEOD) {
          tradesByVariant.E.push(
            makeScalpTrade(symbol, date, inPosition, bar, bar.open, 'eod', config.positionSize),
          );
          inPosition = null;
          break;
        }
        // Bar low / high test. Worst-case ordering (SL first) if both touch.
        const hitSL = bar.low <= inPosition.slPrice;
        const hitTP = bar.high >= inPosition.tpPrice;
        if (hitSL) {
          const fill =
            bar.open <= inPosition.slPrice ? bar.open : inPosition.slPrice;
          tradesByVariant.E.push(
            makeScalpTrade(symbol, date, inPosition, bar, fill, 'sl', config.positionSize),
          );
          inPosition = null;
        } else if (hitTP) {
          const fill =
            bar.open >= inPosition.tpPrice ? bar.open : inPosition.tpPrice;
          tradesByVariant.E.push(
            makeScalpTrade(symbol, date, inPosition, bar, fill, 'tp', config.positionSize),
          );
          inPosition = null;
        }
        prevBar = bar;
        continue;
      }

      // Not in a position — look for entry signal.
      if (pastEOD) {
        // No new entries past EOD even with disableEOD off.
        prevBar = bar;
        continue;
      }
      if (prevBar) {
        const prevRed = prevBar.close < prevBar.open;
        const currGreen = bar.close > bar.open;
        if (prevRed && currGreen) {
          const entryPrice = bar.close;
          const slDistance =
            slUnit === 'usd' ? config.stopLossPct : entryPrice * config.stopLossPct;
          const tpDistance =
            tpUnit === 'usd' ? config.takeProfitPct : entryPrice * config.takeProfitPct;
          inPosition = {
            entryBar: bar,
            entryPrice,
            slPrice: entryPrice - slDistance,
            tpPrice: entryPrice + tpDistance,
          };
        }
      }
      prevBar = bar;
    }

    // Session ended with a still-open position. If disableEOD, hold across
    // sessions — but we already broke out earlier in that case via EOD check
    // being skipped. With EOD on, the EOD branch above already closed it. So
    // this branch only matters if the data ran out before EOD (truncated day).
    if (inPosition && todayBars.length > 0) {
      const last = todayBars[todayBars.length - 1];
      tradesByVariant.E.push(
        makeScalpTrade(symbol, date, inPosition, last, last.close, 'window', config.positionSize),
      );
    }
  }
}

function makeScalpTrade(
  symbol: string,
  date: string,
  pos: {
    entryBar: AlpacaBar;
    entryPrice: number;
    slPrice: number;
    tpPrice: number;
  },
  exitBar: AlpacaBar,
  exitPrice: number,
  reason: 'sl' | 'tp' | 'eod' | 'window',
  positionSize: number,
): BacktestTrade {
  // Use the same shares calculation as simulateTrade so total P&L and
  // "return on deployed" are comparable across variants.
  const shares = positionSize / pos.entryPrice;
  return {
    symbol,
    variant: 'E',
    date,
    entryTime: pos.entryBar.time,
    entryPrice: pos.entryPrice,
    exitTime: exitBar.time,
    exitPrice,
    exitReason: reason,
    shares,
    pnl: (exitPrice - pos.entryPrice) * shares,
    pnlPct: (exitPrice - pos.entryPrice) / pos.entryPrice,
    daysHeld: 1,
  };
}
