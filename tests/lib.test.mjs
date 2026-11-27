import { test } from "node:test";
import assert from "node:assert/strict";
import * as lib from "../mods/personalos-viewer/lib.js";

test("lib loads", () => { assert.equal(lib.LIB_OK, true); });

const { groupOf, actionsFor, pickMode, conflictName, quoteSh, extOf } = lib;
const local = { remote: false, tooLarge: false, remoteWritable: true };

test("groupOf by extension", () => {
  assert.equal(groupOf("a.md"), 1);
  assert.equal(groupOf("a.HTML"), 2);
  assert.equal(groupOf("a.json"), 3);
  assert.equal(groupOf("a.svg"), 3);
  assert.equal(groupOf("a.png"), 4);
  assert.equal(groupOf("a.pdf"), 5);
  assert.equal(groupOf("a.xlsx"), 5);
});

test("groupOf sniffs unknown names", () => {
  assert.equal(groupOf("Makefile", "all:\n"), 3);
  assert.equal(groupOf(".env", "A=1"), 3);
  assert.equal(groupOf("blob", "ab\0c"), 5);
  assert.equal(groupOf("empty.xyz", ""), 3);
});

test("extOf", () => {
  assert.equal(extOf("A.MD"), "md");
  assert.equal(extOf("Makefile"), "");
  assert.equal(extOf(".env"), "");
});

test("actionsFor", () => {
  assert.deepEqual(actionsFor(1, local), { raw: true, render: true, edit: true, openApp: true, finder: true });
  assert.equal(actionsFor(1, { ...local, tooLarge: true }).edit, false);
  const r = actionsFor(3, { remote: true, tooLarge: false, remoteWritable: true });
  assert.equal(r.openApp, false); assert.equal(r.finder, false); assert.equal(r.edit, true);
  assert.equal(actionsFor(3, { remote: true, tooLarge: false, remoteWritable: false }).edit, false);
  assert.deepEqual(actionsFor(5, local), { raw: false, render: false, edit: false, openApp: true, finder: true });
  assert.deepEqual(actionsFor(4, local), { raw: false, render: true, edit: false, openApp: true, finder: true });
});

test("pickMode", () => {
  assert.equal(pickMode("render", actionsFor(3, local)), "raw");
  assert.equal(pickMode(undefined, actionsFor(1, local)), "render");
  assert.equal(pickMode("raw", actionsFor(1, local)), "raw");
  assert.equal(pickMode("raw", actionsFor(5, local)), "card");
  assert.equal(pickMode("raw", actionsFor(4, local)), "render");
});

test("conflictName", () => {
  assert.equal(conflictName("notes.md", () => false), "notes.conflict.md");
  assert.equal(conflictName("notes.md", n => n === "notes.conflict.md"), "notes.conflict-2.md");
  assert.equal(conflictName("Makefile", () => false), "Makefile.conflict");
});

test("quoteSh", () => {
  assert.equal(quoteSh("a b'c$"), "'a b'\\''c$'");
});

test("cacheName keeps the extension and is unique per path", () => {
  const { cacheName } = lib;
  assert.equal(cacheName("/a/b c/x.PNG").endsWith(".png"), true);
  assert.notEqual(cacheName("/a/b/x.png"), cacheName("/a/b_x.png"));
  assert.match(cacheName("/a/b'$/x.png"), /^[A-Za-z0-9_.-]+$/);
});

test("cacheName works without TextEncoder", () => {
  const saved = globalThis.TextEncoder;
  globalThis.TextEncoder = undefined;
  try { assert.match(lib.cacheName("/a/é.png"), /^[0-9a-f]{16}\.png$/); }
  finally { globalThis.TextEncoder = saved; }
});
