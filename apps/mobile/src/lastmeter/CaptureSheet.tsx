import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { View } from 'react-native';

import type { StopRow } from '@/core/db';
import { Button, Chip, Field, Row, Sheet, Sub } from '@/ui/kit';
import { toast } from '@/ui/toast';

import type { BriefLine } from './brief';
import { submitCapture } from './capture';

const QUICK_CHIPS = ['Rear gate', 'Hand to guard', 'Lift down', 'Code changed'];

export function CaptureSheet({
  visible,
  stop,
  factsShown,
  onClose,
  onDone,
}: {
  visible: boolean;
  stop: StopRow | null;
  factsShown: BriefLine[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [busy, setBusy] = useState<'delivered' | 'failed' | null>(null);

  const reset = () => {
    setNote('');
    setPhotoUri(null);
  };

  const pickPhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return toast('Camera permission was not granted', 'warn');
    const result = await ImagePicker.launchCameraAsync({ quality: 0.5 });
    if (!result.canceled) setPhotoUri(result.assets[0].uri);
  };

  const submit = async (result: 'delivered' | 'failed') => {
    if (!stop) return;
    setBusy(result);
    try {
      await submitCapture({
        stopId: stop.id,
        placeId: stop.place_id,
        lat: stop.lat,
        lon: stop.lon,
        arrivedAt: stop.arrived_at ?? Date.now(),
        result,
        note,
        photoUri,
        factsShown,
      });
      reset();
      onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'bad');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet visible={visible} title={stop?.label ?? ''} onClose={onClose}>
      <Row>
        <View style={{ flex: 1 }}>
          <Button title="Delivered" kind="primary" busy={busy === 'delivered'} disabled={!!busy} onPress={() => submit('delivered')} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Failed" kind="soft" busy={busy === 'failed'} disabled={!!busy} onPress={() => submit('failed')} />
        </View>
      </Row>

      <Sub>Anything the next rider should know? (optional)</Sub>
      <Row style={{ flexWrap: 'wrap' }}>
        {QUICK_CHIPS.map((c) => (
          <Chip key={c} label={c} selected={note === c} onPress={() => setNote(c)} />
        ))}
      </Row>
      <Field
        placeholder="Type a note, or use your keyboard mic"
        value={note}
        onChangeText={setNote}
        multiline
      />

      <Row style={{ alignItems: 'center' }}>
        <Button small kind="soft" title={photoUri ? 'Photo added' : 'Add a photo'} onPress={pickPhoto} />
        <Sub>Photo stays on this phone</Sub>
      </Row>
    </Sheet>
  );
}
