export const RANGER_DIRECTION_ACTIONS_SHA256: string;
export const RANGER_RELEASE_CELL_SHA256: string;
export function removeRangerDetachedArrow(
  cell: Uint8Array,
  sourceSha256: string,
): Buffer;
export function prepareRangerProjectileAtlas(
  buffer: Uint8Array,
  sourceSha256: string,
): Promise<Buffer>;
