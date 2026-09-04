/* Tests der Kernlogik:  node tests/core.test.js  */
'use strict';
var C = require('../js/core.js');

var pass = 0, fail = 0;
function eq(actual, expected, label) {
  var a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; console.error('  FAIL  ' + label + '\n        erwartet ' + e + '\n        war      ' + a); }
}
function group(name, fn) { console.log('\n' + name); fn(); }

group('Betragseingabe', function () {
  eq(C.parseAmount('12'), 1200, 'ganze Zahl');
  eq(C.parseAmount('12,50'), 1250, 'deutsches Komma');
  eq(C.parseAmount('12.50'), 1250, 'englischer Punkt');
  eq(C.parseAmount(' 5 € '), 500, 'Waehrung und Leerzeichen');
  eq(C.parseAmount('1.234,56'), 123456, 'deutscher Tausenderpunkt');
  eq(C.parseAmount('1,234.56'), 123456, 'englisches Tausenderkomma');
  eq(C.parseAmount('0,10'), 10, 'Cent');
  eq(C.parseAmount('-3'), -300, 'negativer Betrag (Korrektur)');
  eq(C.parseAmount(''), null, 'leer');
  eq(C.parseAmount('abc'), null, 'Text');
  eq(C.parseAmount('1,2,3'), null, 'unsinnige Zahl');
  eq(C.parseAmount(0.07), 7, 'Zahl statt String (Rundung)');
});

group('Anzeige', function () {
  eq(C.formatCents(1250), '12,50', 'Standard');
  eq(C.formatCents(5), '0,05', 'unter einem Euro');
  eq(C.formatCents(-1250), '-12,50', 'negativ');
  eq(C.formatCents(123456789), '1.234.567,89', 'Tausenderpunkte');
  eq(C.formatSigned(1250, '€'), '+12,50 €', 'Vorzeichen bei Gewinn');
  eq(C.formatSigned(0, '€'), '0,00 €', 'Null ohne Vorzeichen');
});

group('Pot-Aufteilung', function () {
  eq(C.splitEven(1000, ['a']).map(function (x) { return x.amount; }), [1000], 'ein Gewinner');
  eq(C.splitEven(1000, ['a', 'b']).map(function (x) { return x.amount; }), [500, 500], 'glatt teilbar');
  eq(C.splitEven(1000, ['a', 'b', 'c']).map(function (x) { return x.amount; }), [334, 333, 333], 'Rest-Cent an den Ersten');
  eq(C.splitEven(1001, ['a', 'b', 'c']).map(function (x) { return x.amount; }), [334, 334, 333], 'zwei Rest-Cent');
  eq(C.splitEven(0, ['a', 'b']).map(function (x) { return x.amount; }), [0, 0], 'leerer Pot');
  eq(C.splitEven(1000, []), [], 'kein Gewinner');

  // Kein Cent darf beim Teilen verschwinden oder entstehen.
  var leak = null;
  for (var pot = 0; pot < 400 && !leak; pot++) {
    for (var n = 1; n <= 9; n++) {
      var ids = Array.from({ length: n }, function (_, i) { return 'p' + i; });
      var sum = C.splitEven(pot, ids).reduce(function (a, x) { return a + x.amount; }, 0);
      if (sum !== pot) { leak = pot + '/' + n + ' -> ' + sum; break; }
    }
  }
  eq(leak, null, 'Summe der Anteile == Pot (alle Kombinationen bis 4 € / 9 Gewinner)');

  eq(C.checkManualSplit(1000, [600, 400]), { ok: true, sum: 1000, diff: 0 }, 'manuell exakt');
  eq(C.checkManualSplit(1000, [600, 300]), { ok: false, sum: 900, diff: 100 }, 'manuell zu wenig');
  eq(C.checkManualSplit(1000, [600, 500]), { ok: false, sum: 1100, diff: -100 }, 'manuell zu viel');
});

group('Kontostaende aus Ereignissen', function () {
  var s = C.createState();
  var anna = C.makePlayer('Anna'), ben = C.makePlayer('Ben'), cem = C.makePlayer('Cem');
  s.players.push(anna, ben, cem);
  var ev = function (e) { e.id = C.uid('e'); e.ts = Date.now(); s.events.push(e); return e; };

  [anna, ben, cem].forEach(function (p) { ev({ type: 'deposit', playerId: p.id, amount: 2000 }); });
  eq(C.computeBalances(s)[anna.id], 2000, 'Einzahlung 20 €');

  // Runde 1: alle setzen 5 €, Anna gewinnt den ganzen Pot (15 €).
  ev({
    type: 'hand',
    contributions: [anna, ben, cem].map(function (p) { return { playerId: p.id, amount: 500 }; }),
    payouts: [{ playerId: anna.id, amount: 1500 }]
  });
  var b = C.computeBalances(s);
  eq([b[anna.id], b[ben.id], b[cem.id]], [3000, 1500, 1500], 'Gewinn wird gutgeschrieben');
  eq(b[anna.id] + b[ben.id] + b[cem.id], 6000, 'Gesamtsumme unveraendert (Nullsummenspiel)');

  // Runde 2: Split Pot zwischen Ben und Cem (Pot 9 €, ungerade Aufteilung).
  var pot2 = 300 + 300 + 300;
  ev({
    type: 'hand',
    contributions: [anna, ben, cem].map(function (p) { return { playerId: p.id, amount: 300 }; }),
    payouts: C.splitEven(pot2, [ben.id, cem.id]).map(function (x) { return { playerId: x.playerId, amount: x.amount }; })
  });
  b = C.computeBalances(s);
  eq([b[anna.id], b[ben.id], b[cem.id]], [2700, 1650, 1650], 'Split Pot 50/50');
  eq(b[anna.id] + b[ben.id] + b[cem.id], 6000, 'Gesamtsumme weiterhin 60 €');

  // Ein geloeschter Eintrag darf die Salden exakt zuruecksetzen.
  var before = C.computeBalances(s);
  var removed = s.events.pop();
  var after = C.computeBalances(s);
  eq([after[ben.id], after[cem.id]], [1500, 1500], 'Runde loeschen macht sie rueckgaengig');
  s.events.push(removed);
  eq(C.computeBalances(s), before, 'Wiederherstellen ergibt denselben Stand');

  ev({ type: 'transfer', fromId: anna.id, toId: ben.id, amount: 700 });
  b = C.computeBalances(s);
  eq([b[anna.id], b[ben.id]], [2000, 2350], 'direkte Zahlung zwischen Spielern');
});

group('Abrechnung', function () {
  var s = C.createState();
  var anna = C.makePlayer('Anna'), ben = C.makePlayer('Ben');
  s.players.push(anna, ben);
  var ev = function (e) { e.id = C.uid('e'); e.ts = Date.now(); s.events.push(e); return e; };

  ev({ type: 'deposit', playerId: anna.id, amount: 2000 });
  ev({ type: 'deposit', playerId: ben.id, amount: 2000 });
  ev({ type: 'hand', contributions: [{ playerId: anna.id, amount: 500 }, { playerId: ben.id, amount: 500 }],
       payouts: [{ playerId: anna.id, amount: 1000 }] });

  var st = C.sessionStats(s);
  eq([st[anna.id].net, st[ben.id].net], [500, -500], 'Ergebnis = Gewinn/Verlust des Abends');
  eq(st[anna.id].net + st[ben.id].net, 0, 'Summe aller Ergebnisse ist 0');
  eq(st[anna.id].in, 2000, 'Einzahlung erfasst');

  // Auszahlen darf das Ergebnis nicht verfaelschen.
  ev({ type: 'withdraw', playerId: anna.id, amount: 2500 });
  st = C.sessionStats(s);
  eq([st[anna.id].net, st[anna.id].balance], [500, 0], 'nach Auszahlung bleibt das Ergebnis gleich');

  var t = C.settlementTransfers({ a: -1000, b: 600, c: 400 });
  eq(t, [{ fromId: 'a', toId: 'b', amount: 600 }, { fromId: 'a', toId: 'c', amount: 400 }], 'ein Verlierer zahlt an zwei');
  eq(C.settlementTransfers({ a: 0, b: 0 }), [], 'nichts auszugleichen');
  var t2 = C.settlementTransfers({ a: -500, b: -300, c: 800 });
  eq(t2.length, 2, 'zwei Verlierer, ein Gewinner');
  eq(t2.reduce(function (x, y) { return x + y.amount; }, 0), 800, 'ausgeglichene Summe');

  // Abendabschluss: Session-Marke trennt die Abende.
  ev({ type: 'session-end' });
  ev({ type: 'deposit', playerId: ben.id, amount: 1000 });
  st = C.sessionStats(s);
  eq(st[anna.id].net, 0, 'neuer Abend startet bei 0');
  eq(st[ben.id].in, 1000, 'nur die Einzahlung des neuen Abends zaehlt');
});

group('Import defekter Daten', function () {
  eq(C.normalizeState(null).players, [], 'null -> leerer Zustand');
  eq(C.normalizeState({ players: 'kaputt' }).players, [], 'falscher Typ');

  var st = C.normalizeState({
    players: [{ id: 'p1', name: 'Anna' }, { id: 'p1', name: 'Doppelt' }, { name: 'Ohne ID' }],
    events: [
      { type: 'deposit', playerId: 'p1', amount: '2050' },
      { type: 'deposit', playerId: 'p1', amount: 'abc' },
      { type: 'deposit', playerId: 'weg', amount: 500 },
      { type: 'hand', contributions: [{ playerId: 'p1', amount: 100 }], payouts: [{ playerId: 'geist', amount: 100 }] },
      { type: 'quatsch' }
    ],
    settings: { currency: 'CHF', chips: [200, 100] }
  });
  eq(st.players.length, 1, 'Duplikate und ID-lose Spieler entfernt');
  eq(st.events.length, 2, 'Ereignisse mit unbekanntem Spieler oder Betrag entfernt');
  eq(st.events[0].amount, 2050, 'numerischer String uebernommen');
  eq(st.events[1].payouts, [], 'unbekannter Gewinner entfernt');
  eq(st.settings.chips, [100, 200], 'Chips sortiert');
  eq(st.settings.currency, 'CHF', 'Waehrung uebernommen');
});

console.log('\n' + (fail ? '✗ ' + fail + ' Fehler, ' : '✓ alle bestanden – ') + pass + ' Prüfungen\n');
process.exit(fail ? 1 : 0);
