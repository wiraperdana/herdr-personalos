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

// Quick Open: every word must appear somewhere in the path (any case, any order).
// A word at the start of the name scores 3, inside the name 2, elsewhere in the path 0;
// ties go to the shorter path. Folders end with "/".
export function searchPaths(paths, query, limit = 50) {
  const words = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits = [];
  for (const p of paths) {
    const lower = p.toLowerCase();
    const name = lower.replace(/\/$/, "").split("/").pop();
    let score = 0, ok = true;
    for (const w of words) {
      if (!lower.includes(w)) { ok = false; break; }
      score += name.startsWith(w) ? 3 : name.includes(w) ? 2 : 0;
    }
    if (ok) hits.push([score, p]);
  }
  hits.sort((a, b) => b[0] - a[0] || a[1].length - b[1].length || a[1].localeCompare(b[1]));
  return hits.slice(0, limit).map(h => h[1]);
}

// Every parent folder of the given file paths, once each, as "a/" and "a/b/".
export function foldersOf(files) {
  const out = new Set();
  for (const f of files) {
    const parts = f.split("/");
    for (let i = 1; i < parts.length; i++) out.add(parts.slice(0, i).join("/") + "/");
  }
  return [...out];
}
