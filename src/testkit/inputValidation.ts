import type { InputState } from "../game/types";

/** Bound synchronous work so a malformed agent request cannot freeze the page. */
export const MAX_ADVANCE_TICKS = 36_000;

export function validateTick(value: number, label = "tick"): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label} must be a non-negative safe integer`);
}

export function validateAdvance(value: number, initialTick: number): void {
  validateTick(value, "ticks");
  if (value > MAX_ADVANCE_TICKS)
    throw new Error(`ticks must not exceed ${MAX_ADVANCE_TICKS} per call`);
  validateTick(initialTick + value, "final tick");
}

/** Validate and own a patch before it can affect live or queued input. */
export function cloneInputPatch(
  value: Partial<InputState>,
): Partial<InputState> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("input must be an object");
  const patch: Partial<InputState> = {};
  for (const [key, field] of Object.entries(value)) {
    switch (key) {
      case "moveX":
      case "moveY":
        if (field !== -1 && field !== 0 && field !== 1)
          throw new Error(`input.${key} must be -1, 0, or 1`);
        patch[key] = field;
        break;
      case "attack":
      case "ability":
      case "useTonic":
        if (typeof field !== "boolean")
          throw new Error(`input.${key} must be boolean`);
        patch[key] = field;
        break;
      case "pickupTargetId":
        if (field !== null && typeof field !== "string")
          throw new Error("input.pickupTargetId must be null or a string");
        patch.pickupTargetId = field;
        break;
      case "aim":
        if (field === null) {
          patch.aim = null;
          break;
        }
        if (
          !field ||
          typeof field !== "object" ||
          Array.isArray(field) ||
          Object.keys(field).some((name) => name !== "x" && name !== "y") ||
          !("x" in field) ||
          !("y" in field) ||
          typeof field.x !== "number" ||
          typeof field.y !== "number" ||
          !Number.isFinite(field.x) ||
          !Number.isFinite(field.y) ||
          Math.abs(field.x) > Number.MAX_SAFE_INTEGER ||
          Math.abs(field.y) > Number.MAX_SAFE_INTEGER
        )
          throw new Error("input.aim must be null or a finite { x, y } point");
        patch.aim = { x: field.x, y: field.y };
        break;
      default:
        throw new Error(`Unknown input field: ${key}`);
    }
  }
  return patch;
}
