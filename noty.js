import { getAllNotes, saveNote, deleteNote } from './db.js';
import { savePhoto, loadPhoto, deletePhoto } from './opfs.js';

// --- DOM ---

const notesList      = document.getElementById('notesList');
const noteCount      = document.getElementById('noteCount');
const menuBtn        = document.getElementById('menuBtn');
const sidebar        = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebarOverlay');
const sidebarClose   = document.getElementById('sidebarClose');
const navItems       = document.querySelectorAll('.nav-item');
const viewList       = document.getElementById('view-list');
const viewDetail     = document.getElementById('view-detail');
const detailContent  = document.getElementById('detailContent');
const lightbox       = document.getElementById('lightbox');
const lightboxImg    = document.getElementById('lightboxImg');
const lightboxClose  = document.getElementById('lightboxClose');
const fab            = document.getElementById('fab');
const themeToggle    = document.getElementById('themeToggle');
const themeIcon      = document.getElementById('themeIcon');
const themeLabel     = document.getElementById('themeLabel');

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

function navigateTo(viewName) {
  if (viewName === 'add') { openEditor(null); return; }
  viewList.classList.toggle('hidden', viewName !== 'list');
  viewDetail.classList.toggle('hidden', viewName !== 'detail');
  fab.classList.toggle('hidden', viewName !== 'list');
  navItems.forEach((btn) => btn.classList.toggle('active', btn.dataset.view === viewName));
  closeSidebar();
}

fab.addEventListener('click', () => openEditor(null));

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

  const saveBtn = document.createElement('button');
  saveBtn.className = 'editor-save-btn';
  saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i>';
  saveBtn.addEventListener('click', async () => {
    const title       = titleInput.value.trim();
    const body        = textarea.value.trim();
    const updatedText = title + (body ? '\n' + body : '');
    const hasContent  = updatedText || keptPhotos.length || newPhotos.length || keptAudios.length || newAudios.length;
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

    const record = isNew
      ? { id, text: updatedText, createdAt: new Date().toISOString(), photos: newPhotoNames, audios: newAudioNames }
      : { ...note, text: updatedText, photos: [...keptPhotos, ...newPhotoNames], audios: [...keptAudios, ...newAudioNames], updatedAt: new Date().toISOString() };

    await saveNote(record);

    newPhotos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    newAudios.forEach((a) => URL.revokeObjectURL(a.url));
    await render();
    navigateTo('list');
  });

  topBar.append(cancelBtn, dateLabel, saveBtn);

  // --- Başlık alanı ---
  const titleInput = document.createElement('input');
  titleInput.type        = 'text';
  titleInput.className   = 'editor-title-input';
  titleInput.placeholder = 'Başlık';
  titleInput.value       = isNew ? '' : note.text.split('\n')[0];
  titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      textarea.focus();
      textarea.setSelectionRange(0, 0);
    }
  });

  // --- Yazı alanı ---
  const textarea = document.createElement('textarea');
  textarea.className   = 'edit-textarea';
  textarea.value       = isNew ? '' : note.text.split('\n').slice(1).join('\n');
  textarea.placeholder = 'Notunu buraya yaz...';

  function autoResize() {
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }
  textarea.addEventListener('input', autoResize);

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

  bottomBar.append(photoAddBtn, fileInput, micBtn, recIndicator);
  detailContent.append(topBar, titleInput, textarea, strip, audioStrip, bottomBar);
  renderEditStrip();
  renderAudioStrip();

  // view-detail'i göster, diğerlerini gizle
  viewList.classList.add('hidden');
  viewDetail.classList.remove('hidden');
  fab.classList.add('hidden');
  navItems.forEach((btn) => btn.classList.remove('active'));

  autoResize();
  if (isNew) {
    titleInput.focus();
  } else {
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }
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

async function render() {
  const notes = await getAllNotes();
  notes.sort((a, b) => b.id - a.id);

  noteCount.textContent = notes.length ? `${notes.length} not` : '';

  if (!notes.length) {
    notesList.innerHTML = '<p class="empty-state">Henüz not yok. Sağ alttaki + butonuna bas!</p>';
    return;
  }

  notesList.innerHTML = '';

  for (const note of notes) {
    const card = document.createElement('div');
    card.className  = 'note-card';
    card.dataset.id = note.id;

    const lines     = note.text.split('\n');
    const noteTitle = lines[0];
    const noteBody  = lines.slice(1).join('\n').trim();

    const text = document.createElement('div');
    text.className = 'note-text';
    if (noteTitle) {
      const titleEl = document.createElement('p');
      titleEl.className   = 'note-title';
      titleEl.textContent = noteTitle;
      text.appendChild(titleEl);
    }
    if (noteBody) {
      const bodyEl = document.createElement('p');
      bodyEl.className   = 'note-body';
      bodyEl.textContent = noteBody;
      text.appendChild(bodyEl);
    }

    const footer = document.createElement('div');
    footer.className = 'note-footer';
    footer.innerHTML = `
      <span class="note-date">${formatDate(note.createdAt)}</span>
      <button class="delete-btn" data-id="${note.id}">Sil</button>`;

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

// --- Not sil ---

notesList.addEventListener('click', async (e) => {
  const deleteBtn = e.target.closest('.delete-btn');

  if (deleteBtn) {
    const id    = Number(deleteBtn.dataset.id);
    const notes = await getAllNotes();
    const note  = notes.find((n) => n.id === id);

    if (note?.photos?.length) {
      await Promise.all(note.photos.map((name) => deletePhoto(name).catch(() => {})));
    }
    if (note?.audios?.length) {
      await Promise.all(note.audios.map((name) => deletePhoto(name).catch(() => {})));
    }

    await deleteNote(id);
    await render();
    return;
  }

  const card = e.target.closest('.note-card');
  if (card) {
    const notes = await getAllNotes();
    const note  = notes.find((n) => n.id === Number(card.dataset.id));
    if (note) openEditor(note);
  }
});

// --- Service Worker ---

if ('serviceWorker' in navigator) {
  try {
    await navigator.serviceWorker.register('/service-worker.js');
  } catch (err) {
    console.error('SW kaydı başarısız:', err);
  }
}

await render();
