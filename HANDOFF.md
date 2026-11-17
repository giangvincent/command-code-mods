# Handoff — Sidebar pins for the Command Code desktop app

Written 2026-11-16. Next session focus: keep the patched sidebar working across app
updates, and fix anything the user reports about it in the live app.

## Goal

The user wants project/session pinning in the Command Code desktop app sidebar:
pinned projects in their own section on top (pin-time order, uncapped), projects otherwise
by recent activity, per-project pinned sessions fixed above a collapsed 4-row list that
expands to a 6-row inner-scroll window, hover pin + context menu, 4th pin replacing the
least-recent with a named toast, auto-scroll to active, and a floating pinned navigator
(button bottom-right plus Cmd/Ctrl+Up, arrows/Enter/Esc).

## Decisions already settled (do not re-open)

- **Sidebar only.** No plugin system; local-only persistence is acceptable.
- **Mods cannot do this.** Verified in the app's own docs at
  `@commandcode/harness/dist/bundled/mod-builder/reference/{ui,overview}.md`: mods never
  mount components, `ui.override` covers only spinner/tool rows/user message/command
  output, `addShortcut` never fires in the desktop app, pane `input`/`select` are not
  focusable there. Nothing reaches the sidebar.
- **App source is not public.** `github.com/CommandCodeAI/desktop` holds installers and
  docs only (11 files). The installed app is a minified, signed Electron bundle.
- **Approach chosen:** inject one same-origin script into the renderer `index.html` and
  drive the sidebar through its own DOM. No React/`out/main` edits.
- An earlier session mistakenly implemented this feature in `~/Documents/commandcode-chat`
  (a separate web app). Those edits are still uncommitted there — see "Open items".

## What exists

`~/Documents/Command Code plugin/`

| File | Role |
|---|---|
| `cmd-sidebar-pins.js` | The overlay. Plain JS, no build step, ~550 lines. |
| `patch-sidebar.sh` | Installer. `./patch-sidebar.sh` / `--check` / `--restore`. |
| `sidebar-pins-prototype.html` | Published clickable prototype, artifact id `i8neztoda1shhgsb`. |
| `HANDOFF.md` | This file. |

Installed app target: `/Applications/Command Code.app` (0.1.62, `ai.commandcode.desktop`,
Team `LQUM87VV79`). Override with `APP=` for another install.

## Current state

**The patch is applied** to the live app (`./patch-sidebar.sh --check` reports
`patched: yes`). `index.html` has `<!-- cc-sidebar-pins -->` plus one deferred script tag;
`assets/cmd-sidebar-pins.js` is installed; the bundle was ad-hoc re-signed
(`codesign --force --sign -`), which the app tolerates — it launches and runs.

DOM hooks the overlay relies on, all read from the shipped bundle:
`nav[data-sidebar-chats]`, one `section[aria-label]` per project, project header button
whose `title` is the folder path, `[data-thread-id]` per row, `aria-current="page"` for the
active row. State lives in `localStorage` under `cc-sidebar-pins-v1`.

The overlay is fail-safe: no nav, no scrollable viewport, or no parsed projects ⇒ it draws
nothing and removes itself. A mutation observer ignores writes inside its own host, so it
cannot loop.

## Verified

- Installer: idempotent re-runs; `--restore` returns `index.html` byte-identical to the
  shipping file; overlay passes `node --check`.
- Overlay, in a real browser against a fixture reproducing the bundle's markup (fixture was
  in the session scratchpad, no longer needed): 4-row cap with `+N` toggle, 6-row window
  with `maxHeight:180px; overflow:auto` on expand, pin/unpin, 4th pin evicting the
  least-recent with a named toast, Pinned section on top, project pinning, Ctrl+Up palette
  with arrows/Enter/Esc, palette including session pins from unpinned projects, and jumps
  clicking the real row.

## NOT verified

The real running app's DOM. Two blockers hit, both environment permissions rather than
code: `screencapture` cannot create an image (no Screen Recording permission for this
process), and `--remote-debugging-port=9222` is ignored by the app, so `/json/list` is
unreachable. First task next session: ask the user what the sidebar actually looks like.

## Commands

```bash
cd "/Users/giangvincent/Documents/Command Code plugin"
./patch-sidebar.sh --check      # patched? overlay present?
./patch-sidebar.sh              # apply / re-apply after an app update
./patch-sidebar.sh --restore    # back to the shipping bundle
```

Re-run `./patch-sidebar.sh` after every app update — the update replaces the whole bundle.
The backup written at first patch is `index.html.ccsp-orig`.

## Open items

1. **Real-DOM validation.** Confirm the overlay renders in the live app, that row titles and
   the active highlight read correctly, and that clicking a pinned row navigates.
2. **Hover-only pin icon.** Spec asked for hover icon + context menu; only the pin button and
   right-click menu exist, because inserting nodes inside React-owned rows risks
   reconciliation errors. Only pursue if the user insists.
3. **Overlay theming.** It paints with the sidebar's computed background and hard-coded
   greys; it does not use the app's theme tokens. Fix if the user switches light theme.
4. **Upstream option.** The alternative to patching is a feature request on
   `CommandCodeAI/desktop` issues (spec + prototype are ready to paste). Not started.
5. **Stray edits in `~/Documents/commandcode-chat`** — `src/components/chat.tsx`,
   `src/lib/sidebar.ts`, plus untracked `src/lib/sidebar-pins.ts` and
   `tests/sidebar-pins.test.ts`. That repo already had uncommitted pins work before this
   session, so nothing was reverted. Ask the user before doing anything there; back up first
   if they want it reverted.

## Suggested skills

- `grilling` — if the user revises the pin behaviour spec before more code changes.
- `command-code-knowledge` — before answering further questions about the app's own
  features, commands, or extension surface.
- `code-review` — before shipping any larger change to the overlay.
- `handoff-writer` — for the next handoff.
