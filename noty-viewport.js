/**
 * iOS Safari / PWA: CSS `100dvh`, `%` ve `-webkit-fill-available` birlikte tutarsız kalabiliyor;
 * gerçek görünür yüksekliği ölçüp `--app-vh` / `--app-vw` ile veriyoruz.
 * Böylece hem tam ekran (alttaki beyaz şerit) hem de yalnızca <main> scroll (sabit header) dengelenir.
 */
export function initAppViewportCssVars() {
  const apply = () => {
    const vv = window.visualViewport;
    const innerH = window.innerHeight ?? 0;
    const innerW = window.innerWidth ?? 0;
    const vvH = vv?.height ?? 0;
    const vvW = vv?.width ?? 0;
    /* Bazı iOS sürümlerinde biri diğerinden kısa kalabiliyor; büyük olanı al (alt şerit + layout) */
    const h = Math.max(0, Math.round(Math.max(innerH, vvH)));
    const w = Math.max(0, Math.round(Math.max(innerW, vvW)));
    if (h > 0) {
      document.documentElement.style.setProperty('--app-vh', `${h}px`);
    }
    if (w > 0) {
      document.documentElement.style.setProperty('--app-vw', `${w}px`);
    }
  };

  apply();

  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', () => {
    setTimeout(apply, 100);
    setTimeout(apply, 350);
  });

  window.visualViewport?.addEventListener('resize', apply);
}
