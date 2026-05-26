import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase, type CallRow } from '../../src/supabase/client';
import { runSyncOnce } from '../../src/sync/worker';

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

function statusBadge(s: CallRow['transcription_status']): {
  label: string;
  color: string;
} {
  switch (s) {
    case 'done':
      return { label: 'transcribed', color: '#3fb950' };
    case 'processing':
      return { label: 'transcribing', color: '#d29922' };
    case 'failed':
      return { label: 'failed', color: '#f85149' };
    case 'skipped':
      return { label: 'no audio', color: '#8b949e' };
    default:
      return { label: 'pending', color: '#8b949e' };
  }
}

export default function CallsList() {
  const router = useRouter();
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('calls')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(200);
    if (!error && data) setCalls(data as CallRow[]);
    setLoading(false);
  }, []);

  const onRefresh = useCallback(async () => {
    setSyncing(true);
    try {
      await runSyncOnce();
    } catch {
      // surfaced via row status
    }
    await load();
    setSyncing(false);
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (loading && calls.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['bottom']}>
      <FlatList
        data={calls}
        keyExtractor={(c) => c.id}
        contentContainerStyle={
          calls.length === 0 ? styles.emptyContainer : undefined
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.emptyTitle}>No calls yet</Text>
            <Text style={styles.emptyHint}>
              Pull down to sync from your phone's call log.
            </Text>
          </View>
        }
        refreshControl={
          <RefreshControl
            refreshing={syncing}
            onRefresh={onRefresh}
            tintColor="#fff"
          />
        }
        renderItem={({ item }) => {
          const badge = statusBadge(item.transcription_status);
          return (
            <Pressable
              style={styles.row}
              onPress={() => router.push(`/call/${item.id}`)}
            >
              <Text style={styles.dirGlyph}>
                {directionGlyph(item.direction)}
              </Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>
                  {item.contact_name || item.phone_number || 'Unknown'}
                </Text>
                <Text style={styles.meta}>
                  {formatTime(item.started_at)} ·{' '}
                  {formatDuration(item.duration_sec)}
                </Text>
                {item.transcript ? (
                  <Text numberOfLines={1} style={styles.preview}>
                    {item.transcript}
                  </Text>
                ) : null}
              </View>
              <Text style={[styles.badge, { color: badge.color }]}>
                {badge.label}
              </Text>
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1117' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyContainer: { flexGrow: 1 },
  emptyTitle: { color: '#fff', fontSize: 18, fontWeight: '600' },
  emptyHint: { color: '#8b949e', marginTop: 8, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#21262d',
  },
  dirGlyph: { color: '#8b949e', fontSize: 22, width: 28, textAlign: 'center' },
  name: { color: '#fff', fontSize: 16, fontWeight: '600' },
  meta: { color: '#8b949e', marginTop: 2, fontSize: 12 },
  preview: { color: '#c9d1d9', marginTop: 4, fontSize: 12 },
  badge: { fontSize: 11, marginLeft: 8 },
});
