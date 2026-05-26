import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { supabase } from '../src/supabase/client';
import { registerShareIntentListener } from '../src/shareIntent/handler';
import { registerBackgroundSync } from '../src/sync/worker';

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    let unsubShare: (() => void) | undefined;
    (async () => {
      const { data } = await supabase.auth.getSession();
      setSignedIn(!!data.session);
      setReady(true);
      if (data.session) {
        unsubShare = registerShareIntentListener();
        registerBackgroundSync().catch(() => undefined);
      }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setSignedIn(!!session);
    });
    return () => {
      sub.subscription.unsubscribe();
      unsubShare?.();
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const inAuth = segments[0] === '(auth)';
    if (!signedIn && !inAuth) router.replace('/(auth)/login');
    else if (signedIn && inAuth) router.replace('/(tabs)');
  }, [ready, signedIn, segments, router]);

  if (!ready) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="call/[id]" options={{ headerShown: true, title: 'Call' }} />
      </Stack>
    </SafeAreaProvider>
  );
}
