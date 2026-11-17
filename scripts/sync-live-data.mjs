import fs from 'fs';
import path from 'path';
import vm from 'vm';
import zlib from 'zlib';

async function fetchText(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FuelPh/1.0)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBuffer(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FuelPh/1.0)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, timeoutMs = 12000) {
  return JSON.parse(await fetchText(url, timeoutMs));
}

function normalizePrice(val) {
  if (typeof val !== 'number' || !Number.isFinite(val)) return null;
  if (val < 25 || val > 250) return null;
  return Number(val.toFixed(2));
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(2))
    : Number(sorted[mid].toFixed(2));
}

function percentile(values, pct) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * pct)));
  return Number(sorted[idx].toFixed(2));
}

function extractPdfText(buf) {
  const s = buf.toString('latin1');
  const out = [];
  for (const m of s.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    let raw = Buffer.from(m[1], 'latin1');
    try { raw = zlib.inflateSync(raw); } catch {}
    const txt = raw.toString('latin1');
    for (const tm of txt.matchAll(/\(([^()]*)\)\s*Tj|\[([^\]]+)\]\s*TJ/g)) {
      if (tm[1]) out.push(tm[1]);
      else if (tm[2]) out.push([...tm[2].matchAll(/\(([^()]*)\)/g)].map((x) => x[1]).join(''));
    }
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

async function fetchLiveDoeNcrMonitor() {
  try {
    const html = await fetchText('https://www.doe.gov.ph/data-and-prices/liquid-fuels/retail-pump-prices/ncr-pump-prices');
    const urls = [...new Set([...html.matchAll(/https:\/\/d24qbtp4vooyzi\.cloudfront\.net[^"'<\s\\]+/g)].map((m) => m[0]))];
    const candidates = urls.filter((u) => /NCR/i.test(u) && /\.pdf/i.test(u)).slice(0, 5);
    let newest = null;
    for (const url of candidates) {
      try {
        const text = extractPdfText(await fetchBuffer(url));
        const wm = text.match(/week of\s+([A-Za-z]+)\s+(\d+)\s*(?:-|to)\s*(?:([A-Za-z]+)\s+)?(\d+),?\s*(20\d{2})/i);
        let weekEndIso = '';
        if (wm) {
          const endMonth = wm[3] || wm[1];
          const d = new Date(`${endMonth} ${wm[4]}, ${wm[5]}`);
          if (!Number.isNaN(d.getTime())) weekEndIso = new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
        }
        if (weekEndIso && (!newest || weekEndIso > newest.weekEndIso)) newest = { url, weekEndIso, text };
      } catch {}
    }
    if (!newest) return null;
    const parseProd = (prod) => {
      const commons = []; const mins = []; const maxs = [];
      const re = new RegExp(`\\b${prod}(?!\\s*PLUS)\\s+([\\d.#N/A\\s-]+?)(?=\\b(?:RON|DIESEL|KEROSENE|Date)\\b|$)`, 'g');
      for (const m of newest.text.matchAll(re)) {
        const rm = m[1].match(/(\d+\.\d+)\s*-\s*(\d+\.\d+)\s+(\d+\.\d+|#N\/A)/);
        if (rm) {
          const lo = Number(rm[1]); const hi = Number(rm[2]);
          if (lo >= 25 && hi <= 220 && hi >= lo) {
            mins.push(lo); maxs.push(hi);
            if (rm[3] !== '#N/A') { const c = Number(rm[3]); if (c >= lo && c <= hi) commons.push(c); }
          }
        }
      }
      return {
        min: mins.length ? Number(Math.min(...mins).toFixed(2)) : 0,
        max: maxs.length ? Number(Math.max(...maxs).toFixed(2)) : 0,
        common: commons.length ? median(commons) : 0,
      };
    };
    const r91 = parseProd('RON 91'); const r95 = parseProd('RON 95'); const r97 = parseProd('RON 97');
    const diesel = parseProd('DIESEL'); const kero = parseProd('KEROSENE');
    if (!r91.common || !diesel.common) return null;
    return {
      sourceUrl: newest.url,
      weekEndIso: newest.weekEndIso,
      ron91Common: r91.common, ron91Min: r91.min || r91.common, ron91Max: r91.max || r91.common,
      ron95Common: r95.common || Number((r91.common + 1.2).toFixed(2)), ron95Min: r95.min || r91.min, ron95Max: r95.max || r91.max,
      ron97Common: r97.common || Number((r95.common + 5).toFixed(2)),
      dieselCommon: diesel.common, dieselMin: diesel.min || diesel.common, dieselMax: diesel.max || diesel.common,
      keroseneMin: kero.min || Number((diesel.common + 15).toFixed(2)),
      keroseneMax: kero.max || Number((diesel.common + 45).toFixed(2)),
      keroseneCommon: kero.common || (kero.min && kero.max ? Number(((kero.min + kero.max) / 2).toFixed(2)) : Number((diesel.common + 25).toFixed(2))),
    };
  } catch {
    return null;
  }
}

function canonicalBrandLabel(rawBrand) {
  const b = (rawBrand || '').toLowerCase().trim();
  if (b.includes('petron')) return { brand: 'Petron', tier: 'major' };
  if (b.includes('shell')) return { brand: 'Shell', tier: 'major' };
  if (b.includes('caltex')) return { brand: 'Caltex', tier: 'major' };
  if (b.includes('total')) return { brand: 'TotalEnergies', tier: 'major' };
  if (b.includes('seaoil')) return { brand: 'Seaoil', tier: 'independent' };
  if (b.includes('cleanfuel')) return { brand: 'Cleanfuel', tier: 'independent' };
  if (b.includes('unioil')) return { brand: 'Unioil', tier: 'independent' };
  if (b.includes('phoenix')) return { brand: 'Phoenix', tier: 'independent' };
  if (b.includes('jetti')) return { brand: 'Jetti', tier: 'independent' };
  if (b.includes('flyingv') || b.includes('flying v')) return { brand: 'Flying V', tier: 'independent' };
  if (b.includes('ptt')) return { brand: 'PTT', tier: 'independent' };
  if (b.includes('rephil')) return { brand: 'Rephil', tier: 'independent' };
  if (b.includes('petro gazz') || b.includes('petrogazz')) return { brand: 'Petro Gazz', tier: 'independent' };
  return { brand: rawBrand || 'Local Station', tier: 'independent' };
}

function getManilaCalendar(referenceDate = new Date()) {
  const manilaMs = referenceDate.getTime() + 8 * 60 * 60 * 1000;
  const manila = new Date(manilaMs);
  const day = manila.getUTCDay();
  const hour = manila.getUTCHours();
  const daysUntilTue = (2 - day + 7) % 7;
  const target = new Date(manilaMs + daysUntilTue * 24 * 60 * 60 * 1000);
  const nextResetTue = new Date(manilaMs + (day === 2 && hour >= 6 ? 7 : daysUntilTue === 0 ? 7 : daysUntilTue) * 24 * 60 * 60 * 1000);
  const prevDaysSinceTue = (day - 2 + 7) % 7;
  const mostRecentTuesday = new Date(manilaMs - prevDaysSinceTue * 24 * 60 * 60 * 1000);
  const daysSinceMonday = (day + 6) % 7;
  const currentMondayMs = manilaMs - daysSinceMonday * 24 * 60 * 60 * 1000;
  const priorMondayMs = currentMondayMs - 7 * 24 * 60 * 60 * 1000;
  return {
    manilaDay: day,
    manilaHour: hour,
    targetTuesdayIso: target.toISOString().slice(0, 10),
    nextResetTuesdayIso: nextResetTue.toISOString().slice(0, 10),
    mostRecentTuesdayIso: mostRecentTuesday.toISOString().slice(0, 10),
    currentWeekStartIso: new Date(currentMondayMs).toISOString().slice(0, 10),
    priorWeekStartIso: new Date(priorMondayMs).toISOString().slice(0, 10),
    isEffectiveTuesdayNow: day === 2 && hour >= 6,
  };
}

function decodeHtmlEntities(str) {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function fetchGoogleNewsPhFuel(query) {
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-PH&gl=PH&ceid=PH:en`;
  const xml = await fetchText(rssUrl);
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const title = decodeHtmlEntities(block.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '');
    const link = decodeHtmlEntities(block.match(/<link>([\s\S]*?)<\/link>/)?.[1] || '');
    const pubDate = decodeHtmlEntities(block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || '');
    const description = decodeHtmlEntities(block.match(/<description>([\s\S]*?)<\/description>/)?.[1] || '');
    if (title && link) items.push({ title, link, pubDate, description });
  }
  return items;
}

function inferDirectionSign(localContext, fullText) {
  const downRe = /\b(rollback|rollbacks|roll back|cut|cuts|slash|slashed|decrease|decreasing|down|drop|drops|dropped|fall|falls|fell|reduce|lower|cheaper)\b/i;
  const upRe = /\b(hike|hikes|increase|increases|increasing|up|raise|raised|surge|jump|climb|higher)\b/i;
  if (downRe.test(localContext) && !upRe.test(localContext)) return -1;
  if (upRe.test(localContext) && !downRe.test(localContext)) return 1;
  if (downRe.test(fullText) && !upRe.test(fullText)) return -1;
  if (upRe.test(fullText) && !downRe.test(fullText)) return 1;
  return -1;
}

function extractFuelDeltasFromText(text) {
  const findFuelVal = (fuelPattern) => {
    const patterns = [
      new RegExp(`\\b(${fuelPattern})\\b[a-z\\s,:-]{0,38}?(?:₱|\\bphp|\\bp)\\s*(\\d+(?:\\.\\d+)?)`, 'i'),
      new RegExp(`(?:₱|\\bphp|\\bp)\\s*(\\d+(?:\\.\\d+)?)\\s*(?:per\\s*liter|\\/l|\\s*rollback|\\s*hike|\\s*cut|\\s*increase|\\s*decrease)?[a-z\\s,:-]{0,24}?\\b(${fuelPattern})\\b`, 'i'),
    ];
    for (let i = 0; i < patterns.length; i++) {
      const match = text.match(patterns[i]);
      if (match) {
        const val = Number(i === 0 ? match[2] : match[1]);
        if (Number.isFinite(val) && val > 0 && val < 35) {
          const idx = match.index ?? 0;
          const localWindow = text.slice(Math.max(0, idx - 35), Math.min(text.length, idx + match[0].length + 35));
          return Number((val * inferDirectionSign(localWindow, text)).toFixed(2));
        }
      }
    }
    return undefined;
  };
  return { gas: findFuelVal('gasoline|gas'), diesel: findFuelVal('diesel'), kerosene: findFuelVal('kerosene') };
}

function parseTuesdayWindowDeltas(items, targetTuesdayIso) {
  const targetMs = new Date(`${targetTuesdayIso}T00:00:00+08:00`).getTime();
  const recentWindowItems = items
    .map((item) => ({ ...item, pubMs: item.pubDate ? new Date(item.pubDate).getTime() : 0 }))
    .filter((item) => item.pubMs > 0)
    .sort((a, b) => b.pubMs - a.pubMs);
  const currentCycleItems = recentWindowItems.filter(
    (item) => targetMs - item.pubMs <= 5 * 24 * 60 * 60 * 1000 && item.pubMs <= targetMs + 24 * 3600 * 1000
  );
  let gasDelta; let dieselDelta; let keroDelta; let leadTitle = '';
  for (const item of currentCycleItems) {
    const parsed = extractFuelDeltasFromText(`${item.title}. ${item.description}`);
    if (parsed.gas !== undefined && gasDelta === undefined) gasDelta = parsed.gas;
    if (parsed.diesel !== undefined && dieselDelta === undefined) dieselDelta = parsed.diesel;
    if (parsed.kerosene !== undefined && keroDelta === undefined) keroDelta = parsed.kerosene;
    if (!leadTitle && (parsed.gas !== undefined || parsed.diesel !== undefined)) leadTitle = item.title;
  }
  return { gasDelta, dieselDelta, keroDelta, leadTitle, currentCycleItems, allSortedItems: recentWindowItems };
}

async function fetchYahooSeries(symbol) {
  const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
  let data = null;
  let lastErr = null;
  for (const host of hosts) {
    try {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=3mo`;
      data = await fetchJson(url);
      if (data?.chart?.result?.[0]) break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!data?.chart?.result?.[0]) {
    throw lastErr || new Error(`No Yahoo Finance data for ${symbol}`);
  }
  const result = data.chart.result[0];
  const timestamps = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const history = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (typeof closes[i] === 'number') {
      history.push({ date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10), close: Number(closes[i].toFixed(4)) });
    }
  }
  const latest = typeof result?.meta?.regularMarketPrice === 'number' ? Number(result.meta.regularMarketPrice.toFixed(4)) : history.at(-1)?.close ?? 0;
  const prevClose = typeof result?.meta?.chartPreviousClose === 'number' ? result.meta.chartPreviousClose : history.length >= 2 ? history[history.length - 2].close : latest;
  const weekAgoClose = history.length >= 6 ? history[history.length - 6].close : history[0]?.close ?? latest;
  const changePct = prevClose > 0 ? Number((((latest - prevClose) / prevClose) * 100).toFixed(2)) : 0;
  const weeklyChangePct = weekAgoClose > 0 ? Number((((latest - weekAgoClose) / weekAgoClose) * 100).toFixed(2)) : 0;
  return { latest, changePct, weeklyChangePct, history };
}

const NCR_AREAS = new Set(['makati', 'taguig', 'quezon city', 'muntinlupa', 'parañaque', 'paranaque', 'manila', 'pasig', 'mandaluyong', 'pasay', 'marikina', 'caloocan', 'las piñas', 'las pinas', 'valenzuela', 'san juan', 'malabon', 'pateros', 'navotas']);
const SOUTH_LUZON_AREAS = new Set(['bacoor', 'dasmariñas', 'dasmarinas', 'imus', 'general trias', 'kawit', 'trece martires', 'carmona', 'rosario', 'tanza', 'silang', 'noveleta', 'naic', 'cavite city', 'tagaytay', 'ternate', 'maragondon', 'mendez', 'alfonso', 'amadeo', 'general mariano alvarez', 'indang', 'magallanes', 'general emilio aguinaldo', 'calamba', 'santa rosa', 'biñan', 'binan', 'cabuyao', 'san pedro', 'los baños', 'los banos', 'antipolo', 'cainta', 'taytay', 'batangas city', 'lipa', 'tanauan', 'lucena', 'naga', 'legazpi']);

function classifyGasWatchRegion(area, lat) {
  const norm = (area || '').toLowerCase().trim();
  if (NCR_AREAS.has(norm)) return 'ncr';
  if (SOUTH_LUZON_AREAS.has(norm)) return 'south_luzon';
  if (lat < 9.5) return 'mindanao';
  if (lat < 12.6) return 'visayas';
  if (lat > 14.85) return 'north_luzon';
  return 'south_luzon';
}

async function main() {
  const outDir = path.resolve(process.cwd(), 'public', 'data');
  const fuelFile = path.join(outDir, 'fuel-live.json');
  const stationsFile = path.join(outDir, 'stations-live.json');
  let prevReport = null;
  try {
    if (fs.existsSync(fuelFile)) {
      prevReport = JSON.parse(fs.readFileSync(fuelFile, 'utf8'));
    }
  } catch {}

  const fallbackYahooFromPrev = (hist, price, changePct) => ({
    latest: price || hist?.at(-1)?.close || 0,
    changePct: changePct || 0,
    weeklyChangePct: 0,
    history: Array.isArray(hist) ? hist : [],
  });

  const [fx, brent, wti, rbob, ulsd, dataJs, overridesJs, doeNcr, newsMain, newsPump] = await Promise.all([
    fetchJson('https://open.er-api.com/v6/latest/USD').catch((e) => {
      console.warn('FX fetch warning:', e.message);
      return prevReport?.benchmarks?.usdPhpRate ? { rates: { PHP: prevReport.benchmarks.usdPhpRate } } : null;
    }),
    fetchYahooSeries('BZ=F').catch((e) => {
      console.warn('Brent fetch warning:', e.message);
      return prevReport ? fallbackYahooFromPrev(prevReport.benchmarks?.brentHistory, prevReport.benchmarks?.brentUsd, prevReport.benchmarks?.brentChangePct) : null;
    }),
    fetchYahooSeries('CL=F').catch((e) => {
      console.warn('WTI fetch warning:', e.message);
      return prevReport ? fallbackYahooFromPrev(prevReport.benchmarks?.wtiHistory, prevReport.benchmarks?.wtiUsd, prevReport.benchmarks?.wtiChangePct) : null;
    }),
    fetchYahooSeries('RB=F').catch((e) => {
      console.warn('RBOB fetch warning:', e.message);
      return prevReport?.nextWeekForecast
        ? { latest: prevReport.nextWeekForecast.rbobCurrentAvg, changePct: 0, weeklyChangePct: prevReport.nextWeekForecast.rbobDeltaPct, history: [] }
        : { latest: 2.5, changePct: 0, weeklyChangePct: 0, history: [] };
    }),
    fetchYahooSeries('HO=F').catch((e) => {
      console.warn('ULSD fetch warning:', e.message);
      return prevReport?.nextWeekForecast
        ? { latest: prevReport.nextWeekForecast.ulsdCurrentAvg, changePct: 0, weeklyChangePct: prevReport.nextWeekForecast.ulsdDeltaPct, history: [] }
        : { latest: 4.0, changePct: 0, weeklyChangePct: 0, history: [] };
    }),
    fetchText('https://gaswatchph.com/js/data.js').catch((e) => {
      console.warn('GasWatch fetch warning:', e.message);
      return '';
    }),
    fetchText('https://gaswatchph.com/js/station-overrides.js').catch(() => ''),
    fetchLiveDoeNcrMonitor().catch(() => null),
    fetchGoogleNewsPhFuel('Philippines fuel price rollback OR hike gasoline diesel when:45d').catch(() => []),
    fetchGoogleNewsPhFuel('Philippines DOE Metro Manila pump prices gasoline diesel when:30d').catch(() => []),
  ]);

  if (!dataJs || !brent || !wti) {
    if (fs.existsSync(fuelFile) && fs.existsSync(stationsFile)) {
      console.warn('Upstream feeds partially unavailable in CI; preserving existing synced public/data snapshots.');
      return;
    }
    throw new Error('Required live feeds unavailable and no prior snapshot exists.');
  }

  const sandbox = {};
  vm.runInNewContext(`${dataJs}\n${overridesJs}\n;this.__out = { LAST_UPDATED, PRICE_HISTORY, GAS_STATIONS, STATION_OVERRIDES };`, sandbox, { timeout: 2500 });
  const gw = sandbox.__out;
  const overrides = gw.STATION_OVERRIDES || {};
  const lastUpdatedRaw = String(gw.LAST_UPDATED || '');
  const parsedDate = Date.parse(lastUpdatedRaw);
  const lastUpdatedIso = Number.isFinite(parsedDate) ? new Date(parsedDate + 8 * 60 * 60 * 1000).toISOString().slice(0, 10) : '1970-01-01';

  const stations = (gw.GAS_STATIONS || []).map((st) => {
    const ov = overrides[String(st.id)] || {};
    return {
      ...st,
      prices: {
        diesel: normalizePrice(ov.diesel?.p ?? st.prices?.diesel),
        unleaded: normalizePrice(ov.unleaded?.p ?? st.prices?.unleaded),
        premium95: normalizePrice(ov.premium95?.p ?? st.prices?.premium95),
        premium97: normalizePrice(ov.premium97?.p ?? st.prices?.premium97),
        kerosene: normalizePrice(ov.kerosene?.p ?? st.prices?.kerosene),
      },
    };
  });

  const cal = getManilaCalendar();
  const targetTuesday = cal.targetTuesdayIso;
  const usdPhp = Number((fx?.rates?.PHP || 58.0).toFixed(3));
  const combinedNews = [...newsMain, ...newsPump];
  const { gasDelta, dieselDelta, keroDelta, leadTitle, currentCycleItems, allSortedItems } =
    parseTuesdayWindowDeltas(combinedNews, targetTuesday);

  const hasAdvisory = gasDelta !== undefined || dieselDelta !== undefined;
  const mopsGasDelta = Number((((rbob.latest * (rbob.weeklyChangePct / 100)) / 3.78541) * usdPhp).toFixed(2));
  const mopsDieselDelta = Number((((ulsd.latest * (ulsd.weeklyChangePct / 100)) / 3.78541) * usdPhp).toFixed(2));
  const finalGasDelta = gasDelta ?? mopsGasDelta;
  const finalDieselDelta = dieselDelta ?? mopsDieselDelta;
  const finalKeroDelta = keroDelta ?? Number((finalDieselDelta * 1.15).toFixed(2));

  const calcDeltaForRef = (refIso) => {
    if (cal.isEffectiveTuesdayNow && refIso < targetTuesday && hasAdvisory) {
      return { gas: finalGasDelta, diesel: finalDieselDelta, kero: finalKeroDelta };
    }
    if (cal.manilaDay !== 2 && refIso < cal.mostRecentTuesdayIso) {
      const rec = parseTuesdayWindowDeltas(combinedNews, cal.mostRecentTuesdayIso);
      if (rec.gasDelta !== undefined || rec.dieselDelta !== undefined) {
        return { gas: rec.gasDelta ?? 0, diesel: rec.dieselDelta ?? 0, kero: rec.keroDelta ?? 0 };
      }
    }
    return { gas: 0, diesel: 0, kero: 0 };
  };

  const appliedGw = calcDeltaForRef(lastUpdatedIso);
  const appliedDoe = doeNcr ? calcDeltaForRef(doeNcr.weekEndIso) : { gas: 0, diesel: 0, kero: 0 };

  const ncrStations = stations.filter((s) => classifyGasWatchRegion(s.area, s.lat) === 'ncr');
  const refStations = ncrStations.length >= 20 ? ncrStations : stations;
  const gwNcrURaw = median(refStations.map((s) => s.prices.unleaded).filter((v) => v !== null));
  const gwNcrDRaw = median(refStations.map((s) => s.prices.diesel).filter((v) => v !== null));
  const gwNcrU = Number((gwNcrURaw + appliedGw.gas).toFixed(2));
  const gwNcrD = Number((gwNcrDRaw + appliedGw.diesel).toFixed(2));

  const gasCalibrationShift = doeNcr && gwNcrURaw > 0 ? Number((doeNcr.ron91Common - gwNcrURaw).toFixed(2)) : 0;
  const dieselCalibrationShift = doeNcr && gwNcrDRaw > 0 ? Number((doeNcr.dieselCommon - gwNcrDRaw).toFixed(2)) : 0;

  const ron91Common = doeNcr ? Number((doeNcr.ron91Common + appliedDoe.gas).toFixed(2)) : gwNcrU;
  const ron95Common = doeNcr ? Number((doeNcr.ron95Common + appliedDoe.gas).toFixed(2)) : gwNcrU;
  const ron97Common = doeNcr ? Number((doeNcr.ron97Common + appliedDoe.gas).toFixed(2)) : Number((ron95Common + 4.5).toFixed(2));
  const gasolineCommon = ron91Common;
  const dieselCommon = doeNcr ? Number((doeNcr.dieselCommon + appliedDoe.diesel).toFixed(2)) : gwNcrD;
  const keroseneCommon = doeNcr ? Number((doeNcr.keroseneCommon + appliedDoe.kero).toFixed(2)) : Number((dieselCommon + 25).toFixed(2));

  const regionBuckets = { south_luzon: { g: [], d: [] }, north_luzon: { g: [], d: [] }, visayas: { g: [], d: [] }, mindanao: { g: [], d: [] } };
  for (const s of stations) {
    const reg = classifyGasWatchRegion(s.area, s.lat);
    if (reg === 'ncr') continue;
    if (s.prices.unleaded) regionBuckets[reg].g.push(Number((s.prices.unleaded + appliedGw.gas).toFixed(2)));
    if (s.prices.diesel) regionBuckets[reg].d.push(Number((s.prices.diesel + appliedGw.diesel).toFixed(2)));
  }
  const regOff = (b) => ({
    gasolineOffset: b.g.length ? Number((median(b.g) - gwNcrU).toFixed(2)) : 0,
    dieselOffset: b.d.length ? Number((median(b.d) - gwNcrD).toFixed(2)) : 0,
  });

  // Next Tuesday Forecast from MOPS week-over-week live futures
  const avg = (arr) => (arr.length ? Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(4)) : 0);
  const rbobPrior = rbob.history.filter((p) => p.date >= cal.priorWeekStartIso && p.date < cal.currentWeekStartIso).map((p) => p.close);
  const rbobCurr = rbob.history.filter((p) => p.date >= cal.currentWeekStartIso).map((p) => p.close);
  const ulsdPrior = ulsd.history.filter((p) => p.date >= cal.priorWeekStartIso && p.date < cal.currentWeekStartIso).map((p) => p.close);
  const ulsdCurr = ulsd.history.filter((p) => p.date >= cal.currentWeekStartIso).map((p) => p.close);
  const rbobPriorAvg = avg(rbobPrior) || rbob.latest;
  const rbobCurrentAvg = avg(rbobCurr) || rbob.latest;
  const ulsdPriorAvg = avg(ulsdPrior) || ulsd.latest;
  const ulsdCurrentAvg = avg(ulsdCurr) || ulsd.latest;
  const rbobDeltaPct = rbobPriorAvg > 0 ? Number((((rbobCurrentAvg - rbobPriorAvg) / rbobPriorAvg) * 100).toFixed(2)) : 0;
  const ulsdDeltaPct = ulsdPriorAvg > 0 ? Number((((ulsdCurrentAvg - ulsdPriorAvg) / ulsdPriorAvg) * 100).toFixed(2)) : 0;
  const nextGasD = Number((((rbobCurrentAvg - rbobPriorAvg) / 3.78541) * usdPhp).toFixed(2));
  const nextDieselD = Number((((ulsdCurrentAvg - ulsdPriorAvg) / 3.78541) * usdPhp).toFixed(2));
  const nextKeroD = Number((nextDieselD * 1.12).toFixed(2));
  const tradingDaysCompleted = Math.min(5, Math.max(1, Math.max(rbobCurr.length, ulsdCurr.length)));
  const nextDir = nextGasD < -0.1 && nextDieselD < -0.1 ? 'rollback' : nextGasD > 0.1 && nextDieselD > 0.1 ? 'hike' : Math.abs(nextGasD) <= 0.1 && Math.abs(nextDieselD) <= 0.1 ? 'unchanged' : 'mixed';

  const sortedGwHistory = [...(gw.PRICE_HISTORY || [])].sort((a, b) => a.week.localeCompare(b.week));
  const history = sortedGwHistory.map((wk, idx) => {
    const prev = idx > 0 ? sortedGwHistory[idx - 1] : null;
    const tueMs = new Date(`${wk.week}T00:00:00+08:00`).getTime();
    const weekNews = allSortedItems.filter((it) => it.pubMs >= tueMs - 5 * 24 * 3600 * 1000 && it.pubMs <= tueMs + 36 * 3600 * 1000);
    let ng; let nd; let nk; let note = '';
    for (const m of weekNews) {
      const p = extractFuelDeltasFromText(`${m.title}. ${m.description}`);
      if (p.gas !== undefined && ng === undefined) ng = p.gas;
      if (p.diesel !== undefined && nd === undefined) nd = p.diesel;
      if (p.kerosene !== undefined && nk === undefined) nk = p.kerosene;
      if (!note && (p.gas !== undefined || p.diesel !== undefined)) note = m.title.replace(/\s+-\s+[^-]+$/, '').slice(0, 72);
    }
    const gD = ng ?? (prev ? Number((wk.unleadedAvg - prev.unleadedAvg).toFixed(2)) : 0);
    const dD = nd ?? (prev ? Number((wk.dieselAvg - prev.dieselAvg).toFixed(2)) : 0);
    const kD = nk ?? Number((dD * 1.1).toFixed(2));
    const label = new Date(`${wk.week}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' });
    const isLatest = idx === sortedGwHistory.length - 1 && doeNcr && wk.week >= '2026-11-10';
    const wGasAvg = isLatest ? doeNcr.ron91Common : Number(wk.unleadedAvg.toFixed(2));
    const wDieselAvg = isLatest ? doeNcr.dieselCommon : Number(wk.dieselAvg.toFixed(2));
    return { effectiveDate: wk.week, label, gasolineDelta: gD, dieselDelta: dD, keroseneDelta: kD, gasolinePumpAvg: wGasAvg, dieselPumpAvg: wDieselAvg, kerosenePumpAvg: Number((wDieselAvg + (keroseneCommon - dieselCommon)).toFixed(2)), note: note || `DOE/GasWatch weekly average (${wk.label})` };
  });

  const lastHist = history.at(-1);
  if (lastHist && lastHist.effectiveDate < targetTuesday) {
    history.push({
      effectiveDate: targetTuesday,
      label: new Date(`${targetTuesday}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' }),
      gasolineDelta: finalGasDelta, dieselDelta: finalDieselDelta, keroseneDelta: finalKeroDelta,
      gasolinePumpAvg: Number((lastHist.gasolinePumpAvg + finalGasDelta).toFixed(2)),
      dieselPumpAvg: Number((lastHist.dieselPumpAvg + finalDieselDelta).toFixed(2)),
      kerosenePumpAvg: Number((lastHist.kerosenePumpAvg + finalKeroDelta).toFixed(2)),
      note: hasAdvisory ? leadTitle.replace(/\s+-\s+[^-]+$/, '').slice(0, 72) || 'Latest Tuesday oil firm advisory' : 'Live MOPS/RBOB & ULSD benchmark projection',
    });
  }

  const allDown = finalGasDelta < -0.05 && finalDieselDelta < -0.05;
  const allUp = finalGasDelta > 0.05 && finalDieselDelta > 0.05;
  const direction = allDown ? 'rollback' : allUp ? 'hike' : Math.abs(finalGasDelta) < 0.05 && Math.abs(finalDieselDelta) < 0.05 ? 'unchanged' : 'mixed';

  const seenUrls = new Set();
  const sources = [];
  if (doeNcr) {
    seenUrls.add(doeNcr.sourceUrl);
    sources.push({ title: `Department of Energy (DOE) NCR Retail Pump Prices (through ${doeNcr.weekEndIso})`, uri: doeNcr.sourceUrl });
  }
  seenUrls.add('https://gaswatchph.com/');
  sources.push({ title: `GasWatch PH Live Station Monitor (${stations.length.toLocaleString()} stations)`, uri: 'https://gaswatchph.com/' });
  for (const item of [...currentCycleItems, ...allSortedItems].slice(0, 6)) {
    if (item.link && !seenUrls.has(item.link)) { seenUrls.add(item.link); sources.push({ title: item.title, uri: item.link }); }
  }

  const report = {
    fetchedAt: new Date().toISOString(),
    dataSource: doeNcr ? 'live_doe_pdf_and_feeds' : 'live_gaswatch_doe_feeds',
    prediction: {
      targetTuesdayDate: targetTuesday,
      effectiveTime: '06:00 AM PHT',
      status: hasAdvisory ? 'confirmed_advisory' : 'mops_projection',
      direction,
      confidence: hasAdvisory ? 'high' : 'moderate',
      gasolineDelta: finalGasDelta,
      dieselDelta: finalDieselDelta,
      keroseneDelta: finalKeroDelta,
      headline: direction === 'rollback' ? `Pump Price Rollback ${cal.isEffectiveTuesdayNow ? 'Effective' : 'Expected for'} Tue ${targetTuesday}` : direction === 'hike' ? `Pump Price Hike ${cal.isEffectiveTuesdayNow ? 'Effective' : 'Projected for'} Tue ${targetTuesday}` : direction === 'mixed' ? `Mixed Fuel Adjustments ${cal.isEffectiveTuesdayNow ? 'Effective' : 'Set for'} Tue ${targetTuesday}` : `Flat Fuel Pricing Outlook for Tue ${targetTuesday}`,
      summary: hasAdvisory
        ? `Confirmed Philippine oil company advisories implement Gasoline ${finalGasDelta >= 0 ? '+' : '-'}₱${Math.abs(finalGasDelta).toFixed(2)}/L, Diesel ${finalDieselDelta >= 0 ? '+' : '-'}₱${Math.abs(finalDieselDelta).toFixed(2)}/L, and Kerosene ${finalKeroDelta >= 0 ? '+' : '-'}₱${Math.abs(finalKeroDelta).toFixed(2)}/L effective Tuesday 06:00 AM PHT.`
        : `Based on live 5-day refined product futures and USD/PHP import parity, Tuesday adjustments are tracking Gasoline ${finalGasDelta >= 0 ? '+' : '-'}₱${Math.abs(finalGasDelta).toFixed(2)}/L and Diesel ${finalDieselDelta >= 0 ? '+' : '-'}₱${Math.abs(finalDieselDelta).toFixed(2)}/L.`,
      explanation:
        (leadTitle ? `Latest advisory: "${leadTitle}". ` : '') +
        `Philippine oil companies reset pump prices every Tuesday at 06:00 AM using the previous trading week's Mean of Platts Singapore (MOPS) average converted via USD/PHP. Prevailing benchmarks anchor directly to DOE's official retail monitoring report (${doeNcr ? `week ending ${doeNcr.weekEndIso}` : 'GasWatch station survey'}).`,
      drivers: [
        { factor: 'Refined Gasoline Benchmark (RBOB / MOPS Mogas proxy)', impact: rbob.weeklyChangePct < -0.2 ? 'downward' : rbob.weeklyChangePct > 0.2 ? 'upward' : 'neutral', detail: `5-day refined gasoline benchmark shifted ${rbob.weeklyChangePct >= 0 ? '+' : ''}${rbob.weeklyChangePct.toFixed(2)}%, guiding MOPS 92/95 RON import parity.`, metric: `${rbob.weeklyChangePct >= 0 ? '+' : ''}${rbob.weeklyChangePct.toFixed(2)}% (5D)` },
        { factor: 'Middle Distillates / Gasoil (ULSD / MOPS Diesel proxy)', impact: ulsd.weeklyChangePct < -0.2 ? 'downward' : ulsd.weeklyChangePct > 0.2 ? 'upward' : 'neutral', detail: `5-day gasoil benchmark moved ${ulsd.weeklyChangePct >= 0 ? '+' : ''}${ulsd.weeklyChangePct.toFixed(2)}%, driving local diesel and kerosene adjustments.`, metric: `${ulsd.weeklyChangePct >= 0 ? '+' : ''}${ulsd.weeklyChangePct.toFixed(2)}% (5D)` },
        { factor: 'Global Brent Crude Supply & Risk Premium', impact: brent.changePct < -0.2 ? 'downward' : brent.changePct > 0.2 ? 'upward' : 'neutral', detail: `Brent crude spot trades at $${brent.latest.toFixed(2)}/bbl (${brent.changePct >= 0 ? '+' : ''}${brent.changePct.toFixed(2)}% daily).`, metric: `$${brent.latest.toFixed(2)}/bbl` },
        { factor: 'USD / PHP Peso Exchange Rate', impact: usdPhp >= 58.5 ? 'upward' : usdPhp <= 56.5 ? 'downward' : 'neutral', detail: `With USD/PHP at ₱${usdPhp.toFixed(2)}, peso fluctuations scale landed import fuel costs.`, metric: `₱${usdPhp.toFixed(2)} / USD` },
      ],
    },
    nextWeekForecast: {
      targetTuesdayDate: cal.nextResetTuesdayIso,
      effectiveTime: '06:00 AM PHT',
      mopsWindowLabel: `${cal.currentWeekStartIso.slice(5)} MOPS vs ${cal.priorWeekStartIso.slice(5)} wk`,
      tradingDaysCompleted,
      tradingDaysTotal: 5,
      direction: nextDir,
      confidence: tradingDaysCompleted >= 4 ? 'high' : tradingDaysCompleted >= 2 ? 'moderate' : 'early_week',
      gasolineDelta: nextGasD,
      dieselDelta: nextDieselD,
      keroseneDelta: nextKeroD,
      headline: nextDir === 'rollback' ? `Next Tuesday Reset (${cal.nextResetTuesdayIso}) Tracking Another Rollback` : nextDir === 'hike' ? `Next Tuesday Reset (${cal.nextResetTuesdayIso}) Tracking a Price Hike` : nextDir === 'mixed' ? `Next Tuesday Reset (${cal.nextResetTuesdayIso}) Tracking Mixed Moves` : `Next Tuesday Reset (${cal.nextResetTuesdayIso}) Tracking Flat`,
      summary: `Current MOPS week vs prior 5-day average projects Gasoline ${nextGasD >= 0 ? '+' : '-'}₱${Math.abs(nextGasD).toFixed(2)}/L, Diesel ${nextDieselD >= 0 ? '+' : '-'}₱${Math.abs(nextDieselD).toFixed(2)}/L, and Kerosene ${nextKeroD >= 0 ? '+' : '-'}₱${Math.abs(nextKeroD).toFixed(2)}/L if current futures hold through Friday.`,
      explanation: `Across ${tradingDaysCompleted} of 5 active sessions (${cal.currentWeekStartIso} onward), RBOB gasoline trades at $${rbobCurrentAvg.toFixed(3)}/gal (${rbobDeltaPct >= 0 ? '+' : ''}${rbobDeltaPct.toFixed(2)}% vs last week's $${rbobPriorAvg.toFixed(3)}) and ULSD gasoil trades at $${ulsdCurrentAvg.toFixed(3)}/gal (${ulsdDeltaPct >= 0 ? '+' : ''}${ulsdDeltaPct.toFixed(2)}% vs $${ulsdPriorAvg.toFixed(3)}), converted at USD/PHP ₱${usdPhp.toFixed(2)}.`,
      rbobPriorAvg,
      rbobCurrentAvg,
      rbobDeltaPct,
      ulsdPriorAvg,
      ulsdCurrentAvg,
      ulsdDeltaPct,
    },
    prevailing: {
      areaName: 'Metro Manila (DOE NCR)',
      effectiveDate: appliedDoe.gas !== 0 || appliedDoe.diesel !== 0 ? targetTuesday : doeNcr?.weekEndIso || lastUpdatedIso,
      gasolineCommon,
      gasolineMin: doeNcr ? Number((doeNcr.ron91Min + appliedDoe.gas).toFixed(2)) : Number((gasolineCommon - 5).toFixed(2)),
      gasolineMax: doeNcr ? Number((doeNcr.ron95Max + appliedDoe.gas).toFixed(2)) : Number((gasolineCommon + 8).toFixed(2)),
      ron91Common,
      ron95Common,
      ron97Common,
      dieselCommon,
      dieselMin: doeNcr ? Number((doeNcr.dieselMin + appliedDoe.diesel).toFixed(2)) : Number((dieselCommon - 5).toFixed(2)),
      dieselMax: doeNcr ? Number((doeNcr.dieselMax + appliedDoe.diesel).toFixed(2)) : Number((dieselCommon + 5).toFixed(2)),
      keroseneCommon,
      keroseneMin: doeNcr ? Number((doeNcr.keroseneMin + appliedDoe.kero).toFixed(2)) : Number((keroseneCommon - 8).toFixed(2)),
      keroseneMax: doeNcr ? Number((doeNcr.keroseneMax + appliedDoe.kero).toFixed(2)) : Number((keroseneCommon + 12).toFixed(2)),
      regionalAdjustments: [
        { region: 'Metro Manila (NCR)', gasolineOffset: 0, dieselOffset: 0, note: 'Official DOE NCR common price baseline' },
        { region: 'South Luzon (CALABARZON / Cavite / Bicol)', ...regOff(regionBuckets.south_luzon), note: 'Measured median spread vs NCR' },
        { region: 'North & Central Luzon', ...regOff(regionBuckets.north_luzon), note: 'Measured median spread vs NCR' },
        { region: 'Visayas (Cebu / Iloilo)', ...regOff(regionBuckets.visayas), note: 'Measured median spread vs NCR' },
        { region: 'Mindanao (Davao / CDO)', ...regOff(regionBuckets.mindanao), note: 'Measured median spread vs NCR' },
      ],
    },
    history,
    benchmarks: {
      usdPhpRate: usdPhp,
      usdPhpUpdatedAt: fx?.time_last_update_utc ? new Date(fx.time_last_update_utc).toISOString() : new Date().toISOString(),
      brentUsd: Number(brent.latest.toFixed(2)),
      brentChangePct: brent.changePct,
      wtiUsd: Number(wti.latest.toFixed(2)),
      wtiChangePct: wti.changePct,
      brentHistory: brent.history.map((p) => ({ date: p.date, close: Number(p.close.toFixed(2)) })),
      wtiHistory: wti.history.map((p) => ({ date: p.date, close: Number(p.close.toFixed(2)) })),
    },
    sources,
  };

  const compactStations = stations.map((st) => {
    const { brand, tier } = canonicalBrandLabel(st.brand);
    return {
      id: `gw-${st.id}`,
      name: st.name,
      brand,
      brandTier: tier,
      area: st.area,
      lat: st.lat,
      lng: st.lng,
      u: st.prices.unleaded ? Number((st.prices.unleaded + gasCalibrationShift + appliedGw.gas).toFixed(2)) : null,
      r95: st.prices.premium95 ? Number((st.prices.premium95 + gasCalibrationShift + appliedGw.gas).toFixed(2)) : null,
      d: st.prices.diesel ? Number((st.prices.diesel + dieselCalibrationShift + appliedGw.diesel).toFixed(2)) : null,
      k: st.prices.kerosene ? Number((st.prices.kerosene + appliedGw.kero).toFixed(2)) : null,
    };
  });

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(fuelFile, JSON.stringify(report, null, 2));
  fs.writeFileSync(stationsFile, JSON.stringify({ updatedAt: new Date().toISOString(), stations: compactStations }));
  console.log(`Synced official DOE + GasWatch snapshot (${stations.length} stations) successfully.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
