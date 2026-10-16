// Ελβετία — UID-Register (Ομοσπονδιακή Στατιστική Υπηρεσία). Δημόσιο SOAP, δωρεάν, χωρίς κλειδί.
// `ValidateVatNumber` λέει αν ο αριθμός είναι ενεργός στο ΦΠΑ (MWST/TVA/IVA)· `GetByUID` δίνει
// επωνυμία και διεύθυνση. Αναφέρεται όριο ~20 αιτημάτων/λεπτό (ανεπιβεβαίωτο επίσημα).
import type { VatCheckConfig, VatCheckResult } from './types';
import type { VatTarget } from './target';
import { abortDetail, failure, text, timedFetch } from './http';

export const UID_URL = 'https://www.uid-wse.admin.ch/V5.0/PublicServices.svc';
const NS = 'http://www.uid.admin.ch/xmlns/uid-wse';

async function soap(cfg: VatCheckConfig, action: string, body: string): Promise<{ status: number; xml: string }> {
  const envelope = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:uid="${NS}" xmlns:e97="http://www.ech.ch/xmlns/eCH-0097/5"><soapenv:Body>${body}</soapenv:Body></soapenv:Envelope>`;
  const res = await timedFetch(cfg, UID_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${NS}/IPublicServices/${action}"` },
    body: envelope,
  });
  return { status: res.status, xml: await res.text() };
}

/** Πρώτη τιμή ενός στοιχείου XML (αγνοεί namespaces). */
export function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([^<]*)</(?:[\\w-]+:)?${name}>`));
  return m ? m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim() : null;
}

export function parseUidOrganisation(xml: string): { name: string | null; address: string | null; vatStatus: string | null } {
  const street = [tag(xml, 'street'), tag(xml, 'houseNumber')].filter(Boolean).join(' ');
  const town = [tag(xml, 'swissZipCode'), tag(xml, 'town')].filter(Boolean).join(' ');
  return {
    name: text(tag(xml, 'organisationName')),
    address: text([street, town, tag(xml, 'countryIdISO2')].filter(Boolean).join(', ')),
    vatStatus: tag(xml, 'vatStatus'),
  };
}

export async function checkUid(t: VatTarget, cfg: VatCheckConfig): Promise<VatCheckResult> {
  const formatted = `CHE-${t.number.slice(0, 3)}.${t.number.slice(3, 6)}.${t.number.slice(6)}`;
  let v: { status: number; xml: string };
  try {
    v = await soap(cfg, 'ValidateVatNumber', `<uid:ValidateVatNumber><uid:vatNumber>${formatted}</uid:vatNumber></uid:ValidateVatNumber>`);
  } catch (e) { return failure(t, 'uid', 'network', abortDetail(e)); }
  if (/Fault/.test(v.xml) || v.status >= 400) {
    const fault = tag(v.xml, 'faultstring') ?? `HTTP ${v.status}`;
    if (/limit|throttl|too many/i.test(fault)) return failure(t, 'uid', 'rate_limited', fault);
    if (/invalid|format/i.test(fault)) return failure(t, 'uid', 'invalid_format', fault);
    return failure(t, 'uid', 'unavailable', fault);
  }
  const valid = tag(v.xml, 'ValidateVatNumberResult') === 'true';
  const base = { vat: t.vat, countryCode: 'CH', valid, provider: 'uid' as const, source: 'UID-Register', consultationNumber: null, checkedAt: new Date().toISOString() };
  // Επωνυμία/διεύθυνση: δεύτερη κλήση, best effort — ο έλεγχος ΦΠΑ έχει ήδη απάντηση.
  try {
    const g = await soap(cfg, 'GetByUID', `<uid:GetByUID><uid:uid><e97:uidOrganisationIdCategorie>CHE</e97:uidOrganisationIdCategorie><e97:uidOrganisationId>${t.number}</e97:uidOrganisationId></uid:uid></uid:GetByUID>`);
    if (g.status < 400 && !/Fault/.test(g.xml)) {
      const o = parseUidOrganisation(g.xml);
      return { ...base, name: o.name, address: o.address, ...(!valid && o.name ? { message: 'Η επιχείρηση υπάρχει στο μητρώο UID, αλλά ο αριθμός ΔΕΝ είναι ενεργός στο ΦΠΑ.' } : {}) };
    }
  } catch { /* μόνο χωρίς επωνυμία */ }
  return { ...base, name: null, address: null };
}
