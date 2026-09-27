import { existsSync } from 'node:fs';
import type { ExpoConfig } from 'expo/config';

// iOS wake-ups ride FCM topics over APNs (relay/SPECIFICATION.md §6.1). They
// need the Firebase iOS app's plist and an APNs-capable signing team; without
// the plist the build still works and the app reports no wake-up transport.
const iosFirebase = existsSync('./GoogleService-Info.plist');

const config: ExpoConfig = {
  name: 'Keryx',
  slug: 'keryx',
  scheme: 'keryx',
  version: process.env.KERYX_VERSION_NAME ?? '0.6.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  backgroundColor: '#ffffff',
  ios: {
    bundleIdentifier: 'cz.v1b3coder.keryx',
    supportsTablet: true,
    ...(iosFirebase ? { googleServicesFile: './GoogleService-Info.plist' } : {}),
    entitlements: iosFirebase ? { 'aps-environment': 'development' } : {},
    infoPlist: {
      NSCameraUsageDescription: 'Scan the company QR code to subscribe to its messages.',
      UIBackgroundModes: ['remote-notification'],
      // KeryxPush forwards the APNs token itself (modules/keryx-push)
      FirebaseAppDelegateProxyEnabled: false,
    },
  },
  android: {
    package: 'cz.v1b3coder.keryx',
    // CI sets the release version (the tag); local builds keep 1
    versionCode: Number(process.env.KERYX_VERSION_CODE ?? '1'),
    googleServicesFile: './google-services.json',
    adaptiveIcon: {
      backgroundColor: '#0000ee',
      foregroundImage: './assets/android-icon-foreground.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    permissions: ['android.permission.CAMERA', 'android.permission.POST_NOTIFICATIONS'],
    predictiveBackGestureEnabled: false,
  },
  web: {
    output: 'single',
    favicon: './assets/favicon.png',
    name: 'Keryx',
    shortName: 'Keryx',
    description: 'Verified announcements from companies. No email, no accounts, no phishing.',
    themeColor: '#ffffff',
    backgroundColor: '#ffffff',
  },
  // GitHub Pages serves the PWA under /keryx/ (EXPO_BASE_URL in CI)
  experiments: { baseUrl: process.env.EXPO_BASE_URL ?? '' },
  plugins: [
    ['expo-camera', { cameraPermission: 'Scan the company QR code to subscribe to its messages.', recordAudioAndroid: false }],
    'expo-sqlite',
    'expo-web-browser',
    ['expo-build-properties', { ios: { useFrameworks: 'static', enableSceneSupport: true } }],
    './plugins/with-keryx-android',
  ],
};

export default config;
