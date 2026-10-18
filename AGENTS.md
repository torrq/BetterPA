# BetterPA Workspace Rules (`AGENTS.md`)

## 1. Consult and Maintain [`ELEMENTS.md`](file:///c:/Users/nathan/Projects/git/BetterPA/ELEMENTS.md)
- **Read Before Reverse-Engineering**: Before searching or inspecting any embedded Plexamp bundle (`/assets/*.js`) or live DOM dump, always check [`ELEMENTS.md`](file:///c:/Users/nathan/Projects/git/BetterPA/ELEMENTS.md) first. All known bundles, MobX stores (`T.*`), sizing/screen classes (`ge`, `gt`, `Gs`), Player/Queue components (`p0`, `d0`, `m0`, `Xr`, `Yr`, `qr`, `Xi`, `ji`, `Rct`, `Dc`, `Lc`, etc.), and React Native Web DOM selectors are cataloged there.
- **Document Every New Discovery Immediately**: Whenever you identify a new Plexamp component, minified symbol, MobX store property/action, Tauri IPC call, or DOM/CSS selector, you **must** update [`ELEMENTS.md`](file:///c:/Users/nathan/Projects/git/BetterPA/ELEMENTS.md) before finishing your turn.
- **Always Record Version-Independent Anchor Signatures**: Because Plexamp updates change Vite chunk hashes and Terser-minified variable names, every entry in `ELEMENTS.md` and every patch in [`patch.js`](file:///c:/Users/nathan/Projects/git/BetterPA/patch.js) must document the **unminified anchor signature** (property names, string literals, icon names, or structural regexes) alongside the current version's minified symbol.

## 2. Safe Binary Patching (`Plexamp.exe`)
- **Never Corrupt the Binary**: Every patched asset slot in `Plexamp.exe` must be Brotli-compressed (`zlib.constants.BROTLI_PARAM_QUALITY: 10` or `11`) to `<= origLen` bytes and padded with trailing `0x00` bytes to match `origLen` **to the exact byte**.
- **Preserve Backup**: Always ensure `Plexamp.exe.bak` exists before writing to `Plexamp.exe`, and keep `node patch.js restore` functional at all times.
