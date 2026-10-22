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
| `lib/types.ts` | The data contract: `SettingsV1`, `TriggerRule`, `SETTINGS_KEY`, `MAX_RULES` (20), `TRIGGER_PATTERN` (ASCII, letter-initial, ≤32 chars), `createRule()`. |
| `lib/expander.ts` | `expandTriggers(text, rules)` — pure string function, the only tested unit. |
| `lib/storage.ts` | `chrome.storage.local` read/write plus `normalizeSettings()`, the single validation gate for both persisted data and imported JSON files. |
| `lib/deepseek-dom.ts` | **All** DeepSeek page selectors and DOM writing. |

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