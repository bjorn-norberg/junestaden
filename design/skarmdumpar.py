"""Återskapar startsidans telefonbilder (public/img/*.webp) och delningsbilderna (og.jpg, og-om.jpg).

Körning (från mappen Junestaden):
    python design/skarmdumpar.py nordrange            en bild
    python design/skarmdumpar.py alla                 alla fyra telefonbilder + båda delningsbilderna
    python design/skarmdumpar.py og og-om             bara delningsbilderna
    python design/skarmdumpar.py epa --skriv          skriv direkt till public/img/ (annars till design/_ut/)

Krav: Python 3.10+, `pip install playwright pillow`, och Microsoft Edge installerat
(Playwright startas med channel="msedge", så ingen separat webbläsare behöver hämtas).

Skripten går mot de LIVE-sajterna (https://nordrange.se, epa.junestaden.se, bygg.junestaden.se,
vvs.junestaden.se), så internet krävs. Delningsbilderna ritas från design/og.html och design/og-om.html,
som i sin tur läser bilderna i public/img/. Kör därför först telefonbilderna och sedan delningsbilderna.

Bildformat (se INSTRUKTIONER.md): telefonbilder 600 x 1298 WebP (kvalitet 82), delningsbilder 1200 x 630 JPG (kvalitet 92).
Bara övre ~65 % av varje telefonbild syns på startsidans kort, så det viktiga ska ligga högt upp.
Höj ?v= på og:image i public/index.html respektive public/om.html när en delningsbild byts.
"""
import asyncio
import os
import sys
from pathlib import Path

from PIL import Image
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
UT_TEST = ROOT / "design" / "_ut"
IMG = ROOT / "public" / "img"
# Döljer "Installera som app"-rutor så att de inte hamnar på bilderna
HIDE = "[class*=install],[id*=install],.toast,.sheet{display:none!important}"
W, H = 600, 1298  # telefonbildens slutstorlek (förhållande 390 x 844)


async def gå_till(sida, url, försök=8):
    """Går till en adress. Ibland ger namnuppslag ett tillfälligt fel (Portmaster), så prova några gånger."""
    for _ in range(försök):
        try:
            await sida.goto(url, wait_until="networkidle", timeout=30000)
            return
        except Exception:
            await asyncio.sleep(2)
    raise SystemExit("Kunde inte nå " + url)


async def ny_telefon(webbläsare, bredd, höjd):
    ctx = await webbläsare.new_context(
        viewport={"width": bredd, "height": höjd}, device_scale_factor=2, is_mobile=True,
        has_touch=True, locale="sv-SE", color_scheme="dark")
    return ctx, await ctx.new_page()


async def välj_första_förslag(sida, fält, text):
    """Skriver i ett platsfält (Photon) och väljer första träffen i just det fältets lista."""
    await sida.fill("#" + fält, text)
    await sida.wait_for_timeout(1800)
    lista = await sida.get_attribute("#" + fält, "aria-controls")
    val = sida.locator("#" + lista + " li").first
    await val.wait_for(timeout=15000)
    await val.dispatch_event("pointerdown")
    await sida.wait_for_timeout(700)


def spara_telefonbild(png_väg, mål):
    im = Image.open(png_väg).convert("RGB").resize((W, H), Image.LANCZOS)
    im.save(mål, "WEBP", quality=82, method=6)
    print("  sparad", mål, mål.stat().st_size // 1024, "kB")


async def nordrange(p, tmp):
    """Rutten Jönköping -> Trondheim, 80 % batteri: karta med tre numrerade laddstopp och stopplistan under."""
    b = await p.chromium.launch(channel="msedge")
    ctx, sida = await ny_telefon(b, 390, 844)
    await gå_till(sida, "https://nordrange.se/")
    await sida.add_style_tag(content=HIDE)
    await sida.wait_for_timeout(1200)
    await välj_första_förslag(sida, "from", "Jönköping")
    await välj_första_förslag(sida, "to", "Trondheim")
    await sida.keyboard.press("Escape")          # stänger förslagslistan som annars täcker knappen
    await sida.wait_for_timeout(300)
    await sida.locator("#go").dispatch_event("click")
    await sida.wait_for_timeout(14000)           # rutt + väder + laddstopp tar tid
    # Kartans överkant 72 px från toppen (under sidhuvudet)
    await sida.evaluate("""() => { const c=document.querySelector('canvas'); const m=c.closest('[class*=maplibre],[class*=mapbox],[id*=map]')||c.parentElement.parentElement;
        window.scrollTo(0, window.scrollY + m.getBoundingClientRect().top - 72); }""")
    await sida.wait_for_timeout(800)
    # Dra kartan 28 px uppåt så att startpunkten (Jönköping) syns ovanför kartans källhänvisning
    box = await sida.evaluate("(() => { const r=document.querySelector('canvas').getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })()")
    x, y = box[0] + box[2] * 0.3, box[1] + box[3] * 0.55
    await sida.mouse.move(x, y); await sida.mouse.down(); await sida.mouse.move(x, y - 28, steps=12); await sida.mouse.up()
    await sida.wait_for_timeout(2000)
    await sida.screenshot(path=str(tmp / "nordrange.png"))
    await b.close()


async def epa(p, tmp):
    """Jönköping -> Gränna. Bredare fönster (468 x 1013) så att kartan och kostnadskortet får plats."""
    b = await p.chromium.launch(channel="msedge")
    ctx, sida = await ny_telefon(b, 468, 1013)
    await gå_till(sida, "https://epa.junestaden.se/?shot=1")
    await sida.add_style_tag(content=HIDE)
    await sida.wait_for_timeout(1500)
    await välj_första_förslag(sida, "from", "Jönköping")
    await välj_första_förslag(sida, "to", "Gränna")
    await sida.keyboard.press("Escape")
    await sida.wait_for_timeout(8000)
    # Avresa 09:00 så att "Framme" blir en dagtid och inte "imorgon" när bilden tas sent på kvällen
    await sida.fill("#depart", "09:00")
    await sida.evaluate("document.activeElement && document.activeElement.blur()")   # släpp fokus så att fältet inte ser redigerat ut
    await sida.wait_for_timeout(600)
    await sida.evaluate("window.scrollTo(0, 285)")   # Vägval-knapparna överst, kostnadskortet längre ned
    await sida.wait_for_timeout(900)
    await sida.screenshot(path=str(tmp / "epa.png"))
    await b.close()


async def mangd(p, tmp):
    """25 m2 weberfloor 110 fine, 10 mm. Bredare fönster (520 x 1126) så att den gula resultatrutan syns."""
    b = await p.chromium.launch(channel="msedge")
    ctx, sida = await ny_telefon(b, 520, 1126)
    await gå_till(sida, "https://bygg.junestaden.se/?shot=1")
    await sida.add_style_tag(content=HIDE)
    await sida.wait_for_timeout(2000)
    märken = await sida.evaluate("[...document.querySelector('#brandSelect').options].map(o=>o.text)")
    await sida.select_option("#brandSelect", label=[m for m in märken if "weber" in m.lower()][0])
    await sida.wait_for_timeout(500)
    await sida.select_option("#usageSelect", index=0)
    await sida.wait_for_timeout(400)
    await sida.fill("#area", "25")
    await sida.fill("#thickness", "10")
    await sida.wait_for_timeout(1500)
    await sida.evaluate("(off) => { const r=document.querySelector('#area').getBoundingClientRect(); window.scrollTo(0, window.scrollY + r.top - off); }", 95)
    await sida.wait_for_timeout(1500)
    await sida.screenshot(path=str(tmp / "mangdkollen.png"))
    await b.close()


async def vvs(p, tmp):
    """Formelkollens startsida i mobilen, överst."""
    b = await p.chromium.launch(channel="msedge")
    ctx, sida = await ny_telefon(b, 390, 844)
    await gå_till(sida, "https://vvs.junestaden.se/?shot=1")
    await sida.add_style_tag(content=HIDE)
    await sida.wait_for_timeout(2500)
    await sida.screenshot(path=str(tmp / "vvs.png"))
    await b.close()


async def delningsbild(p, mall, mål):
    """Ritar en mall (design/og*.html) i dubbel upplösning och skalar ned till 1200 x 630."""
    b = await p.chromium.launch(channel="msedge")
    sida = await b.new_page(viewport={"width": 1200, "height": 630}, device_scale_factor=2)
    await sida.goto((ROOT / "design" / mall).as_uri(), wait_until="networkidle")
    await sida.wait_for_timeout(1200)    # typsnitten (Google Fonts) ska hinna laddas
    tmp = os.environ.get("TEMP", ".") + "/ogtmp.png"
    await sida.screenshot(path=tmp)
    await b.close()
    Image.open(tmp).convert("RGB").resize((1200, 630), Image.LANCZOS).save(mål, quality=92, optimize=True, subsampling=0)
    print("  sparad", mål, mål.stat().st_size // 1024, "kB")


TELEFON = {"nordrange": (nordrange, "nordrange.png", "nordrange.webp"),
           "epa": (epa, "epa.png", "epa.webp"),
           "mangd": (mangd, "mangdkollen.png", "mangdkollen.webp"),
           "vvs": (vvs, "vvs.png", "vvs.webp")}
DELNING = {"og": ("og.html", "og.jpg"), "og-om": ("og-om.html", "og-om.jpg")}


async def main(argv):
    skriv = "--skriv" in argv
    mål = [a for a in argv if not a.startswith("--")] or ["alla"]
    if "alla" in mål:
        mål = list(TELEFON) + list(DELNING)
    ut = IMG if skriv else UT_TEST
    ut.mkdir(parents=True, exist_ok=True)
    tmp = Path(os.environ.get("TEMP", ".")) / "skarmdumpar"
    tmp.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        for m in mål:
            print(m)
            if m in TELEFON:
                fn, png, webp = TELEFON[m]
                await fn(p, tmp)
                spara_telefonbild(tmp / png, ut / webp)
            elif m in DELNING:
                mall, fil = DELNING[m]
                await delningsbild(p, mall, ut / fil)
            else:
                raise SystemExit("Okänt mål: " + m + ". Välj bland: " + ", ".join(list(TELEFON) + list(DELNING)) + ", alla")
    if not skriv:
        print("Klart. Bilderna ligger i", ut, "(lägg dem i public/img/ för att använda dem, eller kör med --skriv).")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:]))
