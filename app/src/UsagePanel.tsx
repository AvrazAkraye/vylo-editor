import { Icon } from './Icon';
import { fill } from './i18n';
import { across, compact, counted, heaviest, percentOf, total, type Usage } from './usage';
import { daysLeft } from './session';
import { cheapestWith, money, type PlanOffer, type PlanSummary } from './account';
import { MODELS, modelName } from './models';
import type { Chat } from './store';

/**
 * What has been spent: by the plan, by this conversation, by this project.
 *
 * The status bar already carries these numbers, and deliberately carries them
 * badly — it has room for a percentage and a compact total, which answers
 * "how am I doing" and nothing else. This panel is the place to answer the
 * questions that follow: what is the allowance, how much of the window is this
 * conversation filling, and which conversations were the expensive ones.
 *
 * ## Nothing here is stored for its own sake
 *
 * Every figure is derived from the plan the gateway last described, the chats
 * already on disk, and the two running totals App keeps. There is no usage
 * log, so nothing on this screen can be stale relative to what it summarises,
 * and turning the module off costs nothing.
 *
 * ## Where it refuses to draw a number
 *
 * `usage.ts` opens by saying wrong numbers are worse than none, and the two
 * places that bite are both here.
 *
 * A chat saved before tokens were recorded has no figure, and an absent
 * figure is not a zero. Such chats are left out of the ranking rather than
 * sorted to the bottom of a list ordered by cost — which would read as a
 * claim that the oldest conversations were the cheapest — and the total says
 * how many chats it was drawn from, so a small number beside a large library
 * is visible as incompleteness rather than as thrift.
 *
 * There is no price per conversation, and that is the same rule. A token has
 * no price here: the gateway sells plans, not tokens, and turning a token
 * count into money would mean inventing a rate. The money on this screen is
 * the money the gateway itself publishes — what a plan costs a month — which
 * is quoted, not derived.
 *
 * And there is no chart of tokens per day, though it is the obvious next
 * thing to draw. A chat records a lifetime total and the day it was last
 * touched; attributing a week of work to its final afternoon would be a
 * fabrication that looks like data. The day that becomes worth drawing is the
 * day usage is recorded per turn.
 */

interface Props {
  t: (s: string) => string;
  /** The plan as the gateway last described it, or null when there is none. */
  plan: PlanSummary | null;
  /** This conversation's running total. */
  chat: Usage;
  /** What the turn that just finished cost. */
  lastTurn: Usage;
  /** Every chat in the open folder. */
  chats: Chat[];
  /** The plans the gateway sells, cheapest first. Empty when it did not say. */
  offers: PlanOffer[];
  /**
   * How full the model's context window is — the same pair the status bar
   * reads, so the two can never disagree about the same conversation.
   */
  ctx: { used: number; limit: number } | null;
  onOpen: (chatId: string) => void;
  onSettings: () => void;
}

/**
 * A proportional bar. `null` draws nothing: there is no ceiling to fill.
 *
 * The two warning tones are the status bar's own — `--warn` as an allowance
 * runs low, `--err` once it is gone — because the same fact in two places
 * must not be two colours.
 */
function Bar({ percent, tone = '' }: { percent: number | null; tone?: '' | 'low' | 'out' }) {
  if (percent === null) return null;
  return (
    <div className={`us-bar ${tone}`} role="img" aria-label={`${percent}%`}>
      <i style={{ width: `${percent}%` }} />
    </div>
  );
}

export function UsagePanel({ t, plan, chat, lastTurn, chats, offers, ctx, onOpen, onSettings }: Props) {
  const project = across(chats);
  const withFigures = counted(chats);
  const top = heaviest(chats, 5);
  const biggest = top.length ? top[0].used : 0;
  const ctxPercent = ctx ? percentOf(ctx.used, ctx.limit) : null;
  const days = plan ? daysLeft(plan.renews, Date.now()) : null;

  // The offer matching the plan in hand is where its price comes from: `/me`
  // reports what has been spent, `/plans` what it costs, and only the second
  // knows about money.
  const mine = offers.find((o) => o.code === plan?.code) ?? null;
  const price = mine ? money(mine.priceCents, mine.currency) : null;

  // Everything above what is held today, in price order, so "what would more
  // money get me" is answered in one place instead of on a website.
  const bigger = offers.filter((o) =>
    !o.trial && o.code !== plan?.code && (o.priceCents ?? 0) > (mine?.priceCents ?? -1));

  // A model this build offers that the plan cannot run is not a dead end — it
  // is a question with an answer, and the answer is a plan and a price.
  const locked = MODELS
    .filter((m) => plan && plan.models.length && !plan.models.includes(m.id))
    .map((m) => ({ model: m, on: cheapestWith(offers, m.id, mine) }));

  return (
    <div className="us">
      {/* ── the plan ─────────────────────────────────────────────────── */}
      <div className="sb-sub">{t('Plan')}</div>
      {!plan || (!plan.name && !plan.metered) ? (
        <div className="sb-cta">
          <p className="ft-empty">{t('No plan to show yet. Sign in, or paste a key, and it appears here.')}</p>
          <button className="ghost bordered" onClick={onSettings}>{t('Open Settings')}</button>
        </div>
      ) : (
        <div className="us-card">
          <div className="us-head">
            <b>{plan.name || t('Your plan')}</b>
            {plan.trial && <span className="us-tag">{t('Trial')}</span>}
            {/* The price sits beside the name, not under the bar: it is part of
                what the plan *is*, and under the bar it would read as a figure
                that had been spent. */}
            {price && <span className="us-tag money">{price === '$0'
              ? t('Free') : fill(t('{price} a month'), { price })}</span>}
            {/* The bar fills with what has been spent, while the line below
                leads with what is left. Without this the two could be read as
                the same quantity. */}
            {plan.percent !== null && <em>{fill(t('{n}% used'), { n: plan.percent })}</em>}
          </div>
          {plan.metered ? (
            <>
              <Bar percent={plan.percent} tone={plan.level === 'out' ? 'out' : plan.level === 'low' ? 'low' : ''} />
              <div className="us-line">
                <span>{plan.left !== null && plan.allowance !== null
                  ? fill(t('{left} left of {allowance}'), { left: plan.left, allowance: plan.allowance })
                  : t('The balance did not arrive with the plan.')}</span>
                {plan.used !== null && <em>{fill(t('{used} used'), { used: plan.used })}</em>}
              </div>
            </>
          ) : (
            <p className="us-flat">{t('No limit on this plan.')}</p>
          )}
          {days !== null && (
            <p className="us-flat">{days === 0 ? t('The allowance resets today.')
              : days === 1 ? t('The allowance resets tomorrow.')
              : fill(t('The allowance resets in {n} days.'), { n: days })}</p>
          )}
          {/* The rate limit is the other ceiling, and the one that actually
              bites: a plan with tokens to spare still refuses a turn that asks
              too fast, and the refusal reads like a broken model unless the
              number is somewhere. */}
          {(plan.ratePerMin !== null || plan.requests !== null) && (
            <p className="us-flat us-quiet">{[
              plan.ratePerMin !== null
                ? fill(t('{n} requests a minute'), { n: plan.ratePerMin }) : null,
              plan.requests !== null
                ? fill(t('{n} made this period'), { n: plan.requests }) : null,
            ].filter(Boolean).join(' · ')}</p>
          )}
        </div>
      )}

      {/* ── what it can run ──────────────────────────────────────────── */}
      {plan && plan.models.length > 0 && (
        <>
          <div className="sb-sub">{t('What you can run')}</div>
          <div className="us-card">
            <ul className="us-models">
              {plan.models.map((id) => (
                <li key={id}><Icon name="check" size={12} /><b>{modelName(id)}</b></li>
              ))}
              {locked.map(({ model, on }) => (
                <li key={model.id} className="off">
                  <Icon name="close" size={12} />
                  <b>{model.short}</b>
                  <span>{on
                    ? fill(t('on {plan}, {price} a month'),
                           { plan: on.name, price: money(on.priceCents, on.currency) ?? '—' })
                    : t('not on any plan here')}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {/* ── what more would cost ─────────────────────────────────────── */}
      {bigger.length > 0 && (
        <>
          <div className="sb-sub">{t('More room')}</div>
          <ul className="us-list">
            {bigger.map((o) => {
              const adds = o.models.filter((m) => !(plan?.models ?? []).includes(m));
              return (
                <li key={o.code}>
                  <div className="us-offer">
                    <div className="us-head">
                      <b>{o.name}</b>
                      <em>{money(o.priceCents, o.currency) ?? t('Price on request')}
                        {o.priceCents !== null && <span>{t('a month')}</span>}</em>
                    </div>
                    <p className="us-flat">{[
                      o.monthlyTokens !== null
                        ? fill(t('{n} tokens a month'), { n: compact(o.monthlyTokens) }) : null,
                      o.ratePerMin !== null
                        ? fill(t('{n} requests a minute'), { n: o.ratePerMin }) : null,
                      adds.length
                        ? fill(t('adds {models}'), { models: adds.map(modelName).join(', ') }) : null,
                    ].filter(Boolean).join(' · ')}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {/* ── this conversation ────────────────────────────────────────── */}
      <div className="sb-sub">{t('This conversation')}</div>
      {total(chat) === 0 ? (
        <p className="ft-empty">{t('Nothing has been sent in this conversation yet.')}</p>
      ) : (
        <div className="us-card">
          <div className="us-big">{compact(total(chat))}<span>{t('tokens')}</span></div>
          <div className="us-split">
            <div><b>{compact(chat.input)}</b><span>{t('sent')}</span></div>
            <div><b>{compact(chat.output)}</b><span>{t('received')}</span></div>
            <div><b>{compact(chat.cacheRead)}</b><span>{t('from cache')}</span></div>
          </div>
          {total(lastTurn) > 0 && (
            <p className="us-flat">{fill(t('The last turn cost {n} tokens.'), { n: compact(total(lastTurn)) })}</p>
          )}
        </div>
      )}

      {/* The window is not spend — it is the reason a long conversation starts
          dropping its own beginning — but it is the other number a person
          watching cost wants, and it is already computed. */}
      {ctxPercent !== null && ctx && (
        <div className="us-card">
          <div className="us-head"><b>{t('Context window')}</b><em>{ctxPercent}%</em></div>
          <Bar percent={ctxPercent} tone={ctxPercent >= 85 ? 'low' : ''} />
          <p className="us-flat">{fill(t('{used} of {limit} tokens. Past this the oldest turns are summarised to make room.'),
            { used: compact(ctx.used), limit: compact(ctx.limit) })}</p>
        </div>
      )}

      {/* ── this project ─────────────────────────────────────────────── */}
      <div className="sb-sub">{t('This project')}</div>
      {total(project) === 0 ? (
        <p className="ft-empty">{t('No conversation here has a recorded cost yet.')}</p>
      ) : (
        <div className="us-card">
          <div className="us-big">{compact(total(project))}<span>{t('tokens')}</span></div>
          <p className="us-flat">{withFigures === 1
            ? t('From 1 conversation that recorded what it cost.')
            : fill(t('From {n} conversations that recorded what they cost.'), { n: withFigures })}</p>
          {withFigures < chats.length && (
            <p className="us-flat us-quiet">{chats.length - withFigures === 1
              ? t('1 older conversation was saved before this was recorded and is not counted.')
              : fill(t('{n} older conversations were saved before this was recorded and are not counted.'),
                     { n: chats.length - withFigures })}</p>
          )}
        </div>
      )}

      {top.length > 1 && (
        <>
          <div className="sb-sub">{t('Where it went')}</div>
          <ul className="us-list">
            {top.map(({ chat: c, used }) => (
              <li key={c.id}>
                <button className="us-row" onClick={() => onOpen(c.id)}
                        title={fill(t('Open {name}'), { name: c.title })}>
                  <span className="us-what">
                    <b>{c.title}</b>
                    <Bar percent={percentOf(used, biggest)} />
                  </span>
                  <em>{compact(used)}</em>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="us-note">
        <Icon name="bolt" size={12} />
        {t('Prices are what this gateway charges for a plan. Tokens have no price of their own here, so no conversation is shown as money.')}
      </p>
    </div>
  );
}
