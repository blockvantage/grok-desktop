# Product media

Assets used by the root `README.md` and release marketing.

| File | Use |
| --- | --- |
| `icon-64.png` / `icon-256.png` | Brand mark |
| `banner.jpg` | Alternate marketing still |
| `readme-v1/hero.jpg` | v1.0.0 README hero, cropped from the authentic active-queue capture |
| `readme-v1/home.png` | Fresh connected Home workspace |
| `readme-v1/active-queue.png` | Live conversation with a durable queued follow-up |
| `readme-v1/approval.png` | Stable strict-mode approval state |
| `readme-v1/completed-work.png` | Completed result and file-review actions |
| `readme-v1/artifacts.png` | Artifact library with rendered Markdown preview |
| `readme-v1/settings-trust.png` | Preferences and trust defaults |

Source app icon: `apps/desktop/build/icon.png`.  
Walkthrough captures: `docs/evidence/frontend-10-walkthrough/`.

The `readme-v1` set is generated from an ignored, isolated profile with
`pnpm --filter @grokdesk/desktop capture:readme`, then stripped and optimized
with ImageMagick. It contains synthetic demo content only.
