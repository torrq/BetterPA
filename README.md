# BetterPA — Custom CSS, JS & Split-Screen Desktop Player for Plexamp

Modern versions of **Plexamp Desktop** (`v4.50+` / `v5`) run on **Tauri v2** (**Microsoft Edge WebView2** on Windows, **WebKitGTK** on Linux), with all frontend assets (`/index.html`, `/assets/*.js`) compiled directly into the executable (`Plexamp.exe` / `plexamp`) as Brotli-compressed slices. Because Plexamp's React Native Web UI was designed around mobile/tablet dimensions, the default desktop interface underutilizes widescreen monitors.

**BetterPA** non-destructively patches the embedded frontend bundles inside the Plexamp binary (preserving a clean `.bak` backup) to provide:

1. **Split-Screen Desktop Player Layout**:
   - **Top-Left**: Maximum edge-to-edge square album artwork (`min(52% width, height - 104px)`).
   - **Top-Right**: Mouse-wheel scrollable Play Queue / Up Next / Related tracks (expanded to `50` visible items).
   - **Full-Width Bottom Bar (`104px`)**: Wide Artist / Title / Album metadata + never-truncated Codec / Star Rating / Sample Rate (`FLAC ★★★★★ 44.1 kHz`) on the left, **exact-centered** transport controls in the middle, Volume slider + utility actions on the right, and a **100% full-width SVG waveform seekbar** spanning the bottom.
2. **Live Hot-Reloading [`custom.css`](./custom.css)** (~800ms automatic polling + manual `Ctrl+Shift+R` shortcut).
3. **Custom User Script [`custom.js`](./custom.js)** with full access to `window.__PLEXAMP__` (`{ store, layout, screen, poster, fs }`) for scripting and DevTools inspection.
4. **Desktop Keyboard Shortcuts**: `F12` / `Ctrl+Shift+I` for DevTools, `Ctrl+Shift+R` for instant CSS reload, and `Ctrl+=` / `Ctrl+-` / `Ctrl+0` for smooth persistent UI zoom.

---

## Requirements

- **Node.js**: `v18.0.0` or newer (uses only built-in Node modules: `fs`, `os`, `path`, `zlib`, `child_process` — **zero `npm install` dependencies required**).
- **Plexamp Desktop**: `v4.50.x` or newer on **Windows** (`x64`) or **Linux** (`x86_64`).

---

## Quick Start — Windows

1. **Clone or open this repository**:
   ```powershell
   cd C:\path\to\BetterPA
   ```

2. **Install the patch**:
   ```powershell
   node patch.js install
   ```
   **What `node patch.js install` does automatically:**
   - Locates `%LOCALAPPDATA%\Plexamp\Plexamp.exe` and saves a clean backup at `%LOCALAPPDATA%\Plexamp\Plexamp.exe.bak`.
   - Patches `/assets/index-*.js` and `/assets/Player-*.js` inside the PE64 `.rdata` asset table using Brotli quality `10` (fitting with ~40–50 KB of spare room inside each original binary slot).
   - Unlocks Content Security Policy (`script-src`) in-place so `custom.js` can run freely.
   - Hardlinks (or copies) [`custom.css`](./custom.css) and [`custom.js`](./custom.js) into `%APPDATA%\tv.plex.plexamp\`.
   - Stops any running Plexamp instance, writes the patched binary, and launches Plexamp.

3. **Edit styles live**:
   - Open [`custom.css`](./custom.css) in any editor and save—Plexamp hot-reloads changes within **~800ms** without restarting.

---

## Quick Start — Linux

BetterPA's [`patch.js`](./patch.js) natively parses **Linux `ELF64`** (`PT_LOAD`) headers as well as Windows `PE64` headers, and syncs [`custom.css`](./custom.css) and [`custom.js`](./custom.js) to `~/.config/tv.plex.plexamp/` and `~/.local/share/tv.plex.plexamp/`.

### Option A: Native Package Install (AUR / `.deb` / `/opt/Plexamp`)

If Plexamp is installed to `/opt/Plexamp/plexamp` or `/usr/bin/plexamp`:

```bash
git clone https://github.com/your-username/BetterPA.git
cd BetterPA

# If /opt/Plexamp/plexamp is owned by root, grant write access or run with sudo:
sudo chown -R "$USER:$USER" /opt/Plexamp

# Apply the patch (auto-detects /opt/Plexamp/plexamp or /usr/bin/plexamp)
node patch.js install

# Or specify a custom binary path explicitly:
node patch.js install --exe /path/to/plexamp
```

### Option B: `.AppImage` Install (`Plexamp-x.y.z.AppImage`)

Because an `.AppImage` is a SquashFS filesystem image appended to an ELF runtime stub, extract it first, run `patch.js`, and either run the extracted `AppRun` directly or repackage it into a new `.AppImage`:

```bash
# 1. Extract the AppImage into ./squashfs-root
chmod +x Plexamp-*.AppImage
./Plexamp-*.AppImage --appimage-extract

# 2. Patch the extracted ELF64 binary inside squashfs-root
node patch.js install --exe ./squashfs-root/usr/bin/plexamp

# 3a. Run directly from ./squashfs-root/AppRun:
./squashfs-root/AppRun

# 3b. (Optional) Repackage into a standalone AppImage using appimagetool:
ARCH=x86_64 appimagetool squashfs-root Plexamp-BetterPA-x86_64.AppImage
chmod +x Plexamp-BetterPA-x86_64.AppImage
```

### Option C: Flatpak Install (`tv.plex.Plexamp`)

1. Patch the Flatpak binary:
   ```bash
   # User Flatpak install:
   node patch.js install --exe ~/.local/share/flatpak/app/tv.plex.Plexamp/current/active/files/bin/plexamp

   # Or System Flatpak install:
   sudo node patch.js install --exe /var/lib/flatpak/app/tv.plex.Plexamp/current/active/files/bin/plexamp
   ```
2. Ensure [`custom.css`](./custom.css) and [`custom.js`](./custom.js) are inside the Flatpak sandbox config directory (done automatically by `patch.js` if the directory exists, or grant filesystem access):
   ```bash
   flatpak override --user --filesystem=xdg-config/tv.plex.plexamp:ro tv.plex.Plexamp
   ```

---

## Keyboard Shortcuts Inside Plexamp

| Shortcut | Action |
| :--- | :--- |
| `F12` or `Ctrl+Shift+I` | Open native **WebView DevTools** (Edge WebView2 on Windows / WebKitGTK Inspector on Linux) |
| `Ctrl+Shift+R` | Force immediate reload of [`custom.css`](./custom.css) |
| `Ctrl+=` / `Ctrl++` | Zoom UI **in** by `5%` (up to `250%`, persisted across restarts) |
| `Ctrl+-` | Zoom UI **out** by `5%` (down to `50%`, persisted across restarts) |
| `Ctrl+0` | Reset UI zoom to `100%` |

---

## CLI Commands

```bash
# Apply or update the patch (safe to re-run any time)
node patch.js install

# Specify a custom executable path or skip auto-restarting Plexamp
node patch.js install --exe /path/to/plexamp --no-restart

# Check current patch status and binary offsets
node patch.js status

# Restore the untouched original binary from .bak
node patch.js restore

# Extract the embedded /index.html to ./extracted-index.html for reference
node patch.js extract-html
```

---

## Customizing Styles & Scripts

### 1. [`custom.css`](./custom.css)
Out of the box, `custom.css` includes:
- **Multi-column responsive CSS Grid** for Home & Hub lists (*Recent Plays*, *Recent Playlists*, *Stations*) on windows wider than `760px`.
- **Desktop card polish**: Rounded list cards (`10px`), hover highlights, and scaled-up `54px` thumbnails (up from `46px`).
- **Expanded Player & Queue Polish**: Full-width SVG waveform container rules and clean scrollbar styling.
- **Centered Bottom Navigation Bar**: Caps the bottom `tablist` at `760px` centered so tabs aren't stretched across ultrawide/1080p monitors.

### 2. [`custom.js`](./custom.js)
Runs once on startup after the DOM is ready. BetterPA exposes Plexamp's internal objects on `window.__PLEXAMP__`:
- `window.__PLEXAMP__.store` — Root MobX store (`store.player`, `store.settings`, `store.app`, `store.styles`)
- `window.__PLEXAMP__.layout` — Layout constants class (`IS_BIG_IPAD_SIZE()`, `MARGIN`, `GRID_IMAGE_SIZE`, etc.)
- `window.__PLEXAMP__.screen` — Screen dimensions and orientation state (`screenWidth`, `screenHeight`, `landscape`)
- `window.__PLEXAMP__.poster` — Artwork sizing (`PosterSize()`, `PosterRequestSize()`, `RoundedPoster()`)
- `window.__PLEXAMP__.fs` — Tauri filesystem wrapper

*(Note: After editing `custom.js`, restart Plexamp or run `node patch.js install` if `custom.js` was copied instead of hardlinked.)*

---

## Verifying & Troubleshooting

- **Check Logs**:
  - **Windows**: `%LOCALAPPDATA%\Plexamp\logs\Plexamp.log`
    ```powershell
    Select-String -Path "$env:LOCALAPPDATA\Plexamp\logs\Plexamp.log" -Pattern "BetterPA"
    ```
  - **Linux**: `~/.cache/tv.plex.plexamp/logs/Plexamp.log` (or `~/.local/share/tv.plex.plexamp/logs/Plexamp.log`)
    ```bash
    grep "BetterPA" ~/.cache/tv.plex.plexamp/logs/Plexamp.log ~/.local/share/tv.plex.plexamp/logs/Plexamp.log 2>/dev/null
    ```
- **After a Plexamp Update**: If Plexamp updates to a new version, delete the old `.bak` file (`Plexamp.exe.bak` or `plexamp.bak`) and run `node patch.js install` again to back up and patch the new binary.
- **Architecture & Component Reference**:
  - See [`ELEMENTS.md`](./ELEMENTS.md) for the complete catalog of Plexamp's internal React components, MobX stores, layout sizing classes, DOM selectors, and version-independent anchor signatures.
  - See [`SKILL.md`](./SKILL.md) (and [`.agents/skills/plexamp-tauri-injection/SKILL.md`](./.agents/skills/plexamp-tauri-injection/SKILL.md)) for binary asset table details, Tauri v2 CSP unlocking, and reverse-engineering notes.
