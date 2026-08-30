/**
 * Sealed catalogue names carry the product format but never the pack count, so
 * it is derived here: boxes and bundles are stable across eras, ETB pack counts
 * moved from 8 to 9 with Scarlet & Violet, and cases hold 6 boxes or 10 of the
 * smaller products. Pack counts feed the pull-EV model, not observed prices.
 */
export type SealedProductType =
  | 'booster_box'
  | 'elite_trainer_box'
  | 'booster_bundle'
  | 'collection_case'
  | 'blister';

export interface ClassifiedProduct {
  type: SealedProductType;
  packs: number;
  cardsPerPack: number;
}

export function classifySealedProduct(
  name: string,
  releaseDate: string | null,
): ClassifiedProduct | null {
  const lower = name.toLowerCase();
  if (lower.includes('display')) return null; // Retailer display packaging, not a sealed unit we model.

  const etbPacks = (releaseDate ?? '') >= '2023-01-01' ? 9 : 8;
  const cardsPerPack = (releaseDate ?? '') >= '2020-01-01' ? 10 : 11;
  const isCase = lower.includes('case') && !lower.includes('checklane');
  // "[Set of 2]" and "[Set of 6]" listings are several units sold together.
  const bundleSize = Number(/\[set of (\d+)\]/.exec(lower)?.[1] ?? 1);
  const scale = (units: number): number => units * bundleSize;

  if (lower.includes('elite trainer box')) {
    return isCase
      ? { type: 'collection_case', packs: scale(etbPacks * 10), cardsPerPack }
      : { type: 'elite_trainer_box', packs: scale(etbPacks), cardsPerPack };
  }
  if (lower.includes('booster bundle')) {
    return isCase
      ? { type: 'collection_case', packs: scale(6 * 10), cardsPerPack }
      : { type: 'booster_bundle', packs: scale(6), cardsPerPack };
  }
  if (lower.includes('booster box') || lower.includes('booster case')) {
    const boxPacks = lower.includes('half booster box') ? 18 : 36;
    return isCase
      ? { type: 'collection_case', packs: scale(boxPacks * 6), cardsPerPack }
      : { type: 'booster_box', packs: scale(boxPacks), cardsPerPack };
  }
  if (lower.includes('build and battle box') || lower.includes('build & battle')) {
    return isCase
      ? { type: 'collection_case', packs: scale(4 * 10), cardsPerPack }
      : { type: 'blister', packs: scale(4), cardsPerPack };
  }
  if (lower.includes('blister') || lower.includes('checklane')) {
    // Blisters state their own pack count ("3 Pack Blister", "2-Pack Blister"),
    // and a blister case holds a dozen of them.
    const blisterPacks = Number(/(\d+)[\s-]*pack/.exec(lower)?.[1] ?? 3);
    return isCase
      ? { type: 'collection_case', packs: scale(blisterPacks * 12), cardsPerPack }
      : { type: 'blister', packs: scale(blisterPacks), cardsPerPack };
  }
  return null;
}

export function sealedProductId(
  setId: string,
  type: SealedProductType,
  name: string,
): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${setId}-${type}-${slug}`.slice(0, 200);
}
