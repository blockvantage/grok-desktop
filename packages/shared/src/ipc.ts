import { z } from "zod";
import { partialAppSettingsSchema } from "./settings-schema.js";

export const TaskAttachmentSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(512),
  sourcePath: z.string().min(1).max(4096),
  kind: z.enum(["image", "file", "audio"]),
  stagedPath: z.string().max(4096).optional(),
  mime: z.string().max(128).optional(),
  sizeBytes: z.number().nonnegative().max(100 * 1024 * 1024).optional(),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});

/** Shared optional idempotency key for queueable mutations. */
export const ClientMutationIdSchema = z
  .string()
  .min(1)
  .max(128)
  .optional();

/** Required stable mutation / outbox id (same value as clientMutationId). */
export const RequiredClientMutationIdSchema = z.string().min(1).max(128);

/** Gateway-owned follow-up outbox lifecycle. */
export const OutboxStatusSchema = z.enum([
  "pending",
  "submitting",
  "blocked_missing_attachment",
  "failed",
  "accepted",
  "delivered",
  "cancelled",
]);
export type OutboxStatus = z.infer<typeof OutboxStatusSchema>;

export const ConversationOutboxItemSchema = z.object({
  id: z.string().min(1).max(128),
  conversationId: z.string().min(1).max(128),
  parentTaskId: z.string().min(1).max(128),
  text: z.string().min(1).max(100_000),
  attachments: z.array(TaskAttachmentSchema).max(10),
  status: OutboxStatusSchema,
  /** Pending position within this conversation (1-based); null when not pending. */
  position: z.number().int().positive().nullable(),
  acceptedTaskId: z.string().min(1).max(128).nullable(),
  attemptCount: z.number().int().nonnegative(),
  failReason: z.string().max(2_000).nullable(),
  /** Optional edit-and-resubmit lineage (revision of a prior task). */
  revisionOfTaskId: z.string().min(1).max(128).nullable().optional(),
  createdAt: z.string().min(1).max(64),
  updatedAt: z.string().min(1).max(64),
});
export type ConversationOutboxItem = z.infer<typeof ConversationOutboxItemSchema>;

export const OutboxEnqueueResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("accepted"),
    item: ConversationOutboxItemSchema,
  }),
  z.object({
    outcome: z.literal("full"),
    limit: z.number().int().positive(),
  }),
  z.object({
    outcome: z.literal("persistence_failed"),
    message: z.string().min(1).max(500),
  }),
]);
export type OutboxEnqueueResult = z.infer<typeof OutboxEnqueueResultSchema>;

export const OutboxEnqueueParamsSchema = z.object({
  id: RequiredClientMutationIdSchema,
  conversationId: z.string().min(1).max(128),
  parentTaskId: z.string().min(1).max(128),
  text: z.string().min(1).max(100_000),
  attachments: z.array(TaskAttachmentSchema).max(10).default([]),
  revisionOfTaskId: z.string().min(1).max(128).optional(),
});
export type OutboxEnqueueParams = z.infer<typeof OutboxEnqueueParamsSchema>;

export const OutboxListParamsSchema = z.object({
  conversationId: z.string().min(1).max(128).optional(),
  /** When true, include terminal receipt rows (accepted/delivered/cancelled). */
  includeTerminal: z.boolean().optional().default(false),
});

export const OutboxUpdateParamsSchema = z.object({
  id: RequiredClientMutationIdSchema,
  text: z.string().min(1).max(100_000).optional(),
  attachments: z.array(TaskAttachmentSchema).max(10).optional(),
});

export const OutboxIdParamsSchema = z.object({
  id: RequiredClientMutationIdSchema,
});

export const OutboxSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  byStatus: z.record(z.string(), z.number().int().nonnegative()),
  oldestPendingAgeMs: z.number().int().nonnegative().nullable(),
});
export type OutboxSummary = z.infer<typeof OutboxSummarySchema>;

export const CreateTaskInputSchema = z.object({
  // Cap free-form goals so a runaway client cannot flood SQLite / engine IPC.
  goal: z.string().min(1).max(100_000),
  mode: z.enum(["interactive", "scheduled", "proactive"]).default("interactive"),
  model: z.string().min(1).max(128).default("grok-4.5"),
  effort: z.enum(["fast", "normal", "heavy", "max"]).default("normal"),
  /**
   * True when the client UI/user actually chose effort.
   * Omitted/false → schema may have filled effort: "normal"; gateway may
   * still apply role-pack defaultEffort. Keeps effort always set for consumers.
   */
  effortExplicit: z.boolean().optional(),
  planFirst: z.boolean().optional().default(false),
  // Empty array allowed: gateway creates a temp chat workspace when omitted.
  workspaceRoots: z.array(z.string().min(1).max(4096)).max(16).default([]),
  approvalMode: z.enum(["strict", "balanced", "autopilot"]).default("balanced"),
  allowShell: z.boolean().optional(),
  allowNetworkTools: z.boolean().optional(),
  rolePack: z.string().max(128).nullable().optional().default(null),
  skills: z.array(z.string().max(128)).max(64).default([]),
  mcpServerIds: z.array(z.string().max(128)).max(64).default([]),
  projectId: z.string().max(128).nullable().optional().default(null),
  scheduleRuleId: z.string().max(128).nullable().optional().default(null),
  parentTaskId: z.string().max(128).nullable().optional().default(null),
  revisionOfTaskId: z.string().min(1).max(128).optional(),
  attachments: z.array(TaskAttachmentSchema).max(10).default([]),
  clientMutationId: ClientMutationIdSchema,
  /** UI locale for reply language (LANG-1). */
  locale: z.string().min(2).max(5).optional(),
  /** Compact composer text before slash expansion (CMD-4). */
  goalSource: z.string().max(100_000).optional(),
});

export const IpcRequestSchema = z.discriminatedUnion("method", [
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("tasks.create"),
    params: CreateTaskInputSchema,
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("tasks.list"),
    params: z.object({}).default({}),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("tasks.get"),
    params: z.object({ taskId: z.string().min(1).max(128) }),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("tasks.cancel"),
    params: z.object({
      taskId: z.string().min(1).max(128),
      clientMutationId: ClientMutationIdSchema,
    }),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("tasks.setTitle"),
    params: z.object({
      taskId: z.string().min(1).max(128),
      title: z.string().min(1).max(120),
      clientMutationId: ClientMutationIdSchema,
    }),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("tasks.delete"),
    // Deletes the whole chat thread rooted at taskId (root + follow-ups).
    params: z.object({
      taskId: z.string().min(1).max(128),
      clientMutationId: ClientMutationIdSchema,
    }),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("tasks.approve"),
    params: z.object({
      taskId: z.string().min(1).max(128),
      approvalId: z.string().min(1).max(128),
      decision: z.enum(["approve", "reject"]),
      clientMutationId: ClientMutationIdSchema,
    }),
  }),
  z.object({
    id: z.string().min(1).max(128),
    // Reserved: host-parked browser approvals (main process / mobile remote), not renderer.
    method: z.literal("browser.hostApproval"),
    params: z.object({
      approvalId: z.string().min(1).max(128),
      taskId: z.string().min(1).max(128),
      tool: z.string().min(1).max(128),
      reason: z.string().max(8_000),
      url: z.string().max(8_192).optional(),
      args: z.record(z.string().max(128), z.unknown()).optional(),
    }).strict(),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("browser.capability"),
    params: z.object({}).strict().default({}),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("browser.allowExternal"),
    params: z.object({ allowed: z.boolean() }).strict(),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("browser.openHtml"),
    params: z
      .object({
        taskId: z.string().min(1).max(128),
        path: z.string().min(1).max(4096),
      })
      .strict(),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("tasks.pauseAll"),
    params: z.object({}).default({}),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("tasks.resumeAll"),
    params: z.object({}).default({}),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("task.interject"),
    params: z.object({
      taskId: z.string().min(1).max(128),
      text: z.string().min(1).max(32_000),
      /** Durable dedupe key — same model as tasks.create / follow-up. */
      clientMutationId: ClientMutationIdSchema,
    }),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("task.compact"),
    params: z.object({ taskId: z.string().min(1).max(128) }),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("task.contextUsage"),
    params: z.object({ taskId: z.string().min(1).max(128) }),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("task.rewindPoints"),
    params: z.object({ taskId: z.string().min(1).max(128) }),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("task.rewind"),
    params: z.object({
      taskId: z.string().min(1).max(128),
      pointId: z.string().min(1).max(128),
      turnId: z.string().min(1).max(128).optional(),
    }),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("power.setState"),
    params: z.object({
      state: z.enum(["active", "suspended"]),
    }),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("desktop.task.getGrant"),
    params: z.object({ taskId: z.string().min(1).max(128) }),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("desktop.task.setGrant"),
    params: z.object({
      taskId: z.string().min(1).max(128),
      granted: z.boolean(),
      displayId: z.string().max(64).nullable().optional(),
    }),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("desktop.task.resume"),
    params: z.object({ taskId: z.string().min(1).max(128) }),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("events.list"),
    params: z.object({
      taskId: z.string().min(1).max(128),
      afterSeq: z.number().int().nonnegative().max(1_000_000_000).default(0),
    }),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("events.page"),
    params: z.object({
      taskId: z.string().min(1).max(128),
      afterSeq: z.number().int().nonnegative().max(1_000_000_000).default(0),
      limit: z.number().int().positive().max(500).default(200),
    }),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("outbox.enqueue"),
    params: OutboxEnqueueParamsSchema,
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("outbox.list"),
    params: OutboxListParamsSchema.default({}),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("outbox.update"),
    params: OutboxUpdateParamsSchema,
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("outbox.remove"),
    params: OutboxIdParamsSchema,
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("outbox.retry"),
    params: OutboxIdParamsSchema,
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("outbox.sendNow"),
    params: OutboxIdParamsSchema,
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("outbox.summary"),
    params: z.object({}).default({}),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("auth.status"),
    params: z.object({}).default({}),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("auth.signIn"),
    params: z.object({}).default({}),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("auth.signOut"),
    params: z.object({}).default({}),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("auth.usage"),
    params: z.object({ force: z.boolean().optional() }).default({}),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("auth.privacy.get"),
    params: z.object({}).default({}),
  }),
  z.object({
    id: z.string().min(1).max(128),
    // Reserved: SuperGrok privacy is handled in Electron main (token boundary).
    method: z.literal("auth.privacy.set"),
    params: z.object({ codingDataSharing: z.boolean() }),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("auth.openBilling"),
    params: z.object({}).default({}),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("auth.openAccountPrivacy"),
    params: z.object({}).default({}),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("chats.exportMarkdown"),
    params: z.object({
      taskId: z.string().min(1).max(128),
    }),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("schedule.list"),
    params: z.object({}).default({}),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("schedule.create"),
    params: z.object({
      name: z.string().min(1).max(200),
      goalTemplate: z.string().min(1).max(100_000),
      cron: z.string().min(1).max(200),
      timezone: z.string().min(1).max(64),
      approvalMode: z
        .enum(["strict", "balanced", "autopilot"])
        .default("balanced"),
      model: z.string().min(1).max(128).default("grok-4.5"),
      effort: z.enum(["fast", "normal", "heavy", "max"]).default("normal"),
      workspaceRoots: z.array(z.string().min(1).max(4096)).min(1).max(16),
      rolePack: z.string().max(128).nullable().optional().default(null),
      quietHoursRespect: z.boolean().default(true),
    }),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("schedule.setEnabled"),
    params: z.object({
      id: z.string().min(1).max(128),
      enabled: z.boolean(),
    }),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("schedule.delete"),
    params: z.object({ id: z.string().min(1).max(128) }),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("memory.list"),
    params: z.object({
      kind: z
        .enum([
          "profile",
          "project",
          "brand",
          "preference",
          "episodic",
          "now",
          "standing",
        ])
        .optional(),
    }),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("memory.upsert"),
    params: z.object({
      id: z.string().min(1).max(128).optional(),
      kind: z.enum([
        "profile",
        "project",
        "brand",
        "preference",
        "episodic",
        "now",
        "standing",
      ]),
      title: z.string().min(1).max(500),
      content: z.string().max(50_000),
      projectId: z.string().max(128).nullable().optional().default(null),
    }),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("memory.delete"),
    params: z.object({ id: z.string().min(1).max(128) }),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("inbox.list"),
    params: z.object({}).default({}),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("audit.list"),
    params: z
      .object({
        taskId: z.string().min(1).max(128).optional(),
        decision: z
          .enum(["allow", "deny", "approve", "reject", "info"])
          .optional(),
        limit: z.number().int().positive().max(500).optional(),
      })
      .default({}),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("inbox.markRead"),
    params: z.object({ id: z.string().min(1).max(128) }),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("inbox.dismiss"),
    params: z.object({ id: z.string().min(1).max(128) }),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("audit.list"),
    params: z
      .object({
        taskId: z.string().min(1).max(128).optional(),
        decision: z
          .enum(["allow", "deny", "approve", "reject", "info"])
          .optional(),
        limit: z.number().int().optional(),
      })
      .default({}),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("settings.get"),
    params: z.object({}).default({}),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("settings.set"),
    // Typed partial AppSettings — unknown keys (incl. license) are stripped.
    params: partialAppSettingsSchema,
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("tray.status"),
    params: z.object({}).default({}),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("artifacts.list"),
    params: z.object({ taskId: z.string().min(1).max(128).optional() }),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("rolePacks.list"),
    params: z.object({}).default({}),
  }),
  z.object({
    id: z.string().min(1).max(128),
    // Reserved: model list is driven by auth.status / main process for mobile remote.
    method: z.literal("models.list"),
    params: z.object({}).default({}),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("workspace.ensureTemp"),
    params: z
      .object({
        label: z.string().max(64).optional().default("chat"),
      })
      .default({ label: "chat" }),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("workspace.listFiles"),
    params: z.object({
      root: z.string().min(1).max(4096),
      max: z.number().int().positive().max(200).default(40),
    }),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("workspace.readFile"),
    params: z.object({
      path: z.string().min(1).max(4096),
      /** Max chars to return (UTF-8). Default 80k. */
      maxChars: z.number().int().positive().max(500_000).default(80_000),
    }),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("workspace.readAsset"),
    params: z.object({
      path: z.string().min(1).max(4096),
      /** Workspace root for resolving relative paths. */
      root: z.string().min(1).max(4096).optional(),
      /** Max bytes to inline as a data URL. Default 64MB (covers short video). */
      maxBytes: z
        .number()
        .int()
        .positive()
        .max(128 * 1024 * 1024)
        .default(64 * 1024 * 1024),
    }),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("workspace.prepareAsset"),
    params: z.object({
      path: z.string().min(1).max(4096),
      /** Workspace root for resolving relative paths. */
      root: z.string().min(1).max(4096).optional(),
      /**
       * Max bytes allowed for protocol serve / preview. Default 256MB.
       * Does not inline bytes — main mints a tokenized URL.
       */
      maxBytes: z
        .number()
        .int()
        .positive()
        .max(512 * 1024 * 1024)
        .default(256 * 1024 * 1024),
    }),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("connectors.listPresets"),
    params: z.object({}).default({}),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("connectors.enable"),
    params: z.object({
      presetId: z.string().min(1).max(128),
      /** Literal credential values for ${VAR} placeholders (auth presets). */
      env: z.record(z.string().max(256), z.string().max(8192)).optional(),
    }),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("connectors.disable"),
    params: z.object({ presetId: z.string().min(1).max(128) }),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("connectors.doctor"),
    params: z
      .object({
        /** Optional server id; omit to doctor all configured servers. */
        serverId: z.string().min(1).max(128).optional(),
      })
      .default({}),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("connectors.enableRecommended"),
    params: z.object({}).default({}),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("remote.status"),
    params: z.object({}).default({}),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("remote.enable"),
    params: z
      .object({
        relayUrl: z.string().min(1).max(2_048).optional(),
      })
      .default({}),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("remote.disable"),
    params: z.object({}).default({}),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("remote.pairing.start"),
    params: z
      .object({
        ttlMs: z.number().int().positive().max(900_000).optional(),
      })
      .default({}),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("remote.devices.list"),
    params: z.object({}).default({}),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("remote.devices.revoke"),
    params: z.object({
      deviceId: z.string().min(1).max(128).optional(),
      clientMutationId: ClientMutationIdSchema,
    }),
  }),
  /** CX-14: phone rotates device ECDH public key; pair secret stays. */
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("remote.rekey"),
    params: z.object({
      /** Ignored when RequestContext has a principal; must match principal if set. */
      deviceId: z.string().min(1).max(128).optional(),
      devicePub: z.string().min(1).max(256),
      clientMutationId: ClientMutationIdSchema,
    }),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("remote.telepresence.start"),
    params: z.object({
      /** Ignored when RequestContext has a principal; must match principal if set. */
      deviceId: z.string().min(1).max(128).optional(),
      quality: z.enum(["auto", "smooth", "crisp"]).optional().default("auto"),
      displayId: z.string().max(64).nullable().optional(),
      clientMutationId: ClientMutationIdSchema,
    }),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("remote.telepresence.stop"),
    params: z
      .object({
        deviceId: z.string().min(1).max(128).optional(),
        clientMutationId: ClientMutationIdSchema,
      })
      .default({}),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("remote.telepresence.setQuality"),
    params: z.object({
      quality: z.enum(["auto", "smooth", "crisp"]),
      deviceId: z.string().min(1).max(128).optional(),
    }),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("remote.telepresence.status"),
    params: z.object({}).default({}),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("remote.telepresence.listDisplays"),
    params: z.object({}).default({}),
  }),
  z.object({
    id: z.string().min(1).max(128),
    method: z.literal("remote.telepresence.input"),
    params: z.object({
      kind: z.enum(["tap", "drag", "scroll", "key", "type"]),
      deviceId: z.string().min(1).max(128).optional(),
      nx: z.number().min(0).max(1).optional(),
      ny: z.number().min(0).max(1).optional(),
      nx2: z.number().min(0).max(1).optional(),
      ny2: z.number().min(0).max(1).optional(),
      viewX: z.number().min(-100_000).max(100_000).optional(),
      viewY: z.number().min(-100_000).max(100_000).optional(),
      viewX2: z.number().min(-100_000).max(100_000).optional(),
      viewY2: z.number().min(-100_000).max(100_000).optional(),
      viewW: z.number().min(0).max(100_000).optional(),
      viewH: z.number().min(0).max(100_000).optional(),
      dx: z.number().min(-10_000).max(10_000).optional(),
      dy: z.number().min(-10_000).max(10_000).optional(),
      key: z.string().max(64).optional(),
      text: z.string().max(4_000).optional(),
      button: z.enum(["left", "right", "middle"]).optional(),
    }),
  }),
]);

export type IpcRequest = z.infer<typeof IpcRequestSchema>;
export type CreateTaskInputParsed = z.infer<typeof CreateTaskInputSchema>;

export function parseIpcRequest(input: unknown): IpcRequest {
  return IpcRequestSchema.parse(input);
}
