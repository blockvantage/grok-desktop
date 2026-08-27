/**
 * Convert Desk MCP server records into the ACP `session/new` `mcpServers` shape.
 * Unknown extra fields on Desk records are ignored (forward compatible).
 */
export type DeskMcpServerLike = {
  id: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
};

export type AcpMcpServerParam = {
  name: string;
  command: string;
  args: string[];
  env: Array<{ name: string; value: string }>;
};

export function toAcpMcpServers(
  servers: readonly DeskMcpServerLike[] | undefined | null,
): AcpMcpServerParam[] {
  if (!servers?.length) return [];
  const out: AcpMcpServerParam[] = [];
  for (const server of servers) {
    if (!server || server.enabled === false) continue;
    const name = typeof server.id === "string" ? server.id.trim() : "";
    const command =
      typeof server.command === "string" ? server.command.trim() : "";
    if (!name || !command) continue;
    const envEntries = Object.entries(server.env ?? {}).filter(
      ([key, value]) => key.length > 0 && typeof value === "string",
    );
    out.push({
      name,
      command,
      args: Array.isArray(server.args)
        ? server.args.filter((a): a is string => typeof a === "string")
        : [],
      env: envEntries.map(([key, value]) => ({ name: key, value })),
    });
  }
  return out;
}
