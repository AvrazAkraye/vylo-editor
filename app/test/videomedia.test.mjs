// Video pictures: openly licensed images found in Openverse and Wikimedia Commons.
//
// What matters: only pictures whose licence allows a (possibly commercial)
// derivative are ever offered — CC0, the Public Domain Mark, CC BY, CC BY-SA —
// each with the credit line its licence asks for; the searches are few and
// polite (one per scene, a second index only when the first had nothing, no
// headers, a time limit, a stop that stops); and one scene's failure never
// fails the rest. The fixtures are real answers measured from this machine and
// cut down to a few items; requests go to a fake `Get` that records every call,
// and the canvas step is a fake `encode`, so nothing here touches a socket or
// needs a browser.
import {
  cleanQuery, commonsArtist, commonsLicense, commonsUrl, creditsOf, fetchPicture, fillPictures,
  fromCommons, fromOpenverse, needsPictures, openverseLicense, openverseUrl, picturesOf, picturesToTry, portrays, rank,
  scaledSize, searchPictures, stripHtml, wikimediaSized, withPicturesOf,
} from '../.test-build/videomedia.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = (v) => JSON.parse(JSON.stringify(v));

// ── fixtures (real responses, trimmed) ────────────────────────────────────

// Openverse, q=clinic doctor, license=cc0,pdm,by,by-sa, aspect_ratio=wide, page_size=5: three
// of five results, fields cut to the ones read. (Headers: access-control-allow-origin: *,
// x-ratelimit-limit-anon_burst: 20/min, x-ratelimit-limit-anon_sustained: 200/day.) The second
// one is StockSnap, whose CDN sends no CORS header — the reason stocksnap is now excluded.
const ovClinic = {"result_count": 240, "page_size": 5, "results": [{"id": "992bfa1d-4e70-4bd2-9937-473fef5ffa49", "title": "A waiting room at a medical healthcare clinic, doctor's office, hospital", "foreign_landing_url": "https://commons.wikimedia.org/w/index.php?curid=149293632", "url": "https://upload.wikimedia.org/wikipedia/commons/f/f9/A_waiting_room_at_a_medical_healthcare_clinic%2C_doctor%27s_office%2C_hospital.jpg", "creator": "Harrison Keely", "license": "by", "license_version": "4.0", "provider": "wikimedia", "source": "wikimedia", "filetype": "jpg", "mature": false, "height": 4284, "width": 5712, "thumbnail": "https://api.openverse.org/v1/images/992bfa1d-4e70-4bd2-9937-473fef5ffa49/thumb/", "unstable__sensitivity": []}, {"id": "dab1d2b0-961a-4b5b-9d6e-c7cb27fb3c22", "title": "Clinic Doctor", "foreign_landing_url": "https://stocksnap.io/photo/clinic-doctor-6C4YTOELUE", "url": "https://cdn.stocksnap.io/img-thumbs/960w/6C4YTOELUE.jpg", "creator": "Mali Maeder", "license": "cc0", "license_version": "1.0", "provider": "stocksnap", "source": "stocksnap", "filetype": "jpg", "mature": false, "height": 2848, "width": 4288, "thumbnail": "https://api.openverse.org/v1/images/dab1d2b0-961a-4b5b-9d6e-c7cb27fb3c22/thumb/", "unstable__sensitivity": []}, {"id": "f8965e06-6a2a-4909-b288-8e4ad2892516", "title": "HK SKD 西貢 Sai Kung 萬年街 Man Nin Street 方逸華普通科門診診所 Mona Fong General Out-patient Clinic doctor room n waiting zone February 2025 R12S 01", "foreign_landing_url": "https://commons.wikimedia.org/w/index.php?curid=160801099", "url": "https://upload.wikimedia.org/wikipedia/commons/d/d8/HK_SKD_%E8%A5%BF%E8%B2%A2_Sai_Kung_%E8%90%AC%E5%B9%B4%E8%A1%97_Man_Nin_Street_%E6%96%B9%E9%80%B8%E8%8F%AF%E6%99%AE%E9%80%9A%E7%A7%91%E9%96%80%E8%A8%BA%E8%A8%BA%E6%89%80_Mona_Fong_General_Out-patient_Clinic_doctor_room_n_waiting_zone_February_2025_R12S_01.jpg", "creator": "Ha Lunm Yutmncsoe", "license": "cc0", "license_version": "1.0", "provider": "wikimedia", "source": "wikimedia", "filetype": "jpg", "mature": false, "height": 3000, "width": 4000, "thumbnail": "https://api.openverse.org/v1/images/f8965e06-6a2a-4909-b288-8e4ad2892516/thumb/", "unstable__sensitivity": []}]};

// Openverse, q=coffee, aspect_ratio=wide, excluded_source=…: four Flickr results. Flickr is most
// of Openverse, and its `url` is the 1024-pixel "_b" size; live.staticflickr.com sends
// access-control-allow-origin: *.
const ovCoffee = {"result_count": 240, "page_size": 8, "results": [{"id": "d199fcb5-c343-42bf-82a1-3b4b6f82c653", "title": "Cup of coffee", "foreign_landing_url": "https://www.flickr.com/photos/47140246@N02/4325230234", "url": "https://live.staticflickr.com/4070/4325230234_f0919ae3d2_b.jpg", "creator": "Etenil", "license": "by-sa", "license_version": "2.0", "provider": "flickr", "source": "flickr", "filetype": null, "mature": false, "height": 768, "width": 1024, "thumbnail": "https://api.openverse.org/v1/images/d199fcb5-c343-42bf-82a1-3b4b6f82c653/thumb/", "unstable__sensitivity": []}, {"id": "979c56e3-9b99-4700-b0b4-2c8736c98a51", "title": "Coffee", "foreign_landing_url": "https://www.flickr.com/photos/24532534@N02/7063153929", "url": "https://live.staticflickr.com/7218/7063153929_bdae84f157_b.jpg", "creator": "moonlightbulb", "license": "by", "license_version": "2.0", "provider": "flickr", "source": "flickr", "filetype": null, "mature": false, "height": 768, "width": 1024, "thumbnail": "https://api.openverse.org/v1/images/979c56e3-9b99-4700-b0b4-2c8736c98a51/thumb/", "unstable__sensitivity": []}, {"id": "df53bcdb-83ee-4dd2-b0d2-83bf1a2e8c33", "title": "First Cup of Montreal Coffee", "foreign_landing_url": "https://www.flickr.com/photos/37996646802@N01/6592801993", "url": "https://live.staticflickr.com/7017/6592801993_36c65593ff_b.jpg", "creator": "cogdogblog", "license": "by", "license_version": "2.0", "provider": "flickr", "source": "flickr", "filetype": null, "mature": false, "height": 768, "width": 1024, "thumbnail": "https://api.openverse.org/v1/images/df53bcdb-83ee-4dd2-b0d2-83bf1a2e8c33/thumb/", "unstable__sensitivity": []}, {"id": "1dc95f22-7a2e-498b-9c6c-d41685bc29ed", "title": "Lunchtime coffee", "foreign_landing_url": "https://www.flickr.com/photos/89365565@N00/2878022071", "url": "https://live.staticflickr.com/3263/2878022071_267af0ca96_b.jpg", "creator": "Lplatebigcheese", "license": "by", "license_version": "2.0", "provider": "flickr", "source": "flickr", "filetype": null, "mature": false, "height": 683, "width": 1024, "thumbnail": "https://api.openverse.org/v1/images/1dc95f22-7a2e-498b-9c6c-d41685bc29ed/thumb/", "unstable__sensitivity": []}]};

// Commons, exactly commonsUrl('hospital', 10): four of ten pages (formatversion=2 returns them in
// no particular order; `index` is the search's rank). One Artist carries the uploader's address,
// one file is 850 pixels wide. (Headers: access-control-allow-origin: *.)
const wmHospital = {"batchcomplete": true, "continue": {"gsroffset": 10, "continue": "gsroffset||"}, "query": {"pages": [{"pageid": 121371, "ns": 6, "title": "File:Hospital room ubt.jpeg", "index": 3, "imageinfo": [{"size": 372133, "width": 1600, "height": 1200, "thumburl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/57/Hospital_room_ubt.jpeg/330px-Hospital_room_ubt.jpeg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail", "thumbwidth": 330, "thumbheight": 248, "url": "https://upload.wikimedia.org/wikipedia/commons/5/57/Hospital_room_ubt.jpeg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original", "descriptionurl": "https://commons.wikimedia.org/wiki/File:Hospital_room_ubt.jpeg", "extmetadata": {"ObjectName": {"value": "Hospital room ubt"}, "Artist": {"value": "<b><a href=\"//commons.wikimedia.org/wiki/User:Tsca\" title=\"User:Tsca\">Tomasz Sienicki</a></b> <span style=\"color:grey\"><i>[user: <a href=\"//commons.wikimedia.org/wiki/User:Tsca\" title=\"User:Tsca\">tsca</a>, mail: tomasz.sienicki at gmail.com]</i></span>"}, "LicenseShortName": {"value": "Public domain"}, "UsageTerms": {"value": "Public domain"}, "License": {"value": "pd"}}, "mime": "image/jpeg"}]}, {"pageid": 20047569, "ns": 6, "title": "File:Hospital-de-Bellvitge.jpg", "index": 4, "imageinfo": [{"size": 590457, "width": 850, "height": 592, "thumburl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/88/Hospital-de-Bellvitge.jpg/330px-Hospital-de-Bellvitge.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail", "thumbwidth": 330, "thumbheight": 230, "url": "https://upload.wikimedia.org/wikipedia/commons/8/88/Hospital-de-Bellvitge.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original", "descriptionurl": "https://commons.wikimedia.org/wiki/File:Hospital-de-Bellvitge.jpg", "extmetadata": {"ObjectName": {"value": "Hospital-de-Bellvitge"}, "Artist": {"value": "<a href=\"//commons.wikimedia.org/w/index.php?title=User:H501zalc&amp;action=edit&amp;redlink=1\" class=\"new\" title=\"User:H501zalc (page does not exist)\">H501zalc</a>"}, "LicenseShortName": {"value": "CC BY-SA 3.0"}, "UsageTerms": {"value": "Creative Commons Attribution-Share Alike 3.0"}, "License": {"value": "cc-by-sa-3.0"}}, "mime": "image/jpeg"}]}, {"pageid": 71785024, "ns": 6, "title": "File:Doctors Hospital from the Southwest 1.jpg", "index": 1, "imageinfo": [{"size": 8715300, "width": 6016, "height": 2999, "thumburl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b8/Doctors_Hospital_from_the_Southwest_1.jpg/330px-Doctors_Hospital_from_the_Southwest_1.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail", "thumbwidth": 330, "thumbheight": 165, "url": "https://upload.wikimedia.org/wikipedia/commons/b/b8/Doctors_Hospital_from_the_Southwest_1.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original", "descriptionurl": "https://commons.wikimedia.org/wiki/File:Doctors_Hospital_from_the_Southwest_1.jpg", "extmetadata": {"ObjectName": {"value": "Doctors Hospital from the Southwest 1"}, "Artist": {"value": "<a href=\"//commons.wikimedia.org/wiki/User:Sixflashphoto\" title=\"User:Sixflashphoto\">Sixflashphoto</a>"}, "LicenseShortName": {"value": "CC BY-SA 4.0"}, "UsageTerms": {"value": "Creative Commons Attribution-Share Alike 4.0"}, "License": {"value": "cc-by-sa-4.0"}}, "mime": "image/jpeg"}]}, {"pageid": 131111389, "ns": 6, "title": "File:Moore Regional Hospital facility in Pinehurst.jpg", "index": 5, "imageinfo": [{"size": 2467748, "width": 3008, "height": 2000, "thumburl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e1/Moore_Regional_Hospital_facility_in_Pinehurst.jpg/330px-Moore_Regional_Hospital_facility_in_Pinehurst.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail", "thumbwidth": 330, "thumbheight": 219, "url": "https://upload.wikimedia.org/wikipedia/commons/e/e1/Moore_Regional_Hospital_facility_in_Pinehurst.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original", "descriptionurl": "https://commons.wikimedia.org/wiki/File:Moore_Regional_Hospital_facility_in_Pinehurst.jpg", "extmetadata": {"ObjectName": {"value": "Moore Regional Hospital facility in Pinehurst"}, "Artist": {"value": "Donald Lee Pardue"}, "LicenseShortName": {"value": "CC BY 2.0"}, "UsageTerms": {"value": "Creative Commons Attribution 2.0"}, "License": {"value": "cc-by-2.0"}}, "mime": "image/jpeg"}]}]}};

// Commons, "old map": a real Artist wrapped in <bdi><a><span title=…>, and one in a <div class="fn">.
const wmMapArtists = [
  "<bdi><a href=\"https://en.wikipedia.org/wiki/en:Gerard_van_Schagen\" class=\"extiw\" title=\"w:en:Gerard van Schagen\"><span title=\"Dutch cartographer\">Gerard van Schagen</span></a></bdi>",
  "<div class=\"fn value\">\n<a rel=\"nofollow\" class=\"external text\" href=\"https://www.flickr.com/people/31575009@N05\">The National Archives UK</a></div>",
];

// Openverse's answers measured while recording: page_size over 20, and a thumbnail it could not render.
const ovPageTooBig = {"detail": "page_size may not exceed 20 for anonymous requests"};

// ── a fake transport ──────────────────────────────────────────────────────

/** A response shaped the way `fetch` shapes one, for the fields the module reads. */
const reply = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  json: async () => (typeof body === 'string' ? JSON.parse(body) : clone(body)),
  blob: async () => (body instanceof Blob ? body : new Blob([typeof body === 'string' ? body : JSON.stringify(body)], { type: headers['content-type'] ?? '' })),
});
const jpeg = (bytes = 'JPEGBYTES') => reply(200, new Blob([bytes], { type: 'image/jpeg' }), { 'content-type': 'image/jpeg' });

const everyCall = [];

/** A `Get` that records its arguments and answers with `route(url, signal)` (a reply, or an Error to reject with). */
function fake(route) {
  const calls = [];
  const get = async (...args) => {
    calls.push(args);
    everyCall.push(args);
    await new Promise((r) => setTimeout(r, 1));
    const out = await route(args[0], args[1]);
    if (out instanceof Error) throw out;
    return out;
  };
  return { get, calls, urls: () => calls.map((c) => c[0]) };
}

/** The canvas step, faked: records what it was given and answers with a tiny data: URL. */
function fakeEncode() {
  const seen = [];
  const encode = async (blob, maxSide) => {
    seen.push({ size: blob.size, type: blob.type, maxSide, text: await blob.text() });
    return { src: 'data:image/jpeg;base64,/9j/AA==', width: 1920, height: 1080 };
  };
  return { encode, seen };
}

const isOV = (u) => u.startsWith('https://api.openverse.org/v1/images/?');
const isWM = (u) => u.startsWith('https://commons.wikimedia.org/w/api.php?');
const failure = async (p) => { try { await p; return null; } catch (e) { return e; } };

// ── URLs ──────────────────────────────────────────────────────────────────
const EXCL = 'stocksnap,geographorguk,svgsilh,sketchfab,thingiverse';
ok('an Openverse search asks for reusable licences, no mature results, the frame shape',
  openverseUrl('clinic doctor', 12, 'landscape')
    === `https://api.openverse.org/v1/images/?q=clinic%20doctor&license=cc0,pdm,by,by-sa&page_size=12&mature=false&excluded_source=${EXCL}&aspect_ratio=wide`);
ok('portrait asks for tall pictures, square for any shape',
  openverseUrl('x', 5, 'portrait').endsWith('&aspect_ratio=tall') && !openverseUrl('x', 5, 'square').includes('aspect_ratio') && !openverseUrl('x', 5).includes('aspect_ratio'));
ok('the page is never bigger than the anonymous limit of 20 (a 400 otherwise: ' + ovPageTooBig.detail + ')',
  openverseUrl('x', 50).includes('page_size=20&') && openverseUrl('x', 0).includes('page_size=1&') && openverseUrl('x', NaN).includes('page_size=1&'));
ok('a Commons search is the File namespace, bitmaps only, with origin=* and licence metadata',
  commonsUrl('clinic doctor', 10)
    === 'https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2&origin=*&generator=search&gsrnamespace=6&gsrsearch=clinic%20doctor%20filetype%3Abitmap&gsrlimit=10&prop=imageinfo&iiprop=url%7Csize%7Cmime%7Cextmetadata&iiurlwidth=330&iiextmetadatafilter=ObjectName%7CArtist%7CLicenseShortName%7CLicense%7CUsageTerms');
ok('a query cannot add parameters of its own', openverseUrl('a&page_size=200#x', 5).startsWith('https://api.openverse.org/v1/images/?q=a%20page%20size%20200%20x&license='));

// ── query hygiene ─────────────────────────────────────────────────────────
ok('quotes, operators and punctuation go', cleanQuery('  "doctor"  +clinic -- (waiting room)!  ') === 'doctor clinic waiting room');
ok('inner hyphens stay', cleanQuery('high-tech lab') === 'high-tech lab');
ok('markup goes', cleanQuery('<b>city</b> skyline') === 'city skyline');
ok('at most eight words', cleanQuery('a b c d e f g h i j') === 'a b c d e f g h');
ok('at most 60 characters, cut between words', (() => { const q = cleanQuery('photograph '.repeat(10)); return q.length <= 60 && !q.endsWith(' ') && q.split(' ').every((w) => w === 'photograph'); })());
ok('nothing usable is an empty query', cleanQuery('  "" !! ') === '' && cleanQuery(undefined) === '' && cleanQuery(42) === '');
ok('non-Latin letters survive (the search decides what they find)', cleanQuery('عيادة طبيب') === 'عيادة طبيب');

// ── licences ──────────────────────────────────────────────────────────────
ok('Openverse: CC0, PDM, CC BY, CC BY-SA are named with their version',
  same(['cc0', 'pdm', 'by', 'by-sa'].map((c) => openverseLicense(c, '4.0')), ['CC0 4.0', 'Public Domain Mark 4.0', 'CC BY 4.0', 'CC BY-SA 4.0']));
ok('Openverse: NC, ND, sampling and anything unknown are refused',
  ['by-nc', 'by-nd', 'by-nc-sa', 'by-nc-nd', 'sampling+', 'nc-sampling+', '', null, 'BY-NC'].every((c) => openverseLicense(c, '2.0') === null));
ok('Openverse: a strange version is left out, not shown', openverseLicense('by', '<b>9</b>') === 'CC BY');
ok('Commons: public domain, CC0, CC BY and CC BY-SA pass, shown as Commons names them',
  commonsLicense('pd', 'Public domain') === 'Public domain' && commonsLicense('cc0', 'CC0') === 'CC0'
  && commonsLicense('cc-by-2.0', 'CC BY 2.0') === 'CC BY 2.0' && commonsLicense('cc-by-sa-3.0-de', 'CC BY-SA 3.0 de') === 'CC BY-SA 3.0 de');
ok('Commons: NC, ND, GFDL-only, "attribution", "copyrighted free use" and nothing are refused',
  commonsLicense('cc-by-nc-2.0', 'CC BY-NC 2.0') === null && commonsLicense('cc-by-nd-4.0', 'CC BY-ND 4.0') === null
  && commonsLicense('gfdl', 'GFDL') === null && commonsLicense('attribution', 'Attribution') === null
  && commonsLicense('', 'Copyrighted free use') === null && commonsLicense('', '') === null
  && commonsLicense('cc-by-sa-4.0', 'CC BY-NC-SA 4.0') === null);
ok('Commons: a code with an odd short name is named from the code', commonsLicense('cc-by-sa-4.0', '<span>whatever</span>') === 'CC BY-SA 4.0');

// ── parsing ───────────────────────────────────────────────────────────────
{
  const c = fromOpenverse(ovClinic);
  ok('Openverse: every reusable result becomes a candidate', c.length === 3);
  ok('Openverse: the credit is "Title — Creator, LICENSE (where)"',
    c[0].credit === "A waiting room at a medical healthcare clinic, doctor's office, hospital — Harrison Keely, CC BY 4.0 (Wikimedia Commons via Openverse)", c[0].credit);
  ok('Openverse: the source is the landing page, the url the image, the thumb Openverse\'s proxy',
    c[0].source === 'https://commons.wikimedia.org/w/index.php?curid=149293632' && c[0].url.startsWith('https://upload.wikimedia.org/')
    && c[0].thumb === 'https://api.openverse.org/v1/images/992bfa1d-4e70-4bd2-9937-473fef5ffa49/thumb/');
  ok('Openverse: size and licence are kept', c[0].width === 5712 && c[0].height === 4284 && c[1].license === 'CC0 1.0');
  ok('Openverse: a long title is capped', c[2].title.length <= 100 && c[2].title.endsWith('…'));
  const f = fromOpenverse(ovCoffee);
  ok('Openverse: Flickr is named', f[0].credit === 'Cup of coffee — Etenil, CC BY-SA 2.0 (Flickr via Openverse)', f[0].credit);
  const r = ovCoffee.results[0];
  const bad = fromOpenverse({ results: [
    { ...r, license: 'by-nc' }, { ...r, license: 'by-nd' }, { ...r, mature: true },
    { ...r, unstable__sensitivity: ['user_reported_sensitive'] }, { ...r, url: 'http://live.staticflickr.com/x.jpg' },
    { ...r, url: 'https://example.org/a.svg' }, { ...r, filetype: 'svg' }, { ...r, title: 'Nude study' },
    { ...r, url: '' }, null, 'x',
  ] });
  ok('Openverse: NC, ND, mature, sensitive, insecure, SVG, unsafe titles and junk are dropped', bad.length === 0, bad);
  const bare = fromOpenverse({ results: [{ ...r, title: '', creator: '', thumbnail: null, foreign_landing_url: null }] })[0];
  ok('Openverse: a missing title, creator, thumbnail or page still gives a whole credit',
    bare.credit === 'Untitled, CC BY-SA 2.0 (Flickr via Openverse)' && bare.thumb === r.url && bare.source === r.url, bare);
  ok('Openverse: not an answer is no candidates', fromOpenverse(null).length === 0 && fromOpenverse({ detail: 'x' }).length === 0);
}
{
  const c = fromCommons(wmHospital);
  ok('Commons: the search\'s own order, by index', same(c.map((x) => x.title), ['Doctors Hospital from the Southwest 1', 'Hospital room ubt', 'Hospital-de-Bellvitge', 'Moore Regional Hospital facility in Pinehurst']));
  ok('Commons: the credit names the artist, not the HTML around the name',
    c[0].credit === 'Doctors Hospital from the Southwest 1 — Sixflashphoto, CC BY-SA 4.0 (Wikimedia Commons)', c[0].credit);
  ok('Commons: an uploader\'s address never reaches the credits',
    c[1].credit === 'Hospital room ubt — Tomasz Sienicki, Public domain (Wikimedia Commons)', c[1].credit);
  ok('Commons: the original without the tracking query, the 330px thumb, the file page',
    c[0].url === 'https://upload.wikimedia.org/wikipedia/commons/b/b8/Doctors_Hospital_from_the_Southwest_1.jpg'
    && c[0].thumb === 'https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b8/Doctors_Hospital_from_the_Southwest_1.jpg/330px-Doctors_Hospital_from_the_Southwest_1.jpg'
    && c[0].source === 'https://commons.wikimedia.org/wiki/File:Doctors_Hospital_from_the_Southwest_1.jpg');
  const p = wmHospital.query.pages[0];
  const withInfo = (over, meta = {}) => ({ ...p, imageinfo: [{ ...p.imageinfo[0], ...over, extmetadata: { ...p.imageinfo[0].extmetadata, ...meta } }] });
  const bad = fromCommons({ query: { pages: [
    withInfo({}, { License: { value: 'cc-by-nc-sa-2.0' }, LicenseShortName: { value: 'CC BY-NC-SA 2.0' } }),
    withInfo({}, { License: { value: 'gfdl' }, LicenseShortName: { value: 'GFDL' } }),
    withInfo({ mime: 'image/svg+xml' }), withInfo({ mime: 'image/tiff' }), withInfo({ mime: 'application/pdf' }),
    withInfo({}, { ObjectName: { value: 'Naked mole rat' } }), { ...p, imageinfo: [] }, { title: 'File:x' },
  ] } });
  ok('Commons: NC, GFDL, SVG, TIFF, PDF, unsafe titles and pages without info are dropped', bad.length === 0, bad);
  ok('Commons: the old keyed shape of `pages` is read too', fromCommons({ query: { pages: { a: p } } }).length === 1);
  ok('Commons: not an answer is no candidates', fromCommons(null).length === 0 && fromCommons({ error: {} }).length === 0);
}
ok('Artist HTML is text', same(wmMapArtists.map(commonsArtist), ['Gerard van Schagen', 'The National Archives UK']));
ok('entities are decoded', stripHtml('Tom &amp; Jerry &#39;s &#x263A; &lt;b&gt;') === "Tom & Jerry 's ☺ b");
ok('an Artist of just an "Original:" label is the name after it', commonsArtist('<p><b>Original: </b> <a href="x">Yoghya</a></p>') === 'Yoghya');

// ── sizes ─────────────────────────────────────────────────────────────────
const WAIT = 'https://upload.wikimedia.org/wikipedia/commons/f/f9/A_waiting_room_at_a_medical_healthcare_clinic%2C_doctor%27s_office%2C_hospital.jpg';
ok('a big Commons original is fetched as its 1920px thumbnail',
  wikimediaSized(WAIT, 5712, 4284, 1920) === 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f9/A_waiting_room_at_a_medical_healthcare_clinic%2C_doctor%27s_office%2C_hospital.jpg/1920px-A_waiting_room_at_a_medical_healthcare_clinic%2C_doctor%27s_office%2C_hospital.jpg');
ok('only widths Wikimedia renders (1080px- is a 400, measured): 1080 asks for 1280',
  wikimediaSized(WAIT, 5712, 4284, 1080).includes('/1280px-'));
ok('a tall picture asks for the width that gives the long edge', wikimediaSized(WAIT, 3000, 4000, 1920).includes('/1920px-') && wikimediaSized(WAIT, 3000, 4000, 1280).includes('/960px-'));
ok('an original already small enough is fetched as it is', wikimediaSized(WAIT, 1600, 1200, 1920) === null);
ok('not a Commons original, not a bitmap, or no size: left alone',
  wikimediaSized('https://live.staticflickr.com/1/2_b.jpg', 4000, 3000, 1920) === null
  && wikimediaSized('https://upload.wikimedia.org/wikipedia/commons/a/ab/Map.tif', 4000, 3000, 1920) === null
  && wikimediaSized(WAIT, undefined, 3000, 1920) === null);
ok('drawn size: the long edge at most maxSide, never enlarged',
  same(scaledSize(5712, 4284, 1920), { width: 1920, height: 1440 }) && same(scaledSize(3000, 4000, 1920), { width: 1440, height: 1920 })
  && same(scaledSize(1024, 768, 1920), { width: 1024, height: 768 }));
{
  const [w] = fromOpenverse(ovClinic);
  const tries = picturesToTry(w, 1920);
  ok('what fetchPicture tries: the sized thumbnail, the original, Openverse\'s thumbnail',
    tries.length === 3 && tries[0].includes('/thumb/f/f9/') && tries[0].includes('/1920px-') && tries[1] === w.url && tries[2] === w.thumb);
  const [f] = fromOpenverse(ovCoffee);
  ok('a Flickr picture is tried as it is, then the thumbnail', same(picturesToTry(f, 1920), [f.url, f.thumb]));
}

// ── ranking ───────────────────────────────────────────────────────────────
{
  const mk = (id, w, h, host = 'live.staticflickr.com') => ({ thumb: '', url: `https://${host}/${id}.jpg`, title: id, credit: id, source: id, license: 'CC BY 2.0', width: w, height: h });
  const r = rank([mk('small', 640, 480), mk('big', 1600, 1200), mk('tall', 1080, 1920), mk('wide', 1920, 1080)], 'landscape').map((c) => c.title);
  ok('landscape: small ones last, the right shape first, relevance otherwise', same(r, ['big', 'wide', 'tall', 'small']), r);
  const p = rank([mk('wide', 1920, 1080), mk('tall', 1080, 1920)], 'portrait').map((c) => c.title);
  ok('portrait: a tall picture before a wide one', same(p, ['tall', 'wide']), p);
  const h = rank([mk('met', 3000, 2000, 'images.metmuseum.org'), mk('flickr', 1024, 683)], 'landscape').map((c) => c.title);
  ok('a host whose bytes may not be readable gives up places', same(h, ['flickr', 'met']), h);
  const s = rank([mk('a', 800, 600), mk('b', 900, 600)], 'landscape').map((c) => c.title);
  ok('when everything is small, relevance still decides', same(s, ['a', 'b']));
}

// ── searchPictures ────────────────────────────────────────────────────────
{
  const f = fake((u) => (isOV(u) ? reply(200, ovCoffee) : reply(200, wmHospital)));
  const c = await searchPictures('"coffee"', { format: 'landscape', get: f.get });
  ok('Openverse answered with usable pictures: one request, Commons not asked', f.calls.length === 1 && isOV(f.urls()[0]) && c.length === 4);
  ok('the query was cleaned and the frame shape asked for', f.urls()[0].includes('?q=coffee&') && f.urls()[0].includes('aspect_ratio=wide'));
  ok('the page is small (count + 4, at least 8)', f.urls()[0].includes('page_size=16&'));
}
{
  const r = ovCoffee.results;
  const series = { results: [r[0], { ...r[1], title: 'Cup of coffee 2' }, { ...r[2], title: 'Cup of Coffee' }, r[3]] };
  const f = fake(() => reply(200, series));
  const c = await searchPictures('coffee', { get: f.get });
  ok('a series sharing one title does not fill the grid: repeats go last', same(c.map((x) => x.title), ['Cup of coffee', 'Lunchtime coffee', 'Cup of coffee 2', 'Cup of Coffee']), c.map((x) => x.title));
}
{
  const f = fake((u) => (isOV(u) ? reply(200, ovCoffee) : reply(200, wmHospital)));
  const c = await searchPictures('coffee', { count: 2, get: f.get });
  ok('count is respected', c.length === 2 && f.urls()[0].includes('page_size=8&'));
}
{
  const small = { results: ovCoffee.results.map((r) => ({ ...r, width: 500, height: 375 })) };
  const f = fake((u) => (isOV(u) ? reply(200, small) : reply(200, wmHospital)));
  const c = await searchPictures('hospital', { format: 'landscape', get: f.get });
  ok('only small pictures on Openverse: Commons is asked too', f.calls.length === 2 && isWM(f.urls()[1]));
  ok('and its big pictures come before the small ones', c[0].credit.endsWith('(Wikimedia Commons)') && c.slice(-4).every((x) => x.width === 500) && c.findIndex((x) => x.title === 'Hospital-de-Bellvitge') > 2);
}
{
  const f = fake((u) => (isOV(u) ? reply(429, { detail: 'Request was throttled.' }, { 'retry-after': '60' }) : reply(200, wmHospital)));
  const c = await searchPictures('hospital', { get: f.get });
  ok('Openverse refuses (429): Commons answers instead', c.length === 4 && f.calls.length === 2 && c[0].title === 'Doctors Hospital from the Southwest 1');
}
{
  const f = fake((u) => (isOV(u) ? new TypeError('Load failed') : reply(200, { batchcomplete: true })));
  const c = await searchPictures('hospital', { get: f.get });
  ok('Openverse unreachable, Commons finds nothing: an empty list, not an error', Array.isArray(c) && c.length === 0);
}
{
  const f = fake(() => new TypeError('Load failed'));
  const e = await failure(searchPictures('hospital', { get: f.get }));
  ok('neither index answers: an error the panel can show', e instanceof Error && e.name !== 'AbortError' && f.calls.length === 2);
}
{
  const f = fake(() => reply(200, ovCoffee));
  const c = await searchPictures(' "" ', { get: f.get });
  ok('an empty query asks nothing', c.length === 0 && f.calls.length === 0);
}
{
  const ac = new AbortController();
  ac.abort();
  const f = fake(() => reply(200, ovCoffee));
  const e = await failure(searchPictures('coffee', { get: f.get, signal: ac.signal }));
  ok('stopped before it starts: AbortError, nothing asked', e?.name === 'AbortError' && f.calls.length === 0);
}
{
  const ac = new AbortController();
  const f = fake((u, s) => new Promise((_, reject) => s.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); })));
  const p = failure(searchPictures('coffee', { get: f.get, signal: ac.signal }));
  setTimeout(() => ac.abort(), 5);
  const e = await p;
  ok('stopped in flight: AbortError, the request\'s signal aborted, Commons not asked', e?.name === 'AbortError' && f.calls.length === 1 && f.calls[0][1].aborted);
}
{
  const f = fake((u) => (isOV(u) ? new Promise(() => {}) : reply(200, wmHospital)));
  const t0 = Date.now();
  const c = await searchPictures('hospital', { get: f.get, timeout: 20 });
  ok('a slow Openverse is given up on and Commons asked', c.length === 4 && Date.now() - t0 < 1000 && f.calls[0][1].aborted);
}

// ── fetchPicture ──────────────────────────────────────────────────────────
{
  const [w] = fromOpenverse(ovClinic);
  const f = fake(() => jpeg('BIG'));
  const enc = fakeEncode();
  const pic = await fetchPicture(w, ' "clinic"  doctor ', { get: f.get, encode: enc.encode });
  ok('the 1920px thumbnail is fetched, nothing else', f.calls.length === 1 && f.urls()[0].includes('/1920px-'));
  ok('the bytes go to the canvas step with maxSide 1920', enc.seen.length === 1 && enc.seen[0].maxSide === 1920 && enc.seen[0].text === 'BIG');
  ok('the picture carries its credit, landing page, cleaned query and drawn size',
    same(pic, { src: 'data:image/jpeg;base64,/9j/AA==', credit: w.credit, source: w.source, query: 'clinic doctor', width: 1920, height: 1080 }), pic);
  const g = fake(() => jpeg());
  await fetchPicture(w, 'x', { get: g.get, encode: fakeEncode().encode, maxSide: 1080 });
  ok('a smaller maxSide asks for a smaller rendition', g.urls()[0].includes('/1280px-'));
}
{
  const [w] = fromOpenverse(ovClinic);
  const f = fake((u) => (u.includes('/1920px-') ? reply(404, 'nope', { 'content-type': 'text/html' })
    : u === w.url ? reply(200, '<html>', { 'content-type': 'text/html' }) : jpeg('THUMB')));
  const enc = fakeEncode();
  const pic = await fetchPicture(w, 'clinic', { get: f.get, encode: enc.encode });
  ok('a 404, then an HTML page instead of an image, then the thumbnail as the last resort',
    same(f.urls(), picturesToTry(w, 1920)) && enc.seen.length === 1 && enc.seen[0].text === 'THUMB' && pic.credit === w.credit);
}
{
  const [f0] = fromOpenverse(ovCoffee);
  const f = fake(() => new TypeError('Load failed'));
  const e = await failure(fetchPicture(f0, 'coffee', { get: f.get, encode: fakeEncode().encode }));
  ok('no URL gives a picture (a CORS refusal looks like this): an Error, not an abort', e instanceof Error && e.name !== 'AbortError' && f.calls.length === 2);
}
{
  const [f0] = fromOpenverse(ovCoffee);
  const f = fake(() => jpeg());
  const e = await failure(fetchPicture(f0, 'coffee', { get: f.get, encode: async () => { throw new Error('InvalidStateError: decode'); } }));
  ok('bytes that do not decode are a failure too, and every URL is tried', e instanceof Error && f.calls.length === 2);
  const g = fake(() => jpeg());
  const e2 = await failure(fetchPicture(f0, 'coffee', { get: g.get, encode: async () => ({ src: 'javascript:alert(1)', width: 1, height: 1 }) }));
  ok('only a data:image URL is ever handed back', e2 instanceof Error);
  const h = fake(() => reply(200, new Blob(['x'], { type: 'image/jpeg' }), { 'content-type': 'image/jpeg', 'content-length': String(50 * 1024 * 1024) }));
  const e3 = await failure(fetchPicture(f0, 'coffee', { get: h.get, encode: fakeEncode().encode }));
  ok('a response too big to decode is skipped', e3 instanceof Error);
}
{
  const [f0] = fromOpenverse(ovCoffee);
  const ac = new AbortController();
  const f = fake((u, s) => new Promise((_, reject) => s.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); })));
  const p = failure(fetchPicture(f0, 'coffee', { get: f.get, signal: ac.signal, encode: fakeEncode().encode }));
  setTimeout(() => ac.abort(), 5);
  const e = await p;
  ok('stopped while fetching: AbortError, no fallback asked', e?.name === 'AbortError' && f.calls.length === 1);
}
{
  const [f0] = fromOpenverse(ovCoffee);
  const f = fake((u) => (u === f0.url ? new Promise(() => {}) : jpeg('THUMB')));
  const enc = fakeEncode();
  await fetchPicture(f0, 'coffee', { get: f.get, encode: enc.encode, timeout: 20 });
  ok('a slow image is given up on and the next URL tried', f.calls.length === 2 && enc.seen[0].text === 'THUMB');
}

// ── fillPictures ──────────────────────────────────────────────────────────
const scene = (id, kind, over = {}) => ({ id, kind, seconds: 4, transition: 'fade', ...over });
{
  const scenes = [
    scene('s1', 'title', { title: 'Clinic' }),
    scene('s2', 'image', { imageQuery: 'coffee' }),
    scene('s3', 'split', { heading: 'h', text: 't', imageQuery: ' "Coffee" ' }),
    scene('s4', 'image', { imageQuery: 'hospital' }),
    scene('s5', 'kinetic', { text: 'x' }),
    scene('s6', 'image', { imageQuery: 'coffee', picture: { src: 'data:image/jpeg;base64,AA', credit: 'Cup of coffee — Etenil, CC BY-SA 2.0 (Flickr via Openverse)', source: 'https://www.flickr.com/photos/47140246@N02/4325230234', query: 'coffee' } }),
    scene('s7', 'outro', { headline: 'Bye' }),
  ];
  const before = clone(scenes);
  const f = fake((u) => {
    if (isOV(u) && u.includes('q=coffee')) return reply(200, ovCoffee);
    if (isOV(u)) return reply(503, 'down');
    if (isWM(u)) return new TypeError('Load failed');
    return jpeg(u);
  });
  const enc = fakeEncode();
  const reported = [];
  const out = await fillPictures(scenes, { format: 'landscape', get: f.get, encode: enc.encode, onScene: (i, s) => reported.push([i, s]) });
  const searches = f.urls().filter((u) => isOV(u) || isWM(u));
  ok('one search per distinct query: "coffee" once for two scenes, "hospital" on both indexes', searches.length === 3 && searches.filter((u) => u.includes('q=coffee')).length === 1, searches);
  ok('scenes without a query, or with a picture already, are left alone and not reported',
    out[0] === scenes[0] && out[4] === scenes[4] && out[5] === scenes[5] && out[6] === scenes[6] && same(reported.map((r) => r[0]), [1, 2, 3]));
  ok('a picture already in the film is not used again, and two scenes never share one',
    out[1].picture.source === 'https://www.flickr.com/photos/24532534@N02/7063153929'
    && out[2].picture.source === 'https://www.flickr.com/photos/37996646802@N01/6592801993');
  ok('each picture keeps the query it was found with', out[1].picture.query === 'coffee' && out[2].picture.query === 'Coffee');
  ok('a scene whose search failed is reported unchanged, and the others still got theirs', reported[2][1] === scenes[3] && out[3] === scenes[3] && !out[3].picture);
  ok('the input list is not changed', same(scenes, before) && out !== scenes);
  ok('the credits: one line per picture, in scene order, each once',
    same(creditsOf(out), ['Coffee — moonlightbulb, CC BY 2.0 (Flickr via Openverse)', 'First Cup of Montreal Coffee — cogdogblog, CC BY 2.0 (Flickr via Openverse)', 'Cup of coffee — Etenil, CC BY-SA 2.0 (Flickr via Openverse)']), creditsOf(out));
}
{
  const scenes = [scene('a', 'image', { imageQuery: 'coffee' })];
  const f = fake((u) => (isOV(u) ? reply(200, ovCoffee) : new TypeError('Load failed')));
  const reported = [];
  const out = await fillPictures(scenes, { get: f.get, encode: fakeEncode().encode, onScene: (i, s) => reported.push(i) });
  const fetches = f.urls().filter((u) => !isOV(u));
  ok('when no picture fetches, three candidates are tried (both URLs each), then the scene is left', !out[0].picture && fetches.length === 6 && same(reported, [0]));
}
{
  const scenes = [scene('a', 'image', { imageQuery: 'coffee' }), scene('b', 'image', { imageQuery: 'hospital' })];
  const f = fake((u) => (isOV(u) ? reply(200, ovCoffee) : jpeg()));
  const out = await fillPictures(scenes, { get: f.get, encode: fakeEncode().encode, onScene: () => { throw new Error('panel bug'); } });
  ok('an onScene that throws does not stop the others', !!out[0].picture && !!out[1].picture);
}
{
  const ac = new AbortController();
  const scenes = [scene('a', 'image', { imageQuery: 'coffee' }), scene('b', 'image', { imageQuery: 'hospital' })];
  const f = fake((u) => (isOV(u) ? reply(200, ovCoffee) : jpeg()));
  const reported = [];
  const e = await failure(fillPictures(scenes, { get: f.get, encode: fakeEncode().encode, signal: ac.signal, onScene: (i) => { reported.push(i); ac.abort(); } }));
  ok('stopped: an AbortError, the scene reported before it kept, nothing asked after', e?.name === 'AbortError' && same(reported, [0]) && !f.urls().some((u) => u.includes('hospital')));
}
ok('creditsOf ignores scenes without a picture and bad input', same(creditsOf([scene('a', 'title'), { picture: { credit: '  ' } }]), []) && same(creditsOf(null), []));

// ── galleries and people ──────────────────────────────────────────────────
// Openverse, q=Daniel Bliss (2026-09-25): four of eight results. Not one is a portrait of him: a
// homestead named after a Daniel Bliss, and three army photographs that matched on other words.
const ovBliss = {"result_count":116,"page_size":8,"results":[{"id":"326062e3-4b76-46f8-a493-5242c8cb50bf","title":"Daniel Bliss Homestead, Rehoboth MA","foreign_landing_url":"https://commons.wikimedia.org/w/index.php?curid=23566860","url":"https://upload.wikimedia.org/wikipedia/commons/0/0c/Daniel_Bliss_Homestead%2C_Rehoboth_MA.jpg","creator":"John Phelan","license":"by-sa","license_version":"3.0","provider":"wikimedia","source":"wikimedia","filetype":"jpg","mature":false,"height":2448,"width":3264,"thumbnail":"https://api.openverse.org/v1/images/326062e3-4b76-46f8-a493-5242c8cb50bf/thumb/","unstable__sensitivity":[]},{"id":"d9119690-bc1a-4ca8-a3c4-c242062b81ce","title":"U.S. Patriots augment Turkish air defense","foreign_landing_url":"https://www.flickr.com/photos/37585279@N03/15642408367","url":"https://live.staticflickr.com/5605/15642408367_1fce098507_b.jpg","creator":"U.S. Army Europe","license":"pdm","license_version":"1.0","provider":"flickr","source":"flickr","filetype":null,"mature":false,"height":623,"width":1024,"thumbnail":"https://api.openverse.org/v1/images/d9119690-bc1a-4ca8-a3c4-c242062b81ce/thumb/","unstable__sensitivity":[]},{"id":"2b7208ab-6797-4de1-b406-cfd4cab4df52","title":"180326-A-ED846-007","foreign_landing_url":"https://www.flickr.com/photos/133821783@N02/41036042981","url":"https://live.staticflickr.com/901/41036042981_00531269b2_b.jpg","creator":"NCOLCoE Archive Photos","license":"pdm","license_version":"1.0","provider":"flickr","source":"flickr","filetype":null,"mature":false,"height":682,"width":1024,"thumbnail":"https://api.openverse.org/v1/images/2b7208ab-6797-4de1-b406-cfd4cab4df52/thumb/","unstable__sensitivity":[]},{"id":"30de815b-9fb1-4a3a-a567-e3a110ce0b6b","title":"Art_Untitled.","foreign_landing_url":"https://www.flickr.com/photos/35980642@N05/14669707592","url":"https://live.staticflickr.com/5581/14669707592_4260df9c29_b.jpg","creator":"Carl Nenzén Lovén","license":"by","license_version":"2.0","provider":"flickr","source":"flickr","filetype":null,"mature":false,"height":1024,"width":683,"thumbnail":"https://api.openverse.org/v1/images/30de815b-9fb1-4a3a-a567-e3a110ce0b6b/thumb/","unstable__sensitivity":[]}]};
{
  const pic = (t) => ({ src: 'data:image/jpeg;base64,AA', credit: `${t} — X, CC0 (Wikimedia Commons)`, source: `https://commons.wikimedia.org/wiki/File:${t}`, query: t });
  ok('needsPictures: a gallery short of its searches, a person with a search and no portrait, a one-picture scene',
    needsPictures(scene('g', 'gallery', { imageQueries: ['coffee', 'tea'], pictures: [pic('a')] }))
    && !needsPictures(scene('g', 'gallery', { imageQueries: ['coffee'], pictures: [pic('a')] }))
    && needsPictures(scene('p', 'people', { heading: 'h', people: [{ name: 'A', imageQuery: 'A B' }] }))
    && !needsPictures(scene('p', 'people', { heading: 'h', people: [{ name: 'A' }] }))
    && needsPictures(scene('i', 'image', { imageQuery: 'x' })) && !needsPictures(scene('k', 'kinetic', { text: 'x' })) && !needsPictures(null));
  ok('picturesOf and creditsOf count a gallery\'s and each person\'s pictures, in order, once',
    same(picturesOf(scene('g', 'gallery', { pictures: [pic('a'), pic('b')] })).map((p) => p.query), ['a', 'b'])
    && same(creditsOf([scene('t', 'title', { picture: pic('t') }), scene('g', 'gallery', { pictures: [pic('a'), pic('t')] }), scene('p', 'people', { heading: 'h', people: [{ name: 'n', picture: pic('p') }, { name: 'm' }] })]),
      ['t — X, CC0 (Wikimedia Commons)', 'a — X, CC0 (Wikimedia Commons)', 'p — X, CC0 (Wikimedia Commons)']));
  ok('portrays: every word of the name in the title, titles like "Dr" aside, and not a place named after them',
    portrays('Rev. Daniel Bliss', 'Dr. Daniel Bliss') && portrays('Masrour Barzani meets the Prime Minister', 'Masrour Barzani')
    && !portrays('Daniel Bliss Homestead, Rehoboth MA', 'Daniel Bliss') && !portrays('U.S. Patriots augment Turkish air defense', 'Daniel Bliss') && !portrays('Daniel Smith', 'Daniel Bliss') && !portrays('anything', ''));
}
{
  const scenes = [scene('g', 'gallery', { heading: 'Mornings', imageQueries: ['coffee', 'coffee', 'hospital'] })];
  const f = fake((u) => (isOV(u) && u.includes('q=coffee') ? reply(200, ovCoffee) : isOV(u) ? reply(200, { results: [] }) : isWM(u) ? reply(200, wmHospital) : jpeg(u)));
  const reported = [];
  const out = await fillPictures(scenes, { get: f.get, encode: fakeEncode().encode, onScene: (i, s) => reported.push([i, s.pictures?.length]) });
  ok('a gallery gets one picture per search, a shared search searched once, no picture twice', out[0].pictures.length === 3 && new Set(out[0].pictures.map((p) => p.source)).size === 3
    && f.urls().filter((u) => isOV(u) && u.includes('q=coffee')).length === 1 && same(reported, [[0, 3]]));
  const two = [scene('g', 'gallery', { imageQueries: ['coffee', 'coffee', 'coffee'], pictures: [{ src: 'data:image/jpeg;base64,AA', credit: 'c', source: 'https://www.flickr.com/photos/47140246@N02/4325230234', query: 'q' }, { src: 'data:image/jpeg;base64,AB', credit: 'd', source: 'https://example.org/d', query: 'q' }] })];
  const f2 = fake((u) => (isOV(u) ? reply(200, ovCoffee) : jpeg(u)));
  const out2 = await fillPictures(two, { get: f2.get, encode: fakeEncode().encode });
  ok('a gallery that already holds two pictures searches only for its third, and not the one it has', out2[0].pictures.length === 3 && !out2[0].pictures.slice(2).some((p) => p.source === 'https://www.flickr.com/photos/47140246@N02/4325230234'));
}
{
  const scenes = [scene('p', 'people', { heading: 'Founder', people: [{ name: 'دانيال بلس', role: 'المؤسس', imageQuery: 'Daniel Bliss' }, { name: 'Nobody' }] })];
  const f = fake((u) => (isOV(u) ? reply(200, ovBliss) : isWM(u) ? reply(200, { query: { pages: [] } }) : jpeg(u)));
  const out = await fillPictures(scenes, { get: f.get, encode: fakeEncode().encode });
  ok('a person gets no stranger\'s face: none of the real "Daniel Bliss" results is a portrait of him', !out[0].people[0].picture && f.urls().filter((u) => !isOV(u) && !isWM(u)).length === 0);
  const named = clone(ovBliss);
  named.results[1].title = 'Rev. Daniel Bliss, founder';
  const f2 = fake((u) => (isOV(u) ? reply(200, named) : jpeg(u)));
  const out2 = await fillPictures(scenes, { get: f2.get, encode: fakeEncode().encode });
  ok('…and gets the one whose title names him', out2[0].people[0].picture?.credit.startsWith('Rev. Daniel Bliss, founder') && !out2[0].people[1].picture);
}
{
  const p = (id) => ({ src: `data:image/jpeg;base64,${id}`, credit: id, source: `https://x/${id}`, query: id });
  const cur = scene('g', 'gallery', { heading: 'edited', pictures: [p('a')] });
  const found = scene('g', 'gallery', { heading: 'old', pictures: [p('a'), p('b')] });
  ok('withPicturesOf: a gallery edited meanwhile keeps its edit and gains the new picture', same(withPicturesOf(cur, found), { ...cur, pictures: [p('a'), p('b')] }));
  const people = scene('p', 'people', { heading: 'h', people: [{ name: 'Renamed' }, { name: 'Same' }] });
  const got = scene('p', 'people', { heading: 'h', people: [{ name: 'Old name', picture: p('x') }, { name: 'Same', picture: p('y') }] });
  ok('…a person gains a portrait only while still named the same', same(withPicturesOf(people, got).people, [{ name: 'Renamed' }, { name: 'Same', picture: p('y') }]));
  const one = scene('i', 'image', { caption: 'mine', imageQuery: 'q' });
  ok('…a one-picture scene gains its picture; another scene\'s is never taken', same(withPicturesOf(one, { ...one, caption: 'old', picture: p('z') }), { ...one, picture: p('z') }) && withPicturesOf(one, scene('other', 'image', { picture: p('z') })) === one);
}

// ── every request this file made ──────────────────────────────────────────
ok('every search went to Openverse or Commons over https', everyCall.filter(([u]) => /api\.openverse|commons\.wikimedia/.test(u) && !u.includes('/thumb/')).every(([u]) => isOV(u) || isWM(u)));
ok('no request carried an init object (so no header, no preflight)', everyCall.every((c) => c.length === 2 && (c[1] === undefined || c[1] instanceof AbortSignal)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
