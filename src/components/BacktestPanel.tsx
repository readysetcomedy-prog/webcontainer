import { useState } from 'react';
import { AlpacaEnv } from '../lib/alpaca';
import {
  BacktestConfig,
  BacktestResult,
  BacktestTrade,
  BacktestVariant,
  VARIANT_LABELS,
  runBacktest,
} from '../lib/backtest';

function fmtMoney(n: number | undefined | null) {
  if (n === undefined || n === null || !Number.isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtPct(n: number) {
  if (!Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${(n * 100).toFixed(2)}%`;
}

export default function BacktestPanel({
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
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [periodMode, setPeriodMode] = useState<'lookback' | 'range'>('lookback');
  const [lookbackDays, setLookbackDays] = useState(120);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [stopLossPct, setStopLossPct] = useState(5);
  const [takeProfitPct, setTakeProfitPct] = useState(3);
  const [entryHour, setEntryHour] = useState(11);
  const [exitHour, setExitHour] = useState(15);
  const [exitMinute, setExitMinute] = useState(45);
  const [positionSize, setPositionSize] = useState(100);
  const [upPct, setUpPct] = useState(2);
  const [volMult, setVolMult] = useState(2);
  const [variantSelected, setVariantSelected] = useState<Record<BacktestVariant, boolean>>({
    A: true,
    B: true,
    C: true,
  });
  const [disableEOD, setDisableEOD] = useState(false);

  const [expanded, setExpanded] = useState<BacktestVariant | null>(null);

  async function run() {
    setError(null);
    setResult(null);
    const variants = (['A', 'B', 'C'] as BacktestVariant[]).filter(
      (v) => variantSelected[v],
    );
    if (variants.length === 0) {
      setError('Pick at least one variant.');
      return;
    }
    if (symbols.length === 0) {
      setError('Watchlist is empty.');
      return;
    }
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
    const config: BacktestConfig = {
      symbols,
      ...(periodMode === 'lookback'
        ? { lookbackDays }
        : { startDate, endDate }),
      entryHourET: entryHour,
      entryMinuteET: 0,
      exitHourET: exitHour,
      exitMinuteET: exitMinute,
      stopLossPct: stopLossPct / 100,
      takeProfitPct: takeProfitPct / 100,
      positionSize,
      variants,
      upPct: upPct / 100,
      volMultiple: volMult,
      orbStartMinutes: 15,
      disableEOD,
    };
    setRunning(true);
    setProgress({ done: 0, total: symbols.length });
    try {
      const res = await runBacktest(env, config, (done, total) =>
        setProgress({ done, total }),
      );
      setResult(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="gt-backtest">
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
            <span className="gt-muted">
              Tip: try monthly chunks (e.g. Feb, Mar, Apr) to spot regime
              changes.
            </span>
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
          <span>Stop loss %</span>
          <input
            type="number"
            step="0.5"
            min="0.5"
            value={stopLossPct}
            onChange={(e) => setStopLossPct(parseFloat(e.target.value) || 5)}
          />
        </label>
        <label className="gt-field">
          <span>Take profit %</span>
          <input
            type="number"
            step="0.5"
            min="0.5"
            value={takeProfitPct}
            onChange={(e) => setTakeProfitPct(parseFloat(e.target.value) || 3)}
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
          <span>A: up ≥ %</span>
          <input
            type="number"
            step="0.5"
            min="0.5"
            value={upPct}
            onChange={(e) => setUpPct(parseFloat(e.target.value) || 2)}
          />
        </label>
        <label className="gt-field">
          <span>C: vol ≥ ×</span>
          <input
            type="number"
            step="0.5"
            min="1"
            value={volMult}
            onChange={(e) => setVolMult(parseFloat(e.target.value) || 2)}
          />
        </label>
      </div>
      <div className="gt-backtest-variants">
        {(['A', 'B', 'C'] as BacktestVariant[]).map((v) => (
          <label key={v} className="gt-check">
            <input
              type="checkbox"
              checked={variantSelected[v]}
              onChange={(e) =>
                setVariantSelected((s) => ({ ...s, [v]: e.target.checked }))
              }
            />
            <strong>{v}</strong> {VARIANT_LABELS[v]}
          </label>
        ))}
        <label className="gt-check" style={{ marginTop: 6 }}>
          <input
            type="checkbox"
            checked={disableEOD}
            onChange={(e) => setDisableEOD(e.target.checked)}
          />
          <strong>Hold until SL or TP</strong>{' '}
          <span className="gt-muted">
            (no EOD close — trades can carry overnight and across days,
            absorbing gap risk)
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
          {running ? 'Running…' : `Run on ${symbols.length} symbols`}
        </button>
        {progress && running && (
          <span className="gt-muted">
            Fetching bars: {progress.done}/{progress.total}
          </span>
        )}
        {result && !running && (
          <span className="gt-muted">
            {result.period.startDate} → {result.period.endDate} ·{' '}
            {(result.durationMs / 1000).toFixed(1)}s,{' '}
            {result.symbolsProcessed} symbols
            {Object.keys(result.symbolErrors).length > 0
              ? ` (${Object.keys(result.symbolErrors).length} fetch errors)`
              : ''}
          </span>
        )}
      </div>
      {result && Object.keys(result.symbolErrors).length > 0 && (
        <div className="gt-warn">
          {Object.keys(result.symbolErrors).length} symbol
          {Object.keys(result.symbolErrors).length === 1 ? '' : 's'} failed to
          fetch. Sample error:{' '}
          <code>{Object.values(result.symbolErrors)[0]}</code>
        </div>
      )}
      {error && <div className="gt-warn">{error}</div>}
      {result && <BacktestResults result={result} expanded={expanded} setExpanded={setExpanded} />}
    </div>
  );
}

function BacktestResults({
  result,
  expanded,
  setExpanded,
}: {
  result: BacktestResult;
  expanded: BacktestVariant | null;
  setExpanded: (v: BacktestVariant | null) => void;
}) {
  if (result.variants.every((v) => v.totalTrades === 0)) {
    return (
      <div className="gt-empty">
        No qualifying trades across {result.symbolsProcessed} symbols. Try a
        smaller "up ≥ %" threshold, a longer lookback, or a broader watchlist.
      </div>
    );
  }
  return (
    <div className="gt-backtest-results">
      <table className="gt-table">
        <thead>
          <tr>
            <th>Variant</th>
            <th>Trades</th>
            <th>Win rate</th>
            <th>Total P&amp;L</th>
            <th>Return on deployed</th>
            <th>Avg win</th>
            <th>Avg loss</th>
            <th>Best</th>
            <th>Worst</th>
            <th title="SL / TP / EOD / window (out-of-data)">SL/TP/EOD/W</th>
            <th title="Average trading sessions held per trade">Avg days</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {result.variants.map((v) => {
            const ret =
              v.capitalDeployed > 0 ? v.totalPnL / v.capitalDeployed : 0;
            return (
              <tr key={v.variant}>
                <td>
                  <strong>{v.variant}</strong>{' '}
                  <span className="gt-muted">{v.label}</span>
                </td>
                <td>{v.totalTrades}</td>
                <td>{v.totalTrades ? (v.winRate * 100).toFixed(1) + '%' : '—'}</td>
                <td className={v.totalPnL >= 0 ? 'pos' : 'neg'}>
                  {v.totalPnL >= 0 ? '+' : ''}
                  {fmtMoney(v.totalPnL)}
                </td>
                <td className={ret >= 0 ? 'pos' : 'neg'}>{fmtPct(ret)}</td>
                <td className="pos">{fmtMoney(v.avgWin)}</td>
                <td className="neg">{fmtMoney(v.avgLoss)}</td>
                <td className="pos">{fmtMoney(v.bestTrade)}</td>
                <td className="neg">{fmtMoney(v.worstTrade)}</td>
                <td>
                  <span className="gt-muted">
                    {v.exitReasons.sl}/{v.exitReasons.tp}/{v.exitReasons.eod}/
                    {v.exitReasons.window}
                  </span>
                </td>
                <td className="gt-muted">{v.avgDaysHeld.toFixed(1)}</td>
                <td>
                  {v.totalTrades > 0 && (
                    <button
                      className="gt-link"
                      onClick={() =>
                        setExpanded(expanded === v.variant ? null : v.variant)
                      }
                    >
                      {expanded === v.variant ? 'hide' : 'trades'}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {expanded && (
        <TradeList
          trades={
            result.variants.find((v) => v.variant === expanded)?.trades ?? []
          }
        />
      )}
    </div>
  );
}

function TradeList({ trades }: { trades: BacktestTrade[] }) {
  const [sortKey, setSortKey] = useState<'date' | 'pnl'>('date');
  const sorted = [...trades].sort((a, b) =>
    sortKey === 'pnl' ? b.pnl - a.pnl : a.entryTime.localeCompare(b.entryTime),
  );
  return (
    <div className="gt-backtest-trades">
      <div className="gt-backtest-trades-head">
        Showing {trades.length} trades · sort{' '}
        <button
          className="gt-link"
          onClick={() => setSortKey(sortKey === 'date' ? 'pnl' : 'date')}
        >
          {sortKey === 'date' ? 'by P&L' : 'chronologically'}
        </button>
      </div>
      <table className="gt-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Symbol</th>
            <th>Entry</th>
            <th>Exit</th>
            <th>Reason</th>
            <th>%</th>
            <th>P&amp;L</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((t, i) => (
            <tr key={i}>
              <td>{t.date}</td>
              <td className="gt-sym">{t.symbol}</td>
              <td>{fmtMoney(t.entryPrice)}</td>
              <td>{fmtMoney(t.exitPrice)}</td>
              <td>
                <span
                  className={
                    t.exitReason === 'tp'
                      ? 'pos'
                      : t.exitReason === 'sl'
                      ? 'neg'
                      : 'gt-muted'
                  }
                  title={
                    t.exitReason === 'window'
                      ? 'Ran out of bar data — never hit SL or TP within the backtest window'
                      : undefined
                  }
                >
                  {t.exitReason.toUpperCase()}
                </span>
                {t.daysHeld > 1 && (
                  <span className="gt-muted"> · {t.daysHeld}d</span>
                )}
              </td>
              <td className={t.pnl >= 0 ? 'pos' : 'neg'}>{fmtPct(t.pnlPct)}</td>
              <td className={t.pnl >= 0 ? 'pos' : 'neg'}>
                {t.pnl >= 0 ? '+' : ''}
                {fmtMoney(t.pnl)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
