import { useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  View,
  type PressableStateCallbackType,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Muted, Text } from '../../src/components/ui/text';
import { recordAppDial } from '../../src/sync/appDials';

const KEYS: { label: string; sub?: string; value: string }[] = [
  { label: '1', value: '1' },
  { label: '2', sub: 'ABC', value: '2' },
  { label: '3', sub: 'DEF', value: '3' },
  { label: '4', sub: 'GHI', value: '4' },
  { label: '5', sub: 'JKL', value: '5' },
  { label: '6', sub: 'MNO', value: '6' },
  { label: '7', sub: 'PQRS', value: '7' },
  { label: '8', sub: 'TUV', value: '8' },
  { label: '9', sub: 'WXYZ', value: '9' },
  { label: '*', value: '*' },
  { label: '0', sub: '+', value: '0' },
  { label: '#', value: '#' },
];

export default function Dialer() {
  const [number, setNumber] = useState('');

  function press(v: string) {
    setNumber((cur) => (cur + v).slice(0, 32));
  }

  function backspace() {
    setNumber((cur) => cur.slice(0, -1));
  }

  function clear() {
    setNumber('');
  }

  function longPressZero() {
    setNumber((cur) => {
      if (cur.endsWith('0')) return cur.slice(0, -1) + '+';
      return cur + '+';
    });
  }

  async function startCall() {
    // Defensive top-level try so a single tap can never close the app.
    try {
      const trimmed = number.trim();
      if (!trimmed) {
        Alert.alert('No number', 'Type a number first.');
        return;
      }

      // Mark this dial as "app-initiated" before handing off. The sync
      // worker only uploads calls that match an entry here.
      try {
        await recordAppDial(trimmed);
      } catch {
        // never block dialing on a storage failure
      }

      // Skip Linking.canOpenURL — on Android 11+ it returns false unless we
      // explicitly declare a <queries> entry for `tel:` in the manifest. The
      // phone dialer is always available on a real Android device.
      //
      // Don't encodeURIComponent the number: that turns "+" into "%2B" which
      // some OEM dialers (notably older ColorOS / FunTouch) refuse to parse.
      // The `tel:` scheme natively accepts digits and "+", so just pass it.
      const sanitized = trimmed.replace(/\s+/g, '');
      const url = `tel:${sanitized}`;
      await Linking.openURL(url);
    } catch (e) {
      Alert.alert('Dial failed', String((e as Error)?.message ?? e));
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['bottom']}>
      <View className="flex-1 px-6 pt-6 pb-4 justify-end gap-4">
        <View className="items-center min-h-[64px] justify-center">
          {number ? (
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              className="text-foreground text-4xl font-semibold tracking-wider"
            >
              {formatDisplay(number)}
            </Text>
          ) : (
            <Muted className="text-base">Enter a number to call</Muted>
          )}
        </View>

        <View className="flex-row flex-wrap justify-center">
          {KEYS.map((k) => (
            <Key
              key={k.value}
              label={k.label}
              sub={k.sub}
              onPress={() => press(k.value)}
              onLongPress={k.value === '0' ? longPressZero : undefined}
            />
          ))}
        </View>

        <View className="flex-row items-center justify-center gap-8 mt-2">
          <RoundIcon onLongPress={clear} onPress={backspace} label="⌫" muted />
          <CallButton onPress={startCall} />
          <View className="w-14 h-14" />
        </View>
      </View>
    </SafeAreaView>
  );
}

function Key({
  label,
  sub,
  onPress,
  onLongPress,
}: {
  label: string;
  sub?: string;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      className="w-1/3 items-center py-3"
    >
      {({ pressed }: PressableStateCallbackType) => (
        <View
          className={`h-16 w-16 items-center justify-center rounded-full ${
            pressed ? 'bg-muted' : 'bg-card'
          }`}
        >
          <Text className="text-foreground text-3xl font-semibold leading-8">
            {label}
          </Text>
          {sub ? (
            <Text className="text-muted-foreground text-[10px] tracking-wider">
              {sub}
            </Text>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

function CallButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="active:opacity-80">
      <View className="h-16 w-16 items-center justify-center rounded-full bg-emerald-500">
        <Text className="text-white text-2xl">📞</Text>
      </View>
    </Pressable>
  );
}

function RoundIcon({
  label,
  onPress,
  onLongPress,
  muted,
}: {
  label: string;
  onPress: () => void;
  onLongPress?: () => void;
  muted?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      className="active:opacity-70"
    >
      <View
        className={`h-14 w-14 items-center justify-center rounded-full ${
          muted ? 'bg-muted' : 'bg-card'
        }`}
      >
        <Text className="text-foreground text-xl">{label}</Text>
      </View>
    </Pressable>
  );
}

function formatDisplay(n: string): string {
  if (!n) return n;

  const hasPlus = n.startsWith('+');
  const digits = n.replace(/\D/g, '');

  // +91 prefix, India: "+91 98765 43210" (with overflow if user keeps typing)
  if (hasPlus && digits.startsWith('91') && digits.length >= 12) {
    const body = digits.slice(2);
    const head = body.slice(0, 5);
    const mid = body.slice(5, 10);
    const tail = body.length > 10 ? ` ${body.slice(10)}` : '';
    return `+91 ${head} ${mid}${tail}`;
  }

  // Bare 10-digit Indian mobile (starts 6/7/8/9): "98765 43210"
  if (!hasPlus && digits.length === 10 && /^[6-9]/.test(digits)) {
    return `${digits.slice(0, 5)} ${digits.slice(5)}`;
  }

  // Other +-prefixed international: don't pretend to know the format.
  if (hasPlus) return n;

  // Fallback: previous 3+3+4 grouping for non-Indian shapes.
  if (n.length <= 4) return n;
  if (n.length <= 7) return `${n.slice(0, 3)} ${n.slice(3)}`;
  if (n.length <= 10) return `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
  return `${n.slice(0, n.length - 10)} ${n.slice(-10, -7)} ${n.slice(-7, -4)} ${n.slice(-4)}`;
}
