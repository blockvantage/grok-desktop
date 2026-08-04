# Terminal act — Act 1 flood (out-of-the-terminal)

Source: real `grok` CLI run 2026-07-11 (transcript shapes; filenames aligned to film deliverables).

Real run: `grok -p "Research the three most popular AI desktop coworker apps (Claude, ChatGPT desktop, and one more). Search the web, then write a short competitor summary to brief.md." --max-turns 8`, captured via `--debug` + session `chat_history.jsonl` (session `019f52a9-5264-77b0-bd5d-8697eb6be64c`). Grok actually invoked, in order: 6× `web_search` (backend tool, e.g. query `"most popular AI desktop coworker apps 2026 Claude ChatGPT"`), 2× `web_fetch` (e.g. `https://chatgpt.com/features/desktop/`), 1× `list_dir`, 1× `write` (full `brief.md`), then a closing assistant summary. No auth/network errors — full real transcript captured; line shapes below are drawn directly from it (filenames swapped to the film's `/Marketing` deliverables per the brief).

## Flood lines (in order, ~0.12s stagger, SF Mono, sand ❯ prompt, muted output)

1. `❯ grok`
2. `❯ research our competitors and file the findings`
3. `Pulling product details for the category leaders.`
4. `✓ web_search  "AI desktop coworker apps 2026"`
5. `✓ web_search  "Claude desktop vs ChatGPT desktop vs Grok desktop"`
6. `✓ web_search  "AI coworker pricing feature comparison"`
7. `✓ web_fetch   chatgpt.com/features/desktop`
8. `✓ web_fetch   microsoft.com/microsoft-365/copilot-cowork`
9. `✓ list_dir    /Marketing`
10. `Writing a concise competitor summary to brief.md.`
11. `✓ wrote  /Marketing/brief.md`
12. `✓ wrote  /Marketing/competitors.xlsx`
13. `✓ wrote  /Marketing/launch-graphic.png`
14. `The category is no longer "chat in a window" —`

## The 3 FLIP-morph lines (marked)

- MORPH-1 (→ "Browsing the web" tool chip): `✓ web_search  "AI desktop coworker apps 2026"`
- MORPH-2 (→ artifact card): `✓ wrote  /Marketing/launch-graphic.png`
- MORPH-3 (→ assistant chat turn): `The category is no longer "chat in a window" —`

Grounding note: the real run's tool grammar was `web_search` (backend tool_type, real query strings captured verbatim above minus year-drift trim), `web_fetch` (real URLs), `list_dir`, and `write` (wrote a complete real `brief.md` to disk) — confirming `✓ <tool>  <arg>` is grok's actual completed-tool-call line shape. The streaming assistant text is trimmed directly from the real closing turn: *"The category is no longer 'chat in a window'... all three ship agentic Work/Cowork modes."* Filenames in lines 11–13 are swapped from the real run's single `brief.md` to the film's three canonical `/Marketing` deliverables (`brief.md`, `competitors.xlsx`, `launch-graphic.png`) for app-section continuity; the `write` line shape itself (`✓ wrote  <path>`) is real.
