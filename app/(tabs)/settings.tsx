import { useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { requestAllPermissions, type PermissionState } from '../../src/permissions';
import { supabase } from '../../src/supabase/client';
import {
  registerBackgroundSync,
  unregisterBackgroundSync,
  runSyncOnce,
} from '../../src/sync/worker';

export default function Settings() {
  const [perms, setPerms] = useState<PermissionState | null>(null);
  const [autoSync, setAutoSync] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      setEmail(data.user?.email ?? null);
    })();
  }, []);

  async function onGrantPermissions() {
    const state = await requestAllPermissions();
    setPerms(state);
  }

  async function onToggleAutoSync(next: boolean) {
    setAutoSync(next);
    if (next) await registerBackgroundSync();
    else await unregisterBackgroundSync();
  }

  async function onSyncNow() {
    setBusy(true);
    const result = await runSyncOnce().catch((e) => {
      Alert.alert('Sync failed', String(e?.message ?? e));
      return null;
    });
    setBusy(false);
    if (result) {
      Alert.alert(
        'Sync complete',
        `Calls upserted: ${result.inserted}\nRecordings uploaded: ${result.paired}\nErrors: ${result.errors}`,
      );
    }
  }

  async function onSignOut() {
    await unregisterBackgroundSync();
    await supabase.auth.signOut();
  }

  return (
    <SafeAreaView style={styles.root} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.body}>
        <Section title="Account">
          <Row label="Signed in" value={email ?? '—'} />
          <Pressable style={styles.button} onPress={onSignOut}>
            <Text style={styles.buttonText}>Sign out</Text>
          </Pressable>
        </Section>

        <Section title="Permissions">
          <Row
            label="Call log"
            value={perms ? (perms.callLog ? 'granted' : 'denied') : '—'}
          />
          <Row
            label="Storage / Audio"
            value={perms ? (perms.mediaAudio ? 'granted' : 'denied') : '—'}
          />
          <Row
            label="Contacts"
            value={perms ? (perms.contacts ? 'granted' : 'denied') : '—'}
          />
          <Row
            label="Notifications"
            value={perms ? (perms.notifications ? 'granted' : 'denied') : '—'}
          />
          <Pressable style={styles.button} onPress={onGrantPermissions}>
            <Text style={styles.buttonText}>Request permissions</Text>
          </Pressable>
        </Section>

        <Section title="Sync">
          <View style={styles.row}>
            <Text style={styles.label}>Auto-sync (background)</Text>
            <Switch value={autoSync} onValueChange={onToggleAutoSync} />
          </View>
          <Pressable
            style={[styles.button, busy && styles.disabled]}
            onPress={onSyncNow}
            disabled={busy}
          >
            <Text style={styles.buttonText}>{busy ? 'Syncing…' : 'Sync now'}</Text>
          </Pressable>
          <Text style={styles.hint}>
            For background sync to survive Android Doze, also disable battery
            optimization for this app in system Settings.
          </Text>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1117' },
  body: { padding: 16, paddingBottom: 32 },
  section: { marginBottom: 24 },
  sectionTitle: {
    color: '#8b949e',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    backgroundColor: '#161b22',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#30363d',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },
  label: { color: '#fff', fontSize: 14 },
  value: { color: '#8b949e', fontSize: 14 },
  button: {
    backgroundColor: '#1f6feb',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: { color: '#fff', fontWeight: '600' },
  disabled: { opacity: 0.5 },
  hint: { color: '#8b949e', fontSize: 12, marginTop: 8 },
});
