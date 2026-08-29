export type ExistingInjuryObservation = {
  injured: boolean;
  injury_type: string | null;
  injury_reason: string | null;
  injury_updated_at: string | null;
  availability_last_appearance_at: string | null;
};

export function sameInjuryObservation(
  existing: ExistingInjuryObservation | undefined,
  type: string,
  reason: string | null,
) {
  return Boolean(
    existing
      && (existing.injury_type ?? "") === type
      && (existing.injury_reason ?? null) === reason,
  );
}

export function injuryObservedAt(
  existing: ExistingInjuryObservation | undefined,
  type: string,
  reason: string | null,
  observedAt: string,
) {
  return sameInjuryObservation(existing, type, reason)
    ? existing?.injury_updated_at ?? observedAt
    : observedAt;
}

export function appearanceDisprovesInjury(
  existing: ExistingInjuryObservation | undefined,
  type: string,
  reason: string | null,
) {
  if (!existing || existing.injured || !sameInjuryObservation(existing, type, reason)) {
    return false;
  }
  const injuryAt = Date.parse(existing.injury_updated_at ?? "");
  const appearanceAt = Date.parse(existing.availability_last_appearance_at ?? "");
  return Number.isFinite(injuryAt) && Number.isFinite(appearanceAt) && appearanceAt >= injuryAt;
}
