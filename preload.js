const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // ---------- core ----------
  pickImage: () => ipcRenderer.invoke('pick-image'),
  saveProduct: (product) => ipcRenderer.invoke('save-product', product),
  getProduct: (code) => ipcRenderer.invoke('get-product', code),
  getProductsByCategory: (category) => ipcRenderer.invoke('get-products-by-category', category),

  // ✅ Soft delete + restore (Undo)
  deleteProduct: (code) => ipcRenderer.invoke('delete-product', code),
  restoreProduct: (code) => ipcRenderer.invoke('restore-product', code),

  // ✅ Prefix search
  searchProductsPrefix: (prefix, limit, offset) =>
    ipcRenderer.invoke('search-products-prefix', { prefix, limit, offset }),

  // ✅ Filter search
  searchProductsFilter: (filters, limit, offset) =>
    ipcRenderer.invoke('search-products-filter', { filters, limit, offset }),

  // ---------- ✅ Pricing Rules / Price Update ----------
  getCategoryPriceRule: (category) =>
    ipcRenderer.invoke('get-category-price-rule', { category }),

  setCategoryPriceRule: (category, rule) =>
    ipcRenderer.invoke('set-category-price-rule', { category, rule }),

  getProductPriceRule: (code) =>
    ipcRenderer.invoke('get-product-price-rule', { code }),

  // payload examples:
  // { ruleType:"specialRates", rule:{...} }
  // { ruleType:"fixed", fixedRegular: 95000, fixedDiscount: 89000 }
  setProductPriceRule: (code, payload) =>
    ipcRenderer.invoke('set-product-price-rule', { code, payload }),

  clearProductPriceRule: (code) =>
    ipcRenderer.invoke('clear-product-price-rule', { code }),

  // params examples:
  // { scope:"category", category:"Nosepin" }
  // { scope:"codes", codes:["N0001 A","N0002"] }
  recalculatePrices: (params) =>
    ipcRenderer.invoke('recalculate-prices', { params }),

  /* ---------- ✅ Fixed SMS Replies ---------- */
  listSmsReplies: (query = '') => ipcRenderer.invoke('list-sms-replies', { query }),
  createSmsReply: (title, body) => ipcRenderer.invoke('create-sms-reply', { title, body }),
  updateSmsReply: (id, title, body) => ipcRenderer.invoke('update-sms-reply', { id, title, body }),
  deleteSmsReply: (id) => ipcRenderer.invoke('delete-sms-reply', { id }),

  /* ---------- ✅ Logo (Option B) ---------- */
  pickLogo: () => ipcRenderer.invoke('pick-logo'),

  // copies logo into userData and saves path in settings.json
  setLogo: (srcPath) => ipcRenderer.invoke('set-logo', { srcPath }),

  // returns saved logo path (or null)
  getLogo: () => ipcRenderer.invoke('get-logo')
});