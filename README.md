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

## 1. Die Adresse der App

Die App ist bereits veröffentlicht und erreichbar unter:

```
https://derfriedelbube.github.io/PokerApp/
```

Um das Veröffentlichen kümmert sich der Workflow `.github/workflows/pages.yml`:
Bei jedem Push auf `claude/poker-money-tracker-app-s1l0x4` oder `main` lädt er
die Dateien unverändert zu GitHub Pages hoch. Es gibt keinen Build-Schritt.

### Falls die Adresse einen 404 zeigt

Dann steht die Veröffentlichungsquelle nicht richtig. Unter
**Settings → Pages → Build and deployment → Source** muss **„GitHub Actions"**
ausgewählt sein (nicht „Deploy from a branch"). Danach unter **Actions** den
Workflow *GitHub Pages* auswählen und **Run workflow** anstoßen – oder einfach
den nächsten Push abwarten.

Unter **Actions** ist auch zu sehen, ob ein Deployment gelaufen ist und ob es
erfolgreich war. Nach dem ersten Mal dauert es ein bis zwei Minuten, bis die
Adresse antwortet.

> **Hinweis:** GitHub Pages funktioniert bei kostenlosen Konten nur für
> **öffentliche** Repositories. Dieses Repository ist öffentlich, damit passt es.

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

## Wo die Daten liegen

Die App braucht keinen Server und kein Konto – alles bleibt auf dem Handy.
Damit dabei nichts verloren geht, wird mehrfach abgesichert:

* **Zwei Speicher gleichzeitig.** Jeder Stand wird sowohl in die Datenbank des
  Browsers (IndexedDB) als auch in den Browserspeicher (localStorage)
  geschrieben. Wird einer davon geleert, holt die App die Daten beim nächsten
  Start aus dem anderen und legt die fehlende Kopie neu an.
* **Dauerhafter Speicher.** Die App fordert beim Start
  `navigator.storage.persist()` an. Ohne diese Zusage darf ein Browser
  gespeicherte Daten bei Platzmangel von sich aus löschen; mit ihr nicht.
  Als installierte App vom Home-Bildschirm wird sie in der Regel erteilt.
* **Automatische Sicherungen.** Einmal täglich und immer vor Schritten, die
  Daten überschreiben (Sicherung laden, alles löschen, Abend abschließen),
  legt die App eine Kopie an. Die letzten zwölf lassen sich unter
  *Einstellungen → Sicherungen* zurückspielen.
* **Export.** Unter *Kasse → Daten → Sichern* gibt es alles als JSON-Datei.
  Das ist die einzige Kopie, die einen Handyverlust übersteht – und der Weg,
  die Daten auf ein anderes Gerät zu bringen. Nach zwei Wochen ohne Export
  erinnert die App daran.

Unter *Einstellungen* steht jederzeit, in welchen Speichern die Daten liegen,
ob sie als dauerhaft bestätigt sind, wie viele Sicherungen es gibt und wann
zuletzt exportiert wurde.

### Wichtig für das iPhone

Safari löscht Daten von Webseiten, die **sieben Tage** lang nicht benutzt
wurden. Für Web-Apps, die auf dem **Home-Bildschirm installiert** sind, gilt
diese Regel **nicht**. Öffnet die Pokerkasse also über das installierte Symbol
und nicht als Lesezeichen in Safari.

Was auch der beste lokale Speicher nicht abfängt: ein verlorenes Handy, ein
Zurücksetzen des Geräts oder „Website-Daten löschen". Dagegen hilft nur der
Export.

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
.github/workflows/      Veröffentlicht die App bei jedem Push auf GitHub Pages
index.html              Grundgerüst und Icon-Sammlung
css/styles.css          Gestaltung (dunkel, für Handys ausgelegt)
js/core.js              Rechenkern: Beträge, Pot-Aufteilung, Guthaben, Abrechnung
js/store.js             Speicherung: zwei Speicher, Sicherungen, Dauerhaftigkeit
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
Neustart und Offline-Betrieb. Dazu die Speicherung: dass die Daten in beiden
Speichern ankommen, dass ein geleerter Speicher aus dem anderen wieder
aufgefüllt wird und dass sich ein versehentliches Löschen aus der Sicherung
zurückholen lässt.

## Änderungen an der App

Nach jeder Änderung an den Dateien in `sw.js` die Zeile

```js
var CACHE = 'pokerkasse-v1';
```

hochzählen (`v2`, `v3` …). Sonst behalten bereits installierte Apps die alte
Version im Zwischenspeicher.
