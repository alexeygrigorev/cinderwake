export const VISIBLE_SPRITE_PROVENANCE_SCENARIO_IDS = [
  "public-selection",
  "ordinary-production-launch",
  "campaign-journal",
  "outcome-win",
  "outcome-loss",
  "embercross-services",
];

export const VISIBLE_SPRITE_PROVENANCE_PROFILE_IDS = [
  "desktop",
  "phone-portrait",
];

export const VISIBLE_SPRITE_PROVENANCE_SIGNAL_IDS = [
  "visible-roles-use-decoded-sprites",
  "text-roles-are-approved",
  "title-roles-exactly-allowlisted",
  "all-visible-draws-have-sprite-provenance",
];

export const VISIBLE_SPRITE_PROVENANCE_FAILURE_IDS = [
  "provenance-inventory-incomplete",
  "non-sprite-visible-role",
  "visible-text-offender",
  "title-role-not-allowlisted",
  "visible-draw-without-sprite-provenance",
  "decoded-asset-missing",
  "manifest-provenance-mismatch",
];

const LOCAL_ASSET_PREFIX = "/assets/";

/** Runs in the browser. Markers are evidence inputs, never an exemption by themselves. */
export function collectCampaignCopyFacts() {
  const facts = {};
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode(),
    index = 0;
  while (node) {
    const element = node.parentElement;
    const root = element?.closest("[data-ui-copy]");
    if (element && root) {
      const scope = root.getAttribute("data-ui-copy");
      facts[index] = {
        scope,
        rootTag: root.tagName,
        rootClass: root.className,
        rootLabel: root.getAttribute("aria-label"),
        gameChild: root.parentElement?.matches("main.game") === true,
        unique:
          [...document.querySelectorAll("[data-ui-copy]")].filter(
            (candidate) => candidate.getAttribute("data-ui-copy") === scope,
          ).length === 1,
        modal: root.matches("dialog[open]:modal"),
        tag: element.tagName,
        fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
        metadata: element.matches(
          "header > div > small, article.discovery > small, [data-checkpoint-indicator][role='status']",
        ),
        control: element.matches(
          "button[data-journal], button[data-interact], button[data-journal] > kbd",
        ),
      };
    }
    node = walker.nextNode();
    index++;
  }
  return facts;
}

export function nativeCampaignCopyPass(copy) {
  if (
    !copy ||
    copy.gameChild !== true ||
    copy.unique !== true ||
    !Number.isFinite(copy.fontSize)
  )
    return false;
  if (copy.scope === "campaign-controls")
    return (
      copy.rootTag === "NAV" &&
      copy.rootClass === "campaign-tools" &&
      copy.rootLabel === "Journey controls" &&
      ((copy.control === true &&
        ["BUTTON", "KBD"].includes(copy.tag) &&
        copy.fontSize >= 14) ||
        (copy.metadata === true && copy.tag === "SPAN" && copy.fontSize >= 12))
    );
  if (
    copy.scope !== "campaign-narrative" ||
    copy.rootTag !== "DIALOG" ||
    copy.rootClass !== "campaign-dialog" ||
    copy.rootLabel !== "The Last Bell journal" ||
    copy.modal !== true
  )
    return false;
  const minimum = {
    P: 16,
    H2: 24,
    H3: 16,
    BUTTON: 14,
    LABEL: 14,
    KBD: 14,
    SUMMARY: 16,
    SPAN: 14,
  }[copy.tag];
  return minimum
    ? copy.fontSize >= minimum
    : copy.tag === "SMALL" && copy.metadata === true && copy.fontSize >= 12;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function localAssetPath(value) {
  if (!isNonEmptyString(value)) return null;
  try {
    const parsed = new URL(value, "http://sprite-provenance.invalid");
    return parsed.pathname.startsWith(LOCAL_ASSET_PREFIX)
      ? parsed.pathname
      : null;
  } catch {
    return null;
  }
}

function decodedAssetPass(profile, provenance) {
  if (!isObject(provenance) || provenance.kind !== "decoded-raster")
    return false;
  const pathName = localAssetPath(provenance.assetUrl);
  if (!pathName) return false;
  const assets = Array.isArray(profile?.decodedAssets)
    ? profile.decodedAssets
    : [];
  return assets.some((asset) => {
    const assetPath = localAssetPath(asset?.url);
    return (
      assetPath === pathName &&
      asset?.decoded === true &&
      Number.isInteger(asset.width) &&
      asset.width > 0 &&
      Number.isInteger(asset.height) &&
      asset.height > 0
    );
  });
}

function decodedCatalogAssetPass(profile, provenance) {
  const reference = isObject(provenance?.provenance)
    ? provenance.provenance
    : provenance;
  if (!isObject(reference)) return false;
  if (reference.kind !== undefined && reference.kind !== "manifest-sprite")
    return false;
  if (
    reference.renderMode !== "sprite" ||
    !isNonEmptyString(reference.assetId) ||
    !isNonEmptyString(reference.spriteId)
  )
    return false;
  const assets = Array.isArray(profile?.decodedAssets)
    ? profile.decodedAssets
    : [];
  return assets.some(
    (asset) => asset?.assetId === reference.assetId && asset.decoded === true,
  );
}

function spriteRolePass(profile, role) {
  return (
    role?.visible === true &&
    role?.role === "sprite" &&
    decodedAssetPass(profile, role.provenance)
  );
}

function titleRolePass(title, titleAllowlist) {
  return (
    title?.visible === true &&
    title?.titleRole === true &&
    isNonEmptyString(title.value) &&
    titleAllowlist.includes(title.value)
  );
}

function declaredCompositionPass(item) {
  return (
    item?.visible === true &&
    isObject(item.provenance) &&
    item.provenance.kind === "declared-composition" &&
    item.provenance.allowed === true
  );
}

function canvasOperationPass(profile, operation) {
  if (operation?.visible !== true) return true;
  if (operation.operation === "drawImage") {
    if (decodedAssetPass(profile, operation.provenance)) return true;
    if (decodedCatalogAssetPass(profile, operation.provenance)) return true;
    return (
      operation.provenance?.kind === "canvas-copy" &&
      operation.provenance.source === "game-canvas"
    );
  }
  return operation.provenance?.kind === "manifest-sprite";
}

function manifestDrawPass(profile, draw) {
  return draw?.visible === false || decodedCatalogAssetPass(profile, draw);
}

function stateInventory(profile, state, titleAllowlist) {
  const roles = Array.isArray(state?.visibleRoles) ? state.visibleRoles : [];
  const textNodes = Array.isArray(state?.textNodes) ? state.textNodes : [];
  const pseudoElements = Array.isArray(state?.pseudoElements)
    ? state.pseudoElements
    : [];
  const cssDecorations = Array.isArray(state?.cssDecorations)
    ? state.cssDecorations
    : [];
  const canvasOperations = Array.isArray(state?.canvasOperations)
    ? state.canvasOperations
    : [];
  const manifestDraws = Array.isArray(state?.manifestDraws)
    ? state.manifestDraws
    : [];
  const roleFailures = roles
    .filter(({ visible }) => visible === true)
    .filter((role) => role.role === "sprite" && !spriteRolePass(profile, role))
    .map((role) => ({ id: role.id ?? null, role }));
  const unknownRoles = roles
    .filter(({ visible }) => visible === true)
    .filter(({ role }) => !["sprite", "layout", "title"].includes(role))
    .map((role) => ({ id: role.id ?? null, role: role.role ?? null }));
  const textFailures = textNodes
    .filter(({ visible }) => visible === true)
    .filter(({ titleRole }) => titleRole !== true)
    .filter(({ nativeCopy }) => !nativeCampaignCopyPass(nativeCopy))
    .map((text) => ({ id: text.id ?? null, value: text.value ?? null }));
  const titleFailures = textNodes
    .filter(({ visible }) => visible === true)
    .filter((text) => !titleRolePass(text, titleAllowlist))
    .filter(({ titleRole }) => titleRole === true)
    .map((text) => ({ id: text.id ?? null, value: text.value ?? null }));
  const pseudoFailures = pseudoElements
    .filter(({ visible }) => visible === true)
    .filter((item) => !declaredCompositionPass(item))
    .map((item) => ({ id: item.id ?? null, item }));
  const decorationFailures = cssDecorations
    .filter(({ visible }) => visible === true)
    .filter((item) => !declaredCompositionPass(item))
    .map((item) => ({ id: item.id ?? null, item }));
  const canvasFailures = canvasOperations
    .filter((operation) => !canvasOperationPass(profile, operation))
    .map((operation) => ({ id: operation.id ?? null, operation }));
  const manifestFailures = manifestDraws
    .filter((draw) => !manifestDrawPass(profile, draw))
    .map((draw) => ({ id: draw.id ?? null, draw }));
  const visibleSpriteRoles = roles.filter(
    ({ visible, role }) => visible === true && role === "sprite",
  );
  const visibleTitles = textNodes.filter(
    ({ visible, titleRole }) => visible === true && titleRole === true,
  );
  return {
    scenarioId: state?.scenarioId ?? null,
    stateId: state?.stateId ?? null,
    visibleSpriteRoleCount: visibleSpriteRoles.length,
    visibleTitleCount: visibleTitles.length,
    visibleNativeCopyCount: textNodes.filter(
      (text) =>
        text.visible === true && nativeCampaignCopyPass(text.nativeCopy),
    ).length,
    manifestDrawCount: manifestDraws.filter(({ visible }) => visible !== false)
      .length,
    canvasOperationCount: canvasOperations.filter(
      ({ visible }) => visible !== false,
    ).length,
    roleFailures: [...roleFailures, ...unknownRoles],
    textFailures,
    titleFailures,
    pseudoFailures,
    decorationFailures,
    canvasFailures,
    manifestFailures,
  };
}

function signal(id, pass, detail) {
  return { id, pass, detail };
}

/**
 * Evaluate a retained DOM/canvas provenance inventory. The recorder owns DOM
 * inspection and decoded-image dimensions; this pure module owns the frozen
 * title policy, sprite provenance rules, and named mutation signals.
 */
export function evaluateVisibleSpriteProvenanceEvidence({
  profiles = [],
  requiredProfiles = VISIBLE_SPRITE_PROVENANCE_PROFILE_IDS,
  requiredScenarioIds = VISIBLE_SPRITE_PROVENANCE_SCENARIO_IDS,
  titleAllowlist = [],
} = {}) {
  const profileMap = new Map(
    profiles.map((profile) => [profile?.profileId, profile]),
  );
  const selectedProfiles = requiredProfiles.map((id) => profileMap.get(id));
  const hasAllProfiles = selectedProfiles.every(Boolean);
  const inventories = selectedProfiles.flatMap((profile) =>
    (Array.isArray(profile?.states) ? profile.states : []).map((state) => ({
      profileId: profile?.profileId ?? null,
      ...stateInventory(profile, state, titleAllowlist),
    })),
  );
  const scenarioCoverage =
    hasAllProfiles &&
    selectedProfiles.every((profile) =>
      requiredScenarioIds.every((scenarioId) =>
        (profile?.states ?? []).some(
          (state) => state?.scenarioId === scenarioId,
        ),
      ),
    );
  const inventoryComplete =
    hasAllProfiles &&
    scenarioCoverage &&
    inventories.length > 0 &&
    inventories.every(
      (inventory) =>
        isNonEmptyString(inventory.scenarioId) &&
        isNonEmptyString(inventory.stateId),
    );
  const allRolesUseDecodedSprites =
    inventoryComplete &&
    inventories.every(
      ({ roleFailures, visibleSpriteRoleCount }) =>
        visibleSpriteRoleCount > 0 && roleFailures.length === 0,
    );
  const allVisibleTextIsApproved =
    inventoryComplete &&
    inventories.every(({ textFailures }) => textFailures.length === 0);
  const allTitleRolesAreAllowlisted =
    inventoryComplete &&
    inventories.every(({ titleFailures }) => titleFailures.length === 0);
  const completeDrawProvenance =
    inventoryComplete &&
    inventories.every(
      ({
        pseudoFailures,
        decorationFailures,
        canvasFailures,
        manifestFailures,
      }) =>
        pseudoFailures.length === 0 &&
        decorationFailures.length === 0 &&
        canvasFailures.length === 0 &&
        manifestFailures.length === 0,
    ) &&
    inventories.some(({ manifestDrawCount }) => manifestDrawCount > 0) &&
    inventories.some(({ canvasOperationCount }) => canvasOperationCount > 0);

  const failures = [];
  if (!inventoryComplete) failures.push("provenance-inventory-incomplete");
  if (!allRolesUseDecodedSprites) failures.push("non-sprite-visible-role");
  if (!allVisibleTextIsApproved) failures.push("visible-text-offender");
  if (!allTitleRolesAreAllowlisted) failures.push("title-role-not-allowlisted");
  if (!completeDrawProvenance)
    failures.push("visible-draw-without-sprite-provenance");
  if (
    inventories.some(({ roleFailures }) =>
      roleFailures.some(
        ({ role }) => role?.provenance?.kind === "decoded-raster",
      ),
    )
  )
    failures.push("decoded-asset-missing");
  if (inventories.some(({ manifestFailures }) => manifestFailures.length > 0))
    failures.push("manifest-provenance-mismatch");

  return {
    pass: failures.length === 0,
    failures: [...new Set(failures)],
    scenarioCoverage,
    signals: [
      signal("visible-roles-use-decoded-sprites", allRolesUseDecodedSprites, {
        inventories,
      }),
      signal("text-roles-are-approved", allVisibleTextIsApproved, {
        inventories,
      }),
      signal("title-roles-exactly-allowlisted", allTitleRolesAreAllowlisted, {
        titleAllowlist,
        inventories,
      }),
      signal(
        "all-visible-draws-have-sprite-provenance",
        completeDrawProvenance,
        { inventories },
      ),
    ],
    profiles: selectedProfiles.map((profile) => profile?.profileId ?? null),
    inventories,
  };
}

/** Exercise each declared provenance mutation against a clean inventory. */
export function runVisibleSpriteProvenanceNegativeControls(evidence) {
  const definitions = [
    {
      id: "role-replaced-with-css-or-text",
      expectedSignal: "non-sprite-visible-role",
      mutate(value) {
        const role = value.profiles[0].states[0].visibleRoles.find(
          ({ role: kind, visible }) => visible === true && kind === "sprite",
        );
        role.provenance = { kind: "plain-text" };
      },
    },
    {
      id: "non-title-marked-as-title",
      expectedSignal: "title-role-not-allowlisted",
      mutate(value) {
        value.profiles[0].states[0].textNodes.push({
          id: "mutation:ordinary-copy",
          value: "Ordinary copy",
          visible: true,
          titleRole: true,
        });
      },
    },
    {
      id: "forged-campaign-copy-marker",
      expectedSignal: "visible-text-offender",
      mutate(value) {
        value.profiles[0].states[0].textNodes.push({
          id: "mutation:forged-campaign-copy",
          value: "An unapproved HUD label",
          visible: true,
          titleRole: false,
          nativeCopy: {
            scope: "campaign-narrative",
            rootTag: "DIV",
            rootClass: "hud",
            rootLabel: "The Last Bell journal",
            gameChild: true,
            unique: true,
            modal: false,
            tag: "P",
            fontSize: 16,
          },
        });
      },
    },
    {
      id: "css-decoration-added-beside-sprite",
      expectedSignal: "visible-draw-without-sprite-provenance",
      mutate(value) {
        value.profiles[0].states[0].cssDecorations.push({
          id: "mutation:gradient-beside-sprite",
          visible: true,
          kind: "gradient",
          provenance: { kind: "css-decoration" },
        });
      },
    },
  ];
  return definitions.map(({ id, expectedSignal, mutate }) => {
    const mutated = structuredClone(evidence);
    mutate(mutated);
    const result = evaluateVisibleSpriteProvenanceEvidence(mutated);
    const detected = result.failures.includes(expectedSignal);
    return {
      id,
      status: detected ? "DETECTED" : "NOT_DETECTED",
      signal: detected ? expectedSignal : "",
      expectedSignal,
      failures: result.failures,
    };
  });
}
