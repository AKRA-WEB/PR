const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
async function run(source = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8')) {
  const html = source.replace(/\r\n/g, '\n');
  for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) if (match[1].trim()) new vm.Script(match[1]);
  const slice = (start, end) => html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start)));
  const cache = slice('    function getCache(', '    function showNotification(');
  const loader = slice('    async function loadInitialData(', '    function renderHistoryFromServer(');
  for (const quota of [true, false]) {
    const saved = new Map(), requests = [], rendered = [], notices = [];
    let hides = 0;
    const elements = new Map();
    const ctx = {
      console: { error() {} }, PR_CACHE_TTL: 1000, appData: {}, PrPerf: null,
      prStorageKey: key => key + '::fixture',
      window: { appSession: {id:'fixture'}, AkraPR: require('../js/pr-api-client.js') },
      localStorage: { getItem: () => null, removeItem() {}, setItem(key, value) {
        if (quota) throw Object.assign(new Error('fixture quota'), { name: 'QuotaExceededError' });
        saved.set(key, JSON.parse(value));
      } },
      document: { getElementById(id) { if (!elements.has(id)) elements.set(id, { children: [], value: '', innerHTML: '' }); return elements.get(id); } },
      showDataLoading() {}, hideDataLoading() { hides++; },
      addEmptyItemRow() { rendered.push('row'); },
      renderHistoryFromServer(history) { rendered.push(history[0].prNumber); },
      showNotification(message) { notices.push(message); },
      apiCall: async action => { requests.push(action); return action === 'getPRHistory' ? { success: true, history: [{ prNumber: 'fixture-pr' }] } : { success: true, products: [{ name: 'fixture-product', unit: 'box' }], pendingPOs: [{ unused: true }] }; }
    };
    vm.createContext(ctx);
    new vm.Script(cache + '\n' + loader).runInContext(ctx);
    await ctx.loadInitialData();
    assert.equal(ctx.appData.products[0].name, 'fixture-product');
    assert.ok(rendered.includes('fixture-pr'));
    assert.ok(hides > 0);
    assert.equal(notices.length, 0);
    assert.deepEqual(requests, ['getProducts', 'getPRHistory']);
    if (!quota) assert.deepEqual(Object.keys(saved.get('CACHE_PR_INIT_DATA::fixture')._d), ['products']);
    ctx.renderHistoryFromServer = () => { throw new Error('fixture render failure'); };
    await ctx.loadInitialData();
    assert.equal(notices.length, 1, 'data errors are contained in the loader, not propagated as auth failures');
  }
  // Actual AuthGuard must still deny an invalid SSO response before any data reads.
  let dataReads = 0, errors = 0, shown = 0;
  const auth = { PrPerf: null, checkAppVersion: async () => true, AppVersionGuard: { start() {} }, CURRENT_VERSION: 'fixture', lucide: { createIcons() {} },
    UI: { showLoading() {}, showError() { errors++; }, showApp() { shown++; } },
    window: { self: {}, top: {}, location: { hostname: 'example.test', search: '?sso=fixture', pathname: '/' }, history: { replaceState() {} } },
    document: { title: 'fixture' }, URLSearchParams,
    APP_CONFIG: { REQUIRED_ROLES: [], API_URL: 'https://fixture.invalid', STORAGE_KEY: 'fixture' },
    localStorage: { removeItem() {}, setItem() {} },
    fetch: async () => ({ ok: true, json: async () => ({ valid: false }) }),
    loadInitialData: async () => { dataReads++; }, console: { error() {} }
  };
  auth.window.top = auth.window.self;
  vm.createContext(auth);
  new vm.Script(slice('    var AuthGuard = {', "    document.addEventListener('DOMContentLoaded'")).runInContext(auth);
  await auth.AuthGuard.init();
  assert.equal(errors, 1); assert.equal(shown, 0); assert.equal(dataReads, 0);
  return 'PASS PR quota/compact cache, independent data errors, invalid SSO denies before data';
}
module.exports = { run };
if (require.main === module) run().then(console.log).catch(error => { console.error(error); process.exitCode = 1; });
