export function initLightbox({ lightbox, lightboxImg, lightboxClose }) {
  function openLightbox(src) {
    lightboxImg.src = src;
    lightbox.classList.add('open');
  }

  function closeLightbox() {
    const prev = lightboxImg.src;
    lightbox.classList.remove('open');
    lightboxImg.src = '';
    if (prev.startsWith('blob:')) URL.revokeObjectURL(prev);
  }

  lightboxClose.addEventListener('click', closeLightbox);
  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) closeLightbox();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeLightbox();
  });

  return { openLightbox, closeLightbox };
}
