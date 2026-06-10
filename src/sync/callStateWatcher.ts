import { AppState, type AppStateStatus } from 'react-native';
import { loadActiveAppDials, onAppDial } from './appDials';
import { runSyncOnce, type SyncResult } from './worker';

// After a dial, the OS dialer screen comes up, the user talks, hangs up, and
// the OEM call recorder finalises the audio file — typically within a few
// seconds of hang-up but sometimes up to a couple of minutes. We poll the
// sync worker every 10s for 5 min after the dial so the upload happens
// "soon after hang-up" without burning the JS thread the rest of the time.
const BURST_INTERVAL_MS = 10_000;
const BURST_WINDOW_MS = 5 * 60 * 1000;

type WatcherHandle = { stop: () => void };

type WatcherOptions = {
  onSyncResult?: (result: SyncResult) => void;
};

export function startCallStateWatcher(opts: WatcherOptions = {}): WatcherHandle {
  let burstTimer: ReturnType<typeof setInterval> | null = null;
  let burstUntil = 0;
  let stopped = false;

  function fireSync() {
    if (stopped) return;
    runSyncOnce()
      .then((result) => {
        if (stopped) return;
        opts.onSyncResult?.(result);
      })
      .catch(() => {
        // best-effort; runSyncOnce already logs its own warnings
      });
  }

  function armBurst(fromMs: number) {
    burstUntil = Math.max(burstUntil, fromMs + BURST_WINDOW_MS);
    if (burstTimer) return;
    burstTimer = setInterval(() => {
      if (Date.now() > burstUntil) {
        if (burstTimer) {
          clearInterval(burstTimer);
          burstTimer = null;
        }
        return;
      }
      fireSync();
    }, BURST_INTERVAL_MS);
  }

  // If we mount and there's still an unmatched dial within its window, resume
  // burst mode — covers the case where the user dialed, switched apps, and is
  // coming back to the calls tab.
  void loadActiveAppDials().then((dials) => {
    if (stopped) return;
    const now = Date.now();
    const newest = dials.reduce(
      (acc, d) => (!d.matchedCallLogId && d.dialedAtMs > acc ? d.dialedAtMs : acc),
      0,
    );
    if (newest && now - newest < BURST_WINDOW_MS) {
      armBurst(newest);
    }
  });

  const unsubDial = onAppDial((d) => {
    fireSync();
    armBurst(d.dialedAtMs);
  });

  function handleAppState(next: AppStateStatus) {
    if (next === 'active') fireSync();
  }
  const appStateSub = AppState.addEventListener('change', handleAppState);

  // One opportunistic sync on mount so the list catches up if anything was
  // synced while the app was backgrounded.
  fireSync();

  return {
    stop() {
      stopped = true;
      unsubDial();
      appStateSub.remove();
      if (burstTimer) {
        clearInterval(burstTimer);
        burstTimer = null;
      }
    },
  };
}
