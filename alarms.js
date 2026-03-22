/**
 * Not alarmları: alarmAt (ISO) geldiğinde bildirim göster, sonra alarmı temizle.
 * Tarayıcılar uygulama tamamen kapalıyken zamanlayıcı çalıştırmaz; bu yüzden
 * kullanıcı uygulamayı açtığında veya sekmesi açıkken kontrol edilir.
 */
import { getAllNotes, saveNote } from './db.js';

const BODY_DELIMITER = '\n<!--noty-body-->\n';

function noteTitleForNotification(text) {
  if (!text) return 'Not';
  if (!text.includes(BODY_DELIMITER)) {
    return text.split('\n')[0]?.trim() || 'Not';
  }
  return text.slice(0, text.indexOf(BODY_DELIMITER)).trim() || 'Not';
}

const firing = new Set();

let refreshCallback = () => {};

export async function checkDueAlarms() {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;

  let notes;
  try {
    notes = await getAllNotes();
  } catch {
    return;
  }

  const now = Date.now();
  const iconUrl = new URL('icons/icon-192.png', globalThis.location.href).href;

  for (const note of notes) {
    if (note.deletedAt || note.archived) continue;
    if (!note.alarmAt) continue;

    const t = new Date(note.alarmAt).getTime();
    if (Number.isNaN(t) || t > now) continue;

    if (firing.has(note.id)) continue;
    firing.add(note.id);

    try {
      const title = noteTitleForNotification(note.text);
      new Notification(title, {
        body: 'Alarm zamanı geldi',
        tag: `noty-alarm-${note.id}`,
        icon: iconUrl,
        badge: iconUrl,
        renotify: true
      });

      await saveNote({ ...note, alarmAt: null });
      await Promise.resolve(refreshCallback()).catch(() => {});
    } catch (_) {
      /* ignore */
    } finally {
      firing.delete(note.id);
    }
  }
}

let intervalId = null;

export function initAlarmScheduler(options = {}) {
  refreshCallback = typeof options.onAfterAlarm === 'function' ? options.onAfterAlarm : () => {};

  const tick = () => {
    if (document.visibilityState !== 'visible') return;
    checkDueAlarms();
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tick();
  });
  window.addEventListener('focus', tick);

  if (intervalId != null) clearInterval(intervalId);
  intervalId = window.setInterval(tick, 45 * 1000);

  tick();
}

export async function requestNotificationPermissionForAlarm() {
  if (typeof Notification === 'undefined') return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}
