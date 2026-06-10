import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../src/components/ui/button';
import {
  Bullet,
  Dot,
  OnboardingSlide,
} from '../../src/components/ui/onboarding-slide';
import { Muted, Text } from '../../src/components/ui/text';
import { useAuthGate } from '../../src/context/AuthGate';
import { requestAllPermissions } from '../../src/permissions';

export default function Onboarding() {
  const router = useRouter();
  const { markOnboarded } = useAuthGate();
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList>(null);

  const slides = [
    { key: 'welcome' },
    { key: 'how' },
    { key: 'permissions' },
    { key: 'privacy' },
  ] as const;

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i !== index) setIndex(i);
  }

  function goNext() {
    if (index < slides.length - 1) {
      listRef.current?.scrollToIndex({ index: index + 1, animated: true });
    } else {
      finish();
    }
  }

  async function finish() {
    try {
      await requestAllPermissions();
    } catch {
      // user can re-request from Settings; don't block onboarding completion
    }
    await markOnboarded();
    router.replace('/(auth)/login' as never);
  }

  async function skip() {
    await markOnboarded();
    router.replace('/(auth)/login' as never);
  }

  function renderSlide({ item }: { item: (typeof slides)[number] }) {
    switch (item.key) {
      case 'welcome':
        return (
          <OnboardingSlide
            title="HDGEcalls"
            body="by HDGElabs — your business calls, auto-synced to your team's cloud."
            icon={
              <Image
                source={require('../../assets/logo.png')}
                style={{ width: 140, height: 140, borderRadius: 28 }}
                resizeMode="contain"
              />
            }
          />
        );
      case 'how':
        return (
          <OnboardingSlide
            title="How it works"
            body="HDGEcalls is set up by your company admin — you just sign in and let it run."
          >
            <View className="gap-4 mt-4">
              <Step n="1" title="Your admin invited you">
                They created your account on the HDGElabs dashboard and shared
                your email + password.
              </Step>
              <Step n="2" title="Sign in once, on your phone">
                After sign-in, every new call recording your phone saves is
                uploaded automatically.
              </Step>
              <Step n="3" title="Your team sees them on the web">
                Recordings, transcripts, and analytics show up live on the
                HDGElabs dashboard.
              </Step>
            </View>
          </OnboardingSlide>
        );
      case 'permissions':
        return (
          <OnboardingSlide
            title="Permissions we'll ask for"
            body="HDGEcalls is useless without these. Plain-English why for each:"
          >
            <View className="gap-3 mt-2">
              <Bullet text="Call log — to know who you called and when." />
              <Bullet text="Storage / Audio — to read the recordings your phone saves." />
              <Bullet text="Contacts — to show caller names instead of numbers." />
              <Bullet text="Notifications — so we can tell you when sync runs." />
              <Bullet text="Battery exemption — so background sync survives Doze." />
            </View>
          </OnboardingSlide>
        );
      case 'privacy':
        return (
          <OnboardingSlide
            title="Recordings stay in your company"
            body="Audio is uploaded to your company's private DB. Only people your admin has invited can see it."
            icon={
              <View className="h-24 w-24 items-center justify-center rounded-full bg-brand">
                <Feather name="lock" size={40} color="#0f172a" />
              </View>
            }
          />
        );
    }
  }

  const isLast = index === slides.length - 1;

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-row justify-end px-6 pt-2">
        {!isLast ? (
          <Pressable onPress={skip} className="px-3 py-2">
            <Muted>Skip</Muted>
          </Pressable>
        ) : (
          <View className="h-10" />
        )}
      </View>

      <FlatList
        ref={listRef}
        data={slides}
        renderItem={renderSlide}
        keyExtractor={(item) => item.key}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        bounces={false}
      />

      <View className="px-6 pb-6 gap-5">
        <View className="flex-row justify-center gap-2">
          {slides.map((s, i) => (
            <Dot key={s.key} filled={i === index} />
          ))}
        </View>
        <Button
          className="bg-brand active:opacity-80"
          onPress={goNext}
        >
          <Text className="text-brand-foreground text-base font-semibold">
            {isLast ? 'Sign in' : 'Next'}
          </Text>
        </Button>
      </View>
    </SafeAreaView>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View className="flex-row gap-3">
      <View className="h-9 w-9 items-center justify-center rounded-full bg-brand">
        <Text className="text-brand-foreground font-bold">{n}</Text>
      </View>
      <View className="flex-1">
        <Text className="font-semibold">{title}</Text>
        <Muted className="mt-0.5 leading-5">{children}</Muted>
      </View>
    </View>
  );
}
