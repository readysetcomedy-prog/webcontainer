// Netlify Function: proxies requests to Alpaca so the API secret never reaches
// the browser. The client sends:
//   - x-alpaca-env: "paper" | "live"      (defaults to paper)
//   - x-alpaca-target: "trading" | "data" (defaults to trading)
// and the function injects auth headers + rewrites the URL to the right host.

const TRADING_PAPER = 'https://paper-api.alpaca.markets';
const TRADING_LIVE = 'https://api.alpaca.markets';
const DATA = 'https://data.alpaca.markets';

export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/alpaca\/?/, '');

  const env = (req.headers.get('x-alpaca-env') ?? 'paper').toLowerCase();
  const target = (req.headers.get('x-alpaca-target') ?? 'trading').toLowerCase();
  const isPaper = env !== 'live';

  const keyId = isPaper
    ? process.env.ALPACA_PAPER_KEY_ID
    : process.env.ALPACA_LIVE_KEY_ID;
  const secret = isPaper
    ? process.env.ALPACA_PAPER_SECRET
    : process.env.ALPACA_LIVE_SECRET;

  if (!keyId || !secret) {
    return new Response(
      JSON.stringify({
        error: `Alpaca ${isPaper ? 'paper' : 'live'} keys not configured on the server. Set ALPACA_${
          isPaper ? 'PAPER' : 'LIVE'
        }_KEY_ID and ALPACA_${isPaper ? 'PAPER' : 'LIVE'}_SECRET in Netlify env.`,
      }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    );
  }

  let base: string;
  if (target === 'data') {
    base = DATA;
  } else {
    base = isPaper ? TRADING_PAPER : TRADING_LIVE;
  }

  const targetUrl = `${base}/${path}${url.search}`;

  const headers: Record<string, string> = {
    'APCA-API-KEY-ID': keyId,
    'APCA-API-SECRET-KEY': secret,
    accept: 'application/json',
  };
  const contentType = req.headers.get('content-type');
  if (contentType) headers['content-type'] = contentType;

  const init: RequestInit = { method: req.method, headers };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.text();
  }

  const upstream = await fetch(targetUrl, init);
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      'content-type':
        upstream.headers.get('content-type') ?? 'application/json',
    },
  });
};

export const config = {
  path: '/api/alpaca/*',
};
