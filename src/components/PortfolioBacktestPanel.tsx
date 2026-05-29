import { useState } from 'react';
import { AlpacaEnv } from '../lib/alpaca';
import {
  PortfolioBacktestConfig,
  PortfolioBacktestResult,
  PortfolioCycle,
  runPortfolioBacktest,
} from '../lib/portfolioBacktest';

function fmtMoney(n: number | undefined | null) {
  if (n === undefined || n === null || !Number.isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function PortfolioBacktestPanel({
  env,
  symbols,
}: {
  env: AlpacaEnv;
  symbols: string[];
}) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [result, setResult] = useState<PortfolioBacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedCycle, setExpandedCycle] = useState<number | null>(null);

  const [periodMode, setPeriodMode] = useState<'lookback' | 'range'>('lookback');
  const [lookbackDays, setLookbackDays] = useState(120);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [symbolOverride, setSymbolOverride] = useState('');
  const [upPct, setUpPct] = useState(2);
  const [positionSize, setPositionSize] = useState(100);
  const [entryHour, setEntryHour] = useState(11);
  const [exitHour, setExitHour] = useState(15);
  const [exitMinute, setExitMinute] = useState(45);
  const [lossLimit, setLossLimit] = useState<number | ''>(-200);
  const [profitTarget, setProfitTarget] = useState<number | ''>(500);
  const [disableEOD, setDisableEOD] = useState(false);

  async function run() {
    setError(null);
    setResult(null);
    if (periodMode === 'range') {
      if (!startDate || !endDate) {
        setError('Pick both From and To dates, or switch to "Last N days".');
        return;
      }
      if (startDate >= endDate) {
        setError('From must be before To.');
        return;
      }
    }
    const overrideTrimmed = symbolOverride.trim().toUpperCase();
    const targetSymbols = overrideTrimmed ? [overrideTrimmed] : symbols;
    if (targetSymbols.length === 0) {
      setError('No symbols — watchlist is empty.');
      return;
    }
    const ll = typeof lossLimit === 'number' && Number.isFinite(lossLimit) ? lossLimit : null;
    const pt =
      typeof profitTarget === 'number' && Number.isFinite(profitTarget) ? profitTarget : null;
    if (ll === null && pt === null) {
      setError('Set at least one of loss limit or profit target.');
      return;
    }
    if (ll !== null && ll >= 0) {
      setError('Loss limit must be negative (e.g. -200).');
      return;
    }
    if (pt !== null && pt <= 0) {
      setError('Profit target must be positive.');
      return;
    }

    const config: PortfolioBacktestConfig = {
      symbols: targetSymbols,
      ...(periodMode === 'lookback' ? { lookbackDays } : { startDate, endDate }),
      entryHourET: entryHour,
      entryMinuteET: 0,
      exitHourET: exitHour,
      exitMinuteET: exitMinute,
      upPct: upPct / 100,
      positionSize,
      lossLimit: ll,
      profitTarget: pt,
      disableEOD,
    };
    setRunning(true);
    setProgress({ done: 0, total: targetSymbols.length });
    try {
      const res = await runPortfolioBacktest(env, config, (done, total) =>
        setProgress({ done, total }),
      );
      setResult(res);
      setExpandedCycle(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="gt-backtest">
      <div className="gt-backtest-period">
        <label className="gt-field gt-inline-field">
          <span>Symbol</span>
          <input
            type="text"
            placeholder={`all watchlist (${symbols.length})`}
            value={symbolOverride}
            onChange={(e) => setSymbolOverride(e.target.value)}
            style={{ width: 120, textTransform: 'uppercase' }}
            autoComplete="off"
            spellCheck={false}
          />
          {symbolOverride.trim() && (
            <button
              type="button"
              className="gt-link"
              onClick={() => setSymbolOverride('')}
            >
              clear
            </button>
          )}
        </label>
      </div>
      <div className="gt-backtest-period">
        <div className="gt-side-toggle" role="group">
          <button
            type="button"
            className={periodMode === 'lookback' ? 'active' : ''}
            onClick={() => setPeriodMode('lookback')}
          >
            Last N days
          </button>
          <button
            type="button"
            className={periodMode === 'range' ? 'active' : ''}
            onClick={() => setPeriodMode('range')}
          >
            Date range
          </button>
        </div>
        {periodMode === 'lookback' ? (
          <label className="gt-field gt-inline-field">
            <span>Lookback (days)</span>
            <input
              type="number"
              min="5"
              max="365"
              value={lookbackDays}
              onChange={(e) => setLookbackDays(parseInt(e.target.value, 10) || 0)}
            />
          </label>
        ) : (
          <>
            <label className="gt-field gt-inline-field">
              <span>From</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
            <label className="gt-field gt-inline-field">
              <span>To</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </label>
          </>
        )}
      </div>
      <div className="gt-backtest-controls">
        <label className="gt-field">
          <span>Entry ET (hour)</span>
          <input
            type="number"
            min="9"
            max="15"
            value={entryHour}
            onChange={(e) => setEntryHour(parseInt(e.target.value, 10) || 11)}
          />
        </label>
        <label className="gt-field">
          <span>Exit ET</span>
          <div className="gt-qty-row">
            <input
              type="number"
              min="10"
              max="16"
              value={exitHour}
              onChange={(e) => setExitHour(parseInt(e.target.value, 10) || 15)}
            />
            <input
              type="number"
              min="0"
              max="59"
              step="5"
              value={exitMinute}
              onChange={(e) => setExitMinute(parseInt(e.target.value, 10) || 45)}
            />
          </div>
        </label>
        <label className="gt-field">
          <span>Entry: up ≥ %</span>
          <input
            type="number"
            step="0.5"
            min="0.5"
            value={upPct}
            onChange={(e) => setUpPct(parseFloat(e.target.value) || 2)}
          />
        </label>
        <label className="gt-field">
          <span>Position $</span>
          <input
            type="number"
            min="10"
            value={positionSize}
            onChange={(e) => setPositionSize(parseFloat(e.target.value) || 100)}
          />
        </label>
        <label className="gt-field">
          <span>Daily loss limit $</span>
          <input
            type="number"
            placeholder="-200"
            value={lossLimit === '' ? '' : lossLimit}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === '' || raw === '-') {
                setLossLimit('');
                return;
              }
              const v = parseFloat(raw);
              setLossLimit(Number.isFinite(v) ? v : '');
            }}
          />
        </label>
        <label className="gt-field">
          <span>Daily profit target $</span>
          <input
            type="number"
            placeholder="500"
            value={profitTarget === '' ? '' : profitTarget}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              setProfitTarget(Number.isFinite(v) ? v : '');
            }}
          />
        </label>
      </div>
      <div className="gt-backtest-variants">
        <label className="gt-check">
          <input
            type="checkbox"
            checked={!disableEOD}
            onChange={(e) => setDisableEOD(!e.target.checked)}
          />
          <strong>Close at end of day</strong>{' '}
          <span className="gt-muted">
            (unchecked = positions carry to next day until SL or TP fires)
          </span>
        </label>
      </div>
      <div className="gt-backtest-actions">
        <button
          type="button"
          className="gt-btn gt-btn-primary"
          onClick={run}
          disabled={running}
        >
          {running
            ? 'Running…'
            : symbolOverride.trim()
            ? `Run on ${symbolOverride.trim().toUpperCase()}`
            : `Run on ${symbols.length} symbols`}
        </button>
        {progress && running && (
          <span className="gt-muted">
            Fetching bars: {progress.done}/{progress.total}
          </span>
        )}
        {result && !running && (
          <span className="gt-muted">
            {result.period.startDate} → {result.period.endDate} ·{' '}
            {(result.durationMs / 1000).toFixed(1)}s, {result.symbolsProcessed} symbols
            {Object.keys(result.symbolErrors).length > 0
              ? ` (${Object.keys(result.symbolErrors).length} fetch errors)`
              : ''}
          </span>
        )}
      </div>
      {result && Object.keys(result.symbolErrors).length > 0 && (
        <div className="gt-warn">
          {Object.keys(result.symbolErrors).length} fetch error
          {Object.keys(result.symbolErrors).length === 1 ? '' : 's'}. Sample:{' '}
          <code>{Object.values(result.symbolErrors)[0]}</code>
        </div>
      )}
      {error && <div className="gt-warn">{error}</div>}
      {result && (
        <PortfolioResults
          result={result}
          expandedCycle={expandedCycle}
          setExpandedCycle={setExpandedCycle}
        />
      )}
    </div>
  );
}

function PortfolioResults({
  result,
  expandedCycle,
  setExpandedCycle,
}: {
  result: PortfolioBacktestResult;
  expandedCycle: number | null;
  setExpandedCycle: (i: number | null) => void;
}) {
  if (result.totalCycles === 0) {
    return (
      <div className="gt-empty">
        No qualifying entries across {result.symbolsProcessed} symbols. Either no
        watchlist names hit your "up ≥ {(result.config.upPct * 100).toFixed(1)}%"
        threshold at {result.config.entryHourET}:00 ET on any day in the window,
        or the data fetch failed.
      </div>
    );
  }
  const winRate =
    result.totalCycles > 0 ? (result.winningCycles / result.totalCycles) * 100 : 0;
  const avgCycle = result.totalCycles > 0 ? result.totalPnL / result.totalCycles : 0;
  return (
    <div className="gt-backtest-results">
      <div className="gt-pnl-summary">
        Total P&L across {result.totalCycles} cycle
        {result.totalCycles === 1 ? '' : 's'}:{' '}
        <strong className={result.totalPnL >= 0 ? 'pos' : 'neg'}>
          {result.totalPnL >= 0 ? '+' : ''}
          {fmtMoney(result.totalPnL)}
        </strong>{' '}
        <span className="gt-muted">
          · {result.winningCycles}W / {result.losingCycles}L · win rate{' '}
          {winRate.toFixed(1)}% · avg per cycle {fmtMoney(avgCycle)} ·{' '}
          {result.totalEntries} total entries · best{' '}
          <span className="pos">{fmtMoney(result.bestCycle)}</span> · worst{' '}
          <span className="neg">{fmtMoney(result.worstCycle)}</span> · SL/TP/EOD/W{' '}
          {result.endReasons.sl}/{result.endReasons.tp}/{result.endReasons.eod}/
          {result.endReasons.window}
        </span>
      </div>
      <div className="gt-table-wrap">
        <table className="gt-table">
          <thead>
            <tr>
              <th>Cycle</th>
              <th>Start</th>
              <th>End</th>
              <th>Days</th>
              <th>Entries</th>
              <th>Symbols</th>
              <th>End reason</th>
              <th>P&amp;L</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {result.cycles.map((c, i) => (
              <CycleRow
                key={i}
                cycle={c}
                index={i}
                expanded={expandedCycle === i}
                onToggle={() => setExpandedCycle(expandedCycle === i ? null : i)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CycleRow({
  cycle,
  index,
  expanded,
  onToggle,
}: {
  cycle: PortfolioCycle;
  index: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr>
        <td>#{index + 1}</td>
        <td>{cycle.startDate}</td>
        <td>{cycle.endDate}</td>
        <td>{cycle.daysActive}</td>
        <td>{cycle.positions.length}</td>
        <td>{cycle.uniqueSymbols}</td>
        <td>
          <span
            className={
              cycle.endReason === 'tp'
                ? 'pos'
                : cycle.endReason === 'sl'
                ? 'neg'
                : 'gt-muted'
            }
          >
            {cycle.endReason.toUpperCase()}
          </span>
        </td>
        <td className={cycle.totalPnL >= 0 ? 'pos' : 'neg'}>
          {cycle.totalPnL >= 0 ? '+' : ''}
          {fmtMoney(cycle.totalPnL)}
        </td>
        <td>
          <button className="gt-link" onClick={onToggle}>
            {expanded ? 'hide' : 'positions'}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={9}>
            <table className="gt-table" style={{ marginTop: 4 }}>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Entry date</th>
                  <th>Entry $</th>
                  <th>Exit $</th>
                  <th>Shares</th>
                  <th>P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {cycle.positions.map((p, j) => (
                  <tr key={j}>
                    <td className="gt-sym">{p.symbol}</td>
                    <td>{p.entryDate}</td>
                    <td>{fmtMoney(p.entryPrice)}</td>
                    <td>{fmtMoney(p.exitPrice)}</td>
                    <td>{p.shares.toFixed(4)}</td>
                    <td className={p.pnl >= 0 ? 'pos' : 'neg'}>
                      {p.pnl >= 0 ? '+' : ''}
                      {fmtMoney(p.pnl)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}
