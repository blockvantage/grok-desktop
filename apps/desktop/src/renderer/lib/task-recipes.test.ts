import { describe, expect, it } from "vitest";
import {
  deriveRecipeTitle,
  emptyRecipeStore,
  loadRecipeStore,
  markRecipeUsed,
  rankRecipesForHome,
  recipeGoalForComposer,
  recipeMemoryStorage,
  removeRecipe,
  saveRecipe,
  saveRecipeStore,
} from "./task-recipes";

describe("task-recipes", () => {
  it("derives a concise title from a long goal", () => {
    // First sentence, first 6 words, sentence-cased.
    expect(deriveRecipeTitle("write a q3 brief for the launch. include budget.")).toBe(
      "Write a q3 brief for the",
    );
    expect(deriveRecipeTitle("weekly status email")).toBe("Weekly status email");
  });

  it("saves, ranks by use, and persists via storage", () => {
    const mem = recipeMemoryStorage();
    let store = emptyRecipeStore();
    const a = saveRecipe(store, {
      goal: "Organize my downloads folder",
      now: "2026-07-01T10:00:00.000Z",
    });
    store = a.store;
    expect(a.recipe?.title).toMatch(/Organize/i);

    const b = saveRecipe(store, {
      goal: "Weekly status email",
      now: "2026-07-01T11:00:00.000Z",
    });
    store = b.store;
    store = markRecipeUsed(store, b.recipe!.id, "2026-07-01T12:00:00.000Z");

    const ranked = rankRecipesForHome(store, 4);
    expect(ranked[0]!.goal).toBe("Weekly status email");
    expect(ranked[0]!.useCount).toBe(1);

    saveRecipeStore(store, mem);
    const reloaded = loadRecipeStore(mem);
    expect(reloaded.recipes).toHaveLength(2);
    expect(recipeGoalForComposer(reloaded.recipes[0]!)).toBeTruthy();
  });

  it("dedupes by goal and can remove", () => {
    let store = emptyRecipeStore();
    store = saveRecipe(store, { goal: "Same goal" }).store;
    store = saveRecipe(store, { goal: "same goal" }).store;
    expect(store.recipes).toHaveLength(1);
    store = removeRecipe(store, store.recipes[0]!.id);
    expect(store.recipes).toHaveLength(0);
  });

  it("ignores empty goals", () => {
    const { recipe, store } = saveRecipe(emptyRecipeStore(), { goal: "   " });
    expect(recipe).toBeNull();
    expect(store.recipes).toHaveLength(0);
  });
});
