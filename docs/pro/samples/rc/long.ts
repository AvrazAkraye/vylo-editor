// Realistic long inputs per template, English and Arabic: what a real person might type at the long end. Not committed.
import type { RecipeId } from '../../src/motiontypes';

type F = Record<string, string>;
export const LONG: Partial<Record<RecipeId, { en: F; ar: F }>> = {
  'big-title': {
    en: { kicker: 'Annual report 2025', title: 'Why the next generation of teachers will learn to code before they learn to grade', subtitle: 'A six-month investigation into classrooms, budgets and the people quietly changing both' },
    ar: { kicker: 'التقرير السنوي 2025', title: 'كيف أعاد فريق صغير في دهوك بناء النقل المدرسي في المدينة كلها', subtitle: 'تحقيق استمر ستة أشهر في الصفوف والميزانيات والأشخاص الذين يغيّرونها بهدوء' },
  },
  kinetic: {
    en: { title: 'Fresh bread, honest prices, every single morning', highlight: 'honest' },
    ar: { title: 'خبز طازج وأسعار عادلة كل صباح بلا استثناء', highlight: 'عادلة' },
  },
  'split-title': {
    en: { title: 'The quiet revolution in rural healthcare', subtitle: 'How three clinics in the mountains cut waiting times by half in one year' },
    ar: { title: 'الثورة الهادئة في الرعاية الصحية الريفية', subtitle: 'كيف خفّضت ثلاث عيادات في الجبال أوقات الانتظار إلى النصف في عام واحد' },
  },
  quote: {
    en: { quote: 'We did not set out to build a company. We set out to fix one problem for our neighbours, and then the next one, and the one after that.', author: 'Hevi Abdulrahman', role: 'Co-founder and CEO, Zagros Health Cooperative' },
    ar: { quote: 'لم نكن نخطط لتأسيس شركة. أردنا فقط حل مشكلة واحدة لجيراننا، ثم التي تليها، ثم التي بعدها.', author: 'هيفي عبد الرحمن', role: 'الشريكة المؤسسة والرئيسة التنفيذية، تعاونية زاغروس الصحية' },
  },
  'lower-third': {
    en: { name: 'Alexandra Montgomery-Whitfield', role: 'Chief Economist, International Monetary Fund' },
    ar: { name: 'عبد الرحمن محمد الحسيني', role: 'كبير الاقتصاديين في صندوق النقد الدولي، واشنطن' },
  },
  subscribe: {
    en: { label: 'Subscribe for more', done: "You're subscribed!" },
    ar: { label: 'اشترك ليصلك الجديد', done: 'شكراً لاشتراكك!' },
  },
  callout: {
    en: { label: 'Tap here to change your profile photo', number: '12' },
    ar: { label: 'اضغط هنا لتغيير صورة ملفك الشخصي', number: '12' },
  },
  handle: {
    en: { handle: 'duhok.university.official', caption: 'Follow us for daily campus news' },
    ar: { handle: 'duhok.university.official', caption: 'تابعونا لأخبار الجامعة اليومية' },
  },
  'big-number': {
    en: { value: '2750000', prefix: '$', suffix: '+', label: 'Raised for new classrooms across the region this year' },
    ar: { value: '2750000', prefix: '$', suffix: '+', label: 'جُمعت لبناء صفوف دراسية جديدة في المنطقة هذا العام' },
  },
  'bar-chart': {
    en: { title: 'Students enrolled by faculty, autumn semester 2025', items: 'Engineering: 1240\nMedicine: 980\nLaw: 760\nBusiness: 1105\nAgriculture: 430\nEducation: 870\nArts and Humanities: 655\nComputer Science: 1390', unit: '' },
    ar: { title: 'الطلاب المسجلون حسب الكلية، الفصل الخريفي 2025', items: 'الهندسة: 1240\nالطب: 980\nالقانون: 760\nإدارة الأعمال: 1105\nالزراعة: 430\nالتربية: 870\nالآداب والعلوم الإنسانية: 655\nعلوم الحاسوب: 1390', unit: '' },
  },
  donut: {
    en: { title: 'Where every dinar of the 2025 budget goes', items: 'Salaries and benefits: 4200\nBuildings and maintenance: 1800\nTeaching materials: 950\nScholarships: 700\nResearch grants: 640\nEverything else: 310' },
    ar: { title: 'أين يذهب كل دينار من ميزانية 2025', items: 'الرواتب والمزايا: 4200\nالمباني والصيانة: 1800\nالمواد التعليمية: 950\nالمنح الدراسية: 700\nمنح البحث العلمي: 640\nكل ما عدا ذلك: 310' },
  },
  'line-chart': {
    en: { title: 'Monthly active users of the mobile app, 2025', items: 'Jan: 12\nFeb: 15\nMar: 19\nApr: 24\nMay: 22\nJun: 30\nJul: 41\nAug: 45\nSep: 38\nOct: 52\nNov: 61\nDec: 74', unit: 'k' },
    ar: { title: 'المستخدمون النشطون شهرياً للتطبيق في 2025', items: 'كانون الثاني: 12\nشباط: 15\nآذار: 19\nنيسان: 24\nأيار: 22\nحزيران: 30\nتموز: 41\nآب: 45\nأيلول: 38\nتشرين الأول: 52\nتشرين الثاني: 61\nكانون الأول: 74', unit: 'ألف' },
  },
  stats: {
    en: { title: "A decade of the Duhok Children's Library in numbers", items: 'Books lent to children: 184500\nVolunteer reading hours: 12750\nVillages visited by the bus: 96' },
    ar: { title: 'عشر سنوات من مكتبة دهوك للأطفال بالأرقام', items: 'كتب أعيرت للأطفال: 184500\nساعات قراءة تطوعية: 12750\nقرى زارتها الحافلة: 96' },
  },
  'logo-reveal': {
    en: { name: 'Zagros Mountain Coffee Company', tagline: 'Small batches, roasted by hand in the hills since 1998', mark: 'ZM' },
    ar: { name: 'محمصة قهوة جبال زاغروس', tagline: 'دفعات صغيرة تحمّص يدوياً في التلال منذ عام 1998', mark: 'ز' },
  },
  countdown: {
    en: { from: '10', final: "Let's begin!" },
    ar: { from: '10', final: 'لنبدأ الآن!' },
  },
  intro: {
    en: { title: 'The Mountain Kitchen Podcast', subtitle: 'Season 3, episode 14: bread, salt and old family recipes' },
    ar: { title: 'بودكاست مطبخ الجبل', subtitle: 'الموسم 3، الحلقة 14: الخبز والملح ووصفات العائلة القديمة' },
  },
  steps: {
    en: { title: 'How to renew your student card online', items: 'Sign in with your university email\nUpload a recent passport-size photo\nCheck your details and pay the fee\nWait for the confirmation message\nCollect your card from the front desk' },
    ar: { title: 'كيف تجدد بطاقتك الجامعية عبر الإنترنت', items: 'سجّل الدخول ببريدك الجامعي\nارفع صورة شخصية حديثة\nراجع بياناتك وادفع الرسوم\nانتظر رسالة التأكيد\nاستلم بطاقتك من مكتب الاستقبال' },
  },
  'loop-bg': { en: { style: 'bokeh' }, ar: { style: 'waves' } },
  'lt-bar': {
    en: { name: 'Alexandra Montgomery-Whitfield', role: 'Senior Correspondent, Middle East and North Africa' },
    ar: { name: 'عبد الرحمن محمد الحسيني', role: 'مراسل أول لشؤون الشرق الأوسط وشمال أفريقيا' },
  },
  'lt-pill': {
    en: { name: 'Dr. Shilan Abdulkarim Omar', role: 'Host and producer, The Morning Table on Rudaw' },
    ar: { name: 'د. شيلان عبد الكريم عمر', role: 'مقدّمة ومنتجة برنامج طاولة الصباح' },
  },
  'lt-kicker': {
    en: { kicker: 'Live from the summit', name: 'Prof. Aram Karim Barzani', role: 'Climate scientist, University of Duhok, Kurdistan' },
    ar: { kicker: 'مباشر من القمة', name: 'أ.د. آرام كريم البارزاني', role: 'عالم مناخ في جامعة دهوك، إقليم كوردستان' },
  },
  'lt-neon': {
    en: { name: 'Rezan "Night Owl" Ali', role: 'Resident DJ and producer, Erbil Underground' },
    ar: { name: 'ريزان علي', role: 'دي جي ومنتج موسيقي مقيم في نادي أربيل' },
  },
  'ui-notify': {
    en: { items: "Message from Dr. Karim: Can we move tomorrow's lecture to the large hall?\nPayment received: 45,000 IQD from Lana Aziz for the workshop\nCalendar reminder: Faculty meeting in Room 204 starts in 15 minutes" },
    ar: { items: 'رسالة من د. كريم: هل يمكن نقل محاضرة الغد إلى القاعة الكبرى؟\nتم استلام دفعة: 45000 دينار من لانا عزيز لورشة العمل\nتذكير: اجتماع الكلية في القاعة 204 بعد 15 دقيقة' },
  },
  'ui-scribble': {
    en: { word: 'Limited edition', label: 'Only 200 made, signed by the artist' },
    ar: { word: 'إصدار محدود', label: 'مئتا نسخة فقط موقعة من الفنان' },
  },
  'ui-chat': {
    en: { name: 'Lana Aziz', items: 'Lana: Hey! Are you still coming to the book launch at the gallery tonight?\nMe: Yes, of course! I just need to finish this report first.\nLana: Great, doors open at 7 and the reading starts at 8 sharp\nMe: Should I bring anything? Flowers, snacks, a friend?\nLana: Just yourself, and maybe your camera for the photos\nMe: Perfect, see you there. Save me a seat near the front!' },
    ar: { name: 'لانا عزيز', items: 'لانا: مرحباً! هل ما زلت قادماً إلى حفل إطلاق الكتاب في المعرض الليلة؟\nأنا: نعم بالتأكيد! عليّ فقط أن أنهي هذا التقرير أولاً.\nلانا: رائع، الأبواب تفتح في السابعة والقراءة تبدأ في الثامنة تماماً\nأنا: هل أحضر شيئاً معي؟ ورداً أو حلوى أو صديقاً؟\nلانا: أحضر نفسك فقط، وربما الكاميرا لالتقاط الصور\nأنا: ممتاز، أراك هناك. احجز لي مقعداً في الأمام!' },
  },
  'ui-device': {
    en: { title: 'Your entire studio, edited and shared from your pocket', subtitle: 'Cut, colour, caption and export full HD video on the bus, at home or on set', screen: 'Noor Studio Pro' },
    ar: { title: 'استوديوك الكامل في جيبك، تحرير ومشاركة من أي مكان', subtitle: 'قص ولوّن وأضف الترجمة وصدّر فيديو عالي الدقة في الحافلة أو البيت أو موقع التصوير', screen: 'نور ستوديو برو' },
  },
  'film-look': {
    en: { caption: 'Summer of 1998, the road to Amedi' },
    ar: { caption: 'صيف 1998، الطريق إلى العمادية' },
  },
  'bar-race': {
    en: {
      title: 'Most visited cities in Kurdistan, 2015 to 2024',
      items: 'Erbil: 120, 180, 210, 260, 300, 350, 410, 450, 520, 600\nSulaymaniyah: 140, 170, 230, 250, 280, 330, 360, 420, 470, 540\nDuhok: 60, 90, 120, 170, 220, 260, 330, 390, 430, 510\nHalabja: 20, 30, 45, 60, 80, 95, 120, 140, 170, 210\nZakho: 40, 55, 70, 90, 110, 140, 160, 190, 230, 260\nAmedi: 15, 25, 50, 70, 100, 130, 170, 210, 250, 300\nAkre: 10, 20, 30, 45, 60, 70, 85, 100, 120, 150\nRanya: 25, 35, 40, 55, 65, 80, 90, 105, 115, 130\nSoran: 30, 40, 60, 75, 90, 120, 140, 150, 160, 190\nKoya: 18, 22, 28, 35, 44, 50, 61, 70, 82, 95',
      periods: '2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024', unit: 'k',
    },
    ar: {
      title: 'أكثر مدن كوردستان زيارة من 2015 إلى 2024',
      items: 'أربيل: 120, 180, 210, 260, 300, 350, 410, 450, 520, 600\nالسليمانية: 140, 170, 230, 250, 280, 330, 360, 420, 470, 540\nدهوك: 60, 90, 120, 170, 220, 260, 330, 390, 430, 510\nحلبجة: 20, 30, 45, 60, 80, 95, 120, 140, 170, 210\nزاخو: 40, 55, 70, 90, 110, 140, 160, 190, 230, 260\nالعمادية: 15, 25, 50, 70, 100, 130, 170, 210, 250, 300\nعقرة: 10, 20, 30, 45, 60, 70, 85, 100, 120, 150\nرانية: 25, 35, 40, 55, 65, 80, 90, 105, 115, 130\nسوران: 30, 40, 60, 75, 90, 120, 140, 150, 160, 190\nكويه: 18, 22, 28, 35, 44, 50, 61, 70, 82, 95',
      periods: '2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024', unit: 'ألف',
    },
  },
  timeline: {
    en: { title: "Twenty years of the Children's Library", items: '2004: Opened in a borrowed classroom with 300 books\n2008: Our first mobile library bus\n2012: A new building donated by the city\n2016: Reading clubs in forty villages\n2020: Every book online during the lockdown\n2024: One million books lent to children' },
    ar: { title: 'عشرون عاماً من مكتبة الأطفال', items: '2004: افتتحت في صف مستعار ومعها 300 كتاب\n2008: أول حافلة مكتبة متنقلة\n2012: مبنى جديد تبرعت به المدينة\n2016: نوادي قراءة في أربعين قرية\n2020: كل الكتب على الإنترنت أثناء الإغلاق\n2024: مليون كتاب أعير للأطفال' },
  },
  compare: {
    en: { before: 'Before the new system', beforeText: 'Paper forms, three offices and a two-week wait for one signature', after: 'After the new system', afterText: 'One form on your phone and an answer before the end of the day' },
    ar: { before: 'قبل النظام الجديد', beforeText: 'استمارات ورقية وثلاثة مكاتب وانتظار أسبوعين من أجل توقيع واحد', after: 'بعد النظام الجديد', afterText: 'استمارة واحدة على هاتفك وجواب قبل نهاية اليوم' },
  },
  'price-card': {
    en: { plan: 'Business Unlimited', price: '$1,249/year', features: 'Unlimited projects and team members\nExport in 4K with your own fonts\nPriority support around the clock\nShared brand kits for every client', button: 'Start your 30-day trial' },
    ar: { plan: 'الأعمال غير المحدودة', price: '1249$/سنوياً', features: 'مشاريع وأعضاء فريق بلا حدود\nتصدير بدقة 4K بخطوطك الخاصة\nدعم ذو أولوية على مدار الساعة\nهويات بصرية مشتركة لكل عميل', button: 'ابدأ تجربة 30 يوماً' },
  },
  'progress-stats': {
    en: { title: 'How the spring term went across all six schools', items: 'Attendance across the term: 92%\nHomework handed in on time: 78%\nStudents who passed every exam: 85%\nGroup projects finished: 64%' },
    ar: { title: 'كيف مضى الفصل الربيعي في المدارس الست', items: 'الحضور طوال الفصل: 92%\nالواجبات المسلّمة في وقتها: 78%\nالطلاب الناجحون في كل الامتحانات: 85%\nالمشاريع الجماعية المنجزة: 64%' },
  },
  'retro-title': {
    en: { title: 'Saturday Night Cinema Club', subtitle: 'Classic films, live music and popcorn from 9 pm' },
    ar: { title: 'نادي سينما ليلة السبت', subtitle: 'أفلام كلاسيكية وموسيقى حية وفشار من التاسعة مساءً' },
  },
};
