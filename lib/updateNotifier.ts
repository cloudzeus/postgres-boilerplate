import updateNotifier from 'update-notifier';
import pkg from '../package.json' assert { type: 'json' };
import { sendTransactionalEmail } from '@/lib/mailgun';

export async function checkDependenciesAndNotify() {
  const notifier = updateNotifier({ pkg, updateCheckInterval: 0 });
  if (!notifier.update) {
    return { updated: false };
  }

  const update = notifier.update;
  const body = `Update available for ${pkg.name}: ${update.current} → ${update.latest}.`;
  if (process.env.UPDATE_NOTIFY_EMAIL) {
    await sendTransactionalEmail(process.env.UPDATE_NOTIFY_EMAIL, `Dependency updates for ${pkg.name}`, `<p>${body}</p>`);
  }
  return { updated: true, update };
}
