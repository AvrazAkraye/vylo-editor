// Scholar: the references a document cites, found in OpenAlex and Crossref.
//
// The property that matters is that every record is what an index said — field
// by field, from its own answer, never filled in — and that the search is a
// good guest while it asks: no headers on any request, Crossref one request at
// a time and a second apart, OpenAlex left alone once it asks for a long rest,
// and a stop that stops. The fixtures below are real answers, measured from
// this machine and cut down to a few items each; the requests go to a fake
// `Get` that records every call and never touches a socket.
import {
  cleanDoi, crossrefUrl, fromCrossref, fromOpenAlex, lookupDoi, merge, openAlexUrl, search,
} from '../.test-build/scholar.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = (v) => JSON.parse(JSON.stringify(v));

// ── fixtures (real responses, trimmed) ────────────────────────────────────

// OpenAlex, search=artificial intelligence higher education, per-page=6: four of the six
// results kept, authorships cut to the author's name, abstracts cut to their first 28 words.
const openAlexSearch = {"meta": {"count": 734594, "page": 1, "per_page": 6}, "results": [{"id": "https://openalex.org/W2981863007", "doi": "https://doi.org/10.1186/s41239-019-0171-0", "title": "Systematic review of research on artificial intelligence applications in higher education – where are the educators?", "display_name": "Systematic review of research on artificial intelligence applications in higher education – where are the educators?", "publication_year": 2019, "authorships": [{"author": {"display_name": "Olaf Zawacki‐Richter"}, "raw_author_name": "Olaf Zawacki-Richter"}, {"author": {"display_name": "Victoria I. Marín"}, "raw_author_name": "Victoria I. Marín"}, {"author": {"display_name": "Melissa Bond"}, "raw_author_name": "Melissa Bond"}, {"author": {"display_name": "Franziska Gouverneur"}, "raw_author_name": "Franziska Gouverneur"}], "primary_location": {"landing_page_url": "https://doi.org/10.1186/s41239-019-0171-0", "source": {"display_name": "International Journal of Educational Technology in Higher Education", "type": "journal", "host_organization_name": "Springer Nature"}}, "biblio": {"volume": "16", "issue": "1", "first_page": null, "last_page": null}, "type": "review", "language": "en", "abstract_inverted_index": {"Abstract": [0], "According": [1], "to": [2], "various": [3], "international": [4], "reports,": [5], "Artificial": [6], "Intelligence": [7], "in": [8, 18], "Education": [9], "(AIEd)": [10], "is": [11], "one": [12], "of": [13], "the": [14], "currently": [15], "emerging": [16], "fields": [17], "educational": [19], "technology.": [20], "Whilst": [21], "it": [22], "has": [23], "been": [24], "around": [25], "for": [26], "about": [27]}, "cited_by_count": 6707, "is_retracted": false}, {"id": "https://openalex.org/W2770717476", "doi": "https://doi.org/10.1186/s41039-017-0062-8", "title": "Exploring the impact of artificial intelligence on teaching and learning in higher education", "display_name": "Exploring the impact of artificial intelligence on teaching and learning in higher education", "publication_year": 2017, "authorships": [{"author": {"display_name": "Ştefan Popenici"}, "raw_author_name": "Stefan A. D. Popenici"}, {"author": {"display_name": "Sharon Kerr"}, "raw_author_name": "Sharon Kerr"}], "primary_location": {"landing_page_url": "https://doi.org/10.1186/s41039-017-0062-8", "source": {"display_name": "Research and Practice in Technology Enhanced Learning", "type": "journal", "host_organization_name": "Springer Nature"}}, "biblio": {"volume": "12", "issue": "1", "first_page": "22", "last_page": "22"}, "type": "article", "language": "en", "abstract_inverted_index": {"This": [0], "paper": [1], "explores": [2], "the": [3, 6, 9], "phenomena": [4], "of": [5, 8, 11, 25], "emergence": [7], "use": [10], "artificial": [12], "intelligence": [13], "in": [14, 18], "teaching": [15], "and": [16], "learning": [17], "higher": [19], "education.": [20], "It": [21], "investigates": [22], "educational": [23], "implications": [24], "emerging": [26], "technologies": [27]}, "cited_by_count": 1970, "is_retracted": false}, {"id": "https://openalex.org/W3017131514", "doi": "https://doi.org/10.1109/access.2020.2988510", "title": "Artificial Intelligence in Education: A Review", "display_name": "Artificial Intelligence in Education: A Review", "publication_year": 2020, "authorships": [{"author": {"display_name": "Lijia Chen"}, "raw_author_name": "Lijia Chen"}, {"author": {"display_name": "Pingping Chen"}, "raw_author_name": "Pingping Chen"}, {"author": {"display_name": "Zhijian Lin"}, "raw_author_name": "Zhijian Lin"}], "primary_location": {"landing_page_url": "https://doi.org/10.1109/access.2020.2988510", "source": {"display_name": "IEEE Access", "type": "journal", "host_organization_name": "Institute of Electrical and Electronics Engineers"}}, "biblio": {"volume": "8", "issue": null, "first_page": "75264", "last_page": "75278"}, "type": "article", "language": "en", "abstract_inverted_index": {"The": [0], "purpose": [1], "of": [2, 10], "this": [3], "study": [4], "was": [5], "to": [6], "assess": [7], "the": [8], "impact": [9], "Artificial": [11], "Intelligence": [12], "(AI)": [13], "on": [14, 17], "education.": [15], "Premised": [16], "a": [18, 27], "narrative": [19], "and": [20], "framework": [21], "for": [22], "assessing": [23], "AI": [24], "identified": [25], "from": [26]}, "cited_by_count": 3945, "is_retracted": false}, {"id": "https://openalex.org/W4214643205", "doi": "https://doi.org/10.1007/s10639-022-10925-9", "title": "Artificial intelligence in online higher education: A systematic review of empirical research from 2011 to 2020", "display_name": "Artificial intelligence in online higher education: A systematic review of empirical research from 2011 to 2020", "publication_year": 2022, "authorships": [{"author": {"display_name": "Fan Ouyang"}, "raw_author_name": "Fan Ouyang"}, {"author": {"display_name": "Luyi Zheng"}, "raw_author_name": "Luyi Zheng"}, {"author": {"display_name": "Pengcheng Jiao"}, "raw_author_name": "Pengcheng Jiao"}], "primary_location": {"landing_page_url": "https://doi.org/10.1007/s10639-022-10925-9", "source": {"display_name": "Education and Information Technologies", "type": "journal", "host_organization_name": "Springer Science+Business Media"}}, "biblio": {"volume": "27", "issue": "6", "first_page": "7893", "last_page": "7925"}, "type": "review", "language": "en", "abstract_inverted_index": null, "cited_by_count": 813, "is_retracted": false}]};

// OpenAlex, filter=language:ar — a real record with an Arabic half to its title. (The same
// listing tagged English papers `ar` too: `language` is the record's word, not a fact.)
const openAlexBilingual = {"id": "https://openalex.org/W1508167383", "doi": "https://doi.org/10.12816/0003082", "title": "The Role of Oxidative Stress and Antioxidants in Diabetic Complications = دور الإجهاد التأكسدي و المواد المضادة للأكسدة في مضاعفات مرض السكري", "display_name": "The Role of Oxidative Stress and Antioxidants in Diabetic Complications = دور الإجهاد التأكسدي و المواد المضادة للأكسدة في مضاعفات مرض السكري", "publication_year": 2012, "authorships": [{"author": {"display_name": "Fatmah A. Matough"}, "raw_author_name": "Fatmah A Matough"}, {"author": {"display_name": "Siti Balkis Budin"}, "raw_author_name": "Siti B Budin"}, {"author": {"display_name": "Zariyantey Abd Hamid"}, "raw_author_name": "Zariyantey A Hamid"}, {"author": {"display_name": "Nasar Alwahaibi"}, "raw_author_name": "Nasar Alwahaibi"}, {"author": {"display_name": "Jamaludin Mohamed"}, "raw_author_name": "Jamaludin Mohamed"}], "primary_location": {"landing_page_url": "https://doi.org/10.12816/0003082", "source": {"display_name": "Sultan Qaboos University medical journal", "type": "journal", "host_organization_name": "Sultan Qaboos University"}}, "biblio": {"volume": "12", "issue": "1", "first_page": "5", "last_page": "18"}, "type": "article", "language": "ar", "abstract_inverted_index": {"Diabetes": [0], "is": [1, 14], "considered": [2], "to": [3], "be": [4], "one": [5], "of": [6], "the": [7], "most": [8], "common": [9], "chronic": [10], "diseases": [11], "worldwide.": [12], "There": [13], "a": [15], "growing": [16], "scientific": [17], "and": [18], "public": [19]}, "cited_by_count": 582, "is_retracted": false};

// OpenAlex, works/doi:10.1186/s41239-019-0171-0 — a single work, abstract cut to 12 words.
const openAlexWork = {"id": "https://openalex.org/W2981863007", "doi": "https://doi.org/10.1186/s41239-019-0171-0", "title": "Systematic review of research on artificial intelligence applications in higher education – where are the educators?", "display_name": "Systematic review of research on artificial intelligence applications in higher education – where are the educators?", "publication_year": 2019, "authorships": [{"author": {"display_name": "Olaf Zawacki‐Richter"}, "raw_author_name": "Olaf Zawacki-Richter"}, {"author": {"display_name": "Victoria I. Marín"}, "raw_author_name": "Victoria I. Marín"}, {"author": {"display_name": "Melissa Bond"}, "raw_author_name": "Melissa Bond"}, {"author": {"display_name": "Franziska Gouverneur"}, "raw_author_name": "Franziska Gouverneur"}], "primary_location": {"landing_page_url": "https://doi.org/10.1186/s41239-019-0171-0", "source": {"display_name": "International Journal of Educational Technology in Higher Education", "type": "journal", "host_organization_name": "Springer Nature"}}, "biblio": {"volume": "16", "issue": "1", "first_page": null, "last_page": null}, "type": "review", "language": "en", "abstract_inverted_index": {"Abstract": [0], "According": [1], "to": [2], "various": [3], "international": [4], "reports,": [5], "Artificial": [6], "Intelligence": [7], "in": [8], "Education": [9], "(AIEd)": [10], "is": [11]}, "cited_by_count": 6703, "is_retracted": false};

// OpenAlex's answer, twice, to the Arabic query الذكاء الاصطناعي التعليم while measuring this
// (headers: retry-after: 30, access-control-allow-origin: *).
const openAlex429 = {"error": "Rate limit exceeded", "message": "Anonymous search is temporarily rate-limited while the search cluster is under elevated load. Please retry in 30s, or use a free API key for uninterrupted access: https://openalex.org/rest-api.", "retryAfter": 30};

// Crossref, two searches ("artificial intelligence higher education", "proceedings artificial
// intelligence in education"): three items with no `author`, a type `other`, a posted-content
// preprint sharing its title and year with a journal article, JATS abstracts, one with its HTML
// escaped inside the JATS. Long abstracts cut.
const crossrefSearch = {"status": "ok", "message-type": "work-list", "message-version": "1.0.0", "message": {"total-results": 6226802, "items": [{"DOI": "10.33140/eoa.01.03.10", "type": "journal-article", "title": ["Artificial Intelligence and Human Society (Artificial Intelligence and Education)"], "container-title": ["Engineering: Open Access"], "issued": {"date-parts": [[2023, 10, 31]]}, "volume": "1", "issue": "3", "publisher": "Opast Group LLC", "URL": "https://doi.org/10.33140/eoa.01.03.10", "abstract": "<jats:p>The impact of AI technologies on different sectors has been profound, and one area where significant changes have occurred is education. In this abstract the integration of artificial intelligence technologies in education is explored, highlighting their potential advantages, challenges and ethical considerations. There are a wide range of tools and techniques in use for the application of AI to ducation, e.g. Intelligent Coaching Systems, Personalized Learning Platforms, Automated Scoreboards or Virtual Classrooms.</jats:p>"}, {"DOI": "10.1016/0004-3702(87)90086-5", "type": "journal-article", "title": ["Third international conference on artificial intelligence and education"], "container-title": ["Artificial Intelligence"], "issued": {"date-parts": [[1987, 1]]}, "page": "117", "volume": "31", "issue": "1", "publisher": "Elsevier BV", "URL": "https://doi.org/10.1016/0004-3702(87)90086-5"}, {"DOI": "10.64449/9780906785959-08", "type": "book-chapter", "title": ["When Artificial Intelligence Meets Contemplative Studies"], "author": [{"given": "Hiro", "family": "Saito", "sequence": "first"}], "container-title": ["Artificial Intelligence Transforming Higher Education Volume 1"], "issued": {"date-parts": [[2025, 8, 29]]}, "page": "225-252", "publisher": "UJ Press", "URL": "https://doi.org/10.64449/9780906785959-08", "abstract": "<jats:p>In the late 2010s, HE (higher education) leaders, practitioners, and researchers began to discuss how AI (artificial intelligence), as part and parcel of the 4IR (fourth industrial revolution), might transform IHEs (institutions of higher education) (Aoun 2017; Gleason 2018; Peters &amp; Jandrić 2019). As they enthusiastically embraced the 4IR, however, their discussions tended to focus on how IHEs should actively adapt to the AI-driven economy without critically reflecting on how IHEs might intervene and reshape the trajectory of the 4IR itself. In this regard, their mode of thinking was rather reactive (Saito 2022).</jats:p>"}, {"DOI": "10.3390/books978-3-7258-5038-9", "type": "book", "title": ["Artificial Intelligence Technologies for Education"], "issued": {"date-parts": [[2025, 9, 1]]}, "publisher": "MDPI", "URL": "https://doi.org/10.3390/books978-3-7258-5038-9"}, {"DOI": "10.5040/9798216420286_ch2", "type": "other", "title": ["Artificial Intelligence and Education"], "author": [{"given": "Kateryna", "family": "Decker", "sequence": "first"}], "container-title": ["Digital Directions"], "issued": {"date-parts": [[2023]]}, "page": "11-26", "publisher": "Rowman & Littlefield Publishers", "URL": "https://doi.org/10.5040/9798216420286_ch2"}, {"DOI": "10.20319/ictel.2025.151", "type": "proceedings-article", "title": ["ARTIFICIAL INTELLIGENCE IN EDUCATION: CHALLENGES AND OPPORTUNITIES"], "author": [{"given": "Andrei", "family": "Komissarov", "sequence": "first"}], "container-title": ["ARTIFICIAL INTELLIGENCE IN EDUCATION: CHALLENGES AND OPPORTUNITIES"], "issued": {"date-parts": [[2025, 5, 12]]}, "page": "151", "publisher": "Global Research & Development Services Publishing", "URL": "https://doi.org/10.20319/ictel.2025.151", "abstract": "<jats:p>Artificial Intelligence (AI) has become the most talked-about term of the year. However, in education—as in any knowledge-intensive field—its application is far from straightforward. While large language models, now widely used across industries, often produce “hallucinations” or inaccurate responses, such shortcomings are unacceptable in educational settings. So, how can we develop AI tools that genuinely address the challenges of modern education, ease the workload of teachers and students, enhance learning effectiveness, and, most</jats:p>"}, {"DOI": "10.36227/techrxiv.24313456", "type": "posted-content", "title": ["Artificial Intelligence and Human Society (Artificial Intelligence and Education)"], "author": [{"given": "Saumyajeet", "family": "Das", "sequence": "first"}, {"given": "Sauradeep", "family": "Das", "sequence": "first"}], "issued": {"date-parts": [[2023, 10, 18]]}, "publisher": "Institute of Electrical and Electronics Engineers (IEEE)", "URL": "https://doi.org/10.36227/techrxiv.24313456", "abstract": "<jats:p>&lt;p&gt;The impact of AI technologies on different sectors has been profound, and one area where significant changes have occurred is education. In this abstract the integration of artificial intelligence technologies in education is explored, highlighting their potential advantages, challenges and ethical considerations. There are a wide range of tools and techniques in use for the application of AI to education, e.g. Intelligent Coaching Systems, Personalized Learning Platforms, Automated Scoreboards or Virtual Classrooms.&lt;/p&gt;</jats:p>"}]}};

// Crossref, works/10.1186/s41239-019-0171-0 — the fields a lookup reads, abstract cut.
const crossrefWork = {"status": "ok", "message-type": "work", "message-version": "1.0.0", "message": {"DOI": "10.1186/s41239-019-0171-0", "type": "journal-article", "title": ["Systematic review of research on artificial intelligence applications in higher education – where are the educators?"], "author": [{"given": "Olaf", "family": "Zawacki-Richter", "sequence": "first"}, {"given": "Victoria I.", "family": "Marín", "sequence": "additional"}, {"given": "Melissa", "family": "Bond", "sequence": "additional"}, {"given": "Franziska", "family": "Gouverneur", "sequence": "additional"}], "container-title": ["International Journal of Educational Technology in Higher Education"], "issued": {"date-parts": [[2019, 10, 28]]}, "volume": "16", "issue": "1", "article-number": "39", "publisher": "Springer Science and Business Media LLC", "URL": "https://doi.org/10.1186/s41239-019-0171-0", "language": "en", "is-referenced-by-count": 6031, "abstract": "<jats:title>Abstract</jats:title>\n                  <jats:p>According to various international reports, Artificial Intelligence in Education (AIEd) is one of the currently emerging fields in educational technology. Whilst it has been around for about 30 years,</jats:p>"}};

// ── a fake transport ──────────────────────────────────────────────────────

/** A response shaped the way `fetch` shapes one, for the fields a `Get` promises. */
const reply = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  json: async () => (typeof body === 'string' ? JSON.parse(body) : clone(body)),
});

/** Every call any fake received, for the checks at the end. */
const everyCall = [];

/**
 * A `Get` that records its arguments and answers with `route(url, signal)`:
 * a reply, a promise of one, or an Error to reject with. It takes a
 * millisecond, like a request that is really in flight, and counts how many
 * are in flight at once.
 */
function fake(route) {
  const calls = [];
  let inFlight = 0, most = 0;
  const get = async (...args) => {
    calls.push(args);
    everyCall.push(args);
    inFlight += 1;
    most = Math.max(most, inFlight);
    try {
      await new Promise((r) => setTimeout(r, 1));
      const out = await route(args[0], args[1]);
      if (out instanceof Error) throw out;
      return out;
    } finally {
      inFlight -= 1;
    }
  };
  return { get, calls, urls: () => calls.map((c) => c[0]), most: () => most };
}

const isOA = (u) => u.startsWith('https://api.openalex.org/');
const queryOf = (u) => decodeURIComponent((/[?&](?:search|query)=([^&]*)/.exec(u) ?? [])[1] ?? '');
const perPageOf = (u) => Number(/[?&](?:per-page|rows)=(\d+)/.exec(u)[1]);
const noWait = async () => {};
const failure = async (p) => { try { await p; return null; } catch (e) { return e; } };

/** An inverted index read back the obvious way, to check the module against. */
const rebuilt = (inv) => Object.entries(inv)
  .flatMap(([word, at]) => at.map((i) => [i, word]))
  .sort((a, b) => a[0] - b[0])
  .map(([, word]) => word)
  .join(' ');

/** A constructed OpenAlex work, for the cases no real answer happened to contain. */
const oaWork = (id, over = {}) => ({
  id: `https://openalex.org/${id}`, doi: `https://doi.org/10.5555/${id.toLowerCase()}`,
  title: `Work ${id}`, display_name: `Work ${id}`, publication_year: 2020,
  authorships: [{ author: { display_name: 'Ann Lee' } }], primary_location: null, biblio: {},
  type: 'article', language: 'en', abstract_inverted_index: { Some: [0], words: [1] },
  cited_by_count: 0, is_retracted: false, ...over,
});
const oaList = (...works) => ({ meta: { count: works.length }, results: works });

const AR = 'الذكاء الاصطناعي التعليم';
// As the request that measured it was sent (see openAlex429 above).
const AR_ENCODED = '%D8%A7%D9%84%D8%B0%D9%83%D8%A7%D8%A1%20%D8%A7%D9%84%D8%A7%D8%B5%D8%B7%D9%86%D8%A7%D8%B9%D9%8A%20%D8%A7%D9%84%D8%AA%D8%B9%D9%84%D9%8A%D9%85';
const OA_SELECT = 'id,doi,title,display_name,publication_year,authorships,primary_location,biblio,type,language,abstract_inverted_index,cited_by_count,is_retracted';
const CR_SELECT = 'DOI,title,author,container-title,issued,type,abstract,volume,issue,page,publisher,URL';

// ── URLs ──────────────────────────────────────────────────────────────────
ok('an OpenAlex search is relevance search with only the fields a record needs',
  openAlexUrl('artificial intelligence higher education', 6)
    === `https://api.openalex.org/works?search=artificial%20intelligence%20higher%20education&per-page=6&select=${OA_SELECT}`);
ok('a Crossref search selects exactly the contract fields',
  crossrefUrl('artificial intelligence higher education', 8)
    === `https://api.crossref.org/works?query=artificial%20intelligence%20higher%20education&rows=8&select=${CR_SELECT}`);
ok('Crossref is never asked for language (a 400) or given an address', !/language|mailto/.test(crossrefUrl('x', 5)));
ok('an Arabic query is UTF-8 percent-encoded, byte for byte as measured', openAlexUrl(AR, 6).includes(`?search=${AR_ENCODED}&`));
ok('and the same for Crossref', crossrefUrl(AR, 6).includes(`?query=${AR_ENCODED}&`));
ok('a query cannot add parameters of its own', openAlexUrl('a&per-page=200#x', 5).startsWith('https://api.openalex.org/works?search=a%26per-page%3D200%23x&per-page=5&'));
ok('new lines, tabs and doubled spaces are one space', openAlexUrl('  deep\n\tlearning   ', 5).includes('search=deep%20learning&'));
ok('a page size is a whole number the index accepts',
  openAlexUrl('x', 0).includes('per-page=1&') && openAlexUrl('x', 7.8).includes('per-page=7&')
  && openAlexUrl('x', 5000).includes('per-page=200&') && openAlexUrl('x', NaN).includes('per-page=1&')
  && crossrefUrl('x', 5000).includes('rows=1000&') && crossrefUrl('x', -3).includes('rows=1&'));

// ── DOIs ──────────────────────────────────────────────────────────────────
const doiCases = [
  ['https://doi.org/10.1186/S41239-019-0171-0', '10.1186/s41239-019-0171-0'],
  ['http://dx.doi.org/10.1109/ACCESS.2020.2988510', '10.1109/access.2020.2988510'],
  ['https://www.doi.org/10.1000/xyz', '10.1000/xyz'],
  ['doi.org/10.1000/xyz', '10.1000/xyz'],
  ['doi:10.1000/XYZ', '10.1000/xyz'],
  ['DOI 10.1000/xyz', '10.1000/xyz'],
  ['DOI: 10.1000/xyz', '10.1000/xyz'],
  ['  10.1000/xyz.  ', '10.1000/xyz'],
  ['10.1000/xyz;', '10.1000/xyz'],
  ['<10.1000/xyz>', '10.1000/xyz'],
  ['https://doi.org/10.1002%2Fabc.123', '10.1002/abc.123'],
  ['10.1016/0004-3702(87)90086-5', '10.1016/0004-3702(87)90086-5'],
  ['10.1016/0004-3702(87)90086-5)', '10.1016/0004-3702(87)90086-5'],
  ['10.1002/(SICI)1097-4571(199806)49:8<693::AID-ASI3>3.0.CO;2-O', '10.1002/(sici)1097-4571(199806)49:8<693::aid-asi3>3.0.co;2-o'],
  ['10.12816/0003082', '10.12816/0003082'],
];
for (const [raw, want] of doiCases) ok(`cleanDoi(${JSON.stringify(raw)})`, cleanDoi(raw) === want, cleanDoi(raw));
const notDois = ['', '   ', 'hello', '11.1000/xyz', '10.abc/xyz', '10.1000', '10.1000/', '10./xyz',
  'https://example.com/10.1000/xyz', 'https://link.springer.com/article/10.1007/s10639-022-10925-9',
  '10.1000/has space', 'isbn 978-3-7258-5038-9', null, undefined, 42, {}];
ok('anything without a 10.<digits>/ prefix is not a DOI', notDois.every((x) => cleanDoi(x) === null),
  notDois.filter((x) => cleanDoi(x) !== null));

// ── OpenAlex records ──────────────────────────────────────────────────────
const oaFound = fromOpenAlex(openAlexSearch);
ok('every result of a real search is a record', oaFound.length === 4);
ok('keys are left for merge to assign', oaFound.every((s) => s.key === ''));
ok('a record from OpenAlex is verified, from openalex, and in use',
  oaFound.every((s) => s.origin === 'openalex' && s.verified === true && s.use === true && !('retracted' in s)));
ok('the DOI is bare and lower-case, never the URL OpenAlex gives',
  openAlexSearch.results[2].doi.startsWith('https://') && oaFound[2].doi === '10.1109/access.2020.2988510');
ok('the link is the DOI\'s', oaFound[0].url === 'https://doi.org/10.1186/s41239-019-0171-0');
ok('a name OpenAlex gives whole splits at the family name, its U+2010 hyphen made a hyphen',
  openAlexSearch.results[0].authorships[0].author.display_name.includes('‐')
  && same(oaFound[0].authors[0], { given: 'Olaf', family: 'Zawacki-Richter' }));
ok('a middle initial stays with the given name', same(oaFound[0].authors[1], { given: 'Victoria I.', family: 'Marín' }));
ok('a name with a cedilla is kept as written', same(oaFound[1].authors[0], { given: 'Ştefan', family: 'Popenici' }));
ok('year, venue, volume, issue and publisher are the record\'s',
  oaFound[0].year === 2019 && oaFound[0].venue === 'International Journal of Educational Technology in Higher Education'
  && oaFound[0].volume === '16' && oaFound[0].issue === '1' && oaFound[0].publisher === 'Springer Nature');
ok('OpenAlex\'s "review" is a journal article', openAlexSearch.results[0].type === 'review' && oaFound[0].type === 'article');
ok('no pages when the record has none', !('pages' in oaFound[0]));
ok('a first page equal to the last is one page, not 22-22', oaFound[1].pages === '22');
ok('a range is first-last', oaFound[2].pages === '75264-75278');
ok('a null issue is left out, not kept as null', openAlexSearch.results[2].biblio.issue === null && !('issue' in oaFound[2]));
ok('no field of any record is undefined or null', oaFound.every((s) => Object.values(s).every((v) => v !== undefined && v !== null)));
ok('the language and citation count are kept', oaFound.every((s) => s.lang === 'en') && oaFound[0].cited === 6707 && oaFound[3].cited === 813);
ok('the abstract is the inverted index put back in position order',
  oaFound[1].abstract === rebuilt(openAlexSearch.results[1].abstract_inverted_index));
ok('the heading "Abstract" a record starts with is not part of it',
  rebuilt(openAlexSearch.results[0].abstract_inverted_index).startsWith('Abstract According')
  && oaFound[0].abstract.startsWith('According to various international reports'));
ok('a work with no abstract has none, rather than an empty one', openAlexSearch.results[3].abstract_inverted_index === null && !('abstract' in oaFound[3]));

const [bilingual] = fromOpenAlex(openAlexBilingual);
ok('one work, not a result list, is read too', bilingual?.doi === '10.12816/0003082');
ok('a title with an Arabic half is kept whole', bilingual.title.endsWith('= دور الإجهاد التأكسدي و المواد المضادة للأكسدة في مضاعفات مرض السكري'));
ok('the language is the record\'s word for it', bilingual.lang === 'ar');
ok('a three-word Latin name splits at the last word', same(bilingual.authors[2], { given: 'Zariyantey Abd', family: 'Hamid' }));
ok('a real 429 body is no records, not a crash', same(fromOpenAlex(openAlex429), []));
ok('the single-work answer of a DOI lookup reads', fromOpenAlex(openAlexWork)[0]?.title.startsWith('Systematic review'));

const variant = (over) => fromOpenAlex({ results: [{ ...clone(openAlexSearch.results[2]), ...over }] });
const JUNK = ['paratext', 'erratum', 'other', 'retraction', 'peer-review', 'grant', 'libguides', 'supplementary-materials'];
ok('the kinds nobody cites are dropped where OpenAlex marks them', JUNK.every((type) => variant({ type }).length === 0));
const oaTypes = [['article', 'article'], ['review', 'article'], ['editorial', 'article'], ['letter', 'article'],
  ['book-chapter', 'chapter'], ['reference-entry', 'chapter'], ['book', 'book'], ['dissertation', 'thesis'],
  ['report', 'report'], ['standard', 'report'], ['preprint', 'other'], ['dataset', 'other'], ['a-type-added-next-year', 'other']];
ok('OpenAlex types map to the reference styles\' kinds', oaTypes.every(([type, want]) => variant({ type })[0]?.type === want),
  oaTypes.map(([type]) => variant({ type })[0]?.type));
ok('an article in a conference\'s proceedings is a conference paper',
  variant({ primary_location: { source: { display_name: 'Proc. LAK', type: 'conference' } } })[0].type === 'conference');
ok('no title is no record', variant({ title: null, display_name: null }).length === 0 && variant({ title: '  ', display_name: '' }).length === 0);
ok('display_name stands in for a missing title', variant({ title: null, display_name: 'Shown Name' })[0]?.title === 'Shown Name');
ok('front matter and indexes are not works', variant({ title: 'Front Matter' }).length === 0 && variant({ title: 'Index' }).length === 0
  && variant({ title: 'Table of Contents' }).length === 0);
const retractedOa = variant({ is_retracted: true })[0];
ok('a retracted work is kept, marked, and never used', retractedOa?.retracted === true && retractedOa.use === false);
ok('a title that says RETRACTED says the same', variant({ title: 'RETRACTED: A study of things' })[0]?.use === false);
ok('a missing location is no venue, not a crash', (() => {
  const [s] = variant({ primary_location: null });
  return s && !('venue' in s) && !('publisher' in s);
})());
ok('without a DOI, the landing page is the link', (() => {
  const [s] = variant({ doi: null, primary_location: { landing_page_url: 'https://example.org/paper/7', source: null } });
  return s && !('doi' in s) && s.url === 'https://example.org/paper/7';
})());
ok('odd fields are left out rather than kept wrong',
  (() => { const [s] = variant({ language: 'English', cited_by_count: -4, publication_year: '2020', doi: 'not a doi' }); return !('lang' in s) && !('cited' in s) && !('year' in s) && !('doi' in s); })());
ok('markup and entities in a title are text', variant({ title: 'The <i>in vitro</i> effect of H<sub>2</sub>O &amp; salt' })[0].title === 'The in vitro effect of H2O & salt');

// Constructed names: the real answers above had no Arabic-script author.
const nameOf = (display_name) => variant({ authorships: [{ author: { display_name } }] })[0].authors[0];
ok('an Arabic-script name is kept whole, never cut at a space', same(nameOf('محمد عبد الرحمن'), { family: 'محمد عبد الرحمن' }));
ok('a particle goes with the family name', same(nameOf('Ludwig van Beethoven'), { given: 'Ludwig', family: 'van Beethoven' }));
ok('...but only a lower-case one', same(nameOf('Van Morrison'), { given: 'Van', family: 'Morrison' }));
ok('a suffix stays with the family name', same(nameOf('Martin Luther King Jr.'), { given: 'Martin Luther', family: 'King Jr.' }));
ok('one word is a family name alone — an organisation, often', same(nameOf('UNESCO'), { family: 'UNESCO' }));
ok('"Family, Given" is read as it says', same(nameOf('Smith, John'), { given: 'John', family: 'Smith' }));
ok('the raw name stands in when the author has none, and an author with neither is dropped',
  same(variant({ authorships: [{ author: null, raw_author_name: 'Ann Lee' }, { author: {} }, null] })[0].authors, [{ given: 'Ann', family: 'Lee' }]));

const abstractOf = (inv) => variant({ abstract_inverted_index: inv })[0].abstract;
ok('positions put the words in order, whatever order the index lists them', abstractOf({ world: [1], again: [3], Hello: [0], ',': [2] }) === 'Hello world , again');
ok('HTML tokens in an index are dropped', abstractOf({ 'world.</p>': [1], '<p>Hello': [0] }) === 'Hello world.');
ok('broken positions are ignored, not a crash', abstractOf({ a: [0], b: ['x', -1, 1.5, 99999999], c: [1], d: 'no' }) === 'a c');
ok('"Abstract art…" keeps its first word', abstractOf({ Abstract: [0], art: [1], is: [2], old: [3] }) === 'Abstract art is old');
ok('"ABSTRACT:" as a heading goes', abstractOf({ 'ABSTRACT:': [0], This: [1], study: [2] }) === 'This study');
const long = abstractOf(Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`word${i}`, [i]])));
ok('a long abstract is cut at a word, near 1500 characters, and says so', long.length <= 1500 && long.length > 1300 && long.endsWith('…') && /word\d+…$/.test(long));
ok('an empty index is no abstract', !('abstract' in variant({ abstract_inverted_index: {} })[0]));
ok('anything that is not an answer is no records',
  [null, undefined, 'x', 42, [], { results: 'x' }, { results: [null, 1, 'x', {}] }, { meta: {} }].every((j) => same(fromOpenAlex(j), [])));

// ── Crossref records ──────────────────────────────────────────────────────
const crFound = fromCrossref(crossrefSearch);
const byDoi = (list, doi) => list.find((s) => s.doi === doi);
ok('every item but the one Crossref types "other" is a record',
  crossrefSearch.message.items.length === 7 && crFound.length === 6 && !byDoi(crFound, '10.5040/9798216420286_ch2'));
ok('a record from Crossref is verified, from crossref, in use, keys unassigned',
  crFound.every((s) => s.origin === 'crossref' && s.verified === true && s.use === true && s.key === ''));
const noAuthor = ['10.33140/eoa.01.03.10', '10.1016/0004-3702(87)90086-5', '10.3390/books978-3-7258-5038-9'];
ok('the real items with no author have none — and no crash',
  noAuthor.every((d) => !('author' in crossrefSearch.message.items.find((i) => i.DOI === d)))
  && noAuthor.every((d) => same(byDoi(crFound, d).authors, [])));
const saito = byDoi(crFound, '10.64449/9780906785959-08');
ok('title and container-title are arrays; the first of each is used',
  saito.title === 'When Artificial Intelligence Meets Contemplative Studies' && saito.venue === 'Artificial Intelligence Transforming Higher Education Volume 1');
ok('the year is issued date-parts [0][0]', saito.year === 2025 && byDoi(crFound, '10.1016/0004-3702(87)90086-5').year === 1987);
ok('pages, publisher and URL are the record\'s', saito.pages === '225-252' && saito.publisher === 'UJ Press' && saito.url === 'https://doi.org/10.64449/9780906785959-08');
ok('given and family come as Crossref splits them', same(saito.authors, [{ given: 'Hiro', family: 'Saito' }]));
ok('Crossref types map too',
  byDoi(crFound, '10.33140/eoa.01.03.10').type === 'article' && saito.type === 'chapter'
  && byDoi(crFound, '10.3390/books978-3-7258-5038-9').type === 'book' && byDoi(crFound, '10.20319/ictel.2025.151').type === 'conference'
  && byDoi(crFound, '10.36227/techrxiv.24313456').type === 'other');
ok('JATS is stripped and &amp; decoded', saito.abstract.includes('(Aoun 2017; Gleason 2018; Peters & Jandri\u0107 2019)') && !/[<>]|&amp;/.test(saito.abstract));
ok('a letter the record gives in two pieces comes out as one (NFC)',
  crossrefSearch.message.items[2].abstract.includes('Jandric\u0301') && !saito.abstract.includes('\u0301'));
const techrxiv = byDoi(crFound, '10.36227/techrxiv.24313456');
ok('HTML escaped inside the JATS does not reach the model as <p>',
  JSON.stringify(crossrefSearch).includes('&lt;p&gt;The impact') && techrxiv.abstract.startsWith('The impact of AI technologies')
  && !/[<>]|&lt;|&gt;/.test(techrxiv.abstract));
ok('curly quotes and dashes survive', byDoi(crFound, '10.20319/ictel.2025.151').abstract.includes('in education—as in any') && byDoi(crFound, '10.20319/ictel.2025.151').abstract.includes('“hallucinations”'));
ok('no abstract where the record has none', !('abstract' in byDoi(crFound, '10.1016/0004-3702(87)90086-5')));
ok('search results carry no language: Crossref cannot be asked for it', crFound.every((s) => !('lang' in s)));

const [crWork] = fromCrossref(crossrefWork);
ok('one work\'s message is read', crWork?.doi === '10.1186/s41239-019-0171-0' && crWork.title.startsWith('Systematic review'));
ok('the JATS heading "Abstract" is dropped', crossrefWork.message.abstract.startsWith('<jats:title>Abstract') && crWork.abstract.startsWith('According to various'));
ok('a thin space is a plain one', crossrefWork.message.abstract.includes('30 years') && crWork.abstract.includes('30 years,'));
ok('a full record\'s language and citation count are read', crWork.lang === 'en' && crWork.cited === 6031);
ok('volume and issue', crWork.volume === '16' && crWork.issue === '1' && crWork.venue === 'International Journal of Educational Technology in Higher Education');

const crVariant = (over) => fromCrossref({ message: { items: [{ ...clone(crossrefSearch.message.items[2]), ...over }] } });
ok('a structured abstract keeps its headings as text',
  crVariant({ abstract: '<jats:sec><jats:title>Purpose</jats:title><jats:p>To test.</jats:p></jats:sec><jats:sec><jats:title>Findings</jats:title><jats:p>It works.</jats:p></jats:sec>' })[0].abstract
    === 'Purpose: To test. Findings: It works.');
ok('inline markup joins, block markup separates', crVariant({ abstract: '<jats:p>Water is H<jats:sub>2</jats:sub>O.</jats:p><jats:p>Next.</jats:p>' })[0].abstract === 'Water is H2O. Next.');
ok('a less-than sign in the text is not taken for a tag', crVariant({ abstract: '<jats:p>p &lt; 0.05 and n &gt; 30, &#233;t&#xE9; &#x2014; ok</jats:p>' })[0].abstract === 'p < 0.05 and n > 30, été — ok');
ok('an unknown entity is left as it is', crVariant({ abstract: '<jats:p>a &bogus; b &constructor; c</jats:p>' })[0].abstract === 'a &bogus; b &constructor; c');
ok('the first non-empty title is the title', crVariant({ title: ['', 'Second'] })[0]?.title === 'Second');
ok('no title is no record', crVariant({ title: [] }).length === 0 && crVariant({ title: [''] }).length === 0 && crVariant({ title: undefined }).length === 0);
ok('markup in a title is text', crVariant({ title: ['<i>Homo sapiens</i> and AI'] })[0].title === 'Homo sapiens and AI');
const CR_JUNK = ['other', 'journal-issue', 'journal-volume', 'journal', 'component', 'grant', 'peer-review', 'database'];
ok('the kinds nobody cites are dropped where Crossref marks them', CR_JUNK.every((type) => crVariant({ type }).length === 0));
const crTypes = [['journal-article', 'article'], ['book-chapter', 'chapter'], ['book-section', 'chapter'], ['book-part', 'chapter'],
  ['book', 'book'], ['monograph', 'book'], ['edited-book', 'book'], ['proceedings-article', 'conference'], ['proceedings', 'conference'],
  ['dissertation', 'thesis'], ['report', 'report'], ['standard', 'report'], ['posted-content', 'other'], ['dataset', 'other'], ['new-kind', 'other']];
ok('every Crossref type maps', crTypes.every(([type, want]) => crVariant({ type })[0]?.type === want), crTypes.map(([type]) => crVariant({ type })[0]?.type));
ok('a year that is not there is left out', !('year' in crVariant({ issued: { 'date-parts': [[null]] } })[0]) && !('year' in crVariant({ issued: undefined })[0]));
ok('an organisation author is a family name', same(crVariant({ author: [{ name: 'World Health Organization' }] })[0].authors, [{ family: 'World Health Organization' }]));
ok('a given name alone is split like a whole name', same(crVariant({ author: [{ given: 'Jane Roe' }] })[0].authors, [{ given: 'Jane', family: 'Roe' }]));
ok('an Arabic given and family are kept as Crossref splits them',
  same(crVariant({ author: [{ given: 'محمد علي', family: 'الزهراني' }] })[0].authors, [{ given: 'محمد علي', family: 'الزهراني' }]));
ok('an empty author is dropped', same(crVariant({ author: [{}, null, { family: '  ' }] })[0].authors, []));
ok('RETRACTED in the title: kept, marked, never used', (() => {
  const [s] = crVariant({ title: ['RETRACTED: Artificial intelligence and learning'] });
  return s?.retracted === true && s.use === false;
})());
ok('front matter filed as a chapter is not a work', crVariant({ title: ['Front Matter'] }).length === 0 && crVariant({ title: ['Index'] }).length === 0);
ok('a long abstract is capped', (() => {
  const a = crVariant({ abstract: `<jats:p>${'word '.repeat(600)}</jats:p>` })[0].abstract;
  return a.length <= 1500 && a.endsWith('…');
})());
ok('anything that is not an answer is no records',
  [null, {}, { message: null }, { message: { items: 'x' } }, { message: { items: [null, 3, 'x'] } }, 'Resource not found.'].every((j) => same(fromCrossref(j), [])));

// ── merge ─────────────────────────────────────────────────────────────────
const rec = (title, over = {}) => ({ key: '', title, authors: [], type: 'article', origin: 'crossref', verified: true, use: true, ...over });
{
  const found = fromOpenAlex(openAlexSearch);
  const all = merge([], found, 10);
  ok('keys s1… in the order found', same(all.map((s) => s.key), ['s1', 's2', 's3', 's4']));
  ok('found records are copied, not changed', found.every((s) => s.key === '') && all[0] !== found[0]);
  const mine = [rec('Typed by hand', { key: 's1', origin: 'person', verified: false }), rec('Another', { key: 's7' }), rec('Odd key', { key: 'mine' })];
  const merged = merge(mine, found, 10);
  ok('what was there comes back first, the very same objects', merged[0] === mine[0] && merged[1] === mine[1] && merged[2] === mine[2]);
  ok('new keys continue after the highest sN, so no key changes meaning', same(merged.slice(3).map((s) => s.key), ['s8', 's9', 's10', 's11']));
  ok('max limits what is added, not what was there',
    merge(mine, found, 2).length === 5 && merge(mine, found, 0).length === 3 && merge(mine, found, -1).length === 3 && merge(mine, found, NaN).length === 3);
  ok('a DOI already there is not added again, however it was written',
    merge([rec('Typed', { key: 's1', doi: 'https://doi.org/10.1186/S41239-019-0171-0' })], found, 10).length === 4);
  ok('duplicates inside what was found are dropped too', merge([], [rec('One', { doi: '10.1/a' }), rec('Two', { doi: '10.1/A' })], 5).length === 1);
  ok('a record with no title is not added', merge([], [rec(''), rec('   '), rec(undefined)], 5).length === 0);
  ok('what was there is not deduplicated — it is theirs', merge([rec('A', { key: 's1' }), rec('A', { key: 's2' })], [], 5).length === 2);
}
{
  // The text cites [@s3؛ @s45] and the sources end at s3: the next work added
  // by hand must not become s45, or it is cited for a claim nobody read it for.
  const three = [rec('One', { key: 's1' }), rec('Two', { key: 's2' }), rec('Three', { key: 's3' })];
  const added = merge(three, [rec('New work', { doi: '10.1/new' })], 1, 45);
  ok('a floor puts new keys past every key the document used, not only its sources', added.length === 4 && added[3].key === 's46', added.map((s) => s.key));
  ok('added one at a time, each continues past it', merge(added, [rec('Newer work', { doi: '10.1/newer' })], 1, 45)[4].key === 's47');
  ok('a floor below the highest source key changes nothing', same(merge(three, [rec('New work')], 1, 2).map((s) => s.key), ['s1', 's2', 's3', 's4']));
  ok('no floor, or one that is not a whole number, is none',
    merge(three, [rec('New work')], 1)[3].key === 's4' && merge(three, [rec('New work')], 1, NaN)[3].key === 's4' && merge(three, [rec('New work')], 1, -7)[3].key === 's4');
}
{
  const ar1 = rec('أثر الذكاء الاصطناعي في التعليم الجامعي: دراسة ميدانية', { year: 2021, key: 's1' });
  const ar2 = rec('اثر الذكاء الاصطناعى فى التعليم الجامعى - دراسه ميدانيه', { year: 2021 });
  ok('Arabic spellings of one title are one work (hamza, alef maqsura, teh marbuta, punctuation)', merge([ar1], [ar2], 5).length === 1);
  ok('...but not in another year', merge([ar1], [{ ...ar2, year: 2022 }], 5).length === 2);
  ok('...and not with a year against none', merge([ar1], [{ ...ar2, year: undefined }], 5).length === 2);
  ok('Kurdish and Arabic keyboards give one title', merge([rec('کاریگەری زیرەکی دەستکرد', { year: 2020, key: 's1' })], [rec('كاريگەري زيرەكي دەستكرد', { year: 2020 })], 5).length === 1);
  ok('Arabic-Indic digits are the same digits', merge([rec('رؤية 2030 والتعليم', { year: 2019, key: 's1' })], [rec('رؤية ٢٠٣٠ والتعليم', { year: 2019 })], 5).length === 1);
  ok('English case, dashes and punctuation do not make a new work',
    merge([rec('Artificial Intelligence in Education: A Review', { year: 2020, key: 's1' })], [rec('artificial intelligence in education — a review.', { year: 2020 })], 5).length === 1);
  ok('a title with no letters or digits is compared by DOI only',
    merge([rec('???', { key: 's1', doi: '10.1/x' })], [rec('!!!', { doi: '10.1/y' })], 5).length === 2);
}

// ── search: what is asked, and how ────────────────────────────────────────
{
  const f = fake((u) => reply(200, isOA(u) ? openAlexSearch : crossrefSearch));
  const r = await search(['artificial intelligence higher education', 'AI tutoring'], 5, f.get, { sleep: noWait });
  ok('one OpenAlex request per query, and nothing else', same(f.urls(), [openAlexUrl('artificial intelligence higher education', 5), openAlexUrl('AI tutoring', 5)]));
  ok('each request is the URL and nothing more — no init, no headers', f.calls.every((c) => c.length === 2 && c[1] === undefined));
  ok('the same four works from both queries are four records, s1–s4', same(r.sources.map((s) => s.key), ['s1', 's2', 's3', 's4']) && r.failed === 0);
}
{
  const ac = new AbortController();
  const f = fake(() => reply(200, openAlexSearch));
  await search(['a'], 5, f.get, { signal: ac.signal });
  ok('the signal is the second argument, and there is no third', f.calls.length === 1 && f.calls[0].length === 2 && f.calls[0][1] === ac.signal);
}
{
  const pages = async (queries, want) => {
    const f = fake(() => reply(200, oaList()));
    await search(queries, want, f.get);
    return f.urls().map(perPageOf);
  };
  const eight = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  ok('each query asks for its share and a margin: 30 over 8 is 6', same(await pages(eight, 30), Array(8).fill(6)));
  ok('80 over 8 is 16', same(await pages(eight, 80), Array(8).fill(16)));
  ok('never fewer than five a page', same(await pages(['a', 'b', 'c', 'd'], 3), [5, 5, 5, 5]));
  ok('never more than 25', same(await pages(['a', 'b'], 80), [25, 25]));
}
{
  const f = fake(() => reply(200, oaList()));
  await search(['AI  education', 'ai education', ' AI education ', 'التعليم', 'التعلیم', '', '   '], 5, f.get);
  ok('a query is sent once however it was spelt — case, spaces, Arabic or Persian yeh', same(f.urls().map(queryOf), ['AI education', 'التعليم']));
  const g = fake(() => reply(200, oaList()));
  await search(Array.from({ length: 14 }, (_, i) => `query ${i}`), 20, g.get);
  ok('no more than ten queries are spent on one search', g.calls.length === 10);
  const h = fake(() => reply(200, oaList()));
  const none = [await search([], 10, h.get), await search(['  '], 10, h.get), await search(['a'], 0, h.get), await search(['a'], -5, h.get), await search(['a'], NaN, h.get)];
  ok('nothing to search, or nothing wanted, asks nothing', h.calls.length === 0 && none.every((r) => r.sources.length === 0 && r.failed === 0));
}
{
  const f = fake(() => reply(200, oaList()));
  await search([AR], 5, f.get);
  ok('the Arabic query goes out encoded as measured', f.urls()[0] === openAlexUrl(AR, 8) && f.urls()[0].includes(AR_ENCODED));
}

// ── search: when OpenAlex cannot answer ───────────────────────────────────
{
  const waits = [];
  const f = fake((u) => (isOA(u) ? reply(429, openAlex429, { 'retry-after': '30' }) : reply(200, crossrefSearch)));
  const r = await search([AR, 'artificial intelligence higher education'], 10, f.get, { sleep: async (ms) => { waits.push(ms); } });
  ok('the real 429 sends that query to Crossref', same(f.urls().slice(0, 2), [openAlexUrl(AR, 8), crossrefUrl(AR, 8)]));
  ok('asked to come back in 30 s, OpenAlex is not asked again this search',
    same(f.urls(), [openAlexUrl(AR, 8), crossrefUrl(AR, 8), crossrefUrl('artificial intelligence higher education', 8)]));
  ok('the Arabic query reaches Crossref encoded', f.urls()[1].includes(`query=${AR_ENCODED}&`));
  ok('Crossref answered, so nothing failed', r.failed === 0 && r.sources.length > 0 && r.sources.every((s) => s.origin === 'crossref'));
  ok('the second Crossref request waited about a second', waits.length === 1 && waits[0] > 900 && waits[0] <= 1000, waits);
}
{
  let n = 0;
  const f = fake((u) => (isOA(u) ? (n++ === 0 ? reply(429, openAlex429, { 'retry-after': '2' }) : reply(200, openAlexSearch)) : reply(200, crossrefSearch)));
  await search(['q1', 'q2'], 10, f.get, { sleep: noWait });
  ok('a short Retry-After falls back for that query only', same(f.urls(), [openAlexUrl('q1', 8), crossrefUrl('q1', 8), openAlexUrl('q2', 8)]));
  let m = 0;
  const g = fake((u) => (isOA(u) ? (m++ === 0 ? reply(429, openAlex429) : reply(200, openAlexSearch)) : reply(200, crossrefSearch)));
  await search(['q1', 'q2'], 10, g.get, { sleep: noWait });
  ok('so does a 429 with no Retry-After', same(g.urls(), [openAlexUrl('q1', 8), crossrefUrl('q1', 8), openAlexUrl('q2', 8)]));
  const later = new Date(Date.now() + 120_000).toUTCString();
  const h = fake((u) => (isOA(u) ? reply(429, openAlex429, { 'retry-after': later }) : reply(200, crossrefSearch)));
  await search(['q1', 'q2'], 10, h.get, { sleep: noWait });
  ok('a Retry-After given as a date two minutes off is a long rest too', h.urls().filter(isOA).length === 1);
}
const fallbacks = [
  ['a 503', () => reply(503, 'Service Unavailable')],
  ['a 500', () => reply(500, 'Internal Server Error')],
  ['a 400 (a query OpenAlex could not parse)', () => reply(400, { error: 'Invalid query' })],
  ['no network at all', () => new TypeError('Load failed')],
  ['a 200 that is not a result list', () => reply(200, { error: 'odd' })],
  ['a 200 whose JSON does not parse', () => reply(200, '<html>maintenance</html>')],
];
for (const [name, route] of fallbacks) {
  const f = fake((u) => (isOA(u) ? route() : reply(200, crossrefSearch)));
  const r = await search(['q1'], 5, f.get, { sleep: noWait });
  ok(`${name} from OpenAlex: that query goes to Crossref`, same(f.urls(), [openAlexUrl('q1', 8), crossrefUrl('q1', 8)]) && r.failed === 0 && r.sources.length === 5);
}
{
  const f = fake((u) => (queryOf(u) === 'dead' ? reply(503, '') : isOA(u) ? reply(200, openAlexSearch) : reply(200, crossrefSearch)));
  const r = await search(['dead', 'alive'], 5, f.get, { sleep: noWait });
  ok('a query neither index answered is counted', r.failed === 1);
  ok('and the others still give their records', r.sources.length === 4);
  const g = fake(() => new TypeError('offline'));
  const off = await search(['a', 'b', 'c'], 5, g.get, { sleep: noWait });
  ok('offline: every query failed, nothing found, and no throw', off.failed === 3 && off.sources.length === 0 && g.calls.length === 6);
  ok('… and it says how many it asked, so "every one failed" can be told', off.sent === 3 && r.sent === 2);
  const k = fake(() => new TypeError('offline'));
  const repeats = await search(['a', 'A', ' a ', 'b'], 5, k.get, { sleep: noWait });
  ok('sent counts the queries asked once repeats are dropped, not the ones given', repeats.sent === 2 && repeats.failed === 2);
  ok('nothing asked is nothing sent', (await search([], 5, k.get)).sent === 0);
  const h = fake(() => reply(200, oaList()));
  const empty = await search(['nothing matches this'], 5, h.get);
  ok('an answer with no results is not a failure', empty.failed === 0 && empty.sources.length === 0 && h.calls.length === 1);
}

// ── search: Crossref, one at a time and a second apart ────────────────────
{
  const log = [];
  const f = fake((u) => { log.push(isOA(u) ? 'openalex' : 'crossref'); return isOA(u) ? reply(503, '') : reply(200, crossrefSearch); });
  await search(['a', 'b', 'c'], 5, f.get, { sleep: async (ms) => { log.push(ms > 900 && ms <= 1000 ? 'wait ~1s' : `wait ${ms}`); } });
  ok('each Crossref request after the first waits a second; the first does not',
    same(log, ['openalex', 'crossref', 'openalex', 'wait ~1s', 'crossref', 'openalex', 'wait ~1s', 'crossref']), log);
  ok('never two requests in flight at once', f.most() === 1);
}
{
  const waits = [];
  const f = fake((u) => (isOA(u) ? new Promise((r) => setTimeout(() => r(reply(503, '')), 250)) : reply(200, crossrefSearch)));
  await search(['a', 'b'], 5, f.get, { sleep: async (ms) => { waits.push(ms); } });
  ok('time already spent since the last Crossref request counts toward the second', waits.length === 1 && waits[0] >= 650 && waits[0] <= 760, waits);
}
{
  const f = fake((u) => (isOA(u) ? reply(503, '') : reply(200, crossrefSearch)));
  const t0 = Date.now();
  await search(['a', 'b'], 5, f.get);
  ok('without a sleep given, the real wait is a real second', Date.now() - t0 >= 950, Date.now() - t0);
}

// ── search: stopping ──────────────────────────────────────────────────────
{
  const ac = new AbortController();
  ac.abort();
  const f = fake(() => reply(200, openAlexSearch));
  const e = await failure(search(['a'], 5, f.get, { signal: ac.signal }));
  ok('an aborted signal stops before any request, with its AbortError', e?.name === 'AbortError' && e === ac.signal.reason && f.calls.length === 0);
}
{
  const ac = new AbortController();
  const f = fake(() => { ac.abort(); return new DOMException('This operation was aborted', 'AbortError'); });
  const e = await failure(search(['a', 'b'], 5, f.get, { signal: ac.signal, sleep: noWait }));
  ok('a request stopped in flight throws the AbortError fetch threw', e?.name === 'AbortError' && e.message === 'This operation was aborted');
  ok('and is not taken for a network failure: no Crossref, no next query', f.calls.length === 1);
}
{
  const ac = new AbortController();
  const f = fake(() => { ac.abort(); return new TypeError('Load failed'); });
  const e = await failure(search(['a', 'b'], 5, f.get, { signal: ac.signal, sleep: noWait }));
  ok('a transport that reports a stop as some other error is still a stop', e?.name === 'AbortError' && f.calls.length === 1);
}
{
  const ac = new AbortController();
  const f = fake((u) => (isOA(u) ? reply(503, '') : reply(200, crossrefSearch)));
  const e = await failure(search(['a', 'b'], 5, f.get, { signal: ac.signal, sleep: async () => { ac.abort(); } }));
  ok('a stop during the wait between Crossref requests ends it there', e?.name === 'AbortError' && f.calls.length === 3);
}
{
  const ac = new AbortController();
  const f = fake(() => reply(200, openAlexSearch));
  const e = await failure(search(['a', 'b', 'c'], 5, f.get, { signal: ac.signal, onFound: () => ac.abort() }));
  ok('a stop between queries sends nothing more', e?.name === 'AbortError' && f.calls.length === 1);
}
{
  const ac = new AbortController();
  ac.abort('the researcher pressed stop');
  const e = await failure(search(['a'], 5, fake(() => reply(200, oaList())).get, { signal: ac.signal }));
  ok('a reason that is not an error still ends as an AbortError', e?.name === 'AbortError' && e instanceof Error);
}
{
  const ac = new AbortController();
  const f = fake((u) => {
    if (!isOA(u)) setTimeout(() => ac.abort(), 30);
    return isOA(u) ? reply(503, '') : reply(200, crossrefSearch);
  });
  const t0 = Date.now();
  const e = await failure(search(['a', 'b'], 5, f.get, { signal: ac.signal }));
  ok('the real wait ends as soon as the stop comes, not a second later', e?.name === 'AbortError' && Date.now() - t0 < 500 && f.calls.length === 3, Date.now() - t0);
}

// ── search: which records, in what order ──────────────────────────────────
{
  const lists = { a: [oaWork('A0'), oaWork('A1'), oaWork('A2')], b: [oaWork('B0'), oaWork('B1'), oaWork('B2')] };
  const f = fake((u) => reply(200, oaList(...lists[queryOf(u)])));
  const r = await search(['a', 'b'], 6, f.get);
  ok('each query\'s best comes before any query\'s next best',
    same(r.sources.map((s) => s.title), ['Work A0', 'Work B0', 'Work A1', 'Work B1', 'Work A2', 'Work B2']));
  const seen = [];
  const g = fake((u) => reply(200, oaList(...lists[queryOf(u)])));
  const capped = await search(['a', 'b'], 4, g.get, { onFound: (n) => seen.push(n) });
  ok('at most want, keyed s1…', same(capped.sources.map((s) => s.key), ['s1', 's2', 's3', 's4']));
  ok('onFound counts what there is so far, never past want', same(seen, [3, 4]));
}
{
  const works = [
    oaWork('NOABS', { abstract_inverted_index: null }),
    oaWork('NOAUTH', { authorships: [] }),
    oaWork('NEITHER', { authorships: [], abstract_inverted_index: null }),
    oaWork('GOOD'),
  ];
  const r = await search(['a'], 4, fake(() => reply(200, oaList(...works))).get);
  ok('authors and an abstract first, then authors alone, then an abstract alone, then neither',
    same(r.sources.map((s) => s.title), ['Work GOOD', 'Work NOABS', 'Work NOAUTH', 'Work NEITHER']));
}
{
  const r1 = await search(['a'], 2, fake(() => reply(200, oaList(oaWork('P0'), oaWork('P1', { cited_by_count: 10000 })))).get);
  ok('ten thousand citations lift a work two places', same(r1.sources.map((s) => s.title), ['Work P1', 'Work P0']));
  const q = [oaWork('Q0'), oaWork('Q1'), oaWork('Q2'), oaWork('Q3', { cited_by_count: 1000 })];
  const r2 = await search(['a'], 4, fake(() => reply(200, oaList(...q))).get);
  ok('a thousand, a place and a half', same(r2.sources.map((s) => s.title), ['Work Q0', 'Work Q1', 'Work Q3', 'Work Q2']));
  const many = Array.from({ length: 11 }, (_, i) => oaWork(`R${i}`, i === 10 ? { cited_by_count: 1_000_000 } : {}));
  const r3 = await search(['a'], 11, fake(() => reply(200, oaList(...many))).get);
  ok('a million citations lift a work three places, not to the top', r3.sources.findIndex((s) => s.title === 'Work R10') === 7);
}
{
  const reordered = { ...openAlexSearch, results: [openAlexSearch.results[3], ...openAlexSearch.results.slice(0, 3)] };
  const r = await search(['a'], 4, fake(() => reply(200, reordered)).get);
  ok('a real result without an abstract goes behind those with one, though OpenAlex ranked it first',
    r.sources[3].doi === '10.1007/s10639-022-10925-9' && r.sources.slice(0, 3).every((s) => s.abstract));
}
{
  const f = fake((u) => (queryOf(u) === 'q2' && isOA(u) ? reply(503, '') : isOA(u) ? reply(200, openAlexSearch) : reply(200, crossrefWork)));
  const r = await search(['q1', 'q2'], 10, f.get, { sleep: noWait });
  const hits = r.sources.filter((s) => s.doi === '10.1186/s41239-019-0171-0');
  ok('a work both indexes found is one record', hits.length === 1 && r.sources.length === 4);
  ok('the one found first stays when the other is no richer', hits[0].origin === 'openalex');
}
{
  const f = fake((u) => (isOA(u) ? reply(503, '') : reply(200, crossrefSearch)));
  const r = await search(['q'], 20, f.get, { sleep: noWait });
  const pair = r.sources.filter((s) => s.title.startsWith('Artificial Intelligence and Human Society'));
  ok('a real title-and-year pair (an article with no author and its preprint) is one record', pair.length === 1);
  ok('the richer record is kept whole — its own DOI and its own authors, never a mix',
    pair[0].doi === '10.36227/techrxiv.24313456' && same(pair[0].authors.map((a) => a.family), ['Das', 'Das']) && pair[0].type === 'other');
  ok('the "other" item stays out of a search', !r.sources.some((s) => s.doi === '10.5040/9798216420286_ch2'));
}
{
  const x = oaWork('X');
  const f = fake((u) => reply(200, oaList(queryOf(u) === 'a' ? x : { ...x, is_retracted: true })));
  const r = await search(['a', 'b'], 5, f.get);
  ok('either copy of a work saying it was retracted is enough', r.sources.length === 1 && r.sources[0].retracted === true && r.sources[0].use === false);
  const g = fake(() => reply(200, oaList(oaWork('K'), oaWork('L', { is_retracted: true }), oaWork('M', { type: 'paratext' }), oaWork('N', { title: null, display_name: null }))));
  const kept = await search(['a'], 5, g.get);
  ok('a retracted work is kept in the list, switched off; junk and untitled are not', same(kept.sources.map((s) => [s.title, s.use]), [['Work K', true], ['Work L', false]]));
}

// ── lookupDoi ─────────────────────────────────────────────────────────────
{
  const f = fake(() => reply(200, openAlexWork));
  const s = await lookupDoi('https://doi.org/10.1186/S41239-019-0171-0', f.get);
  ok('OpenAlex is asked first, by the cleaned DOI, for the same fields', same(f.urls(), [`https://api.openalex.org/works/doi:10.1186/s41239-019-0171-0?select=${OA_SELECT}`]));
  ok('its record comes back verified', s?.verified === true && s.origin === 'openalex' && s.doi === '10.1186/s41239-019-0171-0' && s.title.startsWith('Systematic review') && s.key === '');
  ok('with no init and no headers', f.calls.every((c) => c.length === 2 && c[1] === undefined));
}
{
  const f = fake((u) => (isOA(u) ? reply(404, { error: 'NotFound' }) : reply(200, crossrefWork)));
  const s = await lookupDoi('DOI 10.1186/s41239-019-0171-0', f.get);
  ok('Crossref when OpenAlex has never heard of it', f.urls()[1] === 'https://api.crossref.org/works/10.1186/s41239-019-0171-0' && s?.origin === 'crossref' && s.verified === true);
  ok('with what a full Crossref record adds', s.lang === 'en' && s.cited === 6031);
}
{
  const f = fake((u) => (isOA(u) ? reply(404, { error: 'NotFound' }) : reply(404, 'Resource not found.')));
  ok('neither knows it: null — the 404 Crossref gives a DOI nobody registered', (await lookupDoi('10.9999/definitely-not-real-vylo-123', f.get)) === null && f.calls.length === 2);
  const g = fake(() => reply(200, openAlexWork));
  ok('not a DOI: null, and nothing is asked', (await lookupDoi('hello', g.get)) === null && (await lookupDoi('', g.get)) === null && g.calls.length === 0);
}
{
  const f = fake((u) => (isOA(u) ? reply(429, openAlex429, { 'retry-after': '30' }) : reply(404, 'Resource not found.')));
  ok('OpenAlex refusing and Crossref not knowing is not "no such work": it throws', (await failure(lookupDoi('10.48550/arxiv.2301.00001', f.get))) instanceof Error);
  const g = fake((u) => (isOA(u) ? reply(404, {}) : new TypeError('Load failed')));
  ok('nor is Crossref being unreachable', (await failure(lookupDoi('10.1000/xyz', g.get))) instanceof Error);
  const h = fake((u) => (isOA(u) ? new TypeError('Load failed') : reply(200, crossrefWork)));
  ok('OpenAlex down, Crossref up: Crossref\'s record', (await lookupDoi('10.1186/s41239-019-0171-0', h.get))?.origin === 'crossref');
}
{
  const f = fake(() => reply(404, {}));
  await lookupDoi('10.1002/(SICI)1097-4571(199806)49:8<693::AID-ASI3>3.0.CO;2-O', f.get);
  ok('a DOI with <, :, ; is escaped in the path, its slash is not',
    f.urls()[0].startsWith('https://api.openalex.org/works/doi:10.1002/(sici)1097-4571(199806)49%3A8%3C693%3A%3Aaid-asi3%3E3.0.co%3B2-o?select=')
    && f.urls()[1] === 'https://api.crossref.org/works/10.1002/(sici)1097-4571(199806)49%3A8%3C693%3A%3Aaid-asi3%3E3.0.co%3B2-o');
  const g = fake(() => reply(404, {}));
  await lookupDoi('10.1016/0004-3702(87)90086-5', g.get);
  ok('brackets in a DOI go as they are', g.urls()[1] === 'https://api.crossref.org/works/10.1016/0004-3702(87)90086-5');
}
{
  const f = fake(() => reply(200, { ...openAlexWork, type: 'erratum' }));
  ok('a DOI somebody typed is looked up whatever kind of work it is', (await lookupDoi('10.1186/s41239-019-0171-0', f.get))?.title.startsWith('Systematic review'));
  const g = fake(() => reply(200, { ...openAlexWork, is_retracted: true }));
  const s = await lookupDoi('10.1186/s41239-019-0171-0', g.get);
  ok('a retracted one is returned, switched off', s?.retracted === true && s.use === false && s.verified === true);
  const ac = new AbortController();
  ac.abort();
  const h = fake(() => reply(200, openAlexWork));
  const e = await failure(lookupDoi('10.1186/s41239-019-0171-0', h.get, ac.signal));
  ok('a stopped lookup throws its AbortError and asks nothing', e?.name === 'AbortError' && h.calls.length === 0);
}

// ── every request this file made ──────────────────────────────────────────
ok('every request went to OpenAlex or Crossref, over https', everyCall.every(([u]) => /^https:\/\/api\.(openalex|crossref)\.org\/works[/?]/.test(u)));
ok('no request carried an address or an init object', everyCall.every((c) => !/mailto|@/.test(c[0]) && c.length === 2 && (c[1] === undefined || c[1] instanceof AbortSignal)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
