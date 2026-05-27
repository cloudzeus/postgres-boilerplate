import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';
import { getSetting } from '@/lib/settings';
import { bunnyUploadPrivate, bunnyDownload, bunnyDelete } from '@/lib/bunny';

function parseDbUrl(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port || '5432',
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
  };
}

async function runPg(bin: string, args: string[], env: NodeJS.ProcessEnv, input?: Buffer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, { env, stdio: input ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(bin)} exited ${code}: ${stderr.slice(-2000)}`));
    });
    if (input) {
      child.stdin?.end(input);
    }
  });
}

export async function runBackup(opts: { trigger: 'cron' | 'manual'; userId?: string | null }) {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL not set');
  const db = parseDbUrl(dbUrl);

  // Priority: explicit setting → PG_DUMP env → first Homebrew install we find → PATH.
  // Server is Postgres 16 on the remote (see DATABASE_URL); the local Homebrew default
  // is often a different major version which causes "server version mismatch" errors.
  async function resolvePgDump() {
    const fromSetting = await getSetting<string>('backups.pgDumpPath');
    if (fromSetting) return fromSetting;
    if (process.env.PG_DUMP) return process.env.PG_DUMP;
    const brewCandidates = [
      '/opt/homebrew/opt/postgresql@16/bin/pg_dump',
      '/usr/local/opt/postgresql@16/bin/pg_dump',
      '/opt/homebrew/opt/postgresql@17/bin/pg_dump',
    ];
    for (const p of brewCandidates) {
      try { await fs.access(p); return p; } catch { /* keep trying */ }
    }
    return 'pg_dump';
  }
  const pgDump = await resolvePgDump();
  const prefix = ((await getSetting<string>('backups.storagePrefix')) || 'backups').replace(/^\/+|\/+$/g, '');
  const retention = Number((await getSetting<number>('backups.retentionDays')) ?? 30);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `espa-${stamp}-${randomBytes(4).toString('hex')}.dump`;
  const storageKey = `${prefix}/${filename}`;
  const tmpFile = path.join(os.tmpdir(), filename);

  const record = await prisma.dbBackup.create({
    data: {
      filename, storageKey, sizeBytes: BigInt(0), status: 'PENDING', trigger: opts.trigger,
      createdById: opts.userId ?? null,
    },
  });

  try {
    // pg_dump custom format → smaller, supports parallel restore
    const args = [
      '-h', db.host, '-p', db.port, '-U', db.user, '-d', db.database,
      '-F', 'c', '--no-owner', '--no-acl', '-f', tmpFile,
    ];
    await runPg(pgDump, args, { ...process.env, PGPASSWORD: db.password });

    const buf = await fs.readFile(tmpFile);
    await bunnyUploadPrivate({ key: storageKey, body: buf, contentType: 'application/octet-stream' });

    const updated = await prisma.dbBackup.update({
      where: { id: record.id },
      data: { status: 'READY', sizeBytes: BigInt(buf.length) },
    });

    await pruneOldBackups(retention);
    return updated;
  } catch (err) {
    await prisma.dbBackup.update({
      where: { id: record.id },
      data: { status: 'FAILED', errorMessage: (err as Error).message.slice(0, 1000) },
    });
    throw err;
  } finally {
    await fs.unlink(tmpFile).catch(() => {});
  }
}

export async function pruneOldBackups(retention: number) {
  if (!Number.isFinite(retention) || retention <= 0) return;
  const ready = await prisma.dbBackup.findMany({
    where: { status: 'READY' },
    orderBy: { createdAt: 'desc' },
  });
  const toDelete = ready.slice(retention);
  if (toDelete.length === 0) return;
  await bunnyDelete(toDelete.map((b) => b.storageKey));
  await prisma.dbBackup.deleteMany({ where: { id: { in: toDelete.map((b) => b.id) } } });
}

export async function restoreBackup(id: string) {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL not set');
  const db = parseDbUrl(dbUrl);

  const record = await prisma.dbBackup.findUnique({ where: { id } });
  if (!record) throw new Error('Backup not found');
  if (record.status !== 'READY') throw new Error(`Backup status is ${record.status}`);

  const pgRestore = (await getSetting<string>('backups.pgRestorePath')) || 'pg_restore';

  await prisma.dbBackup.update({ where: { id }, data: { status: 'RESTORING' } });

  const tmpFile = path.join(os.tmpdir(), `restore-${record.filename}`);
  try {
    const buf = await bunnyDownload(record.storageKey);
    await fs.writeFile(tmpFile, buf);

    const args = [
      '-h', db.host, '-p', db.port, '-U', db.user, '-d', db.database,
      '--clean', '--if-exists', '--no-owner', '--no-acl', tmpFile,
    ];
    await runPg(pgRestore, args, { ...process.env, PGPASSWORD: db.password });

    await prisma.dbBackup.update({ where: { id }, data: { status: 'READY' } });
  } catch (err) {
    await prisma.dbBackup.update({
      where: { id },
      data: { status: 'READY', errorMessage: `Restore failed: ${(err as Error).message.slice(0, 800)}` },
    });
    throw err;
  } finally {
    await fs.unlink(tmpFile).catch(() => {});
  }
}

export async function deleteBackup(id: string) {
  const record = await prisma.dbBackup.findUnique({ where: { id } });
  if (!record) return;
  await bunnyDelete([record.storageKey]).catch(() => {});
  await prisma.dbBackup.delete({ where: { id } });
}
