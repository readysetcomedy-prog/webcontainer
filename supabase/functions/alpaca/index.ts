// Supabase Edge Function (Deno) — proxies authenticated requests to Alpaca
// with server-held secrets. Deploy with:
//   supabase functions deploy alpaca
// Set secrets with:
//   supabase secrets set ALPACA_PAPER_KEY_ID=... ALPACA_PAPER_SECRET=...
//
// JWT verification is on by default — only signed-in Supabase users can hit
// this endpoint. The client sends `Authorization: Bearer <user-jwt>` and
// `apikey: <anon-key>`. The gateway validates the JWT before invoking us.

const TRADING_PAPER = "https://paper-api.alpaca.markets";
const TRADING_LIVE = "https://api.alpaca.markets";
const DATA = "https://data.alpaca.markets";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, PATCH, PUT, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, content-type, x-alpaca-env, x-alpaca-target, x-client-info, apikey",
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  const m = url.pathname.match(/\/functions\/v1\/alpaca\/?(.*)$/);
  const path = (m?.[1] ?? "").replace(/^\/+/, "");

  const env = (req.headers.get("x-alpaca-env") ?? "paper").toLowerCase();
  const target = (req.headers.get("x-alpaca-target") ?? "trading").toLowerCase();
  const isPaper = env !== "live";

  const keyId = isPaper
    ? Deno.env.get("ALPACA_PAPER_KEY_ID")
    : Deno.env.get("ALPACA_LIVE_KEY_ID");
  const secret = isPaper
    ? Deno.env.get("ALPACA_PAPER_SECRET")
    : Deno.env.get("ALPACA_LIVE_SECRET");

  if (!keyId || !secret) {
    return json(
      {
        error: `Alpaca ${isPaper ? "paper" : "live"} keys not configured. Run: supabase secrets set ALPACA_${
          isPaper ? "PAPER" : "LIVE"
        }_KEY_ID=... ALPACA_${isPaper ? "PAPER" : "LIVE"}_SECRET=...`,
      },
      503,
    );
  }

  const base =
    target === "data"
      ? DATA
      : isPaper
      ? TRADING_PAPER
      : TRADING_LIVE;
  const targetUrl = `${base}/${path}${url.search}`;

  const headers: Record<string, string> = {
    "APCA-API-KEY-ID": keyId,
    "APCA-API-SECRET-KEY": secret,
    accept: "application/json",
  };
  const contentType = req.headers.get("content-type");
  if (contentType) headers["content-type"] = contentType;

  const init: RequestInit = { method: req.method, headers };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.text();
  }

  const upstream = await fetch(targetUrl, init);
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      ...CORS_HEADERS,
      "content-type": upstream.headers.get("content-type") ?? "application/json",
    },
  });
});
