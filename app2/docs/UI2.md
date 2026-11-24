# MobileDAW 2 — plan

MobileDAW 2 is a separate app in `app2/` (see `app2/README.md`); 1.0 in the repository root is not changed by it.
Its workflow and gestures follow Honeydew (an open-source FL Studio Mobile-style studio, GPL-3.0), and its modules are FL Studio
Mobile's own instruments and effects plus MiniMeters, Harmor and Moisture. The look is MobileDAW 2's own: outline icons, rounded-square
controls, theme colours and Indonesian labels.

## Phase 1 (done): main screen — `js/ui2/shell.js`, `css/ui2.css`

| Part | Behaviour |
|---|---|
| **Bottom bar, left** | MIXER (mixer view), RACK (device panel), SUARA (browser) |
| **Bottom bar, centre** | REKAM, AWAL, Play / Pause, BPM, METRO, LOOP. BPM: tap opens the Tempo window, a vertical drag changes the tempo. |
| **Bottom bar, right** | Undo, Redo, CPU % / memory, keyboard (Keys panel) |
| **Track column (left)** | One coloured chip per track, showing the track's kind icon. Tap a chip to widen or narrow the column. The wide column shows the name, on/off, Solo, pan (vertical drag) and volume (horizontal drag); a double tap resets pan or volume. Long-press a chip for the track menu. A vertical drag scrolls the tracks. The "+" button adds a track. |
| **Snap (magnet, top left)** | Tap turns snap on or off; long-press shows the grid menu. |
| **Tap a clip** | Bubbles appear, as in Honeydew: Salin (Copy to the clipboard), Gandakan (Duplicate: a copy right after the clip), Hapus, Snap (edges to the grid), Edit (editor), Lainnya. |
| **Lainnya** | Honeydew's More…: Potong di playhead (Slice), Lepas loop, Gabung (Combine), Bisukan / Bunyikan, Potong rata… (Chop: every 1/6 … 1 beat, audio also at transients), Ganti nama, and all clip commands. |
| **Tap empty space of the current track** | The insert menu, as in Honeydew: Klip baru / Tempel at the snapped beat. A second tap on the same cell hides it; on another track the tap makes that track current. |
| **Double tap** | On a clip: editor (unchanged). On empty space: a new clip. |
| **Ruler range** | Drag sideways to select a range. Its menu has the 1.0 items (Deselect, Insert space, Duplicate, Delete, Delete space, Trim) plus Salin / Pindah ke playhead. |
| **Logo button (top right)** | Opens the main menu. |
| **Main menu tabs** | LAGU (new, open, import, recent songs), PROYEK (save, save as, quick render, song info, tempo − / +), EKSPOR, PENGATURAN (theme, column, follow, snap, all settings), BANTUAN (tutorial, about, gesture list) |

In 2.0 the timeline runs in `TL.setV2(true)` mode:

- The canvas has no header column and no bottom time ruler.
- A tapped clip calls `hooks.clipTap` instead of opening the context menu.
- The selected clip gets a white frame.
- The shell reads the row geometry through the `TL.v2*` exports.

Test: `tools/app2-test.mjs`. It covers the bar, the column, the bubbles, the insert menu, undo, volume / mute, the range → playhead command, the menu, the module lists, and that MobileDAW 2 keeps its own settings.

## Next phases (each following Honeydew's controls and gestures)

2. **Rack panel from the right.** Module cards (on / off, icon, name, preset ▸, ☰), a module list from the left with search, rack presets, and Sends.
3. **Piano roll.** Note bubbles (Salin / Hapus / Snap / Lainnya), and a Lainnya menu with Legato, Snap ke skala, Humanize, Double up / down, Toggle slide, set length, Transpose, and a ↑ / ↓ stepper. Also a Vel / Pan panel.
4. **Step sequencer.** Big channel names, Swing, and Mixer / Sample / Envelope / Seq tabs.
5. **Mixer.** Vertical strips with a pan ring and on / Solo buttons, plus a split view with the keyboard (key, scale, keyboard type).
