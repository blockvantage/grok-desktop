/**
 * Lightweight motion primitives — skeleton pulse, fade-in, success check.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import { colors, radius, space } from "./theme";

/** UX-5: respect Reduce Motion. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled?.().then((v) => {
      if (mounted) setReduced(Boolean(v));
    });
    const sub = AccessibilityInfo.addEventListener?.(
      "reduceMotionChanged",
      (v: boolean) => setReduced(Boolean(v)),
    );
    return () => {
      mounted = false;
      try {
        const s = sub as { remove?: () => void } | undefined;
        s?.remove?.();
      } catch {
        /* ignore */
      }
    };
  }, []);
  return reduced;
}

export function usePulse(active = true) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    if (!active || reduced) {
      v.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, {
          toValue: 0.85,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(v, {
          toValue: 0.35,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, reduced, v]);
  return v;
}

export function Skeleton(props: {
  height?: number;
  width?: number | `${number}%`;
  style?: ViewStyle;
  round?: boolean;
}) {
  const opacity = usePulse(true);
  return (
    <Animated.View
      style={[
        styles.skel,
        {
          height: props.height ?? 14,
          width: props.width ?? "100%",
          borderRadius: props.round ? radius.pill : radius.sm,
          opacity,
        },
        props.style,
      ]}
    />
  );
}

export function SkeletonList(props: { rows?: number }) {
  const n = props.rows ?? 4;
  return (
    <View style={styles.skelList}>
      {Array.from({ length: n }).map((_, i) => (
        <View key={i} style={styles.skelRow}>
          <Skeleton height={16} width="58%" />
          <Skeleton height={12} width="82%" style={{ marginTop: 8 }} />
          <Skeleton height={10} width="36%" style={{ marginTop: 8 }} />
        </View>
      ))}
    </View>
  );
}

export function FadeIn(props: {
  children: ReactNode;
  delay?: number;
  style?: ViewStyle;
}) {
  const reduced = useReducedMotion();
  const opacity = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const translate = useRef(new Animated.Value(reduced ? 0 : 8)).current;
  useEffect(() => {
    if (reduced) {
      opacity.setValue(1);
      translate.setValue(0);
      return;
    }
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 320,
        delay: props.delay ?? 0,
        useNativeDriver: true,
      }),
      Animated.timing(translate, {
        toValue: 0,
        duration: 360,
        delay: props.delay ?? 0,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, translate, props.delay, reduced]);
  return (
    <Animated.View
      style={[
        props.style,
        { opacity, transform: [{ translateY: translate }] },
      ]}
    >
      {props.children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  skel: {
    backgroundColor: colors.bgSoft,
  },
  skelList: {
    paddingVertical: space.sm,
  },
  skelRow: {
    paddingVertical: 14,
    paddingHorizontal: space.xl,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
});
