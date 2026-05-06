// ── i18n ENGINE ──────────────────────────────────────────────
const I18N = {
  en: {
    'nav.products':  'Products',
    'nav.solutions': 'Solutions',
    'nav.about':     'About Us',
    'nav.pricing':   'Pricing',
    'nav.policy':    'Policy',
    'nav.cta':       'Open Account',
    'hero.title':    'Banking built for you',
    'hero.sub':      'Open an account in minutes. No hidden fees.',
    // add all your keys here
  },
  fr: {
    'nav.products':  'Produits',
    'nav.solutions': 'Solutions',
    'nav.about':     'À propos',
    'nav.pricing':   'Tarifs',
    'nav.policy':    'Politique',
    'nav.cta':       'Ouvrir un compte',
    'hero.title':    'La banque faite pour vous',
    'hero.sub':      'Ouvrez un compte en quelques minutes.',
  },
  es: { /* ... */ },
  de: { /* ... */ },
  ar: { /* ... */ },
  zh: { /* ... */ },
  // etc.
};

function applyTranslations(lang) {
  const t = I18N[lang] || I18N['en'];

  // Swap every element that has data-i18n="some.key"
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (t[key]) el.textContent = t[key];
  });

  // Swap placeholders too (for inputs)
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (t[key]) el.placeholder = t[key];
  });

  // RTL support for Arabic
  document.documentElement.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
  document.documentElement.setAttribute('lang', lang);
}

// ── Run on page load ─────────────────────────────────────────
(function () {
  const saved = localStorage.getItem('finora_lang')
             || new URLSearchParams(window.location.search).get('lang')
             || 'en';
  applyTranslations(saved);
})();