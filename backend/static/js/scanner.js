(function () {
  'use strict';

  const API_BASE = window.FOOT_SCANNER_API || window.location.origin;

  // State
  let currentStep = 'instructions';
  let stream = null;
  let capturedBlob = null;

  // Point marking state
  const MARKING_STEPS = [
    { id: 'card1', label: 'Tap one end of the card\u2019s long edge', color: '#f59e0b' },
    { id: 'card2', label: 'Tap the other end of the card\u2019s long edge', color: '#f59e0b' },
    { id: 'heel', label: 'Tap the back of your heel', color: '#2563eb' },
    { id: 'toe', label: 'Tap the tip of your longest toe', color: '#2563eb' },
    { id: 'widthL', label: 'Tap the widest point on the left side of your foot', color: '#16a34a' },
    { id: 'widthR', label: 'Tap the widest point on the right side of your foot', color: '#16a34a' },
  ];
  let markingIndex = 0;
  let points = {};
  let imageNaturalWidth = 0;
  let imageNaturalHeight = 0;

  // Zoom/pan state
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let isPanning = false;
  let lastPanX = 0;
  let lastPanY = 0;
  let lastPinchDist = 0;
  let markingWrapper = null;
  let markingContent = null;

  // DOM refs
  let steps = {};
  let videoEl, canvasEl, previewImg, markingImg, markingCanvas, markingCtx;

  function init() {
    steps = {
      instructions: document.getElementById('step-instructions'),
      camera: document.getElementById('step-camera'),
      preview: document.getElementById('step-preview'),
      marking: document.getElementById('step-marking'),
      loading: document.getElementById('step-loading'),
      results: document.getElementById('step-results'),
      error: document.getElementById('step-error'),
      manual: document.getElementById('step-manual'),
    };

    videoEl = document.getElementById('camera-video');
    canvasEl = document.getElementById('camera-canvas');
    previewImg = document.getElementById('preview-image');
    markingImg = document.getElementById('marking-image');
    markingCanvas = document.getElementById('marking-canvas');
    markingCtx = markingCanvas.getContext('2d');
    markingWrapper = document.getElementById('marking-wrapper');
    markingContent = document.getElementById('marking-content');

    // Buttons
    document.getElementById('btn-start-camera').addEventListener('click', startCamera);
    document.getElementById('btn-upload').addEventListener('click', () => document.getElementById('file-input').click());
    document.getElementById('file-input').addEventListener('change', handleFileUpload);
    document.getElementById('btn-capture').addEventListener('click', capturePhoto);
    document.getElementById('btn-retake').addEventListener('click', () => goToStep('camera'));
    document.getElementById('btn-start-marking').addEventListener('click', startMarking);
    document.getElementById('btn-undo-mark').addEventListener('click', undoMark);
    document.getElementById('btn-zoom-in').addEventListener('click', () => adjustZoom(0.5));
    document.getElementById('btn-zoom-out').addEventListener('click', () => adjustZoom(-0.5));
    document.getElementById('btn-zoom-reset').addEventListener('click', resetZoom);
    document.getElementById('btn-try-again').addEventListener('click', () => goToStep('instructions'));
    document.getElementById('btn-manual').addEventListener('click', () => goToStep('manual'));
    document.getElementById('btn-manual-submit').addEventListener('click', submitManual);
    document.getElementById('btn-scan-again').addEventListener('click', () => goToStep('instructions'));
    document.getElementById('btn-error-manual').addEventListener('click', () => goToStep('manual'));

    // Marking canvas tap/touch handlers
    markingCanvas.addEventListener('click', handleMarkingTap);
    markingCanvas.addEventListener('touchend', handleMarkingTouch);

    // Pinch-to-zoom and pan on the wrapper
    markingWrapper.addEventListener('touchstart', handleTouchStart, { passive: false });
    markingWrapper.addEventListener('touchmove', handleTouchMove, { passive: false });
    markingWrapper.addEventListener('touchend', handleTouchEnd);

    // Mouse wheel zoom
    markingWrapper.addEventListener('wheel', handleWheel, { passive: false });

    // Mouse pan (middle click or when zoomed)
    markingWrapper.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    goToStep('instructions');
  }

  function goToStep(name) {
    currentStep = name;
    Object.values(steps).forEach(el => el && el.classList.remove('active'));
    if (steps[name]) steps[name].classList.add('active');
    if (name !== 'camera' && stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
  }

  // --- Camera ---
  async function startCamera() {
    goToStep('camera');
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 2560 } }
      });
      videoEl.srcObject = stream;
      await videoEl.play();
    } catch (err) {
      alert('Could not access camera. Please use the Upload Photo option instead.');
      goToStep('instructions');
    }
  }

  function capturePhoto() {
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    const s = track.getSettings();
    canvasEl.width = s.width || videoEl.videoWidth;
    canvasEl.height = s.height || videoEl.videoHeight;
    canvasEl.getContext('2d').drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
    canvasEl.toBlob(blob => {
      capturedBlob = blob;
      previewImg.src = URL.createObjectURL(blob);
      goToStep('preview');
    }, 'image/jpeg', 0.9);
  }

  function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    compressImage(file, blob => {
      capturedBlob = blob;
      previewImg.src = URL.createObjectURL(blob);
      goToStep('preview');
    });
    e.target.value = '';
  }

  function compressImage(file, callback) {
    const img = new Image();
    img.onload = () => {
      const MAX = 2000;
      let w = img.width, h = img.height;
      if (w > MAX || h > MAX) {
        const r = Math.min(MAX / w, MAX / h);
        w = Math.round(w * r);
        h = Math.round(h * r);
      }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      c.toBlob(callback, 'image/jpeg', 0.85);
    };
    img.src = URL.createObjectURL(file);
  }

  // --- Zoom & Pan ---
  function adjustZoom(delta) {
    const oldZoom = zoom;
    zoom = Math.max(1, Math.min(5, zoom + delta));
    if (zoom === 1) { panX = 0; panY = 0; }
    else {
      // Keep centered
      panX = panX * (zoom / oldZoom);
      panY = panY * (zoom / oldZoom);
      clampPan();
    }
    applyTransform();
    redrawMarks();
  }

  function resetZoom() {
    zoom = 1;
    panX = 0;
    panY = 0;
    applyTransform();
    redrawMarks();
  }

  function clampPan() {
    const maxPanX = (markingContent.offsetWidth * (zoom - 1)) / 2;
    const maxPanY = (markingContent.offsetHeight * (zoom - 1)) / 2;
    panX = Math.max(-maxPanX, Math.min(maxPanX, panX));
    panY = Math.max(-maxPanY, Math.min(maxPanY, panY));
  }

  function applyTransform() {
    markingContent.style.transform = 'translate(' + panX + 'px, ' + panY + 'px) scale(' + zoom + ')';
    // Update zoom level display
    var zoomText = document.getElementById('zoom-level');
    if (zoomText) zoomText.textContent = zoom.toFixed(1) + 'x';
  }

  // Pinch-to-zoom
  let touchStartPoints = [];
  let touchWasPinch = false;

  function handleTouchStart(e) {
    if (e.touches.length === 2) {
      e.preventDefault();
      touchWasPinch = true;
      lastPinchDist = getPinchDist(e.touches);
      lastPanX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      lastPanY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    } else if (e.touches.length === 1 && zoom > 1) {
      // Pan with one finger when zoomed
      touchWasPinch = false;
      isPanning = true;
      lastPanX = e.touches[0].clientX;
      lastPanY = e.touches[0].clientY;
    } else {
      touchWasPinch = false;
    }
  }

  function handleTouchMove(e) {
    if (e.touches.length === 2) {
      e.preventDefault();
      const dist = getPinchDist(e.touches);
      const scale = dist / lastPinchDist;
      const oldZoom = zoom;
      zoom = Math.max(1, Math.min(5, zoom * scale));
      lastPinchDist = dist;

      // Pan while pinching
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      panX += cx - lastPanX;
      panY += cy - lastPanY;
      lastPanX = cx;
      lastPanY = cy;
      clampPan();
      applyTransform();
    } else if (e.touches.length === 1 && isPanning && zoom > 1) {
      e.preventDefault();
      panX += e.touches[0].clientX - lastPanX;
      panY += e.touches[0].clientY - lastPanY;
      lastPanX = e.touches[0].clientX;
      lastPanY = e.touches[0].clientY;
      clampPan();
      applyTransform();
    }
  }

  function handleTouchEnd(e) {
    isPanning = false;
    if (zoom <= 1) { panX = 0; panY = 0; applyTransform(); }
  }

  function getPinchDist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // Mouse wheel zoom
  function handleWheel(e) {
    e.preventDefault();
    adjustZoom(e.deltaY < 0 ? 0.3 : -0.3);
  }

  // Mouse drag pan
  function handleMouseDown(e) {
    if (zoom > 1) {
      isPanning = true;
      lastPanX = e.clientX;
      lastPanY = e.clientY;
    }
  }

  function handleMouseMove(e) {
    if (!isPanning) return;
    panX += e.clientX - lastPanX;
    panY += e.clientY - lastPanY;
    lastPanX = e.clientX;
    lastPanY = e.clientY;
    clampPan();
    applyTransform();
  }

  function handleMouseUp() {
    isPanning = false;
  }

  // --- Marking ---
  function startMarking() {
    markingIndex = 0;
    points = {};
    zoom = 1; panX = 0; panY = 0;
    goToStep('marking');

    const img = new Image();
    img.onload = () => {
      imageNaturalWidth = img.width;
      imageNaturalHeight = img.height;
      resizeMarkingCanvas();
      applyTransform();
      updateMarkingUI();
    };
    img.src = previewImg.src;
    markingImg.src = previewImg.src;
  }

  function resizeMarkingCanvas() {
    const container = markingContent;
    const w = container.clientWidth;
    const ratio = imageNaturalHeight / imageNaturalWidth;
    const h = Math.round(w * ratio);
    markingCanvas.width = w;
    markingCanvas.height = h;
    markingCanvas.style.height = h + 'px';
    markingImg.style.height = h + 'px';
    redrawMarks();
  }

  function handleMarkingTouch(e) {
    // Don't register tap if user was pinching or panning
    if (touchWasPinch || e.touches.length > 0) return;
    e.preventDefault();
    const touch = e.changedTouches[0];
    const rect = markingCanvas.getBoundingClientRect();
    const x = (touch.clientX - rect.left) * (markingCanvas.width / rect.width);
    const y = (touch.clientY - rect.top) * (markingCanvas.height / rect.height);
    addMark(x, y);
  }

  function handleMarkingTap(e) {
    // Don't place mark if we were panning
    if (isPanning) return;
    const rect = markingCanvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (markingCanvas.width / rect.width);
    const y = (e.clientY - rect.top) * (markingCanvas.height / rect.height);
    addMark(x, y);
  }

  function addMark(canvasX, canvasY) {
    if (markingIndex >= MARKING_STEPS.length) return;

    const step = MARKING_STEPS[markingIndex];

    // Convert canvas coords to image coords (for sending to backend)
    const scaleX = imageNaturalWidth / markingCanvas.width;
    const scaleY = imageNaturalHeight / markingCanvas.height;

    points[step.id] = {
      cx: canvasX,
      cy: canvasY,
      x: canvasX * scaleX,
      y: canvasY * scaleY,
    };

    markingIndex++;
    redrawMarks();
    updateMarkingUI();

    if (markingIndex >= MARKING_STEPS.length) {
      setTimeout(submitMeasurement, 300);
    }
  }

  function undoMark() {
    if (markingIndex <= 0) return;
    markingIndex--;
    const step = MARKING_STEPS[markingIndex];
    delete points[step.id];
    redrawMarks();
    updateMarkingUI();
  }

  function redrawMarks() {
    markingCtx.clearRect(0, 0, markingCanvas.width, markingCanvas.height);

    drawLineBetween('card1', 'card2', '#f59e0b');
    drawLineBetween('heel', 'toe', '#2563eb');
    drawLineBetween('widthL', 'widthR', '#16a34a');

    // Scale marker sizes inversely with zoom so they stay tappable
    var markerSize = Math.max(8, 14 / zoom);
    var dotSize = Math.max(3, 5 / zoom);
    var lineWidth = Math.max(1.5, 3 / zoom);
    var fontSize = Math.max(8, 11 / zoom);

    for (let i = 0; i < markingIndex; i++) {
      const step = MARKING_STEPS[i];
      const p = points[step.id];
      if (!p) continue;

      markingCtx.beginPath();
      markingCtx.arc(p.cx, p.cy, markerSize, 0, Math.PI * 2);
      markingCtx.strokeStyle = step.color;
      markingCtx.lineWidth = lineWidth;
      markingCtx.stroke();

      markingCtx.beginPath();
      markingCtx.arc(p.cx, p.cy, dotSize, 0, Math.PI * 2);
      markingCtx.fillStyle = step.color;
      markingCtx.fill();

      markingCtx.font = 'bold ' + fontSize + 'px sans-serif';
      markingCtx.fillStyle = '#fff';
      markingCtx.strokeStyle = 'rgba(0,0,0,0.7)';
      markingCtx.lineWidth = Math.max(1, 3 / zoom);
      const label = step.id.replace('widthL', 'L').replace('widthR', 'R');
      markingCtx.strokeText(label, p.cx + markerSize + 4, p.cy + 4);
      markingCtx.fillText(label, p.cx + markerSize + 4, p.cy + 4);
    }
  }

  function drawLineBetween(id1, id2, color) {
    if (!points[id1] || !points[id2]) return;
    markingCtx.beginPath();
    markingCtx.moveTo(points[id1].cx, points[id1].cy);
    markingCtx.lineTo(points[id2].cx, points[id2].cy);
    markingCtx.strokeStyle = color;
    markingCtx.lineWidth = Math.max(1, 2 / zoom);
    markingCtx.setLineDash([6, 4]);
    markingCtx.stroke();
    markingCtx.setLineDash([]);
  }

  function updateMarkingUI() {
    const label = document.getElementById('marking-instruction');
    const undoBtn = document.getElementById('btn-undo-mark');
    const progress = document.getElementById('marking-progress');

    if (markingIndex < MARKING_STEPS.length) {
      label.textContent = MARKING_STEPS[markingIndex].label;
      label.style.borderLeftColor = MARKING_STEPS[markingIndex].color;
    } else {
      label.textContent = 'All points marked! Calculating...';
      label.style.borderLeftColor = '#16a34a';
    }

    undoBtn.style.display = markingIndex > 0 ? 'flex' : 'none';
    progress.textContent = markingIndex + ' / ' + MARKING_STEPS.length;
  }

  // --- Submit ---
  async function submitMeasurement() {
    goToStep('loading');

    const body = {
      card_point1: { x: points.card1.x, y: points.card1.y },
      card_point2: { x: points.card2.x, y: points.card2.y },
      heel_point: { x: points.heel.x, y: points.heel.y },
      toe_point: { x: points.toe.x, y: points.toe.y },
      image_width: imageNaturalWidth,
      image_height: imageNaturalHeight,
    };
    if (points.widthL && points.widthR) {
      body.width_left = { x: points.widthL.x, y: points.widthL.y };
      body.width_right = { x: points.widthR.x, y: points.widthR.y };
    }

    try {
      const resp = await fetch(API_BASE + '/api/measure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const err = await resp.json();
        const detail = err.detail || err;
        showError(detail.error || 'Measurement failed', detail.error_code, detail.tips || []);
        return;
      }

      const data = await resp.json();
      showResults(data);
    } catch (err) {
      showError('Network error. Please check your connection and try again.', 'NETWORK_ERROR', []);
    }
  }

  function showResults(data) {
    const scan = data.scan;
    const recs = data.recommendations;

    document.getElementById('result-length').textContent = scan.foot_length_cm;
    document.getElementById('result-width').textContent = scan.foot_width_cm || '\u2014';

    const confPct = Math.round(scan.confidence * 100);
    const confEl = document.getElementById('confidence-fill-inner');
    confEl.style.width = confPct + '%';
    confEl.className = confPct >= 70 ? 'confidence-high' : confPct >= 40 ? 'confidence-medium' : 'confidence-low';
    document.getElementById('confidence-text').textContent = confPct + '% confidence';

    const recContainer = document.getElementById('recommendations');
    recContainer.innerHTML = '';

    if (recs.length === 0) {
      recContainer.innerHTML = '<p style="color:var(--text-muted);text-align:center;">No size match found. Try manual entry.</p>';
    } else {
      recs.forEach(rec => {
        const div = document.createElement('div');
        div.className = 'size-rec';
        let html = '<div class="size-rec-header">' +
          '<span class="size-rec-brand">' + esc(rec.brand) + ' \u2014 ' + esc(rec.model) + '</span>' +
          '<span class="size-rec-size">' + esc(rec.recommended_size) + '</span></div>' +
          '<div class="size-rec-details">US ' + rec.us_size + ' \u00b7 UK ' + rec.uk_size + ' \u00b7 Width: ' + rec.width_category + '</div>';
        if (rec.note) html += '<div class="size-rec-note">' + esc(rec.note) + '</div>';
        if (rec.alternative_size) html += '<div class="size-rec-alt">Alternative: ' + esc(rec.alternative_size) + '</div>';
        div.innerHTML = html;
        recContainer.appendChild(div);
      });
    }

    window.parent.postMessage({ type: 'foot-scanner-result', scan: scan, recommendations: recs }, '*');
    goToStep('results');
  }

  function showError(message, code, tips) {
    document.getElementById('error-message').textContent = message;
    const tipsEl = document.getElementById('error-tips');
    tipsEl.innerHTML = '';
    tips.forEach(tip => {
      const li = document.createElement('li');
      li.textContent = tip;
      tipsEl.appendChild(li);
    });
    goToStep('error');
  }

  async function submitManual() {
    const lengthCm = parseFloat(document.getElementById('manual-length').value);
    const widthCm = parseFloat(document.getElementById('manual-width').value);
    if (!lengthCm || lengthCm < 15 || lengthCm > 35) {
      alert('Please enter a valid foot length between 15 and 35 cm');
      return;
    }
    goToStep('loading');
    const params = new URLSearchParams({ length_mm: Math.round(lengthCm * 10) });
    if (widthCm) params.append('width_mm', Math.round(widthCm * 10));
    try {
      const resp = await fetch(API_BASE + '/api/recommend?' + params);
      const data = await resp.json();
      showResults({
        scan: {
          foot_length_mm: lengthCm * 10, foot_width_mm: (widthCm || 0) * 10,
          foot_length_cm: lengthCm, foot_width_cm: widthCm || 0, confidence: 1.0,
        },
        recommendations: data.recommendations,
      });
    } catch (err) {
      showError('Network error. Please check your connection.', 'NETWORK_ERROR', []);
    }
  }

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
