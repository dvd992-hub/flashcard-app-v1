# Flashcards App

A web app for studying with flashcards, featuring spaced repetition (SRS), a timer, a deck editor, bilingual support (EN/IT), and dark mode. Runs fully offline, with no server-side dependencies.

---

## Project structure

```
flashcards-app/
├── index.html              → HTML structure, views and layout
├── css/
│   └── style.css           → Styling, color palette, responsive rules
├── js/
│   └── script.js           → Logic, SRS, i18n, localStorage persistence
├── i18n/
│   ├── en.json              → English strings
│   └── it.json              → Italian strings
├── assets/
│   └── favicon/
│       ├── favicon.svg      → Vector favicon (modern browsers)
│       └── favicon.ico      → Multi-size ICO favicon (fallback)
└── README.md                → This guide
```

---

## How to open the app

No server is strictly required for most browsers, but since the app loads translation files via `fetch()`, opening `index.html` directly as a `file://` URL will block those requests in some browsers (CORS restriction on local files). A local server avoids this entirely:

```bash
# Option 1: local server (recommended)
python3 -m http.server 8080
# then visit http://localhost:8080

# Option 2: double-click index.html
# Works in most browsers, but i18n may fail to load over file://
```

If you use the VS Code "Live Server" extension, simply right-click `index.html` → "Open with Live Server".

---

## Features

### Default decks
- **Capitals** — world capitals
- **Math** — formulas and concepts
- **Science** — chemistry, physics, biology

### Study session
- Cards are shuffled randomly every session
- **15-second timer** per card: the card flips automatically when time runs out
- Animated 3D flip (CSS `rotateY`)
- Two rating buttons: **Knew it** / **Didn't know**
- Real-time progress bar and counters
- Manual previous/next navigation

### Spaced repetition (SRS)
The algorithm is inspired by **SM-2** (the same one used by Anki):

| Answer       | Effect                                                  |
|--------------|-----------------------------------------------------------|
| Knew it      | Interval increases (×ease), ease factor rises slightly    |
| Didn't know  | Interval resets to 1 day, ease factor drops                |

Each card tracks:
- `interval` — days until the next repetition
- `ease` — multiplier factor (min 1.3, default 2.5)
- `due` — due timestamp (ms)
- `reps` — total number of repetitions

Badges on the deck grid show how many cards are new or due today.

### Create deck (editor)
1. Go to the **Create deck** tab
2. Enter the deck name
3. Add question/answer pairs (press Enter to confirm)
4. Click **Save deck**

The deck appears immediately in the grid and is fully usable in future sessions.

### Language (EN/IT)
The app uses a **hybrid language strategy**:

1. On first visit, the browser's language (`navigator.language`) is used to pick the default — English or Italian, defaulting to English if neither matches.
2. The **EN / IT toggle** in the header lets the user switch manually at any time.
3. The manual choice is saved to **localStorage** and takes priority on every future visit, overriding the browser default.

Translation strings live in `i18n/en.json` and `i18n/it.json` as flat key-value JSON files, loaded via `fetch()` and applied to any element marked with `data-i18n` (text content) or `data-i18n-placeholder` (input placeholder).

**Default deck content is translated too.** The name and every question/answer pair of the three bundled decks (Capitals, Math, Science) live inside the i18n files themselves (`deckCapitals`/`cardsCapitals`, etc.), not hardcoded in `script.js`. Switching language re-localizes their text on the fly via `relocalizeDefaultDecks()`, while preserving each card's SRS progress (ease, interval, due date, repetitions) — nothing is reset. Custom decks created by the user are never touched by a language switch, since their content is free text the user typed and must stay exactly as written.

**Switching language mid-session works too.** If the user changes language while a card is already on screen during a study session, `refreshStudyViewText()` repaints the visible question, answer, and deck title in place — without restarting the timer, losing the flip state, reshuffling the queue, or resetting the score.

### Persistence
All data (decks, SRS progress, language preference) is automatically saved to the browser's **localStorage**. Data survives browser restarts but is tied to the specific device and browser used.

---

## Customization

### Changing the timer duration
In `js/script.js`, edit the constant:
```js
const TIMER_MAX = 15; // seconds
```

### Adding a default deck
Default deck content lives in the i18n files, not in `script.js`. To add a new bundled deck (e.g. "History"):

1. In **both** `i18n/en.json` and `i18n/it.json`, add a name key and a cards array:
```json
"deckHistory": "History",
"cardsHistory": [
  ["Question 1?", "Answer 1"],
  ["Question 2?", "Answer 2"]
]
```
2. In `js/script.js`, register the new deck in `DEFAULT_DECK_IDS`:
```js
history: { color: 'custom', nameKey: 'deckHistory', cardsKey: 'cardsHistory' },
```

> **Note:** Defaults are only built on first run (when localStorage is empty). Existing installs won't see the new deck until storage is cleared — see "Resetting saved data" below.

### Available deck colors
| Value       | Color      | Suggested use         |
|-------------|------------|------------------------|
| `capitals`  | Blue       | Geography               |
| `math`      | Purple     | Math/logic               |
| `science`   | Green/Teal | Sciences                  |
| `custom`    | Amber      | User-created decks         |

To add a new color scheme, add the matching CSS classes in `css/style.css` following the `.deck-card.schemeName { ... }` pattern.

### Adding a new language
1. Create `i18n/xx.json` (copy `en.json` as a template and translate every value, including `deckCapitals`/`cardsCapitals`, `deckMath`/`cardsMath`, `deckScience`/`cardsScience`).
2. Add `'xx'` to the `SUPPORTED_LANGS` array in `js/script.js`.
3. Add a corresponding toggle button in `index.html` (`<button class="lang-btn" id="lang-xx" onclick="setLanguage('xx')">XX</button>`).

### Resetting saved data
To clear all data and return to the defaults, from the browser console:
```js
localStorage.removeItem('flashcards_decks_v1');
localStorage.removeItem('flashcards_lang_v1');
location.reload();
```

---

## Compatibility

| Browser       | Minimum version |
|---------------|-------------------|
| Chrome/Edge   | 88+               |
| Firefox       | 78+               |
| Safari        | 14+               |
| Mobile Safari | iOS 14+           |

Features used: CSS `transform-style: preserve-3d`, `backface-visibility`, CSS Custom Properties, `fetch()`, `localStorage`, `setInterval`.

---

## Code structure

### `index.html`
Four `<section class="view">` blocks managed via JS:
- `view-decks` — deck grid
- `view-study` — study session
- `view-summary` — session summary
- `view-editor` — deck editor

Translatable elements are marked with `data-i18n` / `data-i18n-placeholder` attributes.

### `css/style.css`
Organized into 11 numbered sections with comments. Uses CSS variables (`:root`) for colors, borders, and typography. Dark mode is automatic via `@media (prefers-color-scheme: dark)`.

### `js/script.js`
Organized into 13 numbered sections, every function documented with JSDoc:

```
1. Global state           → shared variables (DECKS, timer, etc.)
2. Initial data            → DEFAULT_DECK_IDS, buildDefaultDecks(), relocalizeDefaultDecks()
3. Persistence               → saveToStorage() / loadFromStorage()
4. SRS algorithm              → srsUpdate(), getDue(), getNew()
5. Internationalization         → detectInitialLanguage(), loadTranslations(), setLanguage()
6. UI rendering                  → renderDecks(), renderSRSBadges()
7. View navigation                → showTab(), goBack()
8. Study session                   → startStudy(), showCard(), flipCard(), rate(), refreshStudyViewText()
9. Timer                            → startTimer(), stopTimer()
10. Session summary                  → showSummary(), restartStudy()
11. Deck editor                       → addCard(), delCard(), saveDeck()
12. Utilities                          → shuffle(), escapeHTML()
13. Initialization                      → init() + DOMContentLoaded
```

### `i18n/*.json`
Flat key-value JSON files. Every UI string lives here — no hardcoded text in `index.html` or `script.js` beyond fallback defaults.

### `assets/favicon/`
- `favicon.svg` — scalable vector version, used by modern browsers
- `favicon.ico` — multi-size (16/32/48/64/128/256 px) ICO fallback for older browsers and OS-level bookmarks

---

## License

Free project, modifiable and distributable without restrictions.
