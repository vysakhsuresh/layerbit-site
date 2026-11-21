/* Layerbit time zone engine (UMD: window.LBTz / module.exports).
   Converts wall-clock times between IANA time zones using the time zone
   database built into the browser (Intl), detects daylight-saving gaps and
   overlaps, finds zones by city, country or abbreviation, and parses short
   phrases such as "3pm IST to EST". Pure functions, no DOM. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LBTz = factory();
})(this, function () {
  'use strict';
  var HOUR = 3600000, DAY = 86400000;
  var FMT = {};
  function fmt(zone) {
    if (!FMT[zone]) FMT[zone] = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
    return FMT[zone];
  }

  /** True if the runtime knows this IANA zone name. */
  function isZone(z) {
    if (!z) return false;
    try { new Intl.DateTimeFormat('en-US', { timeZone: z }); return true; } catch (e) { return false; }
  }

  /** Wall-clock fields of instant `ms` in `zone`. */
  function parts(ms, zone) {
    var o = {};
    fmt(zone).formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; });
    return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second, wd: o.weekday };
  }

  /** UTC offset of `zone` at instant `ms`, in minutes east of UTC. */
  function offset(ms, zone) {
    var p = parts(ms, zone);
    var whole = Math.floor(ms / 1000) * 1000;
    return Math.round((Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - whole) / 60000);
  }

  /** The instant at which `zone` shows y-mo-d h:mi. A time skipped by a
   *  daylight-saving jump does not exist: it is moved forward by the jump and
   *  reported as status 'gap'. A time repeated when clocks go back happens
   *  twice: the first occurrence is returned with status 'overlap' and the
   *  second as `later`. */
  function toInstant(y, mo, d, h, mi, zone) {
    var guess = Date.UTC(y, mo - 1, d, h, mi || 0);
    var before = offset(guess - DAY, zone), after = offset(guess + DAY, zone);
    var found = [];
    [before, after].forEach(function (o) {
      var c = guess - o * 60000;
      if (offset(c, zone) === o && found.indexOf(c) < 0) found.push(c);
    });
    found.sort(function (a, b) { return a - b; });
    if (found.length === 2) return { ms: found[0], status: 'overlap', later: found[1] };
    if (found.length === 1) return { ms: found[0], status: 'ok' };
    return { ms: guess - before * 60000, status: 'gap', shift: after - before };
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /** "UTC+5:30", "UTC-5", "UTC" for an offset in minutes. */
  function offsetLabel(min) {
    if (!min) return 'UTC';
    var a = Math.abs(min), h = Math.floor(a / 60), m = a % 60;
    return 'UTC' + (min < 0 ? '-' : '+') + h + (m ? ':' + pad(m) : '');
  }

  /** Signed difference between two offsets as "+1:30", "-9:30", "0". */
  function diffLabel(min) {
    if (!min) return '0';
    var a = Math.abs(min), h = Math.floor(a / 60), m = a % 60;
    return (min < 0 ? '-' : '+') + h + (m ? ':' + pad(m) : '');
  }

  // Zones whose usual abbreviation Intl does not give in English (it shows
  // "GMT+4" for Dubai, for example).
  var FIXED_ABBR = {
    'Asia/Dubai': 'GST', 'Asia/Muscat': 'GST', 'Asia/Kolkata': 'IST', 'Asia/Calcutta': 'IST',
    'Asia/Karachi': 'PKT', 'Asia/Singapore': 'SGT', 'Asia/Kuala_Lumpur': 'MYT', 'Asia/Riyadh': 'AST',
    'Asia/Qatar': 'AST', 'Asia/Kuwait': 'AST', 'Asia/Bahrain': 'AST', 'Asia/Baghdad': 'AST',
    'Asia/Tokyo': 'JST', 'Asia/Seoul': 'KST', 'Asia/Hong_Kong': 'HKT', 'Asia/Kathmandu': 'NPT',
    'Asia/Manila': 'PHT', 'Asia/Jakarta': 'WIB', 'Asia/Bangkok': 'ICT', 'Asia/Ho_Chi_Minh': 'ICT',
    'Asia/Dhaka': 'BST', 'Asia/Colombo': 'SLST', 'Asia/Shanghai': 'CST', 'Asia/Tehran': 'IRST',
    'Africa/Johannesburg': 'SAST', 'Africa/Nairobi': 'EAT', 'Africa/Lagos': 'WAT', 'Europe/Moscow': 'MSK',
    'Europe/Istanbul': 'TRT', 'UTC': 'UTC', 'Etc/UTC': 'UTC', 'Etc/GMT': 'GMT'
  };
  var ABBR_LOCALES = ['en-US', 'en-GB', 'en-AU', 'en-IN', 'en-NZ'];

  /** Common abbreviation for `zone` at instant `ms` ("EDT", "BST", "IST"),
   *  or '' when the zone has none in English. */
  function abbr(ms, zone) {
    if (FIXED_ABBR[zone]) return FIXED_ABBR[zone];
    for (var i = 0; i < ABBR_LOCALES.length; i++) {
      try {
        var p = new Intl.DateTimeFormat(ABBR_LOCALES[i], { timeZone: zone, timeZoneName: 'short' }).formatToParts(new Date(ms));
        for (var j = 0; j < p.length; j++) {
          if (p[j].type === 'timeZoneName' && !/^(GMT|UTC)[+\-−]/.test(p[j].value)) return p[j].value;
        }
      } catch (e) { /* locale unavailable */ }
    }
    return '';
  }

  /** Everything a display needs about instant `ms` in `zone`. */
  function wall(ms, zone) {
    var p = parts(ms, zone), off = offset(ms, zone);
    return {
      y: p.y, mo: p.mo, d: p.d, h: p.h, mi: p.mi, wd: p.wd,
      offset: off, offsetLabel: offsetLabel(off), abbr: abbr(ms, zone),
      date: p.y + '-' + pad(p.mo) + '-' + pad(p.d), time: pad(p.h) + ':' + pad(p.mi),
      dst: isDst(ms, zone, off)
    };
  }

  /** True when `zone` is on summer time at `ms`: its offset is above the
   *  lower of its January and July offsets. */
  function isDst(ms, zone, off) {
    var y = parts(ms, zone).y;
    var jan = offset(Date.UTC(y, 0, 15), zone), jul = offset(Date.UTC(y, 6, 15), zone);
    if (jan === jul) return false;
    return (off == null ? offset(ms, zone) : off) > Math.min(jan, jul);
  }

  /** Whole calendar days from date string a to date string b ("YYYY-MM-DD"). */
  function dayDiff(a, b) {
    var pa = a.split('-'), pb = b.split('-');
    return Math.round((Date.UTC(+pb[0], pb[1] - 1, +pb[2]) - Date.UTC(+pa[0], pa[1] - 1, +pa[2])) / DAY);
  }

  /** 12- or 24-hour clock text for h:mi. */
  function clock(h, mi, h12) {
    if (!h12) return pad(h) + ':' + pad(mi);
    return ((h % 12) || 12) + ':' + pad(mi) + (h < 12 ? ' AM' : ' PM');
  }

  // ---------------------------------------------------------------- zones
  var LABELS = {
    'Asia/Kolkata': 'India', 'Asia/Dubai': 'Dubai, UAE', 'Asia/Riyadh': 'Riyadh, Saudi Arabia', 'Asia/Qatar': 'Doha, Qatar',
    'Asia/Kuwait': 'Kuwait', 'Asia/Bahrain': 'Bahrain', 'Asia/Muscat': 'Muscat, Oman', 'Asia/Karachi': 'Pakistan',
    'Asia/Dhaka': 'Dhaka, Bangladesh', 'Asia/Kathmandu': 'Kathmandu, Nepal', 'Asia/Colombo': 'Colombo, Sri Lanka',
    'Asia/Singapore': 'Singapore', 'Asia/Kuala_Lumpur': 'Kuala Lumpur, Malaysia', 'Asia/Manila': 'Manila, Philippines',
    'Asia/Jakarta': 'Jakarta, Indonesia', 'Asia/Bangkok': 'Bangkok, Thailand', 'Asia/Shanghai': 'China (Beijing, Shanghai)',
    'Asia/Hong_Kong': 'Hong Kong', 'Asia/Tokyo': 'Tokyo, Japan', 'Asia/Seoul': 'Seoul, South Korea',
    'Europe/London': 'London, UK', 'Europe/Dublin': 'Dublin, Ireland', 'Europe/Paris': 'Paris, France', 'Europe/Berlin': 'Berlin, Germany',
    'Europe/Madrid': 'Madrid, Spain', 'Europe/Rome': 'Rome, Italy', 'Europe/Amsterdam': 'Amsterdam, Netherlands',
    'Europe/Zurich': 'Zurich, Switzerland', 'Europe/Istanbul': 'Istanbul, Turkey', 'Europe/Moscow': 'Moscow, Russia',
    'America/New_York': 'New York (US Eastern)', 'America/Chicago': 'Chicago (US Central)', 'America/Denver': 'Denver (US Mountain)',
    'America/Phoenix': 'Phoenix, Arizona', 'America/Los_Angeles': 'Los Angeles (US Pacific)', 'America/Toronto': 'Toronto, Canada',
    'America/Vancouver': 'Vancouver, Canada', 'America/Sao_Paulo': 'São Paulo, Brazil', 'America/Mexico_City': 'Mexico City',
    'Australia/Sydney': 'Sydney, Australia', 'Australia/Melbourne': 'Melbourne, Australia', 'Australia/Brisbane': 'Brisbane, Australia',
    'Australia/Perth': 'Perth, Australia', 'Pacific/Auckland': 'Auckland, New Zealand', 'Africa/Johannesburg': 'Johannesburg, South Africa',
    'Africa/Nairobi': 'Nairobi, Kenya', 'Africa/Lagos': 'Lagos, Nigeria', 'Africa/Cairo': 'Cairo, Egypt',
    'UTC': 'UTC (Coordinated Universal Time)', 'Etc/GMT': 'GMT (Greenwich Mean Time)'
  };

  // Names people type, mapped to the zone they mean. Abbreviations follow the
  // most common reading: IST is India, GST is Gulf, CST is US Central.
  var ALIASES = {};
  function alias(zone, names) { names.split('|').forEach(function (n) { ALIASES[n] = zone; }); }
  alias('Asia/Kolkata', 'ist|india|indian|mumbai|bombay|delhi|new delhi|bangalore|bengaluru|chennai|madras|hyderabad|kolkata|calcutta|pune|kochi|cochin|kerala|ahmedabad|goa|jaipur|noida|gurgaon|gurugram|trivandrum|thiruvananthapuram|lucknow');
  alias('Asia/Dubai', 'gst|gulf|uae|united arab emirates|dubai|abu dhabi|sharjah|ajman|ras al khaimah|fujairah|al ain|umm al quwain|emirates');
  alias('Asia/Muscat', 'oman|muscat');
  alias('Asia/Riyadh', 'ksa|saudi|saudi arabia|riyadh|jeddah|mecca|makkah|medina|madinah|dammam|arabia|arabian|arabia standard');
  alias('Asia/Qatar', 'qatar|doha');
  alias('Asia/Kuwait', 'kuwait');
  alias('Asia/Bahrain', 'bahrain|manama');
  alias('Asia/Karachi', 'pkt|pakistan|karachi|lahore|islamabad');
  alias('Asia/Dhaka', 'bangladesh|dhaka');
  alias('Asia/Kathmandu', 'npt|nepal|kathmandu');
  alias('Asia/Colombo', 'sri lanka|colombo');
  alias('Asia/Singapore', 'sgt|singapore');
  alias('Asia/Kuala_Lumpur', 'myt|malaysia|kuala lumpur');
  alias('Asia/Manila', 'pht|philippines|manila');
  alias('Asia/Jakarta', 'wib|indonesia|jakarta');
  alias('Asia/Bangkok', 'ict|thailand|bangkok');
  alias('Asia/Ho_Chi_Minh', 'vietnam|ho chi minh|saigon|hanoi');
  alias('Asia/Shanghai', 'china|beijing|shanghai|shenzhen');
  alias('Asia/Hong_Kong', 'hkt|hong kong');
  alias('Asia/Tokyo', 'jst|japan|tokyo|osaka');
  alias('Asia/Seoul', 'kst|korea|south korea|seoul');
  alias('Europe/London', 'uk|bst|british|britain|great britain|united kingdom|england|scotland|wales|london|manchester|birmingham|edinburgh');
  alias('Europe/Dublin', 'ireland|dublin');
  alias('Europe/Paris', 'cet|cest|central european|europe|france|paris');
  alias('Europe/Berlin', 'germany|berlin|frankfurt|munich');
  alias('Europe/Madrid', 'spain|madrid|barcelona');
  alias('Europe/Rome', 'italy|rome|milan');
  alias('Europe/Amsterdam', 'netherlands|holland|amsterdam');
  alias('Europe/Zurich', 'switzerland|zurich|geneva');
  alias('Europe/Athens', 'eet|eest|greece|athens');
  alias('Europe/Istanbul', 'trt|turkey|turkiye|istanbul|ankara');
  alias('Europe/Moscow', 'msk|russia|moscow');
  alias('America/New_York', 'est|edt|et|eastern|eastern time|us eastern|usa|us|united states|america|new york|nyc|new york city|washington|washington dc|boston|miami|atlanta|florida|philadelphia|new jersey');
  alias('America/Toronto', 'canada|toronto|ottawa|montreal');
  alias('America/Chicago', 'cst|cdt|ct|central|central time|us central|chicago|texas|dallas|houston|austin');
  alias('America/Denver', 'mst|mdt|mt|mountain|mountain time|us mountain|denver|colorado|utah');
  alias('America/Phoenix', 'arizona|phoenix');
  alias('America/Los_Angeles', 'pst|pdt|pt|pacific|pacific time|us pacific|california|los angeles|la|san francisco|sf|bay area|silicon valley|san jose|seattle|washington state|las vegas');
  alias('America/Vancouver', 'vancouver');
  alias('America/Sao_Paulo', 'brazil|sao paulo|são paulo|rio de janeiro');
  alias('America/Mexico_City', 'mexico|mexico city');
  alias('Australia/Sydney', 'aest|aedt|australia|sydney|canberra');
  alias('Australia/Melbourne', 'melbourne');
  alias('Australia/Brisbane', 'brisbane|queensland');
  alias('Australia/Perth', 'awst|perth');
  alias('Pacific/Auckland', 'nzst|nzdt|new zealand|auckland|wellington');
  alias('Africa/Johannesburg', 'sast|south africa|johannesburg|cape town');
  alias('Africa/Nairobi', 'eat|kenya|nairobi');
  alias('Africa/Lagos', 'wat|nigeria|lagos');
  alias('Africa/Cairo', 'egypt|cairo');
  alias('UTC', 'utc|z|zulu|coordinated universal time');
  alias('Etc/GMT', 'gmt|greenwich|greenwich mean time');

  var FALLBACK = Object.keys(LABELS);
  var MODERN = {
    'Asia/Calcutta': 'Asia/Kolkata', 'Asia/Saigon': 'Asia/Ho_Chi_Minh', 'Asia/Katmandu': 'Asia/Kathmandu',
    'Asia/Rangoon': 'Asia/Yangon', 'Europe/Kiev': 'Europe/Kyiv', 'America/Godthab': 'America/Nuuk',
    'Atlantic/Faeroe': 'Atlantic/Faroe', 'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
    'America/Indianapolis': 'America/Indiana/Indianapolis', 'America/Louisville': 'America/Kentucky/Louisville',
    'Asia/Ulan_Bator': 'Asia/Ulaanbaatar', 'Pacific/Truk': 'Pacific/Chuuk', 'Pacific/Ponape': 'Pacific/Pohnpei'
  };
  var ALL = null;
  /** Every IANA zone the runtime supports (plus UTC and Etc/GMT). */
  function zones() {
    if (ALL) return ALL;
    var list = [];
    try { if (Intl.supportedValuesOf) list = Intl.supportedValuesOf('timeZone').slice(); } catch (e) { /* old engine */ }
    if (!list.length) list = FALLBACK.slice();
    // Chrome and Node list some zones by their old names (Asia/Calcutta);
    // show the current ones, which every engine also accepts.
    var seen = {};
    list = list.map(function (z) { return MODERN[z] && isZone(MODERN[z]) ? MODERN[z] : z; })
      .filter(function (z) { if (seen[z]) return false; seen[z] = 1; return true; });
    ['UTC', 'Etc/GMT'].forEach(function (z) { if (list.indexOf(z) < 0) list.push(z); });
    ALL = list;
    return ALL;
  }

  /** Display name: "India", "Dubai, UAE", or the IANA city ("Buenos Aires"). */
  function label(zone) {
    if (LABELS[zone]) return LABELS[zone];
    var seg = zone.split('/');
    return seg[seg.length - 1].replace(/_/g, ' ');
  }

  function norm(q) {
    return String(q || '').toLowerCase().trim()
      .replace(/[.,]/g, ' ').replace(/\s+/g, ' ')
      .replace(/\s+(standard |daylight |summer )?time( zone)?$/, '')
      .replace(/^time in /, '').trim();
  }

  /** The zone a query means, or null: an alias ("IST", "dubai", "new york
   *  time"), an exact IANA name in any case, or an IANA city ("buenos aires"). */
  function resolve(q) {
    var raw = String(q || '').trim();
    if (!raw) return null;
    var n = norm(raw);
    if (ALIASES[n]) return ALIASES[n];
    if (MODERN[raw] && isZone(MODERN[raw])) return MODERN[raw];
    var list = zones(), i;
    for (i = 0; i < list.length; i++) if (list[i].toLowerCase() === raw.toLowerCase()) return list[i];
    if (raw.indexOf('/') > 0 && isZone(raw)) return raw;
    var city = n.replace(/ /g, '_');
    for (i = 0; i < list.length; i++) {
      var seg = list[i].toLowerCase().split('/');
      if (seg[seg.length - 1] === city) return list[i];
    }
    // "Dubai, UAE" style labels
    for (var z in LABELS) if (norm(LABELS[z]) === n) return z;
    var m = /^(?:utc|gmt)\s*([+\-−])\s*(\d{1,2})(?::?(\d{2}))?$/.exec(n);
    if (m && (!m[3] || m[3] === '00')) {
      var h = +m[2];
      if (h === 0) return 'UTC';
      // Etc/GMT signs are inverted by POSIX convention: UTC+4 is Etc/GMT-4.
      var z2 = 'Etc/GMT' + (m[1] === '+' ? '-' : '+') + h;
      if (isZone(z2)) return z2;
    }
    return null;
  }

  /** Ranked suggestions for a partial query: [{ zone, label }]. */
  function search(q, limit) {
    var n = norm(q), out = [], seen = {};
    limit = limit || 8;
    function add(z) { if (!seen[z] && out.length < limit) { seen[z] = 1; out.push({ zone: z, label: label(z) }); } }
    if (!n) return out;
    var exact = resolve(q);
    if (exact) add(exact);
    Object.keys(ALIASES).forEach(function (k) { if (k.indexOf(n) === 0) add(ALIASES[k]); });
    zones().forEach(function (z) { if (label(z).toLowerCase().indexOf(n) >= 0 || z.toLowerCase().indexOf(n.replace(/ /g, '_')) >= 0) add(z); });
    return out;
  }

  // ---------------------------------------------------------------- phrases
  /** "3pm", "3:30 pm", "15:00", "0930", "noon", "midnight" -> { h, mi }. */
  function parseTime(s) {
    s = String(s || '').trim().toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ');
    if (s === 'noon' || s === 'midday') return { h: 12, mi: 0 };
    if (s === 'midnight') return { h: 0, mi: 0 };
    var m = /^(\d{1,2})(?:[:h]?(\d{2}))?\s*(am|pm|a|p|hrs|hours|h)?$/.exec(s);
    if (!m) return null;
    var h = +m[1], mi = m[2] ? +m[2] : 0, ap = m[3];
    if (mi > 59) return null;
    if (ap === 'am' || ap === 'a' || ap === 'pm' || ap === 'p') {
      if (h < 1 || h > 12) return null;
      if (ap[0] === 'p' && h < 12) h += 12;
      if (ap[0] === 'a' && h === 12) h = 0;
    } else if (h > 23) return null;
    return { h: h, mi: mi };
  }

  var TIME_RE = /^(noon|midday|midnight|\d{1,2}(?:[:h]?\d{2})?\s*(?:[ap]\.?m\.?|[ap]|hrs|hours|h)?)(?:\s+|$)(.*)$/i;

  /** Parses "3pm IST to EST", "9:30 Dubai in London", "IST to PST" or
   *  "now in Tokyo". Returns { time: {h, mi}|null, from: zone|null,
   *  to: zone|null } or { error } naming the part it could not read. */
  function parseQuery(q) {
    var s = String(q || '').trim().replace(/\s+/g, ' ');
    if (!s) return { error: 'Type a time and zones, for example "3pm IST to EST".' };
    var left = s, right = '';
    var m = /^(.*\S)\s+(?:to|in|into|vs|->|→|=)\s+(.+)$/i.exec(s);
    if (m) { left = m[1]; right = m[2]; }
    var time = null, fromText = left;
    if (/^now\b/i.test(left)) { fromText = left.replace(/^now\b\s*/i, ''); }
    else {
      var t = TIME_RE.exec(left);
      if (t && parseTime(t[1])) { time = parseTime(t[1]); fromText = t[2]; }
    }
    var from = fromText ? resolve(fromText) : null;
    if (fromText && !from) return { error: 'Could not find a time zone called "' + fromText + '".' };
    var to = null;
    if (right) { to = resolve(right); if (!to) return { error: 'Could not find a time zone called "' + right + '".' }; }
    if (!time && !from && !to) return { error: 'Could not read a time or a time zone in "' + s + '".' };
    return { time: time, from: from, to: to };
  }

  // ---------------------------------------------------------------- planner
  /** Band of an hour-long slot starting at local h:mi: 'work' when the whole
   *  hour falls between 09:00 and 18:00, 'edge' for the rest of 07:00-22:00,
   *  otherwise 'night'. A slot starting 17:30 runs past 18:00, so it is edge. */
  function band(h, mi) {
    var t = h + mi / 60;
    if (t >= 9 && t + 1 <= 18) return 'work';
    if (t >= 7 && t < 22) return 'edge';
    return 'night';
  }

  /** One row per hour of `date` in `src`, with the local time in each zone:
   *  [{ hour, ms, cells: [{ zone, h, mi, day, band }] , allWork }]. */
  function planner(date, src, list) {
    var p = date.split('-'), rows = [];
    for (var hour = 0; hour < 24; hour++) {
      var r = toInstant(+p[0], +p[1], +p[2], hour, 0, src);
      if (r.status === 'gap') continue;
      var cells = list.map(function (z) {
        var w = wall(r.ms, z);
        return { zone: z, h: w.h, mi: w.mi, day: dayDiff(date, w.date), band: band(w.h, w.mi) };
      });
      rows.push({ hour: hour, ms: r.ms, cells: cells, allWork: cells.every(function (c) { return c.band === 'work'; }) });
    }
    return rows;
  }

  /** Contiguous runs of source hours where every zone is in working hours:
   *  [{ from: hour, to: hourExclusive }]. */
  function overlaps(rows) {
    var out = [], cur = null;
    rows.forEach(function (r) {
      if (r.allWork) { if (cur && cur.to === r.hour) cur.to = r.hour + 1; else { cur = { from: r.hour, to: r.hour + 1 }; out.push(cur); } }
      else cur = null;
    });
    return out;
  }

  return {
    isZone: isZone, parts: parts, offset: offset, toInstant: toInstant, wall: wall, isDst: isDst,
    offsetLabel: offsetLabel, diffLabel: diffLabel, abbr: abbr, dayDiff: dayDiff, clock: clock,
    zones: zones, label: label, resolve: resolve, search: search,
    parseTime: parseTime, parseQuery: parseQuery, band: band, planner: planner, overlaps: overlaps
  };
});
