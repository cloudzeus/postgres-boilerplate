// Supported locales for DGEspa.
export const LOCALES = [
  { code: 'el', label: 'Ελληνικά',  nativeLabel: 'Ελληνικά'  },
  { code: 'en', label: 'English',   nativeLabel: 'English'   },
  { code: 'de', label: 'Deutsch',   nativeLabel: 'Deutsch'   },
  { code: 'fr', label: 'Français',  nativeLabel: 'Français'  },
  { code: 'it', label: 'Italiano',  nativeLabel: 'Italiano'  },
  { code: 'es', label: 'Español',   nativeLabel: 'Español'   },
  { code: 'bg', label: 'Български', nativeLabel: 'Български' },
  { code: 'ro', label: 'Română',    nativeLabel: 'Română'    },
] as const;

export type LocaleCode = (typeof LOCALES)[number]['code'];

export const DEFAULT_LOCALE: LocaleCode = 'el';

export function isValidLocale(code: string): code is LocaleCode {
  return LOCALES.some((l) => l.code === code);
}

export function getLocale(code: string | null | undefined) {
  return LOCALES.find((l) => l.code === code) ?? LOCALES[0];
}
