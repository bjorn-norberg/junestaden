/* Worker för junestaden.se.
 *
 * /api/news?feed=<grupp>  Färdig nyhetslista som JSON för nyhetssidan. Workern hämtar gruppens
 *                         RSS-flöden, slår ihop dem och sorterar efter tid. Grupper: se FEEDS.
 * /api/rss?url=<adress>   Rått RSS-flöde (äldre väg, används av den gamla lokala startsidan).
 * Allt annat (själva webbplatsen i public/) lämnas över till de statiska filerna.
 *
 * Båda vägarna svarar med CORS, så att nyhetssidan fungerar även som lokal fil.
 * Säkerhet: bara adresser vars värd står i ALLOWED hämtas. Annars kan vem som helst
 * använda proxyn för att hämta vad som helst via din domän.
 * Svaren sparas i Cloudflares cache i CACHE_SECONDS, så flödena belastas inte i onödan.
 */

/* Källor. "video" betyder YouTube-flöde: bara klipp vars titel matchar "filter" tas med. */
const SOURCES = {
  expressen: { name: "Expressen", url: "https://feeds.expressen.se/nyheter/" },
  svd: { name: "SvD", url: "https://www.svd.se/feed/articles.rss" },
  dn: { name: "Dagens Nyheter", url: "https://www.dn.se/rss/" },
  jp: { name: "Jönköpings-Posten", url: "https://www.jp.se/feeds/feed.xml" },
  nyt: { name: "The New York Times", url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml" },
  guardian: { name: "The Guardian", url: "https://www.theguardian.com/international/rss" },
  exphockey: { name: "Expressen", url: "https://feeds.expressen.se/hockey/" },
  shl: { name: "SHL", url: "https://www.shl.se/api/articles/rss" },
  shlklipp: { name: "SHL", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCUMwsAsbK-SsW5GHufJJFUA", video: true, filter: /highlights/i },
  di: { name: "Dagens industri", url: "https://www.di.se/rss" },
  svtgolf: { name: "SVT Sport", url: "https://www.svt.se/sport/golf/rss.xml" },
  svenskgolf: { name: "Svensk Golf", url: "https://www.svenskgolf.se/kategori/nyheter/feed/" },
};
/* Grupper (flikarna på nyhetssidan). Ny grupp, t.ex. golf: lägg till källor ovan och en rad här. */
const FEEDS = {
  sverige: { sources: ["expressen", "svd", "dn", "jp"], max: 31 },
  varlden: { sources: ["nyt", "guardian"], max: 31 },
  hockey: { sources: ["exphockey", "shl"], videos: ["shlklipp"], max: 25 },
  bors: { sources: ["di"], max: 20 },
  golf: { sources: ["svtgolf", "svenskgolf"], max: 25 },
};

const ALLOWED = new Set([
  ...Object.values(SOURCES).map(s => new URL(s.url).hostname),
  "news.google.com",
  /* Expressens artikelsidor. Nyhetssidan hämtar delningsbilden därifrån, eftersom Expressens flöden saknar bilder. */
  "www.expressen.se",
]);
const CACHE_SECONDS = 300;
const TIMEOUT_MS = 8000;
const MAX_BYTES = 3 * 1024 * 1024;
const PER_SOURCE = 25;

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
    const path = new URL(request.url).pathname;
    if (path === "/api/news" || path === "/api/rss") {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
      if (request.method !== "GET") return reply(405, "Endast GET");
      try {
        return path === "/api/news" ? await news(request, ctx) : await rss(request, ctx);
      } catch (e) {
        return reply(500, "Internt fel");
      }
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return reply(404, "Hittades inte");
  },
};

/* ============ Hämtning ============ */

/* Hämtar ett flöde och ger { body, type } eller { error }. Svaret cachas per flödesadress. */
async function getFeed(href, ctx) {
  const cache = caches.default;
  const key = new Request("https://rss-cache.junestaden.se/?u=" + encodeURIComponent(href));
  const hit = await cache.match(key);
  if (hit) return { body: await hit.arrayBuffer(), type: hit.headers.get("Content-Type") };

  let upstream;
  try {
    upstream = await fetch(href, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; junestaden-rss/1.0)",
        "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return { error: "Flödet svarade inte" };
  }
  /* Följde omdirigeringen till en annan värd? Släpp inte igenom det. */
  if (!ALLOWED.has(new URL(upstream.url).hostname)) return { error: "Omdirigerad till otillåten värd" };
  if (!upstream.ok) return { error: "Flödet svarade " + upstream.status };

  const body = await upstream.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return { error: "Flödet är för stort" };
  const type = upstream.headers.get("Content-Type") || "application/xml; charset=utf-8";
  ctx.waitUntil(cache.put(key, new Response(body.slice(0), {
    headers: { "Content-Type": type, "Cache-Control": "public, max-age=" + CACHE_SECONDS },
  })));
  return { body, type };
}

/* ============ /api/rss ============ */

async function rss(request, ctx) {
  const raw = new URL(request.url).searchParams.get("url");
  if (!raw) return reply(400, "Parametern url saknas");

  let target;
  try { target = new URL(raw); } catch { return reply(400, "Ogiltig adress"); }
  if (target.protocol !== "https:" || !ALLOWED.has(target.hostname)) {
    return reply(403, "Värden är inte tillåten: " + target.hostname);
  }
  const r = await getFeed(target.href, ctx);
  if (r.error) return reply(502, r.error);
  return new Response(r.body, {
    status: 200,
    headers: {
      ...CORS,
      "Content-Type": r.type,
      "Cache-Control": "public, max-age=" + CACHE_SECONDS,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/* ============ /api/news ============ */

async function news(request, ctx) {
  const id = new URL(request.url).searchParams.get("feed") || "";
  const feed = Object.hasOwn(FEEDS, id) ? FEEDS[id] : null;
  if (!feed) return reply(404, "Okänd grupp. Finns: " + Object.keys(FEEDS).join(", "));

  /* Den färdiga listan cachas också, så att flödena inte tolkas om vid varje besök. */
  const cache = caches.default;
  const key = new Request("https://news-cache.junestaden.se/v1/" + id);
  const hit = await cache.match(key);
  if (hit) return hit;

  const load = async sid => {
    const s = SOURCES[sid];
    const r = await getFeed(s.url, ctx);
    if (r.error) return [];
    let items = parseFeed(new TextDecoder("utf-8").decode(r.body), PER_SOURCE);
    if (s.filter) items = items.filter(i => s.filter.test(i.title));
    if (s.video) items = items.map(i => ({ ...i, img: ytThumb(i.link) }));
    return items.map(i => ({ ...i, by: s.name }));
  };
  const merge = async ids => {
    const seen = new Set();
    return (await Promise.all(ids.map(load))).flat()
      .filter(i => i.date && !seen.has(i.title) && seen.add(i.title))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  };

  const items = (await merge(feed.sources)).slice(0, feed.max);
  const videos = feed.videos ? (await merge(feed.videos)).slice(0, 8) : [];
  if (!items.length && !videos.length) return reply(502, "Inga flöden svarade");

  const res = new Response(JSON.stringify({ feed: id, updated: new Date().toISOString(), items, videos }), {
    status: 200,
    headers: {
      ...CORS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=" + CACHE_SECONDS,
      "X-Content-Type-Options": "nosniff",
    },
  });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

/* ============ Tolkning av RSS och Atom ============
   Workers har ingen XML-tolk, så flödena läses med reguljära uttryck. Det räcker för de fält som behövs. */

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    }
    return Object.hasOwn(ENT, e.toLowerCase()) ? ENT[e.toLowerCase()] : m;
  });
}
function clean(s) {
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  return decode(decode(s).replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}
function tag(xml, name) {
  const m = new RegExp("<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + name + ">", "i").exec(xml);
  return m ? clean(m[1]) : "";
}
function attr(el, name) {
  const m = new RegExp("\\s" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')", "i").exec(el);
  return m ? decode(m[1] !== undefined ? m[1] : m[2]) : "";
}
const isHttp = u => /^https?:\/\/\S+$/.test(u);

function linkOf(x) {
  const text = tag(x, "link");
  if (isHttp(text)) return text;
  let first = "";
  for (const m of x.matchAll(/<link\b[^>]*>/gi)) {
    const href = attr(m[0], "href"), rel = attr(m[0], "rel");
    if (!isHttp(href)) continue;
    if (!rel || rel === "alternate") return href;
    if (!first) first = href;
  }
  return first;
}
/* Väljer den största bilden. Bilder som anges vara smalare än 300 px hoppas över. */
function imageOf(x) {
  let best = "", bestW = -1;
  for (const m of x.matchAll(/<(media:content|media:thumbnail|enclosure)\b[^>]*>/gi)) {
    const el = m[0], url = attr(el, "url"), type = attr(el, "type"), medium = attr(el, "medium");
    if (!/^https:\/\/\S+$/.test(url)) continue;
    if ((type && !/^image\//i.test(type)) || (medium && medium !== "image")) continue;
    const w = parseInt(attr(el, "width"), 10) || 0;
    if (w && w < 300) continue;
    if (w > bestW) { best = url; bestW = w; }
  }
  return best;
}
function parseFeed(xml, max) {
  const out = [];
  const re = /<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  let m;
  while (out.length < max && (m = re.exec(xml))) {
    const x = m[2];
    const title = tag(x, "title"), link = linkOf(x);
    if (!title || !link) continue;
    const d = new Date(tag(x, "pubDate") || tag(x, "published") || tag(x, "updated") || tag(x, "dc:date"));
    out.push({ title, link, date: isNaN(d) ? null : d.toISOString(), img: imageOf(x) });
  }
  return out;
}
function ytThumb(link) {
  const m = /(?:v=|shorts\/)([\w-]{11})/.exec(link);
  return m ? "https://i.ytimg.com/vi/" + m[1] + "/mqdefault.jpg" : "";
}
