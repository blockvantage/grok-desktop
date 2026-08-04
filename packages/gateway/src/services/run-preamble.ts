/**
 * Assemble immutable run preamble pieces (memory + attachments + transcript).
 * Pure composition helpers — I/O is injected by the caller (Phase 6 / TASK-05).
 */

export type PreambleParts = {
  memoryBlock?: string | null;
  attachmentsBlock?: string | null;
  transcriptBlock?: string | null;
};

export type AssembledPreamble = {
  systemPreamble: string;
  provenance: string[];
};

/**
 * Join optional preamble sections with blank lines and record provenance labels.
 */
export function assembleRunPreamble(parts: PreambleParts): AssembledPreamble {
  const provenance: string[] = [];
  const sections: string[] = [];

  const memory = parts.memoryBlock?.trim();
  if (memory) {
    sections.push(memory);
    // Caller may pass count via special prefix; default label.
    provenance.push(
      parts.memoryBlock?.startsWith("__memory_count:")
        ? `memory:${parts.memoryBlock.split(":")[1]}`
        : "memory",
    );
  }

  const attachments = parts.attachmentsBlock?.trim();
  if (attachments) {
    sections.push(attachments);
    provenance.push("attachments");
  }

  const transcript = parts.transcriptBlock?.trim();
  if (transcript) {
    sections.push(
      transcript.startsWith("Prior conversation:")
        ? transcript
        : `Prior conversation:\n${transcript}`,
    );
    provenance.push("transcript_fallback");
  }

  return {
    systemPreamble: sections.join("\n\n"),
    provenance,
  };
}

/**
 * Build preamble from gateway services (thin orchestration around pure join).
 */
export function assembleRunPreambleFromSources(input: {
  memoryPreamble: string;
  memoryHitCount: number;
  attachmentsPreamble?: string | null;
  transcriptFallback?: string | null;
}): AssembledPreamble {
  const provenance: string[] = [];
  const sections: string[] = [];

  const mem = input.memoryPreamble.trim();
  if (mem && input.memoryHitCount > 0) {
    sections.push(mem);
    provenance.push(`memory:${input.memoryHitCount}`);
  }

  const att = input.attachmentsPreamble?.trim();
  if (att) {
    sections.push(att);
    provenance.push("attachments");
  }

  const tr = input.transcriptFallback?.trim();
  if (tr) {
    sections.push(
      tr.startsWith("Prior conversation:")
        ? tr
        : `Prior conversation:\n${tr}`,
    );
    provenance.push("transcript_fallback");
  }

  return {
    systemPreamble: sections.join("\n\n"),
    provenance,
  };
}
