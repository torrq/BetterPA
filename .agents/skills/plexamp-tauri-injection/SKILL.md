---
name: plexamp-tauri-injection
description: >-
  Inject custom CSS stylesheets, JavaScript, and desktop layout fixes into
  Plexamp Desktop (v4.50+ / v5) on Windows. Use this skill whenever modifying,
  patching, styling, debugging, or extending Plexamp Desktop's Tauri v2 /
  WebView2 binary or frontend bundle.
---

# Plexamp Desktop (Tauri v2 / WebView2) Injection & Scaling Skill

This skill documents the architecture of Plexamp Desktop (`v4.50+` / `v5`), how its embedded Tauri v2 asset table works, what approaches fail (so you never repeat them), and the exact workflow for injecting live-reloading CSS/JS and fixing desktop layout scaling.

---

## 1. Architecture Overview (Crucial Context)

* **NOT Electron**: Legacy Plexamp (`<4.12`) used Electron (`resources/app.asar`). Modern Plexamp Desktop (`4.50.19+`) is a **Rust Tauri v2 (`tauri-runtime-wry`) + Microsoft Edge WebView2** single-file executable at `%LOCALAPPDATA%\Plexamp\Plexamp.exe`.
* **Embedded Brotli Asset Table**: All frontend files (`/index.html`, `/assets/index-*.js`, `/assets/Player-*.js`, etc.) are compiled directly into the `.rdata` section of `Plexamp.exe` as **Brotli-compressed slices**.
* **Asset Lookup Table Layout**:
  * In `.rdata`, each asset is referenced by a 32-byte Rust fat-pointer entry:
    `[key_va: u64 LE, key_len: u64 LE, val_va: u64 LE, val_len: u64 LE]`
  * To locate an asset in `Plexamp.exe`:
    1. Parse the PE64 header (`e_lfanew` at `0x3c`, `imageBase` at `optHeader + 24`, and section headers for `virtualAddress` and `rawPtr`).
    2. Search the binary for the UTF-8 asset key string (e.g., `/assets/index-BJP5Glp-.js`).
    3. Convert the key's file offset to its 64-bit Virtual Address (`VA = imageBase + section.virtualAddress + (fileOffset - section.rawPtr)`).
    4. Search `.rdata` for the 16-byte pattern `[key_va (u64 LE), key_len (u64 LE)]`.
    5. Read `val_va` (`tableOffset + 16`) and `val_len` (`tableOffset + 24`), and convert `val_va` back to a file offset.

---

## 2. Pitfalls & Dead Ends (DO NOT REPEAT)

Another LLM or developer approaching Plexamp will naturally try several standard techniques that **fail** in Tauri v2. Do not repeat these:

### Dead End 1: Looking for `app.asar` or Electron Flags
* **Why it fails**: There is no `resources/app.asar` and Electron flags like `--remote-debugging-port` do nothing on Tauri/Wry binaries.

### Dead End 2: Injecting Inline `<script>` or `<style>` into `/index.html`
* **Why someone would try it**: `/index.html` is tiny (`3,158` bytes compressed) and easy to decompress/recompress.
* **Why it fails**:
  1. **Compile-time CSP SHA-256 Hashes**: Tauri precomputes SHA-256 hashes (`'sha256-...'`) for every inline `<script>` in `/index.html` at compile time and embeds them in `.rdata`. Any edit to an inline script in `/index.html` is silently blocked by WebView2's Content Security Policy unless its exact SHA-256 token in `.rdata` is also updated.
  2. **Tiny Slot Capacity**: `/index.html` only has `~395` bytes of Brotli spare capacity even at maximum compression (`quality: 11`).
  3. **Runtime Style Nonces**: Tauri uses `<style nonce="__TAURI_STYLE_NONCE__">` in `/index.html`.
* **What works instead**: Leave `/index.html` 100% untouched. Inject into the main ES module bundle (`/assets/index-*.js`, e.g. `/assets/index-BJP5Glp-.js`). Because `/index.html` loads it via `<script type="module" src="...">` from `'self'`, it is trusted by `script-src 'self'` without any inline script hash check, and recompressing the ~2.8 MB bundle at Brotli quality `10` yields **~52.7 KB of spare capacity** (`~66.5 KB` at quality `11`) inside its original binary slot.

### Dead End 3: Using `eval()` for `custom.js` Without Unlocking CSP
* **Why it fails**: Tauri's CSP header does not include `'unsafe-eval'` by default, so `(0, eval)(customJsCode)` throws `EvalError: Evaluating a string as JavaScript violates the following Content Security Policy directive`.
* **What works instead**: Tauri embeds ~120 compile-time 53-byte `'sha256-...'` tokens in `.rdata` (most for unused HTML templates; `/index.html` only uses the last two tokens: `sz7J1...` and `MUVwA...`). Replacing the first unused 53-byte token (`'sha256-U0F0bRNhpYqfdjcQfTzgupdrqV2duhfAVdvI72ELp4s='`) in-place with the exact same-length 53-byte string:
  `'unsafe-eval' 'unsafe-inline' http://asset.localhost `
  unlocks `eval()`, inline scripts/styles, and `asset.localhost` scripts without shifting a single byte in the executable.

### Dead End 4: Using `log_js_error` to Debug or Verify Injection
* **Why it fails**: Calling `window.__TAURI_INTERNALS__.invoke("log_js_error", { error: "..." })` does **not** write to `%LOCALAPPDATA%\Plexamp\logs\Plexamp.log`.
* **What works instead**: Use `window.__TAURI_INTERNALS__.invoke("player_send_log", { level: 3, message: "[BetterPA] ..." })`. This writes directly to `%LOCALAPPDATA%\Plexamp\logs\Plexamp.log` as `[  Treble] DEBUG - [BetterPA] ...` so you can verify execution immediately.

### Dead End 5: Spawning `Plexamp.exe` Directly from Node (`spawn` / `exec`) in Agent Terminals
* **Why it fails**: Windows agent tool runners (`run_command`) execute commands inside a Windows Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. If `patch.js` spawns `Plexamp.exe` directly via Node's `child_process.spawn()`, Windows kills `Plexamp.exe` the instant `node patch.js` exits (~20ms into startup, right after `BASS: Thread pool library is version v3.0.0`), making it appear as if Plexamp crashed on launch.
* **What works instead**: Launch `Plexamp.exe` via WMI (`Win32_Process.Create`):
  ```powershell
  powershell -NoProfile -Command "Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine='C:\Users\...\Plexamp.exe'; CurrentDirectory='C:\Users\...\Plexamp'}"
  ```
  Because `WmiPrvSE.exe` is an external Windows system service outside the caller's Job Object, `Plexamp.exe` starts as an independent desktop process and never gets killed when the CLI command finishes.

### Dead End 6: Piping Multi-line `@'...'@ | node -` in PowerShell
* **Why it fails**: Piping multi-line strings to `node -` in PowerShell frequently leaves `stdin` open or hangs background tasks. Always write a `.js` file and run `node script.js`.

---

## 3. Useful Tauri v2 IPC Commands in `Plexamp.exe`

Available on `window.__TAURI_INTERNALS__`:

| Capability / IPC Call | Purpose |
| :--- | :--- |
| `invoke("open_devtools")` | Opens native Edge WebView2 DevTools (bound by default only to macOS `Meta+Alt+I`; bind to `F12` / `Ctrl+Shift+I` on Windows). |
| `invoke("plugin:webview\|set_webview_zoom", { label: "main", value: 1.15 })` | Smoothly scales the entire WebView UI zoom factor. |
| `invoke("plugin:path\|resolve_directory", { directory: 14 })` | Resolves `$APPDATA` (`%APPDATA%\tv.plex.plexamp`). |
| `invoke("plugin:fs\|read_text_file", { path })` | Reads a file from `$APPDATA/**` or `$APPLOCALDATA/**` (returns UTF-8 `ArrayBuffer` / byte array). |
| `convertFileSrc(localPath)` | Converts a local file path (`$HOME/**`, `$APPDATA/**`, `$APPCACHE/**`) into an `http://asset.localhost/...` URL that can be read via `fetch(url, { cache: "no-store" })`. |
| `invoke("player_send_log", { level: 3, message })` | Writes a log entry directly to `%LOCALAPPDATA%\Plexamp\logs\Plexamp.log`. |

---

## 4. Why Plexamp Scales Poorly on Desktop (and How We Fix It)

### A. Hardcoded JS Layout Checks in `/assets/index-*.js`
1. **iOS `isPad` Gate (`ge.IS_BIG_IPAD_SIZE`)**:
   * Original code: `static IS_BIG_IPAD_SIZE(){const e=Ii.get("window").width;return!!(ks&&e>600)}`
   * Because `ks` (`Platform.isPad`) is `false` on desktop (`Platform.OS === "web"`), `ge.IS_BIG_IPAD_SIZE()` is **always `false` on desktop**!
   * **Fix**: Replace with `static IS_BIG_IPAD_SIZE(){const e=Ii.get("window").width;return e>700}`. This unlocks `30px` desktop margins (`ge.MARGIN`), `8` items per hub request instead of `6`, and tablet grid sizing.
2. **Undersized Album Artwork (`Gs.PosterSize`)**:
   * **Side-by-Side Landscape Player**: Original code uses `Math.round(gt.screenHeight/2.5)` (`432px` on a `1920x1080` monitor, leaving most of the `960x1080` left pane empty).
     * **Fix**: Replace with `Math.round(Math.min(gt.screenWidth*.42,gt.screenHeight*.54))` (`~583px` on 1080p).
   * **Portrait / Half-Screen Desktop Player**: Original code uses `Math.min(i-70,300)` when `Et` (`OS === "web"`) is true, capping album art at a tiny `300px` square!
     * **Fix**: Replace `300` with `Math.min(a-380,540)`.

### B. React Native Web CSS Selectors in `custom.css`
* **Dual CSS Injection**: Always apply `custom.css` to **both** a Constructable Stylesheet (`document.adoptedStyleSheets`) and `<style id="betterpa-custom-css">` kept at `document.head.lastElementChild` via a `MutationObserver`.
* **Hub List Row Padding Selector Caveat**:
  * When `ge.IS_BIG_IPAD_SIZE()` is `false` (width <= 700px), list rows have inline `padding: 7px 15px`.
  * When `ge.IS_BIG_IPAD_SIZE()` is `true` (width > 700px), `ge.MARGIN` becomes `30`, so list rows have inline `padding: 7px 30px`!
  * Therefore, always match `div[style*="padding: 7px "][style*="flex-direction: row"]` (prefix match on `padding: 7px `) rather than hardcoding `15px`.
* **Waveform Seekbar & Volume Width**:
  * The player seekbar and volume slider are wrapped in `div[style*="max-width: 500px"]`. Overriding `max-width: 680px !important` in CSS automatically triggers React Native Web's `ResizeObserver` / `onLayout` to re-render the SVG waveform wider.

---

## 5. Standard Workflow & Verification

1. **Patch & Launch**:
   ```powershell
   node patch.js install
   ```
2. **Verify Status**:
   ```powershell
   node patch.js status
   ```
3. **Verify Runtime Logs**:
   Inspect `%LOCALAPPDATA%\Plexamp\logs\Plexamp.log` and confirm these lines appear on startup:
   ```text
   [  Treble] DEBUG - [BetterPA] Initializing BetterPA runtime...
   [  Treble] DEBUG - [BetterPA] Applied custom.css from .../custom.css (... bytes)
   [  Treble] DEBUG - [BetterPA] Executed custom.js from .../custom.js
   ```
4. **Restore Unpatched Binary**:
   ```powershell
   node patch.js restore
   ```

---

## 6. Component, Store & Element Catalog (`ELEMENTS.md`)

Always consult and update [`ELEMENTS.md`](file:///c:/Users/nathan/Projects/git/BetterPA/ELEMENTS.md) before inspecting or modifying any Plexamp bundle. It contains the full catalog of embedded chunks, MobX stores (`T.*`), sizing/poster classes (`ge`, `gt`, `Gs`), Player & Play Queue components (`p0`, `d0`, `m0`, `Xr`, `Yr`, `qr`, `Xi`, `ji`, `Rct`, `Dc`, `Lc`), DOM selectors, and **version-independent anchor signatures** for surviving Plexamp updates.

