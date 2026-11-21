import express from 'express';
import { db, newId, nowIso, auditLog } from './db.js';
import { requireAuth, requireAdmin, requireSuperAdmin } from './auth.js';
import { accessFor } from './access.js';

/**
 * Islamic quiz.
 *
 * Two rules shape this module:
 *  - Every answer key stays on the server. The client receives questions and
 *    options only, so a score cannot be manufactured in the browser.
 *  - Every question carries a real reference (a Qur'an ayah or a hadith number
 *    in an agreed-upon collection). Nothing here is invented: where a point is
 *    a matter of well-known practice rather than a specific narration, the
 *    reference says so instead of inventing a citation.
 */
export const quizRouter = express.Router();
export const quizAdminRouter = express.Router();

const LANGS = ['en', 'ar', 'so'];
const CATEGORIES = ['quran', 'hadith', 'prophets', 'history', 'worship'];

const langIndex = (lang) => {
  const i = LANGS.indexOf(String(lang || 'en').toLowerCase());
  return i === -1 ? 0 : i;
};
const pick = (arr, i) => (Array.isArray(arr) && (arr[i] || arr[0])) || '';

/** [en, ar, so] triples keep the bank compact and the translations together. */
export const QUIZ_BANK = [
  {
    id: 'surah-count', category: 'quran', level: 1, reference: 'Qur’an — 114 surahs',
    question: ['How many surahs are in the Qur’an?', 'كم عدد سور القرآن الكريم؟', 'Immisa suurad ayuu Qur’aanku ka kooban yahay?'],
    options: [['99', '٩٩', '99'], ['110', '١١٠', '110'], ['114', '١١٤', '114'], ['120', '١٢٠', '120']],
    answer: 2,
    explanation: ['The Qur’an has 114 surahs.', 'القرآن الكريم ١١٤ سورة.', 'Qur’aanku wuxuu leeyahay 114 suurad.'],
  },
  {
    id: 'first-surah', category: 'quran', level: 1, reference: 'Qur’an 1:1',
    question: ['Which surah opens the Qur’an?', 'ما أول سورة في القرآن؟', 'Suuraddee ayaa Qur’aanka ka horraysa?'],
    options: [['Al-Baqarah', 'البقرة', 'Al-Baqarah'], ['Al-Fatihah', 'الفاتحة', 'Al-Faatixah'], ['An-Nas', 'الناس', 'An-Naas'], ['Al-Ikhlas', 'الإخلاص', 'Al-Ikhlaas']],
    answer: 1,
    explanation: ['Al-Fatihah is the opening surah of the Qur’an.', 'الفاتحة هي أول سورة في القرآن.', 'Al-Faatixah waa suuradda ugu horraysa Qur’aanka.'],
  },
  {
    id: 'longest-surah', category: 'quran', level: 1, reference: 'Qur’an 2 (286 ayat)',
    question: ['Which is the longest surah?', 'ما أطول سورة في القرآن؟', 'Suuraddee ayaa ugu dheer?'],
    options: [['Al-Baqarah', 'البقرة', 'Al-Baqarah'], ['An-Nisa', 'النساء', 'An-Nisaa'], ['Al-Imran', 'آل عمران', 'Aal Cimraan'], ['Al-Araf', 'الأعراف', 'Al-Acraaf']],
    answer: 0,
    explanation: ['Al-Baqarah has 286 ayat and is the longest surah.', 'البقرة أطول سورة وفيها ٢٨٦ آية.', 'Al-Baqarah waa suuradda ugu dheer waxayna leedahay 286 aayad.'],
  },
  {
    id: 'juz-count', category: 'quran', level: 2, reference: 'Qur’an — 30 juz',
    question: ['Into how many juz is the Qur’an divided?', 'إلى كم جزءًا يُقسم القرآن؟', 'Immisa juz ayaa Qur’aanka loo qaybiyay?'],
    options: [['20', '٢٠', '20'], ['25', '٢٥', '25'], ['30', '٣٠', '30'], ['40', '٤٠', '40']],
    answer: 2,
    explanation: ['The Qur’an is divided into 30 juz.', 'يُقسم القرآن إلى ثلاثين جزءًا.', 'Qur’aanka waxaa loo qaybiyay 30 juz.'],
  },
  {
    id: 'fatihah-prayer', category: 'quran', level: 2, reference: 'Sahih al-Bukhari 756',
    question: ['Which surah is recited in every unit of prayer?', 'ما السورة التي تُقرأ في كل ركعة؟', 'Suuraddee ayaa lagu akhriyaa rakcad kasta?'],
    options: [['Al-Fatihah', 'الفاتحة', 'Al-Faatixah'], ['Al-Ikhlas', 'الإخلاص', 'Al-Ikhlaas'], ['Al-Kawthar', 'الكوثر', 'Al-Kawthar'], ['Yasin', 'يس', 'Yaasiin']],
    answer: 0,
    explanation: ['The Prophet ﷺ said there is no prayer for one who does not recite the Opening of the Book.', 'قال النبي ﷺ: لا صلاة لمن لم يقرأ بفاتحة الكتاب.', 'Nabigu ﷺ wuxuu yiri: ma jirto salaad qof aan akhrin Al-Faatixah.'],
  },
  {
    id: 'qadr-night', category: 'quran', level: 2, reference: 'Qur’an 97:3',
    question: ['Which night is described as better than a thousand months?', 'أي ليلة هي خير من ألف شهر؟', 'Habeenkee ayaa ka khayr badan kun bilood?'],
    options: [['Laylat al-Miraj', 'ليلة المعراج', 'Laylat al-Mirac'], ['Laylat al-Qadr', 'ليلة القدر', 'Laylat al-Qadr'], ['Laylat al-Bara’ah', 'ليلة البراءة', 'Laylat al-Baraa’ah'], ['The first night of Rajab', 'أول ليلة من رجب', 'Habeenka koowaad ee Rajab']],
    answer: 1,
    explanation: ['Allah says the Night of Decree is better than a thousand months.', 'قال تعالى إن ليلة القدر خير من ألف شهر.', 'Alle wuxuu yiri Laylat al-Qadr waa ka khayr badan kun bilood.'],
  },
  {
    id: 'maidah-perfected', category: 'quran', level: 3, reference: 'Qur’an 5:3',
    question: ['Which surah contains “This day I have perfected for you your religion”?', 'أي سورة فيها: اليوم أكملت لكم دينكم؟', 'Suuraddee ayaa ku jirta “Maanta diintiinnii u dhammeeyay”?'],
    options: [['Al-Ma’idah', 'المائدة', 'Al-Maa’idah'], ['An-Nur', 'النور', 'An-Nuur'], ['Al-Hajj', 'الحج', 'Al-Xajj'], ['Al-An’am', 'الأنعام', 'Al-Ancaam']],
    answer: 0,
    explanation: ['This ayah is in Surah al-Ma’idah (5:3).', 'هذه الآية في سورة المائدة.', 'Aayaddan waxay ku jirtaa Suuradda Al-Maa’idah (5:3).'],
  },
  {
    id: 'maryam-surah', category: 'quran', level: 3, reference: 'Qur’an 19',
    question: ['Which surah is named after a woman?', 'أي سورة سُميت باسم امرأة؟', 'Suuraddee ayaa loogu magac daray naag?'],
    options: [['Maryam', 'مريم', 'Maryam'], ['Khadijah', 'خديجة', 'Khadijah'], ['Aisha', 'عائشة', 'Caa’ishah'], ['Asiya', 'آسية', 'Aasiyah']],
    answer: 0,
    explanation: ['Surah Maryam is the only surah named after a woman.', 'سورة مريم هي السورة الوحيدة المسماة باسم امرأة.', 'Suuradda Maryam waa tan kaliya ee loogu magac daray naag.'],
  },
  {
    id: 'naml-bismillah', category: 'quran', level: 3, reference: 'Qur’an 27:30',
    question: ['In which surah does the Bismillah appear inside a verse?', 'في أي سورة توجد البسملة داخل آية؟', 'Suuraddee ayuu Bismillah ku dhex jiraa aayad?'],
    options: [['An-Naml', 'النمل', 'An-Naml'], ['Al-Fatihah', 'الفاتحة', 'Al-Faatixah'], ['Hud', 'هود', 'Huud'], ['Yunus', 'يونس', 'Yuunus']],
    answer: 0,
    explanation: ['Surah an-Naml (27:30) quotes the Bismillah within the letter of Sulayman.', 'سورة النمل فيها البسملة ضمن كتاب سليمان.', 'Suuradda An-Naml (27:30) waxay ku jirtaa Bismillah warqadda Sulaymaan.'],
  },
  {
    id: 'pillars-islam', category: 'worship', level: 1, reference: 'Sahih al-Bukhari 8',
    question: ['How many pillars of Islam are there?', 'كم عدد أركان الإسلام؟', 'Immisa tiir ayaa Islaamku leeyahay?'],
    options: [['3', '٣', '3'], ['5', '٥', '5'], ['6', '٦', '6'], ['7', '٧', '7']],
    answer: 1,
    explanation: ['Islam is built on five: shahadah, prayer, zakat, fasting and Hajj.', 'بُني الإسلام على خمس: الشهادة والصلاة والزكاة والصوم والحج.', 'Islaamku wuxuu ku dhisan yahay shan: shahaadada, salaadda, sakada, soonka iyo Xajka.'],
  },
  {
    id: 'fajr-rakah', category: 'worship', level: 1, reference: 'Qur’an 17:78; established Sunnah',
    question: ['How many obligatory rak‘ah are in Fajr?', 'كم عدد ركعات الفرض في صلاة الفجر؟', 'Immisa rakcad oo waajib ah ayaa Fajr ku jira?'],
    options: [['2', '٢', '2'], ['3', '٣', '3'], ['4', '٤', '4'], ['5', '٥', '5']],
    answer: 0,
    explanation: ['Fajr has two obligatory rak‘ah.', 'صلاة الفجر ركعتان فرضًا.', 'Fajr waxay leedahay laba rakcad oo waajib ah.'],
  },
  {
    id: 'ramadan-fasting', category: 'worship', level: 1, reference: 'Qur’an 2:185',
    question: ['In which month is fasting obligatory?', 'في أي شهر يجب الصيام؟', 'Bishii kee ayaa soonku waajib ku yahay?'],
    options: [['Sha’ban', 'شعبان', 'Shaabaan'], ['Rajab', 'رجب', 'Rajab'], ['Ramadan', 'رمضان', 'Ramadaan'], ['Shawwal', 'شوال', 'Shawwaal']],
    answer: 2,
    explanation: ['Allah prescribed fasting in the month of Ramadan.', 'قال تعالى: شهر رمضان الذي أُنزل فيه القرآن.', 'Alle wuxuu soonka waajib ka dhigay bisha Ramadaan.'],
  },
  {
    id: 'qibla-name', category: 'worship', level: 2, reference: 'Qur’an 2:144',
    question: ['What is the direction of prayer toward the Ka‘bah called?', 'ماذا يُسمى اتجاه الصلاة نحو الكعبة؟', 'Maxaa loo yaqaan jihada salaadda xagga Kacbada?'],
    options: [['Qibla', 'القبلة', 'Qiblah'], ['Mihrab', 'المحراب', 'Mixraab'], ['Minbar', 'المنبر', 'Minbar'], ['Sutrah', 'السترة', 'Sutrah']],
    answer: 0,
    explanation: ['The direction of prayer is the Qibla.', 'اتجاه الصلاة هو القبلة.', 'Jihada salaaddu waa Qiblah.'],
  },
  {
    id: 'zakat-rate', category: 'worship', level: 2, reference: 'Fiqh: one fortieth (1/40)',
    question: ['What is the zakat rate on cash held for a lunar year?', 'ما مقدار الزكاة في النقود بعد حولان الحول؟', 'Waa immisa sakada lacagta sanad dayaxeed la hayo?'],
    options: [['1%', '١٪', '1%'], ['2.5%', '٢٫٥٪', '2.5%'], ['5%', '٥٪', '5%'], ['10%', '١٠٪', '10%']],
    answer: 1,
    explanation: ['Zakat on cash is one fortieth, i.e. 2.5%, once nisab is held for a lunar year.', 'زكاة النقود ربع العشر أي ٢٫٥٪ إذا بلغت النصاب وحال عليها الحول.', 'Sakada lacagtu waa rubuc tobnaad, yacni 2.5%, marka nisaabka la gaaro sanad dayaxeed.'],
  },
  {
    id: 'iman-pillars', category: 'worship', level: 2, reference: 'Sahih Muslim 8',
    question: ['How many pillars of faith (iman) are there?', 'كم عدد أركان الإيمان؟', 'Immisa tiir ayaa iimaanku leeyahay?'],
    options: [['4', '٤', '4'], ['5', '٥', '5'], ['6', '٦', '6'], ['8', '٨', '8']],
    answer: 2,
    explanation: ['Faith is belief in Allah, His angels, books, messengers, the Last Day and divine decree.', 'الإيمان أن تؤمن بالله وملائكته وكتبه ورسله واليوم الآخر والقدر.', 'Iimaanku waa rumaysad Alle, malaa’igtiisa, kutubtiisa, rasuulladiisa, Maalinta Dambe iyo qadarka.'],
  },
  {
    id: 'hajj-count', category: 'worship', level: 3, reference: 'Sahih Muslim 1337',
    question: ['How many times did the Prophet ﷺ perform Hajj?', 'كم مرة حج النبي ﷺ؟', 'Immisa jeer ayuu Nabigu ﷺ Xajka gudanay?'],
    options: [['Once', 'مرة واحدة', 'Hal mar'], ['Twice', 'مرتين', 'Laba jeer'], ['Three times', 'ثلاث مرات', 'Saddex jeer'], ['Every year', 'كل سنة', 'Sannad kasta']],
    answer: 0,
    explanation: ['He performed Hajj once, the Farewell Hajj.', 'حج النبي ﷺ حجة واحدة هي حجة الوداع.', 'Wuxuu Xajka gudanay hal mar, kaas oo ahaa Xajka Sagootiga.'],
  },
  {
    id: 'intentions', category: 'hadith', level: 1, reference: 'Sahih al-Bukhari 1; Sahih Muslim 1907',
    question: ['“Actions are judged by …” — complete the hadith.', '«إنما الأعمال بـ…» أكمل الحديث.', '“Ficillada waxaa lagu qiimeeyaa …” buuxi xadiiska.'],
    options: [['their length', 'طولها', 'dhererkooda'], ['intentions', 'النيات', 'niyadaha'], ['their number', 'عددها', 'tiradooda'], ['their time', 'وقتها', 'waqtigooda']],
    answer: 1,
    explanation: ['“Actions are judged by intentions, and every person will have what he intended.”', '«إنما الأعمال بالنيات، وإنما لكل امرئ ما نوى».', '“Ficillada waxaa lagu qiimeeyaa niyadaha, qof kastana wuxuu helaa wixii uu niyadeeyay.”'],
  },
  {
    id: 'brother-love', category: 'hadith', level: 1, reference: 'Sahih al-Bukhari 13; Sahih Muslim 45',
    question: ['“None of you truly believes until he loves for his brother …”', '«لا يؤمن أحدكم حتى يحب لأخيه…»', '“Midkiinna ma rumaysna ilaa uu walaalkiis u jecel yahay …”'],
    options: [['what he loves for himself', 'ما يحبه لنفسه', 'waxa uu naftiisa u jecel yahay'], ['more wealth', 'زيادة المال', 'maal dheeraad ah'], ['a long life', 'طول العمر', 'cimri dheer'], ['good health', 'الصحة', 'caafimaad']],
    answer: 0,
    explanation: ['He loves for his brother what he loves for himself.', 'أي ما يحبه لنفسه.', 'Waxa uu naftiisa u jecel yahay.'],
  },
  {
    id: 'purity-half', category: 'hadith', level: 2, reference: 'Sahih Muslim 223',
    question: ['“Purity is half of …” — complete the hadith.', '«الطهور شطر…» أكمل الحديث.', '“Nadaafaddu waa badh …” buuxi xadiiska.'],
    options: [['faith', 'الإيمان', 'iimaanka'], ['charity', 'الصدقة', 'sadaqada'], ['prayer', 'الصلاة', 'salaadda'], ['patience', 'الصبر', 'samirka']],
    answer: 0,
    explanation: ['“Purity is half of faith.”', '«الطهور شطر الإيمان».', '“Nadaafaddu waa badh iimaanka.”'],
  },
  {
    id: 'best-quran', category: 'hadith', level: 2, reference: 'Sahih al-Bukhari 5027',
    question: ['“The best of you are those who …” — complete the hadith.', '«خيركم من…» أكمل الحديث.', '“Kiinna ugu khayr badan waa kan …” buuxi xadiiska.'],
    options: [['fast the most', 'أكثر الصيام', 'ugu soon badan'], ['learn the Qur’an and teach it', 'تعلّم القرآن وعلّمه', 'barta Qur’aanka oo baraa'], ['give the most charity', 'أكثر الصدقة', 'ugu sadaqo badan'], ['travel the most', 'أكثر السفر', 'ugu safar badan']],
    answer: 1,
    explanation: ['“The best of you are those who learn the Qur’an and teach it.”', '«خيركم من تعلم القرآن وعلمه».', '“Kiinna ugu khayr badan waa kan barta Qur’aanka oo baraa dadka.”'],
  },
  {
    id: 'speak-good', category: 'hadith', level: 3, reference: 'Sahih al-Bukhari 6018',
    question: ['“Whoever believes in Allah and the Last Day, let him …”', '«من كان يؤمن بالله واليوم الآخر فليقل…»', '“Kii rumaysan Alle iyo Maalinta Dambe, ha …”'],
    options: [['speak good or remain silent', 'خيرًا أو ليصمت', 'hadlo wanaag ama aamusnaado'], ['speak loudly', 'يرفع صوته', 'cod dheer yeelo'], ['speak often', 'يكثر الكلام', 'badan hadlo'], ['stay at home', 'يلزم بيته', 'guriga joogo']],
    answer: 0,
    explanation: ['He should speak good or remain silent.', 'فليقل خيرًا أو ليصمت.', 'Waa inuu hadlaa wanaag ama aamusnaadaa.'],
  },
  {
    id: 'first-prophet', category: 'prophets', level: 1, reference: 'Qur’an 2:30; Sahih al-Bukhari 3198',
    question: ['Who was the first prophet?', 'من أول الأنبياء؟', 'Yaa ahaa nabigii ugu horreeyay?'],
    options: [['Nuh', 'نوح', 'Nuux'], ['Adam', 'آدم', 'Aadam'], ['Ibrahim', 'إبراهيم', 'Ibraahiim'], ['Musa', 'موسى', 'Muuse']],
    answer: 1,
    explanation: ['Adam was the first prophet and the first human.', 'آدم أول الأنبياء وأول البشر.', 'Aadam waa nabigii ugu horreeyay iyo dadkii ugu horreeyay.'],
  },
  {
    id: 'kaaba-build', category: 'prophets', level: 1, reference: 'Qur’an 2:127',
    question: ['Who built the Ka‘bah together with Ibrahim?', 'من بنى الكعبة مع إبراهيم؟', 'Yaa Kacbada la dhisay Ibraahiim?'],
    options: [['Isma‘il', 'إسماعيل', 'Ismaaciil'], ['Ishaq', 'إسحاق', 'Isxaaq'], ['Yaqub', 'يعقوب', 'Yacquub'], ['Yusuf', 'يوسف', 'Yuusuf']],
    answer: 0,
    explanation: ['Ibrahim and his son Isma‘il raised the foundations of the House.', 'رفع إبراهيم وإسماعيل القواعد من البيت.', 'Ibraahiim iyo wiilkiis Ismaaciil ayaa saldhigyada guriga kor u qaaday.'],
  },
  {
    id: 'tawrah', category: 'prophets', level: 2, reference: 'Qur’an 5:44',
    question: ['Which prophet was given the Tawrah?', 'من النبي الذي أُوتي التوراة؟', 'Nabi kee ayaa la siiyay Tawreed?'],
    options: [['Musa', 'موسى', 'Muuse'], ['Isa', 'عيسى', 'Ciise'], ['Dawud', 'داود', 'Daawuud'], ['Sulayman', 'سليمان', 'Sulaymaan']],
    answer: 0,
    explanation: ['The Tawrah was revealed to Musa.', 'أُنزلت التوراة على موسى.', 'Tawreed waxaa loo soo waxyooday Muuse.'],
  },
  {
    id: 'injil', category: 'prophets', level: 2, reference: 'Qur’an 5:46',
    question: ['Which prophet was given the Injil?', 'من النبي الذي أُوتي الإنجيل؟', 'Nabi kee ayaa la siiyay Injiil?'],
    options: [['Isa', 'عيسى', 'Ciise'], ['Musa', 'موسى', 'Muuse'], ['Yahya', 'يحيى', 'Yaxya'], ['Zakariya', 'زكريا', 'Zakariya']],
    answer: 0,
    explanation: ['The Injil was given to Isa son of Maryam.', 'أُوتي عيسى ابن مريم الإنجيل.', 'Injiil waxaa la siiyay Ciise bin Maryam.'],
  },
  {
    id: 'zabur', category: 'prophets', level: 3, reference: 'Qur’an 17:55',
    question: ['Which prophet was given the Zabur?', 'من النبي الذي أُوتي الزبور؟', 'Nabi kee ayaa la siiyay Zabuur?'],
    options: [['Dawud', 'داود', 'Daawuud'], ['Sulayman', 'سليمان', 'Sulaymaan'], ['Ayyub', 'أيوب', 'Ayyuub'], ['Yunus', 'يونس', 'Yuunus']],
    answer: 0,
    explanation: ['Allah gave Dawud the Zabur.', 'قال تعالى: وآتينا داود زبورًا.', 'Alle wuxuu Daawuud siiyay Zabuur.'],
  },
  {
    id: 'hijrah-year', category: 'history', level: 1, reference: '622 CE',
    question: ['In which year CE did the Hijrah to Madinah take place?', 'في أي سنة ميلادية كانت الهجرة إلى المدينة؟', 'Sannadkee miilaadi ah ayaa Hijradu Madina dhacday?'],
    options: [['570 CE', '٥٧٠م', '570 CE'], ['610 CE', '٦١٠م', '610 CE'], ['622 CE', '٦٢٢م', '622 CE'], ['632 CE', '٦٣٢م', '632 CE']],
    answer: 2,
    explanation: ['The Hijrah took place in 622 CE, the start of the Hijri calendar.', 'كانت الهجرة سنة ٦٢٢م وهي بداية التقويم الهجري.', 'Hijradu waxay dhacday 622 CE, waana bilowga kalandarka Hijriga.'],
  },
  {
    id: 'first-caliph', category: 'history', level: 1, reference: 'Well-attested history',
    question: ['Who was the first caliph after the Prophet ﷺ?', 'من أول الخلفاء بعد النبي ﷺ؟', 'Yaa ahaa khaliifkii ugu horreeyay Nabiga ﷺ ka dib?'],
    options: [['Abu Bakr', 'أبو بكر', 'Abu Bakr'], ['Umar', 'عمر', 'Cumar'], ['Uthman', 'عثمان', 'Cuthmaan'], ['Ali', 'علي', 'Cali']],
    answer: 0,
    explanation: ['Abu Bakr as-Siddiq led the community first.', 'أبو بكر الصديق أول الخلفاء.', 'Abu Bakr as-Siddiiq ayaa ugu horreeyay.'],
  },
  {
    id: 'badr-year', category: 'history', level: 2, reference: '2 AH',
    question: ['In which year AH was the Battle of Badr?', 'في أي سنة هجرية كانت غزوة بدر؟', 'Sannadkee Hijri ah ayaa dagaalkii Badar dhacay?'],
    options: [['1 AH', '١هـ', '1 AH'], ['2 AH', '٢هـ', '2 AH'], ['5 AH', '٥هـ', '5 AH'], ['8 AH', '٨هـ', '8 AH']],
    answer: 1,
    explanation: ['Badr took place in 2 AH.', 'كانت بدر في السنة الثانية للهجرة.', 'Badar waxay dhacday 2 AH.'],
  },
  {
    id: 'hudaybiyyah', category: 'history', level: 3, reference: '6 AH; Qur’an 48',
    question: ['Which treaty was concluded in 6 AH?', 'أي صلح عُقد في السنة السادسة للهجرة؟', 'Heshiis kee ayaa la galay 6 AH?'],
    options: [['Treaty of Hudaybiyyah', 'صلح الحديبية', 'Heshiiskii Xudaybiyah'], ['Treaty of Aqabah', 'بيعة العقبة', 'Beycada Caqabah'], ['Treaty of Madinah', 'صحيفة المدينة', 'Heshiiskii Madina'], ['Treaty of Tabuk', 'غزوة تبوك', 'Tabuuk']],
    answer: 0,
    explanation: ['The treaty of Hudaybiyyah was concluded in 6 AH.', 'عُقد صلح الحديبية في السنة السادسة للهجرة.', 'Heshiiskii Xudaybiyah waxaa la galay 6 AH.'],
  },
  {
    id: 'sayfullah', category: 'history', level: 3, reference: 'Well-attested history',
    question: ['Which companion was known as “the sword of Allah”?', 'من الصحابي الملقب بسيف الله؟', 'Saxaabi kee ayaa loo yaqaan “seefka Alle”?'],
    options: [['Khalid ibn al-Walid', 'خالد بن الوليد', 'Khaalid bin Waliid'], ['Sa’d ibn Abi Waqqas', 'سعد بن أبي وقاص', 'Sacd bin Abi Waqqaas'], ['Amr ibn al-As', 'عمرو بن العاص', 'Camr bin Al-Caas'], ['Abu Ubaydah', 'أبو عبيدة', 'Abu Cubaydah']],
    answer: 0,
    explanation: ['Khalid ibn al-Walid was called Sayfullah.', 'خالد بن الوليد لُقّب بسيف الله.', 'Khaalid bin Waliid waxaa loo yaqaan Sayfullah.'],
  },
];

function seedQuestions() {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM quiz_questions').get();
  if (n > 0) return;
  const insert = db.prepare(
    `INSERT INTO quiz_questions (id, category, level, reference, question, options, answer, explanation, active, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  );
  for (const q of QUIZ_BANK) {
    insert.run(
      q.id,
      q.category,
      q.level,
      q.reference,
      JSON.stringify(q.question),
      JSON.stringify(q.options),
      q.answer,
      JSON.stringify(q.explanation),
      1,
      nowIso()
    );
  }
  console.log(`[quiz] seeded ${QUIZ_BANK.length} verified questions`);
}
seedQuestions();

function clientQuestion(row, lang) {
  const i = langIndex(lang);
  return {
    id: row.id,
    category: row.category,
    level: row.level,
    question: pick(JSON.parse(row.question), i),
    options: JSON.parse(row.options).map((option) => pick(option, i)),
  };
}

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* ------------------------------- player API ------------------------------- */

quizRouter.get('/bank', (req, res) => {
  const level = Number(req.query.level) || 0;
  const category = String(req.query.category || 'all');
  const limit = Math.min(40, Math.max(1, Number(req.query.limit) || 10));

  const rows = db
    .prepare('SELECT * FROM quiz_questions WHERE active = 1')
    .all()
    .filter((row) => (level ? row.level === level : true))
    .filter((row) => (category === 'all' ? true : row.category === category));

  const questions = [...rows]
    .filter((row) => accessFor(req, `quiz.category.${row.category}`).allowed)
    .filter((row) => accessFor(req, `quiz.level.${row.level}`).allowed)
    .sort(() => Math.random() - 0.5)
    .slice(0, limit);
  res.json({ questions: questions.map((row) => clientQuestion(row, req.query.lang)), total: rows.length });
});

quizRouter.get('/daily', (req, res) => {
  const date = String(req.query.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const rows = db.prepare('SELECT * FROM quiz_questions WHERE active = 1').all();
  const chosen = rows
    .map((row) => ({ row, h: hash(`${row.id}:${date}`) }))
    .sort((a, b) => a.h - b.h)
    .slice(0, 5)
    .map((entry) => entry.row);

  res.json({ date, questions: chosen.map((row) => clientQuestion(row, req.query.lang)) });
});

quizRouter.post('/submit', (req, res) => {
  const answers = Array.isArray(req.body?.answers) ? req.body.answers.slice(0, 40) : [];
  if (answers.length === 0) return res.status(400).json({ error: 'No answers were submitted.' });

  const lang = langIndex(req.body?.lang);
  const results = [];
  let score = 0;

  for (const entry of answers) {
    const row = db.prepare('SELECT * FROM quiz_questions WHERE id = ?').get(String(entry?.id || ''));
    if (!row) continue;
    const picked = Number(entry?.picked);
    const correct = picked === row.answer;
    if (correct) score += 1;
    results.push({
      id: row.id,
      correct,
      picked: Number.isInteger(picked) ? picked : null,
      answer: row.answer,
      reference: row.reference,
      question: pick(JSON.parse(row.question), lang),
      options: JSON.parse(row.options).map((option) => pick(option, lang)),
      explanation: pick(JSON.parse(row.explanation), lang),
    });
  }

  const total = results.length;
  if (total === 0) return res.status(400).json({ error: 'None of the submitted questions exist.' });
  const percent = Math.round((score / total) * 100);

  let saved = false;
  if (req.user) {
    db.prepare(
      `INSERT INTO quiz_results (id, user_id, category, level, score, total, percent, duration_sec, mode, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(
      newId(),
      req.user.id,
      String(req.body?.category || 'mixed').slice(0, 20),
      Number(req.body?.level) || 0,
      score,
      total,
      percent,
      Math.min(3600, Math.max(0, Number(req.body?.durationSec) || 0)),
      String(req.body?.mode || 'practice').slice(0, 12),
      nowIso()
    );
    saved = true;
  }

  res.json({ score, total, percent, results, saved });
});

quizRouter.get('/history', requireAuth, (req, res) => {
  const rows = db
    .prepare('SELECT * FROM quiz_results WHERE user_id = ? ORDER BY created_at DESC LIMIT 20')
    .all(req.user.id);
  const stats = db
    .prepare(
      `SELECT COUNT(*) AS rounds, COALESCE(MAX(percent), 0) AS best, COALESCE(ROUND(AVG(percent)), 0) AS average
         FROM quiz_results WHERE user_id = ?`
    )
    .get(req.user.id);

  res.json({
    history: rows.map((row) => ({
      id: row.id,
      category: row.category,
      level: row.level,
      score: row.score,
      total: row.total,
      percent: row.percent,
      durationSec: row.duration_sec,
      mode: row.mode,
      createdAt: row.created_at,
    })),
    stats: { rounds: stats.rounds, best: stats.best, average: stats.average },
  });
});

/* -------------------------------- admin API ------------------------------- */

quizAdminRouter.use(requireAdmin);

function normalizeQuestion(input = {}) {
  const category = CATEGORIES.includes(input.category) ? input.category : null;
  if (!category) throw new Error(`Category must be one of: ${CATEGORIES.join(', ')}.`);
  const level = Number(input.level);
  if (![1, 2, 3].includes(level)) throw new Error('Level must be 1 (beginner), 2 or 3 (advanced).');

  const question = Array.isArray(input.question)
    ? input.question.map((value) => String(value || '').trim()).slice(0, 3)
    : [String(input.question || '').trim()];
  if (!question[0]) throw new Error('The English question text is required.');

  const options = (Array.isArray(input.options) ? input.options : []).map((option) =>
    Array.isArray(option)
      ? option.map((value) => String(value || '').trim()).slice(0, 3)
      : [String(option || '').trim()]
  );
  if (options.length < 2 || options.some((option) => !option[0])) {
    throw new Error('At least two options with text are required.');
  }

  const answer = Number(input.answer);
  if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) {
    throw new Error('The correct answer index must point at one of the options.');
  }

  const reference = String(input.reference || '').trim();
  if (!reference) throw new Error('A verifiable reference (ayah or hadith number) is required.');

  const explanation = Array.isArray(input.explanation)
    ? input.explanation.map((value) => String(value || '').trim()).slice(0, 3)
    : [String(input.explanation || '').trim()];

  return {
    id: String(input.id || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 60) || `q-${newId().slice(0, 8)}`,
    category,
    level,
    reference,
    question,
    options,
    answer,
    explanation,
    active: input.active === false || input.active === 0 ? 0 : 1,
  };
}

quizAdminRouter.get('/questions', (_req, res) => {
  const rows = db.prepare('SELECT * FROM quiz_questions ORDER BY category, level, id').all();
  res.json({
    questions: rows.map((row) => ({
      id: row.id,
      category: row.category,
      level: row.level,
      reference: row.reference,
      question: JSON.parse(row.question),
      options: JSON.parse(row.options),
      answer: row.answer,
      explanation: JSON.parse(row.explanation),
      active: Boolean(row.active),
    })),
  });
});

quizAdminRouter.post('/questions', requireSuperAdmin, (req, res) => {
  let question;
  try {
    question = normalizeQuestion(req.body || {});
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (db.prepare('SELECT id FROM quiz_questions WHERE id = ?').get(question.id)) {
    return res.status(409).json({ error: 'A question with this ID already exists.' });
  }
  db.prepare(
    `INSERT INTO quiz_questions (id, category, level, reference, question, options, answer, explanation, active, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(
    question.id,
    question.category,
    question.level,
    question.reference,
    JSON.stringify(question.question),
    JSON.stringify(question.options),
    question.answer,
    JSON.stringify(question.explanation),
    question.active,
    nowIso()
  );
  auditLog(req.user, 'quiz.question.created', question.id);
  res.status(201).json({ id: question.id });
});

quizAdminRouter.put('/questions/:id', requireSuperAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM quiz_questions WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Question not found.' });

  let question;
  try {
    question = normalizeQuestion({
      id: existing.id,
      category: existing.category,
      level: existing.level,
      reference: existing.reference,
      question: JSON.parse(existing.question),
      options: JSON.parse(existing.options),
      answer: existing.answer,
      explanation: JSON.parse(existing.explanation),
      active: Boolean(existing.active),
      ...(req.body || {}),
      id: existing.id,
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  db.prepare(
    `UPDATE quiz_questions SET category = ?, level = ?, reference = ?, question = ?, options = ?, answer = ?, explanation = ?, active = ?
      WHERE id = ?`
  ).run(
    question.category,
    question.level,
    question.reference,
    JSON.stringify(question.question),
    JSON.stringify(question.options),
    question.answer,
    JSON.stringify(question.explanation),
    question.active,
    existing.id
  );
  auditLog(req.user, 'quiz.question.updated', existing.id);
  res.json({ id: existing.id });
});

quizAdminRouter.delete('/questions/:id', requireSuperAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM quiz_questions WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Question not found.' });
  db.prepare('UPDATE quiz_questions SET active = 0 WHERE id = ?').run(existing.id);
  auditLog(req.user, 'quiz.question.disabled', existing.id);
  res.json({ ok: true });
});

quizAdminRouter.get('/stats', (_req, res) => {
  const total = db.prepare('SELECT COUNT(*) AS n FROM quiz_questions WHERE active = 1').get().n;
  const rounds = db.prepare('SELECT COUNT(*) AS n FROM quiz_results').get().n;
  const average = db.prepare('SELECT COALESCE(ROUND(AVG(percent)), 0) AS n FROM quiz_results').get().n;
  res.json({ questions: total, rounds, average });
});
