import type { RecipeMeta } from './motionrecipe';
import type { PRO_A_IDS } from './motionids';

/** Work package 07's templates: what each is called and asks for. Data only (see `motionids.ts`). */
export const PRO_A_META: Readonly<Record<(typeof PRO_A_IDS)[number], RecipeMeta>> = {};
