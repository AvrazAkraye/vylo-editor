import type { RecipeMeta } from './motionrecipe';
import type { PRO_B_IDS } from './motionids';

/** Work package 08's templates: what each is called and asks for. Data only (see `motionids.ts`). */
export const PRO_B_META: Readonly<Record<(typeof PRO_B_IDS)[number], RecipeMeta>> = {};
