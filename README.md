# herdr-personalos

A [Herdr](https://herdr.dev) layout: the Files panel on the left, and drag a file or folder from Files into a terminal to type its path. Click a file to open it in its own tab: raw, rendered (Markdown, HTML, images), editable with safe saves (also on remote machines), or in the macOS default app. Right-click a file or folder for a VS Code style menu: new file and folder, cut, copy, paste, duplicate, copy path, rename, and delete to the Trash. Hold ⌥ and drag a row onto a folder to move it, or drop files from Finder to copy them in.

The two mods are also shared on their own, for people who want them in their current layout: [herdr-file-viewer](https://github.com/wiraperdana/herdr-file-viewer) and [herdr-file-explorer](https://github.com/wiraperdana/herdr-file-explorer). This layout is the one-step way to get both, arranged as shown.

## Install

Copy the files into your Herdr home, then switch to the layout:

```sh
cp layouts/PersonalOS.json ~/.config/herdr-app/layouts/
cp -R mods/file-explorer mods/file-viewer ~/.config/herdr-app/mods/
herdr-app check ~/.config/herdr-app/mods/file-explorer
herdr-app check ~/.config/herdr-app/mods/file-viewer
herdr-app do layout.switch '{"name":"PersonalOS"}'
```

Then merge the viewer's shortcuts (⌘E, ⌘R, ⌘S, ⌘O while a viewer has focus) from `mods/file-viewer/keys.json` into `~/.config/herdr-app/keys.json`. Add the `mod:file-viewer` section; don't replace your other keys. Editing `keys.json` makes it yours, so Herdr stops adding new default shortcuts to it on upgrade.

Tests for the pure logic: `node --test tests/lib.test.mjs tests/ops.test.mjs` (Node 18 or newer).

Or ask the agent inside Herdr to add `herdr.dev/layouts/wiraperdana/herdr-personalos`. `ctrl-shift-l` switches back to your previous layout.

See [RECIPE.md](RECIPE.md) for how it is built.

## License

Apache-2.0. The `file-explorer` mod and parts of `file-viewer` are derived from Herdr's `files` mod. See [NOTICE](NOTICE).

## Upgrading from an earlier version

The mods were called `personalos-files` and `personalos-viewer` before 2026-11-27. They are now `file-explorer` and `file-viewer`. Copy the new folders in, delete the old ones from `~/.config/herdr-app/mods/`, and rename the `mod:personalos-viewer` section in your `keys.json` to `mod:file-viewer` (its commands too). In `shared.json`, rename `personalos-viewer.modes` and `personalos-viewer.drafts` to `file-viewer.modes` and `file-viewer.drafts` to keep remembered modes and unsaved drafts.
