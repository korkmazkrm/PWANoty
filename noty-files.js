export async function downloadAttachmentFile(att, { loadPhoto }) {
  try {
    const blob = await loadPhoto(att.stored);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = att.name;
    a.rel = 'noopener';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (_) {}
}
