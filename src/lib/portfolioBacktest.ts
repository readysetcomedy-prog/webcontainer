import { getBarsRange, AlpacaBar, AlpacaEnv } from './alpaca';
import { etParts } from './backtest';

// Portfolio-level backtester: at entry time each day, buy every watchlist
// symbol up ≥ upPct from its prev close. SL/TP are TOTAL portfolio thresholds
// (combined realized + unrealized $), not per-trade. When the portfolio's
// running P&L crosses either threshold, EVERY open position closes
// simultaneously. EOD behavior is the same toggle as the other backtester —
// when on, force-close at exit time each day; when off, hold across sessions
// until SL or TP fires.

export interface PortfolioBacktestConfig {
  symbols: string[];
  // Period — same shape as the per-trade backtester.
  lookbackDays?: number;
  startDate?: string;
  endDate?: string;
  // Entry time in ET wall-clock. Default 11:00 ET = 10:00 CT.
  entryHourET: number;
  entryMinuteET: number;
  // EOD force-close time (only used when disableEOD is false).
  exitHourET: number;
  exitMinuteET: number;
  // Entry qualifier — % up from prev close required at entry bar.
  upPct: number;
  // Per-position notional dollar size (e.g. $100).
  positionSize: number;
  // Portfolio-level $ thresholds. Either or both can be set.
  //   lossLimit is a NEGATIVE number; we trigger when totalPnL <= lossLimit.
  //   profitTarget is POSITIVE;     we trigger when totalPnL >= profitTarget.
  lossLimit: number | null;
  profitTarget: number | null;
  // When true, positions force-close at exit time each day. When false,
  // positions carry across sessions (including overnight gaps) until the
  // portfolio SL or TP fires, or the data window ends.
  disableEOD?: boolean;
}

export interface PortfolioBacktestPeriod {
  startDate: string;
  endDate: string;
  source: 'range' | 'lookback';
}

// A single entry into the portfolio.
export interface PortfolioPositionTrade {
  symbol: string;
  entryDate: string;
  entryTime: string;
  entryPrice: number;
  exitTime: string;
  exitPrice: number;
  shares: number;
  pnl: number;
  pnlPct: number;
}

// One cycle = first-entry → all-close (via SL / TP / EOD / window).
// In EOD-on mode, cycles tend to be one trading day. In EOD-off mode, a
// cycle can span many days as new entries accumulate until SL/TP fires.
export interface PortfolioCycle {
  startDate: string;
  endDate: string;
  endReason: 'sl' | 'tp' | 'eod' | 'window';
  positions: PortfolioPositionTrade[];
  totalPnL: number;
  uniqueSymbols: number;
  daysActive: number;
}

export interface PortfolioBacktestResult {
  config: PortfolioBacktestConfig;
  period: PortfolioBacktestPeriod;
  cycles: PortfolioCycle[];
  // Aggregate stats across all cycles.
  totalPnL: number;
  totalEntries: number;
  totalCycles: number;
  winningCycles: number;
  losingCycles: number;
  bestCycle: number;
  worstCycle: number;
  endReasons: { sl: number; tp: number; eod: number; window: number };
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

function resolvePeriod(config: PortfolioBacktestConfig): PortfolioBacktestPeriod {
  if (config.startDate && config.endDate) {
    return { startDate: config.startDate, endDate: config.endDate, source: 'range' };
  }
  if (config.startDate) {
    return { startDate: config.startDate, endDate: todayIsoDate(), source: 'range' };
  }
  const lookback = config.lookbackDays ?? 90;
  const endDate = todayIsoDate();
  return { startDate: isoDateAddDays(endDate, -lookback), endDate, source: 'lookback' };
}

function isAtOrAfterET(barTime: string, hh: number, mm: number): boolean {
  const p = etParts(barTime);
  return p.h > hh || (p.h === hh && p.m >= mm);
}

// State carried within a running cycle.
interface OpenPosition {
  symbol: string;
  entryDate: string;
  entryTime: string;
  entryPrice: number;
  shares: number;
  // Last seen mark price — used when a symbol has missing bars at the current
  // timestamp (e.g. data gap) so the MTM doesn't whiplash.
  lastMarkPrice: number;
}

export async function runPortfolioBacktest(
  env: AlpacaEnv,
  config: PortfolioBacktestConfig,
  onProgress?: (done: number, total: number) => void,
): Promise<PortfolioBacktestResult> {
  const t0 = Date.now();
  const period = resolvePeriod(config);
  const errors: Record<string, string> = {};
  let symbolsProcessed = 0;
  const total = config.symbols.length;

  // 1. Fetch 5-min bars for every symbol over the resolved window.
  const barsBySymbol: Record<string, AlpacaBar[]> = {};
  const CONCURRENCY = 3;
  for (let i = 0; i < config.symbols.length; i += CONCURRENCY) {
    const chunk = config.symbols.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (sym) => {
        try {
          barsBySymbol[sym] = await getBarsRange(
            env,
            sym,
            '5Min',
            period.startDate,
            period.endDate,
          );
        } catch (e) {
          errors[sym] = (e as Error).message;
        } finally {
          symbolsProcessed++;
          onProgress?.(symbolsProcessed, total);
        }
      }),
    );
  }

  // 2. Per-symbol indices:
  //   - barsBySymbolByDate: bars grouped by ET trading date for fast access
  //   - barByTimeForSymbol: timestamp → bar for direct lookups during the
  //     intraday walk
  const barsBySymbolByDate: Record<string, Map<string, AlpacaBar[]>> = {};
  const barByTimeForSymbol: Record<string, Map<string, AlpacaBar>> = {};
  const allDatesSet = new Set<string>();
  for (const sym of Object.keys(barsBySymbol)) {
    const byDate = new Map<string, AlpacaBar[]>();
    const byTime = new Map<string, AlpacaBar>();
    for (const bar of barsBySymbol[sym]) {
      const { date } = etParts(bar.time);
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date)!.push(bar);
      byTime.set(bar.time, bar);
      allDatesSet.add(date);
    }
    for (const arr of byDate.values()) arr.sort((a, b) => a.time.localeCompare(b.time));
    barsBySymbolByDate[sym] = byDate;
    barByTimeForSymbol[sym] = byTime;
  }
  const allDates = [...allDatesSet].sort();

  // 3. Walk dates chronologically, simulating the portfolio.
  const cycles: PortfolioCycle[] = [];
  let openPositions: OpenPosition[] = [];
  let cycleStartDate: string | null = null;
  // Track the *master timeline* of timestamps to walk on each date. Use the
  // union of all symbols' bars on that date so we don't miss a fast move on
  // any single symbol.
  const closeCycle = (
    endReason: 'sl' | 'tp' | 'eod' | 'window',
    exitTime: string,
    exitPriceLookup: (p: OpenPosition) => number,
    endDate: string,
  ) => {
    if (openPositions.length === 0) return;
    const trades: PortfolioPositionTrade[] = openPositions.map((p) => {
      const exitPrice = exitPriceLookup(p);
      return {
        symbol: p.symbol,
        entryDate: p.entryDate,
        entryTime: p.entryTime,
        entryPrice: p.entryPrice,
        exitTime,
        exitPrice,
        shares: p.shares,
        pnl: (exitPrice - p.entryPrice) * p.shares,
        pnlPct: (exitPrice - p.entryPrice) / p.entryPrice,
      };
    });
    const totalPnL = trades.reduce((s, t) => s + t.pnl, 0);
    const uniqueSymbols = new Set(trades.map((t) => t.symbol)).size;
    // daysActive: distinct dates between cycleStartDate and endDate, inclusive.
    const daysActive = Math.max(
      1,
      allDates.filter((d) => cycleStartDate !== null && d >= cycleStartDate && d <= endDate)
        .length,
    );
    cycles.push({
      startDate: cycleStartDate ?? endDate,
      endDate,
      endReason,
      positions: trades,
      totalPnL,
      uniqueSymbols,
      daysActive,
    });
    openPositions = [];
    cycleStartDate = null;
  };

  for (let di = 0; di < allDates.length; di++) {
    const date = allDates[di];
    const prevDate = di > 0 ? allDates[di - 1] : null;

    // 3a. At entry time, scan for new qualifying symbols (only those not
    // already in the open portfolio).
    for (const sym of config.symbols) {
      if (openPositions.some((p) => p.symbol === sym)) continue;
      const todayBars = barsBySymbolByDate[sym]?.get(date);
      if (!todayBars) continue;
      const entryBar = todayBars.find((b) => {
        const p = etParts(b.time);
        return p.h === config.entryHourET && p.m === config.entryMinuteET;
      });
      if (!entryBar) continue;
      const prevBars = prevDate ? barsBySymbolByDate[sym]?.get(prevDate) : undefined;
      const prevClose = prevBars?.[prevBars.length - 1]?.close;
      if (!prevClose) continue;
      const upPctActual = (entryBar.close - prevClose) / prevClose;
      if (upPctActual < config.upPct) continue;
      const shares = config.positionSize / entryBar.close;
      openPositions.push({
        symbol: sym,
        entryDate: date,
        entryTime: entryBar.time,
        entryPrice: entryBar.close,
        shares,
        lastMarkPrice: entryBar.close,
      });
      if (cycleStartDate === null) cycleStartDate = date;
    }

    if (openPositions.length === 0) continue;

    // 3b. Walk this date's timestamps from entry time onward across the union
    // of open positions' bars. Check SL/TP/EOD at each timestamp.
    const timestampSet = new Set<string>();
    for (const p of openPositions) {
      const byDate = barsBySymbolByDate[p.symbol]?.get(date) ?? [];
      for (const b of byDate) {
        const parts = etParts(b.time);
        // Only include timestamps at or after the entry time on this date.
        if (
          parts.h > config.entryHourET ||
          (parts.h === config.entryHourET && parts.m >= config.entryMinuteET)
        ) {
          timestampSet.add(b.time);
        }
      }
    }
    const timestamps = [...timestampSet].sort();

    let cycleEndedThisDay = false;
    for (const ts of timestamps) {
      // Mark to market: each position uses its bar at ts if present, else the
      // last seen mark price for the position.
      let unrealized = 0;
      for (const p of openPositions) {
        const bar = barByTimeForSymbol[p.symbol]?.get(ts);
        if (bar) p.lastMarkPrice = bar.close;
        unrealized += (p.lastMarkPrice - p.entryPrice) * p.shares;
      }
      const totalPnL = unrealized; // No realized yet — nothing closed mid-cycle.

      const hitProfit =
        config.profitTarget !== null && totalPnL >= config.profitTarget;
      const hitLoss =
        config.lossLimit !== null && totalPnL <= config.lossLimit;
      if (hitProfit || hitLoss) {
        closeCycle(
          hitProfit ? 'tp' : 'sl',
          ts,
          (p) => barByTimeForSymbol[p.symbol]?.get(ts)?.close ?? p.lastMarkPrice,
          date,
        );
        cycleEndedThisDay = true;
        break;
      }

      // EOD force-close (only if not disabled).
      if (!config.disableEOD && isAtOrAfterET(ts, config.exitHourET, config.exitMinuteET)) {
        closeCycle(
          'eod',
          ts,
          (p) => barByTimeForSymbol[p.symbol]?.get(ts)?.open ?? p.lastMarkPrice,
          date,
        );
        cycleEndedThisDay = true;
        break;
      }
    }

    // 3c. If positions are still open at end of session and EOD is OFF, they
    // carry to the next date — nothing to do here. If EOD is ON but we never
    // hit the exit time bar (e.g. truncated day), force-close at last bar.
    if (!cycleEndedThisDay && !config.disableEOD && openPositions.length > 0) {
      const lastTs = timestamps[timestamps.length - 1];
      if (lastTs) {
        closeCycle(
          'eod',
          lastTs,
          (p) => barByTimeForSymbol[p.symbol]?.get(lastTs)?.close ?? p.lastMarkPrice,
          date,
        );
      }
    }
  }

  // 4. End of window — any leftover open positions (only possible with
  // disableEOD) get a 'window' close at their last known mark price.
  if (openPositions.length > 0) {
    const lastDate = allDates[allDates.length - 1];
    closeCycle('window', `${lastDate}T20:00:00Z`, (p) => p.lastMarkPrice, lastDate);
  }

  // 5. Aggregate stats.
  let totalPnL = 0;
  let totalEntries = 0;
  let winningCycles = 0;
  let losingCycles = 0;
  let bestCycle = 0;
  let worstCycle = 0;
  const endReasons = { sl: 0, tp: 0, eod: 0, window: 0 };
  for (const c of cycles) {
    totalPnL += c.totalPnL;
    totalEntries += c.positions.length;
    if (c.totalPnL > 0) winningCycles++;
    else if (c.totalPnL < 0) losingCycles++;
    if (c.totalPnL > bestCycle) bestCycle = c.totalPnL;
    if (c.totalPnL < worstCycle) worstCycle = c.totalPnL;
    endReasons[c.endReason]++;
  }

  return {
    config,
    period,
    cycles,
    totalPnL,
    totalEntries,
    totalCycles: cycles.length,
    winningCycles,
    losingCycles,
    bestCycle,
    worstCycle,
    endReasons,
    symbolErrors: errors,
    symbolsProcessed,
    durationMs: Date.now() - t0,
  };
}
