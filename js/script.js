/**
 * FLASHCARDS APP — script.js
 *
 * Architecture:
 *  1. Global state (DECKS, session variables, timer)
 *  2. Initial data (default decks)
 *  3. Persistence (localStorage: save/load DECKS)
 *  4. SRS algorithm (Spaced Repetition System, inspired by Anki SM-2)
 *  5. Internationalization (i18n: language detection, loading, applying)
 *  6. UI rendering (deck grid, SRS badges)
 *  7. View navigation (tabs, back, goBack)
 *  8. Study session (showCard, flipCard, rate)
 *  9. Timer (startTimer, stopTimer)
 * 10. Session summary (showSummary, restartStudy)
 * 11. Deck editor (addCard, saveDeck, renderCardList)
 * 12. Utilities
 * 13. Initialization
 */


/* ══════════════════════════════════════════════════════════
   1. GLOBAL STATE
══════════════════════════════════════════════════════════ */

/**
 * Deck structure:
 * {
 *   name:  string   — display name
 *   color: string   — CSS color class ('capitals'|'math'|'science'|'custom')
 *   cards: Card[]
 * }
 *
 * Card structure:
 * {
 *   q:        string  — question
 *   a:        string  — answer
 *   ease:     number  — SRS ease factor (default 2.5)
 *   interval: number  — current interval in days (default 1)
 *   due:      number  — timestamp in ms when the card becomes due (0 = immediately)
 *   reps:     number  — total number of repetitions (0 = never studied)
 * }
 */
let DECKS = {};

/* ── Study session variables ── */
let curDeckKey  = null;  // key of the deck currently being studied
let studyQueue  = [];    // shuffled array of cards for this session
let studyIdx    = 0;     // index of the current card in studyQueue
let stOk        = 0;     // correct-answer counter
let stKo        = 0;     // wrong-answer counter
let isFlipped   = false; // true if the card is showing its back face

/* ── Timer ── */
let timerInterval = null; // setInterval reference
let timerLeft     = 15;   // seconds remaining
const TIMER_MAX   = 15;   // total timer duration in seconds

/* ── Editor ── */
let newCards = []; // temporary cards in the editor (not yet saved)

/* ── i18n ── */
let currentLang = 'en';   // active language code ('en' | 'it')
let translations = {};    // loaded key → string map for the active language
const SUPPORTED_LANGS = ['en', 'it'];


/* ══════════════════════════════════════════════════════════
   2. INITIAL DATA
══════════════════════════════════════════════════════════ */

/**
 * Creates a card with default SRS values.
 * @param {string} q - Question
 * @param {string} a - Answer
 * @returns {Card}
 */
function makeCard(q, a) {
  return { q, a, ease: 2.5, interval: 1, due: 0, reps: 0 };
}

/**
 * IDs and colors of the decks bundled by default with the app.
 * Their display name and card text are NOT hardcoded here — they live in the
 * active i18n file (deckCapitals/cardsCapitals, etc.) so they can be
 * re-localized on the fly when the user switches language, without losing
 * any SRS progress already made on those cards.
 * See buildDefaultDecks() and relocalizeDefaultDecks() below.
 */
const DEFAULT_DECK_IDS = {
  capitals: { color: 'capitals', nameKey: 'deckCapitals', cardsKey: 'cardsCapitals' },
  math:     { color: 'math',     nameKey: 'deckMath',     cardsKey: 'cardsMath' },
  science:  { color: 'science',  nameKey: 'deckScience',  cardsKey: 'cardsScience' },
};

/**
 * Builds a fresh DECKS object for the default decks using the strings
 * currently loaded in `translations`. Used only on first run (when
 * localStorage is empty), so every card starts with default SRS values.
 * @returns {object} deck key → deck object
 */
function buildDefaultDecks() {
  const decks = {};
  Object.entries(DEFAULT_DECK_IDS).forEach(([key, meta]) => {
    const pairs = translations[meta.cardsKey] || [];
    decks[key] = {
      name: translations[meta.nameKey] || key,
      color: meta.color,
      cards: pairs.map(([q, a]) => makeCard(q, a)),
    };
  });
  return decks;
}

/**
 * Re-localizes the text (deck name + card question/answer) of the bundled
 * default decks after a language switch, WITHOUT resetting their SRS
 * progress (ease/interval/due/reps stay untouched). Custom user-created
 * decks are left completely alone, since their content is free text typed
 * by the user and must not be overwritten.
 *
 * Matching between old and new card text is positional: card N in the
 * stored deck corresponds to card N in the translation array. This works
 * because default decks are never reordered or partially edited by the
 * user — only studied.
 */
function relocalizeDefaultDecks() {
  Object.entries(DEFAULT_DECK_IDS).forEach(([key, meta]) => {
    const deck = DECKS[key];
    if (!deck) return; // user may have removed it in a future version

    const pairs = translations[meta.cardsKey] || [];
    deck.name = translations[meta.nameKey] || deck.name;

    deck.cards.forEach((card, i) => {
      if (pairs[i]) {
        card.q = pairs[i][0];
        card.a = pairs[i][1];
      }
    });
  });
}


/* ══════════════════════════════════════════════════════════
   3. PERSISTENCE (localStorage)
══════════════════════════════════════════════════════════ */

const STORAGE_KEY_DECKS = 'flashcards_decks_v1';
const STORAGE_KEY_LANG  = 'flashcards_lang_v1';

/**
 * Saves the current DECKS state to localStorage.
 * Called after every modification (rating, new deck, etc.).
 */
function saveToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY_DECKS, JSON.stringify(DECKS));
  } catch (e) {
    // localStorage can fail in private browsing or when storage is full
    console.warn('Could not save to localStorage:', e);
  }
}

/**
 * Loads DECKS from localStorage.
 * Falls back to freshly built default decks (using the currently loaded
 * translations) if nothing is stored yet. Must be called AFTER translations
 * have been loaded, since buildDefaultDecks() reads from `translations`.
 */
function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DECKS);
    if (raw) {
      DECKS = JSON.parse(raw);
      return;
    }
  } catch (e) {
    console.warn('Error reading localStorage:', e);
  }
  // First run: build default decks in the currently active language
  DECKS = buildDefaultDecks();
}


/* ══════════════════════════════════════════════════════════
   4. SRS ALGORITHM (Spaced Repetition System)
      Based on SM-2 (SuperMemo 2), the same algorithm used by Anki
══════════════════════════════════════════════════════════ */

/**
 * Updates a card's SRS metadata based on answer quality.
 *
 * @param {Card} card      - The card to update
 * @param {number} quality - Answer quality: 0 = wrong, 2 = correct
 *
 * Simplified SM-2 logic:
 *  - Wrong answer (q=0)        → interval = 1 day (card comes back immediately)
 *  - First repetition (reps=0) → interval = 1
 *  - Second repetition (reps=1)→ interval = 6
 *  - Subsequent repetitions    → interval = interval * ease
 *
 * The "ease" factor increases with correct answers and decreases with wrong
 * ones, but never drops below 1.3 to avoid overly tight review loops.
 */
function srsUpdate(card, quality) {
  if (quality < 2) {
    /* Wrong answer: reset the interval */
    card.interval = 1;
  } else {
    /* Correct answer: compute the next interval */
    if (card.reps === 0)      card.interval = 1;
    else if (card.reps === 1) card.interval = 6;
    else                      card.interval = Math.round(card.interval * card.ease);

    /* Update the ease factor:
       +0.1 for a correct answer, penalty proportional to the miss */
    card.ease = Math.max(1.3, card.ease + 0.1 - (2 - quality) * 0.08);
  }

  card.reps++;

  /* Compute the next due timestamp in ms */
  card.due = Date.now() + card.interval * 86_400_000; // 86400000 ms = 1 day
}

/**
 * Counts the cards in a deck whose due date has passed (review due today).
 * @param {object} deck
 * @returns {number}
 */
function getDue(deck) {
  const now = Date.now();
  return deck.cards.filter(c => c.due <= now).length;
}

/**
 * Counts the cards in a deck that have never been studied (reps === 0).
 * @param {object} deck
 * @returns {number}
 */
function getNew(deck) {
  return deck.cards.filter(c => c.reps === 0).length;
}


/* ══════════════════════════════════════════════════════════
   5. INTERNATIONALIZATION (i18n)
══════════════════════════════════════════════════════════ */

/*
  Hybrid language strategy (most common pattern for small apps):
  1. On first visit, detect the browser language via navigator.language
     and use it as the default (falls back to English if unsupported).
  2. The user can override this at any time via the EN/IT toggle in the header.
  3. The manual choice is persisted in localStorage so it's remembered
     on every subsequent visit, taking priority over navigator.language.
*/

/**
 * Detects the language to use on first load.
 * Priority: saved preference > browser language > English fallback.
 * @returns {string} 'en' | 'it'
 */
function detectInitialLanguage() {
  /* 1. A manually saved preference always wins */
  try {
    const saved = localStorage.getItem(STORAGE_KEY_LANG);
    if (saved && SUPPORTED_LANGS.includes(saved)) return saved;
  } catch (e) {
    console.warn('Could not read language preference:', e);
  }

  /* 2. Fall back to the browser/system language */
  const browserLang = (navigator.language || 'en').slice(0, 2).toLowerCase();
  if (SUPPORTED_LANGS.includes(browserLang)) return browserLang;

  /* 3. Default to English */
  return 'en';
}

/**
 * Fetches the translation JSON file for a given language code.
 * @param {string} lang - 'en' | 'it'
 * @returns {Promise<object>} key → string map
 */
async function loadTranslations(lang) {
  const response = await fetch(`i18n/${lang}.json`);
  if (!response.ok) throw new Error(`Failed to load translations for "${lang}"`);
  return response.json();
}

/**
 * Applies the currently loaded translations to every element marked with
 * data-i18n (text content) or data-i18n-placeholder (input placeholder).
 */
function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (translations[key]) el.textContent = translations[key];
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (translations[key]) el.placeholder = translations[key];
  });

  /* Update the <html lang="..."> attribute for accessibility/SEO */
  document.documentElement.lang = currentLang;

  /* Update the toggle buttons' pressed state */
  document.querySelectorAll('.lang-btn').forEach(btn => {
    const isActive = btn.id === `lang-${currentLang}`;
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

/**
 * Switches the active language: loads the translation file, applies it,
 * persists the choice, and re-renders dynamic content (decks, cards, etc.)
 * so freshly generated strings use the new language too.
 *
 * @param {string} lang - 'en' | 'it'
 */
async function setLanguage(lang) {
  if (!SUPPORTED_LANGS.includes(lang)) return;

  try {
    translations = await loadTranslations(lang);
    currentLang = lang;

    try {
      localStorage.setItem(STORAGE_KEY_LANG, lang);
    } catch (e) {
      console.warn('Could not persist language preference:', e);
    }

    applyTranslations();

    /* Re-localize the text of the bundled default decks (name + cards),
       preserving their SRS progress. Custom user decks are untouched.
       Since studyQueue holds references to the same card objects as
       DECKS (not deep copies), this also updates any card already
       loaded into the current study session. */
    relocalizeDefaultDecks();
    saveToStorage();

    /* Re-render any dynamically generated UI so it picks up new strings */
    renderDecks();

    if (document.getElementById('view-editor').classList.contains('active')) {
      renderCardList();
    }

    /* If a study session is currently on screen, the question/answer
       text and the deck title were already painted with the old
       language — refresh them in place without restarting the session
       or losing the current position/score. */
    if (document.getElementById('view-study').classList.contains('active')) {
      refreshStudyViewText();
    }
  } catch (e) {
    console.error('Language switch failed:', e);
  }
}


/* ══════════════════════════════════════════════════════════
   6. UI RENDERING
══════════════════════════════════════════════════════════ */

/**
 * Map: deck color → Tabler icon class
 */
const DECK_ICONS = {
  capitals: 'ti-world',
  math:     'ti-calculator',
  science:  'ti-atom',
  custom:   'ti-star',
};

/**
 * Map: deck color → text color for the icon
 */
const DECK_TEXT_COLORS = {
  capitals: '#0C447C',
  math:     '#3C3489',
  science:  '#085041',
  custom:   '#633806',
};

/**
 * Renders the deck grid and updates the global SRS badges in the header.
 * Called on init and after every modification to the decks.
 */
function renderDecks() {
  const grid = document.getElementById('deck-grid');
  grid.innerHTML = '';

  Object.entries(DECKS).forEach(([key, deck]) => {
    const col     = deck.color || 'custom';
    const iconCls = DECK_ICONS[col] || 'ti-stack-2';
    const due     = getDue(deck);
    const newC    = getNew(deck);

    /* Build the deck card's SRS badges */
    let badgesHTML = '';
    if (newC > 0) {
      badgesHTML += `<span class="srs-badge srs-new">
        <i class="ti ti-sparkles" style="font-size:10px;" aria-hidden="true"></i>
        ${newC} ${translations.badgeNew || 'new'}
      </span>`;
    }
    if (due > 0) {
      badgesHTML += `<span class="srs-badge srs-due">
        <i class="ti ti-clock" style="font-size:10px;" aria-hidden="true"></i>
        ${due} ${translations.badgeDue || 'due'}
      </span>`;
    }
    if (newC === 0 && due === 0) {
      badgesHTML += `<span class="srs-badge srs-ok">
        <i class="ti ti-check" style="font-size:10px;" aria-hidden="true"></i>
        ${translations.badgeAllDone || 'all caught up'}
      </span>`;
    }

    /* Create the deck card node */
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="deck-card ${col}"
           onclick="startStudy('${key}')"
           role="button"
           tabindex="0"
           aria-label="Study the ${escapeHTML(deck.name)} deck"
           onkeydown="if(event.key==='Enter')startStudy('${key}')">
        <i class="ti ${iconCls} deck-icon" style="color:${DECK_TEXT_COLORS[col]}" aria-hidden="true"></i>
        <div class="deck-name ${col}">${escapeHTML(deck.name)}</div>
        <div class="deck-count ${col}">${deck.cards.length} ${translations.cardsCount || 'cards'}</div>
        <div class="deck-badges">${badgesHTML}</div>
      </div>`;

    grid.appendChild(wrap);
  });

  renderSRSBadges();
}

/**
 * Updates the global SRS badges in the header (total new + due counts).
 */
function renderSRSBadges() {
  const container = document.getElementById('srs-badges');
  const totalDue  = Object.values(DECKS).reduce((s, d) => s + getDue(d), 0);
  const totalNew  = Object.values(DECKS).reduce((s, d) => s + getNew(d), 0);

  let html = '';
  if (totalNew > 0) {
    html += `<span class="pill pill-purple">
      <i class="ti ti-sparkles" aria-hidden="true"></i> ${totalNew} ${translations.globalNew || 'new'}
    </span>`;
  }
  if (totalDue > 0) {
    html += `<span class="pill pill-amber">
      <i class="ti ti-clock" aria-hidden="true"></i> ${totalDue} ${translations.globalDue || 'due'}
    </span>`;
  }

  container.innerHTML = html;
}


/* ══════════════════════════════════════════════════════════
   7. VIEW NAVIGATION
══════════════════════════════════════════════════════════ */

/**
 * Shows the view matching the clicked tab.
 * Hides all other views and updates aria-selected on the tabs.
 *
 * @param {string} tabName - 'decks' | 'editor'
 * @param {HTMLElement} tabEl - The clicked tab button
 */
function showTab(tabName, tabEl) {
  /* Update visual state of the tabs */
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.remove('active');
    t.setAttribute('aria-selected', 'false');
  });
  tabEl.classList.add('active');
  tabEl.setAttribute('aria-selected', 'true');

  /* Hide all views */
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

  if (tabName === 'decks') {
    document.getElementById('view-decks').classList.add('active');
    renderDecks();
  } else if (tabName === 'editor') {
    document.getElementById('view-editor').classList.add('active');
    /* Reset editor */
    newCards = [];
    renderCardList();
  }
}

/**
 * Returns to the deck grid from any view.
 * Stops the timer if running and resets the tabs.
 */
function goBack() {
  stopTimer();

  /* Hide all views, show decks */
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-decks').classList.add('active');

  /* Reset tab bar to the first tab */
  document.querySelectorAll('.tab').forEach((t, i) => {
    t.classList.toggle('active', i === 0);
    t.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
  });

  renderDecks();
}


/* ══════════════════════════════════════════════════════════
   8. STUDY SESSION
══════════════════════════════════════════════════════════ */

/**
 * Starts a study session for the given deck.
 * Shuffles the cards and shows the first one.
 *
 * @param {string} key - Deck key in DECKS
 */
function startStudy(key) {
  curDeckKey = key;
  const deck = DECKS[key];

  /* Copy and shuffle the cards */
  studyQueue = [...deck.cards];
  shuffle(studyQueue);

  /* Reset counters */
  studyIdx = 0;
  stOk     = 0;
  stKo     = 0;

  /* Update session header */
  document.getElementById('study-title').textContent = deck.name;
  document.getElementById('st-ok').textContent = '0';
  document.getElementById('st-ko').textContent = '0';

  /* Switch to the study view */
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-study').classList.add('active');

  showCard();
}

/**
 * Refreshes the text currently painted on screen during an active study
 * session (deck title, question, answer) after a language switch, WITHOUT
 * resetting the timer, the flip state, the queue order, or the score.
 *
 * Called by setLanguage() when the user changes language while mid-session.
 * Card objects in studyQueue are the same references as in DECKS, so
 * relocalizeDefaultDecks() already updated card.q / card.a in place —
 * this function just re-paints the DOM to match.
 */
function refreshStudyViewText() {
  if (studyIdx >= studyQueue.length) return; // session already on the summary screen

  const card = studyQueue[studyIdx];

  document.getElementById('fc-q').textContent = card.q;
  document.getElementById('fc-a').textContent = card.a;
  document.getElementById('study-title').textContent = DECKS[curDeckKey].name;
}

/**
 * Shows the current card (studyQueue[studyIdx]).
 * If the index exceeds the queue length, shows the summary instead.
 */
function showCard() {
  if (studyIdx >= studyQueue.length) {
    showSummary();
    return;
  }

  const card = studyQueue[studyIdx];

  /* Update card text */
  document.getElementById('fc-q').textContent = card.q;
  document.getElementById('fc-a').textContent = card.a;

  /* Update counter and progress bar */
  document.getElementById('nav-counter').textContent =
    `${studyIdx + 1} / ${studyQueue.length}`;

  const pct = Math.round((studyIdx / studyQueue.length) * 100);
  const progEl = document.getElementById('prog');
  progEl.style.width = pct + '%';
  progEl.parentElement.setAttribute('aria-valuenow', pct);

  /* Reset flip: back to the front face */
  const wrap = document.getElementById('fc-wrap');
  wrap.classList.remove('flipped');
  isFlipped = false;

  /* Show "Flip", hide rating buttons */
  document.getElementById('act-flip').style.display = '';
  document.getElementById('act-rate').style.display = 'none';

  startTimer();
}

/**
 * Flips the card (front ↔ back).
 * Toggles the .flipped class that drives the CSS 3D rotation.
 * After flipping, shows the rating buttons and stops the timer.
 */
function flipCard() {
  isFlipped = !isFlipped;
  document.getElementById('fc-wrap').classList.toggle('flipped', isFlipped);

  if (isFlipped) {
    /* Back face visible: show rating, hide "Flip" */
    document.getElementById('act-flip').style.display = 'none';
    document.getElementById('act-rate').style.display = '';
    stopTimer();
  } else {
    /* Front face visible: hide rating, show "Flip" */
    document.getElementById('act-flip').style.display = '';
    document.getElementById('act-rate').style.display = 'none';
  }
}

/**
 * Records the user's rating and advances to the next card.
 * Updates counters, SRS metadata, and saves to localStorage.
 *
 * @param {number} quality - 0 = wrong, 2 = correct
 */
function rate(quality) {
  const card = studyQueue[studyIdx];

  /* Update session counters */
  if (quality >= 2) {
    stOk++;
    document.getElementById('st-ok').textContent = stOk;
  } else {
    stKo++;
    document.getElementById('st-ko').textContent = stKo;
  }

  /* Update the card's SRS metadata in the original deck */
  srsUpdate(card, quality);

  /* Persist the changes */
  saveToStorage();

  /* Move to the next card after a short delay for visual feedback */
  studyIdx++;
  setTimeout(showCard, 180);
}

/* ── Manual navigation ── */

/** Goes to the previous card without recording a rating */
function navPrev() {
  if (studyIdx > 0) {
    studyIdx--;
    showCard();
  }
}

/** Goes to the next card without recording a rating */
function navNext() {
  if (studyIdx < studyQueue.length - 1) {
    studyIdx++;
    showCard();
  }
}


/* ══════════════════════════════════════════════════════════
   9. TIMER
══════════════════════════════════════════════════════════ */

/**
 * Starts the countdown from TIMER_MAX seconds.
 * Updates the display and bar every second.
 * When it reaches zero, the card flips automatically.
 */
function startTimer() {
  stopTimer(); // safety: clear any previous timer
  timerLeft = TIMER_MAX;

  document.getElementById('timer-disp').textContent = timerLeft;
  document.getElementById('timer-bar').style.width = '100%';

  timerInterval = setInterval(() => {
    timerLeft--;

    /* Update numeric display */
    document.getElementById('timer-disp').textContent = timerLeft;

    /* Update proportional bar */
    const pct = Math.round((timerLeft / TIMER_MAX) * 100);
    document.getElementById('timer-bar').style.width = pct + '%';

    /* Auto-flip when time runs out */
    if (timerLeft <= 0) {
      stopTimer();
      if (!isFlipped) flipCard();
    }
  }, 1000);
}

/**
 * Stops the current timer (if running).
 */
function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}


/* ══════════════════════════════════════════════════════════
  10. SESSION SUMMARY
══════════════════════════════════════════════════════════ */

/**
 * Shows the summary view with the session results.
 * Stops the timer, updates scores and the success percentage.
 */
function showSummary() {
  stopTimer();

  /* Compute success percentage */
  const total = studyQueue.length;
  const pct   = total > 0 ? Math.round((stOk / total) * 100) : 0;

  /* Populate the summary */
  document.getElementById('sum-ok').textContent  = stOk;
  document.getElementById('sum-ko').textContent  = stKo;
  document.getElementById('sum-pct').textContent =
    `${pct}% ${translations.percentCorrect || 'correct answers'}`;
  document.getElementById('sum-sub').textContent =
    `${DECKS[curDeckKey].name} · ${total} ${translations.cardsCount || 'cards'}`;

  /* Bring the progress bar to 100% */
  const progEl = document.getElementById('prog');
  progEl.style.width = '100%';
  progEl.parentElement.setAttribute('aria-valuenow', 100);

  /* Show the summary view */
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-summary').classList.add('active');

  /* Refresh the grid (SRS badges update) */
  renderDecks();
}

/**
 * Restarts the session with the same deck, reshuffling the cards.
 */
function restartStudy() {
  document.getElementById('view-summary').classList.remove('active');
  startStudy(curDeckKey);
}


/* ══════════════════════════════════════════════════════════
  11. DECK EDITOR
══════════════════════════════════════════════════════════ */

/**
 * Adds a card to the editor's temporary list.
 * Reads the question/answer input values and resets the fields.
 */
function addCard() {
  const q = document.getElementById('inp-q').value.trim();
  const a = document.getElementById('inp-a').value.trim();

  if (!q || !a) {
    /* Focus whichever field is empty */
    if (!q) document.getElementById('inp-q').focus();
    else    document.getElementById('inp-a').focus();
    return;
  }

  newCards.push(makeCard(q, a));

  /* Reset inputs and refocus the question field */
  document.getElementById('inp-q').value = '';
  document.getElementById('inp-a').value = '';
  document.getElementById('inp-q').focus();

  renderCardList();
}

/**
 * Removes a card from the temporary list by index.
 * @param {number} index
 */
function delCard(index) {
  newCards.splice(index, 1);
  renderCardList();
}

/**
 * Renders the list of cards added in the editor.
 * Shows a placeholder message when the list is empty.
 */
function renderCardList() {
  const listEl = document.getElementById('card-list');

  if (newCards.length === 0) {
    listEl.innerHTML = `<div style="text-align:center;color:var(--text-hint);font-size:13px;padding:1rem 0;">
      ${translations.noCardsYet || 'No cards added yet'}
    </div>`;
    return;
  }

  listEl.innerHTML = newCards
    .map((card, i) => `
      <div class="card-item">
        <div class="card-item-texts">
          <div class="card-item-q">${escapeHTML(card.q)}</div>
          <div class="card-item-a">${escapeHTML(card.a)}</div>
        </div>
        <button class="del-btn" onclick="delCard(${i})" aria-label="Delete card">
          <i class="ti ti-trash" aria-hidden="true"></i>
        </button>
      </div>`)
    .join('');
}

/**
 * Saves the new deck into DECKS and persists it to localStorage.
 * Validates that a name and at least one card are present.
 */
function saveDeck() {
  const name = document.getElementById('deck-name-inp').value.trim();

  if (!name) {
    alert(translations.alertDeckName || 'Please enter a name for the deck!');
    document.getElementById('deck-name-inp').focus();
    return;
  }
  if (newCards.length === 0) {
    alert(translations.alertNoCards || 'Add at least one card before saving!');
    return;
  }

  /* Generate a unique key based on the timestamp */
  const key = 'custom_' + Date.now();

  DECKS[key] = {
    name,
    color: 'custom',
    cards: [...newCards],
  };

  /* Save and reset the editor */
  saveToStorage();
  newCards = [];
  document.getElementById('deck-name-inp').value = '';
  renderCardList();

  /* Return to the deck grid */
  const firstTab = document.querySelector('.tab');
  showTab('decks', firstTab);
}


/* ══════════════════════════════════════════════════════════
  12. UTILITIES
══════════════════════════════════════════════════════════ */

/**
 * Shuffles an array in-place using the Fisher-Yates algorithm.
 * @param {Array} arr
 */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * Escapes HTML special characters to prevent XSS in the editor.
 * @param {string} str
 * @returns {string}
 */
function escapeHTML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}


/* ══════════════════════════════════════════════════════════
  13. INITIALIZATION
══════════════════════════════════════════════════════════ */

/**
 * App bootstrap:
 *  1. Detects and loads the initial language (saved pref > browser > English)
 *  2. Loads deck data from localStorage (or falls back to defaults)
 *  3. Registers Enter-key listeners for the editor inputs
 *  4. Hides the loading screen
 *  5. Renders the deck grid
 */
async function init() {
  /* 1. Language: detect and load translations before rendering anything,
        so the very first paint already shows the correct language */
  currentLang = detectInitialLanguage();
  try {
    translations = await loadTranslations(currentLang);
  } catch (e) {
    console.error('Failed to load translations, falling back to English:', e);
    currentLang = 'en';
    translations = await loadTranslations('en').catch(() => ({}));
  }
  applyTranslations();

  /* 2. Deck data */
  loadFromStorage();

  /* 3. Enter-key shortcuts in the editor */
  document.getElementById('inp-q').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('inp-a').focus();
  });
  document.getElementById('inp-a').addEventListener('keydown', e => {
    if (e.key === 'Enter') addCard();
  });

  /* 4. Hide loading screen */
  const loadingEl = document.getElementById('loading-screen');
  if (loadingEl) loadingEl.classList.add('hidden');

  /* 5. Initial render */
  renderDecks();
}

/* Start once the DOM is ready */
document.addEventListener('DOMContentLoaded', init);
