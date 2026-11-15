# Junestaden

Startsidan för [junestaden.se](https://junestaden.se) som länkar till mina webbverktyg:
Nordrange, Formelkollen, Mängdkollen och EPAkollen. Dessutom en sida om mig på [/om](https://junestaden.se/om).

## Struktur
- `public/` – det som publiceras: `index.html`, `om.html`, ikoner, bilder, `robots.txt` och `sitemap.xml`
- `src/worker.js` – en liten Cloudflare Worker för `/api/news` och `/api/rss` (nyhetsproxy till nyhetssidan `nyheter.junestaden.se`). Bara `/api/*` går till Workern, allt annat är statiska filer
- `design/` – arbetsfiler som inte publiceras: delningsbildens mall (`og.html`), skriptet `skarmdumpar.py` och favikonförslagen

## Publicering
Cloudflare (Workers med statiska filer) är kopplat till repot och publicerar automatiskt vid varje push till `main`.
Inställningarna finns i `wrangler.toml`: mappen `public/` publiceras och Workern `src/worker.js` svarar på `/api/*`.

- Build command: *(tom)*
- Deploy command: `npx wrangler deploy`

## Uppdatera skärmdumpar och delningsbild
Bilderna i `public/img/` är mobilskärmdumpar (600 × 1298, WebP) och delningsbilden `og.jpg` (1200 × 630).
Allt återskapas med skriptet (kräver Python, `pip install playwright pillow` och Microsoft Edge):

```
python design/skarmdumpar.py alla --skriv
```

Delningsbilden ritas från `design/og.html`. Höj `?v=` på `og:image` i `index.html` och `om.html` när den byts.
Om mig använder samma delningsbild som startsidan.
