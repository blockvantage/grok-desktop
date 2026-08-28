# Paste-ready grokdesk.app copy (O-005 / O-006 / O-007)

The public site lives in a sibling landing repo, not this workspace. Deploy is owner-gated (`REQUIRES_OWNER_ATTENTION.md`). Until that ship, **this file is the source of truth** for corrected claims. In-app catalogs already match.

Do not restore the old slogans: OS Keychain storage, “deletes always wait,” or “memory never leaves the machine.”

## O-005 — Where secrets live

> **Where secrets live.** Product keys and device credentials are stored in an encrypted vault inside Grok Desk’s application data on your disk (not in the macOS Keychain or Windows Credential Manager by default). SuperGrok still processes the prompts and relevant context when you run a task—same as using Grok in a browser.

## O-006 — Deletes and approvals

> **Deletes and approvals.** In **Strict** and **Balanced**, destructive file operations wait for your approval. **Autopilot** can delete and overwrite inside your allowed workspace folders without asking—use it only when you trust the folder and the task.

## O-007 — Memory

> **Memory.** Grok Desk keeps memory records on your disk. When you run a task, relevant memory is included in the prompt sent to SuperGrok (like chat history)—it is not uploaded as a continuous cloud sync.
