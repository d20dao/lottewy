// Companion for an already-running local Wrangler session. Does not sign transactions.
let syncing = false;
async function tick() {
  if (syncing) return;
  syncing = true;
  try {
    await fetch("http://127.0.0.1:8787/cdn-cgi/local/scheduled");
  } catch {
  } finally {
    syncing = false;
  }
}
await tick();
setInterval(tick, 5000);
