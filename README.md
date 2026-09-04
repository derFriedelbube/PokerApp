# Pokerkasse

Eine kleine App für den Pokerabend: Wer legt wie viel in den Pot, wer gewinnt –
und wer schuldet am Ende wem wie viel. Läuft auf **Android und iPhone**, ohne
App Store, ohne Anmeldung, auch **ohne Internet**.

<img src="icons/icon-192.png" width="96" alt="App-Symbol">

## Was die App kann

* **Spieler mit Guthaben** – Namen anlegen, Geld einzahlen und auszahlen.
  Das Guthaben bleibt über Abende hinweg gespeichert.
* **Runden eintragen** – für jeden Spieler den Einsatz eintippen (±-Tasten mit
  frei einstellbaren Chip-Werten, oder „Alle +1,00 €“ für Blinds und Antes).
  Der Pot wird laufend mitgerechnet.
* **Gewinner antippen** – das Geld wird automatisch abgezogen und gutgeschrieben.
* **Split Pot** – mehrere Gewinner antippen, der Pot wird gleichmäßig geteilt.
  Ein nicht teilbarer Rest-Cent geht wie am Tisch an den zuerst gewählten
  Spieler und wird sichtbar gekennzeichnet.
* **Manuelle Aufteilung** – für Side-Pots (All-in) lässt sich jeder Anteil
  einzeln eintragen. Die Runde lässt sich erst abschließen, wenn der Pot
  genau aufgeht.
* **Verlauf** – jede Runde und jede Zahlung ist nachvollziehbar und einzeln
  löschbar. Die Guthaben werden dabei korrekt zurückgerechnet.
* **Kasse** – Gewinn/Verlust je Spieler und ein Vorschlag, wer wem am Ende
  wie viel bar geben muss (mit möglichst wenigen Zahlungen).

Alle Beträge werden intern in ganzen Cent gerechnet, es gehen also keine
Rundungsfehler verloren: Die Summe der Anteile ist immer exakt der Pot.

---

## 1. App ins Netz stellen (einmalig, ca. 2 Minuten)

Damit sich die App aufs Handy installieren lässt, muss sie über **https**
erreichbar sein. Am einfachsten geht das gratis über GitHub Pages:

1. Dieses Repository auf GitHub öffnen.
2. Oben auf **Settings** klicken.
3. Links im Menü auf **Pages**.
4. Bei *Source* **„Deploy from a branch“** auswählen.
5. Bei *Branch* den Branch `claude/poker-money-tracker-app-s1l0x4` (oder `main`,
   falls schon zusammengeführt) und den Ordner **`/ (root)`** wählen.
6. Auf **Save** klicken und ein bis zwei Minuten warten.

Danach ist die App erreichbar unter:

```
https://derfriedelbube.github.io/PokerApp/
```

> **Hinweis:** GitHub Pages funktioniert bei kostenlosen Konten nur für
> **öffentliche** Repositories. Ist das Repo privat, macht es entweder unter
> *Settings → General → Danger Zone → Change visibility* öffentlich, oder nutzt
> eine der Alternativen weiter unten.

### Alternativen zu GitHub Pages

| Weg | Vorgehen |
| --- | --- |
| **Netlify Drop** | Ordner herunterladen und auf <https://app.netlify.com/drop> ziehen – fertig, inklusive https-Adresse. |
| **Vercel / Cloudflare Pages** | Repository verbinden, keine Build-Einstellungen nötig (es sind reine statische Dateien). |
| **Nur ausprobieren** | `python3 -m http.server 8099` im Projektordner starten und am Rechner `http://localhost:8099` öffnen. |

---

## 2. Auf dem Handy installieren

### iPhone / iPad

1. Die Adresse in **Safari** öffnen (wichtig: nicht Chrome).
2. Unten auf das **Teilen-Symbol** tippen (Quadrat mit Pfeil nach oben).
3. Etwas nach unten scrollen und **„Zum Home-Bildschirm“** wählen.
4. Oben rechts auf **„Hinzufügen“** tippen.

Die Pokerkasse liegt jetzt als eigenes Symbol auf dem Home-Bildschirm und
startet im Vollbild – ohne Safari-Leisten, wie eine normale App.

### Android

1. Die Adresse in **Chrome** öffnen.
2. Chrome bietet meist von selbst **„App installieren“** an. Falls nicht:
   oben rechts das **Menü (⋮)** antippen und **„App installieren“** bzw.
   **„Zum Startbildschirm zufügen“** wählen.
3. Bestätigen.

In der App gibt es oben rechts auch ein Teilen-Symbol, das diese Schritte
noch einmal erklärt (oder die Installation direkt startet).

### Nach der Installation

* Die App funktioniert **offline** – die Dateien liegen auf dem Gerät.
* Die Daten werden **nur lokal auf diesem Handy** gespeichert. Es gibt keinen
  Server und kein Konto; niemand sonst sieht eure Beträge.
* Am besten führt **ein Handy** die Kasse. Über *Kasse → Daten → Sichern* könnt
  ihr die Daten als Datei ausgeben und auf einem anderen Gerät über
  *Laden* wieder einspielen.

---

## 3. So läuft ein Abend ab

1. **Spieler** → alle Namen eintragen. Wer heute nicht mitspielt, wird mit dem
   Schalter auf „sitzt aus“ gestellt.
2. Optional: auf einen Namen tippen → **Geld einzahlen**, wenn jemand Bargeld
   in die Kasse legt.
3. **Spiel** → Einsätze eintragen, Gewinner antippen, **Runde abschließen**.
   Vertippt? Direkt danach erscheint unten **„Rückgängig“**; später lässt sich
   jeder Eintrag im **Verlauf** löschen.
4. **Kasse** → am Ende des Abends zeigt die Tabelle Gewinn und Verlust, darunter
   steht, wer wem wie viel bar geben muss.
5. Mit **„Abend abschließen“** werden alle Guthaben auf 0 gesetzt und eine neue
   Abrechnung beginnt. Der Verlauf bleibt erhalten.

---

## Aufbau des Projekts

```
index.html              Grundgerüst und Icon-Sammlung
css/styles.css          Gestaltung (dunkel, für Handys ausgelegt)
js/core.js              Rechenkern: Beträge, Pot-Aufteilung, Guthaben, Abrechnung
js/app.js               Oberfläche: Ansichten, Eingaben, Speichern
sw.js                   Service Worker – macht die App offline nutzbar
manifest.webmanifest    Angaben für die Installation (Name, Symbole, Farben)
icons/                  App-Symbole
tests/core.test.js      Tests des Rechenkerns
tests/e2e.js            Test der kompletten App im Browser
```

Die Guthaben werden **nie direkt gespeichert**, sondern jedes Mal aus der Liste
aller Ereignisse (Einzahlung, Runde, Auszahlung …) neu berechnet. Deshalb kann
man jeden Eintrag im Verlauf löschen, ohne dass die Beträge auseinanderlaufen.

## Tests

```bash
node tests/core.test.js               # Rechenkern

python3 -m http.server 8099 &         # App bereitstellen
node tests/e2e.js                     # kompletter Durchlauf im Browser
```

Der Browser-Test braucht Playwright (`npm i -D playwright`) und spielt einen
ganzen Abend durch: Spieler anlegen, Runden mit einem und mehreren Gewinnern,
Rest-Cent-Verteilung, Side-Pot, Einzahlung, Löschen im Verlauf, Abrechnung,
Neustart und Offline-Betrieb.

## Änderungen an der App

Nach jeder Änderung an den Dateien in `sw.js` die Zeile

```js
var CACHE = 'pokerkasse-v1';
```

hochzählen (`v2`, `v3` …). Sonst behalten bereits installierte Apps die alte
Version im Zwischenspeicher.
