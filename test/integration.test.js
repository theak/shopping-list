// Integration test: load the REAL template <main> markup + script.js + the
// vendored Alpine build under jsdom, stub fetch, let Alpine boot, and assert the
// list actually renders from the x-data/x-for directives.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const REPO = path.join(__dirname, '..');
const template = fs.readFileSync(path.join(REPO, 'templates/index.html'), 'utf8');
const main = template.slice(template.indexOf('<main'), template.indexOf('</main>') + 7);
const scriptJs = fs.readFileSync(path.join(REPO, 'static/js/script.js'), 'utf8');
const alpineJs = fs.readFileSync(path.join(REPO, 'static/js/alpine.min.js'), 'utf8');

const dom = new JSDOM(`<!doctype html><html><body>${main}</body></html>`, {
    runScripts: 'outside-only',
    url: 'http://localhost:8000/',
    pretendToBeVisual: true,
});
const { window } = dom;
window.alert = () => {};

// Stub fetch: /api/items -> two items (online), everything else -> success.
window.fetch = (url) => {
    if (String(url).includes('/api/items')) {
        return Promise.resolve({
            ok: true, status: 200,
            headers: { get: () => null },
            json: async () => ({ items: [{ name: 'Milk', complete: false }, { name: 'Eggs', complete: true }] }),
        });
    }
    return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ success: true }) });
};

// Poll until `fn` is truthy or we time out (avoids CI timing flakiness).
async function waitFor(fn, timeout = 3000, step = 25) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (fn()) return true;
        await new Promise((r) => window.setTimeout(r, step));
    }
    return false;
}

async function run() {
    window.eval(scriptJs);   // registers alpine:init listener
    window.eval(alpineJs);   // boots Alpine -> fires alpine:init -> walks DOM

    const doc = window.document;
    await waitFor(() => doc.querySelectorAll('.list .name').length === 2);

    let pass = 0, fail = 0;
    const check = (n, c) => { if (c) { pass++; console.log('  ok  -', n); } else { fail++; console.log('  FAIL-', n); } };

    const names = [...doc.querySelectorAll('.list .name')].map(el => el.textContent);
    check('Alpine booted and rendered rows', names.length === 2);
    check('incomplete item "Milk" rendered', names.includes('Milk'));
    check('complete item "Eggs" rendered', names.includes('Eggs'));

    const checkboxes = doc.querySelectorAll('.list input[type="checkbox"]');
    check('rendered a checkbox per item', checkboxes.length === 2);

    check('Completed section present (has a complete item)',
        [...doc.querySelectorAll('h2')].some(h => /Completed/.test(h.textContent)));
    check('completed item uses <s> strikethrough',
        [...doc.querySelectorAll('.list s.name')].some(s => s.textContent === 'Eggs'));

    console.log(`\nintegration: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
}
run().catch(e => { console.error('ERROR', e); process.exit(1); });
