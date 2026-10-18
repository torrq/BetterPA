---
trigger: always_on
description: Always consult and update ELEMENTS.md whenever inspecting, reverse-engineering, or patching Plexamp bundles, stores, components, or DOM elements.
---

# Plexamp Element & Component Documentation Rule (`ELEMENTS.md`)

1. **Consult `ELEMENTS.md` First**:
   - Before searching, decompiling, or inspecting any Plexamp JS bundle (`/assets/*.js`) or DOM hierarchy, ALWAYS read [`ELEMENTS.md`](file:///c:/Users/nathan/Projects/git/BetterPA/ELEMENTS.md) first. Do not re-discover symbols, stores, components, or selectors that are already documented there.

2. **Use Version-Independent Anchor Signatures**:
   - When writing or updating patches in [`patch.js`](file:///c:/Users/nathan/Projects/git/BetterPA/patch.js), prefer matching **unminified anchor signatures** (property names, MobX store keys, method names, icon strings, or structural regexes documented in `ELEMENTS.md`) over hardcoded chunk hashes or single-version minified variable names so patches survive Plexamp updates.

3. **Mandatory Updates to `ELEMENTS.md`**:
   - Whenever you discover a new Plexamp bundle chunk, MobX store property/method, layout/sizing constant, React component, Tauri IPC command, or React Native Web DOM/CSS selector, you **MUST** immediately add it to [`ELEMENTS.md`](file:///c:/Users/nathan/Projects/git/BetterPA/ELEMENTS.md) in the same turn.
   - Every entry added to `ELEMENTS.md` MUST include both:
     - Its current minified symbol name (for quick reference), AND
     - Its **Version-Independent Anchor Signature** (unminified strings, properties, or regex pattern) so future Plexamp updates can locate it automatically.
