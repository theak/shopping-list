// Unit tests for the Alpine component logic in static/js/script.js, run under
// jsdom. We capture the factory registered via Alpine.data('list', factory),
// instantiate it, stub fetch, and assert on the component's state. Alpine's own
// reactivity/DOM binding is the library's job and not retested here.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const REPO = path.join(__dirname, '..');
const SCRIPT = fs.readFileSync(path.join(REPO, 'static/js/script.js'), 'utf8');
const dom = new JSDOM('<!doctype html><html><body></body></html>',
    { runScripts: 'outside-only', url: 'http://localhost:8000/' });
const { window } = dom;

let capturedFactory = null;
window.Alpine = { data: (_name, factory) => { capturedFactory = factory; } };
window.alert = (m) => { window.__lastAlert = m; };

window.eval(SCRIPT);
window.document.dispatchEvent(new window.Event('alpine:init'));

let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log('  ok  -', name); }
    else { fail++; console.log('  FAIL-', name); }
}

// Build a fake fetch Response.
function makeRes({ ok = true, status = 200, body = {}, fromCache = false }) {
    return {
        ok, status,
        headers: { get: (h) => (h.toLowerCase() === 'x-from-cache' && fromCache) ? '1' : null },
        json: async () => body,
    };
}
// Install a fetch that returns queued responses and records calls.
let calls = [];
function stubFetch(responder) {
    window.fetch = (url, opts) => { calls.push({ url, opts }); return Promise.resolve(responder(url, opts)); };
}

check('factory was registered via Alpine.data', typeof capturedFactory === 'function');

async function run() {
    // --- refresh(): online with fresh data -------------------------------
    let c = capturedFactory();
    stubFetch(() => makeRes({ body: { items: [{ name: 'Milk', complete: false }, { name: 'Eggs', complete: true }] } }));
    window.localStorage.removeItem('lastSync');
    await c.refresh();
    check('refresh online loads items', c.items.length === 2);
    check('refresh online clears offline flag', c.offline === false);
    check('refresh online records lastSync', !!window.localStorage.getItem('lastSync'));
    check('incomplete getter filters', c.incomplete.length === 1 && c.incomplete[0].name === 'Milk');
    check('complete getter filters', c.complete.length === 1 && c.complete[0].name === 'Eggs');

    // --- refresh(): served from SW cache => offline ----------------------
    c = capturedFactory();
    window.localStorage.setItem('lastSync', 'Aug 16, 2:00 PM');
    stubFetch(() => makeRes({ fromCache: true, body: { items: [{ name: 'Bread', complete: false }] } }));
    await c.refresh();
    check('refresh from-cache sets offline', c.offline === true);
    check('refresh from-cache still renders cached items', c.items.length === 1);
    check('refresh from-cache does NOT overwrite lastSync', window.localStorage.getItem('lastSync') === 'Aug 16, 2:00 PM');

    // --- refresh(): network error => offline -----------------------------
    c = capturedFactory();
    window.fetch = () => Promise.reject(new Error('no net'));
    await c.refresh();
    check('refresh network-error sets offline', c.offline === true);

    // --- blocked() -------------------------------------------------------
    c = capturedFactory();
    c.offline = false;
    check('blocked() false when online', c.blocked() === false);
    c.offline = true;
    window.__lastAlert = null;
    check('blocked() true when offline', c.blocked() === true);
    check('blocked() alerts when offline', /offline/i.test(window.__lastAlert || ''));

    // --- toggle(): offline is a no-op ------------------------------------
    c = capturedFactory();
    c.offline = true;
    const item = { name: 'X', complete: false };
    calls = [];
    await c.toggle(item);
    check('toggle offline does not change item', item.complete === false);
    check('toggle offline makes no request', calls.length === 0);

    // --- toggle(): online flips + posts ----------------------------------
    c = capturedFactory();
    c.offline = false;
    const item2 = { name: 'Y', complete: false };
    stubFetch(() => makeRes({ body: { success: true } }));
    calls = [];
    await c.toggle(item2);
    check('toggle online flips complete', item2.complete === true);
    check('toggle online hits complete_item endpoint', /\/api\/complete_item/.test(calls[0].url));

    // --- add(): online pushes item ---------------------------------------
    c = capturedFactory();
    c.offline = false;
    c.newItem = '  Cheese  ';
    stubFetch(() => makeRes({ body: { success: true, item: { name: 'Cheese' } } }));
    await c.add();
    check('add online appends item', c.items.some(i => i.name === 'Cheese'));
    check('add online clears input', c.newItem === '');

    // --- add(): offline blocked ------------------------------------------
    c = capturedFactory();
    c.offline = true;
    c.newItem = 'Nope';
    calls = [];
    await c.add();
    check('add offline adds nothing', c.items.length === 0 && calls.length === 0);

    // --- save(): renames -------------------------------------------------
    c = capturedFactory();
    c.offline = false;
    const item3 = { name: 'Old', complete: false };
    c.editing = 'Old'; c.editText = 'New';
    stubFetch(() => makeRes({ body: { success: true } }));
    await c.save(item3);
    check('save renames item', item3.name === 'New');
    check('save exits edit mode', c.editing === null);

    // --- save(): no-op when unchanged ------------------------------------
    c = capturedFactory();
    c.offline = false;
    const item4 = { name: 'Same', complete: false };
    c.editing = 'Same'; c.editText = 'Same';
    calls = [];
    await c.save(item4);
    check('save unchanged makes no request', calls.length === 0);
    check('save unchanged exits edit mode', c.editing === null);

    console.log(`\ncomponent: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
}
run().catch(e => { console.error('ERROR', e); process.exit(1); });
