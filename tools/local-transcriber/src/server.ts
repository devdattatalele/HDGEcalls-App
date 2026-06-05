import http from 'node:http';

/**
 * Counters / liveness fields the polling loop updates. Read by /health and
 * /status — the calls.hdgelabs.com dashboard renders these as a "Transcriber
 * online" pill via Cloudflare Tunnel.
 *
 * Daily counters reset at local midnight so the manager sees a meaningful
 * "today" number rather than lifetime totals.
 */
export const stats = {
  provider: 'unknown',
  started_at: new Date().toISOString(),
  last_pass_at: null as string | null,
  last_pass_processed: 0,
  jobs_in_flight: 0,
  jobs_done_today: 0,
  jobs_failed_today: 0,
  last_error: null as string | null,
  day_anchor: todayKey(),
};

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function rolloverIfNewDay() {
  const today = todayKey();
  if (today !== stats.day_anchor) {
    stats.day_anchor = today;
    stats.jobs_done_today = 0;
    stats.jobs_failed_today = 0;
  }
}

export function startHealthServer(port: number) {
  const server = http.createServer((req, res) => {
    rolloverIfNewDay();
    const url = req.url ?? '/';

    if (url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          provider: stats.provider,
          started_at: stats.started_at,
          last_pass_at: stats.last_pass_at,
        }),
      );
      return;
    }

    if (url === '/status') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...stats }));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`[transcriber] health server on :${port}`);
  });

  server.on('error', (err) => {
    console.error('[transcriber] health server error:', err);
  });
}
