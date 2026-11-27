// A file viewer that fills a whole tab. Props: { path, on }.
// What it offers depends on the file's group (see lib.js): Raw, Render, Edit,
// Open in default app and Show in Finder.
import { View, div, image } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, TextView } from "gpui-base";
import { readTextFile, theme, settings, props, shared, setShared, exec, home, appHome } from "herdr";
import { groupOf, actionsFor, pickMode, extOf, cacheName } from "./lib.js";

const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };
const LIMIT = 400000;
const MODES_KEY = "personalos-viewer.modes";

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
    this.path = p.path ?? null; this.on = p.on ?? null;
    this.name = this.path ? this.path.split(/[\\/]/).pop() : "";
    this.ext = extOf(this.name);
    this.mode = null; this.text = null; this.code = null; this.error = this.path ? null : "No file";
    if (this.path) this.load(cx);
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
      this.tooLarge = this.text != null && this.text.length > LIMIT;
      this.actions = actionsFor(this.group, { remote: Boolean(on), tooLarge: this.tooLarge, remoteWritable: true });
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
    const dir = `${appHome()}/data/personalos-viewer/images`, name = cacheName(this.path);
    cx.spawn(async cx => {
      try {
        const r = await exec("sh", ["-c", 'mkdir -p "$1" && ln -sf "$2" "$1/$3" && sips -g pixelWidth -g pixelHeight "$2"', "sh", dir, this.path, name]);
        const w = Number(/pixelWidth: (\d+)/.exec(r.stdout)?.[1]), h = Number(/pixelHeight: (\d+)/.exec(r.stdout)?.[1]);
        if (r.code !== 0 || !w || !h) throw new Error("no size");
        this.img = { rel: `data/personalos-viewer/images/${name}`, w, h };
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

  body(t) {
    if (this.error) return div().p(12).text_color(t.dim).child(this.error);
    if (!this.mode) return div().p(12).text_color(t.dim).child("Loading file…");
    if (this.mode === "card") return this.card(t);
    if (this.mode === "render") {
      if (this.group === 4) {
        if (!this.img) return div().p(12).text_color(t.dim).child("Loading image…");
        const k = Math.min(1, 1400 / this.img.w, 900 / this.img.h);
        return h_flex().id("viewer-image").flex_1().min_h(0).overflow_scrollbar().p(12).items_center().justify_center()
          .child(image(this.img.rel).w(Math.round(this.img.w * k)).h(Math.round(this.img.h * k)).flex_none());
      }
      const view = this.group === 1 ? TextView.markdown("viewer-md", this.text) : TextView.html("viewer-html", this.text);
      return div().id("viewer-render").flex_1().min_h(0).overflow_y_scrollbar().px(24).py(16).child(view.selectable(true));
    }
    const font = settings();
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

  render(cx) {
    const t = theme();
    const h = home(), p = this.path ?? "";
    const shown = middle(h && p.startsWith(h) ? "~" + p.slice(h.length) : p);
    return v_flex().id("viewer").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .child(h_flex().h(36).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border).text_size(12)
        .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(shown))
        .when(Boolean(this.actions?.raw && this.actions?.render), el => el.child(this.segment(t))))
      .child(this.body(t));
  }
}
