import { PermissionsAndroid, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

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
