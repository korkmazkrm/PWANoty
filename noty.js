import { getAllNotes, saveNote, deleteNote, getAllFolders, saveFolder, deleteFolder } from './db.js';
import { savePhoto, loadPhoto, deletePhoto } from './opfs.js';

// --- DOM ---

const notesList      = document.getElementById('notesList');
const notesFilterBar = document.getElementById('notesFilterBar');
const notesSearchInput = document.getElementById('notesSearchInput');
const notesSearchClear = document.getElementById('notesSearchClear');
const foldersList    = document.getElementById('foldersList');
const noteCount      = document.getElementById('noteCount');
const menuBtn        = document.getElementById('menuBtn');
const sidebar        = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebarOverlay');
const sidebarClose   = document.getElementById('sidebarClose');
const navItems       = document.querySelectorAll('.nav-item');
const viewList       = document.getElementById('view-list');
const viewFolders    = document.getElementById('view-folders');
const viewDetail     = document.getElementById('view-detail');
const detailContent  = document.getElementById('detailContent');
const appTitle       = document.getElementById('appTitle');
const headerSearch   = document.getElementById('headerSearch');
const headerSearchBtn = document.getElementById('headerSearchBtn');
const lightbox       = document.getElementById('lightbox');
const lightboxImg    = document.getElementById('lightboxImg');
const lightboxClose  = document.getElementById('lightboxClose');
const fab            = document.getElementById('fab');
const themeToggle    = document.getElementById('themeToggle');
const themeIcon      = document.getElementById('themeIcon');
const themeLabel     = document.getElementById('themeLabel');

let longPressTimer = null;
let longPressActive = false;
let currentMode = 'notes';
let currentFolderFilterId = null;
let currentArchiveFilter = 'active'; // 'active' = arşivlenmemiş, 'archived' = arşiv
let sortBy = 'createdAt';   // 'createdAt' | 'updatedAt' | 'title'
let sortOrder = 'desc';     // 'asc' | 'desc'
let currentTrashFilter = 'active'; // 'active' = çöp değil, 'trash' = çöp kutusu
let searchQuery = '';

// --- Tema ---

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const isLight = theme === 'light';
  themeIcon.className  = isLight ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
  themeLabel.textContent = isLight ? 'Dark Mode' : 'Light Mode';
  localStorage.setItem('noty-theme', theme);
}

applyTheme(localStorage.getItem('noty-theme') ?? 'dark');

themeToggle.addEventListener('click', () => {
  const current = document.documentElement.dataset.theme ?? 'dark';
  applyTheme(current === 'dark' ? 'light' : 'dark');
});

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

const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

async function cleanupTrashExpired() {
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
    return now - t >= TRASH_RETENTION_MS;
  });

  if (!expired.length) return;

  for (const note of expired) {
    if (note.photos?.length) {
      await Promise.all(note.photos.map((name) => deletePhoto(name).catch(() => {})));
    }
    if (note.audios?.length) {
      await Promise.all(note.audios.map((name) => deletePhoto(name).catch(() => {})));
    }
    await deleteNote(note.id).catch(() => {});
  }
}

// --- Lightbox ---

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
lightbox.addEventListener('click', (e) => { if (e.target === lightbox) closeLightbox(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });

// --- Navigasyon ---

function showListViews() {
  viewList.classList.toggle('hidden', currentMode !== 'notes');
  viewFolders.classList.toggle('hidden', currentMode !== 'folders');
  viewDetail.classList.add('hidden');
  fab.classList.remove('hidden');
}

function navigateTo(viewName) {
  if (viewName === 'add') { openEditor(null); return; }
  if (viewName === 'folders') {
    currentMode = 'folders';
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
  } else {
    openEditor(null);
  }
});

// --- Zengin metin: not metni parse/serialize (eski notlarla uyumlu) ---
const BODY_DELIMITER = '\n<!--noty-body-->\n';

function parseNoteText(text) {
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

function serializeNoteText(title, bodyHtml) {
  return (title || '').trim() + BODY_DELIMITER + (bodyHtml || '');
}

function stripHtml(html) {
  if (!html) return '';
  const el = document.createElement('div');
  el.innerHTML = html;
  return (el.textContent || el.innerText || '').trim();
}

// --- Ses kaydı yardımcıları ---

function getSupportedAudioMime() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
}

function audioExt(mimeType) {
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mp4')) return 'm4a';
  return 'webm';
}

// --- Editör (yeni not & düzenleme) ---

function openEditor(note) {
  const isNew = note === null;

  let keptPhotos    = isNew ? [] : [...(note.photos ?? [])];
  let removedPhotos = [];
  let newPhotos     = [];

  let keptAudios    = isNew ? [] : [...(note.audios ?? [])];
  let removedAudios = [];
  let newAudios     = [];

  let mediaRecorder   = null;
  let recordingChunks = [];
  let recordingTimer  = null;

  detailContent.innerHTML = '';

  // --- Üst toolbar ---
  const topBar = document.createElement('div');
  topBar.className = 'editor-top-bar';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'editor-cancel-btn';
  cancelBtn.innerHTML = '<i class="fa-solid fa-arrow-left"></i>';
  cancelBtn.addEventListener('click', () => {
    if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
    clearInterval(recordingTimer);
    newPhotos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    newAudios.forEach((a) => URL.revokeObjectURL(a.url));
    viewList.classList.remove('hidden');
    viewDetail.classList.add('hidden');
    fab.classList.remove('hidden');
    navItems.forEach((btn) => btn.classList.toggle('active', btn.dataset.view === 'list'));
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
    const hasContent  = (title || bodyHtml) || keptPhotos.length || newPhotos.length || keptAudios.length || newAudios.length;
    if (!hasContent) return;

    if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
    clearInterval(recordingTimer);

    await Promise.all(removedPhotos.map((n) => deletePhoto(n).catch(() => {})));
    await Promise.all(removedAudios.map((n) => deletePhoto(n).catch(() => {})));

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

    const folderId = selectedFolder ? selectedFolder.id : null;

    const base = {
      id,
      text: updatedText,
      photos: [...keptPhotos, ...newPhotoNames],
      audios: [...keptAudios, ...newAudioNames],
      folderId
    };

    const record = isNew
      ? { ...base, archived: false, deletedAt: null, createdAt: new Date().toISOString() }
      : { ...note, ...base, updatedAt: new Date().toISOString() };

    await saveNote(record);

    newPhotos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    newAudios.forEach((a) => URL.revokeObjectURL(a.url));
    await renderAll();
    navigateTo('list');
  });

  topBar.append(cancelBtn, dateLabel, spacer, saveBtn);

  // --- Başlık alanı ---
  const titleInput = document.createElement('input');
  titleInput.type        = 'text';
  titleInput.className   = 'editor-title-input';
  titleInput.placeholder = 'Başlık';
  const parsed = isNew ? { title: '', bodyHtml: '', plainBody: '' } : parseNoteText(note.text);
  titleInput.value = parsed.title;
  const initialFolderId = isNew ? currentFolderFilterId : (note.folderId ?? null);

  // --- Klasör satırı ---
  const folderRow = document.createElement('div');
  folderRow.className = 'note-folder-row';
  const folderIcon = document.createElement('span');
  folderIcon.className = 'note-folder-icon';
  folderIcon.innerHTML = '<i class="fa-solid fa-folder"></i>';
  const folderText = document.createElement('span');
  folderText.className = 'note-folder-text';
  folderRow.append(folderIcon, folderText);

  let selectedFolder = null;

  function updateFolderRow() {
    if (!selectedFolder) {
      folderRow.style.display = 'none';
      folderText.textContent = '';
      return;
    }
    folderRow.style.display = 'inline-flex';
    folderText.textContent = selectedFolder.name;
  }

  async function initFolderRow() {
    if (!initialFolderId) {
      updateFolderRow();
      return;
    }
    try {
      const folders = await getAllFolders();
      selectedFolder = folders.find((f) => f.id === initialFolderId) ?? null;
      updateFolderRow();
    } catch {
      selectedFolder = null;
      updateFolderRow();
    }
  }

  folderBtn.addEventListener('click', async () => {
    const folders = await getAllFolders();
    const overlay = document.createElement('div');
    overlay.className = 'sheet-overlay';
    const sheet = document.createElement('div');
    sheet.className = 'sheet sheet-bottom';
    const items = folders.map((f) => `
      <button class="sheet-menu-item folder-pick-item" data-id="${f.id}">
        <span class="folder-color-dot" style="${f.color ? `background:${f.color}` : 'background:transparent'}"></span>
        <span>${f.name}</span>
      </button>
    `).join('');
    sheet.innerHTML = `
      <div class="sheet-handle"></div>
      <div class="sheet-body">
        <div class="sheet-note-actions">
          <button class="sheet-menu-item folder-pick-item" data-id="">
            <span>Hiçbir klasör yok</span>
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
      } else {
        const fid = Number(id);
        selectedFolder = folders.find((f) => f.id === fid) ?? null;
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

  // --- Alt toolbar ---
  const fileInput    = document.createElement('input');
  fileInput.type     = 'file';
  fileInput.accept   = 'image/*';
  fileInput.multiple = true;
  fileInput.hidden   = true;
  fileInput.addEventListener('change', () => {
    for (const file of fileInput.files) {
      newPhotos.push({ file, previewUrl: URL.createObjectURL(file) });
    }
    fileInput.value = '';
    renderEditStrip();
  });

  const bottomBar = document.createElement('div');
  bottomBar.className = 'editor-bottom-bar';

  const photoAddBtn = document.createElement('button');
  photoAddBtn.className = 'editor-icon-btn';
  photoAddBtn.title     = 'Fotoğraf Ekle';
  photoAddBtn.innerHTML = '<i class="fa-solid fa-camera"></i>';
  photoAddBtn.addEventListener('click', () => fileInput.click());

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

  bottomBar.append(folderBtn, photoAddBtn, fileInput, micBtn, recIndicator, formatToggleBtn);
  detailContent.append(topBar, titleInput, folderRow, bodyEditor, strip, audioStrip, formatBarAboveBottom, bottomBar);
  renderEditStrip();
  renderAudioStrip();

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
  titleSpan.textContent = isNew ? 'Yeni Klasör' : 'Klasörü Düzenle';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'editor-save-btn';
  saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i>';

  topBar.append(cancelBtn, titleSpan, saveBtn);

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

  detailContent.append(topBar, nameInput, colorRow, descInput);

  viewList.classList.add('hidden');
  viewFolders.classList.add('hidden');
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
navItems.forEach((btn) => btn.addEventListener('click', () => navigateTo(btn.dataset.view)));

// --- Yardımcı ---

function formatDate(iso) {
  return new Date(iso).toLocaleString('tr-TR', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

// Mobil alt sheet tarzı confirm diyaloğu
function showConfirmSheet({ title, message, confirmLabel = 'Sil', cancelLabel = 'Vazgeç' }) {
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

    // küçük animasyon için next frame'de aç
    requestAnimationFrame(() => {
      overlay.classList.add('open');
      sheet.classList.add('open');
    });
  });
}

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
      btnDelete?.classList.add('hidden');
    }
  })();

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

    const copyNote = {
      id: newId,
      text: note.text,
      folderId: note.folderId ?? null,
      photos: newPhotoNames,
      audios: newAudioNames,
      archived: false,
      deletedAt: null,
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
    const items = folders.map((f) => `
      <button class="sheet-menu-item folder-assign-item" data-id="${f.id}">
        <span class="folder-color-dot" style="${f.color ? `background:${f.color}` : 'background:transparent'}"></span>
        <span>${f.name}</span>
      </button>
    `).join('');
    sheetInner.innerHTML = `
      <div class="sheet-handle"></div>
      <div class="sheet-body">
        <div class="sheet-note-actions">
          <button class="sheet-menu-item folder-assign-item" data-id="">
            <span>Hiçbir klasör yok</span>
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

// --- Not kartlarındaki fotoğrafları async yükle ---

async function loadNotePhotos(photoNames, container) {
  for (const name of photoNames) {
    try {
      const file = await loadPhoto(name);
      const url  = URL.createObjectURL(file);
      const img  = document.createElement('img');
      img.src       = url;
      img.className = 'note-photo';
      img.alt       = name;
      img.addEventListener('load', () => URL.revokeObjectURL(url));
      container.appendChild(img);
    } catch { /* sessizce geç */ }
  }
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
  const [notes, folders] = await Promise.all([getAllNotes(), getAllFolders()]);
  notes.sort((a, b) => b.id - a.id);

  const foldersById = new Map(folders.map((f) => [f.id, f]));

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
    footer.append(dateSpan, folderSpan);

    card.appendChild(text);

    if (note.photos?.length) {
      const grid = document.createElement('div');
      grid.className = 'photo-grid';
      card.appendChild(grid);
      loadNotePhotos(note.photos, grid);
    }

    if (note.audios?.length) {
      const audioBlock = document.createElement('div');
      audioBlock.className = 'card-audio-block';
      card.appendChild(audioBlock);
      loadNoteAudios(note.audios, audioBlock);
    }

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

async function renderAll() {
  await Promise.all([renderNotes(), renderFolders()]);
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
        <span>${f.name}</span>
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

// --- Service Worker (göreli yol: kök veya alt dizin fark etmez) ---

if ('serviceWorker' in navigator) {
  try {
    await navigator.serviceWorker.register('./service-worker.js');
  } catch (err) {
    console.error('SW kaydı başarısız:', err);
  }
}

setupLongPressOnNotes();
setupNotesFilterBar();
await cleanupTrashExpired();
await renderAll();
