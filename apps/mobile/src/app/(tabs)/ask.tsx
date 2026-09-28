import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { CATEGORY_LABEL, type Category } from '@/aftercare/data';
import { ask, type AskAnswer } from '@/aftercare/engine';
import { Button, Card, Chip, Eyebrow, Field, Icon, Row, Screen, SectionTitle, Sub, T } from '@/ui/kit';
import { space, useTheme } from '@/ui/theme';
import { toast } from '@/ui/toast';

const SUGGESTED = ['When do I take Aspirin?', 'What is the blue tablet?', 'What should I avoid eating?', 'Which tests do I need?', 'When is my next checkup?', 'Can I take a painkiller?'];

export default function AskScreen() {
  const t = useTheme();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<AskAnswer | null>(null);

  const run = async (question: string) => {
    if (!question.trim()) return;
    setQ(question);
    setBusy(true);
    try {
      setRes(await ask(question));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'bad');
    } finally {
      setBusy(false);
    }
  };

  const toneBg = res ? { good: t.goodSoft, warn: t.warnSoft, bad: t.badSoft, soft: t.primarySoft }[res.tone] : t.card;

  return (
    <Screen>
      <Row style={{ alignItems: 'flex-end' }}>
        <View style={{ flex: 1 }}>
          <Field placeholder="Ask anything the doctor told you…" value={q} onChangeText={setQ} onSubmitEditing={() => run(q)} returnKeyType="search" />
        </View>
        <Pressable
          onPress={() => toast('Voice questions arrive with on-device Whisper (roadmap)', 'warn')}
          style={({ pressed }) => ({ width: 52, height: 52, borderRadius: 26, backgroundColor: t.dark, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.8 : 1 })}>
          <Icon name="mic" size={20} color={t.primary} />
        </Pressable>
      </Row>
      <Button title="Ask" busy={busy} onPress={() => run(q)} />
      <Row style={{ flexWrap: 'wrap' }}>
        {SUGGESTED.map((s) => (
          <Chip key={s} small label={s} onPress={() => run(s)} />
        ))}
      </Row>

      {res ? (
        <>
          <View style={{ backgroundColor: toneBg, borderRadius: 16, padding: space.l, gap: space.s }}>
            <Row>
              <Icon name="cpu" size={14} color={t.dark} />
              <Eyebrow>{`Answered on this phone · ${res.ms} ms · works offline`}</Eyebrow>
            </Row>
            <T size={16} weight="600" style={{ lineHeight: 22 }}>{res.answer}</T>
            <Sub>{`Summary written on-device from ${res.hits.length} matching moment${res.hits.length === 1 ? '' : 's'} in your visits.`}</Sub>
          </View>

          <SectionTitle icon="search">From your visits</SectionTitle>
          {res.hits.map((h, i) => (
            <Card key={i}>
              <T size={14}>{`“${h.text}”`}</T>
              <Row style={{ justifyContent: 'space-between' }}>
                <Sub>{`${h.doctor} · ${h.specialty} · ${h.date}`}</Sub>
                <Row>
                  {h.category ? <Chip small label={CATEGORY_LABEL[h.category as Category] ?? h.category} /> : null}
                  <T mono size={10} color="faint">{h.score.toFixed(2)}</T>
                </Row>
              </Row>
            </Card>
          ))}
          <Sub>Hybrid search: MiniLM meaning vectors + exact drug-name keywords, fused, over the Qdrant Edge memory on this phone.</Sub>
        </>
      ) : (
        <Card>
          <T weight="600">Your visits, answerable offline</T>
          <Sub>Every sentence the doctor said is stored as a vector on this phone. Ask in your own words, even in airplane mode.</Sub>
        </Card>
      )}
    </Screen>
  );
}
