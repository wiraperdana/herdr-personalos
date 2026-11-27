// Saving a text file on another machine. writeTextFile has no `on` option and exec takes
// no stdin, so the text travels as base64 pieces in exec arguments (spec "Remote text files"):
// 1. append the pieces to a temp file next to the target,
// 2. compare the target's SHA-256 with the hash of the text as it was read,
// 3. move the temp file over the target (atomic on one filesystem), keeping its permission
//    bits and writing through a symlink. The owner becomes the saving user.
// Accepted risk: a write by someone else between steps 2 and 3 is overwritten.
import { exec } from "herdr";
import { createHash } from "crypto";
import { chunkBase64, remoteScripts, conflictName } from "./lib.js";

const S = remoteScripts();
const sh = (script, args, on) => exec("sh", ["-c", script, "sh", ...args], { on });

// True when the machine has sh, base64 and a SHA-256 tool.
export async function canSaveRemote(on) {
  try { return (await sh(S.probe, [], on)).code === 0; } catch { return false; }
}

// Returns "saved", "conflict" (the file changed or vanished), "unsupported" or "error".
// `original` null means a new file: no change check.
export async function saveRemote(path, on, text, original) {
  try {
    const r = await sh(S.resolve, [path], on);
    if (r.code === 0 && r.stdout) path = r.stdout;
  } catch {}
  const i = path.lastIndexOf("/");
  const tmp = `${path.slice(0, i)}/.${path.slice(i + 1)}.herdr-tmp`;
  try {
    await sh(S.cleanup, [tmp], on);
    for (const piece of chunkBase64(text)) {
      if ((await sh(S.append, [tmp, piece], on)).code !== 0) { await sh(S.cleanup, [tmp], on); return "error"; }
    }
    if (original !== null) {
      const code = (await sh(S.check, [path, createHash("sha256").update(original).digest("hex")], on)).code;
      if (code !== 0) { await sh(S.cleanup, [tmp], on); return code === 3 ? "unsupported" : "conflict"; }
    }
    const done = await sh(original === null ? S.commitNew : S.commit, [tmp, path], on);
    return done.code === 0 ? "saved" : done.code === 4 ? "exists" : "error";
  } catch {
    try { await sh(S.cleanup, [tmp], on); } catch {}
    return "error";
  }
}

// Sending a local file (any bytes) back over a remote one: used when a downloaded copy is
// edited in a Mac app (K-261127-15). Same safety as saveRemote, but the bytes stream through
// `hc exec -i` instead of base64 pieces. `baseHash` is the SHA-256 the copy had when downloaded.
// Returns { status: "saved" | "conflict" | "unsupported" | "error", path?, error? }.
// On a conflict the copy is written beside the target as name.conflict.ext, never over it.
const STREAM = 'hc exec -i --timeout 600 --on "$1" -- sh -c \'cat > "$1"\' sh "$2" < "$3"';

export async function localHash(file) {
  const r = await exec("shasum", ["-a", "256", file]);
  return r.code === 0 ? r.stdout.split(" ")[0] : null;
}

export async function uploadFile(local, path, on, baseHash) {
  try {
    const r = await sh(S.resolve, [path], on);
    if (r.code === 0 && r.stdout) path = r.stdout;
  } catch {}
  const i = path.lastIndexOf("/"), dir = path.slice(0, i), name = path.slice(i + 1);
  const tmp = `${dir}/.${name}.herdr-tmp`;
  try {
    const sent = await exec("sh", ["-c", STREAM, "sh", on, tmp, local], { timeout: 600000 });
    if (sent.code !== 0) { await sh(S.cleanup, [tmp], on); return { status: "error", error: (sent.stderr || "Upload failed").trim().split("\n").pop() }; }
    const code = (await sh(S.check, [path, baseHash], on)).code;
    if (code === 3) { await sh(S.cleanup, [tmp], on); return { status: "unsupported" }; }
    if (code !== 0) {
      const taken = new Set(((await exec("ls", ["-A", dir], { on })).stdout || "").split("\n").filter(Boolean));
      const other = `${dir}/${conflictName(name, n => taken.has(n))}`;
      const done = await sh(S.commitNew, [tmp, other], on);
      return done.code === 0 ? { status: "conflict", path: other } : { status: "error", error: "Couldn't write the conflict copy" };
    }
    const done = await sh(S.commit, [tmp, path], on);
    return done.code === 0 ? { status: "saved", path } : { status: "error", error: "Couldn't replace the file" };
  } catch (e) {
    try { await sh(S.cleanup, [tmp], on); } catch {}
    return { status: "error", error: String(e) };
  }
}
