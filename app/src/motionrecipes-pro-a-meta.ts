import type { Field, RecipeMeta } from './motionrecipe';
import type { PRO_A_IDS } from './motionids';

/**
 * Work package 07's templates: what each is called and asks for. Data only (see
 * `motionids.ts`): `motionrecipe.ts` imports this table, so it imports nothing
 * at run time.
 *
 * Four lower thirds, each a different broadcast habit rather than a recolour of
 * one (a news bar revealed by a sweep of colour, a soft pill with an icon, a
 * tag over a name with a drawn underline, a neon outline that traces itself),
 * then notifications, a hand-drawn circle, a chat and a device. Names, `about`
 * and field labels are `i18n.ts` keys; hints are for the model and are kept
 * short, because every template's line is in the prompt it is sent
 * (`motionai.ts`, which has a budget).
 */

const line = (key: string, label: string, max: number, hint: string): Field => ({ key, kind: 'line', label, max, hint });
const list = (key: string, label: string, max: number, hint: string): Field => ({ key, kind: 'list', label, max, hint });

const NAME = line('name', 'Name', 36, 'a person or place name');
const ROLE = line('role', 'Role', 50, 'their role, or one line about them');

export const PRO_A_META: Readonly<Record<(typeof PRO_A_IDS)[number], RecipeMeta>> = {
  'lt-bar': {
    id: 'lt-bar', group: 'overlays', name: 'News bar', hue: 214, seconds: 5, overlay: true, palette: 'ocean',
    about: 'A sweep of colour reveals a name bar, the role on a strip below.',
    fields: [NAME, ROLE],
    tags: ['lower third', 'name', 'news', 'reporter', 'broadcast', 'interview', 'speaker', 'caption', 'documentary'],
    useWhen: 'Naming a speaker or a place over footage, in a news or documentary style.',
    avoidWhen: 'There is no video under it: a title template fills a frame of its own better.',
    pairsWith: ['lower-third', 'handle', 'lt-kicker'],
  },
  'lt-pill': {
    id: 'lt-pill', group: 'overlays', name: 'Soft pill', hue: 200, seconds: 5, overlay: true, palette: 'daylight',
    about: 'A rounded pill with an icon, a name and a role, that springs in.',
    fields: [NAME, ROLE],
    tags: ['lower third', 'name', 'podcast', 'interview', 'host', 'guest', 'minimal', 'speaker', 'pill'],
    useWhen: 'A friendly, light name tag for a podcast, a vlog or an interview.',
    avoidWhen: 'The tone is hard news or the name needs a second line of explanation.',
    pairsWith: ['handle', 'subscribe', 'lt-bar'],
  },
  'lt-kicker': {
    id: 'lt-kicker', group: 'overlays', name: 'Kicker and name', hue: 18, seconds: 5, overlay: true, palette: 'sunset',
    about: 'A small tag above a big name, an underline that draws, and a role.',
    fields: [line('kicker', 'Small label', 24, 'a tag of 1 to 3 words, for example Guest'), NAME, ROLE],
    tags: ['lower third', 'name', 'guest', 'expert', 'editorial', 'interview', 'speaker', 'tag', 'kicker'],
    useWhen: 'Introducing a guest or an expert, with a one-word tag that says why they are on screen.',
    avoidWhen: 'There is nothing to put in the tag: the news bar says a name and a role with less.',
    pairsWith: ['lt-bar', 'quote'],
  },
  'lt-neon': {
    id: 'lt-neon', group: 'overlays', name: 'Neon name', hue: 172, seconds: 5, overlay: true, palette: 'neon',
    about: 'A glowing outline traces itself around a name and a role.',
    fields: [NAME, ROLE],
    tags: ['lower third', 'name', 'neon', 'glow', 'music', 'gaming', 'night', 'dj', 'stream'],
    useWhen: 'Naming someone in a music, gaming or night-time video that wants energy.',
    avoidWhen: 'The video is formal or calm: the glow and the flicker are loud.',
    pairsWith: ['handle', 'countdown'],
  },
  'ui-notify': {
    id: 'ui-notify', group: 'overlays', name: 'Notification stack', hue: 248, seconds: 6, overlay: true, palette: 'midnight',
    about: 'Up to three notification cards that drop in one after another.',
    fields: [list('items', 'Notifications', 3, 'one per line, Title: one short line')],
    tags: ['notification', 'alert', 'message', 'phone', 'app', 'order', 'reminder', 'social proof', 'popup'],
    useWhen: 'Showing messages, orders or reminders arriving, over footage or a screen recording.',
    avoidWhen: 'There are more than three things to say, or they need reading as a list: use steps.',
    pairsWith: ['ui-chat', 'ui-device'],
  },
  'ui-scribble': {
    id: 'ui-scribble', group: 'overlays', name: 'Hand-drawn circle', hue: 44, seconds: 5, overlay: true, palette: 'sunset',
    about: 'A marker circle draws itself, with an arrow and a short note.',
    fields: [line('word', 'Circled word', 24, 'a word inside the circle; empty circles what is under it'), line('label', 'Note', 40, 'a short note, 1 to 5 words')],
    tags: ['circle', 'annotate', 'highlight', 'arrow', 'marker', 'hand drawn', 'scribble', 'point', 'look here'],
    useWhen: 'Pointing at one thing in a video or a screenshot, the way a person would with a marker.',
    avoidWhen: 'Several things need marking at once, or the tone is formal: use the callout.',
    pairsWith: ['callout', 'ui-device'],
  },
  'ui-chat': {
    id: 'ui-chat', group: 'titles', name: 'Chat conversation', hue: 142, seconds: 8, overlay: false, palette: 'midnight',
    about: 'A conversation in bubbles, with typing dots before each reply.',
    fields: [
      line('name', 'Contact name', 30, 'who the other person is; may be empty'),
      list('items', 'Messages', 6, 'one a line: Me: … for your side, Them: … (or their name) for theirs'),
    ],
    tags: ['chat', 'message', 'conversation', 'text', 'dm', 'sms', 'bubble', 'story', 'testimonial'],
    useWhen: 'Telling a short story or a customer exchange as messages back and forth.',
    avoidWhen: 'The messages are long: past four lines a bubble is cut, and reading slows the video.',
    pairsWith: ['ui-notify', 'quote'],
  },
  'ui-device': {
    id: 'ui-device', group: 'brand', name: 'Device frame', hue: 268, seconds: 6, overlay: false, palette: 'royal',
    about: 'A phone, or a browser window when wide, with your headline beside it.',
    fields: [
      line('title', 'Title', 60, 'the headline, 3 to 8 words'),
      line('subtitle', 'Subtitle', 80, 'one supporting line; may be empty'),
      line('screen', 'On the screen', 16, 'a word on the screen, usually the product name; may be empty'),
    ],
    tags: ['phone', 'mockup', 'app', 'website', 'browser', 'product', 'launch', 'device', 'screen'],
    useWhen: 'Presenting an app, a website or a product launch, before a picture of it is placed on the screen.',
    avoidWhen: 'There is no product with a screen: a big title or the logo reveal says it better.',
    pairsWith: ['ui-notify', 'logo-reveal', 'ui-scribble'],
  },
};
