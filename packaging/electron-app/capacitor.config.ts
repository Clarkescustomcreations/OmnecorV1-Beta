import { CapacitorConfig } from '@capacitor/cli';

// For the Android thin-client APK, the app must reach the desktop backend
// over the local network.  At runtime the stored IP (set in StepNetwork) is
// read from localStorage and used to build the server URL dynamically.
//
// During build you can override OMNECOR_SERVER_IP via environment variable:
//   OMNECOR_SERVER_IP=192.168.1.10 pnpm build:android
const serverIP = process.env.OMNECOR_SERVER_IP || 'localhost';
const serverPort = process.env.OMNECOR_SERVER_PORT || '3000';

const config: CapacitorConfig = {
  appId: 'com.omnecor.workstation',
  appName: 'Omnecor',
  webDir: 'out/renderer',
  server: {
    // LAN connection for thin-client mode:
    //   - hostname points to the desktop brain
    //   - androidScheme is http for LAN (use https + reverse proxy for remote)
    hostname: serverIP,
    androidScheme: serverIP === 'localhost' ? 'https' : 'http',
    url: serverIP !== 'localhost' ? `http://${serverIP}:${serverPort}` : undefined
  },
  android: {
    allowMixedContent: true // needed for LAN http connections
  },
  plugins: {
    // Store the server IP so it persists after first-launch wizard
    Preferences: {
      group: 'OmnecorSettings'
    }
  }
};

export default config;
