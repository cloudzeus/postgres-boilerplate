import { Readable } from 'node:stream';
import { S3Client, PutObjectCommand, DeleteObjectCommand, DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSetting } from '@/lib/settings';

interface BunnyCfg {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  zone: string;
  cdnHost: string;
}

async function resolveCfg(): Promise<BunnyCfg> {
  const endpoint   = (await getSetting<string>('storage.bunnyS3Endpoint')) ?? process.env.BUNNY_S3_REGION_ENDPOINT ?? 'https://de-s3.storage.bunnycdn.com';
  const accessKey  = (await getSetting<string>('storage.bunnyAccessKey'))  ?? process.env.BUNNY_ACCESS_KEY ?? '';
  const secretKey  = (await getSetting<string>('storage.bunnyS3SecretKey'))?? process.env.BUNNY_S3_REGION_SECRET_KEY ?? '';
  const zone       = (await getSetting<string>('storage.bunnyZone'))       ?? process.env.BUNNY_STORAGE_ZONE ?? '';
  const cdnHost    = (await getSetting<string>('storage.cdnHost'))         ?? process.env.BUNNY_STORAGE_API_HOST ?? '';
  if (!accessKey || !secretKey || !zone) {
    throw new Error('BunnyCDN credentials missing. Configure storage.* settings.');
  }
  return { endpoint, accessKey, secretKey, zone, cdnHost };
}

async function makeClient(cfg: BunnyCfg) {
  return new S3Client({
    endpoint: cfg.endpoint,
    region: 'auto',
    credentials: { accessKeyId: cfg.zone, secretAccessKey: cfg.accessKey },
    forcePathStyle: true,
  });
}

export interface UploadInput {
  key: string;          // path inside storage zone, no leading slash
  body: Buffer;
  contentType: string;
  cacheControl?: string;
}

export async function bunnyUpload({ key, body, contentType, cacheControl = 'public, max-age=31536000, immutable' }: UploadInput) {
  const cfg = await resolveCfg();
  const s3 = await makeClient(cfg);
  await s3.send(new PutObjectCommand({
    Bucket: cfg.zone,
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: cacheControl,
    ACL: 'public-read',
  }));
  const publicUrl = cfg.cdnHost
    ? `https://${cfg.cdnHost.replace(/^https?:\/\//, '')}/${encodeURI(key)}`
    : `${cfg.endpoint.replace(/\/$/, '')}/${cfg.zone}/${encodeURI(key)}`;
  return { publicUrl, key };
}

// Private upload — same target zone, no public-read ACL. Used for backups.
export async function bunnyUploadPrivate({ key, body, contentType }: { key: string; body: Buffer; contentType: string }) {
  const cfg = await resolveCfg();
  const s3 = await makeClient(cfg);
  await s3.send(new PutObjectCommand({
    Bucket: cfg.zone,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
  return { key };
}

export async function bunnyDownload(key: string): Promise<Buffer> {
  const cfg = await resolveCfg();
  const s3 = await makeClient(cfg);
  const res = await s3.send(new GetObjectCommand({ Bucket: cfg.zone, Key: key }));
  const chunks: Buffer[] = [];
  // @ts-expect-error — Body is a Node Readable stream in the AWS SDK v3 Node runtime
  for await (const chunk of res.Body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export interface BunnyHead {
  size: number;
  etag: string | null;       // το ETag του Bunny (MD5 του αντικειμένου) όπως το επιστρέφει το S3 API
  contentType: string | null;
}

/**
 * Μέγεθος + validator ενός αποθηκευμένου αρχείου, ΧΩΡΙΣ να κατέβει το σώμα.
 * Χρειάζεται για να απαντήσουμε `Content-Length`, `ETag` και `416` χωρίς να διαβάσουμε 3.4 MB.
 */
export async function bunnyHead(key: string): Promise<BunnyHead> {
  const cfg = await resolveCfg();
  const s3 = await makeClient(cfg);
  const res = await s3.send(new HeadObjectCommand({ Bucket: cfg.zone, Key: key }));
  return {
    size: Number(res.ContentLength ?? 0),
    etag: res.ETag ?? null,
    contentType: res.ContentType ?? null,
  };
}

export interface BunnyStream {
  body: ReadableStream<Uint8Array>;
  /** bytes ΑΥΤΗΣ της απάντησης (για range = το μήκος του κομματιού) */
  contentLength: number | null;
  /** ό,τι έστειλε το storage ως `Content-Range`, π.χ. `bytes 0-1023/3428707` */
  contentRange: string | null;
  etag: string | null;
}

/**
 * Ρέει ένα αντικείμενο — ολόκληρο ή ένα κομμάτι — χωρίς να το υλοποιήσει στη μνήμη.
 * Το `range` προωθείται αυτούσιο στο Bunny (το S3 gateway του τιμά την `Range`), άρα ένα αίτημα
 * 1 KB κοστίζει 1 KB και στον server, όχι ολόκληρο το αρχείο όπως με το `bunnyDownload`.
 *
 * Υπάρχει δίπλα στο `bunnyDownload` αντί να το αλλάξει: όλοι οι άλλοι καλούντες (rasterize,
 * extract, backup) θέλουν πράγματι ολόκληρο Buffer.
 */
export async function bunnyStream(key: string, range?: { start: number; end: number }): Promise<BunnyStream> {
  const cfg = await resolveCfg();
  const s3 = await makeClient(cfg);
  const res = await s3.send(new GetObjectCommand({
    Bucket: cfg.zone,
    Key: key,
    Range: range ? `bytes=${range.start}-${range.end}` : undefined,
  }));
  const node = res.Body as unknown as Readable;
  return {
    body: Readable.toWeb(node) as ReadableStream<Uint8Array>,
    contentLength: res.ContentLength == null ? null : Number(res.ContentLength),
    contentRange: res.ContentRange ?? null,
    etag: res.ETag ?? null,
  };
}

export async function bunnyDelete(keys: string[]) {
  if (keys.length === 0) return;
  const cfg = await resolveCfg();
  const s3 = await makeClient(cfg);
  if (keys.length === 1) {
    await s3.send(new DeleteObjectCommand({ Bucket: cfg.zone, Key: keys[0] }));
  } else {
    await s3.send(new DeleteObjectsCommand({
      Bucket: cfg.zone,
      Delete: { Objects: keys.map((Key) => ({ Key })) },
    }));
  }
}
