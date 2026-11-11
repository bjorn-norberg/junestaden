/* Worker för junestaden.se.
 *
 * /api/rss hämtar ett RSS-flöde åt nyhetssidan och svarar med CORS, så att sidan
 * fungerar även när den öppnas som lokal fil från skrivbordet.
 *   GET https://junestaden.se/api/rss?url=<flödets adress, URL-kodad>
 * Allt annat (själva webbplatsen i public/) lämnas över till de statiska filerna.
 *
 * Säkerhet: bara adresser vars värd står i ALLOWED hämtas. Annars kan vem som helst
 * använda proxyn för att hämta vad som helst via din domän.
 * Svaren sparas i Cloudflares cache i CACHE_SECONDS, så flödena belastas inte i onödan.
 */

const ALLOWED = new Set([
  "feeds.expressen.se",
  "www.svd.se",
  "www.dn.se",
  "www.jp.se",
  "www.shl.se",
  "www.youtube.com",
  "news.google.com",
  "rss.nytimes.com",
  "www.theguardian.com",
  "www.di.se",
]);
const CACHE_SECONDS = 300;
const TIMEOUT_MS = 8000;
const MAX_BYTES = 3 * 1024 * 1024;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function reply(status, text) {
  return new Response(text, {
    status,
    headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export default {
  async fetch(request, env, ctx) {
    /* Workern körs bara för /api/* (se run_worker_first i wrangler.toml). Allt annat är statiska filer. */
    if (new URL(request.url).pathname === "/api/rss") return rss(request, ctx);
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return reply(404, "Hittades inte");
  },
};

async function rss(request, ctx) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "GET") return reply(405, "Endast GET");

  const raw = new URL(request.url).searchParams.get("url");
  if (!raw) return reply(400, "Parametern url saknas");

  let target;
  try { target = new URL(raw); } catch { return reply(400, "Ogiltig adress"); }
  if (target.protocol !== "https:" || !ALLOWED.has(target.hostname)) {
    return reply(403, "Värden är inte tillåten: " + target.hostname);
  }

  /* Cachen nycklas på flödets adress, inte på hela anropet. */
  const cache = caches.default;
  const key = new Request("https://rss-cache.junestaden.se/?u=" + encodeURIComponent(target.href));
  const hit = await cache.match(key);
  if (hit) return hit;

  let upstream;
  try {
    upstream = await fetch(target.href, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; junestaden-rss/1.0)",
        "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return reply(502, "Flödet svarade inte");
  }
  /* Följde omdirigeringen till en annan värd? Släpp inte igenom det. */
  if (!ALLOWED.has(new URL(upstream.url).hostname)) return reply(502, "Omdirigerad till otillåten värd");
  if (!upstream.ok) return reply(502, "Flödet svarade " + upstream.status);

  const body = await upstream.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return reply(502, "Flödet är för stort");

  const res = new Response(body, {
    status: 200,
    headers: {
      ...CORS,
      "Content-Type": upstream.headers.get("Content-Type") || "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=" + CACHE_SECONDS,
      "X-Content-Type-Options": "nosniff",
    },
  });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}
