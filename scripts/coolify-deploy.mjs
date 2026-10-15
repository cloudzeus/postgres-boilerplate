// Redeploy της εφαρμογής στο Coolify μέσω του API (GET /api/v1/deploy?uuid=…).
// Χρήση: node --env-file=.env scripts/coolify-deploy.mjs
// Χρειάζεται στο .env: COOLIFY_URL (π.χ. https://coolify.example.com), COOLIFY_API_TOKEN, COOLIFY_APP_UUID.
const base = (process.env.COOLIFY_URL ?? '').replace(/\/+$/, '');
const token = process.env.COOLIFY_API_TOKEN ?? '';
const uuid = process.env.COOLIFY_APP_UUID ?? '';
if (!base || !token || !uuid) {
  console.error('Λείπουν COOLIFY_URL / COOLIFY_API_TOKEN / COOLIFY_APP_UUID στο .env');
  process.exit(1);
}
const res = await fetch(`${base}/api/v1/deploy?uuid=${encodeURIComponent(uuid)}&force=false`, {
  headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
});
const body = await res.text();
console.log(`HTTP ${res.status}`);
console.log(body.slice(0, 1000));
process.exit(res.ok ? 0 : 1);
