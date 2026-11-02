export function getNfcTagUidLabel(
  snapshot: { nfcTagUid?: string | null } | null | undefined,
): string | null {
  return snapshot?.nfcTagUid ? `NFC Tag · UID: ${snapshot.nfcTagUid}` : null;
}
