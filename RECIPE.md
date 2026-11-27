# PersonalOS

Herdr's default window with two changes for people who work from a file tree. The Files and Changes panel sits on the left of the terminals instead of the right. You can drag any file or folder from Files into a terminal, and its absolute path is typed at the cursor. Clicking a file opens it in its own tab, where you can read it raw, see it rendered, edit it, or hand it to the macOS default app.

## What you see

- Left to right: the Herdr sidebar (268px; spaces, agents, footer), then the work column.
- In the work column, the tab bar (42px) runs across the top and the status bar (28px) runs across the bottom.
- Between them is the `work-body` row (8px padding, 8px gap). Its first child is the side panel (368px wide, 280 to 900px). The panel is a stack holding Files and Changes, and it starts hidden like Herdr's own. Its second child is the terminal panes.
- The look is identical to Herdr's `main` layout, and your theme and settings apply unchanged.
- A file opens in a viewer tab named after it. A 36px toolbar shows the path (shortened in the middle, `~` for home) on the left. On the right are a **Raw | Render** switch, a **✎ Edit** button and a **⋯** menu, each only when it applies. While editing, **Save** (filled when there are changes) and **Done** (or **Close…** with unsaved changes) replace ✎ Edit.
- A banner under the toolbar appears for a save conflict, a missing file, or an unsaved draft, with its buttons.
- Binary files show a centred card: name, size and type, and an **Open in default app** button.

## How it behaves

- The Files and Changes buttons in the tab bar show and hide the panel, as in `main`.
- Clicking a file opens it in a new tab. Clicking a folder folds it open or closed as before.
- What a file offers depends on its group:
  | Group | Examples | Raw | Render | Edit | Default app |
  |---|---|---|---|---|---|
  | 1 renderable text | md, markdown, mdx | yes | Markdown | yes | yes |
  | 2 partly renderable | html, htm | yes | HTML without CSS | yes | yes |
  | 3 plain text | code, txt, json, yaml, csv, svg, ipynb | yes | no | yes | yes |
  | 4 images | png, jpg, gif, webp, bmp | no | image | no | yes |
  | 5 other binaries | pdf, docx, xlsx, pptx, zip, mp4 | no | no | no | yes |
  An unknown extension is read: text goes to group 3, a NUL byte or unreadable bytes (for example Latin-1) to group 5.
- The viewer opens in the last mode you picked for that extension (Raw or Render). Edit is never remembered, so a file always opens read-only.
- Shortcuts while a viewer has focus: ⌘E edit, ⌘R switch Raw and Render, ⌘S save, ⌘O open in the default app. On an image, zoom with a trackpad pinch or the toolbar's − Fit + buttons. There are no zoom keys: Herdr keeps ⌘=, ⌘− and ⌘0 for zooming the whole app.
- ⋯ holds Open in default app, Show in Finder, Save (while editing) and Close. Open and Finder are local only.
- Editing marks the tab `● name`. Save writes only if the file still holds what was opened. If someone (an agent, say) changed it meanwhile, the save is refused and the banner offers **Reload** (drop your edits) or **Save as conflict file** (`notes.conflict.md`, then `notes.conflict-2.md`). There is no overwrite-anyway. A deleted file offers only the conflict file.
- Close with unsaved changes asks Save, Discard or Cancel. Herdr gives mods no hook for the tab bar's ×, so the viewer keeps a draft every 3 seconds. Reopening the file offers to restore it, with the same conflict rule if the file changed since.
- Files over 400,000 characters show truncated and cannot be edited.
- Text files on another machine (a space's `machine`) can be edited and saved too. Machines without `sh`, `base64` and a SHA-256 tool stay read-only, with a note in the toolbar. Remote images and binaries show the card.
- Pressing a row and dragging it onto a terminal pastes the absolute path of that file or folder at the cursor. Herdr's own terminal drop handling does the pasting, so paths with spaces are escaped exactly as a drop from Finder. Dropping anywhere else cancels.
- Long file names show in full. The tree scrolls sideways (trackpad or shift+wheel) instead of cutting names with an ellipsis.
- Agent status, tabs, spaces and keys behave exactly as in `main`.

## Built from

- `layouts/PersonalOS.json` is a clone of `main` (Herdr 0.1.18). Inside the `work-body` row, the order of children is swapped from `[main, panel]` to `[panel, main]`. In the `panel-body` stack, the `files` block points at `mods/file-explorer` instead of the shipped `files` mod.
- `mods/file-explorer` is a clone of the shipped `files` mod with one added line in `rows()`. Each row gets `.drag_paths([`${this.root}/${path}`], { on: this.on ?? null })`, placed before its `.on_click`. That makes the row a native drag source, and the path keeps the machine it lives on.
- `mods/file-viewer` is a new mod that fills a tab. Files opens it with `run("tab.new", { name, mod: "file-viewer", props: { path, on } })`. It has three files:
  - `lib.js`: pure logic with no `herdr` import, tested by `node --test tests/lib.test.mjs`. It holds `groupOf`, `actionsFor`, `pickMode`, `conflictName`, `quoteSh`, `cacheName`, `utf8ToBase64`, `chunkBase64` and `remoteScripts`.
  - `main.js`: the view. Raw is a readonly `EditorState`; Edit is a second, writable one with a `change` handler. Render uses `TextView.markdown` and `TextView.html` from `gpui-base`. Modes per extension live in `shared("file-viewer.modes")`, drafts in `shared("file-viewer.drafts")`. Local saves use `writeTextFile(path, text, expected)`.
  - `remote-save.js`: remote saves over `exec(..., { on })`, in four steps. (1) Encode the text as base64 in pieces of at most 64 KB, each a whole number of base64 quads. (2) Append each piece to `.<name>.herdr-tmp` next to the target with `printf "%s" "$2" | base64 -d >> "$1"`. (3) Compare the target's SHA-256 (`sha256sum`, else `shasum -a 256`) with the hash of the text as opened (`crypto.createHash`). If they differ, delete the temp file and report a conflict. (4) Resolve symlinks first (`readlink -f`) so the save writes through a link, copy the target's permission bits to the temp file (`stat` + `chmod`), then `mv -f` it over the target. A new file (a conflict copy) uses a no-replace step that refuses an existing name. Every value goes in as `$1`, `$2`, never inside the script text.
- Images: `image()` loads only paths inside the app folder and needs an explicit size. The viewer symlinks the file into `<appHome>/data/file-viewer/images/<cacheName>` and sizes it from `sips -g pixelWidth -g pixelHeight`, fitted into 1400×900. Zoom multiplies that size (5% to 800%) through `on_pinch` and the toolbar. The image sits in a box at least as big as the viewport, so a small image stays centred and a large one scrolls to every edge.
- ⋯ and the close prompt are popups of the same mod (`props.menu` / `props.confirm`). A choice runs `file-viewer.<command>`, which Herdr delivers to the focused viewer only (`nextCommand()`).
- Shortcuts: `mods/file-viewer/keys.json` holds a `mod:file-viewer` section to merge into your `keys.json`.
- In `file-explorer`, the name is `flex_none().whitespace_nowrap()` instead of `truncate()`. The tree is two scrollers. The outer `h_flex` uses `overflow_x_scroll()`, and the inner `v_flex` keeps the shipped `overflow_y_scrollbar()`. The inner one gets an explicit width `.w()` from the longest row (indent + icons + about 8.5px per character), with `min_w_full()` so short trees still fill the panel.
- The other mods are shipped: `workspace-chrome`, `spaces`, `agents`, `tabs`, `changes`, `pane`, `workspace-status`.
- Unlike the shipped `files` mod, the git mark (A, M, D, U) sits in a fixed slot at the left of each row, before the chevron and icon, so it stays visible while the tree scrolls sideways. The tree's width is estimated at 0.48 em per character, since gpui-kit cannot measure text.
- Right-click a row (or the empty space below the tree, for the root folder) to open a menu like VS Code's Explorer: Open, Open in Default App, Reveal in Finder, Open in Terminal, New File…, New Folder…, Cut, Copy, Paste, Duplicate, Copy Path, Copy Relative Path, Rename…, Delete. Pasting into the same folder names the copy `name copy.ext`, then `name copy 2.ext`, like Finder. A cut refuses to replace an existing name, and a folder can't go inside itself. A new file opens in the viewer.
- Delete asks first. Local items go to the macOS Trash (`/usr/bin/trash`, macOS 15 or newer). A remote machine has no Trash, so the dialog says the delete is permanent.
- Hold Option (⌥) and drag a row onto a folder to move it there; the target folder is outlined and the header says what moves where. Herdr only delivers `on_drop` for drags from outside the app, so this move is built from plain mouse events, and holding ⌥ turns off the row's native `drag_paths` meanwhile. A plain drag still types the path into a terminal. Drop files from Finder onto a folder to copy them in. Both work on local folders only.
- Built from: the menu and both dialogs are popup copies of this mod (`props().menu`, `ask`, `confirm`). They run the file work themselves through `ops.js` (small `sh` scripts via `exec`, so remote machines work too), then post `shared("file-explorer.changed")`. The panel sees it on its 500 ms tick, reloads, and opens the folders down to the changed item. The cut/copy clipboard is `shared("file-explorer.clipboard")`, separate from the text clipboard. `paths.js` holds the pure helpers, tested by `tests/ops.test.mjs`.
- Watch out: closing a popup ends its copy and any task still running in it, so the popup finishes slow work (paste, duplicate) before it closes itself. And don't call your own method `close()`, Herdr calls that when a view goes away.
- Like the shipped `files` mod, it runs programs to list folders and read git status (`sh`, `git`, and `powershell` on Windows). It reads the folder of the focused terminal.

## Watch out

- One scroller on both axes (`overflow_scrollbar()`) stopped updating its height when a folder opened. A vertical scroller does not grow to its content's width either, so it needs the explicit width.
- The width is an estimate for a proportional font. Very wide names (many W or M) can lose a few pixels at the end.
- Herdr calls a view's `close()` when its tab closes. Don't name your own close action `close()`: running `tab.close` from it closes the next tab too, and on the last tab Herdr asks to close the space.
- `readTextFile` throws on binary bytes. Classify by extension first and read only text groups, or images turn into cards.
- Herdr's script engine has no `TextEncoder`, `Buffer` or `btoa`. UTF-8 and base64 are done by hand in `lib.js`.
- A failed save that is not an outside change (read-only folder, full disk, machine without tools) keeps the editor and the draft, and says why. Only a real change on disk shows the conflict choices.
- While a draft banner is open, Edit is hidden, so a new edit cannot overwrite the waiting draft.
- A remote save keeps permissions and symlinks, but the owner becomes the user who saves.
- Remote save has an accepted race: a write by someone else between the hash check and the `mv` is overwritten. Local saves have no such gap.
- Linux caps one exec argument at about 128 KB, hence 64 KB pieces. Large remote saves take several round trips.
- Merging the shortcuts makes `keys.json` yours: Herdr stops adding new default shortcuts to it on upgrade.
- Read props with `props()` from "herdr". The `props` argument to `init` stays empty for a mod opened by `tab.new`.

- The mod is a clone, so fixes Herdr ships for `files` do not reach it. On a newer Herdr, clone `files` again and re-add the one `drag_paths` line.
- `drag_paths` must sit on the row element itself, the one with the `.id()`. If you put it on a child, only that child starts a drag.
- Dropping a local path on a terminal of another machine does not copy folders. Herdr says why.

## Done when

- `herdr-app check` passes for `mods/file-explorer` and `mods/file-viewer`, and `node --test tests/lib.test.mjs tests/ops.test.mjs` passes.
- After `layout.switch {"name":"PersonalOS"}`, the Files panel opens on the left of the terminals.
- Dragging a file from Files into a shell types its absolute path, and dragging a folder does the same.
- A click on a file opens a new tab named after it. A click on a folder still folds it.
- md opens in the last mode used for md; ⌘R switches Raw and Render; ⌘E edits; ⌘S saves; the tab shows ● while dirty.
- Saving after an outside change is refused, and nothing is overwritten. Save as conflict file writes `name.conflict.ext`.
- Closing a dirty viewer from ⋯ asks first. Closing it with × and reopening the file offers the draft.
- A pdf, docx or xlsx shows its card; ⌘O opens it in the default app; Show in Finder reveals it.
- A png or jpg renders inside the tab. An unknown text file opens as raw text, an unknown binary as a card.
- On a remote machine, editing and saving a text file works, and a save after an outside change is refused the same way.
