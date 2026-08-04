/**
 * Activation milestones beyond a single onboardingCompleted flag.
 */

export type ActivationMilestones = {
  /** Account connected or explicit demo/limited mode chosen. */
  accountResolved: boolean;
  demoMode: boolean;
  firstRunCreated: boolean;
  firstMeaningfulResponse: boolean;
  projectFolderGranted: boolean;
};

const STORAGE_KEY = "grokdesk.activation.v1";

export function emptyMilestones(): ActivationMilestones {
  return {
    accountResolved: false,
    demoMode: false,
    firstRunCreated: false,
    firstMeaningfulResponse: false,
    projectFolderGranted: false,
  };
}

export function loadMilestones(
  storage: Pick<Storage, "getItem"> | null = typeof localStorage !== "undefined"
    ? localStorage
    : null,
): ActivationMilestones {
  if (!storage) return emptyMilestones();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return emptyMilestones();
    if (raw.length > 10_000) return emptyMilestones();
    const parsed = JSON.parse(raw) as Partial<ActivationMilestones>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return emptyMilestones();
    }
    // Explicit booleans only — never spread raw JSON (prototype pollution).
    return {
      accountResolved: parsed.accountResolved === true,
      demoMode: parsed.demoMode === true,
      firstRunCreated: parsed.firstRunCreated === true,
      firstMeaningfulResponse: parsed.firstMeaningfulResponse === true,
      projectFolderGranted: parsed.projectFolderGranted === true,
    };
  } catch {
    return emptyMilestones();
  }
}

export function saveMilestones(
  m: ActivationMilestones,
  storage: Pick<Storage, "setItem"> | null = typeof localStorage !== "undefined"
    ? localStorage
    : null,
): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(m));
  } catch {
    /* ignore */
  }
}

export function patchMilestones(
  current: ActivationMilestones,
  patch: Partial<ActivationMilestones>,
): ActivationMilestones {
  return { ...current, ...patch };
}

/** Default workspace when no project folder was chosen. */
export function defaultManagedWorkspaceLabel(): string {
  return "Private managed workspace";
}

/**
 * Seeded goal must never claim a folder the user did not pick.
 */
export function activationStarterGoal(input: {
  hasFolder: boolean;
  folderName?: string | null;
  demoMode?: boolean;
}): string {
  if (input.demoMode) {
    return "Show me what Grok Desk can do in demo mode";
  }
  if (input.hasFolder && input.folderName) {
    return `Look through ${input.folderName} and suggest three useful next steps`;
  }
  return "Help me plan my first project in this private workspace";
}
