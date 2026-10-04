import type { Template } from './whatsappbulktypes';

/**
 * The second half of the ready messages (docs/WA.md, docs/wa/briefs/templates-b.md): the thirteen
 * categories a business sends to people who are already its customers — orders, deliveries,
 * payments, codes, notices — plus the gentle promotional ones that follow from them (a cart left
 * behind, a new dish, a listing, a friend brought along). `whatsapptemplates.ts` merges this list
 * after `TEMPLATES_A`; the categories' titles and icons live there.
 *
 * How it is written, and why:
 *
 * - **Nothing factual is invented.** Every price, date, time, amount, address, code and offer is a
 *   placeholder the sender fills (or a column of their file fills per person). The texts carry no
 *   digits at all, so a template can never promise a number the sender did not type; a test holds it.
 * - **Service messages are plain and exact** (`order`, `delivery`, `payment`, `verify`, `notice`,
 *   `health`, `survey`, the course reminders): who, what, when, what to do next. No emoji in a code,
 *   a notice, a payment or a clinic's message: they are read as official, and a smiley next to an
 *   amount owed reads as a joke. Payment reminders are polite and assume good faith ("if you have
 *   already paid, thank you"); nothing threatens. Clinic messages never diagnose, never hint at what
 *   a result says, and never hurry anyone with fear.
 * - **Codes look like codes** (`verify`): no marketing, no emoji, the code and one instruction, and
 *   the same "do not share this code with anyone" sentence in every one of them, word for word in
 *   each language, so a person learns to recognise it. The brief's sample said "expires in {days}
 *   minutes"; a field labelled *days* that holds minutes would be filled wrongly, so these say
 *   "valid until {time}" instead (docs/wa/templates.md).
 * - **Promotions are warm and short**, with one thing to do. They carry no opt-out line: the engine
 *   adds a translated one to every `promo` (whatsappcampaign.ts). No false pressure: no "last
 *   chance", no "only a few left" — a cart gets one nudge, not a countdown.
 * - **Four languages written, not translated word for word.** Arabic is friendly Modern Standard
 *   (مرحباً, شكراً لك), not dialect. Sorani (`ckb`) and Badini (`kmr`, Arabic script, as Duhok writes
 *   it) follow the words the app's own interface already uses — ckb ناونیشان, وشەی تێپەڕ, نامە; kmr
 *   ناڤونیشان, پەیڤا بۆرینێ, بها, دەمێن کارکرنێ — and say things the way a shopkeeper in Erbil or
 *   Duhok would. A placeholder never carries a Kurdish suffix (`{business}ـەوە`): the sentence is
 *   turned so the value stands alone, whatever it turns out to be. The strings a native reader
 *   should check are listed in docs/wa/review-needed.md.
 * - `vars` lists exactly the placeholders the texts use, in the order the English meets them; the
 *   four languages use the same set (`test/wa-templates-b.test.mjs`).
 */
export const TEMPLATES_B: readonly Template[] = [
  // ── order ──────────────────────────────────────────────────────────────
  {
    id: 'order-1', category: 'order', kind: 'service',
    vars: ['name', 'business', 'code', 'phone'],
    tags: ['shop', 'online', 'restaurant', 'received'],
    title: { en: 'Order received', ar: 'تم استلام الطلب', ckb: 'داواکاری گەیشت', kmr: 'داخوازی گەهشت' },
    text: {
      en: 'Hello {name}, thank you for your order from {business} 🛍️\nWe have received it and will confirm it shortly.\nYour order number: {code}\nAny questions? Call us on {phone}.',
      ar: 'مرحباً {name}، شكراً لطلبك من {business} 🛍️\nلقد استلمنا طلبك وسنؤكده لك قريباً.\nرقم طلبك: {code}\nلأي استفسار، اتصل بنا على {phone}.',
      ckb: 'سڵاو {name}، سوپاس بۆ داواکارییەکەت لە {business} 🛍️\nداواکارییەکەت گەیشتە دەستمان و بەم زووانە پشتڕاستی دەکەینەوە.\nژمارەی داواکارییەکەت: {code}\nبۆ هەر پرسیارێک پەیوەندیمان پێوە بکە: {phone}',
      kmr: 'سلاڤ {name}، سوپاس بۆ داخوازیا تە ژ {business} 🛍️\nداخوازیا تە گەهشتە مە و ب زوویی دێ وێ پشتراست کەین.\nژمارا داخوازیا تە: {code}\nبۆ هەر پرسیارەکێ پەیوەندیێ دگەل مە بکە: {phone}',
    },
  },
  {
    id: 'order-2', category: 'order', kind: 'service',
    vars: ['name', 'code', 'product', 'price'],
    tags: ['shop', 'online', 'confirmed'],
    title: { en: 'Order confirmed', ar: 'تأكيد الطلب', ckb: 'پشتڕاستکردنەوەی داواکاری', kmr: 'پشتراستکرنا داخوازیێ' },
    text: {
      en: 'Hi {name}, your order {code} is confirmed ✅\n{product}\nTotal: {price}\nWe will let you know as soon as it is on its way.',
      ar: 'مرحباً {name}، تم تأكيد طلبك رقم {code} ✅\n{product}\nالمجموع: {price}\nسنخبرك فور خروجه للتوصيل.',
      ckb: 'سڵاو {name}، داواکارییەکەت ({code}) پشتڕاست کرایەوە ✅\n{product}\nنرخی گشتی: {price}\nهەر کە نێردرا ئاگادارت دەکەینەوە.',
      kmr: 'سلاڤ {name}، داخوازیا تە ({code}) هاتە پشتراستکرن ✅\n{product}\nبهایێ گشتی: {price}\nهەر دەمێ هاتە هنارتن، دێ تە ئاگەهدار کەین.',
    },
  },
  {
    id: 'order-3', category: 'order', kind: 'service',
    vars: ['name', 'code', 'business', 'time'],
    tags: ['restaurant', 'shop', 'preparing'],
    title: { en: 'Order being prepared', ar: 'الطلب قيد التحضير', ckb: 'داواکاری ئامادە دەکرێت', kmr: 'داخوازی دهێتە ئامادەکرن' },
    text: {
      en: 'Good news, {name}! Your order {code} is being prepared now at {business}.\nWe expect it to be ready at {time}, and we will message you as soon as it is.',
      ar: 'خبر سار يا {name}! طلبك رقم {code} قيد التحضير الآن لدى {business}.\nنتوقع أن يكون جاهزاً الساعة {time}، وسنرسل إليك رسالة حالما يجهز.',
      ckb: 'هەواڵێکی خۆش {name}! داواکارییەکەت ({code}) ئێستا لە {business} ئامادە دەکرێت.\nپێشبینی دەکەین کاتژمێر {time} ئامادە بێت، و هەر کە ئامادە بوو نامەت بۆ دەنێرین.',
      kmr: 'مزگینی {name}! داخوازیا تە ({code}) نوکە ل {business} دهێتە ئامادەکرن.\nهیڤیدارین دەمژمێر {time} ئامادە بیت، و هەر دەمێ ئامادە بوو دێ نامەکێ بۆ تە هنێرین.',
    },
  },
  {
    id: 'order-4', category: 'order', kind: 'service',
    vars: ['name', 'code', 'business', 'address', 'hours'],
    tags: ['shop', 'pickup', 'restaurant'],
    title: { en: 'Ready for pickup', ar: 'جاهز للاستلام', ckb: 'ئامادەیە بۆ وەرگرتن', kmr: 'ئامادەیە بۆ وەرگرتنێ' },
    text: {
      en: 'Hi {name}, your order {code} is ready for pickup at {business} 🛍️\nAddress: {address}\nOpening hours: {hours}\nPlease show this message when you collect it.',
      ar: 'مرحباً {name}، طلبك رقم {code} جاهز للاستلام من {business} 🛍️\nالعنوان: {address}\nأوقات العمل: {hours}\nيُرجى إبراز هذه الرسالة عند الاستلام.',
      ckb: 'سڵاو {name}، داواکارییەکەت ({code}) ئامادەیە و دەتوانیت لە {business} وەری بگریت 🛍️\nناونیشان: {address}\nکاتەکانی کارکردن: {hours}\nتکایە لە کاتی وەرگرتندا ئەم نامەیە پیشان بدە.',
      kmr: 'سلاڤ {name}، داخوازیا تە ({code}) ئامادەیە و تو دشێی ژ {business} وەرگری 🛍️\nناڤونیشان: {address}\nدەمێن کارکرنێ: {hours}\nهیڤییە دەمێ وەرگرتنێ ڤێ نامێ نیشان بدە.',
    },
  },

  // ── delivery ───────────────────────────────────────────────────────────
  {
    id: 'delivery-1', category: 'delivery', kind: 'service',
    vars: ['name', 'code', 'date', 'time'],
    tags: ['online', 'shop', 'courier', 'tracking'],
    title: { en: 'On its way', ar: 'في الطريق إليك', ckb: 'لە ڕێگادایە', kmr: 'د ڕێکێ دایە' },
    text: {
      en: 'Hi {name}, your order {code} is on its way 🚚\nExpected delivery: {date}, around {time}.\nPlease keep your phone nearby in case our driver needs to call you.',
      ar: 'مرحباً {name}، طلبك رقم {code} في الطريق إليك 🚚\nموعد التوصيل المتوقع: {date}، نحو الساعة {time}.\nيُرجى إبقاء هاتفك قريباً منك، فقد يتصل بك مندوب التوصيل.',
      ckb: 'سڵاو {name}، داواکارییەکەت ({code}) لە ڕێگادایە بۆت 🚚\nکاتی گەیاندنی چاوەڕوانکراو: {date}، نزیکەی کاتژمێر {time}.\nتکایە مۆبایلەکەت لە نزیک خۆت بێت، لەوانەیە کارمەندی گەیاندنمان پەیوەندیت پێوە بکات.',
      kmr: 'سلاڤ {name}، داخوازیا تە ({code}) د ڕێکێ دایە بۆ تە 🚚\nدەمێ گەهاندنێ یێ چاڤەڕێکری: {date}، نێزیکی دەمژمێر {time}.\nهیڤییە مۆبایلا خۆ ل نێزیک خۆ بهێلە، بەلکی کارمەندێ گەهاندنێ پەیوەندیێ دگەل تە بکەت.',
    },
  },
  {
    id: 'delivery-2', category: 'delivery', kind: 'service',
    vars: ['name', 'code', 'business'],
    tags: ['online', 'shop', 'delivered'],
    title: { en: 'Delivered', ar: 'تم التوصيل', ckb: 'گەیەندرا', kmr: 'هاتە گەهاندن' },
    text: {
      en: 'Hi {name}, your order {code} has been delivered 📦\nThank you for shopping with {business}! If anything is not right, just reply to this message and we will help.',
      ar: 'مرحباً {name}، تم توصيل طلبك رقم {code} 📦\nشكراً لتسوقك من {business}! وإن لم يكن كل شيء على ما يرام، فما عليك إلا الرد على هذه الرسالة وسنساعدك.',
      ckb: 'سڵاو {name}، داواکارییەکەت ({code}) گەیەندرا 📦\nسوپاس بۆ بازاڕکردنت لە {business}! ئەگەر هەر کێشەیەک هەبوو، تەنها وەڵامی ئەم نامەیە بدەرەوە و یارمەتیت دەدەین.',
      kmr: 'سلاڤ {name}، داخوازیا تە ({code}) هاتە گەهاندن 📦\nسوپاس بۆ کڕینا تە ژ {business}! ئەگەر هەر ئاریشەیەک هەبیت، تنێ بەرسڤا ڤێ نامێ بدە و دێ هاریکاریا تە کەین.',
    },
  },
  {
    id: 'delivery-3', category: 'delivery', kind: 'service',
    vars: ['name', 'code', 'phone'],
    tags: ['online', 'courier', 'missed'],
    title: { en: 'Missed delivery', ar: 'تعذر التوصيل', ckb: 'گەیاندن سەری نەگرت', kmr: 'گەهاندن سەرنەکەفت' },
    text: {
      en: 'Hi {name}, we tried to deliver your order {code} today but could not reach you.\nPlease reply with a day and time that suit you, or call us on {phone}, and we will bring it again.',
      ar: 'مرحباً {name}، حاولنا اليوم توصيل طلبك رقم {code} لكن لم نتمكن من الوصول إليك.\nيُرجى الرد بيوم ووقت يناسبانك، أو الاتصال بنا على {phone}، وسنعيد توصيله إليك.',
      ckb: 'سڵاو {name}، ئەمڕۆ هەوڵمان دا داواکارییەکەت ({code}) بگەیەنین، بەڵام نەمانتوانی پەیوەندیت پێوە بکەین.\nتکایە ڕۆژ و کاتێکی گونجاو بۆمان بنووسە، یان پەیوەندیمان پێوە بکە: {phone}، و دووبارە بۆتی دەهێنینەوە.',
      kmr: 'سلاڤ {name}، ئەڤرۆ مە هەول دا داخوازیا تە ({code}) بگەهینین، بەلێ مە نەشیا پەیوەندیێ دگەل تە بکەین.\nهیڤییە ڕۆژ و دەمەکێ گونجای بۆ مە بنڤیسە، یان پەیوەندیێ دگەل مە بکە: {phone}، و دێ جارەکا دی بۆ تە ئینین.',
    },
  },
  {
    id: 'delivery-4', category: 'delivery', kind: 'service',
    vars: ['name', 'code', 'date', 'time'],
    tags: ['online', 'courier', 'reschedule'],
    title: { en: 'Delivery rescheduled', ar: 'موعد توصيل جديد', ckb: 'کاتی نوێی گەیاندن', kmr: 'دەمێ نوی یێ گەهاندنێ' },
    text: {
      en: 'Hi {name}, the delivery of your order {code} is now set for {date}, around {time}.\nIf that time does not suit you, reply to this message and we will find another.',
      ar: 'مرحباً {name}، حددنا موعداً جديداً لتوصيل طلبك رقم {code}: {date}، نحو الساعة {time}.\nإن لم يناسبك هذا الموعد، رد على هذه الرسالة وسنحدد موعداً آخر.',
      ckb: 'سڵاو {name}، کاتی گەیاندنی داواکارییەکەت ({code}) گۆڕدرا بۆ {date}، نزیکەی کاتژمێر {time}.\nئەگەر ئەم کاتە بۆت گونجاو نییە، وەڵامی ئەم نامەیە بدەرەوە و کاتێکی تر دیاری دەکەین.',
      kmr: 'سلاڤ {name}، دەمێ گەهاندنا داخوازیا تە ({code}) هاتە گوهۆڕین بۆ {date}، نێزیکی دەمژمێر {time}.\nئەگەر ئەڤ دەمە بۆ تە باش نەبیت، بەرسڤا ڤێ نامێ بدە و دێ دەمەکێ دی دیار کەین.',
    },
  },

  // ── payment ────────────────────────────────────────────────────────────
  {
    id: 'payment-1', category: 'payment', kind: 'service',
    vars: ['name', 'code', 'business', 'price', 'date', 'link'],
    tags: ['invoice', 'bill', 'shop', 'services'],
    title: { en: 'Invoice', ar: 'فاتورة', ckb: 'پسوولە', kmr: 'پسوولە' },
    text: {
      en: 'Hello {name},\nYour invoice {code} from {business} is ready.\nAmount: {price}\nDue date: {date}\nYou can view it here: {link}\nThank you for your business.',
      ar: 'مرحباً {name}،\nفاتورتك رقم {code} من {business} جاهزة.\nالمبلغ: {price}\nتاريخ الاستحقاق: {date}\nيمكنك الاطلاع عليها هنا: {link}\nشكراً لتعاملك معنا.',
      ckb: 'سڵاو {name}،\nپسوولەکەت ({code}) لە {business} ئامادەیە.\nبڕی پارە: {price}\nدوا وادەی پارەدان: {date}\nلێرە دەتوانیت بیبینیت: {link}\nسوپاس بۆ مامەڵەکردنت لەگەڵمان.',
      kmr: 'سلاڤ {name}،\nپسوولا تە ({code}) ژ {business} ئامادەیە.\nبڕێ پارەی: {price}\nدوماهیک دەمێ پارەدانێ: {date}\nل ڤێرە تو دشێی ببینی: {link}\nسوپاس بۆ مامەلەکرنا تە دگەل مە.',
    },
  },
  {
    id: 'payment-2', category: 'payment', kind: 'service',
    vars: ['name', 'price', 'code', 'business'],
    tags: ['receipt', 'paid', 'thanks'],
    title: { en: 'Payment received', ar: 'تم استلام الدفعة', ckb: 'پارەکە گەیشت', kmr: 'پارە گەهشت' },
    text: {
      en: 'Hello {name}, we have received your payment of {price} for invoice {code}.\nThank you! This message confirms your payment to {business}.',
      ar: 'مرحباً {name}، استلمنا دفعتك بقيمة {price} عن الفاتورة رقم {code}.\nشكراً لك! هذه الرسالة تأكيد لدفعتك إلى {business}.',
      ckb: 'سڵاو {name}، پارەدانەکەت بە بڕی {price} بۆ پسوولەی ({code}) گەیشتە دەستمان.\nسوپاس! ئەم نامەیە پشتڕاستکردنەوەی پارەدانەکەتە بۆ {business}.',
      kmr: 'سلاڤ {name}، پارەدانا تە ب بڕێ {price} بۆ پسوولا ({code}) گەهشتە مە.\nسوپاس! ئەڤ نامە پشتراستکرنا پارەدانا تە یە بۆ {business}.',
    },
  },
  {
    id: 'payment-3', category: 'payment', kind: 'service',
    vars: ['name', 'code', 'price', 'date', 'phone'],
    tags: ['reminder', 'invoice', 'due'],
    title: { en: 'Friendly payment reminder', ar: 'تذكير ودي بالدفع', ckb: 'بیرخستنەوەی دۆستانەی پارەدان', kmr: 'بیرئینانا دۆستانە یا پارەدانێ' },
    text: {
      en: 'Hello {name}, this is a friendly reminder:\nInvoice {code} for {price}\nDue date: {date}\nIf you have already paid, please ignore this message, and thank you.\nAny questions? We are happy to help on {phone}.',
      ar: 'مرحباً {name}، هذا تذكير ودي:\nالفاتورة رقم {code} بقيمة {price}\nتاريخ الاستحقاق: {date}\nإن كنت قد سددتها، فتجاهل هذه الرسالة مع شكرنا لك.\nلأي استفسار، يسعدنا مساعدتك على {phone}.',
      ckb: 'سڵاو {name}، ئەمە بیرخستنەوەیەکی دۆستانەیە:\nپسوولەی ({code}) بە بڕی {price}\nدوا وادەی پارەدان: {date}\nئەگەر پێشتر پارەکەت داوە، ئەم نامەیە پشتگوێ بخە و سوپاست دەکەین.\nبۆ هەر پرسیارێک بە خۆشحاڵییەوە یارمەتیت دەدەین: {phone}',
      kmr: 'سلاڤ {name}، ئەڤە بیرئینانەکا دۆستانەیە:\nپسوولا ({code}) ب بڕێ {price}\nدوماهیک دەمێ پارەدانێ: {date}\nئەگەر تە بەری نوکە پارە دابیت، گوه نەدە ڤێ نامێ و زۆر سوپاس.\nبۆ هەر پرسیارەکێ ب دلخۆشی ڤە هاریکاریا تە دکەین: {phone}',
    },
  },
  {
    id: 'payment-4', category: 'payment', kind: 'service',
    vars: ['name', 'code', 'price', 'date', 'phone'],
    tags: ['overdue', 'invoice', 'unpaid'],
    title: { en: 'Overdue invoice', ar: 'فاتورة متأخرة السداد', ckb: 'پسوولەی نەدراو', kmr: 'پسوولا نەدای' },
    text: {
      en: 'Hello {name},\nOur records show that invoice {code} for {price}, due on {date}, has not been paid yet.\nWe understand that things can be missed. Please arrange the payment at your earliest convenience, or call us on {phone} if you would like to talk it over.\nIf you have already paid, thank you, and please disregard this message.',
      ar: 'مرحباً {name}،\nتُظهر سجلاتنا أن الفاتورة رقم {code} بقيمة {price}، المستحقة بتاريخ {date}، لم تُسدد بعد.\nنتفهم أن هذا قد يفوت أحياناً. نرجو منك ترتيب السداد في أقرب وقت يناسبك، أو الاتصال بنا على {phone} إن أردت أن نتحدث في الأمر.\nإن كنت قد سددتها، فشكراً لك، ونرجو تجاهل هذه الرسالة.',
      ckb: 'سڵاو {name}،\nبەپێی تۆمارەکانمان، پسوولەی ({code}) بە بڕی {price} کە وادەکەی {date} بوو، هێشتا پارەکەی نەدراوە.\nتێدەگەین کە هەندێک جار شتەکان لەبیر دەچن. تکایە لە یەکەم دەرفەتدا پارەکە بدە، یان ئەگەر دەتەوێت قسەی لەسەر بکەین پەیوەندیمان پێوە بکە: {phone}\nئەگەر پێشتر پارەکەت داوە، سوپاس، و تکایە ئەم نامەیە پشتگوێ بخە.',
      kmr: 'سلاڤ {name}،\nل دویڤ تۆمارێن مە، پسوولا ({code}) ب بڕێ {price} یا دەمێ وێ {date} بوو، هێشتا پارەدانا وێ نەهاتییە کرن.\nئەم تێدگەهین کو هندەک جاران تشت ژ بیر دچن. هیڤییە د زووترین دەرفەت دا پارەی بدە، یان ئەگەر تە دڤێت پێکڤە باخڤین پەیوەندیێ دگەل مە بکە: {phone}\nئەگەر تە بەری نوکە پارە دابیت، سوپاس، و هیڤییە گوه نەدە ڤێ نامێ.',
    },
  },

  // ── cart ───────────────────────────────────────────────────────────────
  {
    id: 'cart-1', category: 'cart', kind: 'promo',
    vars: ['name', 'business', 'product', 'link'],
    tags: ['online', 'cart', 'abandoned'],
    title: { en: 'You left something behind', ar: 'نسيت شيئاً في سلتك', ckb: 'شتێکت لە سەبەتەکەتدا بەجێ هێشت', kmr: 'تە تشتەک د سەبەتێ دا هێلا' },
    text: {
      en: 'Hi {name}, you left something behind at {business} 🛒\n{product} is still in your cart.\nWhenever you are ready, you can finish your order here: {link}',
      ar: 'مرحباً {name}، يبدو أنك نسيت شيئاً لدى {business} 🛒\n{product} ما زال في سلتك.\nمتى كنت جاهزاً، يمكنك إتمام طلبك من هنا: {link}',
      ckb: 'سڵاو {name}، وا دیارە شتێکت لە {business} بەجێ هێشتووە 🛒\n{product} هێشتا لە سەبەتەکەتدایە.\nهەر کاتێک ئامادە بوویت، دەتوانیت لێرە داواکارییەکەت تەواو بکەیت: {link}',
      kmr: 'سلاڤ {name}، وەسا دیارە تە تشتەک ل {business} هێلایە 🛒\n{product} هێشتا د سەبەتا تە دایە.\nهەر دەمێ تو ئامادە بووی، تو دشێی ل ڤێرە داخوازیا خۆ تەمام بکەی: {link}',
    },
  },
  {
    id: 'cart-2', category: 'cart', kind: 'promo',
    vars: ['name', 'product', 'link'],
    tags: ['online', 'cart'],
    title: { en: 'Still thinking it over?', ar: 'ما زلت تفكر؟', ckb: 'هێشتا بیر دەکەیتەوە؟', kmr: 'تو هێشتا هزر دکەی؟' },
    text: {
      en: 'Hi {name}, still thinking about {product}? 🙂\nWe have kept it in your cart for you. If you have a question about it, just reply here.\n{link}',
      ar: 'مرحباً {name}، هل ما زلت تفكر في {product}؟ 🙂\nاحتفظنا به في سلتك من أجلك. وإن كان لديك أي سؤال عنه، يكفي أن ترد هنا.\n{link}',
      ckb: 'سڵاو {name}، هێشتا بیر لە {product} دەکەیتەوە؟ 🙂\nبۆمان لە سەبەتەکەتدا هێشتووەتەوە. ئەگەر پرسیارێکت لەبارەیەوە هەیە، تەنها لێرە وەڵام بدەرەوە.\n{link}',
      kmr: 'سلاڤ {name}، تو هێشتا ل سەر {product} هزر دکەی؟ 🙂\nمە بۆ تە د سەبەتا تە دا هێلایە. ئەگەر پرسیارەک دەربارەی وێ هەبیت، تنێ ل ڤێرە بەرسڤێ بدە.\n{link}',
    },
  },
  {
    id: 'cart-3', category: 'cart', kind: 'promo',
    vars: ['name', 'code', 'offer', 'link'],
    tags: ['online', 'cart', 'discount', 'code'],
    title: { en: 'Finish your order with a code', ar: 'أكمل طلبك برمز خاص', ckb: 'داواکارییەکەت بە کۆدێک تەواو بکە', kmr: 'داخوازیا خۆ ب کۆدەکێ تەمام بکە' },
    text: {
      en: 'Hi {name}, the items you chose are still waiting in your cart 🛒\nFinish your order with the code {code} and enjoy {offer}.\n{link}',
      ar: 'مرحباً {name}، المنتجات التي اخترتها ما زالت بانتظارك في سلتك 🛒\nأكمل طلبك باستخدام الرمز {code} واحصل على {offer}.\n{link}',
      ckb: 'سڵاو {name}، ئەو کاڵایانەی هەڵتبژاردن هێشتا لە سەبەتەکەتدا چاوەڕێتن 🛒\nبە کۆدی {code} داواکارییەکەت تەواو بکە و {offer} وەربگرە.\n{link}',
      kmr: 'سلاڤ {name}، ئەو تشتێن تە هەلبژارتین هێشتا د سەبەتا تە دا چاڤەڕێیا تە دکەن 🛒\nب کۆدێ {code} داخوازیا خۆ تەمام بکە و {offer} وەربگرە.\n{link}',
    },
  },

  // ── welcome ────────────────────────────────────────────────────────────
  {
    id: 'welcome-1', category: 'welcome', kind: 'greeting',
    vars: ['business', 'name'],
    tags: ['shop', 'salon', 'clinic', 'new-customer'],
    title: { en: 'Welcome, new customer', ar: 'أهلاً بالعميل الجديد', ckb: 'بەخێربێیت، کڕیاری نوێ', kmr: 'ب خێر بێی، کڕیارێ نوی' },
    text: {
      en: 'Welcome to {business}, {name}! 🌟\nThank you for choosing us; we are glad to have you.\nIf you ever need anything, just send us a message here.',
      ar: 'أهلاً بك في {business} يا {name}! 🌟\nشكراً لاختيارك لنا، يسعدنا انضمامك إلينا.\nإن احتجت إلى أي شيء، راسلنا هنا في أي وقت.',
      ckb: 'بەخێربێیت بۆ {business}، {name}! 🌟\nسوپاس کە ئێمەت هەڵبژارد؛ خۆشحاڵین بە بوونت لەگەڵمان.\nئەگەر هەر شتێکت پێویست بوو، تەنها لێرە نامەمان بۆ بنێرە.',
      kmr: 'ب خێر بێی بۆ {business}، {name}! 🌟\nسوپاس کو تە ئەم هەلبژارتین؛ ئەم دلخۆشین کو تو دگەل مەیی.\nئەگەر تە پێدڤی ب تشتەکی هەبیت، تنێ ل ڤێرە نامەکێ بۆ مە بهنێرە.',
    },
  },
  {
    id: 'welcome-2', category: 'welcome', kind: 'greeting',
    vars: ['business', 'name'],
    tags: ['member', 'club', 'gym', 'loyalty'],
    title: { en: 'Welcome, new member', ar: 'أهلاً بالعضو الجديد', ckb: 'بەخێربێیت، ئەندامی نوێ', kmr: 'ب خێر بێی، ئەندامێ نوی' },
    text: {
      en: 'Welcome to the {business} family, {name}! 🎉\nAs a member, you will hear about new arrivals and member offers right here.\nWe are happy to have you with us.',
      ar: 'أهلاً بك في عائلة {business} يا {name}! 🎉\nبصفتك عضواً، ستصلك هنا أخبار المنتجات الجديدة والعروض الخاصة بالأعضاء.\nسعداء بوجودك معنا.',
      ckb: 'بەخێربێیت بۆ خێزانی {business}، {name}! 🎉\nوەک ئەندامێک، هەواڵی بەرهەمە نوێیەکان و ئۆفەرەکانی ئەندامان لێرە پێت دەگات.\nخۆشحاڵین بە بوونت لەگەڵمان.',
      kmr: 'ب خێر بێی بۆ ناڤ مالباتا {business}، {name}! 🎉\nوەک ئەندامەک، نووچەیێن بەرهەمێن نوی و ئۆفەرێن ئەندامان دێ ل ڤێرە گەهنە تە.\nئەم دلخۆشین کو تو دگەل مەیی.',
    },
  },
  {
    id: 'welcome-3', category: 'welcome', kind: 'greeting',
    vars: ['name', 'business'],
    tags: ['subscribe', 'newsletter', 'news'],
    title: { en: 'Thanks for subscribing', ar: 'شكراً لاشتراكك', ckb: 'سوپاس بۆ بەشداربوونت', kmr: 'سوپاس بۆ بەشداربوونا تە' },
    text: {
      en: 'Thank you for subscribing, {name}! 💐\nFrom now on, news and offers from {business} will reach you right here.\nWe are glad you are with us.',
      ar: 'شكراً لاشتراكك يا {name}! 💐\nمن الآن فصاعداً ستصلك أخبار {business} وعروضه هنا مباشرة.\nيسعدنا أنك معنا.',
      ckb: 'سوپاس بۆ بەشداربوونت، {name}! 💐\nلە ئێستاوە هەواڵ و ئۆفەرەکانی {business} ڕاستەوخۆ لێرە پێت دەگەن.\nخۆشحاڵین کە لەگەڵمانیت.',
      kmr: 'سوپاس بۆ بەشداربوونا تە، {name}! 💐\nژ نوکە و پێڤە نووچە و ئۆفەرێن {business} دێ ڕاستەوخۆ ل ڤێرە گەهنە تە.\nئەم دلخۆشین کو تو دگەل مەیی.',
    },
  },
  {
    id: 'welcome-4', category: 'welcome', kind: 'greeting',
    vars: ['business', 'name', 'offer', 'code'],
    tags: ['online', 'shop', 'gift', 'discount'],
    title: { en: 'Welcome gift', ar: 'هدية الترحيب', ckb: 'دیاریی بەخێرهاتن', kmr: 'دیاریا ب خێرهاتنێ' },
    text: {
      en: 'Welcome to {business}, {name}! 🎁\nAs a thank-you for joining us, enjoy {offer} on your first order with the code {code}.',
      ar: 'أهلاً بك في {business} يا {name}! 🎁\nوتقديراً لانضمامك إلينا، احصل على {offer} على طلبك الأول باستخدام الرمز {code}.',
      ckb: 'بەخێربێیت بۆ {business}، {name}! 🎁\nوەک دیارییەکی بەخێرهاتن، {offer} لەسەر یەکەم داواکاریت وەربگرە بە کۆدی {code}.',
      kmr: 'ب خێر بێی بۆ {business}، {name}! 🎁\nوەک دیاریا هاتنا تە، {offer} ل سەر ئێکەمین داخوازیا خۆ وەربگرە ب کۆدێ {code}.',
    },
  },

  // ── course ─────────────────────────────────────────────────────────────
  {
    id: 'course-1', category: 'course', kind: 'promo',
    vars: ['service', 'business', 'date', 'price', 'phone'],
    tags: ['school', 'institute', 'training', 'registration'],
    title: { en: 'Registration open', ar: 'التسجيل مفتوح', ckb: 'ناونووسین کرایەوە', kmr: 'ناڤنڤیسین ڤەبوو' },
    text: {
      en: '*Registration is now open* for {service} at {business} 📚\nStart date: {date}\nFee: {price}\nTo reserve your place, reply to this message or call {phone}.',
      ar: '*التسجيل مفتوح الآن* لدورة {service} في {business} 📚\nتاريخ البدء: {date}\nالرسوم: {price}\nلحجز مقعدك، رد على هذه الرسالة أو اتصل بنا على {phone}.',
      ckb: '*ناونووسین دەستی پێکرد* بۆ {service} لە {business} 📚\nبەرواری دەستپێکردن: {date}\nتێچوون: {price}\nبۆ گرتنی جێگاکەت، وەڵامی ئەم نامەیە بدەرەوە یان پەیوەندیمان پێوە بکە: {phone}',
      kmr: '*ناڤنڤیسین دەست پێ کرییە* بۆ {service} ل {business} 📚\nبەروارێ دەستپێکرنێ: {date}\nبها: {price}\nبۆ گرتنا جهێ خۆ، بەرسڤا ڤێ نامێ بدە یان پەیوەندیێ دگەل مە بکە: {phone}',
    },
  },
  {
    id: 'course-2', category: 'course', kind: 'service',
    vars: ['name', 'service', 'date', 'time', 'place'],
    tags: ['school', 'class', 'reminder'],
    title: { en: 'Class reminder', ar: 'تذكير بموعد الدرس', ckb: 'بیرخستنەوەی وانە', kmr: 'بیرئینانا وانەیێ' },
    text: {
      en: 'Hi {name}, a reminder that your {service} class is on {date} at {time}.\nPlace: {place}\nSee you there!',
      ar: 'مرحباً {name}، نذكرك بموعد درس {service} في {date} الساعة {time}.\nالمكان: {place}\nنراك هناك!',
      ckb: 'سڵاو {name}، بیرت دەخەینەوە کە وانەی {service} ڕۆژی {date} کاتژمێر {time} دەبێت.\nشوێن: {place}\nچاوەڕێتین!',
      kmr: 'سلاڤ {name}، بیرئینانەک: وانەیا {service} ڕۆژا {date} دەمژمێر {time} دێ بیت.\nجه: {place}\nئەم چاڤەڕێیا تە دکەین!',
    },
  },
  {
    id: 'course-3', category: 'course', kind: 'service',
    vars: ['name', 'service', 'address', 'hours'],
    tags: ['school', 'certificate', 'graduation'],
    title: { en: 'Certificate ready', ar: 'الشهادة جاهزة', ckb: 'بڕوانامە ئامادەیە', kmr: 'بڕوانامە ئامادەیە' },
    text: {
      en: 'Congratulations, {name}! 🎓\nYour certificate for {service} is ready.\nYou can collect it from {address} during our opening hours: {hours}.',
      ar: 'تهانينا يا {name}! 🎓\nشهادتك لدورة {service} جاهزة.\nيمكنك استلامها من {address} خلال أوقات الدوام: {hours}.',
      ckb: 'پیرۆزە {name}! 🎓\nبڕوانامەکەت بۆ {service} ئامادەیە.\nدەتوانیت لە {address} وەری بگریت لە کاتەکانی کارکردنماندا: {hours}',
      kmr: 'پیرۆز بیت {name}! 🎓\nبڕوانامەیا تە یا {service} ئامادەیە.\nتو دشێی ژ {address} وەرگری د دەمێن کارکرنا مە دا: {hours}',
    },
  },
  {
    id: 'course-4', category: 'course', kind: 'service',
    vars: ['name', 'service', 'date', 'time', 'place'],
    tags: ['school', 'exam', 'university'],
    title: { en: 'Exam time', ar: 'موعد الامتحان', ckb: 'کاتی تاقیکردنەوە', kmr: 'دەمێ ئەزموونێ' },
    text: {
      en: 'Hi {name}, your {service} exam is on {date} at {time}.\nPlace: {place}\nPlease arrive a little early. We wish you every success!',
      ar: 'مرحباً {name}، موعد امتحان {service}: {date} الساعة {time}.\nالمكان: {place}\nيُرجى الحضور قبل الموعد بقليل. نتمنى لك كل التوفيق!',
      ckb: 'سڵاو {name}، تاقیکردنەوەی {service} ڕۆژی {date} کاتژمێر {time} دەبێت.\nشوێن: {place}\nتکایە کەمێک زووتر ئامادە بە. هیوای سەرکەوتنت بۆ دەخوازین!',
      kmr: 'سلاڤ {name}، ئەزموونا {service} ڕۆژا {date} دەمژمێر {time} دێ بیت.\nجه: {place}\nهیڤییە هندەکێ زووتر ئامادە بی. ئەم سەرکەفتنێ بۆ تە دخوازین!',
    },
  },

  // ── health ─────────────────────────────────────────────────────────────
  {
    id: 'health-1', category: 'health', kind: 'service',
    vars: ['name', 'business', 'date', 'time', 'phone'],
    tags: ['clinic', 'dental', 'doctor', 'appointment'],
    title: { en: 'Appointment reminder', ar: 'تذكير بالموعد', ckb: 'بیرخستنەوەی کاتی سەردان', kmr: 'بیرئینانا دەمێ سەرەدانێ' },
    text: {
      en: 'Hello {name}, this is a reminder of your appointment at {business} on {date} at {time}.\nIf you cannot come, please let us know by replying to this message or calling {phone}, so we can offer the time to someone else.',
      ar: 'مرحباً {name}، نذكرك بموعدك في {business} يوم {date} الساعة {time}.\nإن تعذر عليك الحضور، يُرجى إبلاغنا بالرد على هذه الرسالة أو الاتصال على {phone}، لنتمكن من منح الموعد لمراجع آخر.',
      ckb: 'سڵاو {name}، ئەمە بیرخستنەوەیەکە بۆ کاتی سەردانەکەت لە {business}: ڕۆژی {date}، کاتژمێر {time}.\nئەگەر ناتوانیت بێیت، تکایە بە وەڵامدانەوەی ئەم نامەیە یان پەیوەندیکردن بە {phone} ئاگادارمان بکەرەوە، تا بتوانین ئەو کاتە بدەین بە کەسێکی تر.',
      kmr: 'سلاڤ {name}، بیرئینانەک بۆ دەمێ سەرەدانا تە ل {business}: ڕۆژا {date}، دەمژمێر {time}.\nئەگەر تو نەشێی بهێی، هیڤییە ب بەرسڤدانا ڤێ نامێ یان پەیوەندیکرن ب {phone} مە ئاگەهدار بکە، دا بشێین ڤی دەمی بدەینە کەسەکێ دی.',
    },
  },
  {
    id: 'health-2', category: 'health', kind: 'service',
    vars: ['name', 'business', 'phone'],
    tags: ['clinic', 'dental', 'check-up'],
    title: { en: 'Check-up due', ar: 'موعد الفحص الدوري', ckb: 'کاتی پشکنینی ئاسایی', kmr: 'دەمێ پشکنینا ئاسایی' },
    text: {
      en: 'Hello {name}, it has been a while since your last visit to {business}, and it may be time for your regular check-up.\nTo book a time that suits you, reply to this message or call {phone}.',
      ar: 'مرحباً {name}، مضى بعض الوقت على زيارتك الأخيرة إلى {business}، وربما حان موعد فحصك الدوري.\nلحجز موعد يناسبك، رد على هذه الرسالة أو اتصل بنا على {phone}.',
      ckb: 'سڵاو {name}، ماوەیەک بەسەر دوایین سەردانت بۆ {business} تێپەڕیوە، و ڕەنگە کاتی پشکنینی ئاسایی خۆت هاتبێت.\nبۆ دیاریکردنی کاتێکی گونجاو، وەڵامی ئەم نامەیە بدەرەوە یان پەیوەندیمان پێوە بکە: {phone}',
      kmr: 'سلاڤ {name}، دەمەک ل سەر دوماهیک سەرەدانا تە بۆ {business} بۆرییە، و بەلکی دەمێ پشکنینا تە یا ئاسایی هاتبیت.\nبۆ گرتنا دەمەکێ گونجای، بەرسڤا ڤێ نامێ بدە یان پەیوەندیێ دگەل مە بکە: {phone}',
    },
  },
  {
    id: 'health-3', category: 'health', kind: 'service',
    vars: ['name', 'business', 'date', 'time', 'phone'],
    tags: ['clinic', 'doctor', 'follow-up'],
    title: { en: 'Follow-up visit', ar: 'زيارة المتابعة', ckb: 'سەردانی بەدواداچوون', kmr: 'سەرەدانا دویڤچوونێ' },
    text: {
      en: 'Hello {name}, we hope you are feeling well.\nYour follow-up visit at {business} is on {date} at {time}.\nIf you have any questions before then, call us on {phone}.',
      ar: 'مرحباً {name}، نأمل أن تكون بخير.\nموعد زيارة المتابعة في {business} يوم {date} الساعة {time}.\nإن كان لديك أي سؤال قبل ذلك، اتصل بنا على {phone}.',
      ckb: 'سڵاو {name}، هیوادارین باش بیت.\nسەردانی بەدواداچوونت لە {business}: ڕۆژی {date}، کاتژمێر {time}.\nئەگەر پێش ئەو کاتە هەر پرسیارێکت هەبوو، پەیوەندیمان پێوە بکە: {phone}',
      kmr: 'سلاڤ {name}، هیڤیدارین تو باش بی.\nسەرەدانا تە یا دویڤچوونێ ل {business}: ڕۆژا {date}، دەمژمێر {time}.\nئەگەر بەری وی دەمی چ پرسیار هەبن، پەیوەندیێ دگەل مە بکە: {phone}',
    },
  },
  {
    id: 'health-4', category: 'health', kind: 'service',
    vars: ['name', 'business', 'hours', 'phone'],
    tags: ['clinic', 'lab', 'results'],
    title: { en: 'Results ready to collect', ar: 'النتائج جاهزة للاستلام', ckb: 'ئەنجامەکان ئامادەن', kmr: 'ئەنجام ئامادەنە' },
    text: {
      en: 'Hello {name}, your results are ready to collect from {business}.\nOpening hours: {hours}\nIf you have any questions, call us on {phone}.',
      ar: 'مرحباً {name}، نتائجك جاهزة للاستلام من {business}.\nأوقات الدوام: {hours}\nلأي استفسار، اتصل بنا على {phone}.',
      ckb: 'سڵاو {name}، ئەنجامەکانت ئامادەن و دەتوانیت لە {business} وەریان بگریت.\nکاتەکانی کارکردن: {hours}\nبۆ هەر پرسیارێک پەیوەندیمان پێوە بکە: {phone}',
      kmr: 'سلاڤ {name}، ئەنجامێن تە ئامادەنە و تو دشێی ژ {business} وەرگری.\nدەمێن کارکرنێ: {hours}\nبۆ هەر پرسیارەکێ پەیوەندیێ دگەل مە بکە: {phone}',
    },
  },

  // ── property ───────────────────────────────────────────────────────────
  {
    id: 'property-1', category: 'property', kind: 'promo',
    vars: ['business', 'product', 'place', 'price', 'link', 'phone'],
    tags: ['real-estate', 'sale', 'apartment', 'house'],
    title: { en: 'New listing', ar: 'عقار جديد معروض', ckb: 'خانووبەرەی نوێ', kmr: 'مولکەکێ نوی' },
    text: {
      en: '*New from {business}* 🏡\n{product} in {place}\nPrice: {price}\nPhotos and details: {link}\nTo arrange a viewing, call {phone}.',
      ar: '*جديد من {business}* 🏡\n{product} في {place}\nالسعر: {price}\nالصور والتفاصيل: {link}\nلترتيب موعد للمعاينة، اتصل على {phone}.',
      ckb: '*نوێ لە {business}* 🏡\n{product} لە {place}\nنرخ: {price}\nوێنە و زانیاریی زیاتر: {link}\nبۆ ڕێکخستنی سەردانێک پەیوەندیمان پێوە بکە: {phone}',
      kmr: '*نوی ژ {business}* 🏡\n{product} ل {place}\nبها: {price}\nوێنە و پتر زانیاری: {link}\nبۆ ڕێکخستنا سەرەدانەکێ پەیوەندیێ دگەل مە بکە: {phone}',
    },
  },
  {
    id: 'property-2', category: 'property', kind: 'promo',
    vars: ['name', 'product', 'place', 'date', 'time', 'address'],
    tags: ['real-estate', 'viewing'],
    title: { en: 'Viewing invitation', ar: 'دعوة للمعاينة', ckb: 'بانگهێشت بۆ بینین', kmr: 'ڤەخواندن بۆ دیتنێ' },
    text: {
      en: 'Hi {name}, you are welcome to view {product} in {place} on {date} at {time}.\nAddress: {address}\nPlease reply to confirm, or suggest another time that suits you.',
      ar: 'مرحباً {name}، يسعدنا دعوتك لمعاينة {product} في {place} يوم {date} الساعة {time}.\nالعنوان: {address}\nيُرجى الرد للتأكيد، أو اقتراح وقت آخر يناسبك.',
      ckb: 'سڵاو {name}، بە خۆشحاڵییەوە بانگهێشتت دەکەین بۆ بینینی {product} لە {place}، ڕۆژی {date} کاتژمێر {time}.\nناونیشان: {address}\nتکایە بۆ پشتڕاستکردنەوە وەڵام بدەرەوە، یان کاتێکی تری گونجاو پێشنیار بکە.',
      kmr: 'سلاڤ {name}، ب دلخۆشی ڤە ئەم تە ڤەدخوینین بۆ دیتنا {product} ل {place}، ڕۆژا {date} دەمژمێر {time}.\nناڤونیشان: {address}\nهیڤییە بۆ پشتراستکرنێ بەرسڤێ بدە، یان دەمەکێ دی یێ گونجای پێشنیار بکە.',
    },
  },
  {
    id: 'property-3', category: 'property', kind: 'promo',
    vars: ['name', 'product', 'place', 'price', 'old_price', 'link', 'phone'],
    tags: ['real-estate', 'price'],
    title: { en: 'Price update', ar: 'تحديث السعر', ckb: 'نرخی نوێ', kmr: 'بهایێ نوی' },
    text: {
      en: 'Hi {name}, a price update on {product} in {place}:\nNow {price} (was {old_price}).\nFull details: {link}\nTo arrange a viewing, call {phone}.',
      ar: 'مرحباً {name}، تحديث على سعر {product} في {place}:\nالسعر الآن {price} بدلاً من {old_price}.\nالتفاصيل كاملة: {link}\nلترتيب موعد للمعاينة، اتصل على {phone}.',
      ckb: 'سڵاو {name}، نرخی {product} لە {place} گۆڕدرا:\nئێستا {price} (پێشتر {old_price}).\nزانیاریی تەواو: {link}\nبۆ ڕێکخستنی سەردانێک پەیوەندیمان پێوە بکە: {phone}',
      kmr: 'سلاڤ {name}، بهایێ {product} ل {place} هاتە گوهۆڕین:\nنوکە {price} (بەری نوکە {old_price}).\nهەمی زانیاری: {link}\nبۆ ڕێکخستنا سەرەدانەکێ پەیوەندیێ دگەل مە بکە: {phone}',
    },
  },
  {
    id: 'property-4', category: 'property', kind: 'promo',
    vars: ['product', 'place', 'price', 'link', 'phone'],
    tags: ['real-estate', 'rent', 'apartment'],
    title: { en: 'For rent', ar: 'للإيجار', ckb: 'بە کرێ دەدرێت', kmr: 'ب کرێ دهێتە دان' },
    text: {
      en: '*For rent* 🔑\n{product} in {place}\nRent: {price}\nPhotos and details: {link}\nCall {phone} to arrange a viewing.',
      ar: '*للإيجار* 🔑\n{product} في {place}\nالإيجار: {price}\nالصور والتفاصيل: {link}\nاتصل على {phone} لترتيب موعد للمعاينة.',
      ckb: '*بە کرێ دەدرێت* 🔑\n{product} لە {place}\nکرێ: {price}\nوێنە و زانیاریی زیاتر: {link}\nبۆ ڕێکخستنی سەردانێک پەیوەندیمان پێوە بکە: {phone}',
      kmr: '*ب کرێ دهێتە دان* 🔑\n{product} ل {place}\nکرێ: {price}\nوێنە و پتر زانیاری: {link}\nبۆ ڕێکخستنا سەرەدانەکێ پەیوەندیێ دگەل مە بکە: {phone}',
    },
  },

  // ── food ───────────────────────────────────────────────────────────────
  {
    id: 'food-1', category: 'food', kind: 'promo',
    vars: ['business', 'product', 'phone', 'address'],
    tags: ['restaurant', 'menu', 'cafe'],
    title: { en: 'Today’s menu', ar: 'قائمة اليوم', ckb: 'خواردنی ئەمڕۆ', kmr: 'خوارنا ئەڤرۆ' },
    text: {
      en: '*Today at {business}* 🍽️\n{product}\nOrder by phone: {phone}\nOr visit us at {address}. Enjoy your meal!',
      ar: '*اليوم في {business}* 🍽️\n{product}\nاطلب عبر الهاتف: {phone}\nأو زرنا في {address}. بالهناء والشفاء!',
      ckb: '*ئەمڕۆ لە {business}* 🍽️\n{product}\nبە تەلەفۆن داوا بکە: {phone}\nیان سەردانمان بکە لە {address}. نۆشی گیانت بێت!',
      kmr: '*ئەڤرۆ ل {business}* 🍽️\n{product}\nب تەلەفۆنێ داخواز بکە: {phone}\nیان سەرەدانا مە بکە ل {address}. نۆشی جانێ تە بیت!',
    },
  },
  {
    id: 'food-2', category: 'food', kind: 'promo',
    vars: ['business', 'product', 'price'],
    tags: ['restaurant', 'cafe', 'dish'],
    title: { en: 'New dish', ar: 'طبق جديد', ckb: 'خواردنی نوێ', kmr: 'خوارنا نوی' },
    text: {
      en: 'Something new at {business} ✨\nMeet our new dish: {product}, now on the menu for {price}.\nCome and taste it; we would love to hear what you think.',
      ar: 'جديد لدى {business} ✨\nتعرّف على طبقنا الجديد: {product}، متوفر الآن في قائمتنا بسعر {price}.\nتعال وتذوقه، ويسعدنا سماع رأيك.',
      ckb: 'شتێکی نوێ لە {business} ✨\nخواردنە نوێیەکەمان: {product}، ئێستا لە لیستی خواردنەکانماندایە بە نرخی {price}.\nوەرە تامی بکە؛ زۆر حەز دەکەین ڕای خۆتمان پێ بڵێیت.',
      kmr: 'تشتەکێ نوی ل {business} ✨\nخوارنا مە یا نوی: {product}، نوکە د لیستا خوارنێن مە دایە ب بهایێ {price}.\nوەرە تاما وێ بکە؛ ئەم حەز دکەین بۆچوونا تە بزانین.',
    },
  },
  {
    id: 'food-3', category: 'food', kind: 'promo',
    vars: ['business', 'hours', 'offer'],
    tags: ['cafe', 'restaurant', 'offer'],
    title: { en: 'Happy hour', ar: 'ساعات العروض', ckb: 'کاتژمێرەکانی ئۆفەر', kmr: 'دەمژمێرێن ئۆفەرێ' },
    text: {
      en: 'Happy hour at {business} ☕\nWhen: {hours}\nOffer: {offer}\nBring your friends along!',
      ar: 'ساعات العروض في {business} ☕\nالوقت: {hours}\nالعرض: {offer}\nاصطحب أصدقاءك معك!',
      ckb: 'کاتژمێرەکانی ئۆفەر لە {business} ☕\nکات: {hours}\nئۆفەر: {offer}\nهاوڕێکانیشت لەگەڵ خۆت بهێنە!',
      kmr: 'دەمژمێرێن ئۆفەرێ ل {business} ☕\nدەم: {hours}\nئۆفەر: {offer}\nهەڤالێن خۆ ژی دگەل خۆ بینە!',
    },
  },
  {
    id: 'food-4', category: 'food', kind: 'promo',
    vars: ['business', 'offer', 'phone'],
    tags: ['restaurant', 'catering', 'events'],
    title: { en: 'Catering for occasions', ar: 'تجهيز الطعام للمناسبات', ckb: 'خواردن بۆ بۆنەکان', kmr: 'خوارن بۆ بۆنەیان' },
    text: {
      en: 'Planning a gathering or a celebration? 🎉\nLet {business} take care of the food.\n{offer}\nCall {phone} to plan your menu with us.',
      ar: 'هل تحضّر لمناسبة أو تجمّع؟ 🎉\nدع {business} يهتم بالطعام.\n{offer}\nاتصل على {phone} لنخطط قائمة طعامك معاً.',
      ckb: 'بۆ ئاهەنگ یان بۆنەیەک خۆت ئامادە دەکەیت؟ 🎉\nبا خەمی خواردنەکە لەسەر {business} بێت.\n{offer}\nپەیوەندیمان پێوە بکە: {phone} تا پێکەوە لیستی خواردنەکەت ئامادە بکەین.',
      kmr: 'تو خۆ بۆ ئاهەنگەکێ یان بۆنەیەکێ ئامادە دکەی؟ 🎉\nبلا خەما خوارنێ ل سەر {business} بیت.\n{offer}\nپەیوەندیێ دگەل مە بکە: {phone} دا پێکڤە لیستا خوارنا تە ئامادە بکەین.',
    },
  },
  {
    id: 'food-5', category: 'food', kind: 'promo',
    vars: ['business', 'place', 'hours', 'phone', 'link'],
    tags: ['restaurant', 'delivery'],
    title: { en: 'Delivery now open', ar: 'التوصيل متاح الآن', ckb: 'گەیاندن دەستی پێکرد', kmr: 'گەهاندن دەست پێ کر' },
    text: {
      en: 'Good news! {business} now delivers to {place} 🛵\nDelivery hours: {hours}\nOrder by phone on {phone} or here: {link}',
      ar: 'خبر سار! {business} يوصل الآن إلى {place} 🛵\nأوقات التوصيل: {hours}\nاطلب عبر الهاتف على {phone} أو من هنا: {link}',
      ckb: 'هەواڵێکی خۆش! {business} ئێستا گەیاندن بۆ {place} دەکات 🛵\nکاتەکانی گەیاندن: {hours}\nبە تەلەفۆن داوا بکە: {phone} یان لێرە: {link}',
      kmr: 'مزگینی! {business} نوکە گەهاندنێ بۆ {place} دکەت 🛵\nدەمێن گەهاندنێ: {hours}\nب تەلەفۆنێ داخواز بکە: {phone} یان ل ڤێرە: {link}',
    },
  },

  // ── verify ─────────────────────────────────────────────────────────────
  // Every one carries {code} and the same "do not share" sentence, word for word (the test holds it).
  {
    id: 'verify-1', category: 'verify', kind: 'service',
    vars: ['business', 'code', 'time'],
    tags: ['otp', 'code', 'security'],
    title: { en: 'Verification code', ar: 'رمز التحقق', ckb: 'کۆدی پشتڕاستکردنەوە', kmr: 'کۆدێ پشتراستکرنێ' },
    text: {
      en: 'Your {business} verification code is {code}.\nIt is valid until {time}.\nDo not share this code with anyone.',
      ar: 'رمز التحقق الخاص بك لدى {business} هو {code}.\nالرمز صالح حتى الساعة {time}.\nلا تشارك هذا الرمز مع أي شخص.',
      ckb: 'کۆدی پشتڕاستکردنەوەی تۆ بۆ {business}: {code}\nئەم کۆدە تا کاتژمێر {time} کار دەکات.\nئەم کۆدە لەگەڵ هیچ کەسێک هاوبەش مەکە.',
      kmr: 'کۆدێ پشتراستکرنێ یێ تە بۆ {business}: {code}\nئەڤ کۆدە هەتا دەمژمێر {time} کار دکەت.\nڤی کۆدی دگەل چ کەسێ پارڤە نەکە.',
    },
  },
  {
    id: 'verify-2', category: 'verify', kind: 'service',
    vars: ['code', 'business'],
    tags: ['otp', 'login', 'security'],
    title: { en: 'Sign-in code', ar: 'رمز تسجيل الدخول', ckb: 'کۆدی چوونەژوورەوە', kmr: 'کۆدێ کەڤتنا ژوورێ' },
    text: {
      en: '{code} is your sign-in code for {business}.\nDo not share this code with anyone, even someone who says they are from {business}.',
      ar: 'رمز تسجيل الدخول إلى {business} هو {code}.\nلا تشارك هذا الرمز مع أي شخص، حتى لو قال إنه من {business}.',
      ckb: 'کۆدی چوونەژوورەوە بۆ {business}: {code}\nئەم کۆدە لەگەڵ هیچ کەسێک هاوبەش مەکە، تەنانەت ئەگەر خۆی بە کارمەندی {business} بناسێنێت.',
      kmr: 'کۆدێ کەڤتنا ژوورێ بۆ {business}: {code}\nڤی کۆدی دگەل چ کەسێ پارڤە نەکە، هەتا ئەگەر خۆ ب ناڤێ {business} بدەتە نیاسین.',
    },
  },
  {
    id: 'verify-3', category: 'verify', kind: 'service',
    vars: ['business', 'date', 'time', 'code'],
    tags: ['login', 'security', 'alert'],
    title: { en: 'New sign-in alert', ar: 'تنبيه تسجيل دخول جديد', ckb: 'ئاگاداری چوونەژوورەوەی نوێ', kmr: 'ئاگەهداریا کەڤتنا ژوورێ یا نوی' },
    text: {
      en: 'A new sign-in to your {business} account was requested on {date} at {time}.\nTo confirm it was you, enter the code {code}.\nIf it was not you, do not share this code with anyone and change your password.',
      ar: 'طُلب تسجيل دخول جديد إلى حسابك في {business} بتاريخ {date} الساعة {time}.\nلتأكيد أنك صاحب الطلب، أدخل الرمز {code}.\nإن لم تكن أنت، فلا تشارك هذا الرمز مع أي شخص وغيّر كلمة المرور.',
      ckb: 'داوای چوونەژوورەوەیەکی نوێ بۆ هەژمارەکەت لە {business} کرا، ڕۆژی {date} کاتژمێر {time}.\nبۆ پشتڕاستکردنەوەی ئەوەی کە خۆت بوویت، کۆدی {code} بنووسە.\nئەگەر تۆ نەبوویت، ئەم کۆدە لەگەڵ هیچ کەسێک هاوبەش مەکە و وشەی تێپەڕەکەت بگۆڕە.',
      kmr: 'داخوازەکا نوی بۆ کەڤتنا ژوورێ د هەژمارا تە دا ل {business} هاتە کرن، ڕۆژا {date} دەمژمێر {time}.\nبۆ پشتراستکرنێ کو ئەو تو بووی، کۆدێ {code} بنڤیسە.\nئەگەر نە تو بووی، ڤی کۆدی دگەل چ کەسێ پارڤە نەکە و پەیڤا بۆرینێ بگوهۆڕە.',
    },
  },
  {
    id: 'verify-4', category: 'verify', kind: 'service',
    vars: ['business', 'code'],
    tags: ['password', 'security'],
    title: { en: 'Password change', ar: 'تغيير كلمة المرور', ckb: 'گۆڕینی وشەی تێپەڕ', kmr: 'گوهۆڕینا پەیڤا بۆرینێ' },
    text: {
      en: 'We received a request to change the password of your {business} account.\nYour code is {code}. Do not share this code with anyone.\nIf you did not ask for this, ignore this message and your password will stay as it is.',
      ar: 'وصلنا طلب لتغيير كلمة المرور لحسابك في {business}.\nرمزك هو {code}. لا تشارك هذا الرمز مع أي شخص.\nإن لم تطلب ذلك، تجاهل هذه الرسالة وستبقى كلمة مرورك كما هي.',
      ckb: 'داواکارییەک بۆ گۆڕینی وشەی تێپەڕی هەژمارەکەت لە {business} گەیشتە دەستمان.\nکۆدەکەت: {code}. ئەم کۆدە لەگەڵ هیچ کەسێک هاوبەش مەکە.\nئەگەر تۆ داوات نەکردووە، ئەم نامەیە پشتگوێ بخە و وشەی تێپەڕەکەت وەک خۆی دەمێنێتەوە.',
      kmr: 'داخوازەک بۆ گوهۆڕینا پەیڤا بۆرینێ یا هەژمارا تە ل {business} گەهشتە مە.\nکۆدێ تە: {code}. ڤی کۆدی دگەل چ کەسێ پارڤە نەکە.\nئەگەر تە ئەڤ داخوازە نەکربیت، گوه نەدە ڤێ نامێ و پەیڤا بۆرینێ یا تە دێ وەک خۆ مینیت.',
    },
  },
  {
    id: 'verify-5', category: 'verify', kind: 'service',
    vars: ['business', 'date', 'time', 'code'],
    tags: ['booking', 'reservation', 'hotel', 'restaurant'],
    title: { en: 'Booking confirmation code', ar: 'رمز تأكيد الحجز', ckb: 'کۆدی پشتڕاستکردنەوەی جێگە گرتن', kmr: 'کۆدێ پشتراستکرنا جهگرتنێ' },
    text: {
      en: 'Your booking at {business} on {date} at {time} is confirmed.\nYour confirmation code is {code}. Please show it when you arrive.\nDo not share this code with anyone.',
      ar: 'تم تأكيد حجزك لدى {business} يوم {date} الساعة {time}.\nرمز التأكيد: {code}. يُرجى إبرازه عند وصولك.\nلا تشارك هذا الرمز مع أي شخص.',
      ckb: 'جێگە گرتنەکەت لە {business} بۆ ڕۆژی {date} کاتژمێر {time} پشتڕاست کرایەوە.\nکۆدی پشتڕاستکردنەوە: {code}. تکایە کاتێک گەیشتیت پیشانی بدە.\nئەم کۆدە لەگەڵ هیچ کەسێک هاوبەش مەکە.',
      kmr: 'جهگرتنا تە ل {business} بۆ ڕۆژا {date} دەمژمێر {time} هاتە پشتراستکرن.\nکۆدێ پشتراستکرنێ: {code}. هیڤییە دەمێ تو دگەهی نیشان بدە.\nڤی کۆدی دگەل چ کەسێ پارڤە نەکە.',
    },
  },

  // ── notice ─────────────────────────────────────────────────────────────
  {
    id: 'notice-1', category: 'notice', kind: 'service',
    vars: ['name', 'business', 'date', 'hours'],
    tags: ['closed', 'shop'],
    title: { en: 'Closed for the day', ar: 'يوم إغلاق', ckb: 'ڕۆژی داخستن', kmr: 'ڕۆژا گرتنێ' },
    text: {
      en: 'Hello {name}, please note that {business} will be closed on {date}.\nAfter that we will be back at our usual hours: {hours}.\nThank you for your understanding.',
      ar: 'مرحباً {name}، نود إعلامك بأن {business} سيكون مغلقاً يوم {date}.\nونعود بعدها إلى أوقات عملنا المعتادة: {hours}.\nشكراً لتفهمك.',
      ckb: 'سڵاو {name}، ئاگادارت دەکەینەوە کە {business} ڕۆژی {date} داخراو دەبێت.\nدواتر بە کاتەکانی ئاسایی کارکردنمان دەگەڕێینەوە: {hours}.\nسوپاس بۆ تێگەیشتنت.',
      kmr: 'سلاڤ {name}، ئەم تە ئاگەهدار دکەین کو {business} ڕۆژا {date} دێ گرتی بیت.\nپشتی هینگێ ب دەمێن کارکرنا مە یێن ئاسایی دێ زڤڕینەڤە: {hours}.\nسوپاس بۆ تێگەهشتنا تە.',
    },
  },
  {
    id: 'notice-2', category: 'notice', kind: 'service',
    vars: ['name', 'business', 'hours'],
    tags: ['holiday', 'hours', 'eid'],
    title: { en: 'Holiday hours', ar: 'أوقات العمل في العطلة', ckb: 'کاتەکانی کار لە پشوودا', kmr: 'دەمێن کاری د پشوویێ دا' },
    text: {
      en: 'Hello {name}, during the holiday our opening hours at {business} will be:\n{hours}\nWe wish you and your family a happy holiday.',
      ar: 'مرحباً {name}، ستكون أوقات العمل في {business} خلال العطلة على النحو التالي:\n{hours}\nنتمنى لك ولعائلتك عطلة سعيدة.',
      ckb: 'سڵاو {name}، لە ماوەی پشووەکەدا کاتەکانی کارکردن لە {business} بەم شێوەیە دەبێت:\n{hours}\nپشوویەکی خۆش بۆ تۆ و خێزانەکەت دەخوازین.',
      kmr: 'سلاڤ {name}، د دەمێ پشوویێ دا دەمێن کارکرنێ ل {business} دێ ب ڤی ڕەنگی بن:\n{hours}\nئەم پشوویەکا خۆش بۆ تە و مالباتا تە دخوازین.',
    },
  },
  {
    id: 'notice-3', category: 'notice', kind: 'service',
    vars: ['name', 'business', 'date', 'address', 'link'],
    tags: ['address', 'moved', 'location'],
    title: { en: 'We have moved', ar: 'انتقلنا إلى عنوان جديد', ckb: 'گوازراینەوە بۆ شوێنێکی نوێ', kmr: 'مە جهێ خۆ گوهۆڕی' },
    text: {
      en: 'Hello {name}, {business} has moved! From {date}, you will find us at our new address:\n{address}\nMap: {link}\nWe look forward to seeing you there.',
      ar: 'مرحباً {name}، انتقل {business} إلى مكان جديد! اعتباراً من {date} ستجدنا في عنواننا الجديد:\n{address}\nالخريطة: {link}\nنتطلع إلى رؤيتك هناك.',
      ckb: 'سڵاو {name}، {business} گوازرایەوە بۆ شوێنێکی نوێ! لە ڕۆژی {date} بەدواوە لە ناونیشانە نوێیەکەمان دەمانبینیتەوە:\n{address}\nنەخشە: {link}\nچاوەڕێی بینینتین.',
      kmr: 'سلاڤ {name}، {business} هاتە ڤەگوهاستن بۆ جهەکێ نوی! ژ ڕۆژا {date} و پێڤە، تو دێ مە ل ناڤونیشانێ مە یێ نوی بینی:\n{address}\nنەخشە: {link}\nئەم چاڤەڕێیا دیتنا تە دکەین.',
    },
  },
  {
    id: 'notice-4', category: 'notice', kind: 'service',
    vars: ['name', 'business', 'date', 'time'],
    tags: ['maintenance', 'system', 'online'],
    title: { en: 'Planned maintenance', ar: 'صيانة مجدولة', ckb: 'کاری چاککردنەوە', kmr: 'کارێ چاککرنێ' },
    text: {
      en: 'Hello {name}, {business} will carry out planned maintenance on {date}, starting at {time}.\nSome services may not work for a while. We apologise for the inconvenience and thank you for your patience.',
      ar: 'مرحباً {name}، سيجري {business} أعمال صيانة مجدولة يوم {date} ابتداءً من الساعة {time}.\nقد لا تعمل بعض الخدمات لبعض الوقت. نعتذر عن الإزعاج ونشكرك على صبرك.',
      ckb: 'سڵاو {name}، {business} ڕۆژی {date} کاری چاککردنەوە ئەنجام دەدات، کە کاتژمێر {time} دەست پێدەکات.\nلەوانەیە هەندێک خزمەتگوزاری بۆ ماوەیەک کار نەکەن. داوای لێبوردن دەکەین بۆ ئەم ناڕەحەتییە و سوپاس بۆ ئارامگرتنت.',
      kmr: 'سلاڤ {name}، {business} دێ ڕۆژا {date} کارێ چاککرنێ ئەنجام دەت، کو دەمژمێر {time} دێ دەست پێ کەت.\nبەلکی هندەک خزمەتگوزاری بۆ دەمەکی کار نەکەن. ئەم بۆ ڤێ ئاریشێ لێبورینێ دخوازین و سوپاس بۆ سەبرا تە.',
    },
  },
  {
    id: 'notice-5', category: 'notice', kind: 'service',
    vars: ['name', 'date', 'product', 'business', 'price'],
    tags: ['price', 'change'],
    title: { en: 'Price change notice', ar: 'إشعار بتغيير السعر', ckb: 'ئاگاداری گۆڕینی نرخ', kmr: 'ئاگەهداریا گوهۆڕینا بهایی' },
    text: {
      en: 'Hello {name}, we would like to let you know in advance that from {date}, the price of {product} at {business} will be {price}.\nThank you for your understanding and your continued trust.',
      ar: 'مرحباً {name}، نود إعلامك مسبقاً بأنه اعتباراً من {date} سيصبح سعر {product} لدى {business}: {price}.\nشكراً لتفهمك وثقتك الدائمة بنا.',
      ckb: 'سڵاو {name}، دەمانەوێت پێشوەختە ئاگادارت بکەینەوە کە لە ڕۆژی {date} بەدواوە نرخی {product} لە {business} دەبێت بە {price}.\nسوپاس بۆ تێگەیشتنت و متمانەی بەردەوامت.',
      kmr: 'سلاڤ {name}، مە دڤێت ژ نوکە ڤە تە ئاگەهدار بکەین کو ژ ڕۆژا {date} و پێڤە بهایێ {product} ل {business} دێ بیتە {price}.\nسوپاس بۆ تێگەهشتنا تە و باوەریا تە یا بەردەوام.',
    },
  },

  // ── survey ─────────────────────────────────────────────────────────────
  {
    id: 'survey-1', category: 'survey', kind: 'service',
    vars: ['name', 'business'],
    tags: ['feedback', 'restaurant', 'shop'],
    title: { en: 'How did we do?', ar: 'كيف كانت تجربتك؟', ckb: 'سەردانەکەت چۆن بوو؟', kmr: 'سەرەدانا تە چاوا بوو؟' },
    text: {
      en: 'Hi {name}, thank you for visiting {business}! How did we do?\nReply with a few words about your visit; every answer helps us get better. 😊',
      ar: 'مرحباً {name}، شكراً لزيارتك {business}! كيف كانت تجربتك معنا؟\nرد بكلمات قليلة عن زيارتك، فكل رأي يساعدنا على التحسن. 😊',
      ckb: 'سڵاو {name}، سوپاس بۆ سەردانەکەت بۆ {business}! سەردانەکەت چۆن بوو؟\nبە چەند وشەیەک وەڵام بدەرەوە؛ هەر وەڵامێک یارمەتیمان دەدات باشتر بین. 😊',
      kmr: 'سلاڤ {name}، سوپاس بۆ سەرەدانا تە بۆ {business}! سەرەدانا تە چاوا بوو؟\nب چەند پەیڤان بەرسڤێ بدە؛ هەر بەرسڤەک هاریکاریا مە دکەت دا باشتر ببین. 😊',
    },
  },
  {
    id: 'survey-2', category: 'survey', kind: 'service',
    vars: ['name', 'service', 'link'],
    tags: ['questionnaire', 'feedback'],
    title: { en: 'Short questionnaire', ar: 'استبيان قصير', ckb: 'ڕاپرسییەکی کورت', kmr: 'ڕاپرسییەکا کورت' },
    text: {
      en: 'Hi {name}, could you spare a moment for a short questionnaire about {service}?\nYour answers help us serve you better.\n{link}\nThank you!',
      ar: 'مرحباً {name}، هل لديك بضع لحظات للإجابة عن استبيان قصير حول {service}؟\nإجاباتك تساعدنا على خدمتك بشكل أفضل.\n{link}\nشكراً لك!',
      ckb: 'سڵاو {name}، دەتوانیت چەند ساتێکمان پێ ببەخشیت بۆ ڕاپرسییەکی کورت دەربارەی {service}؟\nوەڵامەکانت یارمەتیمان دەدەن باشتر خزمەتت بکەین.\n{link}\nسوپاس!',
      kmr: 'سلاڤ {name}، تو دشێی هندەک دەمێ خۆ بدەیە مە بۆ ڕاپرسییەکا کورت دەربارەی {service}؟\nبەرسڤێن تە هاریکاریا مە دکەن دا باشتر خزمەتا تە بکەین.\n{link}\nسوپاس!',
    },
  },
  {
    id: 'survey-3', category: 'survey', kind: 'service',
    vars: ['name', 'service', 'business', 'link'],
    tags: ['review', 'rating', 'feedback'],
    title: { en: 'Ask for a review', ar: 'طلب تقييم', ckb: 'داوای هەڵسەنگاندن', kmr: 'داخوازا هەلسەنگاندنێ' },
    text: {
      en: 'Hi {name}, we hope you were happy with {service} at {business}.\nIf you have a moment, we would love a review from you: {link}\nThank you for your support! ⭐',
      ar: 'مرحباً {name}، نأمل أن تكون راضياً عن {service} في {business}.\nإن كان لديك بعض الوقت، يسعدنا أن تكتب لنا تقييمك هنا: {link}\nشكراً لدعمك! ⭐',
      ckb: 'سڵاو {name}، هیوادارین {service} لە {business} بە دڵت بووبێت.\nئەگەر کاتت هەیە، زۆر خۆشحاڵ دەبین هەڵسەنگاندنێکمان بۆ بنووسیت: {link}\nسوپاس بۆ پشتگیریت! ⭐',
      kmr: 'سلاڤ {name}، هیڤیدارین {service} ل {business} ب دلێ تە بوو بیت.\nئەگەر دەمێ تە هەبیت، ئەم دێ گەلەک دلخۆش بین ئەگەر تو هەلسەنگاندنەکێ بۆ مە بنڤیسی: {link}\nسوپاس بۆ پشتەڤانیا تە! ⭐',
    },
  },

  // ── referral ───────────────────────────────────────────────────────────
  {
    id: 'referral-1', category: 'referral', kind: 'promo',
    vars: ['name', 'business', 'offer'],
    tags: ['friend', 'salon', 'shop'],
    title: { en: 'Bring a friend', ar: 'أحضر صديقاً', ckb: 'هاوڕێیەک بهێنە', kmr: 'هەڤالەکێ بینە' },
    text: {
      en: 'Hi {name}, thank you for being with us! 🎁\nBring a friend to {business} and get {offer} on your next visit.\nJust ask your friend to mention your name.',
      ar: 'مرحباً {name}، شكراً لأنك معنا! 🎁\nأحضر صديقاً إلى {business} واحصل على {offer} في زيارتك القادمة.\nويكفي أن يذكر صديقك اسمك.',
      ckb: 'سڵاو {name}، سوپاس کە لەگەڵمانیت! 🎁\nهاوڕێیەک بهێنە بۆ {business} و لە سەردانی داهاتووتدا {offer} وەربگرە.\nتەنها بە هاوڕێکەت بڵێ ناوی تۆ بهێنێت.',
      kmr: 'سلاڤ {name}، سوپاس کو تو دگەل مەیی! 🎁\nهەڤالەکێ بینە بۆ {business} و د سەرەدانا خۆ یا بێت دا {offer} وەربگرە.\nتنێ بێژە هەڤالێ خۆ کو ناڤێ تە بینیت.',
    },
  },
  {
    id: 'referral-2', category: 'referral', kind: 'promo',
    vars: ['name', 'code', 'business', 'offer', 'link'],
    tags: ['friend', 'code', 'online'],
    title: { en: 'Share your code', ar: 'شارك رمزك مع أصدقائك', ckb: 'کۆدەکەت بنێرە بۆ هاوڕێکانت', kmr: 'کۆدێ خۆ بۆ هەڤالان بهنێرە' },
    text: {
      en: 'Hi {name}, send your code {code} to your friends 🎁\nWhen a friend uses it on their first order at {business}, you both get {offer}.\nDetails: {link}',
      ar: 'مرحباً {name}، أرسل رمزك {code} إلى أصدقائك 🎁\nعندما يستخدمه صديقك في أول طلب له من {business}، يحصل كل منكما على {offer}.\nالتفاصيل: {link}',
      ckb: 'سڵاو {name}، کۆدەکەت ({code}) بۆ هاوڕێکانت بنێرە 🎁\nکاتێک هاوڕێیەکت لە یەکەم داواکاریدا لە {business} بەکاری دەهێنێت، هەردووکتان {offer} وەردەگرن.\nزانیاریی زیاتر: {link}',
      kmr: 'سلاڤ {name}، کۆدێ خۆ ({code}) بۆ هەڤالێن خۆ بهنێرە 🎁\nدەمێ هەڤالەک د ئێکەمین داخوازیا خۆ دا ل {business} بکار دئینیت، هەر ئێک ژ هەوە دێ {offer} وەرگریت.\nپتر زانیاری: {link}',
    },
  },
  {
    id: 'referral-3', category: 'referral', kind: 'promo',
    vars: ['name', 'service', 'business', 'offer', 'phone'],
    tags: ['friend', 'clinic', 'salon', 'services'],
    title: { en: 'Introduce someone', ar: 'عرّف أحداً علينا', ckb: 'کەسێک بناسێنە', kmr: 'کەسەکی بدە نیاسین' },
    text: {
      en: 'Hi {name}, do you know someone who would enjoy {service}? 🌟\nBring them to {business}: after their first visit, you both receive {offer}.\nThey only need to mention your name when they book on {phone}.',
      ar: 'مرحباً {name}، هل تعرف أحداً يرغب في {service}؟ 🌟\nعرّفه على {business}، وبعد زيارته الأولى يحصل كل منكما على {offer}.\nيكفي أن يذكر اسمك عند الحجز على {phone}.',
      ckb: 'سڵاو {name}، کەسێک دەناسیت کە حەزی لە {service} بێت؟ 🌟\nبیهێنە بۆ {business}؛ دوای یەکەم سەردانی، هەردووکتان {offer} وەردەگرن.\nتەنها پێویستە لە کاتی نۆرەگرتن لە ڕێگەی {phone} ناوی تۆ بهێنێت.',
      kmr: 'سلاڤ {name}، تو کەسەکی دنیاسی کو حەز ژ {service} بکەت؟ 🌟\nبلا ئەو ژی سەرەدانا {business} بکەت؛ پشتی ئێکەمین سەرەدانێ، هەر ئێک ژ هەوە دێ {offer} وەرگریت.\nتنێ پێدڤییە دەمێ جهگرتنێ ل سەر {phone} ناڤێ تە بینیت.',
    },
  },
];
