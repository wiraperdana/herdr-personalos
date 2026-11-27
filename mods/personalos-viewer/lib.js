// Pure logic for the viewer. No "herdr" import, so Node can test it.
// Sibling imports work: herdr-app check and a live tab loaded main.js importing this file (2026-11-27).
export const LIB_OK = true;

// File groups (spec "File groups"): 1 renderable text, 2 partly renderable text,
// 3 plain text, 4 images, 5 other binaries. Unknown extensions are sniffed.
const GROUP = {};
for (const e of ["md", "markdown", "mdx"]) GROUP[e] = 1;
for (const e of ["html", "htm"]) GROUP[e] = 2;
for (const e of ["txt", "json", "jsonc", "yaml", "yml", "toml", "csv", "tsv", "log", "env", "ini", "xml", "tex", "bib", "ipynb", "svg",
  "py", "js", "mjs", "cjs", "ts", "tsx", "jsx", "sh", "zsh", "bash", "rb", "go", "rs", "java", "kt", "c", "h", "cpp", "hpp", "cs", "php",
  "swift", "sql", "r", "lua", "css", "scss", "vue", "svelte", "conf", "cfg", "gitignore", "dockerfile", "makefile", "lock"]) GROUP[e] = 3;
for (const e of ["png", "jpg", "jpeg", "gif", "webp", "bmp"]) GROUP[e] = 4;
for (const e of ["pdf", "docx", "doc", "xlsx", "xls", "pptx", "ppt", "odt", "ods", "odp", "key", "numbers", "pages", "rtf",
  "mp4", "mov", "mkv", "avi", "mp3", "wav", "m4a", "flac", "zip", "tar", "gz", "tgz", "7z", "rar", "dmg", "pkg", "epub",
  "sqlite", "db", "ico", "icns", "heic", "tiff", "psd", "ai", "sketch", "fig", "ttf", "otf", "woff", "woff2"]) GROUP[e] = 5;

export function extOf(name) {
  const base = name.split("/").pop();
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(i + 1).toLowerCase() : "";
}

export function groupOf(name, sample = null) {
  const g = GROUP[extOf(name)];
  if (g) return g;
  return sample != null && sample.includes("\0") ? 5 : 3;
}

export function actionsFor(group, { remote = false, tooLarge = false, remoteWritable = true } = {}) {
  const text = group <= 3;
  return {
    raw: text,
    render: group === 1 || group === 2 || group === 4,
    edit: text && !tooLarge && (!remote || remoteWritable),
    openApp: !remote,
    finder: !remote,
  };
}

export function pickMode(remembered, actions) {
  if (remembered && actions[remembered]) return remembered;
  if (actions.render) return "render";
  if (actions.raw) return "raw";
  return "card";
}

export function conflictName(name, taken) {
  const i = name.lastIndexOf(".");
  const [stem, ext] = i > 0 ? [name.slice(0, i), name.slice(i)] : [name, ""];
  for (let n = 1; ; n++) {
    const candidate = `${stem}.conflict${n === 1 ? "" : "-" + n}${ext}`;
    if (!taken(candidate)) return candidate;
  }
}

export function quoteSh(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }

// A file name for an image's link in the app's data folder. image() only loads paths
// inside the app folder, so the viewer links the real file there under this name.
// UTF-8 bytes without TextEncoder, which Herdr's script engine lacks.
function utf8(s) {
  const out = [], enc = encodeURIComponent(s);
  for (let i = 0; i < enc.length; i++) {
    if (enc[i] === "%") { out.push(parseInt(enc.slice(i + 1, i + 3), 16)); i += 2; } else out.push(enc.charCodeAt(i));
  }
  return out;
}

export function cacheName(path) {
  // Two FNV-1a hashes with different seeds: short, safe as a file name, collisions unlikely.
  const fnv = seed => { let h = seed >>> 0; for (const b of utf8(path)) { h ^= b; h = Math.imul(h, 16777619) >>> 0; } return h.toString(16).padStart(8, "0"); };
  const ext = extOf(path);
  return fnv(2166136261) + fnv(0x9747b28c) + (ext ? "." + ext : "");
}

// ---- Remote save (spec "Remote text files"). Shared with the repo; nothing machine-specific. ----
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Base64 of the text's UTF-8 bytes, without Buffer, btoa or TextEncoder.
export function utf8ToBase64(text) {
  const b = utf8(text);
  let out = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < b.length ? B64[(n >> 6) & 63] : "=") + (i + 2 < b.length ? B64[n & 63] : "=");
  }
  return out;
}

// Pieces small enough for one exec argument (Linux caps one at about 128 KB).
// Each piece is a whole number of base64 quads, so each decodes on its own.
export function chunkBase64(text, size = 65536) {
  const all = utf8ToBase64(text), step = Math.max(4, size - (size % 4));
  const out = [];
  for (let i = 0; i < all.length; i += step) out.push(all.slice(i, i + step));
  return out.length ? out : [""];
}

// sh -c scripts. Paths and data arrive as $1, $2, never inside the script text.
export function remoteScripts() {
  const hash = 'if command -v sha256sum >/dev/null 2>&1; then h=$(sha256sum < "$1" | cut -d" " -f1); '
    + 'elif command -v shasum >/dev/null 2>&1; then h=$(shasum -a 256 < "$1" | cut -d" " -f1); else exit 3; fi';
  return {
    probe: 'command -v base64 >/dev/null 2>&1 && { command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1; }',
    append: 'printf "%s" "$2" | base64 -d >> "$1"',
    check: `[ -e "$1" ] || exit 2; ${hash}; [ "$h" = "$2" ]`,
    commit: 'mv -f "$1" "$2"',
    cleanup: 'rm -f "$1"',
  };
}
