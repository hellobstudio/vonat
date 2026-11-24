# Vonat – indulások egy pillantással

Megmutatja az összes vonatot és buszt két megálló között egy beállított idősávban
(alapból **Monor → Kőbánya-Kispest, munkanapokon 6:20–7:30**), késéssel együtt,
és **percenként frissül**. Nem kell hozzá menetrendet nyitni és keresgélni.

Az adatok a MÁV-Volán EMMA (OpenTripPlanner) nyilvános API-jából jönnek, ebben
a MÁV-vonatok és a Volánbusz járatai is benne vannak, valós idejű késéssel.

## Mit tud

- Beállítható: **honnan**, **hova** (megállónév-kereséssel), **mettől–meddig**, **vonat / busz**,
  mely **napokon**, csak **átszállás nélküli** járatok.
- Munkanapok: hétfő–péntek, a magyar ünnepnapok (húsvét, pünkösd is) kihagyva.
  Áthelyezett szabadnapok és ledolgozós szombatok a „Haladó” részben adhatók meg.
- Ha a mai idősáv már lejárt (vagy ma nincs munkanap), automatikusan a **következő munkanapot** mutatja.
- Minden járatnál látszik: indulás (késésnél az eredeti idő áthúzva), érkezés, vágány,
  vonatszám vagy járatszám, és hány perc múlva indul. A következő elérhető járat kiemelve.

## 1. Webes app (Android és iPhone)

`index.html` + `app.js` + `style.css`: telepíthető webapp (PWA), nyitva tartva percenként frissül.

**Közzététel GitHub Pages-en:** a repóban Settings → Pages → Branch: `main` / root → Save.
Utána nyisd meg a kapott címet a telefonon, és:
- **Android (Chrome):** ⋮ menü → *Hozzáadás a kezdőképernyőhöz* / *Alkalmazás telepítése*
- **iPhone (Safari):** Megosztás → *Főképernyőhöz adás*

Helyben kipróbálni: `python3 -m http.server` a mappában, majd `http://localhost:8000`.

### Proxy (csak ha kell)
Ha az app „hálózati vagy CORS hiba” üzenetet ír, a MÁV szervere nem engedi a
böngészőből érkező közvetlen hívást. Ilyenkor a `proxy/cloudflare-worker.js` fájlt
tedd ki egy ingyenes Cloudflare Workerbe, és a címét írd be az `app.js` `DEFAULT_API` sorába, vagy:
Beállítások → Haladó → *API cím*.

## 2. iPhone kezdőképernyő-widget (Scriptable)

`widget/scriptable-vonat.js`: valódi widget, az app megnyitása nélkül is látszik.

1. Telepítsd a **Scriptable** appot (ingyenes, App Store).
2. Scriptable → `+` → illeszd be a fájl teljes tartalmát → nevezd el „Vonat”-nak.
3. Kezdőképernyő → hosszan nyomva → `+` → Scriptable → közepes vagy nagy widget →
   *Script*: Vonat.
4. Beállítás: a fájl elején a `CONFIG` blokk, vagy a widget *Parameter* mezőjébe JSON, pl.
   `{"from":"Kőbánya-Kispest","to":"Monor","start":"16:00","end":"18:00"}`.
   Így két widget is lehet: egy reggeli és egy esti irány.

> Megjegyzés: a widget percenkénti frissítést kér, de az iOS ezt saját maga ritkítja
> (jellemzően 5–15 percre). A pontos, percenkénti frissítéshez a webappot használd.

Androidon a webapp kezdőképernyőre tett ikonja a javasolt megoldás.
