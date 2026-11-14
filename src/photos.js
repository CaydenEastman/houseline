// Photo downscaling helpers. Browser-only parts take an injectable `doc`.
export const PHOTO_MAX_DIM = 800, PHOTO_QUALITY = 0.72, PHOTO_MAX_BYTES = 150_000;

/** Fit (w,h) inside max x max keeping aspect ratio; never upscales; result >= 1px. */
export function fitSize(w, h, max = PHOTO_MAX_DIM) {
  if (![w, h, max].every((n) => Number.isFinite(n) && n > 0)) throw new Error("fitSize: width, height and max must be positive numbers");
  const scale = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

export function newPhotoId() {
  let rand = "";
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === "function") {
    const a = new Uint32Array(2);
    c.getRandomValues(a);
    rand = a[0].toString(36) + a[1].toString(36);
  } else {
    rand = Math.random().toString(36).slice(2, 12);
  }
  return `p-${Date.now().toString(36)}${rand}`;
}

/** Approximate decoded byte size of a base64 data URL. */
export function dataUrlBytes(url) {
  const i = url.indexOf(",");
  const b64 = url.slice(i + 1);
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

async function loadImage(file, doc) {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file);
      return { source: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close && bmp.close() };
    } catch { /* fall through to <img> */ }
  }
  const url = URL.createObjectURL(file);
  const img = doc.createElement("img");
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error("That file could not be read as an image."));
    img.src = url;
  }).finally(() => URL.revokeObjectURL(url));
  return { source: img, width: img.naturalWidth || img.width, height: img.naturalHeight || img.height, release() {} };
}

/** Resize to fit PHOTO_MAX_DIM and return a JPEG data URL (<= PHOTO_MAX_BYTES). */
export async function downscaleImage(file, { doc = globalThis.document, loader = loadImage } = {}) {
  if (!file || typeof file.type !== "string" || !file.type.startsWith("image/")) throw new Error("Please choose an image file.");
  if (!doc) throw new Error("No document available to process the image.");
  const img = await loader(file, doc);
  try {
    if (!img.width || !img.height) throw new Error("That image has no size and can't be used.");
    const { w, h } = fitSize(img.width, img.height, PHOTO_MAX_DIM);
    const canvas = doc.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Image processing is not available in this browser.");
    ctx.fillStyle = "#fff"; // JPEG has no alpha
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img.source, 0, 0, w, h);
    let url = canvas.toDataURL("image/jpeg", PHOTO_QUALITY);
    if (!url.startsWith("data:image/jpeg")) throw new Error("This browser could not encode the photo as JPEG.");
    if (dataUrlBytes(url) > PHOTO_MAX_BYTES) {
      url = canvas.toDataURL("image/jpeg", PHOTO_QUALITY * 0.6);
      if (dataUrlBytes(url) > PHOTO_MAX_BYTES) {
        throw new Error(`That photo is still larger than ${Math.round(PHOTO_MAX_BYTES / 1000)} KB after shrinking. Try a simpler or smaller image.`);
      }
    }
    return url;
  } finally {
    img.release && img.release();
  }
}
