import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../src/supabase/client';

export default function Login() {
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [stage, setStage] = useState<'email' | 'otp'>('email');
  const [busy, setBusy] = useState(false);

  async function sendOtp() {
    if (!email.trim()) return;
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true },
    });
    setBusy(false);
    if (error) Alert.alert('Sign-in error', error.message);
    else setStage('otp');
  }

  async function verifyOtp() {
    setBusy(true);
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: otp.trim(),
      type: 'email',
    });
    setBusy(false);
    if (error) Alert.alert('Verification failed', error.message);
  }

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.body}
      >
        <Text style={styles.title}>Calling</Text>
        <Text style={styles.subtitle}>Sign in with a one-time code</Text>

        {stage === 'email' ? (
          <>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              style={styles.input}
            />
            <Pressable
              onPress={sendOtp}
              disabled={busy}
              style={[styles.button, busy && styles.disabled]}
            >
              <Text style={styles.buttonText}>Send code</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.hint}>Code sent to {email}</Text>
            <TextInput
              value={otp}
              onChangeText={setOtp}
              placeholder="6-digit code"
              keyboardType="number-pad"
              style={styles.input}
            />
            <Pressable
              onPress={verifyOtp}
              disabled={busy}
              style={[styles.button, busy && styles.disabled]}
            >
              <Text style={styles.buttonText}>Verify</Text>
            </Pressable>
            <Pressable onPress={() => setStage('email')}>
              <Text style={styles.link}>Use a different email</Text>
            </Pressable>
          </>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1117' },
  body: { flex: 1, padding: 24, justifyContent: 'center' },
  title: { color: '#fff', fontSize: 32, fontWeight: '700', marginBottom: 4 },
  subtitle: { color: '#8b949e', marginBottom: 24 },
  hint: { color: '#8b949e', marginBottom: 8 },
  input: {
    backgroundColor: '#161b22',
    color: '#fff',
    padding: 14,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#30363d',
  },
  button: {
    backgroundColor: '#1f6feb',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  disabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: '600' },
  link: { color: '#1f6feb', marginTop: 16, textAlign: 'center' },
});
