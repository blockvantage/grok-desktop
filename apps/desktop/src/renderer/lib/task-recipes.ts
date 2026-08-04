/**
 * Reusable task playbooks — save a finished goal and one-click rerun.
 * LocalStorage-backed; no new nav surface (Home chips + slash).
 */

export type TaskRecipe = {
  id: string;
  title: string;
  goal: string;
  /** Optional default workspace root when replaying. */
  workspaceRoot?: string | null;
  /** Effort hint for create form. */
  effort?: string | null;
  /** How many times the user has run this recipe. */
  useCount: number;
  createdAt: string;
  lastUsedAt: string | null;
  /** Source task id when saved from a completed run. */
  sourceTaskId?: string | null;
};

export type RecipeStore = {
  recipes: TaskRecipe[];
};

const STORAGE_KEY = "grokdesk.recipes.v1";
const MAX_RECIPES = 40;

export function emptyRecipeStore(): RecipeStore {
  return { recipes: [] };
}

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

const RECIPE_MAX = 100;
const RECIPE_GOAL_MAX = 32_000;
const RECIPE_TITLE_MAX = 200;

export function loadRecipeStore(
  storage: Pick<Storage, "getItem"> | null =
    typeof localStorage !== "undefined" ? localStorage : null,
): RecipeStore {
  if (!storage) return emptyRecipeStore();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return emptyRecipeStore();
    if (raw.length > 1_000_000) return emptyRecipeStore();
    const parsed = JSON.parse(raw) as Partial<RecipeStore>;
    if (!Array.isArray(parsed.recipes)) return emptyRecipeStore();
    return {
      recipes: parsed.recipes
        .filter((r) => r && typeof r === "object" && typeof r.id === "string")
        .slice(0, RECIPE_MAX)
        .map((r) => normalizeRecipe(r as TaskRecipe)),
    };
  } catch {
    return emptyRecipeStore();
  }
}

export function saveRecipeStore(
  store: RecipeStore,
  storage: Pick<Storage, "setItem"> | null =
    typeof localStorage !== "undefined" ? localStorage : null,
): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* quota */
  }
}

function normalizeRecipe(r: TaskRecipe): TaskRecipe {
  const goal = String(r.goal ?? "").trim().slice(0, RECIPE_GOAL_MAX);
  return {
    id: String(r.id).slice(0, 128),
    title:
      String(r.title ?? "").trim().slice(0, RECIPE_TITLE_MAX) ||
      deriveRecipeTitle(goal).slice(0, RECIPE_TITLE_MAX),
    goal,
    workspaceRoot:
      typeof r.workspaceRoot === "string"
        ? r.workspaceRoot.slice(0, 4096)
        : null,
    effort: r.effort ?? null,
    useCount: Number.isFinite(r.useCount) ? Math.max(0, r.useCount) : 0,
    createdAt: r.createdAt || new Date().toISOString(),
    lastUsedAt: r.lastUsedAt ?? null,
    sourceTaskId: r.sourceTaskId ?? null,
  };
}

/** Concise title from goal for list chips. */
export function deriveRecipeTitle(goal: string): string {
  const clean = goal.replace(/\s+/g, " ").trim();
  if (!clean) return "Untitled playbook";
  const first = clean.split(/(?<=[.!?])\s/)[0] ?? clean;
  const words = first.split(" ").slice(0, 6).join(" ").replace(/[.,;:]+$/, "");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function makeRecipeId(now = Date.now()): string {
  return `recipe_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Save or update a playbook from a completed task.
 * Dedupes by normalized goal text when sourceTaskId is absent.
 */
export function saveRecipe(
  store: RecipeStore,
  input: {
    goal: string;
    title?: string | null;
    workspaceRoot?: string | null;
    effort?: string | null;
    sourceTaskId?: string | null;
    now?: string;
  },
): { store: RecipeStore; recipe: TaskRecipe | null } {
  const goal = input.goal.trim();
  if (!goal) return { store, recipe: null };
  const now = input.now ?? new Date().toISOString();
  const norm = goal.toLowerCase();

  const existing = store.recipes.find(
    (r) =>
      (input.sourceTaskId && r.sourceTaskId === input.sourceTaskId) ||
      r.goal.trim().toLowerCase() === norm,
  );
  if (existing) {
    const updated: TaskRecipe = {
      ...existing,
      title: (input.title?.trim() || existing.title).slice(0, 80),
      goal,
      workspaceRoot: input.workspaceRoot ?? existing.workspaceRoot,
      effort: input.effort ?? existing.effort,
      sourceTaskId: input.sourceTaskId ?? existing.sourceTaskId,
    };
    return {
      store: {
        recipes: store.recipes.map((r) => (r.id === existing.id ? updated : r)),
      },
      recipe: updated,
    };
  }

  const recipe: TaskRecipe = {
    id: makeRecipeId(),
    title: (input.title?.trim() || deriveRecipeTitle(goal)).slice(0, 80),
    goal,
    workspaceRoot: input.workspaceRoot ?? null,
    effort: input.effort ?? null,
    useCount: 0,
    createdAt: now,
    lastUsedAt: null,
    sourceTaskId: input.sourceTaskId ?? null,
  };
  const recipes = [recipe, ...store.recipes].slice(0, MAX_RECIPES);
  return { store: { recipes }, recipe };
}

export function removeRecipe(store: RecipeStore, id: string): RecipeStore {
  return { recipes: store.recipes.filter((r) => r.id !== id) };
}

/** Mark recipe used (bumps count + lastUsedAt) for ranking. */
export function markRecipeUsed(
  store: RecipeStore,
  id: string,
  now = new Date().toISOString(),
): RecipeStore {
  return {
    recipes: store.recipes.map((r) =>
      r.id === id
        ? { ...r, useCount: r.useCount + 1, lastUsedAt: now }
        : r,
    ),
  };
}

/**
 * Rank recipes for Home chips: most used, then recently used, then newest.
 */
export function rankRecipesForHome(
  store: RecipeStore,
  limit = 4,
): TaskRecipe[] {
  return [...store.recipes]
    .filter((r) => r.goal.trim().length > 0)
    .sort((a, b) => {
      if (b.useCount !== a.useCount) return b.useCount - a.useCount;
      const au = a.lastUsedAt ?? "";
      const bu = b.lastUsedAt ?? "";
      if (bu !== au) return bu.localeCompare(au);
      return b.createdAt.localeCompare(a.createdAt);
    })
    .slice(0, limit);
}

/** Goal text to seed the composer when replaying a recipe. */
export function recipeGoalForComposer(recipe: TaskRecipe): string {
  return recipe.goal.trim();
}

export { STORAGE_KEY as RECIPE_STORAGE_KEY, memoryStorage as recipeMemoryStorage };
