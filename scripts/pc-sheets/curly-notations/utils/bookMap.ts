const BOOK_MAP: Record<string, string> = {
  CoD: "Chronicles of Darkness",
  HL: "Hurt Locker",
  DtR: "Deviant: the Renegades",
  SG: "Shallow Graves",
  CC: "The Clade Companion"
};

/**
 * Resolves an abbreviated book code to its display title.
 */
export function resolveBookTitle(bookKey: string): string {
  const trimmedKey = bookKey.trim();
  return BOOK_MAP[trimmedKey] ?? trimmedKey;
}
