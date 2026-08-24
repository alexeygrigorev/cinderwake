# Isolated-pose assembly contract

Use isolated-pose assembly when a generator cannot preserve distinct semantics
inside a complete 4 × 4 sheet. It is appropriate only after one identity master
has passed mechanical and independent exact-hash visual review. A rejected
master must not seed more poses.

## Workflow

1. Freeze one common prompt-prefix file containing identity, camera, material,
   lighting, proportions, framing, chroma, and exclusion rules.
2. Freeze one phase prompt per isolated cell. Every phase prompt must begin with
   the exact bytes of the common prefix; only the final semantic phase block
   changes.
3. Generate one square pose per prompt, preserve the original bytes and
   artifact ID, and use the same ordered reference records for every pose.
4. Declare all 16 cells. A cell is either `isolated` or copied from an
   exact-hash `baseSheet` cell.
5. Run a draft assembly without `preparedSha256` or `visualReview`:

   ```bash
   node scripts/assemble-actor-source.mjs \
     --manifest art/generation/assemblies/<actor>-<family>-v1.json \
     --output art/generation/prepared/<actor>-<family>-v1.png \
     --report quality-results/actor-pose-assembly/<actor>-<family>-v1.json
   ```

   The common scale is capped at the canonical 1024→256 factor, so compliant
   raw framing is preserved and only an oversized set is reduced.

6. Run candidate calibration, atlas build/audit, real start→walk→stop and mobile
   captures, then inspect the exact source and runtime frame sequence.
7. Add the resulting output hash and independent six-axis review. Rerun the same
   command; a changed pose, base cell, prompt, reference, placement, or scale now
   invalidates the record.

## Minimal manifest shape

```json
{
  "schemaVersion": 1,
  "contract": "CinderwakeIsolatedPoseAssemblyV1",
  "id": "actor-primary-v1",
  "actorId": "actor",
  "sourceFamily": "primary",
  "actorContract": {
    "file": "art/actor-atlas-v1.json",
    "sha256": "<exact hash>"
  },
  "styleBrief": {
    "file": "art/style-bible.md",
    "sha256": "<exact hash>"
  },
  "baseSheet": {
    "file": "art/generation/prepared/<accepted-base>.png",
    "sha256": "<exact hash>"
  },
  "cells": [
    {
      "index": 0,
      "semanticRole": "east-idle-contact-a",
      "source": { "kind": "inherited", "baseCell": 0 }
    },
    {
      "index": 4,
      "semanticRole": "east-walk-contact-a-near-fore-far-hind",
      "source": {
        "kind": "isolated",
        "raw": {
          "file": "art/generation/candidates/<pose>.png",
          "sha256": "<exact hash>"
        },
        "prompt": {
          "file": "art/generation/prompts/<pose>.txt",
          "sha256": "<exact hash>"
        },
        "commonPromptPrefix": {
          "file": "art/generation/prompts/<actor>-common.txt",
          "sha256": "<exact hash>"
        },
        "references": [
          {
            "file": "art/source/actors/<identity>.png",
            "sha256": "<exact hash>",
            "role": "identity, camera, material, and proportion lock"
          }
        ],
        "generation": {
          "tool": "OpenAI built-in image generation tool",
          "artifactId": "<immutable artifact id>"
        }
      }
    }
  ],
  "preparedSha256": "<add only after draft assembly>",
  "visualReview": {
    "verdict": "ACCEPT",
    "reviewer": "<independent reviewer task>",
    "reviewedPreparedSha256": "<same prepared hash>",
    "axes": [
      {
        "axis": "identity-and-style",
        "verdict": "ACCEPT",
        "notes": "<finding>"
      },
      {
        "axis": "anatomy-and-proportion",
        "verdict": "ACCEPT",
        "notes": "<finding>"
      },
      {
        "axis": "pose-semantics",
        "verdict": "ACCEPT",
        "notes": "<finding>"
      },
      {
        "axis": "animation-continuity",
        "verdict": "ACCEPT",
        "notes": "<finding>"
      },
      {
        "axis": "grounding-and-contact",
        "verdict": "ACCEPT",
        "notes": "<finding>"
      },
      {
        "axis": "raster-cleanliness",
        "verdict": "ACCEPT",
        "notes": "<finding>"
      }
    ]
  }
}
```

The real `cells` array must contain indexes 0 through 15 exactly once. Raw
isolated poses must be square and at least 1024 pixels. No nested cell field may
be named `scale`, `scaleX`, `scaleY`, `resize`, or `transform`.

For a four-phase east walk, use explicit roles:

| Cell | Required support meaning                                     |
| ---- | ------------------------------------------------------------ |
| 4    | contact A — near fore and far hind own support               |
| 5    | passing A — the same diagonal pair carries visible weight    |
| 6    | contact B — far fore and near hind own support               |
| 7    | passing B — the complementary pair returns cleanly to cell 4 |

Source assembly proves only shared isolated-pose scale, preserved 1024→256
canvas framing, fixed placement, and provenance.
`npm run art:candidate:check`, `npm run art:animation:check`, and the temporal
capture matrix remain mandatory because a clean cut cannot prove natural gait
or consistency with inherited cells.
