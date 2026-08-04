/**
 * Camera QR scanner for pairing. Auto-starts, full-bleed friendly, no raw code UI.
 * UX-2: permanent camera denial offers Open Settings + always shows paste fallback.
 */
import { useEffect, useState } from "react";
import { Linking, Platform, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useI18n } from "../i18n";
import { Btn } from "../ui/components";
import { colors, radius, space, type } from "../ui/theme";

export function PairQrScanner(props: {
  onScan: (data: string) => void;
  enabled: boolean;
  /** Start camera immediately (pair screen). */
  autoStart?: boolean;
  /** Edge-to-edge inside parent card. */
  fullBleed?: boolean;
  onCancel?: () => void;
  /** Always-available paste path when camera is blocked (UX-2). */
  onPaste?: () => void;
}) {
  const { t } = useI18n();
  const [permission, requestPermission] = useCameraPermissions();
  const [active, setActive] = useState(Boolean(props.autoStart));
  const [scanned, setScanned] = useState(false);

  useEffect(() => {
    if (!props.enabled) {
      setActive(false);
      setScanned(false);
      return;
    }
    if (props.autoStart) {
      setActive(true);
      setScanned(false);
    }
  }, [props.enabled, props.autoStart]);

  if (Platform.OS === "web") {
    return <Text style={styles.hint}>{t("pair.webNoCamera")}</Text>;
  }

  if (!permission) {
    return (
      <View style={styles.box}>
        <ActivityPlaceholder label={t("pair.cameraNeeded")} />
      </View>
    );
  }

  if (!permission.granted) {
    const canAskAgain = permission.canAskAgain !== false;
    return (
      <View style={[styles.box, props.fullBleed && styles.boxPad]}>
        <Text style={styles.hint}>
          {canAskAgain
            ? t("pair.cameraNeeded")
            : t("pair.cameraDeniedPermanent")}
        </Text>
        {canAskAgain ? (
          <Btn
            compact
            variant="accentSoft"
            title={t("pair.allowCamera")}
            onPress={() => void requestPermission()}
          />
        ) : (
          <Btn
            compact
            variant="accentSoft"
            title={t("pair.openSettings")}
            onPress={() => void Linking.openSettings()}
          />
        )}
        {props.onPaste ? (
          <Btn
            compact
            variant="secondary"
            title={t("pair.pasteClipboard")}
            onPress={props.onPaste}
          />
        ) : null}
        {props.onCancel ? (
          <Btn
            compact
            variant="ghost"
            title={t("pair.cancelScan")}
            onPress={props.onCancel}
          />
        ) : null}
      </View>
    );
  }

  if (!active) {
    return (
      <Btn
        variant="primary"
        title={t("pair.scanQr")}
        onPress={() => {
          setScanned(false);
          setActive(true);
        }}
      />
    );
  }

  return (
    <View style={[styles.cameraWrap, props.fullBleed && styles.cameraWrapBleed]}>
      <View style={[styles.cameraFrame, props.fullBleed && styles.cameraFrameBleed]}>
        <CameraView
          style={styles.camera}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={
            scanned
              ? undefined
              : ({ data }) => {
                  if (
                    typeof data === "string" &&
                    data.includes("grokdesk://pair")
                  ) {
                    setScanned(true);
                    setActive(false);
                    props.onScan(data.trim());
                  }
                }
          }
        />
        <View style={styles.vignette} pointerEvents="none" />
        <View style={styles.scanCornerTL} />
        <View style={styles.scanCornerTR} />
        <View style={styles.scanCornerBL} />
        <View style={styles.scanCornerBR} />
        <Text style={styles.overlayHint}>{t("pair.scanOverlay")}</Text>
      </View>
      {(props.onCancel || !props.autoStart) && (
        <Btn
          compact
          variant="ghost"
          title={t("pair.cancelScan")}
          onPress={() => {
            setActive(false);
            props.onCancel?.();
          }}
          style={styles.cancel}
        />
      )}
    </View>
  );
}

function ActivityPlaceholder(props: { label: string }) {
  return <Text style={styles.hint}>{props.label}</Text>;
}

const corner = {
  position: "absolute" as const,
  width: 28,
  height: 28,
  borderColor: colors.accent,
};

const styles = StyleSheet.create({
  box: { gap: space.sm, marginBottom: space.md },
  boxPad: { padding: space.lg },
  hint: {
    ...type.caption,
    color: colors.textMuted,
    marginBottom: space.sm,
    lineHeight: 18,
    textAlign: "center",
  },
  cameraWrap: { gap: space.sm, marginBottom: space.md },
  cameraWrapBleed: { marginBottom: 0, gap: 0 },
  cameraFrame: {
    borderRadius: radius.lg,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.borderStrong,
    height: 280,
    backgroundColor: colors.deskBlack,
  },
  cameraFrameBleed: {
    borderRadius: 0,
    borderWidth: 0,
    height: 340,
  },
  camera: { width: "100%", height: "100%" },
  vignette: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.12)",
  },
  overlayHint: {
    position: "absolute",
    bottom: 20,
    left: 20,
    right: 20,
    textAlign: "center",
    ...type.caption,
    color: "rgba(215,230,255,0.9)",
    fontWeight: "600",
  },
  scanCornerTL: {
    ...corner,
    top: 22,
    left: 22,
    borderTopWidth: 3,
    borderLeftWidth: 3,
  },
  scanCornerTR: {
    ...corner,
    top: 22,
    right: 22,
    borderTopWidth: 3,
    borderRightWidth: 3,
  },
  scanCornerBL: {
    ...corner,
    bottom: 22,
    left: 22,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
  },
  scanCornerBR: {
    ...corner,
    bottom: 22,
    right: 22,
    borderBottomWidth: 3,
    borderRightWidth: 3,
  },
  cancel: {
    margin: space.md,
    alignSelf: "center",
  },
});
