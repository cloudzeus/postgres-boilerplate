import { NAME_CASE_OPTIONS } from '@/lib/item-naming';
import { DEFAULT_CONVERSION_MAP } from '@/lib/ocr/delivery-note-match';
import { prisma } from '@/lib/db';

// Setting categories used in admin UI.
export const SETTING_CATEGORIES = [
  { id: 'setup', label: 'Αρχικοποίηση εφαρμογής' },
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
  type: 'text' | 'password' | 'url' | 'email' | 'number' | 'boolean' | 'textarea' | 'locale' | 'locales-multi' | 'media' | 'select';
  /** Για `select`: οι επιλογές. */
  options?: { value: string; label: string }[];
  isSecret?: boolean;
  defaultValue?: string | number | boolean | string[];
}

export const SETTING_CATALOG: SettingDef[] = [
  // Αρχικοποίηση εφαρμογής — αποφάσεις που παίρνονται μία φορά, στο στήσιμο (βλ. lib/item-naming.ts)
  {
    key: 'setup.itemNameCase',
    category: 'setup',
    label: 'Ονόματα νέων ειδών & υπηρεσιών',
    description: 'Πώς γράφεται η περιγραφή (NAME) όταν δημιουργείται είδος ή υπηρεσία στη SoftOne. Κεφαλαία: χωρίς τόνους. Πεζά: με τόνους — όσους λείπουν (κείμενο από ΚΕΦΑΛΑΙΑ) τους βάζει το AI, και γίνεται δεκτό μόνο αν άλλαξαν αποκλειστικά τόνοι. Δεν αλλάζει τα υπάρχοντα είδη.',
    type: 'select',
    options: NAME_CASE_OPTIONS,
    defaultValue: 'asis',
  },
  {
    key: 'setup.itemAutoTranslate',
    category: 'setup',
    label: 'Αυτόματη μετάφραση ξένων περιγραφών',
    description: 'Περιγραφή είδους/υπηρεσίας σε άλλη γλώσσα μεταφράζεται στα Ελληνικά (NAME) και η αρχική αποθηκεύεται στην «Περιγραφή 2» (NAME1). Στη φόρμα φαίνεται πριν τη δημιουργία, με «Επαναφορά».',
    type: 'boolean',
    defaultValue: false,
  },
  {
    key: 'setup.deliveryNoteConversion',
    category: 'setup',
    label: 'Μετασχηματισμός δελτίων αποστολής',
    description: 'Σε ποια σειρά τιμολογίου μετασχηματίζεται κάθε σειρά δελτίου αποστολής αγορών, ως «δελτίο=τιμολόγιο» χωρισμένα με κόμμα (π.χ. 2041=2061, 2043=3261). Το τιμολόγιο ΔΕΝ ξαναπερνά ποσότητα: τη μετέφερε ήδη το δελτίο — γι’ αυτό στόχος είναι «Τιμολόγιο Αγοράς», όχι «ΔΑ-Τιμολόγιο».',
    type: 'text',
    defaultValue: DEFAULT_CONVERSION_MAP,
  },

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
  { key: 'ai.openrouterApiKey', category: 'ai', label: 'OpenRouter API Key (vision OCR)', type: 'password', isSecret: true, description: 'ΠΡΩΤΟΣ πάροχος ανάγνωσης όταν υπάρχει (εδώ ή ως OPENROUTER_API_KEY στο .env) — ίδια μοντέλα Gemini (google/…). Αν τελειώσουν τα credits ή αρνηθεί, η ανάγνωση συνεχίζει αυτόματα στο Google Gemini (κλειδί παρακάτω).' },
  { key: 'ai.visionApiKey',   category: 'ai', label: 'Google Gemini API Key (εφεδρεία / δωρεάν)', type: 'password', isSecret: true, description: 'Κλειδί Google AI Studio (δωρεάν όριο). Χρησιμοποιείται όταν το OpenRouter δεν έχει credits ή αρνηθεί — ή ως μόνος πάροχος αν δεν υπάρχει κλειδί OpenRouter. Αν κενό, διαβάζεται από GEMINI_API_KEY στο .env.' },
  { key: 'ai.visionUrl',      category: 'ai', label: 'Vision OCR endpoint',     type: 'url',  description: 'Κενό = αυτόματα: πρώτα OpenRouter, εφεδρεία Google Gemini.' },
  { key: 'ai.visionModel',    category: 'ai', label: 'Vision OCR model',        type: 'text', defaultValue: 'gemini-2.5-flash', description: 'Σκέτο όνομα (gemini-2.5-flash)· στο OpenRouter γίνεται αυτόματα google/gemini-2.5-flash.' },
  {
    key: 'ocr.useIssuerExample',
    category: 'ai',
    label: 'Παράδειγμα από τον ίδιο εκδότη (few-shot)',
    description:
      'Όταν είναι ενεργό, κάθε επανεκτέλεση ανάγνωσης παίρνει ως οδηγό ένα προηγούμενο '
      + 'ΕΠΙΒΕΒΑΙΩΜΕΝΟ έγγραφο του ίδιου ΑΦΜ εκδότη (μόνο θέσεις πεδίων, ποτέ τιμές). '
      + 'Δεν προσθέτει κλήση στο μοντέλο — μόνο λίγα tokens στο prompt.',
    type: 'boolean',
    defaultValue: true,
  },
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
  { key: 'integrations.taxidApiKey',    category: 'integrations', label: 'TaxID API Key (προαιρετικό — εφεδρεία για ΗΒ)', description: 'Ο έλεγχος ξένων ΑΦΜ γίνεται πλέον ΔΩΡΕΑΝ απευθείας στις επίσημες αρχές (VIES για ΕΕ, Brønnøysund για Νορβηγία, UID για Ελβετία, HMRC για ΗΒ). Το κλειδί taxid.dev («vat_…») χρησιμοποιείται ΜΟΝΟ για ΑΦΜ Ηνωμένου Βασιλείου όσο δεν έχουν συμπληρωθεί τα στοιχεία HMRC.', type: 'password', isSecret: true },
  { key: 'integrations.hmrcClientId',     category: 'integrations', label: 'HMRC Client ID (έλεγχος ΑΦΜ ΗΒ)', description: 'Από το HMRC Developer Hub: εφαρμογή εγγεγραμμένη στο API «Check a UK VAT number» v2. Δωρεάν· η έγκριση παίρνει ~2 εβδομάδες (πρώτα δοκιμές στο sandbox). Αν κενό, διαβάζεται από HMRC_CLIENT_ID στο .env.', type: 'text' },
  { key: 'integrations.hmrcClientSecret', category: 'integrations', label: 'HMRC Client Secret', description: 'Το secret της ίδιας εφαρμογής HMRC. Αν κενό, διαβάζεται από HMRC_CLIENT_SECRET στο .env.', type: 'password', isSecret: true },
  { key: 'integrations.hmrcEnv',          category: 'integrations', label: 'HMRC περιβάλλον', description: 'Παραγωγή, ή sandbox για δοκιμές με τους δοκιμαστικούς αριθμούς του HMRC.', type: 'select', options: [{ value: 'production', label: 'Παραγωγή' }, { value: 'sandbox', label: 'Sandbox (δοκιμές)' }], defaultValue: 'production' },
  { key: 'integrations.hmrcRequesterVrn', category: 'integrations', label: 'Δικός μας ΑΦΜ ΗΒ (προαιρετικό)', description: 'Μόνο αν η εταιρία έχει ΑΦΜ στο Ηνωμένο Βασίλειο: τότε το HMRC δίνει αριθμό ελέγχου (αποδεικτικό). Αλλιώς ο έλεγχος γίνεται κανονικά, χωρίς αριθμό.', type: 'text' },
  { key: 'integrations.gemiApiKey',     category: 'integrations', label: 'ΓΕΜΗ API Key', description: 'API Key για το Γενικό Εμπορικό Μητρώο (Μητρώο Επιχειρήσεων).', type: 'password', isSecret: true },
  // Διακόπτης ασφαλείας: όσο είναι κλειστός, ΚΑΜΙΑ εγγραφή παραστατικού δεν φεύγει προς το SoftOne.
  { key: 'softone.postingEnabled',      category: 'integrations', label: 'Καταχώριση παραστατικών στο SoftOne', description: 'Όσο είναι κλειστό, η καταχώριση κάνει μόνο προεπισκόπηση (dry-run).', type: 'boolean', defaultValue: false },
  // Μάσκα κωδικού συναλλασσομένου ανά τύπο: χρησιμοποιείται ΜΟΝΟ όταν δεν υπάρχει
  // ούτε ένας κωδικός αυτού του τύπου στο SoftOne ώστε να συμπεραθεί το σχήμα.
  // Κενό = καμία πρόταση· η εφαρμογή δεν εφευρίσκει ποτέ αρίθμηση από μόνη της.
  { key: 'softone.traderCodeMask.supplier', category: 'integrations', label: 'Μάσκα κωδικού προμηθευτή', description: 'Ο ΠΡΩΤΟΣ κωδικός προμηθευτή (π.χ. 0001). Χρησιμοποιείται μόνο όταν δεν υπάρχει κανένας προμηθευτής στο SoftOne για να συμπεραθεί το σχήμα. Κενό = καμία πρόταση.', type: 'text', defaultValue: '' },
  { key: 'softone.traderCodeMask.creditor', category: 'integrations', label: 'Μάσκα κωδικού πιστωτή',   description: 'Ο ΠΡΩΤΟΣ κωδικός πιστωτή (π.χ. 53-00001). Χρησιμοποιείται μόνο όταν δεν υπάρχει κανένας πιστωτής στο SoftOne για να συμπεραθεί το σχήμα. Κενό = καμία πρόταση.', type: 'text', defaultValue: '' },
  { key: 'softone.traderCodeMask.debtor',   category: 'integrations', label: 'Μάσκα κωδικού χρεώστη',   description: 'Ο ΠΡΩΤΟΣ κωδικός χρεώστη. Χρησιμοποιείται μόνο όταν δεν υπάρχει κανένας χρεώστης στο SoftOne για να συμπεραθεί το σχήμα. Κενό = καμία πρόταση.', type: 'text', defaultValue: '' },
  // Ίδια ακριβώς λογική για τα μητρώα ειδών: πρόταση από το σχήμα των υπαρχόντων κωδικών και,
  // μόνο για ΑΔΕΙΟ μητρώο, από τη μάσκα. Κενό = κανένας προτεινόμενος κωδικός (το πεδίο μένει
  // κενό με εξήγηση) — η εφαρμογή δεν φτιάχνει ποτέ κωδικό από την περιγραφή της γραμμής.
  { key: 'softone.itemCodeMask.product',  category: 'integrations', label: 'Μάσκα κωδικού είδους',        description: 'Ο ΠΡΩΤΟΣ κωδικός είδους (MTRL SODTYPE 51). Χρησιμοποιείται μόνο όταν δεν υπάρχει κανένα είδος στο SoftOne για να συμπεραθεί το σχήμα. Κενό = καμία πρόταση.', type: 'text', defaultValue: '' },
  { key: 'softone.itemCodeMask.service',  category: 'integrations', label: 'Μάσκα κωδικού υπηρεσίας',     description: 'Ο ΠΡΩΤΟΣ κωδικός υπηρεσίας (MTRL SODTYPE 52). Χρησιμοποιείται μόνο όταν δεν υπάρχει καμία υπηρεσία στο SoftOne για να συμπεραθεί το σχήμα. Κενό = καμία πρόταση.', type: 'text', defaultValue: '' },
  { key: 'softone.itemCodeMask.expense',  category: 'integrations', label: 'Μάσκα κωδικού εξόδου',        description: 'Ο ΠΡΩΤΟΣ κωδικός εξόδου (EXPN). Χρησιμοποιείται μόνο όταν δεν υπάρχει κανένα έξοδο στο SoftOne για να συμπεραθεί το σχήμα. Κενό = καμία πρόταση.', type: 'text', defaultValue: '' },
  { key: 'softone.itemCodeMask.lineitem', category: 'integrations', label: 'Μάσκα κωδικού χρεοπίστωσης',  description: 'Ο ΠΡΩΤΟΣ κωδικός χρεοπίστωσης (MTRL SODTYPE 53). Οι χρεοπιστώσεις δημιουργούνται μόνο μέσα στο SoftOne — η μάσκα υπάρχει για πληρότητα. Κενό = καμία πρόταση.', type: 'text', defaultValue: '' },

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
