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
