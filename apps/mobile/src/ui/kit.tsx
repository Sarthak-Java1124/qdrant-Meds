import { Feather } from '@expo/vector-icons';
import { useRef, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fontFamily, type Weight } from './fonts';
import { cardShadow, glow, radius, raisedShadow, space, useTheme } from './theme';

export type IconName = ComponentProps<typeof Feather>['name'];

/** The one icon set (Feather: clean, outline, matches the type system's restraint). */
export function Icon({ name, size = 18, color }: { name: IconName; size?: number; color?: string }) {
  const t = useTheme();
  return <Feather name={name} size={size} color={color ?? t.text} />;
}

/** A round colored chip holding an icon — category markers, header actions, list glyphs. */
export function IconBadge({ name, tone = 'soft', size = 34, iconSize = 16 }: { name: IconName; tone?: 'soft' | 'primary' | 'highlight' | 'good' | 'warn' | 'bad'; size?: number; iconSize?: number }) {
  const t = useTheme();
  const tones = {
    soft: { bg: t.surfaceAlt, fg: t.sub },
    primary: { bg: t.primarySoft, fg: t.link },
    highlight: { bg: t.highlightSoft, fg: t.highlight },
    good: { bg: t.goodSoft, fg: t.good },
    warn: { bg: t.warnSoft, fg: t.warn },
    bad: { bg: t.badSoft, fg: t.bad },
  }[tone];
  return (
    <View style={{ width: size, height: size, borderRadius: radius.pill, backgroundColor: tones.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={name} size={iconSize} color={tones.fg} />
    </View>
  );
}

// ---------- text ----------

type TextColor = 'text' | 'sub' | 'faint' | 'primary' | 'highlight' | 'good' | 'warn' | 'bad';

/**
 * The one text component. Sans (Geist) by default; `mono` for numbers and labels; `serif` (+ `italic`) for
 * decorative emphasis. `track` is letter-spacing in em, `upper` uppercases. "primary" text is the darker lime
 * (bright lime is only for surfaces).
 */
export function T({ children, style, size = 15, weight = '400', color, numberOfLines, selectable, mono, serif, italic, upper, track }: {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
  size?: number;
  weight?: Weight;
  color?: TextColor;
  numberOfLines?: number;
  selectable?: boolean;
  mono?: boolean;
  serif?: boolean;
  italic?: boolean;
  upper?: boolean;
  track?: number;
}) {
  const t = useTheme();
  const c = color === 'primary' ? t.link : t[color ?? 'text'];
  return (
    <Text
      selectable={selectable}
      numberOfLines={numberOfLines}
      style={[{ fontFamily: fontFamily(weight, { mono, serif, italic }), fontSize: size, color: c }, upper && { textTransform: 'uppercase' }, track !== undefined && { letterSpacing: track * size }, style]}>
      {children}
    </Text>
  );
}

/** Screen headline: 34px, bold, tight tracking. */
export const H1 = ({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) => <T size={34} weight="700" track={-0.025} style={[{ lineHeight: 36 }, style]}>{children}</T>;
/** Section / card title. */
export const H2 = ({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) => <T size={22} weight="700" track={-0.02} style={[{ lineHeight: 25 }, style]}>{children}</T>;
export const Sub = ({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) => <T size={13} color="sub" style={[{ lineHeight: 18 }, style]}>{children}</T>;

/** Small muted label: sentence case, semibold. */
export function Eyebrow({ children, color = 'sub', style }: { children: ReactNode; color?: TextColor; style?: StyleProp<TextStyle> }) {
  return <T size={12} weight="600" color={color} style={style}>{children}</T>;
}

/** Big bold number: counts and totals. */
export const Stat = ({ children, size = 34, color, style }: { children: ReactNode; size?: number; color?: TextColor; style?: StyleProp<TextStyle> }) => (
  <T weight="700" size={size} track={-0.03} color={color} style={[{ lineHeight: size * 1.1 }, style]}>{children}</T>
);

/** A bold section heading with optional right-hand action (see-all link, filter buttons). */
export function SectionTitle({ children, right, icon }: { children: ReactNode; right?: ReactNode; icon?: IconName }) {
  const t = useTheme();
  return (
    <View style={styles.sectionTitle}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
        {icon ? <Icon name={icon} size={16} color={t.dark} /> : null}
        <T size={18} weight="700" track={-0.02}>{children}</T>
      </View>
      {right}
    </View>
  );
}

// ---------- layout ----------

/** A screen: cream background, safe area, optional scroll. Headers already handle the top inset (use `top` when there is none). */
export function Screen({ children, scroll = true, padded = true, refreshing, top }: { children: ReactNode; scroll?: boolean; padded?: boolean; refreshing?: boolean; top?: boolean }) {
  const t = useTheme();
  const body = padded ? { padding: space.l, gap: space.m } : undefined;
  return (
    <SafeAreaView edges={top ? ['top', 'left', 'right'] : ['left', 'right']} style={[styles.flex, { backgroundColor: t.bg }]}>
      {scroll ? (
        <ScrollView contentContainerStyle={[body, { paddingBottom: space.xxl }]} keyboardShouldPersistTaps="handled">
          {refreshing ? <ActivityIndicator style={{ marginBottom: space.s }} color={t.accentDark} /> : null}
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.flex, body]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

/** White surface, softly rounded, lightly shadowed. `elevated` lifts it further for a hero-adjacent moment. */
export function Card({ children, style, onPress, elevated }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; elevated?: boolean }) {
  const t = useTheme();
  const base: ViewStyle = {
    backgroundColor: t.card,
    borderColor: t.border,
    borderWidth: 0,
    borderRadius: radius.l,
    padding: space.l,
    gap: space.s,
    ...(elevated ? raisedShadow : cardShadow),
  };
  const scale = useRef(new Animated.Value(1)).current;
  const pressIn = () => Animated.spring(scale, { toValue: 0.98, useNativeDriver: true, speed: 50, bounciness: 0 }).start();
  const pressOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 8 }).start();
  return onPress ? (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable onPress={onPress} onPressIn={pressIn} onPressOut={pressOut} style={({ pressed }) => [base, style, pressed && { backgroundColor: t.surfaceAlt }]}>{children}</Pressable>
    </Animated.View>
  ) : (
    <View style={[base, style]}>{children}</View>
  );
}

/**
 * A gradient-free "gradient moment": a solid accent (or dark) surface with a soft translucent glow layered in
 * one corner for depth, used for headline blocks (onboarding intro, empty states, hero stats) instead of a flat
 * white Card. `tone` picks the base surface; text inside should use `onAccent`/`onDark`-style explicit colors.
 */
export function Hero({ children, style, tone = 'accent' }: { children: ReactNode; style?: StyleProp<ViewStyle>; tone?: 'accent' | 'dark' }) {
  const t = useTheme();
  const bg = t.dark;
  return (
    <View style={[{ backgroundColor: bg, borderRadius: radius.xl, padding: space.xl, gap: space.m, overflow: 'hidden', ...raisedShadow }, style]}>
      <View pointerEvents="none" style={{ position: 'absolute', width: 220, height: 220, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.08)', top: -90, right: -70 }} />
      <View pointerEvents="none" style={{ position: 'absolute', width: 140, height: 140, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.06)', bottom: -50, left: -40 }} />
      {children}
    </View>
  );
}

export const Row = ({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) => (
  <View style={[{ flexDirection: 'row', alignItems: 'center', gap: space.s }, style]}>{children}</View>
);

export function Divider() {
  const t = useTheme();
  return <View style={{ height: 1, backgroundColor: t.border, marginVertical: space.xs }} />;
}

// ---------- controls ----------

/**
 * primary = the lime call to action (filled, glow). soft = the outlined secondary. danger = filled red.
 * ghost = text-only link in the darker lime. Labels are uppercase and widely tracked.
 */
export function Button({ title, onPress, kind = 'primary', disabled, busy, small }: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'soft' | 'danger' | 'ghost';
  disabled?: boolean;
  busy?: boolean;
  small?: boolean;
}) {
  const t = useTheme();
  const c = {
    primary: { bg: t.primary, fg: t.dark, border: 'transparent', size: 15, py: 17, px: 24, weight: '700' as Weight },
    soft: { bg: t.card, fg: t.dark, border: t.border, size: 14, py: 15, px: 22, weight: '600' as Weight },
    danger: { bg: t.bad, fg: '#FFFFFF', border: 'transparent', size: 15, py: 17, px: 24, weight: '600' as Weight },
    ghost: { bg: 'transparent', fg: t.link, border: 'transparent', size: 14, py: 12, px: 12, weight: '600' as Weight },
  }[kind];
  const size = small ? c.size - 2 : c.size;
  const py = small ? Math.round(c.py * 0.55) : c.py;
  const px = small ? Math.round(c.px * 0.6) : c.px;
  const scale = useRef(new Animated.Value(1)).current;
  const pressIn = () => Animated.spring(scale, { toValue: 0.96, useNativeDriver: true, speed: 50, bounciness: 0 }).start();
  const pressOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 8 }).start();
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        disabled={disabled || busy}
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        style={({ pressed }) => [
          { backgroundColor: c.bg, borderColor: c.border, borderWidth: c.border === 'transparent' ? 0 : 1, borderRadius: kind === 'ghost' ? 0 : radius.pill, paddingVertical: py, paddingHorizontal: px, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
          kind === 'primary' && !disabled && glow,
          (disabled || busy) && { opacity: 0.4 },
          pressed && { opacity: 0.75 },
        ]}>
        {busy ? <ActivityIndicator size="small" color={c.fg} /> : null}
        <T weight={c.weight} size={size} track={-0.01} style={{ color: c.fg }}>{title}</T>
      </Pressable>
    </Animated.View>
  );
}

/** A pill. `small` is the mono badge style. `icon` draws a small glyph before the label. */
export function Chip({ label, selected, onPress, tone = 'soft', small, icon }: { label: string; selected?: boolean; onPress?: () => void; tone?: 'soft' | 'good' | 'warn' | 'bad'; small?: boolean; icon?: IconName }) {
  const t = useTheme();
  const tones = { soft: { bg: t.primarySoft, fg: t.dark, bd: t.border }, good: { bg: t.goodSoft, fg: t.good, bd: 'transparent' }, warn: { bg: t.warnSoft, fg: t.warn, bd: 'transparent' }, bad: { bg: t.badSoft, fg: t.bad, bd: 'transparent' } }[tone];
  const fg = selected ? t.dark : tones.fg;
  const style = {
    backgroundColor: selected ? t.primary : tones.bg,
    borderColor: selected ? t.primary : tones.bd,
    borderWidth: 1,
    borderRadius: radius.pill,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: small ? 9 : 14,
    paddingVertical: small ? 4 : 8,
  };
  const text = small ? (
    <T weight="600" size={11} style={{ color: fg }}>{label}</T>
  ) : (
    <T weight="600" size={13} style={{ color: fg }}>{label}</T>
  );
  const inner = (
    <>
      {icon ? <Icon name={icon} size={small ? 11 : 14} color={fg} /> : null}
      {text}
    </>
  );
  return onPress ? <Pressable onPress={onPress} style={({ pressed }) => [style, pressed && { opacity: 0.7 }]}>{inner}</Pressable> : <View style={style}>{inner}</View>;
}

/** A tiny mono badge for a short code, e.g. the source of an item ("SMS", "IMG"). Stays rectangular on purpose — a receipt-style detail, one of the few deliberately sharp accents left in the system. */
export function Tag({ children }: { children: string }) {
  const t = useTheme();
  return (
    <View style={{ backgroundColor: t.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3, minWidth: 34, alignItems: 'center' }}>
      <T weight="600" size={10} color="sub">{children}</T>
    </View>
  );
}

export function Field({ label, style, ...props }: TextInputProps & { label?: string }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {label ? <Eyebrow>{label}</Eyebrow> : null}
      <TextInput
        placeholderTextColor={t.faint}
        selectionColor={t.accentDark}
        {...props}
        style={[
          { backgroundColor: t.input, borderColor: t.border, borderWidth: 1, borderRadius: radius.m, color: t.text, paddingHorizontal: space.m, paddingVertical: 12, fontSize: 15, fontFamily: fontFamily('400') },
          props.multiline && { minHeight: 96, textAlignVertical: 'top' },
          style,
        ]}
      />
    </View>
  );
}

export function SwitchRow({ label, hint, value, onValueChange, disabled }: { label: string; hint?: string; value: boolean; onValueChange: (v: boolean) => void; disabled?: boolean }) {
  const t = useTheme();
  return (
    <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <View style={{ flex: 1, gap: 2 }}>
        <T weight="600">{label}</T>
        {hint ? <Sub>{hint}</Sub> : null}
      </View>
      <Switch value={value} onValueChange={onValueChange} disabled={disabled} trackColor={{ true: t.primary, false: t.mist }} thumbColor={value ? t.dark : '#FFFFFF'} />
    </Row>
  );
}

/** Rounded segmented control: the selected segment is a pill of accent color inset within the track. */
export function Segmented<V extends string>({ options, value, onChange }: { options: { value: V; label: string }[]; value: V; onChange: (v: V) => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', borderRadius: radius.pill, padding: 3, backgroundColor: t.surfaceAlt }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} style={{ flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: radius.pill, backgroundColor: on ? t.card : 'transparent', ...(on ? cardShadow : null) }}>
            <T weight="600" size={12} style={{ color: on ? t.dark : t.sub }}>{o.label}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

/** An empty state: an icon badge, a title, a hint. */
export function Empty({ title, hint, icon = 'inbox' }: { title: string; hint?: string; icon?: IconName }) {
  return (
    <View style={{ alignItems: 'center', padding: space.xl, gap: space.m }}>
      <IconBadge name={icon} size={44} iconSize={20} />
      <T weight="600" style={{ textAlign: 'center' }}>{title}</T>
      {hint ? <Sub style={{ textAlign: 'center' }}>{hint}</Sub> : null}
    </View>
  );
}

/** A bottom sheet with the centred drag handle. Tapping outside closes it. */
export function Sheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const t = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: t.overlay, justifyContent: 'flex-end' }} onPress={onClose}>
        <Pressable style={{ backgroundColor: t.bg, maxHeight: '88%', padding: space.l, paddingTop: space.m, gap: space.m, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl }} onPress={() => undefined}>
          <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: t.borderStrong }} />
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}><H2>{title}</H2></View>
            <Pressable onPress={onClose} hitSlop={12} style={{ width: 36, height: 36, borderRadius: radius.pill, backgroundColor: t.card, alignItems: 'center', justifyContent: 'center' }}><Icon name="x" size={18} color={t.dark} /></Pressable>
          </Row>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: space.s, paddingBottom: space.l }}>{children}</ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** A tappable list row: optional short code (Tag), title, optional subtitle, optional right-hand content. */
export function ListRow({ title, subtitle, right, onPress, icon }: { title: string; subtitle?: string; right?: ReactNode; onPress?: () => void; icon?: string }) {
  const inner = (
    <Row style={{ paddingVertical: 8, gap: space.m }}>
      {icon ? <Tag>{icon}</Tag> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <T weight="600" numberOfLines={2}>{title}</T>
        {subtitle ? <Sub>{subtitle}</Sub> : null}
      </View>
      {right}
    </Row>
  );
  return onPress ? <Pressable onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.6 }}>{inner}</Pressable> : inner;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  sectionTitle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space.m },
});
