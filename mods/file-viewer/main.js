// A file viewer that fills a whole tab. Props: { path, on }.
// What it offers depends on the file's group (see lib.js): Raw, Render, Edit,
// Open in default app and Show in Finder.
import { View, div, image } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, TextView } from "gpui-base";
import { readTextFile, writeTextFile, notify, theme, settings, props, shared, setShared, exec, home, appHome, run, nextCommand, openOverlay, closeOverlay } from "herdr";
import { canSaveRemote, saveRemote } from "./remote-save.js";
import { groupOf, actionsFor, pickMode, extOf, cacheName, conflictName } from "./lib.js";

const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };
const LIMIT = 400000;
const MODES_KEY = "file-viewer.modes";
const DRAFTS_KEY = "file-viewer.drafts";

function middle(s, max = 90) {
  return s.length <= max ? s : s.slice(0, max / 2 - 1) + "…" + s.slice(-(max / 2 - 1));
}

function sizeLabel(n) {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default class Viewer extends View {
  init(_props, cx) {
    const p = props() ?? {};
    if (p.menu || p.confirm) { this.menu = p; this.handle = cx.focus_handle(); this.handle.focus(); this.at = 0; return; }
    this.path = p.path ?? null; this.on = p.on ?? null;
    this.name = this.path ? this.path.split(/[\\/]/).pop() : "";
    this.ext = extOf(this.name);
    this.mode = null; this.text = null; this.code = null; this.error = this.path ? null : "No file";
    if (this.path) this.load(cx);
    // Shortcuts and menu choices arrive as commands; Herdr delivers them to the focused copy only.
    cx.spawn(async cx => { for (;;) { this.command(await nextCommand(), cx); cx.notify(); } });
    cx.timer.every(3000, () => this.saveDraft());
  }

  command(c, cx) {
    if (c === "open") this.openApp();
    else if (c === "finder") this.showInFinder();
    else if (c === "render") { if (this.actions?.raw && this.actions?.render) this.setMode(this.mode === "render" ? "raw" : "render", cx); }
    else if (c === "close") this.askClose(cx);
    else if (c === "edit") this.startEdit(this.text, cx);
    else if (c === "save") this.save(cx);
    else if (c === "close-save") this.save(cx).then(r => { if (r === "saved") run("tab.close"); });
    else if (c === "reload") this.reload(cx);
    else if (c === "zoom-in") { if (this.img) this.setZoom(this.scale() * 1.25, cx); }
    else if (c === "zoom-out") { if (this.img) this.setZoom(this.scale() / 1.25, cx); }
    else if (c === "zoom-fit") { if (this.img) this.setZoom(null, cx); }
    else if (c === "save-conflict") { if (this.mode === "edit") this.saveAsConflict(cx); }
    else if (c === "close-discard") { this.dropDraft(); run("tab.close"); }
  }

  // Herdr calls a view's close() itself when its tab closes, so the name close is taken.
  // Ours must not run tab.close there, or a second tab.close hits the last tab and asks to close the space.
  close() { this.saveDraft(); }

  askClose(_cx) {
    if (!this.dirty) { run("tab.close"); return; }
    openOverlay({ mod: "file-viewer", kind: "dialog", width: 380, modal: true,
      props: { confirm: true, name: this.name, items: [["Save", "close-save", "⌘S"], ["Discard changes", "close-discard", ""], ["Cancel", "", "esc"]] } });
  }

  draftKey() { return this.path ? `${this.on ?? ""}|${this.path}` : null; }

  saveDraft() {
    if (!this.dirty || !this.editCode) return;
    setShared(DRAFTS_KEY, { ...(shared(DRAFTS_KEY) ?? {}), [this.draftKey()]: { text: this.editCode.value(), original: this.original, at: Date.now() } });
  }

  dropDraft() {
    const all = { ...(shared(DRAFTS_KEY) ?? {}) };
    if (all[this.draftKey()]) { delete all[this.draftKey()]; setShared(DRAFTS_KEY, all); }
  }

  setDirty(dirty) {
    if (this.dirty === dirty) return;
    this.dirty = dirty;
    run("tab.rename", { name: dirty ? `● ${this.name}` : this.name });
  }

  // Edit is a writable editor over `value`; it is never remembered as the file type's mode.
  startEdit(value, cx) {
    if (!this.actions?.edit || this.mode === "edit") return;
    if (this.banner?.kind === "draft" && value !== shared(DRAFTS_KEY)?.[this.draftKey()]?.text) return;   // restore or discard the draft first
    const t = theme();
    this.editCode?.release();
    this.editCode = EditorState.new({ language: LANG[this.ext] ?? (this.ext || "txt"), value: value ?? "",
      syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
    this.editCode.on("change", (_e, cx) => { this.setDirty(this.editCode.value() !== this.original); cx.notify(); });
    this.mode = "edit";
    this.editCode.focus();
    cx?.notify();
  }

  stopEdit(cx) {
    this.editCode?.release(); this.editCode = null;
    this.setDirty(false); this.dropDraft();
    this.mode = pickMode(shared(MODES_KEY)?.[this.ext], this.actions);
    cx?.notify();
  }

  // Saves only if the file still holds what was read; otherwise shows the conflict banner.
  async save(cx) {
    if (this.mode !== "edit" || !this.editCode) return "error";
    const text = this.editCode.value();
    try {
      await this.write(this.path, text, this.original);
    } catch (e) {
      // Only a real outside change is a conflict. Any other failure keeps the editor and the draft.
      let now = null;
      try { now = await readTextFile(this.path, { on: this.on }); } catch {}
      if (now === null) this.banner = { kind: "gone" };
      else if (now !== this.original) this.banner = { kind: "conflict" };
      else this.banner = { kind: "error", reason: String(e?.message ?? e ?? "") };
      cx?.notify();
      return now !== null && now === this.original ? "error" : "conflict";
    }
    this.text = this.original = text; this.banner = null;
    this.buildCode(); this.setDirty(false); this.dropDraft();
    cx?.notify();
    return "saved";
  }

  // Local files use Herdr's check-and-write; remote ones use remote-save.js.
  async write(path, text, expected) {
    if (!this.on) return writeTextFile(path, text, expected);
    const r = await saveRemote(path, this.on, text, expected);
    if (r !== "saved") throw new Error(r);
    return null;
  }

  async reload(cx) {
    let text = null;
    try { text = await readTextFile(this.path, { on: this.on }); } catch {}
    this.banner = null;
    if (text === null) { this.error = "This file is no longer available"; this.stopEdit(cx); return; }
    this.text = this.original = text; this.buildCode(); this.stopEdit(cx);
  }

  async saveAsConflict(cx) {
    const text = this.editCode?.value() ?? "";
    const dir = this.path.slice(0, this.path.lastIndexOf("/"));
    let names = new Set();
    try {
      const r = await exec("ls", ["-A", dir], { on: this.on });
      names = new Set(r.stdout.split("\n"));
    } catch {}
    const name = conflictName(this.name, n => names.has(n));
    try {
      await this.write(`${dir}/${name}`, text, null);
      notify({ title: `Your edits were saved as ${name}` });
      await this.reload(cx);
    } catch { notify({ title: "Could not save the conflict file" }); }
  }

  restoreDraft(cx) {
    const d = shared(DRAFTS_KEY)?.[this.draftKey()];
    this.banner = null;
    if (!d) return;
    const disk = this.original;
    this.startEdit(d.text, cx);
    this.original = d.original;     // a later save checks the file against where the draft began
    this.setDirty(true);
    if (disk !== d.original) this.banner = { kind: "conflict" };
    cx?.notify();
  }

  showInFinder() { if (this.actions?.finder) exec("open", ["-R", this.path]).catch(() => {}); }

  menuItems() {
    const a = this.actions ?? {};
    return [
      a.openApp && ["Open in default app", "open", "⌘O"],
      a.finder && ["Show in Finder", "finder", ""],
      this.mode === "edit" && ["Save", "save", "⌘S"],
      ["Close", "close", ""],
    ].filter(Boolean);
  }

  openMenu() {
    openOverlay({ mod: "file-viewer", kind: "popup", width: 220, props: { menu: true, items: this.menuItems() } });
  }

  load(cx) {
    const path = this.path, on = this.on;
    cx.spawn(async cx => {
      // Images and known binaries are classified by extension alone; reading them as text throws.
      const byExt = groupOf(this.name, null);
      let text = null, unreadable = false;
      if (byExt <= 3) {
        try { text = await readTextFile(path, { on }); } catch { unreadable = true; }
        if (text === null && !unreadable) { this.error = "This file is no longer available"; cx.notify(); return; }
      }
      this.group = byExt >= 4 ? byExt : unreadable ? 5 : groupOf(this.name, text);
      if (this.group <= 3 && (text == null || text.includes("\0"))) this.group = 5;
      this.text = this.group <= 3 ? text : null;
      this.original = this.text;
      const draft = this.draftKey() && shared(DRAFTS_KEY)?.[this.draftKey()];
      if (draft && this.text != null && draft.text !== this.text) this.banner = { kind: "draft", at: draft.at };
      this.tooLarge = this.text != null && this.text.length > LIMIT;
      this.remoteWritable = on && this.group <= 3 ? await canSaveRemote(on) : true;
      this.actions = actionsFor(this.group, { remote: Boolean(on), tooLarge: this.tooLarge, remoteWritable: this.remoteWritable });
      this.mode = pickMode(shared(MODES_KEY)?.[this.ext], this.actions);
      if (this.group === 4) { if (on) this.mode = "card"; else this.loadImage(cx); }
      if (this.mode === "card") this.loadSize(cx);
      this.buildCode();
      cx.notify();
    });
  }

  loadSize(cx) {
    const local = !this.on;
    cx.spawn(async cx => {
      try {
        const r = await exec(local ? "stat" : "wc", local ? ["-f", "%z", this.path] : ["-c", this.path], { on: this.on });
        this.size = r.code === 0 ? Number(r.stdout.trim().split(/\s+/)[0]) : null;
      } catch { this.size = null; }
      cx.notify();
    });
  }

  // image() only loads paths inside the app folder, so link the file there and read its size.
  loadImage(cx) {
    const dir = `${appHome()}/data/file-viewer/images`, name = cacheName(this.path);
    cx.spawn(async cx => {
      try {
        const r = await exec("sh", ["-c", 'mkdir -p "$1" && ln -sf "$2" "$1/$3" && sips -g pixelWidth -g pixelHeight "$2"', "sh", dir, this.path, name]);
        const w = Number(/pixelWidth: (\d+)/.exec(r.stdout)?.[1]), h = Number(/pixelHeight: (\d+)/.exec(r.stdout)?.[1]);
        if (r.code !== 0 || !w || !h) throw new Error("no size");
        this.img = { rel: `data/file-viewer/images/${name}`, w, h };
      } catch { this.img = null; this.mode = "card"; this.loadSize(cx); }
      cx.notify();
    });
  }

  buildCode() {
    this.code?.release(); this.code = null;
    if (this.text == null) return;
    const t = theme();
    this.code = EditorState.new({ language: LANG[this.ext] ?? (this.ext || "txt"), readonly: true,
      value: this.tooLarge ? this.text.slice(0, LIMIT) + "\n… (file truncated)" : this.text,
      syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
  }

  // Raw or Render, remembered per extension. Edit is never remembered.
  setMode(mode, cx) {
    if (!this.actions?.[mode]) return;
    this.mode = mode;
    setShared(MODES_KEY, { ...(shared(MODES_KEY) ?? {}), [this.ext]: mode });
    cx?.notify();
  }

  openApp() { if (this.actions?.openApp) exec("open", [this.path]).catch(() => {}); }

  segment(t) {
    const pill = (mode, label) => div().id(`mode-${mode}`).px(10).py(3).cursor_pointer()
      .when(this.mode === mode, el => el.bg(t.hover).text_color(t.foreground))
      .when(this.mode !== mode, el => el.text_color(t.muted))
      .on_click((_e, cx) => this.setMode(mode, cx)).child(label);
    return h_flex().rounded(7).border_1().border_color(t.border).overflow_hidden()
      .child(pill("raw", "Raw")).child(pill("render", "Render"));
  }

  // Zoom: null means fit (at most 100%, inside 1400x900); otherwise a factor of the real size.
  fitScale() { return Math.min(1, 1400 / this.img.w, 900 / this.img.h); }
  scale() { return this.zoom ?? this.fitScale(); }
  setZoom(z, cx) { this.zoom = z == null ? null : Math.min(8, Math.max(0.05, z)); cx.notify(); }

  zoomBar(t) {
    const btn = (id, label, cmd) => div().id(id).px(8).py(3).rounded(7).border_1().border_color(t.border).cursor_pointer()
      .text_color(t.muted).hover(s => s.bg(t.hover)).on_click((_e, cx) => { this.command(cmd, cx); cx.notify(); }).child(label);
    return h_flex().gap(4).items_center()
      .child(btn("zoom-out", "−", "zoom-out"))
      .child(btn("zoom-fit", this.zoom == null ? "Fit" : `${Math.round(this.scale() * 100)}%`, "zoom-fit"))
      .child(btn("zoom-in", "+", "zoom-in"));
  }

  body(t) {
    if (this.error) return div().p(12).text_color(t.dim).child(this.error);
    if (!this.mode) return div().p(12).text_color(t.dim).child("Loading file…");
    if (this.mode === "card") return this.card(t);
    if (this.mode === "render") {
      if (this.group === 4) {
        if (!this.img) return div().p(12).text_color(t.dim).child("Loading image…");
        const k = this.scale();
        // The inner box is at least the viewport and grows with the image: a small image sits centred,
        // a large one pushes the box wider, so every edge stays reachable by scrolling.
        return div().id("viewer-image").flex().flex_1().min_h(0).min_w(0).overflow_scrollbar()
          .on_pinch((e, cx) => { this.setZoom(this.scale() * (1 + e.delta), cx); })
          .child(h_flex().flex_none().min_w_full().min_h_full().p(12).items_center().justify_center()
            .child(image(this.img.rel).w(Math.round(this.img.w * k)).h(Math.round(this.img.h * k)).flex_none()));
      }
      const view = this.group === 1 ? TextView.markdown("viewer-md", this.text) : TextView.html("viewer-html", this.text);
      return div().id("viewer-render").flex_1().min_h(0).overflow_y_scrollbar().px(24).py(16).child(view.selectable(true));
    }
    const font = settings();
    if (this.mode === "edit") return Editor.new(this.editCode).font_family(font.font_family).text_size(font.font_size).flex_1().min_h(0);
    return Editor.new(this.code).font_family(font.font_family).text_size(font.font_size).flex_1().min_h(0);
  }

  card(t) {
    return v_flex().flex_1().items_center().justify_center().gap(10)
      .child(div().text_size(16).font_semibold().child(this.name))
      .child(div().text_size(12).text_color(t.dim).child([sizeLabel(this.size), this.ext ? this.ext.toUpperCase() + " file" : "File"].filter(Boolean).join(" · ")))
      .when(Boolean(this.actions?.openApp), el => el.child(div().id("card-open").mt(8).px(16).py(8).rounded(8).bg(t.accent).text_color(t.background).cursor_pointer()
        .on_click(() => this.openApp()).child("Open in default app")))
      .when(Boolean(this.on), el => el.child(div().text_size(12).text_color(t.dim).child(`On ${this.on}`)));
  }

  renderMenu(t) {
    const items = this.menu.items ?? [];
    const choose = i => { closeOverlay(this.menu.overlay); if (items[i][1]) run(`file-viewer.${items[i][1]}`); };
    return v_flex().id("viewer-menu").track_focus(this.handle).w_full().p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % items.length;
        else if (e.key === "up") this.at = (this.at + items.length - 1) % items.length;
        else if (e.key === "enter") choose(this.at);
        else if (e.key === "escape") closeOverlay(this.menu.overlay);
        else return;
        cx.notify();
      })
      .when(Boolean(this.menu.confirm), el => el.child(div().px(8).py(8).font_semibold().child(`Save changes to ${this.menu.name}?`)))
      .children(items.map(([label, , key], i) => h_flex().id(`vm-${i}`).h(31).px(8).rounded(7).items_center().justify_between().cursor_pointer()
        .when(i === this.at, el => el.bg(t.hover))
        .on_mouse_move((_e, cx) => { if (this.at !== i) { this.at = i; cx.notify(); } })
        .on_click(() => choose(i))
        .child(div().child(label)).child(div().text_color(t.dim).child(key))));
  }

  render(cx) {
    const t = theme();
    if (this.menu) return this.renderMenu(t);
    const h = home(), p = this.path ?? "";
    const shown = middle(h && p.startsWith(h) ? "~" + p.slice(h.length) : p);
    return v_flex().id("viewer").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .child(h_flex().h(36).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border).text_size(12)
        .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(shown))
        .when(Boolean(this.actions?.raw && this.actions?.render), el => el.child(this.segment(t)))
        .when(Boolean(this.group === 4 && this.img && this.mode === "render"), el => el.child(this.zoomBar(t)))
        .when(Boolean(this.on && this.group <= 3 && this.remoteWritable === false), el => el.child(div().text_size(11).text_color(t.dim).child("Read-only: this machine can't save remotely")))
        .when(Boolean(this.actions?.edit && this.mode !== "edit" && this.banner?.kind !== "draft"), el => el.child(div().id("viewer-edit").px(10).py(3).rounded(7).border_1().border_color(t.border)
          .cursor_pointer().text_color(t.muted).hover(s => s.bg(t.hover)).on_click((_e, cx) => this.startEdit(this.text, cx)).child("✎ Edit")))
        .when(this.mode === "edit", el => el
          .child(div().id("viewer-save").px(10).py(3).rounded(7).cursor_pointer().bg(this.dirty ? t.accent : t.hover).text_color(this.dirty ? t.background : t.muted)
            .on_click((_e, cx) => this.save(cx)).child("Save"))
          .child(div().id("viewer-done").px(10).py(3).rounded(7).border_1().border_color(t.border).cursor_pointer().text_color(t.muted)
            .on_click((_e, cx) => this.dirty ? this.askClose(cx) : this.stopEdit(cx)).child(this.dirty ? "Close…" : "Done")))
        .when(Boolean(this.actions), el => el.child(div().id("viewer-more").px(8).py(2).rounded(6).cursor_pointer().text_color(t.muted)
          .hover(s => s.bg(t.hover)).on_click(() => this.openMenu()).child("⋯"))))
      .when(Boolean(this.banner), el => el.child(this.renderBanner(t)))
      .child(this.body(t));
  }

  renderBanner(t) {
    const b = this.banner;
    const btn = (id, label, fn) => div().id(id).px(10).py(3).rounded(7).border_1().border_color(t.border).cursor_pointer()
      .hover(s => s.bg(t.hover)).on_click((_e, cx) => fn(cx)).child(label);
    const msg = b.kind === "conflict" ? "This file changed on disk since you opened it."
      : b.kind === "gone" ? "This file is no longer available."
      : b.kind === "error" ? `Could not save this file${b.reason === "unsupported" ? ": this machine can't save remotely" : b.reason && b.reason !== "error" ? `: ${b.reason}` : ""}. Your edits are still here.`
      : `You have unsaved changes to this file from ${new Date(b.at).toLocaleString()}.`;
    return h_flex().flex_none().px(12).py(8).gap(8).items_center().bg(t.hover).border_b(1).border_color(t.border).text_size(12)
      .child(div().flex_1().child(msg))
      .when(b.kind === "conflict", el => el.child(btn("b-reload", "Reload", cx => this.reload(cx))))
      .when(b.kind === "error", el => el.child(btn("b-dismiss", "Dismiss", cx => { this.banner = null; cx.notify(); })))
      .when(b.kind === "conflict" || b.kind === "gone", el => el.child(btn("b-conflict", "Save as conflict file", cx => this.saveAsConflict(cx))))
      .when(b.kind === "draft", el => el.child(btn("b-restore", "Restore", cx => this.restoreDraft(cx)))
        .child(btn("b-drop", "Discard", cx => { this.dropDraft(); this.banner = null; cx.notify(); })));
  }
}
