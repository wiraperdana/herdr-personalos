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

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

test("chunkBase64 round-trips UTF-8 within 64 KB chunks", () => {
  const text = "Halo dunia, apa kabar? 🌏 é\n".repeat(5000);
  const chunks = lib.chunkBase64(text);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(c.length <= 65536);
  assert.equal(Buffer.from(chunks.join(""), "base64").toString("utf8"), text);
  assert.equal(lib.utf8ToBase64("é🌏"), Buffer.from("é🌏").toString("base64"));
});

test("remoteScripts carry no file names, only positional arguments", () => {
  const s = lib.remoteScripts();
  for (const k of ["append", "check", "commit", "cleanup"]) {
    assert.equal(typeof s[k], "string");
    assert.ok(!s[k].includes("notes"));
  }
});

test("remoteScripts write, refuse a changed target, and handle odd names", () => {
  const dir = mkdtempSync(join(tmpdir(), "rs-"));
  const target = join(dir, "a b'$.md"), tmp = join(dir, ".a b'$.md.herdr-tmp");
  writeFileSync(target, "old\n");
  const s = lib.remoteScripts();
  const sh = (script, ...args) => { try { execFileSync("sh", ["-c", script, "sh", ...args]); return 0; } catch (e) { return e.status; } };
  const sha = t => createHash("sha256").update(t).digest("hex");
  for (const c of lib.chunkBase64("new é\n", 3)) assert.equal(sh(s.append, tmp, c), 0);
  assert.equal(sh(s.check, target, sha("old\n")), 0);
  assert.equal(sh(s.commit, tmp, target), 0);
  assert.equal(readFileSync(target, "utf8"), "new é\n");
  assert.equal(sh(s.check, target, sha("old\n")), 1);
  sh(s.append, tmp, lib.utf8ToBase64("x"));
  assert.equal(sh(s.cleanup, tmp), 0);
});
