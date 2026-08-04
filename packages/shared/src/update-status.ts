/**
 * Shared update coordinator status surface for main ↔ renderer diagnostics.
 * Phase names match the synchronized Desk/Grok update state machine.
 */
import { z } from "zod";
import {
  CanonicalRuntimeTargetSchema,
  ReleaseChannelSchema,
} from "./compatibility-manifest.js";
import type { RuntimeTarget } from "./runtime-target.js";

export const UpdatePhaseSchema = z.enum([
  "idle",
  "checking",
  "available",
  "downloading",
  "verifying",
  "staged",
  "waiting_for_idle",
  "installing",
  "restarting",
  "post_update_verification",
  "committed",
  "error",
  "repair",
]);
export type UpdatePhase = z.infer<typeof UpdatePhaseSchema>;

/** Semver / id fields on the update status IPC surface. */
const VERSION_MAX = 64;
const PAIR_ID_MAX = 256;
const ERROR_CODE_MAX = 128;
const ERROR_MESSAGE_MAX = 2_000;
const ISO_TIME_MAX = 64;

export const InstalledPairStatusSchema = z.object({
  deskVersion: z.string().min(1).max(VERSION_MAX),
  grokVersion: z.string().min(1).max(VERSION_MAX),
});
export type InstalledPairStatus = z.infer<typeof InstalledPairStatusSchema>;

export const AvailablePairStatusSchema = z.object({
  pairId: z.string().min(1).max(PAIR_ID_MAX),
  deskVersion: z.string().min(1).max(VERSION_MAX),
  grokVersion: z.string().min(1).max(VERSION_MAX),
  channel: ReleaseChannelSchema,
  securityForced: z.boolean().optional(),
});
export type AvailablePairStatus = z.infer<typeof AvailablePairStatusSchema>;

export const UpdateProgressSchema = z.object({
  receivedBytes: z.number().nonnegative(),
  totalBytes: z.number().nonnegative().optional(),
  artifactKind: z.enum(["desk", "grok"]).optional(),
});
export type UpdateProgress = z.infer<typeof UpdateProgressSchema>;

export const UpdateErrorStatusSchema = z.object({
  code: z.string().min(1).max(ERROR_CODE_MAX),
  message: z.string().min(1).max(ERROR_MESSAGE_MAX),
});
export type UpdateErrorStatus = z.infer<typeof UpdateErrorStatusSchema>;

/** Renderer-safe security policy mode (main evaluates; renderer cannot set). */
export const UpdateSecurityModeSchema = z.enum([
  "normal",
  "security_warn",
  "security_block",
  "revocation_switch",
  "revocation_repair",
]);
export type UpdateSecurityMode = z.infer<typeof UpdateSecurityModeSchema>;

export const UpdateStatusSchema = z.object({
  phase: UpdatePhaseSchema,
  channel: ReleaseChannelSchema,
  target: z.union([CanonicalRuntimeTargetSchema, z.literal("unsupported")]),
  installed: InstalledPairStatusSchema.optional(),
  available: AvailablePairStatusSchema.optional(),
  progress: UpdateProgressSchema.optional(),
  error: UpdateErrorStatusSchema.optional(),
  lastCheckedAt: z.string().max(ISO_TIME_MAX).optional(),
  securityDeadline: z.string().max(ISO_TIME_MAX).nullable().optional(),
  /** Main-evaluated security mode; renderer may display only. */
  securityMode: UpdateSecurityModeSchema.optional(),
  manifestSequence: z.number().int().nonnegative().optional(),
});
export type UpdateStatus = z.infer<typeof UpdateStatusSchema>;

export function parseUpdateStatus(input: unknown): UpdateStatus {
  return UpdateStatusSchema.parse(input);
}

export function idleUpdateStatus(args: {
  channel: z.infer<typeof ReleaseChannelSchema>;
  target: RuntimeTarget;
  installed?: InstalledPairStatus;
}): UpdateStatus {
  return {
    phase: "idle",
    channel: args.channel,
    target: args.target,
    installed: args.installed,
  };
}
