/**
 * Phase 5 — assert heavy preview/render stacks stay off the critical path.
 * Structural checks drive the shipped import graph (not re-implementations).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rendererRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function read(rel: string): string {
  return fs.readFileSync(path.join(rendererRoot, rel), "utf8");
}

describe("lazy preview / heavy render imports", () => {
  it("markdown consumers import markdown-lazy, not eager markdown", () => {
    const consumers = [
      "components/task-stream.tsx",
      "components/conversation/plan-card.tsx",
      "components/conversation/conversation-turn.tsx",
      "components/views/task-workspace-parts.tsx",
      "components/views/artifacts-view.tsx",
    ];
    for (const rel of consumers) {
      const src = read(rel);
      expect(src, rel).toMatch(/markdown-lazy/);
      expect(src, rel).not.toMatch(
        /from\s+["']@\/components\/ui\/markdown["']/,
      );
      expect(src, rel).not.toMatch(
        /from\s+["']\.\/markdown["']/,
      );
    }
  });

  it("markdown-lazy uses React.lazy dynamic import of ./markdown", () => {
    const lazy = read("components/ui/markdown-lazy.tsx");
    expect(lazy).toMatch(/lazy\s*\(/);
    expect(lazy).toMatch(/import\s*\(\s*["']\.\/markdown["']\s*\)/);
    expect(lazy).toMatch(/Suspense/);
  });

  it("mermaid is dynamically imported inside MermaidBlock only", () => {
    const block = read("components/ui/mermaid-block.tsx");
    expect(block).toMatch(/import\s*\(\s*["']mermaid["']\s*\)/);
    expect(block).not.toMatch(/from\s+["']mermaid["']/);

    // Eager markdown may import MermaidBlock (which itself lazy-loads mermaid).
    const md = read("components/ui/markdown.tsx");
    expect(md).toMatch(/MermaidBlock|mermaid-block/);
    expect(md).not.toMatch(/from\s+["']mermaid["']/);
    expect(md).not.toMatch(/import\s*\(\s*["']mermaid["']\s*\)/);
  });

  it("renderer does not dynamically re-import lib/api (static only)", () => {
    const app = read("App.tsx");
    expect(app).toMatch(/taskInterject/);
    expect(app).toMatch(/from\s+["']@\/lib\/api["']/);
    expect(app).not.toMatch(/import\s*\(\s*["']@\/lib\/api["']\s*\)/);
    const queue = read("lib/queue-attachments.ts");
    expect(queue).toMatch(/from\s+["']@\/lib\/api["']/);
    expect(queue).not.toMatch(/import\s*\(\s*["']@\/lib\/api["']\s*\)/);
  });

  it("heavy secondary views stay React.lazy in App shell", () => {
    const app = read("App.tsx");
    expect(app).toMatch(/lazy\s*\(\s*\(\s*\)\s*=>\s*import\(["']@\/components\/views\/artifacts-view/);
    expect(app).toMatch(/lazy\s*\(\s*\(\s*\)\s*=>\s*import\(["']@\/components\/views\/memory-view/);
    expect(app).toMatch(/lazy\s*\(\s*\(\s*\)\s*=>\s*import\(["']@\/components\/views\/settings-view/);
    expect(app).toMatch(/lazy\s*\(\s*\(\s*\)\s*=>\s*import\(["']@\/components\/views\/scheduled-view/);
    expect(app).toMatch(/lazy\s*\(\s*\(\s*\)\s*=>\s*import\(["']@\/components\/command-palette/);
    expect(app).toMatch(/lazy\s*\(\s*\(\s*\)\s*=>\s*import\(["']@\/components\/inbox-panel/);
  });

  it("keeps Home and basic chat shell eager in the initial chunk", () => {
    const app = read("App.tsx");
    // Eager imports for reliability (not React.lazy).
    expect(app).toMatch(
      /import\s+\{\s*HomeView\s*\}\s+from\s+["']@\/components\/views\/home-view["']/,
    );
    expect(app).toMatch(
      /import\s+\{\s*TasksView\s*\}\s+from\s+["']@\/components\/views\/tasks-view["']/,
    );
    expect(app).toMatch(
      /import\s+\{\s*TaskWorkspaceView\s*\}\s+from\s+["']@\/components\/views\/task-workspace-view["']/,
    );
    expect(app).not.toMatch(
      /lazy\s*\(\s*\(\s*\)\s*=>\s*import\(["']@\/components\/views\/home-view/,
    );
    expect(app).not.toMatch(
      /lazy\s*\(\s*\(\s*\)\s*=>\s*import\(["']@\/components\/views\/task-workspace-view/,
    );
  });

  it("defers browser pane and media lightbox until interaction", () => {
    const ws = read("components/views/task-workspace-view.tsx");
    expect(ws).toMatch(
      /lazy\s*\(\s*\(\s*\)\s*=>\s*import\(["']@\/components\/browser-pane-slot/,
    );
    expect(ws).toMatch(
      /lazy\s*\(\s*\(\s*\)\s*=>\s*import\(["']@\/components\/media-lightbox/,
    );
    expect(ws).toMatch(/browser-pane-loading|Suspense/);
    expect(ws).not.toMatch(
      /import\s+\{\s*BrowserPaneSlot\s*\}\s+from\s+["']@\/components\/browser-pane-slot["']/,
    );
  });

  it("bundle-budget script enforces plan targets and regression ceiling", () => {
    const script = fs.readFileSync(
      path.join(rendererRoot, "../../scripts/check-bundle-budget.mjs"),
      "utf8",
    );
    expect(script).toMatch(/2\.2\s*\*\s*1024\s*\*\s*1024|JS_BUDGET/);
    expect(script).toMatch(/130\s*\*\s*1024|CSS_BUDGET/);
    expect(script).toMatch(/JS_REGRESSION_CEILING|2\.7/);
    expect(script).toMatch(/index\.html/);
  });

  it("no cytoscape dependency on renderer critical path", () => {
    // Product does not ship cytoscape; guard against accidental add.
    const pkg = JSON.parse(
      fs.readFileSync(
        path.join(rendererRoot, "../../package.json"),
        "utf8",
      ),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    expect(pkg.dependencies?.cytoscape).toBeUndefined();
    expect(pkg.devDependencies?.cytoscape).toBeUndefined();
  });
});
