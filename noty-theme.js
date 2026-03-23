export function initTheme({ themeIcon, themeLabel, themeToggle }) {
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const isLight = theme === 'light';
    themeIcon.className = isLight ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
    themeLabel.textContent = isLight ? 'Dark Mode' : 'Light Mode';
    localStorage.setItem('noty-theme', theme);
  }

  applyTheme(localStorage.getItem('noty-theme') ?? 'dark');

  themeToggle.addEventListener('click', () => {
    const current = document.documentElement.dataset.theme ?? 'dark';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });

  return { applyTheme };
}
