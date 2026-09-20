// Pure parsing and validation for admin player input.
//
// Kept free of Firebase imports so it can be unit tested in Node; adminService
// wraps these with the actual Firestore writes.

export const MIN_ELO = 100;
export const MAX_ELO = 3000;
export const MAX_ADJUSTMENT = 1000;

export function parseProfileId(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (!/^\d+$/.test(text)) {
    throw new Error(`"${text}" is not a valid AoE2 profile id (digits only)`);
  }
  return Number(text);
}

export function parseAltProfileIds(value) {
  if (Array.isArray(value)) return value.map(parseProfileId).filter(id => id !== null);
  return String(value || "")
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(parseProfileId)
    .filter(id => id !== null);
}

// `label` names the field in the error, so the same range check can back both
// the "Starting Elo" on the add-player form and the "New Elo" on the editor.
export function parseEloValue(value, label = "Elo") {
  const elo = Math.round(Number(value));
  if (!Number.isFinite(elo) || elo < MIN_ELO || elo > MAX_ELO) {
    throw new Error(`${label} must be between ${MIN_ELO} and ${MAX_ELO}`);
  }
  return elo;
}

export function parseSeedElo(value) {
  return parseEloValue(value, "Starting Elo");
}

export function parseEloAdjustment(value) {
  const delta = Math.round(Number(value));
  if (!Number.isFinite(delta) || Math.abs(delta) > MAX_ADJUSTMENT) {
    throw new Error(
      `Adjustment must be between -${MAX_ADJUSTMENT} and +${MAX_ADJUSTMENT}`
    );
  }
  return delta;
}

export function parsePlayerName(value) {
  const name = String(value || "").trim();
  if (!name) throw new Error("A player name is required");
  if (name.length > 60) throw new Error("Player name is too long");
  return name;
}

// A player already exists if the name matches case-insensitively, or if any
// profile id (primary or alt) collides.
export function findDuplicatePlayer(players, name, profileId) {
  const wanted = String(name || "").trim().toLowerCase();
  const pid = profileId === null || profileId === undefined
    ? null
    : Number(profileId);

  return (players || []).find(player => {
    if (wanted && String(player.name || "").trim().toLowerCase() === wanted) {
      return true;
    }
    if (pid === null) return false;
    return [player.profileId, ...(player.altProfileIds || [])]
      .filter(value => value !== undefined && value !== null)
      .map(Number)
      .includes(pid);
  }) || null;
}
