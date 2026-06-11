import * as Application from 'expo-application';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Image, Linking, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  clearCachedMe,
  fetchMe,
  loadCachedMe,
  type MeResponse,
} from '../../src/api/client';
import { Avatar } from '../../src/components/ui/avatar';
import { Badge } from '../../src/components/ui/badge';
import { Button } from '../../src/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../src/components/ui/card';
import { Segmented } from '../../src/components/ui/segmented';
import { Separator } from '../../src/components/ui/separator';
import { Switch } from '../../src/components/ui/switch';
import { Muted, Text } from '../../src/components/ui/text';
import { useAuthGate } from '../../src/context/AuthGate';
import {
  fetchMonthlyMinutes,
  fetchUsage,
  type MonthlyMinutes,
  type ProfileUsage,
} from '../../src/data/profile';
import { requestAllPermissions, type PermissionState } from '../../src/permissions';
import { supabase } from '../../src/supabase/client';
import { useTheme, type ThemeMode } from '../../src/theme/ThemeProvider';
import {
  registerBackgroundSync,
  runSyncOnce,
  unregisterBackgroundSync,
} from '../../src/sync/worker';

const PLAN_LABEL: Record<string, string> = {
  free: 'Free',
  starter: 'Starter',
  pro: 'Pro',
  business: 'Business',
};

export default function Settings() {
  const router = useRouter();
  const { resetOnboarded } = useAuthGate();
  const { mode, setMode } = useTheme();
  const [perms, setPerms] = useState<PermissionState | null>(null);
  const [autoSync, setAutoSync] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [usage, setUsage] = useState<ProfileUsage | null>(null);
  const [minutes, setMinutes] = useState<MonthlyMinutes | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const { data } = await supabase.auth.getUser();
    const user = data.user;
    setEmail(user?.email ?? null);
    if (!user) return;

    const cached = await loadCachedMe();
    if (cached) setMe(cached);

    const [meRes, usageRes, minRes] = await Promise.allSettled([
      fetchMe(),
      fetchUsage(user.id),
      fetchMonthlyMinutes(user.id),
    ]);
    if (meRes.status === 'fulfilled') setMe(meRes.value);
    if (usageRes.status === 'fulfilled') setUsage(usageRes.value);
    if (minRes.status === 'fulfilled') setMinutes(minRes.value);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  async function onGrantPermissions() {
    setPerms(await requestAllPermissions());
  }

  async function onToggleAutoSync(next: boolean) {
    setAutoSync(next);
    if (next) await registerBackgroundSync();
    else await unregisterBackgroundSync();
  }

  async function onSyncNow() {
    setBusy(true);
    const result = await runSyncOnce().catch((e) => {
      Alert.alert('Sync failed', String((e as Error)?.message ?? e));
      return null;
    });
    setBusy(false);
    if (result) {
      Alert.alert(
        'Sync complete',
        `New recordings synced: ${result.inserted}\nErrors: ${result.errors}`,
      );
      reload();
    }
  }

  async function onSignOut() {
    await unregisterBackgroundSync();
    await clearCachedMe();
    await supabase.auth.signOut();
  }

  async function onReplayTour() {
    await resetOnboarded();
    router.replace('/(onboarding)' as never);
  }

  const company = me?.company ?? null;
  const userLabel = me?.user?.label?.trim() || email || 'HDGEcalls user';
  const planLabel = PLAN_LABEL[company?.plan ?? 'free'];
  const recMin = minutes?.recording_minutes ?? 0;
  const usageSubtitle =
    minutes == null
      ? planLabel
      : `${planLabel} · ${recMin < 1 ? Math.round(recMin * 60) + 's' : recMin.toFixed(1) + ' min'} recorded this month`;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['bottom']}>
      <ScrollView contentContainerClassName="p-4 gap-4 pb-8">
        {/* Company header */}
        <Card>
          <CardContent className="gap-3 pt-6">
            <View className="flex-row items-center gap-3">
              {company?.logo_url ? (
                <Image
                  source={{ uri: company.logo_url }}
                  style={{ width: 48, height: 48, borderRadius: 12 }}
                />
              ) : (
                <View className="h-12 w-12 items-center justify-center rounded-xl bg-brand">
                  <Text className="text-brand-foreground text-lg font-bold">
                    {(company?.name ?? 'H').slice(0, 1).toUpperCase()}
                  </Text>
                </View>
              )}
              <View className="flex-1">
                <Text className="font-semibold" numberOfLines={1}>
                  {company?.name ?? 'Your company'}
                </Text>
                <Muted className="text-xs">
                  {company ? 'Signed in to this workspace' : 'Loading workspace…'}
                </Muted>
              </View>
              {company ? (
                <Badge className="bg-brand">
                  <Text className="text-brand-foreground text-xs font-semibold">
                    {planLabel}
                  </Text>
                </Badge>
              ) : null}
            </View>

            <Separator />

            <View className="flex-row items-center gap-3">
              <Avatar name={userLabel} />
              <View className="flex-1">
                <Text className="font-medium" numberOfLines={1}>
                  {userLabel}
                </Text>
                <Muted numberOfLines={1}>{email ?? '—'}</Muted>
              </View>
            </View>
          </CardContent>
        </Card>

        {/* Plan & usage link */}
        <Card>
          <CardContent className="p-0">
            <LinkRow
              title="Plan & usage"
              subtitle={usageSubtitle}
              onPress={() => router.push('/plan' as never)}
            />
            <Separator />
            <LinkRow
              title="Sync Health"
              subtitle="Permissions, counters, and support log"
              onPress={() => router.push('/sync-health' as never)}
            />
          </CardContent>
        </Card>

        {/* Sync */}
        <Card>
          <CardHeader>
            <CardTitle>Sync</CardTitle>
            <CardDescription>
              Background sync every ~15 min. Pull-to-refresh on Calls also syncs.
            </CardDescription>
          </CardHeader>
          <CardContent className="gap-3">
            <Row>
              <Text>Auto-sync (background)</Text>
              <Switch checked={autoSync} onCheckedChange={onToggleAutoSync} />
            </Row>
            <Button onPress={onSyncNow} loading={busy}>
              Sync now
            </Button>
            <Muted>
              For background sync to survive Doze, also disable Battery
              optimization for HDGEcalls in system Settings.
            </Muted>
          </CardContent>
        </Card>

        {/* OEM compatibility — Oppo / Vivo / Xiaomi need extra toggles */}
        <Card>
          <CardHeader>
            <CardTitle>Background reliability</CardTitle>
            <CardDescription>
              On Oppo, Vivo, Xiaomi, Realme and similar phones, the OS hides
              call recordings from non-system apps and aggressively kills
              background apps. Both toggles below are required for sync to
              work on those phones.
            </CardDescription>
          </CardHeader>
          <CardContent className="gap-3">
            <View className="gap-1.5">
              <Text className="font-medium">1. All files access</Text>
              <Muted className="text-xs">
                Required to read MIUI / ColorOS / FunTouch call recording
                folders. Find HDGEcalls in the list and toggle "Allow
                management of all files".
              </Muted>
              <Button
                variant="outline"
                onPress={() => {
                  try {
                    Linking.sendIntent(
                      'android.settings.MANAGE_ALL_FILES_ACCESS_PERMISSION',
                    );
                  } catch {
                    Linking.openSettings();
                  }
                }}
              >
                Grant all files access
              </Button>
            </View>
            <View className="gap-1.5">
              <Text className="font-medium">2. Battery + autostart</Text>
              <Muted className="text-xs">
                Battery → "No restrictions" / "Unrestricted". On Oppo/Vivo/Xiaomi
                also: Autostart → enable.
              </Muted>
              <Button variant="outline" onPress={() => Linking.openSettings()}>
                Open HDGEcalls system settings
              </Button>
            </View>
          </CardContent>
        </Card>

        {/* Appearance */}
        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
            <CardDescription>Theme follows your selection.</CardDescription>
          </CardHeader>
          <CardContent>
            <Segmented<ThemeMode>
              value={mode}
              onChange={setMode}
              options={[
                { value: 'system', label: 'System' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
            />
          </CardContent>
        </Card>

        {/* Permissions */}
        <Card>
          <CardHeader>
            <CardTitle>Permissions</CardTitle>
            <CardDescription>
              All required for syncing call recordings.
            </CardDescription>
          </CardHeader>
          <CardContent className="gap-2">
            <PermRow label="Call log" granted={perms?.callLog} />
            <Separator />
            <PermRow label="Storage / Audio" granted={perms?.mediaAudio} />
            <Separator />
            <PermRow label="Contacts" granted={perms?.contacts} />
            <Separator />
            <PermRow label="Notifications" granted={perms?.notifications} />
            <Button variant="outline" onPress={onGrantPermissions} className="mt-2">
              Request permissions
            </Button>
          </CardContent>
        </Card>

        {/* About */}
        <Card>
          <CardHeader>
            <CardTitle>About HDGEcalls</CardTitle>
            <CardDescription>
              Built by HDGElabs · version {Application.nativeApplicationVersion ?? '0.2.0'}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <LinkRow title="Replay the app tour" onPress={onReplayTour} />
            <Separator />
            <LinkRow
              title="Support"
              subtitle="Open HDGElabs in your browser"
              onPress={() => Linking.openURL('https://calls.hdgelabs.com/support')}
            />
          </CardContent>
        </Card>

        <Button variant="outline" onPress={onSignOut}>
          Sign out
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <View className="flex-row items-center justify-between">{children}</View>
  );
}

function LinkRow({
  title,
  subtitle,
  onPress,
}: {
  title: string;
  subtitle?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center justify-between px-5 py-4 active:bg-muted"
    >
      <View className="flex-1 pr-3">
        <Text className="font-medium">{title}</Text>
        {subtitle ? (
          <Muted numberOfLines={1} className="mt-0.5">
            {subtitle}
          </Muted>
        ) : null}
      </View>
      <Text className="text-muted-foreground text-lg">›</Text>
    </Pressable>
  );
}

function PermRow({ label, granted }: { label: string; granted: boolean | undefined }) {
  let state: string;
  let cls: string;
  if (granted === undefined) {
    state = '—';
    cls = 'text-muted-foreground';
  } else if (granted) {
    state = 'granted';
    cls = 'text-emerald-600 dark:text-emerald-400';
  } else {
    state = 'denied';
    cls = 'text-red-600 dark:text-red-400';
  }
  return (
    <View className="flex-row items-center justify-between py-1">
      <Text>{label}</Text>
      <Text className={cls}>{state}</Text>
    </View>
  );
}
