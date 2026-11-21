/**
 * Supplications (duas) shipped with the app.
 *
 * Sourcing rules, applied to every entry:
 *  - Quranic duas quote the ayah exactly and cite it;
 *  - Prophetic duas carry the collection and the book/number they are reported
 *    in; where a number is not certain the collection and chapter are given
 *    instead of an invented number;
 *  - a repeat count is only shown when the report states one;
 *  - translations say what the Arabic says; nothing is added to the text.
 */

export type DuaCategory =
  | 'morning'
  | 'evening'
  | 'sleep'
  | 'waking'
  | 'eating'
  | 'meals'
  | 'home'
  | 'mosque'
  | 'travel'
  | 'protection'
  | 'forgiveness'
  | 'anxiety'
  | 'worship'
  | 'daily'
  | 'family'
  | 'health';

export interface Dua {
  id: string;
  category: DuaCategory;
  title: string;
  titleAr: string;
  arabic: string;
  transliteration: string;
  english: string;
  somali: string;
  reference: string;
  repeat: string;
}

export interface DuaGroup {
  id: DuaCategory;
  label: string;
  labelAr: string;
  labelSo: string;
  hint: string;
}

export const DUA_GROUPS: DuaGroup[] = [
  { id: 'morning', label: 'Morning Adhkar', labelAr: 'أذكار الصباح', labelSo: 'Adkaarta subaxa', hint: 'After Fajr until sunrise' },
  { id: 'evening', label: 'Evening Adhkar', labelAr: 'أذكار المساء', labelSo: 'Adkaarta galabta', hint: 'After Asr until Maghrib' },
  { id: 'sleep', label: 'Before Sleeping', labelAr: 'أذكار النوم', labelSo: 'Hurdada ka hor', hint: 'Before going to bed' },
  { id: 'waking', label: 'Upon Waking Up', labelAr: 'أذكار الاستيقاظ', labelSo: 'Soo jeedka', hint: 'On waking' },
  { id: 'eating', label: 'Eating and Drinking', labelAr: 'أذكار الطعام والشراب', labelSo: 'Cunto iyo cabbitaan', hint: 'Before and during' },
  { id: 'meals', label: 'Before and After Meals', labelAr: 'بعد الطعام والضيافة', labelSo: 'Cunto ka dib', hint: 'After eating, hosting' },
  { id: 'home', label: 'Entering and Leaving the Home', labelAr: 'دخول المنزل والخروج منه', labelSo: 'Guriga gelid iyo ka bixid', hint: 'Doorway duas' },
  { id: 'mosque', label: 'Entering and Leaving the Mosque', labelAr: 'دخول المسجد والخروج منه', labelSo: 'Masaajidka gelid iyo ka bixid', hint: 'Masjid duas' },
  { id: 'travel', label: 'Travel Duas', labelAr: 'أدعية السفر', labelSo: 'Safarka', hint: 'Journeys and transport' },
  { id: 'protection', label: 'Protection and Safety', labelAr: 'أدعية الحفظ والسلامة', labelSo: 'Ilaalin iyo nabadgelyo', hint: 'Shelter and safety' },
  { id: 'forgiveness', label: 'Forgiveness and Repentance', labelAr: 'أدعية المغفرة والتوبة', labelSo: 'Dambi dhaaf iyo tawbad', hint: 'Istighfar' },
  { id: 'anxiety', label: 'Stress, Anxiety and Difficulties', labelAr: 'أدعية الهم والكرب', labelSo: 'Walwal iyo dhibaato', hint: 'Hardship' },
  { id: 'worship', label: 'Prayer and Worship', labelAr: 'أدعية الصلاة والعبادة', labelSo: 'Salaad iyo cibaado', hint: 'Salah and dhikr' },
  { id: 'daily', label: 'Daily Life Duas', labelAr: 'أدعية الحياة اليومية', labelSo: 'Nolol maalmeedka', hint: 'Clothing, market, rain' },
  { id: 'family', label: 'Parents and Family', labelAr: 'أدعية الوالدين والأهل', labelSo: 'Waalid iyo qoys', hint: 'Parents, spouse, children' },
  { id: 'health', label: 'Health and Healing', labelAr: 'أدعية الشفاء', labelSo: 'Caafimaad iyo bogsasho', hint: 'Illness and recovery' },
];

const d = (
  id: string,
  category: DuaCategory,
  title: string,
  titleAr: string,
  arabic: string,
  transliteration: string,
  english: string,
  somali: string,
  reference: string,
  repeat = '1×'
): Dua => ({ id, category, title, titleAr, arabic, transliteration, english, somali, reference, repeat });

export const DUAS: Dua[] = [
  /* ------------------------------- morning -------------------------------- */
  d(
    'morning-kursi',
    'morning',
    'Ayat al-Kursi',
    'آية الكرسي',
    'اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ الْحَيُّ الْقَيُّومُ ۚ لَا تَأْخُذُهُ سِنَةٌ وَلَا نَوْمٌ ۚ لَهُ مَا فِي السَّمَاوَاتِ وَمَا فِي الْأَرْضِ ۗ مَنْ ذَا الَّذِي يَشْفَعُ عِنْدَهُ إِلَّا بِإِذْنِهِ ۚ يَعْلَمُ مَا بَيْنَ أَيْدِيهِمْ وَمَا خَلْفَهُمْ ۖ وَلَا يُحِيطُونَ بِشَيْءٍ مِنْ عِلْمِهِ إِلَّا بِمَا شَاءَ ۚ وَسِعَ كُرْسِيُّهُ السَّمَاوَاتِ وَالْأَرْضَ ۖ وَلَا يَئُودُهُ حِفْظُهُمَا ۚ وَهُوَ الْعَلِيُّ الْعَظِيمُ',
    'Allahu la ilaha illa huwa al-Hayyul-Qayyum…',
    'Allah — there is no deity except Him, the Ever-Living, the Sustainer of existence. Neither drowsiness overtakes Him nor sleep. To Him belongs whatever is in the heavens and whatever is on the earth…',
    'Alle waa midka aan ilaah kale jirin, Noolaha, Ilaaliyaha. Indho la\'aan iyo hurdo midna ma qabto…',
    'Qur’an 2:255 — recited in the morning for protection',
    '1×'
  ),
  d(
    'morning-mulk',
    'morning',
    'Morning has come',
    'أصبحنا وأصبح الملك لله',
    'أَصْبَحْنَا وَأَصْبَحَ الْمُلْكُ لِلَّهِ، وَالْحَمْدُ لِلَّهِ، لَا إِلَهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ وَهُوَ عَلَى كُلِّ شَيْءٍ قَدِيرٌ',
    'Asbahna wa asbahal-mulku lillah, wal-hamdu lillah, la ilaha illallahu wahdahu la sharika lah, lahul-mulku wa lahul-hamdu wa huwa \'ala kulli shay\'in qadir',
    'We have entered the morning and the dominion belongs to Allah. Praise is for Allah. There is no deity except Allah alone, without partner. His is the dominion and His is the praise, and He is able to do all things.',
    'Waxaan galnay subaxda, boqortooyaduna waxaa leh Alle. Ammaan idilkeed waxaa leh Alle…',
    'Sahih Muslim, Book of Dhikr, Du\'a and Repentance',
    '1×'
  ),
  d(
    'morning-istighfar',
    'morning',
    'Sayyid al-Istighfar',
    'سيد الاستغفار',
    'اللَّهُمَّ أَنْتَ رَبِّي لَا إِلَهَ إِلَّا أَنْتَ، خَلَقْتَنِي وَأَنَا عَبْدُكَ، وَأَنَا عَلَى عَهْدِكَ وَوَعْدِكَ مَا اسْتَطَعْتُ، أَعُوذُ بِكَ مِنْ شَرِّ مَا صَنَعْتُ، أَبُوءُ لَكَ بِنِعْمَتِكَ عَلَيَّ، وَأَبُوءُ لَكَ بِذَنْبِي، فَاغْفِرْ لِي، فَإِنَّهُ لَا يَغْفِرُ الذُّنُوبَ إِلَّا أَنْتَ',
    'Allahumma anta Rabbi la ilaha illa ant, khalaqtani wa ana \'abduk, wa ana \'ala \'ahdika wa wa\'dika mastata\'t…',
    'O Allah, You are my Lord; there is no deity except You. You created me and I am Your servant. I keep Your covenant and promise as much as I can. I seek refuge in You from the evil I have done. I acknowledge Your favour upon me and I acknowledge my sin, so forgive me, for none forgives sins except You.',
    'Alleeyow adaa Rabbigay, adigaan ka sokow ilaah kale ma jiro. Adaa i abuuray, anna addoonkaa ahay…',
    'Sahih al-Bukhari, Book of Da\'awat — the master of seeking forgiveness',
    '1×'
  ),

  /* ------------------------------- evening -------------------------------- */
  d(
    'evening-mulk',
    'evening',
    'Evening has come',
    'أمسينا وأمسى الملك لله',
    'أَمْسَيْنَا وَأَمْسَى الْمُلْكُ لِلَّهِ، وَالْحَمْدُ لِلَّهِ، لَا إِلَهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ وَهُوَ عَلَى كُلِّ شَيْءٍ قَدِيرٌ',
    'Amsayna wa amsal-mulku lillah, wal-hamdu lillah…',
    'We have entered the evening and the dominion belongs to Allah. Praise is for Allah. There is no deity except Allah alone, without partner…',
    'Waxaan galnay galabta, boqortooyaduna waxaa leh Alle, ammaanna waxaa leh Alle…',
    'Sahih Muslim, Book of Dhikr and Du\'a',
    '1×'
  ),
  d(
    'evening-bika',
    'evening',
    'By You we reach the evening',
    'اللهم بك أمسينا',
    'اللَّهُمَّ بِكَ أَمْسَيْنَا، وَبِكَ أَصْبَحْنَا، وَبِكَ نَحْيَا، وَبِكَ نَمُوتُ، وَإِلَيْكَ الْمَصِيرُ',
    'Allahumma bika amsayna, wa bika asbahna, wa bika nahya, wa bika namut, wa ilaykal-masir',
    'O Allah, by You we enter the evening, by You we enter the morning, by You we live and by You we die, and to You is the return.',
    'Alleeyow adigaan galnaa galabta, adigaan galnaa subaxda, adigaan noolaadaa oo ku dhintaa, xaggaagaana loo noqdaa.',
    'Jami\' at-Tirmidhi, Book of Supplications',
    '1×'
  ),
  d(
    'evening-kalimat',
    'evening',
    'Refuge in Allah\'s perfect words',
    'أعوذ بكلمات الله التامات',
    'أَعُوذُ بِكَلِمَاتِ اللَّهِ التَّامَّاتِ مِنْ شَرِّ مَا خَلَقَ',
    'A\'udhu bikalimatillahit-tammati min sharri ma khalaq',
    'I seek refuge in the perfect words of Allah from the evil of what He created.',
    'Waxaan ka magangelyaa hadallada Alle ee dhamaystiran, sharka waxa uu abuuray.',
    'Sahih Muslim, Book of Dhikr and Du\'a',
    '3×'
  ),

  /* -------------------------------- sleep --------------------------------- */
  d(
    'sleep-bismika',
    'sleep',
    'In Your name I die and live',
    'باسمك اللهم أموت وأحيا',
    'بِاسْمِكَ اللَّهُمَّ أَمُوتُ وَأَحْيَا',
    'Bismika Allahumma amutu wa ahya',
    'In Your name, O Allah, I die and I live.',
    'Magacaaga, Alleeyow, waan dhintaa oo waan noolaadaa.',
    'Sahih al-Bukhari, Book of Da\'awat',
    '1×'
  ),
  d(
    'sleep-qini',
    'sleep',
    'Protect me from Your punishment',
    'اللهم قني عذابك',
    'اللَّهُمَّ قِنِي عَذَابَكَ يَوْمَ تَبْعَثُ عِبَادَكَ',
    'Allahumma qini \'adhabaka yawma tab\'athu \'ibadak',
    'O Allah, protect me from Your punishment on the Day You raise Your servants.',
    'Alleeyow iga dhowee cadaabkaaga Maalinta aad addoommahaaga soo bixinaysid.',
    'Sunan Abu Dawud and Jami\' at-Tirmidhi, Book of Supplications',
    '3×'
  ),
  d(
    'sleep-aslamtu',
    'sleep',
    'I submit myself to You',
    'اللهم أسلمت نفسي إليك',
    'اللَّهُمَّ أَسْلَمْتُ نَفْسِي إِلَيْكَ، وَوَجَّهْتُ وَجْهِي إِلَيْكَ، وَفَوَّضْتُ أَمْرِي إِلَيْكَ، وَأَلْجَأْتُ ظَهْرِي إِلَيْكَ، رَغْبَةً وَرَهْبَةً إِلَيْكَ',
    'Allahumma aslamtu nafsi ilayk, wa wajjahtu wajhi ilayk, wa fawwadtu amri ilayk…',
    'O Allah, I submit myself to You, I turn my face to You, I entrust my affair to You and I rely upon You, in desire and in fear of You.',
    'Alleeyow naftayda kuu dhiibay, wejigaygana kuu jeediyay, arrinkaygana kuu wareejiyay…',
    'Sahih al-Bukhari, Book of Da\'awat',
    '1×'
  ),

  /* -------------------------------- waking -------------------------------- */
  d(
    'waking-alhamdulillah',
    'waking',
    'Praise to the One who gave us life',
    'الحمد لله الذي أحيانا',
    'الْحَمْدُ لِلَّهِ الَّذِي أَحْيَانَا بَعْدَ مَا أَمَاتَنَا وَإِلَيْهِ النُّشُورُ',
    'Alhamdulillahilladhi ahyana ba\'da ma amatana wa ilayhin-nushur',
    'Praise is for Allah who gave us life after He had caused us to die, and to Him is the resurrection.',
    'Ammaan idilkeed waxaa leh Alle, kan nolol noo celiyay ka dib markii uu na dilay, xaggiisaana la soo bixin doonaa.',
    'Sahih al-Bukhari, Book of Invocations',
    '1×'
  ),
  d(
    'waking-radda',
    'waking',
    'He returned my soul',
    'الحمد لله الذي رد علي روحي',
    'الْحَمْدُ لِلَّهِ الَّذِي رَدَّ عَلَيَّ رُوحِي، وَعَافَانِي فِي جَسَدِي، وَأَذِنَ لِي بِذِكْرِهِ',
    'Alhamdulillahilladhi radda \'alayya ruhi, wa \'afani fi jasadi, wa adhina li bidhikrih',
    'Praise is for Allah who returned my soul to me, granted health to my body and permitted me to remember Him.',
    'Ammaan waxaa leh Alle, kan ii celiyay naftayda, iiguna caafiyay jidhkayga, iiguna fasaxay xuskiisa.',
    'Jami\' at-Tirmidhi, Book of Supplications',
    '1×'
  ),
  d(
    'waking-tahlil',
    'waking',
    'None is worthy of worship but Allah',
    'لا إله إلا الله وحده',
    'لَا إِلَهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ، وَهُوَ عَلَى كُلِّ شَيْءٍ قَدِيرٌ',
    'La ilaha illallahu wahdahu la sharika lah, lahul-mulku wa lahul-hamdu, wa huwa \'ala kulli shay\'in qadir',
    'There is no deity except Allah alone, without partner. His is the dominion, His is the praise, and He is able to do all things.',
    'Ilaah kale ma jiro Alle mooyee, keligiis, shariig la\'aan, boqortooyaduna waxaa leh isaga…',
    'Sahih al-Bukhari and Sahih Muslim — morning dhikr',
    '10×'
  ),

  /* -------------------------------- eating -------------------------------- */
  d(
    'eating-bismillah',
    'eating',
    'Before eating',
    'قبل الطعام',
    'بِسْمِ اللَّهِ',
    'Bismillah',
    'In the name of Allah.',
    'Magaca Alle.',
    'Sahih al-Bukhari and Sahih Muslim — commanded before eating',
    '1×'
  ),
  d(
    'eating-forgot',
    'eating',
    'If you forget at the start',
    'إذا نسيت في أوله',
    'بِسْمِ اللَّهِ أَوَّلَهُ وَآخِرَهُ',
    'Bismillahi awwalahu wa akhirahu',
    'In the name of Allah at its beginning and at its end.',
    'Magaca Alle, bilowgiisa iyo dhammaadkiisaba.',
    'Sunan Abu Dawud and Jami\' at-Tirmidhi, Book of Foods',
    '1×'
  ),
  d(
    'eating-wrongdoing',
    'eating',
    'Do not let the shaytan share the meal',
    'لا تدع الشيطان يشاركك',
    'فَإِنَّ الشَّيْطَانَ يَسْتَحِلُّ الطَّعَامَ الَّذِي لَمْ يُذْكَرِ اسْمُ اللَّهِ عَلَيْهِ',
    'Fa innash-shaytana yastahillut-ta\'amalladhi lam yudhkarismullahi \'alayh',
    'The Prophet ﷺ said: the shaytan makes lawful the food over which the name of Allah has not been mentioned.',
    'Nabi ﷺ wuxuu yiri: shaydaanku wuxuu xalaalaysadaa cuntada aan magaca Alle lagu xusin.',
    'Sahih Muslim, Book of Drinks',
    '1×'
  ),

  /* -------------------------------- meals --------------------------------- */
  d(
    'meals-after',
    'meals',
    'After eating',
    'بعد الطعام',
    'الْحَمْدُ لِلَّهِ الَّذِي أَطْعَمَنَا وَسَقَانَا وَجَعَلَنَا مُسْلِمِينَ',
    'Alhamdulillahilladhi at\'amana wa saqana wa ja\'alana muslimin',
    'Praise is for Allah who fed us, gave us drink and made us Muslims.',
    'Ammaan waxaa leh Alle, kan na quudiyay, na waraabiyay, oo Muslimiin na yeelay.',
    'Sunan Abu Dawud and Jami\' at-Tirmidhi, Book of Supplications',
    '1×'
  ),
  d(
    'meals-host',
    'meals',
    'For the one who hosted you',
    'دعاء لمن أطعمك',
    'اللَّهُمَّ بَارِكْ لَهُمْ فِيمَا رَزَقْتَهُمْ وَاغْفِرْ لَهُمْ وَارْحَمْهُمْ',
    'Allahumma barik lahum fima razaqtahum waghfir lahum warhamhum',
    'O Allah, bless them in what You have provided them, forgive them and have mercy on them.',
    'Alleeyow barakee waxa aad ku arsaaqday, u dambi dhaaf oo u naxariiso.',
    'Sahih Muslim, Book of Drinks',
    '1×'
  ),
  d(
    'meals-reciprocate',
    'meals',
    'Feed the one who fed you',
    'أطعم من أطعمك',
    'اللَّهُمَّ أَطْعِمْ مَنْ أَطْعَمَنِي وَاسْقِ مَنْ سَقَانِي',
    'Allahumma at\'im man at\'amani wasqi man saqani',
    'O Allah, feed the one who fed me and give drink to the one who gave me drink.',
    'Alleeyow quudi kan i quudiyay, oo waraabi kan i waraabiyay.',
    'Sahih Muslim, Book of Drinks',
    '1×'
  ),

  /* --------------------------------- home --------------------------------- */
  d(
    'home-enter',
    'home',
    'Entering the home',
    'دعاء دخول المنزل',
    'بِسْمِ اللَّهِ وَلَجْنَا، وَبِسْمِ اللَّهِ خَرَجْنَا، وَعَلَى رَبِّنَا تَوَكَّلْنَا',
    'Bismillahi walajna, wa bismillahi kharajna, wa \'ala Rabbina tawakkalna',
    'In the name of Allah we enter, in the name of Allah we leave, and upon our Lord we depend.',
    'Magaca Alle ayaan galnaa, magaca Alle ayaan baxnaa, Rabbigayna waan isku halleynaa.',
    'Sunan Abu Dawud, Book of Manners',
    '1×'
  ),
  d(
    'home-leave',
    'home',
    'Leaving the home',
    'دعاء الخروج من المنزل',
    'بِسْمِ اللَّهِ، تَوَكَّلْتُ عَلَى اللَّهِ، وَلَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللَّهِ',
    'Bismillah, tawakkaltu \'alallah, wa la hawla wa la quwwata illa billah',
    'In the name of Allah, I place my trust in Allah; there is no might nor power except with Allah.',
    'Magaca Alle, Alle ayaan isku halleeyay, xoog iyo awood midna ma leh Alle mooyee.',
    'Sunan Abu Dawud and Jami\' at-Tirmidhi, Book of Supplications',
    '1×'
  ),
  d(
    'home-greeting',
    'home',
    'Greeting the household',
    'السلام على أهل البيت',
    'فَإِذَا دَخَلْتُمْ بُيُوتًا فَسَلِّمُوا عَلَى أَنفُسِكُمْ تَحِيَّةً مِّنْ عِندِ اللَّهِ مُبَارَكَةً طَيِّبَةً',
    'Fa idha dakhaltum buyutan fasallimu \'ala anfusikum…',
    'But when you enter houses, give greetings of peace upon one another — a greeting from Allah, blessed and good.',
    'Markaad guryo gashaan, isku salaama — salaanta ka timid Alle, barakaysan oo wanaagsan.',
    'Qur’an 24:61',
    '1×'
  ),

  /* -------------------------------- mosque -------------------------------- */
  d(
    'mosque-enter',
    'mosque',
    'Entering the mosque',
    'دعاء دخول المسجد',
    'اللَّهُمَّ افْتَحْ لِي أَبْوَابَ رَحْمَتِكَ',
    'Allahummaftah li abwaba rahmatik',
    'O Allah, open for me the gates of Your mercy.',
    'Alleeyow ii fur albaabada naxariistaada.',
    'Sahih Muslim, Book of Prayer',
    '1×'
  ),
  d(
    'mosque-leave',
    'mosque',
    'Leaving the mosque',
    'دعاء الخروج من المسجد',
    'اللَّهُمَّ إِنِّي أَسْأَلُكَ مِنْ فَضْلِكَ',
    'Allahumma inni as\'aluka min fadlik',
    'O Allah, I ask You from Your bounty.',
    'Alleeyow waxaan kaa weydiisanayaa fadligaaga.',
    'Sahih Muslim, Book of Prayer',
    '1×'
  ),
  d(
    'mosque-shaytan',
    'mosque',
    'Seeking refuge on entering',
    'الاستعاذة عند الدخول',
    'أَعُوذُ بِاللَّهِ الْعَظِيمِ، وَبِوَجْهِهِ الْكَرِيمِ، وَسُلْطَانِهِ الْقَدِيمِ، مِنَ الشَّيْطَانِ الرَّجِيمِ',
    'A\'udhu billahil-\'Adhim, wa biwajhihil-karim, wa sultanihil-qadim, minash-shaytanir-rajim',
    'I seek refuge in Allah the Mighty, in His noble face and His eternal authority, from the accursed shaytan.',
    'Waxaan ka magangelyaa Alle Weyn, wejigiisa sharafta leh iyo amarradiisa qadiimka ah, shaydaanka la fogeeyay.',
    'Sunan Abu Dawud, Book of Prayer',
    '1×'
  ),

  /* -------------------------------- travel -------------------------------- */
  d(
    'travel-ride',
    'travel',
    'Boarding a vehicle',
    'دعاء الركوب',
    'سُبْحَانَ الَّذِي سَخَّرَ لَنَا هَذَا وَمَا كُنَّا لَهُ مُقْرِنِينَ وَإِنَّا إِلَى رَبِّنَا لَمُنْقَلِبُونَ',
    'Subhanalladhi sakhkhara lana hadha wa ma kunna lahu muqrinin, wa inna ila Rabbina lamunqalibun',
    'Glory to Him who has subjected this to us, though we could not have subdued it. And indeed, to our Lord we will return.',
    'Ammaan waxaa leh kan noo sakhiray tan, annagoo aan awoodin inaan qabsanno, Rabbigayna waan ku noqon doonaa.',
    'Qur’an 43:13–14 — recited by the Prophet ﷺ when mounting (Sahih Muslim)',
    '1×'
  ),
  d(
    'travel-journey',
    'travel',
    'At the start of a journey',
    'دعاء السفر',
    'اللَّهُمَّ إِنَّا نَسْأَلُكَ فِي سَفَرِنَا هَذَا الْبِرَّ وَالتَّقْوَى، وَمِنَ الْعَمَلِ مَا تَرْضَى، اللَّهُمَّ هَوِّنْ عَلَيْنَا سَفَرَنَا هَذَا وَاطْوِ عَنَّا بُعْدَهُ',
    'Allahumma inna nas\'aluka fi safarina hadhal-birra wat-taqwa, wa minal-\'amali ma tarda…',
    'O Allah, we ask You on this journey for righteousness and piety, and for deeds that please You. O Allah, make this journey easy for us and shorten its distance.',
    'Alleeyow safarkan waxaan kaa weydiisanaynaa wanaag iyo takwo, iyo camal aad ka raali tahay. Fududee safarkanna, gaabshee masaafada.',
    'Sahih Muslim, Book of Pilgrimage — journey supplication',
    '1×'
  ),
  d(
    'travel-return',
    'travel',
    'Refuge from a difficult journey',
    'الاستعاذة في السفر',
    'اللَّهُمَّ إِنِّي أَعُوذُ بِكَ مِنْ وَعْثَاءِ السَّفَرِ، وَكَآبَةِ الْمُنْقَلَبِ، وَسُوءِ الْمَنْظَرِ فِي الْأَهْلِ وَالْمَالِ',
    'Allahumma inni a\'udhu bika min wa\'tha\'is-safar, wa ka\'batil-munqalab, wa su\'il-manzari fil-ahli wal-mal',
    'O Allah, I seek refuge in You from the hardship of travel, from a wretched return, and from seeing harm in my family and wealth.',
    'Alleeyow waxaan kaa magangelyanayaa dhibaatada safarka, ku-noqod xun, iyo aragtida xun ee qoyska iyo maalka.',
    'Sahih Muslim, Book of Pilgrimage',
    '1×'
  ),

  /* ------------------------------ protection ------------------------------ */
  d(
    'protection-bismillah',
    'protection',
    'Protection morning and evening',
    'بسم الله الذي لا يضر مع اسمه شيء',
    'بِسْمِ اللَّهِ الَّذِي لَا يَضُرُّ مَعَ اسْمِهِ شَيْءٌ فِي الْأَرْضِ وَلَا فِي السَّمَاءِ وَهُوَ السَّمِيعُ الْعَلِيمُ',
    'Bismillahilladhi la yadurru ma\'asmihi shay\'un fil-ardi wa la fis-sama\'i wa huwas-Sami\'ul-\'Alim',
    'In the name of Allah, with whose name nothing on earth or in heaven can cause harm; He is the All-Hearing, the All-Knowing.',
    'Magaca Alle, kan aan waxba ku dhibin magaciisa, dhulka iyo samadaba, isagaa wax walba maqla oo og.',
    'Sunan Abu Dawud and Jami\' at-Tirmidhi, Book of Supplications',
    '3×'
  ),
  d(
    'protection-children',
    'protection',
    'Protecting children',
    'تعويذ الأولاد',
    'أُعِيذُكُمَا بِكَلِمَاتِ اللَّهِ التَّامَّةِ مِنْ كُلِّ شَيْطَانٍ وَهَامَّةٍ وَمِنْ كُلِّ عَيْنٍ لَامَّةٍ',
    'U\'idhukuma bikalimatillahit-tammati min kulli shaytanin wa hammatin wa min kulli \'aynin lammah',
    'I seek refuge for you both in the perfect words of Allah from every shaytan, every harmful creature and every evil eye.',
    'Waxaan idinku magangelyoonayaa hadallada Alle ee dhamaystiran, shaydaan kasta, xamaarato wax dhibta iyo il kasta oo xun.',
    'Sahih al-Bukhari, Book of the Beginning of Creation — the Prophet ﷺ used it for al-Hasan and al-Husayn',
    '1×'
  ),
  d(
    'protection-hamm',
    'protection',
    'From worry and debt',
    'من الهم والدين',
    'اللَّهُمَّ إِنِّي أَعُوذُ بِكَ مِنَ الْهَمِّ وَالْحَزَنِ، وَالْعَجْزِ وَالْكَسَلِ، وَالْبُخْلِ وَالْجُبْنِ، وَضَلَعِ الدَّيْنِ وَغَلَبَةِ الرِّجَالِ',
    'Allahumma inni a\'udhu bika minal-hammi wal-hazan, wal-\'ajzi wal-kasal, wal-bukhli wal-jubn, wa dala\'id-dayni wa ghalabatir-rijal',
    'O Allah, I seek refuge in You from anxiety and sorrow, from incapacity and laziness, from miserliness and cowardice, from the burden of debt and from being overpowered by others.',
    'Alleeyow waxaan kaa magangelyanayaa walwal iyo murugo, tabar-darro iyo caajis, bakhli iyo fulaynnimo, culeyska deynta iyo in dadka kale kaa adkaadaan.',
    'Sahih al-Bukhari, Book of Da\'awat',
    '1×'
  ),

  /* ----------------------------- forgiveness ------------------------------ */
  d(
    'forgiveness-astaghfirullah',
    'forgiveness',
    'Seeking forgiveness',
    'الاستغفار',
    'أَسْتَغْفِرُ اللَّهَ وَأَتُوبُ إِلَيْهِ',
    'Astaghfirullaha wa atubu ilayh',
    'I seek the forgiveness of Allah and I turn to Him in repentance.',
    'Alle ayaan dambi dhaaf weydiistanayaa, xaggiisana waan tawbad galayaa.',
    'Sahih al-Bukhari and Sahih Muslim — the Prophet ﷺ said he did it a hundred times a day',
    '100×'
  ),
  d(
    'forgiveness-adam',
    'forgiveness',
    'Our Lord, we have wronged ourselves',
    'ربنا ظلمنا أنفسنا',
    'رَبَّنَا ظَلَمْنَا أَنْفُسَنَا وَإِنْ لَمْ تَغْفِرْ لَنَا وَتَرْحَمْنَا لَنَكُونَنَّ مِنَ الْخَاسِرِينَ',
    'Rabbana zalamna anfusana wa il-lam taghfir lana wa tarhamna lanakunanna minal-khasirin',
    'Our Lord, we have wronged ourselves, and if You do not forgive us and have mercy on us, we will surely be among the losers.',
    'Rabbiyow, nafahayaga ayaan dulmiyay, haddaadan na dambi dhaafin oo na naxariisin, waxaan noqonaynaa kuwa khasaaray.',
    'Qur’an 7:23',
    '1×'
  ),
  d(
    'forgiveness-dhambi',
    'forgiveness',
    'Forgive every sin of mine',
    'اللهم اغفر لي ذنبي كله',
    'اللَّهُمَّ اغْفِرْ لِي ذَنْبِي كُلَّهُ، دِقَّهُ وَجِلَّهُ، وَأَوَّلَهُ وَآخِرَهُ، وَعَلَانِيَتَهُ وَسِرَّهُ',
    'Allahumma ghfir li dhanbi kullahu, diqqahu wa jillah, wa awwalahu wa akhirah, wa \'alaniyatahu wa sirrah',
    'O Allah, forgive me all my sins: the small and the great, the first and the last, the open and the hidden.',
    'Alleeyow ii dambi dhaaf dembigayga oo dhan, yar iyo weyn, hore iyo dambe, caddaan iyo qarsoodiba.',
    'Sahih Muslim, Book of Dhikr and Du\'a',
    '1×'
  ),

  /* ------------------------------- anxiety -------------------------------- */
  d(
    'anxiety-adhim',
    'anxiety',
    'The supplication of distress',
    'دعوة الكرب',
    'لَا إِلَهَ إِلَّا اللَّهُ الْعَظِيمُ الْحَلِيمُ، لَا إِلَهَ إِلَّا اللَّهُ رَبُّ الْعَرْشِ الْعَظِيمِ، لَا إِلَهَ إِلَّا اللَّهُ رَبُّ السَّمَاوَاتِ وَرَبُّ الْأَرْضِ وَرَبُّ الْعَرْشِ الْكَرِيمِ',
    'La ilaha illallahul-\'Adhimul-Halim, la ilaha illallahu Rabbul-\'Arshil-\'Adhim, la ilaha illallahu Rabbus-samawati wa Rabbul-ardi wa Rabbul-\'Arshil-Karim',
    'There is no deity except Allah, the Mighty, the Forbearing. There is no deity except Allah, Lord of the Mighty Throne. There is no deity except Allah, Lord of the heavens, Lord of the earth and Lord of the noble Throne.',
    'Ilaah kale ma jiro Alle Weyn, Dulqaadka Badan mooyee. Ilaah kale ma jiro Alle, Rabbiga Carshiga Weyn…',
    'Sahih al-Bukhari and Sahih Muslim — said by the Prophet ﷺ at times of distress',
    '1×'
  ),
  d(
    'anxiety-rahmah',
    'anxiety',
    'Do not leave me to myself',
    'لا تكلني إلى نفسي',
    'اللَّهُمَّ رَحْمَتَكَ أَرْجُو، فَلَا تَكِلْنِي إِلَى نَفْسِي طَرْفَةَ عَيْنٍ، وَأَصْلِحْ لِي شَأْنِي كُلَّهُ، لَا إِلَهَ إِلَّا أَنْتَ',
    'Allahumma rahmataka arju, fala takilni ila nafsi tarfata \'ayn, wa aslih li sha\'ni kullahu, la ilaha illa ant',
    'O Allah, it is Your mercy I hope for. Do not leave me to myself even for the blink of an eye. Set right all my affairs. There is no deity except You.',
    'Alleeyow naxariistaada ayaan rajeynayaa, hal il-biriqsi iga tagin naftayda, hagaaji arrinkayga oo dhan.',
    'Sunan Abu Dawud, Book of Manners',
    '1×'
  ),
  d(
    'anxiety-hasbunallah',
    'anxiety',
    'Allah is sufficient for us',
    'حسبنا الله ونعم الوكيل',
    'حَسْبُنَا اللَّهُ وَنِعْمَ الْوَكِيلُ',
    'Hasbunallahu wa ni\'mal-wakil',
    'Allah is sufficient for us, and He is the best Disposer of affairs.',
    'Alle ayaa nagu filan, isagaana ah wakiilka ugu fiican.',
    'Qur’an 3:173',
    '1×'
  ),

  /* ------------------------------- worship -------------------------------- */
  d(
    'worship-dhikr',
    'worship',
    'Help me remember You',
    'أعني على ذكرك',
    'اللَّهُمَّ أَعِنِّي عَلَى ذِكْرِكَ وَشُكْرِكَ وَحُسْنِ عِبَادَتِكَ',
    'Allahumma a\'inni \'ala dhikrika wa shukrika wa husni \'ibadatik',
    'O Allah, help me to remember You, to thank You and to worship You well.',
    'Alleeyow iiga caawi xuskaaga, mahadnaqaaga iyo si wanaagsan oo aan ku caabudo.',
    'Sunan Abu Dawud and Sunan an-Nasa\'i — taught to Mu\'adh ibn Jabal',
    '1×'
  ),
  d(
    'worship-knowledge',
    'worship',
    'Increase me in knowledge',
    'رب زدني علما',
    'رَبِّ زِدْنِي عِلْمًا',
    'Rabbi zidni \'ilma',
    'My Lord, increase me in knowledge.',
    'Rabbiyow, ii kordhi cilmi.',
    'Qur’an 20:114',
    '1×'
  ),
  d(
    'worship-after-adhan',
    'worship',
    'After the adhan',
    'بعد الأذان',
    'اللَّهُمَّ رَبَّ هَذِهِ الدَّعْوَةِ التَّامَّةِ، وَالصَّلَاةِ الْقَائِمَةِ، آتِ مُحَمَّدًا الْوَسِيلَةَ وَالْفَضِيلَةَ، وَابْعَثْهُ مَقَامًا مَحْمُودًا الَّذِي وَعَدْتَهُ',
    'Allahumma Rabba hadhihid-da\'watit-tammah, was-salatil-qa\'imah, ati Muhammadanil-wasilata wal-fadilah, wab\'ath-hu maqaman mahmudanilladhi wa\'adtah',
    'O Allah, Lord of this perfect call and the prayer about to be established, grant Muhammad the means and the excellence, and raise him to the praised station You promised him.',
    'Alleeyow Rabbiga baaqa dhamaystiran iyo salaadda la oogayaa, sii Muxammad wasiilada iyo fadliga, kuna soo bixi meesha ammaanta leh ee aad ballan qaaday.',
    'Sahih al-Bukhari, Book of Adhan',
    '1×'
  ),

  /* -------------------------------- daily --------------------------------- */
  d(
    'daily-clothing',
    'daily',
    'Wearing new clothes',
    'دعاء لبس الثوب',
    'الْحَمْدُ لِلَّهِ الَّذِي كَسَانِي هَذَا الثَّوْبَ وَرَزَقَنِيهِ مِنْ غَيْرِ حَوْلٍ مِنِّي وَلَا قُوَّةٍ',
    'Alhamdulillahilladhi kasani hadhath-thawba wa razaqanihi min ghayri hawlin minni wa la quwwah',
    'Praise is for Allah who clothed me with this garment and provided it for me without any strength or power on my part.',
    'Ammaan waxaa leh Alle, kan i geliyay dharkan, iigana arsaaqay xoog iyo awood aan lahayn.',
    'Sunan Abu Dawud and Jami\' at-Tirmidhi, Book of Clothing',
    '1×'
  ),
  d(
    'daily-market',
    'daily',
    'Entering the market',
    'دعاء دخول السوق',
    'لَا إِلَهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ، يُحْيِي وَيُمِيتُ، وَهُوَ حَيٌّ لَا يَمُوتُ، بِيَدِهِ الْخَيْرُ، وَهُوَ عَلَى كُلِّ شَيْءٍ قَدِيرٌ',
    'La ilaha illallahu wahdahu la sharika lah, lahul-mulku wa lahul-hamd, yuhyi wa yumit, wa huwa hayyun la yamut, biyadihil-khayr, wa huwa \'ala kulli shay\'in qadir',
    'There is no deity except Allah alone, without partner. His is the dominion and His is the praise. He gives life and causes death, and He is living and never dies. In His hand is all good, and He is able to do all things.',
    'Ilaah kale ma jiro Alle keligiis mooyee, boqortooyadu waxaa leh isaga, isagaa noolayn oo dilaa, isaguna weligiis nool…',
    'Jami\' at-Tirmidhi, Book of Supplications',
    '1×'
  ),
  d(
    'daily-rain',
    'daily',
    'When it rains',
    'عند المطر',
    'اللَّهُمَّ صَيِّبًا نَافِعًا',
    'Allahumma sayyiban nafi\'a',
    'O Allah, make it a beneficial rain.',
    'Alleeyow ka dhig roob faa\'iido leh.',
    'Sahih al-Bukhari, Book of Rain',
    '1×'
  ),

  /* -------------------------------- family -------------------------------- */
  d(
    'family-parents',
    'family',
    'For your parents',
    'دعاء للوالدين',
    'رَبِّ ارْحَمْهُمَا كَمَا رَبَّيَانِي صَغِيرًا',
    'Rabbir hamhuma kama rabbayani saghira',
    'My Lord, have mercy on them both as they nurtured me when I was small.',
    'Rabbiyow u naxariiso labadoodaba sida ay ii soo koriyeen anigoo yar.',
    'Qur’an 17:24',
    '1×'
  ),
  d(
    'family-progeny',
    'family',
    'For spouse and children',
    'دعاء للزوج والذرية',
    'رَبَّنَا هَبْ لَنَا مِنْ أَزْوَاجِنَا وَذُرِّيَّاتِنَا قُرَّةَ أَعْيُنٍ وَاجْعَلْنَا لِلْمُتَّقِينَ إِمَامًا',
    'Rabbana hab lana min azwajina wa dhurriyyatina qurrata a\'yunin waj\'alna lil-muttaqina imama',
    'Our Lord, grant us from among our spouses and offspring comfort to our eyes, and make us leaders for the righteous.',
    'Rabbiyow naga sii xaasaskeenna iyo carruurteenna farxad indhahayaga, oo ka dhig annaga hoggaamiye kuwa takwada leh.',
    'Qur’an 25:74',
    '1×'
  ),
  d(
    'family-gratitude',
    'family',
    'Thanking Allah for family',
    'الشكر على الأهل',
    'رَبِّ أَوْزِعْنِي أَنْ أَشْكُرَ نِعْمَتَكَ الَّتِي أَنْعَمْتَ عَلَيَّ وَعَلَى وَالِدَيَّ وَأَنْ أَعْمَلَ صَالِحًا تَرْضَاهُ',
    'Rabbi awzi\'ni an ashkura ni\'matakallati an\'amta \'alayya wa \'ala walidayya wa an a\'mala salihan tardah',
    'My Lord, enable me to be grateful for Your favour which You have bestowed upon me and upon my parents, and to do righteousness that pleases You.',
    'Rabbiyow iiga yeel mid ku mahadnaqa nicmadaada aad siisay aniga iyo waalidkayba, oo sameeya camal wanaagsan oo aad ka raali tahay.',
    'Qur’an 46:15',
    '1×'
  ),

  /* -------------------------------- health -------------------------------- */
  d(
    'health-rabbannas',
    'health',
    'Healing for the sick',
    'دعاء شفاء المريض',
    'اللَّهُمَّ رَبَّ النَّاسِ، أَذْهِبِ الْبَاسَ، اشْفِ أَنْتَ الشَّافِي، لَا شَافِيَ إِلَّا أَنْتَ',
    'Allahumma Rabban-nas, adhhibil-ba\'s, ishfi antash-Shafi, la shafiya illa ant',
    'O Allah, Lord of people, remove the harm. Heal, for You are the Healer. There is no healer except You.',
    'Alleeyow Rabbiga dadka, ka fogee dhibaatada, bogsii adigaa Bogsiiye ah, bogsiiye ma jiro adiga mooyee.',
    'Sahih al-Bukhari and Sahih Muslim — the Prophet ﷺ wiped with his right hand while saying it',
    '1×'
  ),
  d(
    'health-pain',
    'health',
    'When in pain',
    'دعاء الألم',
    'بِسْمِ اللَّهِ (ثَلَاثًا) أَعُوذُ بِعِزَّةِ اللَّهِ وَقُدْرَتِهِ مِنْ شَرِّ مَا أَجِدُ وَأُحَاذِرُ (سَبْعًا)',
    'Bismillah (3×) — A\'udhu bi\'izzatillahi wa qudratihi min sharri ma ajidu wa uhadhiru (7×)',
    'In the name of Allah (three times). I seek refuge in the might and power of Allah from the evil of what I feel and fear (seven times).',
    'Magaca Alle (saddex jeer). Waxaan ka magangelyaa xoogga iyo awoodda Alle sharka waxa aan dareemayo oo ka baqayo (toddoba jeer).',
    'Sahih Muslim, Book of Greetings — taught to \'Uthman ibn Abi al-\'As',
    '3× + 7×'
  ),
  d(
    'health-shifa',
    'health',
    'Asking Allah to heal another',
    'الدعاء بالشفاء لغيره',
    'أَسْأَلُ اللَّهَ الْعَظِيمَ رَبَّ الْعَرْشِ الْعَظِيمِ أَنْ يَشْفِيَكَ',
    'As\'alullahal-\'Adhima Rabbal-\'Arshil-\'Adhimi an yashfiyak',
    'I ask Allah the Mighty, Lord of the Mighty Throne, to heal you.',
    'Waxaan Alle Weyn, Rabbiga Carshiga Weyn ka weydiisanayaa inuu ku bogsiiyo.',
    'Sunan Abu Dawud and Jami\' at-Tirmidhi — said seven times for one who is ill',
    '7×'
  ),
];

export const duaById = (id: string) => DUAS.find((x) => x.id === id);
export const duasIn = (category: DuaCategory) => DUAS.filter((x) => x.category === category);
export const dailyDua = (dateKey: string) => {
  let h = 0;
  for (let i = 0; i < dateKey.length; i++) h = (h * 31 + dateKey.charCodeAt(i)) % 100000;
  return DUAS[h % DUAS.length];
};
