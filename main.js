// main.js
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const db = require('./db');

/* =========================================================
   Simple App Settings (logo path)
   ========================================================= */
function settingsPath() {
  // userData is per-user and safe for writable app settings
  return path.join(app.getPath('userData'), 'settings.json');
}

async function readSettings() {
  try {
    const p = settingsPath();
    if (!(await fs.pathExists(p))) return {};
    const data = await fs.readJson(p);
    return (data && typeof data === 'object') ? data : {};
  } catch {
    return {};
  }
}

async function writeSettings(next) {
  try {
    const p = settingsPath();
    await fs.ensureDir(path.dirname(p));
    await fs.writeJson(p, next || {}, { spaces: 2 });
    return true;
  } catch {
    return false;
  }
}

/* =========================================================
   App Writable Folders (userData)
   ========================================================= */
function appDataDir() {
  return app.getPath('userData');
}

function dbPathUserData() {
  // db.js এখন এই path এ db তৈরি/ব্যবহার করবে
  return path.join(appDataDir(), 'products.db');
}

function imagesDir() {
  return path.join(appDataDir(), 'images');
}

function backupsDir() {
  return path.join(appDataDir(), 'backups');
}

function pad2(n) { return String(n).padStart(2, '0'); }

async function ensureDbBackupOncePerDay() {
  // ✅ Safety: make a daily backup of products.db (non-destructive)
  // ✅ Packaged app safe: userData folder writable
  try {
    const dbPath = dbPathUserData();
    const bDir = backupsDir();
    const metaPath = path.join(bDir, 'backup.meta.json');

    await fs.ensureDir(bDir);

    const now = new Date();
    const dayKey = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;

    let meta = {};
    if (await fs.pathExists(metaPath)) {
      try { meta = await fs.readJson(metaPath); } catch { meta = {}; }
    }

    if (meta.lastBackupDay === dayKey) return; // already backed up today

    if (!(await fs.pathExists(dbPath))) {
      await fs.writeJson(metaPath, { lastBackupDay: dayKey }, { spaces: 2 });
      return;
    }

    const stamp = `${dayKey}_${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
    const dest = path.join(bDir, `products_${stamp}.db`);
    await fs.copy(dbPath, dest, { overwrite: false });

    await fs.writeJson(metaPath, { lastBackupDay: dayKey }, { spaces: 2 });
  } catch (err) {
    console.error('DB backup failed:', err);
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile('index.html');
}

app.whenReady().then(async () => {
  // ✅ Ensure writable folders exist
  try {
    await fs.ensureDir(appDataDir());
    await fs.ensureDir(imagesDir());
    await fs.ensureDir(backupsDir());
  } catch (e) {
    console.error('ensure userData dirs failed:', e);
  }

  await ensureDbBackupOncePerDay();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Pick image
ipcMain.handle('pick-image', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
  });
  if (canceled) return null;
  return filePaths[0];
});

/* =========================================================
   Logo (Option B) - Pick/Save/Get
   ========================================================= */

ipcMain.handle('pick-logo', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
  });
  if (canceled) return null;
  return filePaths[0];
});

ipcMain.handle('set-logo', async (event, payload) => {
  try {
    const srcPath = payload?.srcPath;
    if (!srcPath) return { success: false, error: 'srcPath missing' };
    if (!(await fs.pathExists(srcPath))) return { success: false, error: 'File not found' };

    const ext = path.extname(srcPath) || '.png';
    const dest = path.join(app.getPath('userData'), `app_logo${ext}`);
    await fs.copy(srcPath, dest, { overwrite: true });

    const s = await readSettings();
    s.logoPath = dest;
    await writeSettings(s);

    return { success: true, logoPath: dest };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-logo', async () => {
  try {
    const s = await readSettings();
    const p = s?.logoPath;
    if (!p) return null;
    if (!(await fs.pathExists(p))) return null;
    return p;
  } catch {
    return null;
  }
});

// Save / Update product
ipcMain.handle('save-product', async (event, product) => {
  try {
    let savedImagePath = null;

    if (product?.imageSrcPath) {
      const iDir = imagesDir();
      await fs.ensureDir(iDir);

      const ext = path.extname(product.imageSrcPath);
      const safeCode = (product.code || '').toString().trim();
      const newName = `${safeCode}${ext}`;
      const dest = path.join(iDir, newName);

      await fs.copy(product.imageSrcPath, dest, { overwrite: true });
      savedImagePath = dest;
    }

    const rec = {
      code: product.code,
      category: product.category,

      grossWeight: product.grossWeight ?? null,
      diamondWRegular: product.diamondWRegular ?? null,
      diamondWSolitaire: product.diamondWSolitaire ?? null,
      colorStone: product.colorStone ?? null,

      diamondColor: product.diamondColor ?? null,
      diamondClarity: product.diamondClarity ?? null,

      regularPrice: product.regularPrice ?? null,
      discountPrice: product.discountPrice ?? null,
      quantity: product.quantity ?? null,

      imagePath: savedImagePath,
      lastUpdated: Date.now()
    };

    db.upsertProduct(rec);

    // ✅ If product was previously soft-deleted, restore it automatically on save
    db.restoreProduct(product.code);

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-product', (event, code) => db.getProductByCode(code));
ipcMain.handle('get-products-by-category', (event, category) => db.getProductsByCategory(category));

// ✅ Soft delete by default (Undo supported)
ipcMain.handle('delete-product', (event, code) => {
  try {
    db.softDeleteProduct(code);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('restore-product', (event, code) => {
  try {
    db.restoreProduct(code);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ✅ Prefix Search + Pagination
ipcMain.handle('search-products-prefix', (event, payload) => {
  const prefix = payload?.prefix ?? '';
  const limit = Number(payload?.limit ?? 10);
  const offset = Number(payload?.offset ?? 0);
  return db.searchProductsByPrefix(prefix, limit, offset);
});

// ✅ Filter Search + Pagination
ipcMain.handle('search-products-filter', (event, payload) => {
  const filters = payload?.filters || {};
  const limit = Number(payload?.limit ?? 10);
  const offset = Number(payload?.offset ?? 0);
  return db.searchProductsWithFilters(filters, limit, offset);
});

/* =========================================================
   Pricing Rules / Price Update IPC
   ========================================================= */

ipcMain.handle('get-category-price-rule', (event, payload) => {
  try {
    const category = payload?.category ?? '';
    if (!category) return null;
    return db.getCategoryPriceRule(category);
  } catch {
    return null;
  }
});

ipcMain.handle('set-category-price-rule', (event, payload) => {
  try {
    const category = payload?.category ?? '';
    const rule = payload?.rule ?? {};
    if (!category) return { success: false, error: 'Category missing' };
    return db.setCategoryPriceRule(category, rule);
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-product-price-rule', (event, payload) => {
  try {
    const code = payload?.code ?? '';
    if (!code) return null;
    return db.getProductPriceRule(code);
  } catch {
    return null;
  }
});

ipcMain.handle('set-product-price-rule', (event, payload) => {
  try {
    const code = payload?.code ?? '';
    const data = payload?.payload ?? null;
    if (!code) return { success: false, error: 'Code missing' };
    if (!data?.ruleType) return { success: false, error: 'ruleType missing' };
    return db.setProductPriceRule(code, data);
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('clear-product-price-rule', (event, payload) => {
  try {
    const code = payload?.code ?? '';
    if (!code) return { success: false, error: 'Code missing' };
    return db.clearProductPriceRule(code);
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('recalculate-prices', (event, payload) => {
  try {
    const params = payload?.params ?? {};
    return db.recalculatePrices(params);
  } catch (err) {
    return { updated: 0, error: err.message };
  }
});

/* =========================================================
   Fixed SMS Replies (Dashboard)
   ========================================================= */

ipcMain.handle('list-sms-replies', (event, payload) => {
  try {
    const query = payload?.query ?? '';
    const rows = db.listSmsReplies(query);
    return { success: true, rows };
  } catch (err) {
    return { success: false, error: err.message, rows: [] };
  }
});

ipcMain.handle('create-sms-reply', (event, payload) => {
  try {
    const title = (payload?.title ?? '').toString().trim();
    const body = (payload?.body ?? '').toString().trim();
    if (!title) return { success: false, error: 'Title required' };
    if (!body) return { success: false, error: 'Message required' };
    return db.createSmsReply(title, body);
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('update-sms-reply', (event, payload) => {
  try {
    const id = Number(payload?.id);
    const title = (payload?.title ?? '').toString().trim();
    const body = (payload?.body ?? '').toString().trim();
    if (!Number.isFinite(id)) return { success: false, error: 'Invalid id' };
    if (!title) return { success: false, error: 'Title required' };
    if (!body) return { success: false, error: 'Message required' };
    return db.updateSmsReply(id, title, body);
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('delete-sms-reply', (event, payload) => {
  try {
    const id = Number(payload?.id);
    if (!Number.isFinite(id)) return { success: false, error: 'Invalid id' };
    return db.deleteSmsReply(id);
  } catch (err) {
    return { success: false, error: err.message };
  }
});