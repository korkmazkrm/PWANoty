export function showConfirmSheet({ title, message, confirmLabel = 'Sil', cancelLabel = 'Vazgeç' }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'sheet-overlay';

    const sheet = document.createElement('div');
    sheet.className = 'sheet sheet-bottom';
    sheet.innerHTML = `
      <div class="sheet-handle"></div>
      <div class="sheet-body">
        <p class="sheet-title">${title}</p>
        <p class="sheet-message">${message}</p>
        <div class="sheet-actions">
          <button class="sheet-btn sheet-btn-cancel">${cancelLabel}</button>
          <button class="sheet-btn sheet-btn-danger">${confirmLabel}</button>
        </div>
      </div>
    `;

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    const close = (result) => {
      overlay.classList.remove('open');
      sheet.classList.remove('open');
      setTimeout(() => overlay.remove(), 180);
      resolve(result);
    };

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false);
    });

    sheet.querySelector('.sheet-btn-cancel').addEventListener('click', () => close(false));
    sheet.querySelector('.sheet-btn-danger').addEventListener('click', () => close(true));

    requestAnimationFrame(() => {
      overlay.classList.add('open');
      sheet.classList.add('open');
    });
  });
}
