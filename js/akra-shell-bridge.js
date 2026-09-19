/* Protocol v1; distributed verbatim to module repositories. No token in route/message. */
(function () {
    'use strict';
    let shell = null;
    try {
        if (window.parent !== window && window.parent.location.origin === window.location.origin && ['/Main/','/Main/index.html'].includes(window.parent.location.pathname)) shell = window.parent.AkraShell;
    } catch (_) { /* Standalone/cross-origin pages keep their normal entrypoint. */ }
    let dirty = false, busy = 0, leaving = false;
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
            owner.refreshed(next.token, user);
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
            watched = {...options, fingerprint:fingerprint(options.user), raw:stored(MAIN_SESSION)};
            ++watchGeneration;
            let current;
            try { current = JSON.parse(watched.raw); } catch (_) {}
            if (watched.raw && (!current || current.version !== 1 || !watched.fingerprint || fingerprint(current) !== watched.fingerprint)) {
                invalidateWatched(); throw new Error('session_changed');
            }
        },
        stopWatchingSession: () => { watched = null; ++watchGeneration; },
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
            const response = await fetch('https://hgxrrskztbpejirrdpbq.supabase.co/functions/v1/auth-api', {
                method:'POST', headers:{'Content-Type':'application/json'}, cache:'no-store',
                body:JSON.stringify({action:'verifyToken',appId,token})
            });
            const result = await response.json();
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
