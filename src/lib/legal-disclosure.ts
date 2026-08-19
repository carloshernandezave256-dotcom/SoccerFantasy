export const LEGAL_DISCLOSURE_VERSION = "beta-1.0";

export function requiresLegalDisclosure(version: string | null | undefined, acceptedAt: string | null | undefined) {
  return version !== LEGAL_DISCLOSURE_VERSION || !acceptedAt;
}
