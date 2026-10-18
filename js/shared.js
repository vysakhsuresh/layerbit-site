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

// Cookie consent banner. The visitor can accept or reject non-essential
// cookies (advertising and analytics); the choice is stored in localStorage,
// sent to Google Consent Mode v2 immediately, and re-applied on every later
// page load by the consent snippet in <head> before any Google tag runs.
// "Your privacy choices" in the footer reopens it. If Google's own consent
// message (the AdSense Privacy & messaging CMP, used for EEA/UK visitors) is
// on the page, it takes precedence and this banner stands aside.
function applyConsent(choice) {
  var v = choice === 'accepted' ? 'granted' : 'denied';
  try { if (typeof window.gtag === 'function') window.gtag('consent', 'update', { ad_storage: v, ad_user_data: v, ad_personalization: v, analytics_storage: v }); } catch (e) {}
}
function initCookieConsent(force) {
  var stored = null;
  try { stored = localStorage.getItem('layerbit-cookie-consent'); } catch (e) { return; }
  if (!force && (stored === 'accepted' || stored === 'rejected')) return;
  if (document.querySelector('.cookie-consent-banner')) return;

  var depth = location.pathname.split('/').filter(Boolean).length - 1;
  var prefix = '../'.repeat(Math.max(0, depth));
  var banner = document.createElement('div');
  banner.className = 'cookie-consent-banner';
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-live', 'polite');
  banner.setAttribute('aria-label', 'Cookie choices');
  banner.innerHTML =
    '<p>We use cookies to show ads (Google AdSense) and to measure which pages are useful (Google Analytics). ' +
    'The tools themselves need none. Choose whether to allow them; you can change this any time from the footer. ' +
    '<a href="' + prefix + 'privacy.html#cookies">Privacy Policy</a></p>' +
    '<div class="cookie-consent-actions">' +
    '<button type="button" class="cookie-consent-reject">Reject all</button>' +
    '<button type="button" class="cookie-consent-accept">Accept all</button>' +
    '</div>';
  document.body.appendChild(banner);
  function choose(choice) {
    try { localStorage.setItem('layerbit-cookie-consent', choice); } catch (e) {}
    applyConsent(choice);
    banner.remove();
  }
  banner.querySelector('.cookie-consent-accept').addEventListener('click', function () { choose('accepted'); });
  banner.querySelector('.cookie-consent-reject').addEventListener('click', function () { choose('rejected'); });

  // Defer to Google's certified CMP when it renders (EEA/UK/CH visitors).
  if (!force) {
    var checks = 0, t = setInterval(function () {
      checks++;
      if (document.querySelector('.fc-consent-root, .fc-dialog-container')) { banner.remove(); clearInterval(t); }
      if (checks > 20) clearInterval(t);
    }, 300);
  }
}
document.addEventListener('click', function (e) {
  var a = e.target.closest && e.target.closest('[data-cookie-settings]');
  if (!a) return;
  e.preventDefault();
  if (window.googlefc && typeof window.googlefc.showRevocationMessage === 'function' && document.querySelector('.fc-consent-root')) { window.googlefc.showRevocationMessage(); return; }
  initCookieConsent(true);
});
