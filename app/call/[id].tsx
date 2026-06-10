import { Feather } from '@expo/vector-icons';
import { Audio, type AVPlaybackStatus } from 'expo-av';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  PanResponder,
  Pressable,
  ScrollView,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ContactPicker, type PickedContact } from '../../src/components/ContactPicker';
import { Avatar } from '../../src/components/ui/avatar';
import { Badge } from '../../src/components/ui/badge';
import { Button } from '../../src/components/ui/button';
import { Input } from '../../src/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../src/components/ui/card';
import { Rating10 } from '../../src/components/ui/rating10';
import { Separator } from '../../src/components/ui/separator';
import { H2, Muted, Text } from '../../src/components/ui/text';
import { supabase, type CallRow } from '../../src/supabase/client';
import { signedRecordingUrl, RECORDINGS_BUCKET } from '../../src/sync/uploader';

function formatDuration(sec: number) {
  if (!sec) return '0s';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function CallDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [call, setCall] = useState<CallRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const soundRef = useRef<Audio.Sound | null>(null);
  const [transcribing, setTranscribing] = useState(false);

  // Feedback form state
  const [rating, setRating] = useState<number | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [contactName, setContactName] = useState<string | null>(null);
  const [contactPhone, setContactPhone] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      if (!id) return;
      const { data } = await supabase
        .from('calls')
        .select('*')
        .eq('id', id)
        .single();
      const row = (data as CallRow) ?? null;
      setCall(row);
      if (row) {
        setRating(row.rating);
        setConfidence(row.purchase_confidence);
        setContactName(row.assigned_contact_name ?? row.contact_name ?? null);
        setContactPhone(row.assigned_contact_phone ?? row.phone_number ?? null);
      }
      setLoading(false);
    })();
    return () => {
      soundRef.current?.unloadAsync().catch(() => undefined);
    };
  }, [id]);

  // Pin the audio session so recordings never persist past this screen.
  useEffect(() => {
    Audio.setAudioModeAsync({ staysActiveInBackground: false }).catch(() => undefined);
  }, []);

  // Stop + tear down on blur (Back, tab switch, etc).
  useFocusEffect(
    useCallback(() => {
      return () => {
        const s = soundRef.current;
        if (s) {
          soundRef.current = null;
          setPlaying(false);
          setPositionMs(0);
          s.stopAsync().catch(() => undefined);
          s.unloadAsync().catch(() => undefined);
        }
      };
    }, []),
  );

  // While transcription is in flight (queued, processing, or we just kicked
  // it off ourselves), poll the row every 5s for up to 2 min so the UI flips
  // to 'done' without the user pulling to refresh.
  useEffect(() => {
    if (!id) return;
    const status = call?.transcription_status;
    if (status !== 'pending' && status !== 'processing' && !transcribing) return;
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from('calls')
        .select('*')
        .eq('id', id)
        .single();
      if (data) {
        const row = data as CallRow;
        setCall(row);
        if (row.transcription_status === 'done' || row.transcription_status === 'failed') {
          setTranscribing(false);
        }
      }
    }, 5000);
    const timeout = setTimeout(() => {
      clearInterval(interval);
      setTranscribing(false);
    }, 120_000);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [id, call?.transcription_status, transcribing]);

  const dirty = useMemo(() => {
    if (!call) return false;
    return (
      rating !== call.rating ||
      confidence !== call.purchase_confidence ||
      (contactName ?? null) !== (call.assigned_contact_name ?? call.contact_name ?? null) ||
      (contactPhone ?? null) !== (call.assigned_contact_phone ?? call.phone_number ?? null)
    );
  }, [call, rating, confidence, contactName, contactPhone]);

  function onStatus(status: AVPlaybackStatus) {
    if (!status.isLoaded) return;
    if (status.durationMillis) setDurationMs(status.durationMillis);
    setPositionMs(status.positionMillis ?? 0);
    if (status.didJustFinish) {
      // Pause the engine; don't seek to 0 here — expo-av treats
      // setPositionAsync(0) on a just-finished sound as "play again" and
      // the recording auto-loops. Leave it parked at the end; togglePlay
      // detects the end-of-track on next Play press and rewinds.
      setPlaying(false);
      soundRef.current?.pauseAsync().catch(() => undefined);
    }
  }

  async function togglePlay() {
    if (!call?.recording_storage_path) return;
    if (soundRef.current) {
      if (playing) {
        await soundRef.current.pauseAsync();
        setPlaying(false);
      } else {
        // If we're sitting at (or within 250ms of) the end, rewind first
        // so Play doesn't immediately fire didJustFinish again.
        if (durationMs > 0 && positionMs >= durationMs - 250) {
          await soundRef.current.setPositionAsync(0).catch(() => undefined);
          setPositionMs(0);
        }
        await soundRef.current.playAsync();
        setPlaying(true);
      }
      return;
    }
    setAudioLoading(true);
    try {
      const url = await signedRecordingUrl(call.recording_storage_path);
      if (!url) {
        Alert.alert('Playback failed', 'Could not create a signed URL.');
        return;
      }
      const { sound } = await Audio.Sound.createAsync(
        { uri: url },
        { shouldPlay: true, progressUpdateIntervalMillis: 250 },
        onStatus,
      );
      soundRef.current = sound;
      setPlaying(true);
    } catch (e) {
      Alert.alert('Playback failed', String((e as Error)?.message ?? e));
    } finally {
      setAudioLoading(false);
    }
  }

  async function seekToMs(ms: number) {
    const s = soundRef.current;
    if (!s) return;
    const clamped = Math.max(0, Math.min(ms, durationMs || ms));
    setPositionMs(clamped);
    await s.setPositionAsync(clamped).catch(() => undefined);
  }

  async function skip(deltaMs: number) {
    await seekToMs(positionMs + deltaMs);
  }

  async function onTranscribe() {
    if (!call) return;
    setTranscribing(true);
    setCall({
      ...call,
      transcription_status: 'pending',
      transcript: null,
      transcript_segments: null,
    });
    // Flip the row to `pending` — the local transcriber service (tools/
    // local-transcriber*) polls for this and picks it up within seconds.
    // We clear the existing transcript so re-transcribes don't show stale
    // text while the new one is being produced.
    const { error } = await supabase
      .from('calls')
      .update({
        transcription_status: 'pending',
        transcript: null,
        transcript_segments: null,
      })
      .eq('id', call.id);
    if (error) {
      setTranscribing(false);
      setCall((c) => (c ? { ...c, transcription_status: 'failed' } : c));
      Alert.alert('Could not queue transcription', error.message);
    }
  }

  async function deleteRecording() {
    if (!call) return;
    Alert.alert('Delete?', 'This removes the recording and its row.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (call.recording_storage_path) {
            await supabase.storage
              .from(RECORDINGS_BUCKET)
              .remove([call.recording_storage_path]);
          }
          await supabase.from('calls').delete().eq('id', call.id);
          router.back();
        },
      },
    ]);
  }

  function onPickContact(c: PickedContact) {
    setContactName(c.name);
    setContactPhone(c.phone);
  }

  async function saveFeedback() {
    if (!call) return;
    setSaving(true);
    try {
      const patch: Partial<CallRow> = {
        rating,
        purchase_confidence: confidence,
        assigned_contact_name: contactName,
        assigned_contact_phone: contactPhone,
        rated_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from('calls')
        .update(patch)
        .eq('id', call.id);
      if (error) throw error;
      setCall((c) => (c ? { ...c, ...patch } : c));
      Alert.alert('Saved', 'Feedback was saved.');
    } catch (e) {
      Alert.alert('Save failed', String((e as Error)?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }
  if (!call) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Muted>Call not found.</Muted>
      </View>
    );
  }

  const headerTitle =
    contactName || call.contact_name || call.phone_number || 'Unknown';
  const headerPhone = contactPhone || call.phone_number;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['bottom']}>
      <ScrollView contentContainerClassName="p-4 gap-4 pb-8">
        <View className="items-center gap-3 py-4">
          <Avatar name={headerTitle} size="lg" />
          <H2>{headerTitle}</H2>
          {headerPhone && headerPhone !== headerTitle ? (
            <Muted>{headerPhone}</Muted>
          ) : null}
          <View className="flex-row gap-2 flex-wrap justify-center">
            {call.direction ? (
              <Badge variant="outline">{call.direction}</Badge>
            ) : null}
            {call.recording_source === 'manual_share' ? (
              <Badge variant="secondary">shared</Badge>
            ) : null}
          </View>
          <Muted>
            {new Date(call.started_at).toLocaleString()} ·{' '}
            {formatDuration(call.duration_sec)}
          </Muted>
        </View>

        <Card>
          <CardHeader>
            <CardTitle>Recording</CardTitle>
          </CardHeader>
          <CardContent className="gap-4">
            {call.recording_storage_path ? (
              <AudioScrubber
                playing={playing}
                loading={audioLoading}
                positionMs={positionMs}
                durationMs={durationMs || call.duration_sec * 1000}
                onTogglePlay={togglePlay}
                onSeekMs={seekToMs}
                onSkip={skip}
              />
            ) : (
              <Muted className="text-center py-3">No recording</Muted>
            )}
            <Button variant="outline" onPress={deleteRecording}>
              Delete recording
            </Button>
          </CardContent>
        </Card>

        <TranscriptCard
          call={call}
          onTranscribe={onTranscribe}
          transcribing={transcribing}
        />

        <Card>
          <CardHeader>
            <CardTitle>Rate this call</CardTitle>
            <CardDescription>
              How did the conversation go, and how likely is this lead to
              convert?
            </CardDescription>
          </CardHeader>
          <CardContent className="gap-5">
            <View className="gap-2">
              <View className="flex-row items-baseline justify-between">
                <Text className="font-medium">Call rating</Text>
                <Muted>{rating ?? '—'}/10</Muted>
              </View>
              <Rating10 value={rating} onChange={setRating} />
            </View>

            <View className="gap-2">
              <View className="flex-row items-baseline justify-between">
                <Text className="font-medium">Purchase confidence</Text>
                <Muted>{confidence ?? '—'}/10</Muted>
              </View>
              <Rating10 value={confidence} onChange={setConfidence} />
              <Muted className="text-xs">
                1 = won't buy · 10 = will definitely buy
              </Muted>
            </View>

            <Separator />

            <View className="gap-2">
              <Text className="font-medium">Contact name</Text>
              <Input
                value={contactName ?? ''}
                onChangeText={(v) => setContactName(v.length ? v : null)}
                placeholder="e.g. Acme lead, Pranav from LinkedIn"
                autoCapitalize="words"
              />
              {contactPhone ? (
                <Muted className="text-xs">{contactPhone}</Muted>
              ) : null}
              <Button variant="outline" onPress={() => setPickerOpen(true)}>
                Pick from contacts
              </Button>
            </View>

            <Button onPress={saveFeedback} loading={saving} disabled={!dirty}>
              Save
            </Button>
          </CardContent>
        </Card>
      </ScrollView>

      <ContactPicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={onPickContact}
      />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Audio scrubber — draggable progress + ±10s skip, matches the website's player
// without pulling wavesurfer.js into RN.
// ---------------------------------------------------------------------------

function formatClock(ms: number): string {
  if (!isFinite(ms) || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

function AudioScrubber({
  playing,
  loading,
  positionMs,
  durationMs,
  onTogglePlay,
  onSeekMs,
  onSkip,
}: {
  playing: boolean;
  loading: boolean;
  positionMs: number;
  durationMs: number;
  onTogglePlay: () => void;
  onSeekMs: (ms: number) => void;
  onSkip: (deltaMs: number) => void;
}) {
  const [trackWidth, setTrackWidth] = useState(0);
  const [draggingMs, setDraggingMs] = useState<number | null>(null);
  const trackWidthRef = useRef(0);
  const durationRef = useRef(durationMs);

  useEffect(() => {
    trackWidthRef.current = trackWidth;
  }, [trackWidth]);
  useEffect(() => {
    durationRef.current = durationMs;
  }, [durationMs]);

  function onLayout(e: LayoutChangeEvent) {
    setTrackWidth(e.nativeEvent.layout.width);
  }

  function xToMs(x: number): number {
    const w = trackWidthRef.current;
    const d = durationRef.current;
    if (w <= 0 || d <= 0) return 0;
    const ratio = Math.max(0, Math.min(1, x / w));
    return Math.round(ratio * d);
  }

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // Claim the gesture so the parent ScrollView doesn't fight us.
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          setDraggingMs(xToMs(e.nativeEvent.locationX));
        },
        onPanResponderMove: (e) => {
          // `locationX` in onPanResponderMove is the CURRENT finger X relative
          // to the responder view — do not add gestureState.dx (that would
          // double-count). Past me added it; thumb jumped.
          setDraggingMs(xToMs(e.nativeEvent.locationX));
        },
        onPanResponderRelease: (e) => {
          const ms = xToMs(e.nativeEvent.locationX);
          onSeekMs(ms);
          setDraggingMs(null);
        },
        onPanResponderTerminate: () => setDraggingMs(null),
      }),
    [onSeekMs],
  );

  const liveMs = draggingMs ?? positionMs;
  const pct =
    durationMs > 0 ? Math.max(0, Math.min(1, liveMs / durationMs)) : 0;

  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-center gap-6">
        <Pressable
          onPress={() => onSkip(-10_000)}
          className="h-12 w-12 items-center justify-center rounded-full active:opacity-60"
        >
          <Feather name="rotate-ccw" size={22} color="#64748b" />
        </Pressable>
        <Pressable
          onPress={onTogglePlay}
          disabled={loading}
          className="h-16 w-16 items-center justify-center rounded-full bg-brand active:opacity-80"
        >
          {loading ? (
            <ActivityIndicator color="#0f172a" />
          ) : (
            <Feather
              name={playing ? 'pause' : 'play'}
              size={28}
              color="#0f172a"
              style={{ marginLeft: playing ? 0 : 3 }}
            />
          )}
        </Pressable>
        <Pressable
          onPress={() => onSkip(10_000)}
          className="h-12 w-12 items-center justify-center rounded-full active:opacity-60"
        >
          <Feather name="rotate-cw" size={22} color="#64748b" />
        </Pressable>
      </View>

      <View
        onLayout={onLayout}
        className="h-8 justify-center"
        {...pan.panHandlers}
      >
        <View className="h-2 rounded-full bg-muted overflow-hidden">
          <View
            className="h-full bg-brand"
            style={{ width: `${pct * 100}%` }}
          />
        </View>
        {trackWidth > 0 ? (
          <View
            pointerEvents="none"
            className="absolute h-4 w-4 rounded-full bg-brand border-2 border-background"
            style={{ left: pct * trackWidth - 8, top: 8 }}
          />
        ) : null}
      </View>

      <View className="flex-row justify-between">
        <Muted className="text-xs tabular-nums">{formatClock(liveMs)}</Muted>
        <Muted className="text-xs tabular-nums">{formatClock(durationMs)}</Muted>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Transcript card — invoke the transcribe-call edge function, show progress,
// render the transcript when done. Matches the website's CallDetailPage UX.
// ---------------------------------------------------------------------------

const TRANSCRIPT_PREVIEW_CHARS = 380;

function TranscriptCard({
  call,
  onTranscribe,
  transcribing,
}: {
  call: CallRow;
  onTranscribe: () => void | Promise<void>;
  transcribing: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const status = call.transcription_status;
  const text = (call.transcript ?? '').trim();
  const hasText = text.length > 0;
  const isBusy = transcribing || status === 'processing' || status === 'pending';
  const isLong = text.length > TRANSCRIPT_PREVIEW_CHARS;

  // Collapse when navigating to a different call.
  useEffect(() => {
    setExpanded(false);
  }, [call.id]);

  let buttonLabel: string;
  if (transcribing) buttonLabel = 'Queued…';
  else if (status === 'processing') buttonLabel = 'Transcribing…';
  else if (status === 'failed') buttonLabel = 'Retry';
  else if (hasText) buttonLabel = 'Re-transcribe';
  else buttonLabel = 'Transcribe';

  const shown =
    !hasText || expanded || !isLong
      ? text
      : text.slice(0, TRANSCRIPT_PREVIEW_CHARS).trimEnd() + '…';

  return (
    <Card>
      <CardHeader>
        <View className="flex-row items-center justify-between gap-3">
          <CardTitle>Transcript</CardTitle>
          {hasText && status === 'done' ? (
            <Badge variant="secondary">done</Badge>
          ) : status === 'failed' ? (
            <Badge variant="destructive">failed</Badge>
          ) : status === 'processing' ? (
            <Badge variant="outline">processing</Badge>
          ) : null}
        </View>
        {!call.recording_storage_path ? (
          <CardDescription>No recording to transcribe.</CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="gap-3">
        {hasText ? (
          <View className="gap-2">
            <View className="rounded-md border border-border bg-muted/30 p-3">
              <Text className="text-foreground leading-6">{shown}</Text>
            </View>
            {isLong ? (
              <Pressable
                onPress={() => setExpanded((x) => !x)}
                className="flex-row items-center justify-center gap-1.5 py-1.5 active:opacity-60"
              >
                <Text className="text-brand font-medium">
                  {expanded ? 'Show less' : `Show full transcript (${text.length.toLocaleString()} chars)`}
                </Text>
                <Feather
                  name={expanded ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color="#C8E841"
                />
              </Pressable>
            ) : null}
          </View>
        ) : null}
        <Button
          variant={hasText ? 'outline' : 'default'}
          onPress={onTranscribe}
          disabled={!call.recording_storage_path || isBusy}
          loading={isBusy}
        >
          {buttonLabel}
        </Button>
      </CardContent>
    </Card>
  );
}
