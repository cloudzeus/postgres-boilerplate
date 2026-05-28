import { z } from 'zod';

export const ROLE_KEYS = ['SUPER_ADMIN', 'ADMIN', 'EMPLOYEE', 'COLLABORATOR', 'SUPPLIER', 'CUSTOMER'] as const;
export type WikiRoleKey = (typeof ROLE_KEYS)[number];

export const WikiScreenshotSchema = z.object({
  file: z.string(),
  caption: z.string().optional(),
  route: z.string().optional(),
  asRole: z.enum(ROLE_KEYS).optional(),
  actions: z.array(z.string()).optional(),
});

export const WikiFrontmatterSchema = z.object({
  title: z.string(),
  module: z.string(),
  slug: z.string(),
  roles: z.array(z.enum(ROLE_KEYS)).min(1),
  order: z.number().int().default(100),
  updatedAt: z.preprocess((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v), z.string().optional()),
  description: z.string().optional(),
  screenshots: z.array(WikiScreenshotSchema).default([]),
  related: z.array(z.string()).default([]),
  helpAnchors: z.array(z.string()).default([]),
});

export type WikiFrontmatter = z.infer<typeof WikiFrontmatterSchema>;
export type WikiScreenshot = z.infer<typeof WikiScreenshotSchema>;

export interface WikiPage {
  frontmatter: WikiFrontmatter;
  content: string;
  filePath: string;
}

export interface WikiModule {
  module: string;
  title: string;
  pages: WikiPage[];
}

export const MODULE_LABELS: Record<string, string> = {
  'getting-started': 'Ξεκινώντας',
  programs: 'Ευρωπαϊκά Προγράμματα',
  users: 'Χρήστες',
  roles: 'Ρόλοι & Δικαιώματα',
  companies: 'Εταιρίες',
  media: 'Media',
  ocr: 'OCR / Έγγραφα',
  imports: 'Excel Imports',
  'kad-codes': 'Μητρώο ΚΑΔ',
  'reference-data': 'Μητρώα αναφοράς',
  audit: 'Audit log',
  backups: 'Backups',
  settings: 'Ρυθμίσεις',
  account: 'Ο λογαριασμός μου',
};
