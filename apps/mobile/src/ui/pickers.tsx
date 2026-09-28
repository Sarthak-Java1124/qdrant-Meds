import { Pressable } from 'react-native';

import { Field, Sheet, Sub } from './kit';

/** A rider's zone is a free-typed neighborhood name (matches the demo route's --zone), not a fixed list. */
export function ZonePicker({ visible, current, onPick, onClose }: { visible: boolean; current?: string; onPick: (zone: string) => void; onClose: () => void }) {
  return (
    <Sheet visible={visible} title="Choose your zone" onClose={onClose}>
      <Sub>The neighborhood you're delivering in today. Facts you and other riders learn here are shared with everyone in the same zone.</Sub>
      <Field
        placeholder="e.g. Koramangala"
        defaultValue={current}
        autoFocus
        autoCapitalize="words"
        onSubmitEditing={(e) => {
          const v = e.nativeEvent.text.trim();
          if (v) onPick(v);
        }}
      />
    </Sheet>
  );
}

export function ZoneRow({ zone, onPress }: { zone: string | null; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <Sub>{zone ? `Zone: ${zone}` : 'Choose your zone'}</Sub>
    </Pressable>
  );
}
