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
  const isCase = lower.includes('case');

  if (lower.includes('elite trainer box')) {
    return isCase
      ? { type: 'collection_case', packs: etbPacks * 10, cardsPerPack }
      : { type: 'elite_trainer_box', packs: etbPacks, cardsPerPack };
  }
  if (lower.includes('booster bundle')) {
    return isCase
      ? { type: 'collection_case', packs: 6 * 10, cardsPerPack }
      : { type: 'booster_bundle', packs: 6, cardsPerPack };
  }
  if (lower.includes('booster box') || lower.includes('booster case')) {
    const boxPacks = lower.includes('half booster box') ? 18 : 36;
    return isCase
      ? { type: 'collection_case', packs: boxPacks * 6, cardsPerPack }
      : { type: 'booster_box', packs: boxPacks, cardsPerPack };
  }
  if (lower.includes('build and battle box') || lower.includes('build & battle')) {
    return isCase
      ? { type: 'collection_case', packs: 4 * 10, cardsPerPack }
      : { type: 'blister', packs: 4, cardsPerPack };
  }
  if (lower.includes('blister') || lower.includes('checklane')) {
    return { type: 'blister', packs: 3, cardsPerPack };
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
