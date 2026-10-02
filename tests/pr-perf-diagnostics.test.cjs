const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8').replace(/\r\n/g, '\n');
function slice(start, end) {
  const from = html.indexOf(start), to = html.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `missing source boundary ${start}`);
  return html.slice(from, to);
}
const helper = slice('    var PrPerf = (function () {', '    async function checkAppVersion(');
const loader = slice('    async function loadInitialData(', '    function renderHistoryFromServer(');
const auth = slice('    var AuthGuard = {', "    document.addEventListener('DOMContentLoaded'");

function fixture({ search = '?akra_perf=1', productsCache = false, historyCache = false, permitted = true, editable = true, preview = false } = {}) {
  let now = 75, clockReads = 0, storageCalls = 0, restoreCalls = 0;
  let invalidateSession;
  const requests = [], rendered = [], pending = new Map(), nodes = new Map();
  function element(hidden = false) {
    const classes = new Set(hidden ? ['hidden'] : []);
    return { children: [], value: '', disabled: false, innerHTML: '',
      classList: { contains: name => classes.has(name), add: name => classes.add(name), remove: name => classes.delete(name) },
      setAttribute() {} };
  }
  nodes.set('app-content', element(true)); nodes.set('data-loader', element(true));
  nodes.set('pr-items-container', element()); nodes.set('pr-warehouse', element()); nodes.set('pr-history-container', element());
  const context = {
    CURRENT_VERSION: 'fixture-version', URLSearchParams, TextEncoder,
    console: { error() {} }, appData: { products: [] }, PR_CACHE_TTL: 1000, prSessionToken: '',
    window: { location: { search }, performance: { now: () => { clockReads++; return now; } },
      AkraModule: { embedded: true, isLocalPreview: () => preview, verifySession: async () => ({ id: 'private-actor', name: 'private-name', identityId: 'private-identity' }), watchSession: options => { invalidateSession = options.invalidated; } },
      AkraPR: { can: (_user, action) => action === 'viewPR' ? permitted : editable } },
    document: {
      body: { appendChild: node => nodes.set(node.id, node) }, createElement: () => element(),
      getElementById: id => nodes.get(id) || null,
      querySelector: selector => selector === '#pr-items-container .p-product-input:not(:disabled)' && nodes.get('pr-items-container').children.length && editable ? { disabled: false } : null,
      querySelectorAll: () => [],
    },
    getCache: key => {
      storageCalls++;
      if (key === 'CACHE_PR_INIT_DATA' && productsCache) return { products: [{ name: 'private-cached-product' }] };
      if (key === 'CACHE_PR_HIST_DATA' && historyCache) return { history: [{ prNumber: 'private-cached-pr' }] };
      return key === 'pr_warehouse_pref' ? 'fixture-warehouse' : null;
    },
    setCache: () => { storageCalls++; },
    apiCall: action => { requests.push(action); return new Promise((resolve, reject) => pending.set(action, { resolve, reject })); },
    showDataLoading: () => nodes.get('data-loader').classList.remove('hidden'),
    hideDataLoading: () => nodes.get('data-loader').classList.add('hidden'),
    addEmptyItemRow: () => nodes.get('pr-items-container').children.push({ value: 'draft-preserved' }),
    renderHistoryFromServer: history => { rendered.push(history); now += 3; },
    showNotification() {}, checkAppVersion: async () => true, AppVersionGuard: { start() {} }, lucide: { createIcons() {} },
    UI: { showLoading() {}, showApp() { nodes.get('app-content').classList.remove('hidden'); }, showError() { nodes.get('app-content').classList.add('hidden'); } },
    restorePendingPR: () => { restoreCalls++; now += 7; },
  };
  vm.createContext(context);
  new vm.Script(helper + '\n' + loader + '\n' + auth).runInContext(context);
  const result = () => nodes.has('akra-perf-diagnostics') ? JSON.parse(nodes.get('akra-perf-diagnostics').textContent) : null;
  return { context, requests, rendered, pending, nodes, result, setNow: value => { now = value; },
    invalidate: () => { assert.equal(typeof invalidateSession, 'function'); invalidateSession(); },
    counts: () => ({ clockReads, storageCalls, restoreCalls }) };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
async function start(f) { const running = f.context.AuthGuard.init(); await flush(); return { running }; }
const products = { success: true, products: [{ name: 'private-product', unit: 'กล่อง' }], token: 'private-token', url: 'https://private.invalid/signed', actor: 'private-actor' };
const history = { success: true, history: [{ prNumber: 'private-pr-number' }] };

test('disabled diagnostic flags create no DOM node, clock reads, extra reads or storage operations', async () => {
  for (const search of ['', '?akra_perf=0', '?akra_perf=true']) {
    const f = fixture({ search }); const { running } = await start(f);
    assert.deepEqual(f.requests, ['getProducts', 'getPRHistory']);
    f.pending.get('getProducts').resolve(products); f.pending.get('getPRHistory').resolve(history); await running;
    assert.equal(f.result(), null); assert.equal(f.counts().clockReads, 0);
    assert.equal(f.counts().storageCalls, 5); assert.equal(f.counts().restoreCalls, 1);
  }
});

test('fresh markers reflect both actual responses, applied history and restored usable form, without private values', async () => {
  const f = fixture(); const { running } = await start(f);
  assert.deepEqual(f.requests, ['getProducts', 'getPRHistory'], 'both reads still start concurrently');
  assert.equal(f.result().scriptStartMs, 75);
  assert.deepEqual(f.result().cache, { products: 'miss', history: 'miss' });
  f.setNow(110); f.pending.get('getProducts').resolve(products); await flush();
  assert.equal(f.result().stages['api-products'].durationMs, 35);
  assert.equal(f.result().ready.freshFormProductUsableMs, null, 'S1 retains the existing history dependency');
  f.setNow(210); f.pending.get('getPRHistory').resolve(history); await running;
  const data = f.result();
  assert.equal(data.ready.freshHistorySettledMs, 213);
  assert.equal(data.ready.freshFormProductUsableMs, 220, 'form endpoint includes pending draft restoration');
  assert.equal(data.stages['draft-restore'].durationMs, 7); assert.equal(data.status, 'ready');
  assert.equal(data.mode, 'signed'); assert.equal(data.schema, 1);
  assert.equal(data.requestCount, 2); assert.equal(data.aggregates.productsRows, 1); assert.equal(data.aggregates.historyRows, 1);
  assert.equal(data.aggregates.productsJsonBytes, new TextEncoder().encode(JSON.stringify(products)).length);
  assert.doesNotMatch(JSON.stringify(data), /private-|https:|กล่อง/);
  const frozen = JSON.stringify(data);
  const refresh = f.context.loadInitialData(true);
  f.setNow(900); f.pending.get('getProducts').resolve(products); f.pending.get('getPRHistory').resolve(history); await refresh;
  assert.equal(JSON.stringify(f.result()), frozen, 'manual refresh leaves the startup snapshot frozen');
  assert.equal(f.nodes.get('pr-items-container').children.length, 1, 'existing draft rows retained');
  assert.equal(f.nodes.get('pr-warehouse').value, 'fixture-warehouse');
});

test('cache hit paint is separate from fresh settlement; mixed cache cohorts do not pretend to paint', async () => {
  for (const [productsCache, historyCache] of [[true, true], [true, false], [false, true]]) {
    const f = fixture({ productsCache, historyCache }); const { running } = await start(f);
    assert.deepEqual(f.result().cache, { products: productsCache ? 'hit' : 'miss', history: historyCache ? 'hit' : 'miss' });
    assert.equal(f.result().ready.cachedFormProductUsableMs !== null, productsCache && historyCache);
    assert.equal(f.result().ready.cachedHistoryPaintMs !== null, productsCache && historyCache);
    assert.equal(f.result().ready.freshHistorySettledMs, null);
    f.setNow(500); f.pending.get('getProducts').resolve(products); f.pending.get('getPRHistory').resolve(history); await running;
    assert.ok(f.result().ready.freshFormProductUsableMs >= 500); assert.equal(f.result().status, 'ready');
  }
});

test('failed read or denied view never invents fresh readiness; errors remain constant and sanitized', async () => {
  const f = fixture(); const { running } = await start(f);
  f.pending.get('getProducts').resolve(products);
  f.pending.get('getPRHistory').resolve({ success: false, message: 'private-record private-token' }); await running;
  assert.equal(f.result().ready.freshHistorySettledMs, null);
  assert.notEqual(f.result().ready.freshFormProductUsableMs, null);
  assert.equal(f.result().status, 'error'); assert.deepEqual(f.result().errors, ['api-history']);
  assert.doesNotMatch(JSON.stringify(f.result()), /private-/);
  const denied = fixture({ permitted: false }); await denied.context.AuthGuard.init();
  assert.equal(denied.requests.length, 0); assert.equal(denied.result().requestCount, 0);
  assert.equal(denied.result().ready.freshFormProductUsableMs, null); assert.equal(denied.result().ready.freshHistorySettledMs, null);
  assert.deepEqual(denied.result().errors, ['permission']);
});

test('rejected read, render error, invalid auth and disabled form remain excluded from usable cohorts', async () => {
  const rejected = fixture(); const { running } = await start(rejected);
  rejected.pending.get('getProducts').reject(new Error('private-token private-url'));
  rejected.pending.get('getPRHistory').resolve(history); await running;
  assert.equal(rejected.result().ready.freshFormProductUsableMs, null); assert.equal(rejected.result().ready.freshHistorySettledMs, null);
  assert.deepEqual(rejected.result().errors, ['api-products', 'data-load']);
  const rendered = fixture(); rendered.context.renderHistoryFromServer = () => { throw new Error('private-record'); };
  const renderRun = await start(rendered); rendered.pending.get('getProducts').resolve(products); rendered.pending.get('getPRHistory').resolve(history); await renderRun.running;
  assert.equal(rendered.result().ready.freshHistorySettledMs, null); assert.ok(rendered.result().errors.includes('data-load'));
  const invalid = fixture(); invalid.context.window.AkraModule.verifySession = async () => { throw new Error('private-token'); }; await invalid.context.AuthGuard.init();
  assert.equal(invalid.requests.length, 0); assert.deepEqual(invalid.result().errors, ['auth']); assert.doesNotMatch(JSON.stringify(invalid.result()), /private-/);
  const readOnly = fixture({ editable: false }); const readOnlyRun = await start(readOnly);
  readOnly.pending.get('getProducts').resolve(products); readOnly.pending.get('getPRHistory').resolve(history); await readOnlyRun.running;
  assert.equal(readOnly.result().ready.freshFormProductUsableMs, null); assert.ok(readOnly.result().errors.includes('form-unavailable'));
});

test('session invalidation clears finished diagnostics and pending reads cannot republish readiness or aggregates', async () => {
  for (const afterReady of [false, true]) {
    const f = fixture(); const { running } = await start(f);
    if (afterReady) {
      f.pending.get('getProducts').resolve(products); f.pending.get('getPRHistory').resolve(history); await running;
      assert.equal(f.result().status, 'ready'); assert.equal(f.result().aggregates.productsRows, 1);
    }
    f.invalidate();
    assert.equal(f.result().status, 'session-invalidated');
    assert.ok(Object.values(f.result().ready).every(value => value === null)); assert.deepEqual(f.result().aggregates, {});
    // Even a visible-DOM race cannot make an invalidated diagnostic snapshot usable again.
    f.nodes.get('app-content').classList.remove('hidden'); f.nodes.get('data-loader').classList.add('hidden');
    if (!afterReady) {
      f.pending.get('getProducts').resolve(products); f.pending.get('getPRHistory').resolve(history); await running;
    }
    f.context.PrPerf.mark('freshHistorySettledMs'); f.context.PrPerf.finish(); f.context.PrPerf.fail('data-load');
    assert.equal(f.result().status, 'session-invalidated');
    assert.ok(Object.values(f.result().ready).every(value => value === null)); assert.deepEqual(f.result().aggregates, {});
  }
});

test('preview data is explicitly excluded from the signed ready cohort and helper keys are bounded', async () => {
  const f = fixture({ preview: true }); const { running } = await start(f);
  f.pending.get('getProducts').resolve(products); f.pending.get('getPRHistory').resolve(history); await running;
  assert.equal(f.result().mode, 'preview'); assert.equal(f.result().status, 'preview');
  const snapshot = JSON.stringify(f.result());
  f.context.PrPerf.fail('private-token'); f.context.PrPerf.mark('private-record');
  await f.context.PrPerf.read('private-stage', async () => products, 'private-field');
  assert.equal(JSON.stringify(f.result()), snapshot);
});
