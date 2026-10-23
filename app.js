// Flashcard Maker: static site, no accounts. Decks live in this browser's localStorage.

const KEY = 'flashcards.v1';
const DAY = 24 * 60 * 60 * 1000;
const RETRY_MS = 60 * 1000; // an "Again" card comes back after a minute

const $ = (sel, root = document) => root.querySelector(sel);
const clean = (value) => String(value ?? '').trim();
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const safeUrl = (url) => (/^https?:\/\//i.test(clean(url)) ? clean(url) : '');
const slug = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'deck';
const shuffled = (arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};
const LABEL = { again: 'Again', hard: 'Hard', got: 'Got it' };

const app = $('#app');
let state = loadState();
let study = null; // the active study session, or null

// ---------- storage ----------

function loadState() {
  const raw = localStorage.getItem(KEY);
  try {
    const saved = JSON.parse(raw);
    if (saved && Array.isArray(saved.decks)) return saved;
  } catch (err) {
    // Keep the unreadable data around so nothing is lost, then start clean.
    if (raw) localStorage.setItem(`${KEY}.broken`, raw);
  }
  return { decks: [] };
}

function saveState() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    toast('Could not save. Browser storage may be full or blocked.');
  }
}

// ---------- models ----------

function makeDeck({ title, subject, description }) {
  return { id: uid(), title: clean(title) || 'Untitled deck', subject: clean(subject), description: clean(description), createdAt: Date.now(), cards: [] };
}

function makeCard({ q, a, example, image, ...progress }) {
  return {
    id: uid(),
    q: clean(q),
    a: clean(a),
    example: clean(example),
    image: safeUrl(image),
    starred: false,
    ease: 2.5,
    interval: 0,
    due: Date.now(),
    last: null,
    lastStudied: null,
    reps: 0,
    ...pickProgress(progress),
  };
}

function pickProgress(obj) {
  const keep = {};
  for (const key of ['starred', 'ease', 'interval', 'due', 'last', 'lastStudied', 'reps']) {
    if (obj[key] !== undefined) keep[key] = obj[key];
  }
  return keep;
}

const findDeck = (id) => state.decks.find((d) => d.id === id);
const findCard = (deck, id) => deck.cards.find((c) => c.id === id);

// Simple spaced repetition: Again returns soon, Hard grows slowly, Got it grows faster.
function review(card, rating) {
  const now = Date.now();
  if (rating === 'again') {
    card.ease = Math.max(1.3, card.ease - 0.2);
    card.interval = 0;
    card.due = now + RETRY_MS;
  } else if (rating === 'hard') {
    card.ease = Math.max(1.3, card.ease - 0.15);
    card.interval = Math.max(1, Math.round((card.interval || 1) * 1.2));
    card.due = now + card.interval * DAY;
  } else {
    card.interval = card.interval <= 0 ? 1 : card.interval === 1 ? 3 : Math.round(card.interval * card.ease);
    card.due = now + card.interval * DAY;
  }
  card.reps += 1;
  card.last = rating;
  card.lastStudied = now;
  saveState();
}

function deckStats(deck) {
  const now = Date.now();
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const cards = deck.cards;
  const reviewed = cards.filter((c) => c.last).length;
  return {
    total: cards.length,
    reviewed,
    got: cards.filter((c) => c.last === 'got').length,
    practice: cards.filter((c) => c.last === 'again' || c.last === 'hard').length,
    due: cards.filter((c) => c.due <= now).length,
    today: cards.filter((c) => c.lastStudied && c.lastStudied >= startOfToday).length,
    pct: cards.length ? Math.round((reviewed / cards.length) * 100) : 0,
  };
}

// ---------- routing & rendering ----------

function currentRoute() {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [name, id] = path.split('/');
  return { name: name || 'home', id, params: new URLSearchParams(query) };
}

const currentDeck = () => findDeck(currentRoute().id);

function render() {
  const route = currentRoute();
  const deck = findDeck(route.id);
  if (route.name === 'deck' && deck) renderDeck(deck);
  else if (route.name === 'study' && deck) renderStudy(deck, route.params);
  else renderHome();
}

function renderHome() {
  study = null;
  app.innerHTML = `
    <section class="page-head">
      <div>
        <h1>Your decks</h1>
        <p class="muted">Everything saves automatically in this browser.</p>
      </div>
      <button class="primary" data-action="new-deck" type="button">+ New deck</button>
    </section>
    ${state.decks.length
      ? `<div class="deck-grid">${state.decks.map(deckTile).join('')}</div>`
      : '<div class="empty"><p>No decks yet. Create one to start adding cards.</p></div>'}`;
}

function deckTile(deck) {
  const s = deckStats(deck);
  return `
    <a class="card deck-tile" href="#/deck/${deck.id}">
      <div class="tile-subject">${esc(deck.subject || 'General')}</div>
      <h2>${esc(deck.title)}</h2>
      <p class="muted">${esc(deck.description)}</p>
      <div class="tile-stats">
        <span>${s.total} cards</span><span>${s.due} due</span><span>${s.practice} need practice</span>
      </div>
      <div class="bar" title="${s.pct}% reviewed"><span style="width:${s.pct}%"></span></div>
    </a>`;
}

function renderDeck(deck, { term = '', openAdd = false, openImport = false } = {}) {
  study = null;
  const s = deckStats(deck);
  const practiceCards = deck.cards.filter((c) => c.last === 'again' || c.last === 'hard');
  app.innerHTML = `
    <nav class="crumbs"><a href="#/">Decks</a> / ${esc(deck.title)}</nav>

    <section class="page-head">
      <div>
        <div class="tile-subject">${esc(deck.subject || 'General')}</div>
        <h1>${esc(deck.title)}</h1>
        <p class="muted">${esc(deck.description)}</p>
      </div>
      <div class="row-actions">
        <button class="ghost" data-action="edit-deck" data-deck="${deck.id}" type="button">Edit deck</button>
        <button class="ghost" data-action="share-deck" data-deck="${deck.id}" type="button">Share link</button>
        <button class="ghost" data-action="export-json" data-deck="${deck.id}" type="button">Export JSON</button>
        <button class="ghost" data-action="export-csv" data-deck="${deck.id}" type="button">Export CSV</button>
        <button class="danger" data-action="delete-deck" data-deck="${deck.id}" type="button">Delete deck</button>
      </div>
    </section>

    <section class="stats">
      <div><b>${s.total}</b><span>cards</span></div>
      <div><b>${s.reviewed}</b><span>reviewed</span></div>
      <div><b>${s.today}</b><span>reviewed today</span></div>
      <div><b>${s.due}</b><span>due now</span></div>
      <div><b>${s.practice}</b><span>need practice</span></div>
    </section>

    <section class="card">
      <form class="inline-form" data-form="study-start" data-deck="${deck.id}">
        <label>Study
          <select name="filter">
            <option value="all">All cards</option>
            <option value="due">Due now</option>
            <option value="starred">Starred</option>
            <option value="missed">Missed (Again or Hard)</option>
          </select>
        </label>
        <label class="check"><input type="checkbox" name="shuffle"> Shuffle</label>
        <button class="primary" type="submit" ${deck.cards.length ? '' : 'disabled'}>Start studying</button>
      </form>
      ${practiceCards.length ? `
        <details class="panel" style="margin-top:12px">
          <summary>${practiceCards.length} card${practiceCards.length === 1 ? '' : 's'} need more practice</summary>
          <ul class="practice-list">${practiceCards.map((c) => `<li>${esc(c.q)}</li>`).join('')}</ul>
        </details>` : ''}
    </section>

    <section class="card">
      <details class="panel" id="add-panel" ${openAdd ? 'open' : ''}>
        <summary>+ Add a card</summary>
        <form data-form="add-card" data-deck="${deck.id}">
          <label>Question<textarea name="q" rows="2" required></textarea></label>
          <label>Answer<textarea name="a" rows="3" required></textarea></label>
          <label>Example (optional)<input name="example"></label>
          <label>Image URL (optional)<input name="image" type="url" placeholder="https://…"></label>
          <div class="row-actions"><button class="primary" type="submit">Add card</button></div>
        </form>
      </details>

      <details class="panel" id="import-panel" ${openImport ? 'open' : ''}>
        <summary>Import cards</summary>
        <form data-form="import-text" data-deck="${deck.id}">
          <label>Paste cards, one per line: question | answer | optional example
            <textarea name="text" rows="5" placeholder="What is H2O? | Water&#10;Capital of France | Paris | It is also the largest city"></textarea>
          </label>
          <div class="row-actions">
            <button class="primary" type="submit">Import pasted cards</button>
            <button class="ghost" type="button" data-action="import-csv" data-deck="${deck.id}">Import CSV file</button>
          </div>
        </form>
      </details>

      <div class="list-head">
        <input id="search" type="search" placeholder="Search cards…" aria-label="Search cards" value="${esc(term)}">
      </div>
      <div id="card-list">${renderCardList(deck, term)}</div>
    </section>`;

  if (openAdd) $('#add-panel textarea[name="q"]')?.focus();
}

function renderCardList(deck, term) {
  const needle = clean(term).toLowerCase();
  const matches = deck.cards.filter((c) => !needle || [c.q, c.a, c.example].join(' ').toLowerCase().includes(needle));
  if (!matches.length) {
    return `<p class="muted">${deck.cards.length ? 'No cards match your search.' : 'No cards yet. Add your first one above.'}</p>`;
  }
  return `<ul class="card-list">${matches.map((c) => cardRow(deck, c)).join('')}</ul>`;
}

function cardRow(deck, c) {
  const status = c.last ? `<span class="tag tag-${c.last}">${LABEL[c.last]}</span>` : '<span class="tag">New</span>';
  return `
    <li class="card-row">
      <button class="icon ${c.starred ? 'on' : ''}" data-action="star" data-deck="${deck.id}" data-card="${c.id}" type="button" title="Star" aria-label="Star card" aria-pressed="${c.starred}">★</button>
      <div class="card-body">
        <div class="q">${esc(c.q)}</div>
        <div class="a muted">${esc(c.a)}</div>
      </div>
      ${status}
      <button class="ghost small" data-action="edit-card" data-deck="${deck.id}" data-card="${c.id}" type="button">Edit</button>
      <button class="ghost small danger" data-action="delete-card" data-deck="${deck.id}" data-card="${c.id}" type="button">Delete</button>
    </li>`;
}

// ---------- study mode ----------

function newSession(deck, filter, shuffleOn) {
  const now = Date.now();
  const matches = deck.cards.filter((c) => {
    if (filter === 'due') return c.due <= now;
    if (filter === 'starred') return c.starred;
    if (filter === 'missed') return c.last === 'again' || c.last === 'hard';
    return true;
  });
  const ordered = shuffleOn ? shuffled(matches) : matches.sort((a, b) => a.due - b.due);
  return {
    deckId: deck.id,
    filter,
    shuffle: shuffleOn,
    queue: ordered.map((c) => c.id),
    total: ordered.length,
    revealed: false,
    counts: { again: 0, hard: 0, got: 0 },
  };
}

function renderStudy(deck, params) {
  const filter = params.get('filter') || 'all';
  const shuffleOn = params.get('shuffle') === '1';
  if (!study || study.deckId !== deck.id || study.filter !== filter || study.shuffle !== shuffleOn) {
    study = newSession(deck, filter, shuffleOn);
  }

  if (!study.queue.length) return renderSummary(deck);

  const card = findCard(deck, study.queue[0]);
  const remaining = study.queue.length;
  const img = safeUrl(card.image);

  app.innerHTML = `
    <nav class="crumbs"><a href="#/deck/${deck.id}">← ${esc(deck.title)}</a></nav>
    <div class="study-meta">
      <span>${remaining} left in this round</span>
      <span>Again ${study.counts.again} · Hard ${study.counts.hard} · Got it ${study.counts.got}</span>
    </div>

    <section class="flashcard ${study.revealed ? 'revealed' : ''}">
      <button class="icon star-btn ${card.starred ? 'on' : ''}" data-action="star-study" data-card="${card.id}" type="button" title="Star (S)" aria-label="Star card" aria-pressed="${card.starred}">★</button>
      <div class="face">
        <div class="label">${study.revealed ? 'Answer' : 'Question'}</div>
        <div class="text">${esc(study.revealed ? card.a : card.q)}</div>
        ${study.revealed && card.example ? `<div class="example"><b>Example:</b> ${esc(card.example)}</div>` : ''}
        ${img ? `<img class="card-img" src="${esc(img)}" alt="">` : ''}
      </div>
    </section>

    ${study.revealed
      ? `<div class="ratings">
           <button class="again" data-action="rate" data-rating="again" type="button">Again <kbd>1</kbd></button>
           <button class="hard" data-action="rate" data-rating="hard" type="button">Hard <kbd>2</kbd></button>
           <button class="got" data-action="rate" data-rating="got" type="button">Got it <kbd>3</kbd></button>
         </div>`
      : `<button class="primary reveal-btn" data-action="reveal" type="button">Show answer <kbd>Space</kbd></button>`}`;
}

function renderSummary(deck) {
  const c = study.counts;
  const rated = c.again + c.hard + c.got;
  const pct = rated ? Math.round((c.got / rated) * 100) : 0;
  app.innerHTML = `
    <section class="card summary">
      <h1>${study.total ? 'Round complete' : 'Nothing to study here'}</h1>
      <p class="muted">${study.total ? `${pct}% got it on the first try` : 'No cards match this filter yet.'}</p>
      <div class="session-counts">
        <span>Got it ${c.got}</span><span>Hard ${c.hard}</span><span>Again ${c.again}</span>
      </div>
      <div class="row-actions center" style="margin-top:20px">
        <button class="primary" data-action="study-again" type="button">Study again</button>
        <a class="ghost" href="#/deck/${deck.id}">Back to deck</a>
      </div>
    </section>`;
}

function revealAnswer() {
  if (!study || study.revealed) return;
  study.revealed = true;
  render();
}

function rateCard(rating) {
  const deck = currentDeck();
  if (!study || !deck || !study.revealed) return;
  const id = study.queue.shift();
  const card = findCard(deck, id);
  if (card) {
    review(card, rating);
    study.counts[rating] += 1;
    if (rating === 'again') study.queue.push(id); // missed cards come back this round
  }
  study.revealed = false;
  render();
}

function toggleStar(card) {
  card.starred = !card.starred;
  saveState();
}

// ---------- dialogs ----------

function openModal(title, fieldsHtml, onSubmit) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <form class="modal" aria-label="${esc(title)}">
      <h2>${esc(title)}</h2>
      ${fieldsHtml}
      <div class="row-actions center" style="justify-content:flex-end; margin-top:8px">
        <button class="ghost" type="button" data-close>Cancel</button>
        <button class="primary" type="submit">Save</button>
      </div>
    </form>`;
  const form = overlay.querySelector('form');
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.matches('[data-close]')) overlay.remove();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    if (onSubmit(data) !== false) overlay.remove();
  });
  document.body.append(overlay);
  form.querySelector('input, textarea')?.focus();
}

const deckFields = (deck = {}) => `
  <label>Title<input name="title" required value="${esc(deck.title)}"></label>
  <label>Subject or class<input name="subject" placeholder="e.g. Biology 101" value="${esc(deck.subject)}"></label>
  <label>Description (optional)<textarea name="description" rows="2">${esc(deck.description)}</textarea></label>`;

const cardFields = (card = {}) => `
  <label>Question<textarea name="q" rows="2" required>${esc(card.q)}</textarea></label>
  <label>Answer<textarea name="a" rows="3" required>${esc(card.a)}</textarea></label>
  <label>Example (optional)<input name="example" value="${esc(card.example)}"></label>
  <label>Image URL (optional)<input name="image" type="url" placeholder="https://…" value="${esc(card.image)}"></label>`;

// ---------- import / export ----------

function parseTextCards(text) {
  const cards = [];
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const sep = ['\t', '|', '::'].find((s) => line.includes(s));
    const [q, a, ...rest] = sep ? line.split(sep) : [];
    if (!sep || !clean(q) || !clean(a)) {
      skipped += 1;
      continue;
    }
    cards.push({ q, a, example: rest.join(sep) });
  }
  return { cards, skipped };
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => clean(cell)));
}

function cardsFromCSV(text) {
  const rows = parseCSV(text);
  if (!rows.length) return { cards: [], skipped: 0 };
  const header = rows[0].map((h) => clean(h).toLowerCase());
  const col = (names) => header.findIndex((h) => names.includes(h));
  const hasHeader = col(['question', 'front', 'q']) !== -1;
  const body = hasHeader ? rows.slice(1) : rows;
  const qi = hasHeader ? col(['question', 'front', 'q']) : 0;
  const ai = hasHeader ? col(['answer', 'back', 'a']) : 1;
  const ei = hasHeader ? col(['example', 'notes', 'extra']) : 2;

  const cards = [];
  let skipped = 0;
  for (const r of body) {
    const q = clean(r[qi]);
    const a = clean(r[ai]);
    if (!q || !a) {
      skipped += 1;
      continue;
    }
    cards.push({ q, a, example: ei >= 0 ? r[ei] : '' });
  }
  return { cards, skipped };
}

function decksFromJSON(text) {
  const data = JSON.parse(text);
  const list = Array.isArray(data.decks) ? data.decks : data.cards ? [data] : [];
  return list.map((d) => ({
    ...makeDeck({ title: d.title, subject: d.subject, description: d.description }),
    cards: (d.cards || []).filter((c) => c && clean(c.q) && clean(c.a)).map((c) => makeCard(c)),
  }));
}

const csvCell = (v) => (/[",\r\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));

function cardsToCSV(cards) {
  return ['question,answer,example', ...cards.map((c) => [c.q, c.a, c.example].map(csvCell).join(','))].join('\n');
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportPayload(decks, withProgress) {
  return JSON.stringify({
    format: 'flashcards',
    version: 1,
    decks: decks.map((d) => ({
      title: d.title,
      subject: d.subject,
      description: d.description,
      cards: d.cards.map((c) => (withProgress
        ? c
        : { q: c.q, a: c.a, example: c.example, image: c.image })),
    })),
  }, null, 2);
}

// Share links carry the deck in the URL fragment, so nothing goes to a server.
function b64encode(str) {
  let bin = '';
  new TextEncoder().encode(str).forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64decode(s) {
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Share link copied');
  } catch (err) {
    window.prompt('Copy this share link:', text);
  }
}

function importDecks(decks) {
  if (!decks.length) return toast('No decks found in that file.');
  state.decks.push(...decks);
  saveState();
  const cards = decks.reduce((n, d) => n + d.cards.length, 0);
  toast(`Imported ${decks.length} deck${decks.length === 1 ? '' : 's'} (${cards} cards)`);
  render();
}

function addCards(deck, cards, skipped) {
  deck.cards.push(...cards.map((c) => makeCard(c)));
  saveState();
  toast(`Added ${cards.length} card${cards.length === 1 ? '' : 's'}${skipped ? `, skipped ${skipped} line(s)` : ''}`);
  renderDeck(deck, { openImport: true });
}

// ---------- events ----------

let importTargetDeckId = null;
const fileInput = $('#file-input');

function rerenderDeck(deck, extra = {}) {
  renderDeck(deck, { term: $('#search')?.value || '', ...extra });
}

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  const deck = el.dataset.deck ? findDeck(el.dataset.deck) : currentDeck();
  const card = deck && el.dataset.card ? findCard(deck, el.dataset.card) : null;

  switch (action) {
    case 'new-deck':
      openModal('New deck', deckFields(), (d) => {
        if (!clean(d.title)) return false;
        const deck = makeDeck(d);
        state.decks.push(deck);
        saveState();
        location.hash = `#/deck/${deck.id}`;
      });
      break;

    case 'edit-deck':
      if (!deck) return;
      openModal('Edit deck', deckFields(deck), (d) => {
        Object.assign(deck, { title: clean(d.title) || deck.title, subject: clean(d.subject), description: clean(d.description) });
        saveState();
        rerenderDeck(deck);
      });
      break;

    case 'delete-deck':
      if (deck && confirm(`Delete "${deck.title}" and its ${deck.cards.length} cards? This cannot be undone.`)) {
        state.decks = state.decks.filter((d) => d.id !== deck.id);
        saveState();
        location.hash = '#/';
        render();
      }
      break;

    case 'share-deck':
      if (deck) copyText(`${location.origin}${location.pathname}#share=${b64encode(exportPayload([deck], false))}`);
      break;

    case 'export-json':
      if (deck) download(`${slug(deck.title)}.json`, exportPayload([deck], true), 'application/json');
      break;

    case 'export-csv':
      if (deck) download(`${slug(deck.title)}.csv`, cardsToCSV(deck.cards), 'text/csv');
      break;

    case 'import-csv':
      importTargetDeckId = deck ? deck.id : null;
      fileInput.click();
      break;

    case 'star':
      if (!card) return;
      toggleStar(card);
      rerenderDeck(deck);
      break;

    case 'edit-card':
      if (!card) return;
      openModal('Edit card', cardFields(card), (d) => {
        if (!clean(d.q) || !clean(d.a)) return false;
        Object.assign(card, { q: clean(d.q), a: clean(d.a), example: clean(d.example), image: safeUrl(d.image) });
        saveState();
        rerenderDeck(deck);
      });
      break;

    case 'delete-card':
      if (card && confirm('Delete this card?')) {
        deck.cards = deck.cards.filter((c) => c.id !== card.id);
        saveState();
        rerenderDeck(deck);
      }
      break;

    case 'reveal':
      revealAnswer();
      break;

    case 'rate':
      rateCard(el.dataset.rating);
      break;

    case 'star-study': {
      const current = currentDeck();
      const target = current && findCard(current, el.dataset.card);
      if (!target) return;
      toggleStar(target);
      render();
      break;
    }

    case 'study-again':
      study = null;
      render();
      break;

    default:
      break;
  }
});

app.addEventListener('submit', (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const deck = findDeck(form.dataset.deck);
  const data = Object.fromEntries(new FormData(form));

  switch (form.dataset.form) {
    case 'add-card': {
      if (!deck || !clean(data.q) || !clean(data.a)) return;
      deck.cards.push(makeCard(data));
      saveState();
      toast('Card added');
      rerenderDeck(deck, { openAdd: true });
      break;
    }

    case 'import-text': {
      if (!deck) return;
      const { cards, skipped } = parseTextCards(data.text || '');
      if (!cards.length) return toast('No cards found. Use: question | answer');
      addCards(deck, cards, skipped);
      break;
    }

    case 'study-start': {
      if (!deck) return;
      const filter = data.filter || 'all';
      const shuffleOn = form.elements.shuffle.checked ? 1 : 0;
      study = null;
      location.hash = `#/study/${deck.id}?filter=${filter}&shuffle=${shuffleOn}`;
      render();
      break;
    }

    default:
      break;
  }
});

$('#btn-export-all').addEventListener('click', () => {
  if (!state.decks.length) return toast('Nothing to export yet.');
  download('flashcards-backup.json', exportPayload(state.decks, true), 'application/json');
});

$('#btn-import-file').addEventListener('click', () => {
  importTargetDeckId = null;
  fileInput.click();
});

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  fileInput.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const target = importTargetDeckId ? findDeck(importTargetDeckId) : null;
    if (/\.json$/i.test(file.name) || text.trimStart().startsWith('{')) {
      importDecks(decksFromJSON(text));
    } else if (target) {
      const { cards, skipped } = cardsFromCSV(text);
      addCards(target, cards, skipped);
    } else {
      const { cards, skipped } = cardsFromCSV(text);
      importDecks([{ ...makeDeck({ title: file.name.replace(/\.[^.]+$/, '') }), cards: cards.map((c) => makeCard(c)) }]);
      if (skipped) toast(`Skipped ${skipped} row(s) without a question and answer`);
    }
  } catch (err) {
    toast('Could not read that file. Check the format and try again.');
  }
  importTargetDeckId = null;
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.overlay').forEach((o) => o.remove());
    return;
  }
  // Study shortcuts only apply on the study screen, with no dialog open and no field focused.
  if (document.querySelector('.overlay') || e.target.matches('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (currentRoute().name !== 'study' || !study || !study.queue.length) return;

  if (!study.revealed && (e.key === ' ' || e.key === 'Enter')) {
    e.preventDefault();
    revealAnswer();
  } else if (study.revealed && e.key === '1') rateCard('again');
  else if (study.revealed && e.key === '2') rateCard('hard');
  else if (study.revealed && e.key === '3') rateCard('got');
  else if (e.key.toLowerCase() === 's') {
    const deckNow = currentDeck();
    const target = deckNow && findCard(deckNow, study.queue[0]);
    if (target) {
      toggleStar(target);
      render();
    }
  }
});

let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---------- start ----------

// Opening a shared link: #share=<encoded deck>. Confirm before adding it.
function handleShareLink() {
  if (!location.hash.startsWith('#share=')) return;
  const encoded = location.hash.slice('#share='.length);
  history.replaceState(null, '', location.pathname);
  try {
    const decks = decksFromJSON(b64decode(encoded));
    const total = decks.reduce((n, d) => n + d.cards.length, 0);
    if (decks.length && confirm(`Add shared deck${decks.length === 1 ? '' : 's'} with ${total} cards to your decks?`)) {
      importDecks(decks);
    }
  } catch (err) {
    toast('That share link is not valid.');
  }
}

window.addEventListener('hashchange', render);

handleShareLink();
render();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
