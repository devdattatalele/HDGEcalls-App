import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Pressable,
  RefreshControl,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from '../../src/components/ui/avatar';
import { Button } from '../../src/components/ui/button';
import { Skeleton } from '../../src/components/ui/skeleton';
import { H2, Muted, Text } from '../../src/components/ui/text';
import { supabase, type CallRow } from '../../src/supabase/client';
import { useTheme } from '../../src/theme/ThemeProvider';
import { runSyncOnce } from '../../src/sync/worker';
import { startCallStateWatcher } from '../../src/sync/callStateWatcher';

type Filter = 'all' | 'incoming' | 'outgoing' | 'missed';

const REALTIME_RECONNECT_MS = 30_000;

function formatDuration(sec: number): string {
  if (!sec) return '0s';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}

function directionGlyph(d: CallRow['direction']): string {
  switch (d) {
    case 'incoming':
      return '↙';
    case 'outgoing':
      return '↗';
    case 'missed':
      return '✕';
    case 'rejected':
      return '⊘';
    default:
      return '·';
  }
}

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'incoming', label: 'In' },
  { value: 'outgoing', label: 'Out' },
  { value: 'missed', label: 'Missed' },
];

export default function CallsList() {
  const router = useRouter();
  const { resolved } = useTheme();
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    const { data, error } = await supabase
      .from('calls')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(200);
    if (!error && data) setCalls(data as CallRow[]);
    if (showSpinner) setLoading(false);
  }, []);

  const onRefresh = useCallback(async () => {
    setSyncing(true);
    try {
      await runSyncOnce();
    } finally {
      await load(false);
      setSyncing(false);
    }
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
      const watcher = startCallStateWatcher({
        onSyncResult: (r) => {
          if (r.inserted > 0) void load(false);
        },
      });
      return () => watcher.stop();
    }, [load]),
  );

  // Refetch the calls list every time the app foregrounds, even if Realtime
  // missed the insert (channel can drop while we're backgrounded). The
  // watcher handles triggering sync; this ensures the UI catches up.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') load(false);
    });
    return () => sub.remove();
  }, [load]);

  // Supabase Realtime: pick up new rows the moment they're inserted in case
  // another device (or a future server-side ingester) writes them. We retry
  // on CHANNEL_ERROR / TIMED_OUT so a transient network drop doesn't kill
  // updates for the rest of the session.
  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    async function connect() {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (!uid || cancelled) return;
      channel = supabase
        .channel(`calls:${uid}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'calls',
            filter: `user_id=eq.${uid}`,
          },
          () => {
            load(false);
          },
        )
        .subscribe((status) => {
          if (cancelled) return;
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            if (channel) {
              supabase.removeChannel(channel);
              channel = null;
            }
            if (!reconnectTimer) {
              reconnectTimer = setTimeout(() => {
                reconnectTimer = null;
                if (!cancelled) void connect();
              }, REALTIME_RECONNECT_MS);
            }
          }
        });
    }
    void connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (channel) supabase.removeChannel(channel);
    };
  }, [load]);

  const visible = useMemo(() => {
    if (filter === 'all') return calls;
    return calls.filter((c) => c.direction === filter);
  }, [calls, filter]);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['bottom']}>
      <View className="px-4 pt-2 pb-3">
        <View className="flex-row gap-2">
          {FILTERS.map((f) => {
            const active = filter === f.value;
            return (
              <Pressable
                key={f.value}
                onPress={() => setFilter(f.value)}
                className={`rounded-full border px-3 py-1.5 ${
                  active
                    ? 'border-primary bg-primary'
                    : 'border-border bg-background'
                }`}
              >
                <Text
                  className={`text-sm font-medium ${
                    active ? 'text-primary-foreground' : 'text-foreground'
                  }`}
                >
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {loading && calls.length === 0 ? (
        <View className="px-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <View key={i} className="flex-row items-center gap-3 py-2">
              <Skeleton className="h-11 w-11 rounded-full" />
              <View className="flex-1 gap-2">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-1/3" />
              </View>
            </View>
          ))}
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(c) => c.id}
          contentContainerStyle={
            visible.length === 0 ? { flexGrow: 1 } : undefined
          }
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center px-8 gap-3">
              <H2>No calls here</H2>
              <Muted className="text-center">
                Make sure native call recording is on. New recordings appear
                here automatically within a few seconds.
              </Muted>
              <Button onPress={onRefresh} loading={syncing} className="mt-2">
                Sync now
              </Button>
            </View>
          }
          ItemSeparatorComponent={() => (
            <View className="h-px bg-border ml-[68px]" />
          )}
          refreshControl={
            <RefreshControl
              refreshing={syncing}
              onRefresh={onRefresh}
              tintColor={resolved === 'dark' ? '#f8fafc' : '#0f172a'}
            />
          }
          renderItem={({ item }) => {
            const title =
              item.contact_name || item.phone_number || 'Unknown';
            return (
              <Pressable
                onPress={() => router.push(`/call/${item.id}`)}
                className="flex-row items-center gap-3 px-4 py-3 active:bg-muted/50"
              >
                <Avatar name={title} fallback="?" size="md" />
                <View className="flex-1 gap-0.5">
                  <View className="flex-row items-center gap-2">
                    <Text className="text-foreground font-semibold">
                      {title}
                    </Text>
                    <Text className="text-muted-foreground">
                      {directionGlyph(item.direction)}
                    </Text>
                  </View>
                  <Muted>
                    {formatTime(item.started_at)} ·{' '}
                    {formatDuration(item.duration_sec)}
                  </Muted>
                </View>
                {item.recording_storage_path ? (
                  <Text className="text-brand text-lg">●</Text>
                ) : null}
              </Pressable>
            );
          }}
        />
      )}

      {loading && calls.length === 0 ? (
        <View className="absolute inset-0 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : null}
    </SafeAreaView>
  );
}
