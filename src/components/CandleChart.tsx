import { useEffect, useRef } from 'react';
import {
  CandlestickSeries,
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { AlpacaBar } from '../lib/alpaca';

interface Props {
  bars: AlpacaBar[];
  height?: number;
  loading?: boolean;
  intraday?: boolean;
}

export default function CandleChart({
  bars,
  height = 320,
  loading,
  intraday = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      width: container.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#9ca3af',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.04)' },
        horzLines: { color: 'rgba(255,255,255,0.06)' },
      },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.08)',
        timeVisible: intraday,
        secondsVisible: false,
      },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' },
      crosshair: { mode: 1 },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#4ade80',
      downColor: '#f87171',
      borderUpColor: '#4ade80',
      borderDownColor: '#f87171',
      wickUpColor: '#4ade80',
      wickDownColor: '#f87171',
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        chart.applyOptions({ width: entry.contentRect.width });
      }
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [height, intraday]);

  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return;
    // De-duplicate by timestamp and sort ascending — lightweight-charts crashes
    // if it sees out-of-order or duplicate times.
    const seen = new Map<number, AlpacaBar>();
    for (const b of bars) {
      const sec = Math.floor(new Date(b.time).getTime() / 1000);
      if (Number.isFinite(sec)) seen.set(sec, b);
    }
    const data = Array.from(seen.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([sec, b]) => ({
        time: sec as UTCTimestamp,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      }));
    seriesRef.current.setData(data);
    chartRef.current.timeScale().fitContent();
  }, [bars]);

  return (
    <div className="gt-chart-wrap" style={{ height }}>
      <div ref={containerRef} className="gt-chart" />
      {loading && <div className="gt-chart-loading">Loading…</div>}
      {!loading && bars.length === 0 && (
        <div className="gt-chart-empty">No bars for this symbol.</div>
      )}
    </div>
  );
}
