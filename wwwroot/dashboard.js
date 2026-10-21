(() => {
    'use strict';
    const host = window.chrome && window.chrome.webview;
    const $ = id => document.getElementById(id);
    const setText = (id, value) => {
        const element = $(id);
        if (element.textContent !== value) element.textContent = value;
    };
    const state = { temp: 0, usage: 0, connected: false, fahrenheit: false };
    const history = [];
    const buttons = [...document.querySelectorAll('[data-unit]')];
    let live = false;
    let lastSample = 0;
    const toUnit = c => state.fahrenheit ? c * 9 / 5 + 32 : c;
    const temperatureColor = () => state.temp < 60 ? '--accent' : state.temp < 80 ? '--warm' : '--hot';

    function sample() {
        const now = Date.now();
        if (now - lastSample < 1000) return;
        lastSample = now;
        history.push({ temp: state.temp, usage: state.usage });
        if (history.length > 60) history.shift();
    }

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
        const css = getComputedStyle(document.documentElement);
        const color = name => css.getPropertyValue(name).trim();
        const top = 8, bottom = height - 7, plotHeight = bottom - top;
        const left = 2, right = width - 5;
        ctx.lineWidth = 1;
        ctx.strokeStyle = color('--grid');
        ctx.setLineDash([2, 4]);
        for (const fraction of [0, .5, 1]) {
            const y = Math.round(top + fraction * plotHeight) + .5;
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
        }
        ctx.setLineDash([]);
        if (history.length < 2) return;
        const step = (right - left) / 59;
        const start = right - (history.length - 1) * step;
        function line(key, stroke, filled) {
            // Fixed 0–100 scale, in Celsius for temperature; labels follow the selected unit.
            const points = history.map((p, i) => ({
                x: start + i * step,
                y: top + plotHeight * (1 - Math.min(100, Math.max(0, p[key])) / 100),
                valid: key !== 'temp' || p.temp > 0
            }));
            if (filled) {
                const fill = ctx.createLinearGradient(0, top, 0, bottom);
                fill.addColorStop(0, stroke + '26'); fill.addColorStop(1, stroke + '00');
                ctx.fillStyle = fill;
                let run = [];
                function fillRun() {
                    if (run.length > 1) {
                        ctx.beginPath(); ctx.moveTo(run[0].x, bottom);
                        run.forEach(p => ctx.lineTo(p.x, p.y));
                        ctx.lineTo(run[run.length - 1].x, bottom); ctx.closePath(); ctx.fill();
                    }
                    run = [];
                }
                points.forEach(p => { if (p.valid) run.push(p); else fillRun(); });
                fillRun();
            }
            ctx.beginPath(); ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = stroke;
            let connected = false;
            points.forEach(p => {
                if (!p.valid) { connected = false; return; }
                if (connected) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
                connected = true;
            });
            ctx.stroke();
            const end = points[points.length - 1];
            if (end.valid) {
                ctx.beginPath(); ctx.arc(end.x, end.y, 3, 0, Math.PI * 2); ctx.fillStyle = stroke; ctx.fill();
            }
        }
        line('usage', color('--usage'), false);
        line('temp', color(temperatureColor()), true);
    }

    function render() {
        const hasTemp = live && state.temp > 0;
        const unit = state.fahrenheit ? 'F' : 'C';
        const color = hasTemp ? temperatureColor() : '--accent';
        $('tempValue').textContent = hasTemp ? Math.round(toUnit(state.temp)) : '—';
        $('useValue').textContent = live ? Math.round(state.usage) : '—';
        $('tempUnit').textContent = '°' + unit;
        $('tempRead').style.setProperty('--metric-color', `var(${color})`);
        $('tempSwatch').style.background = `var(${color})`;
        $('tempMeter').style.width = `${hasTemp ? Math.min(state.temp, 100) : 0}%`;
        $('useMeter').style.width = `${live ? state.usage : 0}%`;
        $('tempCaption').textContent = hasTemp ? (state.temp < 60 ? 'Cool' : state.temp < 80 ? 'Warm' : 'Hot') : live ? 'Sensor unavailable' : 'Waiting for sensor';
        $('useCaption').textContent = live ? 'of total CPU capacity' : 'Waiting for sensor';
        const temperatures = history.map(p => p.temp).filter(t => t > 0).map(toUnit);
        const uses = history.map(p => p.usage);
        $('tempRange').textContent = temperatures.length ? `${Math.round(Math.min(...temperatures))}–${Math.round(Math.max(...temperatures))} °${unit}` : '—';
        $('useRange').textContent = uses.length ? `${Math.round(Math.min(...uses))}–${Math.round(Math.max(...uses))} %` : '—';
        $('chartEmpty').hidden = history.length >= 2;
        $('status').dataset.state = !live ? 'starting' : state.connected ? 'connected' : 'disconnected';
        setText('statusText', !live ? 'Starting' : state.connected ? 'Connected' : 'Not connected');
        let notice = '';
        if (live && !state.connected) notice = 'Connect the cooler’s USB cable. Zeus will reconnect automatically.';
        else if (live && !hasTemp) notice = 'CPU temperature is unavailable. Install PawnIO separately and run Zeus Display as administrator.';
        $('notice').hidden = !notice; setText('noticeText', notice);
        buttons.forEach(button => {
            const checked = (button.dataset.unit === 'F') === state.fahrenheit;
            button.setAttribute('aria-checked', String(checked)); button.tabIndex = checked ? 0 : -1;
        });
        drawChart();
    }

    function selectUnit(button) {
        state.fahrenheit = button.dataset.unit === 'F';
        if (host) host.postMessage({ type: 'setUnit', fahrenheit: state.fahrenheit });
        render();
    }
    buttons.forEach((button, index) => {
        button.addEventListener('click', () => selectUnit(button));
        button.addEventListener('keydown', event => {
            let next;
            if (['ArrowRight', 'ArrowDown'].includes(event.key)) next = (index + 1) % buttons.length;
            if (['ArrowLeft', 'ArrowUp'].includes(event.key)) next = (index + buttons.length - 1) % buttons.length;
            if (event.key === 'Home') next = 0;
            if (event.key === 'End') next = buttons.length - 1;
            if (next === undefined) return;
            event.preventDefault(); buttons[next].focus(); selectUnit(buttons[next]);
        });
    });
    if (host) {
        host.addEventListener('message', event => {
            const message = event.data;
            if (!message || message.type !== 'state') return;
            live = true;
            state.temp = Math.max(0, Number(message.temp) || 0);
            state.usage = Math.min(100, Math.max(0, Number(message.usage) || 0));
            state.connected = !!message.connected; state.fahrenheit = !!message.fahrenheit;
            sample(); render();
        });
    } else {
        // Browser preview only; the app always waits for real sensor readings.
        live = true;
        for (let i = 0; i < 60; i++) history.push({ temp: 43 + Math.sin(i / 7) * 4 + Math.sin(i * 1.8), usage: 15 + Math.sin(i / 4) * 7 + Math.cos(i * 1.7) * 4 });
        Object.assign(state, history[history.length - 1], { connected: true });
        setInterval(() => {
            const t = Date.now() / 1000;
            Object.assign(state, { temp: 43 + Math.sin(t / 7) * 4, usage: 15 + Math.sin(t / 4) * 7 });
            sample(); render();
        }, 1000);
    }
    new ResizeObserver(drawChart).observe($('chart'));
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', drawChart);
    render();
})();
