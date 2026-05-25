import { checkDependenciesAndNotify } from '../lib/updateNotifier.js';

const run = async () => {
  try {
    const result = await checkDependenciesAndNotify();
    if (result.updated) {
      console.log(`Update available: ${result.update.current} → ${result.update.latest}`);
      console.log('An email notification was sent if UPDATE_NOTIFY_EMAIL is configured.');
    } else {
      console.log('All packages are up to date.');
    }
  } catch (error) {
    console.error('Update check failed:', error);
    process.exit(1);
  }
};

run();
