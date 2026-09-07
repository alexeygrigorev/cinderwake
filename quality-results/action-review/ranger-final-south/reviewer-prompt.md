Inspect these game action images with visual tools. Preferred reviewer: gpt-5.6-luna. This is a scoped visual review, not whole-game approval.
You MUST open every listed PNG at original resolution using view_image or equivalent image input. Reading filenames, source code, JSON or automatic PASS results is not image inspection. The recorded input defines expected direction; independently identify the visible tip/front and compare it to motion. Do not infer visual correctness from metadata.
Identify front and tail by their shape, not brightness alone: an arrow's bright fletching may be its tail, while a darker metal point is its head. When ambiguous, inspect the authored asset as a reference, then verify the actual rendered frames; an asset alone cannot pass the scene. Distinguish moving projectiles from arrows or effects baked into actor animation cells. Flag a baked-in extra projectile that points or moves differently from the real action.
For each case merge frames and additionalFrames by tick, then inspect that ordered timeline: windup, release/impact, consecutive flight frames and recovery (or the action's named stages). Open every closeup beside its sourceFrame; these are unscaled native-pixel crops of the same scene, not standalone assets. Compare adjacent frames and track each visible projectile tip across them. Zoom where needed without smoothing. If an arrow or effect is too small, obscured, absent or lacks enough consecutive flight frames to judge its heading, mark the relevant check UNCERTAIN and request a closer/denser capture. Do not guess or pass missing evidence.
For EACH check return PASS, FAIL or UNCERTAIN with a concrete observation and the exact supporting frame paths. FAIL or UNCERTAIN blocks acceptance. Mention backwards arrows, sideways flight, inconsistent flips, wrong emission points, detached effects, clipping, sliding or discontinuous recovery when present. Do not change code or images.
Return JSON only with schemaVersion:1, bundleHash:"d5c123e1a45549888a15cf47fe28d06d62cac5dc20a95be50cb0fcd367fe7066", reviewer:{model:"gpt-5.6-luna"}, and cases:[{id, inspectedFrames:[every frame path], checks:[{id,verdict,observation,frames:[supporting paths]}]}]. Every case and check is required; no blanket verdict.
Cases and precise instructions:
[
  {
    "id": "ranger/attack/south/desktop",
    "actor": "ranger",
    "action": "attack",
    "direction": "south",
    "profile": "desktop",
    "expectation": {
      "intendedDirection": "south",
      "input": {
        "attack": true,
        "aim": {
          "x": 15872,
          "y": 13824
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
            "x": 0,
            "y": 220
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
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0046-ranger-move-south-primary-after.png",
        "sha256": "ad3e0ce520f143a9d3033e7a61d3250822a729be05ee58148882dc46a811f579"
      },
      {
        "stage": "impact",
        "tick": 7,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0047-ranger-move-south-primary-impact.png",
        "sha256": "a76d8763f677de250689c3c369fff49e612b070b8fd788a44d2399cb201daf09"
      },
      {
        "stage": "recovery",
        "tick": 33,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0053-ranger-move-south-primary-recovery.png",
        "sha256": "632387ade88f19a9afb585b4f0c849522a357076598c09e61929efdecf252362"
      }
    ],
    "additionalFrames": [
      {
        "stage": "flight+1",
        "tick": 8,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0048-ranger-move-south-primary-flight-1.png",
        "sha256": "0035b79099c6bc8ac635c8f3cb97870b37910b148d8bc60bf805dad63fd4ac53",
        "projectiles": [
          {
            "id": "projectile:2",
            "owner": "player",
            "hostile": false,
            "position": {
              "x": 15872,
              "y": 13020
            },
            "previousPosition": {
              "x": 15872,
              "y": 12800
            },
            "velocity": {
              "x": 0,
              "y": 220
            },
            "spawnedAtTick": 6
          }
        ]
      },
      {
        "stage": "flight+2",
        "tick": 9,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0049-ranger-move-south-primary-flight-2.png",
        "sha256": "e54ba43a881ae7e7e669582d96f70b10b66de4de67636f4ec75777f13906d9cc",
        "projectiles": [
          {
            "id": "projectile:2",
            "owner": "player",
            "hostile": false,
            "position": {
              "x": 15872,
              "y": 13240
            },
            "previousPosition": {
              "x": 15872,
              "y": 13020
            },
            "velocity": {
              "x": 0,
              "y": 220
            },
            "spawnedAtTick": 6
          }
        ]
      },
      {
        "stage": "flight+3",
        "tick": 10,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0050-ranger-move-south-primary-flight-3.png",
        "sha256": "f1f1a968fbe030c90feb280fdfd54675b91b8525b8ce50a1b0487c9654d1f0ab",
        "projectiles": [
          {
            "id": "projectile:2",
            "owner": "player",
            "hostile": false,
            "position": {
              "x": 15872,
              "y": 13460
            },
            "previousPosition": {
              "x": 15872,
              "y": 13240
            },
            "velocity": {
              "x": 0,
              "y": 220
            },
            "spawnedAtTick": 6
          }
        ]
      },
      {
        "stage": "flight+5",
        "tick": 12,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0051-ranger-move-south-primary-flight-5.png",
        "sha256": "2f830814aaa48a0f0e926db993c7284c1d5a3534886c7405160b054274ea9c75",
        "projectiles": [
          {
            "id": "projectile:2",
            "owner": "player",
            "hostile": false,
            "position": {
              "x": 15872,
              "y": 13900
            },
            "previousPosition": {
              "x": 15872,
              "y": 13680
            },
            "velocity": {
              "x": 0,
              "y": 220
            },
            "spawnedAtTick": 6
          }
        ]
      },
      {
        "stage": "flight+8",
        "tick": 15,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0052-ranger-move-south-primary-flight-8.png",
        "sha256": "7a65381a137e72747720f0516e5f3e520026ca096b93182f7ea65d76ca6a96c8",
        "projectiles": [
          {
            "id": "projectile:2",
            "owner": "player",
            "hostile": false,
            "position": {
              "x": 15872,
              "y": 14560
            },
            "previousPosition": {
              "x": 15872,
              "y": 14340
            },
            "velocity": {
              "x": 0,
              "y": 220
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
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0046-ranger-move-south-primary-after-closeup.png",
        "sha256": "3e1dfece6a10c6cc0d7b422c4f746fea9ea1b236ea6b81f4388255e40fcf1354",
        "sourceFrame": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0046-ranger-move-south-primary-after.png",
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
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0047-ranger-move-south-primary-impact-closeup.png",
        "sha256": "5ed16b41a7a73acd11a023bd5b66f1f1c986c63cf9f69d09ac7d7f64932bd14e",
        "sourceFrame": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0047-ranger-move-south-primary-impact.png",
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
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0048-ranger-move-south-primary-flight-1-closeup.png",
        "sha256": "455ad099025e5206268479d0b588a105c022db213907aa422c24b751af202ec6",
        "sourceFrame": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0048-ranger-move-south-primary-flight-1.png",
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
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0049-ranger-move-south-primary-flight-2-closeup.png",
        "sha256": "aa246f1136e4e254f9c1a70ebd03bef7fe3632a3716a413de3397a3a7a8c7d2e",
        "sourceFrame": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0049-ranger-move-south-primary-flight-2.png",
        "nativeCrop": {
          "left": 671,
          "top": 249,
          "width": 258,
          "height": 258
        }
      },
      {
        "stage": "native-closeup",
        "tick": 10,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0050-ranger-move-south-primary-flight-3-closeup.png",
        "sha256": "55dd564e7d2c0a6462119329b91d49fb709e83e5d678c343c057b4572e45dc37",
        "sourceFrame": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0050-ranger-move-south-primary-flight-3.png",
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
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0051-ranger-move-south-primary-flight-5-closeup.png",
        "sha256": "846b0064412b428139e4262b4ef2e7228ad2f77a87c313b04a2b31040f7997c7",
        "sourceFrame": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0051-ranger-move-south-primary-flight-5.png",
        "nativeCrop": {
          "left": 671,
          "top": 249,
          "width": 258,
          "height": 260
        }
      },
      {
        "stage": "native-closeup",
        "tick": 15,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0052-ranger-move-south-primary-flight-8-closeup.png",
        "sha256": "3571287739e8e42326609d1f7b908c102d42093d5cc4306c2e7fb50a479b0755",
        "sourceFrame": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0052-ranger-move-south-primary-flight-8.png",
        "nativeCrop": {
          "left": 671,
          "top": 249,
          "width": 258,
          "height": 307
        }
      },
      {
        "stage": "native-closeup",
        "tick": 33,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0053-ranger-move-south-primary-recovery-closeup.png",
        "sha256": "0607eb3c8251e54f5473eb71db866bb450c1f51d462537d76cb9933bea2b9fe6",
        "sourceFrame": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0053-ranger-move-south-primary-recovery.png",
        "nativeCrop": {
          "left": 671,
          "top": 249,
          "width": 258,
          "height": 585
        }
      }
    ]
  },
  {
    "id": "ranger/ability/south/desktop",
    "actor": "ranger",
    "action": "ability",
    "direction": "south",
    "profile": "desktop",
    "expectation": {
      "intendedDirection": "south",
      "input": {
        "ability": true,
        "aim": {
          "x": 15872,
          "y": 13824
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
            "x": 40,
            "y": 216
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
            "x": 0,
            "y": 220
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
            "x": -40,
            "y": 216
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
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0055-ranger-move-south-ability-after.png",
        "sha256": "6e91ef4b1e3b781ac8dcc51f6be948bf46e0fb43f465d685a4546e7e2a8f5da3"
      },
      {
        "stage": "impact",
        "tick": 11,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0056-ranger-move-south-ability-impact.png",
        "sha256": "63cf7c0697e05b15e00f9e4402fb74c343080814f02441a3c9975e631ed750ea"
      },
      {
        "stage": "recovery",
        "tick": 47,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0062-ranger-move-south-ability-recovery.png",
        "sha256": "9cb7d765add8762b8499d4ab2d67cdc601e753a79c6238450bc7779dbccf09f0"
      }
    ],
    "additionalFrames": [
      {
        "stage": "flight+1",
        "tick": 12,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0057-ranger-move-south-ability-flight-1.png",
        "sha256": "b4671ba1dcbeac7691f533b399eec696e528a0dd0b343cd1cf9e4b4946ad8d07",
        "projectiles": [
          {
            "id": "projectile:2",
            "owner": "player",
            "hostile": false,
            "position": {
              "x": 15912,
              "y": 13016
            },
            "previousPosition": {
              "x": 15872,
              "y": 12800
            },
            "velocity": {
              "x": 40,
              "y": 216
            },
            "spawnedAtTick": 10
          },
          {
            "id": "projectile:3",
            "owner": "player",
            "hostile": false,
            "position": {
              "x": 15872,
              "y": 13020
            },
            "previousPosition": {
              "x": 15872,
              "y": 12800
            },
            "velocity": {
              "x": 0,
              "y": 220
            },
            "spawnedAtTick": 10
          },
          {
            "id": "projectile:4",
            "owner": "player",
            "hostile": false,
            "position": {
              "x": 15832,
              "y": 13016
            },
            "previousPosition": {
              "x": 15872,
              "y": 12800
            },
            "velocity": {
              "x": -40,
              "y": 216
            },
            "spawnedAtTick": 10
          }
        ]
      },
      {
        "stage": "flight+2",
        "tick": 13,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0058-ranger-move-south-ability-flight-2.png",
        "sha256": "ac489dab41d333efd6b86f9b4e67d1abd754aceb16daa11c1780e0f0bc13f2a9",
        "projectiles": [
          {
            "id": "projectile:2",
            "owner": "player",
            "hostile": false,
            "position": {
              "x": 15952,
              "y": 13232
            },
            "previousPosition": {
              "x": 15912,
              "y": 13016
            },
            "velocity": {
              "x": 40,
              "y": 216
            },
            "spawnedAtTick": 10
          },
          {
            "id": "projectile:3",
            "owner": "player",
            "hostile": false,
            "position": {
              "x": 15872,
              "y": 13240
            },
            "previousPosition": {
              "x": 15872,
              "y": 13020
            },
            "velocity": {
              "x": 0,
              "y": 220
            },
            "spawnedAtTick": 10
          },
          {
            "id": "projectile:4",
            "owner": "player",
            "hostile": false,
            "position": {
              "x": 15792,
              "y": 13232
            },
            "previousPosition": {
              "x": 15832,
              "y": 13016
            },
            "velocity": {
              "x": -40,
              "y": 216
            },
            "spawnedAtTick": 10
          }
        ]
      },
      {
        "stage": "flight+3",
        "tick": 14,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0059-ranger-move-south-ability-flight-3.png",
        "sha256": "4e3098c22680937b852b07d45c94731632675620cbd060fd1dee0c3cb9434ea0",
        "projectiles": [
          {
            "id": "projectile:2",
            "owner": "player",
            "hostile": false,
            "position": {
              "x": 15992,
              "y": 13448
            },
            "previousPosition": {
              "x": 15952,
              "y": 13232
            },
            "velocity": {
              "x": 40,
              "y": 216
            },
            "spawnedAtTick": 10
          },
          {
            "id": "projectile:3",
            "owner": "player",
            "hostile": false,
            "position": {
              "x": 15872,
              "y": 13460
            },
            "previousPosition": {
              "x": 15872,
              "y": 13240
            },
            "velocity": {
              "x": 0,
              "y": 220
            },
            "spawnedAtTick": 10
          },
          {
            "id": "projectile:4",
            "owner": "player",
            "hostile": false,
            "position": {
              "x": 15752,
              "y": 13448
            },
            "previousPosition": {
              "x": 15792,
              "y": 13232
            },
            "velocity": {
              "x": -40,
              "y": 216
            },
            "spawnedAtTick": 10
          }
        ]
      },
      {
        "stage": "flight+5",
        "tick": 16,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0060-ranger-move-south-ability-flight-5.png",
        "sha256": "b11cd0a7e071d590e10c1bb0fbc7517246deeadfdb64f2cffccf369b39bec862",
        "projectiles": [
          {
            "id": "projectile:2",
            "owner": "player",
            "hostile": false,
            "position": {
              "x": 16072,
              "y": 13880
            },
            "previousPosition": {
              "x": 16032,
              "y": 13664
            },
            "velocity": {
              "x": 40,
              "y": 216
            },
            "spawnedAtTick": 10
          },
          {
            "id": "projectile:3",
            "owner": "player",
            "hostile": false,
            "position": {
              "x": 15872,
              "y": 13900
            },
            "previousPosition": {
              "x": 15872,
              "y": 13680
            },
            "velocity": {
              "x": 0,
              "y": 220
            },
            "spawnedAtTick": 10
          },
          {
            "id": "projectile:4",
            "owner": "player",
            "hostile": false,
            "position": {
              "x": 15672,
              "y": 13880
            },
            "previousPosition": {
              "x": 15712,
              "y": 13664
            },
            "velocity": {
              "x": -40,
              "y": 216
            },
            "spawnedAtTick": 10
          }
        ]
      },
      {
        "stage": "flight+8",
        "tick": 19,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0061-ranger-move-south-ability-flight-8.png",
        "sha256": "c97c7ccb7c8e73e625e22fb1f8a6cf70169b32b2d4f5206a4592663185ac5cb7",
        "projectiles": [
          {
            "id": "projectile:2",
            "owner": "player",
            "hostile": false,
            "position": {
              "x": 16192,
              "y": 14528
            },
            "previousPosition": {
              "x": 16152,
              "y": 14312
            },
            "velocity": {
              "x": 40,
              "y": 216
            },
            "spawnedAtTick": 10
          },
          {
            "id": "projectile:3",
            "owner": "player",
            "hostile": false,
            "position": {
              "x": 15872,
              "y": 14560
            },
            "previousPosition": {
              "x": 15872,
              "y": 14340
            },
            "velocity": {
              "x": 0,
              "y": 220
            },
            "spawnedAtTick": 10
          },
          {
            "id": "projectile:4",
            "owner": "player",
            "hostile": false,
            "position": {
              "x": 15552,
              "y": 14528
            },
            "previousPosition": {
              "x": 15592,
              "y": 14312
            },
            "velocity": {
              "x": -40,
              "y": 216
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
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0055-ranger-move-south-ability-after-closeup.png",
        "sha256": "454491ca38869008caa3a01af8b0f99a80bb19f56545612ab5f58defd179a362",
        "sourceFrame": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0055-ranger-move-south-ability-after.png",
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
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0056-ranger-move-south-ability-impact-closeup.png",
        "sha256": "7e8511b39c13e1e5fd77fb3ac67ec6ef00f1a6afb814744e45f3d174d63d14fd",
        "sourceFrame": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0056-ranger-move-south-ability-impact.png",
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
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0057-ranger-move-south-ability-flight-1-closeup.png",
        "sha256": "fa3aa5280a2d3119be059986cce7bec34bfa9be9295f3f69db66341c354fe091",
        "sourceFrame": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0057-ranger-move-south-ability-flight-1.png",
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
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0058-ranger-move-south-ability-flight-2-closeup.png",
        "sha256": "a120b52dd513b1407210802771a08f739ed0c9a51479a0f205bb075010de698d",
        "sourceFrame": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0058-ranger-move-south-ability-flight-2.png",
        "nativeCrop": {
          "left": 671,
          "top": 249,
          "width": 258,
          "height": 258
        }
      },
      {
        "stage": "native-closeup",
        "tick": 14,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0059-ranger-move-south-ability-flight-3-closeup.png",
        "sha256": "0f6486c058e911545123eab5236c0540d7f37d8614cfc8eca56c7abe878a1392",
        "sourceFrame": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0059-ranger-move-south-ability-flight-3.png",
        "nativeCrop": {
          "left": 671,
          "top": 249,
          "width": 258,
          "height": 258
        }
      },
      {
        "stage": "native-closeup",
        "tick": 16,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0060-ranger-move-south-ability-flight-5-closeup.png",
        "sha256": "862b73fa00798d07a91d0b3abf9730c235caa0c6f12ef8a0652107a6d85f8915",
        "sourceFrame": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0060-ranger-move-south-ability-flight-5.png",
        "nativeCrop": {
          "left": 671,
          "top": 249,
          "width": 258,
          "height": 260
        }
      },
      {
        "stage": "native-closeup",
        "tick": 19,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0061-ranger-move-south-ability-flight-8-closeup.png",
        "sha256": "e5bfbeea204f98eecaadaee828a05c821d9345e350f7dd7015c3ffe5990f63ff",
        "sourceFrame": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0061-ranger-move-south-ability-flight-8.png",
        "nativeCrop": {
          "left": 671,
          "top": 249,
          "width": 259,
          "height": 307
        }
      },
      {
        "stage": "native-closeup",
        "tick": 47,
        "file": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0062-ranger-move-south-ability-recovery-closeup.png",
        "sha256": "c1468cb4a44696fc98bd5e19026c2d9053c5c40deb21d1062e7bc34f1a38697e",
        "sourceFrame": "quality-results/directional-bank/ranger-final/desktop/frames/frame-0062-ranger-move-south-ability-recovery.png",
        "nativeCrop": {
          "left": 662,
          "top": 249,
          "width": 347,
          "height": 651
        }
      }
    ]
  }
]
