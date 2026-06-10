import { Feather } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useTheme } from '../../src/theme/ThemeProvider';

function TabIcon({ icon, color }: { icon: string; color: string }) {
  return <Text style={{ fontSize: 20, color }}>{icon}</Text>;
}

function TabFeatherIcon({
  name,
  color,
}: {
  name: React.ComponentProps<typeof Feather>['name'];
  color: string;
}) {
  return <Feather name={name} size={22} color={color} />;
}

export default function TabsLayout() {
  const { resolved } = useTheme();
  const dark = resolved === 'dark';
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: dark ? '#C8E841' : '#5d7a1f',
        tabBarInactiveTintColor: dark ? '#94a3b8' : '#64748b',
        headerStyle: { backgroundColor: dark ? 'hsl(222, 47%, 6%)' : '#ffffff' },
        headerTintColor: dark ? '#f8fafc' : '#0f172a',
        tabBarStyle: {
          backgroundColor: dark ? 'hsl(222, 47%, 6%)' : '#ffffff',
          borderTopColor: dark ? 'hsl(217, 33%, 20%)' : 'hsl(214, 32%, 91%)',
        },
      }}
    >
      <Tabs.Screen
        name="dialer"
        options={{
          title: 'Dialer',
          tabBarIcon: ({ color }) => <TabIcon icon="⌨" color={color} />,
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: 'Calls',
          tabBarIcon: ({ color }) => <TabFeatherIcon name="phone" color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <TabIcon icon="⚙" color={color} />,
        }}
      />
    </Tabs>
  );
}
