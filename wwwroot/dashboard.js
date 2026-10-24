(() => {
    'use strict';
    const host = window.chrome && window.chrome.webview;     // present inside the Zeus Display window
    const root = document.documentElement;
    const $ = id => document.getElementById(id);
    const setText = (id, value) => {
        const element = $(id);
        if (element.textContent !== value) element.textContent = value;
    };

    // Temperature is always held in Celsius; only labels follow the chosen unit.
    const state = { temp: 0, usage: 0, connected: false, fahrenheit: false, theme: 'system' };
    const history = [];
    let live = false;
    let lastSample = 0;
    let hover = -1;

    const toUnit = c => (state.fahrenheit ? c * 9 / 5 + 32 : c);
    const zone = c => (c < 60 ? 'accent' : c < 80 ? 'warm' : 'hot');
    const zoneLabel = c => (c < 60 ? 'Cool' : c < 80 ? 'Warm' : 'Hot');

    /* ---------- Gauges: a 270 degree ring, drawn with stroke-dasharray ---------- */
    const RADIUS = 62, CIRC = 2 * Math.PI * RADIUS, ARC = CIRC * 0.75;
    for (const id of ['tempGauge', 'useGauge']) {
        const track = $(id).querySelector('.ring-track');
        track.style.strokeDasharray = `${ARC} ${CIRC}`;
    }
    function setGauge(id, fraction) {
        const f = Math.min(1, Math.max(0, fraction));
        const arc = $(id);
        arc.style.strokeDasharray = `${(ARC * f).toFixed(2)} ${CIRC}`;
        arc.style.opacity = f < 0.005 ? '0' : '1';
    }
    // Small tick marks on the temperature ring where it turns warm (60) and hot (80).
    (function addTicks() {
        const ns = 'http://www.w3.org/2000/svg';
        for (const fraction of [0.6, 0.8]) {
            const angle = (135 + 270 * fraction) * Math.PI / 180;
            const line = document.createElementNS(ns, 'line');
            line.setAttribute('class', 'tick');
            line.setAttribute('x1', (80 + 69 * Math.cos(angle)).toFixed(2));
            line.setAttribute('y1', (80 + 69 * Math.sin(angle)).toFixed(2));
            line.setAttribute('x2', (80 + 76 * Math.cos(angle)).toFixed(2));
            line.setAttribute('y2', (80 + 76 * Math.sin(angle)).toFixed(2));
            $('tempGauge').appendChild(line);
        }
    })();

    /* ---------- History ---------- */
    function sample() {
        const now = Date.now();
        if (now - lastSample < 900) return;
        lastSample = now;
        history.push({ temp: state.temp, usage: state.usage });
        if (history.length > 60) history.shift();
    }

    /* ---------- Chart ---------- */
    let geometry = { start: 0, step: 1 };
    function drawChart() {
        const canvas = $('chart');
        const width = canvas.clientWidth, height = canvas.clientHeight;
        if (!width || !height) return;
        const dpr = window.devicePixelRatio || 1;
        const pw = Math.round(width * dpr), ph = Math.round(height * dpr);
        if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);

        const css = getComputedStyle(root);
        const color = name => css.getPropertyValue(name).trim();
        const top = 8, bottom = height - 6, plotHeight = bottom - top;
        const left = 4, right = width - 6;

        ctx.lineWidth = 1;
        ctx.strokeStyle = color('--grid');
        ctx.setLineDash([2, 4]);
        for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
            const y = Math.round(top + fraction * plotHeight) + 0.5;
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
        }
        ctx.setLineDash([]);
        if (history.length < 2) return;

        const step = (right - left) / 59;
        const start = right - (history.length - 1) * step;
        geometry = { start, step };
        // Fixed 0 to 100 scale: Celsius for temperature, percent for usage.
        const xAt = i => start + i * step;
        const yAt = value => top + plotHeight * (1 - Math.min(100, Math.max(0, value)) / 100);

        function series(key, stroke, isValid, fillStrength) {
            const points = history.map((p, i) => ({ x: xAt(i), y: yAt(p[key]), valid: isValid(p) }));
            const gradient = ctx.createLinearGradient(0, top, 0, bottom);
            gradient.addColorStop(0, stroke + fillStrength);
            gradient.addColorStop(1, stroke + '00');
            ctx.fillStyle = gradient;
            let run = [];
            const flush = () => {
                if (run.length > 1) {
                    ctx.beginPath(); ctx.moveTo(run[0].x, bottom);
                    run.forEach(p => ctx.lineTo(p.x, p.y));
                    ctx.lineTo(run[run.length - 1].x, bottom); ctx.closePath(); ctx.fill();
                }
                run = [];
            };
            points.forEach(p => { if (p.valid) run.push(p); else flush(); });
            flush();

            ctx.beginPath(); ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = stroke;
            let connected = false;
            points.forEach(p => {
                if (!p.valid) { connected = false; return; }
                if (connected) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
                connected = true;
            });
            ctx.stroke();
            const end = points[points.length - 1];
            if (end.valid) { ctx.beginPath(); ctx.arc(end.x, end.y, 3.5, 0, Math.PI * 2); ctx.fillStyle = stroke; ctx.fill(); }
            return points;
        }
        series('usage', color('--usage'), () => true, '22');
        const tempPoints = series('temp', color('--' + zone(state.temp)), p => p.temp > 0, '33');

        if (hover >= 0 && hover < history.length) {
            const x = xAt(hover);
            ctx.strokeStyle = color('--muted'); ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
            ctx.beginPath(); ctx.moveTo(x + 0.5, top); ctx.lineTo(x + 0.5, bottom); ctx.stroke(); ctx.setLineDash([]);
            const dot = (y, stroke) => {
                ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2);
                ctx.fillStyle = color('--surface'); ctx.fill();
                ctx.lineWidth = 2; ctx.strokeStyle = stroke; ctx.stroke();
            };
            dot(yAt(history[hover].usage), color('--usage'));
            if (tempPoints[hover].valid) dot(tempPoints[hover].y, color('--' + zone(state.temp)));
        }
    }

    function describeHover() {
        if (hover < 0 || hover >= history.length) return 'Last 60 seconds';
        const p = history[hover], age = history.length - 1 - hover, unit = state.fahrenheit ? 'F' : 'C';
        const temperature = p.temp > 0 ? `${Math.round(toUnit(p.temp))} \u00B0${unit}` : 'no temperature';
        return `${age === 0 ? 'Now' : age + 's ago'}: ${temperature}, ${Math.round(p.usage)} %`;
    }
    const canvas = $('chart');
    canvas.addEventListener('pointermove', event => {
        if (history.length < 2) return;
        const x = event.clientX - canvas.getBoundingClientRect().left;
        hover = Math.min(history.length - 1, Math.max(0, Math.round((x - geometry.start) / geometry.step)));
        setText('period', describeHover());
        drawChart();
    });
    canvas.addEventListener('pointerleave', () => {
        hover = -1;
        setText('period', describeHover());
        drawChart();
    });

    /* ---------- Rendering ---------- */
    function summarize(prefix, values, format) {
        const has = values.length > 0;
        const sum = values.reduce((a, b) => a + b, 0);
        setText(prefix + 'Min', has ? format(Math.min(...values)) : '\u2014');
        setText(prefix + 'Avg', has ? format(sum / values.length) : '\u2014');
        setText(prefix + 'Max', has ? format(Math.max(...values)) : '\u2014');
    }

    const unitButtons = [...document.querySelectorAll('[data-unit]')];
    const themeButtons = [...document.querySelectorAll('[data-theme-option]')];

    function render() {
        const hasTemp = live && state.temp > 0;
        const unit = state.fahrenheit ? 'F' : 'C';
        const z = hasTemp ? zone(state.temp) : 'accent';

        setText('tempValue', hasTemp ? String(Math.round(toUnit(state.temp))) : '\u2014');
        setText('useValue', live ? String(Math.round(state.usage)) : '\u2014');
        setText('tempUnit', '\u00B0' + unit);
        $('tempCard').style.setProperty('--metric', `var(--${z})`);
        $('tempSwatch').style.background = `var(--${z})`;
        setGauge('tempArc', hasTemp ? state.temp / 100 : 0);
        setGauge('useArc', live ? state.usage / 100 : 0);
        setText('tempCaption', hasTemp ? zoneLabel(state.temp) : live ? 'Sensor unavailable' : 'Waiting for sensor');
        setText('useCaption', live ? 'of total CPU capacity' : 'Waiting for sensor');

        const temperatures = history.map(p => p.temp).filter(t => t > 0).map(toUnit);
        const uses = history.map(p => p.usage);
        summarize('temp', temperatures, v => `${Math.round(v)} \u00B0${unit}`);
        summarize('use', uses, v => `${Math.round(v)} %`);
        setText('tempRange', temperatures.length ? `${Math.round(Math.min(...temperatures))}\u2013${Math.round(Math.max(...temperatures))} \u00B0${unit}` : '\u2014');
        setText('useRange', uses.length ? `${Math.round(Math.min(...uses))}\u2013${Math.round(Math.max(...uses))} %` : '\u2014');
        $('chartEmpty').hidden = history.length >= 2;

        const link = !live ? 'starting' : state.connected ? 'connected' : 'disconnected';
        $('status').dataset.state = link;
        $('deviceText').closest('.device').dataset.state = link;
        setText('statusText', !live ? 'Starting' : state.connected ? 'Connected' : 'Not connected');
        setText('deviceText', !live ? 'Starting' : state.connected ? 'Sending live readings to the cooler' : 'Cooler screen not found');
        let notice = '';
        if (live && !state.connected) notice = 'Connect the cooler\u2019s USB cable. Zeus will reconnect automatically.';
        else if (live && !hasTemp) notice = 'CPU temperature is unavailable. Install PawnIO separately and run Zeus Display as administrator.';
        $('notice').hidden = !notice;
        setText('noticeText', notice);

        mark(unitButtons, b => (b.dataset.unit === 'F') === state.fahrenheit);
        mark(themeButtons, b => b.dataset.themeOption === state.theme);
        drawChart();
    }

    /* ---------- Controls ---------- */
    function mark(buttons, isChecked) {
        buttons.forEach(button => {
            const checked = isChecked(button);
            button.setAttribute('aria-checked', String(checked));
            button.tabIndex = checked ? 0 : -1;
        });
    }
    function radioGroup(buttons, onSelect) {
        buttons.forEach((button, index) => {
            button.addEventListener('click', () => onSelect(button));
            button.addEventListener('keydown', event => {
                let next;
                if (['ArrowRight', 'ArrowDown'].includes(event.key)) next = (index + 1) % buttons.length;
                else if (['ArrowLeft', 'ArrowUp'].includes(event.key)) next = (index + buttons.length - 1) % buttons.length;
                else if (event.key === 'Home') next = 0;
                else if (event.key === 'End') next = buttons.length - 1;
                else return;
                event.preventDefault();
                buttons[next].focus();
                onSelect(buttons[next]);
            });
        });
    }
    function applyTheme(theme) {
        state.theme = theme === 'light' || theme === 'dark' ? theme : 'system';
        if (state.theme === 'system') delete root.dataset.theme; else root.dataset.theme = state.theme;
    }
    radioGroup(unitButtons, button => {
        state.fahrenheit = button.dataset.unit === 'F';
        if (host) host.postMessage({ type: 'setUnit', fahrenheit: state.fahrenheit });
        render();
    });
    radioGroup(themeButtons, button => {
        applyTheme(button.dataset.themeOption);
        if (host) host.postMessage({ type: 'setTheme', theme: state.theme });
        render();
    });

    /* ---------- Data from the app (about once a second) ---------- */
    state.theme = window.__theme === 'light' || window.__theme === 'dark' ? window.__theme : 'system';
    if (host) {
        host.addEventListener('message', event => {
            const message = event.data;
            if (!message || message.type !== 'state') return;
            live = true;
            state.temp = Math.max(0, Number(message.temp) || 0);
            state.usage = Math.min(100, Math.max(0, Number(message.usage) || 0));
            state.connected = !!message.connected;
            state.fahrenheit = !!message.fahrenheit;
            if (typeof message.theme === 'string' && message.theme !== state.theme) applyTheme(message.theme);
            sample();
            render();
        });
    } else {
        // Opened in a normal browser: moving demo data so the layout can be previewed. The app never uses this.
        live = true;
        for (let i = 0; i < 60; i++) history.push({ temp: 43 + Math.sin(i / 7) * 4 + Math.sin(i * 1.8), usage: 15 + Math.sin(i / 4) * 7 + Math.cos(i * 1.7) * 4 });
        Object.assign(state, history[history.length - 1], { connected: true });
        setInterval(() => {
            const t = Date.now() / 1000;
            Object.assign(state, { temp: 43 + Math.sin(t / 7) * 4, usage: 15 + Math.sin(t / 4) * 7 });
            sample();
            render();
        }, 1000);
    }

    new ResizeObserver(drawChart).observe($('chart'));
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', drawChart);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
    render();
})();