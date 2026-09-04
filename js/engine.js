/**
 * Pokerkasse – Spielablauf einer Hand (ohne DOM, damit in Node testbar).
 *
 * Die App spielt nicht Poker – die Karten liegen auf dem Tisch. Sie verwaltet
 * nur das Geld: Wer ist dran, wie viel muss er mitgehen, was liegt im Pot und
 * wem steht am Ende was zu.
 *
 * Alle Betraege sind ganzzahlige Cent (wie in core.js).
 */
(function (root) {
  'use strict';

  var STREETS = ['preflop', 'flop', 'turn', 'river'];
  var STREET_NAMES = {
    preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River', showdown: 'Showdown'
  };

  /* ------------------------------------------------------------- Helfer */

  function seatCount(hand) { return hand.players.length; }

  /** Kann dieser Spieler ueberhaupt noch handeln? */
  function canAct(p) { return !p.folded && !p.allIn; }

  /** Naechster handlungsfaehiger Spieler nach Index `from` (exklusiv). */
  function nextActive(hand, from) {
    var n = seatCount(hand);
    for (var i = 1; i <= n; i++) {
      var idx = (from + i) % n;
      if (canAct(hand.players[idx])) return idx;
    }
    return -1;
  }

  /** Naechster nicht ausgestiegener Spieler nach `from` (auch All-in). */
  function nextLive(hand, from) {
    var n = seatCount(hand);
    for (var i = 1; i <= n; i++) {
      var idx = (from + i) % n;
      if (!hand.players[idx].folded) return idx;
    }
    return -1;
  }

  function maxBet(hand) {
    return hand.players.reduce(function (m, p) { return Math.max(m, p.bet); }, 0);
  }

  function livePlayers(hand) {
    return hand.players.filter(function (p) { return !p.folded; });
  }

  /** Zahlt Geld ein; mehr als der eigene Stack geht nicht (dann All-in). */
  function pay(p, amount) {
    var real = Math.max(0, Math.min(amount, p.stack));
    p.stack -= real;
    p.bet += real;
    p.committed += real;
    if (p.stack === 0) p.allIn = true;
    return real;
  }

  /* ------------------------------------------------------- Hand starten */

  /**
   * @param opts {seats: [playerId], dealer: int, sb, bb, ante, stacks: {id: cents}}
   * @returns hand oder null, wenn zu wenige Spieler
   */
  function startHand(opts) {
    var seats = (opts.seats || []).slice();
    if (seats.length < 2) return null;

    var dealer = ((opts.dealer || 0) % seats.length + seats.length) % seats.length;
    var hand = {
      street: 'preflop',
      dealer: dealer,
      sb: Math.max(0, Math.round(opts.sb || 0)),
      bb: Math.max(0, Math.round(opts.bb || 0)),
      ante: Math.max(0, Math.round(opts.ante || 0)),
      startedAt: Date.now(),
      players: seats.map(function (id, i) {
        return {
          id: id, seat: i,
          stack: Math.max(0, Math.round((opts.stacks || {})[id] || 0)),
          bet: 0, committed: 0,
          folded: false, allIn: false, acted: false
        };
      }),
      toAct: -1,
      minRaise: 0,
      lastAction: null
    };

    var n = hand.players.length;
    if (hand.ante > 0) hand.players.forEach(function (p) { pay(p, hand.ante); });

    // Heads-up: der Dealer zahlt den kleinen Blind und ist vor dem Flop zuerst dran.
    var sbSeat = n === 2 ? dealer : (dealer + 1) % n;
    var bbSeat = n === 2 ? (dealer + 1) % n : (dealer + 2) % n;
    if (hand.sb > 0) pay(hand.players[sbSeat], hand.sb);
    if (hand.bb > 0) pay(hand.players[bbSeat], hand.bb);
    hand.sbSeat = sbSeat;
    hand.bbSeat = bbSeat;

    hand.minRaise = hand.bb || hand.sb || 1;
    var first = n === 2 ? dealer : (dealer + 3) % n;
    hand.toAct = canAct(hand.players[first]) ? first : nextActive(hand, first - 1);
    return hand;
  }

  /* --------------------------------------------------- Moegliche Aktionen */

  /** Was der Spieler, der gerade dran ist, tun darf. */
  function options(hand) {
    if (hand.toAct < 0 || hand.street === 'showdown') return null;
    var p = hand.players[hand.toAct];
    if (!p || !canAct(p)) return null;

    var high = maxBet(hand);
    var toCall = Math.min(high - p.bet, p.stack);
    // Mindesterhoehung: bisheriger Hoechsteinsatz plus letzte Erhoehungsgroesse.
    var minRaiseTo = high + hand.minRaise;
    var maxRaiseTo = p.bet + p.stack;

    return {
      player: p,
      toCall: toCall,
      canCheck: high - p.bet <= 0,
      canCall: toCall > 0,
      canRaise: maxRaiseTo > high,
      // Reicht der Stack nicht fuer die volle Mindesterhoehung, bleibt nur All-in.
      minRaiseTo: Math.min(minRaiseTo, maxRaiseTo),
      maxRaiseTo: maxRaiseTo,
      isAllInRaise: maxRaiseTo < minRaiseTo
    };
  }

  /* ---------------------------------------------------------- Aktionen */

  /**
   * Fuehrt eine Aktion aus. `type`: 'fold' | 'check' | 'call' | 'raise' | 'allin'.
   * Bei 'raise' ist `amount` der Gesamteinsatz dieser Setzrunde (nicht die Differenz).
   * @returns {ok: boolean, error?: string}
   */
  function act(hand, type, amount) {
    var opt = options(hand);
    if (!opt) return { ok: false, error: 'Gerade ist niemand am Zug.' };
    var p = opt.player;
    var high = maxBet(hand);

    if (type === 'fold') {
      p.folded = true;
    } else if (type === 'check') {
      if (!opt.canCheck) return { ok: false, error: 'Es steht ein Einsatz – mitgehen oder aussteigen.' };
    } else if (type === 'call') {
      if (!opt.canCall) return { ok: false, error: 'Es gibt nichts mitzugehen.' };
      pay(p, opt.toCall);
    } else if (type === 'raise' || type === 'allin') {
      var target = type === 'allin' ? opt.maxRaiseTo : Math.round(amount);
      if (type === 'raise') {
        if (!(target > high)) return { ok: false, error: 'Die Erhöhung muss über dem aktuellen Einsatz liegen.' };
        if (target < opt.minRaiseTo) {
          return { ok: false, error: 'Mindestens ' + opt.minRaiseTo + ' Cent.' };
        }
        if (target > opt.maxRaiseTo) return { ok: false, error: 'Mehr als der Stack geht nicht.' };
      }
      var erhoehungUm = target - high;
      pay(p, target - p.bet);
      if (target > high) {
        // Eine volle Erhoehung eroeffnet die Setzrunde neu: alle duerfen noch mal.
        if (erhoehungUm >= hand.minRaise) {
          hand.minRaise = erhoehungUm;
          hand.players.forEach(function (o) { if (o !== p && canAct(o)) o.acted = false; });
        }
      }
    } else {
      return { ok: false, error: 'Unbekannte Aktion.' };
    }

    p.acted = true;
    hand.lastAction = { id: p.id, type: type };
    hand.toAct = nextActive(hand, hand.toAct);
    return { ok: true };
  }

  /* -------------------------------------------------- Zustand der Runde */

  /** Nur noch einer übrig – die Hand ist ohne Showdown entschieden. */
  function isHandOver(hand) {
    return livePlayers(hand).length <= 1;
  }

  /** Sind alle Einsätze dieser Setzrunde ausgeglichen? */
  function isStreetComplete(hand) {
    if (isHandOver(hand)) return true;
    var high = maxBet(hand);
    var offen = hand.players.filter(function (p) {
      return canAct(p) && (!p.acted || p.bet !== high);
    });
    return offen.length === 0;
  }

  /** Kann überhaupt noch gesetzt werden, oder sind alle All-in? */
  function noMoreBetting(hand) {
    return hand.players.filter(canAct).length <= 1 && isStreetComplete(hand);
  }

  /** Nächste Karte: Einsätze abschließen, neue Setzrunde eröffnen. */
  function nextStreet(hand) {
    var i = STREETS.indexOf(hand.street);
    if (i === -1 || i === STREETS.length - 1) {
      hand.street = 'showdown';
      hand.toAct = -1;
      return hand;
    }
    hand.street = STREETS[i + 1];
    hand.players.forEach(function (p) { p.bet = 0; p.acted = false; });
    hand.minRaise = hand.bb || 1;
    // Nach dem Flop beginnt der erste Spieler links vom Dealer.
    var start = nextActive(hand, hand.dealer);
    hand.toAct = start;
    if (start === -1) hand.street = 'showdown';
    return hand;
  }

  /** Springt direkt zum Showdown (z. B. wenn alle All-in sind). */
  function toShowdown(hand) {
    hand.street = 'showdown';
    hand.toAct = -1;
    return hand;
  }

  /* ------------------------------------------------------------- Pots */

  /**
   * Zerlegt die Einsätze in Haupt- und Nebenpots. Wer All-in mit weniger geht,
   * kann nur den Teil gewinnen, den er selbst mitbezahlt hat.
   * Einsätze ausgestiegener Spieler bleiben im Pot, sie sind nur nicht mehr
   * anspruchsberechtigt.
   */
  function zerlege(hand) {
    var stufen = [];
    hand.players.forEach(function (p) {
      if (p.committed > 0 && stufen.indexOf(p.committed) === -1) stufen.push(p.committed);
    });
    stufen.sort(function (a, b) { return a - b; });

    var out = [], zurueck = {}, vorher = 0;
    stufen.forEach(function (stufe) {
      var proKopf = stufe - vorher;
      vorher = stufe;
      if (proKopf <= 0) return;
      var zahler = hand.players.filter(function (p) { return p.committed >= stufe; });
      var berechtigt = zahler.filter(function (p) { return !p.folded; })
        .map(function (p) { return p.id; });

      if (!berechtigt.length) {
        // Diese Ebene haben nur Ausgestiegene bezahlt – niemand kann sie
        // gewinnen. Nach Pokerregeln geht das Geld an die Einzahler zurueck.
        zahler.forEach(function (p) { zurueck[p.id] = (zurueck[p.id] || 0) + proKopf; });
        return;
      }
      out.push({ amount: zahler.length * proKopf, eligible: berechtigt });
    });

    // Aufeinanderfolgende Pots mit derselben Berechtigten-Gruppe zusammenfassen.
    var merged = [];
    out.forEach(function (pot) {
      var last = merged[merged.length - 1];
      if (last && last.eligible.join(',') === pot.eligible.join(',')) {
        last.amount += pot.amount;
      } else {
        merged.push({ amount: pot.amount, eligible: pot.eligible.slice() });
      }
    });

    return {
      pots: merged.map(function (pot, i) {
        return {
          amount: pot.amount,
          eligible: pot.eligible,
          label: merged.length === 1 ? 'Pot' : (i === 0 ? 'Hauptpot' : 'Nebenpot ' + i)
        };
      }),
      refunds: Object.keys(zurueck).map(function (id) {
        return { playerId: id, amount: zurueck[id] };
      })
    };
  }

  function pots(hand) { return zerlege(hand).pots; }

  /** Einsätze, die niemand mehr gewinnen kann – sie gehen an den Einzahler zurück. */
  function refunds(hand) { return zerlege(hand).refunds; }

  function potTotal(hand) {
    return hand.players.reduce(function (s, p) { return s + p.committed; }, 0);
  }

  /* ---------------------------------------------------------- Auszahlung */

  /**
   * Verteilt jeden Pot auf seine Gewinner.
   * @param winners [[id, ...], ...] – je Pot die gewählten Gewinner
   * @param splitEven Funktion aus core.js (Rest-Cent-Regel)
   * @returns {payouts: [{playerId, amount}], perPot: [...]}
   */
  function settle(hand, winners, splitEven) {
    var zer = zerlege(hand);
    var liste = zer.pots;
    var summe = {};
    var perPot = [];

    // Nicht gewinnbare Einsätze zuerst zurückbuchen.
    zer.refunds.forEach(function (r) {
      summe[r.playerId] = (summe[r.playerId] || 0) + r.amount;
    });

    liste.forEach(function (pot, i) {
      var gewinner = (winners[i] || []).filter(function (id) {
        return pot.eligible.indexOf(id) !== -1;
      });
      if (!gewinner.length) { perPot.push([]); return; }
      var anteile = splitEven(pot.amount, gewinner);
      anteile.forEach(function (a) {
        summe[a.playerId] = (summe[a.playerId] || 0) + a.amount;
      });
      perPot.push(anteile);
    });

    return {
      payouts: Object.keys(summe).map(function (id) {
        return { playerId: id, amount: summe[id] };
      }),
      perPot: perPot,
      refunds: zer.refunds
    };
  }

  /** Die Einsätze der Hand im Format der Ereignisliste. */
  function contributions(hand) {
    return hand.players.filter(function (p) { return p.committed > 0; })
      .map(function (p) { return { playerId: p.id, amount: p.committed }; });
  }

  root.startHand = startHand;
  root.options = options;
  root.act = act;
  root.isStreetComplete = isStreetComplete;
  root.isHandOver = isHandOver;
  root.noMoreBetting = noMoreBetting;
  root.nextStreet = nextStreet;
  root.toShowdown = toShowdown;
  root.pots = pots;
  root.refunds = refunds;
  root.potTotal = potTotal;
  root.settle = settle;
  root.contributions = contributions;
  root.maxBet = maxBet;
  root.livePlayers = livePlayers;
  root.nextActive = nextActive;
  root.nextLive = nextLive;
  root.STREETS = STREETS;
  root.STREET_NAMES = STREET_NAMES;
}(typeof module !== 'undefined' && module.exports ? module.exports : (this.PokerEngine = {})));
