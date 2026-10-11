import { prisma } from '../lib/db';
const since = new Date(Date.now() - 6 * 60 * 1000);
const n = await prisma.auditLog.count({ where: { createdAt: { gte: since }, action: 'ocr.item.create' } });
const masks = await prisma.appSetting.findMany({ where: { key: { startsWith: 'softone.itemErpMask.' } }, select: { key: true, value: true } });
const last = await prisma.auditLog.findMany({ where: { createdAt: { gte: since }, action: 'ocr.item.create' }, orderBy: { createdAt: 'desc' }, take: 3, select: { metadata: true } });
console.log(new Date().toISOString().slice(11,19), 'δημιουργίες:', n, '| μάσκες:', JSON.stringify(masks.map((m) => `${m.key.split('.').pop()}=${m.value}`)), '| τελευταίες:', last.map((l: any) => `${l.metadata?.code} ${String(l.metadata?.name ?? '').slice(0,25)}`).join(' ; '));
await prisma.$disconnect();
