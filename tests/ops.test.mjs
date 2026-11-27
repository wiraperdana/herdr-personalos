import { test } from "node:test";
import assert from "node:assert/strict";
import { copyName, validName, parentOf, joinPath, isInside, pasteTarget } from "../mods/file-explorer/paths.js";

test("copyName adds ' copy', then ' copy 2', keeping the extension", () => {
  assert.equal(copyName("notes.md", []), "notes copy.md");
  assert.equal(copyName("notes.md", ["notes copy.md"]), "notes copy 2.md");
  assert.equal(copyName("notes.md", ["notes copy.md", "notes copy 2.md"]), "notes copy 3.md");
  assert.equal(copyName("src", ["src copy"]), "src copy 2");
  assert.equal(copyName(".env", []), ".env copy");
  assert.equal(copyName("a.tar.gz", []), "a.tar copy.gz");
});

test("copyName keeps the name when it is free (paste into another folder)", () => {
  assert.equal(copyName("notes.md", ["other.md"], { keepIfFree: true }), "notes.md");
  assert.equal(copyName("notes.md", ["notes.md"], { keepIfFree: true }), "notes copy.md");
});

test("validName refuses empty, dot names, slashes and NUL", () => {
  assert.equal(validName("ok.md"), null);
  assert.match(validName(""), /name/i);
  assert.match(validName("   "), /name/i);
  assert.match(validName("."), /name/i);
  assert.match(validName(".."), /name/i);
  assert.match(validName("a/b"), /\//);
  assert.match(validName("a\0b"), /character/i);
});

test("parentOf, joinPath, isInside", () => {
  assert.equal(parentOf("/r/a/b.md"), "/r/a");
  assert.equal(parentOf("/b.md"), "/");
  assert.equal(joinPath("/r/a", "b"), "/r/a/b");
  assert.equal(joinPath("/", "b"), "/b");
  assert.equal(isInside("/r/a/b", "/r/a"), true);
  assert.equal(isInside("/r/a", "/r/a"), true);
  assert.equal(isInside("/r/ab", "/r/a"), false);
});

test("pasteTarget: a folder pastes into itself, a file into its parent", () => {
  assert.equal(pasteTarget({ path: "/r/a", dir: true }), "/r/a");
  assert.equal(pasteTarget({ path: "/r/a/x.md", dir: false }), "/r/a");
});

import { searchPaths, foldersOf } from "../mods/file-explorer/paths.js";

test("searchPaths: every word must appear, case-insensitive, in any order", () => {
  const all = ["docs/Renstra 2027.pdf", "docs/notes.md", "src/renstra.js", "README.md"];
  assert.deepEqual(searchPaths(all, "renstra pdf"), ["docs/Renstra 2027.pdf"]);
  assert.deepEqual(searchPaths(all, "PDF renstra"), ["docs/Renstra 2027.pdf"]);
  assert.deepEqual(searchPaths(all, "zzz"), []);
  assert.deepEqual(searchPaths(all, "  "), []);
});

test("searchPaths ranks a name match above a folder match, then shorter paths", () => {
  const all = ["notes/a/b/c.md", "x/notes.md", "deep/folder/notes.md"];
  assert.deepEqual(searchPaths(all, "notes"), ["x/notes.md", "deep/folder/notes.md", "notes/a/b/c.md"]);
});

test("searchPaths: a name that starts with the word beats one that only contains it", () => {
  assert.deepEqual(searchPaths(["a/my-plan.md", "b/plan.md"], "plan"), ["b/plan.md", "a/my-plan.md"]);
});

test("searchPaths caps the result count", () => {
  const all = Array.from({ length: 500 }, (_, i) => `f${i}.txt`);
  assert.equal(searchPaths(all, "f", 50).length, 50);
});

test("foldersOf lists every parent folder once, with a trailing slash", () => {
  assert.deepEqual(foldersOf(["a/b/c.md", "a/d.md", "e.md"]).sort(), ["a/", "a/b/"]);
});
