const PDFJS_VERSION = "4.10.38";
const PDFJS_CDN_BASE = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`;
const PDFJS_CDN_MODULE_URL = `${PDFJS_CDN_BASE}/pdf.min.mjs`;
const PDFJS_CDN_WORKER_URL = `${PDFJS_CDN_BASE}/pdf.worker.min.mjs`;
// Optional local pdf.js (recommended for reliability on restricted networks):
// Put files here if you want to avoid CDN:
// `vendor/pdfjs/pdf.min.mjs` and `vendor/pdfjs/pdf.worker.min.mjs`
const PDFJS_LOCAL_MODULE_URL = "./vendor/pdfjs/pdf.min.mjs";
const PDFJS_LOCAL_WORKER_URL = "./vendor/pdfjs/pdf.worker.min.mjs";

const $ = (sel) => document.querySelector(sel);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

const ui = {
  fileLabel: $("#fileLabel"),
  viewer: $("#viewer"),
  page3d: $("#page3d"),
  canvasA: $("#canvasA"),
  canvasB: $("#canvasB"),
  statusPill: $("#statusPill"),

  prevBtn: $("#prevBtn"),
  nextBtn: $("#nextBtn"),
  pageInput: $("#pageInput"),
  pageTotal: $("#pageTotal"),

  zoomOutBtn: $("#zoomOutBtn"),
  zoomInBtn: $("#zoomInBtn"),
  zoomRange: $("#zoomRange"),
  fullscreenBtn: $("#fullscreenBtn"),
  themeBtn: $("#themeBtn"),
  openBtn: $("#openBtn"),
  fileInput: $("#fileInput"),
  shareBtn: $("#shareBtn"),
  downloadBtn: $("#downloadBtn"),

  progressBar: $("#progressBar"),
  progressText: $("#progressText"),

  tocBtn: $("#tocBtn"),
  searchBtn: $("#searchBtn"),

  drawer: $("#drawer"),
  scrim: $("#scrim"),
  drawerCloseBtn: $("#drawerCloseBtn"),
  tabToc: $("#tabToc"),
  tabSearch: $("#tabSearch"),
  tabAbout: $("#tabAbout"),
  paneToc: $("#paneToc"),
  paneSearch: $("#paneSearch"),
  paneAbout: $("#paneAbout"),
  tocList: $("#tocList"),

  searchInput: $("#searchInput"),
  searchGoBtn: $("#searchGoBtn"),
  searchHint: $("#searchHint"),
  searchResults: $("#searchResults"),

  featureTpl: $("#featureTpl"),
  featureGrid: $("#featureGrid"),
};

const state = {
  pdfjs: null,
  pdf: null,
  numPages: 0,
  currentPage: 1,
  scale: 1.2,
  rendering: false,
  renderNonce: 0,
  textCache: new Map(), // pageNumber -> lowercased string
  outlineBuilt: false,
  drawerOpen: false,
  reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false,
  pdfJsWorkerUrl: null,
  pdfJsMode: null, // "module" | "global"
};

function setStatus(msg) {
  ui.statusPill.textContent = msg;
}

function setTheme(theme) {
  document.body.dataset.theme = theme;
  localStorage.setItem("ebook_theme", theme);
  ui.themeBtn.textContent = theme === "light" ? "Dark" : "Light";
}

function initTheme() {
  const saved = localStorage.getItem("ebook_theme");
  if (saved === "light" || saved === "dark") return setTheme(saved);
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? true;
  setTheme(prefersDark ? "dark" : "light");
}

function parseUrlParams() {
  const p = new URLSearchParams(location.search);
  const page = parseInt(p.get("page") || "1", 10);
  const file = p.get("file") || "หนังสือรุ่น.pdf";
  return { page: Number.isFinite(page) ? page : 1, file };
}

function updateUrl(page) {
  const p = new URLSearchParams(location.search);
  p.set("page", String(page));
  if (!p.get("file")) p.set("file", "หนังสือรุ่น.pdf");
  const next = `${location.pathname}?${p.toString()}`;
  history.replaceState({}, "", next);
}

function makeFlipSound() {
  // Short page-flip noise without shipping any audio file.
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    return () => {
      const dur = 0.085;
      const sr = ctx.sampleRate;
      const frames = Math.floor(dur * sr);
      const buffer = ctx.createBuffer(1, frames, sr);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < frames; i++) {
        const t = i / frames;
        const env = Math.pow(1 - t, 2.6);
        const noise = (Math.random() * 2 - 1) * 0.45;
        const hiss = (Math.random() * 2 - 1) * 0.12;
        data[i] = (noise + hiss) * env;
      }
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.value = 0.45;
      src.connect(gain).connect(ctx.destination);
      src.start();
    };
  } catch {
    return () => {};
  }
}

const playFlip = makeFlipSound();

class EbookError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = "EbookError";
    this.code = code;
    this.cause = cause;
  }
}

function setButtonsEnabled() {
  ui.prevBtn.disabled = !state.pdf || state.currentPage <= 1 || state.rendering;
  ui.nextBtn.disabled = !state.pdf || state.currentPage >= state.numPages || state.rendering;
  ui.pageInput.disabled = !state.pdf || state.rendering;
}

function setProgress() {
  const pct = state.numPages ? (state.currentPage / state.numPages) * 100 : 0;
  ui.progressBar.style.width = `${pct}%`;
  ui.progressText.textContent = state.numPages
    ? `${state.currentPage.toLocaleString()} / ${state.numPages.toLocaleString()}`
    : "–";
}

function setPageInput() {
  ui.pageInput.value = String(state.currentPage);
  ui.pageTotal.textContent = state.numPages ? String(state.numPages) : "–";
}

function showDrawer(tab) {
  state.drawerOpen = true;
  ui.drawer.classList.add("open");
  ui.drawer.setAttribute("aria-hidden", "false");
  ui.scrim.classList.add("show");
  ui.scrim.setAttribute("aria-hidden", "false");
  selectTab(tab);
}

function hideDrawer() {
  state.drawerOpen = false;
  ui.drawer.classList.remove("open");
  ui.drawer.setAttribute("aria-hidden", "true");
  ui.scrim.classList.remove("show");
  ui.scrim.setAttribute("aria-hidden", "true");
}

function selectTab(tab) {
  const allTabs = [
    { tab: ui.tabToc, pane: ui.paneToc, key: "toc" },
    { tab: ui.tabSearch, pane: ui.paneSearch, key: "search" },
    { tab: ui.tabAbout, pane: ui.paneAbout, key: "about" },
  ];
  for (const t of allTabs) {
    const active = t.key === tab;
    t.tab.classList.toggle("active", active);
    t.tab.setAttribute("aria-selected", active ? "true" : "false");
    t.pane.classList.toggle("hidden", !active);
  }
  if (tab === "toc") void ensureOutline();
}

async function ensureOutline() {
  if (!state.pdf || state.outlineBuilt) return;
  state.outlineBuilt = true;

  ui.tocList.textContent = "";
  setStatus("กำลังอ่านสารบัญ…");
  try {
    const outline = await state.pdf.getOutline();
    if (!outline || !outline.length) {
      ui.tocList.appendChild(makeInfoItem("ไม่พบสารบัญในไฟล์ PDF นี้"));
      setStatus("พร้อมใช้งาน");
      return;
    }

    const frag = document.createDocumentFragment();
    const walk = async (nodes, depth) => {
      for (const n of nodes) {
        const page = await outlineNodeToPage(n);
        frag.appendChild(makeTocItem(n.title || "(ไม่มีชื่อ)", page, depth));
        if (n.items && n.items.length) await walk(n.items, depth + 1);
      }
    };
    await walk(outline, 0);
    ui.tocList.appendChild(frag);
    setStatus("พร้อมใช้งาน");
  } catch (e) {
    ui.tocList.appendChild(makeInfoItem("อ่านสารบัญไม่สำเร็จ"));
    setStatus("พร้อมใช้งาน");
    console.warn(e);
  }
}

async function outlineNodeToPage(node) {
  if (!state.pdf) return null;
  try {
    let dest = node.dest;
    if (!dest) return null;
    if (typeof dest === "string") dest = await state.pdf.getDestination(dest);
    if (!Array.isArray(dest) || !dest.length) return null;
    const ref = dest[0];
    const idx = await state.pdf.getPageIndex(ref);
    return idx + 1;
  } catch {
    return null;
  }
}

function makeInfoItem(text) {
  const div = document.createElement("div");
  div.className = "item";
  div.style.cursor = "default";
  div.innerHTML = `<div class="itemTitle">${escapeHtml(text)}</div>`;
  return div;
}

function makeTocItem(title, page, depth) {
  const div = document.createElement("div");
  div.className = "item" + (depth ? " indent" : "");
  div.innerHTML = `
    <div class="itemTitle">${escapeHtml(title)}</div>
    <div class="itemMeta">${page ? "หน้า " + page : "—"}</div>
  `;
  if (page) {
    div.addEventListener("click", () => {
      hideDrawer();
      void goToPage(page);
    });
  } else {
    div.style.opacity = "0.75";
  }
  return div;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildFeatureSummary() {
  const features = [
    { name: "พลิกหน้ากระดาษ 3D", desc: "แอนิเมชันพลิกหน้าแบบ 3 มิติด้วย CSS 3D พร้อมเรนเดอร์หน้าปลายทางล่วงหน้า" },
    { name: "เสียงพลิกหน้า", desc: "สร้างเสียงจาก Web Audio (ไม่ต้องมีไฟล์เสียงแยก)" },
    { name: "ซูม", desc: "ซูมด้วยสไลเดอร์/ปุ่ม และคงสัดส่วนหน้ากระดาษ" },
    { name: "Fullscreen", desc: "กดเต็มจอได้ (ใช้ Fullscreen API)" },
    { name: "รองรับมือถือ", desc: "UI ปรับตามหน้าจอ + ปุ่มสำคัญใช้งานง่ายบนมือถือ" },
    { name: "ไปหน้าที่ต้องการ", desc: "พิมพ์เลขหน้าแล้วกด Enter เพื่อไปทันที" },
    { name: "ค้นหาคำ", desc: "ดึงข้อความจาก PDF ทีละหน้าแบบ Lazy แล้วค้นหา พร้อมผลลัพธ์คลิกไปหน้า" },
    { name: "progress bar", desc: "แถบความคืบหน้าตามหน้าปัจจุบัน / จำนวนหน้าทั้งหมด" },
    { name: "โหลดทีละหน้า", desc: "เรนเดอร์เฉพาะหน้าที่เปิดอยู่ (และเตรียมหน้าถัดไปเฉพาะตอนพลิก)" },
    { name: "สารบัญ", desc: "อ่าน Outline จาก PDF (ถ้ามี) แล้วคลิกเพื่อไปหน้า" },
    { name: "แชร์หน้า", desc: "แชร์ลิงก์พร้อมพารามิเตอร์ `?page=` ผ่าน Web Share หรือคัดลอกคลิปบอร์ด" },
    { name: "ดาวน์โหลด PDF", desc: "ปุ่มดาวน์โหลดไฟล์ PDF ต้นฉบับ" },
    { name: "Dark mode", desc: "สลับโหมดมืด/สว่าง และจำค่าในเครื่อง" },
    { name: "PWA", desc: "มี manifest + service worker สำหรับแคชไฟล์ ใช้งานออฟไลน์หลังเคยเปิดครั้งแรก" },
  ];

  ui.featureGrid.textContent = "";
  for (const f of features) {
    const node = ui.featureTpl.content.firstElementChild.cloneNode(true);
    node.querySelector(".featureName").textContent = f.name;
    node.querySelector(".featureState").textContent = "✅";
    node.querySelector(".featureDesc").textContent = f.desc;
    ui.featureGrid.appendChild(node);
  }
}

async function loadPdfJs() {
  setStatus("กำลังโหลดตัวเรนเดอร์ PDF…");
  if (window.pdfjsLib) {
    state.pdfJsMode = "global";
    return window.pdfjsLib;
  }

  const moduleAttempts = [
    { moduleUrl: PDFJS_LOCAL_MODULE_URL, workerUrl: PDFJS_LOCAL_WORKER_URL, label: "local-mjs" },
    { moduleUrl: PDFJS_CDN_MODULE_URL, workerUrl: PDFJS_CDN_WORKER_URL, label: "cdn-mjs" },
  ];

  let lastErr = null;
  for (const a of moduleAttempts) {
    try {
      const mod = await import(a.moduleUrl);
      state.pdfJsWorkerUrl = a.workerUrl;
      state.pdfJsMode = "module";
      return mod;
    } catch (e) {
      lastErr = e;
      console.warn(`pdf.js import failed (${a.label})`, e);
    }
  }

  // Fallback to classic script build if present (better chance to work on `file://`).
  try {
    const ok = await loadPdfJsClassic();
    if (ok && window.pdfjsLib) {
      state.pdfJsMode = "global";
      return window.pdfjsLib;
    }
  } catch (e) {
    lastErr = e;
  }

  const msg =
    "โหลด pdf.js ไม่ได้: เครือข่ายอาจบล็อก CDN หรือยังไม่มีไฟล์ local ที่ vendor/pdfjs/ (เปิด Console จะเห็น error)";
  setStatus(msg);
  throw new EbookError("PDFJS_LOAD_FAILED", msg, lastErr);
}

async function loadPdfJsClassic() {
  // Requires `vendor/pdfjs/pdf.min.js` (classic build) to exist, or CDN classic build.
  const localClassic = "./vendor/pdfjs/pdf.min.js";
  const cdnClassic = `${PDFJS_CDN_BASE}/pdf.min.js`;

  const tryLoad = async (src) => {
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`script load failed: ${src}`));
      document.head.appendChild(s);
    });
  };

  try {
    await tryLoad(localClassic);
    state.pdfJsWorkerUrl = "./vendor/pdfjs/pdf.worker.min.js";
    return true;
  } catch (e) {
    console.warn("pdf.js classic local failed", e);
  }

  await tryLoad(cdnClassic);
  state.pdfJsWorkerUrl = `${PDFJS_CDN_BASE}/pdf.worker.min.js`;
  return true;
}

async function openPdfSource(source, initialPage) {
  state.pdfjs = await loadPdfJs();
  const workerUrl = state.pdfJsWorkerUrl || PDFJS_CDN_WORKER_URL;
  if (state.pdfjs?.GlobalWorkerOptions) state.pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  setStatus("กำลังเปิดไฟล์ PDF…");
  ui.fileLabel.textContent = source.label || "PDF";
  if (source.url) {
    ui.downloadBtn.href = source.url;
    ui.downloadBtn.style.display = "";
  } else {
    // If user picked a file via input, we can't provide a stable download URL.
    ui.downloadBtn.style.display = "none";
  }

  const isFile = location.protocol === "file:";
  let task;
  try {
    task = state.pdfjs.getDocument({
      ...(source.data ? { data: source.data } : { url: source.url }),
      enableXfa: false,
      // Workers often fail on `file://` due to security restrictions.
      ...(isFile ? { disableWorker: true } : {}),
    });
    state.pdf = await task.promise;
  } catch (e) {
    const msg = source.url
      ? `เปิด PDF ไม่ได้: ${source.url} (อาจ 404/บล็อก/ไฟล์ใหญ่เกิน หรือ CORS)`
      : "เปิด PDF ไม่ได้: ไฟล์จากเครื่องอาจเสียหรือไม่ใช่ PDF";
    setStatus(msg);
    throw new EbookError("PDF_LOAD_FAILED", msg, e);
  }
  state.numPages = state.pdf.numPages || 0;

  state.currentPage = clamp(initialPage, 1, state.numPages || 1);
  updateUrl(state.currentPage);
  setPageInput();
  setProgress();
  setButtonsEnabled();
  setStatus("พร้อมใช้งาน");
  await renderToCanvas(state.currentPage, ui.canvasA, state.scale);
}

function ensureCanvasSize(canvas, w, h) {
  // Only resize when needed to avoid clearing/flash.
  if (canvas.width === w && canvas.height === h) return;
  canvas.width = w;
  canvas.height = h;
}

async function renderToCanvas(pageNumber, canvas, scale) {
  if (!state.pdf) return;
  const nonce = ++state.renderNonce;
  state.rendering = true;
  setButtonsEnabled();

  try {
    const page = await state.pdf.getPage(pageNumber);
    if (nonce !== state.renderNonce) return;

    const viewport = page.getViewport({ scale });
    const ctx = canvas.getContext("2d", { alpha: false });
    ensureCanvasSize(canvas, Math.floor(viewport.width), Math.floor(viewport.height));

    const renderTask = page.render({ canvasContext: ctx, viewport });
    await renderTask.promise;
  } finally {
    if (nonce === state.renderNonce) {
      state.rendering = false;
      setButtonsEnabled();
      setPageInput();
      setProgress();
    }
  }
}

async function flipTo(nextPage) {
  if (!state.pdf) return;
  if (nextPage === state.currentPage) return;
  nextPage = clamp(nextPage, 1, state.numPages);
  if (state.rendering) return;

  const forward = nextPage > state.currentPage;
  setStatus(`กำลังไปหน้า ${nextPage}…`);

  // Prepare next page into canvasB first, then animate the 3D flip.
  await renderToCanvas(nextPage, ui.canvasB, state.scale);
  if (state.rendering) return;

  if (!state.reducedMotion) playFlip();

  ui.page3d.classList.remove("flipAnim", "back");
  // Force reflow to restart animation.
  void ui.page3d.offsetWidth;
  ui.page3d.classList.add("flipAnim");
  if (!forward) ui.page3d.classList.add("back");

  const done = () =>
    new Promise((resolve) => {
      if (state.reducedMotion) return resolve();
      const onEnd = () => {
        ui.page3d.removeEventListener("animationend", onEnd);
        resolve();
      };
      ui.page3d.addEventListener("animationend", onEnd, { once: true });
    });

  await done();

  // Commit next page as current (keep DOM stable, avoid 3D state glitches).
  copyCanvas(ui.canvasB, ui.canvasA);
  state.currentPage = nextPage;
  updateUrl(state.currentPage);
  setStatus("พร้อมใช้งาน");
  setButtonsEnabled();
  setPageInput();
  setProgress();
}

function copyCanvas(src, dst) {
  ensureCanvasSize(dst, src.width, src.height);
  const ctx = dst.getContext("2d", { alpha: false });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(src, 0, 0);
}

async function goToPage(page) {
  page = clamp(page, 1, state.numPages || 1);
  await flipTo(page);
}

async function search(queryRaw) {
  if (!state.pdf) return;
  const query = String(queryRaw || "").trim();
  ui.searchResults.textContent = "";
  if (!query) {
    ui.searchHint.textContent = "พิมพ์คำ แล้วกด Enter";
    return;
  }

  const q = query.toLowerCase();
  ui.searchHint.textContent = "กำลังค้นหา… (ดึงข้อความทีละหน้า)";
  setStatus("กำลังค้นหา…");

  let hits = 0;
  for (let pageNumber = 1; pageNumber <= state.numPages; pageNumber++) {
    const text = await getPageTextLower(pageNumber);
    if (text.includes(q)) {
      hits++;
      ui.searchResults.appendChild(makeSearchItem(query, pageNumber, text, q));
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  ui.searchHint.textContent = hits ? `พบ ${hits} หน้า` : "ไม่พบคำที่ค้นหา";
  setStatus("พร้อมใช้งาน");
}

async function getPageTextLower(pageNumber) {
  if (state.textCache.has(pageNumber)) return state.textCache.get(pageNumber);
  const page = await state.pdf.getPage(pageNumber);
  const content = await page.getTextContent();
  const text = (content.items || [])
    .map((it) => (typeof it.str === "string" ? it.str : ""))
    .join(" ");
  const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
  state.textCache.set(pageNumber, normalized);
  return normalized;
}

function makeSearchItem(query, pageNumber, textLower, qLower) {
  const div = document.createElement("div");
  div.className = "item";
  const idx = textLower.indexOf(qLower);
  const start = Math.max(0, idx - 28);
  const end = Math.min(textLower.length, idx + qLower.length + 28);
  const snippet = idx >= 0 ? textLower.slice(start, end) : "";
  const safe = escapeHtml(snippet);
  const safeQ = escapeHtml(qLower);
  const highlighted = idx >= 0 ? safe.replace(safeQ, `<span class="searchHit">${safeQ}</span>`) : safe;

  div.innerHTML = `
    <div class="itemTitle">หน้า ${pageNumber} <span class="itemMeta">พบคำ: ${escapeHtml(query)}</span></div>
    <div class="paneHint">${highlighted || "—"}</div>
  `;
  div.addEventListener("click", () => {
    hideDrawer();
    void goToPage(pageNumber);
  });
  return div;
}

async function shareCurrentPage() {
  const url = new URL(location.href);
  url.searchParams.set("page", String(state.currentPage));
  if (!url.searchParams.get("file")) url.searchParams.set("file", "หนังสือรุ่น.pdf");
  const shareData = {
    title: "E-Book",
    text: `หน้า ${state.currentPage}`,
    url: url.toString(),
  };

  if (navigator.share) {
    try {
      await navigator.share(shareData);
      return;
    } catch {
      // fall back
    }
  }

  try {
    await navigator.clipboard.writeText(shareData.url);
    setStatus("คัดลอกลิงก์แล้ว");
    setTimeout(() => setStatus("พร้อมใช้งาน"), 900);
  } catch {
    prompt("คัดลอกลิงก์นี้:", shareData.url);
  }
}

async function toggleFullscreen() {
  const el = ui.viewer;
  if (!document.fullscreenElement) {
    try {
      await el.requestFullscreen();
    } catch {}
  } else {
    try {
      await document.exitFullscreen();
    } catch {}
  }
}

function adjustZoom(deltaPct) {
  const pct = clamp(parseInt(ui.zoomRange.value, 10) + deltaPct, 50, 250);
  ui.zoomRange.value = String(pct);
  void applyZoomFromRange();
}

async function applyZoomFromRange() {
  const pct = clamp(parseInt(ui.zoomRange.value, 10) || 120, 50, 250);
  state.scale = pct / 100;
  setStatus(`ซูม ${pct}%…`);
  // Re-render current page at new scale without flip.
  await renderToCanvas(state.currentPage, ui.canvasA, state.scale);
  setStatus("พร้อมใช้งาน");
}

function wireUi() {
  ui.prevBtn.addEventListener("click", () => void goToPage(state.currentPage - 1));
  ui.nextBtn.addEventListener("click", () => void goToPage(state.currentPage + 1));

  ui.pageInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const n = parseInt(ui.pageInput.value, 10);
    if (!Number.isFinite(n)) return;
    void goToPage(n);
  });

  ui.zoomOutBtn.addEventListener("click", () => adjustZoom(-10));
  ui.zoomInBtn.addEventListener("click", () => adjustZoom(10));
  ui.zoomRange.addEventListener("input", () => {
    // Debounced-ish: schedule microtask to avoid re-render per pixel.
    clearTimeout(wireUi._zoomT);
    wireUi._zoomT = setTimeout(() => void applyZoomFromRange(), 120);
  });

  ui.fullscreenBtn.addEventListener("click", () => void toggleFullscreen());
  ui.themeBtn.addEventListener("click", () => {
    const t = document.body.dataset.theme === "light" ? "dark" : "light";
    setTheme(t);
  });
  ui.openBtn.addEventListener("click", () => ui.fileInput?.click());
  ui.fileInput?.addEventListener("change", async () => {
    const f = ui.fileInput.files?.[0];
    if (!f) return;
    setStatus("กำลังอ่านไฟล์จากเครื่อง…");
    try {
      const buf = await f.arrayBuffer();
      state.textCache.clear();
      state.outlineBuilt = false;
      await openPdfSource({ data: buf, label: f.name }, 1);
    } catch (e) {
      console.warn(e);
      setStatus("อ่านไฟล์ไม่สำเร็จ (ลองเลือกไฟล์ PDF ใหม่)");
    } finally {
      ui.fileInput.value = "";
    }
  });
  ui.shareBtn.addEventListener("click", () => void shareCurrentPage());

  ui.tocBtn.addEventListener("click", () => showDrawer("toc"));
  ui.searchBtn.addEventListener("click", () => showDrawer("search"));
  ui.drawerCloseBtn.addEventListener("click", () => hideDrawer());
  ui.scrim.addEventListener("click", () => hideDrawer());

  ui.tabToc.addEventListener("click", () => selectTab("toc"));
  ui.tabSearch.addEventListener("click", () => selectTab("search"));
  ui.tabAbout.addEventListener("click", () => selectTab("about"));

  ui.searchGoBtn.addEventListener("click", () => void search(ui.searchInput.value));
  ui.searchInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    void search(ui.searchInput.value);
  });

  window.addEventListener("keydown", (e) => {
    if (state.drawerOpen) return;
    if (e.key === "ArrowLeft") return void goToPage(state.currentPage - 1);
    if (e.key === "ArrowRight") return void goToPage(state.currentPage + 1);
  });
}

function registerPwa() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    } catch (e) {
      console.warn("SW register failed", e);
    }
  });
}

async function main() {
  window.__ebook_booted = true;
  initTheme();
  buildFeatureSummary();
  wireUi();
  registerPwa();

  const { page, file } = parseUrlParams();
  const fileUrl = encodeURI(file);

  try {
    if (location.protocol === "file:") {
      // `fetch(file.pdf)` is often blocked on file://; prefer user file picker.
      setStatus("โหมดไฟล์: กด “เปิด PDF” เพื่อเลือกไฟล์จากเครื่อง");
      ui.fileLabel.textContent = "file://";
      showDrawer("about");
      return;
    }

    await openPdfSource({ url: fileUrl, label: file }, page);
  } catch (e) {
    console.warn(e);
    const code = e && typeof e === "object" && "code" in e ? e.code : null;
    if (code === "PDFJS_LOAD_FAILED") {
      setStatus("เริ่มระบบไม่สำเร็จ: โหลดตัวเรนเดอร์ PDF (pdf.js) ไม่ได้ (ดู Console / หรือใส่ไฟล์ไว้ที่ vendor/pdfjs)");
    } else if (code === "PDF_LOAD_FAILED") {
      setStatus("เริ่มระบบไม่สำเร็จ: โหลดไฟล์ PDF ไม่ได้ (เช็คว่าไฟล์อยู่บน Pages จริงและเปิดได้)");
    } else {
      setStatus("เริ่มระบบไม่สำเร็จ: มีข้อผิดพลาดระหว่างโหลด (เปิด Console เพื่อดูรายละเอียด)");
    }
    setButtonsEnabled();
    ui.pageTotal.textContent = "–";
    ui.progressText.textContent = "—";
    ui.fileLabel.textContent = fileUrl;
    showDrawer("about");
  }
}

main();
