import { Audio } from 'expo-av';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase, type CallRow } from '../../src/supabase/client';
import { signedRecordingUrl } from '../../src/sync/uploader';

export default function CallDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [call, setCall] = useState<CallRow | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const soundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    (async () => {
      if (!id) return;
      const { data } = await supabase
        .from('calls')
        .select('*')
        .eq('id', id)
        .single();
      setCall((data as CallRow) ?? null);
      setLoading(false);
    })();
    return () => {
      soundRef.current?.unloadAsync().catch(() => undefined);
    };
  }, [id]);

  async function togglePlay() {
    if (!call?.recording_storage_path) return;
    if (soundRef.current) {
      if (playing) {
        await soundRef.current.pauseAsync();
        setPlaying(false);
      } else {
        await soundRef.current.playAsync();
        setPlaying(true);
      }
      return;
    }
    const url = await signedRecordingUrl(call.recording_storage_path);
    if (!url) {
      Alert.alert('Playback failed', 'Could not create a signed URL.');
      return;
    }
    const { sound } = await Audio.Sound.createAsync(
      { uri: url },
      { shouldPlay: true },
      (status) => {
        if (status.isLoaded && status.didJustFinish) setPlaying(false);
      },
    );
    soundRef.current = sound;
    setPlaying(true);
  }

  async function reTranscribe() {
    if (!call) return;
    await supabase
      .from('calls')
      .update({ transcription_status: 'pending' })
      .eq('id', call.id);
    // The Edge Function picks up changes; for an immediate kick we could invoke
    // it directly via supabase.functions.invoke('transcribe-call', { body: { call_id } }).
    await supabase.functions
      .invoke('transcribe-call', { body: { call_id: call.id } })
      .catch(() => undefined);
    Alert.alert('Requested', 'Transcription has been re-queued.');
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!call) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Call not found.</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.title}>
          {call.contact_name || call.phone_number || 'Unknown'}
        </Text>
        <Text style={styles.meta}>
          {new Date(call.started_at).toLocaleString()} · {call.direction} ·{' '}
          {call.duration_sec}s
        </Text>

        <View style={styles.actions}>
          <Pressable
            style={[
              styles.button,
              !call.recording_storage_path && styles.disabled,
            ]}
            onPress={togglePlay}
            disabled={!call.recording_storage_path}
          >
            <Text style={styles.buttonText}>
              {!call.recording_storage_path
                ? 'No recording'
                : playing
                  ? 'Pause'
                  : 'Play'}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.button, styles.secondary]}
            onPress={reTranscribe}
          >
            <Text style={styles.buttonText}>Re-transcribe</Text>
          </Pressable>
        </View>

        <Text style={styles.sectionTitle}>Transcript</Text>
        <Text style={styles.statusLine}>
          status: {call.transcription_status}
          {call.transcript_provider ? ` · ${call.transcript_provider}` : ''}
        </Text>
        <Text style={styles.transcript}>
          {call.transcript || 'No transcript yet.'}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1117' },
  body: { padding: 16 },
  center: {
    flex: 1,
    backgroundColor: '#0d1117',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: { color: '#fff', fontSize: 22, fontWeight: '700' },
  meta: { color: '#8b949e', marginTop: 4, marginBottom: 16 },
  actions: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  button: {
    backgroundColor: '#1f6feb',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
  },
  secondary: { backgroundColor: '#21262d' },
  disabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: '600' },
  sectionTitle: { color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 4 },
  statusLine: { color: '#8b949e', marginBottom: 8, fontSize: 12 },
  transcript: { color: '#c9d1d9', lineHeight: 22 },
  muted: { color: '#8b949e' },
});
