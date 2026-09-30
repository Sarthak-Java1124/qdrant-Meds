import { useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
// See ui/kit.tsx: React Native's own KeyboardAvoidingView doesn't track the keyboard on Android once
// edge-to-edge display is on, so this screen (which builds its own layout instead of using Screen) needs the
// same swap. Requires the app root to be wrapped in this library's KeyboardProvider (app/_layout.tsx).
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

import { CATEGORY_LABEL, type Category } from '@/aftercare/data';
import { ask, type AskAnswer } from '@/aftercare/engine';
import { fontFamily } from '@/ui/fonts';
import { Chip, Icon, Row, Sub, T } from '@/ui/kit';
import { ThinkingDots } from '@/ui/ThinkingDots';
import { cardShadow, radius, space, useTheme } from '@/ui/theme';
import { toast } from '@/ui/toast';

const SUGGESTED = ['When do I take Aspirin?', 'What is the blue tablet?', 'What should I avoid eating?', 'Which tests do I need?', 'When is my next checkup?', 'Can I take a painkiller?'];

/**
 * Expo's edge-to-edge display on Android (on by default) turns off `windowSoftInputMode=adjustResize`, so
 * Android needs `KeyboardAvoidingView` too — same as iOS, just with the `behavior` that actually works there.
 * `automaticOffset` asks the OS for this view's true on-screen position (it sits below the tab header) instead
 * of assuming it starts at the top of the screen — without it the avoidance silently computes the wrong
 * offset and never visibly moves anything.
 */
const KEYBOARD_BEHAVIOR = Platform.OS === 'ios' ? 'padding' : 'height';

type NewMessage = { role: 'user'; text: string } | { role: 'assistant'; answer: AskAnswer } | { role: 'error'; text: string };
type Message = NewMessage & { id: number };

/** The assistant's small round mark, shown beside each reply. */
function AssistantAvatar({ size = 28 }: { size?: number }) {
  const t = useTheme();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="activity" size={size * 0.5} color={t.dark} />
    </View>
  );
}

function UserBubble({ text }: { text: string }) {
  const t = useTheme();
  return (
    <View style={{ alignSelf: 'flex-end', maxWidth: '82%', backgroundColor: t.dark, borderRadius: radius.l, borderBottomRightRadius: 6, paddingHorizontal: space.l, paddingVertical: 11 }}>
      <T size={15} style={{ color: '#FFFFFF', lineHeight: 21 }}>{text}</T>
    </View>
  );
}

/** A reply: plain text next to the avatar (no bubble, like Claude/ChatGPT), a meta line, and collapsible sources. */
function AssistantReply({ a }: { a: AskAnswer }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const n = a.hits.length;
  return (
    <Row style={{ alignItems: 'flex-start', gap: space.m }}>
      <AssistantAvatar />
      <View style={{ flex: 1, gap: space.s, paddingTop: 3 }}>
        <T size={15} selectable style={{ lineHeight: 22 }}>{a.answer}</T>
        <Row style={{ gap: space.s, flexWrap: 'wrap' }}>
          <T size={11} color="faint">{`On this phone · ${a.ms} ms`}</T>
          {n ? (
            <Pressable onPress={() => setOpen((o) => !o)} hitSlop={6}>
              <Row style={{ backgroundColor: t.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, gap: 4 }}>
                <Icon name="file-text" size={11} color={t.sub} />
                <T size={11} weight="600" color="sub">{`${n} source${n === 1 ? '' : 's'}`}</T>
                <Icon name={open ? 'chevron-up' : 'chevron-down'} size={12} color={t.sub} />
              </Row>
            </Pressable>
          ) : null}
        </Row>
        {open ? (
          <View style={{ gap: space.s }}>
            {a.hits.map((h, i) => (
              <View key={i} style={{ backgroundColor: t.card, borderRadius: radius.m, padding: space.m, gap: 6, borderWidth: 1, borderColor: t.border }}>
                <T size={13} style={{ lineHeight: 18 }}>{`“${h.text}”`}</T>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Sub style={{ flex: 1, fontSize: 11 }}>{`${h.doctor} · ${h.specialty} · ${h.date}`}</Sub>
                  {h.category ? <Chip small label={CATEGORY_LABEL[h.category as Category] ?? h.category} /> : null}
                </Row>
              </View>
            ))}
            <T size={11} color="faint">Found by meaning + exact drug names in the memory on this phone.</T>
          </View>
        ) : null}
      </View>
    </Row>
  );
}

function Welcome() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.m, paddingHorizontal: space.xl }}>
      <AssistantAvatar size={56} />
      <T size={22} weight="600" track={-0.02} style={{ textAlign: 'center' }}>What would you like to know?</T>
      <Sub style={{ textAlign: 'center', fontSize: 14, lineHeight: 20 }}>Ask about anything your doctors told you. Answers come from your visits, right on this phone, even offline.</Sub>
    </View>
  );
}

/**
 * Collapsible suggestions: a small toggle pill; the list only shows once the user opens it.
 * The panel is a direct child here (not nested inside a `flex: 1` row alongside the toggle) — that nesting
 * previously left the row's width undetermined, which collapsed each suggestion's `flex: 1` label to zero
 * width and hid the text entirely. `trailing` (the "New chat" pill) sits beside the toggle instead.
 */
function Suggestions({ open, onToggle, onPick, trailing }: { open: boolean; onToggle: () => void; onPick: (q: string) => void; trailing?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: space.s }}>
      {open ? (
        <View style={{ backgroundColor: t.card, borderRadius: radius.l, paddingVertical: space.xs, ...cardShadow }}>
          {SUGGESTED.map((s, i) => (
            <Pressable key={s} onPress={() => onPick(s)} style={({ pressed }) => ({ backgroundColor: pressed ? t.surfaceAlt : 'transparent' })}>
              <Row style={{ paddingHorizontal: space.l, paddingVertical: 12, gap: space.m, borderTopWidth: i ? 1 : 0, borderTopColor: t.border }}>
                <Icon name="message-circle" size={15} color={t.sub} />
                <T size={14} style={{ flex: 1 }}>{s}</T>
                <Icon name="arrow-up-right" size={15} color={t.faint} />
              </Row>
            </Pressable>
          ))}
        </View>
      ) : null}
      <Row style={{ justifyContent: 'space-between' }}>
        <Pressable onPress={onToggle} hitSlop={6}>
          <Row style={{ backgroundColor: open ? t.primary : t.card, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8, gap: 6, ...(open ? null : cardShadow) }}>
            <Icon name="zap" size={13} color={t.dark} />
            <T size={12} weight="600">Suggestions</T>
            <Icon name={open ? 'chevron-down' : 'chevron-up'} size={14} color={t.dark} />
          </Row>
        </Pressable>
        {open ? null : trailing}
      </Row>
    </View>
  );
}

export default function AskScreen() {
  const t = useTheme();
  const scroll = useRef<ScrollView>(null);
  const nextId = useRef(0);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const push = (m: NewMessage) => setMessages((ms) => [...ms, { ...m, id: nextId.current++ }]);

  const run = async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    setQ('');
    setShowSuggestions(false);
    push({ role: 'user', text });
    setBusy(true);
    try {
      push({ role: 'assistant', answer: await ask(text) });
    } catch (e) {
      push({ role: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const canSend = !!q.trim() && !busy;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.bg }} behavior={KEYBOARD_BEHAVIOR} automaticOffset>
      {messages.length === 0 && !busy ? (
        <Welcome />
      ) : (
        <ScrollView
          ref={scroll}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: space.l, gap: space.xl }}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
          {messages.map((m) =>
            m.role === 'user' ? (
              <UserBubble key={m.id} text={m.text} />
            ) : m.role === 'assistant' ? (
              <AssistantReply key={m.id} a={m.answer} />
            ) : (
              <Row key={m.id} style={{ alignItems: 'flex-start', gap: space.m }}>
                <AssistantAvatar />
                <T size={14} color="bad" style={{ flex: 1, paddingTop: 5 }}>{`Something went wrong: ${m.text}`}</T>
              </Row>
            ),
          )}
          {busy ? (
            <Row style={{ alignItems: 'flex-start', gap: space.m }}>
              <AssistantAvatar />
              <ThinkingDots />
            </Row>
          ) : null}
        </ScrollView>
      )}

      <View style={{ paddingHorizontal: space.l, paddingTop: space.s, paddingBottom: space.m, gap: space.s }}>
        <Suggestions
          open={showSuggestions}
          onToggle={() => setShowSuggestions((o) => !o)}
          onPick={run}
          trailing={
            messages.length > 0 ? (
              <Pressable onPress={() => setMessages([])} disabled={busy} hitSlop={6}>
                <Row style={{ backgroundColor: t.card, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8, gap: 6, ...cardShadow }}>
                  <Icon name="edit" size={13} color={t.dark} />
                  <T size={12} weight="600">New chat</T>
                </Row>
              </Pressable>
            ) : null
          }
        />
        <Row style={{ backgroundColor: t.card, borderRadius: radius.pill, paddingLeft: space.l, padding: 6, gap: 6, ...cardShadow }}>
          <TextInput
            placeholder="Message your health memory…"
            placeholderTextColor={t.faint}
            selectionColor={t.accentDark}
            value={q}
            onChangeText={setQ}
            onSubmitEditing={() => run(q)}
            returnKeyType="send"
            style={{ flex: 1, color: t.text, fontSize: 15, fontFamily: fontFamily('400'), paddingVertical: 10 }}
          />
          <Pressable
            accessibilityLabel="Ask by voice"
            onPress={() => toast('Voice questions arrive with on-device Whisper (roadmap)', 'warn')}
            style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, backgroundColor: t.surfaceAlt, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}>
            <Icon name="mic" size={19} color={t.dark} />
          </Pressable>
          <Pressable
            accessibilityLabel="Send"
            disabled={!canSend}
            onPress={() => run(q)}
            style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, backgroundColor: canSend || busy ? t.dark : t.mist, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.8 : 1 })}>
            {busy ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Icon name="arrow-up" size={20} color={canSend ? '#FFFFFF' : t.faint} />}
          </Pressable>
        </Row>
      </View>
    </KeyboardAvoidingView>
  );
}
