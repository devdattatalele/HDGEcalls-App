import { useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Platform, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../src/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../src/components/ui/card';
import { Input } from '../../src/components/ui/input';
import { H1, Muted } from '../../src/components/ui/text';
import { supabase } from '../../src/supabase/client';

const INVALID_PATTERNS = [
  /invalid login credentials/i,
  /invalid credentials/i,
  /user.*banned/i,
  /user not found/i,
];

function friendly(message: string): { title: string; body: string } {
  if (INVALID_PATTERNS.some((r) => r.test(message))) {
    return {
      title: "Can't sign in",
      body:
        "Either your password is wrong, or your admin has revoked access. " +
        'Contact your team admin to verify your credentials.',
    };
  }
  return { title: 'Sign in failed', body: message };
}

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    const e = email.trim().toLowerCase();
    if (!e || !password) {
      Alert.alert('Missing', 'Enter your email and password.');
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: e,
        password,
      });
      if (error) throw error;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const f = friendly(msg);
      Alert.alert(f.title, f.body);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 justify-center px-6"
      >
        <View className="mb-8 items-center">
          <Image
            source={require('../../assets/logo.png')}
            style={{ width: 88, height: 88, borderRadius: 20 }}
            resizeMode="contain"
          />
          <H1 className="mt-4">HDGEcalls</H1>
          <Muted className="mt-1">by HDGElabs</Muted>
        </View>

        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>
              Use the email and password your team admin gave you.
            </CardDescription>
          </CardHeader>
          <CardContent className="gap-3">
            <Input
              placeholder="you@yourcompany.com"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="username"
            />
            <Input
              placeholder="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType="password"
            />
            <Button onPress={submit} loading={busy} className="mt-2">
              Sign in
            </Button>
          </CardContent>
        </Card>

        <View className="mt-8 items-center">
          <Muted className="text-center text-xs leading-5">
            HDGEcalls accounts are created by your company admin on the{'\n'}
            HDGElabs dashboard. There is no in-app signup.
          </Muted>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
