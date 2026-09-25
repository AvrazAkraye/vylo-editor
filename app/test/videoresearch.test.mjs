// Looking the subject up before a video is planned: "UoD" → the University of
// Duhok's real facts, pictures and website, from Wikidata, Wikipedia, Commons
// and Openverse — and, where the route allows, the model's own web search.
//
// What matters: the right thing is looked up (the model names the subject;
// without it, a heuristic still finds "UoD" or "جامعة دهوك"; among namesakes,
// the one in the Kurdistan Region wins when nothing says otherwise); every fact
// carries its source and link; only pictures under licences that allow reuse
// are kept, and a Wikipedia's fair-use logo never is; nothing but the facts the
// person left on reaches the model; the subject's own pictures go into the
// scenes before any stock search, portraits only to their people; the model's
// web search can only add, never block — a 4xx is remembered, a hang is cut
// off; and every request is a plain GET with no header. The fixtures are real
// answers recorded from this machine on 2026-09-25 and trimmed to the fields
// read; requests go to a fake `Get` and the canvas step is a fake `encode`, so
// nothing here touches a socket or needs a browser.
import {
  HOSTS, LABELS, WEB_SEARCH_TOOL, chooseEntity, findLogo, siteLogo, siteLogoCandidates, withSiteLogo, mergeBrief, commonsCategoryUrl, commonsFilesUrl, commonsTitleUrl, entitiesUrl, factsBlock,
  findSubjects, fold, forgetRefusals, formatTime, fromCommonsFiles, fromSearch, fromSummary, guessSubjects, parseResearch,
  parseSubjects, pictureTitle, placeBriefPictures, portraitOf, readEntity, researchPrompt, researchVideo, sameName,
  searchLanguage, searchUrl, subjectsPrompt, summaryUrl, summaryWikis, webFacts, webSearchRefused, wantsLookup,
} from '../.test-build/videoresearch.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = (v) => JSON.parse(JSON.stringify(v));
const failure = async (p) => { try { await p; return null; } catch (e) { return e; } };

// ── fixtures (real responses, trimmed) ────────────────────────────────────
//
// searchDuhok / searchUoD — wbsearchentities for "University of Duhok" and "UoD" (UoD's first hit is
//   the University of Derby, the second Duhok; access-control-allow-origin: * on every Wikidata answer).
// candidatesDuhok / candidatesUoD — wbgetentities labels|descriptions|aliases|sitelinks for those hits.
// entityUoD — Q3666468 with its claims: no logo (P154), no image (P18), no Commons category; inception
//   1992, website http://uod.ac, country Q796, located in Q152831. labelsUoD — Q796, Q152831.
// summaryArUoD / summaryCkbUoD — the REST summaries (enwiki has no page: a 404). The arwiki lead image is
//   a local "fair use" file, not on Commons.
// titleEnUoD / titleArUoD — Commons intitle:"…" searches: nothing in English, the main gate in Arabic.
// openverseUoD / openverseDuhok — Openverse for the name and for the city.
// entityAUB, labelsAUB, peopleAUB, categoryAUB — the American University of Beirut: an image, a Commons
//   category, a founder (Daniel Bliss) with a portrait, two student counts (the one with P585 is later).
// filesOxford — Commons imageinfo for University of Oxford.svg (P154, public domain), its aerial
//   panorama, and Rev. Daniel Bliss.jpg.
const FX = {"searchDuhok":{"search":[{"id":"Q3666468","label":"University of Duhok","description":"university in Iraq","match":{"type":"label","language":"en","text":"University of Duhok"}},{"id":"Q101012636","label":"University of Duhok Faculty of Medical Science","description":"faculty","match":{"type":"label","language":"en","text":"University of Duhok Faculty of Medical Science"}},{"id":"Q101012635","label":"University of Duhok School of Medicine","description":"academic department","match":{"type":"label","language":"en","text":"University of Duhok School of Medicine"}}],"success":1},"searchUoD":{"search":[{"id":"Q3183295","label":"University of Derby","description":"university in Derby, United Kingdom","match":{"type":"alias","language":"en","text":"UoD"}},{"id":"Q3666468","label":"University of Duhok","description":"university in Iraq","match":{"type":"alias","language":"en","text":"UoD"}},{"id":"Q14577","label":"Udligenswil","description":"municipality in the canton of Lucerne, Switzerland","match":{"type":"alias","language":"en","text":"Uodelgoswilare"}},{"id":"Q116959466","label":"Universidad Odontológica Dominicana","description":"education organization in Santo Domingo, Dominican Republic","match":{"type":"alias","language":"en","text":"UOD"}},{"id":"Q60756006","label":"School of Life Sciences","description":"life sciences school at the University of Dundee, Scotland","match":{"type":"alias","language":"en","text":"UoD Life Sciences"}},{"id":"Q47253","label":"worm","description":"any animal with a long, pipe-like body and no limbs","match":{"type":"label","language":"tl","text":"uod"}}],"success":1},"candidatesUoD":{"entities":{"Q3183295":{"type":"item","id":"Q3183295","labels":{"en":{"language":"en","value":"University of Derby"},"ar":{"language":"ar","value":"جامعة داربي"}},"descriptions":{"ar":{"language":"ar","value":"كلية في المملكة المتحدة"},"en":{"language":"en","value":"university in Derby, United Kingdom"}},"aliases":{"en":[{"language":"en","value":"Derby College of Art and Technology"},{"language":"en","value":"Derby College"},{"language":"en","value":"UoD"}]},"sitelinks":{"afwiki":{"site":"afwiki","title":"Universiteit van Derby"},"arwiki":{"site":"arwiki","title":"جامعة داربي"},"arzwiki":{"site":"arzwiki","title":"جامعة داربى"},"azbwiki":{"site":"azbwiki","title":"داربی بیلیم‌یوردو"},"bewiki":{"site":"bewiki","title":"Дэрбійскі ўніверсітэт"},"elwiki":{"site":"elwiki","title":"Πανεπιστήμιο του Ντέρμπι"},"enwiki":{"site":"enwiki","title":"University of Derby"},"eowiki":{"site":"eowiki","title":"Universitato de Derbio"},"eswiki":{"site":"eswiki","title":"Universidad de Derby"},"fawiki":{"site":"fawiki","title":"دانشگاه داربی"},"frwiki":{"site":"frwiki","title":"Université de Derby"},"hewiki":{"site":"hewiki","title":"אוניברסיטת דרבי"},"plwiki":{"site":"plwiki","title":"Uniwersytet w Derby"},"pnbwiki":{"site":"pnbwiki","title":"ڈربی یونیورسٹی"},"svwiki":{"site":"svwiki","title":"University of Derby"},"tgwiki":{"site":"tgwiki","title":"Донишгоҳи Дерби"},"trwiki":{"site":"trwiki","title":"Derby Üniversitesi"},"urwiki":{"site":"urwiki","title":"یونیورسٹی آف ڈربی"},"zhwiki":{"site":"zhwiki","title":"德比大学"}}},"Q3666468":{"type":"item","id":"Q3666468","labels":{"ku-arab":{"language":"ku-arab","value":"زانینگەها دوهۆکێ"},"en":{"language":"en","value":"University of Duhok"},"ckb":{"language":"ckb","value":"زانکۆی دھۆک"},"ar":{"language":"ar","value":"جامعة دهوك"},"ku":{"language":"ku","value":"Zanîngeha Duhokê"}},"descriptions":{"ar":{"language":"ar","value":"جامعة في دهوك، کوردستان"},"en":{"language":"en","value":"university in Iraq"},"ckb":{"language":"ckb","value":"زانکۆیەکە لە باشووری کوردستان"},"ku":{"language":"ku","value":"unîversîte"}},"aliases":{"ku":[{"language":"ku","value":"Zankoya Duhokê"},{"language":"ku","value":"Zankoy Dohuk"}],"ar":[{"language":"ar","value":"جامعه دهوك"}],"en":[{"language":"en","value":"UoD"},{"language":"en","value":"UoD Malta Campus"},{"language":"en","value":"University of Dohuk"}],"ckb":[{"language":"ckb","value":"زانکۆیا دهۆک"},{"language":"ckb","value":"زانکویا دهوک"}]},"sitelinks":{"arwiki":{"site":"arwiki","title":"جامعة دهوك"},"arzwiki":{"site":"arzwiki","title":"جامعة دهوك"},"cawiki":{"site":"cawiki","title":"Universitat de Duhok"},"cebwiki":{"site":"cebwiki","title":"University of Duhok"},"ckbwiki":{"site":"ckbwiki","title":"زانکۆی دھۆک"},"dewiki":{"site":"dewiki","title":"University of Duhok"},"eswiki":{"site":"eswiki","title":"Universidad de Duhok"},"fawiki":{"site":"fawiki","title":"دانشگاه دهوک"},"kuwiki":{"site":"kuwiki","title":"Zanîngeha Dihokê"},"ptwiki":{"site":"ptwiki","title":"Universidade de Dohuk"},"svwiki":{"site":"svwiki","title":"University of Duhok"},"trwiki":{"site":"trwiki","title":"Duhok Üniversitesi"}}},"Q14577":{"type":"item","id":"Q14577","labels":{"en":{"language":"en","value":"Udligenswil"}},"descriptions":{"en":{"language":"en","value":"municipality in the canton of Lucerne, Switzerland"}},"aliases":{"en":[{"language":"en","value":"Udligenswil LU"},{"language":"en","value":"Uodelgoswilare"}]},"sitelinks":{"alswiki":{"site":"alswiki","title":"Udligenswil"},"cawiki":{"site":"cawiki","title":"Udligenswil"},"cebwiki":{"site":"cebwiki","title":"Udligenswil (munisipyo)"},"dewiki":{"site":"dewiki","title":"Udligenswil"},"enwiki":{"site":"enwiki","title":"Udligenswil"},"eowiki":{"site":"eowiki","title":"Udligenswil"},"eswiki":{"site":"eswiki","title":"Udligenswil"},"euwiki":{"site":"euwiki","title":"Udligenswil"},"frwiki":{"site":"frwiki","title":"Udligenswil"},"itwiki":{"site":"itwiki","title":"Udligenswil"},"kkwiki":{"site":"kkwiki","title":"Удлигенсвиль"},"lmowiki":{"site":"lmowiki","title":"Udligenswil"},"mswiki":{"site":"mswiki","title":"Udligenswil"},"nlwiki":{"site":"nlwiki","title":"Udligenswil"},"nnwiki":{"site":"nnwiki","title":"Udligenswil"},"plwiki":{"site":"plwiki","title":"Udligenswil"},"pmswiki":{"site":"pmswiki","title":"Udligenswil"},"ptwiki":{"site":"ptwiki","title":"Udligenswil"},"ruwiki":{"site":"ruwiki","title":"Удлигенсвиль"},"simplewiki":{"site":"simplewiki","title":"Udligenswil"},"sqwiki":{"site":"sqwiki","title":"Udligenswil"},"svwiki":{"site":"svwiki","title":"Udligenswil"},"ukwiki":{"site":"ukwiki","title":"Удлігенсвіль"},"uzwiki":{"site":"uzwiki","title":"Udligenswil"},"vecwiki":{"site":"vecwiki","title":"Udligenswil"},"warwiki":{"site":"warwiki","title":"Udligenswil"},"zhwiki":{"site":"zhwiki","title":"烏德利根斯維爾"}}},"Q116959466":{"type":"item","id":"Q116959466","labels":{"en":{"language":"en","value":"Universidad Odontológica Dominicana"}},"descriptions":{"en":{"language":"en","value":"education organization in Santo Domingo, Dominican Republic"}},"aliases":{"en":[{"language":"en","value":"UOD"}]},"sitelinks":{}},"Q60756006":{"type":"item","id":"Q60756006","labels":{"en":{"language":"en","value":"School of Life Sciences"}},"descriptions":{"en":{"language":"en","value":"life sciences school at the University of Dundee, Scotland"}},"aliases":{"en":[{"language":"en","value":"University of Dundee, School of Life Sciences"},{"language":"en","value":"UoD Life Sciences"}]},"sitelinks":{"enwiki":{"site":"enwiki","title":"School of Life Sciences (University of Dundee)"}}},"Q47253":{"type":"item","id":"Q47253","labels":{"ar":{"language":"ar","value":"دودة"},"en":{"language":"en","value":"worm"},"ku":{"language":"ku","value":"kurm"}},"descriptions":{"en":{"language":"en","value":"any animal with a long, pipe-like body and no limbs"}},"aliases":{"ar":[{"language":"ar","value":"الديدان"},{"language":"ar","value":"ديدان"}],"en":[{"language":"en","value":"worms"}]},"sitelinks":{"afwiki":{"site":"afwiki","title":"Wurm"},"anwiki":{"site":"anwiki","title":"Cuco"},"arcwiki":{"site":"arcwiki","title":"ܬܘܠܥܐ"},"arwiki":{"site":"arwiki","title":"دودة"},"astwiki":{"site":"astwiki","title":"Viérbene"},"aywiki":{"site":"aywiki","title":"Laq'u"},"azbwiki":{"site":"azbwiki","title":"سولوجانلار"},"bat_smgwiki":{"site":"bat_smgwiki","title":"Kėrmėns"},"bawiki":{"site":"bawiki","title":"Селәүсен"},"bclwiki":{"site":"bclwiki","title":"Ulod"},"be_x_oldwiki":{"site":"be_x_oldwiki","title":"Чарвякі"},"bewiki":{"site":"bewiki","title":"Чарвякі"},"bgwiki":{"site":"bgwiki","title":"Червей"},"bnwiki":{"site":"bnwiki","title":"কৃমি"},"brwiki":{"site":"brwiki","title":"Preñv"},"cawiki":{"site":"cawiki","title":"Cuc"},"cawikiquote":{"site":"cawikiquote","title":"Cuc"},"crhwiki":{"site":"crhwiki","title":"Suvalçan"},"cswiki":{"site":"cswiki","title":"Červ"},"cswikiquote":{"site":"cswikiquote","title":"Červ"},"cvwiki":{"site":"cvwiki","title":"Хурт"},"dawiki":{"site":"dawiki","title":"Orm"},"dewiki":{"site":"dewiki","title":"Würmer"},"dewikiquote":{"site":"dewikiquote","title":"Wurm"},"elwiki":{"site":"elwiki","title":"Σκουλήκι"},"enwiki":{"site":"enwiki","title":"Worm"},"enwikiquote":{"site":"enwikiquote","title":"Worms"},"eowiki":{"site":"eowiki","title":"Vermo"},"eowikiquote":{"site":"eowikiquote","title":"Vermo"},"eswiki":{"site":"eswiki","title":"Gusano"},"eswikiquote":{"site":"eswikiquote","title":"Gusano"},"etwiki":{"site":"etwiki","title":"Ussid"},"etwikiquote":{"site":"etwikiquote","title":"Uss"},"euwiki":{"site":"euwiki","title":"Har"},"fawiki":{"site":"fawiki","title":"کرم (جانور)"},"fiwiki":{"site":"fiwiki","title":"Mato"},"fiwikiquote":{"site":"fiwikiquote","title":"Mato"},"frwiki":{"site":"frwiki","title":"Ver"},"fywiki":{"site":"fywiki","title":"Wjirm"},"gawiki":{"site":"gawiki","title":"Péist talún"},"gdwiki":{"site":"gdwiki","title":"Cnuimh"},"glwiki":{"site":"glwiki","title":"Verme"},"gnwiki":{"site":"gnwiki","title":"Yso"},"gucwiki":{"site":"gucwiki","title":"Jokoma"},"hewiki":{"site":"hewiki","title":"תולעים"},"hrwiki":{"site":"hrwiki","title":"Crvi"},"htwiki":{"site":"htwiki","title":"Vè (bèt)"},"huwiki":{"site":"huwiki","title":"Giliszta"},"hywiki":{"site":"hywiki","title":"Որդեր"},"idwiki":{"site":"idwiki","title":"Cacing"},"iowiki":{"site":"iowiki","title":"Vermo"},"iswiki":{"site":"iswiki","title":"Ormur"},"itwiki":{"site":"itwiki","title":"Verme"},"itwikiquote":{"site":"itwikiquote","title":"Verme"},"iuwiki":{"site":"iuwiki","title":"ᖁᐱᓪᕈᖅ"},"jawiki":{"site":"jawiki","title":"蠕虫"},"jvwiki":{"site":"jvwiki","title":"Cacing"},"kawiki":{"site":"kawiki","title":"ჭიაყელები"},"kcgwiki":{"site":"kcgwiki","title":"A̱ma̱njhyii̱t"},"kkwiki":{"site":"kkwiki","title":"Құрттар"},"knwiki":{"site":"knwiki","title":"ಹುಳು"},"kowiki":{"site":"kowiki","title":"벌레"},"kowikiquote":{"site":"kowikiquote","title":"벌레"},"kuwiki":{"site":"kuwiki","title":"Kirm"},"kwwiki":{"site":"kwwiki","title":"Pryv"},"lawiki":{"site":"lawiki","title":"Vermis"},"liwiki":{"site":"liwiki","title":"Wörm"},"lnwiki":{"site":"lnwiki","title":"Mosɔ́pi"},"ltwiki":{"site":"ltwiki","title":"Kirmėlė"},"lvwiki":{"site":"lvwiki","title":"Tārpi"},"mgwiki":{"site":"mgwiki","title":"Kankana"},"mkwiki":{"site":"mkwiki","title":"Црв"},"mlwiki":{"site":"mlwiki","title":"വിര"},"mnwiki":{"site":"mnwiki","title":"Өт"},"mrwiki":{"site":"mrwiki","title":"कृमी"},"mswiki":{"site":"mswiki","title":"Cacing"},"mznwiki":{"site":"mznwiki","title":"آجیک"},"napwiki":{"site":"napwiki","title":"Vèrme"},"ndswiki":{"site":"ndswiki","title":"Wörmer"},"nlwiki":{"site":"nlwiki","title":"Wormen (dieren)"},"nnwiki":{"site":"nnwiki","title":"Makk"},"nowiki":{"site":"nowiki","title":"Makk"},"ocwiki":{"site":"ocwiki","title":"Vèrm"},"oswiki":{"site":"oswiki","title":"Зулчъытæ"},"pamwiki":{"site":"pamwiki","title":"Bulati"},"plwiki":{"site":"plwiki","title":"Robaki"},"plwikiquote":{"site":"plwikiquote","title":"Robak"},"ptwiki":{"site":"ptwiki","title":"Verme"},"quwiki":{"site":"quwiki","title":"Kuru"},"rowiki":{"site":"rowiki","title":"Vierme"},"ruwiki":{"site":"ruwiki","title":"Черви"},"ruwikiquote":{"site":"ruwikiquote","title":"Черви"},"sawiki":{"site":"sawiki","title":"कीटः"},"scnwiki":{"site":"scnwiki","title":"Càmula (tignola)"},"scowiki":{"site":"scowiki","title":"Wirm"},"shwiki":{"site":"shwiki","title":"Crvi"},"simplewiki":{"site":"simplewiki","title":"Worm"},"skwiki":{"site":"skwiki","title":"Červy (taxón)"},"skwikiquote":{"site":"skwikiquote","title":"Červ"},"slwiki":{"site":"slwiki","title":"Črv"},"srwiki":{"site":"srwiki","title":"Црв"},"srwikiquote":{"site":"srwikiquote","title":"Црв"},"svwiki":{"site":"svwiki","title":"Maskar"},"swwiki":{"site":"swwiki","title":"Mnyoo"},"thwiki":{"site":"thwiki","title":"หนอน"},"tlwiki":{"site":"tlwiki","title":"Uod"},"tokwiki":{"site":"tokwiki","title":"pipi linja"},"trwiki":{"site":"trwiki","title":"Solucan"},"ukwiki":{"site":"ukwiki","title":"Черви"},"ukwikiquote":{"site":"ukwikiquote","title":"Черви"},"uzwiki":{"site":"uzwiki","title":"Chuvalchanglar"},"viwiki":{"site":"viwiki","title":"Giun"},"warwiki":{"site":"warwiki","title":"Ulod"},"wuuwiki":{"site":"wuuwiki","title":"蠕虫"},"xmfwiki":{"site":"xmfwiki","title":"ღვენწკეფი"},"yiwiki":{"site":"yiwiki","title":"ווארעם"},"yowiki":{"site":"yowiki","title":"Aràn"},"zh_yuewiki":{"site":"zh_yuewiki","title":"蠕蟲"},"zhwiki":{"site":"zhwiki","title":"蠕虫"}}}},"success":1},"candidatesDuhok":{"entities":{"Q3666468":{"type":"item","id":"Q3666468","labels":{"ku-arab":{"language":"ku-arab","value":"زانینگەها دوهۆکێ"},"en":{"language":"en","value":"University of Duhok"},"ckb":{"language":"ckb","value":"زانکۆی دھۆک"},"ar":{"language":"ar","value":"جامعة دهوك"},"ku":{"language":"ku","value":"Zanîngeha Duhokê"}},"descriptions":{"ar":{"language":"ar","value":"جامعة في دهوك، کوردستان"},"en":{"language":"en","value":"university in Iraq"},"ckb":{"language":"ckb","value":"زانکۆیەکە لە باشووری کوردستان"},"ku":{"language":"ku","value":"unîversîte"}},"aliases":{"ku":[{"language":"ku","value":"Zankoya Duhokê"},{"language":"ku","value":"Zankoy Dohuk"}],"ar":[{"language":"ar","value":"جامعه دهوك"}],"en":[{"language":"en","value":"UoD"},{"language":"en","value":"UoD Malta Campus"},{"language":"en","value":"University of Dohuk"}],"ckb":[{"language":"ckb","value":"زانکۆیا دهۆک"},{"language":"ckb","value":"زانکویا دهوک"}]},"sitelinks":{"arwiki":{"site":"arwiki","title":"جامعة دهوك"},"arzwiki":{"site":"arzwiki","title":"جامعة دهوك"},"cawiki":{"site":"cawiki","title":"Universitat de Duhok"},"cebwiki":{"site":"cebwiki","title":"University of Duhok"},"ckbwiki":{"site":"ckbwiki","title":"زانکۆی دھۆک"},"dewiki":{"site":"dewiki","title":"University of Duhok"},"eswiki":{"site":"eswiki","title":"Universidad de Duhok"},"fawiki":{"site":"fawiki","title":"دانشگاه دهوک"},"kuwiki":{"site":"kuwiki","title":"Zanîngeha Dihokê"},"ptwiki":{"site":"ptwiki","title":"Universidade de Dohuk"},"svwiki":{"site":"svwiki","title":"University of Duhok"},"trwiki":{"site":"trwiki","title":"Duhok Üniversitesi"}}},"Q101012636":{"type":"item","id":"Q101012636","labels":{"en":{"language":"en","value":"University of Duhok Faculty of Medical Science"}},"descriptions":{"en":{"language":"en","value":"faculty"}},"aliases":{},"sitelinks":{}},"Q101012635":{"type":"item","id":"Q101012635","labels":{"en":{"language":"en","value":"University of Duhok School of Medicine"}},"descriptions":{"en":{"language":"en","value":"academic department"},"ar":{"language":"ar","value":"قسم أكاديمي"}},"aliases":{},"sitelinks":{}}},"success":1},"entityUoD":{"entities":{"Q3666468":{"type":"item","id":"Q3666468","labels":{"ku-arab":{"language":"ku-arab","value":"زانینگەها دوهۆکێ"},"en":{"language":"en","value":"University of Duhok"},"ckb":{"language":"ckb","value":"زانکۆی دھۆک"},"ar":{"language":"ar","value":"جامعة دهوك"},"ku":{"language":"ku","value":"Zanîngeha Duhokê"}},"descriptions":{"ar":{"language":"ar","value":"جامعة في دهوك، کوردستان"},"en":{"language":"en","value":"university in Iraq"},"ckb":{"language":"ckb","value":"زانکۆیەکە لە باشووری کوردستان"},"ku":{"language":"ku","value":"unîversîte"}},"aliases":{"ku":[{"language":"ku","value":"Zankoya Duhokê"},{"language":"ku","value":"Zankoy Dohuk"}],"ar":[{"language":"ar","value":"جامعه دهوك"}],"en":[{"language":"en","value":"UoD"},{"language":"en","value":"UoD Malta Campus"},{"language":"en","value":"University of Dohuk"}],"ckb":[{"language":"ckb","value":"زانکۆیا دهۆک"},{"language":"ckb","value":"زانکویا دهوک"}]},"sitelinks":{"arwiki":{"site":"arwiki","title":"جامعة دهوك"},"arzwiki":{"site":"arzwiki","title":"جامعة دهوك"},"cawiki":{"site":"cawiki","title":"Universitat de Duhok"},"cebwiki":{"site":"cebwiki","title":"University of Duhok"},"ckbwiki":{"site":"ckbwiki","title":"زانکۆی دھۆک"},"dewiki":{"site":"dewiki","title":"University of Duhok"},"eswiki":{"site":"eswiki","title":"Universidad de Duhok"},"fawiki":{"site":"fawiki","title":"دانشگاه دهوک"},"kuwiki":{"site":"kuwiki","title":"Zanîngeha Dihokê"},"ptwiki":{"site":"ptwiki","title":"Universidade de Dohuk"},"svwiki":{"site":"svwiki","title":"University of Duhok"},"trwiki":{"site":"trwiki","title":"Duhok Üniversitesi"}},"claims":{"P31":[{"mainsnak":{"snaktype":"value","property":"P31","datavalue":{"value":{"entity-type":"item","numeric-id":3918,"id":"Q3918"},"type":"wikibase-entityid"}},"rank":"normal"}],"P17":[{"mainsnak":{"snaktype":"value","property":"P17","datavalue":{"value":{"entity-type":"item","numeric-id":796,"id":"Q796"},"type":"wikibase-entityid"}},"rank":"normal"}],"P625":[{"mainsnak":{"snaktype":"value","property":"P625","datavalue":{"value":{"latitude":36.85924222222222,"longitude":42.921682777777775,"altitude":null,"precision":2.7777777777777776e-07,"globe":"http://www.wikidata.org/entity/Q2"},"type":"globecoordinate"}},"rank":"normal"}],"P571":[{"mainsnak":{"snaktype":"value","property":"P571","datavalue":{"value":{"time":"+1992-00-00T00:00:00Z","timezone":0,"before":0,"after":0,"precision":9,"calendarmodel":"http://www.wikidata.org/entity/Q1985727"},"type":"time"}},"rank":"normal"}],"P856":[{"mainsnak":{"snaktype":"value","property":"P856","datavalue":{"value":"http://uod.ac","type":"string"}},"rank":"normal"}],"P131":[{"mainsnak":{"snaktype":"value","property":"P131","datavalue":{"value":{"entity-type":"item","numeric-id":152831,"id":"Q152831"},"type":"wikibase-entityid"}},"rank":"normal"}]}}},"success":1},"labelsUoD":{"entities":{"Q796":{"type":"item","id":"Q796","labels":{"ar":{"language":"ar","value":"العراق"},"en":{"language":"en","value":"Iraq"},"ckb":{"language":"ckb","value":"عێراق"},"ku":{"language":"ku","value":"Iraq"}}},"Q152831":{"type":"item","id":"Q152831","labels":{"ar":{"language":"ar","value":"دهوك"},"ku-arab":{"language":"ku-arab","value":"دهۆک"},"en":{"language":"en","value":"Duhok"},"ckb":{"language":"ckb","value":"دھۆک"},"ku":{"language":"ku","value":"Dihok"}}}},"success":1},"summaryArUoD":{"type":"standard","title":"جامعة دهوك","thumbnail":{"source":"https://thumb.wikimedia.org/wikipedia/ar/thumb/6/68/%D8%AC%D8%A7%D9%85%D8%B9%D8%A9_%D8%AF%D9%87%D9%88%D9%83.jpg/330px-%D8%AC%D8%A7%D9%85%D8%B9%D8%A9_%D8%AF%D9%87%D9%88%D9%83.jpg?utm_source=ar.wikipedia.org&utm_campaign=api&utm_content=thumbnail","width":330,"height":390},"originalimage":{"source":"https://upload.wikimedia.org/wikipedia/ar/6/68/%D8%AC%D8%A7%D9%85%D8%B9%D8%A9_%D8%AF%D9%87%D9%88%D9%83.jpg?utm_source=ar.wikipedia.org&utm_campaign=api&utm_content=thumbnail_unscaled","width":336,"height":397},"lang":"ar","dir":"rtl","description":"جامعة في دهوك، کوردستان","content_urls":{"desktop":{"page":"https://ar.wikipedia.org/wiki/%D8%AC%D8%A7%D9%85%D8%B9%D8%A9_%D8%AF%D9%87%D9%88%D9%83"}},"extract":"جامعة دهوك هي من إحدى جامعات العراق التي تقع في محافظة دهوك. تأسست الجامعة في تشرين الأول / أكتوبر 1992 برئاسة الدكتور عصمت محمد خالد."},"summaryCkbUoD":{"type":"standard","title":"زانکۆی دھۆک","lang":"ckb","dir":"rtl","description":"زانکۆیەکە لە باشووری کوردستان","content_urls":{"desktop":{"page":"https://ckb.wikipedia.org/wiki/%D8%B2%D8%A7%D9%86%DA%A9%DB%86%DB%8C_%D8%AF%DA%BE%DB%86%DA%A9"}},"extract":"زانکوا دھۆک یەکێک لە زانکۆ گەورەکانی کوردستانە کە لە شاری دھۆکە. لە ٣١ی تشرینی یەکەمی ١٩٩٢ بە دوو کۆلیژ و ١٤٩ قوتابییەوە دامەزراوە. ئەمڕۆ ئەم زانکۆیە لە ١٧ کۆلیژ پێکھاتووە.\nلەزانکۆ دهۆک بەشی پزیشکی و چاندن یەکەمین بەش بوون کەبکرێنەوە لەزانکۆکە، لەهەردوو ساڵی یەکەمیدا بەشی پزیشکی ٤٨ قوتابی، و بەشی چاندن ١٦٦ قوتابی. لەدوای نەمانی ئابلووقەی نەتەوەیەکگرتووەکان لەعێراق ،زانکۆکە چالاکییەکانی زۆرتربوو وەبەشەکانیشی زۆرتر لێکرایەوە کە بەشەکانی زۆرکرا بۆ ١١ فاکەلتی لەنێوان ئەمەشدا کۆلێژی ئاداب و ئەندازیاری لەساڵی ١٩٩٤ دامەزرا، پاشا لە ساڵی ١٩٩٦ڤێتێرنەری و کۆلێژی کارگێڕی و ئابووری کرایەوە. لەدوای ئەمە فاکەلتی دیکەشی لێکرایەوە تاکوو ژمارەیان گەیشتە ١١."},"titleEnUoD":{"batchcomplete":true},"titleArUoD":{"batchcomplete":true,"query":{"pages":[{"pageid":46242676,"ns":6,"title":"File:جامعة دهوك البوابة.jpg","index":1,"imagerepository":"local","imageinfo":[{"size":81503,"width":960,"height":540,"thumburl":"https://upload.wikimedia.org/wikipedia/commons/0/00/%D8%AC%D8%A7%D9%85%D8%B9%D8%A9_%D8%AF%D9%87%D9%88%D9%83_%D8%A7%D9%84%D8%A8%D9%88%D8%A7%D8%A8%D8%A9.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail_unscaled","thumbwidth":640,"thumbheight":360,"url":"https://upload.wikimedia.org/wikipedia/commons/0/00/%D8%AC%D8%A7%D9%85%D8%B9%D8%A9_%D8%AF%D9%87%D9%88%D9%83_%D8%A7%D9%84%D8%A8%D9%88%D8%A7%D8%A8%D8%A9.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original","descriptionurl":"https://commons.wikimedia.org/wiki/File:%D8%AC%D8%A7%D9%85%D8%B9%D8%A9_%D8%AF%D9%87%D9%88%D9%83_%D8%A7%D9%84%D8%A8%D9%88%D8%A7%D8%A8%D8%A9.jpg","extmetadata":{"ObjectName":{"value":"جامعة دهوك البوابة","source":"mediawiki-metadata"},"ImageDescription":{"value":"جامعة دهوك البوابة","source":"commons-desc-page"},"Artist":{"value":"<a href=\"//commons.wikimedia.org/wiki/User:MuhammedIQ\" class=\"mw-redirect\" title=\"User:MuhammedIQ\">MuhammedIQ</a>","source":"commons-desc-page"},"LicenseShortName":{"value":"CC BY-SA 4.0","source":"commons-desc-page","hidden":""},"UsageTerms":{"value":"Creative Commons Attribution-Share Alike 4.0","source":"commons-desc-page"},"License":{"value":"cc-by-sa-4.0","source":"commons-templates","hidden":""}},"mime":"image/jpeg"}]}]}},"openverseUoD":{"result_count":2,"page_size":20,"results":[{"id":"edd420e4-471c-4f3f-a2ed-bc48ab3879af","title":"University of Duhok","foreign_landing_url":"https://www.flickr.com/photos/59442036@N08/5434110551","url":"https://live.staticflickr.com/5212/5434110551_ca8a6ee5dd_b.jpg","creator":"wgauthier","license":"by-sa","license_version":"2.0","provider":"flickr","source":"flickr","filetype":null,"mature":false,"height":683,"width":1024,"thumbnail":"https://api.openverse.org/v1/images/edd420e4-471c-4f3f-a2ed-bc48ab3879af/thumb/","unstable__sensitivity":[]},{"id":"a1e382e6-d98f-47a8-98fa-3e14c637f35b","title":"Dr wisam Murad","foreign_landing_url":"https://commons.wikimedia.org/w/index.php?curid=107699184","url":"https://upload.wikimedia.org/wikipedia/commons/d/d1/Dr_wisam_Murad.jpg","creator":"Wisam doughati","license":"by-sa","license_version":"4.0","provider":"wikimedia","source":"wikimedia","filetype":"jpg","mature":false,"height":2362,"width":1772,"thumbnail":"https://api.openverse.org/v1/images/a1e382e6-d98f-47a8-98fa-3e14c637f35b/thumb/","unstable__sensitivity":[]}]},"openverseDuhok":{"result_count":240,"page_size":20,"results":[{"id":"03b8a0b8-19c7-4d48-bd6f-6e0c83e1be97","title":"City of Duhok","foreign_landing_url":"https://commons.wikimedia.org/w/index.php?curid=37605325","url":"https://upload.wikimedia.org/wikipedia/commons/2/26/City_of_Duhok.jpg","creator":"Claus Weinberg","license":"by","license_version":"2.0","provider":"wikimedia","source":"wikimedia","filetype":"jpg","mature":false,"height":623,"width":960,"thumbnail":"https://api.openverse.org/v1/images/03b8a0b8-19c7-4d48-bd6f-6e0c83e1be97/thumb/","unstable__sensitivity":[]},{"id":"7cf5a40a-2781-48ce-9fa5-cbc62cdbc816","title":"Kurdistan Duhok City - kurdi","foreign_landing_url":"https://www.flickr.com/photos/8605011@N02/3550230400","url":"https://live.staticflickr.com/3313/3550230400_7510e2d7f8_b.jpg","creator":"Kurdistan Photo كوردستان","license":"by-sa","license_version":"2.0","provider":"flickr","source":"flickr","filetype":null,"mature":false,"height":1000,"width":1000,"thumbnail":"https://api.openverse.org/v1/images/7cf5a40a-2781-48ce-9fa5-cbc62cdbc816/thumb/","unstable__sensitivity":[]},{"id":"7f478d72-ffec-48b1-a560-629d69bfb559","title":"Duhok in Iraq","foreign_landing_url":"https://commons.wikimedia.org/w/index.php?curid=16495990","url":"https://upload.wikimedia.org/wikipedia/commons/2/26/Duhok_in_Iraq.svg","creator":"TUBS","license":"by-sa","license_version":"3.0","provider":"wikimedia","source":"wikimedia","filetype":"svg","mature":false,"height":1263,"width":1240,"thumbnail":"https://api.openverse.org/v1/images/7f478d72-ffec-48b1-a560-629d69bfb559/thumb/","unstable__sensitivity":[]},{"id":"68f3a3f9-b9ed-4151-a816-99a61e18973b","title":"Kurdistan Duhok City","foreign_landing_url":"https://www.flickr.com/photos/8605011@N02/3951403754","url":"https://live.staticflickr.com/2563/3951403754_76a007508a_b.jpg","creator":"Kurdistan Photo كوردستان","license":"by-sa","license_version":"2.0","provider":"flickr","source":"flickr","filetype":null,"mature":false,"height":681,"width":1024,"thumbnail":"https://api.openverse.org/v1/images/68f3a3f9-b9ed-4151-a816-99a61e18973b/thumb/","unstable__sensitivity":[]},{"id":"2d859731-8341-48ed-bec1-f9eff34a03e7","title":"Duhok Dam - Duhok - Kurdistan","foreign_landing_url":"https://www.flickr.com/photos/24326549@N04/21926306691","url":"https://live.staticflickr.com/5624/21926306691_ca50ce6452_b.jpg","creator":"alan abdulkadir Sae'd","license":"by","license_version":"2.0","provider":"flickr","source":"flickr","filetype":null,"mature":false,"height":682,"width":1024,"thumbnail":"https://api.openverse.org/v1/images/2d859731-8341-48ed-bec1-f9eff34a03e7/thumb/","unstable__sensitivity":[]}]},"entityAUB":{"entities":{"Q469482":{"type":"item","id":"Q469482","labels":{"en":{"language":"en","value":"American University of Beirut"},"ar":{"language":"ar","value":"الجامعة الأميركية في بيروت"},"ckb":{"language":"ckb","value":"زانکۆی ئەمریکی لە بەیرووت"}},"descriptions":{"en":{"language":"en","value":"private university in Lebanon"},"ar":{"language":"ar","value":"جامعة خاصة في لبنان"}},"aliases":{"ar":[{"language":"ar","value":"الكلية السورية البروتستانتية"},{"language":"ar","value":"الجامعة الأمريكية في بيروت"},{"language":"ar","value":"الكلية السورية الإنجيلية"},{"language":"ar","value":"المدرسة البطريكية"},{"language":"ar","value":"الجامعة الأمريكية ببيروت"},{"language":"ar","value":"الكلية الأميركية ببيروت"},{"language":"ar","value":"الجامعة الأميركية ببيروت"}],"en":[{"language":"en","value":"AUB"},{"language":"en","value":"Syrian Protestant College"},{"language":"en","value":"American University in Beirut"}]},"sitelinks":{"arwiki":{"site":"arwiki","title":"الجامعة الأميركية في بيروت"},"arzwiki":{"site":"arzwiki","title":"الجامعه الامريكيه فى بيروت"},"azbwiki":{"site":"azbwiki","title":"بیروت‌ده‌کی آمریکا بیلیم‌یوردو"},"azwiki":{"site":"azwiki","title":"Beyrut Amerika Universiteti"},"bewiki":{"site":"bewiki","title":"Амерыканскі ўніверсітэт Бейрута"},"cawiki":{"site":"cawiki","title":"Universitat Americana de Beirut"},"ckbwiki":{"site":"ckbwiki","title":"زانکۆی ئەمریکی لە بەیرووت"},"cswiki":{"site":"cswiki","title":"Americká univerzita v Bejrútu"},"dewiki":{"site":"dewiki","title":"Amerikanische Universität Beirut"},"elwiki":{"site":"elwiki","title":"Αμερικανικό Πανεπιστήμιο της Βηρυτού"},"enwiki":{"site":"enwiki","title":"American University of Beirut"},"eowiki":{"site":"eowiki","title":"Usona Universitato de Bejruto"},"eswiki":{"site":"eswiki","title":"Universidad Americana de Beirut"},"euwiki":{"site":"euwiki","title":"Beiruteko Amerikar Unibertsitatea"},"fawiki":{"site":"fawiki","title":"دانشگاه آمریکایی بیروت"},"fiwiki":{"site":"fiwiki","title":"Beirutin amerikkalainen yliopisto"},"frwiki":{"site":"frwiki","title":"Université américaine de Beyrouth"},"glwiki":{"site":"glwiki","title":"Universidade Americana de Beirut"},"hewiki":{"site":"hewiki","title":"האוניברסיטה האמריקאית בביירות"},"hiwiki":{"site":"hiwiki","title":"बेरूत का अमेरिकी विश्वविद्यालय"},"huwiki":{"site":"huwiki","title":"Bejrúti Amerikai Egyetem"},"hywiki":{"site":"hywiki","title":"Բեյրութի ամերիկյան համալսարան"},"hywwiki":{"site":"hywwiki","title":"Պէյրութի Ամերիկեան Համալսարան"},"idwiki":{"site":"idwiki","title":"Universitas Amerika di Beirut"},"itwiki":{"site":"itwiki","title":"Università americana di Beirut"},"jawiki":{"site":"jawiki","title":"ベイルート・アメリカン大学"},"kawiki":{"site":"kawiki","title":"ბეირუთის ამერიკული უნივერსიტეტი"},"kkwiki":{"site":"kkwiki","title":"Бейруттың Америка университеті"},"kowiki":{"site":"kowiki","title":"베이루트 아메리칸 대학교"},"mswiki":{"site":"mswiki","title":"Universiti Amerika di Beirut"},"nowiki":{"site":"nowiki","title":"American University of Beirut"},"plwiki":{"site":"plwiki","title":"Uniwersytet Amerykański w Bejrucie"},"pnbwiki":{"site":"pnbwiki","title":"امریکن یونیورسٹی بیروت"},"ptwiki":{"site":"ptwiki","title":"Universidade Americana de Beirute"},"rowiki":{"site":"rowiki","title":"Universitatea Americană din Beirut"},"ruwiki":{"site":"ruwiki","title":"Американский университет Бейрута"},"shwiki":{"site":"shwiki","title":"Američki univerzitet u Bejrutu"},"simplewiki":{"site":"simplewiki","title":"American University of Beirut"},"svwiki":{"site":"svwiki","title":"American University of Beirut"},"tgwiki":{"site":"tgwiki","title":"Донишгоҳи амрикоии Байрут"},"thwiki":{"site":"thwiki","title":"มหาวิทยาลัยอเมริกันแห่งเบรุต"},"tlwiki":{"site":"tlwiki","title":"Amerikanong Unibersidad ng Beirut"},"trwiki":{"site":"trwiki","title":"Beyrut Amerikan Üniversitesi"},"ukwiki":{"site":"ukwiki","title":"Американський університет у Бейруті"},"urwiki":{"site":"urwiki","title":"امریکن یونیورسٹی بیروت"},"uzwiki":{"site":"uzwiki","title":"Bayrut Amerika universiteti"},"zhwiki":{"site":"zhwiki","title":"贝鲁特美国大学"}},"claims":{"P373":[{"mainsnak":{"snaktype":"value","property":"P373","datavalue":{"value":"American University of Beirut","type":"string"}},"rank":"normal"}],"P31":[{"mainsnak":{"snaktype":"value","property":"P31","datavalue":{"value":{"entity-type":"item","numeric-id":902104,"id":"Q902104"},"type":"wikibase-entityid"}},"rank":"normal"}],"P625":[{"mainsnak":{"snaktype":"value","property":"P625","datavalue":{"value":{"latitude":33.899963888889,"longitude":35.482283333333,"altitude":null,"precision":0.00027777777777778,"globe":"http://www.wikidata.org/entity/Q2"},"type":"globecoordinate"}},"rank":"normal"}],"P856":[{"mainsnak":{"snaktype":"value","property":"P856","datavalue":{"value":"https://www.aub.edu.lb","type":"string"}},"rank":"normal"}],"P17":[{"mainsnak":{"snaktype":"value","property":"P17","datavalue":{"value":{"entity-type":"item","numeric-id":822,"id":"Q822"},"type":"wikibase-entityid"}},"rank":"normal"}],"P1451":[{"mainsnak":{"snaktype":"value","property":"P1451","datavalue":{"value":{"text":"That they may have life and have it more abundantly","language":"en"},"type":"monolingualtext"}},"rank":"normal"}],"P571":[{"mainsnak":{"snaktype":"value","property":"P571","datavalue":{"value":{"time":"+1866-00-00T00:00:00Z","timezone":0,"before":0,"after":0,"precision":9,"calendarmodel":"http://www.wikidata.org/entity/Q1985727"},"type":"time"}},"rank":"normal"}],"P112":[{"mainsnak":{"snaktype":"value","property":"P112","datavalue":{"value":{"entity-type":"item","numeric-id":5216583,"id":"Q5216583"},"type":"wikibase-entityid"}},"rank":"normal"}],"P2196":[{"mainsnak":{"snaktype":"value","property":"P2196","datavalue":{"value":{"amount":"+7572","unit":"1"},"type":"quantity"}},"rank":"normal"},{"mainsnak":{"snaktype":"value","property":"P2196","datavalue":{"value":{"amount":"+7220","unit":"1"},"type":"quantity"}},"rank":"normal","qualifiers":{"P585":[{"snaktype":"value","datavalue":{"value":{"time":"+2021-09-01T00:00:00Z","timezone":0,"before":0,"after":0,"precision":11,"calendarmodel":"http://www.wikidata.org/entity/Q1985727"},"type":"time"}}]}}],"P18":[{"mainsnak":{"snaktype":"value","property":"P18","datavalue":{"value":"AUB 1.jpg","type":"string"}},"rank":"normal"}],"P131":[{"mainsnak":{"snaktype":"value","property":"P131","datavalue":{"value":{"entity-type":"item","numeric-id":3820,"id":"Q3820"},"type":"wikibase-entityid"}},"rank":"normal"}]}}},"success":1},"labelsAUB":{"entities":{"Q822":{"type":"item","id":"Q822","labels":{"ar":{"language":"ar","value":"لبنان"},"en":{"language":"en","value":"Lebanon"},"ckb":{"language":"ckb","value":"لوبنان"},"ku":{"language":"ku","value":"Libnan"}}},"Q3820":{"type":"item","id":"Q3820","labels":{"en":{"language":"en","value":"Beirut"},"ar":{"language":"ar","value":"بيروت"},"ckb":{"language":"ckb","value":"بەیرووت"},"ku":{"language":"ku","value":"Bêrût"}}},"Q5216583":{"type":"item","id":"Q5216583","labels":{"ar":{"language":"ar","value":"دانيال بلس"},"en":{"language":"en","value":"Daniel Bliss"}}}},"success":1},"peopleAUB":{"entities":{"Q5216583":{"type":"item","id":"Q5216583","claims":{"P31":[{"mainsnak":{"snaktype":"value","property":"P31","datavalue":{"value":{"entity-type":"item","numeric-id":5,"id":"Q5"},"type":"wikibase-entityid"}},"rank":"normal"}],"P18":[{"mainsnak":{"snaktype":"value","property":"P18","datavalue":{"value":"Rev. Daniel Bliss.jpg","type":"string"}},"rank":"normal"}]}}},"success":1},"categoryAUB":{"batchcomplete":true,"query":{"pages":[{"pageid":4653057,"ns":6,"title":"File:American-University-Beirut-NW.jpg","imagerepository":"local","imageinfo":[{"size":528174,"width":1514,"height":1134,"thumburl":"https://thumb.wikimedia.org/wikipedia/commons/thumb/9/95/American-University-Beirut-NW.jpg/960px-American-University-Beirut-NW.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail","thumbwidth":640,"thumbheight":479,"url":"https://upload.wikimedia.org/wikipedia/commons/9/95/American-University-Beirut-NW.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original","descriptionurl":"https://commons.wikimedia.org/wiki/File:American-University-Beirut-NW.jpg","extmetadata":{"ObjectName":{"value":"American-University-Beirut-NW","source":"mediawiki-metadata"},"ImageDescription":{"value":"American University of Beirut Campus","source":"commons-desc-page"},"Artist":{"value":"<a class=\"external free\" data-mw-original-href=\"http://en.wikipedia.org/wiki/User:Not_home\" href=\"https://en.wikipedia.org/wiki/User:Not_home\">http://en.wikipedia.org/wiki/User:Not_home</a>","source":"commons-desc-page"},"LicenseShortName":{"value":"Public domain","source":"commons-desc-page","hidden":""},"UsageTerms":{"value":"Public domain","source":"commons-desc-page"},"License":{"value":"pd","source":"commons-templates","hidden":""}},"mime":"image/jpeg"}]},{"pageid":12382670,"ns":6,"title":"File:American University of beirut2.jpg","imagerepository":"local","imageinfo":[{"size":101201,"width":484,"height":646,"thumburl":"https://upload.wikimedia.org/wikipedia/commons/9/9a/American_University_of_beirut2.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail_unscaled","thumbwidth":640,"thumbheight":854,"url":"https://upload.wikimedia.org/wikipedia/commons/9/9a/American_University_of_beirut2.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original","descriptionurl":"https://commons.wikimedia.org/wiki/File:American_University_of_beirut2.jpg","extmetadata":{"ObjectName":{"value":"American University of beirut2","source":"mediawiki-metadata"},"ImageDescription":{"value":"At the Main Gate, photographed by BlingBling10.","source":"commons-desc-page"},"Artist":{"value":"Original uploaded by <a href=\"https://en.wikipedia.org/wiki/User:BlingBling10\" class=\"extiw\" title=\"en:User:BlingBling10\">BlingBling10</a> (Transfered by <a href=\"//commons.wikimedia.org/wiki/User:Aboluay\" title=\"User:Aboluay\">Aboluay</a>)","source":"commons-desc-page"},"LicenseShortName":{"value":"CC BY 3.0","source":"commons-desc-page","hidden":""},"UsageTerms":{"value":"Creative Commons Attribution 3.0","source":"commons-desc-page"},"License":{"value":"cc-by-3.0","source":"commons-templates","hidden":""}},"mime":"image/jpeg"}]},{"pageid":16145895,"ns":6,"title":"File:American University of Beirut (AUB).jpg","imagerepository":"local","imageinfo":[{"size":8372546,"width":3916,"height":2634,"thumburl":"https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d0/American_University_of_Beirut_%28AUB%29.jpg/960px-American_University_of_Beirut_%28AUB%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail","thumbwidth":640,"thumbheight":430,"url":"https://upload.wikimedia.org/wikipedia/commons/d/d0/American_University_of_Beirut_%28AUB%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original","descriptionurl":"https://commons.wikimedia.org/wiki/File:American_University_of_Beirut_(AUB).jpg","extmetadata":{"ObjectName":{"value":"American University of Beirut (AUB)","source":"mediawiki-metadata"},"ImageDescription":{"value":"American University of Beirut (AUB)","source":"commons-desc-page"},"Artist":{"value":"<a rel=\"nofollow\" class=\"external text\" href=\"https://www.flickr.com/people/64323230@N00\">Mohamed Nanabhay</a> from Qatar","source":"commons-desc-page"},"LicenseShortName":{"value":"CC BY 2.0","source":"commons-desc-page","hidden":""},"UsageTerms":{"value":"Creative Commons Attribution 2.0","source":"commons-desc-page"},"License":{"value":"cc-by-2.0","source":"commons-templates","hidden":""}},"mime":"image/jpeg"}]},{"pageid":16145967,"ns":6,"title":"File:American University Beirut (AUB).jpg","imagerepository":"local","imageinfo":[{"size":1615057,"width":2304,"height":1728,"thumburl":"https://thumb.wikimedia.org/wikipedia/commons/thumb/7/77/American_University_Beirut_%28AUB%29.jpg/960px-American_University_Beirut_%28AUB%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail","thumbwidth":640,"thumbheight":480,"url":"https://upload.wikimedia.org/wikipedia/commons/7/77/American_University_Beirut_%28AUB%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original","descriptionurl":"https://commons.wikimedia.org/wiki/File:American_University_Beirut_(AUB).jpg","extmetadata":{"ObjectName":{"value":"American University Beirut (AUB)","source":"mediawiki-metadata"},"ImageDescription":{"value":"American University Beirut (AUB)","source":"commons-desc-page"},"Artist":{"value":"<a rel=\"nofollow\" class=\"external text\" href=\"https://www.flickr.com/people/58028998@N00\">Rachel Ricci</a> from Chicago, US","source":"commons-desc-page"},"LicenseShortName":{"value":"CC BY 2.0","source":"commons-desc-page","hidden":""},"UsageTerms":{"value":"Creative Commons Attribution 2.0","source":"commons-desc-page"},"License":{"value":"cc-by-2.0","source":"commons-templates","hidden":""}},"mime":"image/jpeg"}]},{"pageid":17307428,"ns":6,"title":"File:AUB 1.jpg","imagerepository":"local","imageinfo":[{"size":194724,"width":800,"height":600,"thumburl":"https://upload.wikimedia.org/wikipedia/commons/2/2b/AUB_1.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail_unscaled","thumbwidth":640,"thumbheight":480,"url":"https://upload.wikimedia.org/wikipedia/commons/2/2b/AUB_1.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original","descriptionurl":"https://commons.wikimedia.org/wiki/File:AUB_1.jpg","extmetadata":{"ObjectName":{"value":"AUB 1","source":"mediawiki-metadata"},"ImageDescription":{"value":"american university of beirut","source":"commons-desc-page"},"Artist":{"value":"<a href=\"//commons.wikimedia.org/w/index.php?title=User:A.K.Khalifeh&amp;action=edit&amp;redlink=1\" class=\"new\" title=\"User:A.K.Khalifeh (page does not exist)\">A.K.Khalifeh</a>","source":"commons-desc-page"},"LicenseShortName":{"value":"CC BY-SA 3.0","source":"commons-desc-page","hidden":""},"UsageTerms":{"value":"Creative Commons Attribution-Share Alike 3.0","source":"commons-desc-page"},"License":{"value":"cc-by-sa-3.0","source":"commons-templates","hidden":""}},"mime":"image/jpeg"}]}]}},"filesOxford":{"batchcomplete":true,"query":{"pages":[{"pageid":39121004,"ns":6,"title":"File:Rev. Daniel Bliss.jpg","imagerepository":"local","imageinfo":[{"size":88679,"width":461,"height":590,"thumburl":"https://upload.wikimedia.org/wikipedia/commons/d/d3/Rev._Daniel_Bliss.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail_unscaled","thumbwidth":640,"thumbheight":819,"url":"https://upload.wikimedia.org/wikipedia/commons/d/d3/Rev._Daniel_Bliss.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original","descriptionurl":"https://commons.wikimedia.org/wiki/File:Rev._Daniel_Bliss.jpg","extmetadata":{"ObjectName":{"value":"Rev. Daniel Bliss","source":"mediawiki-metadata"},"Artist":{"value":"Syrian Protestant college","source":"commons-desc-page"},"LicenseShortName":{"value":"Public domain","source":"commons-desc-page","hidden":""},"UsageTerms":{"value":"Public domain","source":"commons-desc-page"},"License":{"value":"pd","source":"commons-templates","hidden":""}},"mime":"image/jpeg"}]},{"pageid":52257860,"ns":6,"title":"File:1 oxford aerial panorama 2016.jpg","imagerepository":"local","imageinfo":[{"size":48967456,"width":15050,"height":5051,"thumburl":"https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b8/1_oxford_aerial_panorama_2016.jpg/960px-1_oxford_aerial_panorama_2016.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail","thumbwidth":640,"thumbheight":215,"url":"https://upload.wikimedia.org/wikipedia/commons/b/b8/1_oxford_aerial_panorama_2016.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original","descriptionurl":"https://commons.wikimedia.org/wiki/File:1_oxford_aerial_panorama_2016.jpg","extmetadata":{"ObjectName":{"value":"1 oxford aerial panorama 2016","source":"mediawiki-metadata"},"Artist":{"value":"<a href=\"//commons.wikimedia.org/wiki/User:Chensiyuan\" title=\"User:Chensiyuan\">Chensiyuan</a>","source":"commons-desc-page"},"LicenseShortName":{"value":"CC BY-SA 4.0","source":"commons-desc-page","hidden":""},"UsageTerms":{"value":"Creative Commons Attribution-Share Alike 4.0","source":"commons-desc-page"},"License":{"value":"cc-by-sa-4.0","source":"commons-templates","hidden":""}},"mime":"image/jpeg"}]},{"pageid":137764166,"ns":6,"title":"File:University of Oxford.svg","imagerepository":"local","imageinfo":[{"size":49606,"width":547,"height":161,"thumburl":"https://thumb.wikimedia.org/wikipedia/commons/thumb/2/2f/University_of_Oxford.svg/960px-University_of_Oxford.svg.png?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail","thumbwidth":640,"thumbheight":188,"url":"https://upload.wikimedia.org/wikipedia/commons/2/2f/University_of_Oxford.svg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original","descriptionurl":"https://commons.wikimedia.org/wiki/File:University_of_Oxford.svg","extmetadata":{"ObjectName":{"value":"University of Oxford","source":"mediawiki-metadata"},"Artist":{"value":"<bdi><a href=\"https://en.wikipedia.org/wiki/en:University_of_Oxford\" class=\"extiw\" title=\"w:en:University of Oxford\"><span title=\"collegiate research university in Oxford, England\">University of Oxford</span></a>\n</bdi>","source":"commons-desc-page"},"LicenseShortName":{"value":"Public domain","source":"commons-desc-page","hidden":""},"UsageTerms":{"value":"Public domain","source":"commons-desc-page"},"License":{"value":"pd","source":"commons-templates","hidden":""}},"mime":"image/svg+xml"}]}]}}};

// arwiki's own University of Duhok logo, as its API describes it (the local file behind the summary's image).
const arwikiFairUse = { batchcomplete: true, query: { pages: [{ pageid: 1965993, ns: 6, title: 'ملف:جامعة دهوك.jpg', imagerepository: 'local', imageinfo: [{ size: 23519, width: 336, height: 397, url: 'https://upload.wikimedia.org/wikipedia/ar/6/68/%D8%AC%D8%A7%D9%85%D8%B9%D8%A9_%D8%AF%D9%87%D9%88%D9%83.jpg', descriptionurl: 'https://ar.wikipedia.org/wiki/%D9%85%D9%84%D9%81:%D8%AC%D8%A7%D9%85%D8%B9%D8%A9_%D8%AF%D9%87%D9%88%D9%83.jpg', extmetadata: { ObjectName: { value: 'جامعة دهوك' }, LicenseShortName: { value: 'استعمال عادل' }, UsageTerms: { value: 'استعمال عادل' }, NonFree: { value: 'true' }, Copyrighted: { value: 'True' } }, mime: 'image/jpeg' }] }] } };

// ── a fake transport ──────────────────────────────────────────────────────

const reply = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  json: async () => (typeof body === 'string' ? JSON.parse(body) : clone(body)),
  blob: async () => (body instanceof Blob ? body : new Blob([typeof body === 'string' ? body : JSON.stringify(body)], { type: headers['content-type'] ?? '' })),
});
const jpeg = () => reply(200, new Blob(['JPEGBYTES'], { type: 'image/jpeg' }), { 'content-type': 'image/jpeg' });
const png = () => reply(200, new Blob(['PNGBYTES'], { type: 'image/png' }), { 'content-type': 'image/png' });

const everyCall = [];
/** A `Get` answering by the first matching [test, answer]; an answer may be a function of the URL, or an Error. */
function fake(routes) {
  const calls = [];
  const get = async (...args) => {
    calls.push(args);
    everyCall.push(args);
    await new Promise((r) => setTimeout(r, 1));
    for (const [test, out] of routes) {
      if (typeof test === 'function' ? test(args[0]) : args[0].includes(test)) {
        const r = typeof out === 'function' ? await out(args[0], args[1]) : out;
        if (r instanceof Error) throw r;
        return r;
      }
    }
    return reply(404, { error: 'no route' });
  };
  return { get, calls, urls: () => calls.map((c) => c[0]) };
}
const isImage = (u) => /^https:\/\/(upload|thumb)\.wikimedia\.org\/|staticflickr\.com\//.test(u);

/** The canvas step, faked: a tiny data: URL of the size asked for. */
const encode = async (blob, maxSide) => ({ src: `data:image/jpeg;base64,${Buffer.from(await blob.text()).toString('base64')}`, width: maxSide, height: Math.round(maxSide * 0.6) });
const encodeLogo = async (blob, maxSide) => ({ src: `data:image/png;base64,${Buffer.from(await blob.text()).toString('base64')}`, width: maxSide, height: maxSide });

/** The routes that answer a University of Duhok lookup, as recorded. */
const uodRoutes = (extra = []) => [
  ...extra,
  ['search=University%20of%20Duhok', reply(200, FX.searchDuhok)],
  ['search=UoD', reply(200, FX.searchUoD)],
  [(u) => u.includes('wbgetentities') && u.includes('ids=Q3183295'), reply(200, FX.candidatesUoD)],
  [(u) => u.includes('wbgetentities') && u.includes('props=labels%7Cdescriptions%7Caliases%7Csitelinks'), reply(200, FX.candidatesDuhok)],
  [(u) => u.includes('wbgetentities') && u.includes('ids=Q3666468&') && u.includes('claims'), reply(200, FX.entityUoD)],
  [(u) => u.includes('wbgetentities') && u.includes('ids=Q796'), reply(200, FX.labelsUoD)],
  ['ar.wikipedia.org/api/rest_v1/page/summary/', reply(200, FX.summaryArUoD)],
  ['ckb.wikipedia.org/api/rest_v1/page/summary/', reply(200, FX.summaryCkbUoD)],
  ['.wikipedia.org/api/rest_v1/page/summary/', reply(404, { type: 'Internal error' })],
  ['intitle%3A%22University%20of%20Duhok', reply(200, FX.titleEnUoD)],
  ['intitle%3A%22%D8%AC%D8%A7%D9%85%D8%B9%D8%A9', reply(200, FX.titleArUoD)],
  ['intitle%3A', reply(200, { batchcomplete: true })],
  ['api.openverse.org/v1/images/?q=University%20of%20Duhok', reply(200, FX.openverseUoD)],
  ['api.openverse.org/v1/images/?q=Duhok&', reply(200, FX.openverseDuhok)],
  [isImage, jpeg],
];

// ── 1. subjects ───────────────────────────────────────────────────────────

{
  const p = subjectsPrompt('فيديو ترويجي عن UoD مدته 30 ثانية', 'ar');
  ok('the subjects prompt fences the request and asks for JSON only', /<<<\nفيديو ترويجي عن UoD مدته 30 ثانية\n>>>/.test(p.user) && /JSON and nothing else/.test(p.system) && /\{"subjects":\[/.test(p.user));
  ok('…with the fullest English name, abbreviations expanded, and the Kurdistan Region preferred', /"UoD" → "University of Duhok"/.test(p.user) && /Kurdistan Region of Iraq/.test(p.user) && /video in Arabic/.test(p.user));
}
ok('parseSubjects reads the reply', same(parseSubjects('{"subjects":[{"name":"University of Duhok","alsoKnownAs":["UoD","جامعة دهوك"],"kind":"University"}]}'),
  [{ name: 'University of Duhok', alsoKnownAs: ['UoD', 'جامعة دهوك'], kind: 'university' }]));
ok('…with words and a fence around it', same(parseSubjects('Here you go:\n```json\n{"subjects":[{"name":"Duhok"}]}\n```\nDone.'), [{ name: 'Duhok' }]));
ok('…as a bare array of names, deduplicated, at most three', same(parseSubjects('["A Co", "a co", "B Co", "C Co", "D Co"]').map((s) => s.name), ['A Co', 'B Co', 'C Co']));
ok('…dropping an alias that is the name again, markup, and non-strings', same(parseSubjects('{"subjects":[{"name":"<b>Koya University</b>","alsoKnownAs":["Koya University","KU",4],"kind":7}]}'),
  [{ name: 'Koya University', alsoKnownAs: ['KU'] }]));
ok('…and nothing from a reply that is not JSON of that shape', same(parseSubjects('I think it is about a university.'), []) && same(parseSubjects('{"title":"x"}'), []));
ok('…nor a "name" that is a paragraph', same(parseSubjects(`{"subjects":[{"name":"${'word '.repeat(30)}"}]}`), []));

ok('guess: an acronym', same(guessSubjects('a 30-second vertical promo for UoD'), [{ name: 'UoD' }]));
ok('guess: a capitalised name, the video words left out', same(guessSubjects('Make a TikTok video about the University of Duhok in Arabic'), [{ name: 'University of Duhok' }]));
ok('guess: Arabic — an institution word and its name', same(guessSubjects('فيديو ترويجي عن جامعة دهوك مدته 30 ثانية'), [{ name: 'جامعة دهوك' }]));
ok('guess: Sorani — "زانکۆی …"', guessSubjects('ڤیدیۆیەکی ستوونی دروست بکە دەربارەی زانکۆی دهۆک').some((s) => s.name === 'زانکۆی دهۆک'));
ok('guess: a quoted name comes too', guessSubjects('a reel for "Nobel Dental Clinic", calm').some((s) => s.name === 'Nobel Dental Clinic'));
ok('guess: nothing specific, nothing guessed', same(guessSubjects('a calm video for our dental clinic, 30 seconds, vertical'), []) && same(guessSubjects('Make a vertical TikTok video in Arabic'), []));

{
  let asked = null;
  const got = await findSubjects('promo for UoD', { lang: 'en', ask: async (p) => { asked = p; return '{"subjects":[{"name":"University of Duhok","kind":"university"}]}'; } });
  ok('findSubjects asks the model with a small budget and takes its answer', same(got, [{ name: 'University of Duhok', kind: 'university' }]) && asked.maxTokens <= 1000 && !asked.tools);
  const fell = await findSubjects('promo for UoD', { lang: 'en', ask: async () => { throw new Error('The server answered 529: overloaded'); } });
  ok('…and when the model fails, the heuristic still finds "UoD"', same(fell, [{ name: 'UoD' }]));
  const none = await findSubjects('a promo for UoD', { lang: 'en', ask: async () => '{"subjects":[]}' });
  ok('…but "nothing specific" from the model is an answer, not a failure', same(none, []));
  const e = await failure(findSubjects('x', { lang: 'en', ask: async () => { const x = new Error('stopped'); x.name = 'AbortError'; throw x; }, signal: AbortSignal.abort() }));
  ok('…and a stop is a stop', e?.name === 'AbortError');
}

// ── 2. names, languages, URLs ─────────────────────────────────────────────

ok('fold makes Kurdish and Arabic spellings of one name one', fold('زانکۆی دهۆک') === fold('زانکۆی دھۆک') && fold('جامعة') === fold('جامعه') && fold('كردستان') === fold('کردستان'));
ok('fold reads Arabic-Indic digits and drops joiners', fold('١٩٩٢') === '1992' && fold('۱۹۹۲') === '1992' && fold('a‌b') === 'ab');
ok('searchLanguage: Latin → en, Kurdish letters → ckb, Arabic → ar', searchLanguage('UoD') === 'en' && searchLanguage('زانکۆی دهۆک') === 'ckb' && searchLanguage('جامعة دهوك') === 'ar');
ok('the Wikidata search URL is keyless and CORS-clean (origin=*)', searchUrl('University of Duhok') === 'https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&origin=*&type=item&limit=7&language=en&uselang=en&search=University%20of%20Duhok');
ok('wbgetentities: ids, props and label languages, encoded', entitiesUrl(['Q1', 'Q2'], 'labels|claims') === 'https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&origin=*&ids=Q1%7CQ2&props=labels%7Cclaims&languages=en%7Car%7Cckb%7Cku%7Cku-arab');
ok('a summary URL per Wikipedia, the title with underscores', summaryUrl('ckb', 'زانکۆی دھۆک') === `https://ckb.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent('زانکۆی_دھۆک')}`);
ok('the summary languages follow the video: Badini reads Kurmanji, then Sorani', same(summaryWikis('kmr'), ['ku', 'ckb', 'en', 'ar']) && same(summaryWikis('en'), ['en', 'ar']));
ok('Commons: named files in one request, with a 640-pixel rendering and licence metadata', commonsFilesUrl(['A.jpg', 'File:A.jpg', 'B.svg']).includes(`titles=${encodeURIComponent('File:A.jpg|File:B.svg')}`) && commonsFilesUrl(['x']).includes('iiurlwidth=640') && commonsFilesUrl(['x']).includes('NonFree'));
ok('Commons: a category\'s files, and a title search that keeps the whole name', commonsCategoryUrl('American University of Beirut').includes('gcmtitle=Category%3AAmerican%20University%20of%20Beirut&gcmtype=file') && commonsTitleUrl('University "of" Duhok').includes(encodeURIComponent('intitle:"University of Duhok" filetype:bitmap')));

// ── 3. which item ─────────────────────────────────────────────────────────

ok('fromSearch reads the hits in order', same(fromSearch(FX.searchUoD).slice(0, 2).map((h) => [h.id, h.matchType, h.matchText]), [['Q3183295', 'alias', 'UoD'], ['Q3666468', 'alias', 'UoD']]));
{
  const hits = fromSearch(FX.searchUoD);
  ok('"UoD" in a Kurdish video is the University of Duhok, not Derby (listed first, more Wikipedias)', chooseEntity({ name: 'UoD' }, hits, FX.candidatesUoD, 'ckb') === 'Q3666468');
  ok('…and in an English one too: the people this is for are in the Kurdistan Region', chooseEntity({ name: 'UoD' }, hits, FX.candidatesUoD, 'en') === 'Q3666468');
  ok('…but a request that says Derby gets Derby', chooseEntity({ name: 'University of Derby' }, hits, FX.candidatesUoD, 'en') === 'Q3183295');
  ok('a name that matches nothing chooses nothing', chooseEntity({ name: 'Nobel Dental Clinic' }, hits, FX.candidatesUoD, 'en') === null);
  const exact = fromSearch(FX.searchDuhok);
  ok('the full name picks the university, not its faculty or school', chooseEntity({ name: 'University of Duhok', kind: 'university' }, exact, FX.candidatesDuhok, 'ar') === 'Q3666468');
  const dab = [{ id: 'Q1', label: 'Duhok', description: 'Wikimedia disambiguation page', matchType: 'label', matchText: 'Duhok' }];
  ok('a disambiguation page is never the subject', chooseEntity({ name: 'Duhok' }, dab, { entities: {} }, 'en') === null);
}

// ── 4. what the claims say ────────────────────────────────────────────────

ok('times at their own precision', formatTime({ time: '+1992-00-00T00:00:00Z', precision: 9 }) === '1992' && formatTime({ time: '+1992-10-31T00:00:00Z', precision: 11 }) === '1992-10-31'
  && formatTime({ time: '+1992-10-00T00:00:00Z', precision: 10 }) === '1992-10' && formatTime({ time: '-0500-00-00T00:00:00Z', precision: 9 }) === '500 BCE' && formatTime(null) === '');
{
  const uod = FX.entityUoD.entities.Q3666468;
  const labels = FX.labelsUoD.entities;
  const r = readEntity(uod, labels, 'ckb');
  const by = Object.fromEntries(r.facts.map((f) => [f.label, f.value]));
  ok('University of Duhok: founded 1992, its website, where it is — with the Kurdish names', by.Founded === '1992' && by['Official website'] === 'http://uod.ac' && r.website === 'http://uod.ac'
    && by['Located in'] === 'Duhok (دھۆک)' && by.Country === 'Iraq (عێراق)' && by['Name in Sorani'] === 'زانکۆی دھۆک', by);
  ok('…each fact from Wikidata, linked to the item, on', r.facts.every((f) => f.source === 'Wikidata' && f.url === 'https://www.wikidata.org/wiki/Q3666468' && f.use === true));
  ok('…"UoD" among its other names; no logo, image or category to fetch; its place for more pictures', /UoD/.test(by['Also known as']) && !r.logoFiles.length && !r.photoFiles.length && !r.category && r.place === 'Q152831');
  const en = readEntity(uod, labels, 'en');
  ok('in an English video the place is plain English and there is no "Name in"', en.facts.find((f) => f.label === 'Located in')?.value === 'Duhok' && !en.facts.some((f) => /^Name in/.test(f.label)));
}
{
  const aub = FX.entityAUB.entities.Q469482;
  const r = readEntity(aub, FX.labelsAUB.entities, 'ar');
  const by = Object.fromEntries(r.facts.map((f) => [f.label, f.value]));
  ok('AUB: the later of two student counts, with its year', by.Students === '7220 (2021)', by.Students);
  ok('…founded 1866 by Daniel Bliss (named in Arabic too), its motto, its https website', by.Founded === '1866' && /^Daniel Bliss \(.+\)$/.test(by['Founded by']) && /abundantly/.test(by.Motto) && by['Official website'] === 'https://www.aub.edu.lb', by);
  ok('…its image, its Commons category, and its founder to find a portrait of', same(r.photoFiles, ['AUB 1.jpg']) && r.category === 'American University of Beirut' && same(r.people, [['Q5216583', 'Founded by']]));
  ok('…the founder\'s portrait: a human with a P18', portraitOf(FX.peopleAUB.entities.Q5216583) === 'Rev. Daniel Bliss.jpg' && portraitOf(FX.entityAUB.entities.Q469482) === '');
  const second = readEntity(aub, FX.labelsAUB.entities, 'ar', 'American University of Beirut');
  ok('a second subject\'s facts say whose they are', second.facts.some((f) => f.label === 'Founded (American University of Beirut)'));
}

// ── 5. Wikipedia ──────────────────────────────────────────────────────────

{
  const ar = fromSummary(FX.summaryArUoD, 'ar');
  ok('the Arabic summary, with its page', /^جامعة دهوك هي/.test(ar.text) && ar.url.startsWith('https://ar.wikipedia.org/wiki/') && ar.wiki === 'ar');
  ok('…and no image: the lead image is arwiki\'s own fair-use file, not a Commons one', ar.image === undefined);
  const ckb = fromSummary(FX.summaryCkbUoD, 'ckb');
  ok('the Sorani summary, cut at a sentence and short', ckb.text.length <= 700 && /[.؟!]$/.test(ckb.text));
  ok('a disambiguation page or an empty extract is no summary', fromSummary({ ...FX.summaryArUoD, type: 'disambiguation' }, 'ar') === null && fromSummary({ type: 'standard', extract: ' ' }, 'ar') === null);
  const withCommons = fromSummary({ ...FX.summaryArUoD, originalimage: { source: 'https://upload.wikimedia.org/wikipedia/commons/2/2f/University_of_Oxford.svg', width: 547, height: 161 } }, 'en');
  ok('a Commons lead image is named, to be licence-checked with the rest', withCommons.image === 'University of Oxford.svg');
}

// ── 6. Commons files and their licences ───────────────────────────────────

{
  const files = fromCommonsFiles(FX.filesOxford);
  const logo = files.get('University of Oxford.svg');
  ok('an SVG logo comes as its PNG rendering, public domain, credited', logo && /\/thumb\/.+University_of_Oxford\.svg\/\d+px-University_of_Oxford\.svg\.png$/.test(logo.url) && logo.license === 'Public domain'
    && logo.credit === 'University of Oxford — University of Oxford, Public domain (Wikimedia Commons)', logo);
  const pano = files.get('1 oxford aerial panorama 2016.jpg');
  ok('a photograph comes as its original, which fetchPicture sizes', pano && pano.url === 'https://upload.wikimedia.org/wikipedia/commons/b/b8/1_oxford_aerial_panorama_2016.jpg' && pano.width === 15050 && pano.license === 'CC BY-SA 4.0');
  ok('the portrait is there, public domain', files.get('Rev. Daniel Bliss.jpg')?.license === 'Public domain');
  ok('arwiki\'s fair-use logo (NonFree) is never taken', fromCommonsFiles(arwikiFairUse).size === 0);
  const nc = clone(FX.filesOxford);
  nc.query.pages.forEach((p) => { p.imageinfo[0].extmetadata.License = { value: 'cc-by-nc-sa-4.0' }; p.imageinfo[0].extmetadata.LicenseShortName = { value: 'CC BY-NC-SA 4.0' }; });
  ok('nor a NonCommercial one', fromCommonsFiles(nc).size === 0);
  const cat = [...fromCommonsFiles(FX.categoryAUB).values()];
  ok('a category\'s files: reusable ones only, each credited', cat.length > 0 && cat.every((c) => /^(CC0|Public domain|CC BY(-SA)? \d)/.test(c.license) && / \(Wikimedia Commons\)$/.test(c.credit)));
  ok('a title search that found nothing is nothing', fromCommonsFiles(FX.titleEnUoD).size === 0 && fromCommonsFiles(null).size === 0);
}

// ── 7. the whole lookup, University of Duhok ──────────────────────────────

{
  forgetRefusals();
  const f = fake(uodRoutes());
  const steps = [];
  let askedWith = null;
  const brief = await researchVideo('فيديو ترويجي عن UoD', {
    lang: 'ar', get: f.get, encode, encodeLogo, now: () => 42, onStep: (s) => steps.push(s),
    ask: async (p) => { askedWith = p; return '{"subjects":[{"name":"University of Duhok","alsoKnownAs":["UoD","جامعة دهوك"],"kind":"university"}]}'; },
  });
  const by = Object.fromEntries(brief.facts.map((x) => [x.label, x]));
  ok('UoD → the University of Duhok', same(brief.subjects, ['University of Duhok']) && /UoD/.test(askedWith.user));
  ok('…founded 1992, its website, its Arabic name, its place', by.Founded?.value === '1992' && brief.website === 'http://uod.ac' && by['Name in Arabic']?.value === 'جامعة دهوك' && by['Located in']?.value === 'Duhok (دهوك)', brief.facts.map((x) => [x.label, x.value]));
  ok('…the Arabic Wikipedia summary, as a fact that can be switched off', /^جامعة دهوك هي/.test(brief.summary) && by.Summary?.source === 'Wikipedia (ar)' && by.Summary.use === true);
  ok('…every fact sourced and linked', brief.facts.every((x) => x.source && /^https:\/\//.test(x.url) && x.use === true));
  ok('…five real pictures: the gate, the campus, a graduate, then two of Duhok', brief.pictures.length === 5
    && same(brief.pictures.map(pictureTitle), ['جامعة دهوك البوابة', 'University of Duhok', 'Dr wisam Murad', 'City of Duhok', 'Kurdistan Duhok City - kurdi']), brief.pictures.map((p) => p.credit));
  ok('…each a data: URL with its credit, and what it shows as its query', brief.pictures.every((p) => /^data:image\/jpeg;base64,/.test(p.src) && / \((Wikimedia Commons|Flickr via Openverse|Wikimedia Commons via Openverse)\)$/.test(p.credit))
    && same(brief.pictures.map((p) => p.query), ['University of Duhok', 'University of Duhok', 'University of Duhok', 'Duhok', 'Duhok']));
  ok('…no logo: none free exists for it', brief.logo === undefined);
  ok('…looked up at the time given', brief.at === 42 && same(steps.slice(0, 3), ['subjects', 'facts', 'pictures']));
  const urls = f.urls();
  ok('…in fifteen plain GETs, one of them the English Wikipedia\'s? no — it has no page, so none', urls.length === 15 && !urls.some((u) => u.includes('en.wikipedia.org')), urls);
  ok('…Wikidata, then Wikipedia, then Commons, then Openverse, then the pictures', urls.findIndex((u) => u.includes('wikipedia.org')) > urls.findIndex((u) => u.includes('wikidata.org'))
    && urls.findIndex((u) => u.includes('commons.wikimedia')) > urls.findIndex((u) => u.includes('wikipedia.org'))
    && urls.findIndex((u) => u.includes('openverse')) > urls.findIndex((u) => u.includes('commons.wikimedia'))
    && urls.findIndex(isImage) > urls.findIndex((u) => u.includes('openverse')));
  const block = factsBlock(brief);
  ok('factsBlock: "Label: value (source)" lines, the summary, and the pictures the scenes will show', /^About: University of Duhok\.$/m.test(block) && /^- Founded: 1992 \(Wikidata\)$/m.test(block)
    && /^- Official website: http:\/\/uod\.ac \(Wikidata\)$/m.test(block) && /^- Summary: جامعة دهوك هي .+ \(Wikipedia \(ar\)\)$/m.test(block) && /جامعة دهوك البوابة; University of Duhok/.test(block), block);
  ok('…and short', block.length < 1600, block.length);
  const off = { ...brief, facts: brief.facts.map((x) => (x.label === 'Founded' || x.label === 'Summary' ? { ...x, use: false } : x)) };
  const offBlock = factsBlock(off);
  ok('a fact switched off, and the summary switched off, never reach the model', !/Founded/.test(offBlock) && !/Summary/.test(offBlock) && /Official website/.test(offBlock));
}
{
  forgetRefusals();
  const f = fake(uodRoutes());
  const brief = await researchVideo('a 30-second promo for UoD', { lang: 'ckb', get: f.get, encode, encodeLogo, ask: async () => { throw new Error('The server answered 500: boom'); } });
  ok('with the model failing, "UoD" alone still finds the University of Duhok (the Sorani summary)', same(brief.subjects, ['University of Duhok']) && brief.facts.find((x) => x.label === 'Summary')?.source === 'Wikipedia (ckb)'
    && brief.facts.some((x) => x.label === 'Name in Sorani' && x.value === 'زانکۆی دھۆک'));
}
{
  const f = fake(uodRoutes());
  const brief = await researchVideo('a promo for our bakery', { lang: 'en', get: f.get, encode, ask: async () => '{"subjects":[]}', now: () => 7 });
  ok('nothing specific: an empty brief and not one request', same(brief, { subjects: [], facts: [], pictures: [], at: 7 }) && f.calls.length === 0);
}
{
  const f = fake([[() => true, new TypeError('Load failed')]]);
  const brief = await researchVideo('UoD', { lang: 'en', get: f.get, encode, subjects: [{ name: 'University of Duhok' }], now: () => 1 });
  ok('offline: a brief that says what was looked up and found nothing — never an error', same(brief, { subjects: ['University of Duhok'], facts: [], pictures: [], at: 1 }));
}
{
  const ac = new AbortController();
  const f = fake(uodRoutes([[(u) => u.includes('ar.wikipedia.org'), () => { ac.abort(); return reply(200, FX.summaryArUoD); }]]));
  const e = await failure(researchVideo('UoD', { lang: 'ar', get: f.get, encode, subjects: [{ name: 'University of Duhok' }], signal: ac.signal }));
  ok('a stop is an AbortError, and nothing is asked after it', e?.name === 'AbortError' && !f.urls().some((u) => u.includes('commons.wikimedia') || u.includes('openverse')));
}
{
  let n = 0;
  const f = fake(uodRoutes([['search=University%20of%20Duhok', () => (++n === 1 ? reply(429, 'slow down', { 'retry-after': '1' }) : reply(200, FX.searchDuhok))]]));
  const t0 = Date.now();
  const brief = await researchVideo('UoD', { lang: 'en', get: f.get, encode, subjects: [{ name: 'University of Duhok' }] });
  ok('a 429 is waited out once, as long as Retry-After asks, then asked again', n === 2 && Date.now() - t0 >= 950 && brief.facts.some((x) => x.label === 'Founded'));
}
{
  // A category and a founder: AUB's pictures, and its founder's portrait kept for a people scene.
  const f = fake([
    ['search=American%20University%20of%20Beirut', reply(200, { search: [{ id: 'Q469482', label: 'American University of Beirut', description: 'private university in Lebanon', match: { type: 'label', language: 'en', text: 'American University of Beirut' } }] })],
    [(u) => u.includes('wbgetentities') && u.includes('ids=Q469482') && !u.includes('claims'), reply(200, { entities: { Q469482: { ...FX.entityAUB.entities.Q469482, claims: undefined } } })],
    [(u) => u.includes('wbgetentities') && u.includes('ids=Q469482'), reply(200, FX.entityAUB)],
    [(u) => u.includes('wbgetentities') && u.includes('props=labels&'), reply(200, FX.labelsAUB)],
    [(u) => u.includes('wbgetentities') && u.includes('ids=Q5216583'), reply(200, FX.peopleAUB)],
    ['wikipedia.org/api/rest_v1/page/summary/', reply(404, {})],
    ['titles=', reply(200, FX.filesOxford)],
    ['categorymembers', reply(200, FX.categoryAUB)],
    [isImage, jpeg],
  ]);
  const brief = await researchVideo('AUB', { lang: 'en', get: f.get, encode, subjects: [{ name: 'American University of Beirut', kind: 'university' }] });
  ok('AUB: its category\'s photographs and its founder\'s portrait', brief.pictures.some((p) => p.query === 'Daniel Bliss' && /Daniel Bliss/.test(p.credit)) && brief.pictures.filter((p) => p.query === 'American University of Beirut').length >= 3, brief.pictures.map((p) => [p.query, p.credit]));
  ok('…the founder named in the facts, and the portrait never offered to the planner as a photo of the place', /Founded by: Daniel Bliss/.test(factsBlock(brief)) && !/Rev\. Daniel Bliss/.test(factsBlock(brief).split('\n').pop()));
}
{
  // A logo: Oxford's P154 is a public-domain SVG, fetched as a PNG at logo size.
  const oxford = { type: 'item', id: 'Q34433', labels: { en: { language: 'en', value: 'University of Oxford' } }, descriptions: { en: { language: 'en', value: 'collegiate research university in Oxford, England' } }, sitelinks: {},
    claims: { P154: [{ mainsnak: { snaktype: 'value', property: 'P154', datavalue: { value: 'University of Oxford.svg', type: 'string' } }, rank: 'normal' }], P18: [{ mainsnak: { snaktype: 'value', property: 'P18', datavalue: { value: '1 oxford aerial panorama 2016.jpg', type: 'string' } }, rank: 'normal' }] } };
  const sizes = [];
  const f = fake([
    ['wbsearchentities', reply(200, { search: [{ id: 'Q34433', label: 'University of Oxford', description: 'collegiate research university in Oxford, England', match: { type: 'label', text: 'University of Oxford' } }] })],
    ['wbgetentities', reply(200, { entities: { Q34433: oxford } })],
    ['titles=', reply(200, FX.filesOxford)],
    [(u) => u.includes('.svg.png'), (u) => { sizes.push(u); return png(); }],
    [isImage, jpeg],
    ['openverse', reply(200, { results: [] })],
    ['commons.wikimedia.org', reply(200, { batchcomplete: true })],
  ]);
  const brief = await researchVideo('Oxford', { lang: 'en', get: f.get, encode, encodeLogo, subjects: [{ name: 'University of Oxford' }] });
  ok('a free logo is found, fetched as a PNG at logo size, and credited', brief.logo && /^data:image\/png/.test(brief.logo.src) && brief.logo.width === 512 && /Public domain/.test(brief.logo.credit) && sizes.length === 1);
  ok('…and never counted among the pictures the scenes get', !brief.pictures.some((p) => /University of Oxford — /.test(p.credit)) && brief.pictures.some((p) => /oxford aerial panorama/.test(p.credit)));
}

{
  // Openverse offers the same portrait twice (measured: "Dr wisam Murad" and "Doctor Wisam Murad").
  const twice = clone(FX.openverseUoD);
  const copy = clone(twice.results.find((r) => /wisam/i.test(r.title)));
  twice.results.push({ ...copy, id: 'x2', title: 'Doctor Wisam Murad', url: 'https://upload.wikimedia.org/wikipedia/commons/9/9f/Doctor_Wisam_Murad.jpg', foreign_landing_url: 'https://commons.wikimedia.org/w/index.php?curid=1' });
  const f = fake(uodRoutes([['api.openverse.org/v1/images/?q=University%20of%20Duhok', reply(200, twice)]]));
  const brief = await researchVideo('UoD', { lang: 'en', get: f.get, encode, subjects: [{ name: 'University of Duhok' }] });
  ok('the same portrait under two titles is kept once', brief.pictures.filter((p) => /wisam/i.test(p.credit)).length === 1, brief.pictures.map((p) => p.credit));
}
{
  // A big category (the answer says there is more): only files whose title names it, by name or alias.
  const big = clone(FX.categoryAUB);
  big.continue = { gcmcontinue: 'file|x', continue: 'gcmcontinue||' };
  const stray = clone(big.query.pages[0]);
  stray.title = 'File:Clinton exhibit Presidential Library Little Rock.jpg';
  stray.imageinfo[0].extmetadata.ObjectName = { value: 'Clinton exhibit Presidential Library Little Rock' };
  stray.imageinfo[0].url = 'https://upload.wikimedia.org/wikipedia/commons/0/0a/Clinton_exhibit.jpg';
  stray.imageinfo[0].descriptionurl = 'https://commons.wikimedia.org/wiki/File:Clinton_exhibit.jpg';
  big.query.pages.push(stray);
  const f = fake([
    ['wbsearchentities', reply(200, { search: [{ id: 'Q469482', label: 'American University of Beirut', description: 'private university in Lebanon', match: { type: 'label', text: 'American University of Beirut' } }] })],
    [(u) => u.includes('wbgetentities') && u.includes('ids=Q469482'), reply(200, FX.entityAUB)],
    [(u) => u.includes('wbgetentities') && u.includes('props=labels&'), reply(200, FX.labelsAUB)],
    [(u) => u.includes('wbgetentities') && u.includes('ids=Q5216583'), reply(200, FX.peopleAUB)],
    ['wikipedia.org/api/rest_v1/page/summary/', reply(404, {})],
    ['titles=', reply(200, { batchcomplete: true })],
    ['categorymembers', reply(200, big)],
    ['intitle', reply(200, { batchcomplete: true })],
    ['openverse', reply(200, { results: [] })],
    [isImage, jpeg],
  ]);
  const brief = await researchVideo('AUB', { lang: 'en', get: f.get, encode, subjects: [{ name: 'American University of Beirut' }] });
  ok('a big category\'s stray file is left out; "AUB Campus" stays (AUB is its alias)', !brief.pictures.some((p) => /Clinton/.test(p.credit)) && brief.pictures.some((p) => /^AUB/.test(p.credit)), brief.pictures.map((p) => p.credit));
}

// ── 8. the model's web search ─────────────────────────────────────────────

{
  const text = 'I\'ll search for the university.\n\nBased on the results: {"facts":[{"label":"Students","value":"about 20,000","url":"https://uod.ac/about"},{"label":"Founded","value":"1992","url":"https://en.wikipedia.org/wiki/x"},{"label":"Rank","value":"first","url":"javascript:alert(1)"},{"label":"No link","value":"x"},{"label":"students","value":"dup","url":"https://a.b/c"}]}';
  const facts = parseResearch(text);
  ok('parseResearch: facts with a real link, named by site, after the words around them', same(facts.map((x) => [x.label, x.source]), [['Students', 'uod.ac (web search)'], ['Founded', 'en.wikipedia.org (web search)']]) && facts.every((x) => x.use));
  ok('…nothing from prose alone', same(parseResearch('The university was founded in 1992.'), []));
  const p = researchPrompt([{ name: 'University of Duhok', alsoKnownAs: ['UoD'], kind: 'university' }], [{ label: 'Founded', value: '1992', source: 'Wikidata', url: 'x', use: true }]);
  ok('the research prompt names the subject, what is known, and wants a URL for every fact', /Look up: University of Duhok \(also known as UoD\), a university\./.test(p.user) && /Already known: Founded: 1992/.test(p.user) && /URL/.test(p.system));
  ok('the tool is Anthropic\'s basic web search, three uses at most', same(WEB_SEARCH_TOOL, { type: 'web_search_20250305', name: 'web_search', max_uses: 3 }));
}
{
  forgetRefusals();
  let asks = 0;
  const refused = async () => { asks += 1; const e = new Error('The server answered 400: tools: unknown tool type'); e.status = 400; throw e; };
  ok('a 4xx: no facts', same(await webFacts(refused, 'https://gw.example', [{ name: 'X' }], []), []));
  ok('…remembered for the session at that address', webSearchRefused('https://gw.example') && !webSearchRefused('https://other.example'));
  await webFacts(refused, 'https://gw.example', [{ name: 'X' }], []);
  ok('…and never asked again there', asks === 1);
  forgetRefusals();
  let tries = 0;
  const offline = async () => { tries += 1; throw new TypeError('Load failed'); };
  await webFacts(offline, 'https://gw.example', [{ name: 'X' }], []);
  ok('a network failure is not a refusal: asked again next time', !webSearchRefused('https://gw.example') && tries === 1);
}
{
  forgetRefusals();
  let got = null;
  const f = fake(uodRoutes());
  const brief = await researchVideo('UoD', {
    lang: 'en', get: f.get, encode, subjects: [{ name: 'University of Duhok' }],
    webSearch: { key: 'https://gw', ask: async (p) => { got = p; return '{"facts":[{"label":"Students","value":"about 20,000 (2023)","url":"https://uod.ac/about"},{"label":"Founded","value":"1993","url":"https://x.example/a"}]}'; } },
  });
  ok('with the route\'s web search: the tool is sent, and its new facts are added, sourced', same(got.tools, [WEB_SEARCH_TOOL]) && brief.facts.some((x) => x.label === 'Students' && x.source === 'uod.ac (web search)'));
  ok('…but never over what Wikidata already says', brief.facts.filter((x) => x.label === 'Founded').length === 1 && brief.facts.find((x) => x.label === 'Founded').value === '1992');
}
{
  forgetRefusals();
  const f = fake(uodRoutes());
  const t0 = Date.now();
  const brief = await researchVideo('UoD', {
    lang: 'en', get: f.get, encode, subjects: [{ name: 'University of Duhok' }], webSearchMs: 150,
    webSearch: { key: 'https://gw', ask: () => new Promise(() => {}) }, // a request that never ends, and ignores its signal
  });
  ok('a web search that hangs is cut off at its deadline; the rest of the brief is kept', Date.now() - t0 < 3000 && brief.facts.some((x) => x.label === 'Founded') && !webSearchRefused('https://gw'));
}

// ── 9. the scenes get the subject's own pictures first ────────────────────

{
  const pic = (title, query, w, h) => ({ src: `data:image/jpeg;base64,${Buffer.from(title).toString('base64')}`, credit: `${title} — Someone, CC BY 4.0 (Wikimedia Commons)`, source: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(title)}.jpg`, query, width: w, height: h });
  const brief = {
    subjects: ['American University of Beirut'],
    facts: [{ label: 'Founded by', value: 'Daniel Bliss (دانيال بلس)', source: 'Wikidata', url: 'https://www.wikidata.org/wiki/Q469482', use: true }],
    pictures: [
      pic('AUB College Hall', 'American University of Beirut', 1920, 1280),
      pic('Rev. Daniel Bliss', 'Daniel Bliss', 461, 590),
      pic('AUB library reading room', 'American University of Beirut', 1080, 1440),
      pic('AUB Campus', 'American University of Beirut', 1920, 1080),
      pic('Beirut corniche', 'Beirut', 1920, 1080),
    ],
    at: 1,
  };
  const s = (id, kind, over = {}) => ({ id, kind, seconds: 4, transition: 'fade', ...over });
  const scenes = [
    s('t', 'title', { title: 'Since 1866', imageQuery: 'university campus' }),
    s('k', 'kinetic', { text: 'x' }),
    s('p', 'people', { heading: 'Founder', people: [{ name: 'دانيال بلس', role: 'المؤسس' }, { name: 'Someone Else' }] }),
    s('sp', 'split', { heading: 'A library', text: 'Reading room open late', imageQuery: 'library reading room' }),
    s('i', 'image', { caption: 'x', imageQuery: 'students', picture: pic('Kept', 'kept', 10, 10) }),
    s('g', 'gallery', { imageQueries: ['a', 'b', 'c'] }),
    s('o', 'outro', { headline: 'AUB' }),
  ];
  const before = clone(scenes);
  const out = placeBriefPictures(scenes, brief, 'landscape');
  const title = (x) => pictureTitle(x);
  ok('the founder\'s portrait goes to him in the people scene, matched across scripts', title(out[2].people[0].picture) === 'Rev. Daniel Bliss' && !out[2].people[1].picture);
  ok('the title gets the subject\'s photograph that shares its words ("campus"), never the portrait', title(out[0].picture) === 'AUB Campus');
  ok('the split gets the one whose title shares its words (the library)', title(out[3].picture) === 'AUB library reading room');
  ok('a scene that already has a picture keeps it', title(out[4].picture) === 'Kept');
  ok('the gallery gets what is left — its own before its place\'s — and nothing twice', same(out[5].pictures.map(title), ['AUB College Hall', 'Beirut corniche']));
  ok('scenes that take no picture are untouched, and the input is not changed', same(out[1], before[1]) && same(out[6], before[6]) && same(scenes, before));
  ok('no brief, or no pictures: the scenes as they were', placeBriefPictures(scenes, undefined) === scenes && placeBriefPictures(scenes, { ...brief, pictures: [] }) === scenes);
  const block = factsBlock(brief);
  ok('the planner hears of the photographs, not of the portrait', /AUB College Hall; AUB library reading room; AUB Campus; Beirut corniche/.test(block) && !/Rev\. Daniel Bliss/.test(block));
  const noQuery = placeBriefPictures([s('t', 'title', { title: 'x' })], brief, 'landscape');
  ok('a title that asked for no picture gets none', !noQuery[0].picture);
}
{
  const wide = { src: 'data:image/jpeg;base64,V0lERQ==', credit: 'Main building — A, CC0 (Wikimedia Commons)', source: 'https://commons.wikimedia.org/wiki/File:W.jpg', query: 'X University', width: 1920, height: 1080 };
  const tall = { src: 'data:image/jpeg;base64,VEFMTA==', credit: 'Library tower — B, CC0 (Wikimedia Commons)', source: 'https://commons.wikimedia.org/wiki/File:T.jpg', query: 'X University', width: 1080, height: 1620 };
  const brief = { subjects: ['X University'], facts: [], pictures: [tall, wide], at: 1 };
  const s1 = [{ id: 'i', kind: 'image', seconds: 4, transition: 'fade', imageQuery: 'students walking' }];
  ok('with no words in common, the shape decides: a wide frame gets the wide photograph', pictureTitle(placeBriefPictures(s1, brief, 'landscape')[0].picture) === 'Main building'
    && pictureTitle(placeBriefPictures(s1, brief, 'portrait')[0].picture) === 'Library tower');
}
ok('sameName: the same person in either order, not a namesake with one word', sameName('Daniel Bliss', 'daniel  bliss') && sameName('Bliss Daniel', 'Daniel Bliss') && !sameName('Daniel', 'Daniel Bliss') && !sameName('Daniel Smith', 'Daniel Bliss'));
ok('a brief is made once: planning again reuses it', wantsLookup({}) && wantsLookup({ lookup: true }) && !wantsLookup({ lookup: false }) && !wantsLookup({ brief: { subjects: [], facts: [], pictures: [], at: 1 } }));
ok('fact labels the Facts tab translates', LABELS.founded === 'Founded' && LABELS.website === 'Official website' && LABELS.summary === 'Summary');

// ── every request this file made ──────────────────────────────────────────
ok('no request carried an init object (so no header, no preflight)', everyCall.every((c) => c.length === 2 && (c[1] === undefined || c[1] instanceof AbortSignal)));
ok('every request went over https to Wikidata, Wikipedia, Commons, Openverse or the image hosts', everyCall.every(([u]) => /^https:\/\/(www\.wikidata\.org|(ar|ckb|en|ku)\.wikipedia\.org|commons\.wikimedia\.org|api\.openverse\.org|(upload|thumb)\.wikimedia\.org|live\.staticflickr\.com)\//.test(u)), everyCall.map((c) => c[0]).filter((u) => !/^https:\/\/(www\.wikidata|(ar|ckb|en|ku)\.wikipedia|commons\.wikimedia|api\.openverse|(upload|thumb)\.wikimedia|live\.staticflickr)/.test(u)));

// ── the organisation's own logo, from its own website ─────────────────────
{
  // uod.ac's front page, trimmed to what matters: its own logo in the header,
  // partners' logos further down, news photographs captioned with its name,
  // and its touch icons.
  const page = `<html><head>
    <link rel="shortcut icon" href="https://uod.ac/static/images/favicon.ico">
    <link rel="apple-touch-icon" sizes="152x152" href="/static/images/favicon/apple-touch-icon-152x152.png">
    </head><body><header><a href="/"><img alt="University of Duhok (UoD)" width="45" src="https://uod.ac/static/images/uod-logo-blue.png"></a></header>
    <img src="/media/images/DSC08605.fill-1200x675.jpg" alt="University of Duhok students at graduation">
    <img src="/media/images/a.jpg"><img src="/media/images/b.jpg"><img src="/media/images/c.jpg"><img src="/media/images/d.jpg">
    <img src="/media/images/e.jpg"><img src="/media/images/f.jpg"><img src="/media/images/g.jpg">
    <img src="https://uod.ac/media/images/purdue-university-logo.width-500.png" alt="Purdue University">
    <img src="https://uod.ac/media/images/UniMed-logo.width-500.png">
    <footer><img src="/static/images/uod-logo-white-sm.png" alt="UoD"></footer></body></html>`;
  const c = siteLogoCandidates(page, 'https://uod.ac/', ['University of Duhok']);
  ok('its own header logo comes first', c[0] === 'https://uod.ac/static/images/uod-logo-blue.png', c);
  ok('a partner university\'s logo is never taken for it', !c.some((u) => /purdue|UniMed/i.test(u)), c);
  ok('nor a news photograph whose caption names it', !c.some((u) => /\.jpg$/.test(u)), c);
  ok('the white footer version is kept below the one drawn for light backgrounds', c.indexOf('https://uod.ac/static/images/uod-logo-white-sm.png') > 0);
  ok('the touch icon is the last resort, made absolute; the .ico is left out', c.at(-1) === 'https://uod.ac/static/images/favicon/apple-touch-icon-152x152.png' && !c.some((u) => u.endsWith('.ico')), c);
  ok('schema.org\'s logo outranks everything', siteLogoCandidates(`${page}<script type="application/ld+json">{"@type":"CollegeOrUniversity","logo":{"@type":"ImageObject","url":"/brand/mark.png"}}</script>`, 'https://uod.ac/', [])[0] === 'https://uod.ac/brand/mark.png');
  ok('an http image is asked for over https', siteLogoCandidates('<img src="http://example.org/logo.png" alt="logo">', 'https://example.org/', ['Example'])[0] === 'https://example.org/logo.png');

  const asked = [];
  const get = async (url) => {
    asked.push(url);
    if (url === 'https://uod.ac/') return reply(200, page, { 'content-type': 'text/html' });
    if (url.endsWith('uod-logo-blue.png')) return reply(200, new Blob(['UODLOGO'], { type: 'image/png' }), { 'content-type': 'image/png' });
    return reply(404, '');
  };
  const pic = await siteLogo('http://uod.ac', ['University of Duhok'], { get, encode: encodeLogo });
  ok('the site given as http is read over https, and its logo fetched', asked[0] === 'https://uod.ac/' && pic && /^data:image\/png/.test(pic.src), asked);
  ok('…credited to the organisation\'s own website, not to a licence', pic && /from uod\.ac, the organisation's own website/.test(pic.credit) && pic.source === 'https://uod.ac/');
  ok('a site that cannot be read gives no logo, and no throw', (await siteLogo('https://nowhere.example', ['X'], { get: async () => reply(500, '') })) === null);
  ok('nor does a site with nothing that is a logo', (await siteLogo('https://uod.ac', ['University of Duhok'], { get: async (u) => (u === 'https://uod.ac/' ? reply(200, '<p>hello</p>') : reply(404, '')) })) === null);

  const brief = { subjects: ['University of Duhok'], facts: [], pictures: [], website: 'http://uod.ac', at: 1 };
  const withLogo = await withSiteLogo(brief, { get, encode: encodeLogo });
  ok('a brief with no free logo gets its website\'s', !!withLogo.logo && withLogo.website === 'http://uod.ac');
  const had = { ...brief, logo: { src: 'data:image/png;base64,QQ==', credit: 'free', source: 'https://commons.wikimedia.org/x', query: 'x' } };
  ok('a brief that has a free logo keeps it, and nothing is asked', (await withSiteLogo(had, { get: async () => { throw new Error('asked'); } })) === had);
}

// ── only the logo, for the Slides chat ────────────────────────────────────
{
  // Oxford: its Wikidata item names a Commons logo, and nothing else is fetched.
  const oxford = { type: 'item', id: 'Q34433', labels: { en: { language: 'en', value: 'University of Oxford' } }, descriptions: { en: { language: 'en', value: 'collegiate research university in Oxford, England' } }, sitelinks: {},
    claims: { P154: [{ mainsnak: { snaktype: 'value', property: 'P154', datavalue: { value: 'University of Oxford.svg', type: 'string' } }, rank: 'normal' }] } };
  const f = fake([
    ['wbsearchentities', reply(200, { search: [{ id: 'Q34433', label: 'University of Oxford', description: 'collegiate research university in Oxford, England', match: { type: 'label', text: 'University of Oxford' } }] })],
    ['wbgetentities', reply(200, { entities: { Q34433: oxford } })],
    ['titles=', reply(200, FX.filesOxford)],
    [(u) => u.includes('.svg.png'), png],
  ]);
  const got = await findLogo('University of Oxford', { lang: 'en', get: f.get, encode: encodeLogo });
  ok('findLogo: a Commons logo, as a PNG, for the name the item goes by', got && /^data:image\/png/.test(got.logo.src) && got.found === 'University of Oxford' && /Public domain/.test(got.logo.credit));
  ok('…and no photograph, summary or Openverse is asked for', !f.urls().some((u) => /openverse|rest_v1|\.jpg/.test(u)), f.urls());

  // Duhok: no logo on Wikidata, so the one on its own website (the item's P856).
  const page = '<header><img src="/img/uod-logo-blue.png" alt="University of Duhok logo"></header>';
  // The website's own answers are kept out of `fake`, whose every request HOSTS must name.
  const wiki = fake(uodRoutes());
  const asked = [];
  const g = {
    get: async (u, s) => {
      if (!u.startsWith('https://uod.ac/')) return wiki.get(u, s);
      asked.push(u);
      return u === 'https://uod.ac/' ? reply(200, page, { 'content-type': 'text/html' }) : u.endsWith('uod-logo-blue.png') ? png() : reply(404, '');
    },
  };
  const uod = await findLogo('University of Duhok', { lang: 'ckb', get: g.get, encode: encodeLogo });
  ok('findLogo: no Commons logo, so the organisation\'s own website\'s', uod && /^data:image\/png/.test(uod.logo.src) && /the organisation's own website/.test(uod.logo.credit) && asked[0] === 'https://uod.ac/', asked);
  const site = await findLogo('', { lang: 'en', site: 'https://uod.ac', get: g.get, encode: encodeLogo });
  ok('…a website alone is enough', site && /uod\.ac/.test(site.logo.source));
  ok('nothing found is null, not a throw', (await findLogo('Zzqx Nowhere', { lang: 'en', get: async () => reply(500, '') })) === null);
  const ctl = new AbortController();
  ctl.abort();
  ok('a stop throws an AbortError', (await failure(findLogo('University of Duhok', { lang: 'en', get: g.get, signal: ctl.signal })))?.name === 'AbortError');
}

// ── what was known and what was just found ────────────────────────────────
{
  const known = { subjects: ['University of Duhok'], facts: [{ label: 'Founded', value: '1992', source: 'Wikidata', url: 'u', use: false }], pictures: [{ src: 'data:a', credit: 'a', source: 'a', query: 'a' }], website: 'http://uod.ac', at: 1 };
  const found = { subjects: ['Duhok Dam', 'university of duhok'], facts: [{ label: 'Founded', value: '1992', source: 'Wikidata', url: 'u', use: true }, { label: 'Height', value: '60 m', source: 'Wikidata', url: 'u', use: false }], pictures: [{ src: 'data:a', credit: 'a', source: 'a', query: 'a' }, { src: 'data:b', credit: 'b', source: 'b', query: 'b' }], logo: { src: 'data:l', credit: 'l', source: 'l', query: 'l' }, at: 2 };
  const m = mergeBrief(known, found);
  ok('merged: new subjects added, the same one not twice', m.subjects.join('|') === 'University of Duhok|Duhok Dam');
  ok('…a fact already known kept as the person left it, a new one switched on', m.facts.length === 2 && m.facts[0].use === false && m.facts[1].label === 'Height' && m.facts[1].use === true);
  ok('…photographs without repeats, the first logo and website', m.pictures.length === 2 && m.logo?.src === 'data:l' && m.website === 'http://uod.ac' && m.at === 2);
  ok('nothing found leaves the brief as it was; nothing known takes what was found', mergeBrief(known, null) === known && mergeBrief(undefined, found) === found);
}

// HOSTS is what SAFETY lists for this file: every address it asks is on it,
// except the picture hosts a collection names for a photograph's bytes.
ok('every request that is not a picture went to a host HOSTS names', everyCall.every(([u]) => isImage(u) || HOSTS.includes(new URL(u).hostname)),
   everyCall.map((c) => c[0]).filter((u) => !isImage(u) && !HOSTS.includes(new URL(u).hostname)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
