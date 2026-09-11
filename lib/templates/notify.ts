// lib/templates/notify.ts — NOTIFY actions → Mailgun, one email per document and rule (spec §6, §15.3).
import 'server-only';
import { sendTransactionalEmail } from '@/lib/mailgun';

export type Notification = { conditionId: string; subject: string; emails?: string };
type ValueLike = { value: unknown; color: string };

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ESCAPES[c]);

/** `a@x.gr; b@x.gr` → ['a@x.gr', 'b@x.gr'] (semicolon, comma or whitespace separated). */
export const recipients = (s: string | null | undefined) =>
  String(s ?? '')
    .split(/[;,\s]+/)
    .map((x) => x.trim())
    .filter((x) => /.+@.+\..+/.test(x));

/** `link` empty (no APP_URL configured) → the email names the document instead of linking to it. */
export function notificationHtml(i: { fileName: string; templateName: string; values: Record<string, ValueLike>; link: string }): string {
  const rows = Object.entries(i.values)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 8px;color:${esc(v.color)};font-family:monospace">${esc(k)}</td><td style="padding:4px 8px">${esc(
          Array.isArray(v.value) ? `${v.value.length} γραμμές` : v.value ?? '—',
        )}</td></tr>`,
    )
    .join('');
  const tail = i.link
    ? `<p><a href="${esc(i.link)}">Άνοιγμα εγγράφου</a></p>`
    : `<p>Έγγραφο: <strong>${esc(i.fileName)}</strong></p>`;
  return `<p>Το έγγραφο <strong>${esc(i.fileName)}</strong> διαβάστηκε με το πρότυπο <strong>${esc(i.templateName)}</strong>.</p><table>${rows}</table>${tail}`;
}

/**
 * Sends one email per matched NOTIFY rule and returns the condition ids that were actually notified.
 * Throttling: a rule already present in `alreadyNotified` (collected from the document's previous runs)
 * is skipped, and a failed send is never recorded — so it may be retried on a later run.
 */
export async function sendRuleNotifications(i: {
  docId: string;
  fileName: string;
  templateName: string;
  defaultEmails: string | null;
  values: Record<string, ValueLike>;
  appUrl: string;
  notifications: Notification[];
  alreadyNotified: string[];
}): Promise<string[]> {
  const done: string[] = [];
  const seen = new Set(i.alreadyNotified);
  for (const n of i.notifications) {
    if (seen.has(n.conditionId)) continue;
    const ruleTo = recipients(n.emails);
    const to = ruleTo.length ? ruleTo : recipients(i.defaultEmails);
    if (to.length === 0) continue;
    try {
      await sendTransactionalEmail(
        to.join(', '),
        n.subject,
        notificationHtml({ fileName: i.fileName, templateName: i.templateName, values: i.values, link: i.appUrl ? `${i.appUrl}/admin/ocr/${i.docId}` : '' }),
      );
      done.push(n.conditionId);
      seen.add(n.conditionId);
    } catch (e) {
      console.error('[templates] notify failed', n.conditionId, (e as Error).message);
    }
  }
  return done;
}
