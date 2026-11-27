// A lazy file browser for the focused pane's folder, with bounded read-only previews.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, InputState, Input } from "gpui-base";
import { spaces, panes, focused, run, exec, readTextFile, watchFolder, theme, settings, window, props, shared, setShared, openOverlay, closeOverlay, notify, appHome } from "herdr";
import * as ops from "./ops.js";

// The context menu, the name dialog and the delete dialog are popup copies of this mod.
// They do the file work themselves, then post EVENT so the panel reloads (and opens `open`).
const CLIP = "file-explorer.clipboard", EVENT = "file-explorer.changed";
// Open folders per space, machine and root, kept in shared state so they survive space switches and restarts.
const OPEN = "file-explorer.open", OPEN_MAX = 300;
const openKey = (space, on, root) => `${space ?? ""}|${on ?? ""}|${root}`;
const loadOpen = (space, on, root) => (shared(OPEN) ?? {})[openKey(space, on, root)] ?? [];
const emit = (open, show, reveal) => setShared(EVENT, { seq: `${Date.now()}-${Math.random()}`, open: open ?? null, show: show ?? null, reveal: reveal ?? null });
// Copies of this mod share one script VM, so the panel's check reaches the popups too.
const viewer = globalThis[Symbol.for("file-explorer.viewer")] ??= { installed: true };
// Opens a file in a file-viewer tab, or (without that mod) asks the panel to show its built-in preview.
const openFile = (path, on) => viewer.installed
  ? run("tab.new", { name: path.split("/").pop(), mod: "file-viewer", props: { path, on: on ?? null } })
  : emit(null, path);
const fail = (title, error) => notify({ title, body: error, level: "error" });

// The panels share data in one VM, but their host tasks belong to separate copies.
const scans = globalThis[Symbol.for("herdr.repoStatus.v2")] ??= new Map();

async function repoStatus(root, on, { after, visiting, urgent, allowInactive }, cx, current) {
  const repo = JSON.stringify([on, root]), now = Date.now();
  for (const [key, scan] of scans) {
    if (scan.pollAt <= now || (!scan.pollAt && scan.task.is_done())) scans.delete(key);
  }
  while (current()) {
    let scan = scans.get(repo);
    const pending = scan && !scan.pollAt && !scan.task.is_done();
    const reusable = scan?.status?.code === 0 && Date.now() < scan.pollAt
      && (scan.started >= after || (!urgent && Date.now() < scan.watchAt));
    if (!reusable && (!pending || (visiting && scan.started !== undefined && scan.started < after))) {
      if (!allowInactive && window()?.active === false) return null;
      const next = {};
      next.task = cx.spawn(async cx => {
        await cx.sleep(25); // Let both listeners for a watch batch join before starting Git.
        if (!allowInactive && window()?.active === false) return;
        next.started = Date.now();
        try {
          next.status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd: root, on });
        } catch (error) {
          next.error = error;
        } finally {
          const finished = Date.now(), duration = finished - next.started;
          const delay = duration < 500 ? 0 : Math.min(60000, 5 * duration);
          next.watchAt = finished + delay;
          next.pollAt = finished + Math.max(10000, delay);
          if (next.status?.code !== 0 && scans.get(repo) === next) scans.delete(repo);
        }
      });
      scans.set(repo, next);
      scan = next;
    }
    // Resume through our own host task, so another copy's close cannot cancel our follow-up work.
    while (current() && !scan.pollAt && !scan.task.is_done()) await cx.sleep(50);
    if (!current()) return null;
    if (!scan.pollAt) continue; // The scanning copy closed or reloaded.
    return scan;
  }
  return null;
}

function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
}
const key = () => JSON.stringify(location());
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };
const PER_FOLDER = 500, TOTAL = 5000;

async function directory(path, on) {
  const windowsDirectory = async () => {
    // Windows PowerShell otherwise uses the console code page; exec decodes UTF-8.
    // Links keep directory attributes even when dangling; check their target.
    // Other reparse points (OneDrive's folders) have no LinkType and are folders.
    // PowerShell reads curly single quotes as quotes too, so they're doubled like '.
    const r = await exec("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $_.LinkType -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))) } }) | ConvertTo-Json -Compress } '" + path.replace(/['‘’‚‛]/g, "$&$&") + "'"], { on });
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  };
  if (!on && window()?.platform === "windows") return windowsDirectory();
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  let r;
  try { r = await exec("sh", ["-c", script, "files", path], { on }); }
  catch (e) {
    if (on && String(e).includes("cannot start sh: program not found")) return windowsDirectory();
    throw e;
  }
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

export default class Files extends View {
  init(_props, cx) {
    const p = props() ?? {};
    if (p.menu || p.ask || p.confirm || p.search) return this.initPopup(p, cx);
    this.lastEvent = shared(EVENT)?.seq;
    // Files open in the file-viewer mod when it is installed; without it, in the built-in preview.
    cx.spawn(async () => { try { viewer.installed = (await exec("test", ["-f", `${appHome()}/mods/file-viewer/main.js`])).code === 0; } catch {} });
    this.saved = new Map();
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {};
    this.refresh(cx);
    cx.timer.every(500, cx => this.refreshIfDue(cx));
  }

  refreshIfDue(cx) {
    if (this.revealed && Date.now() - this.revealedAt > 2500) { this.revealed = null; cx.notify(); }
    if (this.dropHover && Date.now() - (this.dropAt ?? 0) > 1500) { this.dropHover = null; cx.notify(); }
    const active = window()?.active !== false, context = this.context;
    const ev = shared(EVENT);
    if (ev && ev.seq !== this.lastEvent) {
      this.lastEvent = ev.seq;
      if (context) context.catchUp = true;
      if (ev.reveal && this.root && ops.isInside(ev.reveal, this.root)) { this.revealed = ev.reveal.slice(this.root.length + 1); this.revealedAt = Date.now(); }
      if (ev.show && this.root && ops.isInside(ev.show, this.root)) this.show(ev.show.slice(this.root.length + 1), cx);
      // Open every folder down to the one that changed, so a new or pasted item is in view.
      if (ev.open && this.root && ops.isInside(ev.open, this.root) && ev.open !== this.root) {
        const parts = ev.open.slice(this.root.length + 1).split("/");
        for (let i = 1; i <= parts.length; i++) this.folders.add(parts.slice(0, i).join("/"));
        this.saveOpen();
      }
    }
    const refocused = active && this.windowActive === false;
    this.windowActive = active;
    if (!context) return;
    if (refocused && (context.dirtyAt || !context.watch)) context.catchUp = true;
    if (!active || this.loading) return;
    const now = Date.now();
    if (context.catchUp || (context.dirtyAt && now >= context.watchAt) || now >= context.pollAt) this.refresh(cx);
  }

  watch(root, context, cx) {
    if (context.on || context.watch?.root === root) return;
    context.watch?.pending?.cancel();
    const watch = { root };
    context.watch = watch;
    cx.spawn(async cx => {
      try {
        while (this.context === context && context.watch === watch) {
          watch.pending = watchFolder(root);
          const paths = await watch.pending;
          if (paths.length && context.watch === watch && this.current(context)) {
            context.dirtyAt = Date.now() + 1;
            this.refreshIfDue(cx);
          }
        }
      } catch {
        if (context.watch === watch) context.watch = null;
      }
    });
  }

  current(context) {
    return this.context === context && key() === context.key;
  }

  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  refresh(cx) {
    const { cwd, on, space } = location(), next = key();
    const visiting = next !== this.context?.key;
    if (visiting) {
      if (this.context) {
        this.saved.set(this.context.key, { folders: this.folders, file: this.file });
        this.context.watch?.pending?.cancel();
      }
      const saved = this.saved.get(next);
      this.context = { key: next, cwd, on, space, dirtyAt: 0 }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders ?? loadOpen(space, on, cwd));
      this.pending = new Set(); this.marks = {}; this.show(null); this.error = null; this.limited = false;
      this.loading = false;
      if (saved?.file) this.show(saved.file, cx);
    }
    const context = this.context;
    const now = Date.now();
    if (!cwd) {
      context.catchUp = false;
      context.dirtyAt = 0;
      context.pollAt = now + 10000;
      return;
    }
    if (this.loading) return;
    if (context.catchUp && !context.dirtyAt) context.dirtyAt = now + 1;
    const request = {
      after: visiting ? now + 1 : context.dirtyAt || (context.lastStatus ?? -1) + 1,
      visiting,
      urgent: visiting || context.catchUp,
      allowInactive: visiting,
    };
    context.catchUp = false;
    context.pollAt = context.watchAt = now + 10000;
    this.loading = true;
    this.limited = false;
    cx.spawn(async cx => {
      try {
        this.watch(cwd, context, cx);
        const dirtyAtListing = context.dirtyAt;
        let gone = false;
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          if (!path) { await this.loadFolder(path, context); continue; }
          if (!this.folders.has(path)) continue;
          // A remembered folder that was deleted or renamed is forgotten instead of failing the whole list.
          try { await this.loadFolder(path, context); }
          catch { for (const f of [...this.folders]) if (f === path || f.startsWith(path + "/")) { this.folders.delete(f); this.entries.delete(f); } gone = true; }
        }
        if (gone) this.saveOpen();
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        if (!this.current(context)) return;
        const marks = {};
        let covered = dirtyAtListing;
        if (top?.code === 0) {
          const root = top.stdout.trim();
          const scan = await repoStatus(root, on, request, cx, () => this.context === context);
          if (!scan || !this.current(context)) return;
          const { status, started, pollAt, watchAt } = scan;
          context.lastStatus = started;
          context.pollAt = pollAt;
          context.watchAt = watchAt;
          covered = Math.min(dirtyAtListing, started);
          if (request.urgent && request.after > started) context.catchUp = true;
          if (status?.code === 0) for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = entry.slice(0, 2);
            marks[`${root}/${entry.slice(3)}`] = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
          }
        } else {
          context.watchAt = Date.now();
        }
        if (!this.current(context)) return;
        if (context.dirtyAt <= covered) context.dirtyAt = 0;
        this.marks = marks; this.error = null;
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally {
        if (this.context === context) this.loading = false;
        cx.notify();
      }
    });
  }

  saveOpen() {
    if (!this.root) return;
    const all = { ...(shared(OPEN) ?? {}) }, k = openKey(this.context?.space, this.on, this.root);
    delete all[k];
    if (this.folders.size) all[k] = [...this.folders];
    // Newest last; drop the oldest roots beyond the cap.
    const keys = Object.keys(all);
    for (const old of keys.slice(0, Math.max(0, keys.length - OPEN_MAX))) delete all[old];
    setShared(OPEN, all);
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending.add(path);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (this.current(context)) this.error = String(e); }
          finally { if (this.context === context) this.pending.delete(path); cx.notify(); }
        });
      }
    }
    this.saveOpen();
    cx.notify();
  }

  // Opens a file in its own tab, as large as a terminal.
  open(path, cx) {
    if (!viewer.installed) return this.show(path, cx);
    openFile(`${this.root}/${path}`, this.on);
  }

  show(path, cx) {
    this.code?.release(); this.code = null; this.file = path; this.fileError = null;
    if (!path || !cx) return;
    const context = this.context, root = this.root, on = this.on;
    cx.spawn(async cx => {
      try {
        const text = await readTextFile(`${root}/${path}`, { on });
        if (this.file !== path || !this.current(context)) return;
        if (text === null) { this.fileError = "This file is no longer available"; return; }
        if (text.includes("\0")) { this.fileError = "Binary file · no text preview"; return; }
        const t = theme(), ext = path.includes(".") ? path.split(".").pop() : "txt";
        this.code = EditorState.new({ language: LANG[ext] ?? ext, readonly: true,
          value: text.length > 400000 ? text.slice(0, 400000) + "\n… (file truncated)" : text,
          syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
      } catch { if (this.file === path && this.current(context)) this.fileError = "Cannot preview this file (binary, too large, or unreadable)"; }
      finally { cx.notify(); }
    });
  }

  // Builds the rows once per render and measures them; treeRows hands back the same rows.
  treeWidth(t) {
    // No text measuring in gpui-kit: about 0.48 em per character in the UI font (measured on long names), plus a little slack per row.
    this.charW = 0.48 * (Number(settings()?.ui_font_size) || 13);
    this.widest = 0; this.rowsCache = this.rows("", 0, [], t); return Math.ceil(this.widest + 12); }
  treeRows() { return this.rowsCache ?? []; }

  rows(prefix, depth, out, t) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      // Rough width of this row, so the tree can be wider than the panel and scroll sideways.
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path), mark = this.marks[`${this.root}/${path}`];
      this.widest = Math.max(this.widest ?? 0, 8 + depth * 18 + 12 + 7 + 14 + 7 + entry.name.length * this.charW + 10 + 7 + 16);
      out.push(h_flex().id(`file-${path}`).h(28).flex_none().pl(8 + depth * 18).pr(8).gap(7).items_center().rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
        // Holding Option turns the native drag (paths into a terminal) off, so our own move-drag can run.
        .when(!(this.altHeld || this.moving), el => el.drag_paths([`${this.root}/${path}`], { on: this.on ?? null }))
        .when((Boolean(this.moving) || Boolean(this.dropHover)) && (this.moving ? this.moveTarget : this.dropHover) === (entry.dir ? `${this.root}/${path}` : null), el => el.bg(t.hover).border_1().border_color(t.accent))
        .when(this.moving?.src === `${this.root}/${path}`, el => el.opacity(0.5))
        .when(this.revealed === path, el => el.bg(t.hover).border_1().border_color(t.accent))
        .on_mouse_down("left", (e, cx) => { this.pressing = true; if (e.modifiers.alt) { cx.stop_propagation(); this.moving = { src: `${this.root}/${path}` }; this.moveTarget = null; cx.notify(); } })
        .on_mouse_move((e, cx) => {
          // A drag from Finder arrives as moves with the left button held, but no press started here.
          if (!this.moving && !this.pressing && e.pressed_button === "left") {
            const target = entry.dir ? `${this.root}/${path}` : ops.parentOf(`${this.root}/${path}`);
            this.dropAt = Date.now();
            if (target !== this.dropHover) { this.dropHover = target; cx.notify(); }
            return;
          }
          if (!this.moving) return; const target = entry.dir ? `${this.root}/${path}` : ops.parentOf(`${this.root}/${path}`); if (target !== this.moveTarget) { this.moveTarget = target; cx.notify(); } })
        .on_mouse_up("left", (_e, cx) => { this.pressing = false; if (this.moving) { cx.stop_propagation(); this.finishMove(entry.dir ? `${this.root}/${path}` : ops.parentOf(`${this.root}/${path}`), cx); } })
        .on_click((e, cx) => { if (e.modifiers.alt) return; entry.dir ? this.toggle(path, cx) : this.open(path, cx); })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.openMenu({ path: `${this.root}/${path}`, dir: entry.dir }); })
        .on_drop((e, cx) => { cx.stop_propagation(); this.dropInto(entry.dir ? `${this.root}/${path}` : ops.parentOf(`${this.root}/${path}`), e.paths); })
        // Git mark first, in a fixed slot, so it stays visible however far the tree scrolls sideways.
        .child(div().w(10).flex_none().text_size(11).text_color(mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked).child(mark ?? ""))
        .child(entry.dir ? svg(`mods/file-explorer/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
        .child(svg(`mods/file-explorer/${entry.dir ? "folder" : "file"}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_none().whitespace_nowrap().child(entry.name)));
      if (entry.dir && open) this.rows(path, depth + 1, out, t);
    }
    return out;
  }

  // ---- Context menu (VS Code style) ----

  openMenu(entry) {
    const local = !this.on, clip = shared(CLIP), file = !entry.dir;
    const canPaste = Boolean(clip && (clip.on ?? null) === (this.on ?? null));
    const items = [
      file && ["Open", "open"],
      file && local && ["Open in Default App", "openApp"],
      local && ["Reveal in Finder", "reveal"],
      entry.dir && ["Open in Terminal", "terminal"],
      null,
      ["New File…", "newFile"],
      ["New Folder…", "newFolder"],
      null,
      !entry.root && ["Cut", "cut"],
      !entry.root && ["Copy", "copy"],
      canPaste && [`Paste ${ops.baseName(clip.path)}`, "paste"],
      !entry.root && ["Duplicate", "duplicate"],
      null,
      ["Copy Path", "copyPath"],
      !entry.root && ["Copy Relative Path", "copyRelative"],
      !entry.root && null,
      !entry.root && ["Rename…", "rename"],
      !entry.root && ["Delete", "delete"],
    ].filter(x => x !== false);
    // Drop separators at the ends and doubled ones.
    const tidy = items.filter((x, i, a) => x || (i > 0 && i < a.length - 1 && a[i - 1]));
    openOverlay({ mod: "file-explorer", kind: "popup", width: 240, props: { menu: true, entry, on: this.on ?? null, root: this.root, items: tidy } });
  }

  initPopup(p, cx) {
    this.popup = p; this.at = -1; this.err = null; this.busy = false;
    this.handle = cx.focus_handle(); this.handle.focus();
    if (p.search) {
      this.all = null; this.hits = []; this.at = 0;
      this.input = InputState.new({ value: "", placeholder: "Search files and folders by name" });
      this.input.on("change", (_e, cx) => { this.filter(); cx.notify(); });
      this.input.on("submit", (_e, cx) => this.pick(this.at, cx));
      this.input.focus();
      cx.timer.after(300, () => this.input.focus());
      cx.spawn(async cx => {
        try { this.all = await ops.listAll(p.root, p.on); } catch (e) { this.all = []; this.err = String(e); }
        this.filter(); cx.notify();
      });
      return;
    }
    if (p.ask) {
      const value = p.ask === "rename" ? ops.baseName(p.entry.path) : "";
      this.input = InputState.new({ value, placeholder: p.ask === "newFolder" ? "folder name" : "file name" });
      const dot = value.lastIndexOf(".");
      if (value) this.input.set_selected_range({ start: 0, end: dot > 0 && !p.entry.dir ? dot : value.length });
      this.input.on("change", (_e, cx) => { this.err = null; cx.notify(); });
      this.input.on("submit", (_e, cx) => this.submitName(cx));
      this.input.focus();
      cx.timer.after(300, () => this.input.focus());
    }
  }

  // ---- Quick Open ----

  openSearch() {
    if (!this.root) return;
    openOverlay({ mod: "file-explorer", kind: "dialog", width: 640, props: { search: true, root: this.root, on: this.on ?? null } });
  }

  filter() {
    this.hits = this.all ? ops.searchPaths(this.all, this.input.value(), 60) : [];
    this.at = 0;
  }

  // A file opens (in the viewer when installed); a folder is opened in the tree and highlighted.
  pick(i, cx) {
    const rel = this.hits[i];
    if (rel == null) return;
    const { root, on } = this.popup, abs = ops.joinPath(root, rel.replace(/\/$/, ""));
    this.dismiss();
    if (rel.endsWith("/")) emit(abs, null, abs);
    else { emit(ops.parentOf(abs), null, abs); openFile(abs, on); }
  }

  renderSearch(t) {
    const p = this.popup, q = this.input.value().trim();
    const row = (rel, i) => {
      const dir = rel.endsWith("/"), clean = rel.replace(/\/$/, ""), cut = clean.lastIndexOf("/");
      const name = clean.slice(cut + 1), where = cut > 0 ? clean.slice(0, cut) : "";
      return h_flex().id(`qo-${i}`).h(30).px(8).gap(8).rounded(6).items_center().cursor_pointer()
        .when(i === this.at, el => el.bg(t.hover))
        .on_mouse_move((_e, cx) => { if (this.at !== i) { this.at = i; cx.notify(); } })
        .on_click((_e, cx) => this.pick(i, cx))
        .child(svg(`mods/file-explorer/${dir ? "folder" : "file"}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_none().whitespace_nowrap().child(name))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(where));
    };
    const note = text => div().px(8).py(10).text_size(12).text_color(t.dim).child(text);
    return v_flex().id("pf-search").track_focus(this.handle).w_full().p(10).gap(8).bg(t.popover).text_color(t.foreground).text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "escape") { this.dismiss(); cx.stop_propagation(); return; }
        if (!this.hits.length) return;
        if (e.key === "down") this.at = (this.at + 1) % this.hits.length;
        else if (e.key === "up") this.at = (this.at + this.hits.length - 1) % this.hits.length;
        else return;
        cx.stop_propagation(); cx.notify();
      })
      .child(Input.new(this.input).h(36).px(10).rounded(9).border_1().border_color(t.accent).bg(t.background).text_size(13).text_color(t.foreground))
      .child(v_flex().id("qo-list").max_h(420).overflow_y_scrollbar()
        .when(this.all === null, el => el.child(note("Listing files…")))
        .when(this.all !== null && !q, el => el.child(note(`${this.all.length.toLocaleString()} files and folders in ${ops.baseName(p.root) || p.root}. Type part of a name; several words narrow it down.`)))
        .when(this.all !== null && Boolean(q) && !this.hits.length, el => el.child(note("No matches")))
        .children(this.hits.map(row)));
  }

  // Not named close(): Herdr calls a view's close() itself when it goes away.
  dismiss() { if (this.popup) closeOverlay(this.popup.overlay); }

  // Runs one menu choice. Called on the popup copy, which carries entry, on and root in its props.
  async act(a, cx) {
    const { entry, on, root } = this.popup, path = entry.path, dir = entry.dir ? path : ops.parentOf(path);
    const dialog = extra => openOverlay({ mod: "file-explorer", kind: "dialog", width: 380, modal: true, props: { entry, on, root, ...extra } });
    // Slow work finishes before the popup closes: closing it ends this copy and its pending tasks.
    if (a === "duplicate" || a === "paste" || a === "delete") { if (this.busy) return; this.busy = true; cx.notify(); }
    else this.dismiss();
    if (a === "open") openFile(path, on);
    else if (a === "openApp") exec("open", [path]).catch(() => {});
    else if (a === "reveal") exec("open", entry.root ? [path] : ["-R", path]).catch(() => {});
    else if (a === "terminal") run("tab.new", { folder: path, name: ops.baseName(path) });
    else if (a === "newFile" || a === "newFolder" || a === "rename") dialog({ ask: a });
    else if (a === "cut" || a === "copy") setShared(CLIP, { path, on, cut: a === "cut" });
    else if (a === "copyPath") cx.write_to_clipboard(path);
    else if (a === "copyRelative") cx.write_to_clipboard(path.slice(root.length + 1));
    else if (a === "duplicate") { const r = await ops.duplicate(path, on); this.dismiss(); r.ok ? emit(ops.parentOf(r.path)) : fail("Duplicate failed", r.error); }
    else if (a === "paste") {
      const clip = shared(CLIP);
      if (!clip) return this.dismiss();
      const r = await ops.paste(clip.path, dir, { cut: clip.cut, on });
      this.dismiss();
      if (!r.ok) return fail("Paste failed", r.error);
      if (clip.cut) setShared(CLIP, null);
      emit(dir);
    }
    else if (a === "delete") { const trash = await ops.canTrash(on); this.dismiss(); dialog({ confirm: true, trash }); }
  }

  async submitName(cx) {
    if (this.busy) return;
    const { ask, entry, on } = this.popup, name = this.input.value().trim();
    const bad = ops.validName(name);
    if (bad) { this.err = bad; cx.notify(); return; }
    const dir = ask === "rename" ? ops.parentOf(entry.path) : (entry.dir ? entry.path : ops.parentOf(entry.path));
    const target = ops.joinPath(dir, name);
    if (ask === "rename" && target === entry.path) { this.dismiss(); return; }
    this.busy = true;
    const r = ask === "newFile" ? await ops.newFile(target, on) : ask === "newFolder" ? await ops.newFolder(target, on) : await ops.rename(entry.path, target, on);
    this.busy = false;
    if (!r.ok) { this.err = r.error; cx.notify(); return; }
    this.dismiss();
    emit(ask === "newFolder" ? target : dir);
    if (ask === "newFile") openFile(target, on);
  }

  async confirmDelete(cx) {
    if (this.busy) return;
    const { entry, on, trash } = this.popup;
    this.busy = true; cx.notify();
    const r = trash ? await ops.trash(entry.path) : await ops.removeForever(entry.path, on);
    this.busy = false;
    if (!r.ok) { this.err = r.error; cx.notify(); return; }
    const clip = shared(CLIP);
    if (clip && ops.isInside(clip.path, entry.path)) setShared(CLIP, null);
    this.dismiss();
    emit(null);
  }

  // Option-drag inside the tree: Herdr only delivers on_drop for drags from outside the app,
  // so a move within the tree is tracked with plain mouse events instead.
  async finishMove(dir, cx) {
    const src = this.moving?.src;
    this.moving = null; this.moveTarget = null; cx.notify();
    if (!src || ops.parentOf(src) === dir) return;
    const r = await ops.paste(src, dir, { cut: true, on: this.on });
    if (!r.ok) return fail(`Couldn't move ${ops.baseName(src)}`, r.error);
    const clip = shared(CLIP);
    if (clip && ops.isInside(clip.path, src)) setShared(CLIP, null);
    emit(dir);
  }

  // Drops: from inside this folder a drop moves (like VS Code); from Finder it copies.
  async dropInto(dir, paths) {
    this.dropHover = null; this.pressing = false;
    // Finder paths are on this Mac. In a remote space they are uploaded to that machine.
    if (this.on && paths?.length) notify({ title: `Copying ${paths.length === 1 ? ops.baseName(paths[0]) : paths.length + " items"} to ${this.on}…`, level: "info", timeout: 3000 });
    for (const src of paths ?? []) {
      if (this.on) { const r = await ops.upload(src, dir, this.on); if (!r.ok) fail(`Couldn't copy ${ops.baseName(src)} to ${this.on}`, r.error); continue; }
      const r = await ops.paste(src, dir, { cut: ops.isInside(src, this.root) });
      if (!r.ok) fail(`Couldn't ${ops.isInside(src, this.root) ? "move" : "copy"} ${ops.baseName(src)}`, r.error);
    }
    emit(dir);
  }

  renderPopup() {
    const t = theme(), p = this.popup;
    if (p.search) return this.renderSearch(t);
    const button = (id, text, primary, danger, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? (danger ? t.ansi1 : t.solid) : t.input).bg(primary ? (danger ? t.ansi1 : t.solid) : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover(s => s.opacity(0.88)).on_click((_e, cx) => action(cx)).child(text);
    const error = () => div().pt(8).text_size(11.5).text_color(t.ansi1).child(this.err ?? "");
    if (p.ask) {
      const title = { newFile: "New file", newFolder: "New folder", rename: `Rename ${ops.baseName(p.entry.path)}` }[p.ask];
      return v_flex().id("pf-ask").track_focus(this.handle).w_full().p(18).bg(t.popover).text_color(t.foreground)
        .on_key_down((e, cx) => { if (e.key === "escape") { this.dismiss(); cx.stop_propagation(); } })
        .child(div().text_size(15).font_semibold().child(title))
        .child(div().pt(4).text_size(11.5).text_color(t.dim).truncate().child(`in ${p.ask === "rename" || !p.entry.dir ? ops.parentOf(p.entry.path) : p.entry.path}`))
        .child(div().pt(12).child(Input.new(this.input).h(36).px(10).rounded(9).border_1().border_color(this.err ? t.ansi1 : t.accent).bg(t.background).text_size(12.8).text_color(t.foreground)))
        .when(Boolean(this.err), el => el.child(error()))
        .child(h_flex().pt(18).gap(8).justify_end()
          .child(button("pf-cancel", "Cancel", false, false, () => this.dismiss()))
          .child(button("pf-ok", p.ask === "rename" ? "Rename" : "Create", true, false, cx => this.submitName(cx))));
    }
    if (p.confirm) {
      const name = ops.baseName(p.entry.path);
      return v_flex().id("pf-confirm").track_focus(this.handle).w_full().p(18).bg(t.popover).text_color(t.foreground)
        .on_key_down((e, cx) => { if (e.key === "escape") { this.dismiss(); cx.stop_propagation(); } else if (e.key === "enter") this.confirmDelete(cx); })
        .child(div().text_size(15).font_semibold().child(p.trash ? `Move ${name} to Trash?` : `Delete ${name} permanently?`))
        .child(div().pt(6).text_size(12).text_color(t.dim).child(p.trash ? "You can restore it from the Trash." : `This machine${p.on ? ` (${p.on})` : ""} has no Trash. It can't be undone.`))
        .when(Boolean(this.err), el => el.child(error()))
        .child(h_flex().pt(18).gap(8).justify_end()
          .child(button("pf-cancel", "Cancel", false, false, () => this.dismiss()))
          .child(button("pf-del", this.busy ? "Deleting…" : p.trash ? "Move to Trash" : "Delete", true, true, cx => this.confirmDelete(cx))));
    }
    const items = p.items ?? [], real = items.map((x, i) => x ? i : -1).filter(i => i >= 0);
    const choose = (i, cx) => { const it = items[i]; if (it) this.act(it[1], cx); };
    return v_flex().id("pf-menu").track_focus(this.handle).w_full().p(5).bg(t.popover).text_size(12.8).text_color(t.foreground)
      .on_key_down((e, cx) => {
        const k = real.indexOf(this.at);
        if (e.key === "down") this.at = real[(k + 1) % real.length];
        else if (e.key === "up") this.at = real[(k <= 0 ? real.length : k) - 1];
        else if (e.key === "enter") { if (this.at >= 0) choose(this.at, cx); }
        else if (e.key === "escape") this.dismiss();
        else return;
        cx.notify();
      })
      .children(items.map((it, i) => it
        ? h_flex().id(`pf-${i}`).h(28).px(8).rounded(6).items_center().justify_between().cursor_pointer()
          .when(i === this.at, el => el.bg(t.hover))
          .when(it[1] === "delete", el => el.text_color(t.ansi1))
          .on_mouse_move((_e, cx) => { if (this.at !== i) { this.at = i; cx.notify(); } })
          .on_click((_e, cx) => choose(i, cx))
          .child(div().child(it[0])).child(div().text_size(11.5).text_color(t.dim).child(it[2] ?? ""))
        : div().id(`pf-sep-${i}`).h(1).mx(6).my(4).bg(t.border)));
  }

  render(cx) {
    if (this.popup) return this.renderPopup();
    if (key() !== this.context?.key) this.refresh(cx);
    else this.refreshIfDue(cx);
    const t = theme();
    const font = this.code ? settings() : null;
    return v_flex().id("files").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .when(Boolean(this.file), el => el.child(div().id("files-back").w(20).cursor_pointer().text_color(t.muted).on_click((_e, cx) => { this.show(null); cx.notify(); }).child("←")))
        .child(div().font_semibold().child("Files"))
        .when(Boolean(this.root) && !this.file, el => el.child(div().id("files-search").p(3).rounded(5).cursor_pointer().hover(s => s.bg(t.hover))
          .on_click(() => this.openSearch()).child(svg("mods/file-explorer/search.svg").size(14).text_color(t.muted))))
        .when(Boolean(this.moving), el => el.child(div().text_size(11.5).text_color(t.accent).child(`Moving ${ops.baseName(this.moving.src)}${this.moveTarget ? " → " + (ops.baseName(this.moveTarget) || "/") : ""}`)))
        .when(!this.moving && Boolean(this.dropHover), el => el.child(div().text_size(11.5).text_color(t.accent).child(`Copy into ${ops.baseName(this.dropHover) || "/"}`)))
        .when(!this.moving && !this.dropHover && Boolean(this.altHeld), el => el.child(div().text_size(11.5).text_color(t.dim).child("⌥ drag to move")))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(this.file ?? this.root?.split(/[\\/]/).pop() ?? "")))
      .when(!this.file, el => el.child(h_flex().id("files-hscroll").flex_1().min_h(0).min_w(0).overflow_x_scroll().child(v_flex().id("files-tree").flex_none().h_full().min_w_full().w(this.treeWidth(t)).overflow_y_scrollbar().p(6)
        .on_mouse_down("right", () => { if (this.root) this.openMenu({ path: this.root, dir: true, root: true }); })
        .on_mouse_move((e, cx) => {
          const alt = Boolean(e.modifiers?.alt);
          if (alt !== Boolean(this.altHeld)) { this.altHeld = alt; cx.notify(); }
          // The button came up outside a row (or outside the panel): cancel.
          if (this.moving && !e.pressed_button) { this.moving = null; this.moveTarget = null; cx.notify(); }
          if (!e.pressed_button) { this.pressing = false; if (this.dropHover) { this.dropHover = null; cx.notify(); } }
        })
        .on_mouse_up("left", (_e, cx) => { this.pressing = false; if (this.moving && this.root) this.finishMove(this.root, cx); })
        .on_drop((e, cx) => { cx.stop_propagation(); if (this.root) this.dropInto(this.root, e.paths); })
        .children(this.treeRows())
        .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
        .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total"))))))
      .when(Boolean(this.file), el => el.child(this.code
        ? Editor.new(this.code).font_family(font.font_family).text_size(font.font_size).flex_1().min_h(0)
        : div().p(12).text_color(t.dim).child(this.fileError || "Loading file…")));
  }
}
