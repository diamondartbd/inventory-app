// db.js
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

function isElectron() {
  return !!(process && process.versions && process.versions.electron);
}

function getElectronApp() {
  try {
    const { app } = require('electron');
    return app;
  } catch {
    return null;
  }
}

function ensureDir(p) {
  try { fs.mkdirSync(p, { recursive: true }); } catch {}
}

function fileExists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function copyFileSafe(src, dest) {
  try {
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
    return true;
  } catch {
    return false;
  }
}

function resolveDbPath() {
  // ✅ Packaged app এ __dirname = app.asar এর ভিতর → writable না
  // তাই userData folder এ DB রাখবো
  if (isElectron()) {
    const app = getElectronApp();
    if (app && typeof app.getPath === 'function') {
      const userData = app.getPath('userData');
      ensureDir(userData);
      return path.join(userData, 'products.db');
    }
  }

  // Fallback (non-electron or very early init)
  return path.join(__dirname, 'products.db');
}

const DB_PATH = resolveDbPath();

// ✅ First-run: যদি userData এ DB না থাকে, bundled products.db থেকে copy করার চেষ্টা
(function ensureDbSeeded() {
  try {
    if (fileExists(DB_PATH)) return;

    if (!isElectron()) return;

    const app = getElectronApp();
    const candidates = [];

    // 1) app.getAppPath() সাধারণত ...\resources\app.asar
    if (app && typeof app.getAppPath === 'function') {
      candidates.push(path.join(app.getAppPath(), 'products.db'));
    }

    // 2) resourcesPath এর পাশে কখনও extraResources দিলে এখানে থাকতে পারে
    if (process && process.resourcesPath) {
      candidates.push(path.join(process.resourcesPath, 'products.db'));
    }

    // 3) Dev mode fallback
    candidates.push(path.join(__dirname, 'products.db'));

    const src = candidates.find(p => fileExists(p));
    if (src) {
      copyFileSafe(src, DB_PATH);
    }
  } catch {
    // ignore
  }
})();

const db = new Database(DB_PATH);

/* =========================
   Schema + Migrations
   ========================= */

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE,
    category TEXT,

    grossWeight REAL,
    diamondWRegular REAL,
    diamondWSolitaire REAL,
    colorStone REAL,

    diamondColor TEXT,
    diamondClarity TEXT,

    regularPrice REAL,
    discountPrice REAL,
    quantity INTEGER,

    imagePath TEXT,
    lastUpdated INTEGER
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS category_price_rules (
    category TEXT PRIMARY KEY,
    ruleJson TEXT,
    updatedAt INTEGER
  );
`);

// ✅ Fixed SMS Replies table
db.exec(`
  CREATE TABLE IF NOT EXISTS sms_replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    updatedAt INTEGER
  );
`);

function hasColumn(table, col) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some(r => r.name === col);
}

function addColumnIfMissing(table, colDefSql) {
  const colName = colDefSql.trim().split(/\s+/)[0];
  if (!hasColumn(table, colName)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${colDefSql};`);
  }
}

// ✅ Product-level special/fixed pricing
addColumnIfMissing('products', `priceRuleType TEXT DEFAULT 'none'`);
addColumnIfMissing('products', `priceRuleJson TEXT`);
addColumnIfMissing('products', `fixedRegular REAL`);
addColumnIfMissing('products', `fixedDiscount REAL`);

// ✅ Soft delete support (Undo)
addColumnIfMissing('products', `deletedAt INTEGER`);

/* =========================
   Core CRUD (Soft-delete safe)
   ========================= */

function upsertProduct(p) {
  return db.prepare(`
    INSERT INTO products (
      code, category,
      grossWeight, diamondWRegular, diamondWSolitaire, colorStone,
      diamondColor, diamondClarity,
      regularPrice, discountPrice, quantity,
      imagePath, lastUpdated,
      priceRuleType, priceRuleJson, fixedRegular, fixedDiscount,
      deletedAt
    ) VALUES (
      @code, @category,
      @grossWeight, @diamondWRegular, @diamondWSolitaire, @colorStone,
      @diamondColor, @diamondClarity,
      @regularPrice, @discountPrice, @quantity,
      @imagePath, @lastUpdated,
      @priceRuleType, @priceRuleJson, @fixedRegular, @fixedDiscount,
      NULL
    )
    ON CONFLICT(code) DO UPDATE SET
      category=excluded.category,
      grossWeight=excluded.grossWeight,
      diamondWRegular=excluded.diamondWRegular,
      diamondWSolitaire=excluded.diamondWSolitaire,
      colorStone=excluded.colorStone,
      diamondColor=excluded.diamondColor,
      diamondClarity=excluded.diamondClarity,
      regularPrice=excluded.regularPrice,
      discountPrice=excluded.discountPrice,
      quantity=excluded.quantity,
      imagePath=COALESCE(excluded.imagePath, products.imagePath),
      lastUpdated=excluded.lastUpdated,

      priceRuleType=COALESCE(excluded.priceRuleType, products.priceRuleType),
      priceRuleJson=COALESCE(excluded.priceRuleJson, products.priceRuleJson),
      fixedRegular=COALESCE(excluded.fixedRegular, products.fixedRegular),
      fixedDiscount=COALESCE(excluded.fixedDiscount, products.fixedDiscount),

      deletedAt=NULL
  `).run({
    ...p,
    priceRuleType: p.priceRuleType ?? null,
    priceRuleJson: p.priceRuleJson ?? null,
    fixedRegular: p.fixedRegular ?? null,
    fixedDiscount: p.fixedDiscount ?? null
  });
}

function getProductByCode(code) {
  return db.prepare(`
    SELECT *
    FROM products
    WHERE UPPER(code)=UPPER(?)
      AND deletedAt IS NULL
  `).get(code);
}

function getProductsByCategory(category) {
  return db.prepare(`
    SELECT *
    FROM products
    WHERE category=?
      AND deletedAt IS NULL
    ORDER BY lastUpdated DESC
  `).all(category);
}

// ✅ Hard delete (kept for compatibility)
function deleteProduct(code) {
  return db.prepare(`DELETE FROM products WHERE UPPER(code)=UPPER(?)`).run(code);
}

// ✅ Soft delete (used for Undo feature)
function softDeleteProduct(code) {
  return db.prepare(`
    UPDATE products
    SET deletedAt=@deletedAt
    WHERE UPPER(code)=UPPER(@code)
  `).run({ code, deletedAt: Date.now() });
}

function restoreProduct(code) {
  return db.prepare(`
    UPDATE products
    SET deletedAt=NULL
    WHERE UPPER(code)=UPPER(?)
  `).run(code);
}

function searchProductsByPrefix(prefix, limit = 10, offset = 0) {
  const like = `${(prefix || '').trim()}%`;

  const totalRow = db.prepare(`
    SELECT COUNT(*) AS cnt
    FROM products
    WHERE UPPER(code) LIKE UPPER(?)
      AND deletedAt IS NULL
  `).get(like);

  const rows = db.prepare(`
    SELECT *
    FROM products
    WHERE UPPER(code) LIKE UPPER(?)
      AND deletedAt IS NULL
    ORDER BY code COLLATE NOCASE ASC
    LIMIT ? OFFSET ?
  `).all(like, limit, offset);

  return { total: totalRow?.cnt || 0, rows };
}

function searchProductsWithFilters(filters = {}, limit = 10, offset = 0) {
  const where = [`deletedAt IS NULL`];
  const params = {};

  if (filters.category) {
    where.push(`category = @category`);
    params.category = filters.category;
  }

  if (filters.minPrice !== null && filters.minPrice !== undefined) {
    where.push(`COALESCE(discountPrice, regularPrice) >= @minPrice`);
    params.minPrice = Number(filters.minPrice);
  }

  if (filters.maxPrice !== null && filters.maxPrice !== undefined) {
    where.push(`COALESCE(discountPrice, regularPrice) <= @maxPrice`);
    params.maxPrice = Number(filters.maxPrice);
  }

  const whereSql = `WHERE ${where.join(" AND ")}`;

  const totalRow = db.prepare(`
    SELECT COUNT(*) AS cnt
    FROM products
    ${whereSql}
  `).get(params);

  const rows = db.prepare(`
    SELECT *
    FROM products
    ${whereSql}
    ORDER BY lastUpdated DESC
    LIMIT @limit OFFSET @offset
  `).all({ ...params, limit: Number(limit), offset: Number(offset) });

  return { total: totalRow?.cnt || 0, rows };
}

/* =========================
   Pricing Rules: Category
   ========================= */

function getCategoryPriceRule(category) {
  const row = db.prepare(`SELECT ruleJson FROM category_price_rules WHERE category=?`).get(category);
  if (!row?.ruleJson) return null;
  try { return JSON.parse(row.ruleJson); } catch { return null; }
}

function setCategoryPriceRule(category, ruleObj) {
  const ruleJson = JSON.stringify(ruleObj || {});
  const updatedAt = Date.now();

  db.prepare(`
    INSERT INTO category_price_rules (category, ruleJson, updatedAt)
    VALUES (@category, @ruleJson, @updatedAt)
    ON CONFLICT(category) DO UPDATE SET
      ruleJson=excluded.ruleJson,
      updatedAt=excluded.updatedAt
  `).run({ category, ruleJson, updatedAt });

  return { success: true };
}

/* =========================
   Pricing Rules: Product
   ========================= */

function getProductPriceRule(code) {
  const row = db.prepare(`
    SELECT priceRuleType, priceRuleJson, fixedRegular, fixedDiscount
    FROM products
    WHERE UPPER(code)=UPPER(?)
      AND deletedAt IS NULL
  `).get(code);

  if (!row) return null;

  let rule = null;
  if (row.priceRuleJson) {
    try { rule = JSON.parse(row.priceRuleJson); } catch { rule = null; }
  }

  return {
    ruleType: row.priceRuleType || 'none',
    rule,
    fixedRegular: row.fixedRegular ?? null,
    fixedDiscount: row.fixedDiscount ?? null
  };
}

function setProductPriceRule(code, payload) {
  const type = payload?.ruleType;

  if (type === 'specialRates') {
    const ruleJson = JSON.stringify(payload.rule || {});
    db.prepare(`
      UPDATE products
      SET priceRuleType='specialRates',
          priceRuleJson=@ruleJson,
          fixedRegular=NULL,
          fixedDiscount=NULL,
          lastUpdated=@lastUpdated
      WHERE UPPER(code)=UPPER(@code)
        AND deletedAt IS NULL
    `).run({ code, ruleJson, lastUpdated: Date.now() });
    return { success: true };
  }

  if (type === 'fixed') {
    const fixedRegular = Number(payload.fixedRegular);
    const fixedDiscount = Number(payload.fixedDiscount);
    db.prepare(`
      UPDATE products
      SET priceRuleType='fixed',
          priceRuleJson=NULL,
          fixedRegular=@fixedRegular,
          fixedDiscount=@fixedDiscount,
          regularPrice=@fixedRegular,
          discountPrice=@fixedDiscount,
          lastUpdated=@lastUpdated
      WHERE UPPER(code)=UPPER(@code)
        AND deletedAt IS NULL
    `).run({ code, fixedRegular, fixedDiscount, lastUpdated: Date.now() });
    return { success: true };
  }

  return { success: false, error: 'Invalid ruleType' };
}

function clearProductPriceRule(code) {
  db.prepare(`
    UPDATE products
    SET priceRuleType='none',
        priceRuleJson=NULL,
        fixedRegular=NULL,
        fixedDiscount=NULL,
        lastUpdated=@lastUpdated
    WHERE UPPER(code)=UPPER(@code)
      AND deletedAt IS NULL
  `).run({ code, lastUpdated: Date.now() });

  return { success: true };
}

/* =========================
   Price Calculation
   ========================= */

function defaultRule() {
  return {
    goldRate: 0,
    diaRateR: 0,
    diaRateS: 0,
    makingRate: 0,

    // ✅ Color stone rate (INR / gram)
    colorStoneRate: 0,

    inrDiv: 0.70,
    carryPct: 3,
    profitRate: 1.00,
    certCost: 0,
    discPct: 25,
    rounding: "nearest100"
  };
}

function numOr0(v) {
  const n = Number(v);
  return Number.isNaN(n) || v === null || v === undefined ? 0 : n;
}

function roundNearest100_50Rule(n) {
  const x = Number(n);
  if (Number.isNaN(x)) return 0;
  const r = ((x % 100) + 100) % 100;
  const base = x - r;
  return (r >= 50) ? (base + 100) : base;
}

/**
  1) Gold INR = (Gross - CL) * GoldRate
  2) Dia INR = (DiaR * RateR) + (DiaS * RateS)
  3) Making INR = Gross * MakingRate
  4) Color Stone INR = CL * colorStoneRate
  5) TotalINR = Gold + Dia + Making + ColorStone
  6) BDT = TotalINR / inrDiv
  7) Carry = BDT * carryPct%
  8) Purchase = BDT + Carry
  9) Regular = (Purchase * profitRate) + certCost
  10) Discount = Regular * (1 - discPct%)
  11) Rounding nearest 100 (50 rule) if rounding=nearest100
**/
function calcByRuleForProduct(productRow, ruleObj) {
  const r = { ...defaultRule(), ...(ruleObj || {}) };

  const gross = numOr0(productRow.grossWeight);
  const cl = numOr0(productRow.colorStone);
  const diaR = numOr0(productRow.diamondWRegular);
  const diaS = numOr0(productRow.diamondWSolitaire);

  const netGold = Math.max(0, gross - cl);

  const goldINR = netGold * numOr0(r.goldRate);
  const diaINR = (diaR * numOr0(r.diaRateR)) + (diaS * numOr0(r.diaRateS));
  const makingINR = gross * numOr0(r.makingRate);
  const colorStoneINR = cl * numOr0(r.colorStoneRate);

  const totalINR = goldINR + diaINR + makingINR + colorStoneINR;

  const inrDiv = numOr0(r.inrDiv) || 0.70;
  const bdt = totalINR / inrDiv;

  const carry = bdt * (numOr0(r.carryPct) / 100);
  const purchase = bdt + carry;

  const profit = numOr0(r.profitRate) || 1.0;
  let regular = (purchase * profit) + numOr0(r.certCost);

  const discPct = numOr0(r.discPct);
  let discount = regular * (1 - (discPct / 100));

  if ((r.rounding || "nearest100") === "nearest100") {
    regular = roundNearest100_50Rule(regular);
    discount = roundNearest100_50Rule(discount);
  }

  regular = Math.max(0, Math.round(regular));
  discount = Math.max(0, Math.round(discount));

  return { regular, discount };
}

/* =========================
   Bulk Recalculate (Soft-delete safe)
   ========================= */

function recalculatePrices(params = {}) {
  const scope = params.scope;

  let rows = [];
  if (scope === "category") {
    rows = db.prepare(`
      SELECT * FROM products
      WHERE category=?
        AND deletedAt IS NULL
    `).all(params.category);
  } else if (scope === "codes") {
    const codes = Array.isArray(params.codes) ? params.codes : [];
    if (codes.length === 0) return { updated: 0 };
    const stmt = db.prepare(`
      SELECT * FROM products
      WHERE UPPER(code)=UPPER(?)
        AND deletedAt IS NULL
    `);
    rows = codes.map(c => stmt.get(c)).filter(Boolean);
  } else {
    return { updated: 0 };
  }

  const catRuleCache = new Map();
  function getCatRule(cat) {
    if (!cat) return null;
    if (catRuleCache.has(cat)) return catRuleCache.get(cat);
    const r = getCategoryPriceRule(cat);
    catRuleCache.set(cat, r);
    return r;
  }

  const updateStmt = db.prepare(`
    UPDATE products
    SET regularPrice=@regularPrice,
        discountPrice=@discountPrice,
        lastUpdated=@lastUpdated
    WHERE id=@id
      AND deletedAt IS NULL
  `);

  let updated = 0;
  const now = Date.now();

  const tx = db.transaction(() => {
    for (const p of rows) {
      if (!p) continue;

      // 1) Fixed
      if ((p.priceRuleType || 'none') === 'fixed' && p.fixedRegular != null && p.fixedDiscount != null) {
        updateStmt.run({
          id: p.id,
          regularPrice: Math.round(Number(p.fixedRegular)),
          discountPrice: Math.round(Number(p.fixedDiscount)),
          lastUpdated: now
        });
        updated++;
        continue;
      }

      // 2) Special Rates
      if ((p.priceRuleType || 'none') === 'specialRates' && p.priceRuleJson) {
        let pr = null;
        try { pr = JSON.parse(p.priceRuleJson); } catch { pr = null; }
        if (pr) {
          const out = calcByRuleForProduct(p, pr);
          updateStmt.run({ id: p.id, regularPrice: out.regular, discountPrice: out.discount, lastUpdated: now });
          updated++;
          continue;
        }
      }

      // 3) Category Rule
      const cr = getCatRule(p.category);
      if (cr) {
        const out = calcByRuleForProduct(p, cr);
        updateStmt.run({ id: p.id, regularPrice: out.regular, discountPrice: out.discount, lastUpdated: now });
        updated++;
        continue;
      }
    }
  });

  tx();
  return { updated };
}

/* =========================
   Fixed SMS Replies (CRUD + Search)
   ========================= */

function listSmsReplies(query = '') {
  const q = (query || '').toString().trim();
  if (!q) {
    return db.prepare(`
      SELECT * FROM sms_replies
      ORDER BY updatedAt DESC, id DESC
    `).all();
  }

  const like = `%${q}%`;
  return db.prepare(`
    SELECT * FROM sms_replies
    WHERE title LIKE @like COLLATE NOCASE
       OR body  LIKE @like COLLATE NOCASE
    ORDER BY updatedAt DESC, id DESC
  `).all({ like });
}

function createSmsReply(title, body) {
  const now = Date.now();
  const info = db.prepare(`
    INSERT INTO sms_replies (title, body, updatedAt)
    VALUES (@title, @body, @updatedAt)
  `).run({ title, body, updatedAt: now });
  return { success: true, id: info.lastInsertRowid };
}

function updateSmsReply(id, title, body) {
  const now = Date.now();
  db.prepare(`
    UPDATE sms_replies
    SET title=@title, body=@body, updatedAt=@updatedAt
    WHERE id=@id
  `).run({ id, title, body, updatedAt: now });
  return { success: true };
}

function deleteSmsReply(id) {
  db.prepare(`DELETE FROM sms_replies WHERE id=?`).run(id);
  return { success: true };
}

/* =========================
   Exports
   ========================= */

module.exports = {
  // products
  upsertProduct,
  getProductByCode,
  getProductsByCategory,
  deleteProduct,        // hard delete (compat)
  softDeleteProduct,    // ✅ new
  restoreProduct,       // ✅ new
  searchProductsByPrefix,
  searchProductsWithFilters,

  // category rule
  getCategoryPriceRule,
  setCategoryPriceRule,

  // product rule
  getProductPriceRule,
  setProductPriceRule,
  clearProductPriceRule,

  // recalc
  recalculatePrices,

  // sms
  listSmsReplies,
  createSmsReply,
  updateSmsReply,
  deleteSmsReply
};