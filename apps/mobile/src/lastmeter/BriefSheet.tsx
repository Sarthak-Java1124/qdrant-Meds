import { View } from 'react-native';

import { Chip, Row, Sheet, Sub, T } from '@/ui/kit';
import { statusStyle } from '@/ui/theme';

import type { BriefLine } from './brief';

function StatusBadge({ status, confirmations }: { status: BriefLine['status']; confirmations: number }) {
  const s = statusStyle[status === 'superseded' ? 'superseded' : status];
  const label = status === 'verified' ? `Verified · ${confirmations} rider${confirmations === 1 ? '' : 's'}` : s.label;
  return (
    <View style={{ backgroundColor: s.bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
      <T size={11} weight="700" style={{ color: s.fg }}>{label}</T>
    </View>
  );
}

/** Up to 4 lines, no typing, no question — the whole point of an arrival brief. */
export function BriefSheet({ visible, label, lines, onClose }: { visible: boolean; label: string; lines: BriefLine[]; onClose: () => void }) {
  return (
    <Sheet visible={visible} title={label} onClose={onClose}>
      {lines.length ? (
        lines.map((l) => (
          <Row key={String(l.id)} style={{ justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 }}>
            <T size={15} style={{ flex: 1, marginRight: 8 }}>{l.text}</T>
            <StatusBadge status={l.status} confirmations={l.confirmations} />
          </Row>
        ))
      ) : (
        <Sub>Nobody's left a note about this stop yet. You'll be the first — whatever you find here helps the next rider.</Sub>
      )}
      <Row style={{ flexWrap: 'wrap', marginTop: 4 }}>
        <Chip small label="Works offline" tone="good" />
      </Row>
    </Sheet>
  );
}
