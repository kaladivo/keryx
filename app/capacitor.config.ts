import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'cz.v1b3coder.keryx',
  appName: 'Keryx',
  webDir: 'dist',
  ios: {
    includePlugins: ['@capacitor/barcode-scanner', '@capacitor/browser', '@capacitor/status-bar'],
  },
  android: {
    includePlugins: ['@capacitor-mlkit/barcode-scanning', '@capacitor/browser', '@capacitor/status-bar'],
  },
  plugins: {
    BarcodeScanner: {
      // MLKit's bundled model: on-device, works without Play Services.
      // (The Capacitor MLKit plugin uses the bundled scanner by default.)
    },
  },
};

export default config;
