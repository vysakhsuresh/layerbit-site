// Layerbit shared behaviors: icon init + FAQ accordion, used on every page.
document.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) lucide.createIcons();

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
});
