/* Tests des Spielablaufs:  node tests/engine.test.js  */
'use strict';
var E = require('../js/engine.js');
var C = require('../js/core.js');

var pass = 0, fail = 0;
function eq(actual, expected, label) {
  var a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) pass++;
  else { fail++; console.error('  FAIL  ' + label + '\n        erwartet ' + b + '\n        war      ' + a); }
}
function ok(cond, label) { eq(!!cond, true, label); }
function group(n, f) { console.log('\n' + n); f(); }

var EUR = function (e) { return Math.round(e * 100); };
function tisch(namen, stack, opts) {
  var stacks = {};
  namen.forEach(function (n) { stacks[n] = stack; });
  return E.startHand(Object.assign({ seats: namen, dealer: 0, sb: EUR(0.5), bb: EUR(1), stacks: stacks }, opts || {}));
}
function von(hand, id) {
  return hand.players.filter(function (p) { return p.id === id; })[0];
}
function amZug(hand) { return hand.toAct < 0 ? null : hand.players[hand.toAct].id; }

group('Blinds und Reihenfolge', function () {
  var h = tisch(['A', 'B', 'C', 'D'], EUR(50));
  eq(von(h, 'B').bet, EUR(0.5), 'Small Blind links vom Dealer');
  eq(von(h, 'C').bet, EUR(1), 'Big Blind daneben');
  eq(amZug(h), 'D', 'vor dem Flop beginnt der Spieler nach dem Big Blind');

  var hu = tisch(['A', 'B'], EUR(50));
  eq(von(hu, 'A').bet, EUR(0.5), 'heads-up zahlt der Dealer den kleinen Blind');
  eq(von(hu, 'B').bet, EUR(1), 'heads-up Big Blind beim Gegner');
  eq(amZug(hu), 'A', 'heads-up ist der Dealer zuerst dran');

  var drei = tisch(['A', 'B', 'C'], EUR(50));
  eq(amZug(drei), 'A', 'zu dritt beginnt der Dealer');

  var ante = tisch(['A', 'B', 'C'], EUR(50), { ante: EUR(0.1) });
  eq(von(ante, 'A').committed, EUR(0.1), 'Ante von allen gezahlt');
  eq(E.potTotal(ante), EUR(0.3) + EUR(1.5), 'Pot enthält Antes und Blinds');
});

group('Setzrunde vor dem Flop', function () {
  var h = tisch(['A', 'B', 'C', 'D'], EUR(50));
  eq(E.options(h).toCall, EUR(1), 'D muss 1,00 mitgehen');
  ok(!E.options(h).canCheck, 'schieben geht nicht gegen einen Einsatz');

  E.act(h, 'call');
  eq(amZug(h), 'A', 'danach ist der Dealer dran');
  E.act(h, 'call');
  E.act(h, 'call');                                  // B ergänzt den Small Blind
  eq(von(h, 'B').bet, EUR(1), 'Small Blind gleicht auf 1,00 aus');
  ok(!E.isStreetComplete(h), 'Big Blind hat noch die Option');
  eq(amZug(h), 'C', 'die Option liegt beim Big Blind');
  ok(E.options(h).canCheck, 'Big Blind darf schieben');
  E.act(h, 'check');
  ok(E.isStreetComplete(h), 'nach der Option ist die Runde beendet');
  eq(E.potTotal(h), EUR(4), 'Pot 4,00 €');
});

group('Erhöhen eröffnet die Runde neu', function () {
  var h = tisch(['A', 'B', 'C', 'D'], EUR(50));
  E.act(h, 'call');                                  // D
  E.act(h, 'raise', EUR(4));                         // A erhöht auf 4,00
  eq(von(h, 'A').bet, EUR(4), 'Erhöhung auf 4,00');
  eq(E.options(h).toCall, EUR(3.5), 'B muss 3,50 nachlegen');
  ok(!E.isStreetComplete(h), 'nach einer Erhöhung dürfen alle noch mal');

  eq(E.act(h, 'raise', EUR(5)).ok, false, 'Mindesterhöhung wird erzwungen');
  eq(E.act(h, 'raise', EUR(7)).ok, true, 'volle Mindesterhöhung ist erlaubt');
  E.act(h, 'fold');                                  // C
  E.act(h, 'fold');                                  // D
  E.act(h, 'call');                                  // A geht mit
  ok(E.isStreetComplete(h), 'Runde beendet');
  eq(E.livePlayers(h).length, 2, 'zwei Spieler übrig');
});

group('Nächste Karte', function () {
  var h = tisch(['A', 'B', 'C'], EUR(50));
  E.act(h, 'call'); E.act(h, 'call'); E.act(h, 'check');
  E.nextStreet(h);
  eq(h.street, 'flop', 'Flop erreicht');
  eq(von(h, 'A').bet, 0, 'Einsätze der Vorrunde zurückgesetzt');
  eq(von(h, 'A').committed, EUR(1), 'Gesamteinsatz bleibt erhalten');
  eq(amZug(h), 'B', 'nach dem Flop beginnt der Spieler links vom Dealer');
  ok(E.options(h).canCheck, 'ohne Einsatz darf geschoben werden');

  E.act(h, 'check'); E.act(h, 'check'); E.act(h, 'check');
  ok(E.isStreetComplete(h), 'durchgecheckte Runde ist beendet');
});

group('Hand endet durch Aussteigen', function () {
  var h = tisch(['A', 'B', 'C'], EUR(50));
  E.act(h, 'fold'); E.act(h, 'fold');
  ok(E.isHandOver(h), 'nur noch einer übrig');
  eq(E.livePlayers(h)[0].id, 'C', 'der Big Blind gewinnt');
  eq(E.pots(h)[0].amount, EUR(1.5), 'Pot enthält beide Blinds');
  eq(E.pots(h)[0].eligible, ['C'], 'nur der Verbliebene ist berechtigt');
});

group('Split Pot', function () {
  var h = tisch(['A', 'B', 'C'], EUR(50));
  E.act(h, 'call'); E.act(h, 'call'); E.act(h, 'check');
  var p = E.pots(h);
  eq(p.length, 1, 'ein einziger Pot');
  eq(p[0].amount, EUR(3), 'Pot 3,00 €');

  var r = E.settle(h, [['B', 'C']], C.splitEven);
  eq(r.payouts.map(function (x) { return x.amount; }), [EUR(1.5), EUR(1.5)], 'Pot wird halbiert');

  // Ungerader Betrag: der Rest-Cent geht an den zuerst gewählten Gewinner.
  var h2 = tisch(['A', 'B', 'C'], EUR(50), { sb: 5, bb: 10 });
  E.act(h2, 'call'); E.act(h2, 'call'); E.act(h2, 'check');
  eq(E.potTotal(h2), 30, 'Pot 30 Cent');
  var r2 = E.settle(h2, [['A', 'B', 'C']], C.splitEven);
  eq(r2.payouts.map(function (x) { return x.amount; }), [10, 10, 10], 'dreigeteilt ohne Rest');

  var h3 = tisch(['A', 'B'], EUR(50), { sb: 5, bb: 5 });
  E.act(h3, 'call'); E.act(h3, 'raise', 12); E.act(h3, 'call');
  eq(E.potTotal(h3), 24, 'Pot 24 Cent');
  var r3 = E.settle(h3, [['A', 'B']], C.splitEven);
  eq(r3.payouts.map(function (x) { return x.amount; }), [12, 12], 'gerade Teilung');
});

group('Nebenpots bei All-in', function () {
  // A hat nur 5,00 €, B und C je 50,00 €.
  var h = E.startHand({
    seats: ['A', 'B', 'C'], dealer: 0, sb: EUR(0.5), bb: EUR(1),
    stacks: { A: EUR(5), B: EUR(50), C: EUR(50) }
  });
  E.act(h, 'allin');                                 // A (Dealer) all-in mit 5,00
  eq(von(h, 'A').committed, EUR(5), 'A ist mit 5,00 all-in');
  ok(von(h, 'A').allIn, 'A als all-in markiert');
  E.act(h, 'call');                                  // B geht mit
  E.act(h, 'raise', EUR(12));                        // C erhöht
  E.act(h, 'call');                                  // B geht mit

  var p = E.pots(h);
  eq(p.length, 2, 'Haupt- und Nebenpot');
  eq(p[0].amount, EUR(15), 'Hauptpot 3 × 5,00 = 15,00');
  eq(p[0].eligible, ['A', 'B', 'C'], 'alle drei am Hauptpot beteiligt');
  eq(p[1].amount, EUR(14), 'Nebenpot 2 × 7,00 = 14,00');
  eq(p[1].eligible, ['B', 'C'], 'A kann den Nebenpot nicht gewinnen');
  eq(p[0].amount + p[1].amount, E.potTotal(h), 'Pots ergeben zusammen den Gesamteinsatz');

  // A gewinnt den Hauptpot, C den Nebenpot.
  var r = E.settle(h, [['A'], ['C']], C.splitEven);
  var byId = {};
  r.payouts.forEach(function (x) { byId[x.playerId] = x.amount; });
  eq(byId.A, EUR(15), 'A bekommt nur den Hauptpot');
  eq(byId.C, EUR(14), 'C bekommt den Nebenpot');
  eq(byId.B, undefined, 'B geht leer aus');
});

group('Einsatz eines Ausgestiegenen bleibt im Pot', function () {
  var h = E.startHand({
    seats: ['A', 'B', 'C'], dealer: 0, sb: EUR(0.5), bb: EUR(1),
    stacks: { A: EUR(50), B: EUR(50), C: EUR(50) }
  });
  E.act(h, 'raise', EUR(3));                         // A
  E.act(h, 'fold');                                  // B verliert seinen Blind
  E.act(h, 'call');                                  // C
  var p = E.pots(h);
  eq(p.length, 1, 'ein Pot');
  eq(p[0].amount, EUR(6.5), 'Pot enthält den verfallenen Small Blind');
  eq(p[0].eligible, ['A', 'C'], 'der Ausgestiegene ist nicht berechtigt');
});

group('Nicht gewinnbare Einsätze gehen zurück', function () {
  // C ist mit 0,50 all-in. A und B bauen daneben einen Nebenpot auf, den nur
  // sie beide gewinnen könnten – und steigen dann beide aus. Diesen Nebenpot
  // kann niemand mehr gewinnen, also muss das Geld zurück an die Einzahler.
  var h = E.startHand({
    seats: ['A', 'B', 'C'], dealer: 0, sb: EUR(0.25), bb: EUR(0.5),
    stacks: { A: EUR(50), B: EUR(50), C: EUR(0.5) }
  });
  E.act(h, 'raise', EUR(5));            // A erhöht auf 5,00
  E.act(h, 'call');                     // B geht mit
  ok(von(h, 'C').allIn, 'C ist mit dem Big Blind all-in');
  ok(E.isStreetComplete(h), 'Setzrunde abgeschlossen');

  E.nextStreet(h);
  E.act(h, 'raise', EUR(3));            // B setzt auf dem Flop
  E.act(h, 'fold');                     // A steigt aus
  ok(!E.isHandOver(h), 'B und der all-in C sind noch im Rennen');

  E.nextStreet(h);
  E.act(h, 'fold');                     // B gibt auf – der Nebenpot verwaist
  ok(E.isHandOver(h), 'nur noch C übrig');

  var p = E.pots(h);
  eq(p.length, 1, 'nur der Hauptpot bleibt');
  eq(p[0].amount, EUR(1.5), 'Hauptpot: 3 × 0,50');
  eq(p[0].eligible, ['C'], 'nur C kann gewinnen');

  var zurueck = E.refunds(h);
  eq(zurueck, [{ playerId: 'A', amount: EUR(4.5) }, { playerId: 'B', amount: EUR(7.5) }],
    'der verwaiste Nebenpot geht an die Einzahler zurück');

  var r = E.settle(h, [['C']], C.splitEven);
  var summe = r.payouts.reduce(function (s, x) { return s + x.amount; }, 0);
  eq(summe, E.potTotal(h), 'ausgezahlt plus zurückgegeben = alle Einsätze');
  var byId = {};
  r.payouts.forEach(function (x) { byId[x.playerId] = x.amount; });
  eq(byId.C, EUR(1.5), 'C bekommt den Hauptpot');
  eq(byId.A, EUR(4.5), 'A bekommt seinen Nebenpot-Anteil zurück');
});

group('Stack ist die Grenze', function () {
  var h = E.startHand({
    seats: ['A', 'B'], dealer: 0, sb: EUR(0.5), bb: EUR(1),
    stacks: { A: EUR(2), B: EUR(50) }
  });
  var o = E.options(h);
  eq(o.maxRaiseTo, EUR(2), 'A kann höchstens seinen Stack setzen');
  eq(E.act(h, 'raise', EUR(10)).ok, false, 'mehr als der Stack wird abgelehnt');
  E.act(h, 'allin');
  eq(von(h, 'A').stack, 0, 'Stack ist aufgebraucht');
  eq(von(h, 'A').committed, EUR(2), 'genau der Stack ist im Pot');
});

group('Kein Cent geht verloren', function () {
  // Viele zufällige Hände: die Summe der Auszahlungen muss immer exakt
  // der Summe der Einsätze entsprechen.
  var seed = 12345;
  function rnd(n) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; }
  var fehler = null;

  for (var runde = 0; runde < 400 && !fehler; runde++) {
    var anzahl = 2 + rnd(5);
    var namen = [], stacks = {};
    for (var i = 0; i < anzahl; i++) { namen.push('P' + i); stacks['P' + i] = 100 + rnd(4000); }
    var h = E.startHand({ seats: namen, dealer: rnd(anzahl), sb: 25, bb: 50, ante: rnd(2) ? 0 : 5, stacks: stacks });

    var schutz = 0;
    while (!E.isHandOver(h) && h.street !== 'showdown' && schutz++ < 200) {
      if (E.isStreetComplete(h)) { E.nextStreet(h); continue; }
      var o = E.options(h);
      if (!o) { E.nextStreet(h); continue; }
      var w = rnd(10);
      if (w < 2) E.act(h, 'fold');
      else if (w < 4 && o.canCheck) E.act(h, 'check');
      else if (w < 8 && o.canCall) E.act(h, 'call');
      else if (o.canRaise) {
        var ziel = o.minRaiseTo + rnd(Math.max(1, o.maxRaiseTo - o.minRaiseTo + 1));
        if (E.act(h, 'raise', ziel).ok !== true) E.act(h, 'allin');
      } else if (o.canCall) E.act(h, 'call');
      else E.act(h, 'check');
    }

    var potsListe = E.pots(h);
    var summePots = potsListe.reduce(function (s, p) { return s + p.amount; }, 0);
    var summeZurueck = E.refunds(h).reduce(function (s, r) { return s + r.amount; }, 0);
    if (summePots + summeZurueck !== E.potTotal(h)) {
      fehler = 'Runde ' + runde + ': Pots ' + summePots + ' + zurück ' + summeZurueck
        + ' != Einsätze ' + E.potTotal(h);
      break;
    }
    // Jeder Pot geht an einen zufälligen Berechtigten – die Summe muss stimmen.
    var winners = potsListe.map(function (p) {
      return p.eligible.length ? [p.eligible[rnd(p.eligible.length)]] : [];
    });
    var res = E.settle(h, winners, C.splitEven);
    var ausgezahlt = res.payouts.reduce(function (s, x) { return s + x.amount; }, 0);
    if (ausgezahlt !== E.potTotal(h)) {
      fehler = 'Runde ' + runde + ': ausgezahlt ' + ausgezahlt + ' != Einsätze ' + E.potTotal(h);
    }
    // Niemand darf mehr gesetzt haben, als er hatte.
    h.players.forEach(function (p) {
      if (p.stack < 0) fehler = 'Runde ' + runde + ': negativer Stack bei ' + p.id;
    });
  }
  eq(fehler, null, '400 zufällige Hände: Einsätze = Pots = Auszahlungen, kein negativer Stack');
});

console.log('\n' + (fail ? '✗ ' + fail + ' Fehler, ' : '✓ alle bestanden – ') + pass + ' Prüfungen\n');
process.exit(fail ? 1 : 0);
