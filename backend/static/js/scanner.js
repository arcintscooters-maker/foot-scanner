(function () {
  'use strict';

  const API_BASE = window.FOOT_SCANNER_API || window.location.origin;

  // State
  let currentStep = 'instructions';
  let stream = null;
  let capturedBlob = null;

  // DOM refs (set after init)
  let steps = {};
  let videoEl, canvasEl, previewImg;

  function init() {
    steps = {
      instructions: document.getElementById('step-instructions'),
      camera: document.getElementById('step-camera'),
      preview: document.getElementById('step-preview'),
      loading: document.getElementById('step-loading'),
      results: document.getElementById('step-results'),
      error: document.getElementById('step-error'),
      manual: document.getElementById('step-manual'),
    };

    videoEl = document.getElementById('camera-video');
    canvasEl = document.getElementById('camera-canvas');
    previewImg = document.getElementById('preview-image');

    // Button handlers
    document.getElementById('btn-start-camera').addEventListener('click', startCamera);
    document.getElementById('btn-upload').addEventListener('click', () => {
      document.getElementById('file-input').click();
    });
    document.getElementById('file-input').addEventListener('change', handleFileUpload);
    document.getElementById('btn-capture').addEventListener('click', capturePhoto);
    document.getElementById('btn-retake').addEventListener('click', () => goToStep('camera'));
    document.getElementById('btn-analyze').addEventListener('click', analyzePhoto);
    document.getElementById('btn-try-again').addEventListener('click', () => goToStep('instructions'));
    document.getElementById('btn-manual').addEventListener('click', () => goToStep('manual'));
    document.getElementById('btn-manual-submit').addEventListener('click', submitManual);
    document.getElementById('btn-scan-again').addEventListener('click', () => goToStep('instructions'));
    document.getElementById('btn-error-manual').addEventListener('click', () => goToStep('manual'));

    goToStep('instructions');
  }

  function goToStep(name) {
    currentStep = name;
    Object.values(steps).forEach(el => el && el.classList.remove('active'));
    if (steps[name]) steps[name].classList.add('active');

    // Stop camera if leaving camera step
    if (name !== 'camera' && stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
  }

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
    const settings = track.getSettings();
    canvasEl.width = settings.width || videoEl.videoWidth;
    canvasEl.height = settings.height || videoEl.videoHeight;

    const ctx = canvasEl.getContext('2d');
    ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);

    canvasEl.toBlob(blob => {
      capturedBlob = blob;
      previewImg.src = URL.createObjectURL(blob);
      goToStep('preview');
    }, 'image/jpeg', 0.9);
  }

  function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    // Compress if needed
    compressImage(file, (blob) => {
      capturedBlob = blob;
      previewImg.src = URL.createObjectURL(blob);
      goToStep('preview');
    });
    // Reset input so same file can be re-selected
    e.target.value = '';
  }

  function compressImage(file, callback) {
    const img = new Image();
    img.onload = () => {
      const MAX = 2000;
      let w = img.width, h = img.height;
      if (w > MAX || h > MAX) {
        const ratio = Math.min(MAX / w, MAX / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob(callback, 'image/jpeg', 0.85);
    };
    img.src = URL.createObjectURL(file);
  }

  async function analyzePhoto() {
    if (!capturedBlob) return;
    goToStep('loading');

    const formData = new FormData();
    formData.append('image', capturedBlob, 'foot.jpg');

    try {
      const resp = await fetch(API_BASE + '/api/scan', {
        method: 'POST',
        body: formData,
      });

      if (!resp.ok) {
        const err = await resp.json();
        const detail = err.detail || err;
        showError(detail.error || 'Scan failed', detail.error_code, detail.tips || []);
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
    document.getElementById('result-width').textContent = scan.foot_width_cm;

    // Confidence bar
    const confPct = Math.round(scan.confidence * 100);
    const confEl = document.getElementById('confidence-fill-inner');
    confEl.style.width = confPct + '%';
    confEl.className = confPct >= 70 ? 'confidence-high' :
                       confPct >= 40 ? 'confidence-medium' : 'confidence-low';
    document.getElementById('confidence-text').textContent = confPct + '% confidence';

    // Recommendations
    const recContainer = document.getElementById('recommendations');
    recContainer.innerHTML = '';

    if (recs.length === 0) {
      recContainer.innerHTML = '<p style="color:var(--text-muted);text-align:center;">No size match found. Try manual entry.</p>';
    } else {
      recs.forEach(rec => {
        const div = document.createElement('div');
        div.className = 'size-rec';
        let html = `
          <div class="size-rec-header">
            <span class="size-rec-brand">${esc(rec.brand)} — ${esc(rec.model)}</span>
            <span class="size-rec-size">${esc(rec.recommended_size)}</span>
          </div>
          <div class="size-rec-details">
            US ${rec.us_size} · UK ${rec.uk_size} · Width: ${rec.width_category}
          </div>`;
        if (rec.note) {
          html += `<div class="size-rec-note">${esc(rec.note)}</div>`;
        }
        if (rec.alternative_size) {
          html += `<div class="size-rec-alt">Alternative: ${esc(rec.alternative_size)}</div>`;
        }
        div.innerHTML = html;
        recContainer.appendChild(div);
      });
    }

    // Send results via postMessage for embed integration
    window.parent.postMessage({
      type: 'foot-scanner-result',
      scan: scan,
      recommendations: recs,
    }, '*');

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
          foot_length_mm: lengthCm * 10,
          foot_width_mm: (widthCm || 0) * 10,
          foot_length_cm: lengthCm,
          foot_width_cm: widthCm || 0,
          confidence: 1.0,
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

  // Init when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
