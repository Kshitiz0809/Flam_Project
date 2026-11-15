// Prepares a user-chosen photo for upload: validates it, then downscales and
// re-encodes it as JPEG in the browser. A 12-megapixel phone photo (~4 MB)
// becomes ~150–300 KB, which uploads fast on mobile data and stays far below
// the server's body limit. Re-encoding also strips EXIF metadata (e.g. GPS).
import { AppError } from './errors.js';

const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_EDGE = 1280; // px — plenty for recognising food items
const QUALITY = 0.82;

/**
 * @param {File} file
 * @returns {Promise<{ mimeType: 'image/jpeg', data: string, previewUrl: string }>}
 *          `data` is base64 without the "data:" prefix; caller must revoke previewUrl.
 */
export async function prepareImage(file) {
  if (!file || !file.type?.startsWith('image/')) {
    throw new AppError('IMAGE_TYPE', `Unsupported file type: ${file?.type || 'unknown'}`);
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new AppError('IMAGE_TOO_LARGE', `File is ${(file.size / 1e6).toFixed(1)} MB`);
  }

  let source;
  try {
    source = await decode(file);
  } catch (err) {
    throw new AppError('IMAGE_UNREADABLE', `Could not decode ${file.type}: ${err?.message || err}`);
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new AppError('IMAGE_UNREADABLE', 'Canvas is not available');
  ctx.fillStyle = '#fff'; // transparent PNGs → white, not black, in JPEG
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
  source.close?.();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
  if (!blob) throw new AppError('IMAGE_UNREADABLE', 'Could not encode the image');

  return { mimeType: 'image/jpeg', data: await blobToBase64(blob), previewUrl: URL.createObjectURL(blob) };
}

/** createImageBitmap applies EXIF orientation; fall back to <img> for older browsers. */
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* fall through to <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new AppError('IMAGE_UNREADABLE', 'Could not read the encoded image'));
    reader.readAsDataURL(blob);
  });
}
