import type { Brand, Format, Scene, Style, Transition, Video, VideoLang } from './videotypes';
import { FPS } from './videotypes';
import { TRANSITION_FRAMES, durationInFrames, newVideo } from './video';

/**
 * Starting points for a video: ten kinds of video people make most — a
 * university's introduction, a clinic's promo, an invitation — each a request
 * already written, in the interface's language, with the style, shape and
 * length that suit it.
 *
 * Each one can also open as a **sample storyboard** at once: the scenes such a
 * video usually has, with placeholder words in the video's language, so the
 * person sees and edits a video before any model is asked for anything. A
 * sample says it is one (`sampleOf`, and the banner the panel shows over it),
 * and its words invent nothing: where a real fact belongs — a date, a number,
 * a room count — the sample says "add it here" rather than making one up.
 * Its pictures are suggested searches, fetched only when the person asks.
 *
 * The request text and the samples are data, not interface strings: they are
 * what the person's video will say, in the language it will say it in. The
 * templates' names and descriptions are interface strings, and go through
 * `t()` in `templateName` and `templateAbout`.
 */

export type TemplateId =
  | 'university' | 'product' | 'event' | 'clinic' | 'restaurant'
  | 'course' | 'realestate' | 'story' | 'review' | 'thanks';

export interface Template {
  id: TemplateId;
  /** An icon name from Icon.tsx. */
  icon: 'book' | 'sparkle' | 'calendar' | 'plus' | 'flame' | 'pencil' | 'image' | 'bolt' | 'clock' | 'star';
  style: Style;
  format: Format;
  /** One of video.ts's LENGTHS. */
  seconds: number;
  /** What the request box is filled with, in the interface's language. */
  request: Readonly<Record<VideoLang, string>>;
}

export const TEMPLATES: readonly Template[] = [
  {
    id: 'university', icon: 'book', style: 'modern', format: 'landscape', seconds: 45,
    request: {
      en: 'An introduction to our university for new students: who we are, our colleges, life on campus, and how to apply.',
      ar: 'فيديو تعريفي بجامعتنا للطلاب الجدد: من نحن، وكلياتنا، والحياة في الحرم الجامعي، وكيفية التقديم.',
      ckb: 'ڤیدیۆیەکی ناساندن بۆ زانکۆکەمان بۆ قوتابیانی نوێ: ئێمە کێین، کۆلێژەکانمان، ژیان لە کەمپەس، و چۆنیەتی خۆتۆمارکردن.',
      kmr: 'ڤیدیۆیەکا ناساندنێ بۆ زانکۆیا مە بۆ خوێندکارێن نوو: ئەم کینە، کۆلیژێن مە، ژیان ل کەمپەسی، و چاوا خۆ تۆمار بکەی.',
    },
  },
  {
    id: 'product', icon: 'sparkle', style: 'bold', format: 'landscape', seconds: 30,
    request: {
      en: 'A launch video for our new product: what it is, what makes it different, and where to get it.',
      ar: 'فيديو لإطلاق منتجنا الجديد: ما هو، وما الذي يميزه، ومن أين يمكن الحصول عليه.',
      ckb: 'ڤیدیۆیەک بۆ ناساندنی بەرهەمە نوێیەکەمان: چییە، چی جیای دەکاتەوە، و لە کوێ دەست دەکەوێت.',
      kmr: 'ڤیدیۆیەک بۆ دەستپێکرنا بەرهەمێ مە یێ نوو: چییە، چ وی جودا دکەت، و ل کیرێ پەیدا دبیت.',
    },
  },
  {
    id: 'event', icon: 'calendar', style: 'elegant', format: 'portrait', seconds: 30,
    request: {
      en: 'An invitation to our event: what it is, when and where it happens, and how to confirm you are coming.',
      ar: 'دعوة لحضور فعاليتنا: ما هي، ومتى وأين تُقام، وكيف تؤكد حضورك.',
      ckb: 'بانگهێشتێک بۆ بۆنەکەمان: چییە، کەی و لە کوێ دەبێت، و چۆن بەشداریکردنت پشتڕاست بکەیتەوە.',
      kmr: 'داخوازنامەیەک بۆ بۆنەیا مە: چییە، کەنگی و ل کیرێ دێ بیت، و چاوا هاتنا خۆ پشتراست بکەی.',
    },
  },
  {
    id: 'clinic', icon: 'plus', style: 'minimal', format: 'portrait', seconds: 30,
    request: {
      en: 'A promo for our clinic: the care we offer, why patients trust us, and how to book an appointment.',
      ar: 'فيديو ترويجي لعيادتنا: الرعاية التي نقدمها، ولماذا يثق بنا المرضى، وكيف تحجز موعداً.',
      ckb: 'ڤیدیۆیەکی ڕیکلام بۆ کلینیکەکەمان: ئەو چاودێرییەی پێشکەشی دەکەین، بۆچی نەخۆشەکان متمانەمان پێدەکەن، و چۆن کاتێک دیاری بکەیت.',
      kmr: 'ڤیدیۆیەکا ریکلامێ بۆ کلینیکا مە: ئەو چاڤدێریا ئەم پێشکێش دکەین، بۆچی نەخۆش باوەریێ ب مە دئینن، و چاوا ژڤانەکێ بگری.',
    },
  },
  {
    id: 'restaurant', icon: 'flame', style: 'warm', format: 'portrait', seconds: 15,
    request: {
      en: 'A mouth-watering promo for our restaurant: our best dishes, the atmosphere, and how to visit or order.',
      ar: 'فيديو ترويجي شهي لمطعمنا: أفضل أطباقنا، والأجواء، وكيف تزورنا أو تطلب.',
      ckb: 'ڤیدیۆیەکی ڕیکلامی سەرنجڕاکێش بۆ چێشتخانەکەمان: باشترین خواردنەکانمان، کەشەکەی، و چۆن سەردانمان بکەیت یان داوا بکەیت.',
      kmr: 'ڤیدیۆیەکا ریکلامێ یا سەرنجراکێش بۆ خوارنگەها مە: باشترین خوارنێن مە، کەشێ وێ، و چاوا سەرەدانا مە بکەی یان داخواز بکەی.',
    },
  },
  {
    id: 'course', icon: 'pencil', style: 'modern', format: 'landscape', seconds: 30,
    request: {
      en: 'A promo for our training course: who it is for, what you will learn, and how to register.',
      ar: 'فيديو ترويجي لدورتنا التدريبية: لمن هي، وماذا ستتعلم، وكيف تسجل.',
      ckb: 'ڤیدیۆیەکی ڕیکلام بۆ خولی ڕاهێنانەکەمان: بۆ کێیە، چی فێر دەبیت، و چۆن خۆت تۆمار بکەیت.',
      kmr: 'ڤیدیۆیەکا ریکلامێ بۆ خولا مە یا راهێنانێ: بۆ کێیە، دێ چ فێربی، و چاوا خۆ تۆمار بکەی.',
    },
  },
  {
    id: 'realestate', icon: 'image', style: 'elegant', format: 'landscape', seconds: 45,
    request: {
      en: 'A listing video for a property for sale: the rooms, the light, the neighbourhood, and how to book a viewing.',
      ar: 'فيديو لعرض عقار للبيع: الغرف، والإضاءة، والحي، وكيف تحجز موعداً للمعاينة.',
      ckb: 'ڤیدیۆیەک بۆ خانوویەکی فرۆشتن: ژوورەکان، ڕووناکییەکەی، گەڕەکەکەی، و چۆن کاتێک بۆ سەردانکردن دیاری بکەیت.',
      kmr: 'ڤیدیۆیەک بۆ خانییەکێ بۆ فرۆتنێ: ژوور، رووناهی، تاخ، و چاوا ژڤانەکێ بۆ دیتنێ بگری.',
    },
  },
  {
    id: 'story', icon: 'bolt', style: 'neon', format: 'portrait', seconds: 15,
    request: {
      en: 'A short story announcement for Instagram and TikTok: big news is coming, follow us so you don’t miss it.',
      ar: 'إعلان قصير كقصة على إنستغرام وتيك توك: خبر كبير قادم، تابعونا حتى لا يفوتكم.',
      ckb: 'ڕاگەیاندنێکی کورت وەک ستۆری بۆ ئینستاگرام و تیکتۆک: هەواڵێکی گەورە لە ڕێگایە، فۆڵۆومان بکەن بۆ ئەوەی لەدەستتان نەچێت.',
      kmr: 'راگەهاندنەکا کورت وەک ستۆری بۆ ئینستاگرام و تیکتۆک: نووچەیەکا مەزن یا ل رێیە، مە فۆلۆ بکەن دا کو ژ دەستێ هەوە نەچیت.',
    },
  },
  {
    id: 'review', icon: 'clock', style: 'bold', format: 'landscape', seconds: 60,
    request: {
      en: 'Our year in review: the milestones, the numbers that mattered, and thanks to everyone who was part of it.',
      ar: 'حصاد عامنا: أبرز المحطات، والأرقام التي صنعت الفرق، وشكر لكل من كان جزءاً منه.',
      ckb: 'کورتەی ساڵەکەمان: گرنگترین ڕووداوەکان، ئەو ژمارانەی گرنگ بوون، و سوپاس بۆ هەموو ئەوانەی بەشێک بوون لێی.',
      kmr: 'کورتیا سالا مە: گرنگترین روودان، ئەو ژمارێن گرنگ بووین، و سوپاس بۆ هەمی ئەوێن بەشەک ژێ بووین.',
    },
  },
  {
    id: 'thanks', icon: 'star', style: 'warm', format: 'square', seconds: 15,
    request: {
      en: 'A warm thank-you message to our customers and friends, with our best wishes.',
      ar: 'رسالة شكر دافئة لعملائنا وأصدقائنا، مع أطيب التمنيات.',
      ckb: 'پەیامێکی گەرمی سوپاسگوزاری بۆ کڕیاران و هاوڕێکانمان، لەگەڵ باشترین هیواکانمان.',
      kmr: 'پەیامەکا گەرم یا سوپاسیێ بۆ کریار و هەڤالێن مە، دگەل باشترین هیڤیان.',
    },
  },
];

export function templateById(id: string): Template | undefined {
  return TEMPLATES.find((x) => x.id === id);
}

type T = (s: string) => string;

/** A template's name, written out as calls so the catalogue scanner sees each one. */
export function templateName(id: TemplateId, t: T): string {
  if (id === 'university') return t('University or school');
  if (id === 'product') return t('Product launch');
  if (id === 'event') return t('Event invitation');
  if (id === 'clinic') return t('Clinic or health');
  if (id === 'restaurant') return t('Restaurant or café');
  if (id === 'course') return t('Course or training');
  if (id === 'realestate') return t('Real-estate listing');
  if (id === 'story') return t('Story announcement');
  if (id === 'review') return t('Year in review');
  return t('Thank-you or greeting');
}

export function templateAbout(id: TemplateId, t: T): string {
  if (id === 'university') return t('Your campus, your colleges, and how to apply.');
  if (id === 'product') return t('What is new, why it matters, and where to get it.');
  if (id === 'event') return t('An invitation, with the date, the place and how to reply.');
  if (id === 'clinic') return t('Your care, your services, and how to book.');
  if (id === 'restaurant') return t('Your dishes, the atmosphere, and how to order.');
  if (id === 'course') return t('Who it is for, what they learn, and how to join.');
  if (id === 'realestate') return t('A home for sale: its rooms, its light, its neighbourhood.');
  if (id === 'story') return t('A short vertical teaser for Instagram and TikTok.');
  if (id === 'review') return t('The year’s milestones and numbers, and a thank-you.');
  return t('A warm message for customers, friends or a holiday.');
}

// ── samples ───────────────────────────────────────────────────────────────

/** A scene before it has an id, a length and a transition. */
type Spec = Scene extends infer S ? (S extends Scene ? Omit<S, 'id' | 'seconds' | 'transition'> : never) : never;

const T_ = (title: string, subtitle: string): Spec => ({ kind: 'title', title, subtitle });
const K = (text: string): Spec => ({ kind: 'kinetic', text });
const B = (heading: string, points: string[]): Spec => ({ kind: 'bullets', heading, points });
const I = (caption: string): Spec => ({ kind: 'image', caption });
const S = (heading: string, text: string): Spec => ({ kind: 'split', heading, text });
const P = (heading: string, steps: string[]): Spec => ({ kind: 'steps', heading, steps });
const O = (headline: string, cta: string): Spec => ({ kind: 'outro', headline, cta });
const N = (value: number, suffix: string, label: string): Spec => ({ kind: 'stat', value, suffix, label });
const C = (heading: string, bars: [string, number][]): Spec => ({ kind: 'chart', heading, bars: bars.map(([label, value]) => ({ label, value })) });

interface Sample {
  /** Words to search a picture with, in English, by scene index. */
  pictures: Readonly<Record<number, string>>;
  scenes: Readonly<Record<VideoLang, Spec[]>>;
}

const SAMPLES: Readonly<Record<TemplateId, Sample>> = {
  university: {
    pictures: { 0: 'university campus', 3: 'students on campus' },
    scenes: {
      en: [
        T_('Welcome to our university', 'Learn, discover and build your future'),
        K('A place where ideas become careers'),
        B('Why study with us', ['Colleges for every ambition', 'Teachers who know your name', 'Labs, libraries and a lively campus']),
        I('Student life on campus'),
        P('How to join us', ['Choose your programme', 'Send your documents', 'Start your first term']),
        O('Your future starts here', 'Apply today'),
      ],
      ar: [
        T_('أهلاً بكم في جامعتنا', 'تعلّم واكتشف وابنِ مستقبلك'),
        K('مكان تتحول فيه الأفكار إلى مهن'),
        B('لماذا تدرس معنا', ['كليات لكل طموح', 'أساتذة يعرفونك بالاسم', 'مختبرات ومكتبات وحرم جامعي نابض بالحياة']),
        I('الحياة الطلابية في الحرم الجامعي'),
        P('كيف تنضم إلينا', ['اختر تخصصك', 'أرسل وثائقك', 'ابدأ فصلك الدراسي الأول']),
        O('مستقبلك يبدأ هنا', 'قدّم اليوم'),
      ],
      ckb: [
        T_('بەخێربێن بۆ زانکۆکەمان', 'فێربە، بدۆزەرەوە و داهاتووت بنیات بنێ'),
        K('شوێنێک کە بیرۆکەکان تێیدا دەبنە پیشە'),
        B('بۆچی لەگەڵ ئێمە بخوێنیت', ['کۆلێژ بۆ هەموو ئامانجێک', 'مامۆستایانێک کە بە ناو دەتناسن', 'تاقیگە، کتێبخانە و کەمپەسێکی پڕ لە ژیان']),
        I('ژیانی قوتابیان لە کەمپەس'),
        P('چۆن بەشداری بکەیت', ['بەشەکەت هەڵبژێرە', 'بەڵگەنامەکانت بنێرە', 'یەکەم وەرزی خوێندنت دەست پێ بکە']),
        O('داهاتووت لێرەوە دەست پێ دەکات', 'ئەمڕۆ داواکاری پێشکەش بکە'),
      ],
      kmr: [
        T_('ب خێر بێن بۆ زانکۆیا مە', 'فێر ببە، ببینە و پاشەرۆژا خۆ ئاڤا بکە'),
        K('جهەک کو بیرۆکە تێدا دبنە کار و پیشە'),
        B('بۆچی دگەل مە بخوینی', ['کۆلیژ بۆ هەر ئارمانجەکێ', 'مامۆستا کو ب ناڤێ تە دنیاسن', 'تاقیگەه، پەرتووکخانە و کەمپەسەکێ تژی ژیان']),
        I('ژیانا خوێندکاران ل کەمپەسی'),
        P('چاوا بەشدار ببی', ['بەشێ خۆ هەلبژێرە', 'بەلگەنامێن خۆ بفرێکە', 'وەرزێ خۆ یێ ئێکێ دەست پێ بکە']),
        O('پاشەرۆژا تە ژ ڤێرە دەست پێ دکەت', 'ئەڤرۆ داخوازیێ پێشکێش بکە'),
      ],
    },
  },
  product: {
    pictures: { 0: 'new product launch', 2: 'product design detail' },
    scenes: {
      en: [
        T_('Something new is here', 'Designed to make every day easier'),
        K('Faster. Simpler. Yours.'),
        S('Made for real life', 'Every detail is designed around the way you live and work.'),
        B('Why you will love it', ['Easy from the first minute', 'Built to last', 'Help whenever you need it']),
        O('Available now', 'Order yours today'),
      ],
      ar: [
        T_('شيء جديد وصل', 'صُمّم ليجعل كل يوم أسهل'),
        K('أسرع. أبسط. لك.'),
        S('صُنع للحياة الحقيقية', 'كل تفصيلة مصممة حول طريقة عيشك وعملك.'),
        B('لماذا ستحبه', ['سهل من الدقيقة الأولى', 'مصنوع ليدوم', 'مساعدة متى احتجت إليها']),
        O('متوفر الآن', 'اطلبه اليوم'),
      ],
      ckb: [
        T_('شتێکی نوێ گەیشت', 'دیزاین کراوە بۆ ئەوەی هەموو ڕۆژێک ئاسانتر بکات'),
        K('خێراتر. سادەتر. هی تۆ.'),
        S('بۆ ژیانی ڕاستەقینە دروستکراوە', 'هەموو وردەکارییەک بەپێی شێوازی ژیان و کارکردنت دیزاین کراوە.'),
        B('بۆچی خۆشت دەوێت', ['هەر لە یەکەم خولەکەوە ئاسانە', 'بۆ ماوەیەکی درێژ دروستکراوە', 'یارمەتی هەر کاتێک پێویستت بوو']),
        O('ئێستا بەردەستە', 'ئەمڕۆ داوای بکە'),
      ],
      kmr: [
        T_('تشتەکێ نوو گەهشت', 'هاتیە دیزاینکرن دا کو هەر رۆژەکێ ساناهیتر بکەت'),
        K('لەزتر. ساناهیتر. یێ تە.'),
        S('بۆ ژیانا راستەقینە هاتیە چێکرن', 'هەر هویرکاریەک ل دویڤ شێوازێ ژیان و کارێ تە هاتیە دیزاینکرن.'),
        B('بۆچی دێ حەز ژێ کەی', ['هەر ژ خولەکا ئێکێ ساناهیە', 'بۆ مانێ هاتیە چێکرن', 'هاریکاری هەر دەمەکێ پێدڤی بی']),
        O('نوکە بەردەستە', 'ئەڤرۆ داخواز بکە'),
      ],
    },
  },
  event: {
    pictures: { 0: 'elegant event hall', 3: 'celebration lights' },
    scenes: {
      en: [
        T_('You’re invited', 'Join us for an evening to remember'),
        K('Good company, good music and a night to celebrate together'),
        B('When and where', ['Add the date here', 'Add the place here', 'Add the time here']),
        I('We would love to see you there'),
        O('See you there', 'Please reply to confirm'),
      ],
      ar: [
        T_('أنتم مدعوون', 'شاركونا أمسية لا تُنسى'),
        K('صحبة طيبة وموسيقى جميلة وليلة نحتفل فيها معاً'),
        B('الموعد والمكان', ['أضف التاريخ هنا', 'أضف المكان هنا', 'أضف الوقت هنا']),
        I('يسعدنا حضوركم'),
        O('نراكم هناك', 'يرجى تأكيد الحضور'),
      ],
      ckb: [
        T_('بانگهێشتن کراون', 'بەشداری ئێوارەیەکی لەبیرنەکراومان بن'),
        K('هاوڕێی باش، مۆسیقای خۆش و شەوێک بۆ ئاهەنگگێڕان پێکەوە'),
        B('کات و شوێن', ['بەروار لێرە زیاد بکە', 'شوێن لێرە زیاد بکە', 'کاتژمێر لێرە زیاد بکە']),
        I('بە بینینتان دڵخۆش دەبین'),
        O('لەوێ دەتانبینین', 'تکایە بەشداریکردنتان پشتڕاست بکەنەوە'),
      ],
      kmr: [
        T_('هوین دهێنە داخوازکرن', 'دگەل مە بەشداری ئێڤارەکا ژ بیر نەچی بکەن'),
        K('هەڤالێن باش، مۆسیقایا خۆش و شەڤەک بۆ ئاهەنگگێرانێ پێکڤە'),
        B('دەم و جه', ['رێکەفتێ ل ڤێرە زێدە بکە', 'جهی ل ڤێرە زێدە بکە', 'دەمژمێرێ ل ڤێرە زێدە بکە']),
        I('ب دیتنا هەوە دێ دلخۆش بین'),
        O('ل وێرێ دێ هەوە بینین', 'هیڤیە هاتنا خۆ پشتراست بکەن'),
      ],
    },
  },
  clinic: {
    pictures: { 0: 'modern clinic' },
    scenes: {
      en: [
        T_('Care you can trust', 'Your health, in experienced hands'),
        B('Our services', ['Check-ups for the whole family', 'Modern equipment', 'Appointments that fit your day']),
        K('We listen first, then we treat'),
        P('Book in three steps', ['Call or message us', 'Choose a time', 'Come in — we take care of the rest']),
        O('Book your visit', 'Call us today'),
      ],
      ar: [
        T_('رعاية يمكنك الوثوق بها', 'صحتك بين أيدٍ خبيرة'),
        B('خدماتنا', ['فحوصات للعائلة كلها', 'أجهزة حديثة', 'مواعيد تناسب يومك']),
        K('نستمع إليك أولاً، ثم نعالج'),
        P('احجز في ثلاث خطوات', ['اتصل بنا أو راسلنا', 'اختر الموعد المناسب', 'تعال إلينا ونحن نهتم بالباقي']),
        O('احجز زيارتك', 'اتصل بنا اليوم'),
      ],
      ckb: [
        T_('چاودێرییەک کە دەتوانیت متمانەی پێ بکەیت', 'تەندروستیت لە دەستی شارەزادایە'),
        B('خزمەتگوزارییەکانمان', ['پشکنین بۆ هەموو خێزان', 'ئامێری نوێ', 'کاتی چاوپێکەوتن کە لەگەڵ ڕۆژەکەت بگونجێت']),
        K('سەرەتا گوێ دەگرین، پاشان چارەسەر دەکەین'),
        P('لە سێ هەنگاودا کات دیاری بکە', ['پەیوەندیمان پێوە بکە یان نامەمان بۆ بنێرە', 'کاتێک هەڵبژێرە', 'وەرە — ئێمە ئاگاداری باقییەکەین']),
        O('سەردانەکەت دیاری بکە', 'ئەمڕۆ پەیوەندیمان پێوە بکە'),
      ],
      kmr: [
        T_('چاڤدێریەک کو دشێی باوەریێ پێ بینی', 'ساخلەمیا تە د دەستێن شارەزادایە'),
        B('خزمەتگوزاریێن مە', ['پشکنین بۆ هەمی خێزانێ', 'ئامیرێن نوو', 'ژڤان کو دگەل رۆژا تە بگونجن']),
        K('ئێکەمجار گوهێ خۆ ددەینێ، پاشان چارەسەر دکەین'),
        P('د سێ پێنگاڤاندا ژڤانێ بگرە', ['تێلەفۆنێ بۆ مە بکە یان نامەیەکێ بفرێکە', 'دەمەکێ هەلبژێرە', 'وەرە — ئەم دێ ئاگەهداری یێن مای بین']),
        O('ژڤانێ سەرەدانا خۆ بگرە', 'ئەڤرۆ پەیوەندیێ ب مە بکە'),
      ],
    },
  },
  restaurant: {
    pictures: { 0: 'restaurant food table', 1: 'delicious dish plate' },
    scenes: {
      en: [
        T_('Fresh every day', 'Made with love, served with a smile'),
        I('Try today’s special'),
        K('Come hungry. Leave happy.'),
        O('See you soon', 'Visit us or order now'),
      ],
      ar: [
        T_('طازج كل يوم', 'مصنوع بحب ويُقدَّم بابتسامة'),
        I('جرّب طبق اليوم'),
        K('تعال جائعاً، واخرج سعيداً.'),
        O('نراك قريباً', 'زرنا أو اطلب الآن'),
      ],
      ckb: [
        T_('هەموو ڕۆژێک تازە', 'بە خۆشەویستی دروست دەکرێت، بە زەردەخەنە پێشکەش دەکرێت'),
        I('خواردنی تایبەتی ئەمڕۆ تاقی بکەرەوە'),
        K('برسی وەرە. دڵخۆش بڕۆ.'),
        O('بەم زووانە دەتبینینەوە', 'سەردانمان بکە یان ئێستا داوا بکە'),
      ],
      kmr: [
        T_('هەر رۆژ تازە', 'ب حەزکرن دهێتە چێکرن، ب کەنی دهێتە پێشکێشکرن'),
        I('خوارنا تایبەت یا ئەڤرۆ تاقی بکە'),
        K('برسی وەرە. دلخۆش هەرە.'),
        O('دێ زوو تە بینین', 'سەرەدانا مە بکە یان نوکە داخواز بکە'),
      ],
    },
  },
  course: {
    pictures: { 0: 'classroom training', 2: 'teacher explaining' },
    scenes: {
      en: [
        T_('Learn a new skill', 'A practical course for beginners and professionals'),
        B('What you will learn', ['The basics, step by step', 'Hands-on practice', 'Real projects to work on']),
        S('Taught by practitioners', 'Learn from people who use these skills every day.'),
        P('How to join', ['Register online', 'Choose your group', 'Start learning']),
        O('Join the next group', 'Register today'),
      ],
      ar: [
        T_('تعلّم مهارة جديدة', 'دورة عملية للمبتدئين والمحترفين'),
        B('ماذا ستتعلم', ['الأساسيات خطوة بخطوة', 'تدريب عملي', 'مشاريع حقيقية تعمل عليها']),
        S('يدرّسها أهل الخبرة', 'تعلّم من أشخاص يستخدمون هذه المهارات كل يوم.'),
        P('كيف تنضم', ['سجّل عبر الإنترنت', 'اختر مجموعتك', 'ابدأ التعلم']),
        O('انضم إلى المجموعة القادمة', 'سجّل اليوم'),
      ],
      ckb: [
        T_('کارامەییەکی نوێ فێربە', 'خولێکی کردەیی بۆ سەرەتاییەکان و پسپۆڕان'),
        B('چی فێر دەبیت', ['بنەماکان، هەنگاو بە هەنگاو', 'ڕاهێنانی کردەیی', 'پڕۆژەی ڕاستەقینە بۆ کارکردن']),
        S('شارەزایان دەیڵێنەوە', 'لە کەسانێک فێربە کە ڕۆژانە ئەم کارامەییانە بەکاردەهێنن.'),
        P('چۆن بەشداری بکەیت', ['لە ئینتەرنێتەوە خۆت تۆمار بکە', 'گرووپەکەت هەڵبژێرە', 'دەست بە فێربوون بکە']),
        O('بەشداری گرووپی داهاتوو بکە', 'ئەمڕۆ خۆت تۆمار بکە'),
      ],
      kmr: [
        T_('شیانەکا نوو فێر ببە', 'خولەکا کرداری بۆ دەستپێکەران و شارەزایان'),
        B('دێ چ فێر بی', ['بنەما، پێنگاڤ ب پێنگاڤ', 'راهێنانا کرداری', 'پرۆژێن راستەقینە بۆ کارکرنێ']),
        S('شارەزا دبێژنەڤە', 'ژ وان کەسان فێر ببە یێن هەر رۆژ ڤان شیانان ب کار دئینن.'),
        P('چاوا بەشدار ببی', ['ب رێکا ئینتەرنێتێ خۆ تۆمار بکە', 'گرووپا خۆ هەلبژێرە', 'دەست ب فێربوونێ بکە']),
        O('بەشداریێ د گرووپا بهێت دا بکە', 'ئەڤرۆ خۆ تۆمار بکە'),
      ],
    },
  },
  realestate: {
    pictures: { 0: 'modern house exterior', 1: 'bright living room interior', 3: 'house garden' },
    scenes: {
      en: [
        T_('Your new home', 'Space, light and comfort in a quiet neighbourhood'),
        I('A bright, open living room'),
        B('The highlights', ['Add the number of rooms', 'Add the area', 'Add what is nearby']),
        I('Room to grow'),
        O('Book a viewing', 'Call us to visit'),
      ],
      ar: [
        T_('بيتك الجديد', 'مساحة وضوء وراحة في حي هادئ'),
        I('غرفة معيشة مشرقة ومفتوحة'),
        B('أبرز المزايا', ['أضف عدد الغرف', 'أضف المساحة', 'أضف ما هو قريب منه']),
        I('مساحة تكبر فيها العائلة'),
        O('احجز موعداً للمعاينة', 'اتصل بنا للزيارة'),
      ],
      ckb: [
        T_('ماڵە نوێیەکەت', 'بۆشایی، ڕووناکی و ئاسوودەیی لە گەڕەکێکی ئارامدا'),
        I('ژووری دانیشتنێکی ڕووناک و کراوە'),
        B('گرنگترین تایبەتمەندییەکان', ['ژمارەی ژوورەکان زیاد بکە', 'ڕووبەرەکە زیاد بکە', 'ئەوەی لە نزیکییەوەیە زیاد بکە']),
        I('شوێن بۆ گەورەبوونی خێزان'),
        O('کاتێک بۆ بینین دیاری بکە', 'بۆ سەردان پەیوەندیمان پێوە بکە'),
      ],
      kmr: [
        T_('خانیێ تە یێ نوو', 'جه، رووناهی و ئاسوودەیی د تاخەکێ هێمندا'),
        I('ژوورەکا روینشتنێ یا رووناک و ڤەکری'),
        B('گرنگترین تایبەتمەندی', ['ژمارا ژووران زێدە بکە', 'رووبەری زێدە بکە', 'ئەوا نێزیکی وێ زێدە بکە']),
        I('جه بۆ مەزنبوونا خێزانێ'),
        O('ژڤانەکێ بۆ دیتنێ بگرە', 'بۆ سەرەدانێ پەیوەندیێ ب مە بکە'),
      ],
    },
  },
  story: {
    pictures: {},
    scenes: {
      en: [
        T_('Big news!', 'Something new is on the way'),
        K('Stay tuned — it is almost here'),
        O('Coming soon', 'Follow us so you don’t miss it'),
      ],
      ar: [
        T_('خبر كبير!', 'شيء جديد في الطريق'),
        K('ترقبوا — اقترب الموعد'),
        O('قريباً', 'تابعونا حتى لا يفوتكم'),
      ],
      ckb: [
        T_('هەواڵێکی گەورە!', 'شتێکی نوێ لە ڕێگایە'),
        K('چاوەڕێ بن — نزیک بووەتەوە'),
        O('بەم زووانە', 'فۆڵۆومان بکەن بۆ ئەوەی لەدەستتان نەچێت'),
      ],
      kmr: [
        T_('نووچەیەکا مەزن!', 'تشتەکێ نوو ل رێیە'),
        K('چاڤەرێ بن — نێزیک بوو'),
        O('ب زوویی', 'مە فۆلۆ بکەن دا ژ دەستێ هەوە نەچیت'),
      ],
    },
  },
  review: {
    pictures: { 0: 'team celebration' },
    scenes: {
      en: [
        T_('Our year in review', 'The moments that made it'),
        N(100, '%', 'Replace with a real number from your year'),
        C('Quarter by quarter (sample figures)', [['Q1', 10], ['Q2', 20], ['Q3', 30], ['Q4', 40]]),
        B('Highlights', ['Our proudest moment', 'Something we started', 'What we learned']),
        K('Thank you for being part of it'),
        O('On to next year', 'Here’s to what comes next'),
      ],
      ar: [
        T_('حصاد عامنا', 'اللحظات التي صنعته'),
        N(100, '%', 'ضع هنا رقماً حقيقياً من عامك'),
        C('ربعاً بربع (أرقام للتوضيح)', [['الربع الأول', 10], ['الثاني', 20], ['الثالث', 30], ['الرابع', 40]]),
        B('أبرز المحطات', ['أكثر لحظة نفخر بها', 'شيء بدأناه', 'ما تعلمناه']),
        K('شكراً لأنكم كنتم جزءاً منه'),
        O('إلى عام جديد', 'نحو ما هو قادم'),
      ],
      ckb: [
        T_('کورتەی ساڵەکەمان', 'ئەو ساتانەی ساڵەکەیان دروست کرد'),
        N(100, '%', 'ژمارەیەکی ڕاستەقینە لە ساڵەکەتەوە لێرە دابنێ'),
        C('چارەک بە چارەک (ژمارەی نموونە)', [['چارەکی یەکەم', 10], ['دووەم', 20], ['سێیەم', 30], ['چوارەم', 40]]),
        B('گرنگترینەکان', ['شانازترین ساتمان', 'شتێک کە دەستمان پێکرد', 'ئەوەی فێری بووین']),
        K('سوپاس کە بەشێک بوون لێی'),
        O('بەرەو ساڵێکی نوێ', 'بۆ ئەوەی دێت'),
      ],
      kmr: [
        T_('کورتیا سالا مە', 'ئەو دەمێن سال چێکری'),
        N(100, '%', 'ژمارەکا راستەقینە ژ سالا خۆ ل ڤێرە دانێ'),
        C('چارەک ب چارەک (ژمارێن نموونە)', [['چارەکا ئێکێ', 10], ['دووێ', 20], ['سێێ', 30], ['چارێ', 40]]),
        B('گرنگترین', ['سەربلندترین دەمێ مە', 'تشتەک کو مە دەست پێکری', 'ئەوا ئەم فێر بووین']),
        K('سوپاس کو هوین بەشەک ژێ بوون'),
        O('بەرەف سالەکا نوو', 'بۆ ئەوا دێ هێت'),
      ],
    },
  },
  thanks: {
    pictures: {},
    scenes: {
      en: [
        T_('Thank you', 'From all of us, with gratitude'),
        K('Your support means the world to us'),
        O('With our best wishes', 'See you soon'),
      ],
      ar: [
        T_('شكراً لكم', 'من كل فريقنا، مع خالص الامتنان'),
        K('دعمكم يعني لنا الكثير'),
        O('مع أطيب التمنيات', 'إلى اللقاء قريباً'),
      ],
      ckb: [
        T_('سوپاس', 'لە هەموومانەوە، بە سوپاسگوزارییەوە'),
        K('پشتگیریتان بۆ ئێمە زۆر بەنرخە'),
        O('لەگەڵ باشترین هیواکانمان', 'بەم زووانە دەتانبینینەوە'),
      ],
      kmr: [
        T_('سوپاس', 'ژ هەمییێن مە، ب سوپاسیڤە'),
        K('پشتەڤانیا هەوە بۆ مە گەلەک ب بهایە'),
        O('دگەل باشترین هیڤیان', 'دێ ب زوویی هەوە بینین'),
      ],
    },
  },
};

/** The sample's scenes in a language, as written — for the tests. */
export function sampleSpecs(id: TemplateId, lang: VideoLang): readonly Spec[] {
  return SAMPLES[id].scenes[lang] ?? SAMPLES[id].scenes.en;
}

/** How each style hands over from one scene to the next, in a sample. */
const HANDOVER: Readonly<Record<Style, Transition>> = {
  modern: 'slide', bold: 'wipe', elegant: 'fade', neon: 'zoom', minimal: 'fade', warm: 'slide',
};

/** Fields that are not words anybody reads on screen. */
const UNREAD = new Set(['kind', 'id', 'seconds', 'transition', 'imageQuery', 'picture', 'narration']);

function wordsIn(x: unknown): number {
  if (typeof x === 'string') return x.split(/\s+/).filter(Boolean).length;
  if (Array.isArray(x)) return x.reduce((n: number, y) => n + wordsIn(y), 0);
  if (x && typeof x === 'object') return Object.entries(x).reduce((n, [k, y]) => n + (UNREAD.has(k) ? 0 : wordsIn(y)), 0);
  return 0;
}

const half = (n: number) => Math.round(n * 2) / 2;

/**
 * The scenes' seconds, scaled so the video plays for about `seconds`: each
 * scene first gets the time its words take to read (three words a second,
 * and a moment to arrive), then all of them the same share of what is left
 * or over — on the half second, each between 2 and 20.
 */
export function fitSeconds(scenes: Scene[], seconds: number): Scene[] {
  if (!scenes.length) return scenes;
  const read = scenes.map((s) => Math.max(2.5, wordsIn(s) / 3 + 1.2));
  const overlaps = scenes.slice(0, -1).filter((s) => s.transition !== 'none').length * (TRANSITION_FRAMES / FPS);
  const scale = (seconds + overlaps) / read.reduce((a, b) => a + b, 0);
  return scenes.map((s, i) => ({ ...s, seconds: Math.min(20, Math.max(2, half(read[i] * scale))) }));
}

const SAMPLE_PREFIX = 'sample-';

/**
 * A sample video from a template, ready to preview and edit: its scenes in
 * `lang`, the brand's name on the close when there is one, pictures suggested
 * but not fetched. `request` is what the request box said, so that "plan it
 * with the model" plans from it later.
 */
export function sampleVideo(tpl: Template, o: {
  now: number; lang: VideoLang; request: string; brand?: Brand; newId: () => string;
}): Video {
  const v = newVideo({
    id: `${SAMPLE_PREFIX}${tpl.id}-${o.newId()}`, now: o.now, request: o.request, lang: o.lang,
    format: tpl.format, style: tpl.style, seconds: tpl.seconds, brand: o.brand,
  });
  const sample = SAMPLES[tpl.id];
  const specs = sample.scenes[o.lang] ?? sample.scenes.en;
  const brandName = o.brand?.name?.trim();
  const scenes = specs.map((spec, i): Scene => {
    const last = i === specs.length - 1;
    const query = sample.pictures[i];
    const s = { ...spec, id: o.newId(), seconds: 3, transition: last ? 'none' : HANDOVER[tpl.style], ...(query ? { imageQuery: query } : {}) } as Scene;
    return s.kind === 'outro' && brandName ? { ...s, headline: brandName } : s;
  });
  const first = specs.find((s) => s.kind === 'title');
  return {
    ...v,
    title: first && first.kind === 'title' ? first.title : '',
    scenes: fitSeconds(scenes, tpl.seconds),
    stage: 'ready',
  };
}

/** The template a video is a sample of, while no model has planned it; `null` for any other video. */
export function sampleOf(v: Pick<Video, 'id' | 'model'>): Template | null {
  if (v.model || !v.id.startsWith(SAMPLE_PREFIX)) return null;
  const id = v.id.slice(SAMPLE_PREFIX.length).split('-')[0];
  return templateById(id) ?? null;
}

/** Seconds a sample plays for — for the tests, and for a card that wants to say so. */
export const playedSeconds = (v: Pick<Video, 'scenes'>) => durationInFrames(v) / FPS;
