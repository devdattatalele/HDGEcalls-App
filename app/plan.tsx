import { useEffect, useState } from 'react';
import { Alert, Linking, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetchMe, loadCachedMe, type CompanyBrand } from '../src/api/client';
import { Badge } from '../src/components/ui/badge';
import { Button } from '../src/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../src/components/ui/card';
import { Muted, Text } from '../src/components/ui/text';
import {
  fetchMonthlyMinutes,
  fetchUsage,
  type MonthlyMinutes,
  type ProfileUsage,
} from '../src/data/profile';
import { supabase } from '../src/supabase/client';

const BILLING_URL = 'https://calls.hdgelabs.com/settings/billing';

const PLAN_LABEL: Record<string, string> = {
  free: 'Free',
  starter: 'Starter',
  pro: 'Pro',
  business: 'Business',
};

export default function PlanScreen() {
  const [company, setCompany] = useState<CompanyBrand | null>(null);
  const [usage, setUsage] = useState<ProfileUsage | null>(null);
  const [minutes, setMinutes] = useState<MonthlyMinutes | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const cached = await loadCachedMe();
        if (cached?.company) setCompany(cached.company);

        const { data: sess } = await supabase.auth.getUser();
        const uid = sess.user?.id ?? null;

        const [meRes, usageRes, minRes] = await Promise.allSettled([
          fetchMe(),
          uid ? fetchUsage(uid) : Promise.resolve(null),
          uid ? fetchMonthlyMinutes(uid) : Promise.resolve(null),
        ]);
        if (meRes.status === 'fulfilled') setCompany(meRes.value.company);
        if (usageRes.status === 'fulfilled') setUsage(usageRes.value);
        if (minRes.status === 'fulfilled') setMinutes(minRes.value);
      } catch (e) {
        Alert.alert('Could not load plan', String((e as Error)?.message ?? e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function openBilling() {
    Linking.openURL(BILLING_URL).catch(() =>
      Alert.alert('Cannot open browser', 'Visit ' + BILLING_URL + ' from a desktop.'),
    );
  }

  const recMin = minutes?.recording_minutes ?? 0;
  const txMin = minutes?.transcription_minutes ?? 0;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['bottom']}>
      <ScrollView contentContainerClassName="p-4 gap-4">
        <Card>
          <CardHeader>
            <View className="flex-row items-center justify-between">
              <CardTitle>{company?.name ?? 'Your company'}</CardTitle>
              <Badge className="bg-brand">
                <Text className="text-brand-foreground text-xs font-semibold">
                  {PLAN_LABEL[company?.plan ?? 'free']}
                </Text>
              </Badge>
            </View>
            <CardDescription>
              Plan and limits are managed by your company admin on the HDGElabs
              dashboard. Changes apply within a minute.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onPress={openBilling}>
              Open dashboard
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>This month</CardTitle>
            <CardDescription>
              Counters reset on the 1st of each calendar month.
            </CardDescription>
          </CardHeader>
          <CardContent className="gap-5">
            <UsageRow
              label="Recording minutes"
              value={recMin}
              loading={loading}
            />
            <UsageRow
              label="Transcription minutes"
              value={txMin}
              loading={loading}
            />
            <Muted className="text-xs">
              Limits are tracked on the company billing dashboard. Open the
              dashboard above to see your plan cap.
            </Muted>
          </CardContent>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

function formatMinutes(min: number): string {
  if (min < 1) return `${Math.round(min * 60)}s`;
  if (min < 60) return `${min.toFixed(1)} min`;
  const hrs = Math.floor(min / 60);
  const rem = Math.round(min % 60);
  return `${hrs}h ${rem}m`;
}

function UsageRow({
  label,
  value,
  loading,
}: {
  label: string;
  value: number;
  loading: boolean;
}) {
  return (
    <View className="flex-row items-center justify-between">
      <Text className="font-medium">{label}</Text>
      <Text className="text-foreground font-semibold">
        {loading ? '…' : formatMinutes(value)}
      </Text>
    </View>
  );
}
