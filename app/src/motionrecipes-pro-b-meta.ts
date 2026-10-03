import type { Field, RecipeMeta } from './motionrecipe';
import type { PRO_B_IDS } from './motionids';

/**
 * Work package 08's templates: what each is called and asks for. Data only
 * (see `motionids.ts`): `motionrecipe.ts` spreads this into `META`, so this
 * file imports nothing but types.
 *
 * Names, descriptions and field labels are `i18n.ts` keys; `tags`, `useWhen`
 * and `avoidWhen` are English for the search and the model, and `hint` is for
 * the model only. A list field's hint says how a line is written, because a
 * model fills it as a person would.
 */

const line = (key: string, label: string, max: number, hint: string): Field => ({ key, kind: 'line', label, max, hint });
const text = (key: string, label: string, max: number, hint: string): Field => ({ key, kind: 'text', label, max, hint });
const list = (key: string, label: string, max: number, hint: string): Field => ({ key, kind: 'list', label, max, hint });

export const PRO_B_META: Readonly<Record<(typeof PRO_B_IDS)[number], RecipeMeta>> = {
  'film-look': {
    id: 'film-look', group: 'overlays', name: 'Film look', hue: 28, seconds: 8, overlay: true, palette: 'sunset',
    about: 'Film grain, a soft vignette and warm light leaks to lay over your video.',
    fields: [
      line('caption', 'Caption', 40, 'a few words at the bottom, such as a place or a season; may be empty'),
    ],
    tags: ['film', 'grain', 'vintage', 'retro', 'old', 'analog', 'light leak', 'vignette', 'memories', 'home video', 'overlay', 'texture'],
    useWhen: 'The person wants their footage to feel like film or an old home video: grain, darker corners and warm light leaking in.',
    avoidWhen: 'There is no video under it and the graphic needs words or numbers of its own; or the look must stay clean and modern.',
    pairsWith: ['lower-third', 'big-title', 'retro-title'],
  },
  'bar-race': {
    id: 'bar-race', group: 'data', name: 'Bar chart race', hue: 210, seconds: 12, overlay: false, palette: 'midnight',
    about: 'Bars that race each other over the years, overtaking as the numbers change.',
    fields: [
      line('title', 'Title', 60, 'what is compared over time'),
      list('items', 'Racers', 10, 'one racer a line, Name: v1, v2, v3 — a value per period, in order'),
      line('periods', 'Periods', 120, 'the periods in order, comma-separated, e.g. 2020, 2021, 2022'),
      line('unit', 'Unit', 6, 'after each value, e.g. % or k; may be empty'),
    ],
    tags: ['race', 'bar chart race', 'ranking', 'over time', 'growth', 'compare', 'leaderboard', 'years', 'trend', 'animated chart'],
    useWhen: 'Several things are compared over a series of periods and the story is who overtakes whom: sales by year, followers by month, votes by round.',
    avoidWhen: 'There is one period only (use a bar chart) or one series over time (use a line chart); or the numbers were not given.',
    pairsWith: ['bar-chart', 'line-chart', 'big-number'],
  },
  timeline: {
    id: 'timeline', group: 'titles', name: 'Timeline', hue: 190, seconds: 8, overlay: false, palette: 'ocean',
    about: 'Milestones with their dates along a line that draws itself.',
    fields: [
      line('title', 'Title', 60, 'a heading, 1 to 5 words; may be empty'),
      list('items', 'Milestones', 6, 'one a line, Date: a few words, e.g. 2019: Opened our first shop'),
    ],
    tags: ['timeline', 'history', 'milestones', 'story', 'journey', 'roadmap', 'dates', 'years', 'about us', 'anniversary'],
    useWhen: 'The story is a sequence of moments in time: a company history, a project roadmap, a life story, the steps of an event.',
    avoidWhen: 'The order is not about time (use steps), or there are more than six moments to show.',
    pairsWith: ['steps', 'big-title', 'stats'],
  },
  compare: {
    id: 'compare', group: 'titles', name: 'Before and after', hue: 250, seconds: 7, overlay: false, palette: 'midnight',
    about: 'Two sides, before and after, with a handle that wipes across to reveal the change.',
    fields: [
      line('before', 'Before', 24, 'the first side\'s label, e.g. Before'),
      text('beforeText', 'Words before', 80, 'how it was, a few words'),
      line('after', 'After', 24, 'the second side\'s label, e.g. After'),
      text('afterText', 'Words after', 80, 'how it is now, a few words'),
    ],
    tags: ['before', 'after', 'compare', 'comparison', 'versus', 'vs', 'change', 'transformation', 'old new', 'then now', 'upgrade'],
    useWhen: 'The message is a change: how something was and how it is now, an old way and a new one, a problem and its fix.',
    avoidWhen: 'There are more than two things to compare, or the comparison is in numbers (use a bar chart).',
    pairsWith: ['stats', 'big-number', 'big-title'],
  },
  'price-card': {
    id: 'price-card', group: 'brand', name: 'Price card', hue: 275, seconds: 6, overlay: false, palette: 'royal',
    about: 'A plan, its price counting up, three things it includes and a button.',
    fields: [
      line('plan', 'Plan', 24, 'the plan or product, 1 to 3 words'),
      line('price', 'Price', 20, 'price with currency, period after a slash, e.g. $19/month'),
      list('features', 'Features', 4, 'what it includes, one a line; three is best'),
      line('button', 'Button', 24, 'the button\'s words, e.g. Start free trial'),
    ],
    tags: ['price', 'pricing', 'plan', 'offer', 'subscription', 'sale', 'product', 'package', 'membership', 'buy', 'promo'],
    useWhen: 'A product, plan, course or membership is offered at a price, with what it includes and a call to act.',
    avoidWhen: 'There is no price the person gave, or several plans must be compared side by side.',
    pairsWith: ['logo-reveal', 'subscribe', 'countdown'],
  },
  'progress-stats': {
    id: 'progress-stats', group: 'data', name: 'Progress rings', hue: 150, seconds: 6, overlay: false, palette: 'mint',
    about: 'Up to four rings that fill to their percentage, each with its label.',
    fields: [
      line('title', 'Title', 60, 'a heading; may be empty'),
      list('items', 'Rings', 4, 'one to four lines Label: value, usually percentages, e.g. Attendance: 92%'),
    ],
    tags: ['progress', 'percentage', 'rings', 'goals', 'kpi', 'completion', 'results', 'score', 'dashboard', 'stats'],
    useWhen: 'Two to four results are each a share of a whole: goals reached, completion, attendance, satisfaction.',
    avoidWhen: 'The numbers are not shares of something (use three numbers), or there are more than four of them.',
    pairsWith: ['stats', 'big-number', 'donut'],
  },
  'retro-title': {
    id: 'retro-title', group: 'titles', name: 'Retro screen', hue: 320, seconds: 5, overlay: false, palette: 'neon',
    about: 'A title that switches on like an old television, with scan lines and a halftone glow.',
    fields: [
      line('title', 'Title', 40, 'the title, 1 to 4 words'),
      line('subtitle', 'Subtitle', 60, 'a short line under it; may be empty'),
    ],
    tags: ['retro', 'tv', 'television', 'crt', 'vhs', 'eighties', 'nineties', 'arcade', 'scanlines', 'glitch', 'vintage', 'title'],
    useWhen: 'A title should feel retro or nostalgic: an old television switching on, an arcade, a late-night show.',
    avoidWhen: 'The look must be calm, corporate or minimal; or the palette is light, where the glow does not read.',
    pairsWith: ['film-look', 'intro', 'kinetic'],
  },
};
