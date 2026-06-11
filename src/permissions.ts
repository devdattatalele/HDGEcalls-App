import { PermissionsAndroid, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { Directory } from 'expo-file-system';

export type PermissionState = {
  callLog: boolean;
  contacts: boolean;
  mediaAudio: boolean;
  notifications: boolean;
};

export async function requestAllPermissions(): Promise<PermissionState> {
  if (Platform.OS !== 'android') {
    return {
      callLog: false,
      contacts: false,
      mediaAudio: false,
      notifications: false,
    };
  }

  const wanted: (keyof typeof PermissionsAndroid.PERMISSIONS)[] = [
    'READ_CALL_LOG',
    'READ_CONTACTS',
    'CALL_PHONE',
  ];

  // API 33+ uses READ_MEDIA_AUDIO; older uses READ_EXTERNAL_STORAGE.
  const apiLevel = Platform.Version as number;
  if (apiLevel >= 33) wanted.push('READ_MEDIA_AUDIO' as never);
  else wanted.push('READ_EXTERNAL_STORAGE' as never);
  if (apiLevel >= 33) wanted.push('POST_NOTIFICATIONS' as never);

  const result = await PermissionsAndroid.requestMultiple(
    wanted.map((k) => PermissionsAndroid.PERMISSIONS[k]) as never,
  );

  const granted = (key: string) =>
    (result as Record<string, string>)[key] ===
    PermissionsAndroid.RESULTS.GRANTED;

  // expo-notifications also has its own permission check.
  const notif = await Notifications.requestPermissionsAsync();

  return {
    callLog: granted(PermissionsAndroid.PERMISSIONS.READ_CALL_LOG),
    contacts: granted(PermissionsAndroid.PERMISSIONS.READ_CONTACTS),
    mediaAudio:
      granted((PermissionsAndroid.PERMISSIONS as Record<string, string>).READ_MEDIA_AUDIO) ||
      granted(PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE),
    notifications: notif.granted,
  };
}

export type SyncCapabilityState = {
  allFiles: boolean;
  callLog: boolean;
  notifications: boolean;
};

export async function checkCallLogPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    return await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.READ_CALL_LOG,
    );
  } catch {
    return false;
  }
}

export async function checkNotificationPermission(): Promise<boolean> {
  try {
    const notif = await Notifications.getPermissionsAsync();
    return notif.granted;
  } catch {
    return false;
  }
}

// Listing /storage/emulated/0/ itself works on every Android version even
// without MANAGE_EXTERNAL_STORAGE, so that's a false-positive probe. On
// Android 11+ the /Android/ directory specifically is gated behind All-Files
// Access: with the permission, listing returns the usual data/media/obb
// entries; without it, listing throws or returns an empty array. Treating
// "≥1 entry" as proof catches the Xiaomi/Oppo/Vivo case this row exists for.
export async function checkAllFilesAccess(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    const probe = new Directory('file:///storage/emulated/0/Android/');
    if (!probe.exists) return false;
    const entries = probe.list();
    return entries.length > 0;
  } catch {
    return false;
  }
}

export async function checkSyncCapabilities(): Promise<SyncCapabilityState> {
  const [allFiles, callLog, notifications] = await Promise.all([
    checkAllFilesAccess(),
    checkCallLogPermission(),
    checkNotificationPermission(),
  ]);
  return { allFiles, callLog, notifications };
}
