import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

if (!process.env.DATABASE_URL) {
  throw new Error('Missing DATABASE_URL environment variable for Prisma');
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Keep in sync with lib/permissions.ts
const PERMISSIONS = [
  { key: 'users.read', resource: 'users', action: 'read', description: 'View users' },
  { key: 'users.create', resource: 'users', action: 'create', description: 'Create users' },
  { key: 'users.update', resource: 'users', action: 'update', description: 'Update users' },
  { key: 'users.delete', resource: 'users', action: 'delete', description: 'Delete users' },
  { key: 'users.assign_role', resource: 'users', action: 'assign_role', description: 'Assign role to user' },
  { key: 'roles.read', resource: 'roles', action: 'read', description: 'View roles' },
  { key: 'roles.create', resource: 'roles', action: 'create', description: 'Create roles' },
  { key: 'roles.update', resource: 'roles', action: 'update', description: 'Update roles' },
  { key: 'roles.delete', resource: 'roles', action: 'delete', description: 'Delete roles' },
  { key: 'roles.reorder', resource: 'roles', action: 'reorder', description: 'Reorder roles' },
  { key: 'permissions.read', resource: 'permissions', action: 'read', description: 'View permissions' },
  { key: 'permissions.assign', resource: 'permissions', action: 'assign', description: 'Grant/revoke permissions' },
  { key: 'permissions.reorder', resource: 'permissions', action: 'reorder', description: 'Reorder permissions' },
  { key: 'imports.read', resource: 'imports', action: 'read', description: 'View Excel imports' },
  { key: 'imports.create', resource: 'imports', action: 'create', description: 'Upload Excel imports' },
  { key: 'system.audit', resource: 'system', action: 'audit', description: 'View audit log' },
  { key: 'system.settings', resource: 'system', action: 'settings', description: 'Modify system settings' },
];

const SYSTEM_ROLES = [
  { key: 'SUPER_ADMIN', name: 'Super Admin', description: 'Πλήρης πρόσβαση στο σύστημα', order: 0 },
  { key: 'ADMIN', name: 'Administrator', description: 'Διαχείριση χρηστών και ομάδων', order: 1 },
  { key: 'EMPLOYEE', name: 'Employee', description: 'Εσωτερικός χρήστης', order: 2 },
  { key: 'COLLABORATOR', name: 'Collaborator', description: 'Εξωτερικός συνεργάτης', order: 3 },
  { key: 'SUPPLIER', name: 'Supplier', description: 'Προμηθευτής', order: 4 },
  { key: 'CUSTOMER', name: 'Customer', description: 'Πελάτης', order: 5 },
];

const ROLE_DEFAULTS = {
  SUPER_ADMIN: PERMISSIONS.map((p) => p.key),
  ADMIN: ['users.read', 'users.create', 'users.update', 'users.assign_role', 'roles.read', 'permissions.read', 'imports.read', 'imports.create'],
  EMPLOYEE: ['users.read', 'imports.read', 'imports.create'],
  COLLABORATOR: ['users.read', 'imports.read'],
  SUPPLIER: ['imports.read'],
  CUSTOMER: [],
};

async function seedPermissions() {
  for (let i = 0; i < PERMISSIONS.length; i++) {
    const p = PERMISSIONS[i];
    await prisma.permission.upsert({
      where: { key: p.key },
      update: { resource: p.resource, action: p.action, description: p.description, order: i },
      create: { key: p.key, resource: p.resource, action: p.action, description: p.description, order: i },
    });
  }
  console.log(`✓ Seeded ${PERMISSIONS.length} permissions`);
}

async function seedRoles() {
  for (const r of SYSTEM_ROLES) {
    await prisma.role.upsert({
      where: { name: r.name },
      update: { description: r.description, order: r.order, isSystem: true, key: r.key },
      create: { key: r.key, name: r.name, description: r.description, order: r.order, isSystem: true },
    });
  }
  console.log(`✓ Seeded ${SYSTEM_ROLES.length} system roles`);
}

async function seedRolePermissions() {
  for (const [roleKey, keys] of Object.entries(ROLE_DEFAULTS)) {
    const role = await prisma.role.findUnique({ where: { key: roleKey } });
    if (!role) continue;
    const perms = await prisma.permission.findMany({ where: { key: { in: keys } } });
    for (const p of perms) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: p.id } },
        update: {},
        create: { roleId: role.id, permissionId: p.id },
      });
    }
  }
  console.log('✓ Linked role → permission defaults');
}

async function seedSuperAdmin() {
  const email = 'gkozyris@i4ria.com';
  const password = '1f1femsk';
  const name = 'Giorgos Kozyris';
  const role = await prisma.role.findUnique({ where: { key: 'SUPER_ADMIN' } });
  if (!role) throw new Error('SUPER_ADMIN role missing');

  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.user.update({
      where: { email },
      data: { roleId: role.id, name, isActive: true, emailVerified: existing.emailVerified ?? new Date() },
    });
    console.log('✓ Super admin updated:', email);
    return;
  }
  await prisma.user.create({
    data: { email, name, passwordHash, emailVerified: new Date(), roleId: role.id, isActive: true },
  });
  console.log('✓ Seeded super admin:', email);
}

async function main() {
  await seedPermissions();
  await seedRoles();
  await seedRolePermissions();
  await seedSuperAdmin();
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
