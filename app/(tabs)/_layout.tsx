import { Tabs } from 'expo-router';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#1f6feb',
        headerStyle: { backgroundColor: '#0d1117' },
        headerTintColor: '#fff',
        tabBarStyle: { backgroundColor: '#0d1117', borderTopColor: '#30363d' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Calls' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}
