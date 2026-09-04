/* Spielt eine komplette Hand über die Oberfläche durch.
   Voraussetzung: laufender Webserver auf BASE.   node tests/e2e-tisch.js   */
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
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'de-DE' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  // Das native App-Bündel enthält absichtlich keinen Service Worker. Wird es
  // ersatzweise im Browser geprüft, ist dessen 404 kein Fehler der App.
  const ohneSW = process.env.BUNDLE === 'native';
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (ohneSW && /fetching the script|sw\.js/.test(m.text())) return;
    errors.push('console: ' + m.text());
  });

  await page.goto(BASE, { waitUntil: 'networkidle' });

  const pot = async () => (await page.locator('#view-game .felt-pot').textContent()).trim();
  const balOf = async (name) =>
    (await page.locator(`#view-players .row:has(.name:text-is("${name}")) .sub`).textContent()).trim();
  const amZug = async () => {
    const el = page.locator('#view-game .pseat.is-active .pseat-name');
    return await el.count() ? (await el.textContent()).trim() : null;
  };

  // --- Spieler anlegen und Geld einzahlen --------------------------------
  console.log('\nVorbereitung');
  await page.click('text=Spieler anlegen');
  for (const n of ['Anna', 'Ben', 'Cem']) {
    await page.fill('input[placeholder="Name"]', n);
    await page.click('button:has-text("Hinzufügen")');
  }
  for (const n of ['Anna', 'Ben', 'Cem']) {
    await page.click(`#view-players .row:has(.name:text-is("${n}"))`);
    await page.click('button:has-text("Geld einzahlen")');
    await page.fill('.modal input[inputmode="decimal"]', '50');
    await page.click('.modal-actions button:has-text("Übernehmen")');
  }
  check((await balOf('Anna')).startsWith('50,00 €'), 'jeder startet mit 50,00 €');

  // --- Tisch aufbauen ----------------------------------------------------
  console.log('\nTisch');
  await page.click('.tab[data-view="game"]');
  check(await page.locator('#view-game .segmented button:has-text("Tisch")').isVisible(), 'Tisch-Modus vorhanden');
  for (const n of ['Anna', 'Ben', 'Cem']) {
    await page.click(`#view-game .pills .pill:has-text("${n}")`);
  }
  check(await page.locator('#view-game .seat').count() === 3, 'drei Spieler sitzen am Tisch');
  check((await page.locator('#view-game .seat').first().locator('.seat-badge').textContent()).trim() === 'D',
    'erster Sitz ist der Dealer');

  // Reihenfolge ändern: Anna eins nach unten
  await page.locator('#view-game .seat').first().locator('button[aria-label="nach unten"]').click();
  const namen = await page.locator('#view-game .seat .name').allTextContents();
  check(namen.join(',') === 'Ben,Anna,Cem', 'Sitzreihenfolge lässt sich ändern', 'war: ' + namen.join(','));
  await page.locator('#view-game .seat').nth(1).locator('button[aria-label="nach oben"]').click();
  check((await page.locator('#view-game .seat .name').allTextContents()).join(',') === 'Anna,Ben,Cem',
    'Reihenfolge wieder hergestellt');
  await page.screenshot({ path: SHOTS + '/9-tisch.png' });

  // --- Hand spielen -------------------------------------------------------
  console.log('\nHand');
  await page.click('button:has-text("Hand starten")');
  check(await page.locator('#actionbar').isVisible(), 'Aktionsleiste erscheint');
  check(await pot() === '1,50 €', 'Blinds liegen im Pot (0,50 + 1,00)', 'war: ' + await pot());
  check(await amZug() === 'Anna', 'zu dritt beginnt der Dealer', 'war: ' + await amZug());
  check((await page.locator('.act-call span').textContent()).includes('Mitgehen'), 'Mitgehen wird angeboten');
  check((await page.locator('.act-call small').textContent()).trim() === '1,00 €', 'Betrag zum Mitgehen stimmt',
    'war: ' + await page.locator('.act-call small').textContent());
  await page.screenshot({ path: SHOTS + '/10-hand.png' });

  // Anna erhöht auf 4,00
  await page.click('.act-raise');
  await page.fill('.raise-panel input', '4');
  await page.click('.raise-panel button:has-text("Setzen")');
  // Anna ist Dealer und hat noch nichts im Pot: 0,50 (SB) + 1,00 (BB) + 4,00.
  check(await pot() === '5,50 €', 'Pot nach der Erhöhung: 5,50 €', 'war: ' + await pot());
  check(await amZug() === 'Ben', 'Ben ist dran');

  await page.click('.act-call');                       // Ben geht mit (3,50)
  check(await amZug() === 'Cem', 'Cem ist dran');
  await page.click('.act-fold');                       // Cem steigt aus
  check(await pot() === '9,00 €', 'Pot 9,00 € (4+4+1 Big Blind)', 'war: ' + await pot());

  check((await page.locator('#actionbar .btn-primary').textContent()).includes('Flop'),
    'Setzrunde beendet, weiter zum Flop');
  await page.click('#actionbar .btn-primary');
  check(await amZug() === 'Ben', 'nach dem Flop beginnt der Spieler links vom Dealer',
    'war: ' + await amZug());
  check((await page.locator('.act-call span').textContent()).includes('Schieben'), 'ohne Einsatz kann geschoben werden');

  await page.click('.act-call');                       // Ben schiebt
  await page.click('.act-call');                       // Anna schiebt
  await page.click('#actionbar .btn-primary');         // Turn
  await page.click('.act-call'); await page.click('.act-call');
  await page.click('#actionbar .btn-primary');         // River
  await page.click('.act-call'); await page.click('.act-call');
  check(await page.locator('#view-game .pills').count() > 0, 'Showdown erreicht');
  check(await page.locator('#actionbar').count() === 0, 'Aktionsleiste ist im Showdown weg');

  // --- Split Pot ----------------------------------------------------------
  console.log('\nGewinner');
  const pills = await page.locator('#view-game .card:has-text("Pot") .pill').allTextContents();
  check(pills.length === 2, 'nur die verbliebenen Spieler stehen zur Wahl', 'war: ' + pills.join(','));
  await page.click('#view-game .pill:has-text("Anna")');
  await page.click('#view-game .pill:has-text("Ben")');
  const anteile = await page.locator('.payout-line .amt').allTextContents();
  check(anteile.join('|') === '+4,50 €|+4,50 €', 'Split Pot halbiert 9,00 €', 'war: ' + anteile.join('|'));
  await page.screenshot({ path: SHOTS + '/11-showdown.png' });

  await page.click('button:has-text("Hand abschließen")');
  check((await page.locator('#toast').textContent()).includes('9,00 € an'), 'Bestätigung nennt den Pot');

  await page.click('.tab[data-view="players"]');
  // Anna: 50,00 eingezahlt, 4,00 gesetzt, 4,50 gewonnen.
  check((await balOf('Anna')).startsWith('50,50 €'), 'Anna: 50,00 -4,00 +4,50 = 50,50 €',
    'war: ' + await balOf('Anna'));
  check((await balOf('Ben')).startsWith('50,50 €'), 'Ben ebenso 50,50 €', 'war: ' + await balOf('Ben'));
  check((await balOf('Cem')).startsWith('49,00 €'), 'Cem verliert seinen Big Blind', 'war: ' + await balOf('Cem'));

  // --- Zweite Hand: All-in mit kleinem Stack erzeugt einen Nebenpot --------
  console.log('\nNebenpot bei All-in');
  // Cem auf einen kleinen Stack bringen: 46,00 € auszahlen -> 3,00 € übrig.
  await page.click('#view-players .row:has(.name:text-is("Cem"))');
  await page.click('button:has-text("Geld auszahlen")');
  await page.fill('.modal input[inputmode="decimal"]', '46');
  await page.click('.modal-actions button:has-text("Übernehmen")');
  check((await balOf('Cem')).startsWith('3,00 €'), 'Cem hat nur noch 3,00 €', 'war: ' + await balOf('Cem'));

  await page.click('.tab[data-view="game"]');
  await page.click('button:has-text("Hand starten")');
  // Der Dealer ist nach der ersten Hand weitergerückt: jetzt Ben.
  check(await amZug() === 'Ben', 'Dealer ist weitergerückt', 'war: ' + await amZug());

  await page.click('.act-raise');                      // Ben erhöht auf 10,00
  await page.fill('.raise-panel input', '10');
  await page.click('.raise-panel button:has-text("Setzen")');
  check(await amZug() === 'Cem', 'Cem (Small Blind) ist dran');
  check((await page.locator('.act-call span').textContent()).includes('All-in'),
    'Cem kann nur noch All-in gehen', 'war: ' + await page.locator('.act-call span').textContent());
  await page.click('.act-call');                       // Cem all-in mit 3,00
  await page.click('.act-call');                       // Anna geht mit 10,00

  // Weiter bis zum Showdown – Ben und Anna checken durch.
  for (let i = 0; i < 3; i++) {
    await page.click('#actionbar .btn-primary');
    if (await page.locator('.act-call').count()) {
      await page.click('.act-call'); await page.click('.act-call');
    }
  }
  const potKarten = await page.locator('#view-game .card-head h2').allTextContents();
  check(potKarten.includes('Hauptpot') && potKarten.includes('Nebenpot 1'),
    'App bildet Haupt- und Nebenpot', 'war: ' + potKarten.join(','));

  const betraege = await page.locator('#view-game .card:has(.pills) .card-head .sub').allTextContents();
  check(betraege[0] === '9,00 €', 'Hauptpot 3 × 3,00 = 9,00 €', 'war: ' + betraege.join(' | '));
  check(betraege[1] === '14,00 €', 'Nebenpot 2 × 7,00 = 14,00 €', 'war: ' + betraege.join(' | '));

  const hauptPills = await page.locator('#view-game .card:has-text("Hauptpot") .pill').allTextContents();
  check(hauptPills.length === 3, 'am Hauptpot sind alle drei beteiligt', 'war: ' + hauptPills.join(','));
  const nebenPills = await page.locator('#view-game .card:has-text("Nebenpot") .pill').allTextContents();
  check(nebenPills.length === 2 && !nebenPills.join(',').includes('Cem'),
    'Cem kann den Nebenpot nicht gewinnen', 'war: ' + nebenPills.join(','));
  await page.screenshot({ path: SHOTS + '/12-nebenpot.png' });

  // Cem gewinnt den Hauptpot, Anna den Nebenpot.
  await page.click('#view-game .card:has-text("Hauptpot") .pill:has-text("Cem")');
  await page.click('#view-game .card:has-text("Nebenpot") .pill:has-text("Anna")');
  await page.click('button:has-text("Hand abschließen")');

  await page.click('.tab[data-view="players"]');
  check((await balOf('Cem')).startsWith('9,00 €'), 'Cem: 3,00 all-in, gewinnt 9,00 € Hauptpot',
    'war: ' + await balOf('Cem'));
  check((await balOf('Anna')).startsWith('54,50 €'), 'Anna: 50,50 -10,00 +14,00 = 54,50 €',
    'war: ' + await balOf('Anna'));
  check((await balOf('Ben')).startsWith('40,50 €'), 'Ben: 50,50 -10,00 = 40,50 €',
    'war: ' + await balOf('Ben'));

  // --- Grafischer Tisch ---------------------------------------------------
  console.log('\nTisch-Darstellung');
  await page.click('.tab[data-view="game"]');
  await page.click('button:has-text("Hand starten")');
  check(await page.locator('#view-game .ptable .pseat').count() === 3, 'drei Sitze am Tisch');
  check(await page.locator('#view-game .felt').count() === 1, 'Tischfläche wird gezeichnet');
  check(await page.locator('#view-game .pseat.is-active').count() === 1, 'genau ein Sitz ist hervorgehoben');
  check(await page.locator('#view-game .pseat-dealer').count() === 1, 'Dealer-Button sitzt an genau einem Platz');
  check(await page.locator('#view-game .pbet').count() === 2, 'die beiden Blinds liegen als Chips auf dem Tisch');

  // Sitze müssen tatsächlich verteilt sein, nicht übereinander liegen.
  const positionen = await page.evaluate(() => [...document.querySelectorAll('.pseat')]
    .map(s => { const r = s.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; }));
  const verschieden = new Set(positionen.map(p => p.join(','))).size;
  check(verschieden === 3, 'die Sitze liegen an verschiedenen Stellen', JSON.stringify(positionen));

  const sichtbar = await page.evaluate(() => {
    const main = document.getElementById('main').getBoundingClientRect();
    return [...document.querySelectorAll('.pseat')].every(s => {
      const r = s.getBoundingClientRect();
      return r.top >= main.top - 1 && r.bottom <= main.bottom + 1;
    });
  });
  check(sichtbar, 'alle Sitze liegen im sichtbaren Bereich');
  check(await page.evaluate(() => {
    const m = document.getElementById('main');
    return m.scrollHeight <= m.clientHeight + 1;
  }), 'der Tisch passt ohne Scrollen auf den Schirm');

  // --- Zurückgehen --------------------------------------------------------
  console.log('\nZurückgehen');
  check(await page.locator('.undo-btn').isDisabled(), 'am Anfang ist Zurück gesperrt');
  const potVorher = await pot();
  const dranVorher = await amZug();
  await page.click('.act-fold');
  check(await amZug() !== dranVorher, 'nach dem Aussteigen ist jemand anders dran');
  check(await page.locator('#view-game .pseat.is-folded').count() === 1, 'der Sitz ist als ausgestiegen markiert');

  check(!(await page.locator('.undo-btn').isDisabled()), 'Zurück ist jetzt möglich');
  await page.click('.undo-btn');
  check(await amZug() === dranVorher, 'wieder derselbe Spieler am Zug', 'war: ' + await amZug());
  check(await page.locator('#view-game .pseat.is-folded').count() === 0, 'Aussteigen wurde zurückgenommen');
  check(await pot() === potVorher, 'Pot unverändert');
  check(await page.locator('.undo-btn').isDisabled(), 'Zurück wieder gesperrt');

  // Mehrere Schritte, auch über eine Setzrunde hinweg.
  await page.click('.act-raise');
  await page.fill('.raise-panel input', '5');
  await page.click('.raise-panel button:has-text("Setzen")');
  await page.click('.act-call'); await page.click('.act-call');
  check((await page.locator('#actionbar .btn-primary').textContent()).includes('Flop'), 'Preflop beendet');
  await page.click('#actionbar .btn-primary');
  const potFlop = await pot();
  await page.click('.act-call');                     // schieben
  await page.click('.undo-btn');                     // zurück
  await page.click('.undo-btn');                     // zurück in die Vorrunde
  check((await page.locator('#actionbar .btn-primary').textContent()).includes('Flop'),
    'zurück in die abgeschlossene Preflop-Runde');
  check(await pot() === potFlop, 'Pot dabei unverändert');
  await page.screenshot({ path: SHOTS + '/14-zurueck.png' });

  // Ganz zurück an den Anfang der Hand.
  let schutz = 0;
  while (!(await page.locator('.undo-btn').isDisabled()) && schutz++ < 20) await page.click('.undo-btn');
  check(await pot() === potVorher, 'ganz zurück: nur noch die Blinds im Pot', 'war: ' + await pot());

  await page.click('a:has-text("x"), .link.danger');
  await page.click('.modal-actions button:has-text("Abbrechen")');

  check(errors.length === 0, 'keine Fehler in der Browser-Konsole', errors.join('\n       '));
  await browser.close();
  console.log('\n' + (fail ? '✗ ' + fail + ' Fehler, ' : '✓ alle bestanden – ') + pass + ' Prüfungen');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
