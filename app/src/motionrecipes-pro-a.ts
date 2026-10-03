import type { Recipe } from './motionrecipe';
import type { PRO_A_IDS } from './motionids';

/** Work package 07's templates: how each is built. */
export const PRO_A_RECIPES: Readonly<Record<(typeof PRO_A_IDS)[number], Recipe>> = {};
