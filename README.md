# Junestaden

Startsidan för [junestaden.se](https://junestaden.se) som länkar till mina webbverktyg:
EPAkollen, Formelkollen och Mängdkollen.

## Struktur
- `public/` – det som publiceras: `index.html`, ikoner, bilder, `robots.txt` och `sitemap.xml`
- `design/` – arbetsfiler som inte publiceras: delningsbildens mall (`og.html`) och favikonförslagen

## Publicering
Cloudflare Pages är kopplat till repot och publicerar automatiskt vid varje push till `main`.

- Build command: *(tom)*
- Build output directory: `public`

## Uppdatera skärmdumpar
Bilderna i `public/img/` är mobilskärmdumpar (600 × 1298, WebP). Byt fil med samma namn
så uppdateras startsidan. Delningsbilden `public/img/og.jpg` (1200 × 630) renderas från `design/og.html`.
