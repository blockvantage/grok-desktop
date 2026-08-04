import type { EffortLevel } from "./types.js";

export interface RolePack {
  id: string;
  name: string;
  description: string;
  skills: string[];
  standingInstructions: string;
  defaultEffort: EffortLevel;
}

export const ROLE_PACKS: RolePack[] = [
  {
    id: "marketing",
    name: "Marketing Agent",
    description: "Campaigns, copy, competitor scans, asset briefs",
    skills: ["marketing", "copywriting", "competitor-research"],
    standingInstructions:
      "Prefer clear claims, cite sources when researching, write shippable drafts.",
    defaultEffort: "normal",
  },
  {
    id: "research",
    name: "Researcher",
    description: "Deep research with structured notes",
    skills: ["research"],
    standingInstructions: "Separate facts from inference; list sources.",
    defaultEffort: "heavy",
  },
  {
    id: "ops",
    name: "Ops / Files",
    description: "Folder organization and operational cleanup",
    skills: ["files"],
    standingInstructions:
      "Prefer reversible file ops; never delete without approval.",
    defaultEffort: "fast",
  },
  {
    id: "chief-of-staff",
    name: "Chief of Staff",
    description: "Priorities, follow-ups, weekly narrative",
    skills: ["planning"],
    standingInstructions:
      "Protect focus; surface only high-leverage nudges.",
    defaultEffort: "normal",
  },
];

export function getRolePack(id: string): RolePack | undefined {
  return ROLE_PACKS.find((p) => p.id === id);
}
