import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browserPath = process.env.EDGE_PATH || [
    `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`
].find(existsSync);
assert.ok(browserPath, 'Microsoft Edge is required for the dashboard checks.');
const profile = path.join(root, 'obj', `dashboard-check-${Date.now()}`);
await mkdir(profile, { recursive: true });
const browser = spawn(browserPath, ['--headless=new', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
try {
    let port;
    for (let attempt = 0; attempt < 100; attempt++) {
        try { port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
        catch { await delay(100); }
    }
    assert.ok(port, 'Headless Edge did not start.');
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let sequence = 0;
    const pending = new Map();
    const errors = [];
    socket.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
        if (message.id) {
            const waiter = pending.get(message.id);
            if (!waiter) return;
            clearTimeout(waiter.timeout); pending.delete(message.id);
            if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
            else waiter.resolve(message.result);
        }
    };
    function command(method, params = {}) {
        const id = ++sequence;
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 10000);
            pending.set(id, { resolve, reject, timeout });
            socket.send(JSON.stringify({ id, method, params }));
        });
    }
    async function evaluate(expression) {
        const result = await command('Runtime.evaluate', { expression, returnByValue: true });
        if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
        return result.result.value;
    }
    await command('Page.enable');
    await command('Runtime.enable');
    await command('Emulation.setDeviceMetricsOverride', { width: 560, height: 740, deviceScaleFactor: 1, mobile: false });
    await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await command('Page.addScriptToEvaluateOnNewDocument', { source: `
        window.__messages = [];
        window.__clock = Date.now();
        Date.now = () => window.__clock;
        window.chrome ??= {};
        window.chrome.webview = {
            addEventListener: (event, callback) => { window.__receive = callback; },
            postMessage: message => window.__messages.push(message)
        };` });
    await command('Page.navigate', { url: pathToFileURL(path.join(root, 'wwwroot', 'index.html')).href });
    for (let attempt = 0; attempt < 100; attempt++) {
        if (await evaluate('document.readyState === "complete" && typeof window.__receive === "function"')) break;
        await delay(50);
    }
    const text = id => evaluate(`document.getElementById(${JSON.stringify(id)}).textContent`);
    const state = async data => evaluate(`window.__clock += 1001; window.__receive({data: ${JSON.stringify({ type: 'state', temp: 42, usage: 18, connected: true, fahrenheit: false, ...data })}});`);
    assert.equal(await text('tempValue'), '—');
    assert.equal(await text('useValue'), '—');
    assert.equal(await text('statusText'), 'Starting');
    assert.equal(await evaluate('document.getElementById("notice").hidden'), true);
    await state({});
    assert.equal(await text('tempValue'), '42');
    assert.equal(await text('useValue'), '18');
    assert.equal(await text('statusText'), 'Connected');
    await evaluate('document.querySelector("[data-unit=F]").click()');
    assert.equal(await text('tempValue'), '108');
    assert.equal(await text('tempUnit'), '°F');
    assert.deepEqual(await evaluate('window.__messages.at(-1)'), { type: 'setUnit', fahrenheit: true });
    await evaluate('document.querySelector("[data-unit=F]").focus()');
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowLeft' });
    assert.deepEqual(await evaluate('window.__messages.at(-1)'), { type: 'setUnit', fahrenheit: false });
    assert.equal(await evaluate('document.activeElement.dataset.unit'), 'C');
    await state({ connected: false });
    assert.equal(await text('statusText'), 'Not connected');
    assert.equal(await evaluate('document.getElementById("notice").hidden'), false);
    await state({ temp: 0 });
    assert.equal(await text('tempValue'), '—');
    assert.match(await text('noticeText'), /PawnIO/);
    await state({ temp: 88, usage: 100 });
    assert.equal(await text('tempCaption'), 'Hot');
    assert.equal(await text('useValue'), '100');
    for (let i = 0; i < 60; i++) await state({ temp: 43 + Math.sin(i / 7) * 4 + Math.sin(i * 1.8), usage: 15 + Math.sin(i / 4) * 7 + Math.cos(i * 1.7) * 4 });
    assert.equal(await evaluate('document.getElementById("chartEmpty").hidden'), true);
    assert.equal(await evaluate('document.scrollingElement.scrollHeight <= innerHeight'), true, 'Default window should fit without scrolling.');
    await evaluate('document.activeElement.blur()');
    if (process.argv.includes('--screenshots')) {
        await mkdir(path.join(root, 'docs'), { recursive: true });
        const screenshot = await command('Page.captureScreenshot');
        await writeFile(path.join(root, 'docs', 'dashboard-dark.png'), Buffer.from(screenshot.data, 'base64'));
    }
    await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    await state({ temp: 47, usage: 18 });
    if (process.argv.includes('--screenshots')) {
        const screenshot = await command('Page.captureScreenshot');
        await writeFile(path.join(root, 'docs', 'dashboard-light.png'), Buffer.from(screenshot.data, 'base64'));
    }
    await command('Emulation.setDeviceMetricsOverride', { width: 424, height: 521, deviceScaleFactor: 1, mobile: false });
    await state({ temp: 100, usage: 100, fahrenheit: true });
    assert.equal(await evaluate('document.scrollingElement.scrollWidth <= innerWidth'), true, 'Minimum window must not overflow horizontally.');
    assert.equal(await evaluate('document.getElementById("tempRead").offsetTop === document.getElementById("useRead").offsetTop'), true);
    assert.equal(errors.length, 0, JSON.stringify(errors));
    console.log('PASS: live states, missing sensor, reconnect notice, temperature conversion, keyboard controls, themes, chart, and window layouts.');
} finally {
    socket?.close();
    browser.kill();
}
