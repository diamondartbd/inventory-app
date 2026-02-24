/* =========================================================
   State
   ========================================================= */
let selectedImagePath = null;
let currentEditCode = null;

let currentCategoryView = null;
let currentDetailsProduct = null;

const RESULT_PAGE_SIZE = 10;
let resultState = {
  mode: "none",  // "none" | "prefix" | "filter"
  prefix: "",
  filters: {},
  total: 0,
  page: 1
};

// SMS modal state
let smsEditId = null;
let smsViewCurrentText = "";

/* =========================================================
   Categories
   ========================================================= */
const CATEGORIES = [
  { name: "Nosepin", prefix: "N" },
  { name: "Female Ring", prefix: "R" },
  { name: "Gents Ring", prefix: "GR" },
  { name: "Pendant", prefix: "P" },
  { name: "Ear Top", prefix: "ET" },
  { name: "Bracelet", prefix: "BR" },
  { name: "Tanmanaya", prefix: "NK" },
  { name: "Ear Top & Pendant Set", prefix: "TP" },
  { name: "Platinum Ring", prefix: "PLT" }
];

/* =========================================================
   DOM helpers
   ========================================================= */
function $(id) { return document.getElementById(id); }

function show(el) { el.classList.add("show"); }
function hide(el) { el.classList.remove("show"); }

function openModal() { show($("modalBackdrop")); }
function closeModal() { hide($("modalBackdrop")); }

function openDetailsModal() { show($("detailsBackdrop")); }
function closeDetailsModal() { hide($("detailsBackdrop")); }

function openPriceModal() { show($("priceBackdrop")); }
function closePriceModal() { hide($("priceBackdrop")); }

function openPriceInputModal() { show($("priceInputBackdrop")); }
function closePriceInputModal() { hide($("priceInputBackdrop")); }

function openSmsModal() { show($("smsBackdrop")); }
function closeSmsModal() { hide($("smsBackdrop")); }

function openSmsViewModal() { show($("smsViewBackdrop")); }
function closeSmsViewModal() { hide($("smsViewBackdrop")); }

/* =========================================================
   Image URL helper (cache buster to force refresh)
   ========================================================= */
function fileUrl(path) {
  if (!path) return "";
  // cache-buster fixes "old image stays until reload"
  return `file://${path}?t=${Date.now()}`;
}

/* =========================================================
   Toast (supports Undo)
   ========================================================= */
let toastTimer = null;
function toast(msg, ms = 1800) {
  const t = $("toast");
  t.innerHTML = msg;
  t.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), ms);
}

function toastAction(msg, actionLabel, actionFn, ms = 10000) {
  const t = $("toast");
  t.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
      <div>${msg}</div>
      <button class="btn small primary" id="toastActionBtn">${actionLabel}</button>
    </div>
  `;
  t.classList.add("show");

  const btn = $("toastActionBtn");
  if (btn) {
    btn.onclick = async () => {
      try { await actionFn(); } catch {}
      t.classList.remove("show");
    };
  }

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), ms);
}

/* =========================================================
   Page navigation + last category remember
   ========================================================= */
function setPage(page) {
  $("pageDashboard").style.display = (page === "dashboard") ? "block" : "none";
  $("pageCategory").style.display = (page === "category") ? "block" : "none";
  $("navDashboard").classList.toggle("active", page === "dashboard");
}

function setActiveCategoryNav(categoryName) {
  document.querySelectorAll("[data-cat]").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-cat") === categoryName);
  });
}

function rememberLastCategory(cat) {
  try { localStorage.setItem("lastCategory", cat || ""); } catch {}
}
function getLastCategory() {
  try { return (localStorage.getItem("lastCategory") || "").trim(); } catch { return ""; }
}

/* =========================================================
   Utilities
   ========================================================= */
function normalizeCode(code) {
  return (code || "")
    .toString()
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}
function basePrefix(code) {
  return normalizeCode(code).split(" ")[0];
}
function toNumberOrNull(v) {
  const s = (v ?? "").toString().trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}
function toTextOrNull(v) {
  const s = (v ?? "").toString().trim();
  return s ? s : null;
}
function numOr0(v) {
  const n = Number(v);
  return Number.isNaN(n) || v === null || v === undefined ? 0 : n;
}
function finalPrice(p) {
  return (p?.discountPrice ?? p?.regularPrice);
}
function calcVatPrice(finalP) {
  const x = Number(finalP);
  if (Number.isNaN(x)) return null;
  return Math.round(x * 1.05);
}

function naText(v) {
  if (v === null || v === undefined || v === "") return "N/A";
  return String(v);
}
function naNum(v) {
  if (v === null || v === undefined || v === "" || Number.isNaN(Number(v))) return "N/A";
  return String(v);
}

function stockBadgeHtml(qty) {
  const q = Number(qty ?? 0);
  const inStock = q > 0;
  return inStock
    ? `<span class="badge in">● In Stock • ${q} pcs</span>`
    : `<span class="badge out">● Stock Out</span>`;
}

function fillCategoryDropdowns() {
  // Left nav
  const nav = $("categoryNav");
  nav.innerHTML = "";
  CATEGORIES.forEach(c => {
    const btn = document.createElement("button");
    btn.className = "btn navBtn";
    btn.textContent = "• " + c.name;
    btn.setAttribute("data-cat", c.name);
    btn.onclick = () => openCategoryPage(c.name);
    nav.appendChild(btn);
    const sp = document.createElement("div");
    sp.style.height = "8px";
    nav.appendChild(sp);
  });

  // Filter dropdown
  const f = $("filterCategory");
  f.innerHTML = `<option value="">All</option>` + CATEGORIES.map(c => `<option value="${c.name}">${c.name}</option>`).join("");

  // Add/Edit form dropdown
  const sel = $("fCategory");
  sel.innerHTML = CATEGORIES.map(c => `<option value="${c.name}">${c.name}</option>`).join("");
}

function detectCategoryFromCode(code) {
  const up = normalizeCode(code).replace(/\s+/g, "");
  const sorted = [...CATEGORIES].sort((a, b) => b.prefix.length - a.prefix.length);
  for (const c of sorted) {
    const p = c.prefix.toUpperCase();
    if (up.startsWith(p + "-") || up.startsWith(p)) return c.name;
  }
  return null;
}

/* =========================================================
   Clipboard
   ========================================================= */
async function copyTextToClipboard(text) {
  const t = (text || "").trim();
  if (!t) return toast("Empty");
  try {
    await navigator.clipboard.writeText(t);
    toast("📋 Copied!");
  } catch {
    const ta = document.createElement("textarea");
    ta.value = t;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    toast("📋 Copied!");
  }
}

/* =========================================================
   Logo (Option B)
   ========================================================= */
async function loadAppLogo() {
  try {
    const p = await window.api.getLogo();
    const img = $("appLogoImg");
    if (!img) return;

    if (p) {
      img.src = fileUrl(p);
      img.style.display = "block";
    } else {
      // fallback remains assets/logo.png
      img.style.display = "block";
    }
  } catch {}
}

async function changeAppLogo() {
  try {
    const picked = await window.api.pickLogo();
    if (!picked) return;
    const res = await window.api.setLogo(picked);
    if (!res?.success) return toast("❌ Logo save failed");
    await loadAppLogo();
    toast("✅ Logo Updated");
  } catch {
    toast("❌ Logo error");
  }
}

/* =========================================================
   Product Reply (Copy Text)
   ========================================================= */
function isMeaningfulText(v) {
  const s = (v ?? "").toString().trim();
  if (!s) return false;
  if (s.toUpperCase() === "N/A") return false;
  return true;
}
function isMeaningfulNumber(v) {
  if (v === null || v === undefined || v === "") return false;
  const n = Number(v);
  if (Number.isNaN(n)) return false;
  if (n === 0) return false;
  return true;
}
function fmtNum(v, suffix = "") {
  const n = Number(v);
  if (Number.isNaN(n)) return "";
  return `${n}${suffix}`;
}
function fmtMoney(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return "";
  return `${Math.round(n)}`;
}
function isPlatinumProduct(p) {
  const cat = (p?.category || "").toString().toLowerCase();
  const code = normalizeCode(p?.code || "");
  return cat.includes("platinum") || code.startsWith("PLT");
}

function formatReply(p) {
  const lines = [];
  const cat = p?.category;
  const code = p?.code;
  const purityTag = isPlatinumProduct(p) ? "Platinum 950" : "18K Gold";

  // Header (Luxury)
  lines.push(`◇◆ DIAMOND ART ◆◇`);
  lines.push(`Your Classic Partner`);
  lines.push(`━━━━━━━━━━━━━━━━━━━━`);

  // Top identity
  if (isMeaningfulText(cat)) lines.push(`CATEGORY : ${cat}`);
  if (isMeaningfulText(code)) lines.push(`CODE     : ${code}`);

  lines.push(`━━━━━━━━━━━━━━━━━━━━`);

  // Product details (skip empty/N/A)
  lines.push(`PRODUCT DETAILS`);

  if (isMeaningfulNumber(p?.grossWeight)) lines.push(`• GR WT     : ${fmtNum(p.grossWeight, " Grm")}  (${purityTag})`);
  else lines.push(`• PURITY    : ${purityTag}`);

  // Diamond weights in Cent
  if (isMeaningfulNumber(p?.diamondWRegular)) lines.push(`• DIA (R)   : ${fmtNum(p.diamondWRegular, " Cent")}`);
  if (isMeaningfulNumber(p?.diamondWSolitaire)) lines.push(`• DIA (S)   : ${fmtNum(p.diamondWSolitaire, " Cent")}`);

  // Color / Clarity
  if (isMeaningfulText(p?.diamondColor)) lines.push(`• COLOR     : ${p.diamondColor}`);
  if (isMeaningfulText(p?.diamondClarity)) lines.push(`• CLARITY   : ${p.diamondClarity}`);

  // Color stone (Grm)
  if (isMeaningfulNumber(p?.colorStone)) lines.push(`• CL STONE  : ${fmtNum(p.colorStone, " Grm")}`);

  // Prices
  const hasReg = isMeaningfulNumber(p?.regularPrice);
  const hasDis = isMeaningfulNumber(p?.discountPrice);

  if (hasReg || hasDis) {
    lines.push(`━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`PRICE DETAILS`);
  }

  if (hasReg) lines.push(`▶ REGULAR   : ${fmtMoney(p.regularPrice)} Tk`);
  if (hasDis) lines.push(`▶ DISCOUNT  : ${fmtMoney(p.discountPrice)} Tk`);

  const fp = finalPrice(p);
  const vatP = calcVatPrice(fp);
  if (vatP !== null) lines.push(`▶ VAT সহ মূল্য : ${Math.round(vatP)} Tk`);

  // Footer notes (VAT note removed, replaced with your 3 lines)
  lines.push(`━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`✓ আন্তর্জাতিক ল্যাব টেস্ট সার্টিফিকেটসহ`);
  lines.push(`✓ সারাদেশে কুরিয়ার এর মাধ্যমে ক্যাশ অন ডেলিভারি (COD) (শর্ত প্রযোজ্য)`);
  lines.push(`✓ অর্ডার/ডিটেইলস: ইনবক্স করুন বা WhatsApp/Call — 01601623457`);
  lines.push(`━━━━━━━━━━━━━━━━━━━━`);

  return lines.join("\n");
}

/* =========================================================
   Dashboard Results (search/filter + pagination)
   ========================================================= */
function listRowHtml(p) {
  const fp = finalPrice(p);
  return `
    <tr>
      <td><b>${naText(p.code)}</b></td>
      <td>${stockBadgeHtml(p.quantity)}</td>
      <td><b>৳${naNum(fp)}</b></td>
      <td>${naText(p.category)}</td>
      <td>
        <div class="rightBtns">
          <button class="btn small" data-details="${p.code}">Details</button>
          <button class="btn small primary" data-copy="${p.code}">Copy</button>
        </div>
      </td>
    </tr>
  `;
}

function bindRowActions(containerEl) {
  containerEl.querySelectorAll("[data-details]").forEach(btn => {
    btn.onclick = async () => {
      const code = btn.getAttribute("data-details");
      const prod = await window.api.getProduct(code);
      if (!prod) return toast("Not found");
      await showDetailsPopup(prod);
    };
  });

  containerEl.querySelectorAll("[data-copy]").forEach(btn => {
    btn.onclick = async () => {
      const code = btn.getAttribute("data-copy");
      const prod = await window.api.getProduct(code);
      if (!prod) return toast("Not found");
      await copyTextToClipboard(formatReply(prod));
    };
  });
}

function renderResults(rows, total) {
  resultState.total = total || 0;

  const totalPages = Math.max(1, Math.ceil(resultState.total / RESULT_PAGE_SIZE));
  $("resultPagerText").textContent = `Page ${resultState.page} / ${totalPages}`;
  $("btnResultPrev").disabled = resultState.page <= 1;
  $("btnResultNext").disabled = resultState.page >= totalPages;

  $("resultListMeta").textContent = `${resultState.total} items`;

  const body = $("resultListBody");
  body.innerHTML = (rows || []).map(listRowHtml).join("");
  bindRowActions(body);
}

async function loadResultsPage(page = 1) {
  resultState.page = page;
  const offset = (page - 1) * RESULT_PAGE_SIZE;

  let res = { total: 0, rows: [] };
  if (resultState.mode === "prefix") {
    res = await window.api.searchProductsPrefix(resultState.prefix, RESULT_PAGE_SIZE, offset);
  } else if (resultState.mode === "filter") {
    res = await window.api.searchProductsFilter(resultState.filters, RESULT_PAGE_SIZE, offset);
  } else {
    res = { total: 0, rows: [] };
  }

  renderResults(res.rows || [], res.total || 0);
}

function buildFiltersFromUI() {
  const cat = ($("filterCategory").value || "").trim();
  const price = toNumberOrNull($("filterPrice").value);

  let minPrice = null;
  let maxPrice = null;
  if (price !== null) {
    minPrice = Math.max(0, price - 5000);
    maxPrice = price + 5000;
  }

  return {
    category: cat ? cat : null,
    minPrice,
    maxPrice,
    stock: "all",
    lowStock: false,
    sort: "latest"
  };
}

function resetFilterUI() {
  $("filterCategory").value = "";
  $("filterPrice").value = "";
  $("priceHint").textContent = "20000 দিলে 15000–25000 দেখাবে";
}

async function applySimpleFilter() {
  resultState.mode = "filter";
  resultState.filters = buildFiltersFromUI();

  const p = toNumberOrNull($("filterPrice").value);
  if (p !== null) {
    const a = Math.max(0, p - 5000);
    const b = p + 5000;
    $("priceHint").textContent = `${p} দিলে ${a}–${b} দেখাবে`;
  } else {
    $("priceHint").textContent = "Price না দিলে শুধু Category অনুযায়ী দেখাবে";
  }

  await loadResultsPage(1);
  toast("✅ Filter applied");
}

async function searchProduct() {
  const raw = $("searchBox").value.trim();
  if (!raw) return applySimpleFilter();

  const prefix = basePrefix(raw);
  resultState.mode = "prefix";
  resultState.prefix = prefix;
  await loadResultsPage(1);
  toast("✅ Showing results");
}

/* =========================================================
   Add/Edit Product Form
   ========================================================= */
function resetForm() {
  currentEditCode = null;
  $("modalTitle").textContent = "Add / Update Product";
  $("btnDeleteProduct").style.display = "none";

  $("fCategory").value = CATEGORIES[0]?.name || "";
  $("fCode").value = "";
  $("fQuantity").value = "";

  $("fGrossWeight").value = "";
  $("fDiamondWRegular").value = "";
  $("fDiamondWSolitaire").value = "";
  $("fColorStone").value = "";

  $("fDiamondColor").value = "";
  $("fDiamondClarity").value = "";

  $("fRegularPrice").value = "";
  $("fDiscountPrice").value = "";
  $("fNote").value = "";

  selectedImagePath = null;
  $("imgName").textContent = "No file";
  $("imgPreview").style.display = "none";
  $("imgPreviewText").style.display = "block";
  $("imgPreviewText").textContent = "No preview";
}

async function pickImage() {
  const filePath = await window.api.pickImage();
  if (!filePath) return;

  selectedImagePath = filePath;
  $("imgName").textContent = filePath.split("\\").pop();

  // ✅ cache-buster
  $("imgPreview").src = fileUrl(filePath);
  $("imgPreview").style.display = "block";
  $("imgPreviewText").style.display = "none";
}

function openEdit(p) {
  currentEditCode = p.code;
  $("modalTitle").textContent = `Edit Product (${p.code})`;
  $("btnDeleteProduct").style.display = "inline-block";

  $("fCategory").value = p.category || (CATEGORIES[0]?.name || "");
  $("fCode").value = p.code || "";
  $("fQuantity").value = (p.quantity ?? "");

  $("fGrossWeight").value = (p.grossWeight ?? "");
  $("fDiamondWRegular").value = (p.diamondWRegular ?? "");
  $("fDiamondWSolitaire").value = (p.diamondWSolitaire ?? "");
  $("fColorStone").value = (p.colorStone ?? "");

  $("fDiamondColor").value = (p.diamondColor ?? "");
  $("fDiamondClarity").value = (p.diamondClarity ?? "");

  $("fRegularPrice").value = (p.regularPrice ?? "");
  $("fDiscountPrice").value = (p.discountPrice ?? "");

  selectedImagePath = null;
  $("imgName").textContent = "Select new image (optional)";
  $("imgPreview").style.display = "none";
  $("imgPreviewText").style.display = "block";
  $("imgPreviewText").textContent = "No preview";

  openModal();
}

async function saveProduct() {
  const selectedCat = ($("fCategory").value || "").trim();
  const codeRaw = $("fCode").value.trim();
  if (!codeRaw) return toast("Product Code বাধ্যতামূলক");

  // ✅ normalize (capital/small problem solved)
  const code = normalizeCode(codeRaw);

  const autoCat = detectCategoryFromCode(code);
  const finalCat = autoCat || selectedCat || CATEGORIES[0]?.name;

  const payload = {
    code,
    category: finalCat,

    grossWeight: toNumberOrNull($("fGrossWeight").value),
    diamondWRegular: toNumberOrNull($("fDiamondWRegular").value),
    diamondWSolitaire: toNumberOrNull($("fDiamondWSolitaire").value),
    colorStone: toNumberOrNull($("fColorStone").value),

    diamondColor: toTextOrNull($("fDiamondColor").value),
    diamondClarity: toTextOrNull($("fDiamondClarity").value),

    regularPrice: toNumberOrNull($("fRegularPrice").value),
    discountPrice: toNumberOrNull($("fDiscountPrice").value),

    quantity: toNumberOrNull($("fQuantity").value),

    // new image (optional)
    imageSrcPath: selectedImagePath || null
  };

  const res = await window.api.saveProduct(payload);
  if (!res?.success) return toast("❌ " + (res?.error || "Save failed"));

  toast("✅ Saved");
  closeModal();
  resetForm();

  // go to category page and highlight
  await openCategoryPage(finalCat, { highlightCode: code });
}

/* =========================================================
   Soft Delete + Undo
   ========================================================= */
async function deleteByCode(code) {
  const ok = confirm(`Delete product ${code}?`);
  if (!ok) return;

  const res = await window.api.deleteProduct(code);
  if (!res?.success) return toast("❌ " + (res?.error || "Delete failed"));

  closeDetailsModal();
  closeModal();
  resetForm();

  const catToReload = currentCategoryView;
  if (catToReload) await openCategoryPage(catToReload);

  if (resultState.mode !== "none") await loadResultsPage(resultState.page);

  toastAction("🗑 Deleted", "Undo", async () => {
    await window.api.restoreProduct(code);
    toast("✅ Restored");
    if (catToReload) await openCategoryPage(catToReload, { highlightCode: code });
    if (resultState.mode !== "none") await loadResultsPage(resultState.page);
  }, 10000);
}

/* =========================================================
   Details Modal (with Image Preview + Change Image)
   ========================================================= */
function renderDetailsImage(p) {
  const img = $("detailsImgPreview");
  const txt = $("detailsImgText");
  if (!img || !txt) return;

  const path = p?.imagePath;
  if (path) {
    // ✅ cache-buster
    img.src = fileUrl(path);
    img.style.display = "block";
    txt.style.display = "none";
  } else {
    img.style.display = "none";
    txt.style.display = "block";
    txt.textContent = "No image";
  }
}

async function showDetailsPopup(p) {
  currentDetailsProduct = p;

  const fp = finalPrice(p);
  $("detailsTitle").textContent = `Details: ${naText(p.code)}`;

  renderDetailsImage(p);

  $("detailsKv").innerHTML = `
    <div>Category</div><div>${naText(p.category)}</div>
    <div>GR WT</div><div>${naNum(p.grossWeight)} g</div>
    <div>Dia WT (R)</div><div>${naNum(p.diamondWRegular)} ct</div>
    <div>Dia WT (S)</div><div>${naNum(p.diamondWSolitaire)} ct</div>
    <div>Color Stone WT</div><div>${naNum(p.colorStone)} g</div>
    <div>Diamond Color</div><div>${naText(p.diamondColor)}</div>
    <div>Diamond Clarity</div><div>${naText(p.diamondClarity)}</div>
    <div>Regular Price</div><div>৳${naNum(p.regularPrice)}</div>
    <div>Discount Price</div><div><b>৳${naNum(p.discountPrice)}</b></div>
    <div>Final Price</div><div><b>৳${naNum(fp)}</b></div>
    <div>VAT(5%) Price</div><div><b>৳${naNum(calcVatPrice(fp))}</b></div>
    <div>Quantity</div><div>${naNum(p.quantity)}</div>
  `;

  openDetailsModal();
}

async function detailsCopy() {
  if (!currentDetailsProduct) return;
  await copyTextToClipboard(formatReply(currentDetailsProduct));
}
function detailsEdit() {
  if (!currentDetailsProduct) return;
  closeDetailsModal();
  openEdit(currentDetailsProduct);
}
async function detailsDelete() {
  if (!currentDetailsProduct) return;
  await deleteByCode(currentDetailsProduct.code);
}

async function detailsChangeImage() {
  if (!currentDetailsProduct) return toast("No product selected");

  const picked = await window.api.pickImage();
  if (!picked) return;

  // Save only image change (we send current values + new imageSrcPath)
  const p = currentDetailsProduct;
  const payload = {
    code: normalizeCode(p.code),
    category: p.category,

    grossWeight: p.grossWeight ?? null,
    diamondWRegular: p.diamondWRegular ?? null,
    diamondWSolitaire: p.diamondWSolitaire ?? null,
    colorStone: p.colorStone ?? null,

    diamondColor: p.diamondColor ?? null,
    diamondClarity: p.diamondClarity ?? null,

    regularPrice: p.regularPrice ?? null,
    discountPrice: p.discountPrice ?? null,

    quantity: p.quantity ?? null,

    imageSrcPath: picked
  };

  const res = await window.api.saveProduct(payload);
  if (!res?.success) return toast("❌ " + (res?.error || "Image save failed"));

  toast("✅ Image Updated");

  // refresh details + category list highlight
  const fresh = await window.api.getProduct(p.code);
  if (fresh) {
    currentDetailsProduct = fresh;
    renderDetailsImage(fresh);
    // update list if category open
    if (fresh.category) await openCategoryPage(fresh.category, { highlightCode: fresh.code });
  }
}

/* =========================================================
   Category Page
   ========================================================= */
function catRowHtml(p) {
  return `
    <tr data-code="${naText(p.code)}">
      <td><b>${naText(p.code)}</b></td>
      <td>${naNum(p.grossWeight)}</td>
      <td>${naNum(p.diamondWRegular)}</td>
      <td>${naNum(p.diamondWSolitaire)}</td>
      <td>${naText(p.diamondColor)}</td>
      <td>${naText(p.diamondClarity)}</td>
      <td>৳${naNum(p.regularPrice)}</td>
      <td><b>৳${naNum(p.discountPrice)}</b></td>
      <td>${stockBadgeHtml(p.quantity)}</td>
      <td>
        <div class="rightBtns">
          <button class="btn small" data-details="${p.code}">Details</button>
          <button class="btn small primary" data-copy="${p.code}">Copy</button>
        </div>
      </td>
    </tr>
  `;
}

async function openCategoryPage(categoryName, opts = {}) {
  currentCategoryView = categoryName;
  rememberLastCategory(categoryName);

  setPage("category");
  setActiveCategoryNav(categoryName);

  $("catTitle").textContent = `Category: ${categoryName}`;
  const rows = await window.api.getProductsByCategory(categoryName);

  $("catCount").textContent = `${rows.length} items`;

  const body = $("catListBody");
  body.innerHTML = (rows || []).map(catRowHtml).join("");
  bindRowActions(body);

  if (opts.highlightCode) {
    const codeN = normalizeCode(opts.highlightCode);
    const tr = body.querySelector(`tr[data-code="${opts.highlightCode}"]`) ||
               Array.from(body.querySelectorAll("tr")).find(r => normalizeCode(r.getAttribute("data-code")) === codeN);
    if (tr) {
      tr.classList.add("flashRow");
      tr.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => tr.classList.remove("flashRow"), 1800);
    }
  }

  toast(`Opened ${categoryName}`);
}

/* =========================================================
   Price System (Category rule save + apply update)
   ========================================================= */
function defaultRule() {
  return {
    goldRate: 0,
    diaRateR: 0,
    diaRateS: 0,
    makingRate: 0,
    colorStoneRate: 0,
    inrDiv: 0.70,
    carryPct: 3,
    profitRate: 1.00,
    certCost: 0,
    discPct: 25,
    rounding: "nearest100"
  };
}

function readRuleFromUI_PriceUpdate() {
  return {
    goldRate: numOr0(toNumberOrNull($("prGoldRate").value)),
    diaRateR: numOr0(toNumberOrNull($("prDiaRateR").value)),
    diaRateS: numOr0(toNumberOrNull($("prDiaRateS").value)),
    makingRate: numOr0(toNumberOrNull($("prMakingRate").value)),
    colorStoneRate: numOr0(toNumberOrNull($("prColorStoneRate").value)),
    inrDiv: numOr0(toNumberOrNull($("prInrDiv").value)) || 0.70,
    carryPct: numOr0(toNumberOrNull($("prCarryPct").value)),
    profitRate: numOr0(toNumberOrNull($("prProfitRate").value)) || 1.0,
    certCost: numOr0(toNumberOrNull($("prCertCost").value)),
    discPct: numOr0(toNumberOrNull($("prDiscPct").value)),
    rounding: $("prRounding").value || "nearest100"
  };
}
function fillRuleToUI_PriceUpdate(rule) {
  const r = { ...defaultRule(), ...(rule || {}) };
  $("prGoldRate").value = r.goldRate || "";
  $("prDiaRateR").value = r.diaRateR || "";
  $("prDiaRateS").value = r.diaRateS || "";
  $("prMakingRate").value = r.makingRate || "";
  $("prColorStoneRate").value = r.colorStoneRate || "";
  $("prInrDiv").value = r.inrDiv ?? 0.70;
  $("prCarryPct").value = r.carryPct ?? 3;
  $("prProfitRate").value = r.profitRate ?? 1.0;
  $("prCertCost").value = r.certCost || "";
  $("prDiscPct").value = r.discPct ?? 25;
  $("prRounding").value = r.rounding || "nearest100";
}

function readRuleFromUI_PriceInput() {
  return {
    goldRate: numOr0(toNumberOrNull($("piGoldRate").value)),
    diaRateR: numOr0(toNumberOrNull($("piDiaRateR").value)),
    diaRateS: numOr0(toNumberOrNull($("piDiaRateS").value)),
    makingRate: numOr0(toNumberOrNull($("piMakingRate").value)),
    colorStoneRate: numOr0(toNumberOrNull($("piColorStoneRate").value)),
    inrDiv: numOr0(toNumberOrNull($("piInrDiv").value)) || 0.70,
    carryPct: numOr0(toNumberOrNull($("piCarryPct").value)),
    profitRate: numOr0(toNumberOrNull($("piProfitRate").value)) || 1.0,
    certCost: numOr0(toNumberOrNull($("piCertCost").value)),
    discPct: numOr0(toNumberOrNull($("piDiscPct").value)),
    rounding: $("piRounding").value || "nearest100"
  };
}
function fillRuleToUI_PriceInput(rule) {
  const r = { ...defaultRule(), ...(rule || {}) };
  $("piGoldRate").value = r.goldRate || "";
  $("piDiaRateR").value = r.diaRateR || "";
  $("piDiaRateS").value = r.diaRateS || "";
  $("piMakingRate").value = r.makingRate || "";
  $("piColorStoneRate").value = r.colorStoneRate || "";
  $("piInrDiv").value = r.inrDiv ?? 0.70;
  $("piCarryPct").value = r.carryPct ?? 3;
  $("piProfitRate").value = r.profitRate ?? 1.0;
  $("piCertCost").value = r.certCost || "";
  $("piDiscPct").value = r.discPct ?? 25;
  $("piRounding").value = r.rounding || "nearest100";
}

function setModeUI(mode) {
  const ratesSection = $("ratesSection");
  const fixedSection = $("fixedSection");

  if (mode === "fixed") {
    ratesSection.style.display = "none";
    fixedSection.style.display = "block";
    return;
  }
  if (mode === "categoryRule") {
    ratesSection.style.display = "none";
    fixedSection.style.display = "none";
    return;
  }
  ratesSection.style.display = "block";
  fixedSection.style.display = "none";
}

function setSelectedCodesWrap(showWrap) {
  $("selectedCodesWrap").style.display = showWrap ? "block" : "none";
}

function getScope() {
  if ($("scopeCategory").checked) return "category";
  if ($("scopeProduct").checked) return "product";
  if ($("scopeSelected").checked) return "selected";
  return "category";
}
function getMode() {
  if ($("modeCategoryRule").checked) return "categoryRule";
  if ($("modeSpecialRates").checked) return "specialRates";
  if ($("modeFixedPrice").checked) return "fixed";
  return "categoryRule";
}

function applyScopeUI() {
  const scope = getScope();
  setSelectedCodesWrap(scope === "selected");

  if (scope === "category") {
    $("priceModalTitle").textContent = "Price Update (Category)";
    $("priceModalSubtitle").textContent = "এই ক্যাটাগরির সব প্রোডাক্ট একসাথে আপডেট হবে";
    $("modeCategoryRule").checked = true;
  } else if (scope === "product") {
    $("priceModalTitle").textContent = "Price Update (This Product)";
    $("priceModalSubtitle").textContent = "এই একটাই প্রোডাক্টের জন্য Special Rate / Fixed Price";
    $("modeSpecialRates").checked = true;
  } else {
    $("priceModalTitle").textContent = "Price Update (Selected Products)";
    $("priceModalSubtitle").textContent = "Selected code গুলোই আপডেট হবে";
    $("modeSpecialRates").checked = true;
  }
  applyModeUI();
}
function applyModeUI() {
  const mode = getMode();
  const scope = getScope();

  setModeUI(mode);
  $("btnRemoveSpecialRule").style.display = (scope === "product") ? "inline-block" : "none";

  if (mode === "categoryRule" && scope !== "category") {
    $("modeSpecialRates").checked = true;
    setModeUI("specialRates");
  }
}

function parseCodes(raw) {
  const t = (raw || "").trim();
  if (!t) return [];
  const parts = t.split(/[,\n\r]+/).map(s => normalizeCode(s)).filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const c of parts) if (!seen.has(c)) { seen.add(c); out.push(c); }
  return out;
}

let priceCtx = { from: null, category: null, productCode: null };

async function openPriceInputFromCategory() {
  if (!currentCategoryView) return toast("Open a category first");

  let rule = defaultRule();
  try {
    const r = await window.api.getCategoryPriceRule(currentCategoryView);
    if (r) rule = { ...rule, ...r };
  } catch {}

  fillRuleToUI_PriceInput(rule);
  openPriceInputModal();
}

async function savePriceInputRule() {
  if (!currentCategoryView) return toast("Category missing");

  const rule = readRuleFromUI_PriceInput();
  if (rule.inrDiv <= 0) return toast("BDT divisor (0.70) ভুল");
  if (rule.profitRate <= 0) return toast("Profit rate ভুল");

  const res = await window.api.setCategoryPriceRule(currentCategoryView, rule);
  if (!res?.success) return toast("❌ Save failed");

  toast("✅ Rule Saved");
  closePriceInputModal();
}

async function openPriceModalFromCategory() {
  if (!currentCategoryView) return toast("Open a category first");

  priceCtx = { from: "categoryBtn", category: currentCategoryView, productCode: null };

  $("scopeCategoryName").value = currentCategoryView;
  $("scopeProductCode").value = "";
  $("scopeCategory").checked = true;
  $("scopeProduct").checked = false;
  $("scopeSelected").checked = false;

  let rule = defaultRule();
  try {
    const r = await window.api.getCategoryPriceRule(currentCategoryView);
    if (r) rule = { ...rule, ...r };
  } catch {}
  fillRuleToUI_PriceUpdate(rule);

  $("fxRegular").value = "";
  $("fxDiscount").value = "";
  $("selectedCodes").value = "";

  applyScopeUI();
  openPriceModal();
}

async function openPriceModalFromDetails() {
  if (!currentDetailsProduct) return toast("No product selected");

  closeDetailsModal();
  priceCtx = { from: "detailsBtn", category: currentDetailsProduct.category, productCode: currentDetailsProduct.code };

  $("scopeCategoryName").value = currentDetailsProduct.category || "";
  $("scopeProductCode").value = currentDetailsProduct.code || "";
  $("scopeCategory").checked = false;
  $("scopeProduct").checked = true;
  $("scopeSelected").checked = false;

  let pr = null;
  try { pr = await window.api.getProductPriceRule(currentDetailsProduct.code); } catch { pr = null; }

  if (pr?.ruleType === "fixed") {
    $("modeFixedPrice").checked = true;
    $("fxRegular").value = pr.fixedRegular ?? "";
    $("fxDiscount").value = pr.fixedDiscount ?? "";
    let rule = defaultRule();
    try {
      const r = await window.api.getCategoryPriceRule(currentDetailsProduct.category);
      if (r) rule = { ...rule, ...r };
    } catch {}
    fillRuleToUI_PriceUpdate(rule);
  } else {
    $("modeSpecialRates").checked = true;
    let rule = defaultRule();
    if (pr?.ruleType === "specialRates" && pr.rule) rule = { ...rule, ...pr.rule };
    else {
      try {
        const r = await window.api.getCategoryPriceRule(currentDetailsProduct.category);
        if (r) rule = { ...rule, ...r };
      } catch {}
    }
    fillRuleToUI_PriceUpdate(rule);

    $("fxRegular").value = "";
    $("fxDiscount").value = "";
  }

  $("selectedCodes").value = "";
  applyScopeUI();
  openPriceModal();
}

async function removeSpecialRule() {
  if (!priceCtx.productCode) return toast("No product");
  const res = await window.api.clearProductPriceRule(priceCtx.productCode);
  if (!res?.success) return toast("❌ Remove failed");

  await window.api.recalculatePrices({ scope: "codes", codes: [priceCtx.productCode] });
  toast("✅ Special rule removed");
  closePriceModal();

  if (priceCtx.category) await openCategoryPage(priceCtx.category, { highlightCode: priceCtx.productCode });
  const fresh = await window.api.getProduct(priceCtx.productCode);
  if (fresh) await showDetailsPopup(fresh);
}

async function applyPriceUpdate() {
  const scope = getScope();
  const mode = getMode();

  if (scope === "category") {
    if (!priceCtx.category && !currentCategoryView) return toast("Category missing");
    const category = priceCtx.category || currentCategoryView;

    if (mode === "categoryRule") {
      const rule = readRuleFromUI_PriceUpdate();
      const res = await window.api.setCategoryPriceRule(category, rule);
      if (!res?.success) return toast("❌ Rule save failed");
    }

    const out = await window.api.recalculatePrices({ scope: "category", category });
    toast(`✅ Updated: ${out?.updated || 0} items`);
    closePriceModal();
    await openCategoryPage(category);
    return;
  }

  if (scope === "product") {
    const code = priceCtx.productCode;
    if (!code) return toast("Product missing");

    if (mode === "fixed") {
      const fxR = toNumberOrNull($("fxRegular").value);
      const fxD = toNumberOrNull($("fxDiscount").value);
      if (fxR === null || fxD === null) return toast("Fixed price required");

      const res = await window.api.setProductPriceRule(code, {
        ruleType: "fixed",
        fixedRegular: fxR,
        fixedDiscount: fxD
      });
      if (!res?.success) return toast("❌ Save failed");
    } else {
      const rule = readRuleFromUI_PriceUpdate();
      const res = await window.api.setProductPriceRule(code, { ruleType: "specialRates", rule });
      if (!res?.success) return toast("❌ Save failed");
    }

    await window.api.recalculatePrices({ scope: "codes", codes: [code] });
    toast("✅ Updated");
    closePriceModal();

    if (priceCtx.category) await openCategoryPage(priceCtx.category, { highlightCode: code });
    const fresh = await window.api.getProduct(code);
    if (fresh) await showDetailsPopup(fresh);
    return;
  }

  if (scope === "selected") {
    const codes = parseCodes($("selectedCodes").value);
    if (codes.length === 0) return toast("Codes missing");

    const rule = readRuleFromUI_PriceUpdate();
    for (const c of codes) {
      await window.api.setProductPriceRule(c, { ruleType: "specialRates", rule });
    }
    const out = await window.api.recalculatePrices({ scope: "codes", codes });
    toast(`✅ Updated: ${out?.updated || 0} items`);
    closePriceModal();

    if (currentCategoryView) await openCategoryPage(currentCategoryView);
    return;
  }
}

/* =========================================================
   Fixed SMS Replies
   ========================================================= */
function smsRowHtml(r) {
  const heading = naText(r.title);
  const body = (r.body || "").toString();
  const preview = body.length > 90 ? body.slice(0, 90) + "…" : body;

  return `
    <tr>
      <td><b>${heading}</b></td>
      <td style="white-space:pre-wrap">${preview}</td>
      <td>
        <div class="rightBtns">
          <button class="btn small" data-sms-view="${r.id}">View</button>
          <button class="btn small primary" data-sms-copy="${r.id}">Copy</button>
          <button class="btn small" data-sms-edit="${r.id}">Edit</button>
          <button class="btn small danger" data-sms-del="${r.id}">Delete</button>
        </div>
      </td>
    </tr>
  `;
}

async function loadSmsList(query = "") {
  const res = await window.api.listSmsReplies(query);
  const rows = res?.rows || [];

  const body = $("smsListBody");
  if (rows.length === 0) {
    body.innerHTML = `<tr><td colspan="3" class="muted">No saved reply yet</td></tr>`;
    return;
  }

  body.innerHTML = rows.map(smsRowHtml).join("");

  body.querySelectorAll("[data-sms-view]").forEach(btn => {
    btn.onclick = async () => {
      const id = Number(btn.getAttribute("data-sms-view"));
      const list = (await window.api.listSmsReplies($("smsSearchBox").value || "")).rows || [];
      const r = list.find(x => Number(x.id) === id);
      if (!r) return toast("Not found");

      smsViewCurrentText = r.body || "";
      $("smsViewTitle").textContent = r.title || "SMS View";
      $("smsViewBody").textContent = r.body || "";
      openSmsViewModal();
    };
  });

  body.querySelectorAll("[data-sms-copy]").forEach(btn => {
    btn.onclick = async () => {
      const id = Number(btn.getAttribute("data-sms-copy"));
      const list = (await window.api.listSmsReplies($("smsSearchBox").value || "")).rows || [];
      const r = list.find(x => Number(x.id) === id);
      if (!r) return toast("Not found");
      await copyTextToClipboard(r.body || "");
    };
  });

  body.querySelectorAll("[data-sms-edit]").forEach(btn => {
    btn.onclick = async () => {
      const id = Number(btn.getAttribute("data-sms-edit"));
      const list = (await window.api.listSmsReplies($("smsSearchBox").value || "")).rows || [];
      const r = list.find(x => Number(x.id) === id);
      if (!r) return toast("Not found");

      smsEditId = id;
      $("smsModalTitle").textContent = "Edit SMS Reply";
      $("smsTitle").value = r.title || "";
      $("smsBody").value = r.body || "";
      $("btnSmsDelete").style.display = "inline-block";
      updateSmsCharCount();
      openSmsModal();
    };
  });

  body.querySelectorAll("[data-sms-del]").forEach(btn => {
    btn.onclick = async () => {
      const id = Number(btn.getAttribute("data-sms-del"));
      const ok = confirm("Delete this reply?");
      if (!ok) return;
      const out = await window.api.deleteSmsReply(id);
      if (!out?.success) return toast("❌ Delete failed");
      toast("🗑 Deleted");
      await loadSmsList($("smsSearchBox").value || "");
    };
  });
}

function updateSmsCharCount() {
  const n = ($("smsBody").value || "").length;
  $("smsCharCount").textContent = `${n} characters`;
}

function openSmsCreate() {
  smsEditId = null;
  $("smsModalTitle").textContent = "Create SMS Reply";
  $("smsTitle").value = "";
  $("smsBody").value = "";
  $("btnSmsDelete").style.display = "none";
  updateSmsCharCount();
  openSmsModal();
}

async function saveSmsReply() {
  const title = ($("smsTitle").value || "").trim();
  const body = ($("smsBody").value || "").trim();

  if (!title) return toast("Heading required");
  if (!body) return toast("Message required");

  if (smsEditId) {
    const out = await window.api.updateSmsReply(smsEditId, title, body);
    if (!out?.success) return toast("❌ Update failed");
    toast("✅ Updated");
  } else {
    const out = await window.api.createSmsReply(title, body);
    if (!out?.success) return toast("❌ Create failed");
    toast("✅ Saved");
  }

  closeSmsModal();
  await loadSmsList($("smsSearchBox").value || "");
}

/* =========================================================
   Events Bind
   ========================================================= */
function bindEvents() {
  // Logo
  $("btnChangeLogo").onclick = changeAppLogo;

  // Nav
  $("navDashboard").onclick = () => {
    setPage("dashboard");
    setActiveCategoryNav(null);
    currentCategoryView = null;
  };

  $("btnBackToDashboard").onclick = () => {
    setPage("dashboard");
    setActiveCategoryNav(null);
    currentCategoryView = null;
  };

  // Add Product modal
  $("btnOpenAdd").onclick = () => { resetForm(); openModal(); };
  $("btnCloseModal").onclick = closeModal;
  $("btnResetForm").onclick = resetForm;
  $("btnPickImage").onclick = pickImage;
  $("btnSaveProduct").onclick = saveProduct;

  $("btnDeleteProduct").onclick = async () => {
    const code = $("fCode").value.trim();
    if (!code) return toast("Code missing");
    await deleteByCode(code);
  };

  // Dashboard search/filter
  $("btnSearch").onclick = searchProduct;
  $("searchBox").addEventListener("keydown", (e) => {
    if (e.key === "Enter") searchProduct();
  });

  $("btnApplyFilter").onclick = applySimpleFilter;
  $("btnResetFilter").onclick = () => {
    resetFilterUI();
    resultState.mode = "none";
    resultState.total = 0;
    $("resultListBody").innerHTML = "";
    $("resultListMeta").textContent = "0 items";
  };

  $("btnResultPrev").onclick = () => loadResultsPage(Math.max(1, resultState.page - 1));
  $("btnResultNext").onclick = () => {
    const totalPages = Math.max(1, Math.ceil((resultState.total || 0) / RESULT_PAGE_SIZE));
    loadResultsPage(Math.min(totalPages, resultState.page + 1));
  };

  // Details modal
  $("btnDetailsBack").onclick = closeDetailsModal;
  $("btnDetailsCopy").onclick = detailsCopy;
  $("btnDetailsEdit").onclick = detailsEdit;
  $("btnDetailsDelete").onclick = detailsDelete;
  $("btnDetailsPriceUpdate").onclick = openPriceModalFromDetails;

  // ✅ Details image change
  $("btnDetailsChangeImage").onclick = detailsChangeImage;

  // Category page price buttons
  $("btnCatPriceInput").onclick = openPriceInputFromCategory;
  $("btnCatPriceUpdate").onclick = openPriceModalFromCategory;

  // Price Update modal
  $("btnClosePriceModal").onclick = closePriceModal;
  $("btnPriceReset").onclick = async () => {
    if (getScope() === "category" && (priceCtx.category || currentCategoryView)) {
      let rule = defaultRule();
      try {
        const r = await window.api.getCategoryPriceRule(priceCtx.category || currentCategoryView);
        if (r) rule = { ...rule, ...r };
      } catch {}
      fillRuleToUI_PriceUpdate(rule);
      $("fxRegular").value = "";
      $("fxDiscount").value = "";
      $("selectedCodes").value = "";
      toast("Reset");
      return;
    }
    fillRuleToUI_PriceUpdate(defaultRule());
    $("fxRegular").value = "";
    $("fxDiscount").value = "";
    $("selectedCodes").value = "";
    toast("Reset");
  };
  $("btnPriceApply").onclick = applyPriceUpdate;
  $("btnRemoveSpecialRule").onclick = removeSpecialRule;

  ["scopeCategory","scopeProduct","scopeSelected"].forEach(id => $(id).onchange = applyScopeUI);
  ["modeCategoryRule","modeSpecialRates","modeFixedPrice"].forEach(id => $(id).onchange = applyModeUI);

  // Price Input modal
  $("btnClosePriceInputModal").onclick = closePriceInputModal;
  $("btnPriceInputReset").onclick = () => fillRuleToUI_PriceInput(defaultRule());
  $("btnPriceInputSave").onclick = savePriceInputRule;

  // SMS
  $("btnSmsCreate").onclick = openSmsCreate;
  $("btnSmsSearch").onclick = () => loadSmsList(($("smsSearchBox").value || "").trim());
  $("smsSearchBox").addEventListener("keydown", (e) => {
    if (e.key === "Enter") loadSmsList(($("smsSearchBox").value || "").trim());
  });

  $("btnSmsClose").onclick = closeSmsModal;
  $("btnSmsReset").onclick = () => {
    $("smsTitle").value = "";
    $("smsBody").value = "";
    updateSmsCharCount();
  };
  $("btnSmsSave").onclick = saveSmsReply;

  $("smsBody").addEventListener("input", updateSmsCharCount);

  $("btnSmsDelete").onclick = async () => {
    if (!smsEditId) return;
    const ok = confirm("Delete this reply?");
    if (!ok) return;
    const out = await window.api.deleteSmsReply(smsEditId);
    if (!out?.success) return toast("❌ Delete failed");
    toast("🗑 Deleted");
    closeSmsModal();
    await loadSmsList(($("smsSearchBox").value || "").trim());
  };

  $("btnSmsViewClose").onclick = closeSmsViewModal;
  $("btnSmsViewCopy").onclick = () => copyTextToClipboard(smsViewCurrentText || "");
}

/* =========================================================
   Init
   ========================================================= */
async function init() {
  fillCategoryDropdowns();
  bindEvents();

  // initial
  setPage("dashboard");
  resetFilterUI();

  // ✅ load saved logo
  await loadAppLogo();

  // Load SMS list
  await loadSmsList("");

  // Open last category if exists
  const last = getLastCategory();
  if (last) {
    const ok = CATEGORIES.some(c => c.name === last);
    if (ok) await openCategoryPage(last);
  }
}

init().catch(err => {
  console.error(err);
  toast("❌ Renderer error (check console)");
});