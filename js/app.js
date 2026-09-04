/**
 * Pokerkasse – Oberfläche.
 * Die Rechenlogik steckt in core.js; hier geht es nur um Darstellung,
 * Eingaben und das Speichern im Browser (localStorage).
 */
(function () {
  'use strict';

  var C = window.PokerCore;
  var S = window.PokerStore;
  var E = window.PokerEngine;
  var MODE_KEY = 'pokerkasse.mode';
  var DRAFT_KEY = 'pokerkasse.draft.v1';
  var SVG_NS = 'http://www.w3.org/2000/svg';

  var state = null;      // gespeicherte Daten (Spieler + Ereignisse)
  var draft = null;      // die Runde, die gerade eingetragen wird
  var view = 'game';
  var storageWarned = false;
  var deferredInstall = null;
  var toastTimer = null;
  var gameMode = 'table';   // 'table' = Spielablauf, 'quick' = Beträge eintippen

  /* =============================================================== Helfer */

  function byId(id) { return document.getElementById(id); }

  function h(tag, props, kids) {
    var e = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2).toLowerCase(), v);
      else e.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (k) {
      if (k === null || k === undefined || k === false) return;
      e.appendChild(typeof k === 'object' ? k : document.createTextNode(String(k)));
    });
    return e;
  }

  function icon(name, cls) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    if (cls) svg.setAttribute('class', cls);
    var use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#' + name);
    svg.appendChild(use);
    return svg;
  }

  function dedupe(list) {
    return list.filter(function (v, i) { return list.indexOf(v) === i; }).sort(function (a, b) { return a - b; });
  }

  function money(cents) { return C.formatMoney(cents, state.settings.currency); }
  function signed(cents) { return C.formatSigned(cents, state.settings.currency); }

  function playerById(id) {
    for (var i = 0; i < state.players.length; i++) {
      if (state.players[i].id === id) return state.players[i];
    }
    return null;
  }
  function nameOf(id) { var p = playerById(id); return p ? p.name : 'Unbekannt'; }

  /** Farbe und Initialen für das Spieler-Kürzel, stabil aus dem Namen abgeleitet. */
  function avatar(player) {
    var hash = 0;
    for (var i = 0; i < player.name.length; i++) hash = (hash * 31 + player.name.charCodeAt(i)) | 0;
    var hue = Math.abs(hash) % 360;
    var initials = player.name.trim().split(/\s+/).slice(0, 2)
      .map(function (w) { return w.charAt(0); }).join('').toUpperCase() || '?';
    return h('div', {
      class: 'avatar',
      style: 'background: hsl(' + hue + ' 62% 62%)'
    }, [initials]);
  }

  /* ========================================================== Persistenz */

  /**
   * Schreibt in beide Speicher. Gewarnt wird nur, wenn wirklich keiner der
   * beiden die Daten annehmen konnte – sonst sind sie sicher.
   */
  function save() {
    S.save(state).then(function (res) {
      if (!res.ok && !storageWarned) {
        storageWarned = true;
        toast('Speichern nicht möglich – bitte die Daten exportieren und sichern.');
      }
    });
  }

  function emptyDraft() {
    return { bets: {}, winners: [], mode: 'even', manual: {}, chip: null, note: '' };
  }

  function loadDraft() {
    var d = emptyDraft();
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { /* egal */ }
    if (raw && typeof raw === 'object') {
      try {
        // Nur Einträge übernehmen, deren Spieler es noch gibt.
        Object.keys(raw.bets || {}).forEach(function (id) {
          var amt = Math.round(Number(raw.bets[id]) || 0);
          if (playerById(id) && amt > 0) d.bets[id] = amt;
        });
        d.winners = (raw.winners || []).filter(playerById);
        d.mode = raw.mode === 'manual' ? 'manual' : 'even';
        Object.keys(raw.manual || {}).forEach(function (id) {
          if (playerById(id)) d.manual[id] = Math.round(Number(raw.manual[id]) || 0);
        });
        d.note = String(raw.note || '').slice(0, 120);
        d.chip = Math.round(Number(raw.chip)) || null;
      } catch (e) { /* unbrauchbarer Entwurf -> leer starten */ }
    }
    var chips = state.settings.chips;
    d.chip = chips.indexOf(d.chip) !== -1 ? d.chip : chips[Math.min(1, chips.length - 1)];
    return d;
  }

  function saveDraft() {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch (e) { /* egal */ }
  }

  function resetDraft() {
    var chip = draft ? draft.chip : null;
    draft = emptyDraft();
    draft.chip = chip || state.settings.chips[Math.min(1, state.settings.chips.length - 1)];
    saveDraft();
  }

  function addEvent(ev) {
    ev.id = ev.id || C.uid('e');
    ev.ts = ev.ts || Date.now();
    state.events.push(ev);
    save();
    return ev;
  }

  function removeEvent(id) {
    state.events = state.events.filter(function (e) { return e.id !== id; });
    save();
  }

  /* =============================================================== Toast */

  function toast(msg, action) {
    var box = byId('toast');
    box.textContent = '';
    box.appendChild(h('div', { class: 'msg', text: msg }));
    if (action) {
      box.appendChild(h('button', {
        type: 'button', text: action.label,
        onclick: function () { hideToast(); action.run(); }
      }));
    }
    box.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, action ? 7000 : 3200);
  }
  function hideToast() { clearTimeout(toastTimer); byId('toast').classList.add('hidden'); }

  /* =============================================================== Modal */

  function closeModal() {
    var root = byId('modal-root');
    root.classList.add('hidden');
    root.textContent = '';
  }

  /**
   * Sheet von unten. `opts.body` sind DOM-Knoten, `opts.actions` die Buttons.
   */
  function modal(opts) {
    var root = byId('modal-root');
    root.textContent = '';
    var sheet = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, [
      h('h2', { text: opts.title }),
      opts.sub ? h('p', { class: 'modal-sub', text: opts.sub }) : null
    ]);
    (opts.body || []).forEach(function (n) { if (n) sheet.appendChild(n); });

    var actions = h('div', { class: 'modal-actions' });
    (opts.actions || [{ label: 'Schließen' }]).forEach(function (a) {
      actions.appendChild(h('button', {
        type: 'button',
        class: 'btn ' + (a.kind === 'primary' ? 'btn-primary' : a.kind === 'danger' ? 'btn-danger' : ''),
        text: a.label,
        onclick: function () { if (!a.run || a.run() !== false) closeModal(); }
      }));
    });
    sheet.appendChild(actions);

    root.appendChild(sheet);
    root.classList.remove('hidden');
    root.onclick = function (e) { if (e.target === root) closeModal(); };
    if (opts.focus !== false) {
      var f = sheet.querySelector('input, textarea');
      if (f) setTimeout(function () { f.focus(); f.select && f.select(); }, 60);
    }
    return sheet;
  }

  function confirmModal(title, sub, confirmLabel, run) {
    modal({
      title: title, sub: sub,
      actions: [
        { label: 'Abbrechen' },
        { label: confirmLabel, kind: 'danger', run: run }
      ]
    });
  }

  /** Betrag abfragen – mit Schnellwahl-Chips für die üblichen Beträge. */
  function askAmount(opts, done) {
    var input = h('input', {
      class: 'input', type: 'text', inputmode: 'decimal',
      placeholder: '0,00', value: opts.value ? C.formatCents(opts.value) : ''
    });
    var quick = h('div', { class: 'chiprow' },
      (opts.quick || [500, 1000, 2000, 5000]).map(function (v) {
        return h('button', {
          type: 'button', class: 'chip', text: C.formatCents(v),
          onclick: function () { input.value = C.formatCents(v); input.focus(); }
        });
      }));

    modal({
      title: opts.title, sub: opts.sub,
      body: [h('label', { class: 'field' }, [h('span', { text: opts.label || 'Betrag' }), input]), quick],
      actions: [
        { label: 'Abbrechen' },
        {
          label: opts.confirm || 'Übernehmen', kind: 'primary',
          run: function () {
            var cents = C.parseAmount(input.value);
            if (cents === null || (!opts.allowNegative && cents <= 0)) {
              toast('Bitte einen gültigen Betrag eingeben.');
              return false;
            }
            done(cents);
          }
        }
      ]
    });
  }

  /* ============================================================ Ansichten */

  function render() {
    var bar = document.getElementById('actionbar');
    if (bar && !(view === 'game' && state.hand && state.hand.street !== 'showdown')) {
      bar.remove();
      byId('view-game').classList.remove('with-actionbar');
    }
    ['game', 'players', 'history', 'cash'].forEach(function (v) {
      byId('view-' + v).classList.toggle('hidden', v !== view);
    });
    document.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('is-active', t.dataset.view === view);
    });
    ({ game: renderGame, players: renderPlayers, history: renderHistory, cash: renderCash })[view]();
  }

  function emptyState(title, text, btnLabel, run) {
    return h('div', { class: 'empty' }, [
      h('strong', { text: title }),
      h('div', { text: text }),
      btnLabel ? h('button', {
        type: 'button', class: 'btn btn-primary', style: 'margin-top:16px',
        text: btnLabel, onclick: run
      }) : null
    ]);
  }

  /* ------------------------------------------------------------ 1. Spiel */

  /** Alle Spieler, die in dieser Runde eine Zeile bekommen. */
  function tablePlayers() {
    return state.players.filter(function (p) {
      return p.active || draft.bets[p.id] > 0;
    });
  }

  function potTotal() {
    return Object.keys(draft.bets).reduce(function (sum, id) {
      return playerById(id) ? sum + (draft.bets[id] || 0) : sum;
    }, 0);
  }

  /** Auszahlung je Gewinner nach aktueller Einstellung. */
  function payouts(pot) {
    if (draft.mode === 'manual') {
      return draft.winners.map(function (id) {
        return { playerId: id, amount: draft.manual[id] || 0, odd: false };
      });
    }
    return C.splitEven(pot, draft.winners);
  }

  function canFinish(pot) {
    if (pot <= 0) return { ok: false, msg: 'Noch keine Einsätze im Pot.' };
    if (!draft.winners.length) return { ok: false, msg: 'Bitte mindestens einen Gewinner auswählen.' };
    if (draft.mode === 'manual') {
      var chk = C.checkManualSplit(pot, draft.winners.map(function (id) { return draft.manual[id] || 0; }));
      if (!chk.ok) {
        return { ok: false, msg: chk.diff > 0
          ? 'Es sind noch ' + money(chk.diff) + ' im Pot übrig.'
          : 'Es sind ' + money(-chk.diff) + ' zu viel verteilt.' };
      }
    }
    return { ok: true };
  }

  /** Weiche: laufende Hand, Tisch-Aufbau oder Schnelleingabe. */
  function renderGame() {
    var root = byId('view-game');
    root.textContent = '';
    // Die Leiste haengt am body, nicht an der Ansicht – sie muss bei jedem
    // Neuaufbau weg und wird nur neu gesetzt, wenn jemand am Zug ist.
    var bar = document.getElementById('actionbar');
    if (bar) bar.remove();
    root.classList.remove('with-actionbar');

    if (!state.players.length) {
      root.appendChild(emptyState(
        'Willkommen bei der Pokerkasse',
        'Lege zuerst deine Mitspieler an. Danach setzt du sie an den Tisch und spielst die Runden hier mit.',
        'Spieler anlegen', function () { view = 'players'; render(); }));
      return;
    }

    if (state.hand) { renderHand(root); return; }

    root.appendChild(h('div', { class: 'segmented', style: 'margin:0 0 14px' }, [
      h('button', {
        type: 'button', class: gameMode === 'table' ? 'is-on' : '', text: 'Tisch',
        onclick: function () { setMode('table'); }
      }),
      h('button', {
        type: 'button', class: gameMode === 'quick' ? 'is-on' : '', text: 'Schnelleingabe',
        onclick: function () { setMode('quick'); }
      })
    ]));

    if (gameMode === 'table') renderTableSetup(root);
    else renderQuick(root);
  }

  function setMode(m) {
    gameMode = m;
    try { localStorage.setItem(MODE_KEY, m); } catch (e) { /* egal */ }
    renderGame();
  }


  /* ================================================= Tisch und Spielablauf */

  var showdownWinners = null;   // Auswahl je Pot, nur waehrend des Showdowns

  function seatedPlayers() {
    return state.table.seats.map(playerById).filter(Boolean);
  }

  /** Guthaben als Startstack der Hand. */
  function handStacks() {
    return C.computeBalances(state);
  }

  function saveTable() { save(); renderGame(); }

  /* ------------------------------------------------------- Tisch aufbauen */

  function renderTableSetup(root) {
    var balances = C.computeBalances(state);
    var seats = seatedPlayers();
    var t = state.table;

    /* ---- Sitzordnung ---- */
    var list = h('div', { class: 'rows' });
    seats.forEach(function (p, i) {
      var rolle = seats.length === 2
        ? (i === t.dealer ? 'D/SB' : 'BB')
        : (i === t.dealer ? 'D' : i === (t.dealer + 1) % seats.length ? 'SB'
          : i === (t.dealer + 2) % seats.length ? 'BB' : String(i + 1));
      var bal = balances[p.id] || 0;

      list.appendChild(h('div', { class: 'seat' }, [
        h('div', {
          class: 'seat-badge' + (i === t.dealer ? ' dealer' : ''), text: rolle,
          title: i === t.dealer ? 'Dealer' : 'Sitz ' + (i + 1)
        }),
        h('div', { class: 'who' }, [
          h('div', { class: 'name', text: p.name }),
          h('div', { class: 'sub' + (bal <= 0 ? ' is-neg' : ''), text: money(bal) })
        ]),
        h('button', {
          type: 'button', class: 'step', 'aria-label': 'nach oben', disabled: i === 0,
          onclick: function () { tauscheSitze(i, i - 1); }
        }, [h('span', { text: '↑' })]),
        h('button', {
          type: 'button', class: 'step', 'aria-label': 'nach unten', disabled: i === seats.length - 1,
          onclick: function () { tauscheSitze(i, i + 1); }
        }, [h('span', { text: '↓' })]),
        h('button', {
          type: 'button', class: 'step', 'aria-label': 'vom Tisch nehmen',
          onclick: function () {
            t.seats.splice(i, 1);
            if (t.dealer >= t.seats.length) t.dealer = 0;
            saveTable();
          }
        }, [icon('i-close')])
      ]));
    });

    function tauscheSitze(a, b) {
      var tmp = t.seats[a]; t.seats[a] = t.seats[b]; t.seats[b] = tmp;
      if (t.dealer === a) t.dealer = b; else if (t.dealer === b) t.dealer = a;
      saveTable();
    }

    /* ---- Wer kann noch dazu ---- */
    var frei = state.players.filter(function (p) { return t.seats.indexOf(p.id) === -1; });
    var addPills = h('div', { class: 'pills' }, frei.map(function (p) {
      return h('button', {
        type: 'button', class: 'pill',
        onclick: function () { t.seats.push(p.id); saveTable(); }
      }, [icon('i-plus'), p.name]);
    }));

    var card = h('div', { class: 'card' }, [
      h('div', { class: 'card-head' }, [
        h('h2', { text: 'Tisch' }),
        h('span', { class: 'sub', text: seats.length + (seats.length === 1 ? ' Spieler' : ' Spieler') })
      ])
    ]);
    if (seats.length) {
      card.appendChild(list);
      card.appendChild(h('button', {
        type: 'button', class: 'btn btn-sm', style: 'margin-top:10px',
        text: 'Dealer weiterrücken',
        onclick: function () { t.dealer = (t.dealer + 1) % seats.length; saveTable(); }
      }));
    } else {
      card.appendChild(h('p', { class: 'hint', style: 'margin-top:0',
        text: 'Tippe unten auf die Namen, um die Spieler in Sitzreihenfolge an den Tisch zu setzen.' }));
    }
    if (frei.length) {
      card.appendChild(h('div', { class: 'section-title', text: 'Dazusetzen' }));
      card.appendChild(addPills);
    }
    root.appendChild(card);

    /* ---- Blinds ---- */
    function betragFeld(label, key, hinweis) {
      var inp = h('input', {
        class: 'input', type: 'text', inputmode: 'decimal',
        value: t[key] ? C.formatCents(t[key]) : '0,00',
        onfocus: function () { inp.select(); },
        onblur: function () {
          var c = C.parseAmount(inp.value);
          t[key] = c === null ? 0 : Math.max(0, c);
          inp.value = C.formatCents(t[key]);
          save();
        }
      });
      return h('label', { class: 'field' }, [
        h('span', { text: label }), inp,
        hinweis ? h('div', { class: 'hint', style: 'margin-top:4px', text: hinweis }) : null
      ]);
    }

    root.appendChild(h('div', { class: 'card' }, [
      h('div', { class: 'card-head' }, [h('h2', { text: 'Blinds' })]),
      h('div', { class: 'field-row' }, [
        betragFeld('Small Blind', 'sb'),
        betragFeld('Big Blind', 'bb')
      ]),
      betragFeld('Ante (optional)', 'ante', 'Zahlt jeder vor der Hand. 0 = keine Ante.')
    ]));

    /* ---- Start ---- */
    var problem = seats.length < 2 ? 'Mindestens zwei Spieler an den Tisch setzen.'
      : seats.filter(function (p) { return (balances[p.id] || 0) <= 0; }).length
        ? 'Alle am Tisch brauchen Guthaben – unter „Spieler“ Geld einzahlen.'
        : null;

    root.appendChild(h('button', {
      type: 'button', class: 'btn btn-primary btn-block btn-lg', disabled: !!problem,
      text: 'Hand starten', onclick: starteHand
    }));
    if (problem) root.appendChild(h('p', { class: 'hint', style: 'text-align:center', text: problem }));
  }

  function starteHand() {
    var balances = handStacks();
    var hand = E.startHand({
      seats: state.table.seats.slice(),
      dealer: state.table.dealer,
      sb: state.table.sb, bb: state.table.bb, ante: state.table.ante,
      stacks: balances
    });
    if (!hand) { toast('Mindestens zwei Spieler nötig.'); return; }
    state.hand = hand;
    showdownWinners = null;
    handStep();
    save();
    renderGame();
  }

  /** Bringt die Hand nach jeder Aktion in den nächsten sinnvollen Zustand. */
  function handStep() {
    var hand = state.hand;
    if (!hand || hand.street === 'showdown') return;
    if (E.isHandOver(hand)) { E.toShowdown(hand); return; }
    if (!E.isStreetComplete(hand)) return;
    // Kann niemand mehr setzen, ist der Rest der Hand nur noch Kartenglück.
    if (hand.street === 'river' || E.noMoreBetting(hand)) E.toShowdown(hand);
  }

  function tuAktion(type, amount) {
    var res = E.act(state.hand, type, amount);
    if (!res.ok) { toast(res.error); return; }
    handStep();
    save();
    renderGame();
  }

  /* ------------------------------------------------------- Laufende Hand */

  function renderHand(root) {
    var hand = state.hand;
    var potListe = E.pots(hand);
    var istShowdown = hand.street === 'showdown';

    /* ---- Der Tisch ---- */
    root.appendChild(pokerTable(hand, istShowdown));

    if (istShowdown) renderShowdown(root, hand, potListe);

    // Bewusst zurückhaltend: darf nicht neben „Hand abschließen“ gleich
    // gewichtig wirken.
    root.appendChild(h('div', { class: 'center-link' }, [h('button', {
      type: 'button', class: 'link danger',
      text: 'Hand abbrechen',
      onclick: function () {
        confirmModal('Hand abbrechen?',
          'Die Einsätze dieser Hand werden verworfen. Guthaben ändern sich nicht – '
          + 'gebucht wird erst beim Abschließen.',
          'Abbrechen', function () {
            state.hand = null; showdownWinners = null;
            save(); renderGame();
            toast('Hand verworfen.');
          });
      }
    })]));

    if (!istShowdown) renderActionBar(hand);
  }

  /**
   * Zeichnet den Tisch: ein Oval mit den Sitzen ringsherum, im Uhrzeigersinn
   * ab unten – so wie die Spieler wirklich sitzen. Positionen werden aus dem
   * Winkel auf einer Ellipse berechnet, damit jede Spielerzahl passt.
   */
  function pokerTable(hand, istShowdown) {
    var n = hand.players.length;
    // Bei voller Besetzung wird es eng – dann kleinere Plaettchen.
    var wrap = h('div', { class: 'ptable' + (n >= 8 ? ' is-full' : '') });
    wrap.appendChild(h('div', { class: 'felt' }));

    // In der Mitte steht der Gesamtpot – die Chips vor den Spielern sind darin
    // enthalten. Fuer eine Kasse zaehlt die Gesamtsumme, nicht die Optik.
    var gesamt = E.potTotal(hand);
    var hoechster = E.maxBet(hand);
    wrap.appendChild(h('div', { class: 'felt-center' }, [
      h('div', { class: 'felt-street', text: istShowdown ? 'Showdown' : E.STREET_NAMES[hand.street] }),
      h('div', { class: 'felt-pot', text: money(gesamt) }),
      h('div', { class: 'felt-note', text: istShowdown
        ? (E.isHandOver(hand) ? 'alle bis auf einen raus' : 'wer gewinnt?')
        : hoechster > 0 ? 'Einsatz ' + money(hoechster) : 'Pot' })
    ]));

    hand.players.forEach(function (hp, i) {
      var winkel = (90 + i * 360 / n) * Math.PI / 180;
      var cos = Math.cos(winkel), sin = Math.sin(winkel);
      var p = playerById(hp.id);
      var dran = i === hand.toAct && !istShowdown && !E.isStreetComplete(hand);

      var tag = hp.folded ? 'raus' : hp.allIn ? 'All-in' : '';
      var seat = h('div', {
        class: 'pseat' + (dran ? ' is-active' : '') + (hp.folded ? ' is-folded' : '')
          + (hp.allIn ? ' is-allin' : ''),
        style: 'left:' + (50 + 40 * cos).toFixed(2) + '%;top:' + (50 + 39 * sin).toFixed(2) + '%'
      }, [
        h('div', { class: 'pseat-name', text: p ? p.name : '?' }),
        h('div', { class: 'pseat-stack', text: C.formatCents(hp.stack) }),
        i === hand.dealer ? h('span', { class: 'pseat-dealer', text: 'D', title: 'Dealer' }) : null,
        tag ? h('span', { class: 'pseat-tag', text: tag }) : null
      ]);
      wrap.appendChild(seat);

      // Der Einsatz liegt zwischen Spieler und Tischmitte – wie echte Chips.
      if (hp.bet > 0) {
        wrap.appendChild(h('div', {
          class: 'pbet',
          style: 'left:' + (50 + 24 * cos).toFixed(2) + '%;top:' + (50 + 22 * sin).toFixed(2) + '%'
        }, [C.formatCents(hp.bet)]));
      }
    });

    passeTischHoehe(wrap);
    return wrap;
  }

  /**
   * Der Tisch soll ohne Scrollen sichtbar sein. Statt fester Werte wird
   * gemessen, wie viel Platz die uebrigen Elemente lassen – das passt dann auf
   * jedem Geraet, vom kleinen iPhone SE bis zum grossen Android.
   */
  function passeTischHoehe(wrap) {
    requestAnimationFrame(function () {
      var main = byId('main');
      var viewEl = byId('view-game');
      if (!main || !wrap.isConnected) return;
      var uebrig = viewEl.scrollHeight - wrap.offsetHeight;   // alles ausser dem Tisch
      var platz = main.clientHeight - uebrig - 4;
      wrap.style.height = Math.max(250, Math.min(470, platz)) + 'px';
    });
  }

  /** Nimmt den letzten Schritt zurück – auch über Setzrunden hinweg. */
  function undoButton(klasse) {
    var moeglich = E.canUndo(state.hand);
    return h('button', {
      type: 'button', class: klasse || 'undo-btn', disabled: !moeglich,
      title: 'Letzten Schritt zurücknehmen',
      onclick: function () {
        if (!E.undo(state.hand)) { toast('Es gibt nichts zurückzunehmen.'); return; }
        showdownWinners = null;
        save(); renderGame();
      }
    }, [icon('i-undo'), h('span', { text: 'Zurück' })]);
  }

  /* ---- Aktionsleiste am unteren Rand ---- */

  function renderActionBar(hand) {
    var alt = document.getElementById('actionbar');
    if (alt) alt.remove();

    var bar = h('div', { class: 'actionbar', id: 'actionbar' });
    document.body.appendChild(bar);
    byId('view-game').classList.add('with-actionbar');

    if (E.isStreetComplete(hand)) {
      var i = E.STREETS.indexOf(hand.street);
      var naechste = E.STREET_NAMES[E.STREETS[i + 1]];
      bar.appendChild(h('div', { class: 'actionbar-head' }, [
        h('span', { class: 'nm', text: 'Setzrunde beendet' }),
        undoButton()
      ]));
      bar.appendChild(h('button', {
        type: 'button', class: 'btn btn-primary btn-block btn-lg',
        text: 'Weiter zum ' + naechste,
        onclick: function () { E.nextStreet(hand); handStep(); save(); renderGame(); }
      }));
      return;
    }

    var opt = E.options(hand);
    if (!opt) return;
    var p = playerById(opt.player.id);
    var name = p ? p.name : 'Spieler';

    bar.appendChild(h('div', { class: 'actionbar-head' }, [
      h('span', { class: 'nm', text: name + ' ist am Zug' }),
      h('span', { class: 'st', text: 'Stack ' + money(opt.player.stack) }),
      undoButton()
    ]));

    var raisePanel = h('div', { class: 'raise-panel hidden' });
    bar.appendChild(raisePanel);

    var buttons = h('div', { class: 'action-row' }, [
      h('button', {
        type: 'button', class: 'act act-fold',
        onclick: function () { tuAktion('fold'); }
      }, [h('span', { text: 'Aussteigen' })]),

      opt.canCheck
        ? h('button', {
            type: 'button', class: 'act act-call',
            onclick: function () { tuAktion('check'); }
          }, [h('span', { text: 'Schieben' })])
        : h('button', {
            type: 'button', class: 'act act-call',
            onclick: function () { tuAktion(opt.toCall >= opt.player.stack ? 'allin' : 'call'); }
          }, [h('span', { text: opt.toCall >= opt.player.stack ? 'All-in' : 'Mitgehen' }),
              h('small', { text: money(opt.toCall) })]),

      opt.canRaise
        ? h('button', {
            type: 'button', class: 'act act-raise',
            onclick: function () { raisePanel.classList.toggle('hidden'); }
          }, [h('span', { text: opt.isAllInRaise ? 'All-in' : opt.canCheck ? 'Setzen' : 'Erhöhen' }),
              h('small', { text: 'ab ' + C.formatCents(opt.minRaiseTo) })])
        : h('button', { type: 'button', class: 'act', disabled: true }, [h('span', { text: 'Erhöhen' })])
    ]);
    bar.appendChild(buttons);

    /* ---- Erhöhen: Betrag wählen ---- */
    if (opt.canRaise) {
      var pot = E.potTotal(hand);
      var input = h('input', {
        class: 'input', type: 'text', inputmode: 'decimal',
        value: C.formatCents(opt.minRaiseTo),
        onfocus: function () { input.select(); }
      });
      var vorschlaege = [
        { label: 'Minimum', wert: opt.minRaiseTo },
        { label: '½ Pot', wert: Math.min(opt.maxRaiseTo, Math.max(opt.minRaiseTo, E.maxBet(hand) + Math.round(pot / 2))) },
        { label: 'Pot', wert: Math.min(opt.maxRaiseTo, Math.max(opt.minRaiseTo, E.maxBet(hand) + pot)) },
        { label: 'All-in', wert: opt.maxRaiseTo }
      ].filter(function (v, idx, arr) {
        // Fallen zwei Vorschläge auf denselben Betrag, gewinnt der spätere –
        // sonst stünde „Minimum“ auf einem Button, der in Wahrheit All-in ist.
        for (var j = arr.length - 1; j > idx; j--) if (arr[j].wert === v.wert) return false;
        return true;
      });

      raisePanel.appendChild(h('div', { class: 'chiprow' }, vorschlaege.map(function (v) {
        return h('button', {
          type: 'button', class: 'chip',
          onclick: function () { input.value = C.formatCents(v.wert); }
        }, [h('span', { text: v.label }), h('small', { text: C.formatCents(v.wert) })]);
      })));
      raisePanel.appendChild(h('div', { class: 'inline-form' }, [
        input,
        h('button', {
          type: 'button', class: 'btn btn-primary', text: 'Setzen',
          onclick: function () {
            var c = C.parseAmount(input.value);
            if (c === null) { toast('Bitte einen gültigen Betrag eingeben.'); return; }
            tuAktion(c >= opt.maxRaiseTo ? 'allin' : 'raise', c);
          }
        })
      ]));
      raisePanel.appendChild(h('p', { class: 'hint', style: 'margin:8px 0 0',
        text: 'Gesamteinsatz dieser Runde, nicht der Betrag zum Nachlegen.' }));
    }
  }

  /* ---- Showdown: Gewinner je Pot ---- */

  function renderShowdown(root, hand, potListe) {
    if (!showdownWinners || showdownWinners.length !== potListe.length) {
      // Wo es nur einen Berechtigten gibt, steht der Gewinner schon fest.
      showdownWinners = potListe.map(function (pot) {
        return pot.eligible.length === 1 ? [pot.eligible[0]] : [];
      });
    }

    potListe.forEach(function (pot, i) {
      var card = h('div', { class: 'card' }, [
        h('div', { class: 'card-head' }, [
          h('h2', { text: pot.label }),
          h('span', { class: 'sub', text: money(pot.amount) })
        ])
      ]);

      card.appendChild(h('div', { class: 'pills' }, pot.eligible.map(function (id) {
        var on = showdownWinners[i].indexOf(id) !== -1;
        return h('button', {
          type: 'button', class: 'pill' + (on ? ' is-on' : ''),
          onclick: function () {
            var k = showdownWinners[i].indexOf(id);
            if (k === -1) showdownWinners[i].push(id); else showdownWinners[i].splice(k, 1);
            renderGame();
          }
        }, [icon('i-check'), nameOf(id)]);
      })));

      if (showdownWinners[i].length) {
        card.appendChild(h('div', { class: 'payout-preview' },
          C.splitEven(pot.amount, showdownWinners[i]).map(function (x) {
            return h('div', { class: 'payout-line' }, [
              h('span', { class: 'nm', text: nameOf(x.playerId) }),
              x.odd ? h('span', { class: 'tag', text: '+1 Cent Rest' }) : null,
              h('span', { class: 'amt', text: '+' + money(x.amount) })
            ]);
          })));
      } else {
        card.appendChild(h('p', { class: 'hint',
          text: pot.eligible.length > 1 ? 'Mehrere auswählen für einen geteilten Pot.' : '' }));
      }
      root.appendChild(card);
    });

    var zurueck = E.refunds(hand);
    if (zurueck.length) {
      root.appendChild(h('div', { class: 'card' }, [
        h('div', { class: 'card-head' }, [h('h2', { text: 'Zurück an die Einzahler' })]),
        h('div', { class: 'payout-preview', style: 'border:0;padding-top:0' },
          zurueck.map(function (r) {
            return h('div', { class: 'payout-line' }, [
              h('span', { class: 'nm', text: nameOf(r.playerId) }),
              h('span', { class: 'amt', text: '+' + money(r.amount) })
            ]);
          })),
        h('p', { class: 'hint', text: 'Diesen Teil des Pots konnte niemand mehr gewinnen – '
          + 'er geht an die Spieler zurück, die ihn eingezahlt haben.' })
      ]));
    }

    var offen = showdownWinners.filter(function (w) { return !w.length; }).length;
    root.appendChild(h('button', {
      type: 'button', class: 'btn btn-primary btn-block btn-lg', disabled: offen > 0,
      text: offen > 0 ? 'Gewinner auswählen' : 'Hand abschließen',
      onclick: bucheHand
    }));
    if (E.canUndo(state.hand)) {
      root.appendChild(h('div', { class: 'center-link', style: 'margin-top:10px' }, [
        undoButton('btn btn-sm')
      ]));
    }
  }

  function bucheHand() {
    var hand = state.hand;
    var res = E.settle(hand, showdownWinners, C.splitEven);
    var ev = {
      type: 'hand',
      contributions: E.contributions(hand),
      payouts: res.payouts.filter(function (x) { return x.amount > 0; })
    };
    var gesamt = E.potTotal(hand);
    var gewinner = [];
    showdownWinners.forEach(function (w) {
      w.forEach(function (id) { if (gewinner.indexOf(id) === -1) gewinner.push(id); });
    });

    addEvent(ev);
    state.hand = null;
    showdownWinners = null;
    if (state.table.seats.length) {
      state.table.dealer = (state.table.dealer + 1) % state.table.seats.length;
    }
    save();
    renderGame();

    toast(money(gesamt) + ' an ' + gewinner.map(nameOf).join(' & '), {
      label: 'Rückgängig',
      run: function () {
        removeEvent(ev.id);
        if (state.table.seats.length) {
          state.table.dealer = (state.table.dealer - 1 + state.table.seats.length) % state.table.seats.length;
        }
        save(); renderGame();
        toast('Hand zurückgenommen. Die Einsätze musst du neu eintragen.');
      }
    });
  }

  /* ---- Schnelleingabe: Beträge direkt eintippen, ohne Spielablauf ---- */
  function renderQuick(root) {
    var players = tablePlayers();

    /* ---- Pot ---- */
    var potAmount = h('div', { class: 'pot-amount' });
    var potSub = h('div', { class: 'pot-sub' });
    root.appendChild(h('div', { class: 'pot-dock' }, [
      h('div', { class: 'pot' }, [
        h('div', { class: 'pot-label', text: 'Pot' }), potAmount, potSub
      ])
    ]));

    if (!players.length) {
      root.appendChild(h('div', { class: 'card' }, [emptyState(
        'Niemand am Tisch',
        'Alle Spieler sitzen gerade aus. Schalte unter „Spieler“ mindestens einen wieder ein.',
        'Zu den Spielern', function () { view = 'players'; render(); })]));
      potAmount.textContent = money(0);
      potAmount.classList.add('is-zero');
      return;
    }

    /* ---- Einsätze ---- */
    var chipRow = h('div', { class: 'chiprow' });
    state.settings.chips.forEach(function (value) {
      chipRow.appendChild(h('button', {
        type: 'button',
        class: 'chip' + (draft.chip === value ? ' is-active' : ''),
        text: C.formatCents(value),
        onclick: function () {
          draft.chip = value; saveDraft();
          chipRow.querySelectorAll('.chip').forEach(function (c, i) {
            c.classList.toggle('is-active', state.settings.chips[i] === value);
          });
          allBtn.textContent = 'Alle +' + money(value);
        }
      }));
    });

    var rows = h('div', { class: 'rows' });
    var inputs = {};
    var balances = C.computeBalances(state);
    players.forEach(function (p) {
      var bal = balances[p.id] || 0;

      var input = h('input', {
        class: 'bet-input', type: 'text', inputmode: 'decimal', placeholder: '0,00',
        'aria-label': 'Einsatz von ' + p.name,
        value: draft.bets[p.id] ? C.formatCents(draft.bets[p.id]) : '',
        onfocus: function () { input.select(); },
        oninput: function () {
          var cents = C.parseAmount(input.value);
          setBet(p.id, cents === null ? 0 : Math.max(0, cents), false);
        },
        onblur: function () {
          input.value = draft.bets[p.id] ? C.formatCents(draft.bets[p.id]) : '';
          input.classList.toggle('has-value', !!draft.bets[p.id]);
        }
      });
      input.classList.toggle('has-value', !!draft.bets[p.id]);
      inputs[p.id] = input;

      var row = h('div', { class: 'row' + (draft.bets[p.id] ? ' is-in' : '') }, [
        avatar(p),
        h('div', { class: 'who' }, [
          h('div', { class: 'name', text: p.name + (p.active ? '' : ' (sitzt aus)') }),
          h('div', { class: 'sub' + (bal < 0 ? ' is-neg' : ''), text: money(bal) })
        ]),
        h('button', {
          type: 'button', class: 'step', 'aria-label': 'Einsatz verringern',
          onclick: function () { setBet(p.id, Math.max(0, (draft.bets[p.id] || 0) - draft.chip), true); }
        }, [icon('i-minus')]),
        input,
        h('button', {
          type: 'button', class: 'step', 'aria-label': 'Einsatz erhöhen',
          onclick: function () { setBet(p.id, (draft.bets[p.id] || 0) + draft.chip, true); }
        }, [icon('i-plus')])
      ]);
      rows.appendChild(row);
    });

    var allBtn = h('button', {
      type: 'button', class: 'btn btn-sm', text: 'Alle +' + money(draft.chip),
      onclick: function () {
        players.forEach(function (p) { setBet(p.id, (draft.bets[p.id] || 0) + draft.chip, true); });
      }
    });

    root.appendChild(h('div', { class: 'card' }, [
      h('div', { class: 'card-head' }, [
        h('h2', { text: 'Einsätze' }),
        h('button', {
          type: 'button', class: 'link', text: 'Leeren',
          onclick: function () {
            draft.bets = {}; draft.winners = []; draft.manual = {}; saveDraft(); renderGame();
          }
        })
      ]),
      chipRow, rows,
      h('div', { style: 'margin-top:12px' }, [allBtn])
    ]));

    /* ---- Gewinner ---- */
    var winnerCard = h('div', { class: 'card' });
    root.appendChild(winnerCard);

    /* ---- Abschließen ---- */
    var finishBtn = h('button', {
      type: 'button', class: 'btn btn-primary btn-block btn-lg', text: 'Runde abschließen',
      onclick: finishHand
    });
    root.appendChild(finishBtn);

    /* -- Aktualisierung der abgeleiteten Anzeigen (ohne Neuaufbau der Inputs) -- */
    function setBet(id, cents, writeInput) {
      if (cents > 0) draft.bets[id] = cents; else delete draft.bets[id];
      if (writeInput && inputs[id]) inputs[id].value = cents ? C.formatCents(cents) : '';
      if (inputs[id]) {
        inputs[id].classList.toggle('has-value', !!cents);
        inputs[id].closest('.row').classList.toggle('is-in', !!cents);
      }
      saveDraft();
      update();
    }

    function update() {
      var pot = potTotal();
      var inPot = Object.keys(draft.bets).filter(function (id) { return draft.bets[id] > 0; }).length;
      potAmount.textContent = money(pot);
      potAmount.classList.toggle('is-zero', pot === 0);
      potSub.textContent = pot === 0
        ? 'Trage die Einsätze der Runde ein'
        : inPot + (inPot === 1 ? ' Spieler' : ' Spieler') + ' im Pot · Chip ' + money(draft.chip);
      renderWinners(pot);
      var chk = canFinish(pot);
      finishBtn.disabled = !chk.ok;
      finishBtn.textContent = chk.ok ? 'Runde abschließen · ' + money(pot) : 'Runde abschließen';
    }

    function renderWinners(pot) {
      winnerCard.textContent = '';
      winnerCard.classList.toggle('hidden', pot <= 0);
      if (pot <= 0) return;

      winnerCard.appendChild(h('div', { class: 'card-head' }, [
        h('h2', { text: 'Wer gewinnt?' }),
        h('span', { class: 'sub', text: draft.winners.length > 1 ? 'Split Pot' : '' })
      ]));

      var pills = h('div', { class: 'pills' }, players.map(function (p) {
        var on = draft.winners.indexOf(p.id) !== -1;
        return h('button', {
          type: 'button', class: 'pill' + (on ? ' is-on' : ''), 'aria-pressed': on ? 'true' : 'false',
          onclick: function () {
            var i = draft.winners.indexOf(p.id);
            if (i === -1) draft.winners.push(p.id); else draft.winners.splice(i, 1);
            saveDraft(); update();
          }
        }, [icon('i-check'), p.name]);
      }));
      winnerCard.appendChild(pills);
      if (!draft.winners.length) {
        winnerCard.appendChild(h('p', { class: 'hint', text: 'Mehrere auswählen für einen geteilten Pot.' }));
        return;
      }

      /* Aufteilung nur anbieten, wenn es mehr als einen Gewinner gibt. */
      if (draft.winners.length > 1) {
        winnerCard.appendChild(h('div', { class: 'segmented' }, [
          h('button', {
            type: 'button', class: draft.mode === 'even' ? 'is-on' : '', text: 'Gleichmäßig',
            onclick: function () { draft.mode = 'even'; saveDraft(); update(); }
          }),
          h('button', {
            type: 'button', class: draft.mode === 'manual' ? 'is-on' : '', text: 'Manuell',
            onclick: function () {
              draft.mode = 'manual';
              // Mit der gleichmäßigen Aufteilung vorbelegen, damit nur noch
              // korrigiert werden muss (typisch bei Side-Pots).
              C.splitEven(pot, draft.winners).forEach(function (x) {
                if (draft.manual[x.playerId] === undefined) draft.manual[x.playerId] = x.amount;
              });
              saveDraft(); update();
            }
          })
        ]));
      } else if (draft.mode === 'manual') {
        draft.mode = 'even';
      }

      if (draft.mode === 'manual' && draft.winners.length > 1) {
        var rest = h('div', { class: 'rest-note' });
        var manualRows = h('div', { class: 'rows', style: 'margin-top:12px' },
          draft.winners.map(function (id) {
            var p = playerById(id);
            var inp = h('input', {
              class: 'bet-input', type: 'text', inputmode: 'decimal', placeholder: '0,00',
              'aria-label': 'Anteil von ' + p.name,
              value: draft.manual[id] ? C.formatCents(draft.manual[id]) : '',
              onfocus: function () { inp.select(); },
              oninput: function () {
                var c = C.parseAmount(inp.value);
                draft.manual[id] = c === null ? 0 : Math.max(0, c);
                saveDraft(); updateRest();
              }
            });
            return h('div', { class: 'row' }, [avatar(p), h('div', { class: 'who' }, [
              h('div', { class: 'name', text: p.name })]), inp]);
          }));
        winnerCard.appendChild(manualRows);
        winnerCard.appendChild(rest);

        var updateRest = function () {
          var chk = C.checkManualSplit(pot, draft.winners.map(function (i) { return draft.manual[i] || 0; }));
          rest.className = 'rest-note ' + (chk.ok ? 'ok' : 'bad');
          rest.textContent = chk.ok ? '✓ Pot vollständig verteilt'
            : chk.diff > 0 ? 'Noch offen: ' + money(chk.diff)
              : 'Zu viel verteilt: ' + money(-chk.diff);
          finishBtn.disabled = !canFinish(pot).ok;
        };
        updateRest();
      } else {
        winnerCard.appendChild(h('div', { class: 'payout-preview' },
          payouts(pot).map(function (x) {
            return h('div', { class: 'payout-line' }, [
              h('span', { class: 'nm', text: nameOf(x.playerId) }),
              x.odd ? h('span', { class: 'tag', text: '+1 Cent Rest' }) : null,
              h('span', { class: 'amt', text: '+' + money(x.amount) })
            ]);
          })));
      }
    }

    update();
  }

  function finishHand() {
    var pot = potTotal();
    var chk = canFinish(pot);
    if (!chk.ok) { toast(chk.msg); return; }

    var contributions = Object.keys(draft.bets)
      .filter(function (id) { return draft.bets[id] > 0 && playerById(id); })
      .map(function (id) { return { playerId: id, amount: draft.bets[id] }; });

    var ev = { type: 'hand', contributions: contributions,
      payouts: payouts(pot).map(function (x) { return { playerId: x.playerId, amount: x.amount }; }) };
    if (draft.note) ev.note = draft.note;

    var snapshot = JSON.parse(JSON.stringify(draft));
    addEvent(ev);
    resetDraft();
    renderGame();

    var winners = ev.payouts.map(function (p) { return nameOf(p.playerId); }).join(' & ');
    toast(money(pot) + ' an ' + winners, {
      label: 'Rückgängig',
      run: function () {
        removeEvent(ev.id);
        draft = snapshot;
        saveDraft();
        renderGame();
        toast('Runde zurückgenommen.');
      }
    });
  }

  /* ---------------------------------------------------------- 2. Spieler */

  function renderPlayers() {
    var root = byId('view-players');
    root.textContent = '';
    var balances = C.computeBalances(state);
    var stats = C.sessionStats(state);

    var nameInput = h('input', {
      class: 'input', type: 'text', placeholder: 'Name', maxlength: '40',
      autocomplete: 'off', autocapitalize: 'words',
      onkeydown: function (e) { if (e.key === 'Enter') addPlayer(); }
    });
    function addPlayer() {
      var name = nameInput.value.trim();
      if (!name) { nameInput.focus(); return; }
      var dup = state.players.some(function (p) { return p.name.toLowerCase() === name.toLowerCase(); });
      if (dup) { toast('„' + name + '“ gibt es schon.'); return; }
      state.players.push(C.makePlayer(name));
      save();
      nameInput.value = '';
      renderPlayers();
    }

    root.appendChild(h('div', { class: 'card' }, [
      h('div', { class: 'card-head' }, [h('h2', { text: 'Spieler hinzufügen' })]),
      h('div', { class: 'inline-form' }, [
        nameInput,
        h('button', { type: 'button', class: 'btn btn-primary', text: 'Hinzufügen', onclick: addPlayer })
      ])
    ]));

    if (!state.players.length) {
      root.appendChild(h('div', { class: 'card' }, [emptyState(
        'Noch keine Spieler', 'Trage oben die Namen aller Mitspieler ein.')]));
      return;
    }

    var list = h('div', { class: 'rows' });
    state.players.slice().sort(function (a, b) {
      return (b.active - a.active) || a.name.localeCompare(b.name, 'de');
    }).forEach(function (p) {
      var bal = balances[p.id] || 0;
      var net = stats[p.id] ? stats[p.id].net : 0;
      var sub = money(bal) + (net !== 0 ? ' · heute ' + signed(net) : '');

      var sw = h('button', {
        type: 'button', class: 'switch' + (p.active ? ' is-on' : ''),
        role: 'switch', 'aria-checked': p.active ? 'true' : 'false',
        'aria-label': p.name + ' spielt mit',
        onclick: function (e) {
          e.stopPropagation();
          p.active = !p.active;
          save();
          renderPlayers();
        }
      });

      list.appendChild(h('div', {
        class: 'row', style: p.active ? '' : 'opacity:.55',
        onclick: function () { playerSheet(p); }
      }, [
        avatar(p),
        h('div', { class: 'who' }, [
          h('div', { class: 'name', text: p.name }),
          h('div', { class: 'sub' + (bal < 0 ? ' is-neg' : ''), text: sub })
        ]),
        sw,
        h('button', { type: 'button', class: 'step', 'aria-label': 'Bearbeiten' }, [icon('i-pencil')])
      ]));
    });

    root.appendChild(h('div', { class: 'card' }, [
      h('div', { class: 'card-head' }, [
        h('h2', { text: 'Am Tisch' }),
        h('span', { class: 'sub', text: state.players.filter(function (p) { return p.active; }).length + ' dabei' })
      ]),
      list,
      h('p', { class: 'hint', text: 'Schalter aus = sitzt aus und erscheint nicht bei den Einsätzen. Tippe auf einen Namen für Ein- und Auszahlungen.' })
    ]));
  }

  /** Aktionsmenü für einen einzelnen Spieler. */
  function playerSheet(p) {
    var bal = C.computeBalances(state)[p.id] || 0;
    var st = C.sessionStats(state)[p.id];

    function action(label, kind, run) {
      return h('button', { type: 'button', class: 'btn btn-block ' + (kind || ''), text: label,
        style: 'margin-bottom:8px', onclick: run });
    }

    modal({
      title: p.name,
      sub: 'Guthaben ' + money(bal) + ' · heute ' + signed(st ? st.net : 0),
      focus: false,
      body: [
        action('Geld einzahlen', 'btn-primary', function () {
          closeModal();
          askAmount({
            title: 'Einzahlung', sub: p.name + ' legt Geld in die Kasse.',
            quick: dedupe(state.settings.chips.slice(-2).concat([2000, 5000]))
          }, function (cents) {
            addEvent({ type: 'deposit', playerId: p.id, amount: cents });
            render();
            toast(p.name + ' hat ' + money(cents) + ' eingezahlt.');
          });
        }),
        action('Geld auszahlen', null, function () {
          closeModal();
          askAmount({
            title: 'Auszahlung', sub: p.name + ' nimmt Geld aus der Kasse.',
            value: bal > 0 ? bal : 0, quick: [1000, 2000, 5000]
          }, function (cents) {
            addEvent({ type: 'withdraw', playerId: p.id, amount: cents });
            render();
            toast(p.name + ' hat ' + money(cents) + ' erhalten.');
          });
        }),
        action('Zahlung an Mitspieler', null, function () { closeModal(); transferSheet(p); }),
        action('Guthaben korrigieren', null, function () {
          closeModal();
          askAmount({
            title: 'Korrektur', label: 'Betrag (negativ = abziehen)',
            sub: 'Rechnet den Betrag direkt auf das Guthaben von ' + p.name + '.',
            allowNegative: true, quick: [100, 500, -100, -500]
          }, function (cents) {
            addEvent({ type: 'adjust', playerId: p.id, amount: cents });
            render();
            toast('Guthaben von ' + p.name + ' um ' + signed(cents) + ' geändert.');
          });
        }),
        action('Umbenennen', null, function () {
          closeModal();
          var inp = h('input', { class: 'input', type: 'text', value: p.name, maxlength: '40' });
          modal({
            title: 'Spieler umbenennen',
            body: [h('label', { class: 'field' }, [h('span', { text: 'Name' }), inp])],
            actions: [{ label: 'Abbrechen' }, {
              label: 'Speichern', kind: 'primary', run: function () {
                var n = inp.value.trim();
                if (!n) return false;
                p.name = n; save(); render();
              }
            }]
          });
        }),
        action('Spieler löschen', 'btn-danger', function () {
          closeModal();
          removePlayer(p);
        })
      ],
      actions: [{ label: 'Schließen' }]
    });
  }

  function transferSheet(from) {
    var others = state.players.filter(function (p) { return p.id !== from.id; });
    if (!others.length) { toast('Es gibt keinen zweiten Spieler.'); return; }

    var targetId = others[0].id;
    var pills = h('div', { class: 'pills', style: 'margin-bottom:14px' }, others.map(function (p) {
      return h('button', {
        type: 'button', class: 'pill' + (p.id === targetId ? ' is-on' : ''),
        onclick: function () {
          targetId = p.id;
          pills.querySelectorAll('.pill').forEach(function (el, i) {
            el.classList.toggle('is-on', others[i].id === targetId);
          });
        }
      }, [icon('i-check'), p.name]);
    }));
    var input = h('input', { class: 'input', type: 'text', inputmode: 'decimal', placeholder: '0,00' });

    modal({
      title: 'Zahlung von ' + from.name,
      sub: 'Bucht den Betrag direkt von einem Guthaben auf ein anderes.',
      body: [
        h('div', { style: 'font-size:12.5px;color:var(--muted);font-weight:600;margin-bottom:5px', text: 'An' }),
        pills,
        h('label', { class: 'field' }, [h('span', { text: 'Betrag' }), input])
      ],
      actions: [{ label: 'Abbrechen' }, {
        label: 'Buchen', kind: 'primary', run: function () {
          var cents = C.parseAmount(input.value);
          if (cents === null || cents <= 0) { toast('Bitte einen gültigen Betrag eingeben.'); return false; }
          addEvent({ type: 'transfer', fromId: from.id, toId: targetId, amount: cents });
          render();
          toast(from.name + ' → ' + nameOf(targetId) + ': ' + money(cents));
        }
      }]
    });
  }

  function removePlayer(p) {
    var used = state.events.some(function (e) {
      return e.playerId === p.id || e.fromId === p.id || e.toId === p.id ||
        (e.contributions || []).some(function (c) { return c.playerId === p.id; }) ||
        (e.payouts || []).some(function (x) { return x.playerId === p.id; });
    });
    var sub = used
      ? 'Alle Einträge von ' + p.name + ' werden mitgelöscht. Guthaben und Verlauf der anderen bleiben erhalten.'
      : 'Der Spieler wird entfernt.';
    confirmModal(p.name + ' löschen?', sub, 'Löschen', function () {
      state.events = state.events.filter(function (e) {
        if (e.playerId === p.id || e.fromId === p.id || e.toId === p.id) return false;
        if (e.type === 'hand') {
          e.contributions = e.contributions.filter(function (c) { return c.playerId !== p.id; });
          e.payouts = e.payouts.filter(function (x) { return x.playerId !== p.id; });
          return e.contributions.length || e.payouts.length;
        }
        return true;
      });
      state.players = state.players.filter(function (x) { return x.id !== p.id; });
      delete draft.bets[p.id];
      draft.winners = draft.winners.filter(function (id) { return id !== p.id; });
      save(); saveDraft(); render();
      toast(p.name + ' wurde gelöscht.');
    });
  }

  /* ---------------------------------------------------------- 3. Verlauf */

  var historyLimit = 60;

  function dayLabel(ts) {
    var d = new Date(ts), now = new Date();
    var same = function (a, b) { return a.toDateString() === b.toDateString(); };
    var yest = new Date(now.getTime() - 864e5);
    if (same(d, now)) return 'Heute';
    if (same(d, yest)) return 'Gestern';
    return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  function timeLabel(ts) {
    return new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  }

  function describe(ev) {
    switch (ev.type) {
      case 'hand': {
        var pot = ev.contributions.reduce(function (s, c) { return s + c.amount; }, 0);
        var winners = ev.payouts.map(function (x) { return nameOf(x.playerId); });
        var players = ev.contributions.map(function (c) { return nameOf(c.playerId); });
        return {
          icon: 'i-spade', cls: 'win',
          title: (winners.length > 1 ? 'Split Pot' : 'Pot') + ' · ' + money(pot),
          sub: players.join(', ') + ' → ',
          winners: winners.join(' & '),
          amount: money(pot), amountCls: ''
        };
      }
      case 'deposit':
        return { icon: 'i-money', cls: 'cash', title: nameOf(ev.playerId) + ' zahlt ein',
          sub: 'Einzahlung in die Kasse', amount: '+' + money(ev.amount), amountCls: 'pos' };
      case 'withdraw':
        return { icon: 'i-money', cls: 'cash', title: nameOf(ev.playerId) + ' lässt auszahlen',
          sub: 'Auszahlung aus der Kasse', amount: '−' + money(ev.amount), amountCls: 'neg' };
      case 'transfer':
        return { icon: 'i-arrow', cls: '', title: nameOf(ev.fromId) + ' → ' + nameOf(ev.toId),
          sub: 'Zahlung zwischen Spielern', amount: money(ev.amount), amountCls: '' };
      case 'adjust':
        return { icon: 'i-pencil', cls: '', title: 'Korrektur · ' + nameOf(ev.playerId),
          sub: 'Guthaben von Hand geändert', amount: signed(ev.amount),
          amountCls: ev.amount < 0 ? 'neg' : 'pos' };
      case 'settle':
        return { icon: 'i-calc', cls: '', title: 'Abrechnung · ' + nameOf(ev.playerId),
          sub: 'Guthaben beim Abschluss ausgeglichen', amount: signed(ev.amount), amountCls: 'zero' };
      case 'session-end':
        return { icon: 'i-check', cls: '', title: 'Abend abgeschlossen',
          sub: 'Ab hier zählt eine neue Abrechnung', amount: '', amountCls: '' };
      default:
        return { icon: 'i-clock', cls: '', title: ev.type, sub: '', amount: '', amountCls: '' };
    }
  }

  function renderHistory() {
    var root = byId('view-history');
    root.textContent = '';

    if (!state.events.length) {
      root.appendChild(emptyState('Noch nichts passiert',
        'Sobald du Runden einträgst oder Geld ein- und auszahlst, steht hier alles nachvollziehbar drin.'));
      return;
    }

    var events = state.events.slice().reverse();
    var shown = events.slice(0, historyLimit);
    var currentDay = null;
    var card = null;

    shown.forEach(function (ev) {
      var day = dayLabel(ev.ts);
      if (day !== currentDay) {
        currentDay = day;
        root.appendChild(h('div', { class: 'section-title', text: day }));
        card = h('div', { class: 'card' });
        root.appendChild(card);
      }
      var d = describe(ev);
      var sub = h('div', { class: 'entry-sub' });
      sub.appendChild(document.createTextNode(timeLabel(ev.ts) + ' · ' + d.sub));
      if (d.winners) sub.appendChild(h('span', { class: 'win-name', text: d.winners }));
      if (ev.note) sub.appendChild(document.createTextNode(' · ' + ev.note));

      card.appendChild(h('div', { class: 'entry' }, [
        h('div', { class: 'entry-icon ' + d.cls }, [icon(d.icon)]),
        h('div', { class: 'entry-body' }, [h('div', { class: 'entry-title', text: d.title }), sub]),
        d.amount ? h('div', { class: 'entry-amt ' + d.amountCls, text: d.amount }) : null,
        h('button', {
          type: 'button', class: 'entry-del', 'aria-label': 'Eintrag löschen',
          onclick: function () {
            confirmModal('Eintrag löschen?',
              d.title + ' – die Guthaben werden entsprechend zurückgerechnet.',
              'Löschen', function () {
                removeEvent(ev.id); render(); toast('Eintrag gelöscht.');
              });
          }
        }, [icon('i-trash')])
      ]));
    });

    if (events.length > shown.length) {
      root.appendChild(h('button', {
        type: 'button', class: 'btn btn-block',
        text: 'Weitere ' + Math.min(60, events.length - shown.length) + ' anzeigen',
        onclick: function () { historyLimit += 60; renderHistory(); }
      }));
    }
  }

  /* ------------------------------------------------------------ 4. Kasse */

  function renderCash() {
    var root = byId('view-cash');
    root.textContent = '';

    if (!state.players.length) {
      root.appendChild(emptyState('Keine Daten',
        'Lege zuerst Spieler an, dann erscheint hier die Abrechnung des Abends.'));
      return;
    }

    var stats = C.sessionStats(state);
    var startIdx = C.sessionStartIndex(state);
    var sessionEvents = state.events.slice(startIdx);
    var hands = sessionEvents.filter(function (e) { return e.type === 'hand'; });
    var volume = hands.reduce(function (s, e) {
      return s + e.contributions.reduce(function (a, c) { return a + c.amount; }, 0);
    }, 0);
    var onTable = state.players.reduce(function (s, p) { return s + (stats[p.id].balance || 0); }, 0);

    /* ---- Überblick ---- */
    root.appendChild(h('div', { class: 'card' }, [
      h('div', { class: 'card-head' }, [
        h('h2', { text: 'Aktueller Abend' }),
        h('span', { class: 'sub', text: hands.length + (hands.length === 1 ? ' Runde' : ' Runden') })
      ]),
      h('table', { class: 'tbl' }, [
        h('thead', {}, [h('tr', {}, [
          h('th', { text: 'Spieler' }), h('th', { text: 'Bar' }),
          h('th', { text: 'Stand' }), h('th', { text: 'Ergebnis' })
        ])]),
        h('tbody', {}, state.players.slice().sort(function (a, b) {
          return stats[b.id].net - stats[a.id].net;
        }).map(function (p) {
          var s = stats[p.id];
          var cls = s.net > 0 ? 'pos' : s.net < 0 ? 'neg' : 'zero';
          return h('tr', {}, [
            h('td', { text: p.name }),
            h('td', { class: 'zero', text: C.formatCents(s.in - s.out) }),
            h('td', { text: C.formatCents(s.balance) }),
            h('td', { class: cls, text: signed(s.net) })
          ]);
        }))
      ]),
      h('p', { class: 'hint', text: 'Bar = eingezahlt minus ausgezahlt. Stand = Guthaben in der Kasse. '
        + 'Ergebnis = Gewinn oder Verlust an diesem Abend. Insgesamt im Spiel: ' + money(onTable)
        + ' · Pot-Volumen: ' + money(volume) + '.' })
    ]));

    /* ---- Ausgleich ---- */
    var nets = {};
    state.players.forEach(function (p) { nets[p.id] = stats[p.id].net; });
    var transfers = C.settlementTransfers(nets);

    var settleCard = h('div', { class: 'card' }, [
      h('div', { class: 'card-head' }, [h('h2', { text: 'Ausgleich in bar' })])
    ]);
    if (!transfers.length) {
      settleCard.appendChild(h('p', { class: 'hint', style: 'margin:0',
        text: 'Nichts auszugleichen – alle stehen bei ±0,00 ' + state.settings.currency + '.' }));
    } else {
      transfers.forEach(function (t) {
        settleCard.appendChild(h('div', { class: 'settle-line' }, [
          h('b', { text: nameOf(t.fromId) }),
          icon('i-arrow'),
          h('b', { text: nameOf(t.toId) }),
          h('span', { class: 'amt', text: money(t.amount) })
        ]));
      });
      settleCard.appendChild(h('p', { class: 'hint',
        text: 'So wenige Zahlungen wie möglich, damit am Ende alle bei null stehen.' }));
    }
    root.appendChild(settleCard);

    backupReminder(root);

    /* ---- Aktionen ---- */
    root.appendChild(h('div', { class: 'card' }, [
      h('div', { class: 'card-head' }, [h('h2', { text: 'Abend beenden' })]),
      h('button', {
        type: 'button', class: 'btn btn-block', text: 'Abend abschließen',
        onclick: closeSession
      }),
      h('p', { class: 'hint', text: 'Setzt alle Guthaben auf 0 und startet eine neue Abrechnung. '
        + 'Der Verlauf bleibt vollständig erhalten.' })
    ]));

    root.appendChild(h('div', { class: 'card' }, [
      h('div', { class: 'card-head' }, [h('h2', { text: 'Daten' })]),
      h('div', { class: 'btn-row' }, [
        h('button', { type: 'button', class: 'btn', text: 'Sichern', onclick: exportData }),
        h('button', { type: 'button', class: 'btn', text: 'Laden', onclick: importData })
      ]),
      h('button', { type: 'button', class: 'btn btn-block', style: 'margin-top:8px',
        text: 'Sicherungen', onclick: backupsSheet }),
      h('p', { class: 'hint', text: 'Die Daten liegen doppelt auf diesem Gerät und werden '
        + 'automatisch gesichert. Ein Export ist die einzige Kopie außerhalb des Handys – '
        + 'damit lassen sie sich auch auf ein anderes Gerät übertragen.' })
    ]));
  }

  /**
   * Erinnert daran, die Daten zu exportieren – die einzige Kopie, die einen
   * Handyverlust ueberlebt. Erscheint erst, wenn es wirklich etwas zu verlieren gibt.
   */
  function backupReminder(root) {
    if (state.events.length < 5) return;
    var last = S.lastExport();
    var alter = last ? Date.now() - last : Infinity;
    if (alter < 14 * 864e5) return;

    root.insertBefore(h('div', { class: 'notice' }, [
      icon('i-share'),
      h('div', { class: 'body' }, [
        h('div', { class: 'title', text: last ? 'Letzte Sicherung ist eine Weile her' : 'Noch keine Sicherung' }),
        h('div', { class: 'text', text: 'Geht das Handy verloren, sind auch die Daten weg. '
          + 'Ein Export dauert ein paar Sekunden.' }),
        h('button', { type: 'button', class: 'btn btn-sm', style: 'margin-top:9px',
          text: 'Jetzt sichern', onclick: exportData })
      ])
    ]), root.firstChild);
  }

  function closeSession() {
    var stats = C.sessionStats(state);
    var open = state.players.filter(function (p) { return stats[p.id].balance !== 0; });
    confirmModal('Abend abschließen?',
      open.length
        ? 'Die Guthaben von ' + open.length + ' Spieler(n) werden auf 0 gesetzt. Der Verlauf bleibt erhalten.'
        : 'Startet eine neue Abrechnung. Der Verlauf bleibt erhalten.',
      'Abschließen', function () {
        S.snapshot(state, 'vor dem Abschluss des Abends');
        open.forEach(function (p) {
          addEvent({ type: 'settle', playerId: p.id, amount: -stats[p.id].balance });
        });
        addEvent({ type: 'session-end' });
        resetDraft();
        render();
        toast('Abend abgeschlossen. Neue Abrechnung gestartet.');
      });
  }

  /* ================================================== Sichern und Laden */

  function exportData() {
    var json = JSON.stringify(state, null, 2);
    var name = 'pokerkasse-' + new Date().toISOString().slice(0, 10) + '.json';
    var url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));

    var body = [h('p', { class: 'hint', style: 'margin-top:0',
      text: state.players.length + ' Spieler, ' + state.events.length + ' Einträge.' })];

    var dl = h('a', { class: 'btn btn-block btn-primary', href: url, download: name,
      style: 'margin-bottom:8px', text: 'Als Datei speichern', onclick: function () { S.markExported(); } });
    body.push(dl);

    if (navigator.share) {
      body.push(h('button', {
        type: 'button', class: 'btn btn-block', text: 'Teilen', style: 'margin-bottom:8px',
        onclick: function () {
          var file = new File([json], name, { type: 'application/json' });
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            navigator.share({ files: [file], title: 'Pokerkasse-Sicherung' })
              .then(function () { S.markExported(); }).catch(function () {});
          } else {
            navigator.share({ title: 'Pokerkasse-Sicherung', text: json })
              .then(function () { S.markExported(); }).catch(function () {});
          }
        }
      }));
    }
    body.push(h('button', {
      type: 'button', class: 'btn btn-block', text: 'In die Zwischenablage',
      onclick: function () {
        if (navigator.clipboard) {
          navigator.clipboard.writeText(json)
            .then(function () { S.markExported(); toast('Daten kopiert.'); })
            .catch(function () { toast('Kopieren nicht möglich.'); });
        } else { toast('Kopieren wird hier nicht unterstützt.'); }
      }
    }));

    modal({
      title: 'Daten sichern',
      sub: 'Eine JSON-Datei mit allen Spielern und Einträgen.',
      body: body, focus: false,
      actions: [{ label: 'Fertig', run: function () { setTimeout(function () { URL.revokeObjectURL(url); }, 1000); } }]
    });
  }

  function importData() {
    var file = h('input', { type: 'file', accept: 'application/json,.json', class: 'input',
      style: 'padding-top:11px;height:auto' });
    var text = h('textarea', { class: 'input', placeholder: 'oder Daten hier einfügen …' });

    function apply(raw) {
      var parsed;
      try { parsed = JSON.parse(raw); }
      catch (e) { toast('Das ist keine gültige Sicherungsdatei.'); return false; }
      var next = C.normalizeState(parsed);
      if (!next.players.length && !next.events.length) { toast('Die Datei enthält keine Daten.'); return false; }
      closeModal();
      confirmModal('Daten ersetzen?',
        next.players.length + ' Spieler und ' + next.events.length + ' Einträge werden geladen. '
        + 'Die aktuellen Daten auf diesem Gerät gehen dabei verloren.',
        'Ersetzen', function () {
          // Erst den bisherigen Stand sichern, dann ersetzen.
          S.snapshot(state, 'vor dem Laden einer Sicherung').then(function () {
            state = next;
            resetDraft();
            save(); render();
            toast('Daten geladen. Der vorherige Stand liegt als Sicherung bereit.');
          });
        });
      return true;
    }

    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () { apply(String(r.result)); };
      r.readAsText(f);
    });

    modal({
      title: 'Daten laden',
      sub: 'Ersetzt alle Daten auf diesem Gerät durch die Sicherung.',
      body: [
        h('label', { class: 'field' }, [h('span', { text: 'Datei auswählen' }), file]),
        h('label', { class: 'field' }, [h('span', { text: 'Oder Text einfügen' }), text])
      ],
      focus: false,
      actions: [{ label: 'Abbrechen' }, {
        label: 'Laden', kind: 'primary',
        run: function () {
          if (!text.value.trim()) { toast('Bitte Datei wählen oder Text einfügen.'); return false; }
          apply(text.value);
          return false;   // apply() steuert das Schließen selbst
        }
      }]
    });
  }

  /* ======================================================= Einstellungen */

  /** Zeigt an, wo die Daten liegen und ob der Browser sie dauerhaft behält. */
  function storageStatusBox() {
    var box = h('div', { class: 'storage-box' }, [
      h('div', { class: 'storage-line', text: 'Speicher wird geprüft …' })
    ]);
    S.status().then(function (st) {
      box.textContent = '';
      var mb = function (b) { return b == null ? '?' : (b / 1048576).toFixed(1).replace('.', ',') + ' MB'; };

      var orte = [];
      if (st.indexedDB) orte.push('Datenbank');
      if (st.localStorage) orte.push('Browserspeicher');

      box.appendChild(h('div', { class: 'storage-line' + (orte.length > 1 ? ' ok' : orte.length ? '' : ' bad') }, [
        icon(orte.length ? 'i-check' : 'i-close'),
        h('span', { text: orte.length
          ? 'Gespeichert in: ' + orte.join(' + ')
          : 'Kein Speicher verfügbar – bitte Daten exportieren!' })
      ]));

      box.appendChild(h('div', { class: 'storage-line' + (st.persisted ? ' ok' : ' warn') }, [
        icon(st.persisted ? 'i-check' : 'i-clock'),
        h('span', { text: st.persisted === true
          ? 'Dauerhaft – der Browser löscht die Daten nicht von selbst'
          : st.persisted === false
            ? 'Noch nicht als dauerhaft bestätigt (nach der Installation auf dem Home-Bildschirm meist automatisch)'
            : 'Dauerhaftigkeit lässt sich hier nicht abfragen' })
      ]));

      if (st.snapshots !== null) {
        box.appendChild(h('div', { class: 'storage-line' }, [
          icon('i-clock'),
          h('span', { text: st.snapshots + (st.snapshots === 1 ? ' Sicherung' : ' Sicherungen') + ' vorhanden' })
        ]));
      }

      box.appendChild(h('div', { class: 'storage-line' + (st.lastExport ? '' : ' warn') }, [
        icon('i-share'),
        h('span', { text: st.lastExport
          ? 'Zuletzt exportiert: ' + new Date(st.lastExport).toLocaleDateString('de-DE')
          : 'Noch nie exportiert – eine Kopie außerhalb des Handys fehlt' })
      ]));

      if (st.usage != null) {
        box.appendChild(h('div', { class: 'storage-line' }, [
          icon('i-money'), h('span', { text: 'Belegt: ' + mb(st.usage) + ' von ' + mb(st.quota) })
        ]));
      }
    });
    return box;
  }

  /** Liste der automatischen Sicherungen mit Wiederherstellung. */
  function backupsSheet() {
    var list = h('div', { class: 'rows' }, [h('p', { class: 'hint', text: 'Wird geladen …' })]);

    S.list().then(function (all) {
      list.textContent = '';
      if (all === null) {
        list.appendChild(h('p', { class: 'hint',
          text: 'Auf diesem Gerät sind keine automatischen Sicherungen möglich. '
            + 'Sichere die Daten stattdessen regelmäßig als Datei.' }));
        return;
      }
      if (!all.length) {
        list.appendChild(h('p', { class: 'hint',
          text: 'Noch keine Sicherungen. Es wird automatisch eine angelegt – einmal täglich '
            + 'und immer vor Schritten, die Daten überschreiben.' }));
        return;
      }
      all.forEach(function (snap) {
        var when = new Date(snap.ts).toLocaleString('de-DE',
          { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
        list.appendChild(h('div', { class: 'row' }, [
          h('div', { class: 'who' }, [
            h('div', { class: 'name', text: when }),
            h('div', { class: 'sub', text: snap.players + ' Spieler · ' + snap.events + ' Einträge'
              + (snap.reason ? ' · ' + snap.reason : '') })
          ]),
          h('button', {
            type: 'button', class: 'btn btn-sm', text: 'Laden',
            onclick: function () {
              S.get(snap.id).then(function (data) {
                if (!data) { toast('Diese Sicherung lässt sich nicht lesen.'); return; }
                var next = C.normalizeState(data);
                closeModal();
                confirmModal('Sicherung vom ' + when + ' laden?',
                  next.players.length + ' Spieler und ' + next.events.length + ' Einträge. '
                  + 'Der aktuelle Stand wird vorher automatisch gesichert.',
                  'Laden', function () {
                    S.snapshot(state, 'vor dem Zurücksetzen auf eine Sicherung').then(function () {
                      state = next;
                      resetDraft();
                      save(); render();
                      toast('Sicherung geladen.');
                    });
                  });
              });
            }
          })
        ]));
      });
    });

    modal({
      title: 'Sicherungen',
      sub: 'Automatische Kopien auf diesem Gerät. Sie schützen vor Fehlgriffen, '
        + 'nicht vor einem verlorenen Handy – dafür ist der Export da.',
      body: [list], focus: false,
      actions: [{ label: 'Schließen' }]
    });
  }

  function settingsSheet() {
    var storageBox = storageStatusBox();
    var cur = h('input', { class: 'input', type: 'text', value: state.settings.currency, maxlength: '4' });
    var chips = h('input', {
      class: 'input', type: 'text', inputmode: 'decimal',
      value: state.settings.chips.map(function (c) { return C.formatCents(c); }).join('  ')
    });

    modal({
      title: 'Einstellungen',
      focus: false,
      body: [
        h('label', { class: 'field' }, [h('span', { text: 'Währung' }), cur]),
        h('label', { class: 'field' }, [
          h('span', { text: 'Chip-Werte (durch Leerzeichen getrennt)' }), chips
        ]),
        h('p', { class: 'hint', style: 'margin-bottom:16px',
          text: 'Die Chip-Werte sind die Schnellwahl-Beträge beim Eintragen der Einsätze.' }),
        storageBox,
        h('button', {
          type: 'button', class: 'btn btn-block', text: 'Sicherungen', style: 'margin-bottom:8px',
          onclick: function () { closeModal(); backupsSheet(); }
        }),
        h('div', { class: 'btn-row', style: 'margin-bottom:8px' }, [
          h('button', { type: 'button', class: 'btn', text: 'Daten sichern',
            onclick: function () { closeModal(); exportData(); } }),
          h('button', { type: 'button', class: 'btn', text: 'Daten laden',
            onclick: function () { closeModal(); importData(); } })
        ]),
        h('button', {
          type: 'button', class: 'btn btn-block', text: 'Installation auf dem Handy',
          style: 'margin-bottom:8px', onclick: function () { closeModal(); installHelp(); }
        }),
        h('button', {
          type: 'button', class: 'btn btn-block btn-danger', text: 'Alle Daten löschen',
          onclick: function () {
            closeModal();
            confirmModal('Wirklich alles löschen?',
              'Spieler, Guthaben und der gesamte Verlauf werden unwiderruflich entfernt.',
              'Alles löschen', function () {
                // Ein Fehlgriff bleibt so umkehrbar.
                S.snapshot(state, 'vor dem Löschen aller Daten').then(function (id) {
                  state = C.createState();
                  resetDraft();
                  save(); render();
                  toast(id ? 'Gelöscht. Der alte Stand liegt als Sicherung bereit.' : 'Alle Daten gelöscht.');
                });
              });
          }
        })
      ],
      actions: [{ label: 'Abbrechen' }, {
        label: 'Speichern', kind: 'primary', run: function () {
          var c = cur.value.trim().slice(0, 4);
          if (c) state.settings.currency = c;
          var parsed = chips.value.split(/[\s,;]+/)
            .map(function (s) { return C.parseAmount(s); })
            .filter(function (v) { return v !== null && v > 0; })
            .sort(function (a, b) { return a - b; })
            .slice(0, 6);
          if (parsed.length) state.settings.chips = parsed;
          if (state.settings.chips.indexOf(draft.chip) === -1) {
            draft.chip = state.settings.chips[Math.min(1, state.settings.chips.length - 1)];
            saveDraft();
          }
          save(); render();
        }
      }]
    });
  }

  /* ========================================================= Installation */

  /** Laeuft die App als installierte native App (Capacitor) statt im Browser? */
  function istNativeApp() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform &&
      window.Capacitor.isNativePlatform());
  }

  /**
   * Die Zurueck-Taste auf Android soll nicht sofort die App schliessen:
   * erst offene Dialoge, dann zurueck zur Spielansicht, und nur dann beenden.
   */
  function bindeZurueckTaste() {
    if (!istNativeApp()) return;
    var plugins = window.Capacitor.Plugins || {};
    if (!plugins.App || !plugins.App.addListener) return;
    plugins.App.addListener('backButton', function () {
      if (!byId('modal-root').classList.contains('hidden')) { closeModal(); return; }
      if (!byId('toast').classList.contains('hidden')) { hideToast(); return; }
      if (view !== 'game') { view = 'game'; render(); return; }
      if (state.hand && E.canUndo(state.hand)) {
        toast('Zum Beenden „Hand abbrechen“ oder die App schließen.');
        return;
      }
      plugins.App.exitApp();
    });
  }

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
  }
  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  }

  function installHelp() {
    var steps = isIOS()
      ? ['Diese Seite in <b>Safari</b> öffnen (nicht Chrome).',
         'Unten auf das <b>Teilen-Symbol</b> tippen (Quadrat mit Pfeil nach oben).',
         'Etwas nach unten scrollen und <b>„Zum Home-Bildschirm“</b> wählen.',
         'Mit <b>„Hinzufügen“</b> bestätigen – fertig.']
      : ['Diese Seite in <b>Chrome</b> öffnen.',
         'Oben rechts das <b>Menü (⋮)</b> antippen.',
         '<b>„App installieren“</b> bzw. <b>„Zum Startbildschirm zufügen“</b> wählen.',
         'Bestätigen – die App liegt danach neben deinen anderen Apps.'];

    modal({
      title: 'Auf dem Handy installieren',
      sub: isIOS() ? 'iPhone / iPad' : 'Android',
      focus: false,
      body: [h('ol', { style: 'margin:0;padding-left:20px;font-size:14.5px;line-height:1.8' },
        steps.map(function (s) { return h('li', { html: s }); })),
        h('p', { class: 'hint', text: 'Danach läuft die App auch ohne Internet. '
          + 'Die Daten bleiben auf dem Gerät.' })],
      actions: [{ label: 'Alles klar' }]
    });
  }

  /* =============================================================== Start */

  function init() {
    // Bis die Daten geladen sind, mit einem leeren Zustand arbeiten – das
    // dauert nur Millisekunden, verhindert aber Zugriffe auf undefined.
    state = C.createState();
    draft = loadDraft();
    try { gameMode = localStorage.getItem(MODE_KEY) === 'quick' ? 'quick' : 'table'; } catch (e) { /* egal */ }

    S.load().then(function (res) {
      if (res.data) state = C.normalizeState(res.data);
      draft = loadDraft();
      render();
      // Den Browser bitten, die Daten nicht selbsttaetig zu loeschen,
      // und einmal am Tag eine Sicherung anlegen.
      S.requestPersistence();
      S.autoSnapshot(state);
      if (res.hadIdb !== res.hadLs) save();   // fehlende Kopie ergaenzen
    });

    document.querySelectorAll('.tab').forEach(function (t) {
      t.addEventListener('click', function () {
        view = t.dataset.view;
        historyLimit = 60;
        hideToast();
        render();
      });
    });
    byId('btn-settings').addEventListener('click', settingsSheet);

    var installBtn = byId('btn-install');
    installBtn.addEventListener('click', function () {
      if (deferredInstall) {
        deferredInstall.prompt();
        deferredInstall.userChoice.then(function () {
          deferredInstall = null;
          installBtn.classList.add('hidden');
        });
      } else { installHelp(); }
    });
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredInstall = e;
      installBtn.classList.remove('hidden');
    });
    if (!istNativeApp() && !isStandalone() && isIOS()) installBtn.classList.remove('hidden');
    window.addEventListener('appinstalled', function () {
      deferredInstall = null;
      installBtn.classList.add('hidden');
      toast('Pokerkasse ist installiert.');
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !byId('modal-root').classList.contains('hidden')) closeModal();
    });

    window.addEventListener('resize', function () {
      var t = document.querySelector('.ptable');
      if (t) passeTischHoehe(t);
    });

    render();

    // Der Service Worker ist nur fuer die Web-Version da. In der nativen App
    // liegen die Dateien ohnehin auf dem Geraet, und ein Cache wuerde nach
    // einem Update den alten Stand ausliefern.
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      window.addEventListener('load', function () {
        // Erst hier pruefen: die Capacitor-Bruecke haengt sich frueh ein, aber
        // beim load-Ereignis ist sie in jedem Fall vorhanden.
        if (istNativeApp()) return;
        navigator.serviceWorker.register('./sw.js').catch(function () { /* offline dann eben nicht */ });
      });
    }

    bindeZurueckTaste();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}());
