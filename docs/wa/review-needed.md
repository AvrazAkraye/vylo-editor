# Strings for a native reader

Sorani (ckb) and Badini (kmr) text written by the WhatsApp broadcast packages, best effort, for a native speaker to
check. Each package appends its own section (docs/WA.md).

## audience

The country names of the picker (`COUNTRIES` in `app/src/whatsappaudience.ts`, the `ckb` and `kmr` fields). The
Arabic is meant to be the usual short names; the Kurdish ones were written from Sorani and Badini (Arabic script)
spelling as best this package knew it. Points to check in particular: whether Badini should use `ڵ`/`ۆ` (it is written
without them here: `ئەلمانیا`, `هولەندا`, `پولەندا`), Türkiye as `تورکیا`, and the two joined entries (US & Canada,
Russia & Kazakhstan), which stand for one calling code each.

| iso | English | Arabic | Sorani (ckb) | Badini (kmr) |
|---|---|---|---|---|
| IQ | Iraq | العراق | عێراق | عیراق |
| TR | Türkiye | تركيا | تورکیا | تورکیا |
| IR | Iran | إيران | ئێران | ئیران |
| SY | Syria | سوريا | سووریا | سووریا |
| SA | Saudi Arabia | السعودية | سعودیە | سعودیە |
| AE | United Arab Emirates | الإمارات | ئیمارات | ئیمارات |
| KW | Kuwait | الكويت | کوەیت | کوەیت |
| JO | Jordan | الأردن | ئوردن | ئوردن |
| LB | Lebanon | لبنان | لوبنان | لوبنان |
| EG | Egypt | مصر | میسر | میسر |
| QA | Qatar | قطر | قەتەر | قەتەر |
| BH | Bahrain | البحرين | بەحرەین | بەحرەین |
| OM | Oman | عُمان | عومان | عومان |
| YE | Yemen | اليمن | یەمەن | یەمەن |
| DE | Germany | ألمانيا | ئەڵمانیا | ئەلمانیا |
| SE | Sweden | السويد | سوید | سوید |
| GB | United Kingdom | المملكة المتحدة | بەریتانیا | بەریتانیا |
| US | United States & Canada | الولايات المتحدة وكندا | ئەمریکا و کەنەدا | ئەمریکا و کەنەدا |
| NL | Netherlands | هولندا | هۆڵەندا | هولەندا |
| FR | France | فرنسا | فەرەنسا | فەرەنسا |
| AT | Austria | النمسا | نەمسا | نەمسا |
| CH | Switzerland | سويسرا | سویسرا | سویسرا |
| NO | Norway | النرويج | نەرویج | نەرویج |
| DK | Denmark | الدنمارك | دانیمارک | دانیمارک |
| FI | Finland | فنلندا | فینلەندا | فینلەندا |
| BE | Belgium | بلجيكا | بەلجیکا | بەلجیکا |
| IT | Italy | إيطاليا | ئیتاڵیا | ئیتالیا |
| ES | Spain | إسبانيا | ئیسپانیا | ئیسپانیا |
| GR | Greece | اليونان | یۆنان | یونان |
| CY | Cyprus | قبرص | قوبرس | قوبرس |
| RU | Russia & Kazakhstan | روسيا وكازاخستان | ڕووسیا و کازاخستان | ڕووسیا و کازاخستان |
| AM | Armenia | أرمينيا | ئەرمەنستان | ئەرمەنستان |
| GE | Georgia | جورجيا | جۆرجیا | جۆرجیا |
| AZ | Azerbaijan | أذربيجان | ئازەربایجان | ئازەربایجان |
| PS | Palestine | فلسطين | فەلەستین | فەلەستین |
| LY | Libya | ليبيا | لیبیا | لیبیا |
| TN | Tunisia | تونس | تونس | تونس |
| DZ | Algeria | الجزائر | جەزائیر | جەزائیر |
| MA | Morocco | المغرب | مەغریب | مەغریب |
| SD | Sudan | السودان | سودان | سودان |
| AF | Afghanistan | أفغانستان | ئەفغانستان | ئەفغانستان |
| PK | Pakistan | باكستان | پاکستان | پاکستان |
| IN | India | الهند | هیندستان | هندستان |
| BD | Bangladesh | بنغلاديش | بەنگلادیش | بەنگلادیش |
| PH | Philippines | الفلبين | فلیپین | فلیپین |
| ID | Indonesia | إندونيسيا | ئیندۆنیزیا | ئیندونیزیا |
| AU | Australia | أستراليا | ئوسترالیا | ئوسترالیا |
| PL | Poland | بولندا | پۆڵەندا | پولەندا |
| UA | Ukraine | أوكرانيا | ئۆکرانیا | ئوکرانیا |
| CN | China | الصين | چین | چین |
| MY | Malaysia | ماليزيا | مالیزیا | مالیزیا |

The header words the reader recognises (`PHONE_WORDS`, `NAME_WORDS` and the first/last-name words in the same file) are
never shown to anyone, but a native reader may know common spellings that are missing: for Sorani `ژمارە`, `ژمارەی
تەلەفۆن`, `مۆبایل`, `ناو`, `ناوی تەواو`, `کڕیار`, `پاشناو`; for Badini `ژمارا`, `تەلەفون`, `موبایل`, `ناڤ`, `ناڤێ`,
`hejmar`, `hejmara telefonê`, `nav`, `navê`, `xerîdar`, `paşnav`.
