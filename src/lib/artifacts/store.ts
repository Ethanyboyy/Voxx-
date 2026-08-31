/**
 * Where artifact bytes live on disk.
 *
 * Separated from the service so the storage backend is swappable (a real
 * deployment would use object storage) without the service or any caller
 * changing, and so the path-safety rules live in exactly one place.
 *
 * Everything a provider returns is UNTRUSTED. A generated file is bytes from a
 * third party; a provider-supplied filename is a string from a third party. So
 * nothing here derives a path from provider input — paths are built from a
 * UUID and an extension chosen from a closed map of MIME types we are prepared
 * to serve. That closes both path traversal and "provider names a file
 * index.html and it gets served from our origin" in one move.
 */

import { mkdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/** Public directory served by Next at /artifacts/*. */
const ARTIFACT_ROOT = path.join(process.cwd(), "public", "artifacts");

/**
 * MIME types VOX will store, and the extension each gets.
 *
 * An allowlist rather than a sanitiser: a provider returning an unexpected
 * type is a signal something is wrong, and guessing an extension for it would
 * put an unknown file format under our public origin.
 */
const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "model/gltf-binary": "glb",
  "application/json": "json",
  "text/plain": "txt",
};

export class UnsupportedMimeTypeError extends Error {
  constructor(mimeType: string) {
    super(`Refusing to store unsupported MIME type "${mimeType}".`);
    this.name = "UnsupportedMimeTypeError";
  }
}

export class ArtifactTooLargeError extends Error {
  constructor(bytes: number, limit: number) {
    super(`Artifact is ${bytes} bytes, over the ${limit} byte limit.`);
    this.name = "ArtifactTooLargeError";
  }
}

/** 256 MB. Generous for video, bounded enough that a runaway cannot fill the disk. */
export const MAX_ARTIFACT_BYTES = 256 * 1024 * 1024;

export function isSupportedMimeType(mimeType: string): boolean {
  return Object.prototype.hasOwnProperty.call(EXTENSIONS, mimeType);
}

export interface StoredBytes {
  /** Public URL, e.g. /artifacts/ab/cdef….png */
  url: string;
  /** Absolute path on disk. */
  absolutePath: string;
  bytes: number;
}

/**
 * Writes bytes and returns where they went.
 *
 * The two-character shard directory keeps any single directory from
 * accumulating tens of thousands of entries, which is a real problem on some
 * filesystems and free to avoid here.
 */
export async function storeArtifactBytes(data: Uint8Array, mimeType: string): Promise<StoredBytes> {
  const extension = EXTENSIONS[mimeType];
  if (!extension) throw new UnsupportedMimeTypeError(mimeType);
  if (data.byteLength > MAX_ARTIFACT_BYTES) {
    throw new ArtifactTooLargeError(data.byteLength, MAX_ARTIFACT_BYTES);
  }
  if (data.byteLength === 0) {
    // An empty file is never a successful generation, and storing one would
    // create an artifact row pointing at nothing.
    throw new Error("Refusing to store an empty artifact.");
  }

  const id = randomUUID();
  const shard = id.slice(0, 2);
  const name = `${id}.${extension}`;
  const dir = path.join(ARTIFACT_ROOT, shard);
  await mkdir(dir, { recursive: true });
  const absolutePath = path.join(dir, name);
  await writeFile(absolutePath, data);

  // Size read back from disk rather than trusted from the buffer length — the
  // ledger should record what is actually there.
  const info = await stat(absolutePath);
  return { url: `/artifacts/${shard}/${name}`, absolutePath, bytes: info.size };
}

/**
 * PNG/JPEG/WebP dimensions, read from the file header.
 *
 * Deliberately header-only and failure-tolerant: dimensions are metadata, and
 * pulling in an image library to decode a whole frame for two integers would
 * be a poor trade. Returns null rather than guessing when the header is not
 * one of the recognised shapes — a wrong dimension recorded as fact is worse
 * than an absent one.
 */
export function readImageDimensions(data: Uint8Array): { width: number; height: number } | null {
  // PNG: 8-byte signature, then an IHDR chunk whose width/height are big-endian
  // 32-bit ints at offsets 16 and 20.
  if (
    data.length > 24 &&
    data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47
  ) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }

  // JPEG: walk the segment chain to a start-of-frame marker, which carries the
  // dimensions. Any other marker is skipped by its own length field.
  if (data.length > 4 && data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) break;
      const marker = data[offset + 1];
      // SOF0..SOF15, excluding the non-frame markers DHT/JPG/DAC at C4/C8/CC.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
      }
      offset += 2 + view.getUint16(offset + 2);
    }
  }

  // WebP: "RIFF"…"WEBPVP8 " — only the simple lossy VP8 header is read here.
  if (
    data.length > 30 &&
    data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
    data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50
  ) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (data[12] === 0x56 && data[13] === 0x50 && data[14] === 0x38 && data[15] === 0x20) {
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    }
  }

  return null;
}
