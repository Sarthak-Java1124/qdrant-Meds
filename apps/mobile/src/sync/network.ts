import NetInfo from '@react-native-community/netinfo';

import { getSetting } from '@/core/db';

/** "Force offline" (demo switch) wins over the real network state. */
export async function isForcedOffline() {
  return (await getSetting('force_offline', '0')) === '1';
}

/** True when sync must not touch the network: forced offline, no connection, or internet known unreachable. */
export async function isOffline() {
  if (await isForcedOffline()) return true;
  const state = await NetInfo.fetch();
  return state.isConnected === false || state.isInternetReachable === false;
}
