const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const AkraPR = require('../js/pr-api-client.js');

// This fixture executes the actual inline runtime and transport with isolated reads.
// Its small DOM records form/state behavior; layout is checked in a real browser.
function element(tag = 'div') {
    const node = { tagName: tag.toUpperCase(), children: [], parentNode: null, value: '', hidden: false, disabled: false, textContent: '', innerText: '', attributes: {}, listeners: {}, className: '' };
    node.classList = {
        add(...names) { const set = new Set(node.className.split(/\s+/).filter(Boolean)); names.forEach(name => set.add(name)); node.className = [...set].join(' '); },
        remove(...names) { node.className = node.className.split(/\s+/).filter(name => !names.includes(name)).join(' '); },
        contains(name) { return node.className.split(/\s+/).includes(name); }
    };
    node.setAttribute = (key, value) => { node.attributes[key] = String(value); };
    node.getAttribute = key => node.attributes[key] ?? null;
    node.addEventListener = (type, callback) => { node.listeners[type] = callback; };
    node.appendChild = child => { child.parentNode = node; node.children.push(child); return child; };
    node.remove = () => { node.parentNode.children.splice(node.parentNode.children.indexOf(node), 1); };
    node.focus = () => {};
    node.closest = selector => selector === '.item-row' ? node.parentNode : null;
    node.querySelector = selector => node.children.find(child => child.classList.contains(selector.slice(1))) || null;
    node.querySelectorAll = () => node.children.filter(child => ['INPUT', 'BUTTON'].includes(child.tagName));
    let markup = '';
    Object.defineProperty(node, 'innerHTML', {
        get: () => markup,
        set(value) {
            markup = String(value); node.children.length = 0;
            // Parse row controls from the actual template, including sibling ordering.
            for (const match of markup.matchAll(/<(input|ul)\b([^>]*)>/g)) {
                const child = element(match[1]); child.className = /class="([^"]*)"/.exec(match[2])?.[1] || '';
                child.disabled = /\bdisabled\b/.test(match[2]); node.appendChild(child);
            }
            node.children.forEach((child, index) => { child.nextElementSibling = node.children[index + 1] || null; });
        }
    });
    return node;
}

function fixture({ cache = false, pending = null, canView = true, embedded = false } = {}) {
    const html = fs.readFileSync(process.env.PR_LOAD_TEST_HTML || path.join(__dirname, '../index.html'), 'utf8');
    const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].find(match => /const CURRENT_VERSION/.test(match[1]))[1];
    const nodes = {};
    for (const match of html.matchAll(/<(\w+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
        const node = nodes[match[3]] = element(match[1]); node.id = match[3];
        node.hidden = /\bhidden\b/.test(match[2]); node.className = /class="([^"]*)"/.exec(match[2])?.[1] || '';
        node.attributes.role = /\brole="([^"]*)"/.exec(match[2])?.[1];
    }
    const requests = [], values = new Map(), responses = new Map();
    const identity = '10000000-0000-4000-8000-000000000001';
    const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
    const key = name => name + '::identity:' + identity;
    if (cache) {
        values.set(key('CACHE_PR_INIT_DATA'), JSON.stringify({ _ts: Date.now(), _d: { products: [{ sku: 'old', name: 'Cached product', unit: 'ชิ้น' }] } }));
        values.set(key('CACHE_PR_HIST_DATA'), JSON.stringify({ _ts: Date.now(), _d: { success: true, history: [] } }));
    }
    if (pending) values.set(key('PR_PENDING_SUBMISSION'), JSON.stringify(pending));
    const success = action => ({ ok: true, status: 200, json: async () => ({ success: true, [action === 'getProducts' ? 'products' : 'history']: [] }) });
    const fetcher = async (url, options) => {
        if (!options?.body) return { ok: true, json: async () => ({ version: /const CURRENT_VERSION = "([^"]+)"/.exec(html)[1] }) };
        const action = JSON.parse(options.body).action; requests.push(action);
        const response = responses.get(action);
        return typeof response === 'function' ? response() : response || success(action);
    };
    const module = { embedded, isLocalPreview: () => false, getToken: () => 'fixture-token', markDirty: () => {}, markSaved: () => {}, home: () => { homes++; }, authRequired: () => { auths++; } };
    let homes = 0, auths = 0;
    const context = {
        console, URL, URLSearchParams, Date, navigator: { onLine: true }, localStorage: storage, sessionStorage: storage,
        setTimeout: () => 1, setInterval: () => 1, clearTimeout: () => {}, alert: () => {}, confirm: () => true,
        lucide: { createIcons: () => {} }, fetch: fetcher,
        window: { location: { search: '', href: 'http://fixture/PR/', pathname: '/PR/', hash: '' }, AkraModule: module, AkraPR: { can: (user, permission) => permission !== 'viewPR' || canView, create: options => AkraPR.create({ ...options, fetch: fetcher }) }, addEventListener: () => {}, scrollTo: () => {} },
        document: {
            body: element('body'), head: element('head'), addEventListener: () => {}, getElementById: id => nodes[id] || null,
            createElement: tag => element(tag), createDocumentFragment: () => element('fragment'),
            querySelector(selector) { const rows = nodes['pr-items-container'].children; return selector.endsWith(':last-child') ? rows.at(-1) : rows[0]?.querySelector('.p-product-input') || null; },
            querySelectorAll(selector) {
                if (selector === '#pr-items-container .item-row') return nodes['pr-items-container'].children;
                if (selector === '#form-pr input, #form-pr select, #form-pr button') return [nodes['pr-requester'], nodes['pr-warehouse'], nodes['btn-submit-pr'], nodes['pr-products-retry'], ...nodes['pr-items-container'].children.flatMap(row => row.querySelectorAll())];
                return [];
            }
        }
    };
    vm.createContext(context); new vm.Script(script, { filename: 'index.html:runtime' }).runInContext(context);
    new vm.Script("AppVersionGuard.start({current:CURRENT_VERSION,readActions:['getInitialData','getProducts','getPRHistory']});").runInContext(context);
    context.window.appSession = { id: 'fixture', identityId: identity }; context.prSessionToken = 'fixture-token';
    const readRows = () => nodes['pr-items-container'].children.map(row => Object.fromEntries(['sku', 'product', 'qty', 'unit', 'remark'].map(field => [field, row.querySelector('.p-' + field + '-input').value])));
    const typeRow = fields => { for (const [field, value] of Object.entries(fields)) nodes['pr-items-container'].children[0].querySelector('.p-' + field + '-input').value = value; };
    return { context, nodes, requests, responses, values, key, readRows, typeRow, homes: () => homes, auths: () => auths,
        fail(action, reason = 'pr_service_unavailable', status = 500) { responses.set(action, { ok: false, status, json: async () => ({ success: false, reason }) }); },
        succeed(action, items = []) { responses.set(action, { ok: true, status: 200, json: async () => ({ success: true, [action === 'getProducts' ? 'products' : 'history']: items }) }); }
    };
}

test('PR product failure leaves one usable row, matching count, and persistent read retry', async () => {
    const f = fixture(); f.fail('getProducts'); await f.context.loadInitialData();
    assert.deepEqual(f.requests, ['getProducts', 'getPRHistory'], 'the synthetic failure exercised actual read transport');
    assert.equal(f.readRows().length, 1);
    assert.equal(f.nodes['pr-total-items'].innerText, '1 รายการ');
    assert.equal(f.nodes['pr-items-container'].children[0].querySelector('.p-product-input').disabled, false);
    assert.equal(f.nodes['pr-products-error'].hidden, false);
    assert.equal(f.nodes['pr-products-error'].getAttribute('role'), 'alert');
    assert.equal(f.nodes['pr-products-retry'].textContent, 'โหลดรายการสินค้าอีกครั้ง');
});

test('PR product retry preserves every typed field and re-runs only the failed read', async () => {
    const f = fixture(); f.fail('getProducts'); await f.context.loadInitialData();
    const typed = { sku: 'typed-sku', product: 'สินค้าที่กรอกเอง', qty: '2.5000', unit: 'กล่อง', remark: 'คงข้อความนี้' };
    f.typeRow(typed); f.succeed('getProducts', [{ sku: 'fresh', name: 'Fresh product', unit: 'ชิ้น' }]);
    await f.context.retryPRRead('products');
    assert.deepEqual(f.readRows(), [typed]);
    assert.deepEqual(f.requests, ['getProducts', 'getPRHistory', 'getProducts']);
    assert.equal(f.nodes['pr-products-error'].hidden, true);
    assert.equal(f.nodes['pr-total-items'].innerText, '1 รายการ');
    assert.equal(f.context.appData.products[0].sku, 'fresh');
});

test('PR history failure has its own retry and leaves the usable form and catalog alone', async () => {
    const f = fixture(); f.succeed('getProducts', [{ name: 'Catalog product' }]); f.fail('getPRHistory');
    await f.context.loadInitialData(); f.typeRow({ product: 'Keep this', qty: '3', remark: 'Keep remark' });
    const before = f.readRows();
    assert.equal(f.nodes['pr-products-error'].hidden, true);
    assert.equal(f.nodes['pr-history-error'].hidden, false);
    assert.equal(f.nodes['pr-history-container'].innerHTML, '');
    f.succeed('getPRHistory'); await f.context.retryPRRead('history');
    assert.equal(f.nodes['pr-history-error'].hidden, true);
    assert.match(f.nodes['pr-history-container'].innerHTML, /ยังไม่มีประวัติ/);
    assert.deepEqual(f.readRows(), before);
    assert.deepEqual(f.requests, ['getProducts', 'getPRHistory', 'getPRHistory']);
    assert.equal(f.context.appData.products[0].name, 'Catalog product');
});

test('PR cached refresh failure retains catalog and cache rather than presenting successful empty data', async () => {
    const f = fixture({ cache: true }), before = new Map(f.values);
    f.fail('getProducts'); f.fail('getPRHistory'); await f.context.loadInitialData();
    assert.equal(f.context.appData.products[0].name, 'Cached product');
    assert.equal(f.nodes['pr-products-error'].hidden, false);
    assert.equal(f.nodes['pr-history-error'].hidden, false);
    assert.deepEqual(f.values, before);
    assert.equal(f.readRows().length, 1);
});

function deferredRead(f, action) {
    let resolve;
    const promise = new Promise(done => { resolve = done; }); f.responses.set(action, () => promise);
    return items => resolve({ ok: true, status: 200, json: async () => ({ success: true, [action === 'getProducts' ? 'products' : 'history']: items }) });
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('PR read failure during submit leaves read retry enabled and restores only mutation controls', async () => {
    const f = fixture(); await f.context.loadInitialData();
    f.nodes['pr-requester'].value = 'Fixture requester'; f.nodes['pr-warehouse'].value = 'W5';
    f.typeRow({ product: 'Typed product', qty: '2', unit: 'ชิ้น', remark: 'Keep this' });
    let finishRead, finishWrite, writes = 0;
    f.responses.set('getProducts', () => new Promise(resolve => { finishRead = resolve; }));
    const actualApi = f.context.apiCall;
    f.context.apiCall = (action, payload) => {
        if (action !== 'createPR') return actualApi(action, payload);
        writes++; return new Promise(resolve => { finishWrite = resolve; });
    };
    const reading = f.context.retryPRRead('products'); await flush();
    assert.equal(f.nodes['pr-products-retry'].disabled, true);
    const submitting = f.context.submitPR({ preventDefault() {} }); await flush();
    assert.equal(f.nodes['pr-requester'].disabled, true);
    finishRead({ ok: false, status: 500, json: async () => ({ success: false, reason: 'pr_service_unavailable' }) });
    await reading; assert.equal(f.nodes['pr-products-retry'].disabled, false);
    assert.equal(f.nodes['data-loader'].classList.contains('hidden'), false, 'earlier read settlement cannot hide pending submit progress');
    finishWrite({ success: false, pending: true, message: 'Synthetic unknown write result' }); await submitting;
    assert.equal(f.nodes['pr-products-retry'].disabled, false, 'submit settlement cannot restore stale read-pending state');
    assert.equal(f.nodes['pr-requester'].disabled, false); assert.equal(writes, 1);
    assert.equal(f.readRows()[0].remark, 'Keep this');
    assert.equal(f.nodes['pr-products-error'].hidden, false);
});

test('PR products retry settles during pending submit without hiding the submit overlay or changing its payload', async () => {
    for (const failedRead of [false, true]) {
        const f = fixture(); f.fail('getProducts'); await f.context.loadInitialData();
        f.nodes['pr-requester'].value = 'Fixture requester'; f.nodes['pr-warehouse'].value = 'W5';
        f.typeRow({ sku: 'typed-sku', product: 'Typed product', qty: '2.5000', unit: 'ชิ้น', remark: 'Keep this' });
        const typed = f.readRows(); let finishWrite; const writes = [], actualApi = f.context.apiCall;
        f.context.apiCall = (action, payload) => {
            if (action !== 'createPR') return actualApi(action, payload);
            writes.push(JSON.parse(JSON.stringify(payload))); return new Promise(resolve => { finishWrite = resolve; });
        };
        const submitting = f.context.submitPR({ preventDefault() {} }); await flush();
        assert.equal(f.nodes['data-loader'].classList.contains('hidden'), false);
        assert.equal(f.nodes['data-loader-text'].innerText, 'กำลังส่งคำขอสั่งซื้อ...');
        if (failedRead) f.fail('getProducts'); else f.succeed('getProducts', [{ name: 'Fresh product' }]);
        await f.context.retryPRRead('products');
        assert.equal(f.nodes['data-loader'].classList.contains('hidden'), false, 'settled read cannot hide pending submit progress');
        assert.equal(f.nodes['data-loader-text'].innerText, 'กำลังส่งคำขอสั่งซื้อ...');
        assert.equal(f.nodes['pr-requester'].disabled, true); assert.deepEqual(f.readRows(), typed);
        assert.deepEqual(writes, [{ requester: 'Fixture requester', warehouse: 'W5', items: [{ sku: 'typed-sku', product: 'Typed product', quantity: '2.5000', unit: 'ชิ้น', remark: 'Keep this' }] }]);
        assert.deepEqual(f.requests, ['getProducts', 'getPRHistory', 'getProducts']);
        finishWrite({ success: false, pending: true, message: 'Synthetic unresolved write' }); await submitting;
        assert.equal(f.nodes['data-loader'].classList.contains('hidden'), true);
        assert.equal(f.nodes['pr-requester'].disabled, false); assert.deepEqual(f.readRows(), typed);
        assert.equal(f.nodes['pr-restore-pending'].hidden, false); assert.equal(writes.length, 1);
    }
});

test('PR initial-load finally retains a submit overlay until the pending write settles', async () => {
    const f = fixture(), finishProducts = deferredRead(f, 'getProducts');
    const loading = f.context.loadInitialData(); await flush();
    f.nodes['pr-requester'].value = 'Fixture requester'; f.nodes['pr-warehouse'].value = 'W5';
    f.typeRow({ product: 'Typed product', qty: '2', unit: 'ชิ้น', remark: 'Keep this' });
    let finishWrite, writes = 0, actualApi = f.context.apiCall;
    f.context.apiCall = (action, payload) => action === 'createPR' ? new Promise(resolve => { writes++; finishWrite = resolve; }) : actualApi(action, payload);
    const submitting = f.context.submitPR({ preventDefault() {} }); await flush();
    finishProducts([{ name: 'Fresh catalog' }]); await loading;
    assert.equal(f.nodes['data-loader'].classList.contains('hidden'), false, 'outer read-load finally cannot hide a pending submit');
    assert.equal(f.nodes['data-loader-text'].innerText, 'กำลังส่งคำขอสั่งซื้อ...');
    finishWrite({ success: false, pending: true, message: 'Synthetic unresolved write' }); await submitting;
    assert.equal(f.nodes['data-loader'].classList.contains('hidden'), true); assert.equal(writes, 1);
});

test('PR products settle while history is still pending and repeated retry starts only one request', async () => {
    const f = fixture(); f.fail('getProducts'); const finishHistory = deferredRead(f, 'getPRHistory');
    const initial = f.context.loadInitialData(); await flush();
    assert.equal(f.nodes['pr-products-error'].hidden, false);
    assert.equal(f.nodes['data-loader'].classList.contains('hidden'), true);
    assert.equal(f.nodes['pr-history-status'].hidden, false);
    const finishProducts = deferredRead(f, 'getProducts');
    const first = f.context.retryPRRead('products'), second = f.context.retryPRRead('products'); await flush();
    assert.equal(f.requests.filter(action => action === 'getProducts').length, 2);
    assert.equal(f.nodes['pr-products-retry'].disabled, true);
    finishProducts([{ name: 'Recovered' }]); await Promise.all([first, second]);
    assert.equal(f.nodes['pr-products-error'].hidden, true);
    assert.equal(f.readRows().length, 1);
    finishHistory([]); await initial;
});

test('PR late completion cannot overwrite a newer refresh or a changed session', async () => {
    const f = fixture(), finishOld = deferredRead(f, 'getProducts');
    const old = f.context.loadInitialData(); await flush();
    f.succeed('getProducts', [{ name: 'Newer' }]); await f.context.loadInitialData(true);
    f.typeRow({ product: 'Typed while loading', qty: '8', unit: 'ชิ้น', remark: 'Keep' });
    const typed = f.readRows(); finishOld([{ name: 'Older' }]); await old;
    assert.equal(f.context.appData.products[0].name, 'Newer'); assert.deepEqual(f.readRows(), typed);
    const finishChanged = deferredRead(f, 'getProducts'), cacheBefore = f.values.get(f.key('CACHE_PR_INIT_DATA'));
    const changed = f.context.retryPRRead('products'); await flush();
    f.context.window.appSession = { id: 'other', identityId: '10000000-0000-4000-8000-000000000002' };
    finishChanged([{ name: 'Other session response' }]); await changed;
    assert.equal(f.context.appData.products[0].name, 'Newer');
    assert.equal(f.values.get(f.key('CACHE_PR_INIT_DATA')), cacheBefore);
    assert.deepEqual(f.readRows(), typed);
});

test('PR product retries preserve restored pending payload and its request identity', async () => {
    const pending = { clientRequestId: 'fixture-pending', data: { requester: 'Fixture', warehouse: 'W2', items: [
        { sku: 'F-1', product: 'Pending product', quantity: '2.5000', unit: 'กล่อง', remark: 'Pending remark' },
        { sku: '', product: 'Pending free text', quantity: '1', unit: '', remark: '' }
    ] } };
    const f = fixture({ pending }); f.fail('getProducts'); await f.context.loadInitialData(); f.context.restorePendingPR(false);
    const before = f.readRows(), receipt = f.values.get(f.key('PR_PENDING_SUBMISSION'));
    f.succeed('getProducts', [{ name: 'Fresh' }]); await f.context.retryPRRead('products'); await f.context.loadInitialData(true);
    assert.deepEqual(f.readRows(), before); assert.equal(f.values.get(f.key('PR_PENDING_SUBMISSION')), receipt);
    assert.equal(f.nodes['pr-restore-pending'].hidden, false);
    assert.equal(f.nodes['pr-warehouse'].value, 'W2');
    assert.equal(f.nodes['pr-total-items'].innerText, '2 รายการ');
    assert.ok(f.requests.every(action => action === 'getProducts' || action === 'getPRHistory'));
});

test('PR read failures use pinned network, server, permission and session recovery in standalone and shell modes', async () => {
    for (const embedded of [false, true]) {
        for (const sample of [
            { reason: 'pr_service_unavailable', status: 500, title: 'ระบบขัดข้องชั่วคราว' },
            { reason: 'permission_denied', status: 403, title: 'ไม่มีสิทธิ์ใช้ส่วนนี้', recovery: 'home' },
            { reason: 'invalid_or_expired_token', status: 401, title: 'เซสชันหมดอายุหรือเปลี่ยนแล้ว', recovery: 'session' },
            { error: new TypeError('synthetic network failure'), title: 'เชื่อมต่อไม่ได้' },
            { error: Object.assign(new Error('synthetic timeout'), { name: 'TimeoutError' }), title: 'เชื่อมต่อไม่ได้' }
        ]) {
            const f = fixture({ embedded });
            if (sample.error) f.responses.set('getProducts', () => { throw sample.error; }); else f.fail('getProducts', sample.reason, sample.status);
            await f.context.loadInitialData();
            assert.equal(f.nodes['pr-products-error-title'].textContent, sample.title);
            assert.equal(f.readRows().length, 1);
            if (sample.recovery) {
                await f.context.retryPRRead('products'); assert.equal(f.requests.length, 2, 'recovery does not retry a denied read');
                assert.equal(sample.recovery === 'home' ? f.homes() : f.auths(), 1);
            }
        }
    }
});

test('PR successful empty catalog remains valid and denied view performs no reads', async () => {
    const success = fixture(); await success.context.loadInitialData(); await success.context.loadInitialData(true);
    assert.equal(success.readRows().length, 1); assert.equal(success.nodes['pr-products-error'].hidden, true);
    const denied = fixture({ canView: false }); await denied.context.loadInitialData();
    assert.deepEqual(denied.requests, []); assert.equal(denied.nodes['pr-products-error-title'].textContent, 'ไม่มีสิทธิ์ใช้ส่วนนี้');
});

test('PR intentional cancellation and stale-session rejection never become network outages', async () => {
    for (const reason of ['session_changed', 'cancelled']) {
        const f = fixture();
        if (reason === 'session_changed') f.fail('getProducts', reason, 401);
        else f.responses.set('getProducts', () => { throw Object.assign(new Error('cancelled'), { name: 'AbortError' }); });
        await f.context.loadInitialData();
        assert.equal(f.nodes['pr-products-error'].hidden, true);
        assert.equal(f.nodes['pr-products-status'].hidden, true);
        assert.equal(f.nodes['pr-products-retry'].disabled, false);
    }
    const offline = fixture(); offline.context.navigator.onLine = false; await offline.context.loadInitialData();
    assert.equal(offline.nodes['pr-products-error-title'].textContent, 'เชื่อมต่อไม่ได้');
    assert.equal(offline.readRows().length, 1); assert.deepEqual(offline.requests, []);
});
