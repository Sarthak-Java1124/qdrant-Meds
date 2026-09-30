import { useKeyboardState } from 'react-native-keyboard-controller';
import { View } from 'react-native';

import { getDb } from '@/core/db';
import { fmtDateTime } from '@/ui/format';
import { useLoad } from '@/ui/hooks';
import { Button, Card, Chip, Divider, Empty, Field, Row, Screen, Sub, T } from '@/ui/kit';
import { useTheme } from '@/ui/theme';

interface LogRow {
  id: number;
  ts: number;
  source: string;
  level: string;
  msg: string;
}

/**
 * Temporary diagnostic: shows react-native-keyboard-controller's live keyboard state, so it's visible from
 * inside the running app whether it's receiving keyboard events at all (isVisible/height stuck at
 * false/0 while the keyboard is visibly open on screen means the native listener itself isn't firing —
 * a deeper native/linking problem, not a layout offset to tune). Remove once the keyboard-avoidance bug
 * is confirmed fixed.
 */
function KeyboardStateProbe() {
  const t = useTheme();
  const state = useKeyboardState((s) => s);
  return (
    <Card style={{ borderWidth: 1, borderColor: t.warn }}>
      <T weight="700">Keyboard probe (temporary)</T>
      <T mono size={12} selectable>{JSON.stringify(state, null, 2)}</T>
      <Field placeholder="Tap here and open the keyboard to test…" />
    </Card>
  );
}

/** Per-source errors are caught and logged instead of crashing the app; this is where to look. */
export default function DiagnosticsScreen() {
  const logs = useLoad(async () => (await getDb()).getAllAsync<LogRow>('SELECT * FROM logs ORDER BY id DESC LIMIT 150'));
  return (
    <Screen>
      <KeyboardStateProbe />
      <Sub>Errors and notable events from sources, the embedder, the Splitter and sync. Nothing here is uploaded.</Sub>
      <Row>
        <Button small kind="soft" title="Refresh" onPress={() => void logs.reload()} />
        <Button
          small
          kind="ghost"
          title="Clear"
          onPress={async () => {
            await (await getDb()).runAsync('DELETE FROM logs');
            void logs.reload();
          }}
        />
      </Row>
      <Card>
        {logs.data?.length ? (
          logs.data.map((l, i) => (
            <View key={l.id} style={{ gap: 3 }}>
              {i ? <Divider /> : null}
              <Row>
                <Chip small tone={l.level === 'error' ? 'bad' : l.level === 'warn' ? 'warn' : 'soft'} label={`${l.level} · ${l.source}`} />
                <Sub>{fmtDateTime(l.ts)}</Sub>
              </Row>
              <T size={12} selectable>{l.msg}</T>
            </View>
          ))
        ) : (
          <Empty title="No log entries" hint="Everything is running cleanly." />
        )}
      </Card>
    </Screen>
  );
}
