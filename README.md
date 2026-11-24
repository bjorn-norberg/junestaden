# Junestaden

Startsidan för [junestaden.se](https://junestaden.se) som länkar till mina webbverktyg
Nordrange, Formelkollen, Mängdkollen och EPAkollen. Under rubriken *Fler projekt* finns också
Tvättstugebokning och racingspelet Micro Racer '85.

| Sida | Fil | Innehåll |
|---|---|---|
| [junestaden.se](https://junestaden.se) | `public/index.html` | Startsidan: verktygen, *Fler projekt* och sidfoten |
| [/om](https://junestaden.se/om) | `public/om.html` | Om mig, med kvarteren (verktygen) och *Lite utanför stan* |
| [/tvattstuga](https://junestaden.se/tvattstuga) | `public/tvattstuga.html` | Projektsida för bokningsappen till en bostadsrättsförenings tvättstugor, med skärmdumpar och länk till en öppen demo |

## Struktur
- `public/` – det som publiceras: sidorna ovan, ikoner, bilder, `robots.txt` och `sitemap.xml`
- `src/worker.js` – en liten Cloudflare Worker för `/api/news` och `/api/rss` (nyhetsproxy till nyhetssidan `nyheter.junestaden.se`). Bara `/api/*` går till Workern, allt annat är statiska filer
- `design/` – arbetsfiler som inte publiceras: mallarna för delningsbilderna (`og.html`, `og-tvatt.html`), originalskärmdumparna från bokningsappen (`tvatt/`), skriptet `skarmdumpar.py` och favikonförslagen

## Publicering
Cloudflare (Workers med statiska filer) är kopplat till repot och publicerar automatiskt vid varje push till `main`.
Inställningarna finns i `wrangler.toml`: mappen `public/` publiceras och Workern `src/worker.js` svarar på `/api/*`.
Cloudflare serverar `tvattstuga.html` som `/tvattstuga` och `om.html` som `/om`.

- Build command: *(tom)*
- Deploy command: `npx wrangler deploy`

## Uppdatera skärmdumpar och delningsbilder
Telefonbilderna i `public/img/` är mobilskärmdumpar (600 × 1298, WebP). Delningsbilderna är `og.jpg` (startsidan och Om mig)
och `og-tvatt.jpg` (projektsidan för tvättstugebokningen), båda 1200 × 630.
Skriptet tar bilderna från de publicerade sajterna (kräver Python, `pip install playwright pillow` och Microsoft Edge):

```
python design/skarmdumpar.py alla --skriv          # alla telefonbilder och delningsbilder
python design/skarmdumpar.py racer --skriv         # bara Micro Racer
python design/skarmdumpar.py og-tvatt --skriv      # bara delningsbilden för /tvattstuga
```

Utan `--skriv` hamnar bilderna i `design/_ut/` så att de kan granskas först.
Skärmdumparna från tvättstugebokningen tas inte automatiskt: de ligger i `design/tvatt/` och får inte visa riktiga boendes namn.

Höj `?v=` på `og:image` när en delningsbild byts (`index.html` och `om.html` för `og.jpg`, `tvattstuga.html` för `og-tvatt.jpg`)
och kör sedan [LinkedIn Post Inspector](https://www.linkedin.com/post-inspector/) på sidans adress.
