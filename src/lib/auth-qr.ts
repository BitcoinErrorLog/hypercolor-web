import QRCode from "qrcode/lib/core/qrcode";

export const AUTH_QR_SIZE_PT = 220;
const QR_MODULE_SCALE = 8;
const QR_QUIET_ZONE = 2;

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i] ?? 0;
    for (let k = 0; k < 8; k += 1) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBuf = new TextEncoder().encode(type);
  const out = new Uint8Array(4 + 4 + data.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(typeBuf, 4);
  out.set(data, 8);
  const crcInput = new Uint8Array(typeBuf.length + data.length);
  crcInput.set(typeBuf, 0);
  crcInput.set(data, typeBuf.length);
  view.setUint32(8 + data.length, crc32(crcInput));
  return out;
}

function adler32(buf: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < buf.length; i += 1) {
    a = (a + (buf[i] ?? 0)) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary);
}

function rgbaToPngBase64(width: number, height: number, rgba: Uint8Array): string {
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const dest = y * (width * 4 + 1);
    raw[dest] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), dest + 1);
  }

  const stored: Uint8Array[] = [];
  const max = 65535;
  for (let off = 0; off < raw.length; off += max) {
    const chunk = raw.subarray(off, Math.min(off + max, raw.length));
    const block = new Uint8Array(5 + chunk.length);
    const last = off + chunk.length >= raw.length;
    block[0] = last ? 1 : 0;
    block[1] = chunk.length & 0xff;
    block[2] = (chunk.length >> 8) & 0xff;
    const nlen = chunk.length ^ 0xffff;
    block[3] = nlen & 0xff;
    block[4] = (nlen >> 8) & 0xff;
    block.set(chunk, 5);
    stored.push(block);
  }
  const deflateLen = stored.reduce((sum, b) => sum + b.length, 0);
  const zlibBody = new Uint8Array(2 + deflateLen + 4);
  zlibBody[0] = 0x78;
  zlibBody[1] = 0x01;
  let cursor = 2;
  for (const block of stored) {
    zlibBody.set(block, cursor);
    cursor += block.length;
  }
  const view = new DataView(zlibBody.buffer);
  view.setUint32(2 + deflateLen, adler32(raw));

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrChunk = pngChunk("IHDR", ihdr);
  const idatChunk = pngChunk("IDAT", zlibBody);
  const iendChunk = pngChunk("IEND", new Uint8Array(0));
  const png = new Uint8Array(
    signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length,
  );
  png.set(signature, 0);
  png.set(ihdrChunk, signature.length);
  png.set(idatChunk, signature.length + ihdrChunk.length);
  png.set(iendChunk, signature.length + ihdrChunk.length + idatChunk.length);
  return bytesToBase64(png);
}

/**
 * Encode `value` as a high-contrast PNG data URI (dark modules, white quiet zone).
 */
export function generateAuthQrDataUri(value: string): string {
  const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
  const modules = qr.modules;
  if (!modules) {
    throw new Error("Failed to encode authorization QR");
  }

  const moduleCount = modules.size;
  const dim = (moduleCount + QR_QUIET_ZONE * 2) * QR_MODULE_SCALE;
  const rgba = new Uint8Array(dim * dim * 4).fill(255);

  for (let y = 0; y < moduleCount; y += 1) {
    for (let x = 0; x < moduleCount; x += 1) {
      if (!modules.get(x, y)) continue;
      const originX = (x + QR_QUIET_ZONE) * QR_MODULE_SCALE;
      const originY = (y + QR_QUIET_ZONE) * QR_MODULE_SCALE;
      for (let dy = 0; dy < QR_MODULE_SCALE; dy += 1) {
        for (let dx = 0; dx < QR_MODULE_SCALE; dx += 1) {
          const idx = ((originY + dy) * dim + (originX + dx)) * 4;
          rgba[idx] = 0;
          rgba[idx + 1] = 0;
          rgba[idx + 2] = 0;
          rgba[idx + 3] = 255;
        }
      }
    }
  }

  return `data:image/png;base64,${rgbaToPngBase64(dim, dim, rgba)}`;
}
