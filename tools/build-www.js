/**
 * Kopiert die Web-App nach www/ – das ist der Ordner, den Capacitor in die
 * native App packt. Die Web-Version selbst bleibt ohne Build-Schritt: Sie wird
 * unveraendert aus dem Projektwurzelverzeichnis ausgeliefert.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const ziel = path.join(root, 'www');
const inhalt = ['index.html', 'manifest.webmanifest', 'css', 'js', 'icons'];

fs.rmSync(ziel, { recursive: true, force: true });
fs.mkdirSync(ziel, { recursive: true });

let dateien = 0;
function kopiere(von, nach) {
  const stat = fs.statSync(von);
  if (stat.isDirectory()) {
    fs.mkdirSync(nach, { recursive: true });
    for (const name of fs.readdirSync(von)) kopiere(path.join(von, name), path.join(nach, name));
  } else {
    fs.copyFileSync(von, nach);
    dateien++;
  }
}
for (const name of inhalt) kopiere(path.join(root, name), path.join(ziel, name));

// Der Service Worker gehoert nicht in die native App: Dort liegen die Dateien
// ohnehin lokal, und ein Cache wuerde nach einem Update alte Staende ausliefern.
console.log(`www/ erstellt – ${dateien} Dateien (ohne Service Worker)`);
