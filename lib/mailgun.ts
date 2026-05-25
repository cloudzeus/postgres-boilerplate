import formData from 'form-data';
import Mailgun from 'mailgun.js';

const mailgun = new Mailgun(formData);
const client = mailgun.client({
  username: 'api',
  key: process.env.MAILGUN_API_KEY ?? '',
  url: process.env.MAILGUN_ENDPOINT ?? 'https://api.eu.mailgun.net',
});

export async function sendTransactionalEmail(to: string, subject: string, html: string) {
  const domain = process.env.MAILGUN_DOMAIN ?? 'dgsmart.gr';
  return client.messages.create(domain, {
    from: process.env.SHARED_MAILBOX_ADDRESS ?? 'connect@dgsmart.gr',
    to,
    subject,
    html,
  });
}
