import sharp from 'sharp';
import { customAlphabet } from 'nanoid';
import path from 'node:path';
import { prisma } from '@/lib/db';
import { bunnyUpload, bunnyDelete } from '@/lib/bunny';

export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MB
export const IMAGE_MAX_DIMENSION = 1920;
export const WEBP_QUALITY = 82;

const slug = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 8);

const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/tiff', 'image/bmp'];

export function isImageMime(m: string) { return IMAGE_MIME.includes(m); }
export function isSvgMime(m: string) { return m === 'image/svg+xml'; }

function sanitizeName(name: string) {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function datePath() {
  const d = new Date();
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export interface ProcessUploadOpts {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  folderId?: string | null;
  uploadedById?: string | null;
}

export interface ProcessedUpload {
  id: string;
  publicUrl: string;
  originalUrl: string | null;
  name: string;
  size: number;
  width: number | null;
  height: number | null;
  mimeType: string;
  isImage: boolean;
  isSvg: boolean;
}

/**
 * Processes one uploaded file:
 *  - Image (raster): resize to max 1920px, convert to WebP, upload to Bunny.
 *  - SVG: upload original, AND rasterize to WebP (transparent) as companion.
 *  - Other: upload as-is.
 * Creates MediaFile row, returns metadata.
 */
export async function processAndUpload({
  buffer, originalName, mimeType, folderId, uploadedById,
}: ProcessUploadOpts): Promise<ProcessedUpload> {
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error(`File exceeds 500 MB limit`);
  }

  const baseSafe = sanitizeName(path.parse(originalName).name) || 'file';
  const uniqueId = slug();
  const baseKey = `media/${datePath()}/${baseSafe}-${uniqueId}`;

  const isImg = isImageMime(mimeType);
  const isSvg = isSvgMime(mimeType);

  let primaryKey: string;
  let primaryType: string;
  let primaryBody: Buffer;
  let width: number | null = null;
  let height: number | null = null;
  let originalKey: string | null = null;
  let originalUrl: string | null = null;
  let displayName: string;

  if (isSvg) {
    // 1) Upload original SVG
    originalKey = `${baseKey}.svg`;
    const upOrig = await bunnyUpload({
      key: originalKey, body: buffer, contentType: 'image/svg+xml',
    });
    originalUrl = upOrig.publicUrl;
    // 2) Rasterize to WebP companion (preserve transparency)
    try {
      const raster = await sharp(buffer, { density: 300 })
        .resize({ width: IMAGE_MAX_DIMENSION, height: IMAGE_MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY, alphaQuality: 95 })
        .toBuffer({ resolveWithObject: true });
      primaryBody = raster.data;
      primaryType = 'image/webp';
      primaryKey = `${baseKey}.webp`;
      width = raster.info.width;
      height = raster.info.height;
    } catch {
      // If rasterization fails (rare), fall back to SVG-only
      primaryBody = buffer;
      primaryType = 'image/svg+xml';
      primaryKey = originalKey;
      originalKey = null;
      originalUrl = null;
    }
    displayName = `${baseSafe}.${primaryType === 'image/webp' ? 'webp' : 'svg'}`;
  } else if (isImg) {
    // Raster image — resize + convert to WebP
    const img = sharp(buffer).rotate(); // auto-orient
    const meta = await img.metadata();
    const transformed = await img
      .resize({
        width: IMAGE_MAX_DIMENSION,
        height: IMAGE_MAX_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });
    primaryBody = transformed.data;
    primaryType = 'image/webp';
    primaryKey = `${baseKey}.webp`;
    width = transformed.info.width;
    height = transformed.info.height;
    displayName = `${baseSafe}.webp`;
    void meta;
  } else {
    // Non-image: upload as-is
    const ext = path.parse(originalName).ext.replace('.', '').toLowerCase() || 'bin';
    primaryBody = buffer;
    primaryType = mimeType || 'application/octet-stream';
    primaryKey = `${baseKey}.${ext}`;
    displayName = `${baseSafe}.${ext}`;
  }

  const up = await bunnyUpload({
    key: primaryKey,
    body: primaryBody,
    contentType: primaryType,
  });

  const row = await prisma.mediaFile.create({
    data: {
      folderId: folderId ?? null,
      name: displayName,
      originalName,
      storageKey: primaryKey,
      originalKey,
      mimeType: primaryType,
      size: primaryBody.byteLength,
      width,
      height,
      isImage: isImg || isSvg,
      isSvg,
      publicUrl: up.publicUrl,
      originalUrl,
      uploadedById: uploadedById ?? null,
    },
  });

  return {
    id: row.id,
    publicUrl: row.publicUrl,
    originalUrl: row.originalUrl,
    name: row.name,
    size: row.size,
    width: row.width,
    height: row.height,
    mimeType: row.mimeType,
    isImage: row.isImage,
    isSvg: row.isSvg,
  };
}

export async function deleteMediaFile(id: string) {
  const file = await prisma.mediaFile.findUnique({ where: { id } });
  if (!file) return false;
  const keys = [file.storageKey, file.originalKey].filter(Boolean) as string[];
  await bunnyDelete(keys);
  await prisma.mediaFile.delete({ where: { id } });
  return true;
}

export function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
