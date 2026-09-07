Inspect these game action images with visual tools. Preferred reviewer: gpt-5.6-luna. This is a scoped visual review, not whole-game approval.
You MUST open every listed PNG at original resolution using view_image or equivalent image input. Reading filenames, source code, JSON or automatic PASS results is not image inspection. The recorded input defines expected direction; independently identify the visible tip/front and compare it to motion. Do not infer visual correctness from metadata.
Identify front and tail by their shape, not brightness alone: an arrow's bright fletching may be its tail, while a darker metal point is its head. When ambiguous, inspect the authored asset as a reference, then verify the actual rendered frames; an asset alone cannot pass the scene. Distinguish moving projectiles from arrows or effects baked into actor animation cells. Flag a baked-in extra projectile that points or moves differently from the real action.
For each case merge frames and additionalFrames by tick, then inspect that ordered timeline: windup, release/impact, consecutive flight frames and recovery (or the action's named stages). Open every closeup beside its sourceFrame; these are unscaled native-pixel crops of the same scene, not standalone assets. Compare adjacent frames and track each visible projectile tip across them. Zoom where needed without smoothing. If an arrow or effect is too small, obscured, absent or lacks enough consecutive flight frames to judge its heading, mark the relevant check UNCERTAIN and request a closer/denser capture. Do not guess or pass missing evidence.
For EACH check return PASS, FAIL or UNCERTAIN with a concrete observation and the exact supporting frame paths. FAIL or UNCERTAIN blocks acceptance. Mention backwards arrows, sideways flight, inconsistent flips, wrong emission points, detached effects, clipping, sliding or discontinuous recovery when present. Do not change code or images.
Return JSON only with schemaVersion:1, bundleHash:"a1881cdf9c946c305ff9c4b9a55a1e42f7f383f7c9678ed3fd28e56860b3f27e", reviewer:{model:"gpt-5.6-luna"}, and cases:[{id, inspectedFrames:[every frame path], checks:[{id,verdict,observation,frames:[supporting paths]}]}]. Every case and check is required; no blanket verdict.
Cases and precise instructions:
[
  {
    "id": "ranger/attack/east/desktop",
    "actor": "ranger",
    "action": "attack",
    "direction": "east",
    "profile": "desktop",
    "expectation": {
      "intendedDirection": "east",
      "input": {
        "attack": true,
        "aim": {
          "x": 16896,
          "y": 12800
        }
      },
      "produced": [
        {
          "id": "projectile:2",
          "type": "projectile",
          "ownerId": "player",
          "position": {
            "x": 15872,
            "y": 12800
          },
          "velocity": {
            "x": 220,
            "y": 0
          }
        }
      ],
      "note": "Screen north is up, east right, south down, west left. Evaluate actual painted tips; direction metadata alone cannot establish them."
    },
    "automatic": {
      "pass": true,
      "evidence": "quality-results/directional-bank/ranger-final/comparison.json",
      "sha256": "5acf55d08d73cb0095c6947e4533b910043fa506156126f67882debbeff4b591"
    },
    "checks": [
      {
        "id": "visible-heading",
        "instruction": "Identify the actual visible arrowhead or effect front independently of its bounding box and metadata. Does it point toward the declared target and along its displacement, in this cardinal direction? For melee, check the swing faces the target. A sideways or backwards arrow is FAIL."
      },
      {
        "id": "origin-and-timing",
        "instruction": "Does the projectile visibly leave the bow, hand or weapon at release, with no detached start or incorrect side after reflection? Compare windup, impact and recovery for continuous identity and a readable connection between action and result."
      },
      {
        "id": "readable-motion",
        "instruction": "Check the action at actual gameplay scale and inspect small details at original resolution. Flag clipped arrows, misleading streaks, wrong orientation, equipment popping, incoherent recovery or unclear impact. If sparse frames cannot establish movement, return UNCERTAIN and request consecutive flight frames."
      }
    ],
    "frames": [
      {
        "stage": "windup",
        "tick": 1,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0025-ranger-move-east-primary-after.png",
        "sha256": "af54bd0637a4d5bb8b8a78b6320df366cd085742f8e00076716fbf33177cf2f5"
      },
      {
        "stage": "impact",
        "tick": 7,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0026-ranger-move-east-primary-impact.png",
        "sha256": "8b4bd5914ba7c02f258befe598ca0de72e10bf33793cbabcafb6b3e2d7e24646"
      },
      {
        "stage": "recovery",
        "tick": 33,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0032-ranger-move-east-primary-recovery.png",
        "sha256": "bed5f28a489a5cdab61a784236508795de50f9905928141e3c1636fe019223f5"
      }
    ],
    "additionalFrames": [
      {
        "stage": "flight+1",
        "tick": 8,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0027-ranger-move-east-primary-flight-1.png",
        "sha256": "997550ec0ec8acba5e47a15d7605ed97a901597bf7b0fc2bdc1d1b39929a019a",
        "projectiles": [
          {
            "id": "projectile:2",
            "owner": "player",
            "hostile": false,
            "position": {
              "x": 16092,
              "y": 12800
            },
            "previousPosition": {
              "x": 15872,
              "y": 12800
            },
            "velocity": {
              "x": 220,
              "y": 0
            },
            "spawnedAtTick": 6
          }
        ]
      },
      {
        "stage": "flight+2",
        "tick": 9,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0028-ranger-move-east-primary-flight-2.png",
        "sha256": "507364da9b78820f76b0ddcc8be1f8aa1b750bbc40c66c9268e6aea84e4939dc",
        "projectiles": [
          {
            "id": "projectile:2",
            "owner": "player",
            "hostile": false,
            "position": {
              "x": 16312,
              "y": 12800
            },
            "previousPosition": {
              "x": 16092,
              "y": 12800
            },
            "velocity": {
              "x": 220,
              "y": 0
            },
            "spawnedAtTick": 6
          }
        ]
      },
      {
        "stage": "flight+3",
        "tick": 10,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0029-ranger-move-east-primary-flight-3.png",
        "sha256": "731cf7467baff3a75b86f0723a36230bb0a2006ad5b20e19bdf2e7bd8cc36a41",
        "projectiles": [
          {
            "id": "projectile:2",
            "owner": "player",
            "hostile": false,
            "position": {
              "x": 16532,
              "y": 12800
            },
            "previousPosition": {
              "x": 16312,
              "y": 12800
            },
            "velocity": {
              "x": 220,
              "y": 0
            },
            "spawnedAtTick": 6
          }
        ]
      },
      {
        "stage": "flight+5",
        "tick": 12,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0030-ranger-move-east-primary-flight-5.png",
        "sha256": "117fd6a7da239eb26bc5347a54036945768dfc04f27c78420f28f8235999a6e3",
        "projectiles": [
          {
            "id": "projectile:2",
            "owner": "player",
            "hostile": false,
            "position": {
              "x": 16972,
              "y": 12800
            },
            "previousPosition": {
              "x": 16752,
              "y": 12800
            },
            "velocity": {
              "x": 220,
              "y": 0
            },
            "spawnedAtTick": 6
          }
        ]
      },
      {
        "stage": "flight+8",
        "tick": 15,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0031-ranger-move-east-primary-flight-8.png",
        "sha256": "ad61bfec3389a1e58b29e5127bf8eed701f35e93e42401dda3f23b0861bcfe12",
        "projectiles": [
          {
            "id": "projectile:2",
            "owner": "player",
            "hostile": false,
            "position": {
              "x": 17632,
              "y": 12800
            },
            "previousPosition": {
              "x": 17412,
              "y": 12800
            },
            "velocity": {
              "x": 220,
              "y": 0
            },
            "spawnedAtTick": 6
          }
        ]
      }
    ],
    "closeups": [
      {
        "stage": "native-closeup",
        "tick": 1,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0025-ranger-move-east-primary-after-closeup.png",
        "sha256": "333bab067f584a0eef1f02c245d72527f0c964b99ccf0c6e771808ff241ace82",
        "sourceFrame": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0025-ranger-move-east-primary-after.png",
        "nativeCrop": {
          "left": 671,
          "top": 249,
          "width": 258,
          "height": 258
        }
      },
      {
        "stage": "native-closeup",
        "tick": 7,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0026-ranger-move-east-primary-impact-closeup.png",
        "sha256": "95535987866dbcf58248587f6a3c929170f95ff013fe2983ee591acac8788ac0",
        "sourceFrame": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0026-ranger-move-east-primary-impact.png",
        "nativeCrop": {
          "left": 671,
          "top": 249,
          "width": 258,
          "height": 258
        }
      },
      {
        "stage": "native-closeup",
        "tick": 8,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0027-ranger-move-east-primary-flight-1-closeup.png",
        "sha256": "6182083bb0ac17d895c2dd1c780440cbc466b359e87d41e64f5e5d59fcbacca4",
        "sourceFrame": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0027-ranger-move-east-primary-flight-1.png",
        "nativeCrop": {
          "left": 671,
          "top": 249,
          "width": 258,
          "height": 258
        }
      },
      {
        "stage": "native-closeup",
        "tick": 9,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0028-ranger-move-east-primary-flight-2-closeup.png",
        "sha256": "eb330fbda60e55fc8201cd7111398a3f409fabf196d111a9bce4ff289f77a1ef",
        "sourceFrame": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0028-ranger-move-east-primary-flight-2.png",
        "nativeCrop": {
          "left": 671,
          "top": 249,
          "width": 264,
          "height": 258
        }
      },
      {
        "stage": "native-closeup",
        "tick": 10,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0029-ranger-move-east-primary-flight-3-closeup.png",
        "sha256": "094ab914399960e439b8b1d59c116dcc50428b798682a1da1511f7a7e16f7cf6",
        "sourceFrame": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0029-ranger-move-east-primary-flight-3.png",
        "nativeCrop": {
          "left": 671,
          "top": 249,
          "width": 279,
          "height": 258
        }
      },
      {
        "stage": "native-closeup",
        "tick": 12,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0030-ranger-move-east-primary-flight-5-closeup.png",
        "sha256": "1ed0f3fb723a1b4deb3f0c7486027a2d1b5b37facbc7ccf6908f40a1139edab0",
        "sourceFrame": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0030-ranger-move-east-primary-flight-5.png",
        "nativeCrop": {
          "left": 671,
          "top": 249,
          "width": 310,
          "height": 258
        }
      },
      {
        "stage": "native-closeup",
        "tick": 15,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0031-ranger-move-east-primary-flight-8-closeup.png",
        "sha256": "3c0c4f05f37e358583944630bd190f210469a479ec6fc274da5e462eadcdee57",
        "sourceFrame": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0031-ranger-move-east-primary-flight-8.png",
        "nativeCrop": {
          "left": 671,
          "top": 249,
          "width": 357,
          "height": 258
        }
      },
      {
        "stage": "native-closeup",
        "tick": 33,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0032-ranger-move-east-primary-recovery-closeup.png",
        "sha256": "a3fe24cbd10b6bff7898ff24e1923092cc956a791d136c1ee88ca5abd10c49d1",
        "sourceFrame": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0032-ranger-move-east-primary-recovery.png",
        "nativeCrop": {
          "left": 671,
          "top": 249,
          "width": 635,
          "height": 258
        }
      }
    ]
  },
  {
    "id": "ranger/ability/east/desktop",
    "actor": "ranger",
    "action": "ability",
    "direction": "east",
    "profile": "desktop",
    "expectation": {
      "intendedDirection": "east",
      "input": {
        "ability": true,
        "aim": {
          "x": 16896,
          "y": 12800
        }
      },
      "produced": [
        {
          "id": "projectile:2",
          "type": "projectile",
          "ownerId": "player",
          "position": {
            "x": 15872,
            "y": 12800
          },
          "velocity": {
            "x": 216,
            "y": -40
          }
        },
        {
          "id": "projectile:3",
          "type": "projectile",
          "ownerId": "player",
          "position": {
            "x": 15872,
            "y": 12800
          },
          "velocity": {
            "x": 220,
            "y": 0
          }
        },
        {
          "id": "projectile:4",
          "type": "projectile",
          "ownerId": "player",
          "position": {
            "x": 15872,
            "y": 12800
          },
          "velocity": {
            "x": 216,
            "y": 40
          }
        }
      ],
      "note": "Screen north is up, east right, south down, west left. Evaluate actual painted tips; direction metadata alone cannot establish them."
    },
    "automatic": {
      "pass": true,
      "evidence": "quality-results/directional-bank/ranger-final/comparison.json",
      "sha256": "5acf55d08d73cb0095c6947e4533b910043fa506156126f67882debbeff4b591"
    },
    "checks": [
      {
        "id": "visible-heading",
        "instruction": "Identify the visible tip/front of every projectile or directional effect and compare it with target direction and displacement. A Ranger fan must spread around the intended direction and each arrowhead must align with its own travel. For radial effects inspect symmetry and centering."
      },
      {
        "id": "origin-and-timing",
        "instruction": "Compare anticipation, release and recovery: effects must originate at the correct hand/weapon or actor center and remain attached through mirroring. Flag discontinuity, equipment popping, disconnected effects or unreadable consequence."
      },
      {
        "id": "readable-motion",
        "instruction": "Check each effect at gameplay size and original resolution. Flag clipping, unrelated white streaks, reversed tips and visual overlap that hides intent. Return UNCERTAIN when the frame interval or crop cannot reveal projectile motion."
      }
    ],
    "frames": [
      {
        "stage": "windup",
        "tick": 1,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0034-ranger-move-east-ability-after.png",
        "sha256": "73ac012c448b03b5c5652618ea364d47d6dfcd19cb7f1b40dbef9ff365c28d38"
      },
      {
        "stage": "impact",
        "tick": 11,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0035-ranger-move-east-ability-impact.png",
        "sha256": "5fcb12f5020d21aaa4495bb933803949ff76de37b3b5552137004135ac3bf903"
      },
      {
        "stage": "recovery",
        "tick": 47,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0041-ranger-move-east-ability-recovery.png",
        "sha256": "6b74cf788ff31535ac71b14ff14f908059bdb91ab046ac6bf6a9c0dd55cdaee0"
      }
    ],
    "additionalFrames": [
      {
        "stage": "flight+1",
        "tick": 12,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0036-ranger-move-east-ability-flight-1.png",
        "sha256": "c1151d8a2b044aff1cb90b6cbb08b974e74403c2944a90ec09b443d8a571016e",
        "projectiles": [
          {
            "id": "projectile:2",
            "owner": "player",
            "hostile": false,
            "position": {
              "x": 16088,
              "y": 12760
            },
            "previousPosition": {
              "x": 15872,
              "y": 12800
            },
            "velocity": {
              "x": 216,
              "y": -40
            },
            "spawnedAtTick": 10
          },
          {
            "id": "projectile:3",
            "owner": "player",
            "hostile": false,
            "position": {
              "x": 16092,
              "y": 12800
            },
            "previousPosition": {
              "x": 15872,
              "y": 12800
            },
            "velocity": {
              "x": 220,
              "y": 0
            },
            "spawnedAtTick": 10
          },
          {
            "id": "projectile:4",
            "owner": "player",
            "hostile": false,
            "position": {
              "x": 16088,
              "y": 12840
            },
            "previousPosition": {
              "x": 15872,
              "y": 12800
            },
            "velocity": {
              "x": 216,
              "y": 40
            },
            "spawnedAtTick": 10
          }
        ]
      },
      {
        "stage": "flight+2",
        "tick": 13,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0037-ranger-move-east-ability-flight-2.png",
        "sha256": "b308f8ed47f56015a70fb62081841ea55e32c2f35e91277784d76d67ec36757c",
        "projectiles": [
          {
            "id": "projectile:2",
            "owner": "player",
            "hostile": false,
            "position": {
              "x": 16304,
              "y": 12720
            },
            "previousPosition": {
              "x": 16088,
              "y": 12760
            },
            "velocity": {
              "x": 216,
              "y": -40
            },
            "spawnedAtTick": 10
          },
          {
            "id": "projectile:3",
            "owner": "player",
            "hostile": false,
            "position": {
              "x": 16312,
              "y": 12800
            },
            "previousPosition": {
              "x": 16092,
              "y": 12800
            },
            "velocity": {
              "x": 220,
              "y": 0
            },
            "spawnedAtTick": 10
          },
          {
            "id": "projectile:4",
            "owner": "player",
            "hostile": false,
            "position": {
              "x": 16304,
              "y": 12880
            },
            "previousPosition": {
              "x": 16088,
              "y": 12840
            },
            "velocity": {
              "x": 216,
              "y": 40
            },
            "spawnedAtTick": 10
          }
        ]
      },
      {
        "stage": "flight+3",
        "tick": 14,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0038-ranger-move-east-ability-flight-3.png",
        "sha256": "bf6e3868ad0dc9851fa0b06785f6ad0a5e8eb01064aa3aa955233095b1d1bf06",
        "projectiles": [
          {
            "id": "projectile:2",
            "owner": "player",
            "hostile": false,
            "position": {
              "x": 16520,
              "y": 12680
            },
            "previousPosition": {
              "x": 16304,
              "y": 12720
            },
            "velocity": {
              "x": 216,
              "y": -40
            },
            "spawnedAtTick": 10
          },
          {
            "id": "projectile:3",
            "owner": "player",
            "hostile": false,
            "position": {
              "x": 16532,
              "y": 12800
            },
            "previousPosition": {
              "x": 16312,
              "y": 12800
            },
            "velocity": {
              "x": 220,
              "y": 0
            },
            "spawnedAtTick": 10
          },
          {
            "id": "projectile:4",
            "owner": "player",
            "hostile": false,
            "position": {
              "x": 16520,
              "y": 12920
            },
            "previousPosition": {
              "x": 16304,
              "y": 12880
            },
            "velocity": {
              "x": 216,
              "y": 40
            },
            "spawnedAtTick": 10
          }
        ]
      },
      {
        "stage": "flight+5",
        "tick": 16,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0039-ranger-move-east-ability-flight-5.png",
        "sha256": "1d643ce73d2073c132ae56f5c404aff89244836f39ff61aa53595c3111cdcfbb",
        "projectiles": [
          {
            "id": "projectile:2",
            "owner": "player",
            "hostile": false,
            "position": {
              "x": 16952,
              "y": 12600
            },
            "previousPosition": {
              "x": 16736,
              "y": 12640
            },
            "velocity": {
              "x": 216,
              "y": -40
            },
            "spawnedAtTick": 10
          },
          {
            "id": "projectile:3",
            "owner": "player",
            "hostile": false,
            "position": {
              "x": 16972,
              "y": 12800
            },
            "previousPosition": {
              "x": 16752,
              "y": 12800
            },
            "velocity": {
              "x": 220,
              "y": 0
            },
            "spawnedAtTick": 10
          },
          {
            "id": "projectile:4",
            "owner": "player",
            "hostile": false,
            "position": {
              "x": 16952,
              "y": 13000
            },
            "previousPosition": {
              "x": 16736,
              "y": 12960
            },
            "velocity": {
              "x": 216,
              "y": 40
            },
            "spawnedAtTick": 10
          }
        ]
      },
      {
        "stage": "flight+8",
        "tick": 19,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0040-ranger-move-east-ability-flight-8.png",
        "sha256": "97332655dd8f544236cd3d2478a0784d90b5fa6d371b4dc92c1b0c6ad8c1b85e",
        "projectiles": [
          {
            "id": "projectile:2",
            "owner": "player",
            "hostile": false,
            "position": {
              "x": 17600,
              "y": 12480
            },
            "previousPosition": {
              "x": 17384,
              "y": 12520
            },
            "velocity": {
              "x": 216,
              "y": -40
            },
            "spawnedAtTick": 10
          },
          {
            "id": "projectile:3",
            "owner": "player",
            "hostile": false,
            "position": {
              "x": 17632,
              "y": 12800
            },
            "previousPosition": {
              "x": 17412,
              "y": 12800
            },
            "velocity": {
              "x": 220,
              "y": 0
            },
            "spawnedAtTick": 10
          },
          {
            "id": "projectile:4",
            "owner": "player",
            "hostile": false,
            "position": {
              "x": 17600,
              "y": 13120
            },
            "previousPosition": {
              "x": 17384,
              "y": 13080
            },
            "velocity": {
              "x": 216,
              "y": 40
            },
            "spawnedAtTick": 10
          }
        ]
      }
    ],
    "closeups": [
      {
        "stage": "native-closeup",
        "tick": 1,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0034-ranger-move-east-ability-after-closeup.png",
        "sha256": "39cdb973cbdaf3c75d81d9a40bc27d6f0b6d65e0356baf88fdf9fe08f3bddc02",
        "sourceFrame": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0034-ranger-move-east-ability-after.png",
        "nativeCrop": {
          "left": 671,
          "top": 249,
          "width": 258,
          "height": 258
        }
      },
      {
        "stage": "native-closeup",
        "tick": 11,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0035-ranger-move-east-ability-impact-closeup.png",
        "sha256": "237c4fb405cdab17c39ee9798a05265a67b3ae541ab93f45d40b9c4874616e06",
        "sourceFrame": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0035-ranger-move-east-ability-impact.png",
        "nativeCrop": {
          "left": 671,
          "top": 249,
          "width": 258,
          "height": 258
        }
      },
      {
        "stage": "native-closeup",
        "tick": 12,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0036-ranger-move-east-ability-flight-1-closeup.png",
        "sha256": "45eade0f00cfb508d8914b8f218730ff55affe93731b1a1bf13f97885f6d85f5",
        "sourceFrame": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0036-ranger-move-east-ability-flight-1.png",
        "nativeCrop": {
          "left": 671,
          "top": 249,
          "width": 258,
          "height": 258
        }
      },
      {
        "stage": "native-closeup",
        "tick": 13,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0037-ranger-move-east-ability-flight-2-closeup.png",
        "sha256": "a450f5082f50b4559d3b776f98877ac0c083304ec846993199fe7d4601f5d7ce",
        "sourceFrame": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0037-ranger-move-east-ability-flight-2.png",
        "nativeCrop": {
          "left": 671,
          "top": 249,
          "width": 264,
          "height": 258
        }
      },
      {
        "stage": "native-closeup",
        "tick": 14,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0038-ranger-move-east-ability-flight-3-closeup.png",
        "sha256": "d4f483c53a52d3ff8799744fe00deea00431f28575f7fb3d03c4a8ccd77d89a1",
        "sourceFrame": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0038-ranger-move-east-ability-flight-3.png",
        "nativeCrop": {
          "left": 671,
          "top": 249,
          "width": 279,
          "height": 258
        }
      },
      {
        "stage": "native-closeup",
        "tick": 16,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0039-ranger-move-east-ability-flight-5-closeup.png",
        "sha256": "e509bdbbc21aec5d25401c7286a7831aca14d264213f9e5a4c107b9c09a5a988",
        "sourceFrame": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0039-ranger-move-east-ability-flight-5.png",
        "nativeCrop": {
          "left": 671,
          "top": 249,
          "width": 310,
          "height": 258
        }
      },
      {
        "stage": "native-closeup",
        "tick": 19,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0040-ranger-move-east-ability-flight-8-closeup.png",
        "sha256": "8e23c6d2ff5e794dd545866fa153c5868a31f543afba4705d4287fee3611fa33",
        "sourceFrame": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0040-ranger-move-east-ability-flight-8.png",
        "nativeCrop": {
          "left": 671,
          "top": 249,
          "width": 357,
          "height": 258
        }
      },
      {
        "stage": "native-closeup",
        "tick": 47,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0041-ranger-move-east-ability-recovery-closeup.png",
        "sha256": "ad74ed8741626ca5f65857009134475331079bff174827ce72e1f05b967f8fc2",
        "sourceFrame": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0041-ranger-move-east-ability-recovery.png",
        "nativeCrop": {
          "left": 671,
          "top": 198,
          "width": 790,
          "height": 346
        }
      }
    ]
  }
]
