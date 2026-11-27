# PersonalOS

Herdr's default window with two changes for people who work from a file tree. The Files and Changes panel sits on the left of the terminals instead of the right. You can drag any file or folder from Files into a terminal, and its absolute path is typed at the cursor.

## What you see

- Left to right: the Herdr sidebar (268px; spaces, agents, footer), then the work column.
- In the work column, the tab bar (42px) runs across the top and the status bar (28px) runs across the bottom.
- Between them is the `work-body` row (8px padding, 8px gap). Its first child is the side panel (368px wide, 280 to 900px). The panel is a stack holding Files and Changes, and it starts hidden like Herdr's own. Its second child is the terminal panes.
- The look is identical to Herdr's `main` layout, and your theme and settings apply unchanged.

## How it behaves

- The Files and Changes buttons in the tab bar show and hide the panel, as in `main`.
- Clicking a file opens it in a new tab, full size like a terminal, read-only with syntax colors, its path on top and a Reload button. Clicking a folder folds it open or closed as before.
- Pressing a row and dragging it onto a terminal pastes the absolute path of that file or folder at the cursor. Herdr's own terminal drop handling does the pasting, so paths with spaces are escaped exactly as a drop from Finder. Dropping anywhere else cancels.
- Agent status, tabs, spaces and keys behave exactly as in `main`.

## Built from

- `layouts/PersonalOS.json` is a clone of `main` (Herdr 0.1.18). Inside the `work-body` row, the order of children is swapped from `[main, panel]` to `[panel, main]`. In the `panel-body` stack, the `files` block points at `mods/personalos-files` instead of the shipped `files` mod.
- `mods/personalos-files` is a clone of the shipped `files` mod with one added line in `rows()`. Each row gets `.drag_paths([`${this.root}/${path}`], { on: this.on ?? null })`, placed before its `.on_click`. That makes the row a native drag source, and the path keeps the machine it lives on.
- `mods/personalos-viewer` is a new mod that fills a tab. It reads `props().path` and `props().on`, loads the file with `readTextFile`, and shows it in a read-only `Editor` (files over 400,000 characters are cut). Files opens it with `run("tab.new", { name, mod: "personalos-viewer", props: { path, on } })`.
- The other mods are shipped: `workspace-chrome`, `spaces`, `agents`, `tabs`, `changes`, `pane`, `workspace-status`.
- Like the shipped `files` mod, it runs programs to list folders and read git status (`sh`, `git`, and `powershell` on Windows). It reads the folder of the focused terminal.

## Watch out

- Read props with `props()` from "herdr". The `props` argument to `init` stays empty for a mod opened by `tab.new`.

- The mod is a clone, so fixes Herdr ships for `files` do not reach it. On a newer Herdr, clone `files` again and re-add the one `drag_paths` line.
- `drag_paths` must sit on the row element itself, the one with the `.id()`. If you put it on a child, only that child starts a drag.
- Dropping a local path on a terminal of another machine does not copy folders. Herdr says why.

## Done when

- `herdr-app check mods/personalos-files` passes.
- After `layout.switch {"name":"PersonalOS"}`, the Files panel opens on the left of the terminals.
- Dragging a file from Files into a shell types its absolute path, and dragging a folder does the same.
- A click on a file opens a new tab named after it, showing the whole file. A click on a folder still folds it.
