/* Durchspielt die App in einem echten Browser (Handy-Viewport).
   Voraussetzung: laufender Webserver auf BASE.  node tests/e2e.js          */
'use strict';
const { chromium, devices } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8099/';
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user-PokerApp/ebf730fc-bb10-58c4-847d-eb9da202c4c5/scratchpad/shots';

let pass = 0, fail = 0;
function check(cond, label, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.error('  FAIL ' + label + (extra ? '\n       ' + extra : '')); }
}

(async () => {
  require('fs').mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'de-DE' });
  const page = await ctx.newPage();

  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(BASE, { waitUntil: 'networkidle' });

  // --- Startzustand -------------------------------------------------------
  console.log('\nStart');
  check(await page.locator('text=Willkommen bei der Pokerkasse').isVisible(), 'Begrüßung für leere App');
  await page.click('text=Spieler anlegen');
  check(await page.locator('#view-players').isVisible(), 'Wechsel zur Spielerliste');

  // --- Spieler anlegen ----------------------------------------------------
  console.log('\nSpieler');
  for (const name of ['Anna', 'Ben', 'Cem']) {
    await page.fill('input[placeholder="Name"]', name);
    await page.click('button:has-text("Hinzufügen")');
  }
  check(await page.locator('#view-players .rows .row').count() === 3, 'drei Spieler in der Liste');

  await page.fill('input[placeholder="Name"]', 'anna');
  await page.click('button:has-text("Hinzufügen")');
  check(await page.locator('#toast').textContent().then(t => t.includes('gibt es schon')), 'Doppelter Name wird abgelehnt');
  check(await page.locator('#view-players .rows .row').count() === 3, 'weiterhin drei Spieler');
  await page.screenshot({ path: SHOTS + '/2-spieler.png' });

  // --- Runde 1: ein Gewinner ---------------------------------------------
  console.log('\nRunde 1 – ein Gewinner');
  await page.click('.tab[data-view="game"]');
  const bets = page.locator('#view-game .bet-input');
  check(await bets.count() === 3, 'drei Einsatzzeilen');

  for (let i = 0; i < 3; i++) await bets.nth(i).fill('5');
  await page.locator('#view-game .pot-amount').waitFor();
  check((await page.locator('.pot-amount').textContent()).trim() === '15,00 €', 'Pot rechnet mit: 15,00 €',
    'war: ' + await page.locator('.pot-amount').textContent());

  await page.click('#view-game .pill:has-text("Anna")');
  check((await page.locator('.payout-line .amt').first().textContent()).includes('15,00'), 'Vorschau zeigt vollen Pot');
  await page.screenshot({ path: SHOTS + '/1-spiel.png' });

  await page.click('button:has-text("Runde abschließen")');
  check((await page.locator('#toast').textContent()).includes('15,00 € an Anna'), 'Bestätigung nennt Gewinner');
  check((await page.locator('.pot-amount').textContent()).trim() === '0,00 €', 'Pot ist nach der Runde leer');

  // Guthaben: Anna −5+15 = +10, Ben und Cem je −5
  await page.click('.tab[data-view="players"]');
  const balOf = async (name) => (await page.locator(`#view-players .row:has(.name:text-is("${name}")) .sub`).textContent()).trim();
  check((await balOf('Anna')).startsWith('10,00 €'), 'Anna hat 10,00 €', 'war: ' + await balOf('Anna'));
  check((await balOf('Ben')).startsWith('-5,00 €'), 'Ben hat -5,00 €', 'war: ' + await balOf('Ben'));

  // --- Runde 2: Split Pot mit Rest-Cent -----------------------------------
  console.log('\nRunde 2 – Split Pot');
  await page.click('.tab[data-view="game"]');
  for (let i = 0; i < 3; i++) await page.locator('#view-game .bet-input').nth(i).fill('0,05');
  check((await page.locator('.pot-amount').textContent()).trim() === '0,15 €', 'Pot 0,15 €');

  await page.click('#view-game .pill:has-text("Ben")');
  await page.click('#view-game .pill:has-text("Cem")');
  const shares = await page.locator('.payout-line .amt').allTextContents();
  check(shares.join('|') === '+0,08 €|+0,07 €', 'Rest-Cent geht an den ersten Gewinner', 'war: ' + shares.join('|'));
  check(await page.locator('.payout-line .tag').count() === 1, 'Rest-Cent ist gekennzeichnet');
  await page.screenshot({ path: SHOTS + '/3-split.png' });
  await page.click('button:has-text("Runde abschließen")');

  await page.click('.tab[data-view="players"]');
  check((await balOf('Ben')).startsWith('-4,97 €'), 'Ben: -5,00 -0,05 +0,08 = -4,97 €', 'war: ' + await balOf('Ben'));
  check((await balOf('Cem')).startsWith('-4,98 €'), 'Cem: -5,00 -0,05 +0,07 = -4,98 €', 'war: ' + await balOf('Cem'));

  // --- Manuelle Aufteilung (Side Pot) -------------------------------------
  console.log('\nRunde 3 – manuelle Aufteilung');
  await page.click('.tab[data-view="game"]');
  for (let i = 0; i < 3; i++) await page.locator('#view-game .bet-input').nth(i).fill('10');
  await page.click('#view-game .pill:has-text("Anna")');
  await page.click('#view-game .pill:has-text("Ben")');
  await page.click('button:has-text("Manuell")');
  const manual = page.locator('#view-game .rows').last().locator('.bet-input');
  check((await page.locator('.rest-note').textContent()).includes('vollständig verteilt'),
    'manuelle Aufteilung startet mit dem gleichmäßigen Split');
  await manual.nth(0).fill('20');
  check((await page.locator('.rest-note').textContent()).includes('Zu viel verteilt: 5,00'), 'Überverteilung wird gemeldet');
  await manual.nth(1).fill('4');
  check((await page.locator('.rest-note').textContent()).includes('Noch offen: 6,00'), 'offener Rest wird gemeldet');
  check(await page.locator('button:has-text("Runde abschließen")').isDisabled(), 'Abschluss gesperrt, solange der Pot nicht aufgeht');
  await manual.nth(1).fill('10');
  check((await page.locator('.rest-note').textContent()).includes('vollständig verteilt'), 'Pot vollständig verteilt');
  await page.click('button:has-text("Runde abschließen")');

  await page.click('.tab[data-view="players"]');
  check((await balOf('Anna')).startsWith('19,95 €'), 'Anna: 9,95 -10,00 +20,00 = 19,95 €', 'war: ' + await balOf('Anna'));

  // --- Einzahlung ---------------------------------------------------------
  console.log('\nEin- und Auszahlung');
  await page.click('#view-players .row:has(.name:text-is("Cem"))');
  await page.click('button:has-text("Geld einzahlen")');
  await page.fill('.modal input[inputmode="decimal"]', '25');
  await page.click('.modal-actions button:has-text("Übernehmen")');
  check((await balOf('Cem')).startsWith('10,02 €'), 'Cem: -14,98 + 25,00 = 10,02 €', 'war: ' + await balOf('Cem'));

  // --- Verlauf und Rückrechnung ------------------------------------------
  console.log('\nVerlauf');
  await page.click('.tab[data-view="history"]');
  check(await page.locator('.entry').count() === 4, 'vier Einträge im Verlauf');
  check((await page.locator('.entry-title').nth(1).textContent()).includes('Pot'), 'Runde erscheint im Verlauf');
  await page.screenshot({ path: SHOTS + '/4-verlauf.png' });

  await page.locator('.entry').nth(1).locator('.entry-del').click();
  await page.click('.modal-actions button:has-text("Löschen")');
  check(await page.locator('.entry').count() === 3, 'Eintrag gelöscht');
  await page.click('.tab[data-view="players"]');
  check((await balOf('Anna')).startsWith('9,95 €'), 'Guthaben nach dem Löschen zurückgerechnet', 'war: ' + await balOf('Anna'));

  // --- Kasse --------------------------------------------------------------
  console.log('\nKasse');
  await page.click('.tab[data-view="cash"]');
  const rows = await page.locator('#view-cash tbody tr').count();
  check(rows === 3, 'Abrechnung listet alle Spieler');
  const netCells = await page.locator('#view-cash tbody tr td:last-child').allTextContents();
  const sum = netCells.map(t => Math.round(parseFloat(t.replace(/[^\d,-]/g, '').replace(',', '.')) * 100))
    .reduce((a, b) => a + b, 0);
  check(sum === 0, 'Summe aller Ergebnisse ist 0', 'war: ' + sum + ' (' + netCells.join(' | ') + ')');
  check(await page.locator('.settle-line').count() > 0, 'Ausgleichszahlungen werden vorgeschlagen');
  await page.screenshot({ path: SHOTS + '/5-kasse.png' });

  // --- Neustart: Daten überleben das Neuladen -----------------------------
  console.log('\nDauerhaftigkeit');
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('.tab[data-view="players"]');
  check(await page.locator('#view-players .rows .row').count() === 3, 'Spieler nach Neuladen noch da');
  check((await balOf('Anna')).startsWith('9,95 €'), 'Guthaben nach Neuladen unverändert');

  // --- Offline ------------------------------------------------------------
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  check(await page.locator('.tabbar').isVisible(), 'App startet auch offline');
  await ctx.setOffline(false);

  // --- Kein horizontales Scrollen auf schmalen Geräten --------------------
  await page.setViewportSize({ width: 320, height: 640 });
  await page.click('.tab[data-view="game"]');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow <= 0, 'kein seitliches Scrollen bei 320 px Breite', 'Überstand: ' + overflow + 'px');

  check(errors.length === 0, 'keine Fehler in der Browser-Konsole', errors.join('\n       '));

  await browser.close();
  console.log('\n' + (fail ? '✗ ' + fail + ' Fehler, ' : '✓ alle bestanden – ') + pass + ' Prüfungen');
  console.log('Screenshots: ' + SHOTS);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
