/**
 * Premium phone UI kit — dense but calm, touch-first (44pt+), dark mineral shell.
 * Patterns: clear hierarchy, segmented controls, list rows, settings toggles.
 */
import { useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { Icon } from "./Icon";
import { colors, radius, space, type } from "./theme";

type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "accentSoft";

export function Btn(props: {
  title: string;
  onPress?: () => void;
  disabled?: boolean;
  variant?: BtnVariant;
  compact?: boolean;
  style?: ViewStyle;
  accessibilityLabel?: string;
}) {
  const variant = props.variant ?? "secondary";
  const scale = useRef(new Animated.Value(1)).current;
  const pressIn = () =>
    Animated.spring(scale, {
      toValue: 0.97,
      useNativeDriver: true,
      speed: 50,
      bounciness: 0,
    }).start();
  const pressOut = () =>
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 40,
      bounciness: 4,
    }).start();

  const palette =
    variant === "primary"
      ? { bg: colors.accent, border: colors.accent, text: colors.accentText }
      : variant === "danger"
        ? { bg: colors.dangerSoft, border: "transparent", text: colors.danger }
        : variant === "ghost"
          ? {
              bg: "transparent",
              border: colors.border,
              text: colors.textSecondary,
            }
          : variant === "accentSoft"
            ? {
                bg: colors.accentSoft,
                border: "transparent",
                text: colors.accent,
              }
            : {
                bg: colors.bgSoft,
                border: colors.border,
                text: colors.text,
              };

  return (
    <Animated.View style={[{ transform: [{ scale }] }, props.style]}>
      <Pressable
        disabled={props.disabled}
        onPress={props.onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        accessibilityRole="button"
        accessibilityLabel={props.accessibilityLabel ?? props.title}
        accessibilityState={{ disabled: Boolean(props.disabled) }}
        style={({ pressed }) => [
          styles.btn,
          props.compact && styles.btnCompact,
          {
            backgroundColor: palette.bg,
            borderColor: palette.border,
            opacity: props.disabled ? 0.45 : pressed ? 0.88 : 1,
          },
        ]}
      >
        <Text
          style={[
            styles.btnText,
            props.compact && styles.btnTextCompact,
            { color: palette.text },
          ]}
          numberOfLines={1}
        >
          {props.title}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

export function Chip(props: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.chip,
        props.selected && {
          backgroundColor: colors.accentSoft,
          borderColor: colors.accentBorder,
        },
        pressed && { opacity: 0.7, backgroundColor: colors.bgHover },
      ]}
    >
      <Text
        style={[styles.chipText, props.selected && { color: colors.accent }]}
        numberOfLines={1}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

/** iOS-style segmented control for 2–5 options */
export function Segmented(props: {
  options: Array<{ key: string; label: string }>;
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <View style={styles.segmentTrack}>
      {props.options.map((o) => {
        const on = o.key === props.value;
        return (
          <Pressable
            key={o.key}
            onPress={() => props.onChange(o.key)}
            style={({ pressed }) => [
              styles.segmentItem,
              on && styles.segmentItemOn,
              pressed && { opacity: 0.7, backgroundColor: colors.bgHover },
            ]}
          >
            <Text
              style={[styles.segmentText, on && styles.segmentTextOn]}
              numberOfLines={1}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function StatusPill(props: {
  state: "online" | "reconnecting" | "offline";
  label: string;
}) {
  const tone =
    props.state === "online"
      ? { dot: colors.online, bg: colors.onlineSoft, text: colors.online }
      : props.state === "reconnecting"
        ? { dot: colors.warn, bg: colors.warnSoft, text: colors.warn }
        : { dot: colors.danger, bg: colors.dangerSoft, text: colors.danger };
  return (
    <View style={[styles.pill, { backgroundColor: tone.bg }]}>
      <View style={[styles.pillDot, { backgroundColor: tone.dot }]} />
      <Text style={[styles.pillText, { color: tone.text }]} numberOfLines={1}>
        {props.label}
      </Text>
    </View>
  );
}

export function Badge(props: {
  label: string;
  tone?: "neutral" | "accent" | "ok" | "warn" | "danger";
}) {
  const tone = props.tone ?? "neutral";
  const map = {
    neutral: { bg: colors.bgSoft, text: colors.textSecondary },
    accent: { bg: colors.accentSoft, text: colors.accent },
    ok: { bg: colors.onlineSoft, text: colors.online },
    warn: { bg: colors.warnSoft, text: colors.warn },
    danger: { bg: colors.dangerSoft, text: colors.danger },
  }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: map.bg }]}>
      <Text style={[styles.badgeText, { color: map.text }]} numberOfLines={1}>
        {props.label}
      </Text>
    </View>
  );
}

export function Card(props: {
  children: ReactNode;
  style?: ViewStyle;
  glow?: boolean;
  flush?: boolean;
}) {
  return (
    <View
      style={[
        styles.card,
        props.flush && styles.cardFlush,
        props.glow && { borderColor: colors.accentBorderSoft },
        props.style,
      ]}
    >
      {props.children}
    </View>
  );
}

export function ScreenHeader(props: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.screenHeader}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.screenTitle}>{props.title}</Text>
        {props.subtitle ? (
          <Text style={styles.screenSubtitle} numberOfLines={2}>
            {props.subtitle}
          </Text>
        ) : null}
      </View>
      {props.action}
    </View>
  );
}

export function ListRow(props: {
  title: string;
  subtitle?: string;
  meta?: string;
  badge?: string;
  badgeTone?: "neutral" | "accent" | "ok" | "warn" | "danger";
  onPress?: () => void;
  right?: ReactNode;
  last?: boolean;
  leading?: ReactNode;
}) {
  const body = (
    <View style={[styles.listRow, !props.last && styles.listRowBorder]}>
      {props.leading}
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <View style={styles.listRowTop}>
          <Text style={styles.listRowTitle} numberOfLines={2}>
            {props.title}
          </Text>
          {props.badge ? (
            <Badge label={props.badge} tone={props.badgeTone} />
          ) : null}
        </View>
        {props.subtitle ? (
          <Text style={styles.listRowSub} numberOfLines={2}>
            {props.subtitle}
          </Text>
        ) : null}
        {props.meta ? (
          <Text style={styles.listRowMeta} numberOfLines={1}>
            {props.meta}
          </Text>
        ) : null}
      </View>
      {props.right}
      {props.onPress && !props.right ? (
        <Icon name="chevron" size={18} color={colors.textFaint} />
      ) : null}
    </View>
  );
  if (props.onPress) {
    return (
      <Pressable
        onPress={props.onPress}
        style={({ pressed }) => [
          { opacity: pressed ? 0.72 : 1 },
          pressed && { backgroundColor: colors.bgSoft },
        ]}
      >
        {body}
      </Pressable>
    );
  }
  return body;
}

export function ToggleRow(props: {
  title: string;
  subtitle?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  last?: boolean;
}) {
  return (
    <View style={[styles.toggleRow, !props.last && styles.listRowBorder]}>
      <View style={{ flex: 1, minWidth: 0, paddingRight: space.md }}>
        <Text style={styles.listRowTitle}>{props.title}</Text>
        {props.subtitle ? (
          <Text style={styles.listRowSub}>{props.subtitle}</Text>
        ) : null}
      </View>
      <Switch
        value={props.value}
        onValueChange={props.onChange}
        trackColor={{ false: colors.bgSoft, true: colors.accentStrong }}
        thumbColor={props.value ? colors.accent : colors.textMuted}
        ios_backgroundColor={colors.bgSoft}
      />
    </View>
  );
}

export function Field(props: TextInputProps & { label?: string }) {
  const { label, style, onFocus, onBlur, ...rest } = props;
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.fieldWrap}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <TextInput
        keyboardAppearance="dark"
        placeholderTextColor={colors.textMuted}
        {...rest}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[
          styles.input,
          focused && styles.inputFocused,
          style,
        ]}
      />
    </View>
  );
}

export function EmptyState(props: {
  title: string;
  body?: string;
  action?: ReactNode;
  glyph?: string;
}) {
  return (
    <View style={styles.empty}>
      {props.glyph ? (
        <View style={styles.emptyGlyphWrap}>
          <Text style={styles.emptyGlyph}>{props.glyph}</Text>
        </View>
      ) : (
        <View style={styles.emptyMark} />
      )}
      <Text style={styles.emptyTitle}>{props.title}</Text>
      {props.body ? <Text style={styles.emptyBody}>{props.body}</Text> : null}
      {props.action ? (
        <View style={styles.emptyAction}>{props.action}</View>
      ) : null}
    </View>
  );
}

/** Compact floating toast — absolutely positioned overlay (PM-6). */
export function ToastBar(props: {
  message: string;
  tone?: "neutral" | "ok" | "warn" | "danger";
  onDismiss?: () => void;
  /** Optional action button (DS-12). */
  actionLabel?: string;
  onAction?: () => void;
}) {
  const tone = props.tone ?? "neutral";
  const map = {
    neutral: {
      bg: colors.bgElevated,
      border: colors.borderStrong,
      text: colors.textSecondary,
    },
    ok: {
      bg: colors.onlineSoft,
      border: colors.okBorder,
      text: colors.online,
    },
    warn: {
      bg: colors.warnSoft,
      border: colors.warnBorder,
      text: colors.warn,
    },
    danger: {
      bg: colors.dangerSoft,
      border: colors.dangerBorder,
      text: colors.danger,
    },
  }[tone];
  return (
    <Pressable
      onPress={props.onDismiss}
      style={({ pressed }) => [
        styles.toast,
        { backgroundColor: map.bg, borderColor: map.border },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={[styles.toastText, { color: map.text }]} numberOfLines={2}>
        {props.message}
      </Text>
      {props.actionLabel && props.onAction ? (
        <Pressable
          onPress={props.onAction}
          hitSlop={8}
          style={styles.toastAction}
        >
          <Text style={[styles.toastActionText, { color: map.text }]}>
            {props.actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

/** Persistent top banner (approvals / offline) — kit primitive (DS-12). */
export function Banner(props: {
  message: string;
  tone?: "neutral" | "ok" | "warn" | "danger";
  actionLabel?: string;
  onAction?: () => void;
  dismissLabel?: string;
  onDismiss?: () => void;
}) {
  const tone = props.tone ?? "warn";
  const map = {
    neutral: {
      bg: colors.bgElevated,
      border: colors.borderStrong,
      text: colors.textSecondary,
    },
    ok: {
      bg: colors.onlineSoft,
      border: colors.okBorder,
      text: colors.online,
    },
    warn: {
      bg: colors.warnSoft,
      border: colors.warnBorder,
      text: colors.warn,
    },
    danger: {
      bg: colors.dangerSoft,
      border: colors.dangerBorder,
      text: colors.danger,
    },
  }[tone];
  return (
    <View
      style={[
        styles.banner,
        { backgroundColor: map.bg, borderColor: map.border },
      ]}
    >
      <View style={[styles.bannerDot, { backgroundColor: map.text }]} />
      <View style={{ flex: 1, gap: space.sm }}>
        <Text style={[styles.bannerText, { color: map.text }]} numberOfLines={3}>
          {props.message}
        </Text>
        {(props.actionLabel || props.dismissLabel) && (
          <View style={styles.bannerActions}>
            {props.actionLabel && props.onAction ? (
              <Btn
                compact
                variant="primary"
                title={props.actionLabel}
                onPress={props.onAction}
              />
            ) : null}
            {props.dismissLabel && props.onDismiss ? (
              <Btn
                compact
                variant="ghost"
                title={props.dismissLabel}
                onPress={props.onDismiss}
              />
            ) : null}
          </View>
        )}
      </View>
    </View>
  );
}

/** Shared hero mark for pair + unlock (DS-12). */
export function HeroMark(props: {
  children?: ReactNode;
  size?: number;
}) {
  const size = props.size ?? 68;
  return (
    <View style={styles.heroRing}>
      <View
        style={[
          styles.heroMark,
          {
            width: size,
            height: size,
            borderRadius: radius.lg,
          },
        ]}
      >
        {props.children}
      </View>
    </View>
  );
}

export function IconBubble(props: {
  glyph?: string;
  tone?: "accent" | "ok" | "warn" | "danger" | "neutral";
  size?: number;
  children?: ReactNode;
}) {
  const size = props.size ?? 44;
  const tone = props.tone ?? "accent";
  const bg =
    tone === "ok"
      ? colors.onlineSoft
      : tone === "warn"
        ? colors.warnSoft
        : tone === "danger"
          ? colors.dangerSoft
          : tone === "neutral"
            ? colors.bgSoft
            : colors.accentSoft;
  const fg =
    tone === "ok"
      ? colors.online
      : tone === "warn"
        ? colors.warn
        : tone === "danger"
          ? colors.danger
          : tone === "neutral"
            ? colors.textSecondary
            : colors.accent;
  return (
    <View
      style={[
        styles.iconBubble,
        {
          width: size,
          height: size,
          borderRadius: radius.lg,
          backgroundColor: bg,
        },
      ]}
    >
      {props.children ?? (
        <Text style={{ color: fg, fontSize: size * 0.4, fontWeight: "700" }}>
          {props.glyph}
        </Text>
      )}
    </View>
  );
}

export function SectionTitle(props: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionTitle}>{props.title}</Text>
      {props.action}
    </View>
  );
}

export function GroupLabel(props: { children: string }) {
  return <Text style={styles.groupLabel}>{props.children}</Text>;
}

export function BusyOverlay(props: { show: boolean }) {
  if (!props.show) return null;
  return (
    <View style={styles.busy} pointerEvents="none">
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}

/** Horizontal pill nav for secondary destinations */
export function MoreNav(props: {
  items: Array<{ key: string; label: string }>;
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.moreNav}
    >
      {props.items.map((item) => (
        <Chip
          key={item.key}
          label={item.label}
          selected={props.active === item.key}
          onPress={() => props.onChange(item.key)}
        />
      ))}
    </ScrollView>
  );
}

export function StatStrip(props: {
  items: Array<{ label: string; value: string }>;
}) {
  return (
    <View style={styles.statStrip}>
      {props.items.map((it, i) => (
        <View
          key={it.label}
          style={[styles.statCell, i > 0 && styles.statCellBorder]}
        >
          <Text style={styles.statValue} numberOfLines={1}>
            {it.value}
          </Text>
          <Text style={styles.statLabel} numberOfLines={1}>
            {it.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 50,
  },
  btnCompact: {
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    minHeight: 44,
    borderRadius: radius.sm,
  },
  btnText: { ...type.label },
  btnTextCompact: { ...type.caption, fontWeight: "600" },
  chip: {
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    minHeight: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.bgSoft,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: "center",
  },
  chipText: { ...type.caption, color: colors.textSecondary, fontWeight: "600" },
  segmentTrack: {
    flexDirection: "row",
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    padding: space.xs,
    borderWidth: 1,
    borderColor: colors.border,
    gap: space.xs,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: space.sm,
    borderRadius: radius.sm,
    alignItems: "center",
    minHeight: 44,
    justifyContent: "center",
  },
  segmentItemOn: {
    backgroundColor: colors.bgSoft,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  segmentText: {
    ...type.caption,
    color: colors.textMuted,
    fontWeight: "600",
  },
  segmentTextOn: { color: colors.text },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
  },
  pillDot: { width: 8, height: 8, borderRadius: radius.pill },
  pillText: {
    ...type.micro,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  badge: {
    paddingVertical: space.xs,
    paddingHorizontal: space.sm,
    borderRadius: radius.pill,
  },
  badgeText: {
    ...type.micro,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    padding: space.xl,
    marginBottom: space.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardFlush: { paddingHorizontal: 0, paddingVertical: space.sm },
  screenHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.md,
    marginBottom: space.lg,
  },
  screenTitle: { ...type.title, color: colors.text },
  screenSubtitle: {
    ...type.caption,
    color: colors.textMuted,
    marginTop: 4,
    lineHeight: 18,
  },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: 14,
    paddingHorizontal: space.xl,
    minHeight: 56,
  },
  listRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  listRowTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    flexWrap: "wrap",
  },
  listRowTitle: {
    ...type.body,
    color: colors.text,
    fontWeight: "600",
    flexShrink: 1,
  },
  listRowSub: {
    ...type.caption,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  listRowMeta: { ...type.micro, color: colors.textMuted },
  chevron: {
    color: colors.textFaint,
    ...type.glyphMd,
    fontWeight: "300",
    marginLeft: space.xs,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: space.xl,
    minHeight: 56,
  },
  fieldWrap: { marginBottom: space.md },
  fieldLabel: {
    ...type.micro,
    color: colors.textMuted,
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    color: colors.text,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    minHeight: 52,
  },
  empty: {
    alignItems: "center",
    paddingVertical: space.xxl,
    paddingHorizontal: space.lg,
  },
  emptyMark: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    marginBottom: space.md,
  },
  emptyGlyphWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: colors.bgSoft,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: space.md,
  },
  emptyGlyph: {
    ...type.glyphMd,
    color: colors.textMuted,
  },
  emptyTitle: {
    ...type.section,
    color: colors.textSecondary,
    textAlign: "center",
  },
  emptyBody: {
    ...type.caption,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: 6,
    lineHeight: 18,
  },
  emptyAction: { marginTop: space.lg },
  toast: {
    position: "absolute",
    left: space.lg,
    right: space.lg,
    top: space.sm,
    zIndex: 50,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    ...{
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.22,
      shadowRadius: 10,
      elevation: 8,
    },
  },
  toastText: {
    ...type.caption,
    textAlign: "center",
    lineHeight: 18,
    fontWeight: "600",
  },
  toastAction: {
    marginTop: space.sm,
    alignSelf: "center",
    paddingVertical: space.xs,
  },
  toastActionText: {
    ...type.caption,
    fontWeight: "700",
    textDecorationLine: "underline",
  },
  banner: {
    marginHorizontal: space.lg,
    marginBottom: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.md,
  },
  bannerDot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    marginTop: 6,
  },
  bannerText: {
    ...type.caption,
    fontWeight: "600",
    lineHeight: 18,
  },
  bannerActions: {
    flexDirection: "row",
    gap: space.sm,
    flexWrap: "wrap",
  },
  heroRing: {
    padding: 3,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.accentBorderSoft,
    marginBottom: space.lg,
  },
  heroMark: {
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  iconBubble: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  inputFocused: {
    borderColor: colors.accentStrong,
    backgroundColor: colors.bgElevated,
  },
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: space.md,
  },
  sectionTitle: { ...type.section, color: colors.text },
  groupLabel: {
    ...type.micro,
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: space.sm,
    marginTop: space.sm,
    paddingHorizontal: 4,
  },
  busy: { position: "absolute", top: 8, right: 16 },
  moreNav: {
    flexDirection: "row",
    gap: space.sm,
    paddingBottom: space.md,
  },
  statStrip: {
    flexDirection: "row",
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    marginBottom: space.md,
  },
  statCell: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: "center",
  },
  statCellBorder: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.border,
  },
  statValue: {
    ...type.section,
    color: colors.text,
    fontVariant: ["tabular-nums"],
  },
  statLabel: {
    ...type.micro,
    color: colors.textMuted,
    marginTop: space.xs,
    textTransform: "uppercase",
  },
});
