import type { EffortBook } from './effort';
import type { Target } from './generate';
import type { Lang } from './i18n';
import type { Account } from './whatsapp';

/**
 * The Broadcast screens: People, Message, Review & send, Run, Report. PLACEHOLDER from Phase 0
 * (docs/WA.md): the `ui` package replaces this file and adds the others.
 */
export interface BroadcastProps {
  t: (s: string) => string;
  lang: Lang;
  /** The account shown in the panel, or null before one is set up. */
  account: Account | null;
  /** The panel is a window rather than a column. */
  full: boolean;
  /** The model route, when one is set up: the writer needs it. */
  gw?: Target;
  efforts?: EffortBook;
  onProviders: () => void;
  onClose: () => void;
}

export function WhatsAppBroadcast({ t, onClose }: BroadcastProps) {
  return (
    <div className="wa">
      <div className="sb-head-bar">
        <span className="sb-sub">{t('Broadcast')}</span>
        <button className="sb-act" onClick={onClose} title={t('Close')} aria-label={t('Close')}>×</button>
      </div>
    </div>
  );
}
