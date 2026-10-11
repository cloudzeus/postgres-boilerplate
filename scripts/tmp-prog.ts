import { prisma } from '../lib/db';
const since = new Date(Date.now() - 15 * 60 * 1000);
const rows = await prisma.auditLog.groupBy({ by: ['action'], where: { createdAt: { gte: since }, action: { startsWith: 'ocr.' } }, _count: true });
console.log(new Date().toISOString().slice(11, 19), JSON.stringify(rows.map((r) => `${r.action}:${r._count}`)));
await prisma.$disconnect();
