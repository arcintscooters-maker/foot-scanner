/**
 * Foot Scanner Embed Loader
 *
 * Usage:
 *   <script src="https://your-app.railway.app/static/js/embed-loader.js"></script>
 *   <div id="foot-scanner"></div>
 *
 * Options (data attributes on the script tag):
 *   data-container="foot-scanner"  — ID of container element (default: "foot-scanner")
 *   data-height="700"              — Initial height in px (default: 700)
 *   data-theme-color="#2563eb"      — Primary color (future use)
 */
(function () {
  'use strict';

  // Find the script tag to read config
  var scripts = document.getElementsByTagName('script');
  var currentScript = scripts[scripts.length - 1];
  var scriptSrc = currentScript.src;

  // Derive base URL from script src
  var baseUrl = scriptSrc.replace(/\/static\/js\/embed-loader\.js.*$/, '');

  // Read config
  var containerId = currentScript.getAttribute('data-container') || 'foot-scanner';
  var initialHeight = parseInt(currentScript.getAttribute('data-height') || '700', 10);

  function createEmbed() {
    var container = document.getElementById(containerId);
    if (!container) {
      console.error('[Foot Scanner] Container #' + containerId + ' not found');
      return;
    }

    var iframe = document.createElement('iframe');
    iframe.src = baseUrl + '/embed';
    iframe.style.width = '100%';
    iframe.style.height = initialHeight + 'px';
    iframe.style.border = 'none';
    iframe.style.borderRadius = '12px';
    iframe.style.maxWidth = '480px';
    iframe.style.display = 'block';
    iframe.style.margin = '0 auto';
    iframe.setAttribute('allow', 'camera');
    iframe.setAttribute('allowfullscreen', '');
    iframe.title = 'Foot Scanner';

    container.appendChild(iframe);

    // Listen for resize messages from the iframe
    window.addEventListener('message', function (e) {
      if (!e.data || e.data.type !== 'foot-scanner-resize') return;
      iframe.style.height = e.data.height + 'px';
    });

    // Listen for result messages and re-dispatch on the container
    window.addEventListener('message', function (e) {
      if (!e.data || e.data.type !== 'foot-scanner-result') return;
      var event = new CustomEvent('foot-scanner-result', { detail: e.data });
      container.dispatchEvent(event);
    });
  }

  // Init when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createEmbed);
  } else {
    createEmbed();
  }
})();
