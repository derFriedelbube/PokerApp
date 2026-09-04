# Die Pokerkasse als native App

Die native App ist dieselbe Anwendung wie die Web-Version, verpackt in eine
echte Android- bzw. iOS-App. Dafür sorgt [Capacitor](https://capacitorjs.com):
Es gibt weiterhin nur **eine** Codebasis in `index.html`, `css/` und `js/`.

---

## Android

### Fertige App installieren

1. Die Datei **`app-debug.apk`** aufs Handy laden. Sie liegt bei jedem Bauvorgang
   unter **Actions → Android-App → (letzter Lauf) → Artifacts → `pokerkasse-apk`**.
2. Die Datei auf dem Handy öffnen.
3. Android fragt nach der Erlaubnis, Apps aus dieser Quelle zu installieren
   (*„Unbekannte Apps installieren"*) – erlauben.
4. Auf **Installieren** tippen. Die Pokerkasse liegt danach im App-Menü.

> Die APK ist mit dem Standard-Debug-Zertifikat signiert. Das genügt zum
> Installieren; für den Play Store bräuchte es einen eigenen Signierschlüssel
> (siehe unten).

### Selbst bauen

Nötig sind Node.js, ein JDK 21 und das Android-SDK (am einfachsten über
Android Studio).

```bash
npm install
npm run apk
# Ergebnis: android/app/build/outputs/apk/debug/app-debug.apk
```

Einzelschritte, falls etwas hakt:

```bash
npm run www          # Web-Dateien nach www/ kopieren
npx cap sync android # nach android/ übernehmen
cd android && ./gradlew assembleDebug
```

### Für den Play Store

Dafür braucht es eine signierte Release-Version und ein Google-Play-Konto
(einmalig 25 $):

```bash
keytool -genkey -v -keystore pokerkasse.keystore -alias pokerkasse \
        -keyalg RSA -keysize 2048 -validity 10000
cd android && ./gradlew bundleRelease
```

Den Schlüssel gut aufbewahren – ohne ihn lassen sich später keine Updates mehr
veröffentlichen.

---

## iPhone und iPad

**Wichtig: Eine iOS-App lässt sich nur auf einem Mac bauen.** Apple erlaubt das
Erzeugen von iOS-Apps ausschließlich mit Xcode unter macOS. Das iOS-Projekt
liegt fertig vorbereitet im Ordner `ios/`, gebaut werden muss es auf einem Mac.

### Auf dem Mac

```bash
npm install
npm run www
npx cap sync ios
npx cap open ios        # öffnet Xcode
```

In Xcode dann:

1. Links das Projekt **App** auswählen → Reiter **Signing & Capabilities**.
2. Bei *Team* das eigene Apple-Konto wählen (ein kostenloses genügt).
3. Das iPhone per Kabel anschließen und oben als Ziel auswählen.
4. Auf **Run** (▶) drücken.

### Was das kostet

| Weg | Kosten | Haltbarkeit |
| --- | --- | --- |
| Kostenloses Apple-Konto | 0 € | App läuft **7 Tage**, danach neu aufspielen |
| Apple Developer Program | 99 €/Jahr | 1 Jahr, App Store und TestFlight möglich |

**Ohne Mac gibt es keinen Weg zu einer nativen iOS-App.** Wer keinen Mac hat,
nutzt die Web-App: Sie wird in Safari über *Teilen → Zum Home-Bildschirm*
installiert, liegt danach als eigenes Symbol auf dem Home-Bildschirm, startet
im Vollbild und läuft offline – ohne Mac, ohne Konto, ohne Kosten.

---

## Unterschiede zur Web-App

* **Kein Service Worker.** In der nativen App liegen die Dateien ohnehin auf dem
  Gerät. Ein Cache würde nach einem Update den alten Stand ausliefern, deshalb
  packt `tools/build-www.js` den Service Worker bewusst nicht mit ein.
* **Zurück-Taste (Android).** Sie schließt erst offene Dialoge, wechselt dann
  zur Spielansicht und beendet die App erst danach.
* **Speicherung.** Unverändert: dieselben zwei Speicher, dieselben automatischen
  Sicherungen. In der nativen App liegen die Daten im geschützten App-Bereich
  und werden vom Browser nicht angetastet.

Die Daten der Web-App und der nativen App sind **getrennt**. Zum Umziehen die
Daten in der einen unter *Kasse → Daten → Sichern* exportieren und in der
anderen über *Laden* einspielen.

## Nach Änderungen am Code

```bash
npm run www && npx cap sync    # Web-Dateien in beide Projekte übernehmen
```

Die Web-Version selbst braucht keinen Build-Schritt – sie wird unverändert aus
dem Projektwurzelverzeichnis ausgeliefert.
