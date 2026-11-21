/**
 * Kid Academy catalogue.
 *
 * Kept on the server so one source feeds the app, the admin editor and the
 * certificate. Every entry is either a letter of the Arabic alphabet, a short
 * surah quoted in full, a pillar, a manner taken from an authentic narration,
 * or a prophet's story summarised without adding anything to the text.
 */
export const KIDS_LESSONS = [
  /* ------------------------------ 28 letters ----------------------------- */
  { id: 'letter-alif', kind: 'letter', sort: 1, title: ['Alif', 'الألف', 'Alif'], body: { glyph: 'ا', name: 'Alif', sound: 'a', hint: ['Say “a” as in “apple”.', 'تُنطق كحرف الألف في «أب».', 'U dhawaaq “a” sida “aabbe”.'] } },
  { id: 'letter-ba', kind: 'letter', sort: 2, title: ['Ba', 'الباء', 'Ba'], body: { glyph: 'ب', name: 'Ba', sound: 'b', hint: ['Say “b” as in “book”.', 'تُنطق كالباء في «بيت».', 'U dhawaaq “b” sida “buug”.'] } },
  { id: 'letter-ta', kind: 'letter', sort: 3, title: ['Ta', 'التاء', 'Ta'], body: { glyph: 'ت', name: 'Ta', sound: 't', hint: ['Say “t” as in “table”.', 'تُنطق كالتاء في «تمر».', 'U dhawaaq “t” sida “timir”.'] } },
  { id: 'letter-tha', kind: 'letter', sort: 4, title: ['Tha', 'الثاء', 'Tha'], body: { glyph: 'ث', name: 'Tha', sound: 'th', hint: ['Say “th” as in “think”.', 'تُنطق كالثاء في «ثوب».', 'U dhawaaq “th” sida “thum”.'] } },
  { id: 'letter-jeem', kind: 'letter', sort: 5, title: ['Jeem', 'الجيم', 'Jiim'], body: { glyph: 'ج', name: 'Jeem', sound: 'j', hint: ['Say “j” as in “jam”.', 'تُنطق كالجيم في «جمل».', 'U dhawaaq “j” sida “jameel”.'] } },
  { id: 'letter-ha', kind: 'letter', sort: 6, title: ['Ha', 'الحاء', 'Xa'], body: { glyph: 'ح', name: 'Ha', sound: 'h', hint: ['A soft breath from the throat.', 'حاء من الحلق برفق.', 'Neef qayaxan oo dhuunta ka soo baxa.'] } },
  { id: 'letter-kha', kind: 'letter', sort: 7, title: ['Kha', 'الخاء', 'Kha'], body: { glyph: 'خ', name: 'Kha', sound: 'kh', hint: ['Like clearing the throat gently.', 'كصوت الخاء في «خبز».', 'Sida codka “kh” oo dhuunta laga soo saaro.'] } },
  { id: 'letter-dal', kind: 'letter', sort: 8, title: ['Dal', 'الدال', 'Dal'], body: { glyph: 'د', name: 'Dal', sound: 'd', hint: ['Say “d” as in “door”.', 'تُنطق كالدال في «دار».', 'U dhawaaq “d” sida “dal”.'] } },
  { id: 'letter-dhal', kind: 'letter', sort: 9, title: ['Dhal', 'الذال', 'Dhaal'], body: { glyph: 'ذ', name: 'Dhal', sound: 'dh', hint: ['Say “th” as in “this”.', 'تُنطق كالذال في «ذهب».', 'U dhawaaq “dh” sida “dhaqan”.'] } },
  { id: 'letter-ra', kind: 'letter', sort: 10, title: ['Ra', 'الراء', 'Ra'], body: { glyph: 'ر', name: 'Ra', sound: 'r', hint: ['A light rolled “r”.', 'راء مرققة.', '“r” fudud oo la ruxo.'] } },
  { id: 'letter-zay', kind: 'letter', sort: 11, title: ['Zay', 'الزاي', 'Zaay'], body: { glyph: 'ز', name: 'Zay', sound: 'z', hint: ['Say “z” as in “zebra”.', 'تُنطق كالزاي في «زهرة».', 'U dhawaaq “z” sida “zebra”.'] } },
  { id: 'letter-seen', kind: 'letter', sort: 12, title: ['Seen', 'السين', 'Siin'], body: { glyph: 'س', name: 'Seen', sound: 's', hint: ['Say “s” as in “sun”.', 'تُنطق كالسين في «سلام».', 'U dhawaaq “s” sida “salaam”.'] } },
  { id: 'letter-sheen', kind: 'letter', sort: 13, title: ['Sheen', 'الشين', 'Shiin'], body: { glyph: 'ش', name: 'Sheen', sound: 'sh', hint: ['Say “sh” as in “ship”.', 'تُنطق كالشين في «شمس».', 'U dhawaaq “sh” sida “shams”.'] } },
  { id: 'letter-sad', kind: 'letter', sort: 14, title: ['Sad', 'الصاد', 'Saad'], body: { glyph: 'ص', name: 'Sad', sound: 's', hint: ['A heavy, deep “s”.', 'صاد مفخمة.', '“s” qaro weyn oo culus.'] } },
  { id: 'letter-dad', kind: 'letter', sort: 15, title: ['Dad', 'الضاد', 'Daad'], body: { glyph: 'ض', name: 'Dad', sound: 'd', hint: ['A heavy “d” from the side of the tongue.', 'ضاد مفخمة من حافة اللسان.', '“d” culus oo carrabka dhinaciisa laga soo saaro.'] } },
  { id: 'letter-ta-heavy', kind: 'letter', sort: 16, title: ['Ta (heavy)', 'الطاء', 'Taa'], body: { glyph: 'ط', name: 'Ta', sound: 't', hint: ['A heavy “t”.', 'طاء مفخمة.', '“t” culus.'] } },
  { id: 'letter-zha', kind: 'letter', sort: 17, title: ['Zha', 'الظاء', 'Zhaa'], body: { glyph: 'ظ', name: 'Zha', sound: 'dh', hint: ['A heavy “th” as in “those”.', 'ظاء مفخمة.', '“dh” culus.'] } },
  { id: 'letter-ain', kind: 'letter', sort: 18, title: ['Ain', 'العين', 'Cayn'], body: { glyph: 'ع', name: 'Ain', sound: 'ʿa', hint: ['A deep sound from the middle of the throat.', 'عين من وسط الحلق.', 'Cod qoto dheer oo dhuunta dhexdeeda ka soo baxa.'] } },
  { id: 'letter-ghain', kind: 'letter', sort: 19, title: ['Ghain', 'الغين', 'Ghayn'], body: { glyph: 'غ', name: 'Ghain', sound: 'gh', hint: ['Like a soft gargle.', 'غين كالغين في «غيم».', 'Sida cod “gh” oo jilicsan.'] } },
  { id: 'letter-fa', kind: 'letter', sort: 20, title: ['Fa', 'الفاء', 'Fa'], body: { glyph: 'ف', name: 'Fa', sound: 'f', hint: ['Say “f” as in “fish”.', 'تُنطق كالفاء في «فيل».', 'U dhawaaq “f” sida “fii”.'] } },
  { id: 'letter-qaf', kind: 'letter', sort: 21, title: ['Qaf', 'القاف', 'Qaaf'], body: { glyph: 'ق', name: 'Qaf', sound: 'q', hint: ['A deep “k” from the back of the tongue.', 'قاف من أقصى اللسان.', '“k” qoto dheer oo carrabka gadaashiisa laga soo saaro.'] } },
  { id: 'letter-kaf', kind: 'letter', sort: 22, title: ['Kaf', 'الكاف', 'Kaaf'], body: { glyph: 'ك', name: 'Kaf', sound: 'k', hint: ['Say “k” as in “kite”.', 'تُنطق كالكاف في «كتاب».', 'U dhawaaq “k” sida “kitaab”.'] } },
  { id: 'letter-lam', kind: 'letter', sort: 23, title: ['Lam', 'اللام', 'Laam'], body: { glyph: 'ل', name: 'Lam', sound: 'l', hint: ['Say “l” as in “lamp”.', 'تُنطق كاللام في «ليل».', 'U dhawaaq “l” sida “layl”.'] } },
  { id: 'letter-meem', kind: 'letter', sort: 24, title: ['Meem', 'الميم', 'Miim'], body: { glyph: 'م', name: 'Meem', sound: 'm', hint: ['Say “m” as in “moon”.', 'تُنطق كالميم في «ماء».', 'U dhawaaq “m” sida “moon”.'] } },
  { id: 'letter-noon', kind: 'letter', sort: 25, title: ['Noon', 'النون', 'Nuun'], body: { glyph: 'ن', name: 'Noon', sound: 'n', hint: ['Say “n” as in “nest”.', 'تُنطق كالنون في «نور».', 'U dhawaaq “n” sida “nuur”.'] } },
  { id: 'letter-haa', kind: 'letter', sort: 26, title: ['Haa', 'الهاء', 'Ha'], body: { glyph: 'ه', name: 'Haa', sound: 'h', hint: ['A light breath, softer than ح.', 'هاء خفيفة.', 'Neef khafiif ah.'] } },
  { id: 'letter-waw', kind: 'letter', sort: 27, title: ['Waw', 'الواو', 'Waw'], body: { glyph: 'و', name: 'Waw', sound: 'w', hint: ['Say “w” as in “water”.', 'تُنطق كالواو في «ورد».', 'U dhawaaq “w” sida “web”.'] } },
  { id: 'letter-ya', kind: 'letter', sort: 28, title: ['Ya', 'الياء', 'Ya'], body: { glyph: 'ي', name: 'Ya', sound: 'y', hint: ['Say “y” as in “yes”.', 'تُنطق كالياء في «يد».', 'U dhawaaq “y” sida “yes”.'] } },

  /* --------------------------- 6 short surahs ---------------------------- */
  {
    id: 'surah-fatihah', kind: 'surah', sort: 1,
    title: ['Al-Fatihah', 'الفاتحة', 'Al-Faatixah'],
    body: {
      number: 1,
      ayahs: 7,
      arabic: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ ﴿١﴾ الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ ﴿٢﴾ الرَّحْمَٰنِ الرَّحِيمِ ﴿٣﴾ مَالِكِ يَوْمِ الدِّينِ ﴿٤﴾ إِيَّاكَ نَعْبُدُ وَإِيَّاكَ نَسْتَعِينُ ﴿٥﴾ اهْدِنَا الصِّرَاطَ الْمُسْتَقِيمَ ﴿٦﴾ صِرَاطَ الَّذِينَ أَنْعَمْتَ عَلَيْهِمْ غَيْرِ الْمَغْضُوبِ عَلَيْهِمْ وَلَا الضَّالِّينَ ﴿٧﴾',
      meaning: [
        'In the name of Allah, the Most Merciful. All praise is for Allah, Lord of the worlds, the Most Merciful, Master of the Day of Judgement. You alone we worship and You alone we ask for help. Guide us to the straight path, the path of those You have favoured, not of those who earned anger nor of those who went astray.',
        'سورة الفاتحة هي أم الكتاب، تُقرأ في كل ركعة.',
        'Al-Faatixah waa suuradda lagu akhriyo salaad kasta.',
      ],
      tip: ['Learn it slowly, one ayah at a time.', 'احفظها آية آية.', 'Ku baro aayad aayad.'],
    },
  },
  {
    id: 'surah-ikhlas', kind: 'surah', sort: 2,
    title: ['Al-Ikhlas', 'الإخلاص', 'Al-Ikhlaas'],
    body: {
      number: 112, ayahs: 4,
      arabic: 'قُلْ هُوَ اللَّهُ أَحَدٌ ﴿١﴾ اللَّهُ الصَّمَدُ ﴿٢﴾ لَمْ يَلِدْ وَلَمْ يُولَدْ ﴿٣﴾ وَلَمْ يَكُن لَّهُ كُفُوًا أَحَدٌ ﴿٤﴾',
      meaning: [
        'Say: He is Allah, the One. Allah, the Eternal Refuge. He neither begets nor is born, and there is none comparable to Him.',
        'سورة الإخلاص تصف وحدانية الله.',
        'Al-Ikhlaas waxay qeexdaa midnimada Alle.',
      ],
      tip: ['The Prophet ﷺ said it equals a third of the Qur’an in reward.', 'قال النبي ﷺ إنها تعدل ثلث القرآن.', 'Nabigu ﷺ wuxuu yiri waxay la mid tahay saddex meelood Qur’aanka.'],
    },
  },
  {
    id: 'surah-falaq', kind: 'surah', sort: 3,
    title: ['Al-Falaq', 'الفلق', 'Al-Falaq'],
    body: {
      number: 113, ayahs: 5,
      arabic: 'قُلْ أَعُوذُ بِرَبِّ الْفَلَقِ ﴿١﴾ مِن شَرِّ مَا خَلَقَ ﴿٢﴾ وَمِن شَرِّ غَاسِقٍ إِذَا وَقَبَ ﴿٣﴾ وَمِن شَرِّ النَّفَّاثَاتِ فِي الْعُقَدِ ﴿٤﴾ وَمِن شَرِّ حَاسِدٍ إِذَا حَسَدَ ﴿٥﴾',
      meaning: [
        'Say: I seek refuge with the Lord of the daybreak from the evil of what He created, from the evil of darkness when it settles, from the evil of those who blow on knots, and from the evil of the envier when he envies.',
        'سورة الفلق من المعوذتين.',
        'Al-Falaq waa mid ka mid ah labada suuradood ee lagu magangelyo.',
      ],
      tip: ['Recite it with Al-Ikhlas and An-Nas before sleeping.', 'تُقرأ مع الإخلاص والناس قبل النوم.', 'La akhri Al-Ikhlaas iyo An-Naas ka hor hurdada.'],
    },
  },
  {
    id: 'surah-nas', kind: 'surah', sort: 4,
    title: ['An-Nas', 'الناس', 'An-Naas'],
    body: {
      number: 114, ayahs: 6,
      arabic: 'قُلْ أَعُوذُ بِرَبِّ النَّاسِ ﴿١﴾ مَلِكِ النَّاسِ ﴿٢﴾ إِلَٰهِ النَّاسِ ﴿٣﴾ مِن شَرِّ الْوَسْوَاسِ الْخَنَّاسِ ﴿٤﴾ الَّذِي يُوَسْوِسُ فِي صُدُورِ النَّاسِ ﴿٥﴾ مِنَ الْجِنَّةِ وَالنَّاسِ ﴿٦﴾',
      meaning: [
        'Say: I seek refuge with the Lord of mankind, the King of mankind, the God of mankind, from the evil of the whisperer who withdraws, who whispers in the hearts of people, from among jinn and mankind.',
        'سورة الناس آخر سورة في القرآن.',
        'An-Naas waa suuradda ugu dambaysa Qur’aanka.',
      ],
      tip: ['It is the last surah of the Qur’an.', 'هي آخر سورة في المصحف.', 'Waa suuradda ugu dambaysa mushafka.'],
    },
  },
  {
    id: 'surah-kawthar', kind: 'surah', sort: 5,
    title: ['Al-Kawthar', 'الكوثر', 'Al-Kawthar'],
    body: {
      number: 108, ayahs: 3,
      arabic: 'إِنَّا أَعْطَيْنَاكَ الْكَوْثَرَ ﴿١﴾ فَصَلِّ لِرَبِّكَ وَانْحَرْ ﴿٢﴾ إِنَّ شَانِئَكَ هُوَ الْأَبْتَرُ ﴿٣﴾',
      meaning: [
        'Indeed We have given you al-Kawthar. So pray to your Lord and sacrifice. Indeed the one who hates you is the one cut off.',
        'سورة الكوثر أقصر سورة في القرآن.',
        'Al-Kawthar waa suuradda ugu gaaban Qur’aanka.',
      ],
      tip: ['It is the shortest surah: only three ayat.', 'أقصر سورة بثلاث آيات.', 'Waa suuradda ugu gaaban: saddex aayad.'],
    },
  },
  {
    id: 'surah-asr', kind: 'surah', sort: 6,
    title: ['Al-Asr', 'العصر', 'Al-Casr'],
    body: {
      number: 103, ayahs: 3,
      arabic: 'وَالْعَصْرِ ﴿١﴾ إِنَّ الْإِنسَانَ لَفِي خُسْرٍ ﴿٢﴾ إِلَّا الَّذِينَ آمَنُوا وَعَمِلُوا الصَّالِحَاتِ وَتَوَاصَوْا بِالْحَقِّ وَتَوَاصَوْا بِالصَّبْرِ ﴿٣﴾',
      meaning: [
        'By time, mankind is surely in loss, except those who believe, do righteous deeds, and advise one another to truth and to patience.',
        'سورة العصر تذكر أربع خصال للنجاة.',
        'Al-Casr waxay sheegaysaa afar sifo oo badbaado leh.',
      ],
      tip: ['Four keys: faith, good deeds, truth and patience.', 'أربع خصال: الإيمان والعمل الصالح والحق والصبر.', 'Afar fure: iimaan, camal wanaagsan, xaq iyo samir.'],
    },
  },

  /* ---------------------------- 5 pillars -------------------------------- */
  { id: 'pillar-shahadah', kind: 'pillar', sort: 1, title: ['Shahadah', 'الشهادة', 'Shahaadada'], body: { icon: 'star', text: ['Declaring that there is no god but Allah and that Muhammad ﷺ is His messenger.', 'شهادة أن لا إله إلا الله وأن محمدًا رسول الله.', 'Markaad caddayso in aan Ilaah kale jirin Alle mooyee, Nabigana ﷺ uu yahay Rasuulkiisa.'], quiz: { q: ['How many pillars of Islam are there?', 'كم أركان الإسلام؟', 'Immisa tiir ayaa Islaamku leeyahay?'], options: [['5', '٥', '5'], ['3', '٣', '3'], ['6', '٦', '6']], answer: 0 } } },
  { id: 'pillar-salah', kind: 'pillar', sort: 2, title: ['Salah', 'الصلاة', 'Salaadda'], body: { icon: 'prayer', text: ['Five daily prayers: Fajr, Dhuhr, Asr, Maghrib and Isha.', 'خمس صلوات في اليوم: الفجر والظهر والعصر والمغرب والعشاء.', 'Shan salaadood maalintii: Fajr, Dhuhr, Casr, Maghrib iyo Cishaa.'], quiz: { q: ['How many daily prayers are obligatory?', 'كم عدد الصلوات المفروضة يوميًا؟', 'Immisa salaadood maalintii waa waajib?'], options: [['3', '٣', '3'], ['5', '٥', '5'], ['7', '٧', '7']], answer: 1 } } },
  { id: 'pillar-zakat', kind: 'pillar', sort: 3, title: ['Zakat', 'الزكاة', 'Sakada'], body: { icon: 'wallet', text: ['Giving 2.5% of savings held for a lunar year to those in need.', 'إخراج ٢٫٥٪ من المال الذي حال عليه الحول للفقراء.', 'Bixinta 2.5% ee lacagta sanad dayaxeed la hayo dadka u baahan.'], quiz: { q: ['What is the zakat rate on cash?', 'ما مقدار زكاة النقود؟', 'Immisa sakada lacagta?'], options: [['2.5%', '٢٫٥٪', '2.5%'], ['10%', '١٠٪', '10%'], ['1%', '١٪', '1%']], answer: 0 } } },
  { id: 'pillar-sawm', kind: 'pillar', sort: 4, title: ['Sawm', 'الصوم', 'Soonka'], body: { icon: 'moon', text: ['Fasting from dawn to sunset in Ramadan.', 'الصيام من الفجر إلى المغرب في رمضان.', 'Soonka laga bilaabo waaberiga ilaa qorrax dhaca Ramadaan.'], quiz: { q: ['In which month do Muslims fast?', 'في أي شهر يصوم المسلمون؟', 'Bishii kee ayaa muslimiintu soomaan?'], options: [['Ramadan', 'رمضان', 'Ramadaan'], ['Rajab', 'رجب', 'Rajab'], ['Shawwal', 'شوال', 'Shawwaal']], answer: 0 } } },
  { id: 'pillar-hajj', kind: 'pillar', sort: 5, title: ['Hajj', 'الحج', 'Xajka'], body: { icon: 'kaaba', text: ['Pilgrimage to Makkah once in a lifetime for those who are able.', 'الحج إلى مكة مرة في العمر لمن استطاع.', 'Xajka Maka hal mar nololka qofka awooda.'], quiz: { q: ['Where is Hajj performed?', 'أين يُؤدى الحج؟', 'Xaggee Xajka lagu gudanayaa?'], options: [['Madinah', 'المدينة', 'Madina'], ['Makkah', 'مكة', 'Maka'], ['Jerusalem', 'القدس', 'Qudus']], answer: 1 } } },

  /* ---------------------------- 6 manners -------------------------------- */
  { id: 'manner-salam', kind: 'manner', sort: 1, title: ['Say salam', 'إفشاء السلام', 'Salaanta'], body: { icon: 'chat', text: ['Greet others with “as-salamu alaykum”.', 'ألقِ السلام على من تعرف ومن لا تعرف.', 'Salaan dadka, qofkaad taqaan iyo kan aad aqoon.'], source: 'Sahih al-Bukhari 6236' } },
  { id: 'manner-truth', kind: 'manner', sort: 2, title: ['Tell the truth', 'الصدق', 'Runta'], body: { icon: 'check', text: ['Truthfulness leads to goodness and goodness leads to Paradise.', 'الصدق يهدي إلى البر، والبر يهدي إلى الجنة.', 'Runta waxay u horseedaa wanaagga, wanaagguna Jannada.'], source: 'Sahih al-Bukhari 6094' } },
  { id: 'manner-parents', kind: 'manner', sort: 3, title: ['Honour parents', 'بر الوالدين', 'Waalidka'], body: { icon: 'heart', text: ['Be kind to your mother and father and speak to them gently.', 'أحسن إلى والديك وقل لهما قولًا كريمًا.', 'U naxariiso waalidkaa oo hadal wanaagsan kula hadal.'], source: 'Qur’an 17:23' } },
  { id: 'manner-neighbour', kind: 'manner', sort: 4, title: ['Care for neighbours', 'الجار', 'Deriska'], body: { icon: 'home', text: ['Whoever believes in Allah and the Last Day should be good to his neighbour.', 'من كان يؤمن بالله واليوم الآخر فليكرم جاره.', 'Kii rumaysan Alle iyo Maalinta Dambe ha wanaajiyo deriskiisa.'], source: 'Sahih al-Bukhari 6019' } },
  { id: 'manner-share', kind: 'manner', sort: 5, title: ['Share and be kind', 'الكرم', 'Deegsiga'], body: { icon: 'gift', text: ['Allah loves those who are gentle and generous with others.', 'الله يحب الرفق في الأمور.', 'Alle wuxuu jecel yahay qofka jilicsan oo deeqsi ah.'], source: 'Sahih al-Bukhari 6024' } },
  { id: 'manner-clean', kind: 'manner', sort: 6, title: ['Stay clean', 'النظافة', 'Nadaafadda'], body: { icon: 'drop', text: ['Purity is half of faith.', 'الطهور شطر الإيمان.', 'Nadaafaddu waa badh iimaanka.'], source: 'Sahih Muslim 223' } },

  /* ------------------------- 4 prophet stories ---------------------------- */
  { id: 'story-adam', kind: 'story', sort: 1, title: ['Adam', 'آدم', 'Aadam'], body: { text: ['Allah created Adam and taught him the names of things. When the angels prostrated, Iblis refused out of pride.', 'خلق الله آدم وعلمه الأسماء، وسجد الملائكة إلا إبليس استكبر.', 'Alle wuxuu abuuray Aadam oo baray magacyada, malaa’igtii way sujuudeen, Ibliisna wuu kibray.'], source: 'Qur’an 2:30–34', question: { q: ['Who was the first prophet?', 'من أول الأنبياء؟', 'Yaa nabigii ugu horreeyay?'], options: [['Adam', 'آدم', 'Aadam'], ['Nuh', 'نوح', 'Nuux'], ['Musa', 'موسى', 'Muuse']], answer: 0 } } },
  { id: 'story-nuh', kind: 'story', sort: 2, title: ['Nuh and the ark', 'نوح والسفينة', 'Nuux iyo doonnidii'], body: { text: ['Nuh called his people to worship Allah alone for a very long time. Allah told him to build an ark, and those who believed were saved.', 'دعا نوح قومه إلى عبادة الله وحده، فأمره الله ببناء السفينة، ونجا المؤمنون.', 'Nuux wuxuu dadkiisa ugu yeedhay inay Alle keligiis caabudaan, Alle wuxuu ku amray inuu doonni dhiso, rumaystayaashuna way badbaadeen.'], source: 'Qur’an 11:25–48', question: { q: ['What did Nuh build?', 'ماذا بنى نوح؟', 'Maxaa Nuux dhisay?'], options: [['A house', 'بيتًا', 'Guri'], ['An ark', 'سفينة', 'Doonni'], ['A wall', 'سورًا', 'Darbi']], answer: 1 } } },
  { id: 'story-ibrahim', kind: 'story', sort: 3, title: ['Ibrahim', 'إبراهيم', 'Ibraahiim'], body: { text: ['Ibrahim taught that only Allah deserves worship. With his son Isma‘il he raised the foundations of the Ka‘bah.', 'علّم إبراهيم أن العبادة لله وحده، ورفع مع ابنه إسماعيل قواعد الكعبة.', 'Ibraahiim wuxuu baray in Alle keligiis la caabudo, wuxuuna wiilkiis Ismaaciil la qaaday saldhigyada Kacbada.'], source: 'Qur’an 2:127', question: { q: ['Who helped Ibrahim build the Ka‘bah?', 'من ساعد إبراهيم في بناء الكعبة؟', 'Yaa Ibraahiim ka caawiyay dhismaha Kacbada?'], options: [['Isma‘il', 'إسماعيل', 'Ismaaciil'], ['Musa', 'موسى', 'Muuse'], ['Yusuf', 'يوسف', 'Yuusuf']], answer: 0 } } },
  { id: 'story-yusuf', kind: 'story', sort: 4, title: ['Yusuf', 'يوسف', 'Yuusuf'], body: { text: ['Yusuf was thrown into a well by his brothers, then became a trusted minister in Egypt. He forgave them in the end.', 'ألقى إخوة يوسف في الجب، ثم صار عزيزًا لمصر، وعفا عنهم في النهاية.', 'Yuusuf walaalihiis ceel ku tuureen, kadibna wuxuu noqday wasiir Masar, ugu dambayntiina wuu cafiyay.'], source: 'Qur’an 12:4–101', question: { q: ['What did Yusuf become in Egypt?', 'ماذا صار يوسف في مصر؟', 'Maxaa Yuusuf ka noqday Masar?'], options: [['A farmer', 'مزارعًا', 'Beeraley'], ['A minister', 'عزيزًا', 'Wasiir'], ['A sailor', 'بحارًا', 'Badmaax']], answer: 1 } } },
];
