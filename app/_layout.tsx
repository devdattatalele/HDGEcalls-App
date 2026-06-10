import '../global.css';
import { PortalHost } from '@rn-primitives/portal';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useShareIntent } from 'expo-share-intent';
import * as Updates from 'expo-updates';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import {
  AuthGateContext,
  ONBOARDING_KEY,
  type AuthGate,
} from '../src/context/AuthGate';
import { handleSharedFile } from '../src/shareIntent/handler';
import { supabase } from '../src/supabase/client';
import { registerBackgroundSync } from '../src/sync/worker';
import { ThemeProvider } from '../src/theme/ThemeProvider';
import { checkForApkUpdate, type AvailableRelease } from '../src/updates/updateCheck';

// Without this, expo-notifications swallows local notifications while the
// app is in the foreground — the OS never shows a banner. Setting the
// handler here (module scope so it's registered before any notification
// fires) makes "Call synced" appear as a heads-up regardless of whether
// the user is in HDGEcalls or another app.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// In release builds RN's default global error handler is marked `isFatal`
// and the app process is killed on the next tick. Replace it with one that
// logs + surfaces an Alert so the app stays alive even when something
// uncaught throws inside an async event handler or a setInterval tick.
// (Dev builds keep the red box via the wrapped previous handler.)
const RNG = (globalThis as { ErrorUtils?: {
  getGlobalHandler: () => (e: unknown, isFatal?: boolean) => void;
  setGlobalHandler: (handler: (e: unknown, isFatal?: boolean) => void) => void;
} }).ErrorUtils;
if (RNG) {
  const previous = RNG.getGlobalHandler();
  RNG.setGlobalHandler((err: unknown, isFatal?: boolean) => {
    const msg =
      err instanceof Error
        ? err.message
        : typeof err === 'string'
          ? err
          : 'Unknown error';
    // eslint-disable-next-line no-console
    console.warn('[global-error]', isFatal ? 'FATAL' : 'NON-FATAL', err);
    if (!__DEV__) {
      // Swallow fatality in release so the app doesn't exit on a stray
      // uncaught rejection. Show the user a non-blocking alert.
      try {
        // Lazy require to avoid circular import at module init.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { Alert: RNAlert } = require('react-native');
        RNAlert.alert('Something went wrong', msg);
      } catch {
        // last resort: do nothing
      }
      return;
    }
    // Dev: defer to the original (red box).
    previous?.(err, isFatal);
  });
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <SafeAreaProvider>
          <RootNav />
          <PortalHost />
        </SafeAreaProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

function RootNav() {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [onboarded, setOnboarded] = useState(false);
  const [apkUpdate, setApkUpdate] = useState<AvailableRelease | null>(null);
  const router = useRouter();
  const segments = useSegments();

  // EAS Update: silently pull a newer JS bundle on app start. We don't gate
  // the UI on this — if a new bundle arrives we just reload once. Native
  // bumps still need the GitHub APK banner below.
  useEffect(() => {
    (async () => {
      if (__DEV__) return;
      try {
        const result = await Updates.checkForUpdateAsync();
        if (result.isAvailable) {
          await Updates.fetchUpdateAsync();
          await Updates.reloadAsync();
        }
      } catch {
        // best-effort — never block the app on an update check
      }
    })();
  }, []);

  // GitHub Releases: check for newer APK. Banner appears if there is one.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const found = await checkForApkUpdate();
      if (!cancelled && found) setApkUpdate(found);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const markOnboarded = useCallback<AuthGate['markOnboarded']>(async () => {
    await SecureStore.setItemAsync(ONBOARDING_KEY, '1').catch(() => undefined);
    setOnboarded(true);
  }, []);

  const resetOnboarded = useCallback<AuthGate['resetOnboarded']>(async () => {
    await SecureStore.deleteItemAsync(ONBOARDING_KEY).catch(() => undefined);
    setOnboarded(false);
  }, []);

  const gate = useMemo<AuthGate>(
    () => ({ markOnboarded, resetOnboarded }),
    [markOnboarded, resetOnboarded],
  );

  useEffect(() => {
    (async () => {
      const [{ data }, seen] = await Promise.all([
        supabase.auth.getSession(),
        SecureStore.getItemAsync(ONBOARDING_KEY),
      ]);
      setSignedIn(!!data.session);
      setOnboarded(!!seen);
      setReady(true);
      if (data.session) {
        registerBackgroundSync().catch(() => undefined);
      }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setSignedIn(!!session);
    });
    const notifSub = Notifications.addNotificationResponseReceivedListener((resp) => {
      const route = resp.notification.request.content.data?.route;
      if (typeof route === 'string' && route.startsWith('/')) {
        router.push(route as never);
      }
    });
    return () => {
      sub.subscription.unsubscribe();
      notifSub.remove();
    };
  }, [router]);

  // Pick up audio shares from the system share sheet (Google Phone, file
  // managers, etc.) under the new architecture.
  const { hasShareIntent, shareIntent, resetShareIntent, error: shareError } =
    useShareIntent({ debug: false });

  useEffect(() => {
    if (shareError) {
      // eslint-disable-next-line no-console
      console.warn('[share] intent error', shareError);
    }
  }, [shareError]);

  const [shareUploading, setShareUploading] = useState(false);
  // expo-share-intent can re-fire the same intent on re-render. Track which
  // file paths we've already processed (or are processing) so the same audio
  // can't be uploaded 2-3 times. Also guards re-entry while an upload is in
  // flight — the effect can run again before resetShareIntent settles.
  const shareInFlightRef = useRef(false);
  const seenSharePathsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!hasShareIntent || !signedIn) return;
    if (shareInFlightRef.current) return;
    const files = shareIntent.files ?? [];
    if (files.length === 0) {
      resetShareIntent();
      return;
    }
    // Skip files we've already processed in this session.
    const unseen = files.filter((f) => {
      const key = `${f.path ?? ''}|${f.fileName ?? ''}`;
      if (seenSharePathsRef.current.has(key)) return false;
      seenSharePathsRef.current.add(key);
      return true;
    });
    if (unseen.length === 0) {
      resetShareIntent();
      return;
    }

    shareInFlightRef.current = true;
    (async () => {
      setShareUploading(true);
      let lastSuccessId: string | null = null;
      const failures: string[] = [];
      try {
        for (const f of unseen) {
          try {
            const result = await handleSharedFile(f);
            if (result.ok && result.callId) {
              lastSuccessId = result.callId;
            } else if (!result.ok) {
              failures.push(result.reason ?? 'unknown');
              // eslint-disable-next-line no-console
              console.warn('[share] skipped:', result.reason);
            }
          } catch (e) {
            const msg = (e as Error)?.message ?? String(e);
            failures.push(msg);
            // eslint-disable-next-line no-console
            console.warn('[share] failed', e);
          }
        }
      } finally {
        setShareUploading(false);
        resetShareIntent();
        shareInFlightRef.current = false;
      }
      if (lastSuccessId) {
        router.push(`/call/${lastSuccessId}` as never);
      } else if (failures.length > 0) {
        Alert.alert('Share failed', failures.join('\n\n'));
      }
    })();
  }, [hasShareIntent, shareIntent, signedIn, resetShareIntent, router]);

  useEffect(() => {
    if (!ready) return;
    const root = segments[0] as string | undefined;
    const inOnboarding = root === '(onboarding)';
    const inAuth = root === '(auth)';

    if (!onboarded) {
      if (!inOnboarding) router.replace('/(onboarding)' as never);
      return;
    }
    if (!signedIn) {
      if (!inAuth) router.replace('/(auth)/login');
      return;
    }
    if (inOnboarding || inAuth) {
      router.replace('/(tabs)');
    }
  }, [ready, signedIn, onboarded, segments, router]);

  if (!ready) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <AuthGateContext.Provider value={gate}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(onboarding)" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="call/[id]"
          options={{ headerShown: true, title: 'Call' }}
        />
        <Stack.Screen
          name="plan"
          options={{ headerShown: true, title: 'Plan & usage' }}
        />
      </Stack>
      {apkUpdate ? (
        <Pressable
          onPress={() => {
            Linking.openURL(apkUpdate.apkUrl).catch(() => {
              Linking.openURL(apkUpdate.htmlUrl).catch(() => undefined);
            });
          }}
          onLongPress={() => setApkUpdate(null)}
          style={{
            position: 'absolute',
            left: 12,
            right: 12,
            bottom: 76,
            backgroundColor: '#C8E841',
            paddingHorizontal: 16,
            paddingVertical: 12,
            borderRadius: 12,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#0f172a', fontWeight: '600', fontSize: 14 }}>
              Update available: {apkUpdate.tag}
            </Text>
            <Text style={{ color: '#0f172a', fontSize: 12, marginTop: 2 }}>
              Tap to download · long-press to dismiss
            </Text>
          </View>
          <Text style={{ color: '#0f172a', fontSize: 18 }}>↓</Text>
        </Pressable>
      ) : null}
      {shareUploading ? (
        <View
          pointerEvents="auto"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View
            style={{
              backgroundColor: 'white',
              paddingHorizontal: 28,
              paddingVertical: 24,
              borderRadius: 12,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 14,
            }}
          >
            <ActivityIndicator />
            <Text style={{ color: '#0f172a', fontSize: 15, fontWeight: '500' }}>
              Uploading shared recording…
            </Text>
          </View>
        </View>
      ) : null}
    </AuthGateContext.Provider>
  );
}
