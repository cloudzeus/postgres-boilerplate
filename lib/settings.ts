import { prisma } from '@/lib/db';

// Setting categories used in admin UI.
export const SETTING_CATEGORIES = [
  { id: 'company', label: 'Στοιχεία εταιρίας' },
  { id: 'i18n', label: 'Γλώσσες εφαρμογής' },
  { id: 'integrations', label: 'Διασυνδέσεις' },
  { id: 'email', label: 'Email (Mailgun)' },
  { id: 'storage', label: 'BunnyCDN Storage' },
  { id: 'ai', label: 'AI / DeepSeek' },
  { id: 'backups', label: 'Database Backups' },
  { id: 'general', label: 'Γενικές ρυθμίσεις' },
] as const;

// Catalog of all known settings — used to seed defaults and render forms.
export interface SettingDef {
  key: string;
  category: typeof SETTING_CATEGORIES[number]['id'];
  label: string;
  description?: string;
  type: 'text' | 'password' | 'url' | 'email' | 'number' | 'boolean' | 'textarea' | 'locale' | 'locales-multi' | 'media';
  isSecret?: boolean;
  defaultValue?: string | number | boolean | string[];
}

export const SETTING_CATALOG: SettingDef[] = [
  // i18n — application-wide language config
  {
    key: 'i18n.defaultLocale',
    category: 'i18n',
    label: 'Προεπιλεγμένη γλώσσα',
    description: 'Η κύρια γλώσσα της εφαρμογής. Όλα τα κείμενα γράφονται σε αυτή τη γλώσσα.',
    type: 'locale',
    defaultValue: 'el',
  },
  {
    key: 'i18n.enabledLocales',
    category: 'i18n',
    label: 'Διαθέσιμες γλώσσες',
    description: 'Επιπλέον γλώσσες στις οποίες θα μεταφράζονται τα κείμενα μέσω DeepSeek.',
    type: 'locales-multi',
    defaultValue: ['el', 'en'],
  },
  {
    key: 'i18n.autoTranslate',
    category: 'i18n',
    label: 'Αυτόματη μετάφραση νέων κειμένων',
    description: 'Όταν ενεργοποιείται, νέα κείμενα μεταφράζονται αυτόματα στις διαθέσιμες γλώσσες.',
    type: 'boolean',
    defaultValue: true,
  },

  // Company
  { key: 'company.name',         category: 'company', label: 'Επωνυμία εταιρίας',  type: 'text', defaultValue: 'DGEspa' },
  { key: 'company.legalName',    category: 'company', label: 'Νομική επωνυμία',    type: 'text' },
  { key: 'company.vat',          category: 'company', label: 'ΑΦΜ',                type: 'text' },
  { key: 'company.address',      category: 'company', label: 'Διεύθυνση',          type: 'text' },
  { key: 'company.phone',        category: 'company', label: 'Τηλέφωνο',           type: 'text' },
  { key: 'company.email',        category: 'company', label: 'Email επικοινωνίας', type: 'email' },
  { key: 'company.logoUrl',      category: 'company', label: 'Logo',               type: 'media' },

  // Email
  { key: 'email.mailgunApiKey',     category: 'email', label: 'Mailgun API Key',     type: 'password', isSecret: true },
  { key: 'email.mailgunEndpoint',   category: 'email', label: 'Mailgun Endpoint',    type: 'url',      defaultValue: 'https://api.eu.mailgun.net/v3/dgsmart.gr' },
  { key: 'email.fromAddress',       category: 'email', label: 'From address',        type: 'email',    defaultValue: 'connect@dgsmart.gr' },

  // BunnyCDN
  { key: 'storage.bunnyZone',       category: 'storage', label: 'Storage Zone',        type: 'text' },
  { key: 'storage.bunnyAccessKey',  category: 'storage', label: 'Access Key',          type: 'password', isSecret: true },
  { key: 'storage.bunnyS3Endpoint', category: 'storage', label: 'S3 Endpoint',         type: 'url',      defaultValue: 'https://de-s3.storage.bunnycdn.com' },
  { key: 'storage.bunnyS3SecretKey',category: 'storage', label: 'S3 Secret Key',       type: 'password', isSecret: true },
  { key: 'storage.cdnHost',         category: 'storage', label: 'CDN Host',            type: 'text',     defaultValue: 'espa-stamos.b-cdn.net' },

  // AI
  { key: 'ai.deepseekApiKey', category: 'ai', label: 'DeepSeek API Key', type: 'password', isSecret: true },
  { key: 'ai.deepseekUrl',    category: 'ai', label: 'DeepSeek API URL', type: 'url',      defaultValue: 'https://api.deepseek.com/v1/chat/completions' },
  { key: 'ai.deepseekTextModel', category: 'ai', label: 'DeepSeek text model (digital PDF / text OCR)', type: 'text', defaultValue: 'deepseek-chat' },
  { key: 'ai.visionApiKey',   category: 'ai', label: 'Vision OCR API Key (Gemini/DeepInfra/OpenAI)', type: 'password', isSecret: true, description: 'Για scanned images. Default: Gemini 2.0 Flash. Αν κενό, διαβάζεται από GEMINI_API_KEY στο .env.' },
  { key: 'ai.visionUrl',      category: 'ai', label: 'Vision OCR endpoint',     type: 'url',  defaultValue: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions' },
  { key: 'ai.visionModel',    category: 'ai', label: 'Vision OCR model',        type: 'text', defaultValue: 'gemini-2.5-flash' },
  { key: 'ai.usdToEur',       category: 'ai', label: 'Ισοτιμία USD→EUR (fallback)', description: 'Εφεδρική ισοτιμία δολαρίου→ευρώ για την οθόνη κόστους AI. Κανονικά οι ισοτιμίες λαμβάνονται ζωντανά από το Frankfurter (ΕΚΤ), ανά ημέρα· αυτή χρησιμοποιείται μόνο αν το API δεν είναι διαθέσιμο.', type: 'number', defaultValue: 0.92 },

  // Integrations — SoftOne ERP Web Services (two-step login → authenticate)
  { key: 'integrations.softoneSerial',  category: 'integrations', label: 'SoftOne Subdomain', description: 'Το subdomain πριν το .oncloud.gr (π.χ. kolleris). Από αυτό προκύπτει το endpoint https://<subdomain>.oncloud.gr/s1services.', type: 'text' },
  { key: 'integrations.softoneAppId',   category: 'integrations', label: 'SoftOne App ID', description: 'Το AppID (≥1000) που έχει οριστεί στο SoftOne → Web & Mobile → Web Services.', type: 'text' },
  { key: 'integrations.softoneUser',    category: 'integrations', label: 'SoftOne Username', description: 'Web Account username.', type: 'text' },
  { key: 'integrations.softonePass',    category: 'integrations', label: 'SoftOne Password', type: 'password', isSecret: true },
  { key: 'integrations.softoneCompany', category: 'integrations', label: 'SoftOne Company',  description: 'Κωδικός εταιρίας για το authenticate (π.χ. 1001). Αν κενό, το Test εμφανίζει τις διαθέσιμες εταιρίες.', type: 'text' },
  { key: 'integrations.softoneBranch',  category: 'integrations', label: 'SoftOne Branch',   description: 'Κωδικός υποκαταστήματος (π.χ. 1000 = Έδρα).', type: 'text' },
  { key: 'integrations.softoneModule',  category: 'integrations', label: 'SoftOne Module',   description: 'Κωδικός module (π.χ. 0 = Εμπορικό).', type: 'text', defaultValue: '0' },
  { key: 'integrations.softoneRefid',   category: 'integrations', label: 'SoftOne RefID',    description: 'Κωδικός χρήστη/δικαιωμάτων (refid) για το authenticate.', type: 'text' },
  { key: 'integrations.gemiApiKey',     category: 'integrations', label: 'ΓΕΜΗ API Key', description: 'API Key για το Γενικό Εμπορικό Μητρώο (Μητρώο Επιχειρήσεων).', type: 'password', isSecret: true },

  // Backups
  { key: 'backups.enabled',       category: 'backups', label: 'Ενεργό αυτόματο backup',  description: 'Ενεργοποιεί το ημερήσιο cron backup της βάσης.', type: 'boolean', defaultValue: true },
  { key: 'backups.retentionDays', category: 'backups', label: 'Μέγιστος αριθμός αρχείων', description: 'Μέγιστος αριθμός backups που διατηρούνται. Τα παλαιότερα διαγράφονται αυτόματα.', type: 'number', defaultValue: 30 },
  { key: 'backups.cronSecret',    category: 'backups', label: 'Cron Secret Token',        description: 'Bearer token που ζητείται από το /api/cron/backup για να εκτελεστεί το backup.', type: 'password', isSecret: true },
  { key: 'backups.storagePrefix', category: 'backups', label: 'Storage prefix',           description: 'Φάκελος μέσα στο BunnyCDN storage zone όπου ανεβαίνουν τα backups.', type: 'text', defaultValue: 'backups' },
  { key: 'backups.pgDumpPath',    category: 'backups', label: 'pg_dump path',             description: 'Πλήρες path του εκτελέσιμου pg_dump στον server. Αφήστε κενό για default.', type: 'text', defaultValue: 'pg_dump' },
  { key: 'backups.pgRestorePath', category: 'backups', label: 'pg_restore path',          description: 'Πλήρες path του εκτελέσιμου pg_restore στον server.', type: 'text', defaultValue: 'pg_restore' },

  // General
  { key: 'general.defaultLocale', category: 'general', label: 'Default locale', type: 'text', defaultValue: 'el-GR' },
  { key: 'general.timezone',      category: 'general', label: 'Timezone',       type: 'text', defaultValue: 'Europe/Athens' },
];

export async function getSetting<T = string>(key: string, fallback?: T): Promise<T | undefined> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  if (!row) return fallback;
  return row.value as T;
}

export async function setSetting(key: string, value: unknown, updatedById?: string | null) {
  const def = SETTING_CATALOG.find((s) => s.key === key);
  await prisma.appSetting.upsert({
    where: { key },
    update: { value: value as never, updatedById: updatedById ?? null },
    create: {
      key,
      value: value as never,
      category: def?.category ?? 'general',
      description: def?.label,
      isSecret: def?.isSecret ?? false,
      updatedById: updatedById ?? null,
    },
  });
}

// Strips secret values for client-side display
export function maskSecret(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  return '••••••••' + value.slice(-4);
}
