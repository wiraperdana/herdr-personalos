// A read-only file viewer that fills a whole tab. Props: { path, on }.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState } from "gpui-base";
import { readTextFile, theme, settings, props } from "herdr";

const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };

export default class Viewer extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.path = p.path ?? null; this.on = p.on ?? null;
    this.code = null; this.error = this.path ? null : "No file";
    if (this.path) this.load(cx);
  }

  load(cx) {
    const path = this.path, on = this.on;
    cx.spawn(async cx => {
      try {
        const text = await readTextFile(path, { on });
        if (text === null) { this.error = "This file is no longer available"; return; }
        if (text.includes("\0")) { this.error = "Binary file · no text preview"; return; }
        const t = theme(), name = path.split(/[\\/]/).pop(), ext = name.includes(".") ? name.split(".").pop() : "txt";
        this.code?.release();
        this.code = EditorState.new({ language: LANG[ext] ?? ext, readonly: true,
          value: text.length > 400000 ? text.slice(0, 400000) + "\n… (file truncated)" : text,
          syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
      } catch { this.error = "Cannot preview this file (binary, too large, or unreadable)"; }
      finally { cx.notify(); }
    });
  }

  render(cx) {
    const t = theme(), font = settings();
    return v_flex().id("viewer").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .child(h_flex().h(32).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(this.path ?? ""))
        .child(div().id("viewer-reload").cursor_pointer().text_size(12).text_color(t.muted).hover(s => s.text_color(t.foreground))
          .on_click((_e, cx) => { this.error = null; this.load(cx); }).child("Reload")))
      .child(this.code
        ? Editor.new(this.code).font_family(font.font_family).text_size(font.font_size).flex_1().min_h(0)
        : div().p(12).text_color(t.dim).child(this.error || "Loading file…"));
  }
}
