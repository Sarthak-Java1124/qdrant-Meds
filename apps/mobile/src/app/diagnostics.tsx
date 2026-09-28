import { View } from 'react-native';

import { getDb } from '@/core/db';
import { fmtDateTime } from '@/ui/format';
import { useLoad } from '@/ui/hooks';
import { Button, Card, Chip, Divider, Empty, Row, Screen, Sub, T } from '@/ui/kit';

interface LogRow {
  id: number;
  ts: number;
  source: string;
  level: string;
  msg: string;
}

/** Per-source errors are caught and logged instead of crashing the app; this is where to look. */
export default function DiagnosticsScreen() {
  const logs = useLoad(async () => (await getDb()).getAllAsync<LogRow>('SELECT * FROM logs ORDER BY id DESC LIMIT 150'));
  return (
    <Screen>
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
