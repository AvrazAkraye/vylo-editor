import type { Audience, Campaign } from './whatsappbulktypes';

/**
 * What is kept between sessions: audiences, campaigns, the do-not-contact list. PLACEHOLDER from Phase 0
 * (docs/WA.md): the `engine` package replaces this file (IndexedDB `vylo-whatsapp-bulk`, read again through
 * readers that clamp). Names and signatures below are the contract.
 */
export async function loadCampaigns(): Promise<Campaign[]> {
  return [];
}

export async function saveCampaign(_c: Campaign): Promise<boolean> {
  return false;
}

export async function deleteCampaign(_id: string): Promise<void> {
  return undefined;
}

export async function loadAudiences(): Promise<Audience[]> {
  return [];
}

export async function saveAudience(_a: Audience): Promise<boolean> {
  return false;
}

export async function deleteAudience(_id: string): Promise<void> {
  return undefined;
}

/** The do-not-contact list, as phones. */
export async function loadSuppressed(): Promise<Set<string>> {
  return new Set();
}

export async function addSuppressed(_phones: readonly string[]): Promise<void> {
  return undefined;
}

export async function removeSuppressed(_phone: string): Promise<void> {
  return undefined;
}

/** Messages this account sent on the calendar day of `now`, across every campaign. */
export async function sentToday(_accountId: string, _now: number = Date.now()): Promise<number> {
  return 0;
}
