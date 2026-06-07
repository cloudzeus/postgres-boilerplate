import type * as React from 'react';
import {
  FiBookOpen, FiUser, FiUsers, FiShield, FiBriefcase, FiUpload, FiImage,
  FiCpu, FiGlobe, FiLayers, FiTag, FiActivity, FiHome, FiMapPin, FiFileText,
} from 'react-icons/fi';
import type { IconType } from 'react-icons';

export interface ModuleMeta {
  label: string;
  description: string;
  icon: IconType;
  /** Hex stops for gradients (inline style to bypass JIT purge) */
  gradientFrom: string;
  gradientTo: string;
  /** Solid hex for accents (bars, badges) */
  accent: string;
  /** Soft background hex for icon tiles */
  accentSoft: string;
}

export const MODULE_META: Record<string, ModuleMeta> = {
  'getting-started': {
    label: 'Ξεκινώντας', description: 'Πρώτα βήματα στην εφαρμογή',
    icon: FiHome,
    gradientFrom: '#38bdf8', gradientTo: '#3b82f6',
    accent: '#0284c7', accentSoft: '#e0f2fe',
  },
  account: {
    label: 'Ο λογαριασμός μου', description: 'Προφίλ, γλώσσα, αποσύνδεση',
    icon: FiUser,
    gradientFrom: '#a78bfa', gradientTo: '#8b5cf6',
    accent: '#7c3aed', accentSoft: '#ede9fe',
  },
  users: {
    label: 'Χρήστες', description: 'Διαχείριση χρηστών και προσκλήσεις',
    icon: FiUsers,
    gradientFrom: '#60a5fa', gradientTo: '#6366f1',
    accent: '#2563eb', accentSoft: '#dbeafe',
  },
  roles: {
    label: 'Ρόλοι & Δικαιώματα', description: 'Ποιος μπορεί να κάνει τι',
    icon: FiShield,
    gradientFrom: '#818cf8', gradientTo: '#4f46e5',
    accent: '#4338ca', accentSoft: '#e0e7ff',
  },
  companies: {
    label: 'Εταιρίες', description: 'Πελάτες, προμηθευτές, συνεργάτες',
    icon: FiBriefcase,
    gradientFrom: '#34d399', gradientTo: '#10b981',
    accent: '#059669', accentSoft: '#d1fae5',
  },
  programs: {
    label: 'Ευρωπαϊκά Προγράμματα', description: 'Προσκλήσεις ΕΣΠΑ και εξαγωγή στοιχείων',
    icon: FiGlobe,
    gradientFrom: '#fbbf24', gradientTo: '#f97316',
    accent: '#d97706', accentSoft: '#fef3c7',
  },
  ocr: {
    label: 'OCR & Έγγραφα', description: 'Αυτόματη αναγνώριση τιμολογίων',
    icon: FiCpu,
    gradientFrom: '#fb7185', gradientTo: '#ec4899',
    accent: '#e11d48', accentSoft: '#ffe4e6',
  },
  media: {
    label: 'Media', description: 'Αρχεία, εικόνες, έγγραφα',
    icon: FiImage,
    gradientFrom: '#22d3ee', gradientTo: '#0ea5e9',
    accent: '#0891b2', accentSoft: '#cffafe',
  },
  imports: {
    label: 'Excel Imports', description: 'Μαζική εισαγωγή από Excel',
    icon: FiUpload,
    gradientFrom: '#a3e635', gradientTo: '#65a30d',
    accent: '#65a30d', accentSoft: '#ecfccb',
  },
  'kad-codes': {
    label: 'Μητρώο ΚΑΔ', description: 'Κωδικοί δραστηριότητας',
    icon: FiTag,
    gradientFrom: '#e879f9', gradientTo: '#c026d3',
    accent: '#a21caf', accentSoft: '#fae8ff',
  },
  'reference-data': {
    label: 'Μητρώα αναφοράς', description: 'Νομοί, δήμοι, λοιπά lookups',
    icon: FiLayers,
    gradientFrom: '#2dd4bf', gradientTo: '#14b8a6',
    accent: '#0f766e', accentSoft: '#ccfbf1',
  },
  audit: {
    label: 'Audit log', description: 'Ιστορικό ενεργειών',
    icon: FiActivity,
    gradientFrom: '#94a3b8', gradientTo: '#64748b',
    accent: '#475569', accentSoft: '#f1f5f9',
  },
  documents: {
    label: 'Δικαιολογητικά', description: 'Τύποι δικαιολογητικών, φάσεις προγραμμάτων και απαιτήσεις',
    icon: FiFileText,
    gradientFrom: '#818cf8', gradientTo: '#6366f1',
    accent: '#4f46e5', accentSoft: '#e0e7ff',
  },
  mitroa: {
    label: 'Μητρώο Περιφερειών', description: 'Δομή Καλλικράτη — Περιφέρειες/Νομοί/Δήμοι',
    icon: FiMapPin,
    gradientFrom: '#38bdf8', gradientTo: '#0284c7',
    accent: '#0369a1', accentSoft: '#e0f2fe',
  },
  'tax-templates': {
    label: 'Πρότυπα Φορολογικών Εντύπων', description: 'Πρότυπα Ε3/Ε1 με region marking πεδίων για OCR εξαγωγή',
    icon: FiFileText,
    gradientFrom: '#f472b6', gradientTo: '#db2777',
    accent: '#be185d', accentSoft: '#fce7f3',
  },
};

export const FALLBACK_META: ModuleMeta = {
  label: '',
  description: '',
  icon: FiBookOpen,
  gradientFrom: '#94a3b8',
  gradientTo: '#64748b',
  accent: '#475569',
  accentSoft: '#f1f5f9',
};

export function getModuleMeta(key: string): ModuleMeta {
  return MODULE_META[key] ?? { ...FALLBACK_META, label: key };
}

export function gradientStyle(meta: ModuleMeta): React.CSSProperties {
  return { backgroundImage: `linear-gradient(135deg, ${meta.gradientFrom}, ${meta.gradientTo})` };
}
