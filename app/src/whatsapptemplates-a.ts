import type { Template } from './whatsappbulktypes';

/**
 * The first half of the ready messages (docs/wa/templates.md): selling, occasions, appointments and looking
 * after customers — sale, new, code, flash, restock, event, opening, appointment, followup, review, loyalty,
 * birthday, holiday. The other thirteen categories are in `whatsapptemplates-b.ts`; `whatsapptemplates.ts`
 * merges both and is the only thing that reads this.
 *
 * ## How these are written
 *
 * - **Nothing the sender did not say.** A price, a percentage, a date, a product, a deadline is always a
 *   placeholder: no digit appears in any text, and no "free", "win" or "guaranteed". A ready message that
 *   promised a discount the shop is not giving would be sent to hundreds of people before anyone noticed.
 * - **No opt-out line.** The engine adds one, translated, to every `promo`; one written here would appear twice.
 * - **Arabic addresses people in the plural** (احجزوا، زورونا، بانتظاركم). The list does not say who is a man
 *   and who a woman, عزيزي would be wrong for half of it, and the polite plural is how shops write in the
 *   region anyway. A placeholder never carries a prefix or suffix glued to it (لـ{business}): the filled
 *   word would join the letter wrongly, so the sentence is built around the placeholder instead.
 * - **Sorani and Badini** use the singular (تۆ / تو) when the message greets the person by `{name}`, the
 *   plural when it speaks to everyone. Both are written in Arabic script as the app writes them elsewhere
 *   (بەروار for a date, ناڤونیشان for Badini's address, بها for its price). They are a careful best effort;
 *   the strings least sure of are listed in docs/wa/review-needed.md for a native reader.
 * - **Short.** Most are under 300 characters; one call to action; at most three emoji, and none in a
 *   `service` message — a reminder of an appointment is not a party.
 */

/** A message's lines, joined: a line each reads better beside its translation than `\n` inside one long string. */
const lines = (...l: string[]): string => l.join('\n');

export const TEMPLATES_A: readonly Template[] = [
  // ── sale ────────────────────────────────────────────────────────────────
  {
    id: 'sale-1',
    category: 'sale',
    kind: 'promo',
    title: { en: 'Season sale', ar: 'تخفيضات الموسم', ckb: 'داشکاندنی وەرز', kmr: 'داشکاندنا وەرزی' },
    text: {
      en: lines(
        'Hi {name} 🛍️',
        'The season sale has started at {business}: *{discount}* off {product}.',
        'It runs until {date}, so come early for the best choice.',
        '',
        'Shop now: {link}',
      ),
      ar: lines(
        'مرحباً {name} 🛍️',
        'بدأت تخفيضات الموسم في {business}: خصم *{discount}* على {product}.',
        'يستمر العرض حتى {date}، فلا تتأخروا لتحظوا بأفضل الخيارات.',
        '',
        'تسوّقوا الآن: {link}',
      ),
      ckb: lines(
        'سڵاو {name} 🛍️',
        'داشکاندنی وەرز لە {business} دەستی پێکرد: داشکاندنی *{discount}* لەسەر {product}.',
        'تا {date} بەردەوامە، زوو وەرە بۆ ئەوەی باشترینەکان هەڵبژێریت.',
        '',
        'ئێستا بکڕە: {link}',
      ),
      kmr: lines(
        'سلاڤ {name} 🛍️',
        'داشکاندنا وەرزی ل {business} دەست پێکر: داشکاندنا *{discount}* ل سەر {product}.',
        'هەتا {date} بەردەوامە، زوی وەرە دا باشترینان هەلبژێری.',
        '',
        'نوکە بکڕە: {link}',
      ),
    },
    vars: ['name', 'business', 'discount', 'product', 'date', 'link'],
    tags: ['shop', 'clothing', 'seasonal'],
  },
  {
    id: 'sale-2',
    category: 'sale',
    kind: 'promo',
    title: { en: 'Weekend offers', ar: 'عروض نهاية الأسبوع', ckb: 'ئۆفەری کۆتایی هەفتە', kmr: 'ئۆفەرێن دوماهیا هەفتیێ' },
    text: {
      en: lines(
        'This weekend at {business} 🎉',
        '{offer}',
        '',
        'When: {date}, open {hours}.',
        'Where: {address}. See you there!',
      ),
      ar: lines(
        'عروض نهاية الأسبوع في {business} 🎉',
        '{offer}',
        '',
        'الموعد: {date}، وأوقات الدوام: {hours}.',
        'العنوان: {address}. بانتظاركم!',
      ),
      ckb: lines(
        'ئۆفەرەکانی کۆتایی هەفتە لە {business} 🎉',
        '{offer}',
        '',
        'کات: {date}، کاتی کارکردن: {hours}.',
        'ناونیشان: {address}. چاوەڕێتانین!',
      ),
      kmr: lines(
        'ئۆفەرێن دوماهیا هەفتیێ ل {business} 🎉',
        '{offer}',
        '',
        'دەم: {date}، دەمێن کاری: {hours}.',
        'ناڤونیشان: {address}. چاڤەڕێی هەوە دکەین!',
      ),
    },
    vars: ['business', 'offer', 'date', 'hours', 'address'],
    tags: ['supermarket', 'shop', 'weekend'],
  },
  {
    id: 'sale-3',
    category: 'sale',
    kind: 'promo',
    title: { en: 'Price drop', ar: 'سعر جديد أقل', ckb: 'دابەزینی نرخ', kmr: 'دابەزینا بهای' },
    text: {
      en: lines(
        'Good news, {name}: {product} is now {price} at {business} (it was {old_price}).',
        '',
        'Order yours here: {link}',
      ),
      ar: lines(
        'خبر سارّ يا {name}: أصبح سعر {product} في {business} الآن {price} بدلاً من {old_price}.',
        '',
        'اطلبوا الآن من هنا: {link}',
      ),
      ckb: lines(
        'مژدە {name}: نرخی {product} لە {business} بووە بە {price} (پێشتر {old_price} بوو).',
        '',
        'لێرە داوای بکە: {link}',
      ),
      kmr: lines(
        'مزگینی {name}: بهایێ {product} ل {business} بوو {price} (بەرێ {old_price} بوو).',
        '',
        'ل ڤێرە داخواز بکە: {link}',
      ),
    },
    vars: ['name', 'product', 'price', 'business', 'old_price', 'link'],
    tags: ['online-store', 'electronics', 'price'],
  },
  {
    id: 'sale-4',
    category: 'sale',
    kind: 'promo',
    title: { en: 'Eid offers', ar: 'عروض العيد', ckb: 'ئۆفەری جەژن', kmr: 'ئۆفەرێن جەژنێ' },
    text: {
      en: lines(
        'Get ready for Eid with {business} 🌙',
        '{offer}',
        '',
        'Until {date}, at {address}.',
        'We look forward to welcoming you!',
      ),
      ar: lines(
        'استعدّوا للعيد مع {business} 🌙',
        '{offer}',
        '',
        'حتى {date}، في {address}.',
        'يسعدنا استقبالكم!',
      ),
      ckb: lines(
        'خۆتان بۆ جەژن ئامادە بکەن لەگەڵ {business} 🌙',
        '{offer}',
        '',
        'تا {date}، لە {address}.',
        'بە خۆشحاڵییەوە چاوەڕێتانین!',
      ),
      kmr: lines(
        'خۆ بۆ جەژنێ ئامادە بکەن دگەل {business} 🌙',
        '{offer}',
        '',
        'هەتا {date}، ل {address}.',
        'ب کەیفخۆشی چاڤەڕێی هەوە دکەین!',
      ),
    },
    vars: ['business', 'offer', 'date', 'address'],
    tags: ['shop', 'clothing', 'eid'],
  },

  // ── new ─────────────────────────────────────────────────────────────────
  {
    id: 'new-1',
    category: 'new',
    kind: 'promo',
    title: { en: 'New in store', ar: 'جديد في المتجر', ckb: 'تازە گەیشتووە', kmr: 'نوی گەهشتی' },
    text: {
      en: lines(
        'Hi {name} ✨',
        'Just in at {business}: {product}.',
        'Be among the first to see it.',
        '',
        'Take a look: {link}',
      ),
      ar: lines(
        'مرحباً {name} ✨',
        'وصل حديثاً إلى {business}: {product}.',
        'كونوا أول من يكتشف الجديد.',
        '',
        'شاهدوا الجديد هنا: {link}',
      ),
      ckb: lines(
        'سڵاو {name} ✨',
        'بە تازەیی گەیشتۆتە {business}: {product}.',
        'پێش هەمووان بیبینە.',
        '',
        'سەیری بکە: {link}',
      ),
      kmr: lines(
        'سلاڤ {name} ✨',
        'نوی گەهشتیە {business}: {product}.',
        'بەری هەمییان ببینە.',
        '',
        'بەرێ خۆ بدێ: {link}',
      ),
    },
    vars: ['name', 'business', 'product', 'link'],
    tags: ['shop', 'clothing'],
  },
  {
    id: 'new-2',
    category: 'new',
    kind: 'promo',
    title: { en: 'New product', ar: 'منتج جديد', ckb: 'بەرهەمی نوێ', kmr: 'بەرهەمێ نوی' },
    text: {
      en: lines(
        'New at {business}: {product} ✨',
        'Price: {price}',
        '',
        'See the details and order here: {link}',
      ),
      ar: lines(
        'جديدنا في {business}: {product} ✨',
        'السعر: {price}',
        '',
        'التفاصيل والطلب من هنا: {link}',
      ),
      ckb: lines(
        'نوێترین بەرهەمی {business}: {product} ✨',
        'نرخ: {price}',
        '',
        'وردەکاری و داواکردن لێرە: {link}',
      ),
      kmr: lines(
        'نویترین بەرهەمێ {business}: {product} ✨',
        'بها: {price}',
        '',
        'زانیاریێن پتر و داخوازکرن ل ڤێرە: {link}',
      ),
    },
    vars: ['business', 'product', 'price', 'link'],
    tags: ['online-store', 'electronics'],
  },
  {
    id: 'new-3',
    category: 'new',
    kind: 'promo',
    title: { en: 'New service', ar: 'خدمة جديدة', ckb: 'خزمەتگوزاری نوێ', kmr: 'خزمەتا نوی' },
    text: {
      en: lines(
        "Hi {name}, there's something new at {business}: {service} ✨",
        '',
        'To book or ask a question, call or message us on {phone}.',
      ),
      ar: lines(
        'مرحباً {name}، لدينا جديد في {business}: {service} ✨',
        '',
        'للحجز أو الاستفسار تواصلوا معنا على {phone}.',
      ),
      ckb: lines(
        'سڵاو {name}، شتێکی نوێمان لە {business} هەیە: {service} ✨',
        '',
        'بۆ نۆرە گرتن یان پرسیار، پەیوەندیمان پێوە بکە بە {phone}.',
      ),
      kmr: lines(
        'سلاڤ {name}، تشتەکێ نوی ل {business} مە هەیە: {service} ✨',
        '',
        'بۆ گرتنا نۆرێ یان پرسیارێ، پەیوەندیێ ب مە بکە ل سەر {phone}.',
      ),
    },
    vars: ['name', 'business', 'service', 'phone'],
    tags: ['salon', 'clinic', 'services'],
  },

  // ── code ────────────────────────────────────────────────────────────────
  {
    id: 'code-1',
    category: 'code',
    kind: 'promo',
    title: { en: 'Online promo code', ar: 'كود خصم للتسوّق عبر الإنترنت', ckb: 'کۆدی داشکاندنی ئۆنلاین', kmr: 'کۆدا داشکاندنێ یا ئۆنلاین' },
    text: {
      en: lines(
        'Hi {name} 🎁',
        'Use the code *{code}* at {business} for {discount} off your order.',
        'Valid until {date}.',
        '',
        'Shop here: {link}',
      ),
      ar: lines(
        'مرحباً {name} 🎁',
        'استخدموا الكود *{code}* في {business} واحصلوا على خصم {discount} على طلبكم.',
        'صالح حتى {date}.',
        '',
        'تسوّقوا من هنا: {link}',
      ),
      ckb: lines(
        'سڵاو {name} 🎁',
        'کۆدی *{code}* لە {business} بەکاربهێنە و داشکاندنی {discount} لەسەر داواکارییەکەت وەربگرە.',
        'تا {date} کار دەکات.',
        '',
        'لێرە بکڕە: {link}',
      ),
      kmr: lines(
        'سلاڤ {name} 🎁',
        'کۆدا *{code}* ل {business} بکاربینە و داشکاندنا {discount} ل سەر داخوازیا خۆ وەرگرە.',
        'هەتا {date} کار دکەت.',
        '',
        'ل ڤێرە بکڕە: {link}',
      ),
    },
    vars: ['name', 'code', 'business', 'discount', 'date', 'link'],
    tags: ['online-store', 'coupon'],
  },
  {
    id: 'code-2',
    category: 'code',
    kind: 'promo',
    title: { en: 'Thank-you code', ar: 'كود شكر خاص', ckb: 'کۆدی سوپاس', kmr: 'کۆدا سوپاسیێ' },
    text: {
      en: lines(
        'Thank you for shopping with {business}, {name}!',
        'As a small thank-you, here is your personal code: *{code}*',
        'It gives you {offer} on your next visit, until {date}.',
      ),
      ar: lines(
        'شكراً لتسوّقكم من {business} يا {name}!',
        'تقديراً لكم، هذا كودكم الخاص: *{code}*',
        'يمنحكم {offer} في زيارتكم القادمة، حتى {date}.',
      ),
      ckb: lines(
        'سوپاس بۆ کڕینت لە {business}، {name}!',
        'وەک سوپاسێکی بچووک، ئەمە کۆدی تایبەتی تۆیە: *{code}*',
        'بەم کۆدە لە سەردانی داهاتووتدا {offer} وەردەگریت، تا {date}.',
      ),
      kmr: lines(
        'سوپاس بۆ کڕینا تە ژ {business}، {name}!',
        'وەک سوپاسیەکا بچووک، ئەڤە کۆدا تە یا تایبەتە: *{code}*',
        'ب ڤێ کۆدێ د سەرەدانا خۆ یا بێت دا {offer} وەردگری، هەتا {date}.',
      ),
    },
    vars: ['business', 'name', 'code', 'offer', 'date'],
    tags: ['shop', 'restaurant', 'thanks', 'coupon'],
  },
  {
    id: 'code-3',
    category: 'code',
    kind: 'promo',
    title: { en: 'Code to show in store', ar: 'كود يُعرض في المتجر', ckb: 'کۆد بۆ پیشاندان لە دوکان', kmr: 'کۆد بۆ نیشاندانێ ل دوکانێ' },
    text: {
      en: lines(
        'Show this message at {business} and mention the code *{code}* to get {offer}.',
        '',
        'Valid until {date} at {address}.',
      ),
      ar: lines(
        'أظهروا هذه الرسالة في {business} واذكروا الكود *{code}* لتحصلوا على {offer}.',
        '',
        'صالح حتى {date} في {address}.',
      ),
      ckb: lines(
        'ئەم نامەیە لە {business} پیشان بدە و کۆدی *{code}* بڵێ بۆ ئەوەی {offer} وەربگریت.',
        '',
        'تا {date} کار دەکات، لە {address}.',
      ),
      kmr: lines(
        'ڤێ پەیامێ ل {business} نیشان بدە و کۆدا *{code}* بێژە دا {offer} وەرگری.',
        '',
        'هەتا {date} کار دکەت، ل {address}.',
      ),
    },
    vars: ['business', 'code', 'offer', 'date', 'address'],
    tags: ['shop', 'cafe', 'restaurant', 'coupon'],
  },

  // ── flash ───────────────────────────────────────────────────────────────
  {
    id: 'flash-1',
    category: 'flash',
    kind: 'promo',
    title: { en: 'Today only', ar: 'اليوم فقط', ckb: 'تەنها ئەمڕۆ', kmr: 'تنێ ئەڤرۆ' },
    text: {
      en: lines(
        'Today only at {business} ⚡',
        '{offer}',
        '',
        'The offer ends today at {time}. Find us at {address}.',
      ),
      ar: lines(
        'اليوم فقط في {business} ⚡',
        '{offer}',
        '',
        'ينتهي العرض اليوم الساعة {time}. عنواننا: {address}.',
      ),
      ckb: lines(
        'تەنها ئەمڕۆ لە {business} ⚡',
        '{offer}',
        '',
        'ئۆفەرەکە ئەمڕۆ کاتژمێر {time} کۆتایی دێت. ناونیشانمان: {address}.',
      ),
      kmr: lines(
        'تنێ ئەڤرۆ ل {business} ⚡',
        '{offer}',
        '',
        'ئۆفەر ئەڤرۆ دەمژمێر {time} ب دوماهی دهێت. ناڤونیشانا مە: {address}.',
      ),
    },
    vars: ['business', 'offer', 'time', 'address'],
    tags: ['shop', 'supermarket'],
  },
  {
    id: 'flash-2',
    category: 'flash',
    kind: 'promo',
    title: { en: 'Flash sale announcement', ar: 'إعلان عرض خاطف', ckb: 'ئاگاداری داشکاندنی خێرا', kmr: 'ئاگەهداریا داشکاندنا بلەز' },
    text: {
      en: lines(
        '{name}, save the date ⏰',
        'Flash sale at {business} on {date}, starting at {time}:',
        '{offer}',
        '',
        'It goes live here: {link}',
      ),
      ar: lines(
        '{name}، احفظوا الموعد ⏰',
        'عرض خاطف في {business} يوم {date}، يبدأ الساعة {time}:',
        '{offer}',
        '',
        'سيكون متاحاً هنا: {link}',
      ),
      ckb: lines(
        '{name}، ئەم کاتە لەبیر مەکە ⏰',
        'داشکاندنی خێرا لە {business} لە ڕۆژی {date}، کاتژمێر {time} دەست پێدەکات:',
        '{offer}',
        '',
        'لێرە بەردەست دەبێت: {link}',
      ),
      kmr: lines(
        '{name}، ڤی دەمی ژ بیر نەکە ⏰',
        'داشکاندنا بلەز ل {business} ل ڕۆژا {date}، دەمژمێر {time} دەست پێ دکەت:',
        '{offer}',
        '',
        'ل ڤێرە دێ بەردەست بیت: {link}',
      ),
    },
    vars: ['name', 'business', 'date', 'time', 'offer', 'link'],
    tags: ['online-store'],
  },
  {
    id: 'flash-3',
    category: 'flash',
    kind: 'promo',
    title: { en: 'Last day', ar: 'اليوم الأخير', ckb: 'دوایین ڕۆژ', kmr: 'دوماهیک ڕۆژ' },
    text: {
      en: lines(
        'Last call, {name}!',
        'The {offer} at {business} ends today at {time}.',
        '',
        "There's still time: {link}",
      ),
      ar: lines(
        'فرصة أخيرة يا {name}!',
        'ينتهي عرض {offer} في {business} اليوم الساعة {time}.',
        '',
        'ما زال هناك وقت: {link}',
      ),
      ckb: lines(
        'دوایین دەرفەت {name}!',
        'ئۆفەری {offer} لە {business} ئەمڕۆ کاتژمێر {time} کۆتایی دێت.',
        '',
        'هێشتا کات ماوە: {link}',
      ),
      kmr: lines(
        'دوماهیک دەرفەت {name}!',
        'ئۆفەرا {offer} ل {business} ئەڤرۆ دەمژمێر {time} ب دوماهی دهێت.',
        '',
        'هێشتا دەم مایە: {link}',
      ),
    },
    vars: ['name', 'offer', 'business', 'time', 'link'],
    tags: ['shop', 'online-store'],
  },

  // ── restock ─────────────────────────────────────────────────────────────
  {
    id: 'restock-1',
    category: 'restock',
    kind: 'promo',
    title: { en: 'Back in stock', ar: 'متوفر من جديد', ckb: 'دووبارە بەردەستە', kmr: 'دیسان بەردەستە' },
    text: {
      en: lines(
        'Good news, {name}: {product} is back in stock at {business}.',
        '',
        'Reserve yours here: {link}',
      ),
      ar: lines(
        'خبر سارّ يا {name}، توفّر من جديد في {business}: {product}.',
        '',
        'احجزوا طلبكم من هنا: {link}',
      ),
      ckb: lines(
        'مژدە {name}: {product} دووبارە لە {business} بەردەستە.',
        '',
        'لێرە داوای بکە: {link}',
      ),
      kmr: lines(
        'مزگینی {name}: {product} دیسان ل {business} بەردەستە.',
        '',
        'ل ڤێرە داخواز بکە: {link}',
      ),
    },
    vars: ['name', 'product', 'business', 'link'],
    tags: ['shop', 'online-store'],
  },
  {
    id: 'restock-2',
    category: 'restock',
    kind: 'promo',
    title: { en: 'New stock arrived', ar: 'وصلت بضاعة جديدة', ckb: 'کاڵای نوێ گەیشت', kmr: 'کەلوپەلێن نوی گەهشتن' },
    text: {
      en: lines(
        'New stock has just arrived at {business}: {product} 🧺',
        '',
        "We're open {hours} at {address}. Drop by!",
      ),
      ar: lines(
        'وصلت بضاعة جديدة إلى {business}: {product} 🧺',
        '',
        'نستقبلكم {hours} في {address}. تفضّلوا بزيارتنا!',
      ),
      ckb: lines(
        'کاڵای نوێ گەیشتە {business}: {product} 🧺',
        '',
        'کاتی کارکردن: {hours}، لە {address}. سەردانمان بکەن!',
      ),
      kmr: lines(
        'کەلوپەلێن نوی گەهشتنە {business}: {product} 🧺',
        '',
        'دەمێن کاری: {hours}، ل {address}. سەرەدانا مە بکەن!',
      ),
    },
    vars: ['business', 'product', 'hours', 'address'],
    tags: ['supermarket', 'shop'],
  },
  {
    id: 'restock-3',
    category: 'restock',
    kind: 'promo',
    title: { en: 'Arriving soon', ar: 'يصل قريباً', ckb: 'بەم زووانە دەگات', kmr: 'ب زوویی دگەهیت' },
    text: {
      en: lines(
        'Hi {name}, {product} arrives at {business} on {date}.',
        '',
        "Would you like one? Reply to this message and we'll keep it aside for you.",
      ),
      ar: lines(
        'مرحباً {name}، موعد وصول {product} إلى {business}: {date}.',
        '',
        'هل ترغبون في الحجز؟ ردّوا على هذه الرسالة وسنحجز لكم طلبكم.',
      ),
      ckb: lines(
        'سڵاو {name}، {product} لە ڕۆژی {date} دەگاتە {business}.',
        '',
        'دەتەوێت؟ وەڵامی ئەم نامەیە بدەرەوە و بۆتی هەڵدەگرین.',
      ),
      kmr: lines(
        'سلاڤ {name}، {product} ل ڕۆژا {date} دگەهیتە {business}.',
        '',
        'تە دڤێت؟ بەرسڤا ڤێ پەیامێ بدە و ئەم دێ بۆ تە هەلگرین.',
      ),
    },
    vars: ['name', 'product', 'business', 'date'],
    tags: ['shop', 'electronics', 'pre-order'],
  },

  // ── event ───────────────────────────────────────────────────────────────
  {
    id: 'event-1',
    category: 'event',
    kind: 'promo',
    title: { en: 'Open day invitation', ar: 'دعوة إلى يوم مفتوح', ckb: 'بانگهێشت بۆ ڕۆژی کراوە', kmr: 'ڤەخوەندن بۆ ڕۆژا ڤەکری' },
    text: {
      en: lines(
        "{name}, you're invited 🎉",
        'Join us for an open day at {business} on {date} from {time}.',
        '{offer}',
        '',
        'Where: {address}',
        "Reply to this message to let us know you're coming.",
      ),
      ar: lines(
        '{name}، أنتم مدعوون 🎉',
        'شاركونا اليوم المفتوح في {business} يوم {date} ابتداءً من الساعة {time}.',
        '{offer}',
        '',
        'العنوان: {address}',
        'ردّوا على هذه الرسالة لتأكيد حضوركم.',
      ),
      ckb: lines(
        '{name}، بانگهێشتت دەکەین 🎉',
        'بەشداری ڕۆژی کراوەی {business} بکە لە ڕۆژی {date}، کاتژمێر {time}.',
        '{offer}',
        '',
        'ناونیشان: {address}',
        'وەڵامی ئەم نامەیە بدەرەوە تا بزانین دێیت.',
      ),
      kmr: lines(
        '{name}، ئەم تە ڤەدخوینین 🎉',
        'بەشداریێ د ڕۆژا ڤەکری یا {business} دا بکە، ل ڕۆژا {date}، دەمژمێر {time}.',
        '{offer}',
        '',
        'ناڤونیشان: {address}',
        'بەرسڤا ڤێ پەیامێ بدە دا بزانین تو دێ هێی.',
      ),
    },
    vars: ['name', 'business', 'date', 'time', 'offer', 'address'],
    tags: ['shop', 'school', 'invitation'],
  },
  {
    id: 'event-2',
    category: 'event',
    kind: 'promo',
    title: { en: 'Workshop invitation', ar: 'دعوة إلى ورشة عمل', ckb: 'بانگهێشت بۆ وۆرکشۆپ', kmr: 'ڤەخوەندن بۆ وۆرکشۆپێ' },
    text: {
      en: lines(
        'Join our {service} workshop ✨',
        'Hosted by {business} at {place}',
        '{date}, {time}',
        '',
        'To book a place, message or call {phone}.',
      ),
      ar: lines(
        'شاركونا في ورشة {service} ✨',
        'بتنظيم {business} في {place}',
        '{date}، الساعة {time}',
        '',
        'للحجز راسلونا أو اتصلوا على {phone}.',
      ),
      ckb: lines(
        'بەشداری وۆرکشۆپی {service} بکەن ✨',
        'لەلایەن {business}، لە {place}',
        '{date}، کاتژمێر {time}',
        '',
        'بۆ حیجزکردنی شوێن، نامە بنێرن یان پەیوەندی بکەن بە {phone}.',
      ),
      kmr: lines(
        'بەشداریێ د وۆرکشۆپا {service} دا بکەن ✨',
        'ژ لایێ {business}، ل {place}',
        '{date}، دەمژمێر {time}',
        '',
        'بۆ گرتنا جهەکی، پەیامێ بهنێرن یان پەیوەندیێ ب {phone} بکەن.',
      ),
    },
    vars: ['service', 'business', 'place', 'date', 'time', 'phone'],
    tags: ['training', 'salon', 'school'],
  },
  {
    id: 'event-3',
    category: 'event',
    kind: 'promo',
    title: { en: 'Meet us at the exhibition', ar: 'زورونا في المعرض', ckb: 'لە پێشانگا سەردانمان بکەن', kmr: 'ل پێشانگەهێ سەرەدانا مە بکەن' },
    text: {
      en: lines(
        'Come and meet {business} at {place} on {date}.',
        '',
        "Visit our stand to see {product} up close. We'd be glad to meet you!",
      ),
      ar: lines(
        'نتشرّف بدعوتكم إلى جناح {business} في {place} يوم {date}.',
        '',
        'تعالوا لتشاهدوا {product} عن قرب. يسعدنا لقاؤكم!',
      ),
      ckb: lines(
        'خۆشحاڵ دەبین سەردانی بەشی {business} بکەن لە {place}، لە ڕۆژی {date}.',
        '',
        'وەرن {product} لە نزیکەوە ببینن. بە دیدارتان دڵخۆش دەبین!',
      ),
      kmr: lines(
        'دێ کەیفخۆش بین هوین سەرەدانا ستاندێ {business} بکەن ل {place}، ل ڕۆژا {date}.',
        '',
        'وەرن {product} ژ نێزیک ببینن. ب دیتنا هەوە دلخۆش دبین!',
      ),
    },
    vars: ['business', 'place', 'date', 'product'],
    tags: ['exhibition', 'shop', 'invitation'],
  },

  // ── opening ─────────────────────────────────────────────────────────────
  {
    id: 'opening-1',
    category: 'opening',
    kind: 'promo',
    title: { en: 'Grand opening', ar: 'الافتتاح الكبير', ckb: 'کردنەوەی گەورە', kmr: 'ڤەکرنا مەزن' },
    text: {
      en: lines(
        "We're opening! 🎉",
        '{business} opens its doors on {date} at {address}.',
        '',
        'Opening-day treat: {offer}',
        'Come and celebrate with us!',
      ),
      ar: lines(
        'افتتاح {business} 🎉',
        'نفتح أبوابنا يوم {date} في {address}.',
        '',
        'عرض يوم الافتتاح: {offer}',
        'شاركونا الاحتفال!',
      ),
      ckb: lines(
        'کردنەوەی {business} 🎉',
        'لە ڕۆژی {date} دەرگاکانمان دەکەینەوە، لە {address}.',
        '',
        'ئۆفەری ڕۆژی کردنەوە: {offer}',
        'وەرن لەگەڵمان ئاهەنگ بگێڕن!',
      ),
      kmr: lines(
        'ڤەکرنا {business} 🎉',
        'ل ڕۆژا {date} دەرگەهێن خۆ ڤەدکەین، ل {address}.',
        '',
        'ئۆفەرا ڕۆژا ڤەکرنێ: {offer}',
        'وەرن دا پێکڤە ئاهەنگێ بگێڕین!',
      ),
    },
    vars: ['business', 'date', 'address', 'offer'],
    tags: ['shop', 'restaurant', 'cafe'],
  },
  {
    id: 'opening-2',
    category: 'opening',
    kind: 'promo',
    title: { en: 'New branch', ar: 'فرع جديد', ckb: 'لقی نوێ', kmr: 'لقێ نوی' },
    text: {
      en: lines(
        'Now closer to you 📍',
        '{business} has opened a new branch at {address}.',
        '',
        'Open {hours}',
        'Call us: {phone}',
      ),
      ar: lines(
        'صرنا أقرب إليكم 📍',
        'يسعدنا في {business} افتتاح فرعنا الجديد في {address}.',
        '',
        'أوقات الدوام: {hours}',
        'للتواصل: {phone}',
      ),
      ckb: lines(
        'ئێستا لێتانەوە نزیکترین 📍',
        '{business} لقێکی نوێی لە {address} کردەوە.',
        '',
        'کاتی کارکردن: {hours}',
        'پەیوەندی: {phone}',
      ),
      kmr: lines(
        'نوکە ئەم نێزیکی هەوە بووین 📍',
        '{business} لقەکێ نوی ل {address} ڤەکر.',
        '',
        'دەمێن کاری: {hours}',
        'پەیوەندی: {phone}',
      ),
    },
    vars: ['business', 'address', 'hours', 'phone'],
    tags: ['shop', 'restaurant', 'clinic', 'branch'],
  },
  {
    id: 'opening-3',
    category: 'opening',
    kind: 'promo',
    title: { en: 'Reopening', ar: 'إعادة الافتتاح', ckb: 'کردنەوەی دووبارە', kmr: 'ڤەکرنا دووبارە' },
    text: {
      en: lines(
        "We're back, {name}! ✨",
        '{business} reopens on {date} with a fresh new look.',
        '',
        'To celebrate: {offer}',
        "We can't wait to see you.",
      ),
      ar: lines(
        'عدنا من جديد يا {name}! ✨',
        'نعود لاستقبالكم في {business} يوم {date} بحلّة جديدة.',
        '',
        'احتفالاً بذلك: {offer}',
        'بانتظاركم بشوق.',
      ),
      ckb: lines(
        'گەڕاینەوە {name}! ✨',
        '{business} لە ڕۆژی {date} بە شێوەیەکی نوێوە دەکرێتەوە.',
        '',
        'بەم بۆنەیەوە: {offer}',
        'بە پەرۆشەوە چاوەڕێتین.',
      ),
      kmr: lines(
        'ئەم ڤەگەڕیاین {name}! ✨',
        '{business} ل ڕۆژا {date} ب شێوەیەکێ نوی دێ ڤەبیت.',
        '',
        'ب ڤێ بۆنێ: {offer}',
        'ب دلگەرمی چاڤەڕێی تە دکەین.',
      ),
    },
    vars: ['name', 'business', 'date', 'offer'],
    tags: ['shop', 'restaurant', 'salon', 'renovation'],
  },

  // ── appointment ─────────────────────────────────────────────────────────
  {
    id: 'appointment-1',
    category: 'appointment',
    kind: 'service',
    title: { en: 'Appointment reminder', ar: 'تذكير بالموعد', ckb: 'بیرخستنەوەی ژوان', kmr: 'بیرئینانا ژڤانێ' },
    text: {
      en: lines(
        'Hello {name}, this is a reminder of your appointment at {business} on {date} at {time}.',
        '',
        'If you need to change it, please call us on {phone}.',
      ),
      ar: lines(
        'مرحباً {name}، نذكّركم بموعدكم في {business} يوم {date} الساعة {time}.',
        '',
        'إذا احتجتم إلى تغيير الموعد، يُرجى الاتصال بنا على {phone}.',
      ),
      ckb: lines(
        'سڵاو {name}، بیرت دەخەینەوە کە ژوانت لە {business} هەیە لە ڕۆژی {date}، کاتژمێر {time}.',
        '',
        'ئەگەر پێویستت بە گۆڕینی هەیە، تکایە پەیوەندیمان پێوە بکە بە {phone}.',
      ),
      kmr: lines(
        'سلاڤ {name}، ئەم ژڤانا تە ل {business} دئینینە بیرا تە: ل ڕۆژا {date}، دەمژمێر {time}.',
        '',
        'ئەگەر پێدڤی ب گوهۆڕینێ هەبیت، هیڤیە پەیوەندیێ ب مە بکە ل سەر {phone}.',
      ),
    },
    vars: ['name', 'business', 'date', 'time', 'phone'],
    tags: ['clinic', 'salon', 'reminder'],
  },
  {
    id: 'appointment-2',
    category: 'appointment',
    kind: 'service',
    title: { en: 'Appointment confirmed', ar: 'تأكيد الموعد', ckb: 'جێگیرکردنی ژوان', kmr: 'پشتڕاستکرنا ژڤانێ' },
    text: {
      en: lines(
        'Hello {name}, your appointment is confirmed.',
        '',
        '{service} at {business}',
        '{date}, {time}',
        '{address}',
        '',
        'Please arrive a few minutes early. See you soon!',
      ),
      ar: lines(
        'مرحباً {name}، تم تأكيد موعدكم.',
        '',
        '{service} في {business}',
        '{date}، الساعة {time}',
        '{address}',
        '',
        'نرجو الحضور قبل الموعد ببضع دقائق. نراكم قريباً!',
      ),
      ckb: lines(
        'سڵاو {name}، ژوانەکەت جێگیر کرا.',
        '',
        '{service} لە {business}',
        '{date}، کاتژمێر {time}',
        '{address}',
        '',
        'تکایە چەند خولەکێک زووتر وەرە. بەم زووانە دەتبینین!',
      ),
      kmr: lines(
        'سلاڤ {name}، ژڤانا تە هاتە پشتڕاستکرن.',
        '',
        '{service} ل {business}',
        '{date}، دەمژمێر {time}',
        '{address}',
        '',
        'هیڤیە چەند خولەکان زووتر وەرە. ب هیڤیا دیتنا تە!',
      ),
    },
    vars: ['name', 'service', 'business', 'date', 'time', 'address'],
    tags: ['clinic', 'salon', 'booking'],
  },
  {
    id: 'appointment-3',
    category: 'appointment',
    kind: 'promo',
    title: { en: 'Openings this week', ar: 'مواعيد متاحة هذا الأسبوع', ckb: 'کاتی بەتاڵ ئەم هەفتەیە', kmr: 'دەمێن ڤالا ڤێ هەفتیێ' },
    text: {
      en: lines(
        'Hi {name}, we have openings this week at {business} for {service}.',
        '',
        'Reply with a day that suits you, or call {phone} to book.',
      ),
      ar: lines(
        'مرحباً {name}، تتوفّر لدينا مواعيد هذا الأسبوع في {business} لخدمة: {service}.',
        '',
        'أرسلوا لنا اليوم المناسب لكم، أو اتصلوا على {phone} للحجز.',
      ),
      ckb: lines(
        'سڵاو {name}، ئەم هەفتەیە کاتی بەتاڵمان لە {business} هەیە بۆ {service}.',
        '',
        'ڕۆژێکی گونجاومان بۆ بنێرە، یان بۆ نۆرە گرتن پەیوەندی بکە بە {phone}.',
      ),
      kmr: lines(
        'سلاڤ {name}، ڤێ هەفتیێ دەمێن ڤالا ل {business} مە هەنە بۆ {service}.',
        '',
        'ڕۆژەکا گونجای بۆ مە بهنێرە، یان بۆ گرتنا نۆرێ پەیوەندیێ ب {phone} بکە.',
      ),
    },
    vars: ['name', 'business', 'service', 'phone'],
    tags: ['salon', 'barber', 'clinic', 'booking'],
  },
  {
    id: 'appointment-4',
    category: 'appointment',
    kind: 'service',
    title: { en: 'Missed appointment', ar: 'موعد فائت', ckb: 'ژوانی لەدەستچوو', kmr: 'ژڤانا ژ دەست چووی' },
    text: {
      en: lines(
        'Hello {name}, we missed you at {business} today.',
        '',
        'Would you like a new time for your {service}? Reply with a day that suits you, or call {phone}.',
      ),
      ar: lines(
        'مرحباً {name}، افتقدناكم اليوم في {business}.',
        '',
        'هل تودّون حجز موعد جديد من أجل {service}؟ أرسلوا لنا اليوم المناسب لكم أو اتصلوا على {phone}.',
      ),
      ckb: lines(
        'سڵاو {name}، ئەمڕۆ لە {business} چاوەڕێمان دەکردیت.',
        '',
        'دەتەوێت کاتێکی نوێ بۆ {service} دیاری بکەین؟ ڕۆژێکی گونجاومان بۆ بنێرە یان پەیوەندی بکە بە {phone}.',
      ),
      kmr: lines(
        'سلاڤ {name}، ئەڤرۆ ل {business} مە چاڤەڕێیا تە دکر.',
        '',
        'تە دڤێت دەمەکێ نوی بۆ {service} دیار بکەین؟ ڕۆژەکا گونجای بۆ مە بهنێرە یان پەیوەندیێ ب {phone} بکە.',
      ),
    },
    vars: ['name', 'business', 'service', 'phone'],
    tags: ['clinic', 'salon', 'booking'],
  },

  // ── followup ────────────────────────────────────────────────────────────
  {
    id: 'followup-1',
    category: 'followup',
    kind: 'service',
    title: { en: 'After a purchase', ar: 'بعد الشراء', ckb: 'دوای کڕین', kmr: 'پشتی کڕینێ' },
    text: {
      en: lines(
        'Hello {name}, thank you for buying {product} from {business}.',
        '',
        "How are you finding it? If you have a question or something isn't right, just reply here and we'll help.",
      ),
      ar: lines(
        'مرحباً {name}، شكراً لشرائكم {product} من {business}.',
        '',
        'كيف كانت تجربتكم؟ إن كان لديكم أي سؤال أو ملاحظة، ردّوا هنا وسنساعدكم بكل سرور.',
      ),
      ckb: lines(
        'سڵاو {name}، سوپاس بۆ کڕینی {product} لە {business}.',
        '',
        'چۆنە بەلاتەوە؟ ئەگەر پرسیارێکت هەیە یان شتێک باش نییە، لێرە وەڵام بدەرەوە و یارمەتیت دەدەین.',
      ),
      kmr: lines(
        'سلاڤ {name}، سوپاس بۆ کڕینا {product} ژ {business}.',
        '',
        'تە چاوا دیت؟ ئەگەر پرسیارەک تە هەبیت یان تشتەک نە باش بیت، ل ڤێرە بەرسڤێ بدە و ئەم دێ هاریکاریا تە کەین.',
      ),
    },
    vars: ['name', 'product', 'business'],
    tags: ['shop', 'online-store', 'electronics'],
  },
  {
    id: 'followup-2',
    category: 'followup',
    kind: 'service',
    title: { en: 'After a visit', ar: 'بعد الزيارة', ckb: 'دوای سەردان', kmr: 'پشتی سەرەدانێ' },
    text: {
      en: lines(
        'Thank you for visiting {business} today, {name}.',
        '',
        "We hope you're happy with your {service}. If anything isn't quite right, reply to this message and we'll look into it straight away.",
      ),
      ar: lines(
        'شكراً لزيارتكم {business} اليوم يا {name}.',
        '',
        'نتمنى أن تكون خدمة {service} قد نالت رضاكم. وإن كانت لديكم أي ملاحظة، ردّوا على هذه الرسالة وسنهتم بها فوراً.',
      ),
      ckb: lines(
        'سوپاس بۆ سەردانەکەی ئەمڕۆت بۆ {business}، {name}.',
        '',
        'هیوادارین لە {service} ڕازی بیت. ئەگەر هەر تێبینییەکت هەیە، وەڵامی ئەم نامەیە بدەرەوە و یەکسەر بەدوایدا دەچین.',
      ),
      kmr: lines(
        'سوپاس بۆ سەرەدانا تە یا ئەڤرۆ بۆ {business}، {name}.',
        '',
        'هیڤیدارین تو ژ {service} ڕازی بی. ئەگەر هەر تێبینیەک تە هەبیت، بەرسڤا ڤێ پەیامێ بدە و ئەم دێ ب لەز بەرسڤا تە دەین.',
      ),
    },
    vars: ['business', 'name', 'service'],
    tags: ['salon', 'clinic', 'services'],
  },
  {
    id: 'followup-3',
    category: 'followup',
    kind: 'service',
    title: { en: 'Following up a quote', ar: 'متابعة عرض السعر', ckb: 'بەدواداچوونی نرخنامە', kmr: 'بەدویداچوونا نرخنامێ' },
    text: {
      en: lines(
        "Hello {name}, this is {business}. We're following up on the quote we sent you for {service}.",
        '',
        "Do you have any questions? We're happy to talk it through on {phone}.",
      ),
      ar: lines(
        'مرحباً {name}، معكم {business}. نتابع معكم عرض السعر الذي أرسلناه إليكم بخصوص {service}.',
        '',
        'هل لديكم أي استفسار؟ يسعدنا التحدث معكم على {phone}.',
      ),
      ckb: lines(
        'سڵاو {name}، لە {business} بۆت دەنووسین سەبارەت بەو نرخنامەیەی بۆ {service} بۆمان ناردیت.',
        '',
        'هیچ پرسیارێکت هەیە؟ خۆشحاڵ دەبین لە ڕێگەی {phone} قسەی لەسەر بکەین.',
      ),
      kmr: lines(
        'سلاڤ {name}، ژ {business} بۆ تە دنڤیسین دەربارەی وێ نرخنامێ یا مە بۆ {service} بۆ تە هنارتی.',
        '',
        'چ پرسیار تە هەنە؟ ب کەیفخۆشی دێ ل سەر {phone} دگەل تە ئاخڤین.',
      ),
    },
    vars: ['name', 'business', 'service', 'phone'],
    tags: ['real-estate', 'services', 'quote'],
  },

  // ── review ──────────────────────────────────────────────────────────────
  {
    id: 'review-1',
    category: 'review',
    kind: 'service',
    title: { en: 'Ask for a review', ar: 'طلب تقييم', ckb: 'داوای هەڵسەنگاندن', kmr: 'داخوازا هەلسەنگاندنێ' },
    text: {
      en: lines(
        'Hello {name}, thank you for choosing {business}.',
        '',
        'Could you spare a minute to share your experience? It helps us a lot.',
        '{link}',
      ),
      ar: lines(
        'مرحباً {name}، شكراً لاختياركم {business}.',
        '',
        'هل تتكرّمون بدقيقة لمشاركة تجربتكم؟ رأيكم يساعدنا كثيراً.',
        '{link}',
      ),
      ckb: lines(
        'سڵاو {name}، سوپاس بۆ هەڵبژاردنی {business}.',
        '',
        'دەتوانیت خولەکێک تەرخان بکەیت بۆ ئەوەی ئەزموونەکەت بنووسیت؟ زۆر یارمەتیمان دەدات.',
        '{link}',
      ),
      kmr: lines(
        'سلاڤ {name}، سوپاس بۆ هەلبژارتنا {business}.',
        '',
        'تو دشێی خولەکەکێ تەرخان بکەی دا ئەزموونا خۆ بنڤیسی؟ گەلەک هاریکاریا مە دکەت.',
        '{link}',
      ),
    },
    vars: ['name', 'business', 'link'],
    tags: ['restaurant', 'shop', 'feedback'],
  },
  {
    id: 'review-2',
    category: 'review',
    kind: 'service',
    title: { en: 'Rate your order', ar: 'قيّموا طلبكم', ckb: 'هەڵسەنگاندنی داواکاری', kmr: 'هەلسەنگاندنا داخوازیێ' },
    text: {
      en: lines(
        'Hi {name}, has your order ({product}) from {business} arrived safely?',
        '',
        "We'd be grateful if you rated it here: {link}",
      ),
      ar: lines(
        'مرحباً {name}، هل وصلكم طلبكم ({product}) من {business} بسلام؟',
        '',
        'نكون ممتنّين لو قيّمتموه من هنا: {link}',
      ),
      ckb: lines(
        'سڵاو {name}، ئایا داواکارییەکەت ({product}) لە {business} بە سەلامەتی گەیشت؟',
        '',
        'سوپاسگوزار دەبین ئەگەر لێرە هەڵیبسەنگێنیت: {link}',
      ),
      kmr: lines(
        'سلاڤ {name}، ئەرێ داخوازیا تە ({product}) ژ {business} ب سلامەتی گەهشت؟',
        '',
        'دێ سوپاسدار بین ئەگەر تو ل ڤێرە هەلبسەنگینی: {link}',
      ),
    },
    vars: ['name', 'product', 'business', 'link'],
    tags: ['online-store', 'feedback'],
  },
  {
    id: 'review-3',
    category: 'review',
    kind: 'service',
    title: { en: 'Thanks for a review', ar: 'شكراً على تقييمكم', ckb: 'سوپاس بۆ هەڵسەنگاندن', kmr: 'سوپاس بۆ هەلسەنگاندنێ' },
    text: {
      en: lines(
        'Thank you for your kind words, {name}!',
        '',
        'Your review means a great deal to all of us at {business}. We look forward to seeing you again.',
      ),
      ar: lines(
        'شكراً لكلماتكم الطيبة يا {name}!',
        '',
        'تقييمكم يعني لنا الكثير في {business}، ونتطلع إلى رؤيتكم مجدداً.',
      ),
      ckb: lines(
        'سوپاس بۆ قسە جوانەکانت {name}!',
        '',
        'هەڵسەنگاندنەکەت بۆ هەموومان لە {business} زۆر بەنرخە. بە هیوای دیدارێکی تر.',
      ),
      kmr: lines(
        'سوپاس بۆ گوتنێن تە یێن جوان {name}!',
        '',
        'هەلسەنگاندنا تە بۆ هەمییێن مە ل {business} گەلەک ب بهایە. ب هیڤیا دیتنەکا دی.',
      ),
    },
    vars: ['name', 'business'],
    tags: ['thanks', 'feedback'],
  },

  // ── loyalty ─────────────────────────────────────────────────────────────
  {
    id: 'loyalty-1',
    category: 'loyalty',
    kind: 'service',
    title: { en: 'Points balance', ar: 'رصيد النقاط', ckb: 'ژمارەی خاڵەکان', kmr: 'ژمارا خالان' },
    text: {
      en: lines(
        'Hello {name}, your points balance at {business}: *{points}*',
        '',
        "Use them on your next visit. They're valid until {date}.",
      ),
      ar: lines(
        'مرحباً {name}، رصيد نقاطكم لدى {business}: *{points}*',
        '',
        'استخدموها في زيارتكم القادمة، فهي صالحة حتى {date}.',
      ),
      ckb: lines(
        'سڵاو {name}، ژمارەی خاڵەکانت لە {business}: *{points}*',
        '',
        'لە سەردانی داهاتووتدا بەکاریان بهێنە، تا {date} بەکاردێن.',
      ),
      kmr: lines(
        'سلاڤ {name}، ژمارا خالێن تە ل {business}: *{points}*',
        '',
        'د سەرەدانا خۆ یا بێت دا بکاربینە، هەتا {date} دمینن.',
      ),
    },
    vars: ['name', 'business', 'points', 'date'],
    tags: ['members', 'shop', 'cafe'],
  },
  {
    id: 'loyalty-2',
    category: 'loyalty',
    kind: 'promo',
    title: { en: 'Members-only offer', ar: 'عرض خاص للعملاء الأوفياء', ckb: 'ئۆفەری تایبەت بە کڕیارە بەردەوامەکان', kmr: 'ئۆفەرا تایبەت ب کریارێن بەردەوام' },
    text: {
      en: lines(
        'For our loyal customers only, {name} ⭐',
        '{offer}',
        '',
        'Show this message at {business} before {date}. Thank you for staying with us!',
      ),
      ar: lines(
        'لعملائنا الأوفياء فقط يا {name} ⭐',
        '{offer}',
        '',
        'أظهروا هذه الرسالة في {business} قبل {date}. شكراً لأنكم معنا دائماً!',
      ),
      ckb: lines(
        'تەنها بۆ کڕیارە بەردەوامەکانمان، {name} ⭐',
        '{offer}',
        '',
        'پێش {date} ئەم نامەیە لە {business} پیشان بدە. سوپاس کە هەمیشە لەگەڵمانیت!',
      ),
      kmr: lines(
        'تنێ بۆ کریارێن مە یێن بەردەوام، {name} ⭐',
        '{offer}',
        '',
        'بەری {date} ڤێ پەیامێ ل {business} نیشان بدە. سوپاس کو هەردەم دگەل مە یی!',
      ),
    },
    vars: ['name', 'offer', 'business', 'date'],
    tags: ['members', 'shop', 'cafe'],
  },
  {
    id: 'loyalty-3',
    category: 'loyalty',
    kind: 'service',
    title: { en: 'Points expiring', ar: 'نقاط ستنتهي صلاحيتها', ckb: 'خاڵ بەسەردەچێت', kmr: 'خال ب دوماهی دهێن' },
    text: {
      en: lines(
        'Hello {name}, *{points}* of your points at {business} expire on {date}.',
        '',
        'Drop by before then and use them on your next purchase.',
      ),
      ar: lines(
        'مرحباً {name}، تنتهي صلاحية *{points}* من نقاطكم لدى {business} يوم {date}.',
        '',
        'زورونا قبل ذلك واستخدموها في مشترياتكم القادمة.',
      ),
      ckb: lines(
        'سڵاو {name}، *{points}* لە خاڵەکانت لە {business} لە ڕۆژی {date} بەسەردەچن.',
        '',
        'پێش ئەو ڕۆژە سەردانمان بکە و لە کڕینی داهاتووتدا بەکاریان بهێنە.',
      ),
      kmr: lines(
        'سلاڤ {name}، *{points}* ژ خالێن تە ل {business} ل ڕۆژا {date} ب دوماهی دهێن.',
        '',
        'بەری وی ڕۆژی سەرەدانا مە بکە و د کڕینا خۆ یا بێت دا بکاربینە.',
      ),
    },
    vars: ['name', 'points', 'business', 'date'],
    tags: ['members', 'reminder'],
  },

  // ── birthday ────────────────────────────────────────────────────────────
  {
    id: 'birthday-1',
    category: 'birthday',
    kind: 'greeting',
    title: { en: 'Birthday gift', ar: 'هدية عيد الميلاد', ckb: 'دیاری ڕۆژی لەدایکبوون', kmr: 'دیاریا ڕۆژبوونێ' },
    text: {
      en: lines(
        'Happy birthday, {name}! 🎂',
        'Everyone at {business} wishes you a wonderful year ahead.',
        '',
        'Our gift to you: {offer}, valid until {date}.',
      ),
      ar: lines(
        'كل عام وأنتم بخير يا {name}! 🎂',
        'أسرة {business} تتمنى لكم عاماً جميلاً مليئاً بالسعادة.',
        '',
        'هديتنا لكم: {offer}، صالحة حتى {date}.',
      ),
      ckb: lines(
        'ڕۆژی لەدایکبوونت پیرۆز بێت {name}! 🎂',
        'هەموومان لە {business} ساڵێکی پڕ لە خۆشیت بۆ دەخوازین.',
        '',
        'دیاری ئێمە بۆ تۆ: {offer}، تا {date}.',
      ),
      kmr: lines(
        'ڕۆژبوونا تە پیرۆز بیت {name}! 🎂',
        'هەمی مە ل {business} سالەکا تژی خۆشی بۆ تە دخوازین.',
        '',
        'دیاریا مە بۆ تە: {offer}، هەتا {date}.',
      ),
    },
    vars: ['name', 'business', 'offer', 'date'],
    tags: ['gift', 'shop', 'salon'],
  },
  {
    id: 'birthday-2',
    category: 'birthday',
    kind: 'greeting',
    title: { en: 'Birthday wishes', ar: 'تهنئة بعيد الميلاد', ckb: 'پیرۆزبایی ڕۆژی لەدایکبوون', kmr: 'پیرۆزباهیا ڕۆژبوونێ' },
    text: {
      en: lines(
        'Happy birthday, {name} 🎉',
        'Wishing you good health, happiness and a year full of good news.',
        '',
        'Warm wishes from all of us at {business}.',
      ),
      ar: lines(
        'عيد ميلاد سعيد يا {name} 🎉',
        'نتمنى لكم دوام الصحة والسعادة، وعاماً مليئاً بالأخبار السارّة.',
        '',
        'مع أطيب التمنيات من أسرة {business}.',
      ),
      ckb: lines(
        'ڕۆژی لەدایکبوونت پیرۆز بێت {name} 🎉',
        'تەندروستی و خۆشی و ساڵێکی پڕ لە هەواڵی خۆشت بۆ دەخوازین.',
        '',
        'لەگەڵ باشترین هیواکانی هەموومان لە {business}.',
      ),
      kmr: lines(
        'ڕۆژبوونا تە پیرۆز بیت {name} 🎉',
        'ساخلەمی و کەیفخۆشی و سالەکا تژی مزگینی بۆ تە دخوازین.',
        '',
        'دگەل باشترین هیڤیێن هەمییێن مە ل {business}.',
      ),
    },
    vars: ['name', 'business'],
    tags: ['shop', 'thanks'],
  },
  {
    id: 'birthday-3',
    category: 'birthday',
    kind: 'promo',
    title: { en: 'Birthday month treat', ar: 'عرض شهر الميلاد', ckb: 'ئۆفەری مانگی لەدایکبوون', kmr: 'ئۆفەرا هەیڤا ڕۆژبوونێ' },
    text: {
      en: lines(
        "{name}, it's your birthday month! 🎈",
        'Celebrate with us at {business}: {offer}.',
        '',
        'Book your visit on {phone}.',
      ),
      ar: lines(
        '{name}، إنه شهر ميلادكم! 🎈',
        'احتفلوا معنا في {business}: {offer}.',
        '',
        'احجزوا زيارتكم على {phone}.',
      ),
      ckb: lines(
        '{name}، ئەمە مانگی لەدایکبوونتە! 🎈',
        'لەگەڵمان لە {business} ئاهەنگ بگێڕە: {offer}.',
        '',
        'بۆ حیجزکردن پەیوەندی بکە بە {phone}.',
      ),
      kmr: lines(
        '{name}، ئەڤە هەیڤا ڕۆژبوونا تە یە! 🎈',
        'دگەل مە ل {business} ئاهەنگێ بگێڕە: {offer}.',
        '',
        'بۆ حیجزکرنێ پەیوەندیێ ب {phone} بکە.',
      ),
    },
    vars: ['name', 'business', 'offer', 'phone'],
    tags: ['salon', 'restaurant', 'cafe', 'gift'],
  },

  // ── holiday ─────────────────────────────────────────────────────────────
  {
    id: 'holiday-1',
    category: 'holiday',
    kind: 'greeting',
    title: { en: 'Eid al-Fitr', ar: 'عيد الفطر', ckb: 'جەژنی ڕەمەزان', kmr: 'جەژنا ڕەمەزانێ' },
    text: {
      en: lines(
        'Eid Mubarak! 🌙',
        'May this Eid bring joy, peace and blessings to you and your family.',
        '',
        'With our warmest wishes,',
        '{business}',
      ),
      ar: lines(
        'عيد فطر مبارك! 🌙',
        'كل عام وأنتم بخير، أعاده الله عليكم وعلى أحبّتكم بالخير واليُمن والبركات.',
        '',
        'مع أطيب التهاني،',
        '{business}',
      ),
      ckb: lines(
        'جەژنتان پیرۆز بێت! 🌙',
        'هیوادارین جەژنی ڕەمەزان خۆشی و ئاشتی و بەرەکەت بۆ ئێوە و خێزانەکانتان بهێنێت.',
        '',
        'لەگەڵ گەرمترین پیرۆزباییەکانمان،',
        '{business}',
      ),
      kmr: lines(
        'جەژنا هەوە پیرۆز بیت! 🌙',
        'هیڤیدارین جەژنا ڕەمەزانێ خۆشی و ئاشتی و بەرەکەتێ بۆ هەوە و خێزانێن هەوە بینیت.',
        '',
        'دگەل گەرمترین پیرۆزباهیێن مە،',
        '{business}',
      ),
    },
    vars: ['business'],
    tags: ['eid', 'eid-al-fitr', 'ramadan'],
  },
  {
    id: 'holiday-2',
    category: 'holiday',
    kind: 'greeting',
    title: { en: 'Eid al-Adha', ar: 'عيد الأضحى', ckb: 'جەژنی قوربان', kmr: 'جەژنا قوربانێ' },
    text: {
      en: lines(
        'Eid al-Adha Mubarak 🌙',
        'Wishing you and your loved ones a blessed Eid, full of peace and time together.',
        '',
        'From all of us at {business}',
      ),
      ar: lines(
        'عيد أضحى مبارك 🌙',
        'تقبّل الله منّا ومنكم صالح الأعمال، وكل عام وأنتم وأحبّتكم بخير.',
        '',
        'من أسرة {business}',
      ),
      ckb: lines(
        'جەژنی قوربانتان پیرۆز بێت 🌙',
        'جەژنێکی پڕ لە ئاشتی و بەرەکەت و کۆبوونەوەی خۆشەویستان بۆ ئێوە و ئازیزانتان دەخوازین.',
        '',
        'لە هەموومانەوە لە {business}',
      ),
      kmr: lines(
        'جەژنا قوربانێ ل هەوە پیرۆز بیت 🌙',
        'جەژنەکا تژی ئاشتی و بەرەکەت بۆ هەوە و خۆشتڤیێن هەوە دخوازین.',
        '',
        'ژ هەمییێن مە ل {business}',
      ),
    },
    vars: ['business'],
    tags: ['eid', 'eid-al-adha'],
  },
  {
    id: 'holiday-3',
    category: 'holiday',
    kind: 'greeting',
    title: { en: 'Ramadan Kareem', ar: 'رمضان كريم', ckb: 'ڕەمەزانی پیرۆز', kmr: 'ڕەمەزانا پیرۆز' },
    text: {
      en: lines(
        'Ramadan Kareem 🌙',
        'May this holy month bring you peace, health and blessings.',
        '',
        '{business} wishes you and your family a blessed Ramadan.',
      ),
      ar: lines(
        'رمضان كريم 🌙',
        'أهلّه الله عليكم بالخير والصحة والبركات.',
        '',
        'أسرة {business} تتمنى لكم ولعائلاتكم شهراً مباركاً.',
      ),
      ckb: lines(
        'ڕەمەزانتان پیرۆز بێت 🌙',
        'هیوادارین ئەم مانگە پیرۆزە ئاشتی و تەندروستی و بەرەکەتتان بۆ بهێنێت.',
        '',
        '{business} ڕەمەزانێکی پیرۆز بۆ ئێوە و خێزانەکانتان دەخوازێت.',
      ),
      kmr: lines(
        'ڕەمەزانا هەوە پیرۆز بیت 🌙',
        'هیڤیدارین ئەڤ هەیڤا پیرۆز ئاشتی و ساخلەمی و بەرەکەتێ بۆ هەوە بینیت.',
        '',
        '{business} ڕەمەزانەکا پیرۆز بۆ هەوە و خێزانێن هەوە دخوازیت.',
      ),
    },
    vars: ['business'],
    tags: ['ramadan'],
  },
  {
    id: 'holiday-4',
    category: 'holiday',
    kind: 'greeting',
    title: { en: 'Newroz', ar: 'عيد نوروز', ckb: 'نەورۆز', kmr: 'نەورۆز' },
    text: {
      en: lines(
        'Happy Newroz! 🔥🌷',
        'May the new year bring you light, health and new beginnings.',
        '',
        'Warm wishes from {business}',
      ),
      ar: lines(
        'نوروز سعيد! 🔥🌷',
        'نتمنى أن يحمل لكم العام الجديد النور والصحة وبدايات جميلة.',
        '',
        'مع أطيب الأمنيات من {business}',
      ),
      ckb: lines(
        'نەورۆزتان پیرۆز بێت! 🔥🌷',
        'هیوادارین ساڵی نوێ ڕووناکی و تەندروستی و دەستپێکی جوانتان بۆ بهێنێت.',
        '',
        'لەگەڵ گەرمترین هیواکانی {business}',
      ),
      kmr: lines(
        'نەورۆزا هەوە پیرۆز بیت! 🔥🌷',
        'هیڤیدارین سالا نوی ڕۆناهی و ساخلەمی و دەستپێکێن جوان بۆ هەوە بینیت.',
        '',
        'دگەل باشترین هیڤیێن {business}',
      ),
    },
    vars: ['business'],
    tags: ['newroz', 'new-year'],
  },
  {
    id: 'holiday-5',
    category: 'holiday',
    kind: 'greeting',
    title: { en: 'New Year', ar: 'رأس السنة', ckb: 'ساڵی نوێ', kmr: 'سالا نوی' },
    text: {
      en: lines(
        'Happy New Year, {name}! ✨',
        'Thank you for being with us this year. We wish you a new year full of health, success and good moments.',
        '',
        '{business}',
      ),
      ar: lines(
        'سنة جديدة سعيدة يا {name}! ✨',
        'شكراً لأنكم كنتم معنا هذا العام، ونتمنى لكم عاماً جديداً مليئاً بالصحة والنجاح واللحظات الجميلة.',
        '',
        '{business}',
      ),
      ckb: lines(
        'ساڵی نوێت پیرۆز بێت {name}! ✨',
        'سوپاس کە ئەمساڵ لەگەڵمان بوویت. ساڵێکی نوێی پڕ لە تەندروستی و سەرکەوتن و ساتی خۆشت بۆ دەخوازین.',
        '',
        '{business}',
      ),
      kmr: lines(
        'سالا نوی ل تە پیرۆز بیت {name}! ✨',
        'سوپاس کو ڤێ سالێ دگەل مە بووی. سالەکا نوی یا تژی ساخلەمی و سەرکەفتن و دەمێن خۆش بۆ تە دخوازین.',
        '',
        '{business}',
      ),
    },
    vars: ['name', 'business'],
    tags: ['new-year', 'thanks'],
  },
  {
    id: 'holiday-6',
    category: 'holiday',
    kind: 'greeting',
    title: { en: "Mother's Day", ar: 'عيد الأم', ckb: 'ڕۆژی دایک', kmr: 'ڕۆژا دایکێ' },
    text: {
      en: lines(
        "Happy Mother's Day 💐",
        'To every mother: thank you for your love, your patience and everything you give.',
        '',
        'With love and respect,',
        '{business}',
      ),
      ar: lines(
        'عيد أمّ سعيد 💐',
        'تحية لكل أمّ: شكراً لحبّها وصبرها وعطائها الذي لا ينتهي.',
        '',
        'مع كل الحب والتقدير،',
        '{business}',
      ),
      ckb: lines(
        'ڕۆژی دایک پیرۆز بێت 💐',
        'بۆ هەموو دایکێک: سوپاس بۆ خۆشەویستی و ئارامگرتن و هەموو ئەو شتانەی دەیبەخشن.',
        '',
        'بە خۆشەویستی و ڕێزەوە،',
        '{business}',
      ),
      kmr: lines(
        'ڕۆژا دایکێ پیرۆز بیت 💐',
        'بۆ هەمی دایکان: سوپاس بۆ ڤیان و سەبرا هەوە و هەمی تشتێن هوین ددەن.',
        '',
        'ب ڤیان و ڕێز،',
        '{business}',
      ),
    },
    vars: ['business'],
    tags: ['mothers-day'],
  },
  {
    id: 'holiday-7',
    category: 'holiday',
    kind: 'greeting',
    title: { en: "Teachers' Day", ar: 'يوم المعلم', ckb: 'ڕۆژی مامۆستا', kmr: 'ڕۆژا مامۆستایان' },
    text: {
      en: lines(
        "Happy Teachers' Day 📚",
        'To every teacher who lights the way: thank you for your patience, your knowledge and your care.',
        '',
        'With gratitude,',
        '{business}',
      ),
      ar: lines(
        'كل عام وأنتم بخير في يوم المعلّم 📚',
        'إلى كل معلّم ومعلّمة يضيئون الطريق: شكراً على صبركم وعلمكم وعطائكم.',
        '',
        'مع خالص التقدير،',
        '{business}',
      ),
      ckb: lines(
        'ڕۆژی مامۆستا پیرۆز بێت 📚',
        'بۆ هەموو ئەو مامۆستایانەی ڕێگا ڕووناک دەکەنەوە: سوپاس بۆ ئارامی و زانست و گرنگیپێدانتان.',
        '',
        'بە سوپاس و ڕێزەوە،',
        '{business}',
      ),
      kmr: lines(
        'ڕۆژا مامۆستایان پیرۆز بیت 📚',
        'بۆ هەمی وان مامۆستایێن ڕێکێ ڕۆن دکەن: سوپاس بۆ سەبر و زانین و گرنگیپێدانا هەوە.',
        '',
        'ب سوپاس و ڕێز،',
        '{business}',
      ),
    },
    vars: ['business'],
    tags: ['teachers-day', 'school'],
  },
  {
    id: 'holiday-8',
    category: 'holiday',
    kind: 'greeting',
    title: { en: 'Thank you', ar: 'شكر وتقدير', ckb: 'سوپاس و پێزانین', kmr: 'سوپاس و پێزانین' },
    text: {
      en: lines(
        'Thank you, {name} 🌷',
        "Your trust and support mean a great deal to everyone at {business}. We're glad to have you with us.",
      ),
      ar: lines(
        'شكراً لكم يا {name} 🌷',
        'ثقتكم ودعمكم يعنيان الكثير لفريق {business}، ويسعدنا أنكم معنا.',
      ),
      ckb: lines(
        'سوپاس {name} 🌷',
        'متمانە و پشتگیریت بۆ هەموومان لە {business} زۆر بەنرخە. خۆشحاڵین کە لەگەڵمانیت.',
      ),
      kmr: lines(
        'سوپاس {name} 🌷',
        'باوەری و پشتەڤانیا تە بۆ هەمییێن مە ل {business} گەلەک ب بهایە. کەیفخۆشین کو تو دگەل مە یی.',
      ),
    },
    vars: ['name', 'business'],
    tags: ['thanks'],
  },
  {
    id: 'holiday-9',
    category: 'holiday',
    kind: 'greeting',
    title: { en: 'Christmas', ar: 'عيد الميلاد المجيد', ckb: 'کریسمس', kmr: 'کریسمس' },
    text: {
      en: lines(
        'Merry Christmas 🎄',
        'Wishing you and your family peace, joy and a blessed season.',
        '',
        'With warm wishes from {business}',
      ),
      ar: lines(
        'ميلاد مجيد 🎄',
        'نتمنى لكم ولعائلاتكم أياماً مليئة بالسلام والفرح والبركة.',
        '',
        'مع أطيب التمنيات من {business}',
      ),
      ckb: lines(
        'کریسمستان پیرۆز بێت 🎄',
        'ئاشتی و خۆشی و بەرەکەت بۆ ئێوە و خێزانەکانتان دەخوازین.',
        '',
        'لەگەڵ گەرمترین هیواکانی {business}',
      ),
      kmr: lines(
        'کریسمسا هەوە پیرۆز بیت 🎄',
        'ئاشتی و کەیفخۆشی و بەرەکەتێ بۆ هەوە و خێزانێن هەوە دخوازین.',
        '',
        'دگەل باشترین هیڤیێن {business}',
      ),
    },
    vars: ['business'],
    tags: ['christmas', 'new-year'],
  },
];
