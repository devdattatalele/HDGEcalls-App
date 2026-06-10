import * as SecureStore from 'expo-secure-store';
import { useColorScheme } from 'nativewind';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';

type Ctx = {
  mode: ThemeMode;
  resolved: 'light' | 'dark';
  setMode: (m: ThemeMode) => void;
};

const ThemeCtx = createContext<Ctx | null>(null);
const STORAGE_KEY = 'hdgecalls.theme.mode';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { colorScheme, setColorScheme } = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [ready, setReady] = useState(false);

  // Hydrate persisted mode on first mount.
  useEffect(() => {
    (async () => {
      try {
        const saved = await SecureStore.getItemAsync(STORAGE_KEY);
        if (saved === 'light' || saved === 'dark' || saved === 'system') {
          setModeState(saved);
          setColorScheme(saved);
        }
      } catch {
        // ignore — fall through with 'system'
      } finally {
        setReady(true);
      }
    })();
  }, [setColorScheme]);

  const setMode = useCallback(
    (m: ThemeMode) => {
      setModeState(m);
      setColorScheme(m);
      SecureStore.setItemAsync(STORAGE_KEY, m).catch(() => undefined);
    },
    [setColorScheme],
  );

  const value = useMemo<Ctx>(
    () => ({
      mode,
      resolved: colorScheme === 'dark' ? 'dark' : 'light',
      setMode,
    }),
    [mode, colorScheme, setMode],
  );

  // Avoid a flash by not rendering until the persisted mode is loaded.
  if (!ready) return null;
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): Ctx {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
