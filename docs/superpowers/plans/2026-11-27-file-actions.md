# File Actions in the Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `personalos-viewer` into a per-file-type viewer with Raw, Render, Edit, Open in default app and Show in Finder, safe local and remote saving, and draft recovery.

**Architecture:** Pure logic (file groups, conflict names, base64 chunking, remote save script building) lives in `lib.js`, which has no `herdr` import, so Node can test it. `main.js` holds the view, and `remote-save.js` holds the remote save over `exec`. If gpui-kit cannot import sibling files (Task 1 decides), the modules are inlined into `main.js` as marked sections, and the tests then load the copied section.

**Tech Stack:** Herdr 0.1.18 mods (gpui-kit JS, `herdr` and `gpui-base` modules), Node 24 `node:test` for pure logic, `herdr-app check`, and manual checks in the app.

**Spec:** `docs/superpowers/specs/2026-11-27-file-actions-design.md`

## Global Constraints

- Source of truth: `~/.config/herdr-app/mods/personalos-viewer/` (`$MOD`). Copy to the repo's `mods/personalos-viewer/` only after `herdr-app check $MOD` passes.
- Tests import the repo copy, so copy `$MOD/lib.js` into the repo's `mods/personalos-viewer/` before every `node --test tests/*.test.mjs` run.
- Read props with `props()` from "herdr", never from `init`'s argument.
- Display limit: 400,000 characters. Over it, the file is read-only and Edit is hidden.
- Shortcuts: ⌘E Edit, ⌘R toggles Raw/Render, ⌘S Save, ⌘O Open in default app, in a `mod:personalos-viewer` section of `keys.json`, merged and never replacing keys.
- The remembered mode is per extension, and only "raw" or "render". Edit is never remembered.
- Conflict file name: `<name>.conflict.<ext>`, then `<name>.conflict-2.<ext>`, and so on. There is no overwrite-anyway.
- Remote chunk size: 64 KB of base64 per `exec` argument. Temp file: `.<name>.herdr-tmp` next to the target.
- No machine names, hosts, home paths or user names in shipped code.
- Commit messages carry no Co-Authored-By trailer.
- Update `RECIPE.md` and `README.md` in the task that changes the behaviour they describe.

## Review Focus

- File names with spaces, quotes or `$`: open, save, conflict name and remote `sh -c` must not break or inject. Pinned by a test in Task 2 (`quoteSh`) and Task 6.
- A file without an extension, or a dotfile such as `.env` or `Makefile`: it falls to sniffing and must open as text. Pinned in Task 2.
- An empty file: not binary, opens in Raw, and saves. Pinned in Task 2.
- A file deleted on disk while open: save shows "no longer available" and offers Save as conflict file, without a crash. Pinned in Task 5.
- A non-UTF-8 text file (Latin-1): `readTextFile` may fail. It must fall to the group 5 card, not "Loading…" forever. Pinned in Task 3.

---

### Task 1: Decide module layout and add the test harness

**Files:**
- Create: `$MOD/lib.js`, `tests/lib.test.mjs`, `package.json` (`{"type":"module","private":true}` only, so tests stay outside the shipped mod)

**Interfaces:**
- Produces: `lib.js` exports, filled in by Task 2. The decision "sibling imports work: yes/no" is written at the top of `lib.js` as a comment.

- [ ] **Step 1:** In `$MOD/lib.js`, export `export const LIB_OK = true;`. In `main.js`, add `import { LIB_OK } from "./lib.js";` and render nothing different.
- [ ] **Step 2:** Run `herdr-app check $MOD`, then open a file in the app. If both pass, sibling imports work. If not, revert the import, and from here on keep `lib.js` as the tested source and paste its body into a `// ---- lib (generated from lib.js) ----` section of `main.js` with each change.
- [ ] **Step 3:** Write `tests/lib.test.mjs` importing `../mods/personalos-viewer/lib.js` (the repo copy) with a smoke test `LIB_OK === true`. Run `node --test tests/*.test.mjs`. Expected: 1 pass.
- [ ] **Step 4:** Commit: "Viewer: pure logic module and Node tests".

### Task 2: File groups, actions and naming (pure)

**Files:** Modify `$MOD/lib.js`. Test `tests/lib.test.mjs`.

**Interfaces:**
- Produces:
  - `groupOf(name: string, sample: string | null): 1|2|3|4|5`. `sample` is the first bytes as text, or null when unread.
  - `actionsFor(group, { remote: boolean, tooLarge: boolean, remoteWritable: boolean }): { raw, render, edit, openApp, finder }` (all booleans).
  - `extOf(name: string): string`. Lowercase, "" when there is none.
  - `pickMode(remembered: "raw"|"render"|undefined, actions): "raw"|"render"|"card"`.
  - `conflictName(name: string, taken: (n: string) => boolean): string`.
  - `quoteSh(s: string): string`. Single-quote POSIX quoting.

- [ ] **Step 1: Failing tests.** Use the spec's group table:
  - `groupOf("a.md")===1`, `groupOf("a.HTML")===2`, `groupOf("a.json")===3`, `groupOf("a.svg")===3`, `groupOf("a.png")===4`, `groupOf("a.pdf")===5`, `groupOf("a.xlsx")===5`.
  - `groupOf("Makefile","all:\n")===3`, `groupOf(".env","A=1")===3`, `groupOf("blob","ab\0c")===5`, `groupOf("empty.xyz","")===3`.
  - `actionsFor(1,{remote:false,tooLarge:false,remoteWritable:true})` gives all five true. `actionsFor(1,{...,tooLarge:true}).edit===false`. `actionsFor(3,{remote:true,remoteWritable:true})` has `openApp===false`, `finder===false` and `edit===true`. `actionsFor(3,{remote:true,remoteWritable:false}).edit===false`. `actionsFor(5,{remote:false})` has only `openApp` and `finder` true.
  - `pickMode("render", actionsFor(3,...))==="raw"`, `pickMode(undefined, actionsFor(1,...))==="render"`, `pickMode("raw", actionsFor(5,...))==="card"`.
  - `conflictName("notes.md", n=>false)==="notes.conflict.md"`, `conflictName("notes.md", n=>n==="notes.conflict.md")==="notes.conflict-2.md"`, `conflictName("Makefile",()=>false)==="Makefile.conflict"`.
  - `quoteSh("a b'c$")===` `'a b'\''c$'`.
- [ ] **Step 2:** Run `node --test tests/*.test.mjs`. Expected: FAIL (not defined).
- [ ] **Step 3:** Implement them in `lib.js`. Group 4 is png, jpg, jpeg, gif, webp and bmp. Task 4 may move gif and webp to group 5 if `image()` cannot render them. Unknown extensions use `sample`: a NUL means 5, otherwise 3.
- [ ] **Step 4:** Run `node --test tests/*.test.mjs`. Expected: all pass.
- [ ] **Step 5:** Commit: "Viewer: file groups, actions and conflict names".

### Task 3: Toolbar, modes and per-extension memory

**Files:** Modify `$MOD/main.js`.

**Interfaces:**
- Consumes: Task 2 functions.
- Produces: `Viewer.mode: "raw"|"render"|"edit"|"card"`, `Viewer.setMode(m, cx)`, `Viewer.dirty: boolean`, and the shared key `personalos-viewer.modes`, an `{ [ext]: "raw"|"render" }` object read and written with `shared`/`setShared`.

- [ ] **Step 1:** On open, read up to 1 MiB with `readTextFile(path, { on })`. A null result, a thrown error, or a NUL means binary. Classify with `groupOf`, then pick the mode with `pickMode(shared("personalos-viewer.modes")?.[ext], actions)`.
- [ ] **Step 2:** Build the toolbar as in mockup C: the path, middle-truncated, on the left. On the right, a Raw|Render segmented switch (only when both apply), a `✎ Edit` button (when `edit`), and a `⋯` button. Raw shows a readonly `EditorState`. Render uses `TextView.markdown(id, text)` for group 1, `TextView` HTML for group 2, and `image(path)` for group 4. Choosing Raw or Render writes the mode to `personalos-viewer.modes[ext]`.
- [ ] **Step 3:** Show the group 5 card: name, size (`exec("stat", ...)` locally, `wc -c` remotely), type, and a large "Open in default app" button (hidden when remote, with "On <machine>" shown instead).
- [ ] **Step 4:** Run `herdr-app check $MOD`, then check in the app that md opens in Render after you last chose Render for md, json opens in Raw, png shows the image, pdf shows the card, and a Latin-1 `.txt` shows the card without hanging.
- [ ] **Step 5:** Commit: "Viewer: toolbar, Raw/Render, images, binary card".

### Task 4: Open in default app, Show in Finder, ⋯ menu, shortcuts

**Files:** Modify `$MOD/main.js` and `~/.config/herdr-app/keys.json` (merge). Create the repo's `mods/personalos-viewer/keys.json` (the section to merge, for sharing).

**Interfaces:**
- Consumes: `actionsFor`.
- Produces: the mod commands `edit`, `render`, `save` and `open`, delivered through `nextCommand()`.

- [ ] **Step 1:** ⋯ opens a popup (`openOverlay({ mod: "personalos-viewer", kind: "popup", props: { menu: true, path, on } ... })`) listing only the applicable items: Open in default app (`exec("open",[path])`), Show in Finder (`exec("open",["-R",path])`), Save (while editing) and Close.
- [ ] **Step 2:** Add `"mod:personalos-viewer": { "cmd-e": "personalos-viewer.edit", "cmd-r": "personalos-viewer.render", "cmd-s": "personalos-viewer.save", "cmd-o": "personalos-viewer.open" }` to `keys.json` without touching other keys. Handle these in a `nextCommand()` loop.
- [ ] **Step 3: Verify scoping.** With a terminal focused, ⌘R must not reach the viewer. If it does, stop and ask Wira (spec: Calls made by the designer).
- [ ] **Step 4:** Check that `gif` and `webp` render with `image()`. Move any that don't to group 5 in `lib.js`, and update its test.
- [ ] **Step 5:** Run `herdr-app check $MOD`, then try each item and shortcut in the app. Commit: "Viewer: default app, Finder, menu and shortcuts".

### Task 5: Local edit, safe save, conflicts, unsaved-work guards

**Files:** Modify `$MOD/main.js`.

**Interfaces:**
- Consumes: `conflictName`, `Viewer.mode`, `Viewer.dirty`.
- Produces: `Viewer.save(cx): Promise<"saved"|"conflict"|"error">`, `Viewer.original: string` (the text as read), and the shared key `personalos-viewer.drafts`, an `{ [on+"|"+path]: { text, original, at } }` object.

- [ ] **Step 1:** Edit makes the editor writable. On the first change, set `dirty` and run `tab.rename` to `● <name>`. On save or discard, rename back to `<name>`.
- [ ] **Step 2:** Save calls `writeTextFile(path, text, original)`. On rejection, show a banner: "This file changed on disk since you opened it." with buttons **Reload** (read again, drop edits) and **Save as conflict file** (`writeTextFile(dir/conflictName(...), text, null)`, then a toast with the new name). If the file was deleted, the banner says "This file is no longer available" and offers only Save as conflict file.
- [ ] **Step 3:** ⋯ Close while dirty asks **Save / Discard / Cancel** (a `confirm`-style overlay), then runs `tab.close`.
- [ ] **Step 4:** Autosave a draft every 3 s while dirty into `personalos-viewer.drafts`, and delete it on save or discard. On open, if a draft exists, offer "Restore unsaved changes from <time>?". If the file changed since `draft.original`, use the Step 2 banner choices.
- [ ] **Step 5: Verify.** Edit a scratch file and save it, then confirm the content on disk. Edit it, run `echo x >> file` in a terminal, then save: the banner appears and the disk keeps `x`. Choose Save as conflict file: `file.conflict.ext` appears. Edit, close with ×, reopen: the draft is offered.
- [ ] **Step 6:** Commit: "Viewer: edit and safe save with conflict files and drafts".

### Task 6: Remote save (shared, recipe-reproducible)

**Files:** Create `$MOD/remote-save.js` (or a marked section, per Task 1). Modify `$MOD/lib.js` and `tests/lib.test.mjs`.

**Interfaces:**
- Produces:
  - In `lib.js` (pure): `chunkBase64(text: string, size = 65536): string[]`, `utf8ToBase64(text: string): string`, `remoteScripts(target: string): { append: string, check: string, commit: string, cleanup: string }`. Each is an `sh -c` script taking its values as positional `$1`, `$2` and so on, never spliced into the script text.
  - In `remote-save.js`: `saveRemote(path: string, on: string, text: string, original: string): Promise<"saved"|"conflict"|"unsupported"|"error">`.

- [ ] **Step 1: Failing tests.** Joining `chunkBase64` chunks and decoding them gives the original, including emoji and Indonesian text. Every chunk is at most 65536 characters. `remoteScripts` scripts contain no file name text, only `"$1"` and similar references. Run the scripts locally with `sh -c script sh <args>` on a temp dir: append plus commit writes the exact text. `check` exits 1 when the target hash differs from the hash passed in. This works with a target named `a b'$.md`.
- [ ] **Step 2:** Run `node --test tests/*.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement. `check` picks `sha256sum`, or else `shasum -a 256`, at run time, and `saveRemote` hashes `original` locally to compare. If `sh`, `base64` or a hash tool is missing, return "unsupported", and the toolbar shows "Read-only: this machine can't save remotely".
- [ ] **Step 4:** Wire it in: `Viewer.save` calls `saveRemote` when `on` is set. "conflict" uses the Task 5 banner, where Save as conflict file goes through `saveRemote(conflictPath, on, text, null)` (with `original` null, skip the check).
- [ ] **Step 5: Verify on a real remote machine** (any machine in `hc machine ls`). Do a normal save, then do a save after `echo x >> file` on that machine. Expected: saved, then the conflict banner.
- [ ] **Step 6:** Run `node --test tests/*.test.mjs`, then commit: "Viewer: editable remote text files".

### Task 7: Recipe, README and repo sync

**Files:** Modify the repo's `RECIPE.md` and `README.md`, and copy `$MOD/*` (without `gpui-kit.d.ts` and `jsconfig.json`) into `mods/personalos-viewer/`.

- [ ] **Step 1:** In `RECIPE.md`, "What you see" gets the toolbar and the card. "How it behaves" gets the modes and per-extension memory, saving, conflicts, drafts and shortcuts. "Built from" gets the file groups, the APIs and the four remote steps. "Watch out" gets the × hook gap, the race window, the 64 KB chunks, Windows read-only and the props note. "Done when" gets the spec's list.
- [ ] **Step 2:** In `README.md`, the install merges `mods/personalos-viewer/keys.json` into `keys.json`, and lists `node --test tests/*.test.mjs`.
- [ ] **Step 3:** `herdr-app check` passes for both mods. Drag-to-terminal and sideways scrolling in Files still work.
- [ ] **Step 4:** Commit: "Viewer: recipe and README for file actions". No push. K-261127-03 is still open.
