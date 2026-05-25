// Canonical permission catalog. Add new entries here; the seed will sync them to DB.
// key = "<resource>.<action>".

export type PermissionDef = {
  key: string;
  resource: string;
  action: string;
  description: string;
};

export const PERMISSIONS: PermissionDef[] = [
  // Users
  { key: 'users.read', resource: 'users', action: 'read', description: 'View users' },
  { key: 'users.create', resource: 'users', action: 'create', description: 'Create users' },
  { key: 'users.update', resource: 'users', action: 'update', description: 'Update users' },
  { key: 'users.delete', resource: 'users', action: 'delete', description: 'Delete users' },
  { key: 'users.assign_role', resource: 'users', action: 'assign_role', description: 'Assign role to user' },

  // Roles
  { key: 'roles.read', resource: 'roles', action: 'read', description: 'View roles' },
  { key: 'roles.create', resource: 'roles', action: 'create', description: 'Create roles' },
  { key: 'roles.update', resource: 'roles', action: 'update', description: 'Update roles' },
  { key: 'roles.delete', resource: 'roles', action: 'delete', description: 'Delete roles' },
  { key: 'roles.reorder', resource: 'roles', action: 'reorder', description: 'Reorder roles' },

  // Permissions
  { key: 'permissions.read', resource: 'permissions', action: 'read', description: 'View permissions' },
  { key: 'permissions.assign', resource: 'permissions', action: 'assign', description: 'Grant/revoke permissions' },
  { key: 'permissions.reorder', resource: 'permissions', action: 'reorder', description: 'Reorder permissions' },

  // Imports
  { key: 'imports.read', resource: 'imports', action: 'read', description: 'View Excel imports' },
  { key: 'imports.create', resource: 'imports', action: 'create', description: 'Upload Excel imports' },

  // Media
  { key: 'media.read',   resource: 'media', action: 'read',   description: 'View media gallery' },
  { key: 'media.upload', resource: 'media', action: 'upload', description: 'Upload media files' },
  { key: 'media.delete', resource: 'media', action: 'delete', description: 'Delete media files/folders' },
  { key: 'media.manage_folders', resource: 'media', action: 'manage_folders', description: 'Create/rename folders' },

  // System
  { key: 'system.audit', resource: 'system', action: 'audit', description: 'View audit log' },
  { key: 'system.settings', resource: 'system', action: 'settings', description: 'Modify system settings' },
];

// Default permission keys per system role.
export const ROLE_DEFAULTS: Record<string, string[]> = {
  SUPER_ADMIN: PERMISSIONS.map((p) => p.key), // all
  ADMIN: [
    'users.read', 'users.create', 'users.update', 'users.assign_role',
    'roles.read',
    'permissions.read',
    'imports.read', 'imports.create',
  ],
  EMPLOYEE: ['users.read', 'imports.read', 'imports.create'],
  COLLABORATOR: ['users.read', 'imports.read'],
  SUPPLIER: ['imports.read'],
  CUSTOMER: [],
};

export const SYSTEM_ROLES: Array<{ key: string; name: string; description: string; order: number }> = [
  { key: 'SUPER_ADMIN', name: 'Super Admin', description: 'Πλήρης πρόσβαση στο σύστημα', order: 0 },
  { key: 'ADMIN', name: 'Administrator', description: 'Διαχείριση χρηστών και ομάδων', order: 1 },
  { key: 'EMPLOYEE', name: 'Employee', description: 'Εσωτερικός χρήστης', order: 2 },
  { key: 'COLLABORATOR', name: 'Collaborator', description: 'Εξωτερικός συνεργάτης', order: 3 },
  { key: 'SUPPLIER', name: 'Supplier', description: 'Προμηθευτής', order: 4 },
  { key: 'CUSTOMER', name: 'Customer', description: 'Πελάτης', order: 5 },
];
