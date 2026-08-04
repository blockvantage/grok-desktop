/**
 * Apply role pack defaults onto a tasks.create params bag (Phase 6 extract).
 * Pure mutation of a params object; standing-instructions side effect is injected.
 */

export type RolePackLike = {
  id: string;
  name: string;
  skills: string[];
  defaultEffort: "fast" | "normal" | "heavy" | "max";
  standingInstructions: string;
};

export type RolePackCreateParams = {
  rolePack?: string | null;
  skills?: string[];
  effort?: "fast" | "normal" | "heavy" | "max";
};

export function standingMemoryForRolePack(pack: RolePackLike): {
  id: string;
  kind: "standing";
  title: string;
  content: string;
  provenance: string;
} {
  return {
    id: `role-pack:${pack.id}`,
    kind: "standing",
    title: `Role pack: ${pack.name}`,
    content: pack.standingInstructions,
    provenance: `rolePack:${pack.id}`,
  };
}

/**
 * Merge pack skills and default effort into create params.
 * @returns standing memory payload when a pack applied, else null.
 */
export function applyRolePackToCreateParams(
  params: RolePackCreateParams,
  lookup: (id: string) => RolePackLike | null | undefined,
  opts: { effortWasExplicit: boolean },
): {
  applied: boolean;
  standingMemory: {
    id: string;
    kind: "standing";
    title: string;
    content: string;
    provenance: string;
  } | null;
} {
  if (!params.rolePack) {
    return { applied: false, standingMemory: null };
  }
  const pack = lookup(params.rolePack);
  if (!pack) {
    return { applied: false, standingMemory: null };
  }
  params.skills = [...new Set([...(params.skills ?? []), ...pack.skills])];
  if (!opts.effortWasExplicit) {
    params.effort = pack.defaultEffort;
  }
  return {
    applied: true,
    standingMemory: standingMemoryForRolePack(pack),
  };
}
