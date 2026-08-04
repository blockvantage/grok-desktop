/**
 * Product-level controller factories (P2 extract).
 * Thin re-exports so surfaces can import from one place without growing shells.
 */

export {
  createAccountController,
  type AccountController,
  type AccountControllerDeps,
  type AuthStatusPayload,
} from "./account-controller";

export {
  emptyActivityStore,
  reduceActivity,
  visibleTimelineEvents,
  workersForHud,
  type ActivityEvent,
  type ActivityStoreState,
  type WorkerRecord,
} from "./activity-store";

export {
  initialBrowserCapability,
  reduceBrowserCapability,
  browserGlobeState,
  browserProviderReceipt,
  mayUseExternalBrowser,
  shouldAdvertiseDeskBrowser,
  type BrowserCapability,
} from "./browser-capability";

export {
  loadQueueStore,
  saveQueueStore,
  enqueueDurable,
  claimDurable,
  queueForConversation,
  type QueueStoreSnapshot,
  type DurableQueuedMessage,
} from "./message-queue-store";

export {
  loadLayoutStore,
  saveLayoutStore,
  layoutForConversation,
  setLayoutForConversation,
  type WorkspaceLayout,
  type WorkspaceLayoutStore,
} from "./workspace-layout";

export {
  loadMilestones,
  saveMilestones,
  patchMilestones,
  activationStarterGoal,
  type ActivationMilestones,
} from "./activation-milestones";
