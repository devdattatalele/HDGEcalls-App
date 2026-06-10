import * as Contacts from 'expo-contacts';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Muted, Text } from './ui/text';

export interface PickedContact {
  name: string;
  phone: string | null;
}

type ContactsMap = { id: string; name: string; phone: string | null }[];

export function ContactPicker({
  visible,
  onPick,
  onClose,
}: {
  visible: boolean;
  onPick: (c: PickedContact) => void;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contacts, setContacts] = useState<ContactsMap>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const perm = await Contacts.requestPermissionsAsync();
        if (perm.status !== 'granted') {
          if (!cancelled) setError('Contacts permission denied.');
          return;
        }
        const { data } = await Contacts.getContactsAsync({
          fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
          pageSize: 5000,
        });
        if (cancelled) return;
        const flat: ContactsMap = [];
        for (const c of data) {
          const name = (c.name ?? '').trim();
          const phones = c.phoneNumbers ?? [];
          if (!name && phones.length === 0) continue;
          if (phones.length === 0) {
            flat.push({ id: c.id ?? name, name: name || '(no name)', phone: null });
            continue;
          }
          for (const p of phones) {
            flat.push({
              id: `${c.id ?? name}-${p.id ?? p.number ?? ''}`,
              name: name || p.number || '(no name)',
              phone: p.number ?? null,
            });
          }
        }
        flat.sort((a, b) => a.name.localeCompare(b.name));
        setContacts(flat);
      } catch (e) {
        if (!cancelled) setError(String((e as Error)?.message ?? e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) => {
      if (c.name.toLowerCase().includes(q)) return true;
      if (c.phone && c.phone.replace(/\D/g, '').includes(q.replace(/\D/g, ''))) {
        return true;
      }
      return false;
    });
  }, [contacts, query]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView className="flex-1 bg-background">
        <View className="flex-row items-center justify-between px-4 py-3 border-b border-border">
          <Text className="text-foreground text-lg font-semibold">
            Select contact
          </Text>
          <Pressable onPress={onClose} className="px-2 py-1 active:opacity-70">
            <Text className="text-muted-foreground">Close</Text>
          </Pressable>
        </View>

        <View className="px-4 py-2">
          <Input
            placeholder="Search name or number"
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
          />
        </View>

        {loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator />
          </View>
        ) : error ? (
          <View className="flex-1 items-center justify-center px-6 gap-3">
            <Muted className="text-center">{error}</Muted>
            <Button variant="outline" onPress={onClose}>
              Close
            </Button>
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(c) => c.id}
            ItemSeparatorComponent={() => (
              <View className="h-px bg-border" />
            )}
            ListEmptyComponent={
              <View className="px-6 py-12 items-center">
                <Muted>No matches.</Muted>
              </View>
            }
            renderItem={({ item }) => (
              <Pressable
                onPress={() => {
                  onPick({ name: item.name, phone: item.phone });
                  onClose();
                }}
                className="px-4 py-3 active:bg-muted/50"
              >
                <Text className="text-foreground">{item.name}</Text>
                {item.phone ? (
                  <Muted className="text-xs">{item.phone}</Muted>
                ) : null}
              </Pressable>
            )}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}
