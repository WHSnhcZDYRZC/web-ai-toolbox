# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`deepseek-trigger-expander` — a Chrome/Edge MV3 extension that rewrites trigger words in the DeepSeek chat input **at send time** (not on typing). Typing `hy1` then pressing Enter actually sends the long text configured for `hy1`.

Stack: WXT 0.21 (framework/manifest/bundling), plain TypeScript + DOM APIs in the content script, React 19 + Ant Design v6 in the popup, Vitest for tests. All UI text, code comments, and the README are in Chinese — match that when editing existing files.

## Commands

```bash
pnpm install            # postinstall runs `wxt prepare`, which generates .wxt/tsconfig.json
pnpm dev                # wxt dev — rebuild on change
pnpm build              # production build → .output/chrome-mv3 (load this dir as an unpacked extension)
pnpm zip                # distributable zip
pnpm test               # vitest run
pnpm typecheck          # tsc --noEmit
node scripts/generate-icons.mjs   # regenerate public/icons/*.png (pure Node, no deps)
```

Single test / subset:

```bash
pnpm vitest run tests/expander.test.ts
pnpm vitest run -t "长触发词优先"
```

To see popup changes: `pnpm build`, then reload the extension at `chrome://extensions`. For headless screenshots, `scripts/make-preview.mjs` (untracked, ad-hoc) patches `chrome.storage` into the built `.output/chrome-mv3/popup.html` and writes `preview.html` with sample rules — it requires a build first and mutates `.output/`.

## Architecture

Two independent extension surfaces sharing `lib/`:

- **`entrypoints/content.ts`** — the only content script, injected at `document_idle` on `https://chat.deepseek.com/*`. Vanilla TS; React/antd are deliberately **not** injected into the page (bundle stays ~7.7 kB).
- **`entrypoints/popup/`** — the toolbar config page (React 19 + antd). Popup size is fixed at 400×560 via CSS on `body`, not in the manifest.

`lib/` is framework-agnostic and split by concern:

| File | Role |
|---|---|
| `lib/types.ts` | The data contract: `SettingsV1`, `TriggerRule`, `SETTINGS_KEY`, `MAX_RULES` (20), `TRIGGER_PATTERN` (ASCII, letter-initial, ≤32 chars), `createRule()`, plus `Prefs`/`PREF_KEY`/`DEFAULT_PREFS`. |
| `lib/expander.ts` | `expandTriggers(text, rules)` — pure string function, the only tested unit. |
| `lib/storage.ts` | `chrome.storage.local` read/write plus `normalizeSettings()`, the single validation gate for both persisted data and imported JSON files. Also `loadPrefs`/`savePrefs`/`onPrefsChanged`, which funnel through one private `normalizePrefs()`. |
| `lib/deepseek-dom.ts` | **All** DeepSeek page selectors and DOM writing. |
| `lib/code-block-fold.ts` | The injected fold button's UI: style injection, button creation, `applyCodeBlockFold(enabled)` entry point. |

### Send interception (`content.ts`)

Listeners are attached once on `document` in the **capture** phase, which is what makes them survive the SPA rebuilding its DOM. Two distinct strategies:

- **Enter key** — expand, then let the event through so the page's own handler sends it. Shift+Enter and IME composition (`isComposing` / `compositionstart`) are excluded.
- **Send-button click** — capture phase checks whether the click landed inside the send button; if a replacement actually happened, `preventDefault()` + `stopPropagation()`, then re-click the button on the next tick (`setTimeout(..., 0)`) so the page framework has processed the `input` event. The re-click naturally does nothing because `replacedCount` is now 0 — this is why there is no recursion guard.

Element lookups are cached in `cachedInput` / `cachedSendButton`, invalidated by `isConnected` checks plus a `MutationObserver` on `document.body`. Don't move listeners onto the elements themselves.

### Hot reload path

Popup mutates state → `saveSettings()` writes `chrome.storage.local` → content script's `onSettingsChanged()` (subscribed once at startup) swaps its in-memory `rules`. No reload of the extension or page is needed. `App.tsx` funnels every mutation through `persist(nextRules, successText)` for this reason — keep new write paths going through it.

### `lib/deepseek-dom.ts` is the single maintenance point

The file's own header says DeepSeek redesign fixes belong **only** here — don't scatter DeepSeek-specific selectors into `content.ts` or elsewhere. Every lookup is a multi-level fallback chain (input: `textarea` → `[contenteditable="true"]` → editable inside the send button's container; send button: `button[type="submit"]` → aria-label/title/text containing 发送/Send → icon-only button near the input). Preserve the fallback structure when adjusting selectors.

Writing text back must go through `setInputText()`, which keeps two frameworks happy and is the reason the DOM layer exists at all:

- `textarea`/`input` → native prototype `value` setter (bypasses React's value wrapper) + dispatched `input`/`change`.
- `contenteditable` → `Selection`/`Range` + `document.execCommand('insertText')` so ProseMirror/Lexical register the edit; `textContent` write is only the last-resort fallback.

Text is always inserted as plain text, never as HTML.

### Collapsible "thought" blocks — verified facts

`findThoughtAreas()` / `isThoughtExpanded()` / `collapseThought()` in `lib/deepseek-dom.ts` implement the optional 「思考内容默认折叠」 setting. These conclusions came from probing a live `chat.deepseek.com` page in Oct 2026 — they cannot be re-derived from the source, and re-check them if the UI ever changes:

- **Never key off `class`.** DeepSeek's classes are mostly build-time hashes (`_74c0879`, `c2b72bb8`…) that change on every deploy. Only `ds-`-prefixed classes are semantic (`ds-think-content`, `ds-message`, `ds-toggle-button`). The container is anchored on its inline CSS variable `--collapsible-area-title-height`, with a text-based fallback.
- **There is no `aria-expanded`, and the class is identical in both states.** The one reliable signal is whether `.ds-think-content` is in the DOM: expanded mounts it, collapsed **removes it entirely** (it is not hidden). Measured heights: 89px expanded vs 34px collapsed; content up to 5229px.
- The title row is always the container's **first child**; clicking it toggles. Clicking the span, the row, or the row's parent all work.
- `ds-collapsible-text` is the **user's question text**, not a thought-block title — don't mistake it for one.
- `findThoughtAreas()` matches only titles starting with `已思考`, deliberately skipping `正在思考`: content streams in live during thinking, so collapsing then would fight both the user's attention and the MutationObserver's high-frequency callbacks. Blocks are folded once they settle.

`content.ts` folds on load, on pref change, and on mutation (via `scheduleCollapse()`, a `setTimeout(…, 0)` debounce so a burst of mutations folds only once). `collapseThought()` returns `false` for already-collapsed blocks, which is what makes the repeated observer callbacks safe — verified idempotent over three consecutive passes.

Prefs live under their own storage key rather than inside `SettingsV1`: `normalizeSettings()` discards fields outside `{version, rules}`, so folding the setting in would force a schema version bump plus migration and import-file compatibility work. Decoupling also keeps exported rule JSON clean.

### HTML code blocks — verified facts

`lib/code-block-fold.ts` folds long HTML code blocks (361 lines rendered to 8036px, taller than the viewport). Unlike thought blocks, DeepSeek's own copy/download/run buttons already exist — **only html blocks get a run button**, so don't reimplement them; just add the fold toggle. Probed facts:

- **Gated behind the `foldCodeBlocks` pref, default off.** When off, `applyCodeBlockFold(false)` must leave the page byte-for-byte alone — no button, no `<style>`, no `display:none`. Toggling off also *unfolds* everything we folded and removes the injected buttons, and resets the `processed` `WeakSet` so re-enabling still works (otherwise the old nodes look "already handled" and nothing reappears). Keep `processed` a `let`, not a `const`.
- `applyCodeBlockFold(enabled)` is the module's only export; content script calls it on load, on pref change, and from the observer (skipped entirely when the pref is off).

- The container is `div.md-code-block` — a *semantic* class, so far more reliable than the thought block's hashes.
- `banner-wrap` is `display:block`; the actual side-by-side row is the **full-width flex one level down** (`space-between`, holding the language label and the native buttons). Appending to `banner-wrap` looks fine in the DOM but renders on a second line and visually collides with DeepSeek's message-action row. `findButtonHost()` walks back up from the first bare-language-name span instead of keying off a hash.
- `<pre>` has **no `<code>` child** — one `<span>` per line. Read it via `pre.textContent`.
- Fold by setting `display:none` plus a `data-tse-folded` marker; don't touch `max-height` (DeepSeek uses `overflow:auto` with no height cap, so an inline `display` toggle can't fight its styles).
- The button lives in React-managed DOM and can be wiped on re-render, so `refreshHtmlCodeBlocks()` re-injects it on every observer tick; a `WeakSet` keeps that idempotent.

### `expandTriggers()` semantics

Deliberate behaviors that the tests pin down — changing any of them changes the contract:

- Word-boundary match via lookbehind/lookahead on `[A-Za-z0-9_-]`, so `hy1` does not fire on `hy123`, `xhy1`, or `hy1_extra`.
- Case-insensitive matching, but rules keep the user's original casing; `matchedTriggers` reports that original form.
- Active rules sorted by trigger length descending so longer triggers win.
- Single pass, non-recursive: triggers appearing inside a `replacement` are never expanded.
- Function replacer, so `$&` / `$1` inside a replacement stay literal.
- Regex lookbehind means modern Chrome/Edge only.

## Testing scope

Only `lib/expander.ts` is covered (11 unit tests in `tests/expander.test.ts`). There is no jsdom or browser environment and no test for the DOM layer or the storage layer — new pure functions in `lib/` are the natural place to add coverage.

## Manifest & permissions

`wxt.config.ts` declares the manifest. Permissions are intentionally minimal: `storage` plus host `https://chat.deepseek.com/*` — do not add `<all_urls>` or inject content scripts on other origins. Settings live in `chrome.storage.local` (device-local, not synced), and `normalizeSettings` drops malformed rules and caps at `MAX_RULES`, so imports can never exceed the limit or write bad shape.

Note that `entrypoints/content.ts` imports `defineContentScript` from `#imports`, a WXT-generated virtual module — type resolution for it comes from the generated `.wxt/tsconfig.json`, so run `pnpm prepare` if the editor complains about that import.