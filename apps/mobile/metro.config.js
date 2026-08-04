const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");
const sharedPkg = path.resolve(monorepoRoot, "packages/shared");
const sharedDist = path.resolve(sharedPkg, "dist");

const config = getDefaultConfig(projectRoot);

// Keep Expo defaults, then add monorepo root so workspace packages hot-reload
const defaultWatch = config.watchFolders ?? [];
config.watchFolders = Array.from(new Set([...defaultWatch, monorepoRoot]));
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

// Resolve shared + noble from monorepo. Use **dist** (compiled .js) so Metro
// can follow extensioned imports; never the package main that pulls node:path.
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  "@grokdesk/shared": sharedPkg,
};

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    moduleName === "@grokdesk/shared/remote" ||
    moduleName === "@grokdesk/shared/remote.js"
  ) {
    return {
      filePath: path.join(sharedDist, "remote.js"),
      type: "sourceFile",
    };
  }
  // Accidental main import → still remote-only surface (no node:path)
  if (moduleName === "@grokdesk/shared") {
    return {
      filePath: path.join(sharedDist, "remote.js"),
      type: "sourceFile",
    };
  }
  // TypeScript ESM style: import "./foo.js" → resolve to ./foo.ts / .tsx
  if (
    moduleName.startsWith(".") &&
    moduleName.endsWith(".js") &&
    !moduleName.includes("node_modules")
  ) {
    const base = moduleName.slice(0, -3);
    for (const ext of [".ts", ".tsx", ".js", ".jsx", ".json"]) {
      try {
        return context.resolveRequest(context, base + ext, platform);
      } catch {
        /* try next */
      }
    }
  }
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
