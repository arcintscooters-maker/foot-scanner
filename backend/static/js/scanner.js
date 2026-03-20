(function () {
  'use strict';

  const API_BASE = window.FOOT_SCANNER_API || window.location.origin;

  let currentStep = 'instructions';
  let stream = null;
  let capturedBlob = null;

  const MARKING_STEPS = [
    { id: 'card1', label: 'Tap one end of the card\u2019s long edge', color: '#f59e0b' },
    { id: 'card2', label: 'Tap the other end of the card\u2019s long edge', color: '#f59e0b' },
    { id: 'heel', label: 'Tap the back of your heel', color: '#2563eb' },
    { id: 'toe', label: 'Tap the tip of your longest toe', color: '#2563eb' },
    { id: 'widthL', label: 'Tap the widest left point of your foot', color: '#16a34a' },
    { id: 'widthR', label: 'Tap the widest right point of your foot', color: '#16a34a' },
  ];
  let markingIndex = 0;
  let points = {};
  let imageNaturalWidth = 0;
  let imageNaturalHeight = 0;

  // Zoom/pan state
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let markingWrapper = null;
  let markingContent = null;

  // Touch tracking — the key to separating gestures from taps
  let touchStartTime = 0;
  let touchStartPos = null;
  let touchMoved = false;
  let wasPinching = false;
  let isPanning = false;
  let lastPanX = 0;
  let lastPanY = 0;
  let lastPinchDist = 0;

  // Thresholds
  const TAP_MAX_DURATION = 300;   // ms
  const TAP_MAX_DISTANCE = 12;    // px movement allowed for a tap

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
    document.getElementById('btn-exit-marking').addEventListener('click', () => goToStep('preview'));

    // ALL touch/mouse goes on the wrapper — single handler decides tap vs gesture
    markingWrapper.addEventListener('touchstart', onTouchStart, { passive: false });
    markingWrapper.addEventListener('touchmove', onTouchMove, { passive: false });
    markingWrapper.addEventListener('touchend', onTouchEnd, { passive: false });
    markingWrapper.addEventListener('wheel', onWheel, { passive: false });

    // Desktop click for marking (no conflict since no pinch)
    markingCanvas.addEventListener('click', onDesktopClick);

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
    // Toggle fullscreen body class for marking
    document.body.classList.toggle('marking-fullscreen', name === 'marking');
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

  // ============================================
  // TOUCH HANDLING — unified gesture detection
  // ============================================

  function onTouchStart(e) {
    if (e.touches.length === 2) {
      // Pinch start
      e.preventDefault();
      wasPinching = true;
      touchMoved = true;
      lastPinchDist = pinchDist(e.touches);
      lastPanX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      lastPanY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    } else if (e.touches.length === 1) {
      // Could be a tap or a pan — record start
      wasPinching = false;
      touchMoved = false;
      touchStartTime = Date.now();
      touchStartPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };

      if (zoom > 1) {
        // Might be panning
        lastPanX = e.touches[0].clientX;
        lastPanY = e.touches[0].clientY;
      }
    }
  }

  function onTouchMove(e) {
    if (e.touches.length === 2) {
      // Pinch zoom + pan
      e.preventDefault();
      wasPinching = true;
      touchMoved = true;

      const dist = pinchDist(e.touches);
      const scale = dist / lastPinchDist;
      zoom = Math.max(1, Math.min(5, zoom * scale));
      lastPinchDist = dist;

      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      panX += cx - lastPanX;
      panY += cy - lastPanY;
      lastPanX = cx;
      lastPanY = cy;

      clampPan();
      applyTransform();
      return;
    }

    if (e.touches.length === 1 && touchStartPos) {
      const dx = e.touches[0].clientX - touchStartPos.x;
      const dy = e.touches[0].clientY - touchStartPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > TAP_MAX_DISTANCE) {
        touchMoved = true;
      }

      // Pan when zoomed
      if (zoom > 1 && touchMoved) {
        e.preventDefault();
        panX += e.touches[0].clientX - lastPanX;
        panY += e.touches[0].clientY - lastPanY;
        lastPanX = e.touches[0].clientX;
        lastPanY = e.touches[0].clientY;
        clampPan();
        applyTransform();
      }
    }
  }

  function onTouchEnd(e) {
    // If was pinching, just reset and ignore
    if (wasPinching) {
      wasPinching = e.touches.length > 0;
      if (zoom <= 1) { panX = 0; panY = 0; applyTransform(); }
      return;
    }

    // Check if this qualifies as a TAP (short, didn't move)
    if (e.changedTouches.length === 1 && !touchMoved && e.touches.length === 0) {
      const elapsed = Date.now() - touchStartTime;
      if (elapsed < TAP_MAX_DURATION) {
        e.preventDefault();
        const touch = e.changedTouches[0];
        placeMark(touch.clientX, touch.clientY);
      }
    }

    touchStartPos = null;
    if (zoom <= 1) { panX = 0; panY = 0; applyTransform(); }
  }

  function onWheel(e) {
    e.preventDefault();
    adjustZoom(e.deltaY < 0 ? 0.3 : -0.3);
  }

  function onDesktopClick(e) {
    // Desktop only — on touch devices the touchend handler does it
    if ('ontouchstart' in window) return;
    placeMark(e.clientX, e.clientY);
  }

  function pinchDist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // ============================================
  // ZOOM
  // ============================================

  function adjustZoom(delta) {
    zoom = Math.max(1, Math.min(5, zoom + delta));
    if (zoom <= 1) { panX = 0; panY = 0; }
    clampPan();
    applyTransform();
    redrawMarks();
  }

  function resetZoom() {
    zoom = 1; panX = 0; panY = 0;
    applyTransform();
    redrawMarks();
  }

  function clampPan() {
    const maxX = (markingContent.offsetWidth * (zoom - 1)) / 2;
    const maxY = (markingContent.offsetHeight * (zoom - 1)) / 2;
    panX = Math.max(-maxX, Math.min(maxX, panX));
    panY = Math.max(-maxY, Math.min(maxY, panY));
  }

  function applyTransform() {
    markingContent.style.transform = 'translate(' + panX + 'px,' + panY + 'px) scale(' + zoom + ')';
    var el = document.getElementById('zoom-level');
    if (el) el.textContent = zoom.toFixed(1) + 'x';
  }

  // ============================================
  // MARKING
  // ============================================

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
    const w = markingContent.clientWidth;
    const ratio = imageNaturalHeight / imageNaturalWidth;
    const h = Math.round(w * ratio);
    markingCanvas.width = w;
    markingCanvas.height = h;
    markingCanvas.style.height = h + 'px';
    markingImg.style.height = h + 'px';
    redrawMarks();
  }

  function placeMark(clientX, clientY) {
    if (markingIndex >= MARKING_STEPS.length) return;

    // Convert screen coords → canvas coords (accounting for zoom + pan)
    const rect = markingCanvas.getBoundingClientRect();
    const canvasX = (clientX - rect.left) * (markingCanvas.width / rect.width);
    const canvasY = (clientY - rect.top) * (markingCanvas.height / rect.height);

    // Bounds check
    if (canvasX < 0 || canvasY < 0 || canvasX > markingCanvas.width || canvasY > markingCanvas.height) return;

    const step = MARKING_STEPS[markingIndex];
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
      setTimeout(submitMeasurement, 400);
    }
  }

  function undoMark() {
    if (markingIndex <= 0) return;
    markingIndex--;
    delete points[MARKING_STEPS[markingIndex].id];
    redrawMarks();
    updateMarkingUI();
  }

  function redrawMarks() {
    markingCtx.clearRect(0, 0, markingCanvas.width, markingCanvas.height);

    drawLine('card1', 'card2', '#f59e0b');
    drawLine('heel', 'toe', '#2563eb');
    drawLine('widthL', 'widthR', '#16a34a');

    for (let i = 0; i < markingIndex; i++) {
      const step = MARKING_STEPS[i];
      const p = points[step.id];
      if (!p) continue;

      // Ring
      markingCtx.beginPath();
      markingCtx.arc(p.cx, p.cy, 14, 0, Math.PI * 2);
      markingCtx.strokeStyle = step.color;
      markingCtx.lineWidth = 3;
      markingCtx.stroke();

      // Dot
      markingCtx.beginPath();
      markingCtx.arc(p.cx, p.cy, 5, 0, Math.PI * 2);
      markingCtx.fillStyle = step.color;
      markingCtx.fill();

      // Label
      markingCtx.font = 'bold 11px sans-serif';
      markingCtx.fillStyle = '#fff';
      markingCtx.strokeStyle = 'rgba(0,0,0,0.7)';
      markingCtx.lineWidth = 3;
      var lbl = step.id.replace('widthL', 'L').replace('widthR', 'R');
      markingCtx.strokeText(lbl, p.cx + 18, p.cy + 4);
      markingCtx.fillText(lbl, p.cx + 18, p.cy + 4);
    }
  }

  function drawLine(id1, id2, color) {
    if (!points[id1] || !points[id2]) return;
    markingCtx.beginPath();
    markingCtx.moveTo(points[id1].cx, points[id1].cy);
    markingCtx.lineTo(points[id2].cx, points[id2].cy);
    markingCtx.strokeStyle = color;
    markingCtx.lineWidth = 2;
    markingCtx.setLineDash([6, 4]);
    markingCtx.stroke();
    markingCtx.setLineDash([]);
  }

  function updateMarkingUI() {
    var label = document.getElementById('marking-instruction');
    var undoBtn = document.getElementById('btn-undo-mark');
    var progress = document.getElementById('marking-progress');

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

  // ============================================
  // SUBMIT
  // ============================================

  async function submitMeasurement() {
    goToStep('loading');

    var body = {
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
      var resp = await fetch(API_BASE + '/api/measure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        var err = await resp.json();
        var detail = err.detail || err;
        showError(detail.error || 'Measurement failed', detail.error_code, detail.tips || []);
        return;
      }
      showResults(await resp.json());
    } catch (err) {
      showError('Network error. Please check your connection.', 'NETWORK_ERROR', []);
    }
  }

  function showResults(data) {
    var scan = data.scan;
    var recs = data.recommendations;
    document.getElementById('result-length').textContent = scan.foot_length_cm;
    document.getElementById('result-width').textContent = scan.foot_width_cm || '\u2014';
    var confPct = Math.round(scan.confidence * 100);
    var confEl = document.getElementById('confidence-fill-inner');
    confEl.style.width = confPct + '%';
    confEl.className = confPct >= 70 ? 'confidence-high' : confPct >= 40 ? 'confidence-medium' : 'confidence-low';
    document.getElementById('confidence-text').textContent = confPct + '% confidence';
    var rc = document.getElementById('recommendations');
    rc.innerHTML = '';
    if (recs.length === 0) {
      rc.innerHTML = '<p style="color:var(--text-muted);text-align:center;">No size match found.</p>';
    } else {
      recs.forEach(function (rec) {
        var d = document.createElement('div');
        d.className = 'size-rec';
        var h = '<div class="size-rec-header"><span class="size-rec-brand">' + esc(rec.brand) + ' \u2014 ' + esc(rec.model) + '</span><span class="size-rec-size">' + esc(rec.recommended_size) + '</span></div><div class="size-rec-details">US ' + rec.us_size + ' \u00b7 UK ' + rec.uk_size + ' \u00b7 Width: ' + rec.width_category + '</div>';
        if (rec.note) h += '<div class="size-rec-note">' + esc(rec.note) + '</div>';
        if (rec.alternative_size) h += '<div class="size-rec-alt">Alternative: ' + esc(rec.alternative_size) + '</div>';
        d.innerHTML = h;
        rc.appendChild(d);
      });
    }
    window.parent.postMessage({ type: 'foot-scanner-result', scan: scan, recommendations: recs }, '*');
    goToStep('results');
  }

  function showError(msg, code, tips) {
    document.getElementById('error-message').textContent = msg;
    var el = document.getElementById('error-tips');
    el.innerHTML = '';
    tips.forEach(function (t) { var li = document.createElement('li'); li.textContent = t; el.appendChild(li); });
    goToStep('error');
  }

  async function submitManual() {
    var lc = parseFloat(document.getElementById('manual-length').value);
    var wc = parseFloat(document.getElementById('manual-width').value);
    if (!lc || lc < 15 || lc > 35) { alert('Enter a valid foot length (15-35 cm)'); return; }
    goToStep('loading');
    var p = new URLSearchParams({ length_mm: Math.round(lc * 10) });
    if (wc) p.append('width_mm', Math.round(wc * 10));
    try {
      var r = await fetch(API_BASE + '/api/recommend?' + p);
      var d = await r.json();
      showResults({ scan: { foot_length_mm: lc * 10, foot_width_mm: (wc || 0) * 10, foot_length_cm: lc, foot_width_cm: wc || 0, confidence: 1.0 }, recommendations: d.recommendations });
    } catch (e) { showError('Network error.', 'NETWORK_ERROR', []); }
  }

  function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
