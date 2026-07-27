(() => {
  const themeToggleBtn = document.querySelector('#themeToggleBtn');
  if (!themeToggleBtn) return;

  const themes = ['system', 'light', 'dark'];
  const labels = { system: 'System', light: 'Light', dark: 'Dark' };
  const icons = {
    system: '<svg class="themeIcon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"></rect><path d="M8 21h8M12 17v4"></path></svg>',
    light: '<svg class="themeIcon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"></path></svg>',
    dark: '<svg class="themeIcon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.2 15.3A8.5 8.5 0 0 1 8.7 3.8a8.5 8.5 0 1 0 11.5 11.5Z"></path></svg>'
  };

  function applyTheme(theme) {
    const nextTheme = themes.includes(theme) ? theme : 'system';
    document.documentElement.dataset.theme = nextTheme;
    themeToggleBtn.innerHTML = `${icons[nextTheme]}<span>${labels[nextTheme]}</span>`;
    themeToggleBtn.setAttribute('aria-label', `Color theme: ${labels[nextTheme]}. Click to switch theme.`);
  }

  function savedTheme() {
    try {
      return localStorage.getItem('theme');
    } catch {
      return null;
    }
  }

  applyTheme(savedTheme() || 'system');
  themeToggleBtn.addEventListener('click', () => {
    const currentTheme = document.documentElement.dataset.theme || 'system';
    const nextTheme = themes[(themes.indexOf(currentTheme) + 1) % themes.length];
    applyTheme(nextTheme);
    try {
      localStorage.setItem('theme', nextTheme);
    } catch {}
  });
})();
