/* Protocol v1; distributed verbatim to module repositories. No token in route/message. */
(function () {
    'use strict';
    let shell = null;
    try {
        if (window.parent !== window && window.parent.location.origin === window.location.origin && ['/Main/','/Main/index.html'].includes(window.parent.location.pathname)) shell = window.parent.AkraShell;
    } catch (_) { /* Standalone/cross-origin pages keep their normal entrypoint. */ }
    let dirty = false, busy = 0, leaving = false;
    const APP_SWITCHER_CATALOG = Object.freeze([
        {id:'app-w5', label:'เบิกย้ายสินค้า (AKRA)', path:'/AKRA/', icon:'package'},
        {id:'app-trd', label:'เบิกย้ายสินค้าสต๊อก (AKRA>TRD)', path:'/TRDAKRA/', icon:'arrow-right-left'},
        {id:'app-gr', label:'ตรวจรับเข้าสินค้า (GR)', path:'/GR/', icon:'clipboard-check'},
        {id:'app-pr', label:'ขอสั่งชื้อสินค้า (PR)', path:'/PR/', icon:'file-plus-2'},
        {id:'app-pick', label:'บิลเบิกสินค้า (Picking)', path:'/Picking/', icon:'package-check'},
        {id:'app-tracking', label:'จัดการคำสั่งชื้อ (PO)', path:'/TrackingPO/', icon:'truck'},
        {id:'app-damage', label:'รับคืนสินค้าและเคลม', path:'/Returnitem/', icon:'package-x'},
        {id:'app-kpi', label:'KPI Tracker', path:'/KPITRACKER/', icon:'chart-no-axes-combined'},
        {id:'app-manual', label:'คู่มือ', path:'/SOP/', icon:'book-open'},
        {id:'app-evaluation', label:'แบบประเมินพนักงาน', path:'/Evaluation/', icon:'clipboard-list'}
    ]);
    const APP_SWITCHER_ICON_PATHS = Object.freeze({
        package:'<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
        'arrow-right-left':'<path d="M4 7h15M15 4l4 3-4 3M20 17H5M9 14l-4 3 4 3"/>',
        'clipboard-check':'<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4.5V3h6v1.5M8 12l2.5 2.5L16 9"/>',
        'file-plus-2':'<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 14h6M12 11v6"/>',
        'package-check':'<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m8.5 13 2.2 2.2 4.8-5"/>',
        truck:'<path d="M3 5h11v11H3zM14 9h4l3 3v4h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
        'package-x':'<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m9 10 6 6M15 10l-6 6"/>',
        'chart-no-axes-combined':'<path d="M4 19V5M4 19h16"/><path d="m7 15 3-4 3 2 5-7"/>',
        'book-open':'<path d="M4 5.5c3-1.2 5.7-.5 8 1.5v12c-2.3-2-5-2.7-8-1.5zM20 5.5c-3-1.2-5.7-.5-8 1.5v12c2.3-2 5-2.7 8-1.5z"/>',
        'clipboard-list':'<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 9h6M9 13h6M9 17h3"/>',
        home:'<path d="m3 10 9-7 9 7"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-7h6v7"/>'
    });
    const APP_SWITCHER_STYLE = [
        '#akra-global-app-switcher,.akra-global-switcher{font:inherit;color:#dbe7f5;box-sizing:border-box}',
        '.akra-global-switcher--fixed{position:fixed;inset:0 auto 0 0;z-index:70;width:224px;display:flex;flex-direction:column;gap:10px;padding:18px 12px;background:#0f172a;box-shadow:12px 0 30px rgba(15,23,42,.12)}',
        '.akra-global-switcher--inline{display:grid;gap:8px;margin:0 0 14px;padding:12px 10px;border-top:1px solid rgba(148,163,184,.2);border-bottom:1px solid rgba(148,163,184,.2);background:rgba(15,23,42,.18)}',
        '.akra-global-switcher__brand{display:flex;align-items:center;gap:9px;min-height:36px;padding:0 4px;color:#fff}',
        '.akra-global-switcher__mark{display:grid;place-items:center;width:30px;height:30px;flex:0 0 auto;border-radius:8px;background:#2563eb;color:#fff;font-size:11px;font-weight:800}',
        '.akra-global-switcher__brand-copy{display:grid;gap:1px;min-width:0}.akra-global-switcher__brand-copy strong{font-size:12px}.akra-global-switcher__brand-copy small{color:#9fb2ca;font-size:9px}',
        '.akra-global-switcher__heading{padding:3px 5px 0;color:#8fa5c0;font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}',
        '.akra-global-switcher__nav{display:grid;gap:3px;min-height:0;overflow:auto}',
        '.akra-global-switcher button{display:flex;width:100%;min-height:40px;align-items:center;gap:9px;padding:8px 9px;border:1px solid transparent;border-radius:8px;background:transparent;color:#b9c8dc;font:inherit;font-size:11px;font-weight:600;text-align:left;cursor:pointer}',
        '.akra-global-switcher button:hover{border-color:#31425f;background:#1b2a43;color:#fff}.akra-global-switcher button:focus-visible{outline:3px solid #60a5fa;outline-offset:2px}',
        '.akra-global-switcher button[aria-current="page"]{border-color:#3b82f6;background:#2563eb;color:#fff}',
        '.akra-global-switcher button svg{width:16px;height:16px;flex:0 0 auto;fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;stroke-width:1.8}',
        '.akra-global-switcher button span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.akra-global-switcher__home{background:rgba(37,99,235,.8)!important;color:#fff!important}.akra-global-switcher__footer{margin-top:auto;padding:10px 5px 0;border-top:1px solid rgba(148,163,184,.2);color:#8fa5c0;font-size:9px;line-height:1.5}',
        'body.akra-global-switcher-visible{padding-left:224px}@media(max-width:1023px){body.akra-global-switcher-visible{padding-left:0}.akra-global-switcher--fixed,.akra-global-switcher--inline{display:none!important}}',
        '@media(prefers-reduced-motion:reduce){.akra-global-switcher button{transition:none}}'
    ].join('');
    let standaloneAppId = '', standaloneSwitcher = null, standaloneSwitcherObserver = null;
    let standaloneUser = null;

    function switcherStorageJson(key) {
        try { return JSON.parse(stored(key)); } catch (_) { return null; }
    }
    function switcherEntries() {
        const cached = switcherStorageJson('akra_app_config');
        const user = switcherStorageJson('akra_user_data') || standaloneUser;
        const roles = Array.isArray(user?.roles) ? user.roles : [];
        const authorizedApps = Array.isArray(user?.apps) ? new Set(user.apps.map(String)) : null;
        if (authorizedApps?.size) {
            return APP_SWITCHER_CATALOG.flatMap(app => {
                if (!authorizedApps.has(app.id)) return [];
                const configured = Array.isArray(cached) ? cached.find(item => item?.id === app.id) : null;
                if (configured?.isActive === false) return [];
                return [{...app, label: typeof configured?.name === 'string' && configured.name ? configured.name : app.label}];
            });
        }
        if (!Array.isArray(cached) || !roles.length) {
            const current = APP_SWITCHER_CATALOG.find(app => app.id === standaloneAppId);
            return current ? [current] : [];
        }
        const roleSet = new Set(roles);
        return APP_SWITCHER_CATALOG.flatMap(app => {
            const configured = cached.find(item => item?.id === app.id);
            if (!configured || configured.isActive === false || !Array.isArray(configured.roles)
                || !configured.roles.some(role => roleSet.has(role))) return [];
            return [{...app, label: typeof configured.name === 'string' && configured.name ? configured.name : app.label}];
        });
    }
    function ensureSwitcherStyles() {
        if (typeof document === 'undefined' || !document.head || document.getElementById('akra-global-switcher-style')) return;
        const style = document.createElement('style');
        style.id = 'akra-global-switcher-style';
        style.textContent = APP_SWITCHER_STYLE;
        document.head.appendChild(style);
    }
    function switcherIcon(name) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
        svg.setAttribute('viewBox','0 0 24 24');
        svg.setAttribute('aria-hidden','true');
        svg.innerHTML = APP_SWITCHER_ICON_PATHS[name] || APP_SWITCHER_ICON_PATHS.package;
        return svg;
    }
    function confirmStandaloneLeave() {
        const work = window.AkraModule?.getWorkState?.() || {};
        if (work.busy) {
            window.alert?.('กำลังบันทึกรายการ กรุณารอผลก่อนเปลี่ยนแอปหรือออกจากระบบ');
            return false;
        }
        return !work.dirty || window.confirm('มีข้อมูลที่แก้ไขหรือรายการที่อาจยังไม่บันทึก ต้องการเปลี่ยนแอปหรือไม่?');
    }
    function switchStandalone(target) {
        if (!confirmStandaloneLeave()) return;
        window.AkraModule?.prepareLeave?.();
        window.location.assign(target);
    }
    function renderStandaloneSwitcher(host) {
        if (!host) return;
        host.replaceChildren();
        const brand = document.createElement('div');
        brand.className = 'akra-global-switcher__brand';
        const mark = document.createElement('span');
        mark.className = 'akra-global-switcher__mark';
        mark.textContent = 'AK';
        const brandCopy = document.createElement('span');
        brandCopy.className = 'akra-global-switcher__brand-copy';
        const brandTitle = document.createElement('strong');
        brandTitle.textContent = 'AKRA WEB';
        const brandSubtitle = document.createElement('small');
        brandSubtitle.textContent = 'สลับแอปพลิเคชัน';
        brandCopy.appendChild(brandTitle); brandCopy.appendChild(brandSubtitle);
        brand.appendChild(mark); brand.appendChild(brandCopy); host.appendChild(brand);
        const home = document.createElement('button');
        home.type = 'button'; home.className = 'akra-global-switcher__home';
        home.title = 'กลับหน้าหลัก'; home.setAttribute('aria-label','กลับหน้าหลัก');
        home.appendChild(switcherIcon('home'));
        const homeLabel = document.createElement('span'); homeLabel.textContent = 'หน้าหลัก'; home.appendChild(homeLabel);
        home.addEventListener('click', () => {
            if (!confirmStandaloneLeave()) return;
            window.AkraModule?.home?.(new URL('/Main/', window.location.origin).href);
        });
        host.appendChild(home);
        const heading = document.createElement('div');
        heading.className = 'akra-global-switcher__heading';
        heading.textContent = 'แอปของคุณ'; host.appendChild(heading);
        const nav = document.createElement('nav');
        nav.className = 'akra-global-switcher__nav';
        nav.setAttribute('aria-label','สลับแอปพลิเคชัน');
        switcherEntries().forEach(app => {
            const button = document.createElement('button');
            button.type = 'button'; button.title = app.label;
            button.setAttribute('aria-label','เปิด ' + app.label);
            if (app.id === standaloneAppId) button.setAttribute('aria-current','page');
            button.appendChild(switcherIcon(app.icon));
            const label = document.createElement('span'); label.textContent = app.label; button.appendChild(label);
            button.addEventListener('click', () => {
                if (app.id !== standaloneAppId) switchStandalone(new URL(app.path, window.location.origin).href);
            });
            nav.appendChild(button);
        });
        host.appendChild(nav);
        const footer = document.createElement('div');
        footer.className = 'akra-global-switcher__footer';
        footer.textContent = 'สิทธิ์การเข้าใช้งานควบคุมโดย Main';
        host.appendChild(footer);
    }
    function localSidebarHost() {
        if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return null;
        return document.querySelector('.gr-sidebar,#sidebar,#main-sidebar,.sidebar,.editor-sidebar');
    }
    function mountStandaloneSwitcher() {
        if (shell || !standaloneAppId || typeof document === 'undefined' || !document.body) return;
        ensureSwitcherStyles();
        const local = localSidebarHost();
        if (local) {
            document.body.classList.remove('akra-global-switcher-visible');
            let host = local.querySelector('[data-akra-global-switcher]');
            if (!host) {
                host = document.createElement('section');
                host.className = 'akra-global-switcher akra-global-switcher--inline';
                host.setAttribute('data-akra-global-switcher','');
                local.insertBefore(host, local.firstChild);
            }
            standaloneSwitcher = host;
            renderStandaloneSwitcher(host);
            if (!standaloneSwitcherObserver && typeof MutationObserver === 'function') {
                standaloneSwitcherObserver = new MutationObserver(() => {
                    if (!local.querySelector('[data-akra-global-switcher]')) mountStandaloneSwitcher();
                });
                standaloneSwitcherObserver.observe(local,{childList:true});
            }
            return;
        }
        document.body.classList.add('akra-global-switcher-visible');
        let host = document.getElementById('akra-global-app-switcher');
        if (!host) {
            host = document.createElement('aside');
            host.id = 'akra-global-app-switcher';
            host.className = 'akra-global-switcher akra-global-switcher--fixed';
            document.body.appendChild(host);
        }
        standaloneSwitcher = host;
        renderStandaloneSwitcher(host);
    }
    window.addEventListener('storage', event => {
        if (event.key === 'akra_app_config' || event.key === 'akra_user_data') renderStandaloneSwitcher(standaloneSwitcher);
    });

    const SESSION_VERIFY_TIMEOUT_MS = 10000;
    const MAIN_SESSION = 'akra_main_session', MAIN_TOKEN = 'akra_session_token';
    let watched = null, watchGeneration = 0;
    function stored(key) {
        try { return window.localStorage?.getItem(key) ?? null; } catch (_) { return null; }
    }
    function sessionStamp() { return stored(MAIN_SESSION) || JSON.stringify([stored(MAIN_TOKEN)]); }
    function isMainSignedOut() {
        try { return JSON.parse(stored(MAIN_SESSION))?.signedOut === true; } catch (_) { return false; }
    }
    function fingerprint(user) {
        const id = String(user?.identityId || '').toLowerCase();
        const version = Number(user?.sessionVersion), revision = user?.authorizationRevision;
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
            && Number.isSafeInteger(version) && version > 0 && typeof revision === 'string' && revision
            ? JSON.stringify([id,version,revision]) : '';
    }
    function invalidateWatched() {
        const old = watched;
        watched = null; ++watchGeneration;
        old?.invalidated();
    }
    async function checkSharedSession(event) {
        if (shell || !watched) return;
        if (event.key === null) { invalidateWatched(); return; }
        if (![MAIN_SESSION,MAIN_TOKEN].includes(event.key)) return;
        const raw = stored(MAIN_SESSION), legacy = stored(MAIN_TOKEN);
        let next;
        try { next = JSON.parse(raw); } catch (_) { /* Corrupt notifications cannot authorize anything. */ }
        if (event.key === MAIN_TOKEN && legacy !== watched.token && legacy !== next?.token) { invalidateWatched(); return; }
        if (raw === watched.raw) return;
        if (!next || next.version !== 1 || typeof next.token !== 'string' || !next.token
            || !watched.fingerprint || fingerprint(next) !== watched.fingerprint) { invalidateWatched(); return; }
        const owner = watched, generation = ++watchGeneration;
        owner.raw = raw;
        try {
            // Storage metadata only requests verification. It never grants access.
            const user = await window.AkraModule.verifySession(owner.appId, next.token);
            if (watched !== owner || generation !== watchGeneration || stored(MAIN_SESSION) !== raw) return;
            if (fingerprint(user) !== owner.fingerprint) { invalidateWatched(); return; }
            owner.token = next.token;
            standaloneUser = user;
            owner.refreshed(next.token, user);
            renderStandaloneSwitcher(standaloneSwitcher);
        } catch (_) {
            if (watched === owner && generation === watchGeneration) invalidateWatched();
        }
    }
    window.addEventListener('storage', checkSharedSession);
    function send(type, details = {}) {
        if (shell) window.parent.postMessage({channel:'akra-shell',version:1,type,...details},window.location.origin);
    }
    function state() { send('state',{dirty,busy:busy > 0}); }
    window.AkraModule = Object.freeze({
        embedded: !!shell,
        sessionStamp,
        isMainSignedOut,
        watchSession: options => {
            if (shell) return; // Main owns embedded document retirement.
            standaloneAppId = typeof options?.appId === 'string' ? options.appId : '';
            standaloneUser = options?.user || null;
            watched = {...options, fingerprint:fingerprint(options.user), raw:stored(MAIN_SESSION)};
            ++watchGeneration;
            let current;
            try { current = JSON.parse(watched.raw); } catch (_) {}
            if (watched.raw && (!current || current.version !== 1 || !watched.fingerprint || fingerprint(current) !== watched.fingerprint)) {
                invalidateWatched(); throw new Error('session_changed');
            }
            mountStandaloneSwitcher();
        },
        stopWatchingSession: () => { watched = null; standaloneUser = null; ++watchGeneration; },
        getToken: () => {
            if (!shell) return '';
            const token = shell.tokenFor(window);
            if (!token) throw new Error('shell_session_unavailable');
            return token;
        },
        isLocalPreview: () => !shell && ['localhost','127.0.0.1','::1'].includes(window.location.hostname) && new URLSearchParams(window.location.search).get('demo') === '1',
        hasPendingWork: () => dirty || busy > 0,
        getWorkState: () => ({dirty,busy:busy > 0}),
        prepareLeave: () => { leaving = true; },
        markDirty: () => { dirty = true; state(); },
        markSaved: () => { dirty = false; state(); },
        startWork: () => { busy += 1; state(); },
        endWork: () => { busy = Math.max(0,busy-1); state(); },
        runMutation: async operation => {
            busy += 1; state();
            try { return await operation(); }
            finally { busy = Math.max(0,busy-1); state(); }
        },
        verifySession: async (appId, standaloneToken = '') => {
            if (!shell && isMainSignedOut()) throw new Error('main_signed_out');
            const stamp = sessionStamp();
            const token = shell ? window.AkraModule.getToken() : standaloneToken;
            if (!token) throw new Error('no_token');
            const controller = typeof AbortController === 'function' ? new AbortController() : null;
            let timeoutId;
            const timeout = new Promise((_, reject) => {
                timeoutId = setTimeout(() => {
                    controller?.abort();
                    reject(Object.assign(new Error('session_verify_timeout'), { code: 'session_verify_timeout' }));
                }, SESSION_VERIFY_TIMEOUT_MS);
            });
            let response, result;
            try {
                const request = (async () => {
                    const nextResponse = await fetch('https://hgxrrskztbpejirrdpbq.supabase.co/functions/v1/auth-api', {
                        method:'POST', headers:{'Content-Type':'application/json'}, cache:'no-store',
                        ...(controller ? {signal:controller.signal} : {}),
                        body:JSON.stringify({action:'verifyToken',appId,token})
                    });
                    return {response:nextResponse,result:await nextResponse.json()};
                })();
                ({response, result} = await Promise.race([request, timeout]));
            } finally {
                clearTimeout(timeoutId);
            }
            if (!shell && stamp !== sessionStamp()) throw new Error('session_changed');
            if (!response.ok || result.valid !== true || !result.user?.id) throw new Error(result.reason || 'invalid_session');
            return result.user;
        },
        home: fallback => { if (shell) send('home'); else window.location.assign(fallback); },
        authRequired: fallback => { if (shell) send('auth-required'); else window.location.replace(fallback); },
        logout: fallback => { if (shell) send('logout'); else window.location.assign(fallback); }
    });
    if (!shell) return;
    // Conservative guard: filters/search do not count; saving is cleared only by
    // an explicit successful module save, never by a generic network response.
    document.addEventListener('input', event => {
        const target = event.target;
        if (!target?.matches?.('input, textarea, select, [contenteditable="true"]') || target.disabled || target.readOnly) return;
        if (target.type === 'search' || /search|filter/i.test(target.id || '') || target.closest('[data-shell-clean]')) return;
        dirty = true; state();
    },true);
    window.addEventListener('beforeunload', event => {
        if (!leaving && (dirty || busy)) { event.preventDefault(); event.returnValue = ''; }
    });
    const ready = () => send('ready');
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',ready,{once:true});
    else ready();
}());
