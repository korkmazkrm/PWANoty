const BODY_DELIMITER = '\n<!--noty-body-->\n';

export function parseNoteText(text) {
  if (!text || !text.includes(BODY_DELIMITER)) {
    const lines = (text || '').split('\n');
    return { title: lines[0] || '', bodyHtml: null, plainBody: lines.slice(1).join('\n') };
  }
  const i = text.indexOf(BODY_DELIMITER);
  return {
    title: text.slice(0, i).trim(),
    bodyHtml: text.slice(i + BODY_DELIMITER.length),
    plainBody: ''
  };
}

export function serializeNoteText(title, bodyHtml) {
  return (title || '').trim() + BODY_DELIMITER + (bodyHtml || '');
}

export function stripHtml(html) {
  if (!html) return '';
  const el = document.createElement('div');
  el.innerHTML = html;
  return (el.textContent || el.innerText || '').trim();
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function isoToDatetimeLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function datetimeLocalToIso(val) {
  if (!val || !String(val).trim()) return null;
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function getSupportedAudioMime() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
}

export function audioExt(mimeType) {
  if (!mimeType) return 'webm';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mp4')) return 'm4a';
  return 'webm';
}

export function safeFileExt(filename) {
  const m = String(filename).match(/\.([a-zA-Z0-9]{1,24})$/);
  return m ? m[1].toLowerCase() : 'bin';
}

export function normalizeAttachments(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((a) => a && typeof a.stored === 'string' && typeof a.name === 'string');
}

export function formatDate(iso) {
  return new Date(iso).toLocaleString('tr-TR', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}
