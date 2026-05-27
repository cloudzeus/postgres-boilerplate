// Entity registry for the Super Excel Import wizard.
// Each entry declares: target fields (with type + validation), the commit function,
// and an optional permission override. Adding a new entity = add an entry here.

import { prisma } from '@/lib/db';

export type FieldType = 'string' | 'number' | 'integer' | 'boolean' | 'date' | 'email';

export type ImportField = {
  key: string;                 // payload key on the target entity (e.g. 'name', 'afm')
  label: string;               // display label in the mapping UI (Greek)
  type: FieldType;
  required?: boolean;
  /** Marks this field as a natural key — rows with same value are upserted instead of inserted. */
  uniqueKey?: boolean;
  /** Optional sample value shown in the mapping picker. */
  sample?: string;
};

export type CommitArgs = {
  rows: Record<string, any>[];                  // mapped rows (keys = ImportField.key)
  mode: 'insert' | 'upsert';                    // upsert needs at least one uniqueKey field
  meta?: Record<string, any>;                   // entity-specific extras (e.g. company id for nested)
};

export type CommitResult = {
  total: number;
  inserted: number;
  updated: number;
  failed: { row: number; reason: string }[];
};

export type ImportEntity = {
  key: string;                                  // url-safe slug
  label: string;                                // Greek display name
  description?: string;
  permission: string;                           // required permission to commit
  fields: ImportField[];
  /** If true, the wizard will require the user to choose a parent (e.g. companyId for nested entities). */
  parent?: { entityKey: string; label: string; }; // not used yet — placeholder
  commit: (args: CommitArgs) => Promise<CommitResult>;
};

// ---------- Helpers ----------

function toStr(v: any): string | null {
  if (v === null || v === undefined || v === '') return null;
  return String(v).trim();
}
function toNum(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
function toInt(v: any): number | null {
  const n = toNum(v);
  return n == null ? null : Math.trunc(n);
}
function toBool(v: any): boolean | null {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'ναι', 'ν'].includes(s)) return true;
  if (['0', 'false', 'no', 'n', 'οχι', 'όχι', 'ο'].includes(s)) return false;
  return null;
}
function toDate(v: any): Date | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function coerce(value: any, type: FieldType) {
  switch (type) {
    case 'string': return toStr(value);
    case 'email':  return toStr(value);
    case 'number': return toNum(value);
    case 'integer': return toInt(value);
    case 'boolean': return toBool(value);
    case 'date':    return toDate(value);
  }
}

// ---------- Entities ----------

const COMPANY: ImportEntity = {
  key: 'company',
  label: 'Εταιρίες',
  description: 'Δημιουργία/ενημέρωση εταιριών (matching ανά ΑΦΜ ή Αρ. ΓΕΜΗ).',
  permission: 'companies.create',
  fields: [
    { key: 'afm', label: 'ΑΦΜ', type: 'string', uniqueKey: true, sample: '997606870' },
    { key: 'arGemi', label: 'Αρ. ΓΕΜΗ', type: 'string', uniqueKey: true, sample: '124343401000' },
    { key: 'name', label: 'Επωνυμία', type: 'string', required: true },
    { key: 'shortName', label: 'Διακριτικός τίτλος', type: 'string' },
    { key: 'code', label: 'Κωδικός', type: 'string' },
    { key: 'doy', label: 'ΔΟΥ', type: 'string' },
    { key: 'legalForm', label: 'Νομική μορφή', type: 'string' },
    { key: 'profession', label: 'Επάγγελμα', type: 'string' },
    { key: 'address', label: 'Διεύθυνση', type: 'string' },
    { key: 'city', label: 'Πόλη', type: 'string' },
    { key: 'zip', label: 'ΤΚ', type: 'string' },
    { key: 'country', label: 'Χώρα (ISO)', type: 'string' },
    { key: 'phone', label: 'Τηλέφωνο', type: 'string' },
    { key: 'phone2', label: 'Τηλέφωνο 2', type: 'string' },
    { key: 'email', label: 'Email', type: 'email' },
    { key: 'website', label: 'Website', type: 'string' },
    { key: 'iban', label: 'IBAN', type: 'string' },
    { key: 'bankName', label: 'Τράπεζα', type: 'string' },
    { key: 'creditLimit', label: 'Πιστωτικό όριο', type: 'number' },
    { key: 'discount', label: 'Έκπτωση (%)', type: 'number' },
    { key: 'employeeCount', label: 'Εργαζόμενοι', type: 'integer' },
    { key: 'notes', label: 'Σημειώσεις', type: 'string' },
    { key: 'foundingDate', label: 'Ημερομηνία ίδρυσης', type: 'date' },
    { key: 'isActive', label: 'Ενεργή', type: 'boolean' },
  ],
  async commit({ rows, mode, meta }) {
    const typeId = meta?.defaultTypeId as string | undefined;
    if (!typeId) throw new Error('defaultTypeId is required for Company import (επίλεξε τύπο εταιρίας)');

    const result: CommitResult = { total: rows.length, inserted: 0, updated: 0, failed: [] };
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      try {
        if (!r.name) throw new Error('Λείπει η επωνυμία');
        const where = r.afm ? { afm: r.afm } : (r.arGemi ? { arGemi: r.arGemi } : null);
        const data: any = { ...r };
        // Strip undefineds and align types stored as Decimal
        Object.keys(data).forEach((k) => { if (data[k] === null || data[k] === undefined) delete data[k]; });

        if (mode === 'upsert' && where) {
          const existing = await prisma.company.findUnique({ where });
          if (existing) {
            await prisma.company.update({ where: { id: existing.id }, data });
            result.updated++;
            continue;
          }
        }
        await prisma.company.create({
          data: { ...data, types: { create: [{ typeId }] } },
        });
        result.inserted++;
      } catch (e: any) {
        result.failed.push({ row: i + 1, reason: e.message ?? String(e) });
      }
    }
    return result;
  },
};

const KAD: ImportEntity = {
  key: 'kad',
  label: 'Μητρώο ΚΑΔ',
  description: 'Μαζική εισαγωγή κωδικών δραστηριότητας (ΚΑΔ).',
  permission: 'kad.manage',
  fields: [
    { key: 'code', label: 'Κωδικός ΚΑΔ', type: 'string', required: true, uniqueKey: true, sample: '62101200' },
    { key: 'description', label: 'Περιγραφή', type: 'string', required: true },
    { key: 'parentCode', label: 'Πατρικός κωδικός', type: 'string' },
    { key: 'category', label: 'Κατηγορία', type: 'string' },
    { key: 'isActive', label: 'Ενεργός', type: 'boolean' },
  ],
  async commit({ rows }) {
    const result: CommitResult = { total: rows.length, inserted: 0, updated: 0, failed: [] };
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      try {
        if (!r.code || !r.description) throw new Error('Λείπει code ή description');
        const existing = await prisma.kadCode.findUnique({ where: { code: r.code } });
        const data = {
          code: r.code,
          description: r.description,
          parentCode: r.parentCode ?? (r.code.length > 2 ? r.code.slice(0, 2) : null),
          category: r.category ?? null,
          isActive: r.isActive ?? true,
        };
        if (existing) {
          await prisma.kadCode.update({ where: { code: r.code }, data });
          result.updated++;
        } else {
          await prisma.kadCode.create({ data });
          result.inserted++;
        }
      } catch (e: any) {
        result.failed.push({ row: i + 1, reason: e.message ?? String(e) });
      }
    }
    return result;
  },
};

const COMPANY_CONTACT: ImportEntity = {
  key: 'company-contact',
  label: 'Επαφές εταιριών',
  description: 'Μαζική εισαγωγή επαφών (πρέπει να δοθεί ΑΦΜ ή κωδικός εταιρίας για matching).',
  permission: 'companies.update',
  fields: [
    { key: 'companyAfm', label: 'ΑΦΜ Εταιρίας (lookup)', type: 'string', required: true, uniqueKey: true },
    { key: 'firstName', label: 'Όνομα', type: 'string' },
    { key: 'lastName', label: 'Επώνυμο', type: 'string' },
    { key: 'fullName', label: 'Ονοματεπώνυμο', type: 'string' },
    { key: 'role', label: 'Ρόλος / Θέση', type: 'string' },
    { key: 'department', label: 'Τμήμα', type: 'string' },
    { key: 'mobile', label: 'Κινητό', type: 'string' },
    { key: 'phone', label: 'Σταθερό', type: 'string' },
    { key: 'email', label: 'Email', type: 'email' },
    { key: 'isPrimary', label: 'Κύρια επαφή', type: 'boolean' },
  ],
  async commit({ rows }) {
    const result: CommitResult = { total: rows.length, inserted: 0, updated: 0, failed: [] };
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      try {
        if (!r.companyAfm) throw new Error('Λείπει ΑΦΜ εταιρίας');
        const company = await prisma.company.findUnique({ where: { afm: r.companyAfm }, select: { id: true } });
        if (!company) throw new Error(`Δεν βρέθηκε εταιρία με ΑΦΜ ${r.companyAfm}`);
        const fullName = (r.fullName ?? '').toString().trim()
          || [r.firstName, r.lastName].filter(Boolean).join(' ').trim();
        if (!fullName) throw new Error('Λείπει ονοματεπώνυμο');
        await prisma.companyContact.create({
          data: {
            companyId: company.id,
            firstName: r.firstName ?? null, lastName: r.lastName ?? null, fullName,
            role: r.role ?? null, department: r.department ?? null,
            mobile: r.mobile ?? null, phone: r.phone ?? null,
            email: r.email ?? null,
            isPrimary: r.isPrimary ?? false,
          },
        });
        result.inserted++;
      } catch (e: any) {
        result.failed.push({ row: i + 1, reason: e.message ?? String(e) });
      }
    }
    return result;
  },
};

const ENTITIES: ImportEntity[] = [COMPANY, KAD, COMPANY_CONTACT];

export function listEntities() {
  return ENTITIES.map(({ key, label, description, permission, fields }) => ({
    key, label, description, permission, fields,
  }));
}

export function getEntity(key: string): ImportEntity | null {
  return ENTITIES.find((e) => e.key === key) ?? null;
}

export { coerce };
