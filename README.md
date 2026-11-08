# chatgpt-utils

Two features: **Export** a single response to Markdown for Obsidian, and **Outline** for quick navigation in long conversations.

A Chrome extension (MV3) that exports **one ChatGPT response** to clean Markdown for Obsidian, preserving:

- bold / italic / strikethrough / inline code / links (strips `utm_source=chatgpt.com`)
- headings, nested lists, task lists (`- [x]`), blockquotes, tables (with alignment), horizontal rules
- code blocks (correct language, original source code)
- KaTeX math → `$…$` / `$$…$$`
- web search **images** (`images.openai.com`) → original image files; uploaded/generated images: host not yet verified (see Security)
- **diagrams / charts / mermaid / cards** drawn by ChatGPT → PNG images (2x)

## Why ChatGPT's Copy button loses formatting

ChatGPT (2026) renders answers with a new renderer ("DIL"): bold is `<span data-d-default-strong>`, italic is `data-d-font-style="italic"`, strikethrough is `data-d-text-decoration="line-through"`… instead of `<strong>/<em>/<del>`. Diagrams are layout blocks (divs + SVG arrows), charts are inline SVG, and mermaid is only the rendered SVG. This extension reads those attributes directly.

## Installation

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this folder
3. Reload the ChatGPT tab

## Usage

Each response gets a **⤓** button at the end of its action bar (next to Copy, Like…):

| Option | Result |
| --- | --- |
| **Copy Markdown** | Markdown to the clipboard, with images/diagrams embedded as `data:image/png;base64` (self-contained, heavy notes; whether Obsidian displays base64 images has not been verified) |
| **Download .zip for Obsidian** | `<Title>.zip` containing `<Title>.md` (with `source`, `exported`, `tags` frontmatter) + `attachments/*.png` — extract it straight into your vault |

The **.zip** is recommended for notes with images/diagrams. Extract it with Finder (or `ditto -x -k`); macOS's built-in `unzip` CLI ignores the UTF-8 flag and may mangle non-ASCII file names.

## Outline

A floating panel on the right lists each of your questions (**Q**) and the H1–H3 headings of the answer below it.

- Click an item to scroll to it; the section you are reading is highlighted as you scroll.
- **H1 / H2 / H3** buttons in the header: show headings only up to that level (questions are always shown); the choice is remembered.
- The **»** button collapses the panel into a small button; the state is remembered (`chrome.storage.local`). Screens narrower than 1100px start collapsed.
- Updates automatically when a new answer arrives or you switch conversations. Only shown when there are at least 2 items.

## Security

- Reads only the visible DOM. Does **not** call `/api/auth/session`, does **not** use the access token, does **not** call `/backend-api`.
- Sends no data anywhere. The only network access: fetching images from `images.openai.com` (web search images, blocked by CORS in the page) through the service worker, without cookies. Same-origin `chatgpt.com` images are fetched directly in the page.
- Permissions: `clipboardWrite`, `storage` (only stores the outline's collapsed state), host `images.openai.com`. The content script runs only on `chatgpt.com` / `chat.openai.com`.
- Images from hosts not on the list → the original link is kept (with a warning). To add a host: edit `host_permissions` in `manifest.json` and `ALLOWED_HOSTS` in `src/background.js`.

## Structure

```
manifest.json
src/converter.js   DOM → Markdown (also runs in jsdom)
src/rasterize.js   element → PNG via SVG foreignObject (no external libraries)
src/outline.js     outline: collectOutline() (tested with jsdom) + panel
src/zip.js         minimal ZIP writer (STORE, UTF-8 file names)
src/content.js     injects the button, menu, clipboard, zip download
src/background.js  fetches cross-origin images for allowed hosts
test/              node:test + jsdom, fixtures mimicking the real DOM
```

## Tests

```bash
pnpm install
pnpm test
```

## Known limitations

- Mermaid: the DOM does not contain the mermaid source, only the rendered SVG → exported as PNG, not as ```` ```mermaid ```` code.
- Citation badges (e.g. "MDN") have no URL in the DOM → exported as `(MDN)`.
- Selectors depend on ChatGPT's DOM; when OpenAI changes the UI, `src/converter.js` may need updating.
- Exports one response at a time (not the whole conversation).
- Outline: not yet verified with very long conversations — if ChatGPT removes old turns from the DOM, their items disappear until they are rendered again. Dark mode has not been checked.
