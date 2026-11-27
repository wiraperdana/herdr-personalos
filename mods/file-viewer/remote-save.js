// Saving a text file on another machine. writeTextFile has no `on` option and exec takes
// no stdin, so the text travels as base64 pieces in exec arguments (spec "Remote text files"):
// 1. append the pieces to a temp file next to the target,
// 2. compare the target's SHA-256 with the hash of the text as it was read,
// 3. move the temp file over the target (atomic on one filesystem), keeping its permission
//    bits and writing through a symlink. The owner becomes the saving user.
// Accepted risk: a write by someone else between steps 2 and 3 is overwritten.
import { exec } from "herdr";
import { createHash } from "crypto";
import { chunkBase64, remoteScripts } from "./lib.js";

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
