import * as Clipboard from 'expo-clipboard';
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../src/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../src/components/ui/card';
import { Separator } from '../src/components/ui/separator';
import { Muted, Text } from '../src/components/ui/text';
import {
  checkSyncCapabilities,
  type SyncCapabilityState,
} from '../src/permissions';
import {
  clearSyncEventLog,
  getSyncEventLog,
  type SyncEvent,
} from '../src/sync/eventLog';
import { loadActiveAppDials } from '../src/sync/appDials';
import { runSyncOnce } from '../src/sync/worker';

type Counters = {
  recordings: number;
  callLogs: number;
  pairs: number;
  uploadOk: number;
  uploadFailed: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function relativeTime(ts: number | null): string {
  if (!ts) return 'Never';
  const delta = Math.max(0, Date.now() - ts);
  const min = Math.floor(delta / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day === 1 ? '' : 's'} ago`;
}

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function severityFor(event: SyncEvent): 'success' | 'warn' | 'error' {
  switch (event.kind) {
    case 'upload_success':
    case 'pairing_matched':
    case 'app_dial_matched':
    case 'sync_finished':
      return 'success';
    case 'upload_failed':
    case 'permission_denied':
      return 'error';
    case 'scan_folder_inaccessible':
    case 'pairing_rejected_not_app_dialed':
    case 'pairing_no_recording_found':
    case 'sync_skipped':
      return 'warn';
    default:
      return 'success';
  }
}

function eventSummary(event: SyncEvent): string {
  switch (event.kind) {
    case 'app_dial_recorded':
      return `App dial queued ending ${event.numberSuffix || '----'}`;
    case 'app_dial_matched':
      return `App dial consumed ending ${event.numberSuffix || '----'}`;
    case 'scan_started':
      return `Scanning ${event.folderCount} folders since ${timeLabel(event.sinceMs)}`;
    case 'scan_folder_inaccessible':
      return `${event.reason.replace('_', ' ')}: ${event.folderUri}`;
    case 'recording_found':
      return `Recording ${event.ext || 'audio'} ${Math.round(event.sizeBytes / 1024)} KB`;
    case 'call_log_scanned':
      return `Saw ${event.count} call-log entries${event.newestTs ? `, newest ${timeLabel(event.newestTs)}` : ''}`;
    case 'pairing_matched':
      return `${event.reason} pair for ${event.direction} ending ${event.numberSuffix || '----'}`;
    case 'pairing_rejected_not_app_dialed':
      return `Rejected: not dialed in HDGEcalls, ending ${event.numberSuffix || '----'}`;
    case 'pairing_no_recording_found':
      return `No recording paired for ${event.direction} ending ${event.numberSuffix || '----'}`;
    case 'upload_started':
      return `Uploading ${event.direction} ending ${event.numberSuffix || '----'}`;
    case 'upload_success':
      return `Uploaded ${event.direction} ${event.durationSec}s ending ${event.numberSuffix || '----'}`;
    case 'upload_failed':
      return `Upload failed (${event.errorName}) ending ${event.numberSuffix || '----'}`;
    case 'permission_denied':
      return `Permission denied: ${event.permission.replace('_', ' ')}`;
    case 'sync_started':
      return `Sync pass started from ${timeLabel(event.cursorMs)}`;
    case 'sync_skipped':
      return `Sync skipped: ${event.reason.replace('_', ' ')}`;
    case 'sync_finished':
      return `Sync finished: ${event.inserted} uploaded, ${event.errors} errors`;
  }
}

function countLastDay(events: SyncEvent[]): Counters {
  const since = Date.now() - DAY_MS;
  const recent = events.filter((e) => e.ts >= since);
  const callLogScans = recent.filter(
    (e): e is Extract<SyncEvent, { kind: 'call_log_scanned' }> =>
      e.kind === 'call_log_scanned',
  );
  return {
    recordings: recent.filter((e) => e.kind === 'recording_found').length,
    callLogs: callLogScans.reduce((sum, e) => sum + e.count, 0),
    pairs: recent.filter((e) => e.kind === 'pairing_matched').length,
    uploadOk: recent.filter((e) => e.kind === 'upload_success').length,
    uploadFailed: recent.filter((e) => e.kind === 'upload_failed').length,
  };
}

async function copyText(value: string): Promise<void> {
  await Clipboard.setStringAsync(value);
}

export default function SyncHealthScreen() {
  const [events, setEvents] = useState<SyncEvent[]>([]);
  const [capabilities, setCapabilities] = useState<SyncCapabilityState | null>(
    null,
  );
  const [pendingDials, setPendingDials] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    const [log, caps, dials] = await Promise.all([
      getSyncEventLog(),
      checkSyncCapabilities(),
      loadActiveAppDials(),
    ]);
    setEvents(log);
    setCapabilities(caps);
    setPendingDials(dials.filter((d) => !d.matchedCallLogId).length);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const counters = useMemo(() => countLastDay(events), [events]);
  const lastSuccess = events.find((e) => e.kind === 'upload_success')?.ts ?? null;
  const lastSyncPass =
    events.find((e) => e.kind === 'sync_finished' || e.kind === 'sync_skipped')
      ?.ts ?? null;

  async function onRunSync() {
    setSyncing(true);
    try {
      const result = await runSyncOnce();
      await load();
      Alert.alert(
        'Sync finished',
        `${result.inserted} uploaded, ${result.errors} errors${
          result.skipped === -1 ? ' (limit reached this month)' : ''
        }.`,
      );
    } catch (e) {
      Alert.alert('Sync failed', String((e as Error)?.message ?? e));
    } finally {
      setSyncing(false);
    }
  }

  async function onCopy() {
    try {
      await copyText(JSON.stringify(events, null, 2));
      Alert.alert('Copied', 'Sync log copied to clipboard.');
    } catch (e) {
      Alert.alert('Copy failed', String((e as Error)?.message ?? e));
    }
  }

  function onClear() {
    Alert.alert('Clear sync log?', 'This only clears local diagnostics.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => {
          void clearSyncEventLog().then(load);
        },
      },
    ]);
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['bottom']}>
      <Stack.Screen options={{ headerShown: true, title: 'Sync Health' }} />
      <FlatList
        data={events}
        keyExtractor={(item, index) => `${item.ts}:${item.kind}:${index}`}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        contentContainerClassName="p-4 gap-4 pb-8"
        ListHeaderComponent={
          <View className="gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Sync status</CardTitle>
                <CardDescription>
                  Last sync pass: {relativeTime(lastSyncPass)} · Last upload:{' '}
                  {relativeTime(lastSuccess)}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  variant="default"
                  onPress={onRunSync}
                  loading={syncing}
                  disabled={syncing}
                >
                  Run sync now
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Current state</CardTitle>
                <CardDescription>Last 24 hours</CardDescription>
              </CardHeader>
              <CardContent className="gap-2">
                <Metric label="Recordings found" value={counters.recordings} />
                <Metric label="Call-log entries seen" value={counters.callLogs} />
                <Metric label="Pairs matched" value={counters.pairs} />
                <Metric label="Uploads succeeded" value={counters.uploadOk} />
                <Metric label="Uploads failed" value={counters.uploadFailed} />
                <Metric label="Pending app-dials" value={pendingDials} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Capabilities</CardTitle>
                <CardDescription>Checked live when this screen opens.</CardDescription>
              </CardHeader>
              <CardContent className="gap-2">
                <Capability
                  label="All-Files Access"
                  ok={capabilities?.allFiles}
                  onFix={() => {
                    Linking.sendIntent(
                      'android.settings.MANAGE_ALL_FILES_ACCESS_PERMISSION',
                    ).catch(() => Linking.openSettings());
                  }}
                />
                <Separator />
                <Capability
                  label="Call-log permission"
                  ok={capabilities?.callLog}
                  onFix={() => Linking.openSettings()}
                />
                <Separator />
                <Capability
                  label="Notifications"
                  ok={capabilities?.notifications}
                  onFix={() => Linking.openSettings()}
                />
              </CardContent>
            </Card>

            <View>
              <Text className="font-semibold text-lg">Event log</Text>
              <Muted>Newest first, capped at 50 events.</Muted>
            </View>
          </View>
        }
        ListFooterComponent={
          <View className="gap-3 pt-2">
            <Button variant="outline" onPress={onCopy}>
              Copy log to clipboard
            </Button>
            <Button variant="destructive" onPress={onClear}>
              Clear log
            </Button>
          </View>
        }
        ListEmptyComponent={
          <Card>
            <CardContent className="py-8">
              <Muted className="text-center">
                No sync events yet. Run a sync, then pull to refresh.
              </Muted>
            </CardContent>
          </Card>
        }
        ItemSeparatorComponent={() => <View className="h-2" />}
        renderItem={({ item }) => <EventRow event={item} />}
      />
    </SafeAreaView>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <View className="flex-row items-center justify-between">
      <Text>{label}</Text>
      <Text className="font-semibold">{value}</Text>
    </View>
  );
}

function Capability({
  label,
  ok,
  onFix,
}: {
  label: string;
  ok: boolean | undefined;
  onFix: () => void;
}) {
  return (
    <View className="flex-row items-center justify-between gap-3 py-1">
      <Text className="flex-1">{label}</Text>
      {ok ? (
        <Text className="text-emerald-600 dark:text-emerald-400 font-semibold">
          ✓
        </Text>
      ) : (
        <Button variant="outline" size="sm" onPress={onFix}>
          Fix
        </Button>
      )}
    </View>
  );
}

function EventRow({ event }: { event: SyncEvent }) {
  const severity = severityFor(event);
  const color =
    severity === 'error'
      ? 'border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30'
      : severity === 'warn'
        ? 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30'
        : 'border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30';
  return (
    <Pressable className={`rounded-lg border p-3 ${color}`}>
      <View className="flex-row items-center justify-between gap-3">
        <Text className="font-semibold text-sm flex-1" numberOfLines={1}>
          {event.kind}
        </Text>
        <Muted className="text-xs">{timeLabel(event.ts)}</Muted>
      </View>
      <Muted className="mt-1" numberOfLines={1}>
        {eventSummary(event)}
      </Muted>
    </Pressable>
  );
}
