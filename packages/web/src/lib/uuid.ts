// RFC 9562 UUIDv7 — time-ordered identifiers used as clientUuid for offline mutations.
export function uuidv7(): string {
  const time = Date.now().toString(16).padStart(12, '0');
  const rnd = crypto.getRandomValues(new Uint8Array(10));
  const hex = (i: number): string => rnd[i].toString(16).padStart(2, '0');

  const g1 = time.slice(0, 8);
  const g2 = time.slice(8, 12);
  // group 3: version nibble 7
  const g3 = '7' + hex(0).slice(1) + hex(1);
  // group 4: variant 10xx (8, 9, a, b)
  const variant = (8 + (rnd[2] % 4)).toString(16);
  const g4 = variant + hex(2).slice(1) + hex(3);
  const g5 = hex(4) + hex(5) + hex(6) + hex(7) + hex(8) + hex(9);

  return `${g1}-${g2}-${g3}-${g4}-${g5}`;
}
