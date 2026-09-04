/**
 * Pokerkasse – Kernlogik (ohne DOM, damit sie in Node getestet werden kann).
 *
 * Grundregeln:
 *  - Alle Geldbetraege sind ganzzahlige Cent. Nie Fliesskomma-Arithmetik auf Geld.
 *  - Der Kontostand eines Spielers wird NIE gespeichert, sondern immer aus der
 *    Ereignisliste berechnet. Dadurch kann jeder Eintrag jederzeit geloescht
 *    werden, ohne dass die Salden auseinanderlaufen.
 */
(function (root) {
  'use strict';

  var CENTS = 100;

  /* ------------------------------------------------------------------ Geld */

  /**
   * Wandelt eine Nutzereingabe ("12", "12,50", "1.5", "-3") in Cent um.
   * Gibt null zurueck, wenn die Eingabe kein gueltiger Betrag ist.
   */
  function parseAmount(input) {
    if (typeof input === 'number') {
      return Number.isFinite(input) ? Math.round(input * CENTS) : null;
    }
    if (typeof input !== 'string') return null;
    var s = input.trim().replace(/\s/g, '').replace(/[€$£]/g, '');
    if (s === '') return null;
    // Deutsches wie englisches Format zulassen: 1.234,56 und 1,234.56
    if (s.indexOf(',') !== -1 && s.indexOf('.') !== -1) {
      s = s.lastIndexOf(',') > s.lastIndexOf('.')
        ? s.replace(/\./g, '').replace(',', '.')
        : s.replace(/,/g, '');
    } else {
      s = s.replace(',', '.');
    }
    if (!/^-?\d*\.?\d*$/.test(s) || !/\d/.test(s)) return null;
    var n = parseFloat(s);
    if (!Number.isFinite(n)) return null;
    return Math.round(n * CENTS);
  }

  /** 1250 -> "12,50" */
  function formatCents(cents) {
    var n = Math.round(cents || 0);
    var sign = n < 0 ? '-' : '';
    n = Math.abs(n);
    var whole = String(Math.floor(n / CENTS));
    var frac = String(n % CENTS).padStart(2, '0');
    whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return sign + whole + ',' + frac;
  }

  /** 1250 -> "12,50 €" */
  function formatMoney(cents, currency) {
    return formatCents(cents) + ' ' + (currency || '€');
  }

  /** 1250 -> "+12,50 €" (Vorzeichen immer sichtbar) */
  function formatSigned(cents, currency) {
    var c = Math.round(cents || 0);
    return (c > 0 ? '+' : '') + formatMoney(c, currency);
  }

  /* ----------------------------------------------------------- Pot-Teilung */

  /**
   * Teilt den Pot gleichmaessig auf die Gewinner auf. Ein nicht teilbarer
   * Rest-Cent geht der Reihe nach an die ersten Gewinner (so wie am Tisch der
   * ungerade Chip an den ersten Spieler links vom Dealer geht).
   *
   * @returns {Array<{playerId: string, amount: number, odd: boolean}>}
   */
  function splitEven(potCents, winnerIds) {
    var n = winnerIds.length;
    if (n === 0) return [];
    var pot = Math.max(0, Math.round(potCents));
    var base = Math.floor(pot / n);
    var rest = pot - base * n;
    return winnerIds.map(function (id, i) {
      return { playerId: id, amount: base + (i < rest ? 1 : 0), odd: i < rest && rest > 0 };
    });
  }

  /**
   * Prueft eine manuelle Aufteilung (z. B. bei Side-Pots).
   * @returns {{ok: boolean, sum: number, diff: number}} diff > 0 = Rest offen.
   */
  function checkManualSplit(potCents, amounts) {
    var sum = amounts.reduce(function (a, b) { return a + (b || 0); }, 0);
    return { ok: sum === Math.round(potCents), sum: sum, diff: Math.round(potCents) - sum };
  }

  /* --------------------------------------------------------------- Zustand */

  var SCHEMA = 1;

  function createState() {
    return {
      schema: SCHEMA,
      players: [],
      events: [],
      // Sitzordnung, Dealer-Position und Blinds des Tisches
      table: { seats: [], dealer: 0, sb: 50, bb: 100, ante: 0 },
      // Laufende Hand – wird mitgespeichert, damit ein Neustart sie nicht verliert
      hand: null,
      settings: { currency: '€', chips: [50, 100, 200, 500, 1000] }
    };
  }

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + '_' +
      Math.random().toString(36).slice(2, 8);
  }

  function makePlayer(name) {
    return { id: uid('p'), name: String(name).trim(), active: true, createdAt: Date.now() };
  }

  /**
   * Wendet ein Ereignis auf eine Saldo-Tabelle an. Herzstueck der App:
   * Einsaetze verringern den Kontostand, Gewinne erhoehen ihn.
   */
  function applyEvent(balances, ev) {
    function add(id, delta) {
      if (id == null) return;
      balances[id] = (balances[id] || 0) + delta;
    }
    switch (ev.type) {
      case 'deposit':                       // Geld eingezahlt / Buy-in
        add(ev.playerId, ev.amount); break;
      case 'withdraw':                      // Geld ausgezahlt / Cash-out
        add(ev.playerId, -ev.amount); break;
      case 'adjust':                         // manuelle Korrektur (Delta)
      case 'settle':                         // Ausgleich beim Abendabschluss
        add(ev.playerId, ev.amount); break;
      case 'transfer':                      // direkte Zahlung zwischen Spielern
        add(ev.fromId, -ev.amount); add(ev.toId, ev.amount); break;
      case 'hand':                          // gespielte Runde
        (ev.contributions || []).forEach(function (c) { add(c.playerId, -c.amount); });
        (ev.payouts || []).forEach(function (p) { add(p.playerId, p.amount); });
        break;
      case 'session-end':
        break;
    }
    return balances;
  }

  /** Kontostaende aller Spieler. `upTo` = Anzahl beruecksichtigter Ereignisse. */
  function computeBalances(state, upTo) {
    var balances = {};
    state.players.forEach(function (p) { balances[p.id] = 0; });
    var events = state.events;
    var end = upTo === undefined ? events.length : upTo;
    for (var i = 0; i < end; i++) applyEvent(balances, events[i]);
    return balances;
  }

  /** Index nach dem letzten Abendabschluss (= Beginn der laufenden Session). */
  function sessionStartIndex(state) {
    for (var i = state.events.length - 1; i >= 0; i--) {
      if (state.events[i].type === 'session-end') return i + 1;
    }
    return 0;
  }

  /**
   * Abrechnung der laufenden Session je Spieler.
   *   in    – in dieser Session eingezahlt
   *   out   – in dieser Session ausgezahlt
   *   start – Guthaben zu Session-Beginn
   *   balance – aktuelles Guthaben
   *   net   – Ergebnis des Abends (+ Gewinn / − Verlust); Summe aller net = 0
   */
  function sessionStats(state) {
    var startIdx = sessionStartIndex(state);
    var start = computeBalances(state, startIdx);
    var now = computeBalances(state);
    var stats = {};
    state.players.forEach(function (p) {
      stats[p.id] = {
        playerId: p.id, in: 0, out: 0,
        start: start[p.id] || 0, balance: now[p.id] || 0,
        hands: 0, won: 0, wagered: 0, net: 0
      };
    });
    for (var i = startIdx; i < state.events.length; i++) {
      var ev = state.events[i];
      if (ev.type === 'deposit' && stats[ev.playerId]) stats[ev.playerId].in += ev.amount;
      if (ev.type === 'withdraw' && stats[ev.playerId]) stats[ev.playerId].out += ev.amount;
      if (ev.type === 'hand') {
        (ev.contributions || []).forEach(function (c) {
          if (stats[c.playerId]) { stats[c.playerId].hands++; stats[c.playerId].wagered += c.amount; }
        });
        (ev.payouts || []).forEach(function (p) {
          if (stats[p.playerId]) stats[p.playerId].won += p.amount;
        });
      }
    }
    Object.keys(stats).forEach(function (id) {
      var s = stats[id];
      s.net = (s.balance - s.start) + s.out - s.in;
    });
    return stats;
  }

  /**
   * Minimale Liste an Barzahlungen, um alle Ergebnisse auszugleichen.
   * Verlierer zahlen an Gewinner; groesste Betraege zuerst (Greedy) – das
   * ergibt hoechstens (Anzahl Spieler − 1) Zahlungen.
   */
  function settlementTransfers(nets) {
    var debtors = [], creditors = [];
    Object.keys(nets).forEach(function (id) {
      var v = Math.round(nets[id]);
      if (v < 0) debtors.push({ id: id, amount: -v });
      else if (v > 0) creditors.push({ id: id, amount: v });
    });
    debtors.sort(function (a, b) { return b.amount - a.amount; });
    creditors.sort(function (a, b) { return b.amount - a.amount; });

    var out = [], i = 0, j = 0;
    while (i < debtors.length && j < creditors.length) {
      var pay = Math.min(debtors[i].amount, creditors[j].amount);
      if (pay > 0) out.push({ fromId: debtors[i].id, toId: creditors[j].id, amount: pay });
      debtors[i].amount -= pay;
      creditors[j].amount -= pay;
      if (debtors[i].amount === 0) i++;
      if (creditors[j].amount === 0) j++;
    }
    return out;
  }

  /* ----------------------------------------------------------- Persistenz */

  /** Prueft und repariert importierte Daten, damit ein defektes Backup die App nicht lahmlegt. */
  function normalizeState(raw) {
    var base = createState();
    if (!raw || typeof raw !== 'object') return base;

    var seen = {};
    base.players = (Array.isArray(raw.players) ? raw.players : [])
      .filter(function (p) { return p && typeof p.id === 'string' && !seen[p.id] && (seen[p.id] = 1); })
      .map(function (p) {
        return {
          id: p.id,
          name: String(p.name || 'Unbenannt').slice(0, 40),
          active: p.active !== false,
          createdAt: Number(p.createdAt) || Date.now()
        };
      });

    var known = {};
    base.players.forEach(function (p) { known[p.id] = true; });
    // Betraege stehen in gespeicherten Daten immer schon in Cent. Was sich nicht
    // als endliche Zahl lesen laesst, wird verworfen statt auf 0 gesetzt – sonst
    // schleppt ein defektes Backup stumme Nullbuchungen ein.
    var int = function (v) { var n = Number(v); return Number.isFinite(n) ? Math.round(n) : null; };
    var picks = function (list) {
      return (Array.isArray(list) ? list : [])
        .filter(function (x) { return x && known[x.playerId] && int(x.amount) !== null; })
        .map(function (x) { return { playerId: x.playerId, amount: int(x.amount) }; });
    };

    base.events = (Array.isArray(raw.events) ? raw.events : []).map(function (ev) {
      if (!ev || typeof ev.type !== 'string') return null;
      var out = { id: ev.id || uid('e'), type: ev.type, ts: Number(ev.ts) || Date.now() };
      if (ev.note) out.note = String(ev.note).slice(0, 120);
      switch (ev.type) {
        case 'deposit': case 'withdraw': case 'adjust': case 'settle':
          if (!known[ev.playerId] || int(ev.amount) === null) return null;
          out.playerId = ev.playerId; out.amount = int(ev.amount); return out;
        case 'transfer':
          if (!known[ev.fromId] || !known[ev.toId] || int(ev.amount) === null) return null;
          out.fromId = ev.fromId; out.toId = ev.toId; out.amount = int(ev.amount); return out;
        case 'hand':
          out.contributions = picks(ev.contributions);
          out.payouts = picks(ev.payouts);
          if (!out.contributions.length && !out.payouts.length) return null;
          return out;
        case 'session-end':
          return out;
        default:
          return null;
      }
    }).filter(Boolean);

    /* ---- Tisch ---- */
    var t = raw.table || {};
    var gesehen = {};
    base.table = {
      seats: (Array.isArray(t.seats) ? t.seats : []).filter(function (id) {
        if (!known[id] || gesehen[id]) return false;
        gesehen[id] = true;
        return true;
      }),
      dealer: Math.max(0, int(t.dealer) || 0),
      sb: Math.max(0, int(t.sb) === null ? 50 : int(t.sb)),
      bb: Math.max(0, int(t.bb) === null ? 100 : int(t.bb)),
      ante: Math.max(0, int(t.ante) || 0)
    };
    if (base.table.dealer >= base.table.seats.length) base.table.dealer = 0;

    /* ---- Laufende Hand ----
       Nur uebernehmen, wenn sie vollstaendig und stimmig ist. Eine halb
       gelesene Hand waere schlimmer als gar keine – dann lieber neu anfangen. */
    var rh = raw.hand;
    if (rh && typeof rh === 'object' && Array.isArray(rh.players) && rh.players.length >= 2) {
      var heil = true;
      var hp = rh.players.map(function (p) {
        if (!p || !known[p.id] || int(p.committed) === null || int(p.stack) === null) { heil = false; return null; }
        return {
          id: p.id,
          seat: int(p.seat) || 0,
          stack: Math.max(0, int(p.stack)),
          bet: Math.max(0, int(p.bet) || 0),
          committed: Math.max(0, int(p.committed)),
          folded: !!p.folded,
          allIn: !!p.allIn,
          acted: !!p.acted
        };
      });
      if (heil) {
        base.hand = {
          street: ['preflop', 'flop', 'turn', 'river', 'showdown'].indexOf(rh.street) !== -1
            ? rh.street : 'preflop',
          dealer: int(rh.dealer) || 0,
          sb: Math.max(0, int(rh.sb) || 0),
          bb: Math.max(0, int(rh.bb) || 0),
          ante: Math.max(0, int(rh.ante) || 0),
          sbSeat: int(rh.sbSeat) || 0,
          bbSeat: int(rh.bbSeat) || 0,
          startedAt: Number(rh.startedAt) || Date.now(),
          players: hp,
          toAct: rh.toAct === undefined ? -1 : int(rh.toAct),
          minRaise: Math.max(1, int(rh.minRaise) || 1),
          lastAction: rh.lastAction || null
        };
        if (base.hand.toAct >= hp.length) base.hand.toAct = -1;
      }
    }

    var s = raw.settings || {};
    base.settings.currency = String(s.currency || '€').slice(0, 4) || '€';
    var chips = (Array.isArray(s.chips) ? s.chips : [])
      .map(function (c) { return Math.round(Number(c) || 0); })
      .filter(function (c) { return c > 0; })
      .sort(function (a, b) { return a - b; })
      .slice(0, 6);
    if (chips.length) base.settings.chips = chips;
    return base;
  }

  root.parseAmount = parseAmount;
  root.formatCents = formatCents;
  root.formatMoney = formatMoney;
  root.formatSigned = formatSigned;
  root.splitEven = splitEven;
  root.checkManualSplit = checkManualSplit;
  root.createState = createState;
  root.normalizeState = normalizeState;
  root.makePlayer = makePlayer;
  root.uid = uid;
  root.applyEvent = applyEvent;
  root.computeBalances = computeBalances;
  root.sessionStartIndex = sessionStartIndex;
  root.sessionStats = sessionStats;
  root.settlementTransfers = settlementTransfers;
  root.SCHEMA = SCHEMA;
}(typeof module !== 'undefined' && module.exports ? module.exports : (this.PokerCore = {})));
