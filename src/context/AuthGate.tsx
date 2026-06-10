import * as SecureStore from 'expo-secure-store';
import { createContext, useContext } from 'react';

export const ONBOARDING_KEY = 'hdgecalls.onboarding.done';

export type AuthGate = {
  /**
   * Inform the root navigator that the user has finished (or skipped) the
   * onboarding tour. The navigator owns the SecureStore write so its local
   * state stays in sync — call this instead of writing the flag directly.
   */
  markOnboarded: () => Promise<void>;
  /**
   * Drop the onboarding flag so the user is sent back to the tour.
   */
  resetOnboarded: () => Promise<void>;
};

export const AuthGateContext = createContext<AuthGate>({
  markOnboarded: async () => {
    await SecureStore.setItemAsync(ONBOARDING_KEY, '1');
  },
  resetOnboarded: async () => {
    await SecureStore.deleteItemAsync(ONBOARDING_KEY);
  },
});

export function useAuthGate(): AuthGate {
  return useContext(AuthGateContext);
}
