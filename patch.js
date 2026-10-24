#!/usr/bin/env node
/**
 * BetterPA — Stylesheet, Script & Split-Screen Player Injector for Plexamp Desktop (Windows PE64 & Linux ELF64)
 *
 * Usage:
 *   node patch.js [install] [--exe <path>] [--no-restart]
 *   node patch.js restore   [--exe <path>] [--no-restart]
 *   node patch.js status    [--exe <path>]
 *   node patch.js extract-html [--exe <path>]
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { execSync, spawn } = require("child_process");

const IS_WIN = process.platform === "win32";

function resolvePlexampExe() {
  const args = process.argv.slice(2);
  const exeFlagIdx = args.indexOf("--exe");
  if (exeFlagIdx !== -1 && args[exeFlagIdx + 1]) {
    return path.resolve(args[exeFlagIdx + 1]);
  }
  if (process.env.PLEXAMP_EXE) {
    return path.resolve(process.env.PLEXAMP_EXE);
  }
  if (IS_WIN) {
    return path.join(process.env.LOCALAPPDATA || "", "Plexamp", "Plexamp.exe");
  }
  const home = os.homedir();
  const candidates = [
    path.resolve("squashfs-root/usr/bin/plexamp"),
    path.resolve("squashfs-root/usr/bin/Plexamp"),
    "/opt/Plexamp/plexamp",
    "/opt/plexamp/plexamp",
    "/usr/bin/plexamp",
    "/usr/lib/plexamp/plexamp",
    path.join(home, ".local/share/flatpak/app/tv.plex.Plexamp/current/active/files/bin/plexamp"),
    "/var/lib/flatpak/app/tv.plex.Plexamp/current/active/files/bin/plexamp",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return "/opt/Plexamp/plexamp";
}

function getAppDataDirs() {
  if (IS_WIN) {
    return [path.join(process.env.APPDATA || "", "tv.plex.plexamp")];
  }
  const home = os.homedir();
  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
  const xdgData = process.env.XDG_DATA_HOME || path.join(home, ".local", "share");
  return [
    path.join(xdgConfig, "tv.plex.plexamp"),
    path.join(xdgData, "tv.plex.plexamp"),
    path.join(home, ".var/app/tv.plex.Plexamp/config/tv.plex.plexamp"),
    path.join(home, ".var/app/tv.plex.Plexamp/data/tv.plex.plexamp"),
  ];
}

const PLEXAMP_EXE = resolvePlexampExe();
const PLEXAMP_DIR = path.dirname(PLEXAMP_EXE);
const PLEXAMP_BAK = PLEXAMP_EXE + ".bak";
const REPO_DIR = __dirname.replace(/\\/g, "/");
const BETTERPA_MARKER = "__BETTERPA_LOADED__";

/**
 * Parse PE64 (Windows) or ELF64 (Linux) headers and locate an embedded Tauri asset by its key.
 */
function findEmbeddedAsset(exeBuf, assetKey) {
  let fileOffsetToVa;
  let vaToFileOffset;

  const isElf =
    exeBuf.length > 64 &&
    exeBuf[0] === 0x7f &&
    exeBuf[1] === 0x45 &&
    exeBuf[2] === 0x4c &&
    exeBuf[3] === 0x46;

  if (isElf) {
    // ELF64 little-endian PT_LOAD program headers
    const phoff = Number(exeBuf.readBigUInt64LE(0x20));
    const phentsize = exeBuf.readUInt16LE(0x36);
    const phnum = exeBuf.readUInt16LE(0x38);
    const segments = [];
    for (let i = 0; i < phnum; i++) {
      const pOff = phoff + i * phentsize;
      const pType = exeBuf.readUInt32LE(pOff);
      if (pType === 1) {
        // PT_LOAD
        const fileOffset = Number(exeBuf.readBigUInt64LE(pOff + 8));
        const vaddr = exeBuf.readBigUInt64LE(pOff + 16);
        const filesz = Number(exeBuf.readBigUInt64LE(pOff + 32));
        const memsz = Number(exeBuf.readBigUInt64LE(pOff + 40));
        segments.push({ fileOffset, vaddr, filesz, memsz });
      }
    }

    fileOffsetToVa = (fileOff) => {
      for (const s of segments) {
        if (fileOff >= s.fileOffset && fileOff < s.fileOffset + s.filesz) {
          return s.vaddr + BigInt(fileOff - s.fileOffset);
        }
      }
      return null;
    };

    vaToFileOffset = (va) => {
      for (const s of segments) {
        const span = BigInt(Math.max(s.filesz, s.memsz));
        if (va >= s.vaddr && va < s.vaddr + span) {
          return s.fileOffset + Number(va - s.vaddr);
        }
      }
      return null;
    };
  } else {
    // PE64 section headers
    const peOffset = exeBuf.readUInt32LE(0x3c);
    const numSections = exeBuf.readUInt16LE(peOffset + 6);
    const sizeOfOptionalHeader = exeBuf.readUInt16LE(peOffset + 20);
    const optHeaderOffset = peOffset + 24;
    const imageBase = exeBuf.readBigUInt64LE(optHeaderOffset + 24);
    const sectionTableOffset = optHeaderOffset + sizeOfOptionalHeader;

    const sections = [];
    for (let i = 0; i < numSections; i++) {
      const sOff = sectionTableOffset + i * 40;
      const name = exeBuf.toString("utf8", sOff, sOff + 8).replace(/\0+$/, "");
      const virtualSize = exeBuf.readUInt32LE(sOff + 8);
      const virtualAddress = exeBuf.readUInt32LE(sOff + 12);
      const rawSize = exeBuf.readUInt32LE(sOff + 16);
      const rawPtr = exeBuf.readUInt32LE(sOff + 20);
      sections.push({ name, virtualSize, virtualAddress, rawSize, rawPtr });
    }

    fileOffsetToVa = (fileOff) => {
      for (const s of sections) {
        if (fileOff >= s.rawPtr && fileOff < s.rawPtr + s.rawSize) {
          return imageBase + BigInt(s.virtualAddress + (fileOff - s.rawPtr));
        }
      }
      return null;
    };

    vaToFileOffset = (va) => {
      const rva = Number(va - imageBase);
      for (const s of sections) {
        if (rva >= s.virtualAddress && rva < s.virtualAddress + Math.max(s.virtualSize, s.rawSize)) {
          return s.rawPtr + (rva - s.virtualAddress);
        }
      }
      return null;
    };
  }

  const keyBuf = Buffer.from(assetKey, "utf8");
  let searchIdx = 0;

  while ((searchIdx = exeBuf.indexOf(keyBuf, searchIdx)) !== -1) {
    const keyVa = fileOffsetToVa(searchIdx);
    if (keyVa !== null) {
      const entryPattern = Buffer.alloc(16);
      entryPattern.writeBigUInt64LE(keyVa, 0);
      entryPattern.writeBigUInt64LE(BigInt(keyBuf.length), 8);

      const tableIdx = exeBuf.indexOf(entryPattern);
      if (tableIdx !== -1) {
        const valVa = exeBuf.readBigUInt64LE(tableIdx + 16);
        const valLen = Number(exeBuf.readBigUInt64LE(tableIdx + 24));
        const valFileOffset = vaToFileOffset(valVa);
        if (valFileOffset !== null && valLen > 0) {
          const nextKeyVa = exeBuf.readBigUInt64LE(tableIdx + 32);
          const nextKeyFileOffset = vaToFileOffset(nextKeyVa);
          const maxCapacity =
            nextKeyFileOffset && nextKeyFileOffset > valFileOffset && nextKeyFileOffset - valFileOffset < 5000000
              ? nextKeyFileOffset - valFileOffset
              : valLen;
          return {
            assetKey,
            keyFileOffset: searchIdx,
            tableOffset: tableIdx,
            valFileOffset,
            valLen,
            maxCapacity,
          };
        }
      }
    }
    searchIdx += keyBuf.length;
  }

  throw new Error(`Could not locate ${assetKey} in Tauri embedded asset table.`);
}

/**
 * Find an embedded JS bundle by prefix (e.g. "/assets/index-" or "/assets/Player-").
 */
function findBundleKeyByPrefix(exeBuf, prefixStr, minBytes = 1000) {
  const prefix = Buffer.from(prefixStr, "utf8");
  let idx = 0;
  while ((idx = exeBuf.indexOf(prefix, idx)) !== -1) {
    const windowStr = exeBuf.toString("utf8", idx, Math.min(exeBuf.length, idx + 80));
    const m = windowStr.match(/^(\/assets\/[A-Za-z0-9._-]+\.js)(?!\.map)/);
    if (m) {
      const candidate = m[1];
      try {
        const info = findEmbeddedAsset(exeBuf, candidate);
        if (info.valLen >= minBytes) return candidate;
      } catch {}
    }
    idx += prefix.length;
  }
  throw new Error(`Could not locate ${prefixStr}*.js bundle in Plexamp.exe`);
}

/**
 * Patch the main JS bundle (/assets/index-*.js) with:
 *  1. Desktop layout unlocks (IS_BIG_IPAD_SIZE enabled on desktop >700px)
 *  2. Edge-to-edge maximum left-side artwork in side-by-side mode (PosterSize = min(width*0.52, height-104), RoundedPoster = false)
 *  3. Full-width bottom seekbar/waveform in side-by-side mode (supporting classic, smooth, bars & line seekbars)
 *  4. BetterPA live CSS/JS loader + shortcuts
 */
function buildPatchedMainBundle(originalJs) {
  let js = originalJs;

  // Note: Do NOT force ge.IS_BIG_IPAD_SIZE() to true on desktop — it doubles ge.MARGIN (15 -> 30)
  // and adds +20/+25px to GRID_ITEM_MIN_WIDTH, which reduces column count and leaves a large gap
  // on the right of LibraryGridScreen ("Recently Added in Music").

  // 1. Edge-to-edge square corners on the side-by-side full-height left artwork
  const roundedRe = /static RoundedPoster\(\)\{return!0\}/;
  if (roundedRe.test(js)) {
    js = js.replace(
      roundedRe,
      "static RoundedPoster(){return!((typeof w!=='undefined'?w:typeof T!=='undefined'?T:this).app?.useTabletSideBySideLayout&&this.landscape)}"
    );
    console.log("Unlocked edge-to-edge square poster corners in side-by-side landscape mode");
  }

  // 2. Maximum left-side artwork size in Gs.PosterSize() (fills full height above 104px bottom bar)
  const sideBySidePosterRe = /if\(([\w$]+)\.app\.useTabletSideBySideLayout\)return Math\.round\(([\w$]+)\.screenHeight\/2\.5\);/;
  if (sideBySidePosterRe.test(js)) {
    js = js.replace(sideBySidePosterRe, (match, store, screen) => {
      return `if(${store}.app.useTabletSideBySideLayout)return Math.round(Math.min(${screen}.screenWidth*.52,${screen}.screenHeight-104));`;
    });
    console.log("Unlocked maximum full-height left-side artwork in Gs.PosterSize()");
  }

  const webPortraitRe = /if\(([\w$]+)\)return i<([\w$]+)\.fullPosterWidth\|\|([\w$]+)>\2\.tallestPlayerHeight&&i<\2\.widestFullPosterWidth\?i:Math\.min\(i-70,300\);/;
  if (webPortraitRe.test(js)) {
    js = js.replace(webPortraitRe, (match, isWeb, screen, heightVar) => {
      return `if(${isWeb})return i<${screen}.fullPosterWidth||${heightVar}>${screen}.tallestPlayerHeight&&i<${screen}.widestFullPosterWidth?i:Math.min(i-70,${heightVar}-380,540);`;
    });
    console.log("Unlocked larger portrait desktop player artwork in Gs.PosterSize()");
  }

  // 3. Full-width waveform seekbar in side-by-side landscape mode
  const seekbarMaxRe = /(style:\[[\w$]+\.container,\{opacity:this\.visibility,maxWidth:)(this\.props\.maxWidth\?\?\()?([\w$]+)\?700:500(\)?\}\])/;
  if (seekbarMaxRe.test(js)) {
    js = js.replace(seekbarMaxRe, (match, prefix, propCheck, isPad, suffix) => {
      const storeRef = `(typeof w!=='undefined'?w:T)`;
      const screenRef = `(typeof $e!=='undefined'?$e:gt)`;
      const fallback = propCheck
        ? `${propCheck}(${storeRef}.app.useTabletSideBySideLayout&&${screenRef}.landscape?"100%":${isPad}?700:500))`
        : `(${storeRef}.app.useTabletSideBySideLayout&&${screenRef}.landscape?"100%":${isPad}?700:500)`;
      return `${prefix}${fallback}${suffix.endsWith("}]") ? "}]" : "}"}`;
    });
    console.log("Unlocked 100% full-width waveform seekbar in Rct/b9e.render()");
  }

  // 4. Lower height threshold for side-by-side layout from 680px to 350px on desktop
  const sideBySideGetterRe = /get useTabletSideBySideLayout\(\)\{return this\.rootStore\.settings\.playerSideBySideLayout\?([\w$]+)&&([\w$]+)\.screenWidth>500&&([\w$]+)\.screenHeight>680\?!0:([\w$]+)\(\):!1\}/;
  if (sideBySideGetterRe.test(js)) {
    js = js.replace(sideBySideGetterRe, (match, isWeb, screenW, screenH, isTablet) => {
      return `get useTabletSideBySideLayout(){return this.rootStore.settings.playerSideBySideLayout!==!1&&(${isWeb}&&${screenW}.screenWidth>500&&${screenH}.screenHeight>350?!0:${isTablet}())}`;
    });
    console.log("Lowered side-by-side landscape height threshold from 680px to 350px");
  }

  // 5. Append BetterPA runtime loader
  const loaderCode = `
;(function(){
  if (window.${BETTERPA_MARKER}) return;
  window.${BETTERPA_MARKER} = true;

  var ti = window.__TAURI_INTERNALS__;
  function log(msg) {
    try {
      if (ti) ti.invoke("player_send_log", { level: 3, message: "[BetterPA] " + msg });
    } catch (e) {}
  }

  try {
    var _store = typeof w !== "undefined" ? w : typeof hr !== "undefined" ? hr : typeof T !== "undefined" ? T : null;
    var _layout = typeof ae !== "undefined" ? ae : typeof i8t !== "undefined" ? i8t : typeof ge !== "undefined" ? ge : null;
    var _screen = typeof na !== "undefined" ? na : typeof gt !== "undefined" ? gt : null;
    var _poster = typeof wo !== "undefined" ? wo : typeof Gs !== "undefined" ? Gs : null;
    var _fs = typeof $P !== "undefined" ? $P : typeof F !== "undefined" ? F : null;
    window.__PLEXAMP__ = { store: _store, layout: _layout, screen: _screen, poster: _poster, fs: _fs };
  } catch (e) {}

  log("Initializing BetterPA runtime...");

  var repoCss = "${REPO_DIR}/custom.css";
  var repoJs = "${REPO_DIR}/custom.js";

  var adoptedSheet = null;
  try {
    adoptedSheet = new CSSStyleSheet();
    document.adoptedStyleSheets = [].concat(Array.from(document.adoptedStyleSheets || []), [adoptedSheet]);
  } catch (e) {
    log("adoptedStyleSheets init error: " + e);
  }

  function ensureStyleTag() {
    var style = document.getElementById("betterpa-custom-css");
    if (!style && document.head) {
      style = document.createElement("style");
      style.id = "betterpa-custom-css";
      var baseStyle = document.querySelector("style[nonce]");
      if (baseStyle && (baseStyle.nonce || baseStyle.getAttribute("nonce"))) {
        style.nonce = baseStyle.nonce || baseStyle.getAttribute("nonce");
      }
      document.head.appendChild(style);
    }
    if (style && document.head && document.head.lastElementChild !== style) {
      document.head.appendChild(style);
    }
    return style;
  }

  if (document.head) {
    ensureStyleTag();
    new MutationObserver(function(){ ensureStyleTag(); }).observe(document.head, { childList: true });
  }

  var lastCss = null;

  async function readText(p) {
    if (!ti) return null;
    try {
      var buf = await ti.invoke("plugin:fs|read_text_file", { path: p });
      if (buf) {
        return new TextDecoder("utf-8").decode(buf instanceof ArrayBuffer ? buf : Uint8Array.from(buf));
      }
    } catch (e) {}
    try {
      var url = ti.convertFileSrc(p) + "?t=" + Date.now();
      var res = await fetch(url, { cache: "no-store" });
      if (res.ok) return await res.text();
    } catch (e) {}
    return null;
  }

  var pathsPromise = (async function(){
    var list = { css: [], js: [] };
    if (ti) {
      try {
        var appData = (await ti.invoke("plugin:path|resolve_directory", { directory: 14 })).replace(/\\\\/g, "/");
        list.css.push(appData + "/custom.css");
        list.js.push(appData + "/custom.js");
      } catch (e) {}
    }
    list.css.push(repoCss);
    list.js.push(repoJs);
    return list;
  })();

  async function reloadCss(force) {
    var paths = await pathsPromise;
    for (var i = 0; i < paths.css.length; i++) {
      var txt = await readText(paths.css[i]);
      if (txt !== null) {
        if (force || txt !== lastCss) {
          lastCss = txt;
          if (adoptedSheet) {
            try { adoptedSheet.replaceSync(txt); } catch (e) { log("replaceSync error: " + e); }
          }
          var s = ensureStyleTag();
          if (s) s.textContent = txt;
          log("Applied custom.css from " + paths.css[i] + " (" + txt.length + " bytes)");
        }
        return;
      }
    }
  }

  async function runCustomJs() {
    var paths = await pathsPromise;
    for (var i = 0; i < paths.js.length; i++) {
      var code = await readText(paths.js[i]);
      if (code !== null) {
        try {
          (0, eval)(code);
          log("Executed custom.js from " + paths.js[i]);
        } catch (e) {
          log("custom.js error: " + e);
        }
        return;
      }
    }
  }

  reloadCss(true);
  setInterval(function(){ reloadCss(false); }, 800);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", runCustomJs);
  } else {
    runCustomJs();
  }

  var zoom = parseFloat(localStorage.getItem("__betterpa_zoom") || "1") || 1;
  if (zoom !== 1 && ti) {
    setTimeout(function(){
      ti.invoke("plugin:webview|set_webview_zoom", { label: "main", value: zoom }).catch(function(){});
    }, 600);
  }

  window.addEventListener("keydown", function(e) {
    if (!ti) return;
    if (e.key === "F12") {
      // Do NOT call preventDefault/stopPropagation on F12 so native WebView2 accelerator also works
      ti.invoke("plugin:webview|internal_toggle_devtools").catch(function(){});
      ti.invoke("open_devtools").catch(function(){});
    } else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "i") {
      // Let event bubble to Tauri's document listener (internal_toggle_devtools) and also call open_devtools
      ti.invoke("open_devtools").catch(function(){});
    } else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "r") {
      e.preventDefault();
      e.stopPropagation();
      reloadCss(true);
    } else if (e.ctrlKey && (e.key === "=" || e.key === "+")) {
      e.preventDefault();
      zoom = Math.min(2.5, Math.round((zoom + 0.05) * 100) / 100);
      localStorage.setItem("__betterpa_zoom", String(zoom));
      ti.invoke("plugin:webview|set_webview_zoom", { label: "main", value: zoom });
    } else if (e.ctrlKey && e.key === "-") {
      e.preventDefault();
      zoom = Math.max(0.5, Math.round((zoom - 0.05) * 100) / 100);
      localStorage.setItem("__betterpa_zoom", String(zoom));
      ti.invoke("plugin:webview|set_webview_zoom", { label: "main", value: zoom });
    } else if (e.ctrlKey && e.key === "0") {
      e.preventDefault();
      zoom = 1.0;
      localStorage.setItem("__betterpa_zoom", "1");
      ti.invoke("plugin:webview|set_webview_zoom", { label: "main", value: zoom });
    }
  }, true);
})();
`;

  return js + "\n" + loaderCode;
}

/**
 * Patch the Player JS bundle (/assets/Player-*.js) to create the split-screen layout:
 *  - Top-Left: Edge-to-edge full-height square Album Artwork (Xr/or)
 *  - Top-Right: Scrollable Play Queue / Up Next / Related tracks ($r/Ui, up to 50 items)
 *  - Bottom Bar (104px, 100% width): Wide Track/Artist/Album info + full uncut Codec/Stars on left,
 *    Transport controls in center, Volume + Utility buttons on right, and 100% full-width Waveform Seekbar (supporting smooth, bars & line).
 */
function buildPatchedPlayerBundle(originalPlayerJs) {
  let js = originalPlayerJs;

  // 1. Enable scrolling inside PlayQueue ScrollViewWithFooter (Lc/Hc)
  const scrollRe = /scrollEnabled:!1,children:\[([\w$]+),([\w$]+)\.footer\]/;
  if (scrollRe.test(js)) {
    js = js.replace(scrollRe, "scrollEnabled:!0,children:[$1,$2.footer]");
    console.log("Enabled vertical mouse-wheel scrolling in PlayQueue (Lc/Hc)");
  }

  // 2. Increase visible tracks in side-by-side PlayQueue from ~16 to 50
  const visibleTracksRe = /([\w$]+=)(Math\.max\([\w$]+\.length,Math\.floor\(\([\w$]+\.screenHeight-[\w$]+\(\)\+30\)\/[\w$]+\)-\([\w$]+\.landscape\?1:0\)\);)/;
  if (visibleTracksRe.test(js)) {
    js = js.replace(visibleTracksRe, (match, assign, origCalc) => {
      return `${assign}(typeof A!=="undefined"?A:T).app.useTabletSideBySideLayout&&(typeof he!=="undefined"?he:fe).landscape?50:${origCalc}`;
    });
    console.log("Increased side-by-side PlayQueue visible track count to 50");
  }

  // 3. Fix Xi/Pi (Codec + Stars + Sample Rate) so it never truncates ("44.1 ...") in side-by-side mode
  const codecTextRe = /codecText:\{flexDirection:"row",flex:1\}/;
  if (codecTextRe.test(js)) {
    js = js.replace(
      codecTextRe,
      'codecText:{flexDirection:"row",flex:(typeof A!=="undefined"?A:T).app.useTabletSideBySideLayout&&(typeof he!=="undefined"?he:fe).landscape?void 0:1,flexShrink:0}'
    );
    console.log("Unlocked full uncut codec & sample-rate in stylesheet (v5)");
  }
  const piRenderRe = /(children:!![\w$]+&&[\w$]+\.jsxs\([\w$]+,\{halign:"center",valign:"center",style:)\{flex:1,marginHorizontal:([\w$]+)\.MARGIN\}(,children:\[this\.renderCodec\([\w$]+\))/;
  if (piRenderRe.test(js)) {
    js = js.replace(piRenderRe, (match, prefix, marginVar, suffix) => {
      return `${prefix}(typeof A!=="undefined"?A:T).app.useTabletSideBySideLayout&&(typeof he!=="undefined"?he:fe).landscape?{flexShrink:0}:{flex:1,marginHorizontal:${marginVar}.MARGIN}${suffix}`;
    });
    console.log("Unlocked full uncut codec & sample-rate width in Xi/Pi.render() (v5)");
  }
  const origXiRender =
    'v.jsx(Ie,{halign:"center",style:{width:"100%"},children:!!t&&v.jsxs(Ie,{halign:"center",valign:"center",style:{flex:1,marginHorizontal:ae.MARGIN},children:[v.jsx(Yn,{weight:"light",text:t,style:fl.codecText,align:"right"}),T.settings.preferFullStars!==!1?v.jsx(gx,{onDragging:this.props.onDragging}):v.jsx(vx,{}),v.jsx(Yn,{weight:"light",text:n,style:fl.codecText})]})})';
  const newXiRender =
    'v.jsx(Ie,{halign:"center",style:T.app.useTabletSideBySideLayout&&fe.landscape?{flexShrink:0}:{width:"100%"},children:!!t&&v.jsxs(Ie,{halign:"center",valign:"center",style:T.app.useTabletSideBySideLayout&&fe.landscape?{flexShrink:0}:{flex:1,marginHorizontal:ae.MARGIN},children:[v.jsx(Yn,{weight:"light",text:t,style:T.app.useTabletSideBySideLayout&&fe.landscape?{flexShrink:0}:fl.codecText,align:"right"}),T.settings.preferFullStars!==!1?v.jsx(gx,{onDragging:this.props.onDragging}):v.jsx(vx,{}),v.jsx(Yn,{weight:"light",text:n,style:T.app.useTabletSideBySideLayout&&fe.landscape?{flexShrink:0}:fl.codecText})]})})';
  if (js.includes(origXiRender)) {
    js = js.replace(origXiRender, newXiRender);
    console.log("Unlocked full uncut codec & sample-rate width in Xi.render() (legacy)");
  }

  // 4. Fix qr/Li (Artist / Title / Album) so it uses 100% of its container width instead of clipping at 90%
  const origQrWidth = 'style:{opacity:this.visibility,width:"90%"}';
  if (js.includes(origQrWidth)) {
    js = js.replace(
      origQrWidth,
      'style:{opacity:this.visibility,width:(typeof A!=="undefined"?A:T).app.useTabletSideBySideLayout&&(typeof he!=="undefined"?he:fe).landscape?"100%":"90%"}'
    );
    console.log("Unlocked 100% width for Artist / Title / Album metadata block (qr/Li)");
  }

  // 5. Replace side-by-side component (p0 / R0) with Maximum Left Artwork + Right Queue + Full-Width Bottom Bar
  const p0Regex = /let\s+([A-Za-z0-9_$]+)=([A-Za-z0-9_$]+)\(([A-Za-z0-9_$]+)=class\s+extends\s+([A-Za-z0-9_$]+)\.Component\{constructor\([^)]*\)\{super\([^)]*\)[^}]*playerShowPlayQueue/;
  const p0Match = js.match(p0Regex);
  if (!p0Match) {
    throw new Error("Could not locate side-by-side component in Player bundle.");
  }
  const varName = p0Match[1];
  const obsName = p0Match[2];
  const className = p0Match[3];
  const reactName = p0Match[4];

  let endPattern = "})]})}})||" + className + ";";
  let endIdx = js.indexOf(endPattern, p0Match.index);
  if (endIdx === -1) {
    endPattern = "})})}})||" + className + ";";
    endIdx = js.indexOf(endPattern, p0Match.index);
  }
  if (endIdx === -1) {
    throw new Error("Could not locate end of side-by-side component in Player bundle.");
  }

  const isV5 = js.includes('from"./index-') || js.includes('from "./index-') || varName === "R0";
  let newSideBySide;
  if (isV5) {
    newSideBySide = `let ${varName}=${obsName}(${className}=class extends ${reactName}.Component{constructor(...e){super(...e),A.settings.playerShowPlayQueue===!1&&(A.settings.playerShowPlayQueue=!0),this.showQueue=new rt.Value(A.settings.playerShowPlayQueue?1:0),this.playQueueOpacity=new rt.Value(A.settings.playerShowPlayQueue?1:0),this.playQueueTranslation=new rt.Value(0),this.playerTranslation=new rt.Value(0),this.observerSize=void 0,this.observer=void 0,this.onDismiss=()=>{A.player.hideFullscreenPlayer()}}playerWidth(){return Zt.PosterSize()}componentDidMount(){const e=(he.screenWidth-this.playerWidth())/2;this.showQueue.setValue(A.settings.playerShowPlayQueue?1:0),this.playerTranslation.setValue(A.settings.playerShowPlayQueue?0:e),rt.spring(this.playerTranslation,{toValue:this.showQueue.interpolate({inputRange:[0,1],outputRange:[e,0]}),useNativeDriver:!0}).start(),this.observerSize=an(()=>{const t=Ld(()=>A.settings.playerShowPlayQueue);this.playerTranslation.setValue(t?0:(he.screenWidth-this.playerWidth())/2)}),this.observer=an(()=>{this.showQueue.setValue(A.settings.playerShowPlayQueue?1:0),A.settings.playerShowPlayQueue?(this.playQueueTranslation.setValue(0),rt.timing(this.playQueueOpacity,{toValue:1,delay:150,useNativeDriver:!0,duration:150}).start()):rt.timing(this.playQueueOpacity,{toValue:0,useNativeDriver:!0,duration:150}).start(()=>{this.playQueueTranslation.setValue(he.screenHeight)})})}componentWillUnmount(){this.observerSize?.(),this.observer?.()}render(){const{podcast:e,audiobook:t,driving:n,longFormAudio:r,volumeControllable:s}=this.props,o=We?he.screenHeight-Ln():he.screenHeight-$l()-Ln(),bH=104,topH=Math.max(200,o-bH);return g.jsxs(Qe,{flex:!0,style:{width:"100%",height:o},children:[g.jsxs(Pe,{valign:"center",style:{width:"100%",height:topH,overflow:"hidden"},children:[g.jsx(Ul,{style:{zIndex:100,width:this.playerWidth(),height:topH,transform:[{translateX:this.playerTranslation}]},halign:"center",valign:"center",children:g.jsx(or,{})}),g.jsx(Ul,{flex:!0,style:{marginLeft:0,opacity:this.playQueueOpacity,transform:[{translateY:this.playQueueTranslation}],height:topH,backgroundColor:"rgba(10,10,12,0.55)",borderLeftWidth:1,borderLeftColor:"rgba(255,255,255,0.07)"},children:g.jsx(Ui,{audiobook:t,onDragging:this.props.onDragging})})]}),g.jsxs(Qe,{style:{width:"100%",height:bH,backgroundColor:"rgba(12,12,14,0.94)",borderTopWidth:1,borderTopColor:"rgba(255,255,255,0.09)",paddingHorizontal:24,justifyContent:"center",zIndex:200},children:[this.props.loading&&g.jsx(Ji,{}),g.jsxs(Pe,{valign:"center",style:{width:"100%",height:54,justifyContent:"space-between"},children:[g.jsxs(Pe,{valign:"center",style:{flex:1,minWidth:0,paddingRight:16},children:[g.jsx(Qe,{style:{flex:1,minWidth:0},children:g.jsx(Li,{align:"left",showAlbum:!0,navigation:this.props.navigation,onPress:this.props.onContextMenu,fontSize:14,lineHeight:17})}),A.settings.playerShowCodec&&g.jsx(je,{style:{marginLeft:16,marginRight:4,flexShrink:0},children:g.jsx(Pi,{onDragging:this.props.onDragging})})]}),g.jsx(Pe,{valign:"center",halign:"center",style:{flexShrink:0},children:g.jsx(Zn,{plain:We,extraControls:!0})}),g.jsxs(Pe,{valign:"center",halign:"right",style:{flex:1,minWidth:0,paddingLeft:16,justifyContent:"flex-end"},children:[A.settings.playerShowVolume&&s&&g.jsx(Pe,{style:{width:155,marginRight:12},children:g.jsx($r,{showSpeakerControl:!0})}),g.jsx(Sa,{style:{marginRight:10}}),g.jsx(ya,{style:{marginRight:8}}),!r&&!A.player.isOfflinePlayQueue&&g.jsx(Ra,{outerStyle:{marginLeft:6,marginRight:6}}),g.jsx(Br,{size:16,padding:4,onPress:this.props.onContextMenu,style:{margin:10,backgroundColor:"transparent"}}),g.jsx(Gc,{}),We&&g.jsx(Nc,{onPress:this.onDismiss})]})]}),g.jsx(Pe,{valign:"center",halign:"center",style:{width:"100%",height:38},children:g.jsx(er,{driving:n,audiobook:t,podcast:e})})]})]})}})||${className};`;
  } else {
    newSideBySide = `let ${varName}=${obsName}(${className}=class extends ${reactName}.Component{constructor(...e){super(...e),T.settings.playerShowPlayQueue===!1&&(T.settings.playerShowPlayQueue=!0),this.showQueue=new vt.Value(T.settings.playerShowPlayQueue?1:0),this.playQueueOpacity=new vt.Value(T.settings.playerShowPlayQueue?1:0),this.playQueueTranslation=new vt.Value(0),this.playerTranslation=new vt.Value(0),this.observerSize=void 0,this.observer=void 0,this.onDismiss=()=>{T.player.hideFullscreenPlayer()}}playerWidth(){return jt.PosterSize()}componentDidMount(){const e=(fe.screenWidth-this.playerWidth())/2;this.showQueue.setValue(T.settings.playerShowPlayQueue?1:0),this.playerTranslation.setValue(T.settings.playerShowPlayQueue?0:e),vt.spring(this.playerTranslation,{toValue:this.showQueue.interpolate({inputRange:[0,1],outputRange:[e,0]}),useNativeDriver:!0}).start(),this.observerSize=qt(()=>{const t=dd(()=>T.settings.playerShowPlayQueue);this.playerTranslation.setValue(t?0:(fe.screenWidth-this.playerWidth())/2)}),this.observer=qt(()=>{this.showQueue.setValue(T.settings.playerShowPlayQueue?1:0),T.settings.playerShowPlayQueue?(this.playQueueTranslation.setValue(0),vt.timing(this.playQueueOpacity,{toValue:1,delay:150,useNativeDriver:!0,duration:150}).start()):vt.timing(this.playQueueOpacity,{toValue:0,useNativeDriver:!0,duration:150}).start(()=>{this.playQueueTranslation.setValue(fe.screenHeight)})})}componentWillUnmount(){this.observerSize?.(),this.observer?.()}render(){const{podcast:e,audiobook:t,driving:n,longFormAudio:r,volumeControllable:s}=this.props,o=Ke?fe.screenHeight-$n():fe.screenHeight-Nl()-$n(),bH=104,topH=Math.max(200,o-bH);return v.jsxs(Ye,{flex:!0,style:{width:"100%",height:o},children:[v.jsxs(Ie,{valign:"center",style:{width:"100%",height:topH,overflow:"hidden"},children:[v.jsx(bl,{style:{zIndex:100,width:this.playerWidth(),height:topH,transform:[{translateX:this.playerTranslation}]},halign:"center",valign:"center",children:v.jsx(Xr,{})}),v.jsx(bl,{flex:!0,style:{marginLeft:0,opacity:this.playQueueOpacity,transform:[{translateY:this.playQueueTranslation}],height:topH,backgroundColor:"rgba(10,10,12,0.55)",borderLeftWidth:1,borderLeftColor:"rgba(255,255,255,0.07)"},children:v.jsx($r,{audiobook:t,onDragging:this.props.onDragging})})]}),v.jsxs(Ye,{style:{width:"100%",height:bH,backgroundColor:"rgba(12,12,14,0.94)",borderTopWidth:1,borderTopColor:"rgba(255,255,255,0.09)",paddingHorizontal:24,justifyContent:"center",zIndex:200},children:[this.props.loading&&v.jsx(qi,{}),v.jsxs(Ie,{valign:"center",style:{width:"100%",height:54,justifyContent:"space-between"},children:[v.jsxs(Ie,{valign:"center",style:{flex:1,minWidth:0,paddingRight:16},children:[v.jsx(Ye,{style:{flex:1,minWidth:0},children:v.jsx(qr,{align:"left",showAlbum:!0,navigation:this.props.navigation,onPress:this.props.onContextMenu,fontSize:14,lineHeight:17})}),T.settings.playerShowCodec&&v.jsx(Ze,{style:{marginLeft:16,marginRight:4,flexShrink:0},children:v.jsx(Xi,{onDragging:this.props.onDragging})})]}),v.jsx(Ie,{valign:"center",halign:"center",style:{flexShrink:0},children:v.jsx(ji,{plain:Ke,extraControls:!0})}),v.jsxs(Ie,{valign:"center",halign:"right",style:{flex:1,minWidth:0,paddingLeft:16,justifyContent:"flex-end"},children:[T.settings.playerShowVolume&&s&&v.jsx(Ie,{style:{width:155,marginRight:12},children:v.jsx(da,{showSpeakerControl:!0})}),v.jsx(Fl,{style:{marginRight:10}}),v.jsx(Ol,{style:{marginRight:8}}),!r&&!T.player.isOfflinePlayQueue&&v.jsx(bc,{outerStyle:{marginLeft:6,marginRight:6}}),v.jsx(Ws,{size:16,padding:4,onPress:this.props.onContextMenu,style:{margin:10,backgroundColor:"transparent"}}),v.jsx(f0,{}),Ke&&v.jsx(Ac,{onPress:this.onDismiss})]})]}),v.jsx(Ie,{valign:"center",halign:"center",style:{width:"100%",height:38},children:v.jsx(Yr,{driving:n,audiobook:t,podcast:e})})]})]})}})||${className};`;
  }

  js = js.slice(0, p0Match.index) + newSideBySide + js.slice(endIdx + endPattern.length);
  console.log(`Patched ${varName} in Player bundle with Split-Screen Left Artwork + Right Queue + Full-Width Bottom Bar`);

  // 6. Prioritize side-by-side layout (p0/R0) over card mode when landscape & useTabletSideBySideLayout are active
  const newLayoutSelectRe = /([A-Za-z0-9_$]+)=([A-Za-z0-9_$]+)\?([A-Za-z0-9_$]+):([A-Za-z0-9_$]+)\.card\?([A-Za-z0-9_$]+):\4\.landscape\?([A-Za-z0-9_$]+)\.app\.useTabletSideBySideLayout\?([A-Za-z0-9_$]+):([A-Za-z0-9_$]+):([A-Za-z0-9_$]+)/;
  if (newLayoutSelectRe.test(js)) {
    js = js.replace(
      newLayoutSelectRe,
      (match, assign, skinCheck, skinLayout, screen, cardLayout, store, sbsLayout, lndLayout, prtLayout) => {
        return `${assign}=${skinCheck}?${skinLayout}:${screen}.landscape&&${store}.app.useTabletSideBySideLayout?${sbsLayout}:${screen}.card?${cardLayout}:${screen}.landscape?${lndLayout}:${prtLayout}`;
      }
    );
    console.log("Prioritized side-by-side split-screen layout over card aspect-ratio override (v5)");
  } else {
    const origLayoutSelect = "const o=fe.card?l0:fe.landscape?(T.app.useTabletSideBySideLayout?p0:d0):m0";
    const newLayoutSelect = "const o=fe.landscape&&T.app.useTabletSideBySideLayout?p0:fe.card?l0:fe.landscape?d0:m0";
    if (js.includes(origLayoutSelect)) {
      js = js.replace(origLayoutSelect, newLayoutSelect);
      console.log("Prioritized side-by-side split-screen layout (p0) over card aspect-ratio override (legacy)");
    }
  }

  // 7. Account for the 104px bottom bar in Up Next virtualized list height (Dc) (legacy only)
  const origQueueHeight = "style:{width:i,height:e-80}";
  const newQueueHeight = "style:{width:i,height:T.app.useTabletSideBySideLayout&&fe.landscape?e-184:e-80}";
  if (js.includes(origQueueHeight)) {
    js = js.replace(origQueueHeight, newQueueHeight);
    console.log("Adjusted PlayQueue Up Next scroll viewport height for 104px bottom bar (legacy)");
  }

  return js;
}

function syncAppDataFiles() {
  for (const dir of getAppDataDirs()) {
    if (!fs.existsSync(dir)) continue;
    for (const file of ["custom.css", "custom.js"]) {
      const src = path.join(__dirname, file);
      const dst = path.join(dir, file);
      if (!fs.existsSync(src)) continue;
      try {
        if (fs.existsSync(dst)) fs.unlinkSync(dst);
        fs.linkSync(src, dst);
        console.log(`Linked ${dst} <-> ${src}`);
      } catch {
        fs.copyFileSync(src, dst);
        console.log(`Copied ${src} -> ${dst}`);
      }
    }
  }
}

function isPlexampRunning() {
  try {
    if (IS_WIN) {
      const out = execSync('tasklist /FI "IMAGENAME eq Plexamp.exe" /NH', { encoding: "utf8" });
      return out.toLowerCase().includes("plexamp.exe");
    } else {
      const out = execSync("pgrep -i plexamp", { encoding: "utf8" });
      return out.trim().length > 0;
    }
  } catch {
    return false;
  }
}

function stopPlexamp() {
  try {
    if (IS_WIN) {
      execSync("taskkill /IM Plexamp.exe /F", { stdio: "ignore" });
    } else {
      execSync("pkill -i plexamp", { stdio: "ignore" });
    }
  } catch {}
}

function startPlexamp() {
  if (IS_WIN) {
    try {
      execSync(
        `powershell -NoProfile -Command "Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine='${PLEXAMP_EXE}'; CurrentDirectory='${PLEXAMP_DIR}'}"`,
        { stdio: "ignore" }
      );
      return;
    } catch {}
  }
  const child = spawn(PLEXAMP_EXE, [], {
    cwd: PLEXAMP_DIR,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

function writeExeWithRetry(targetPath, dataBuf) {
  for (let attempt = 1; attempt <= 15; attempt++) {
    try {
      fs.writeFileSync(targetPath, dataBuf);
      if (!IS_WIN) {
        try {
          fs.chmodSync(targetPath, 0o755);
        } catch {}
      }
      return;
    } catch (err) {
      if (attempt === 15) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
  }
}

function getStatus() {
  if (!fs.existsSync(PLEXAMP_EXE)) {
    console.error(`Plexamp executable not found at ${PLEXAMP_EXE}`);
    console.error(`Tip: Pass --exe /path/to/plexamp if installed in a custom location.`);
    process.exit(1);
  }
  const buf = fs.readFileSync(PLEXAMP_EXE);
  const bundleKey = findBundleKeyByPrefix(buf, "/assets/index-", 100000);
  const info = findEmbeddedAsset(buf, bundleKey);
  const js = zlib
    .brotliDecompressSync(buf.subarray(info.valFileOffset, info.valFileOffset + info.valLen))
    .toString("utf8");
  const isPatched = js.includes(BETTERPA_MARKER);
  const refBuf = isPatched && fs.existsSync(PLEXAMP_BAK) ? fs.readFileSync(PLEXAMP_BAK) : buf;
  const origInfo = findEmbeddedAsset(refBuf, bundleKey);
  console.log(`Plexamp executable : ${PLEXAMP_EXE}`);
  console.log(`Backup exists      : ${fs.existsSync(PLEXAMP_BAK) ? "Yes (" + PLEXAMP_BAK + ")" : "No"}`);
  console.log(
    `Target JS bundle   : ${bundleKey} @ 0x${info.valFileOffset.toString(16)} (${info.valLen} / ${
      origInfo.valLen
    } bytes compressed)`
  );
  console.log(`BetterPA status    : ${isPatched ? "PATCHED (Active)" : "UNPATCHED (Original)"}`);
  return { buf, refBuf, bundleKey, info, origInfo, js, isPatched };
}

function compressAndWriteAsset(outBuf, sourceBuf, assetKey, transformFn) {
  const sourceInfo = findEmbeddedAsset(sourceBuf, assetKey);
  const sourceCode = zlib
    .brotliDecompressSync(sourceBuf.subarray(sourceInfo.valFileOffset, sourceInfo.valFileOffset + sourceInfo.valLen))
    .toString("utf8");

  const patchedCode = transformFn(sourceCode);
  const compressed = zlib.brotliCompressSync(Buffer.from(patchedCode, "utf8"), {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 10,
    },
  });

  const slotCapacity = sourceInfo.valLen;
  console.log(
    `Compressed ${assetKey}: ${compressed.length} bytes (slot capacity: ${slotCapacity} bytes, spare: ${
      slotCapacity - compressed.length
    } bytes)`
  );

  if (compressed.length > slotCapacity) {
    throw new Error(`Compressed size (${compressed.length}) exceeds slot capacity (${slotCapacity}) for ${assetKey}.`);
  }

  outBuf.fill(0, sourceInfo.valFileOffset, sourceInfo.valFileOffset + slotCapacity);
  compressed.copy(outBuf, sourceInfo.valFileOffset);
  outBuf.writeBigUInt64LE(BigInt(compressed.length), sourceInfo.tableOffset + 24);
}

function installPatch(restartIfRunning = true) {
  const { buf, isPatched } = getStatus();

  if (!isPatched) {
    const htmlInfo = findEmbeddedAsset(buf, "/index.html");
    const html = zlib
      .brotliDecompressSync(buf.subarray(htmlInfo.valFileOffset, htmlInfo.valFileOffset + htmlInfo.valLen))
      .toString("utf8");
    if (!html.includes("betterpa") || !fs.existsSync(PLEXAMP_BAK)) {
      fs.copyFileSync(PLEXAMP_EXE, PLEXAMP_BAK);
      console.log(`Saved clean backup at ${PLEXAMP_BAK}`);
    }
  } else if (!fs.existsSync(PLEXAMP_BAK)) {
    throw new Error("Plexamp executable is already patched and no backup exists.");
  }

  const sourceBuf = fs.readFileSync(PLEXAMP_BAK);
  const outBuf = Buffer.from(sourceBuf);

  const mainBundleKey = findBundleKeyByPrefix(sourceBuf, "/assets/index-", 100000);
  compressAndWriteAsset(outBuf, sourceBuf, mainBundleKey, buildPatchedMainBundle);

  const playerBundleKey = findBundleKeyByPrefix(sourceBuf, "/assets/Player-", 50000);
  compressAndWriteAsset(outBuf, sourceBuf, playerBundleKey, buildPatchedPlayerBundle);

  // Unlock CSP script-src for custom.js by replacing the first unused sha256 token in-place (53 bytes -> 53 bytes)
  const unusedCspToken = Buffer.from("'sha256-U0F0bRNhpYqfdjcQfTzgupdrqV2duhfAVdvI72ELp4s='", "utf8");
  const unlockedCspToken = Buffer.from("'unsafe-eval' 'unsafe-inline' http://asset.localhost ", "utf8");
  const cspIdx = outBuf.indexOf(unusedCspToken);
  if (cspIdx !== -1 && unusedCspToken.length === unlockedCspToken.length) {
    unlockedCspToken.copy(outBuf, cspIdx);
    console.log(`Unlocked CSP script-src at 0x${cspIdx.toString(16)} for custom.js execution`);
  }

  syncAppDataFiles();

  const isSquashfsExtract = PLEXAMP_EXE.includes("squashfs-root");
  const shouldRestart = restartIfRunning && !isSquashfsExtract;
  const wasRunning = isPlexampRunning();
  if (wasRunning && shouldRestart) {
    console.log("Stopping running Plexamp instance...");
    stopPlexamp();
  }

  writeExeWithRetry(PLEXAMP_EXE, outBuf);
  console.log(`Successfully patched ${PLEXAMP_EXE}!`);

  if (shouldRestart && (IS_WIN || wasRunning)) {
    console.log("Starting Plexamp...");
    startPlexamp();
  }
}

function restoreBackup(restartIfRunning = true) {
  if (!fs.existsSync(PLEXAMP_BAK)) {
    console.error(`No backup found at ${PLEXAMP_BAK}`);
    process.exit(1);
  }
  const isSquashfsExtract = PLEXAMP_EXE.includes("squashfs-root");
  const shouldRestart = restartIfRunning && !isSquashfsExtract;
  const wasRunning = isPlexampRunning();
  if (wasRunning && shouldRestart) {
    console.log("Stopping running Plexamp instance...");
    stopPlexamp();
  }
  const bakBuf = fs.readFileSync(PLEXAMP_BAK);
  writeExeWithRetry(PLEXAMP_EXE, bakBuf);
  console.log(`Restored original ${PLEXAMP_EXE} from backup.`);
  if (wasRunning && shouldRestart) {
    console.log("Restarting Plexamp...");
    startPlexamp();
  }
}

const rawArgs = process.argv.slice(2);
const noRestart = rawArgs.includes("--no-restart");
const positionalArgs = [];
for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === "--exe") {
    i++;
  } else if (!rawArgs[i].startsWith("--")) {
    positionalArgs.push(rawArgs[i]);
  }
}
const cmd = (positionalArgs[0] || "install").toLowerCase();

if (cmd === "status") {
  getStatus();
} else if (cmd === "restore" || cmd === "unpatch" || cmd === "uninstall") {
  restoreBackup(!noRestart);
} else if (cmd === "extract-html") {
  const refBuf = fs.existsSync(PLEXAMP_BAK) ? fs.readFileSync(PLEXAMP_BAK) : fs.readFileSync(PLEXAMP_EXE);
  const htmlInfo = findEmbeddedAsset(refBuf, "/index.html");
  const html = zlib
    .brotliDecompressSync(refBuf.subarray(htmlInfo.valFileOffset, htmlInfo.valFileOffset + htmlInfo.valLen))
    .toString("utf8");
  const outPath = path.join(__dirname, "extracted-index.html");
  fs.writeFileSync(outPath, html, "utf8");
  console.log(`Extracted /index.html to ${outPath}`);
} else if (cmd === "install" || cmd === "patch") {
  installPatch(!noRestart);
} else {
  console.log("Usage: node patch.js [install|restore|status|extract-html] [--exe <path>] [--no-restart]");
}
