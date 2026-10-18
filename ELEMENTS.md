# Plexamp Desktop Architecture, Components & Element Reference (`ELEMENTS.md`)

> [!IMPORTANT]
> **Single Source of Truth**: This document catalogs every reverse-engineered Plexamp bundle, MobX store, layout class, React component, and React Native Web DOM selector discovered so far.
>
> **Why Anchor Signatures Matter for Updates**: When Plexamp updates, Vite/Rollup regenerates chunk hashes (e.g., `Player-CYi7FNvM.js`) and Terser re-assigns minified local symbol names (`p0`, `Xr`, `Rct`, `Gs`, etc.). However, **unminified object property names, MobX observable/action names, React prop names, StyleSheet keys, and icon string literals remain unchanged across versions**. Every entry below includes both its **v4.50.19 minified symbol** and its **Version-Independent Anchor Signature** so future updates can locate and patch every target automatically without re-inspecting the bundles from scratch.

---

## 1. Embedded Asset Bundles (`Plexamp.exe` Tauri v2 Table)

Rather than hardcoding chunk hashes, resolve bundle names dynamically from `/index.html` inside the PE64 `.rdata` asset table:

| Role | v4.50.19 Asset Path | Uncompressed Size | Spare @ Brotli q10 | Version-Independent Discovery Method / Anchor |
| :--- | :--- | :--- | :--- | :--- |
| **HTML Entrypoint** | `/index.html` | `7,448 B` (`3,158 B` br) | `~117 B` | Exact key `"/index.html"` in Tauri asset table |
| **Bootstrap Entry** | `/assets/index-DyWjVV-d.js` | `~1.2 KB` | Small | `<script type="module" crossorigin src="/assets/index-*.js">` in `/index.html` |
| **Core / Store / UI Engine** | `/assets/index-BJP5Glp-.js` | `2,849,642 B` (`778,485 B` br) | **`~52,700 B`** | First `<link rel="modulepreload" as="script" crossorigin href="/assets/index-*.js">` in `/index.html`; contains `"useTabletSideBySideLayout"` and `"IS_BIG_IPAD_SIZE"` |
| **Player & Play Queue** | `/assets/Player-CYi7FNvM.js` | `~465 KB` (`129,808 B` br) | **`~8,451 B`** | Modulepreload matching `/assets/Player-*.js`; contains `"button-queue-on"` and `"BACK TO","UP NEXT","RELATED"` |
| **Home Screen** | `/assets/HomeScreen-BsoUMxjY.js` | Preloaded chunk | ~5–10% | Modulepreload matching `/assets/HomeScreen-*.js` |
| **Hub Carousels** | `/assets/HubList-DYTGDbOO.js` | Preloaded chunk | ~5–10% | Modulepreload matching `/assets/HubList-*.js` |
| **Track Row & Album Grid Item** | `/assets/TrackItem-UZUqQ-wn.js` | Preloaded chunk | ~5–10% | Modulepreload matching `/assets/TrackItem-*.js`; exports Album/Artist/Track grid & list items |
| **Track List** | `/assets/TrackItemList-Bq4n75EJ.js` | Preloaded chunk | ~5–10% | Modulepreload matching `/assets/TrackItemList-*.js` |
| **Virtualized Library Grid Screen** | `/assets/LibraryGridScreen-C_X640GC.js` | Lazy chunk | ~5–10% | Contains `"library-grid"`, `GridLayoutProvider`, and `alphaEndpoint` dot/letter jump bar (`je`) |
| **RecyclerListView Wrapper** | `/assets/RecyclerListViewWrapper-C_-eWRiu.js` | Preloaded chunk | ~5–10% | Modulepreload matching `/assets/RecyclerListViewWrapper-*.js`; exports `GridLayoutProvider` |
| **Media / Album / Artist Screen** | `/assets/MediaScreen-DvbJFTCY.js` | Preloaded chunk | ~5–10% | Modulepreload matching `/assets/MediaScreen-*.js` |
| **Grid Component** | `/assets/Grid-DIBGDJbi.js` | Preloaded chunk | ~5–10% | Modulepreload matching `/assets/Grid-*.js` |
| **List Sizing & Styles** | `/assets/ListStyles-2AuBPn0S.js` | Preloaded chunk | ~5–10% | Modulepreload matching `/assets/ListStyles-*.js` |

### 1.1 Tauri v2 & Custom Rust IPC Commands (`window.__TAURI_INTERNALS__.invoke`)
| IPC Command | Arguments | Purpose & Caveats |
| :--- | :--- | :--- |
| `"plugin:webview\|internal_toggle_devtools"` | *(none)* | Built-in Tauri v2 webview plugin command bound to `Ctrl+Shift+I` on Windows. **Caveat**: Never call `e.preventDefault()` or `e.stopPropagation()` on `F12` or `Ctrl+Shift+I` in a capture-phase `keydown` listener, or you will block WebView2's native `F12` accelerator and Tauri's `document` keydown listener! Invoke `"plugin:webview\|internal_toggle_devtools"` directly on `F12`. |
| `"open_devtools"` | *(none)* | Custom Plexamp Rust command (bound to `Cmd+Opt+I` on macOS in `index-*.js`). |
| `"plugin:webview\|set_webview_zoom"` | `{ label: "main", value: number }` | Scales the entire WebView2 DPI zoom factor (`1.0` = 100%). |
| `"plugin:fs\|read_text_file"` | `{ path: string }` | Reads a local UTF-8 file as an `ArrayBuffer`/`Uint8Array` (scoped to `%APPDATA%\tv.plex.plexamp\`). |
| `"plugin:path\|resolve_directory"` | `{ directory: 14 }` | Resolves `%APPDATA%\tv.plex.plexamp` (`BaseDirectory.AppData = 14`). |
| `"player_send_log"` | `{ level: 3, message: string }` | Writes a log line to `%LOCALAPPDATA%\Plexamp\logs\Plexamp.log` under `[  Treble] DEBUG`. |

---

## 2. Core Bundle Exports & Singletons (`/assets/index-*.js`)

BetterPA exposes these on `window.__PLEXAMP__` at runtime (`{ store: T, layout: ge, screen: gt, poster: Gs, fs: F }`).

### 2.1 Platform Flags
| Concept | v4.50.19 Symbol | Export Alias (in `index`) | Import Alias (in `Player`) | Version-Independent Anchor Signature |
| :--- | :--- | :--- | :--- | :--- |
| **Is Web** (`Platform.OS === "web"`) | `Et` | `n` | `Ke` | `Te.OS==="web"` |
| **Is iOS** (`Platform.OS === "ios"`) | `gi` | `i` | `ut` | `Te.OS==="ios"` |
| **Is Desktop** (`macos` or `windows`) | `Lt` | `d` | `st` | `Te.OS==="macos"\|\|Te.OS==="windows"` |
| **Is iPad** (`Platform.isPad`) | `ks` | `u` | `at` | `"isPad"in Te&&Te.isPad` |

### 2.2 Root MobX Store (`T`)
- **v4.50.19 Symbol**: `T` (exported as `a as T` from `index-*.js`, imported as `a as T` in `Player-*.js`)
- **Anchor Signature**: Singleton containing `.player`, `.settings`, `.app`, `.styles`, `.menu`, `.playerRoute`, `.Cast`. Locate via `T.settings.playerSideBySideLayout` or `T.app.useTabletSideBySideLayout`.

#### `T.player` (Playback, Queue, Loudness, Visualizer & Sub-stores)
All property and method names below are **unminified** and stable across Plexamp versions:
- **Track & Queue State**:
  - `currentTrack`: Active track object (`id`, `key`, `metadata` (`title`, `grandparentTitle`, `originalTitle`, `parentTitle`, `year`, `duration`, `parentYear`), `palette`, `gradientColors`, `accentColors`, `loudness`, `userRating`, `media`, `source`)
  - `upcomingTrack`: Next track in queue
  - `playQueue`: Full play queue collection (`items`, `selectedItemOffset`, `isRemote`, `canControl`, `shuffle`, `shuffled`, `unshuffle()`, `shufflePlayQueue()`)
  - `upNext`: Array of upcoming queue tracks
  - `backTo`: Array of previously played tracks/sources
  - `isOfflinePlayQueue`: Boolean
- **Playback State & Timing**:
  - `state`: `"playing"` | `"paused"` | `"buffering"` | `"stopped"`
  - `time`: Elapsed playback position in seconds/ms
  - `duration`: Total track duration
  - `buffered`: Buffered position
  - `repeatMode`: Current repeat mode (`0` = off, `1` = all, `2` = one)
- **Visuals & Feature Sub-stores**:
  - `visualizerMode`: `"art"` | `"viz"`
  - `visualizerProgram`: Current visualizer shader/program ID
  - `lyricPlayerStore`: `{ visible: boolean, currentLyrics, ... }`
  - `deeJayStore` / `deeJayMode`: Guest DJ configuration and active mode
  - `recommendedTrackStore`: `{ sonicallySimilar, related, outsideComfortZone }`
  - `autoPlayStore`: AutoPlay / radio continuation card at bottom of Up Next
- **Actions (Methods)**:
  - `playPause()`, `previousTrack()`, `nextTrack()`, `skipToNextAlbum()`, `stopPlayback()`
  - `seekTo(position)`, `skipToTrack(item)`, `removeFromPlayQueue(item)`, `reorderPlayQueue(fromIndex, toIndex)`
  - `rate(rating)`, `hideFullscreenPlayer()`

#### `T.settings` (User Preferences — Unminified Observable Keys)
- `playerSideBySideLayout`: Boolean (enables tablet/desktop side-by-side player when `useTabletSideBySideLayout` is true)
- `playerShowPlayQueue`: Boolean (toggles Play Queue visibility in `p0` side-by-side player)
- `playerShowVolume`: Boolean (shows `da` volume slider inside player)
- `playerShowCodec`: Boolean (shows `Xi` codec/sample-rate badge)
- `playerShowYear`: Boolean (appends `(year)` to album line in `qr`)
- `playQueueTabIndex`: Integer (`0` = `BACK TO`, `1` = `UP NEXT`, `2` = `RELATED`)
- `gridSize`: `"normal"` | `"large"`
- `showAlbumCodecBadges`: Boolean
- `preferFullStars`: Boolean (`true` = 5-star rating widget `gx`, `false` = single-star/half-star widget `vx`)
- `showMusicSkip`: Boolean (shows skip backward/forward buttons on music tracks)
- `playerSkipBackwardsSeconds` / `playerSkipForwardsSeconds`: Skip step durations

#### `T.app` (Application & Layout State — Unminified Keys)
- `useTabletSideBySideLayout`: Getter controlling whether the side-by-side player (`p0`) is eligible in landscape:
  - **Anchor Signature**: `get useTabletSideBySideLayout(){return this.rootStore.settings.playerSideBySideLayout?`
  - **Original Logic**: `this.rootStore.settings.playerSideBySideLayout ? (<isWeb> && <screen>.screenWidth > 500 && <screen>.screenHeight > 680 ? !0 : <isTabletCheck>()) : !1`
  - **BetterPA Patch**: Lower height threshold from `680` to `350` (`screenWidth > 500 && screenHeight > 350`) so landscape desktop windows of any normal height enter the side-by-side layout.
- `server`, `library`, `networkType`, `windowSize`, `windowFocused`, `activity`

#### `T.styles` (Theme & Dynamic Palette Colors — Unminified Keys)
- `dark`: Boolean
- `style`: `{ background, backgroundColorOverlay, placeHolderBackgroundColor, textColor, lightTextColor, faintTextColor, buttonOverlayColor, seekBarFutureNormalColor, seekBarPastNormalColor, playerProgressBarColorPast, playerProgressBarBackgroundColor, playerProgressTrackColor }`
- `overlayStyle()`: Method returning dynamic backdrop style

---

## 3. Sizing, Screen & Poster Classes (`/assets/index-*.js`)

### 3.1 Layout Constants Class (`ge`) & Grid Column Math (`Au` / `z0t`)
- **v4.50.19 Symbols**: `ge` (exported as `g as ge`) and `Au` (exported as `G as Au`), plus grid column count helper `z0t` (exported as `a6 as Ct` in `LibraryGridScreen`).
- **Anchor Signature**: Static methods/getters `IS_BIG_IPAD_SIZE()`, `MINI_PLAYER_HEIGHT`, `LIST_ITEM_HEIGHT`, `GRID_IMAGE_SIZE`, `GRID_ITEM_MIN_WIDTH`, `GRID_LAYOUT_MARGIN_HORIZONTAL`.
- **CRITICAL CAVEAT — Do NOT Force `ge.IS_BIG_IPAD_SIZE()` to `true` on Desktop**:
  - `ge.IS_BIG_IPAD_SIZE()` is **not** used by `useTabletSideBySideLayout` (the player layout).
  - Instead, forcing `IS_BIG_IPAD_SIZE()` to `true` doubles `ge.MARGIN` from `15` to `30`, triples `Au.GRID_LAYOUT_MARGIN_HORIZONTAL` (`ge.MARGIN * 2 - ge.SPACER`) from `15` to `45`, and adds `+20px` / `+25px` to `Au.GRID_ITEM_MIN_WIDTH`.
  - In `LibraryGridScreen` (e.g., *"Recently Added in Music"*), `z0t` computes the column count as:
    `n = Math.floor((gt.screenWidth - t) / (Au.GRID_ITEM_MIN_WIDTH + 4))`
    and each album item (`hnt` / `pnt`) renders at fixed `Au.GRID_IMAGE_SIZE` (`170px` or `120px`) left-aligned inside its virtualized cell (`width = _layout.width / n`). When `IS_BIG_IPAD_SIZE()` is forced `true`, `n` drops by 1–2 columns, inflating cell widths far beyond `GRID_IMAGE_SIZE` and leaving a large empty gap on the right side of the album grid! Keep `IS_BIG_IPAD_SIZE()` unpatched (`false` on desktop).
  - `ge.MARGIN`: `30` when `IS_BIG_IPAD_SIZE()` is true, else `15`. *(Important: changes inline row padding from `7px 15px` to `7px 30px` when window width > 700px!)*
  - `ge.SPACER`: `15`
  - `ge.LIST_SPACER`: `7`
  - `ge.LIST_IMAGE_SIZE`: `Adjust(46)` (`46px` square list thumbnail)
  - `ge.LIST_SMALL_ITEM_HEIGHT`: `Adjust(45)`
  - `ge.LIST_ITEM_HEIGHT`: `Adjust(59)`
  - `ge.LIST_ITEM_TALLER_HEIGHT`: `Adjust(70)`
  - `ge.MINI_PLAYER_HEIGHT`: `Adjust(60)`
  - `ge.PLAYER_ICON_SIZE`: `28` on web, `30` on native
  - `ge.GRID_IMAGE_SIZE`, `ge.GRID_ITEM_MIN_WIDTH`, `ge.GRID_BORDER_RADIUS`

### 3.2 Screen & Orientation Class (`gt` / `class rA`)
- **v4.50.19 Symbol**: `class rA`, singleton `gt` (exported as `h as gt` in `index-*.js`, imported as `h as fe` in `Player-*.js`)
- **Anchor Signature**: Contains `screenWidth`, `screenHeight`, `RoundedPoster()`, `fullPosterWidth=300`, `tallestPlayerHeight=700`, `widestFullPosterWidth=350`.
- **Key Members (Unminified Names)**:
  - `screenWidth`, `screenHeight`, `screenInsets`
  - `get landscape()`: Returns `true` on web when `screenWidth > 500` and `screenWidth / screenHeight > 1`.
  - `get card()`: Returns `true` on desktop (`Lt`) when aspect ratio `screenWidth / screenHeight` is between `1.25` and `1.3`.
    - **Note**: If a user resizes their window to an aspect ratio between `1.25` and `1.3`, `fe.card` overrides `fe.landscape` unless bypassed in Player selection!
  - `static RoundedPoster()`:
    - **Anchor**: `static RoundedPoster(){return!0}`
    - **BetterPA Patch**: `static RoundedPoster(){return!(T.app.useTabletSideBySideLayout&&rA.landscape)}` (removes rounded corners on album artwork in split-screen mode so it sits flush against window edges).

### 3.3 Poster Sizing Class (`Gs`)
- **v4.50.19 Symbol**: `class Gs` (exported as `aJ as Gs` in `index-*.js`, imported as `aJ as jt` in `Player-*.js`)
- **Anchor Signature**: `static PosterSize(e=!1){` and `static PosterRequestSize(){`
- **Key Members**:
  - `static PosterSize(e = false)`: Computes `{ width, height }` of the Player's album artwork (`Xr`).
    - **Original Logic**: Caps artwork width in side-by-side mode to `min((screenWidth - 90) / 2, screenHeight - 250)` and clamps non-side-by-side artwork to `widestFullPosterWidth` (`350px`).
    - **BetterPA Patch**: When `T.app.useTabletSideBySideLayout && gt.landscape` is active, returns `s = Math.max(240, Math.min(gt.screenHeight - 104, Math.floor(gt.screenWidth * 0.55)))` as `{ width: s, height: s }` so the artwork fills 100% of the upper-left pane height above the `104px` bottom transport bar.
  - `static PosterRequestSize()`: Rounds `PosterSize()` up to `POSTER_REQUEST_STEP` so Plexamp requests high-resolution artwork from the Plex server matching the enlarged display size.

### 3.4 Waveform Seekbar Component (`Rct`)
- **v4.50.19 Symbol**: `Rct` (exported as `c1 as Rct` in `index-*.js`, imported as `c1 as Dl` in `Player-*.js`), styled via `Ict = J.create({ container: ... })`
- **Anchor Signature**: `seekBarContainer:{flex:1,height:ge.SEEK_BAR_HEIGHT` inside `J.create({container:{width:"100%",maxWidth:`
- **Subcomponents**:
  - `Ict.container`: Outer wrapper (`maxWidth: ks ? 700 : 500`, patched by BetterPA to `"100%"` in side-by-side mode so the waveform spans the full bottom bar).
  - `Sct`: Elapsed time text on the left (`alignItems: "flex-end"`).
  - `_ct`: SVG waveform renderer (`hoverProgress`, `loudness` bar array, `progress`, `buffered`).
  - `Cct`: Total / remaining time text on the right (`alignItems: "flex-start"`).

---

## 4. Player & Play Queue Components (`/assets/Player-*.js`)

### 4.1 Top-Level Player Layout Selector (`_0` / `X0`)
- **v4.50.19 Symbol**: `_0` (`class X0`, default export of `Player-*.js`)
- **Anchor Signature**: `const o=<screen>.card?<CardPlayer>:<screen>.landscape?(<store>.app.useTabletSideBySideLayout?<SideBySidePlayer>:<LandscapePlayer>):<PortraitPlayer>`
  - **Regex to match across versions**: `/const (\w+)=(\w+)\.card\?(\w+):\2\.landscape\?\((\w+)\.app\.useTabletSideBySideLayout\?(\w+):(\w+)\):(\w+)/`
  - Captures:
    - `$2` (`fe`): Screen singleton (`gt`)
    - `$3` (`l0`): Card player layout
    - `$4` (`T`): Root MobX store
    - `$5` (`p0`): **Side-by-Side Tablet/Desktop Landscape Player**
    - `$6` (`d0`): Standard Landscape Player
    - `$7` (`m0`): Portrait Player

### 4.2 Player Subcomponents (Inside `/assets/Player-*.js`)
All of these are referenced directly inside `p0` (`SideBySidePlayer`), `d0` (`LandscapePlayer`), and `m0` (`PortraitPlayer`), making them trivial to extract automatically from `p0.prototype.render()`:

| Component Role | v4.50.19 Symbol | Key Props | Version-Independent Anchor Signature |
| :--- | :--- | :--- | :--- |
| **Side-by-Side Player** | `p0` (`class Tl`) | `onLayout` | Matched via layout selector regex (`$5`) or `button-queue-on` + `playerShowPlayQueue` |
| **Artwork / Visualizer / Lyrics 3D Flip** | `Xr` (`class Rl`) | `size={jt.PosterSize()}` | `<Component>,{size:<PosterClass>.PosterSize()}` (`r.jsx(Xr,{size:jt.PosterSize()})`) |
| **Seekbar Wrapper (Music Waveform / Podcast Scrubber)** | `Yr` | *(none)* | Checks `e.source==="music"` -> renders `<Waveform/>` (`Dl` / `Rct`), else `<PodcastSeekbar/>` (`Wx`) |
| **Track Metadata Block (Artist / Title / Album)** | `qr` (`class pl`) | `align`, `showAlbum`, `fontSize`, `lineHeight`, `onPress` | Contains `buildForTouchScreen(e)` with `style:{opacity:this.visibility,width:"90%"}` and `Cn` (`scrolling:!0`). **Caveat**: Must patch `width:"90%"` to `"100%"` in side-by-side mode AND wrap `qr` in `style:{flex:1,minWidth:180}` so long track/album titles expand across the full left bar. |
| **Codec Badge & Star Rating Row** | `Xi` (`class hl`) | `onDragging` | Anchor: `const fl=Ln.create({codecText:{flexDirection:"row",flex:1}})`. Splits codec string (`"FLAC 44.1 kHz"` or `"FLAC 48 / 24"`) on first space into `t` (left of stars `gx`/`vx`) and `n` (right of stars). **Caveat**: In RNW, `flex:1` on `fl.codecText` sets `flex-basis:0%`, which truncates `n` (`"44.1 kHz"` -> `"44.1 ..."`) when `Xi` is placed inside a flex row! Patch `fl.codecText` / `Xi` in side-by-side mode to use `{flexDirection:"row",flexShrink:0}` and `marginHorizontal:0` so `t` and `n` never truncate. |
| **Transport Controls Row (Repeat / Prev / Play / Next / Shuffle)** | `ji` (`class cx`, styles `Bi`) | `plain`, `extraControls`, `noLeftPadding` | Uses `Bi.playContainer` (`width:60,height:60,borderRadius:30`), renders `Mc`/`Ec` (repeat) & `yc`/`Tc` (shuffle) |
| **Car Mode Large Controls** | `Ic` (`c0`) | *(none)* | Uses `80x80` buttons (`button-Pause`, `button-Play`, `button-SkipForward`) |
| **Volume Slider & Mute Control** | `da` | `style` | Checked alongside `T.settings.playerShowVolume` |
| **Play Queue Panel Wrapper** | `$r` -> `a0` (`s0`) | *(none)* | Renders `Cc` tab container with `tabs:["BACK TO","UP NEXT","RELATED"]` |
| **Lyrics Toggle Button** | `Fl` | *(none)* | Toggles `lyricPlayerStore.visible` |
| **Cast / Remote Player Button** | `Ol` | *(none)* | Opens `type:"remote-player"` menu |
| **Guest DJ Button** | `bc` (`ux`) | `size` | Opens `type:"deeJay"` menu (`icon:"button-dj"`) |
| **Context Menu (`...`) Button** | `Ws` | `size={16}` | Calls `T.menu.popup(e,{type:"player-track",...})` |
| **Queue Toggle Button** | `f0` (`h0`) | *(none)* | Toggles `T.settings.playerShowPlayQueue`, icon `"button-queue-on"` / `"button-queue"` |
| **Collapse / Dismiss Player Button** | `Ac` | `extraMargin` | Calls `T.player.hideFullscreenPlayer()`, icon `"chevron-down"` |

### 4.3 Play Queue Subcomponents (Inside `/assets/Player-*.js`)
| Component Role | v4.50.19 Symbol | Version-Independent Anchor Signature |
| :--- | :--- | :--- |
| **Play Queue Tab Container** | `Cc` (`class $x`) | Passed `tabs:["BACK TO","UP NEXT","RELATED"]`, `index:t`, `onChange:this.onChangeTab` |
| **Play Queue Tab Header Bar** | `Yx` (`class qx`) | Renders tab labels from `["BACK TO","UP NEXT","RELATED"]` |
| **`BACK TO` Tab View** | `wc` | First child of `Cc` (`index 0`); uses `T.player.backTo` |
| **`UP NEXT` Virtualized Track List** | `Dc` (`class xl`) | Second child of `Cc` (`index 1`); uses `RecyclerListViewWrapper` (`Md`), `rowRenderer:this.renderItem`, `scrollViewProps` with `scrollComponent:Lc` |
| **`UP NEXT` Scroll Container** | `Lc` (`ScrollViewWithFooter`) | Custom scroll component inside `Dc`; has `paddingTop:20` and `height:e-80` (patched by BetterPA in side-by-side mode to `e-154` so tracks don't hide behind the `104px` bottom bar) |
| **`UP NEXT` Track Row** | `Sa` | Rendered by `Dc.prototype.renderItem`; receives `track`, `index`, `isCurrent`, `onPress`, `onRemove` |
| **`UP NEXT` AutoPlay Footer** | `Zx` (`class Rc`) | Passed as `footer` prop to `Lc` inside `Dc`; uses `T.player.autoPlayStore` |
| **`RELATED` Tab View** | `r0` (`class Ml`) & `Vs` (`class yl`) | Third child of `Cc` (`index 2`); renders `"Sonically Similar Tracks"`, `"Related Tracks"`, `"Outside Your Comfort Zone"` |

### 4.4 Primitive Layout Components (Imported into `Player-*.js` from `index-*.js`)
When constructing custom JSX trees inside `Player-*.js` (such as `p0.prototype.render()`), use these primitives:
- `r.jsx` / `r.jsxs`: JSX runtime factory functions (imported at top of `Player-*.js` as `j as r`).
- `Ze`: Base React Native `View` (`div.css-g5y9jx`).
- `Ie`: Horizontal Flex Row (`flexDirection: "row"`, `alignItems: "center"`).
- `Ye`: Vertical Flex Column (`flexDirection: "column"`).
- `Jr`: Flexible Spacer (`flexGrow: 1`).
- `ki`: Fixed Pixel Spacer (`{ width?: number, height?: number }`).

---

## 5. React Native Web DOM & CSS Selectors (Live WebView2 DOM)

Because React Native Web compiles styles to atomic classes (`css-g5y9jx` for `View`, `css-146c3p1` for `Text`) plus inline `style="..."` attributes, target elements using structural `:has()` and inline style substring selectors:

| UI Element | Stable CSS Selector / DOM Signature | Notes & Version Stability |
| :--- | :--- | :--- |
| **Root Window & App** | `html.plexamp-square-corners`, `#react-app` | Hardcoded in `/index.html` |
| **Base RNW `View`** | `div.css-g5y9jx` | Standard RNW View class |
| **Base RNW `Text`** | `div.css-146c3p1` | Standard RNW Text class |
| **Vertical Track/Album List Container** | `div.css-g5y9jx:has(> div.css-g5y9jx > div[tabindex="0"] > div[style*="padding: 7px "][style*="flex-direction: row"])` | **Important**: Use `[style*="padding: 7px "]` (with trailing space, NOT `padding: 7px 15px`), because horizontal padding switches between `15px` and `30px` (`ge.MARGIN`) when `IS_BIG_IPAD_SIZE()` is active! |
| **Vertical List Row Wrapper** | `div.css-g5y9jx:has(> div[tabindex="0"] > div[style*="padding: 7px "][style*="flex-direction: row"])` | Direct child of the Vertical List Container |
| **List Row `46x46` Thumbnail** | `div[style*="padding: 7px "][style*="flex-direction: row"] > div[style*="width: 46px"][style*="aspect-ratio: 1 / 1"]` | Controlled by `ge.LIST_IMAGE_SIZE` (`46px`) |
| **Bottom Navigation Tab Bar** | `div[role="tablist"]` | Contains `<a role="tab" href="/Navigator/Discover\|Library\|Search\|Offline\|Settings">` |
| **Bottom Docked MiniPlayer + Tab Bar Overlay** | `div[style*="bottom: 0px"][style*="height: 110px"][style*="backdrop-filter: blur(13px)"]` | `60px` MiniPlayer (`ge.MINI_PLAYER_HEIGHT`) + `3px` progress bar + `49px` `div[role="tablist"]` |
| **Horizontal Hub Carousel Scroller** | `div[style*="overflow-x: auto"][style*="overflow-y: hidden"]` | Used by `HubList` on Home/Discover screens |
| **Virtualized Grid / Queue Container** | `div[style*="position: relative"][style*="overflow: hidden"] > div[style*="position: absolute"][style*="top: 0px"][style*="left: 0px"]` | Generated by `RecyclerListViewWrapper` |
