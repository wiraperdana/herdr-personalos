# File actions in the PersonalOS viewer: design

Date: 2026-11-27. Owner: Wira Perdana. Status: approved by Wira on 2026-11-27, after a builder check.

## Intent

Clicking a file in the PersonalOS Files panel already opens it in its own tab (`mods/file-viewer`), read-only, as raw text. Wira works with every kind of file there: md, pdf, html, docx, xlsx, pptx, png, jpg, and more. One raw view is not enough. He wants each file to offer the actions that make sense for it. The actions are: **see raw**, **see rendered**, **edit** (for anything that has a raw view), and **open in the OS default app**.

Why it matters: the Files panel should be the one place he starts from. Today a pdf or docx shows "Binary file", and a markdown file shows only its source. That sends him back to Finder.

## Goals

1. One viewer tab per file, with a compact toolbar: path on the left, then a **Raw | Render** switch, a **✎ Edit** button and a **⋯** menu on the right (mockup C, chosen by Wira).
2. Actions shown depend on the file's group (below). Actions that do not apply are hidden, not disabled.
3. The viewer opens in the **last mode used for that file type** (per extension; Wira's decision). If that mode does not apply to this file, it falls back to the first available mode in the order Render, Raw.
4. Editing with safe saving, and three layers that protect unsaved work (below).
5. Keyboard shortcuts (approved by Wira): ⌘E Edit, ⌘R Render (toggles Raw/Render), ⌘S Save, ⌘O Open in default app.

## File groups

The group decides the actions. The extension decides the group. An unknown extension is sniffed (see the fallback rule).

| Group | Extensions | Raw | Render | Edit | Default app |
|---|---|---|---|---|---|
| 1. Renderable text | md, markdown, mdx | yes | Markdown, native | yes | yes |
| 2. Partly renderable text | html, htm | yes | rough HTML, no CSS | yes | yes |
| 3. Plain text | code (py, js, ts, sh, ...), txt, json, yaml, toml, csv, tsv, log, env, ini, xml, tex, bib, ipynb (as JSON), svg | yes | no | yes | yes |
| 4. Images | png, jpg, jpeg, gif, webp, bmp | no | image | no | yes |
| 5. Other binaries | pdf, docx, xlsx, pptx, odt, key, numbers, pages, mp4, mov, mp3, wav, zip, tar, gz, dmg, epub, sqlite, and more | no | no | no | yes, plus Show in Finder |

**Fallback rule.** For an unknown extension, read the start of the file. Text goes to group 3. A NUL byte means binary, which goes to group 5. The shipped `files` mod uses the same NUL check.

**svg** is in group 3 (raw and editable). Whether `image()` can also render svg, gif and webp is to be checked during the build. Formats it cannot render move to group 5.

## Behaviour

**Toolbar (mockup C).** The path is truncated in the middle if long. The Raw | Render switch is shown only when both apply. ✎ Edit is shown when Raw applies. The ⋯ menu has Open in default app, Show in Finder, Save (while editing), and Close. Groups 4 and 5 show only what applies. Group 5's body shows the file name, size and type, with a large "Open in default app" button.

**Modes.** Raw is a read-only editor with syntax colors (as today). Render: Markdown through `TextView.markdown`, HTML through the same `TextView` (no CSS, which is a known limit), images through `image(path)`. Edit is the same editor, writable. The last mode is remembered per extension in mod state (`shared` or the mod's own storage), and it survives restarts.

**Saving.** Save uses `writeTextFile(path, text, expected)`, where `expected` is the text as it was read. If the file changed on disk in the meantime (an agent wrote it), the save is refused. The viewer then says so and offers two ways out (Wira's decision K-261127-04):
- **Reload**, which shows the new version from disk and drops the edits.
- **Save as a conflict file**, which writes the edits next to the original as `<name>.conflict.<ext>` (for example `notes.conflict.md`, with a number added if that name is taken). Nothing is lost, and the original keeps the agent's version.

There is no "overwrite anyway". The same two choices apply when restoring a draft (layer 3 below) for a file that changed on disk since the draft began, so a draft stores the original text it started from.

**Unsaved work. Wira asked to be asked before losing changes.** A mod cannot intercept closing a tab with the × in Herdr's tab bar. No such hook was found in `herdr.d.ts` or `gpui-kit.d.ts`. So there are three layers:
1. The tab title shows "● name" while there are unsaved changes (rename the tab via `tab.rename`).
2. Close from the viewer (⋯ Close) asks Save, Discard or Cancel.
3. The draft is autosaved to mod state every few seconds. If the tab was closed with ×, reopening the same file asks whether to restore the draft.

Switching tabs keeps the tab alive, so it needs no prompt.

**Remote text files (K-261127-05).** Remote text files can be edited too. `readTextFile(path, { on })` reads them, but `writeTextFile` has no `on` option, and `exec` takes no stdin. So saving is assembled from `exec(..., { on })` calls:
1. Encode the text as base64 and split it into chunks of about 64 KB (Linux caps one argument at about 128 KB).
2. Append each chunk to a temp file next to the target (`.<name>.herdr-tmp`), decoding with `base64 -d`.
3. Hash the target on the remote (`sha256sum`, or `shasum -a 256`) and compare it with the hash of the text as it was read. If they differ, delete the temp file and offer the K-261127-04 choices (reload, or save as a conflict file).
4. If they match, `mv` the temp file over the target. This is atomic on the same filesystem.

**Accepted risk.** A write by someone else in the milliseconds between steps 3 and 4 would be overwritten. Wira accepted this risk. The local path has no such gap, because `writeTextFile` checks and writes in one step. Remote saves of large files are slower, because they go in chunks. Remote machines without `sh`, `base64` and a SHA-256 tool (for example Windows) stay read-only, with a note in the toolbar.

**It ships with the repo (Wira's request).** The remote save is part of the shared layout, not a local patch. It must:
- live inside `mods/file-viewer/`, as its own module (`remote-save.js`) if gpui-kit loads relative imports, otherwise as one clearly marked section of `main.js` with a single entry function such as `saveRemote(path, on, text, original)`;
- hold nothing specific to Wira's setup: no machine names, hosts, home paths or user names. It takes the machine from the file's `on` and finds the hash tool at run time;
- be described in `RECIPE.md`: the four steps in "Built from", and the accepted race window, the 64 KB chunks and the Windows limit in "Watch out". A fresh build from the recipe alone must reproduce it;
- be tested on a real remote machine before it is pushed. One test proves a normal save, and one proves the refusal after an outside change.

**Open in default app** runs `open <path>` (macOS) through `exec`. Show in Finder runs `open -R <path>`. Both are local-only.

**Shortcuts** go in a `mod:file-viewer` section of `keys.json`, delivered to the mod's `nextCommand()`. ⌘E, ⌘R, ⌘S and ⌘O are not bound in Wira's current `keys.json`. A mod's keys must be merged into the person's file, never replacing their keys.

## Non-goals

- A full browser-quality HTML or PDF view. Herdr has no web view, so the default app covers these.
- Rendering office files (docx, xlsx, pptx) inside Herdr.
- Running notebooks, or rendering ipynb as cells.
- Multi-file editing features such as find and replace across files, or a diff view.

## Anti-goals (a failure even if it works)

- Losing an edit without being asked, or overwriting a file an agent changed.
- Saving a truncated file. Files over the 400,000-character display limit open read-only, and Edit is hidden for them.
- Cluttering the toolbar. Mockup C was chosen for compactness.
- Breaking what works now: drag a row to a terminal to paste its path, folder folding, and sideways scrolling in Files.

## Constraints

- Herdr 0.1.18 mods: gpui-kit JavaScript only, no DOM or HTML/CSS, no Node APIs. `herdr.d.ts` and `gpui-kit.d.ts` are the truth.
- The source of truth is `~/.config/herdr-app/`. Edit there, pass `herdr-app check`, then copy into this repo.
- Props reach a `tab.new` mod through `props()`, not through `init`'s argument.
- License: Apache-2.0, as a derivative of Herdr's mods. Update `NOTICE` if new shipped code is copied.
- Update `RECIPE.md` (What you see, How it behaves, Built from, Watch out, Done when) and `README.md` install lines.

## Calls made by the designer (Wira can override)

- **Edit is never the remembered mode.** Only Raw or Render is remembered per extension. A file always opens read-only, so a writable buffer never appears unasked.
- **Files on another machine (`on` set)**: see "Remote text files" under Behaviour (Wira's decision K-261127-05). Open in default app and Show in Finder stay hidden for them, because the app would run on the Mac while the file lives elsewhere. Group 5's card for a remote file shows its info and says it lives on that machine. Images render only if `image()` can reach the path, otherwise they get the card.
- **Shortcuts live in a `mod:file-viewer` section**, which Herdr applies only while that mod has focus. In terminal tabs, ⌘S, ⌘R, ⌘E and ⌘O keep their current behaviour. The builder verifies this scoping first, and stops to ask if Herdr applies `mod:` keys app-wide.

## Left to the builder

- How the extension table and the sniffing are organised in code.
- The exact autosave interval, and where drafts are stored, as long as they survive a restart.
- The visual details within mockup C (spacing, icons, the ⋯ menu as a popup overlay or an inline list).
- Whether the menu-bar Save shows ⌘S. String actions in `keys.json` show in the macOS menu.

## Done when

- md opens in the last mode used for md. ⌘R switches Raw and Render. ⌘E edits. ⌘S saves. The tab shows ● while the file is dirty.
- Saving after an outside change to the file is refused with a clear message, and nothing is overwritten.
- Closing a dirty tab from ⋯ asks first. Closing it with × and reopening the file offers the draft.
- A pdf, docx or xlsx shows its info card. ⌘O opens it in the macOS default app. Show in Finder reveals it.
- A png or jpg renders inside the tab.
- An unknown text file opens as raw text, and an unknown binary as group 5.
- On a remote machine, editing and saving a text file works. A save after an outside change is refused with the same two choices.
- `herdr-app check` passes for both mods, and drag-to-terminal still works.
