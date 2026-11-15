# Fridge to Fork

Type (or **photograph**) what's in your fridge and get back a recipe you can **use**, not just read: check off steps as you cook, scale servings, swap ingredients you don't have, and tweak the recipe with follow-up requests ("make it vegetarian") without starting over.

The AI (Google Gemini) returns **structured JSON**. The app validates it, salvages what it can, and renders it as interactive React components. It's not a chatbot.

> 🌐 Live: _add Render URL here_ · 📹 Demo video: _add link here_

---

## Setup

Requires Node 18+ (developed on Node 22).

```bash
npm install
cp .env.example .env        # then paste your key into GEMINI_API_KEY
npm start                   # API on :8787 + Vite on :5173 → open http://localhost:5173
```

Get a free Gemini key at <https://aistudio.google.com/apikey>.

**No key?** Run `MOCK_LLM=1 npm start` (PowerShell: `$env:MOCK_LLM=1; npm start`) to get a canned recipe. Every UI path still works.

| Command         | What it does                                                       |
| --------------- | ------------------------------------------------------------------ |
| `npm start`     | API server + Vite dev server (with the dev "Simulate failure" panel) |
| `npm test`      | Unit + integration tests (Vitest, jsdom)                           |
| `npm run build` | Production build into `dist/`                                       |
| `npm run serve` | Serve `dist/` + API from one Express process on :8787 (fault injection off) |

Optional env vars: `GEMINI_MODEL` (default `gemini-flash-latest`), `GEMINI_FALLBACK_MODELS` (default `gemini-flash-lite-latest`), `GEMINI_ATTEMPT_TIMEOUT_MS` (25000), `GEMINI_TIMEOUT_MS` (50000), `PORT`. See `.env.example`.

## Usage

1. List ingredients in any format, then pick servings and dietary needs. Or click an example.
   - **📷 Scan a photo of your fridge**: the AI lists what it can see. You untick anything wrong (low-confidence guesses start unticked), then **Add to my list**. Nothing goes into your list without your confirmation.
2. **Get a recipe** (or <kbd>Ctrl</kbd>+<kbd>Enter</kbd>). While it loads you'll see an elapsed timer. **Cancel** or <kbd>Esc</kbd> aborts the request.
3. In the recipe you can:
   - **−/+ servings**: every quantity rescales (`1 ½ cup`, `440 g`).
   - **Swap…**: pick a substitute from the dropdown. Then **Rewrite the recipe for my swaps** sends a refinement so the method matches.
   - **Check off** ingredients as you gather them and steps as you cook. The current step is highlighted.
   - **Tweak it**: type a change or tap a suggestion. **Undo change** goes back a version.
4. **Saved**: every recipe and your progress autosave in the browser. Reopen or delete them from the drawer.

---

## Architecture

```
browser ──POST /api/recipe──▶ Express (server/) ──▶ Gemini generateContent
        ──POST /api/scan────▶   (photo, base64)
   ▲                             holds API key,         (JSON mode + responseSchema)
   │                             validates input,
   │  { text, finishReason }     timeout + abort
   │  or { error: {code,…} }
   └── src/lib/parseRecipe.js / parseScan.js: extract → validate → normalize → data | refusal | typed error
```

**Server (`server/`)**: a thin proxy whose main job is keeping the key out of the browser.
- `index.js`: both AI routes share one `aiRoute()` handler. It validates the request body (length limits, servings 1–12, diet whitelist; for photos: JPEG/PNG/WebP only, valid base64, size cap) and enforces a 45s timeout. It **aborts the Gemini call if the browser disconnects**. Every failure returns a JSON `{ error: { code, message, retryable } }` (never an HTML stack trace).
- `fallback.js`: **model fallback chain.** If the main model is overloaded (503 "high demand"), rate-limited, erroring, or slower than 25s, the same request is retried on `gemini-flash-lite-latest`. That model has separate capacity and its own free-tier quota, all within one 50s budget. Content problems (safety blocks, bad input) don't trigger a fallback, because another model wouldn't fix them.
- `rateLimit.js`: per-IP limit (40 model calls / 10 min by default in production), so a public deploy can't drain the API key's quota.
- `gemini.js`: one generic `callGemini()` doing a single `fetch` to the Gemini REST API, with no SDK, so each failure is visible. Text and image parts go in the same request. It asks for no "thinking" (`thinkingBudget: 0`), which cuts latency a lot for this task. If a model refuses that setting, it retries without it and remembers that for the model. It maps HTTP 429/4xx/5xx, safety blocks (`promptFeedback.blockReason`, `finishReason: SAFETY`), and the API envelope to typed errors. It returns the raw model text plus `finishReason`.
- `prompt.js`: system instructions plus `responseSchema`s for recipes and photo scans. User text is wrapped in `<user_ingredients>` tags and treated as data. The scan prompt also says to ignore any instructions written *in the photo* (e.g. on a label or note).
- `faults.js`: dev-only fault injection (see below).

**Client (`src/`)**
- `lib/parseRecipe.js`: **the core of "turning unpredictable output into reliable UI."** See the next section.
- `hooks/useAiRequest.js`: generic request lifecycle: loading, error, refused, auto-retry, cancel, and **stale-response protection**. `useRecipeGenerator` and `useIngredientScan` are thin wrappers that plug in their own `send` + `parse` functions.
- `lib/image.js`: validates the chosen photo, then downscales it to ≤1280px and re-encodes it as JPEG in the browser (a ~4 MB phone photo becomes ~200 KB). This also strips EXIF/GPS metadata.
- `components/PhotoScan.jsx`: the photo flow. The user confirms detected items before they're added.
- `lib/session.js`: a pure reducer (`useReducer`) for the recipe being worked on: versions (for undo), servings, checked steps and ingredients, chosen swaps. Plain JSON, so it saves to `localStorage` as-is.
- `lib/storage.js`: loads and saves sessions. Saved data is re-validated through `normalizeRecipe` on load, because localStorage is untrusted too (old app versions, manual edits).
- `lib/scale.js`: scaling and kitchen-friendly formatting (fractions for spoons/cups, rounding for grams).
- `components/`: presentational components. `RecipeView` derives display data (swap + scale) with `useMemo`. Components don't fetch.
- `ErrorBoundary`: last-resort recovery screen if a render bug slips through.

**Why parse on the client, not the server?** The server could validate too, but keeping the proxy thin means one validator is used for both model output and saved sessions. It also lets the UI show *partial* results with warnings rather than a binary pass/fail. The server still validates its own *input*.

---

## Handling bad AI output

| What goes wrong | How it's detected | What the user sees |
| --- | --- | --- |
| **Markdown fences / prose around JSON** | `extractJson` strips ```` ``` ```` and falls back to the outermost `{…}` | Nothing. It just works. |
| **Malformed JSON** | `JSON.parse` fails → `MALFORMED_JSON` | One **silent automatic retry** ("first answer was unusable — asking again…"), then an error with **Try again** |
| **Truncated** (hit token limit) | parse fails **and** `finishReason === 'MAX_TOKENS'` → `TRUNCATED` | Auto-retry, then a specific "recipe got cut off" message |
| **Wrong shape** (valid JSON, wrong fields) | `normalizeRecipe` requires `ingredients[]` and `steps[]` with ≥1 usable item → `INVALID_SHAPE` | Auto-retry, then error + retry |
| **Partially wrong** (some items broken, `servings: "4 people"`, `"1/2"` quantities, numbered steps, strings instead of objects) | Lenient coercion; unreadable items dropped and counted | Recipe renders, plus a dismissible **"Heads up — parts were unreadable"** banner listing what was dropped |
| **Missing title / servings** | Defaulted | Recipe renders with a warning that scaling may be off |
| **Empty response** | `EMPTY` | Auto-retry, then error |
| **Model says it's not food** | Schema has a `refusal` field | Friendly empty state with the model's reason and example inputs |
| **Safety block** | `blockReason` / `finishReason: SAFETY` → `BLOCKED` | Explains it was declined; no auto-retry |
| **Slow** | Elapsed timer; after 8s, "Taking longer than usual" | Cancel button / Esc at any time |
| **Model overloaded / slow / rate-limited** (common on the free tier) | 503 → `OVERLOADED`, 429, 5xx, or no answer within 25s | **Server silently falls back to a lighter model**; the user just gets a recipe. Only if every model fails: a specific message + retry |
| **Timeout** | Whole request capped at 50s server-side → `TIMEOUT` (504); client backstop at 60s | Error + retry |
| **Rate limit / provider 5xx / network down** | Typed codes from the server; `fetch` rejection → `NETWORK` | Specific message + retry. **Not** auto-retried, to avoid hammering a limited API |
| **Stale response** | Each run gets an incrementing id. A new run or Cancel **aborts the previous fetch and bumps the id**. Results are applied only if their id is still current. | An older, slower response can never overwrite a newer one. (Abort alone isn't enough: a response can resolve just before `abort()` runs.) |
| **Refinement fails** | Same pipeline, but errors render **inline** under the tweak box | "Your recipe is unchanged." The current recipe is never wiped by a failed edit. Recipe body is `inert` while refining. |
| **Photo misidentified** | Model returns a `confidence` per item | Low-confidence items start **unticked** and dashed; the user confirms everything before it's added |
| **Photo isn't food / nothing found** | `refusal` field, or an empty list | "Couldn't see any food…" / "Didn't spot any ingredients — try a closer, brighter photo" |
| **Photo the browser can't open** (e.g. HEIC on Chrome), wrong type, >20 MB | Checked/decoded client-side → `IMAGE_*` codes | Specific message + "Choose another photo"; the API is never called |
| **Messy scan output** (duplicates, strings instead of objects, bad confidence values) | `normalizeScan` dedupes, coerces, defaults | Clean chips + a note about skipped items |
| **New photo while one is processing** | Same request-id guard as recipes, plus a guard on the async resize step | The older photo's result is discarded |
| **Refine lands on a different recipe** | Opening a saved recipe or Undo cancels any in-flight request | n/a |
| **Corrupted saved data** | Every saved version goes back through `normalizeRecipe` | Bad entries are silently skipped |

Auto-retry is deliberately limited to **output** problems, which are non-deterministic: a second sample often succeeds. Transport problems (429, timeouts, 5xx) are surfaced for the user to retry.

### Try every failure yourself

In dev (`npm start`), a **"Simulate failure"** panel (it applies to photo scans too) sits at the bottom-right. Pick a fault and every request returns it until you turn it off: `flaky-json` (bad once, then recovers via auto-retry), `malformed`, `fenced-prose`, `wrong-shape`, `partial`, `empty`, `refusal`, `truncated`, `slow` (12s), `timeout`, `rate-limit`, `server-error`. The server only honours the `x-simulate-fault` header in dev; `npm run serve` disables it.

To see the race protection, submit, then edit the ingredients and submit again before the first one finishes (try it with `slow`).

### Tests

`npm test` runs 77 tests:
- `parseRecipe.test.js`: fences, prose, malformed, truncation, wrong shape, salvage + warnings, quantity parsing (`"1 1/2"`, `"½"`)
- `useRecipeGenerator.test.jsx`: **out-of-order responses** (newer wins), auto-retry then success, retry exhausted → typed error, no auto-retry on 429, network failure, cancel drops the in-flight result
- `parseScan.test.js`, `PhotoScan.test.jsx`: scan parsing; the photo flow with low-confidence items unticked, only confirmed items added, unreadable image, auto-retry, refusal, empty result
- `App.test.jsx`: renders the whole app with a mocked API: scaling, swaps, step progress, autosave, error → retry, refusal, failed refinement keeps the recipe, undo
- `server/fallback.test.js`: fallback on 503/429/5xx/slow model; no fallback on safety blocks; stops on client disconnect
- `scale.test.js`, `session.test.js`

---

## Stretch goals

- ✅ **Refinement loop**: follow-ups edit the current recipe (the current JSON is sent back with the change request). Versions are kept for **undo**. Also used by "rewrite for my swaps."
- ✅ **Save & reload sessions**: autosaved to localStorage with progress (checked steps, servings, swaps).
- ✅ **Polish**: dark mode (system / light / dark toggle), keyboard support (Ctrl+Enter, Esc to cancel, native focusable controls, visible focus rings, `<dialog>` drawer with focus trapping), subtle animation with `prefers-reduced-motion` respected.
- ❌ **Streaming**: skipped on purpose. Partial JSON can't be validated until it's complete, and showing half a recipe that might then be rejected felt worse than a good loading state. If I added it, I'd stream into a tolerant partial-JSON parser and render only fully-closed `steps[]` items as they arrive.
- ❌ **Different block types**: not a natural fit for a single recipe. The closest equivalent is the swaps / shopping-list / tips sections.

## Known limitations

- **Swaps don't rewrite the method automatically.** Choosing a swap changes the ingredient line only. The UI says so and offers a one-click AI rewrite.
- **Checkmarks reset when a refinement is applied.** Ids are positional, so after the AI restructures the recipe, old checkmarks could point at the wrong step. Servings are kept.
- **Refinement sends the whole recipe back** to the model (fine at this size; could use a JSON-patch style edit for larger docs).
- **Quantities are only as good as the model's.** Unit conversion (cups ↔ grams) isn't attempted, and "to taste" items don't scale.
- **Free-tier Gemini is sometimes overloaded.** The fallback model absorbs most of this, but if Google's whole Flash family is busy, users see "The AI is very busy right now" and can retry. The real fix is a paid key (Tier 1 is cheap). Using several free keys to multiply quota isn't a fix: limits are per Google Cloud project, and getting around them breaks Google's terms.
- **Rate limiting is in-memory**, so it resets on restart and isn't shared across multiple instances (fine for one free Render instance; Redis would be needed beyond that).
- **One photo at a time.** Scan again to add more. Photos aren't kept in saved sessions.
- **Sessions are per-browser** (localStorage), capped at 20.
- **AI-generated food content:** no allergen guarantees. The footer says so.
- The default model alias `gemini-flash-latest` may change behaviour over time. Pin `GEMINI_MODEL` for reproducibility.

## What I'd do next

1. Streaming with progressive rendering of completed steps.
2. Step timers (the `minutes` field is already there).
3. A "keep my checkmarks" merge on refinement by matching steps by text similarity.
4. Multi-photo scans, and pasting/dropping images into the text box.
5. An eval script that runs ~30 varied inputs through the real model and reports parse/validation failure rates.

---

## Deploying (Render)

The repo includes a `render.yaml` blueprint: one free Node web service that runs `npm ci --include=dev && npm run build`, then `npm run serve` (Express serves `dist/` and `/api` from one origin, so there's no CORS setup and the key never leaves the server).

1. Push this repo to GitHub.
2. On [render.com](https://render.com): **New → Blueprint**, then pick the repo.
3. When prompted, paste your **GEMINI_API_KEY**, then **Apply**.
4. Wait for the build, then open the `https://<name>.onrender.com` URL. `/api/health` should show `"keyConfigured": true`.

In production mode, fault injection is disabled and per-IP rate limiting is on. On the free plan the service sleeps after ~15 minutes idle, so the first visit afterwards takes ~30–60s to wake up. Every push to `main` redeploys automatically.

## AI usage

_Edit this section so it accurately describes how you worked._

- **Claude Code (Anthropic)** was used to scaffold the project and write most of the initial code: the Express proxy, the parsing/validation layer, the request hook, components, CSS, tests, and this README.
- I chose the project and provider, reviewed the code, ran the tests and the app, and checked each failure scenario with the fault-injection panel.
- **SDKs**: none. Gemini is called with plain `fetch`, and structured output comes from Gemini's `responseMimeType: application/json` + `responseSchema`. That schema constrains generation but isn't trusted: everything is re-validated client-side.

## Time spent

_Fill in:_ ~X hours (setup X, core generation + parsing X, interactive UI X, failure handling + tests X, polish + README X).
