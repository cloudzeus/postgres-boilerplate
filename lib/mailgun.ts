import formData from 'form-data';
import Mailgun from 'mailgun.js';

type MailgunClient = ReturnType<InstanceType<typeof Mailgun>['client']>;

let cached: MailgunClient | null = null;

/**
 * Ο client φτιάχνεται ΜΟΝΟ στην πρώτη αποστολή. Το mailgun.js πετάει «Parameter "key" is
 * required» όταν το κλειδί λείπει, οπότε μια κατασκευή σε module scope έσπαγε το `next build`
 * (collect page data) σε περιβάλλον χωρίς MAILGUN_API_KEY — π.χ. στο Docker build.
 */
function getClient(): MailgunClient {
  if (cached) return cached;
  const key = process.env.MAILGUN_API_KEY ?? '';
  if (!key) throw new Error('MAILGUN_API_KEY is not configured');
  const mailgun = new Mailgun(formData);
  cached = mailgun.client({
    username: 'api',
    key,
    url: process.env.MAILGUN_ENDPOINT ?? 'https://api.eu.mailgun.net',
  });
  return cached;
}

export async function sendTransactionalEmail(to: string, subject: string, html: string) {
  const domain = process.env.MAILGUN_DOMAIN ?? 'dgsmart.gr';
  return getClient().messages.create(domain, {
    from: process.env.SHARED_MAILBOX_ADDRESS ?? 'connect@dgsmart.gr',
    to,
    subject,
    html,
  });
}
