export type McpRow = {
  id: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled: boolean;
};
