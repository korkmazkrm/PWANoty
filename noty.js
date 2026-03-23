import { getAllNotes, saveNote, deleteNote, getAllFolders, saveFolder, deleteFolder, getAllTags, saveTag, deleteTag } from './db.js';
import { savePhoto, loadPhoto, deletePhoto } from './opfs.js';
import { initAlarmScheduler, requestNotificationPermissionForAlarm } from './alarms.js';
import {
  appTitle,
  detailContent,
  fab,
  foldersList,
  headerSearch,
  headerSearchBtn,
  lightbox,
  lightboxClose,
  lightboxImg,
  menuBtn,
  navItems,
  noteCount,
  notesFilterBar,
  notesList,
  notesSearchClear,
  notesSearchInput,
  sidebar,
  sidebarClose,
  sidebarOverlay,
  tagsList,
  themeIcon,
  themeLabel,
  themeToggle,
  viewDetail,
  viewFolders,
  viewList,
  viewTags
} from './noty-dom.js';
import {
  audioExt,
  datetimeLocalToIso,
  escapeHtml,
  formatDate,
  getSupportedAudioMime,
  isoToDatetimeLocal,
  normalizeAttachments,
  parseNoteText,
  safeFileExt,
  serializeNoteText,
  stripHtml
} from './noty-utils.js';
import { initTheme } from './noty-theme.js';
import { initLightbox } from './noty-lightbox.js';
import { showConfirmSheet, showInfoSheet } from './noty-sheet.js';
import { cleanupTrashExpired } from './noty-maintenance.js';
import { downloadAttachmentFile } from './noty-files.js';

// --- App state ---
let longPressActive = false;
let longPressTimer = null;
let currentMode = 'notes';
let currentFolderFilterId = null;
let currentArchiveFilter = 'active'; // 'active' = arşivlenmemiş, 'archived' = arşiv
let editorCloseGuard = null;
let currentTrashFilter = 'active'; // 'active' = çöp değil, 'trash' = çöp kutusu
let searchQuery = '';
let sortBy = 'createdAt'; // 'createdAt' | 'updatedAt' | 'title'
let sortOrder = 'desc'; // 'asc' | 'desc'

// --- Tema ---
initTheme({ themeIcon, themeLabel, themeToggle });

// --- Arama ---

const SEARCH_MIN_CHARS = 1;
const SEARCH_DEBOUNCE_MS = 120;

if (notesSearchInput) {
  let t = null;
  const updateClear = () => {
    const has = (notesSearchInput.value || '').length > 0;
    notesSearchClear?.classList.toggle('hidden', !has);
  };
  const setSearchOpen = (open) => {
    if (!appTitle || !headerSearch) return;
    appTitle.classList.toggle('hidden', open);
    headerSearch.classList.toggle('hidden', !open);
    if (!headerSearchBtn) return;
    headerSearchBtn.innerHTML = open
      ? '<i class="fa-solid fa-xmark"></i>'
      : '<i class="fa-solid fa-magnifying-glass"></i>';
    headerSearchBtn.title = open ? 'Kapat' : 'Ara';
    if (open) {
      requestAnimationFrame(() => notesSearchInput.focus());
    }
  };

  notesSearchInput.addEventListener('input', () => {
    updateClear();
    clearTimeout(t);
    t = setTimeout(() => {
      const next = notesSearchInput.value || '';
      searchQuery = next;
      renderNotes().catch(() => {});
    }, SEARCH_DEBOUNCE_MS);
  });

  notesSearchClear?.addEventListener('click', () => {
    notesSearchInput.value = '';
    searchQuery = '';
    updateClear();
    renderNotes().catch(() => {});
    notesSearchInput.focus();
  });

  headerSearchBtn?.addEventListener('click', () => {
    const isOpen = !headerSearch?.classList.contains('hidden');
    if (isOpen) {
      notesSearchInput.value = '';
      searchQuery = '';
      updateClear();
      renderNotes().catch(() => {});
      setSearchOpen(false);
    } else {
      setSearchOpen(true);
    }
  });

  updateClear();
  setSearchOpen(false);
}

// --- Çöp kutusu temizlik (30 gün) ---

// --- Lightbox ---
const { openLightbox } = initLightbox({ lightbox, lightboxImg, lightboxClose });

// --- Navigasyon ---

function showListViews() {
  viewList.classList.toggle('hidden', currentMode !== 'notes');
  viewFolders.classList.toggle('hidden', currentMode !== 'folders');
  viewTags.classList.toggle('hidden', currentMode !== 'tags');
  viewDetail.classList.add('hidden');
  fab.classList.remove('hidden');
}

async function navigateTo(viewName) {
  if (viewDetail && !viewDetail.classList.contains('hidden') && editorCloseGuard) {
    const ok = await editorCloseGuard();
    if (!ok) {
      closeSidebar();
      return;
    }
    editorCloseGuard = null;
  }
  if (viewName === 'add') { openEditor(null); return; }
  if (viewName === 'folders') {
    currentMode = 'folders';
  } else if (viewName === 'tags') {
    currentMode = 'tags';
  } else {
    currentMode = 'notes';
  }
  if (viewName === 'trash') {
    currentTrashFilter = 'trash';
    currentArchiveFilter = 'active';
    currentFolderFilterId = null;
  } else if (viewName === 'notes') {
    currentTrashFilter = 'active';
  }
  showListViews();
  navItems.forEach((btn) => btn.classList.toggle('active', btn.dataset.view === viewName));
  setupNotesFilterBar();
  renderNotes().catch(() => {});
  closeSidebar();
}

fab.addEventListener('click', () => {
  if (currentMode === 'folders') {
    openFolderEditor(null);
  } else if (currentMode === 'tags') {
    openTagEditor(null);
  } else {
    openEditor(null);
  }
});

// --- Ses kaydı yardımcıları ---

// --- Editör (yeni not & düzenleme) ---

function openEditor(note) {
  const isNew = note === null;
  const MAX_NOTE_PHOTOS = 3;
  const MAX_NOTE_ATTACHMENTS = 3;

  let keptPhotos    = isNew ? [] : [...(note.photos ?? [])];
  let removedPhotos = [];
  let newPhotos     = [];

  let keptAudios    = isNew ? [] : [...(note.audios ?? [])];
  let removedAudios = [];
  let newAudios     = [];

  let keptAttachments = isNew ? [] : normalizeAttachments(note.attachments);
  let removedAttachmentStorages = [];
  let newAttachments = [];

  let mediaRecorder   = null;
  let recordingChunks = [];
  let recordingTimer  = null;
  let hasUnsavedChanges = () => false;

  let alarmDatetimeLocal = isNew ? '' : isoToDatetimeLocal(note.alarmAt);

  detailContent.innerHTML = '';

  // --- Üst toolbar ---
  const topBar = document.createElement('div');
  topBar.className = 'editor-top-bar';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'editor-cancel-btn';
  cancelBtn.innerHTML = '<i class="fa-solid fa-arrow-left"></i>';
  const cleanupTransientResources = () => {
    if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
    clearInterval(recordingTimer);
    newPhotos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    newAudios.forEach((a) => URL.revokeObjectURL(a.url));
  };
  const closeEditorToList = () => {
    viewList.classList.remove('hidden');
    viewDetail.classList.add('hidden');
    fab.classList.remove('hidden');
    navItems.forEach((btn) => btn.classList.toggle('active', btn.dataset.view === 'notes'));
  };
  cancelBtn.addEventListener('click', async () => {
    if (editorCloseGuard) {
      const ok = await editorCloseGuard();
      if (!ok) return;
      editorCloseGuard = null;
      closeEditorToList();
      return;
    }
    cleanupTransientResources();
    closeEditorToList();
  });

  const dateLabel = document.createElement('span');
  dateLabel.className = 'editor-date';
  dateLabel.textContent = isNew ? 'Yeni Not' : formatDate(note.updatedAt ?? note.createdAt);

  const spacer = document.createElement('div');
  spacer.className = 'editor-top-spacer';

  const folderBtn = document.createElement('button');
  folderBtn.className = 'editor-icon-btn editor-folder-btn';
  folderBtn.innerHTML = '<i class="fa-solid fa-folder"></i>';
  folderBtn.title = 'Klasör seç';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'editor-save-btn';
  saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i>';
  saveBtn.addEventListener('click', async () => {
    const title    = titleInput.value.trim();
    const bodyHtml = bodyEditor.innerHTML.trim();
    const updatedText = serializeNoteText(title, bodyHtml);
    const hasAlarmSet = Boolean(alarmDatetimeLocal?.trim());
    const hasContent  =
      (title || bodyHtml) ||
      keptPhotos.length ||
      newPhotos.length ||
      keptAudios.length ||
      newAudios.length ||
      keptAttachments.length ||
      newAttachments.length ||
      hasAlarmSet;
    if (!hasContent) return;

    if (hasAlarmSet) {
      await requestNotificationPermissionForAlarm();
    }

    if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
    clearInterval(recordingTimer);

    await Promise.all(removedPhotos.map((n) => deletePhoto(n).catch(() => {})));
    await Promise.all(removedAudios.map((n) => deletePhoto(n).catch(() => {})));
    await Promise.all(removedAttachmentStorages.map((n) => deletePhoto(n).catch(() => {})));

    const id = isNew ? Date.now() : note.id;

    const newPhotoNames = [];
    for (let i = 0; i < newPhotos.length; i++) {
      const ext  = newPhotos[i].file.type.split('/')[1] || 'jpg';
      const name = `${id}-photo-${Date.now()}-${i}.${ext}`;
      await savePhoto(name, newPhotos[i].file);
      newPhotoNames.push(name);
    }

    const newAudioNames = [];
    for (let i = 0; i < newAudios.length; i++) {
      const ext  = audioExt(newAudios[i].mimeType);
      const name = `${id}-audio-${Date.now()}-${i}.${ext}`;
      await savePhoto(name, newAudios[i].blob);
      newAudioNames.push(name);
    }

    const newAttachmentRecords = [];
    for (let i = 0; i < newAttachments.length; i++) {
      const f = newAttachments[i].file;
      const ext = safeFileExt(f.name);
      const stored = `${id}-file-${Date.now()}-${i}.${ext}`;
      await savePhoto(stored, f);
      newAttachmentRecords.push({ name: f.name, stored });
    }

    const folderId = selectedFolderId ?? null;

    const alarmAt = datetimeLocalToIso(alarmDatetimeLocal);

    const base = {
      id,
      text: updatedText,
      photos: [...keptPhotos, ...newPhotoNames],
      audios: [...keptAudios, ...newAudioNames],
      attachments: [...keptAttachments, ...newAttachmentRecords],
      folderId,
      tagIds: [...selectedTagIds],
      alarmAt
    };

    const record = isNew
      ? { ...base, archived: false, deletedAt: null, createdAt: new Date().toISOString() }
      : { ...note, ...base, updatedAt: new Date().toISOString() };

    await saveNote(record);

    newPhotos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    newAudios.forEach((a) => URL.revokeObjectURL(a.url));
    await renderAll();
    editorCloseGuard = null;
    navigateTo('notes');
  });

  topBar.append(cancelBtn, spacer, saveBtn);

  // --- Başlık alanı ---
  const titleInput = document.createElement('input');
  titleInput.type        = 'text';
  titleInput.className   = 'editor-title-input';
  titleInput.placeholder = 'Başlık';
  const parsed = isNew ? { title: '', bodyHtml: '', plainBody: '' } : parseNoteText(note.text);
  titleInput.value = parsed.title;
  const initialFolderId = isNew ? currentFolderFilterId : (note.folderId ?? null);
  const initialTagIds = isNew ? [] : [...(note.tagIds ?? [])].sort((a, b) => a - b);
  const initialAlarmDatetimeLocal = alarmDatetimeLocal || '';

  // --- Klasör + Etiket satırı ---
  const metaRow = document.createElement('div');
  metaRow.className = 'note-tags-row';
  metaRow.style.display = 'none';
  const folderChip = document.createElement('span');
  folderChip.className = 'note-folder-chip-small';
  const folderIcon = document.createElement('span');
  folderIcon.className = 'note-folder-chip-icon';
  folderIcon.innerHTML = '<i class="fa-solid fa-folder"></i>';
  const folderText = document.createElement('span');
  folderText.className = 'note-folder-text';
  folderChip.append(folderIcon, folderText);
  metaRow.append(folderChip);

  let selectedFolder = null;
  let selectedFolderId = initialFolderId ?? null;
  let selectedTags = [];
  let selectedTagIds = [...initialTagIds];

  const renderMetaRow = () => {
    metaRow.innerHTML = '';

    if (selectedFolder) {
      folderText.textContent = selectedFolder.name;
      folderChip.style.backgroundColor = selectedFolder.color || '';
      folderChip.style.color = selectedFolder.fontColor || '';
      metaRow.appendChild(folderChip);
    }

    for (const t of selectedTags) {
      const chip = document.createElement('span');
      chip.className = 'note-tag-chip-small';
      const icon = document.createElement('span');
      icon.className = 'note-tag-chip-icon';
      icon.innerHTML = '<i class="fa-solid fa-tag"></i>';
      chip.appendChild(icon);
      chip.appendChild(document.createTextNode(t.name));
      if (t.color) chip.style.backgroundColor = t.color;
      if (t.fontColor) chip.style.color = t.fontColor;
      metaRow.appendChild(chip);
    }

    metaRow.style.display = metaRow.childNodes.length ? 'flex' : 'none';
  };

  function updateFolderRow() {
    if (!selectedFolder) {
      folderText.textContent = '';
      renderMetaRow();
      return;
    }
    folderText.textContent = selectedFolder.name;
    folderChip.style.backgroundColor = selectedFolder.color || '';
    folderChip.style.color = selectedFolder.fontColor || '';
    renderMetaRow();
  }

  async function initFolderRow() {
    if (!initialFolderId) {
      updateFolderRow();
      return;
    }
    try {
      const folders = await getAllFolders();
      selectedFolder = folders.find((f) => f.id === initialFolderId) ?? null;
      selectedFolderId = selectedFolder ? selectedFolder.id : null;
      updateFolderRow();
    } catch {
      selectedFolder = null;
      selectedFolderId = null;
      updateFolderRow();
    }
  }

  const updateTagsRow = () => {
    renderMetaRow();
  };

  const initTags = async () => {
    const ids = isNew ? [] : (note.tagIds ?? []);
    if (!ids.length) { selectedTags = []; selectedTagIds = []; updateTagsRow(); return; }
    try {
      const tags = await getAllTags();
      const map = new Map(tags.map((t) => [t.id, t]));
      selectedTags = ids.map((id) => map.get(id)).filter(Boolean);
      selectedTagIds = [...ids].sort((a, b) => a - b);
      updateTagsRow();
    } catch {
      selectedTags = [];
      selectedTagIds = [...ids].sort((a, b) => a - b);
      updateTagsRow();
    }
  };

  folderBtn.addEventListener('click', async () => {
    const folders = await getAllFolders();
    const overlay = document.createElement('div');
    overlay.className = 'sheet-overlay';
    const sheet = document.createElement('div');
    sheet.className = 'sheet sheet-bottom';
    const items = folders.map((f) => `
      <button class="sheet-menu-item folder-pick-item" data-id="${f.id}">
        <span class="note-folder-chip-small" style="${f.color ? `background:${f.color};` : ''}${f.fontColor ? `color:${f.fontColor};` : ''}">
          <span class="note-folder-chip-icon"><i class="fa-solid fa-folder"></i></span>
          <span>${escapeHtml(f.name)}</span>
        </span>
      </button>
    `).join('');
    sheet.innerHTML = `
      <div class="sheet-handle"></div>
      <div class="sheet-body">
        <div class="sheet-note-actions">
          <button class="sheet-menu-item folder-pick-item" data-id="">
            <span class="note-folder-chip-small">
              <span class="note-folder-chip-icon"><i class="fa-regular fa-folder-open"></i></span>
              <span>Klasörü kaldır</span>
            </span>
          </button>
          ${items}
        </div>
      </div>
    `;
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
    const close = () => {
      overlay.classList.remove('open');
      sheet.classList.remove('open');
      setTimeout(() => overlay.remove(), 180);
    };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    sheet.addEventListener('click', (e) => {
      const btn = e.target.closest('.folder-pick-item');
      if (!btn) return;
      const id = btn.dataset.id;
      if (!id) {
        selectedFolder = null;
        selectedFolderId = null;
      } else {
        const fid = Number(id);
        selectedFolder = folders.find((f) => f.id === fid) ?? null;
        selectedFolderId = fid;
      }
      updateFolderRow();
      close();
    });
    requestAnimationFrame(() => {
      overlay.classList.add('open');
      sheet.classList.add('open');
    });
  });

  initFolderRow();
  initTags();

  const tagBtn = document.createElement('button');
  tagBtn.className = 'editor-icon-btn editor-tag-btn';
  tagBtn.innerHTML = '<i class="fa-solid fa-tags"></i>';
  tagBtn.title = 'Etiket seç';

  tagBtn.addEventListener('click', async () => {
    const tags = await getAllTags();
    const selected = new Set(selectedTags.map((t) => t.id));

    const overlay = document.createElement('div');
    overlay.className = 'sheet-overlay';
    const sheet = document.createElement('div');
    sheet.className = 'sheet sheet-bottom';

    const renderItems = () => {
      const items = tags.map((t) => {
        const on = selected.has(t.id);
        const bg = t.color ? `background:${t.color}` : '';
        const fg = t.fontColor ? `color:${t.fontColor}` : '';
        const style = [bg, fg].filter(Boolean).join(';');
        return `
          <button class="sheet-menu-item tag-pick-item" data-id="${t.id}">
            <i class="fa-solid ${on ? 'fa-square-check' : 'fa-square'}"></i>
            <span class="note-tag-chip-small" style="${style}">
              <span class="note-tag-chip-icon"><i class="fa-solid fa-tag"></i></span>
              <span>${escapeHtml(t.name)}</span>
            </span>
          </button>
        `;
      }).join('');
      sheet.innerHTML = `
        <div class="sheet-handle"></div>
        <div class="sheet-body">
          <p class="sheet-title">Etiket seç</p>
          <div class="sheet-note-actions">
            ${items || '<p class="empty-state" style="padding:0.75rem 0.25rem">Henüz etiket yok.</p>'}
            <button class="sheet-btn sheet-btn-cancel tag-pick-done">Bitti</button>
          </div>
        </div>
      `;
    };

    renderItems();
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    const close = () => {
      overlay.classList.remove('open');
      sheet.classList.remove('open');
      setTimeout(() => overlay.remove(), 180);
    };

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    sheet.addEventListener('click', (e) => {
      const done = e.target.closest('.tag-pick-done');
      if (done) {
        const map = new Map(tags.map((t) => [t.id, t]));
        selectedTags = [...selected].map((id) => map.get(id)).filter(Boolean);
        selectedTagIds = [...selected].sort((a, b) => a - b);
        updateTagsRow();
        close();
        return;
      }
      const btn = e.target.closest('.tag-pick-item');
      if (!btn) return;
      const id = Number(btn.dataset.id);
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      renderItems();
    });

    requestAnimationFrame(() => {
      overlay.classList.add('open');
      sheet.classList.add('open');
    });
  });

  const alarmBtn = document.createElement('button');
  alarmBtn.type = 'button';
  alarmBtn.className = 'editor-icon-btn editor-alarm-btn';
  alarmBtn.innerHTML = '<i class="fa-solid fa-bell"></i>';
  alarmBtn.title = 'Alarm';

  const updateAlarmBtn = () => {
    const has = Boolean(alarmDatetimeLocal?.trim());
    alarmBtn.classList.toggle('editor-alarm-btn--active', has);
    alarmBtn.title = has ? 'Alarm (ayarlı)' : 'Alarm';
  };
  updateAlarmBtn();

  alarmBtn.addEventListener('click', () => {
    const backup = alarmDatetimeLocal;

    const overlay = document.createElement('div');
    overlay.className = 'sheet-overlay';
    const sheet = document.createElement('div');
    sheet.className = 'sheet sheet-bottom';

    const handle = document.createElement('div');
    handle.className = 'sheet-handle';

    const sheetBody = document.createElement('div');
    sheetBody.className = 'sheet-body';

    const sheetTitle = document.createElement('p');
    sheetTitle.className = 'sheet-title';
    sheetTitle.textContent = 'Alarm';

    const input = document.createElement('input');
    input.type = 'datetime-local';
    input.className = 'sheet-alarm-datetime';
    input.value = alarmDatetimeLocal;

    const actions = document.createElement('div');
    actions.className = 'sheet-note-actions sheet-alarm-actions';

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'sheet-menu-item sheet-alarm-clear';
    clearBtn.textContent = 'Alarmı kaldır';

    const doneBtn = document.createElement('button');
    doneBtn.type = 'button';
    doneBtn.className = 'sheet-btn sheet-btn-cancel sheet-alarm-done';
    doneBtn.textContent = 'Tamam';

    actions.append(clearBtn, doneBtn);
    sheetBody.append(sheetTitle, input, actions);
    sheet.append(handle, sheetBody);
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    const closeOverlay = () => {
      overlay.classList.remove('open');
      sheet.classList.remove('open');
      setTimeout(() => overlay.remove(), 180);
    };

    clearBtn.addEventListener('click', () => {
      alarmDatetimeLocal = '';
      input.value = '';
      updateAlarmBtn();
      closeOverlay();
    });

    doneBtn.addEventListener('click', () => {
      alarmDatetimeLocal = input.value;
      updateAlarmBtn();
      closeOverlay();
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        alarmDatetimeLocal = backup;
        updateAlarmBtn();
        closeOverlay();
      }
    });

    requestAnimationFrame(() => {
      overlay.classList.add('open');
      sheet.classList.add('open');
      input.focus();
    });
  });

  // --- Zengin metin alanı (contenteditable) ---
  const bodyEditor = document.createElement('div');
  bodyEditor.className = 'editor-body-rich';
  bodyEditor.contentEditable = 'true';
  bodyEditor.dataset.placeholder = 'Notunu buraya yaz...';
  if (isNew) {
    bodyEditor.innerHTML = '';
  } else if (parsed.bodyHtml) {
    bodyEditor.innerHTML = parsed.bodyHtml;
  } else {
    bodyEditor.textContent = parsed.plainBody;
  }
  const initialTitleNormalized = (parsed.title || '').trim();
  const initialBodyNormalized = (bodyEditor.innerHTML || '').trim();

  const arraysEqual = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  hasUnsavedChanges = () => {
    const currentTitle = titleInput.value.trim();
    const currentBody = (bodyEditor.innerHTML || '').trim();
    const currentFolderId = selectedFolderId ?? null;
    const currentTagIds = [...selectedTagIds].sort((a, b) => a - b);
    const currentAlarm = alarmDatetimeLocal || '';

    if (currentTitle !== initialTitleNormalized) return true;
    if (currentBody !== initialBodyNormalized) return true;
    if (currentFolderId !== (initialFolderId ?? null)) return true;
    if (!arraysEqual(currentTagIds, initialTagIds)) return true;
    if (currentAlarm !== initialAlarmDatetimeLocal) return true;
    if (newPhotos.length || removedPhotos.length) return true;
    if (newAudios.length || removedAudios.length) return true;
    if (newAttachments.length || removedAttachmentStorages.length) return true;
    return false;
  };
  editorCloseGuard = async () => {
    if (!hasUnsavedChanges()) {
      cleanupTransientResources();
      return true;
    }
    const ok = await showConfirmSheet({
      title: 'Kaydedilmemiş değişiklikler var',
      message: 'Notta kaydedilmemiş değişiklikler var. Çıkarsan değişiklikler kaybolacak.',
      confirmLabel: 'Evet, çık',
      cancelLabel: 'Vazgeç'
    });
    if (ok) cleanupTransientResources();
    return ok;
  };

  titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      bodyEditor.focus();
    }
  });

  // --- Format toolbar: alt barın hemen üstünde, ikonla açılıp kapanır ---
  const execFmt = (cmd, value) => {
    bodyEditor.focus();
    if (value != null) document.execCommand(cmd, false, value);
    else document.execCommand(cmd, false);
  };
  const fmt = (cmd, value, label, icon) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'format-btn';
    btn.title = label;
    btn.innerHTML = icon;
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      execFmt(cmd, value);
    });
    return btn;
  };
  const sep = () => { const s = document.createElement('span'); s.className = 'format-sep'; return s; };

  const formatBarAboveBottom = document.createElement('div');
  formatBarAboveBottom.className = 'editor-format-bar editor-format-bar-above-bottom';
  formatBarAboveBottom.append(
    fmt('bold', null, 'Kalın', '<i class="fa-solid fa-bold"></i>'),
    fmt('italic', null, 'İtalik', '<i class="fa-solid fa-italic"></i>'),
    fmt('strikeThrough', null, 'Üstü çizili', '<i class="fa-solid fa-strikethrough"></i>'),
    fmt('underline', null, 'Altı çizili', '<i class="fa-solid fa-underline"></i>'),
    sep(),
    fmt('formatBlock', 'h1', 'Başlık 1', 'H1'),
    fmt('formatBlock', 'h2', 'Başlık 2', 'H2'),
    fmt('formatBlock', 'h3', 'Başlık 3', 'H3'),
    fmt('formatBlock', 'h4', 'Başlık 4', 'H4'),
    fmt('formatBlock', 'h5', 'Başlık 5', 'H5'),
    fmt('formatBlock', 'h6', 'Başlık 6', 'H6'),
    sep(),
    fmt('formatBlock', 'p', 'Paragraf', 'P')
  );

  // --- Fotoğraf şeridi ---
  const strip = document.createElement('div');
  strip.className = 'editor-photo-strip';

  function renderEditStrip() {
    strip.innerHTML = '';
    keptPhotos.forEach((name, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'pending-photo';
      const img = document.createElement('img');
      img.alt = name;
      img.style.cursor = 'pointer';
      img.addEventListener('click', () => openPhotoLightbox(name));
      attachPhoto(name, img);
      const removeBtn = document.createElement('button');
      removeBtn.className = 'remove-photo-btn';
      removeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      removeBtn.addEventListener('click', () => {
        removedPhotos.push(keptPhotos.splice(i, 1)[0]);
        renderEditStrip();
      });
      wrap.append(img, removeBtn);
      strip.appendChild(wrap);
    });
    newPhotos.forEach((p, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'pending-photo';
      const img = document.createElement('img');
      img.src = p.previewUrl;
      img.alt = p.file.name;
      img.style.cursor = 'pointer';
      img.addEventListener('click', () => openLightbox(p.previewUrl));
      const removeBtn = document.createElement('button');
      removeBtn.className = 'remove-photo-btn';
      removeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      removeBtn.addEventListener('click', () => {
        URL.revokeObjectURL(p.previewUrl);
        newPhotos.splice(i, 1);
        renderEditStrip();
      });
      wrap.append(img, removeBtn);
      strip.appendChild(wrap);
    });
  }

  // --- Ses şeridi ---
  const audioStrip = document.createElement('div');
  audioStrip.className = 'editor-audio-strip';

  function renderAudioStrip() {
    audioStrip.innerHTML = '';
    keptAudios.forEach((name, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'audio-item';
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.preload  = 'metadata';
      loadPhoto(name).then((blob) => { audio.src = URL.createObjectURL(blob); }).catch(() => {});
      const removeBtn = document.createElement('button');
      removeBtn.className = 'audio-remove-btn';
      removeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      removeBtn.addEventListener('click', () => {
        removedAudios.push(keptAudios.splice(i, 1)[0]);
        renderAudioStrip();
      });
      wrap.append(audio, removeBtn);
      audioStrip.appendChild(wrap);
    });
    newAudios.forEach((a, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'audio-item';
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.src      = a.url;
      const removeBtn = document.createElement('button');
      removeBtn.className = 'audio-remove-btn';
      removeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      removeBtn.addEventListener('click', () => {
        URL.revokeObjectURL(a.url);
        newAudios.splice(i, 1);
        renderAudioStrip();
      });
      wrap.append(audio, removeBtn);
      audioStrip.appendChild(wrap);
    });
  }

  // --- Dosya ekleri şeridi ---
  const attachmentStrip = document.createElement('div');
  attachmentStrip.className = 'editor-attachment-strip';

  function renderAttachmentStrip() {
    attachmentStrip.innerHTML = '';
    keptAttachments.forEach((att, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'attachment-item';
      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'attachment-open-btn';
      openBtn.title = 'İndir / aç';
      openBtn.innerHTML = '<i class="fa-solid fa-file"></i>';
      openBtn.addEventListener('click', () => downloadAttachmentFile(att, { loadPhoto }));
      const nameBtn = document.createElement('button');
      nameBtn.type = 'button';
      nameBtn.className = 'attachment-name-btn';
      nameBtn.textContent = att.name;
      nameBtn.title = att.name;
      nameBtn.addEventListener('click', () => downloadAttachmentFile(att, { loadPhoto }));
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'attachment-remove-btn';
      removeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      removeBtn.addEventListener('click', () => {
        const [gone] = keptAttachments.splice(i, 1);
        removedAttachmentStorages.push(gone.stored);
        renderAttachmentStrip();
      });
      wrap.append(openBtn, nameBtn, removeBtn);
      attachmentStrip.appendChild(wrap);
    });
    newAttachments.forEach((item, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'attachment-item attachment-item--pending';
      const icon = document.createElement('span');
      icon.className = 'attachment-pending-icon';
      icon.innerHTML = '<i class="fa-solid fa-file"></i>';
      const nameEl = document.createElement('span');
      nameEl.className = 'attachment-pending-name';
      nameEl.textContent = item.file.name;
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'attachment-remove-btn';
      removeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      removeBtn.addEventListener('click', () => {
        newAttachments.splice(i, 1);
        renderAttachmentStrip();
      });
      wrap.append(icon, nameEl, removeBtn);
      attachmentStrip.appendChild(wrap);
    });
  }

  // --- Alt toolbar ---
  const fileInput    = document.createElement('input');
  fileInput.type     = 'file';
  fileInput.accept   = 'image/*';
  fileInput.multiple = true;
  fileInput.hidden   = true;
  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files ?? []);
    const remainingSlots = Math.max(0, MAX_NOTE_PHOTOS - (keptPhotos.length + newPhotos.length));
    if (remainingSlots <= 0) {
      showInfoSheet({ title: 'Fotoğraf limiti', message: 'Bir nota en fazla 3 fotoğraf ekleyebilirsin.' });
      fileInput.value = '';
      return;
    }
    if (files.length > remainingSlots) {
      showInfoSheet({
        title: 'Fotoğraf limiti',
        message: `En fazla 3 fotoğraf ekleyebilirsin. ${remainingSlots} adet daha eklenebilir.`
      });
    }
    for (const file of files.slice(0, remainingSlots)) {
      newPhotos.push({ file, previewUrl: URL.createObjectURL(file) });
    }
    fileInput.value = '';
    renderEditStrip();
  });

  const attachmentFileInput = document.createElement('input');
  attachmentFileInput.type = 'file';
  attachmentFileInput.multiple = true;
  attachmentFileInput.hidden = true;
  attachmentFileInput.addEventListener('change', () => {
    const files = Array.from(attachmentFileInput.files ?? []);
    const remainingSlots = Math.max(0, MAX_NOTE_ATTACHMENTS - (keptAttachments.length + newAttachments.length));
    if (remainingSlots <= 0) {
      showInfoSheet({ title: 'Dosya limiti', message: 'Bir nota en fazla 3 dosya ekleyebilirsin.' });
      attachmentFileInput.value = '';
      return;
    }
    if (files.length > remainingSlots) {
      showInfoSheet({
        title: 'Dosya limiti',
        message: `En fazla 3 dosya ekleyebilirsin. ${remainingSlots} adet daha eklenebilir.`
      });
    }
    for (const file of files.slice(0, remainingSlots)) {
      newAttachments.push({ file });
    }
    attachmentFileInput.value = '';
    renderAttachmentStrip();
  });

  const bottomBar = document.createElement('div');
  bottomBar.className = 'editor-bottom-bar';

  const photoAddBtn = document.createElement('button');
  photoAddBtn.className = 'editor-icon-btn';
  photoAddBtn.title     = 'Fotoğraf Ekle';
  photoAddBtn.innerHTML = '<i class="fa-solid fa-camera"></i>';
  photoAddBtn.addEventListener('click', () => {
    const totalPhotos = keptPhotos.length + newPhotos.length;
    if (totalPhotos >= MAX_NOTE_PHOTOS) {
      showInfoSheet({ title: 'Fotoğraf limiti', message: 'Bu notta zaten 3 fotoğraf var. Daha fazla ekleyemezsin.' });
      return;
    }
    fileInput.click();
  });

  const fileAttachBtn = document.createElement('button');
  fileAttachBtn.type = 'button';
  fileAttachBtn.className = 'editor-icon-btn';
  fileAttachBtn.title = 'Dosya ekle';
  fileAttachBtn.innerHTML = '<i class="fa-solid fa-file-arrow-up"></i>';
  fileAttachBtn.addEventListener('click', () => {
    const totalAttachments = keptAttachments.length + newAttachments.length;
    if (totalAttachments >= MAX_NOTE_ATTACHMENTS) {
      showInfoSheet({ title: 'Dosya limiti', message: 'Bu notta zaten 3 dosya var. Daha fazla ekleyemezsin.' });
      return;
    }
    attachmentFileInput.click();
  });

  const micBtn = document.createElement('button');
  micBtn.className = 'editor-icon-btn';
  micBtn.title     = 'Ses Kaydet';
  micBtn.innerHTML = '<i class="fa-solid fa-microphone"></i>';

  const formatToggleBtn = document.createElement('button');
  formatToggleBtn.className = 'editor-icon-btn editor-format-toggle';
  formatToggleBtn.title    = 'Metin biçimi';
  formatToggleBtn.innerHTML = '<i class="fa-solid fa-font"></i>';
  formatToggleBtn.addEventListener('click', () => {
    formatBarAboveBottom.classList.toggle('open');
  });

  const recIndicator = document.createElement('span');
  recIndicator.className = 'rec-indicator hidden';

  function startRecording() {
    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      const mimeType  = getSupportedAudioMime();
      mediaRecorder   = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      recordingChunks = [];
      mediaRecorder.addEventListener('dataavailable', (e) => {
        if (e.data.size > 0) recordingChunks.push(e.data);
      });
      mediaRecorder.addEventListener('stop', () => {
        stream.getTracks().forEach((t) => t.stop());
        const mime = mediaRecorder.mimeType;
        const blob = new Blob(recordingChunks, { type: mime });
        newAudios.push({ blob, url: URL.createObjectURL(blob), mimeType: mime });
        renderAudioStrip();
        micBtn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
        micBtn.classList.remove('recording');
        recIndicator.classList.add('hidden');
        clearInterval(recordingTimer);
      });
      mediaRecorder.start();
      let secs = 0;
      recIndicator.textContent = '00:00';
      recIndicator.classList.remove('hidden');
      micBtn.innerHTML = '<i class="fa-solid fa-stop"></i>';
      micBtn.classList.add('recording');
      recordingTimer = setInterval(() => {
        secs++;
        const m = String(Math.floor(secs / 60)).padStart(2, '0');
        const s = String(secs % 60).padStart(2, '0');
        recIndicator.textContent = `${m}:${s}`;
      }, 1000);
    }).catch(() => {});
  }

  micBtn.addEventListener('click', () => {
    if (mediaRecorder?.state === 'recording') {
      mediaRecorder.stop();
    } else {
      startRecording();
    }
  });

  bottomBar.append(folderBtn, tagBtn, alarmBtn, photoAddBtn, fileAttachBtn, fileInput, attachmentFileInput, micBtn, recIndicator, formatToggleBtn);
  detailContent.append(topBar, titleInput, metaRow, bodyEditor, strip, audioStrip, attachmentStrip, formatBarAboveBottom, bottomBar);
  renderEditStrip();
  renderAudioStrip();
  renderAttachmentStrip();

  // view-detail'i göster, diğerlerini gizle
  viewList.classList.add('hidden');
  viewDetail.classList.remove('hidden');
  fab.classList.add('hidden');
  navItems.forEach((btn) => btn.classList.remove('active'));

  if (isNew) {
    titleInput.focus();
  } else {
    bodyEditor.focus();
  }
}

// --- Klasör editörü (yeni klasör & düzenleme) ---

function openFolderEditor(folder) {
  const isNew = folder === null;

  detailContent.innerHTML = '';

  const topBar = document.createElement('div');
  topBar.className = 'editor-top-bar';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'editor-cancel-btn';
  cancelBtn.innerHTML = '<i class="fa-solid fa-arrow-left"></i>';
  cancelBtn.addEventListener('click', () => {
    showListViews();
  });

  const titleSpan = document.createElement('span');
  titleSpan.className = 'editor-date';
  titleSpan.textContent = isNew ? 'Yeni Klasör' : '';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'editor-save-btn';
  saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i>';

  const spacer = document.createElement('div');
  spacer.className = 'editor-top-spacer';
  topBar.append(cancelBtn, titleSpan, spacer, saveBtn);

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'editor-title-input';
  nameInput.placeholder = 'Klasör adı';
  nameInput.value = isNew ? '' : (folder.name ?? '');

  const colorRow = document.createElement('div');
  colorRow.className = 'folder-color-row';
  const colorLabel = document.createElement('span');
  colorLabel.className = 'folder-color-label';
  colorLabel.textContent = 'Arka plan';
  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.className = 'folder-color-input';
  colorInput.value = !isNew && folder.color ? folder.color : '#ffffff';
  const fontColorLabel = document.createElement('span');
  fontColorLabel.className = 'folder-color-label';
  fontColorLabel.textContent = 'Yazı rengi';
  const fontColorInput = document.createElement('input');
  fontColorInput.type = 'color';
  fontColorInput.className = 'folder-color-input';
  fontColorInput.value = !isNew && folder.fontColor ? folder.fontColor : '#000000';
  colorRow.append(colorLabel, colorInput, fontColorLabel, fontColorInput);

  const descInput = document.createElement('textarea');
  descInput.className = 'folder-desc-input';
  descInput.placeholder = 'İsteğe bağlı açıklama...';
  descInput.value = isNew ? '' : (folder.description ?? '');

  saveBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    const description = descInput.value.trim();
    const color = colorInput.value;
    const fontColor = fontColorInput.value;
    if (!name) return;

    const id = isNew ? Date.now() : folder.id;
    const now = new Date().toISOString();

    const record = isNew
      ? { id, name, description, color, fontColor, createdAt: now, updatedAt: now }
      : { ...folder, name, description, color, fontColor, updatedAt: now };

    await saveFolder(record);
    await renderAll();
    currentMode = 'folders';
    showListViews();
  });

  detailContent.append(topBar, nameInput, descInput, colorRow);

  viewList.classList.add('hidden');
  viewFolders.classList.add('hidden');
  viewDetail.classList.remove('hidden');
  fab.classList.add('hidden');
  navItems.forEach((btn) => btn.classList.remove('active'));

  nameInput.focus();
}

function openTagEditor(tag) {
  const isNew = tag === null;

  detailContent.innerHTML = '';

  const topBar = document.createElement('div');
  topBar.className = 'editor-top-bar';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'editor-cancel-btn';
  cancelBtn.innerHTML = '<i class="fa-solid fa-arrow-left"></i>';
  cancelBtn.addEventListener('click', () => {
    showListViews();
  });

  const titleSpan = document.createElement('span');
  titleSpan.className = 'editor-date';
  titleSpan.textContent = isNew ? 'Yeni Etiket' : 'Etiketi Düzenle';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'editor-save-btn';
  saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i>';

  const spacer = document.createElement('div');
  spacer.className = 'editor-top-spacer';
  topBar.append(cancelBtn, titleSpan, spacer, saveBtn);

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'editor-title-input';
  nameInput.placeholder = 'Etiket adı';
  nameInput.value = isNew ? '' : (tag.name ?? '');

  const colorRow = document.createElement('div');
  colorRow.className = 'folder-color-row';
  const colorLabel = document.createElement('span');
  colorLabel.className = 'folder-color-label';
  colorLabel.textContent = 'Arka plan';
  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.className = 'folder-color-input';
  colorInput.value = !isNew && tag.color ? tag.color : '#ffffff';
  const fontColorLabel = document.createElement('span');
  fontColorLabel.className = 'folder-color-label';
  fontColorLabel.textContent = 'Yazı rengi';
  const fontColorInput = document.createElement('input');
  fontColorInput.type = 'color';
  fontColorInput.className = 'folder-color-input';
  fontColorInput.value = !isNew && tag.fontColor ? tag.fontColor : '#000000';
  colorRow.append(colorLabel, colorInput, fontColorLabel, fontColorInput);

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'sheet-btn sheet-btn-danger tag-delete-btn';
  deleteBtn.textContent = 'Etiketi sil';
  deleteBtn.style.margin = '1rem 1.25rem 0';
  deleteBtn.style.width = 'calc(100% - 2.5rem)';

  deleteBtn.addEventListener('click', async () => {
    if (isNew) return;
    let usedCount = 0;
    try {
      const notes = await getAllNotes();
      usedCount = notes.filter((n) => (n.tagIds ?? []).includes(tag.id) && !n.deletedAt).length;
    } catch {
      usedCount = 0;
    }
    const extra = usedCount
      ? ` Bu etiket ${usedCount} notta kullanılıyor; silersen notların üzerinden de kaldırılacak.`
      : '';
    const ok = await showConfirmSheet({
      title: 'Etiketi sil',
      message: `Bu etiket silinecek.${extra}`,
      confirmLabel: 'Evet, sil',
      cancelLabel: 'Vazgeç'
    });
    if (!ok) return;
    // Notlardan ilişkiyi de temizle
    try {
      const notes = await getAllNotes();
      const affected = notes.filter((n) => (n.tagIds ?? []).includes(tag.id));
      for (const n of affected) {
        n.tagIds = (n.tagIds ?? []).filter((id) => id !== tag.id);
        await saveNote(n);
      }
    } catch { /* sessiz */ }
    await deleteTag(tag.id);
    await renderAll();
    currentMode = 'tags';
    showListViews();
  });

  saveBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    const color = colorInput.value;
    const fontColor = fontColorInput.value;
    if (!name) return;

    const id = isNew ? Date.now() : tag.id;
    const now = new Date().toISOString();
    const record = isNew
      ? { id, name, color, fontColor, createdAt: now, updatedAt: now }
      : { ...tag, name, color, fontColor, updatedAt: now };

    await saveTag(record);
    await renderAll();
    currentMode = 'tags';
    showListViews();
  });

  detailContent.append(topBar, nameInput, colorRow);
  if (!isNew) detailContent.append(deleteBtn);

  viewList.classList.add('hidden');
  viewFolders.classList.add('hidden');
  viewTags.classList.add('hidden');
  viewDetail.classList.remove('hidden');
  fab.classList.add('hidden');
  navItems.forEach((btn) => btn.classList.remove('active'));

  nameInput.focus();
}

function openSidebar()  { sidebar.classList.add('open');    sidebarOverlay.classList.add('open');    }
function closeSidebar() { sidebar.classList.remove('open'); sidebarOverlay.classList.remove('open'); }

menuBtn.addEventListener('click', openSidebar);
sidebarClose.addEventListener('click', closeSidebar);
sidebarOverlay.addEventListener('click', closeSidebar);
navItems.forEach((btn) => btn.addEventListener('click', () => {
  navigateTo(btn.dataset.view).catch(() => {});
}));

// Mobil alt sheet tarzı confirm diyaloğu `noty-sheet.js` içinde.

// Not kartı için uzun basma alt menüsü (şimdilik boş içerik)
async function showNoteActionsSheet(noteId) {
  const overlay = document.createElement('div');
  overlay.className = 'sheet-overlay';

  const sheet = document.createElement('div');
  sheet.className = 'sheet sheet-bottom';
  sheet.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="sheet-body">
      <div class="sheet-note-actions" data-note-id="${noteId}">
        <button class="sheet-menu-item sheet-menu-copy"><i class="fa-solid fa-copy"></i><span>Kopyala</span></button>
        <button class="sheet-menu-item sheet-menu-archive"><i class="fa-solid fa-box-archive"></i><span class="sheet-menu-item-label">Arşive gönder</span></button>
        <button class="sheet-menu-item sheet-menu-folder"><i class="fa-solid fa-folder"></i><span>Klasör ata/değiştir</span></button>
        <button class="sheet-menu-item sheet-menu-tags"><i class="fa-solid fa-tags"></i><span>Etiket ata/değiştir</span></button>
        <button class="sheet-menu-item sheet-menu-restore hidden"><i class="fa-solid fa-rotate-left"></i><span>Geri yükle</span></button>
        <button class="sheet-menu-item sheet-menu-delete-perm hidden"><i class="fa-solid fa-trash-can"></i><span>Kalıcı sil</span></button>
        <button class="sheet-menu-item sheet-menu-delete"><i class="fa-solid fa-trash"></i><span>Sil</span></button>
      </div>
    </div>
  `;

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);

  const close = () => {
    longPressActive = false;
    overlay.classList.remove('open');
    sheet.classList.remove('open');
    setTimeout(() => overlay.remove(), 180);
  };

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  const btnCopy = sheet.querySelector('.sheet-menu-copy');
  const btnArchive = sheet.querySelector('.sheet-menu-archive');
  const btnFolder = sheet.querySelector('.sheet-menu-folder');
  const btnTags = sheet.querySelector('.sheet-menu-tags');
  const btnRestore = sheet.querySelector('.sheet-menu-restore');
  const btnDeletePerm = sheet.querySelector('.sheet-menu-delete-perm');
  const btnDelete = sheet.querySelector('.sheet-menu-delete');

  (async () => {
    const notes = await getAllNotes();
    const note  = notes.find((n) => n.id === noteId);
    const label = btnArchive?.querySelector('.sheet-menu-item-label');
    if (note && label) {
      label.textContent = note.archived ? 'Arşivden çıkar' : 'Arşive gönder';
    }
    if (note?.deletedAt) {
      btnRestore?.classList.remove('hidden');
      btnDeletePerm?.classList.remove('hidden');
      btnCopy?.classList.add('hidden');
      btnArchive?.classList.add('hidden');
      btnFolder?.classList.add('hidden');
      btnTags?.classList.add('hidden');
      btnDelete?.classList.add('hidden');
    }
  })();

  btnTags.addEventListener('click', async () => {
    const notes = await getAllNotes();
    const note  = notes.find((n) => n.id === noteId);
    if (!note) { close(); return; }

    const tags = await getAllTags();
    const selected = new Set(note.tagIds ?? []);

    const overlayInner = document.createElement('div');
    overlayInner.className = 'sheet-overlay';
    const sheetInner = document.createElement('div');
    sheetInner.className = 'sheet sheet-bottom';

    const renderItems = () => {
      const items = tags.map((t) => {
        const on = selected.has(t.id);
        const bg = t.color ? `background:${t.color}` : '';
        const fg = t.fontColor ? `color:${t.fontColor}` : '';
        const style = [bg, fg].filter(Boolean).join(';');
        return `
          <button class="sheet-menu-item tag-assign-item" data-id="${t.id}">
            <i class="fa-solid ${on ? 'fa-square-check' : 'fa-square'}"></i>
            <span class="note-tag-chip-small" style="${style}">
              <span class="note-tag-chip-icon"><i class="fa-solid fa-tag"></i></span>
              <span>${escapeHtml(t.name)}</span>
            </span>
          </button>
        `;
      }).join('');
      sheetInner.innerHTML = `
        <div class="sheet-handle"></div>
        <div class="sheet-body">
          <p class="sheet-title">Etiket ata</p>
          <div class="sheet-note-actions">
            ${items || '<p class="empty-state" style="padding:0.75rem 0.25rem">Henüz etiket yok.</p>'}
            <button class="sheet-btn sheet-btn-cancel tag-assign-done">Bitti</button>
          </div>
        </div>
      `;
    };

    renderItems();
    overlayInner.appendChild(sheetInner);
    document.body.appendChild(overlayInner);

    const closeInner = () => {
      overlayInner.classList.remove('open');
      sheetInner.classList.remove('open');
      setTimeout(() => overlayInner.remove(), 180);
    };
    overlayInner.addEventListener('click', (e) => {
      if (e.target === overlayInner) closeInner();
    });
    sheetInner.addEventListener('click', async (e) => {
      const done = e.target.closest('.tag-assign-done');
      if (done) {
        note.tagIds = [...selected];
        await saveNote(note);
        await renderAll();
        closeInner();
        close();
        return;
      }
      const btn = e.target.closest('.tag-assign-item');
      if (!btn) return;
      const id = Number(btn.dataset.id);
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      renderItems();
    });
    requestAnimationFrame(() => {
      overlayInner.classList.add('open');
      sheetInner.classList.add('open');
    });
  });

  btnRestore.addEventListener('click', async () => {
    const notes = await getAllNotes();
    const note  = notes.find((n) => n.id === noteId);
    if (!note) { close(); return; }
    note.deletedAt = null;
    await saveNote(note);
    await renderAll();
    close();
  });

  btnDeletePerm.addEventListener('click', async () => {
    const notes = await getAllNotes();
    const note  = notes.find((n) => n.id === noteId);
    if (!note) { close(); return; }
    const ok = await showConfirmSheet({
      title: 'Kalıcı sil',
      message: 'Bu not ve tüm ekleri kalıcı olarak silinecek. Emin misin?',
      confirmLabel: 'Evet, kalıcı sil',
      cancelLabel: 'Vazgeç'
    });
    if (!ok) { close(); return; }
    if (note.photos?.length) {
      await Promise.all(note.photos.map((name) => deletePhoto(name).catch(() => {})));
    }
    if (note.audios?.length) {
      await Promise.all(note.audios.map((name) => deletePhoto(name).catch(() => {})));
    }
    for (const att of normalizeAttachments(note.attachments)) {
      await deletePhoto(att.stored).catch(() => {});
    }
    await deleteNote(note.id);
    await renderAll();
    close();
  });

  btnArchive.addEventListener('click', async () => {
    const notes = await getAllNotes();
    const note  = notes.find((n) => n.id === noteId);
    if (!note) { close(); return; }
    note.archived = !note.archived;
    await saveNote(note);
    await renderAll();
    close();
  });

  btnCopy.addEventListener('click', async () => {
    const notes = await getAllNotes();
    const note  = notes.find((n) => n.id === noteId);
    if (!note) { close(); return; }

    const newId = Date.now();
    const now   = new Date().toISOString();

    const newPhotoNames = [];
    for (let i = 0; i < (note.photos?.length ?? 0); i++) {
      const name = note.photos[i];
      try {
        const file = await loadPhoto(name);
        const ext  = (name.split('.').pop() || 'jpg').toLowerCase();
        const newName = `${newId}-photo-${Date.now()}-${i}.${ext}`;
        await savePhoto(newName, file);
        newPhotoNames.push(newName);
      } catch (_) {}
    }

    const newAudioNames = [];
    for (let i = 0; i < (note.audios?.length ?? 0); i++) {
      const name = note.audios[i];
      try {
        const file = await loadPhoto(name);
        const ext  = (name.split('.').pop() || 'webm').toLowerCase();
        const newName = `${newId}-audio-${Date.now()}-${i}.${ext}`;
        await savePhoto(newName, file);
        newAudioNames.push(newName);
      } catch (_) {}
    }

    const newAttachmentRecords = [];
    const srcAtt = normalizeAttachments(note.attachments);
    for (let i = 0; i < srcAtt.length; i++) {
      const att = srcAtt[i];
      try {
        const file = await loadPhoto(att.stored);
        const ext = safeFileExt(att.name);
        const newName = `${newId}-file-${Date.now()}-${i}.${ext}`;
        await savePhoto(newName, file);
        newAttachmentRecords.push({ name: att.name, stored: newName });
      } catch (_) {}
    }

    const copyNote = {
      id: newId,
      text: note.text,
      folderId: note.folderId ?? null,
      tagIds: [...(note.tagIds ?? [])],
      photos: newPhotoNames,
      audios: newAudioNames,
      attachments: newAttachmentRecords,
      archived: false,
      deletedAt: null,
      alarmAt: null,
      createdAt: now,
      updatedAt: now
    };
    await saveNote(copyNote);
    await renderAll();
    close();
  });

  btnFolder.addEventListener('click', async () => {
    const notes = await getAllNotes();
    const note  = notes.find((n) => n.id === noteId);
    if (!note) { close(); return; }

    const folders = await getAllFolders();
    const overlayInner = document.createElement('div');
    overlayInner.className = 'sheet-overlay';
    const sheetInner = document.createElement('div');
    sheetInner.className = 'sheet sheet-bottom';

    const currentFolderId = note.folderId != null ? Number(note.folderId) : null;
    const folderAssignLeading = (isCurrent) =>
      isCurrent
        ? '<i class="fa-solid fa-check folder-assign-current-icon" aria-hidden="true"></i>'
        : '<span class="folder-assign-current-spacer" aria-hidden="true"></span>';

    const items = folders.map((f) => {
      const isCurrent = currentFolderId !== null && currentFolderId === Number(f.id);
      return `
      <button type="button" class="sheet-menu-item folder-assign-item${isCurrent ? ' folder-assign-item--current' : ''}" data-id="${f.id}">
        ${folderAssignLeading(isCurrent)}
        <span class="note-folder-chip-small" style="${f.color ? `background:${f.color};` : ''}${f.fontColor ? `color:${f.fontColor};` : ''}">
          <span class="note-folder-chip-icon"><i class="fa-solid fa-folder"></i></span>
          <span>${escapeHtml(f.name)}</span>
        </span>
      </button>`;
    }).join('');

    const noneCurrent = currentFolderId === null;
    sheetInner.innerHTML = `
      <div class="sheet-handle"></div>
      <div class="sheet-body">
        <div class="sheet-note-actions">
          <button type="button" class="sheet-menu-item folder-assign-item${noneCurrent ? ' folder-assign-item--current' : ''}" data-id="">
            ${folderAssignLeading(noneCurrent)}
            <span class="note-folder-chip-small">
              <span class="note-folder-chip-icon"><i class="fa-regular fa-folder-open"></i></span>
              <span>Klasörü kaldır</span>
            </span>
          </button>
          ${items}
        </div>
      </div>
    `;
    overlayInner.appendChild(sheetInner);
    document.body.appendChild(overlayInner);
    const closeInner = () => {
      overlayInner.classList.remove('open');
      sheetInner.classList.remove('open');
      setTimeout(() => overlayInner.remove(), 180);
    };
    overlayInner.addEventListener('click', (e) => {
      if (e.target === overlayInner) closeInner();
    });
    sheetInner.addEventListener('click', async (e) => {
      const btn = e.target.closest('.folder-assign-item');
      if (!btn) return;
      const id = btn.dataset.id;
      note.folderId = id ? Number(id) : null;
      await saveNote(note);
      await renderAll();
      closeInner();
      close();
    });
    requestAnimationFrame(() => {
      overlayInner.classList.add('open');
      sheetInner.classList.add('open');
    });
  });
  btnDelete.addEventListener('click', async () => {
    const notes = await getAllNotes();
    const note  = notes.find((n) => n.id === noteId);
    if (!note) { close(); return; }

    // Çöp kutusuna taşı (kalıcı silme değil)
    const ok = await showConfirmSheet({
      title: 'Çöp kutusuna gönder',
      message: 'Bu not 30 gün boyunca çöp kutusunda kalacak. İstersen geri alabilirsin.',
      confirmLabel: 'Gönder',
      cancelLabel: 'Vazgeç'
    });

    if (!ok) { close(); return; }

    note.deletedAt = new Date().toISOString();
    await saveNote(note);
    await renderAll();
    close();
  });

  requestAnimationFrame(() => {
    overlay.classList.add('open');
    sheet.classList.add('open');
  });
}

// --- Lightbox için fotoğrafı OPFS'ten yükle ---

function openPhotoLightbox(name) {
  loadPhoto(name).then((f) => openLightbox(URL.createObjectURL(f))).catch(() => {});
}

// --- Fotoğrafı img elementine yükle ---

function attachPhoto(name, img) {
  loadPhoto(name)
    .then((file) => {
      const url = URL.createObjectURL(file);
      img.src = url;
      img.addEventListener('load', () => URL.revokeObjectURL(url));
    })
    .catch(() => {});
}

// --- Not kartlarındaki sesleri async yükle ---

async function loadNoteAudios(audioNames, container) {
  for (const name of audioNames) {
    try {
      const blob  = await loadPhoto(name);
      const url   = URL.createObjectURL(blob);
      const wrap  = document.createElement('div');
      wrap.className = 'card-audio-wrap';
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.preload  = 'metadata';
      audio.src      = url;
      audio.addEventListener('click', (e) => e.stopPropagation());
      wrap.appendChild(audio);
      container.appendChild(wrap);
    } catch { /* sessizce geç */ }
  }
}

// --- Render ---

async function renderNotes() {
  const [notes, folders, tags] = await Promise.all([getAllNotes(), getAllFolders(), getAllTags()]);
  notes.sort((a, b) => b.id - a.id);

  const foldersById = new Map(folders.map((f) => [f.id, f]));
  const tagsById = new Map(tags.map((t) => [t.id, t]));

  const byTrash = currentTrashFilter === 'trash'
    ? notes.filter((n) => Boolean(n.deletedAt))
    : notes.filter((n) => !n.deletedAt);

  const byArchive = currentArchiveFilter === 'archived'
    ? byTrash.filter((n) => n.archived === true)
    : byTrash.filter((n) => !n.archived);

  let filteredNotes = currentFolderFilterId == null
    ? byArchive
    : byArchive.filter((n) => n.folderId === currentFolderFilterId);

  const q = (searchQuery || '').trim().toLowerCase();
  if (q.length >= SEARCH_MIN_CHARS) {
    filteredNotes = filteredNotes.filter((n) => {
      const parsed = parseNoteText(n.text);
      const title = (parsed.title || '').toLowerCase();
      const body = (parsed.bodyHtml ? stripHtml(parsed.bodyHtml) : parsed.plainBody || '').toLowerCase();
      return title.includes(q) || body.includes(q);
    });
  }

  const mult = sortOrder === 'asc' ? 1 : -1;
  if (sortBy === 'createdAt') {
    filteredNotes = [...filteredNotes].sort((a, b) => mult * (new Date(a.createdAt) - new Date(b.createdAt)));
  } else if (sortBy === 'updatedAt') {
    filteredNotes = [...filteredNotes].sort((a, b) => {
      const ta = a.updatedAt ? new Date(a.updatedAt) : new Date(a.createdAt);
      const tb = b.updatedAt ? new Date(b.updatedAt) : new Date(b.createdAt);
      return mult * (ta - tb);
    });
  } else {
    filteredNotes = [...filteredNotes].sort((a, b) => {
      const titleA = (parseNoteText(a.text).title || '').trim().toLowerCase();
      const titleB = (parseNoteText(b.text).title || '').trim().toLowerCase();
      return mult * titleA.localeCompare(titleB, 'tr');
    });
  }

  noteCount.textContent = filteredNotes.length ? `${filteredNotes.length} not` : '';

  if (!filteredNotes.length) {
    let emptyMsg = 'Henüz not yok. Sağ alttaki + butonuna bas!';
    if (currentTrashFilter === 'trash') emptyMsg = 'Çöp kutusu boş.';
    else if (currentArchiveFilter === 'archived') emptyMsg = 'Arşivde not yok.';
    notesList.innerHTML = `<p class="empty-state">${emptyMsg}</p>`;
    return;
  }

  notesList.innerHTML = '';

  for (const note of filteredNotes) {
    const card = document.createElement('div');
    card.className  = 'note-card';
    card.dataset.id = note.id;

    const parsed  = parseNoteText(note.text);
    const preview = parsed.bodyHtml ? stripHtml(parsed.bodyHtml) : parsed.plainBody;

    const text = document.createElement('div');
    text.className = 'note-text';
    if (parsed.title) {
      const titleEl = document.createElement('p');
      titleEl.className   = 'note-title';
      titleEl.textContent = parsed.title;
      text.appendChild(titleEl);
    }
    if (preview) {
      const bodyEl = document.createElement('p');
      bodyEl.className   = 'note-body';
      bodyEl.textContent = preview.slice(0, 200) + (preview.length > 200 ? '…' : '');
      text.appendChild(bodyEl);
    }

    const footer = document.createElement('div');
    footer.className = 'note-footer';
    const dateSpan = document.createElement('span');
    dateSpan.className = 'note-date';
    dateSpan.textContent = formatDate(note.createdAt);
    const folderSpan = document.createElement('span');
    folderSpan.className = 'note-folder-chip-small';
    if (note.folderId != null) {
      const f = foldersById.get(note.folderId);
      if (f) {
        const icon = document.createElement('span');
        icon.className = 'note-folder-chip-icon';
        icon.innerHTML = '<i class="fa-solid fa-folder"></i>';
        folderSpan.appendChild(icon);
        folderSpan.appendChild(document.createTextNode(f.name));
        if (f.color) {
          folderSpan.style.backgroundColor = f.color;
        }
        if (f.fontColor) {
          folderSpan.style.color = f.fontColor;
        }
      }
    }
    const tagsSpan = document.createElement('span');
    tagsSpan.className = 'note-tags-inline';
    const ids = note.tagIds ?? [];
    if (ids.length) {
      const show = ids.slice(0, 2).map((id) => tagsById.get(id)).filter(Boolean);
      for (const t of show) {
        const chip = document.createElement('span');
        chip.className = 'note-tag-chip-small';
        const icon = document.createElement('span');
        icon.className = 'note-tag-chip-icon';
        icon.innerHTML = '<i class="fa-solid fa-tag"></i>';
        chip.appendChild(icon);
        chip.appendChild(document.createTextNode(t.name));
        if (t.color) chip.style.backgroundColor = t.color;
        if (t.fontColor) chip.style.color = t.fontColor;
        tagsSpan.appendChild(chip);
      }
      if (ids.length > show.length) {
        const more = document.createElement('span');
        more.className = 'note-tag-chip-small note-tag-chip-more';
        more.textContent = `+${ids.length - show.length}`;
        tagsSpan.appendChild(more);
      }
    }

    const footerEnd = document.createElement('div');
    footerEnd.className = 'note-footer-end';
    if (note.alarmAt) {
      const alarmBadge = document.createElement('span');
      alarmBadge.className = 'note-alarm-badge';
      alarmBadge.title = 'Alarm kurulu';
      alarmBadge.setAttribute('aria-label', 'Alarm kurulu');
      alarmBadge.innerHTML = '<i class="fa-solid fa-bell"></i>';
      footerEnd.appendChild(alarmBadge);
    }
    if (note.photos?.length) {
      const photoBadge = document.createElement('span');
      photoBadge.className = 'note-photo-badge';
      photoBadge.title = 'Fotoğraf eklendi';
      photoBadge.setAttribute('aria-label', 'Fotoğraf eklendi');
      photoBadge.innerHTML = '<i class="fa-solid fa-image"></i>';
      footerEnd.appendChild(photoBadge);
    }
    if (note.audios?.length) {
      const audioBadge = document.createElement('span');
      audioBadge.className = 'note-audio-badge';
      audioBadge.title = 'Ses kaydı eklendi';
      audioBadge.setAttribute('aria-label', 'Ses kaydı eklendi');
      audioBadge.innerHTML = '<i class="fa-solid fa-microphone"></i>';
      footerEnd.appendChild(audioBadge);
    }
    if (normalizeAttachments(note.attachments).length) {
      const fileBadge = document.createElement('span');
      fileBadge.className = 'note-attachment-badge';
      fileBadge.title = 'Dosya eki var';
      fileBadge.setAttribute('aria-label', 'Dosya eki var');
      fileBadge.innerHTML = '<i class="fa-solid fa-file"></i>';
      footerEnd.appendChild(fileBadge);
    }
    if (folderSpan.childNodes.length) {
      footerEnd.appendChild(folderSpan);
    }
    if (tagsSpan.childNodes.length) {
      footerEnd.appendChild(tagsSpan);
    }
    footer.append(dateSpan, footerEnd);

    card.appendChild(text);

    card.appendChild(footer);
    notesList.appendChild(card);
  }
}

async function renderFolders() {
  const folders = await getAllFolders();
  folders.sort((a, b) => b.id - a.id);

  if (!folders.length) {
    foldersList.innerHTML = '<p class="empty-state">Henüz klasör yok. Sağ alttaki + butonuna bas!</p>';
    return;
  }

  foldersList.innerHTML = '';

  for (const folder of folders) {
    const card = document.createElement('div');
    card.className = 'note-card folder-card';
    card.dataset.id = folder.id;

    const text = document.createElement('div');
    text.className = 'note-text';

    const titleRow = document.createElement('div');
    titleRow.className = 'folder-title-row';

    const colorDot = document.createElement('span');
    colorDot.className = 'folder-color-dot';
    if (folder.color) {
      colorDot.style.backgroundColor = folder.color;
    }

    const nameEl = document.createElement('p');
    nameEl.className = 'note-title';
    nameEl.textContent = folder.name;

    titleRow.append(colorDot, nameEl);
    text.appendChild(titleRow);

    if (folder.description) {
      const descEl = document.createElement('p');
      descEl.className = 'note-body';
      descEl.textContent = folder.description;
      text.appendChild(descEl);
    }

    const footer = document.createElement('div');
    footer.className = 'note-footer';
    const dateLabel = document.createElement('span');
    dateLabel.className = 'note-date';
    const dateSource = folder.updatedAt ?? folder.createdAt;
    dateLabel.textContent = dateSource ? formatDate(dateSource) : '';
    footer.appendChild(dateLabel);

    card.appendChild(text);
    card.appendChild(footer);
    foldersList.appendChild(card);
  }
}

async function renderTags() {
  const tags = await getAllTags();
  tags.sort((a, b) => b.id - a.id);

  if (!tags.length) {
    tagsList.innerHTML = '<p class="empty-state">Henüz etiket yok. Sağ alttaki + butonuna bas!</p>';
    return;
  }

  tagsList.innerHTML = '';

  for (const tag of tags) {
    const card = document.createElement('div');
    card.className = 'note-card tag-card';
    card.dataset.id = tag.id;

    const text = document.createElement('div');
    text.className = 'note-text';

    const titleRow = document.createElement('div');
    titleRow.className = 'tag-title-row';

    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.textContent = tag.name;
    if (tag.color) chip.style.backgroundColor = tag.color;
    if (tag.fontColor) chip.style.color = tag.fontColor;

    titleRow.appendChild(chip);
    text.appendChild(titleRow);

    const footer = document.createElement('div');
    footer.className = 'note-footer';
    const dateLabel = document.createElement('span');
    dateLabel.className = 'note-date';
    const dateSource = tag.updatedAt ?? tag.createdAt;
    dateLabel.textContent = dateSource ? formatDate(dateSource) : '';
    footer.appendChild(dateLabel);

    card.appendChild(text);
    card.appendChild(footer);
    tagsList.appendChild(card);
  }
}

async function renderAll() {
  await Promise.all([renderNotes(), renderFolders(), renderTags()]);
}

function setupNotesFilterBar() {
  if (!notesFilterBar) return;
  notesFilterBar.innerHTML = '';

  const folderChip = document.createElement('button');
  folderChip.type = 'button';
  folderChip.className = 'notes-filter-chip';
  const folderLabel = document.createElement('span');
  folderLabel.textContent = 'Tüm notlar';
  folderChip.append(folderLabel);
  const updateFolderLabel = async () => {
    if (currentFolderFilterId == null) {
      folderLabel.textContent = 'Tüm notlar';
      return;
    }
    try {
      const folders = await getAllFolders();
      const f = folders.find((x) => x.id === currentFolderFilterId);
      folderLabel.textContent = f ? f.name : 'Tüm notlar';
    } catch {
      folderLabel.textContent = 'Tüm notlar';
    }
  };
  folderChip.addEventListener('click', async () => {
    const folders = await getAllFolders();
    const overlay = document.createElement('div');
    overlay.className = 'sheet-overlay';
    const sheet = document.createElement('div');
    sheet.className = 'sheet sheet-bottom';
    const items = folders.map((f) => `
      <button class="sheet-menu-item folder-filter-item" data-id="${f.id}">
        <span class="folder-color-dot" style="${f.color ? `background:${f.color}` : 'background:transparent'}"></span>
        <span>${escapeHtml(f.name)}</span>
      </button>
    `).join('');
    sheet.innerHTML = `
      <div class="sheet-handle"></div>
      <div class="sheet-body">
        <div class="sheet-note-actions">
          <button class="sheet-menu-item folder-filter-item" data-id="">
            <span>Tüm notlar</span>
          </button>
          ${items}
        </div>
      </div>
    `;
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
    const close = () => {
      overlay.classList.remove('open');
      sheet.classList.remove('open');
      setTimeout(() => overlay.remove(), 180);
    };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    sheet.addEventListener('click', async (e) => {
      const btn = e.target.closest('.folder-filter-item');
      if (!btn) return;
      const id = btn.dataset.id;
      currentFolderFilterId = id ? Number(id) : null;
      await renderNotes();
      await updateFolderLabel();
      close();
    });
    requestAnimationFrame(() => {
      overlay.classList.add('open');
      sheet.classList.add('open');
    });
  });
  notesFilterBar.append(folderChip);

  const archiveChip = document.createElement('button');
  archiveChip.type = 'button';
  archiveChip.className = 'notes-filter-chip notes-filter-chip-archive';
  const archiveLabel = document.createElement('span');
  archiveLabel.textContent = currentArchiveFilter === 'archived' ? 'Arşiv' : 'Arşivlenmemiş';
  archiveChip.append(archiveLabel);
  const updateArchiveLabel = () => {
    archiveLabel.textContent = currentArchiveFilter === 'archived' ? 'Arşiv' : 'Arşivlenmemiş';
  };
  archiveChip.addEventListener('click', () => {
    const overlay = document.createElement('div');
    overlay.className = 'sheet-overlay';
    const sheet = document.createElement('div');
    sheet.className = 'sheet sheet-bottom';
    sheet.innerHTML = `
      <div class="sheet-handle"></div>
      <div class="sheet-body">
        <div class="sheet-note-actions">
          <button class="sheet-menu-item archive-filter-item" data-value="active">Arşivlenmemiş</button>
          <button class="sheet-menu-item archive-filter-item" data-value="archived">Arşiv</button>
        </div>
      </div>
    `;
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
    const close = () => {
      overlay.classList.remove('open');
      sheet.classList.remove('open');
      setTimeout(() => overlay.remove(), 180);
    };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    sheet.addEventListener('click', async (e) => {
      const btn = e.target.closest('.archive-filter-item');
      if (!btn) return;
      currentArchiveFilter = btn.dataset.value;
      await renderNotes();
      updateArchiveLabel();
      close();
    });
    requestAnimationFrame(() => {
      overlay.classList.add('open');
      sheet.classList.add('open');
    });
  });
  notesFilterBar.append(archiveChip);

  const trashChip = document.createElement('button');
  trashChip.type = 'button';
  trashChip.className = 'notes-filter-chip notes-filter-chip-trash';
  const trashLabel = document.createElement('span');
  trashChip.append(trashLabel);
  const updateTrashLabel = () => {
    trashLabel.textContent = currentTrashFilter === 'trash' ? 'Çöp kutusu' : 'Aktif';
  };
  trashChip.addEventListener('click', () => {
    const overlay = document.createElement('div');
    overlay.className = 'sheet-overlay';
    const sheet = document.createElement('div');
    sheet.className = 'sheet sheet-bottom';
    sheet.innerHTML = `
      <div class="sheet-handle"></div>
      <div class="sheet-body">
        <div class="sheet-note-actions">
          <button class="sheet-menu-item trash-filter-item" data-value="active">Aktif</button>
          <button class="sheet-menu-item trash-filter-item" data-value="trash">Çöp kutusu</button>
        </div>
      </div>
    `;
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
    const close = () => {
      overlay.classList.remove('open');
      sheet.classList.remove('open');
      setTimeout(() => overlay.remove(), 180);
    };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    sheet.addEventListener('click', async (e) => {
      const btn = e.target.closest('.trash-filter-item');
      if (!btn) return;
      currentTrashFilter = btn.dataset.value;
      await renderNotes();
      updateTrashLabel();
      close();
    });
    requestAnimationFrame(() => {
      overlay.classList.add('open');
      sheet.classList.add('open');
    });
  });
  notesFilterBar.append(trashChip);

  const sortChip = document.createElement('button');
  sortChip.type = 'button';
  sortChip.className = 'notes-filter-chip notes-filter-chip-sort';
  const sortIcon = document.createElement('span');
  sortIcon.className = 'notes-filter-chip-sort-icon';
  sortIcon.innerHTML = '<i class="fa-solid fa-filter"></i>';
  const sortLabel = document.createElement('span');
  sortChip.append(sortIcon, sortLabel);
  const getSortLabel = () => {
    if (sortBy === 'createdAt') return sortOrder === 'desc' ? 'Oluşturma (yeni)' : 'Oluşturma (eski)';
    if (sortBy === 'updatedAt') return sortOrder === 'desc' ? 'Güncelleme (yeni)' : 'Güncelleme (eski)';
    return sortOrder === 'asc' ? 'Başlık (A-Z)' : 'Başlık (Z-A)';
  };
  const updateSortLabel = () => { sortLabel.textContent = getSortLabel(); };
  sortChip.addEventListener('click', () => {
    const overlay = document.createElement('div');
    overlay.className = 'sheet-overlay';
    const sheet = document.createElement('div');
    sheet.className = 'sheet sheet-bottom';
    sheet.innerHTML = `
      <div class="sheet-handle"></div>
      <div class="sheet-body">
        <div class="sheet-note-actions">
          <button class="sheet-menu-item sort-filter-item" data-sort="createdAt" data-order="desc">Oluşturma (yeniden eskiye)</button>
          <button class="sheet-menu-item sort-filter-item" data-sort="createdAt" data-order="asc">Oluşturma (eskiden yeniye)</button>
          <button class="sheet-menu-item sort-filter-item" data-sort="updatedAt" data-order="desc">Güncelleme (yeniden eskiye)</button>
          <button class="sheet-menu-item sort-filter-item" data-sort="updatedAt" data-order="asc">Güncelleme (eskiden yeniye)</button>
          <button class="sheet-menu-item sort-filter-item" data-sort="title" data-order="asc">Başlık (A-Z)</button>
          <button class="sheet-menu-item sort-filter-item" data-sort="title" data-order="desc">Başlık (Z-A)</button>
        </div>
      </div>
    `;
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
    const close = () => {
      overlay.classList.remove('open');
      sheet.classList.remove('open');
      setTimeout(() => overlay.remove(), 180);
    };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    sheet.addEventListener('click', async (e) => {
      const btn = e.target.closest('.sort-filter-item');
      if (!btn) return;
      sortBy = btn.dataset.sort;
      sortOrder = btn.dataset.order;
      await renderNotes();
      updateSortLabel();
      close();
    });
    requestAnimationFrame(() => {
      overlay.classList.add('open');
      sheet.classList.add('open');
    });
  });
  notesFilterBar.append(sortChip);

  updateFolderLabel();
  updateArchiveLabel();
  updateTrashLabel();
  updateSortLabel();
}

function setupLongPressOnNotes() {
  const pressStart = (e) => {
    const card = e.target.closest('.note-card');
    if (!card) return;
    clearTimeout(longPressTimer);
    longPressTimer = setTimeout(() => {
      longPressActive = true;
      const id = Number(card.dataset.id);
      showNoteActionsSheet(id);
    }, 300);
  };

  const pressEnd = () => {
    clearTimeout(longPressTimer);
  };

  notesList.addEventListener('mousedown', pressStart);
  notesList.addEventListener('touchstart', pressStart);
  notesList.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.note-card')) e.preventDefault();
  });
  notesList.addEventListener('mouseup', pressEnd);
  notesList.addEventListener('mouseleave', pressEnd);
  notesList.addEventListener('touchend', pressEnd);
  notesList.addEventListener('touchcancel', pressEnd);
}

// --- Not kartı tıklama ---

notesList.addEventListener('click', async (e) => {
  const card = e.target.closest('.note-card');
  if (card) {
    if (longPressActive) {
      longPressActive = false;
      return;
    }
    const notes = await getAllNotes();
    const note  = notes.find((n) => n.id === Number(card.dataset.id));
    if (note) openEditor(note);
  }
});

// --- Klasör kartı tıklama ---

foldersList.addEventListener('click', (e) => {
  const card = e.target.closest('.folder-card');
  if (!card) return;
  const id = Number(card.dataset.id);
  getAllFolders().then((folders) => {
    const folder = folders.find((f) => f.id === id);
    if (folder) openFolderEditor(folder);
  }).catch(() => {});
});

// --- Etiket kartı tıklama ---

tagsList.addEventListener('click', (e) => {
  const card = e.target.closest('.tag-card');
  if (!card) return;
  const id = Number(card.dataset.id);
  getAllTags().then((tags) => {
    const tag = tags.find((t) => t.id === id);
    if (tag) openTagEditor(tag);
  }).catch(() => {});
});

// --- Service Worker (göreli yol: kök veya alt dizin fark etmez) ---

if ('serviceWorker' in navigator) {
  try {
    const reg = await navigator.serviceWorker.register('./service-worker.js', {
      updateViaCache: 'none'
    });
    const pingUpdate = () => {
      reg.update().catch(() => {});
    };
    window.addEventListener('focus', pingUpdate);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') pingUpdate();
    });
  } catch (err) {
    console.error('SW kaydı başarısız:', err);
  }
}

setupLongPressOnNotes();
setupNotesFilterBar();
await cleanupTrashExpired({ getAllNotes, deleteNote, deletePhoto, normalizeAttachments });
await renderAll();

initAlarmScheduler({ onAfterAlarm: () => renderAll() });
