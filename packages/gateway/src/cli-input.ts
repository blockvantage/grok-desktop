export type GatewayCliLineDeps = {
  dispatch(request: {
    id: string;
    method: string | undefined;
    params: unknown;
  }): Promise<unknown>;
  handleHostResult(message: {
    id: string;
    ok: boolean;
    result?: unknown;
    error?: string;
  }): void;
  shutdown(): Promise<void>;
  send(message: unknown): void;
  exit(code: number): void;
};

/**
 * Create a non-blocking JSON-lines handler for the gateway child process.
 *
 * Requests can synchronously initiate a reverse host call. Its `host_result`
 * arrives on this same input stream, so reading must continue while the
 * originating request is pending or both processes deadlock.
 */
/** Reject individual JSON-lines above this size (DoS / memory guard). */
export const GATEWAY_CLI_MAX_LINE_BYTES = 2 * 1024 * 1024; // 2 MiB

export function createGatewayLineHandler(
  deps: GatewayCliLineDeps,
): (line: string) => void {
  let requestTail = Promise.resolve();
  return (line) => {
    if (!line.trim()) return;
    if (Buffer.byteLength(line, "utf8") > GATEWAY_CLI_MAX_LINE_BYTES) {
      deps.send({
        id: null,
        ok: false,
        error: `Line too large (max ${GATEWAY_CLI_MAX_LINE_BYTES} bytes)`,
      });
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (err) {
      deps.send({
        id: null,
        ok: false,
        error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }

    const msg = raw as GatewayCliMessage;
    if (msg.type === "host_result" && msg.id != null) {
      deps.handleHostResult({
        id: String(msg.id),
        ok: Boolean(msg.ok),
        result: msg.result,
        error: msg.error,
      });
      return;
    }

    // Preserve the original one-request-at-a-time gateway contract. Only
    // reverse-call results bypass this queue because the active request may be
    // waiting for exactly that result.
    requestTail = requestTail.then(() => processRequest(msg, deps));
  };
}

type GatewayCliMessage = {
  id?: string;
  method?: string;
  params?: unknown;
  type?: string;
  ok?: boolean;
  result?: unknown;
  error?: string;
};

async function processRequest(
  msg: GatewayCliMessage,
  deps: GatewayCliLineDeps,
): Promise<void> {
  if (msg.method === "shutdown") {
    await deps.shutdown();
    deps.send({ id: msg.id ?? "_", ok: true, result: { stopped: true } });
    deps.exit(0);
    return;
  }

  try {
    const result = await deps.dispatch({
      id: String(msg.id ?? "0"),
      method: msg.method,
      params: msg.params ?? {},
    });
    deps.send({ id: msg.id, ok: true, result });
  } catch (err) {
    deps.send({
      id: msg.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
