/**
 * The ids of the templates the pro pass adds, kept in two lists of their own so
 * two people can add templates without editing the same line of
 * `motiontypes.ts`. Each list belongs to one file pair: `motionrecipes-pro-a.ts`
 * (how it is built) with `motionrecipes-pro-a-meta.ts` (what it is called, its
 * fields), and the same for `b`. A pure data file with no imports, so any module
 * may take the ids without a cycle.
 */
export const PRO_A_IDS = [] as const;
export const PRO_B_IDS = [] as const;
