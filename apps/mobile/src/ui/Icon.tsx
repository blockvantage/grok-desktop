/**
 * PM-5: Lucide icons sized/colored from theme tokens.
 * Desktop uses Lucide stroke 1.75 — mirror that on phone.
 */
import type { ComponentType } from "react";
import {
  CheckCircle2,
  ChevronRight,
  Diamond,
  Home,
  Inbox,
  List,
  Lock,
  Monitor,
  Settings,
  type LucideProps,
} from "lucide-react-native";
import { colors } from "./theme";

export type IconName =
  | "home"
  | "tasks"
  | "desk"
  | "inbox"
  | "settings"
  | "chevron"
  | "lock"
  | "mark"
  | "empty"
  | "ok";

const MAP: Record<IconName, ComponentType<LucideProps>> = {
  home: Home,
  tasks: List,
  desk: Monitor,
  inbox: Inbox,
  settings: Settings,
  chevron: ChevronRight,
  lock: Lock,
  mark: Diamond,
  empty: Inbox,
  ok: CheckCircle2,
};

export function Icon(props: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  const Cmp = MAP[props.name] ?? Diamond;
  return (
    <Cmp
      size={props.size ?? 20}
      color={props.color ?? colors.textMuted}
      strokeWidth={props.strokeWidth ?? 1.75}
    />
  );
}
