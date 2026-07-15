// Supabase Edge Function (Deno) — GetTube video decision engine.
// Deploy:  supabase functions deploy gettube
// Secrets: supabase secrets set ANTHROPIC_API_KEY=... YOUTUBE_API_KEY=...
//
// One endpoint: POST { description } → full publishing package + research.
// Pipeline (all server-side so keys never reach the browser):
//   1. Claude extracts the topic + candidate search queries.
//   2. YouTube Data API researches each query (who ranks, how big, how old,
//      how fast those videos accrue views, exact-match quality).
//   3. Plain code computes per-query metrics.
//   4. Claude receives the metrics and produces ONE decisive package.
//
// v1 deliberately does NOT forecast view counts — with no channel history the
// honest range is too wide to be useful. It ships verdict + opportunity tiers.

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, content-type, x-client-info, apikey',
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  });
}

const ANTHROPIC_MODEL = 'claude-sonnet-5';

async function claude(
  apiKey: string,
  system: string,
  user: string,
  maxTokens: number,
): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = (data.content ?? [])
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text)
    .join('');
  return text;
}

// Claude is asked for pure JSON; strip markdown fences defensively.
function parseJsonLoose<T>(text: string): T {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object in model output');
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}

interface QueryMetrics {
  query: string;
  approxTotalResults: number;
  top: Array<{
    title: string;
    channelTitle: string;
    channelSubs: number | null;
    views: number;
    ageDays: number;
    viewsPerDay: number;
    exactish: boolean;
  }>;
  medianViews: number;
  medianViewsPerDay: number;
  demandProxy: number; // sum of views/day across top 5 — what ranking there earns today
  smallChannelShare: number; // fraction of top results from channels < 20k subs
  recentShare: number; // fraction newer than 18 months
  exactMatchCount: number;
  error?: string;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

// Loose "does the title answer this query" check: at least 60% of the query's
// meaningful words appear in the title.
function exactish(query: string, title: string): boolean {
  const stop = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'to', 'is', 'are', 'do', 'does', 'why', 'how', 'what', 'we']);
  const words = query.toLowerCase().split(/\W+/).filter((w) => w && !stop.has(w));
  if (words.length === 0) return false;
  const t = title.toLowerCase();
  const hits = words.filter((w) => t.includes(w)).length;
  return hits / words.length >= 0.6;
}

async function researchQuery(ytKey: string, query: string): Promise<QueryMetrics> {
  const base: QueryMetrics = {
    query,
    approxTotalResults: 0,
    top: [],
    medianViews: 0,
    medianViewsPerDay: 0,
    demandProxy: 0,
    smallChannelShare: 0,
    recentShare: 0,
    exactMatchCount: 0,
  };
  try {
    const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
    searchUrl.searchParams.set('part', 'snippet');
    searchUrl.searchParams.set('q', query);
    searchUrl.searchParams.set('type', 'video');
    searchUrl.searchParams.set('maxResults', '10');
    searchUrl.searchParams.set('relevanceLanguage', 'en');
    searchUrl.searchParams.set('key', ytKey);
    const sRes = await fetch(searchUrl);
    if (!sRes.ok) throw new Error(`search ${sRes.status}: ${(await sRes.text()).slice(0, 200)}`);
    const sData = await sRes.json();
    base.approxTotalResults = sData.pageInfo?.totalResults ?? 0;
    const items: Array<{ id: { videoId: string }; snippet: { title: string; channelId: string; channelTitle: string; publishedAt: string } }> =
      sData.items ?? [];
    if (items.length === 0) return base;

    const videoIds = items.map((i) => i.id.videoId).filter(Boolean);
    const vUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
    vUrl.searchParams.set('part', 'statistics');
    vUrl.searchParams.set('id', videoIds.join(','));
    vUrl.searchParams.set('key', ytKey);
    const vRes = await fetch(vUrl);
    const vData = vRes.ok ? await vRes.json() : { items: [] };
    const viewsById = new Map<string, number>();
    for (const v of vData.items ?? []) {
      viewsById.set(v.id, parseInt(v.statistics?.viewCount ?? '0', 10) || 0);
    }

    const channelIds = [...new Set(items.map((i) => i.snippet.channelId))];
    const cUrl = new URL('https://www.googleapis.com/youtube/v3/channels');
    cUrl.searchParams.set('part', 'statistics');
    cUrl.searchParams.set('id', channelIds.join(','));
    cUrl.searchParams.set('key', ytKey);
    const cRes = await fetch(cUrl);
    const cData = cRes.ok ? await cRes.json() : { items: [] };
    const subsById = new Map<string, number | null>();
    for (const ch of cData.items ?? []) {
      subsById.set(
        ch.id,
        ch.statistics?.hiddenSubscriberCount
          ? null
          : parseInt(ch.statistics?.subscriberCount ?? '0', 10) || 0,
      );
    }

    const now = Date.now();
    base.top = items.map((i) => {
      const views = viewsById.get(i.id.videoId) ?? 0;
      const ageDays = Math.max(
        1,
        Math.round((now - new Date(i.snippet.publishedAt).getTime()) / 86_400_000),
      );
      return {
        title: i.snippet.title,
        channelTitle: i.snippet.channelTitle,
        channelSubs: subsById.get(i.snippet.channelId) ?? null,
        views,
        ageDays,
        viewsPerDay: Math.round((views / ageDays) * 10) / 10,
        exactish: exactish(query, i.snippet.title),
      };
    });
    base.medianViews = median(base.top.map((t) => t.views));
    base.medianViewsPerDay = median(base.top.map((t) => t.viewsPerDay));
    base.demandProxy = Math.round(
      base.top.slice(0, 5).reduce((s, t) => s + t.viewsPerDay, 0),
    );
    const withSubs = base.top.filter((t) => t.channelSubs !== null);
    base.smallChannelShare = withSubs.length
      ? Math.round((withSubs.filter((t) => (t.channelSubs ?? 0) < 20_000).length / withSubs.length) * 100) / 100
      : 0;
    base.recentShare =
      Math.round((base.top.filter((t) => t.ageDays < 548).length / base.top.length) * 100) / 100;
    base.exactMatchCount = base.top.filter((t) => t.exactish).length;
    return base;
  } catch (e) {
    base.error = (e as Error).message;
    return base;
  }
}

const EXTRACT_SYSTEM = `You analyze a YouTube video concept and output ONLY a JSON object, no prose, of the shape:
{"topic": string, "coreQuestion": string, "audience": string, "candidateQueries": string[]}
candidateQueries: 6 to 8 search phrases real people would type into YouTube or Google that this video could satisfy. Mix phrasings: question forms, short keyword forms, misconception forms. Order by your prior guess of demand. Lowercase, no punctuation beyond apostrophes.`;

const SYNTH_SYSTEM = `You are a YouTube publishing strategist. You receive a video concept and REAL research data about what currently ranks on YouTube for candidate search queries (views/day of ranking videos = demand proxy; channel sizes; result ages; exact-match counts = competition quality).

Output ONLY a JSON object, no prose:
{
  "verdict": "make" | "reframe" | "skip",
  "verdictReason": string,
  "reframe": {"angle": string, "why": string} | null,
  "title": string,
  "thumbnailText": string,
  "altThumbnailText": string,
  "primaryQuery": string,
  "secondaryQueries": string[],
  "description": string,
  "tags": string[],
  "chapters": string | null,
  "opening": string,
  "risks": string[],
  "requiredImprovement": string | null,
  "opportunity": {"youtubeSearch": "low"|"moderate"|"high", "browse": "low"|"moderate"|"high"},
  "confidence": "low" | "moderate" | "high"
}

Rules:
- Be decisive: ONE title, not options. altThumbnailText is the only allowed alternative.
- Ground every judgment in the research numbers. High demandProxy + high smallChannelShare + low exactMatchCount = real opportunity. Big-channel-dominated results with strong exact matches = weak search opportunity (browse/suggested must carry it).
- description: first 2 sentences carry the search weight; then 2-3 natural sentences. No hashtag spam.
- chapters: only if the concept implies clear structure; timestamps as placeholders like 00:00.
- opening: 60-90 words, answers or firmly promises the title's question inside the first 30 seconds.
- NEVER fabricate view forecasts or invented statistics. Opportunity tiers and confidence only.
- If the concept's natural framing has weak demand but the content is good, verdict "reframe" with a specific stronger angle.
- tags: max 12, honest note-free.`;

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  const ytKey = Deno.env.get('YOUTUBE_API_KEY');
  if (!anthropicKey || !ytKey) {
    return json(
      {
        error:
          'Missing secrets. Run: supabase secrets set ANTHROPIC_API_KEY=... YOUTUBE_API_KEY=... && supabase functions deploy gettube',
      },
      503,
    );
  }

  let description = '';
  try {
    const body = await req.json();
    description = String(body.description ?? '').trim();
  } catch {
    return json({ error: 'Body must be JSON: { "description": "..." }' }, 400);
  }
  if (description.length < 20) {
    return json({ error: 'Describe the video in at least a sentence or two.' }, 400);
  }
  if (description.length > 60_000) {
    description = description.slice(0, 60_000);
  }

  try {
    // 1. Extract topic + candidate queries.
    const extractRaw = await claude(
      anthropicKey,
      EXTRACT_SYSTEM,
      `VIDEO CONCEPT / SCRIPT:\n\n${description}`,
      1_000,
    );
    const extracted = parseJsonLoose<{
      topic: string;
      coreQuestion: string;
      audience: string;
      candidateQueries: string[];
    }>(extractRaw);
    const queries = (extracted.candidateQueries ?? []).slice(0, 8);
    if (queries.length === 0) throw new Error('No candidate queries extracted');

    // 2+3. Research each query (sequential keeps us polite on quota; 8 queries
    // ≈ 8 * ~102 units, well within a day's free 10k).
    const research: QueryMetrics[] = [];
    for (const q of queries) {
      research.push(await researchQuery(ytKey, q));
    }

    // 4. Synthesize the decisive package.
    const synthRaw = await claude(
      anthropicKey,
      SYNTH_SYSTEM,
      `VIDEO CONCEPT / SCRIPT:\n\n${description}\n\nEXTRACTED: ${JSON.stringify(extracted)}\n\nRESEARCH DATA (per candidate query):\n${JSON.stringify(research, null, 1)}`,
      3_000,
    );
    const pkg = parseJsonLoose<Record<string, unknown>>(synthRaw);

    return json({ package: pkg, extracted, research });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
