const videoElement  = document.getElementsByClassName('input_video')[0];
const canvasElement = document.getElementsByClassName('output_canvas')[0];
const canvasCtx     = canvasElement.getContext('2d');
const loadingOverlay = document.getElementById('loading-overlay');
const gestureStatus  = document.getElementById('gesture-status');
const modeText       = document.getElementById('mode-text');
const modeIcon       = gestureStatus.querySelector('i');
const clearBtn       = document.getElementById('clear-btn');
const sizeSlider     = document.getElementById('size-slider');
const colorSwatches  = document.querySelectorAll('.color-swatch');
const customColorPicker = document.getElementById('custom-color');

// ─── Color selection ─────────────────────────────────────────────────────────
let activeColor = '#ef4444';

// Draw the full RGB spectrum onto the canvas bar
const rgbBar    = document.getElementById('rgb-bar');
const rgbCursor = document.getElementById('rgb-cursor');
const rgbCtx    = rgbBar.getContext('2d');
(function drawRGBBar() {
    const grad = rgbCtx.createLinearGradient(0, 0, rgbBar.width, 0);
    grad.addColorStop(0,     '#ff0000');
    grad.addColorStop(1/6,   '#ffff00');
    grad.addColorStop(2/6,   '#00ff00');
    grad.addColorStop(3/6,   '#00ffff');
    grad.addColorStop(4/6,   '#0000ff');
    grad.addColorStop(5/6,   '#ff00ff');
    grad.addColorStop(1,     '#ff0000');
    rgbCtx.fillStyle = grad;
    rgbCtx.fillRect(0, 0, rgbBar.width, rgbBar.height);
})();

function pickFromBar(clientX) {
    const rect = rgbBar.getBoundingClientRect();
    const x    = Math.max(0, Math.min(clientX - rect.left, rect.width - 1));
    const px   = rgbCtx.getImageData(Math.floor(x), 11, 1, 1).data;
    const hex  = '#' + [px[0], px[1], px[2]].map(v => v.toString(16).padStart(2,'0')).join('');
    setActiveColor(hex);
    rgbCursor.style.left = x + 'px';
}

function setActiveColor(hex) {
    activeColor = hex;
    colorSwatches.forEach(s => s.classList.remove('active'));
    customColorPicker.value = hex;
}

rgbBar.addEventListener('click',     e => pickFromBar(e.clientX));
rgbBar.addEventListener('mousemove', e => { if (e.buttons === 1) pickFromBar(e.clientX); });

colorSwatches.forEach(swatch => {
    swatch.addEventListener('click', () => {
        colorSwatches.forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
        activeColor = swatch.dataset.color;
        customColorPicker.value = activeColor;
        // Move rgb cursor off-bar visually
        rgbCursor.style.left = '-20px';
    });
});
customColorPicker.addEventListener('input', e => {
    colorSwatches.forEach(s => s.classList.remove('active'));
    activeColor = e.target.value;
    rgbCursor.style.left = '-20px';
});

// ─── Pause / resume tracking ─────────────────────────────────────────────────
let trackingPaused = false;
const toggleBtn = document.getElementById('toggle-tracking-btn');
toggleBtn.addEventListener('click', () => {
    trackingPaused = !trackingPaused;
    if (trackingPaused) {
        toggleBtn.innerHTML = '<i class="fa-solid fa-play"></i> Resume';
        toggleBtn.classList.add('paused');
    } else {
        toggleBtn.innerHTML = '<i class="fa-solid fa-pause"></i> Pause';
        toggleBtn.classList.remove('paused');
    }
});

// ─── Persistent drawing canvas ───────────────────────────────────────────────
const drawingCanvas = document.createElement('canvas');
const drawingCtx    = drawingCanvas.getContext('2d', { willReadFrequently: true });

function resizeCanvases() {
    const W = window.innerWidth, H = window.innerHeight;
    canvasElement.width = W; canvasElement.height = H;
    const tmp = document.createElement('canvas');
    tmp.width = drawingCanvas.width || W;
    tmp.height = drawingCanvas.height || H;
    if (drawingCanvas.width > 0) tmp.getContext('2d').drawImage(drawingCanvas, 0, 0);
    drawingCanvas.width = W; drawingCanvas.height = H;
    drawingCtx.drawImage(tmp, 0, 0);
}
window.addEventListener('resize', resizeCanvases);
resizeCanvases();

// ─── One Euro Filter ─────────────────────────────────────────────────────────
class OneEuroFilter {
    constructor(minCutoff = 1.5, beta = 0.01) {
        this.minCutoff = minCutoff;
        this.beta      = beta;
        this.dCutoff   = 1.0;
        this.xPrev     = null;
        this.dxPrev    = 0;
        this.tPrev     = null;
    }
    filter(x, t) {
        if (this.xPrev === null) { this.xPrev = x; this.tPrev = t; return x; }
        const dt   = Math.max((t - this.tPrev) / 1000, 1e-6);
        const freq = 1 / dt;
        this.tPrev = t;

        const alpha = v => 1 / (1 + 1 / (2 * Math.PI * v * dt));

        const dx   = (x - this.xPrev) * freq;
        const dxF  = this.dxPrev + alpha(this.dCutoff) * (dx - this.dxPrev);
        this.dxPrev = dxF;

        const cutoff = this.minCutoff + this.beta * Math.abs(dxF);
        const xF     = this.xPrev + alpha(cutoff) * (x - this.xPrev);
        this.xPrev   = xF;
        return xF;
    }
    reset() { this.xPrev = null; this.dxPrev = 0; this.tPrev = null; }
}

const fX = new OneEuroFilter(1.5, 0.01);
const fY = new OneEuroFilter(1.5, 0.01);

// ─── State ───────────────────────────────────────────────────────────────────
let curMode    = 'Hovering';
let modeBuf    = [];
const BUF_SZ   = 6;    // majority vote across 6 frames
let hoverCnt   = 0;
const HOVER_EXIT = 4;  // frames of hovering needed to exit drawing/erasing

// Cursor position (filtered)
let curX = null, curY = null;
// Previous point actually drawn
let prevX = null, prevY = null;

// ─── Gesture detection ────────────────────────────────────────────────────────
// A finger is "up" only if its tip is CLEARLY above its MCP (base knuckle)
// by at least MIN_EXTENSION in normalised units — prevents false positives
// from slightly raised fingers in a neutral/hovering hand pose.
const MIN_EXT = 0.08;   // ~8% of image height — tune up if too sensitive

function fingerUp(tip, pip, mcp) {
    // tip must be above both PIP and MCP by a meaningful margin
    return (mcp.y - tip.y) > MIN_EXT && tip.y < pip.y;
}

function fingerDown(tip, pip) {
    // tip is clearly below pip (curled)
    return tip.y > pip.y - 0.02;
}

function detectGesture(lm) {
    // tip ids: 8,12,16,20 — PIP ids: 6,10,14,18 — MCP ids: 5,9,13,17
    const iUp = fingerUp(lm[8],  lm[6],  lm[5]);
    const mUp = fingerUp(lm[12], lm[10], lm[9]);
    const rUp = fingerUp(lm[16], lm[14], lm[13]);
    const pUp = fingerUp(lm[20], lm[18], lm[17]);

    // For drawing we also require middle/ring/pinky clearly DOWN
    const mDown = fingerDown(lm[12], lm[10]);
    const rDown = fingerDown(lm[16], lm[14]);
    const pDown = fingerDown(lm[20], lm[18]);

    if (iUp && mDown && rDown && pDown) return 'Drawing';
    if (iUp && mUp   && rDown && pDown) return 'Erasing';
    return 'Hovering';
}

function majority(arr) {
    const c = {};
    for (const v of arr) c[v] = (c[v] || 0) + 1;
    return Object.entries(c).sort((a,b) => b[1]-a[1])[0][0];
}

// ─── UI helper ───────────────────────────────────────────────────────────────
let lastMode = '';
function setMode(mode) {
    curMode = mode;
    if (mode === lastMode) return;
    lastMode = mode;
    gestureStatus.className = 'status-badge ' + mode.toLowerCase();
    modeIcon.className = mode === 'Drawing'  ? 'fa-solid fa-pen'
                       : mode === 'Erasing' ? 'fa-solid fa-eraser'
                                            : 'fa-solid fa-hand';
    modeText.innerText = mode;
}

// ─── Frame handler ────────────────────────────────────────────────────────────
function onResults(results) {
    // First frame: hide loader
    if (loadingOverlay.style.display !== 'none') {
        loadingOverlay.style.opacity = '0';
        setTimeout(() => loadingOverlay.style.display = 'none', 500);
        setMode('Hovering');
    }

    // If paused, just redraw the camera feed + saved strokes, no tracking
    if (trackingPaused) {
        const W = canvasElement.width, H = canvasElement.height;
        canvasCtx.clearRect(0, 0, W, H);
        const iW = results.image.width, iH = results.image.height;
        const sc = Math.max(W / iW, H / iH);
        const dW = iW * sc, dH = iH * sc;
        const oX = (W - dW) / 2, oY = (H - dH) / 2;
        canvasCtx.save();
        canvasCtx.translate(W, 0); canvasCtx.scale(-1, 1);
        canvasCtx.drawImage(results.image, oX, oY, dW, dH);
        canvasCtx.fillStyle = 'rgba(0,0,0,0.2)';
        canvasCtx.fillRect(0, 0, W, H);
        canvasCtx.restore();
        canvasCtx.drawImage(drawingCanvas, 0, 0, W, H);
        return;
    }

    const W = canvasElement.width, H = canvasElement.height;
    const now = performance.now();

    // ── 1. Clear display canvas ───────────────────────────────────────────
    canvasCtx.clearRect(0, 0, W, H);

    // ── 2. Compute cover-fit of camera image ──────────────────────────────
    const iW = results.image.width, iH = results.image.height;
    const sc = Math.max(W / iW, H / iH);
    const dW = iW * sc, dH = iH * sc;
    const oX = (W - dW) / 2, oY = (H - dH) / 2;

    // ── 3. Draw mirrored camera ───────────────────────────────────────────
    canvasCtx.save();
    canvasCtx.translate(W, 0);
    canvasCtx.scale(-1, 1);
    canvasCtx.drawImage(results.image, oX, oY, dW, dH);
    canvasCtx.fillStyle = 'rgba(0,0,0,0.2)';
    canvasCtx.fillRect(0, 0, W, H);
    canvasCtx.restore();

    // ── 4. Draw saved strokes ─────────────────────────────────────────────
    canvasCtx.drawImage(drawingCanvas, 0, 0, W, H);

    // ── 5. Convert normalised landmark → mirrored screen pixel ───────────
    // landmark.x is 0→1 left-to-right in the ORIGINAL (unmirrored) image.
    // After we mirror the canvas display, a landmark at x=0.2 appears at
    // screen-x = W - (oX + 0.2*dW).
    function toScreen(lmk) {
        return {
            x: W - (oX + lmk.x * dW),
            y:       oY + lmk.y * dH
        };
    }

    // ── 6. Process hand ───────────────────────────────────────────────────
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const lm = results.multiHandLandmarks[0];

        // Gesture debounce
        const raw = detectGesture(lm);
        modeBuf.push(raw);
        if (modeBuf.length > BUF_SZ) modeBuf.shift();
        const maj = majority(modeBuf);

        if (maj === 'Hovering') {
            hoverCnt++;
            if (hoverCnt >= HOVER_EXIT) setMode('Hovering');
        } else {
            hoverCnt = 0;
            setMode(maj);
        }

        // Filter the index fingertip
        const raw8 = toScreen(lm[8]);
        curX = fX.filter(raw8.x, now);
        curY = fY.filter(raw8.y, now);

        // Draw skeleton in screen-normalised coords
        const sLM = lm.map(l => {
            const s = toScreen(l);
            return { x: s.x / W, y: s.y / H, z: l.z };
        });
        canvasCtx.setLineDash([]);
        drawConnectors(canvasCtx, sLM, HAND_CONNECTIONS,
            { color: 'rgba(255,255,255,0.2)', lineWidth: 2 });
        drawLandmarks(canvasCtx, sLM,
            { color: '#60a5fa', lineWidth: 1, radius: 3 });

        const brush = parseFloat(sizeSlider.value);

        if (curMode === 'Drawing') {
            // Draw onto persistent canvas
            drawingCtx.setLineDash([]);
            drawingCtx.lineCap   = 'round';
            drawingCtx.lineJoin  = 'round';
            drawingCtx.strokeStyle = activeColor;
            drawingCtx.lineWidth   = brush;

            if (prevX !== null) {
                drawingCtx.beginPath();
                drawingCtx.moveTo(prevX, prevY);
                drawingCtx.lineTo(curX, curY);
                drawingCtx.stroke();
            }
            prevX = curX;
            prevY = curY;

            // Cursor: filled dot + white ring at cursor position
            canvasCtx.setLineDash([]);
            canvasCtx.beginPath();
            canvasCtx.arc(curX, curY, brush / 2, 0, 2 * Math.PI);
            canvasCtx.fillStyle = activeColor;
            canvasCtx.fill();
            canvasCtx.beginPath();
            canvasCtx.arc(curX, curY, brush / 2 + 4, 0, 2 * Math.PI);
            canvasCtx.strokeStyle = 'white';
            canvasCtx.lineWidth = 2;
            canvasCtx.stroke();

        } else if (curMode === 'Erasing') {
            prevX = null; prevY = null;

            const er = brush * 4;
            // Erase on drawing canvas
            drawingCtx.save();
            drawingCtx.globalCompositeOperation = 'destination-out';
            drawingCtx.beginPath();
            drawingCtx.arc(curX, curY, er, 0, 2 * Math.PI);
            drawingCtx.fill();
            drawingCtx.restore();

            // Eraser cursor
            canvasCtx.save();
            canvasCtx.setLineDash([6, 4]);
            canvasCtx.beginPath();
            canvasCtx.arc(curX, curY, er, 0, 2 * Math.PI);
            canvasCtx.strokeStyle = 'rgba(255,255,255,0.9)';
            canvasCtx.lineWidth = 2;
            canvasCtx.stroke();
            canvasCtx.restore();

        } else {
            // Hovering — break stroke continuity
            prevX = null; prevY = null;
            fX.reset(); fY.reset();

            // Small hover dot
            canvasCtx.setLineDash([]);
            canvasCtx.beginPath();
            canvasCtx.arc(curX, curY, 6, 0, 2 * Math.PI);
            canvasCtx.fillStyle = 'rgba(255,255,255,0.6)';
            canvasCtx.fill();
        }

    } else {
        // No hand — full reset
        prevX = null; prevY = null;
        curX  = null; curY  = null;
        modeBuf = []; hoverCnt = 0;
        setMode('Hovering');
        fX.reset(); fY.reset();
    }
}

// ─── MediaPipe ───────────────────────────────────────────────────────────────
const hands = new Hands({
    locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`
});
hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.75,
    minTrackingConfidence: 0.75
});
hands.onResults(onResults);

const camera = new Camera(videoElement, {
    onFrame: async () => { await hands.send({ image: videoElement }); },
    width: 1280,
    height: 720
});
camera.start().catch(() => {
    loadingOverlay.querySelector('h2').innerText = 'Camera Access Required';
    loadingOverlay.querySelector('p').innerText  = 'Please allow camera access and reload.';
    loadingOverlay.querySelector('.spinner').style.display = 'none';
});

clearBtn.addEventListener('click', () => {
    drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
});
