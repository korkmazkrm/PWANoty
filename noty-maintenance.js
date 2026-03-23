export async function cleanupTrashExpired({
  getAllNotes,
  deleteNote,
  deletePhoto,
  normalizeAttachments,
  retentionMs = 30 * 24 * 60 * 60 * 1000
}) {
  const now = Date.now();
  let notes;
  try {
    notes = await getAllNotes();
  } catch {
    return;
  }

  const expired = notes.filter((n) => {
    if (!n?.deletedAt) return false;
    const t = Date.parse(n.deletedAt);
    if (!Number.isFinite(t)) return false;
    return now - t >= retentionMs;
  });

  if (!expired.length) return;

  for (const note of expired) {
    if (note.photos?.length) {
      await Promise.all(note.photos.map((name) => deletePhoto(name).catch(() => {})));
    }
    if (note.audios?.length) {
      await Promise.all(note.audios.map((name) => deletePhoto(name).catch(() => {})));
    }
    for (const att of normalizeAttachments(note.attachments)) {
      await deletePhoto(att.stored).catch(() => {});
    }
    await deleteNote(note.id).catch(() => {});
  }
}
