/**
 * Compose Home coworker surfaces from pure modules (briefing, board, recipes, discovery).
 */

import {
  buildMorningBriefing,
  briefingSubtitle,
  type BriefingInboxItem,
  type BriefingSchedule,
  type BriefingTask,
  type MorningBriefing,
} from "./morning-briefing";
import {
  buildWorkBoard,
  shouldShowWorkBoard,
  type WorkBoardSnapshot,
  type WorkBoardTaskInput,
} from "./concurrent-work-board";
import {
  loadRecipeStore,
  rankRecipesForHome,
  type TaskRecipe,
} from "./task-recipes";
import {
  filterDismissedHints,
  loadDismissedDiscovery,
  pickCapabilityHints,
  type CapabilityHint,
  type UsageSignals,
} from "./capability-discovery";
import {
  buildScheduleDigest,
  shouldShowScheduleDigest,
  type ScheduleDigest,
  type ScheduleRunLike,
} from "./schedule-digest";
import {
  loadWorkSession,
  resolveResumeIntent,
  type ResumeIntent,
  type WorkSessionSnapshot,
} from "./work-session";
import { pickNextConnector, type ConnectorLike } from "./connector-next";

export type CoworkerHomeModel = {
  briefing: MorningBriefing;
  briefingLine: string;
  workBoard: WorkBoardSnapshot;
  showWorkBoard: boolean;
  recipes: TaskRecipe[];
  discovery: CapabilityHint[];
  scheduleDigest: ScheduleDigest;
  showScheduleDigest: boolean;
  resume: ResumeIntent;
  session: WorkSessionSnapshot;
  nextConnector: ReturnType<typeof pickNextConnector>;
};

export type CoworkerHomeTask = BriefingTask & WorkBoardTaskInput;

export function buildCoworkerHomeModel(input: {
  tasks: CoworkerHomeTask[];
  schedules: BriefingSchedule[];
  inbox: BriefingInboxItem[];
  scheduleRuns?: ScheduleRunLike[];
  usage: UsageSignals;
  connectors?: { catalog: ConnectorLike[]; enabledIds: string[] };
  now?: Date;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
}): CoworkerHomeModel {
  const now = input.now ?? new Date();
  const storage =
    input.storage ??
    (typeof localStorage !== "undefined" ? localStorage : null);

  const briefing = buildMorningBriefing({
    tasks: input.tasks,
    schedules: input.schedules,
    inbox: input.inbox,
    now,
  });

  const workBoard = buildWorkBoard(input.tasks, { now });
  const recipes = rankRecipesForHome(loadRecipeStore(storage), 4);
  const dismissed = loadDismissedDiscovery(storage);
  const discovery = filterDismissedHints(
    pickCapabilityHints(input.usage, 3),
    dismissed,
  );

  const scheduleDigest = buildScheduleDigest({
    runs: input.scheduleRuns ?? [],
    now,
  });

  const session = loadWorkSession(storage);
  const resume = resolveResumeIntent(session, now);

  const nextConnector = input.connectors
    ? pickNextConnector(input.connectors)
    : null;

  return {
    briefing,
    briefingLine: briefingSubtitle(briefing),
    workBoard,
    showWorkBoard: shouldShowWorkBoard(workBoard),
    recipes,
    discovery,
    scheduleDigest,
    showScheduleDigest: shouldShowScheduleDigest(scheduleDigest),
    resume,
    session,
    nextConnector,
  };
}
