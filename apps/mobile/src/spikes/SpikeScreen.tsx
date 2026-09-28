import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { clusterSpike } from './clusterSpike';
import { edgeSpike, type Log } from './edgeSpike';
import { embedSpike } from './embedSpike';

async function coreReset(log: Log) {
  const { deleteAllShards } = await import('@/core/shards');
  const { deleteDatabase } = await import('@/core/db');
  deleteAllShards();
  await deleteDatabase();
  log('core data deleted. Reload the app (r in Metro) before running anything else.');
}

const SPIKES = [
  { key: 'A', label: 'A: Qdrant Edge', run: edgeSpike },
  { key: 'B', label: 'B: Embeddings', run: embedSpike },
  { key: 'CLU', label: 'Memory Map (searchMatrix)', run: clusterSpike },
  { key: 'RST', label: 'Reset all data', run: coreReset },
];

// Temporary developer harness. The crowd/privacy/sync smoke tests from Hive's merchant/doubt/tip era were
// dropped in the LastMeter pivot rather than rewritten for place_fact/outcome — they exercised deleted
// domains end to end and porting them properly is a project of its own; the shipped Route/Brief/Capture
// flow is what actually needs to work, and that's verified by running the app, not this harness.
export function SpikeScreen() {
  const [lines, setLines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const log: Log = (msg) => {
    console.log(msg);
    setLines((l) => [...l, msg]);
  };

  const run = async (label: string, fn: (log: Log) => Promise<void>) => {
    setBusy(true);
    log(`=== ${label} ===`);
    try {
      await fn(log);
    } catch (e) {
      log(`CRASH ${e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e)}`);
    }
    setBusy(false);
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.row}>
        {SPIKES.map((s) => (
          <Pressable
            key={s.key}
            disabled={busy}
            style={[styles.btn, busy && styles.disabled]}
            onPress={() => run(s.label, s.run)}>
            <Text style={styles.btnText}>{s.label}</Text>
          </Pressable>
        ))}
        <Pressable style={[styles.btn, styles.clear]} onPress={() => setLines([])}>
          <Text style={styles.btnText}>Clear</Text>
        </Pressable>
      </View>
      <ScrollView style={styles.log}>
        {lines.map((l, i) => (
          <Text key={i} style={[styles.line, /FAIL|CRASH/.test(l) && styles.bad]} selectable>
            {l}
          </Text>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 12, backgroundColor: '#111' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  btn: { backgroundColor: '#1E5A45', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8 },
  clear: { backgroundColor: '#444' },
  disabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontWeight: '600' },
  log: { flex: 1 },
  line: { color: '#d4d4d4', fontFamily: 'monospace', fontSize: 11, marginBottom: 4 },
  bad: { color: '#f87171' },
});
