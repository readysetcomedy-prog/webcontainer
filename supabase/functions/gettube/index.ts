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

// Call Claude and parse a JSON object from the reply, retrying once with a
// harder instruction if the first reply has no parseable object (the model
// occasionally preambles or spends its budget reasoning).
async function claudeJson<T>(
  apiKey: string,
  system: string,
  user: string,
  maxTokens: number,
): Promise<T> {
  const first = await claude(apiKey, system, user, maxTokens);
  try {
    return parseJsonLoose<T>(first);
  } catch {
    const retry = await claude(
      apiKey,
      system,
      user +
        '\n\nIMPORTANT: Respond with ONLY the JSON object. Start your reply with { and end with }. No preamble, no explanation, no markdown code fences.',
      maxTokens,
    );
    return parseJsonLoose<T>(retry);
  }
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
    durationSec: number;
    isShort: boolean;
    exactish: boolean;
  }>;
  // SEARCH DEMAND — does the phrase actually get typed? Derived from YouTube
  // autocomplete: whether the phrase auto-suggests and how many completions it
  // spawns. This is the honest "searched a lot?" signal; it is NOT the
  // topic-heat number below. 0 = ghost phrase, 100 = strongly searched.
  searchDemandScore: number;
  autocompleteHit: boolean;
  autocompleteSuggestions: string[];
  // TOPIC HEAT — how much attention the CONTENT ranking here pulls (mostly from
  // the algorithm, not search). This is the size of the Suggested stream you
  // could be pulled into. medianViews / topicHeat are the same idea.
  topicHeat: number; // median views of top results
  medianViewsPerDay: number;
  // OPEN LANE — is the specific search slot winnable?
  exactMatchCount: number; // titles that closely answer the query
  liveExactMatch: boolean; // is any exact match actually getting views (>1/day)?
  smallChannelShare: number; // fraction of ranking channels < 20k subs
  recentShare: number; // fraction newer than 18 months
  // FORMAT — is the ranking content Shorts or long-form? Measured, not guessed.
  shortsShare: number; // fraction of top results that are Shorts (<=60s)
  error?: string;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

// ISO 8601 duration (e.g. PT4M13S) → seconds.
function parseDurationSec(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (+(m[1] ?? 0)) * 3600 + (+(m[2] ?? 0)) * 60 + (+(m[3] ?? 0));
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

// YouTube autocomplete = the honest search-demand signal. The public suggest
// endpoint returns what YouTube predicts people type. We score:
//   - exact/near-exact completion of the phrase → strongly searched
//   - number of related completions → breadth of demand
// This measures whether a phrase is TYPED, unlike view-count proxies which
// measure how popular the ranking content is.
async function autocompleteSignal(
  query: string,
): Promise<{ score: number; hit: boolean; suggestions: string[] }> {
  try {
    const url =
      'https://suggestqueries-clients6.youtube.com/complete/search?client=youtube&ds=yt&hl=en&q=' +
      encodeURIComponent(query);
    const res = await fetch(url);
    if (!res.ok) return { score: 0, hit: false, suggestions: [] };
    const text = await res.text();
    // Response is JSONP: window.google.ac.h([...]) — extract the array.
    const start = text.indexOf('(');
    const end = text.lastIndexOf(')');
    const arr = JSON.parse(text.slice(start + 1, end));
    const suggestions: string[] = (arr[1] ?? [])
      .map((s: unknown) => (Array.isArray(s) ? String(s[0]) : String(s)))
      .filter(Boolean);
    const q = query.toLowerCase().trim();
    const norm = suggestions.map((s) => s.toLowerCase());
    const exactHit = norm.includes(q);
    const prefixHit = norm.some((s) => s.startsWith(q));
    const containsHits = norm.filter((s) => s.includes(q.split(' ').slice(0, 3).join(' '))).length;
    // Score: exact completion is the strongest signal; prefix next; then
    // breadth of related suggestions (capped). No suggestions at all = ghost.
    let score = 0;
    if (exactHit) score += 55;
    else if (prefixHit) score += 35;
    score += Math.min(suggestions.length, 10) * 3; // up to 30 for breadth
    score += Math.min(containsHits, 5) * 3; // up to 15 for relevance density
    return {
      score: Math.min(100, score),
      hit: exactHit || prefixHit,
      suggestions: suggestions.slice(0, 8),
    };
  } catch {
    return { score: 0, hit: false, suggestions: [] };
  }
}

async function researchQuery(ytKey: string, query: string): Promise<QueryMetrics> {
  const base: QueryMetrics = {
    query,
    approxTotalResults: 0,
    top: [],
    searchDemandScore: 0,
    autocompleteHit: false,
    autocompleteSuggestions: [],
    topicHeat: 0,
    medianViewsPerDay: 0,
    exactMatchCount: 0,
    liveExactMatch: false,
    smallChannelShare: 0,
    recentShare: 0,
    shortsShare: 0,
  };
  try {
    // Search-demand signal (autocomplete) runs alongside the ranking research.
    const acPromise = autocompleteSignal(query);

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

    const ac = await acPromise;
    base.searchDemandScore = ac.score;
    base.autocompleteHit = ac.hit;
    base.autocompleteSuggestions = ac.suggestions;

    if (items.length === 0) return base;

    const videoIds = items.map((i) => i.id.videoId).filter(Boolean);
    const vUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
    vUrl.searchParams.set('part', 'statistics,contentDetails');
    vUrl.searchParams.set('id', videoIds.join(','));
    vUrl.searchParams.set('key', ytKey);
    const vRes = await fetch(vUrl);
    const vData = vRes.ok ? await vRes.json() : { items: [] };
    const viewsById = new Map<string, number>();
    const durById = new Map<string, number>();
    for (const v of vData.items ?? []) {
      viewsById.set(v.id, parseInt(v.statistics?.viewCount ?? '0', 10) || 0);
      durById.set(v.id, parseDurationSec(v.contentDetails?.duration ?? 'PT0S'));
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
      const durationSec = durById.get(i.id.videoId) ?? 0;
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
        durationSec,
        isShort: durationSec > 0 && durationSec <= 60,
        exactish: exactish(query, i.snippet.title),
      };
    });
    base.topicHeat = median(base.top.map((t) => t.views));
    base.medianViewsPerDay = median(base.top.map((t) => t.viewsPerDay));
    const withSubs = base.top.filter((t) => t.channelSubs !== null);
    base.smallChannelShare = withSubs.length
      ? Math.round((withSubs.filter((t) => (t.channelSubs ?? 0) < 20_000).length / withSubs.length) * 100) / 100
      : 0;
    base.recentShare =
      Math.round((base.top.filter((t) => t.ageDays < 548).length / base.top.length) * 100) / 100;
    base.shortsShare =
      Math.round((base.top.filter((t) => t.isShort).length / base.top.length) * 100) / 100;
    const exacts = base.top.filter((t) => t.exactish);
    base.exactMatchCount = exacts.length;
    // Is any exact-match video actually alive (pulling >1 view/day)? A dead
    // exact match (e.g. 170 views in 3 years) means the phrase is a ghost town —
    // the slot is open, but only because nobody searches it.
    base.liveExactMatch = exacts.some((t) => t.viewsPerDay > 1);
    return base;
  } catch (e) {
    base.error = (e as Error).message;
    return base;
  }
}

const EXTRACT_SYSTEM = `You analyze a YouTube video concept and output ONLY a JSON object, no prose, of the shape:
{"topic": string, "coreQuestion": string, "audience": string, "candidateQueries": string[]}
candidateQueries: 6 to 8 search phrases real people would type into YouTube that this video could satisfy. Include a mix: some SHORTER head phrases (2-4 words people actually type, e.g. "transitional species", "why still monkeys") AND some longer question forms. Shorter phrases usually have real search demand; long exact-sentence phrases often don't. Lowercase, no punctuation beyond apostrophes.`;

const SYNTH_SYSTEM = `You are a YouTube publishing strategist. You receive a video concept and REAL research data per candidate query. Read the signals CORRECTLY — they mean different things:

- searchDemandScore (0-100) + autocompleteHit + autocompleteSuggestions = whether the phrase is ACTUALLY TYPED into search. This is the ONLY real search-demand signal. HIGH = people search it; LOW/0 = ghost phrase almost nobody types, no matter how it looks elsewhere.
- topicHeat / medianViewsPerDay = how much attention the CONTENT ranking here pulls. This is mostly ALGORITHM traffic (Suggested/Browse), i.e. the size of the recommendation stream you could be pulled into. It is NOT search demand. A high topicHeat with a LOW searchDemandScore means: big topic, but the views come from the algorithm, not from typing this phrase.
- exactMatchCount + liveExactMatch = is the search slot open? liveExactMatch=false means the only exact matches are DEAD (getting ~no views) → the slot is open ONLY because the phrase isn't really searched (confirm with searchDemandScore). liveExactMatch=true with high views = slot is taken.
- smallChannelShare = can a small/new channel break in (relevance beats authority).
- shortsShare = fraction of ranking results that are Shorts. HIGH shortsShare means a long-form video is fighting format — only flag a Shorts risk when shortsShare is actually high (>0.4). NEVER invent a Shorts concern from phrasing.
- recentShare = is the topic active now.

THE TWO GAMES (weigh both):
1. SEARCH game — win when searchDemandScore is genuinely high AND (exactMatchCount low OR no liveExactMatch) AND smallChannelShare decent. This earns steady, durable search traffic and is the most winnable surface for a small channel.
2. ALGORITHM game — win when topicHeat is high (big Suggested stream) AND the packaging can earn the click+retention. This is where the big numbers are, but a small channel usually needs a SEARCH win first as the wedge that proves quality and triggers Suggested pickup.

Pick the primaryQuery that best combines REAL searchDemandScore + open lane + intent match with the video. Do NOT pick a high-topicHeat phrase that has a low searchDemandScore and call it a search opportunity — say plainly its traffic would come from the algorithm, not the keyword.

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
  "strategy": {"searchWedge": string, "algorithmPlay": string},
  "opportunity": {"search": "low"|"moderate"|"high", "algorithm": "low"|"moderate"|"high"},
  "confidence": "low" | "moderate" | "high"
}

Rules:
- Be decisive: ONE title, not options. altThumbnailText is the only allowed alternative. When search is the goal, the title should contain the primaryQuery's words so it can BE the search result.
- strategy.searchWedge: the specific query to target for a winnable search entry (or "none — this is an algorithm/browse play" if no query has real search demand). strategy.algorithmPlay: what the thumbnail/hook must do to earn Suggested placement on the hot topic.
- opportunity.search reflects real searchDemandScore + open lane. opportunity.algorithm reflects topicHeat + winnability. They are independent — a video can be low search / high algorithm.
- description: first 2 sentences carry the search weight; then 2-3 natural sentences. No hashtag spam.
- chapters: only if the concept implies clear structure; timestamps as placeholders like 00:00.
- opening: 60-90 words, answers or firmly promises the title's question inside the first 30 seconds.
- NEVER fabricate view forecasts or invented statistics. Tiers and confidence only.
- If the natural framing has weak real search demand but the topic is hot, don't call it a skip — verdict "make" or "reframe" and be explicit it's an algorithm/browse play carried by packaging, not a search play.
- tags: max 12.

Respond with ONLY the JSON object. Start with { and end with }. No preamble, no explanation, no markdown fences.`;

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
    const extracted = await claudeJson<{
      topic: string;
      coreQuestion: string;
      audience: string;
      candidateQueries: string[];
    }>(anthropicKey, EXTRACT_SYSTEM, `VIDEO CONCEPT / SCRIPT:\n\n${description}`, 1_500);
    const queries = (extracted.candidateQueries ?? []).slice(0, 8);
    if (queries.length === 0) throw new Error('No candidate queries extracted');

    // 2+3. Research each query (sequential keeps us polite on quota; 8 queries
    // ≈ 8 * ~102 units, well within a day's free 10k).
    const research: QueryMetrics[] = [];
    for (const q of queries) {
      research.push(await researchQuery(ytKey, q));
    }

    // 4. Synthesize the decisive package. Generous token budget so any
    // reasoning tokens don't starve the JSON output.
    const pkg = await claudeJson<Record<string, unknown>>(
      anthropicKey,
      SYNTH_SYSTEM,
      `VIDEO CONCEPT / SCRIPT:\n\n${description}\n\nEXTRACTED: ${JSON.stringify(extracted)}\n\nRESEARCH DATA (per candidate query):\n${JSON.stringify(research, null, 1)}`,
      8_000,
    );

    return json({ package: pkg, extracted, research });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
