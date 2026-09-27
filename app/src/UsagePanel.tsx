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
      <i style={{ inlineSize: `${percent}%` }} />
    </div>
  );
}

/**
 * The plan's allowance as a ring: the part spent, in the status bar's tone,
 * with the percentage in the middle. An unmetered plan is a whole ring with
 * ∞ in it — full, not empty, because nothing is running out.
 */
function Ring({ percent, tone, label }: { percent: number | null; tone: '' | 'low' | 'out'; label: string }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const shown = percent === null ? 1 : Math.max(0, Math.min(100, percent)) / 100;
  return (
    <div className={`us-ring ${tone}`} role="img" aria-label={label}>
      <svg viewBox="0 0 80 80" aria-hidden="true">
        <circle className="us-ring-track" cx="40" cy="40" r={r} />
        <circle className="us-ring-fill" cx="40" cy="40" r={r}
                strokeDasharray={`${(c * shown).toFixed(2)} ${c.toFixed(2)}`} transform="rotate(-90 40 40)" />
      </svg>
      <b dir="ltr">{percent === null ? '∞' : `${percent}%`}</b>
    </div>
  );
}

/**
 * What a conversation's tokens were, as one bar in three colours — sent,
 * received, read back from the cache — with the legend under it. Proportions
 * of real counts, so nothing is drawn that was not measured.
 */
function Split({ t, u }: { t: Props['t']; u: Usage }) {
  const parts = [
    { key: 'in', n: u.input, label: t('sent') },
    { key: 'out', n: u.output, label: t('received') },
    { key: 'cache', n: u.cacheRead, label: t('from cache') },
  ];
  const sum = parts.reduce((s, p) => s + p.n, 0) || 1;
  return (
    <>
      <div className="us-stack" role="img" aria-label={parts.map((p) => `${p.label} ${compact(p.n)}`).join(', ')}>
        {parts.filter((p) => p.n > 0).map((p) => (
          <i key={p.key} className={`us-seg ${p.key}`} style={{ inlineSize: `${((p.n / sum) * 100).toFixed(2)}%` }} />
        ))}
      </div>
      <div className="us-legend">
        {parts.map((p) => (
          <div key={p.key}><i className={`us-dot ${p.key}`} /><span>{p.label}</span><b>{compact(p.n)}</b></div>
        ))}
      </div>
    </>
  );
}

export function UsagePanel({ t, plan, chat, lastTurn, chats, offers, ctx, onOpen, onSettings }: Props) {
  const project = across(chats);
  const withFigures = counted(chats);
  const top = heaviest(chats, 5);
  const biggest = top.length ? top[0].used : 0;
  const ctxPercent = ctx ? percentOf(ctx.used, ctx.limit) : null;
  const days = plan ? daysLeft(plan.renews, Date.now()) : null;
  const tone: '' | 'low' | 'out' = plan?.level === 'out' ? 'out' : plan?.level === 'low' ? 'low' : '';

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

  const resets = days === null ? null
    : days === 0 ? t('The allowance resets today.')
    : days === 1 ? t('The allowance resets tomorrow.')
    : fill(t('The allowance resets in {n} days.'), { n: days });

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
        <div className={`us-card us-hero ${tone}`}>
          <Ring percent={plan.metered ? plan.percent : null} tone={tone}
                label={plan.metered && plan.percent !== null ? fill(t('{n}% used'), { n: plan.percent }) : t('No limit on this plan.')} />
          <div className="us-hero-main">
            <div className="us-head">
              <b>{plan.name || t('Your plan')}</b>
              {plan.trial && <span className="us-tag">{t('Trial')}</span>}
              {/* The price is part of what the plan *is*, not a figure that has been spent. */}
              {price && <span className="us-tag money">{price === '$0'
                ? t('Free') : fill(t('{price} a month'), { price })}</span>}
            </div>
            {plan.metered ? (
              <p className="us-lead">{plan.left !== null && plan.allowance !== null
                ? fill(t('{left} left of {allowance}'), { left: plan.left, allowance: plan.allowance })
                : t('The balance did not arrive with the plan.')}</p>
            ) : (
              <p className="us-lead">{t('No limit on this plan.')}</p>
            )}
            {plan.metered && plan.used !== null && <p className="us-flat">{fill(t('{used} used'), { used: plan.used })}</p>}
            <div className="us-pills">
              {resets && <span className="us-pill"><Icon name="calendar" size={11} />{resets}</span>}
              {/* The rate limit is the other ceiling, and the one that actually bites: a plan with tokens
                  to spare still refuses a turn that asks too fast. */}
              {plan.ratePerMin !== null && <span className="us-pill"><Icon name="bolt" size={11} />{fill(t('{n} requests a minute'), { n: plan.ratePerMin })}</span>}
              {plan.requests !== null && <span className="us-pill"><Icon name="clock" size={11} />{fill(t('{n} made this period'), { n: plan.requests })}</span>}
            </div>
          </div>
        </div>
      )}

      {/* ── what it can run ──────────────────────────────────────────── */}
      {plan && plan.models.length > 0 && (
        <>
          <div className="sb-sub">{t('What you can run')}</div>
          <ul className="us-chips">
            {plan.models.map((id) => (
              <li key={id} className="on"><Icon name="check" size={12} /><b>{modelName(id)}</b></li>
            ))}
            {locked.map(({ model, on }) => (
              <li key={model.id} className="off" title={on
                ? fill(t('on {plan}, {price} a month'), { plan: on.name, price: money(on.priceCents, on.currency) ?? '—' })
                : t('not on any plan here')}>
                <Icon name="shield" size={12} />
                <b>{model.short}</b>
                <span>{on ? `${on.name} · ${money(on.priceCents, on.currency) ?? '—'}` : '—'}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* ── what more would cost ─────────────────────────────────────── */}
      {bigger.length > 0 && (
        <>
          <div className="sb-sub">{t('More room')}</div>
          <div className="us-offers">
            {bigger.map((o) => {
              const adds = o.models.filter((m) => !(plan?.models ?? []).includes(m));
              return (
                <div key={o.code} className="us-offer">
                  <div className="us-offer-top">
                    <b>{o.name}</b>
                    <Icon name="sparkle" size={12} />
                  </div>
                  <div className="us-price">{money(o.priceCents, o.currency) ?? t('Price on request')}
                    {o.priceCents !== null && <span>{t('a month')}</span>}</div>
                  <ul>
                    {o.monthlyTokens !== null && <li>{fill(t('{n} tokens a month'), { n: compact(o.monthlyTokens) })}</li>}
                    {o.ratePerMin !== null && <li>{fill(t('{n} requests a minute'), { n: o.ratePerMin })}</li>}
                    {adds.length > 0 && <li className="adds">{fill(t('adds {models}'), { models: adds.map(modelName).join(', ') })}</li>}
                  </ul>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── this conversation ────────────────────────────────────────── */}
      <div className="sb-sub">{t('This conversation')}</div>
      {total(chat) === 0 ? (
        <p className="ft-empty">{t('Nothing has been sent in this conversation yet.')}</p>
      ) : (
        <div className="us-card">
          <div className="us-big">{compact(total(chat))}<span>{t('tokens')}</span>
            {total(lastTurn) > 0 && <em className="us-pill" title={fill(t('The last turn cost {n} tokens.'), { n: compact(total(lastTurn)) })}>
              <Icon name="bolt" size={11} /><bdi dir="ltr">+{compact(total(lastTurn))}</bdi></em>}
          </div>
          <Split t={t} u={chat} />
        </div>
      )}

      {/* The window is not spend — it is the reason a long conversation starts
          dropping its own beginning — but it is the other number a person
          watching cost wants, and it is already computed. */}
      {ctxPercent !== null && ctx && (
        <div className="us-card us-ctx">
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
          {top.length > 1 && (
            <>
              <div className="us-mini">{t('Where it went')}</div>
              <ol className="us-rank">
                {top.map(({ chat: c, used }, i) => (
                  <li key={c.id}>
                    <button className="us-row" onClick={() => onOpen(c.id)}
                            title={fill(t('Open {name}'), { name: c.title })}>
                      <span className="us-n">{i + 1}</span>
                      <span className="us-what">
                        <span className="us-what-top"><b>{c.title}</b><em>{compact(used)}</em></span>
                        <Bar percent={percentOf(used, biggest)} />
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      )}

      <p className="us-note">
        <Icon name="bolt" size={12} />
        {t('Prices are what this gateway charges for a plan. Tokens have no price of their own here, so no conversation is shown as money.')}
      </p>
    </div>
  );
}
