// Layerbit shared behaviors: icon init + FAQ accordion, used on every page.
document.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) lucide.createIcons();

  // The lucide script tag is async, so DOMContentLoaded can fire before it's
  // finished loading (especially on slower mobile connections) -- in that
  // case the call above silently no-ops and every icon on the page is stuck
  // as an empty placeholder forever, since nothing ever retries. `load`
  // fires only once every subresource (async scripts included) has finished,
  // so it's a guaranteed second chance; calling createIcons() again is a
  // harmless no-op for anything already converted.
  if (!window.lucide) {
    window.addEventListener("load", () => {
      if (window.lucide) lucide.createIcons();
    });
  }

  document.querySelectorAll('.faq-question').forEach(button => {
    button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', () => {
      const answer = button.nextElementSibling;
      const isActive = button.classList.contains('active');

      document.querySelectorAll('.faq-question').forEach(btn => {
        btn.classList.remove('active');
        btn.setAttribute('aria-expanded', 'false');
        btn.nextElementSibling.style.maxHeight = null;
      });

      if (!isActive) {
        button.classList.add('active');
        button.setAttribute('aria-expanded', 'true');
        answer.style.maxHeight = answer.scrollHeight + "px";
      }
    });
  });

  initCookieConsent();
});

// Cookie consent banner: AdSense, Google Analytics, and (on the LayerLink
// tools) Firebase all set cookies before any visitor interaction, so a
// dismissible notice is shown until the visitor accepts it once.
function initCookieConsent() {
  try {
    if (localStorage.getItem('layerbit-cookie-consent') === 'accepted') return;
  } catch (e) {
    return; // storage unavailable (e.g. blocked) - don't block rendering over it
  }

  const prefix = location.pathname.includes('/tools/') ? '../' : '';
  const banner = document.createElement('div');
  banner.className = 'cookie-consent-banner';
  banner.setAttribute('role', 'region');
  banner.setAttribute('aria-label', 'Cookie notice');
  banner.innerHTML =
    '<p>Layerbit uses cookies for analytics and ads, and (on tools that need it) for core functionality. ' +
    'See our <a href="' + prefix + 'privacy.html">Privacy Policy</a> for details.</p>' +
    '<button type="button" class="cookie-consent-accept">Accept</button>';
  document.body.appendChild(banner);

  banner.querySelector('.cookie-consent-accept').addEventListener('click', () => {
    try { localStorage.setItem('layerbit-cookie-consent', 'accepted'); } catch (e) {}
    banner.remove();
  });
}
