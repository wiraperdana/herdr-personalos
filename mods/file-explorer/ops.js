// File operations for the Files context menu. The pure helpers are tested in tests/ops.test.mjs;
// the rest runs small sh scripts through exec, so they work the same on a remote machine (`on`).
import { exec } from "herdr";
import { parentOf, joinPath, baseName, isInside, copyName } from "./paths.js";
export * from "./paths.js";

// Exit codes: 4 means the target already exists, nothing was touched.
const S = {
  newFile: 'set -C; [ -e "$1" ] && exit 4; : > "$1"',
  newFolder: '[ -e "$1" ] && exit 4; mkdir "$1"',
  // A case-only rename on a case-insensitive disk names the same file, so -ef lets it through.
  rename: 'if [ -e "$2" ] && ! [ "$1" -ef "$2" ]; then exit 4; fi; mv "$1" "$2"',
  copy: '[ -e "$2" ] && exit 4; cp -R "$1" "$2"',
  move: '[ -e "$2" ] && exit 4; mv "$1" "$2"',
  list: 'ls -A "$1"',
  trash: '/usr/bin/trash "$1"',
  remove: 'rm -rf "$1"',
  hasTrash: '[ -x /usr/bin/trash ]',
};
const sh = (script, args, on) => exec("sh", ["-c", script, "sh", ...args], { on: on ?? null });

async function run(script, args, on) {
  const r = await sh(script, args, on);
  if (r.code === 0) return { ok: true };
  if (r.code === 4) return { ok: false, error: "Something with that name is already there" };
  return { ok: false, error: (r.stderr || r.stdout || `Failed (code ${r.code})`).trim().split("\n").pop() };
}

export async function names(dir, on) {
  const r = await sh(S.list, [dir], on);
  return r.code === 0 ? r.stdout.split("\n").filter(Boolean) : [];
}

export const newFile = (path, on) => run(S.newFile, [path], on);
export const newFolder = (path, on) => run(S.newFolder, [path], on);
export const rename = (from, to, on) => run(S.rename, [from, to], on);

// Copy or move `src` into folder `dir`. Copies into their own folder get " copy" names, like Finder.
export async function paste(src, dir, { cut = false, on } = {}) {
  if (cut && parentOf(src) === dir) return { ok: true, path: src };
  if (isInside(dir, src)) return { ok: false, error: "Can't put a folder inside itself" };
  const name = copyName(baseName(src), await names(dir, on), { keepIfFree: true });
  if (cut && name !== baseName(src)) return { ok: false, error: `${baseName(src)} already exists there` };
  const dest = joinPath(dir, name);
  const r = await run(cut ? S.move : S.copy, [src, dest], on);
  return r.ok ? { ok: true, path: dest } : r;
}

export async function duplicate(src, on) {
  const dir = parentOf(src), dest = joinPath(dir, copyName(baseName(src), await names(dir, on)));
  const r = await run(S.copy, [src, dest], on);
  return r.ok ? { ok: true, path: dest } : r;
}

// Local files go to the macOS Trash. Remote machines have no Trash, so delete is permanent there.
export async function canTrash(on) { return !on && (await sh(S.hasTrash, [], null)).code === 0; }
export const trash = path => run(S.trash, [path], null);
export const removeForever = (path, on) => run(S.remove, [path], on);
