import { useEffect, useLayoutEffect, useState } from 'react';

export interface TourStep {
  target: string;
  title: string;
  desc: string;
  onEnter?: () => void;
}

export interface TourProps {
  steps: TourStep[];
  onClose: () => void;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PADDING = 8;
const TOOLTIP_WIDTH = 320;
const TOOLTIP_MIN_HEIGHT = 120;
const GAP = 12;

function computeTooltipPosition(rect: Rect): {
  top: number;
  left: number;
  placement: 'top' | 'bottom' | 'left' | 'right';
} {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const spaceBottom = vh - (rect.top + rect.height);
  const spaceTop = rect.top;
  const spaceRight = vw - (rect.left + rect.width);
  const spaceLeft = rect.left;

  // Prefer below, then above, then right, then left.
  if (spaceBottom >= TOOLTIP_MIN_HEIGHT + GAP) {
    const left = Math.max(
      16,
      Math.min(
        vw - TOOLTIP_WIDTH - 16,
        rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2,
      ),
    );
    return { top: rect.top + rect.height + GAP, left, placement: 'bottom' };
  }
  if (spaceTop >= TOOLTIP_MIN_HEIGHT + GAP) {
    const left = Math.max(
      16,
      Math.min(
        vw - TOOLTIP_WIDTH - 16,
        rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2,
      ),
    );
    return {
      top: rect.top - TOOLTIP_MIN_HEIGHT - GAP,
      left,
      placement: 'top',
    };
  }
  if (spaceRight >= TOOLTIP_WIDTH + GAP) {
    const top = Math.max(
      16,
      Math.min(
        vh - TOOLTIP_MIN_HEIGHT - 16,
        rect.top + rect.height / 2 - TOOLTIP_MIN_HEIGHT / 2,
      ),
    );
    return { top, left: rect.left + rect.width + GAP, placement: 'right' };
  }
  if (spaceLeft >= TOOLTIP_WIDTH + GAP) {
    const top = Math.max(
      16,
      Math.min(
        vh - TOOLTIP_MIN_HEIGHT - 16,
        rect.top + rect.height / 2 - TOOLTIP_MIN_HEIGHT / 2,
      ),
    );
    return { top, left: rect.left - TOOLTIP_WIDTH - GAP, placement: 'left' };
  }
  // Fallback — center-top.
  return { top: 80, left: (vw - TOOLTIP_WIDTH) / 2, placement: 'bottom' };
}

export default function Tour({ steps, onClose }: TourProps) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const step = steps[index];

  useEffect(() => {
    step?.onEnter?.();
  }, [step]);

  useLayoutEffect(() => {
    if (!step) return;
    let frame = 0;
    const measure = () => {
      const el = document.querySelector(
        `[data-tour="${step.target}"]`,
      ) as HTMLElement | null;
      if (!el) {
        setRect(null);
        return;
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const r = el.getBoundingClientRect();
      setRect({
        top: r.top - PADDING,
        left: r.left - PADDING,
        width: r.width + PADDING * 2,
        height: r.height + PADDING * 2,
      });
    };
    measure();
    frame = window.setTimeout(measure, 250);
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      clearTimeout(frame);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [step, index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, steps.length - 1));
      else if (e.key === 'ArrowLeft') setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, steps.length]);

  if (!step) return null;

  const tip = rect
    ? computeTooltipPosition(rect)
    : { top: 80, left: (window.innerWidth - TOOLTIP_WIDTH) / 2, placement: 'bottom' as const };

  const atStart = index === 0;
  const atEnd = index === steps.length - 1;

  return (
    <div className="tour-root">
      {rect ? (
        <div
          className="tour-spotlight"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          }}
        />
      ) : (
        <div className="tour-backdrop" />
      )}
      <div
        className={`tour-tooltip tour-tooltip-${tip.placement}`}
        style={{ top: tip.top, left: tip.left, width: TOOLTIP_WIDTH }}
      >
        <div className="tour-step-num">
          Step {index + 1} of {steps.length}
        </div>
        <div className="tour-title">{step.title}</div>
        <div className="tour-desc">{step.desc}</div>
        <div className="tour-actions">
          <button className="link-button" onClick={onClose}>
            Skip
          </button>
          <div className="tour-nav">
            <button
              disabled={atStart}
              onClick={() => setIndex((i) => Math.max(i - 1, 0))}
            >
              Back
            </button>
            {atEnd ? (
              <button className="primary" onClick={onClose}>
                Done
              </button>
            ) : (
              <button
                className="primary"
                onClick={() => setIndex((i) => Math.min(i + 1, steps.length - 1))}
              >
                Next
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
