/**
 * Interface language.
 *
 * The same four the Vylo OTP dashboard ships: English, Arabic, Central Kurdish
 * (Sorani) and Badini — Northern Kurdish as written in Duhok, in Arabic script
 * rather than the Latin one Kurmanji usually takes.
 *
 * Layout stays left-to-right in every language, matching the decision made for
 * the OTP dashboard. Arabic-script text still shapes right-to-left within each
 * line; that is the browser's bidi algorithm and is not something `dir`
 * controls. Only the interface is translated — the agent answers in whatever
 * language you write to it.
 */

export type Lang = 'en' | 'ar' | 'ckb' | 'kmr';

export const LANGS: { code: Lang; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'العربية' },
  { code: 'ckb', label: 'کوردیی ناوەندی' },
  { code: 'kmr', label: 'کوردیا بادینی' },
];

type Dict = Record<string, string>;

const ar: Dict = {
  'Recent': 'الأخيرة',
  'Recent folders': 'المجلدات الأخيرة',
  'New chat': 'محادثة جديدة',
  'Clear this conversation': 'مسح هذه المحادثة',
  'Update available': 'يتوفر تحديث',
  'Later': 'لاحقاً',
  'Install and restart': 'التثبيت وإعادة التشغيل',
  'Downloading…': 'جارٍ التنزيل…',
  'Restarting…': 'جارٍ إعادة التشغيل…',
  'Open folder…': 'افتح مجلداً…',
  'Open a project folder': 'افتح مجلد مشروع',
  'Settings': 'الإعدادات',
  'Gateway': 'البوابة',
  'API key': 'مفتاح API',
  'Model': 'النموذج',
  'Language': 'اللغة',
  'Stored in this app only, on this machine.': 'يُحفظ في هذا التطبيق فقط، على هذا الجهاز.',
  'Send': 'إرسال',
  'Open a folder, then ask about the code in it.': 'افتح مجلداً، ثم اسأل عن الكود بداخله.',
  'The agent reads files on this machine — nothing is uploaded except your question and the snippets it chooses to read.':
    'يقرأ الوكيل الملفات على هذا الجهاز — لا يُرفع شيء سوى سؤالك والمقاطع التي يختار قراءتها.',
  'It can propose edits and run your tests — you approve every change and every command first.':
    'يمكنه اقتراح تعديلات وتشغيل اختباراتك — أنت توافق على كل تغيير وكل أمر أولاً.',
  'working…': 'جارٍ العمل…',
  'Open a folder first.': 'افتح مجلداً أولاً.',
  'Add your gateway API key in Settings.': 'أضف مفتاح API الخاص بالبوابة في الإعدادات.',
  'Run this command?': 'تشغيل هذا الأمر؟',
  'Decline': 'رفض',
  'Always allow this': 'اسمح دائماً بهذا',
  'Run': 'تشغيل',
  'in': 'في',
  'Approve': 'موافقة',
  'Approve all': 'الموافقة على الكل',
  'Discard': 'تجاهل',
  'Discard all': 'تجاهل الكل',
  'Nothing is written until you approve.': 'لا يُكتب شيء حتى توافق.',
  'new': 'جديد',
  'Commit message': 'رسالة الالتزام',
  'Not now': 'ليس الآن',
  '+ branch': '+ فرع',
  'New branch name': 'اسم الفرع الجديد',
  'Drop a folder to open it, or images to attach': 'أفلت مجلداً لفتحه، أو صوراً لإرفاقها',
  'Open a folder, or drop one here': 'افتح مجلداً، أو أفلت واحداً هنا',
};

const ckb: Dict = {
  'Recent': 'دواییەکان',
  'Recent folders': 'بوخچە دواییەکان',
  'New chat': 'گفتوگۆی نوێ',
  'Clear this conversation': 'ئەم گفتوگۆیە بسڕەوە',
  'Update available': 'نوێکردنەوە بەردەستە',
  'Later': 'دواتر',
  'Install and restart': 'دایبنێ و پێبکەرەوە',
  'Downloading…': 'داگرتن…',
  'Restarting…': 'پێکردنەوە…',
  'Open folder…': 'بوخچەیەک بکەرەوە…',
  'Open a project folder': 'بوخچەی پڕۆژەیەک بکەرەوە',
  'Settings': 'ڕێکخستن',
  'Gateway': 'دەروازە',
  'API key': 'کلیلی API',
  'Model': 'مۆدێل',
  'Language': 'زمان',
  'Stored in this app only, on this machine.': 'تەنها لەم ئەپەدا هەڵدەگیرێت، لەسەر ئەم ئامێرە.',
  'Send': 'ناردن',
  'Open a folder, then ask about the code in it.': 'بوخچەیەک بکەرەوە، پاشان لەبارەی کۆدەکەی بپرسە.',
  'The agent reads files on this machine — nothing is uploaded except your question and the snippets it chooses to read.':
    'ئەیجەنتەکە فایلەکان لەسەر ئەم ئامێرە دەخوێنێتەوە — هیچ نانێردرێت جگە لە پرسیارەکەت و ئەو بەشانەی هەڵیدەبژێرێت بۆ خوێندنەوە.',
  'It can propose edits and run your tests — you approve every change and every command first.':
    'دەتوانێت گۆڕانکاری پێشنیار بکات و تاقیکردنەوەکانت جێبەجێ بکات — تۆ سەرەتا ڕەزامەندی لە هەموو گۆڕانکارییەک و هەموو فەرمانێک دەدەیت.',
  'working…': 'کار دەکات…',
  'Open a folder first.': 'سەرەتا بوخچەیەک بکەرەوە.',
  'Add your gateway API key in Settings.': 'کلیلی API ی دەروازەکەت لە ڕێکخستندا زیاد بکە.',
  'Run this command?': 'ئەم فەرمانە جێبەجێ بکرێت؟',
  'Decline': 'ڕەتکردنەوە',
  'Always allow this': 'هەمیشە ڕێگە بدە',
  'Run': 'جێبەجێکردن',
  'in': 'لە',
  'Approve': 'ڕەزامەندی',
  'Approve all': 'ڕەزامەندی بە هەموویان',
  'Discard': 'فڕێدان',
  'Discard all': 'هەموویان فڕێبدە',
  'Nothing is written until you approve.': 'هیچ نانووسرێت هەتا ڕەزامەندی نەدەیت.',
  'new': 'نوێ',
  'Commit message': 'پەیامی کۆمیت',
  'Not now': 'ئێستا نا',
  '+ branch': '+ لق',
  'New branch name': 'ناوی لقی نوێ',
  'Drop a folder to open it, or images to attach': 'بوخچەیەک فڕێبدە بۆ کردنەوەی، یان وێنە بۆ هاوپێچکردن',
  'Open a folder, or drop one here': 'بوخچەیەک بکەرەوە، یان یەکێک لێرە فڕێبدە',
};

const kmr: Dict = {
  'Recent': 'یێن دوماهیێ',
  'Recent folders': 'بوخچێن دوماهیێ',
  'New chat': 'ئاخفتنا نوی',
  'Clear this conversation': 'ڤێ ئاخفتنێ ژێبە',
  'Update available': 'نویکرن هەیە',
  'Later': 'پاشتر',
  'Install and restart': 'دابنێ و ژنوڤە بدەستپێکە',
  'Downloading…': 'داگرتن…',
  'Restarting…': 'ژنوڤە دەستپێکرن…',
  'Open folder…': 'بوخچەیەکێ ڤەکە…',
  'Open a project folder': 'بوخچەیا پڕۆژەیەکێ ڤەکە',
  'Settings': 'ڕێکخستن',
  'Gateway': 'دەرگەه',
  'API key': 'کلیلا API',
  'Model': 'مۆدێل',
  'Language': 'زمان',
  'Stored in this app only, on this machine.': 'تنێ د ڤێ ئەپێ دا تێت پاراستن، ل سەر ڤێ ئامێرێ.',
  'Send': 'هنارتن',
  'Open a folder, then ask about the code in it.': 'بوخچەیەکێ ڤەکە، پاشی ل دەر کۆدێ وێ بپرسە.',
  'The agent reads files on this machine — nothing is uploaded except your question and the snippets it chooses to read.':
    'ئەیجەنت فایلان ل سەر ڤێ ئامێرێ دخوینیت — تشتەک نایێ هنارتن ژ بلی پرسیارا تە و وان بەشێن ئەو هەلدبژێریت بۆ خواندنێ.',
  'It can propose edits and run your tests — you approve every change and every command first.':
    'دشێت گوهۆڕین پێشنیار بکەت و تاقیکرنێن تە بمەشینیت — تو بەری هەمییان ڕازیبوونێ ددەی ل سەر هەر گوهۆڕینەک و هەر فەرمانەکێ.',
  'working…': 'کار دکەت…',
  'Open a folder first.': 'بەرێ بوخچەیەکێ ڤەکە.',
  'Add your gateway API key in Settings.': 'کلیلا API یا دەرگەهێ خۆ د ڕێکخستنێ دا زێدە بکە.',
  'Run this command?': 'ئەڤ فەرمانە بێتە مەشاندن؟',
  'Decline': 'ڕەتکرن',
  'Always allow this': 'هەروەسا ڕێ بدە',
  'Run': 'بمەشینە',
  'in': 'د',
  'Approve': 'ڕازیبوون',
  'Approve all': 'ڕازیبوون ب هەمییان',
  'Discard': 'ئاڤێتن',
  'Discard all': 'هەمییان بئاڤێژە',
  'Nothing is written until you approve.': 'تشتەک نایێ نڤیسین هەتا تو ڕازی نەبی.',
  'new': 'نوی',
  'Commit message': 'پەیاما کۆمیتێ',
  'Not now': 'نە نوکە',
  '+ branch': '+ چق',
  'New branch name': 'ناڤێ چقێ نوی',
  'Drop a folder to open it, or images to attach': 'بوخچەیەکێ بئاڤێژە بۆ ڤەکرنێ، یان وێنان بۆ پێڤەکرنێ',
  'Open a folder, or drop one here': 'بوخچەیەکێ ڤەکە، یان یەکێ ل ڤێرێ بئاڤێژە',
};

const TABLES: Record<Lang, Dict> = { en: {}, ar, ckb, kmr };

const KEY = 'vylo.lang';

export function storedLang(): Lang {
  const v = localStorage.getItem(KEY);
  return LANGS.some((l) => l.code === v) ? (v as Lang) : 'en';
}

export function storeLang(l: Lang): void {
  localStorage.setItem(KEY, l);
}

/**
 * The English sentence is the key, so a missing translation degrades to English
 * rather than to a raw identifier — and the source stays readable.
 */
export function translator(lang: Lang): (s: string) => string {
  const table = TABLES[lang];
  return (s: string) => table[s] ?? s;
}
