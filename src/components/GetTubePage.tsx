import { useState } from 'react';
import {
  analyzeVideo,
  GetTubeAnalysis,
  GetTubeQueryMetrics,
} from '../lib/gettube';

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="gt-link"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? 'copied ✓' : label ?? 'copy'}
    </button>
  );
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

const VERDICT_STYLES: Record<string, { label: string; cls: string }> = {
  make: { label: 'MAKE THIS VIDEO', cls: 'tube-verdict-make' },
  reframe: { label: 'REFRAME IT FIRST', cls: 'tube-verdict-reframe' },
  skip: { label: "DON'T PRIORITIZE THIS", cls: 'tube-verdict-skip' },
};

export default function GetTubePage() {
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GetTubeAnalysis | null>(null);
  const [showResearch, setShowResearch] = useState(false);

  async function run() {
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const r = await analyzeVideo(description);
      setResult(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const pkg = result?.package;
  const verdict = pkg ? VERDICT_STYLES[pkg.verdict] ?? VERDICT_STYLES.make : null;

  return (
    <div className="gt-shell tube-shell">
      <header className="gt-header">
        <a className="gt-back" href="/app">
          ← Editor
        </a>
        <h1 className="gt-title">GetTube</h1>
        <span className="gt-muted tube-tagline">
          Describe the video → get the publishing package + whether it's worth making.
        </span>
      </header>

      <section className="tube-input">
        <textarea
          placeholder={
            'Describe the video — concept, outline, or paste the full script.\n\nExample: "I\'m explaining why people expect evolution to produce half-duck half-crocodile animals, why nearly every organism is transitional, and why species labels are arbitrary human boundaries. Audience includes creationists and people who misunderstand evolution."'
          }
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={10}
          disabled={busy}
        />
        <div className="tube-input-actions">
          <button
            type="button"
            className="gt-btn gt-btn-primary"
            onClick={run}
            disabled={busy || description.trim().length < 20}
          >
            {busy ? 'Researching… (takes ~30–60s)' : 'Analyze'}
          </button>
          <span className="gt-muted">
            Verdicts and opportunity tiers come from live YouTube competition
            research. No view-count forecasts — those would be fiction until the
            channel has history.
          </span>
        </div>
        {error && <div className="gt-warn">{error}</div>}
      </section>

      {pkg && verdict && (
        <section className="tube-results">
          <div className={`tube-verdict ${verdict.cls}`}>
            <div className="tube-verdict-label">{verdict.label}</div>
            <div className="tube-verdict-reason">{pkg.verdictReason}</div>
            {pkg.reframe && (
              <div className="tube-reframe">
                <strong>Reframe as:</strong> {pkg.reframe.angle}
                <div className="gt-muted">{pkg.reframe.why}</div>
              </div>
            )}
          </div>

          <div className="tube-grid">
            <div className="tube-card">
              <div className="tube-card-head">
                Title <CopyButton text={pkg.title} />
              </div>
              <div className="tube-card-body tube-title-text">{pkg.title}</div>
            </div>
            <div className="tube-card">
              <div className="tube-card-head">
                Thumbnail text <CopyButton text={pkg.thumbnailText} />
              </div>
              <div className="tube-card-body">
                <span className="tube-thumb-text">{pkg.thumbnailText}</span>
                {pkg.altThumbnailText && (
                  <div className="gt-muted tube-alt">
                    alt: {pkg.altThumbnailText}{' '}
                    <CopyButton text={pkg.altThumbnailText} />
                  </div>
                )}
              </div>
            </div>
            <div className="tube-card">
              <div className="tube-card-head">Search targets</div>
              <div className="tube-card-body">
                <div>
                  <strong>{pkg.primaryQuery}</strong>{' '}
                  <span className="gt-muted">(primary)</span>
                </div>
                <ul className="tube-list">
                  {pkg.secondaryQueries.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="tube-card">
              <div className="tube-card-head">Opportunity</div>
              <div className="tube-card-body">
                <div>
                  YouTube search:{' '}
                  <strong className={`tube-tier-${pkg.opportunity.youtubeSearch}`}>
                    {pkg.opportunity.youtubeSearch}
                  </strong>
                </div>
                <div>
                  Browse / suggested:{' '}
                  <strong className={`tube-tier-${pkg.opportunity.browse}`}>
                    {pkg.opportunity.browse}
                  </strong>
                </div>
                <div>
                  Confidence: <strong>{pkg.confidence}</strong>
                </div>
              </div>
            </div>
          </div>

          <div className="tube-card tube-wide">
            <div className="tube-card-head">
              Recommended opening (first 30 seconds){' '}
              <CopyButton text={pkg.opening} />
            </div>
            <div className="tube-card-body tube-prewrap">{pkg.opening}</div>
          </div>

          <div className="tube-card tube-wide">
            <div className="tube-card-head">
              Description <CopyButton text={pkg.description} />
            </div>
            <div className="tube-card-body tube-prewrap">{pkg.description}</div>
          </div>

          {pkg.chapters && (
            <div className="tube-card tube-wide">
              <div className="tube-card-head">
                Chapters <CopyButton text={pkg.chapters} />
              </div>
              <div className="tube-card-body tube-prewrap">{pkg.chapters}</div>
            </div>
          )}

          <div className="tube-card tube-wide">
            <div className="tube-card-head">
              Tags <CopyButton text={pkg.tags.join(', ')} />
            </div>
            <div className="tube-card-body gt-muted">{pkg.tags.join(', ')}</div>
          </div>

          {(pkg.risks.length > 0 || pkg.requiredImprovement) && (
            <div className="tube-card tube-wide tube-risks">
              <div className="tube-card-head">Risks</div>
              <div className="tube-card-body">
                {pkg.requiredImprovement && (
                  <div className="tube-required">
                    <strong>Required:</strong> {pkg.requiredImprovement}
                  </div>
                )}
                <ul className="tube-list">
                  {pkg.risks.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <div className="tube-card tube-wide">
            <div className="tube-card-head">
              Research data{' '}
              <button
                type="button"
                className="gt-link"
                onClick={() => setShowResearch((v) => !v)}
              >
                {showResearch ? 'hide' : 'show the work'}
              </button>
            </div>
            {showResearch && result && (
              <div className="tube-card-body">
                <ResearchTable research={result.research} />
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function ResearchTable({ research }: { research: GetTubeQueryMetrics[] }) {
  return (
    <div className="gt-table-wrap">
      <table className="gt-table">
        <thead>
          <tr>
            <th>Candidate query</th>
            <th title="Sum of views/day across the top 5 ranking videos — what ranking there earns today">
              Demand proxy
            </th>
            <th title="Median views of the top 10">Median views</th>
            <th title="Share of top results from channels under 20k subs">
              Small channels
            </th>
            <th title="Share of top results newer than 18 months">Recent</th>
            <th title="Top results whose titles closely answer the query">
              Exact matches
            </th>
          </tr>
        </thead>
        <tbody>
          {research.map((r) => (
            <tr key={r.query}>
              <td>{r.error ? `${r.query} — error: ${r.error}` : r.query}</td>
              <td>{fmtNum(r.demandProxy)}/day</td>
              <td>{fmtNum(r.medianViews)}</td>
              <td>{Math.round(r.smallChannelShare * 100)}%</td>
              <td>{Math.round(r.recentShare * 100)}%</td>
              <td>{r.exactMatchCount}/10</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
