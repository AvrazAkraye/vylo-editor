import type { Recipe } from './motionrecipe';
import type { PRO_B_IDS } from './motionids';

/** Work package 08's templates: how each is built. */
export const PRO_B_RECIPES: Readonly<Record<(typeof PRO_B_IDS)[number], Recipe>> = {};
