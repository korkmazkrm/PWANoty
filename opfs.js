async function getPhotosDir() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('photos', { create: true });
}

export async function savePhoto(filename, blob) {
  const dir = await getPhotosDir();
  const fileHandle = await dir.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

export async function loadPhoto(filename) {
  const dir = await getPhotosDir();
  const fileHandle = await dir.getFileHandle(filename);
  return fileHandle.getFile();
}

export async function deletePhoto(filename) {
  const dir = await getPhotosDir();
  await dir.removeEntry(filename);
}
