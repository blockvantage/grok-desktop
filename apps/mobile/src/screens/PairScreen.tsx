/**
 * Phone-first pairing: scan QR or paste from clipboard — never show the raw code.
 * UX-9: real progress steps + cancel. PM-12: success choreography.
 * PM-8: clipboard gated on hasStringAsync.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  AppState,
  Easing,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { useI18n } from "../i18n";
import { PairQrScanner } from "../components/PairQrScanner";
import { haptic } from "../lib/haptics";
import { Btn, Card, HeroMark } from "../ui/components";
import { Icon } from "../ui/Icon";
import { FadeIn } from "../ui/motion";
import { colors, radius, space, type as typo } from "../ui/theme";

function extractPairPayload(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const idx = t.indexOf("grokdesk://pair/");
  if (idx >= 0) {
    const slice = t.slice(idx).split(/\s/)[0] ?? "";
    return slice.startsWith("grokdesk://pair/") ? slice : null;
  }
  if (/^[A-Za-z0-9_-]{40,}$/.test(t) && !t.includes(" ")) {
    return `grokdesk://pair/${t}`;
  }
  return null;
}

export type PairStep = 0 | 1 | 2 | 3;

export function PairScreen(props: {
  busy: boolean;
  status?: string;
  /** Structured tone so localized errors still style as error (UX-10). */
  statusKind?: "error" | "info";
  /** Real milestone 0=idle 1=secure 2=relay 3=desk (UX-9). */
  pairStep?: PairStep;
  onPair: (payload: string) => void | Promise<void>;
  onCancelPair?: () => void;
}) {
  const { t } = useI18n();
  const [scanning, setScanning] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const lastAttempt = useRef<string | null>(null);
  const pairing = props.busy;
  const pairStep = props.pairStep ?? (pairing ? 1 : 0);
  const checkScale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (pairStep >= 3 && !pairing) {
      checkScale.setValue(0);
      Animated.spring(checkScale, {
        toValue: 1,
        friction: 5,
        tension: 80,
        useNativeDriver: true,
      }).start();
    }
  }, [pairStep, pairing, checkScale]);

  const tryPair = useCallback(
    (raw: string, source: "scan" | "clipboard") => {
      const payload = extractPairPayload(raw);
      if (!payload) {
        if (source === "clipboard") {
          void haptic("warning");
          setHint(t("pair.clipboardEmpty"));
        }
        return;
      }
      if (lastAttempt.current === payload && pairing) return;
      lastAttempt.current = payload;
      setHint(null);
      setScanning(false);
      void haptic(source === "scan" ? "medium" : "selection");
      void props.onPair(payload);
    },
    [pairing, props, t],
  );

  const pasteAndPair = useCallback(async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (!text?.trim()) {
        void haptic("warning");
        setHint(t("pair.clipboardEmpty"));
        return;
      }
      tryPair(text, "clipboard");
    } catch {
      void haptic("error");
      setHint(t("pair.clipboardFailed"));
    }
  }, [t, tryPair]);

  const checkClipboard = useCallback(async () => {
    if (pairing) return;
    try {
      const has =
        typeof Clipboard.hasStringAsync === "function"
          ? await Clipboard.hasStringAsync()
          : true;
      if (!has) return;
      const text = await Clipboard.getStringAsync();
      const payload = extractPairPayload(text ?? "");
      if (payload && payload !== lastAttempt.current) {
        setHint(t("pair.clipboardDetected"));
        tryPair(payload, "clipboard");
      }
    } catch {
      /* ignore */
    }
  }, [pairing, t, tryPair]);

  useEffect(() => {
    void checkClipboard();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void checkClipboard();
    });
    return () => sub.remove();
  }, [checkClipboard]);

  const statusLooksError =
    props.statusKind === "error" ||
    !!hint?.toLowerCase().match(/fail|error|empty|couldn/) ||
    !!props.status?.toLowerCase().match(
      /fail|error|timeout|expired|revoked|unreachable|not allowed|offline|invalid/,
    );

  const steps = [
    t("pair.stepSecure"),
    t("pair.stepRelay"),
    t("pair.stepDesk"),
  ];

  return (
    <FadeIn style={styles.wrap}>
      <View style={styles.hero}>
        <HeroMark>
          {pairStep >= 3 && !pairing ? (
            <Animated.View style={{ transform: [{ scale: checkScale }] }}>
              <Icon name="ok" size={28} color={colors.online} />
            </Animated.View>
          ) : (
            <Icon name="mark" size={28} color={colors.accent} />
          )}
        </HeroMark>
        <Text style={styles.kicker}>{t("pair.kicker")}</Text>
        <Text style={styles.title}>{t("pair.title")}</Text>
        <Text style={styles.subtitle}>{t("pair.hint")}</Text>
      </View>

      <Card glow style={styles.card}>
        {pairing ? (
          <View style={styles.busyBox}>
            <View style={styles.busyPulse}>
              <ActivityIndicator size="large" color={colors.accent} />
            </View>
            <Text style={styles.busyTitle}>{t("pair.pairing")}</Text>
            <Text style={styles.busyBody}>{t("pair.pairingHint")}</Text>
            <View style={styles.steps}>
              {steps.map((step, i) => {
                const n = i + 1;
                const done = pairStep > n;
                const active = pairStep === n;
                return (
                  <View key={step} style={styles.stepRow}>
                    <View
                      style={[
                        styles.stepDot,
                        done && styles.stepDotDone,
                        active && styles.stepDotActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.stepNum,
                          (done || active) && styles.stepNumOn,
                        ]}
                      >
                        {done ? "✓" : String(n)}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.stepText,
                        (done || active) && styles.stepTextOn,
                      ]}
                    >
                      {step}
                    </Text>
                  </View>
                );
              })}
            </View>
            {props.onCancelPair ? (
              <Btn
                compact
                variant="ghost"
                title={t("pair.cancelPair")}
                onPress={() => {
                  void haptic("selection");
                  props.onCancelPair?.();
                }}
                style={{ marginTop: space.md }}
              />
            ) : null}
          </View>
        ) : scanning ? (
          <View style={styles.scanBox}>
            <PairQrScanner
              enabled
              autoStart
              fullBleed
              onScan={(data) => tryPair(data, "scan")}
              onPaste={() => void pasteAndPair()}
              onCancel={() => {
                void haptic("selection");
                setScanning(false);
              }}
            />
          </View>
        ) : (
          <View style={styles.actions}>
            {Platform.OS !== "web" ? (
              <Btn
                variant="primary"
                title={t("pair.scanQr")}
                onPress={() => {
                  void haptic("selection");
                  setHint(null);
                  setScanning(true);
                }}
                style={styles.primaryBtn}
              />
            ) : (
              <Text style={styles.webNote}>{t("pair.webNoCamera")}</Text>
            )}
            <Btn
              variant="secondary"
              title={t("pair.pasteClipboard")}
              onPress={() => void pasteAndPair()}
              style={styles.secondaryBtn}
            />
            <Text style={styles.micro}>{t("pair.autoHint")}</Text>
          </View>
        )}

        {(hint || (props.status && !pairing)) && (
          <View
            style={[
              styles.feedback,
              statusLooksError && styles.feedbackErrBox,
            ]}
          >
            <Text
              style={[
                styles.feedbackText,
                statusLooksError && styles.feedbackError,
              ]}
            >
              {hint ?? props.status}
            </Text>
            {statusLooksError ? (
              <Text style={styles.checklist}>{t("pair.timeoutChecklist")}</Text>
            ) : null}
          </View>
        )}
      </Card>

      <Text style={styles.footer}>{t("pair.footer")}</Text>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  hero: {
    alignItems: "center",
    paddingTop: space.xl,
    paddingBottom: space.lg,
    paddingHorizontal: space.md,
  },
  kicker: {
    ...typo.micro,
    color: colors.accent,
    fontWeight: "700",
    letterSpacing: 1.8,
    textTransform: "uppercase",
    marginBottom: space.sm,
  },
  title: {
    ...typo.hero,
    color: colors.text,
    textAlign: "center",
    marginBottom: space.sm,
  },
  subtitle: {
    ...typo.body,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 23,
    maxWidth: 320,
  },
  card: { marginHorizontal: 0 },
  actions: { gap: space.md },
  primaryBtn: { minHeight: 54 },
  secondaryBtn: { minHeight: 50 },
  micro: {
    ...typo.caption,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 18,
    marginTop: space.xs,
  },
  webNote: {
    ...typo.caption,
    color: colors.textMuted,
    textAlign: "center",
    marginBottom: space.sm,
    lineHeight: 18,
  },
  busyBox: {
    alignItems: "center",
    paddingVertical: space.xl,
    gap: space.md,
  },
  busyPulse: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: space.sm,
  },
  busyTitle: { ...typo.section, color: colors.text },
  busyBody: {
    ...typo.caption,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 18,
    maxWidth: 280,
  },
  steps: {
    width: "100%",
    marginTop: space.md,
    gap: space.md,
    paddingHorizontal: space.sm,
  },
  stepRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  stepDot: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: colors.bgSoft,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  stepDotActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  stepDotDone: {
    borderColor: colors.online,
    backgroundColor: colors.onlineSoft,
  },
  stepNum: {
    ...typo.micro,
    color: colors.textMuted,
    fontWeight: "800",
  },
  stepNumOn: { color: colors.accent },
  stepText: {
    ...typo.caption,
    color: colors.textMuted,
    flex: 1,
  },
  stepTextOn: { color: colors.text, fontWeight: "600" },
  scanBox: {
    marginHorizontal: -space.xl,
    marginTop: -space.xl,
    marginBottom: -space.xl,
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  feedback: {
    marginTop: space.lg,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  feedbackErrBox: {
    marginHorizontal: -4,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
    borderTopWidth: 0,
  },
  feedbackText: {
    ...typo.caption,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 18,
  },
  feedbackError: { color: colors.danger, fontWeight: "600" },
  checklist: {
    ...typo.caption,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: space.sm,
    lineHeight: 18,
  },
  footer: {
    ...typo.micro,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: space.lg,
    lineHeight: 16,
    paddingHorizontal: space.lg,
  },
});
