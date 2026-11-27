import { test } from "node:test";
import assert from "node:assert/strict";
import { copyName, validName, parentOf, joinPath, isInside, pasteTarget } from "../mods/personalos-files/paths.js";

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
