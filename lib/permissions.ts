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

  // Companies
  { key: 'companies.read', resource: 'companies', action: 'read', description: 'View companies' },
  { key: 'companies.create', resource: 'companies', action: 'create', description: 'Create companies' },
  { key: 'companies.update', resource: 'companies', action: 'update', description: 'Update companies' },
  { key: 'companies.delete', resource: 'companies', action: 'delete', description: 'Delete companies' },
  { key: 'companies.manage_types', resource: 'companies', action: 'manage_types', description: 'Manage company types (sodtype)' },

  // ΚΑΔ master registry
  { key: 'kad.read', resource: 'kad', action: 'read', description: 'View ΚΑΔ registry' },
  { key: 'kad.manage', resource: 'kad', action: 'manage', description: 'Create/update ΚΑΔ master entries' },

  // Reference data (ΓΕΜΗ metadata: νομικές μορφές, νομοί, δήμοι, υπηρεσίες ΓΕΜΗ…)
  { key: 'metadata.read', resource: 'metadata', action: 'read', description: 'View reference lookup tables' },
  { key: 'metadata.manage', resource: 'metadata', action: 'manage', description: 'Refresh ΓΕΜΗ metadata + edit lookups' },

  // OCR / Intelligent document extraction
  { key: 'ocr.read',   resource: 'ocr', action: 'read',   description: 'View OCR documents' },
  { key: 'ocr.create', resource: 'ocr', action: 'create', description: 'Upload & extract documents' },
  { key: 'ocr.delete', resource: 'ocr', action: 'delete', description: 'Delete OCR documents' },
  { key: 'ocr.categorize', resource: 'ocr', action: 'categorize', description: 'Set category / notes on OCR documents' },
  { key: 'ocr.post', resource: 'ocr', action: 'post', description: 'Post OCR document to SoftOne' },

  // European funding programs (ΕΣΠΑ / EU calls)
  { key: 'programs.read',   resource: 'programs', action: 'read',   description: 'View European funding programs' },
  { key: 'programs.create', resource: 'programs', action: 'create', description: 'Upload & extract program PDFs' },
  { key: 'programs.update', resource: 'programs', action: 'update', description: 'Edit extracted program data' },
  { key: 'programs.delete', resource: 'programs', action: 'delete', description: 'Delete programs' },

  // System
  { key: 'system.audit', resource: 'system', action: 'audit', description: 'View audit log' },
  { key: 'system.settings', resource: 'system', action: 'settings', description: 'Modify system settings' },
  { key: 'system.backups', resource: 'system', action: 'backups', description: 'Manage database backups' },
];

// Default permission keys per system role.
export const ROLE_DEFAULTS: Record<string, string[]> = {
  SUPER_ADMIN: PERMISSIONS.map((p) => p.key), // all
  ADMIN: [
    'users.read', 'users.create', 'users.update', 'users.assign_role',
    'roles.read',
    'permissions.read',
    'imports.read', 'imports.create',
    'companies.read', 'companies.create', 'companies.update', 'companies.delete', 'companies.manage_types',
    'kad.read', 'kad.manage',
    'metadata.read', 'metadata.manage',
    'ocr.read', 'ocr.create', 'ocr.delete', 'ocr.categorize', 'ocr.post',
    'programs.read', 'programs.create', 'programs.update', 'programs.delete',
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
