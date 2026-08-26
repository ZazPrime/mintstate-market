/**
 * Name/number normalisation used to map provider catalogues (which use
 * TCGplayer naming such as "SWSH04: Vivid Voltage" or "SM - Team Up") onto the
 * pokemon-tcg-data sets and cards already in the database.
 */

/** Lowercase alphanumeric key with the provider's set-code prefix removed. */
export function setKey(name: string): string {
  const withoutPrefix = name
    .replace(/^[^:]{1,12}:\s*/, '')
    .replace(/^[A-Za-z0-9]{1,6}\s+-\s+/, '');
  return normalizeKey(withoutPrefix);
}

export function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');
}

/** "1/99" and "TG05/TG30" collapse to the printed collector number. */
export function cardNumberKey(number: string | null | undefined): string {
  if (!number) return '';
  const printed = number.split('/')[0];
  return printed.trim().toLowerCase().replace(/^0+(?=\d)/, '');
}
