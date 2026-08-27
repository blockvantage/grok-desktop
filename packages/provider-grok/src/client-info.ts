import { GROKDESK_VERSION } from "@grokdesk/shared";

/** Single ACP clientInfo — sourced from the Desk app version. */
export function grokAcpClientInfo(): { name: string; version: string } {
  return { name: "grok-desk", version: GROKDESK_VERSION };
}
