import type { Conn } from './whatsapp';
import type { Campaign, RunEvent } from './whatsappbulktypes';

/**
 * The runner. PLACEHOLDER from Phase 0 (docs/WA.md): the `engine` package replaces this file with the loop
 * that checks numbers, sends one message at a time at the campaign's pace, saves its state before each send,
 * and halts when WhatsApp or the gateway says to. Names and signatures below are the contract.
 */
export interface RunDeps {
  /** One call to the account's instance (`whatsappwire.ts` `callerFor`). */
  call: (path: string, body?: unknown) => Promise<unknown>;
  instance: string;
  now: () => number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  rnd: () => number;
  /** Persist the campaign; awaited before each send. */
  save: (c: Campaign) => Promise<void>;
  /** Messages this account has sent today, across campaigns. */
  sentToday: () => Promise<number>;
}

export interface Runner {
  /** Runs until the campaign is done, stopped or halted; resolves with it. */
  start(): Promise<Campaign>;
  pause(): void;
  resume(): void;
  stop(): void;
  on(fn: (e: RunEvent) => void): () => void;
}

export function runCampaign(c: Campaign, _deps: RunDeps): Runner {
  let now = c;
  return {
    start: async () => now, pause: () => undefined, resume: () => undefined,
    stop: () => { now = { ...now, state: 'stopped' }; }, on: () => () => undefined,
  };
}

/** The dependencies for the real thing: the account's connection, the clock, the timer, the store. */
export function realDeps(conn: Conn): RunDeps {
  return {
    call: async () => ({}), instance: conn.instance, now: Date.now, sleep: async () => undefined, rnd: Math.random,
    save: async () => undefined, sentToday: async () => 0,
  };
}

/** After a quit or a crash: whatever was `sending` may or may not have gone, and is `unknown` from here on. */
export function recover(c: Campaign): Campaign {
  return c;
}

/** One message to the person's own number before the real thing: `'sent'` or why not. */
export async function sendTest(_conn: Conn, _phone: string, _text: string): Promise<'sent' | { failed: string }> {
  return { failed: 'not built' };
}
