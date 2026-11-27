// Pure path and name helpers for the Files context menu (tested in tests/ops.test.mjs).

export function parentOf(p) { const i = p.lastIndexOf("/"); return i <= 0 ? "/" : p.slice(0, i); }
export function joinPath(dir, name) { return dir === "/" ? `/${name}` : `${dir}/${name}`; }
export function baseName(p) { return p.slice(p.lastIndexOf("/") + 1); }
export function isInside(p, dir) { return p === dir || p.startsWith(dir.endsWith("/") ? dir : dir + "/"); }
export function pasteTarget(entry) { return entry.dir ? entry.path : parentOf(entry.path); }

// Returns an error message, or null when the name is fine.
export function validName(name) {
  const n = (name ?? "").trim();
  if (!n || n === "." || n === "..") return "Type a name";
  if (n.includes("/")) return "A name can't contain /";
  if (n.includes("\0")) return "That character isn't allowed";
  return null;
}

// "notes.md" -> "notes copy.md" -> "notes copy 2.md". A leading dot is part of the stem (".env copy").
export function copyName(name, taken, { keepIfFree = false } = {}) {
  const used = new Set(taken);
  if (keepIfFree && !used.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
  for (let n = 1; ; n++) {
    const candidate = `${stem} copy${n === 1 ? "" : " " + n}${ext}`;
    if (!used.has(candidate)) return candidate;
  }
}
