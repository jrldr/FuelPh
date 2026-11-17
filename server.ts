import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type {
  CommodityPoint,
  ForecastDriver,
  FuelPrediction,
  GroundingSource,
  LiveFuelReport,
  MarketBenchmarks,
  NextTuesdayForecast,
  PrevailingPrices,
  PriceDirection,
  WeeklyHistoryPoint,
} from './src/types/fuel.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    })
  : null;

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

interface GasWatchPrices {
  diesel: number | null;
  premiumDiesel: number | null;
  unleaded: number | null;
  egasoline?: number | null;
  premium95: number | null;
  premium97: number | null;
  kerosene: number | null;
}

interface GasWatchStation {
  id: number;
  brand: string;
  name: string;
  area: string;
  lat: number;
  lng: number;
  prices: GasWatchPrices;
}

interface GasWatchHistoryWeek {
  week: string;
  label: string;
  dieselAvg: number;
  unleadedAvg: number;
  brands?: Record<string, { diesel?: number; unleaded?: number }>;
}

interface GasWatchDataset {
  lastUpdatedRaw: string;
  lastUpdatedIso: string;
  history: GasWatchHistoryWeek[];
  stations: GasWatchStation[];
  brandAverages: Record<
    string,
    { unleaded: number; premium95: number; diesel: number; kerosene: number }
  >;
}

interface DoeNcrMonitorData {
  sourceUrl: string;
  weekEndIso: string;
  ron91Common: number;
  ron91Min: number;
  ron91Max: number;
  ron95Common: number;
  ron95Min: number;
  ron95Max: number;
  ron97Common: number;
  dieselCommon: number;
  dieselMin: number;
  dieselMax: number;
  keroseneMin: number;
  keroseneMax: number;
  keroseneCommon: number;
}

let liveReportCache: CacheEntry<LiveFuelReport> | null = null;
let gasWatchCache: CacheEntry<GasWatchDataset> | null = null;
let doeNcrCache: CacheEntry<DoeNcrMonitorData> | null = null;
const nearbyCache = new Map<string, CacheEntry<unknown>>();
const CACHE_TTL_MS = 10 * 60 * 1000;
const GASWATCH_TTL_MS = 15 * 60 * 1000;
const DOE_TTL_MS = 30 * 60 * 1000;

async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${url}`);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJsonWithTimeout(url: string, init?: RequestInit, timeoutMs = 10000) {
  const res = await fetchWithTimeout(url, init, timeoutMs);
  return await res.json();
}

async function fetchTextWithTimeout(url: string, init?: RequestInit, timeoutMs = 10000) {
  const res = await fetchWithTimeout(url, init, timeoutMs);
  return await res.text();
}

function normalizePrice(val: unknown): number | null {
  if (typeof val !== 'number' || !Number.isFinite(val)) return null;
  if (val < 25 || val > 250) return null;
  return Number(val.toFixed(2));
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(2));
  }
  return Number(sorted[mid].toFixed(2));
}

function percentile(values: number[], pct: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * pct)));
  return Number(sorted[idx].toFixed(2));
}

function extractPdfText(buf: Buffer): string {
  const s = buf.toString('latin1');
  const out: string[] = [];
  for (const m of s.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    let raw: Buffer = Buffer.from(m[1], 'latin1');
    try {
      raw = zlib.inflateSync(raw);
    } catch {
      // stream may not be zlib compressed
    }
    const txt = raw.toString('latin1');
    for (const tm of txt.matchAll(/\(([^()]*)\)\s*Tj|\[([^\]]+)\]\s*TJ/g)) {
      if (tm[1]) {
        out.push(tm[1]);
      } else if (tm[2]) {
        out.push([...tm[2].matchAll(/\(([^()]*)\)/g)].map((x) => x[1]).join(''));
      }
    }
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

async function fetchLiveDoeNcrMonitor(forceRefresh = false): Promise<DoeNcrMonitorData | null> {
  if (!forceRefresh && doeNcrCache && Date.now() < doeNcrCache.expiresAt) {
    return doeNcrCache.data;
  }

  try {
    const html = await fetchTextWithTimeout(
      'https://www.doe.gov.ph/data-and-prices/liquid-fuels/retail-pump-prices/ncr-pump-prices',
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FuelPh/1.0)' } },
      12000
    );
    const urls = [
      ...new Set(
        [...html.matchAll(/https:\/\/d24qbtp4vooyzi\.cloudfront\.net[^"'<\s\\]+/g)].map(
          (m) => m[0]
        )
      ),
    ];
    const candidates = urls.filter((u) => /NCR/i.test(u) && /\.pdf/i.test(u)).slice(0, 5);
    if (!candidates.length) return null;

    let newest: { url: string; weekEndIso: string; text: string } | null = null;
    for (const url of candidates) {
      try {
        const res = await fetchWithTimeout(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FuelPh/1.0)' },
        });
        const buf = Buffer.from(await res.arrayBuffer());
        const text = extractPdfText(buf);
        const wm = text.match(
          /week of\s+([A-Za-z]+)\s+(\d+)\s*(?:-|to)\s*(?:([A-Za-z]+)\s+)?(\d+),?\s*(20\d{2})/i
        );
        let weekEndIso = '';
        if (wm) {
          const endMonth = wm[3] || wm[1];
          const d = new Date(`${endMonth} ${wm[4]}, ${wm[5]}`);
          if (!Number.isNaN(d.getTime())) {
            weekEndIso = new Date(d.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
          }
        }
        if (weekEndIso && (!newest || weekEndIso > newest.weekEndIso)) {
          newest = { url, weekEndIso, text };
        }
      } catch {
        // try next candidate
      }
    }

    if (!newest) return null;

    const parseProductStats = (prod: string) => {
      const commons: number[] = [];
      const mins: number[] = [];
      const maxs: number[] = [];
      const re = new RegExp(
        `\\b${prod}(?!\\s*PLUS)\\s+([\\d.#N/A\\s-]+?)(?=\\b(?:RON|DIESEL|KEROSENE|Date)\\b|$)`,
        'g'
      );
      for (const m of newest!.text.matchAll(re)) {
        const rm = m[1].match(/(\d+\.\d+)\s*-\s*(\d+\.\d+)\s+(\d+\.\d+|#N\/A)/);
        if (rm) {
          const lo = Number(rm[1]);
          const hi = Number(rm[2]);
          if (lo >= 25 && hi <= 220 && hi >= lo) {
            mins.push(lo);
            maxs.push(hi);
            if (rm[3] !== '#N/A') {
              const c = Number(rm[3]);
              if (c >= lo && c <= hi) commons.push(c);
            }
          }
        }
      }
      return {
        min: mins.length ? Number(Math.min(...mins).toFixed(2)) : 0,
        max: maxs.length ? Number(Math.max(...maxs).toFixed(2)) : 0,
        common: commons.length ? median(commons) : 0,
      };
    };

    const ron91 = parseProductStats('RON 91');
    const ron95 = parseProductStats('RON 95');
    const ron97 = parseProductStats('RON 97');
    const diesel = parseProductStats('DIESEL');
    const kero = parseProductStats('KEROSENE');

    if (!ron91.common || !diesel.common) return null;

    const data: DoeNcrMonitorData = {
      sourceUrl: newest.url,
      weekEndIso: newest.weekEndIso,
      ron91Common: ron91.common,
      ron91Min: ron91.min || ron91.common,
      ron91Max: ron91.max || ron91.common,
      ron95Common: ron95.common || Number((ron91.common + 1.2).toFixed(2)),
      ron95Min: ron95.min || ron91.min,
      ron95Max: ron95.max || ron91.max,
      ron97Common: ron97.common || Number((ron95.common + 5.0).toFixed(2)),
      dieselCommon: diesel.common,
      dieselMin: diesel.min || diesel.common,
      dieselMax: diesel.max || diesel.common,
      keroseneMin: kero.min || Number((diesel.common + 15).toFixed(2)),
      keroseneMax: kero.max || Number((diesel.common + 45).toFixed(2)),
      keroseneCommon:
        kero.common ||
        (kero.min && kero.max ? Number(((kero.min + kero.max) / 2).toFixed(2)) : Number((diesel.common + 25).toFixed(2))),
    };

    doeNcrCache = { data, expiresAt: Date.now() + DOE_TTL_MS };
    return data;
  } catch (err) {
    console.warn('DOE PDF monitor fetch warning:', err instanceof Error ? err.message : err);
    return null;
  }
}

function parseGasWatchLastUpdatedIso(raw: string): string {
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) {
    const manila = new Date(parsed + 8 * 60 * 60 * 1000);
    return manila.toISOString().slice(0, 10);
  }
  return '1970-01-01';
}

function canonicalBrandLabel(rawBrand: string): { brand: string; tier: 'major' | 'independent' } {
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

async function fetchLiveGasWatchData(forceRefresh = false): Promise<GasWatchDataset> {
  if (!forceRefresh && gasWatchCache && Date.now() < gasWatchCache.expiresAt) {
    return gasWatchCache.data;
  }

  const [dataJs, overridesJs] = await Promise.all([
    fetchTextWithTimeout(
      'https://gaswatchph.com/js/data.js',
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FuelPh/1.0)' } },
      12000
    ),
    fetchTextWithTimeout(
      'https://gaswatchph.com/js/station-overrides.js',
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FuelPh/1.0)' } },
      12000
    ).catch(() => ''),
  ]);

  const sandbox: Record<string, unknown> = {};
  const script = `${dataJs}\n${overridesJs}\n;this.__out = {
    LAST_UPDATED: typeof LAST_UPDATED !== 'undefined' ? LAST_UPDATED : '',
    PRICE_HISTORY: typeof PRICE_HISTORY !== 'undefined' ? PRICE_HISTORY : [],
    GAS_STATIONS: typeof GAS_STATIONS !== 'undefined' ? GAS_STATIONS : [],
    STATION_OVERRIDES: typeof STATION_OVERRIDES !== 'undefined' ? STATION_OVERRIDES : {}
  };`;

  vm.runInNewContext(script, sandbox, { timeout: 2500 });
  const out = sandbox.__out as {
    LAST_UPDATED: string;
    PRICE_HISTORY: GasWatchHistoryWeek[];
    GAS_STATIONS: GasWatchStation[];
    STATION_OVERRIDES: Record<string, Record<string, { p?: number }>>;
  };

  const overrides = out.STATION_OVERRIDES || {};
  const stations: GasWatchStation[] = (Array.isArray(out.GAS_STATIONS) ? out.GAS_STATIONS : []).map((st) => {
    const ov = overrides[String(st.id)] || {};
    const merged: GasWatchPrices = {
      diesel: normalizePrice(ov.diesel?.p ?? st.prices?.diesel),
      premiumDiesel: normalizePrice(ov.premiumDiesel?.p ?? st.prices?.premiumDiesel),
      unleaded: normalizePrice(ov.unleaded?.p ?? st.prices?.unleaded),
      egasoline: normalizePrice(ov.egasoline?.p ?? st.prices?.egasoline),
      premium95: normalizePrice(ov.premium95?.p ?? st.prices?.premium95),
      premium97: normalizePrice(ov.premium97?.p ?? st.prices?.premium97),
      kerosene: normalizePrice(ov.kerosene?.p ?? st.prices?.kerosene),
    };
    return { ...st, prices: merged };
  });

  const byBrandBuckets = new Map<
    string,
    { u: number[]; p95: number[]; d: number[]; k: number[] }
  >();
  for (const st of stations) {
    const { brand } = canonicalBrandLabel(st.brand);
    const key = brand.toLowerCase();
    if (!byBrandBuckets.has(key)) {
      byBrandBuckets.set(key, { u: [], p95: [], d: [], k: [] });
    }
    const bucket = byBrandBuckets.get(key)!;
    if (st.prices.unleaded) bucket.u.push(st.prices.unleaded);
    if (st.prices.premium95) bucket.p95.push(st.prices.premium95);
    if (st.prices.diesel) bucket.d.push(st.prices.diesel);
    if (st.prices.kerosene) bucket.k.push(st.prices.kerosene);
  }

  const allU = stations.map((s) => s.prices.unleaded).filter((v): v is number => v !== null);
  const allP95 = stations.map((s) => s.prices.premium95).filter((v): v is number => v !== null);
  const allD = stations.map((s) => s.prices.diesel).filter((v): v is number => v !== null);
  const allK = stations.map((s) => s.prices.kerosene).filter((v): v is number => v !== null);

  const globalMedians = {
    unleaded: median(allU),
    premium95: median(allP95),
    diesel: median(allD),
    kerosene: median(allK),
  };

  const brandAverages: GasWatchDataset['brandAverages'] = {
    default: globalMedians,
  };
  for (const [key, b] of byBrandBuckets.entries()) {
    brandAverages[key] = {
      unleaded: b.u.length ? median(b.u) : globalMedians.unleaded,
      premium95: b.p95.length ? median(b.p95) : globalMedians.premium95,
      diesel: b.d.length ? median(b.d) : globalMedians.diesel,
      kerosene: b.k.length ? median(b.k) : globalMedians.kerosene,
    };
  }

  const lastUpdatedRaw = String(out.LAST_UPDATED || '');
  const dataset: GasWatchDataset = {
    lastUpdatedRaw,
    lastUpdatedIso: parseGasWatchLastUpdatedIso(lastUpdatedRaw),
    history: Array.isArray(out.PRICE_HISTORY) ? out.PRICE_HISTORY : [],
    stations,
    brandAverages,
  };

  gasWatchCache = { data: dataset, expiresAt: Date.now() + GASWATCH_TTL_MS };
  return dataset;
}

async function fetchYahooSeries(symbol: string): Promise<{
  latest: number;
  changePct: number;
  weeklyChangePct: number;
  history: CommodityPoint[];
}> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?interval=1d&range=3mo`;
  const data = await fetchJsonWithTimeout(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FuelPh/1.0)' },
  });

  const result = data?.chart?.result?.[0];
  const timestamps: number[] = result?.timestamp || [];
  const closes: Array<number | null> = result?.indicators?.quote?.[0]?.close || [];
  const history: CommodityPoint[] = [];

  for (let i = 0; i < timestamps.length; i++) {
    const c = closes[i];
    if (typeof c === 'number' && Number.isFinite(c)) {
      const dateStr = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
      history.push({ date: dateStr, close: Number(c.toFixed(4)) });
    }
  }

  const latest =
    typeof result?.meta?.regularMarketPrice === 'number'
      ? Number(result.meta.regularMarketPrice.toFixed(4))
      : history.at(-1)?.close ?? 0;

  const prevClose =
    typeof result?.meta?.chartPreviousClose === 'number'
      ? result.meta.chartPreviousClose
      : history.length >= 2
        ? history[history.length - 2].close
        : latest;

  const weekAgoClose =
    history.length >= 6 ? history[history.length - 6].close : history[0]?.close ?? latest;

  const changePct =
    prevClose > 0 ? Number((((latest - prevClose) / prevClose) * 100).toFixed(2)) : 0;
  const weeklyChangePct =
    weekAgoClose > 0 ? Number((((latest - weekAgoClose) / weekAgoClose) * 100).toFixed(2)) : 0;

  return { latest, changePct, weeklyChangePct, history };
}

interface ExtendedBenchmarks extends MarketBenchmarks {
  rbobWeeklyPct: number;
  ulsdWeeklyPct: number;
  rbobLatest: number;
  ulsdLatest: number;
  rbobHistory: CommodityPoint[];
  ulsdHistory: CommodityPoint[];
}

async function fetchLiveMarketBenchmarks(): Promise<ExtendedBenchmarks> {
  const [fxRes, brentRes, wtiRes, rbobRes, ulsdRes] = await Promise.allSettled([
    fetchJsonWithTimeout('https://open.er-api.com/v6/latest/USD'),
    fetchYahooSeries('BZ=F'),
    fetchYahooSeries('CL=F'),
    fetchYahooSeries('RB=F'),
    fetchYahooSeries('HO=F'),
  ]);

  const usdPhpRate =
    fxRes.status === 'fulfilled' && typeof fxRes.value?.rates?.PHP === 'number'
      ? Number(fxRes.value.rates.PHP.toFixed(3))
      : 58.0;
  const usdPhpUpdatedAt =
    fxRes.status === 'fulfilled' && fxRes.value?.time_last_update_utc
      ? new Date(fxRes.value.time_last_update_utc).toISOString()
      : new Date().toISOString();

  const brent =
    brentRes.status === 'fulfilled'
      ? brentRes.value
      : { latest: 0, changePct: 0, weeklyChangePct: 0, history: [] };
  const wti =
    wtiRes.status === 'fulfilled'
      ? wtiRes.value
      : { latest: 0, changePct: 0, weeklyChangePct: 0, history: [] };
  const rbob =
    rbobRes.status === 'fulfilled'
      ? rbobRes.value
      : { latest: 0, changePct: 0, weeklyChangePct: 0, history: [] };
  const ulsd =
    ulsdRes.status === 'fulfilled'
      ? ulsdRes.value
      : { latest: 0, changePct: 0, weeklyChangePct: 0, history: [] };

  return {
    usdPhpRate,
    usdPhpUpdatedAt,
    brentUsd: Number(brent.latest.toFixed(2)),
    brentChangePct: brent.changePct,
    wtiUsd: Number(wti.latest.toFixed(2)),
    wtiChangePct: wti.changePct,
    brentHistory: brent.history.map((p) => ({ date: p.date, close: Number(p.close.toFixed(2)) })),
    wtiHistory: wti.history.map((p) => ({ date: p.date, close: Number(p.close.toFixed(2)) })),
    rbobWeeklyPct: rbob.weeklyChangePct,
    ulsdWeeklyPct: ulsd.weeklyChangePct,
    rbobLatest: rbob.latest,
    ulsdLatest: ulsd.latest,
    rbobHistory: rbob.history,
    ulsdHistory: ulsd.history,
  };
}

function getManilaCalendar(referenceDate = new Date()) {
  const manilaMs = referenceDate.getTime() + 8 * 60 * 60 * 1000;
  const manila = new Date(manilaMs);
  const day = manila.getUTCDay(); // 0 Sun, 1 Mon, 2 Tue...
  const hour = manila.getUTCHours();
  const daysUntilTue = (2 - day + 7) % 7;
  const target = new Date(manilaMs + daysUntilTue * 24 * 60 * 60 * 1000);
  const nextResetTue = new Date(
    manilaMs + (day === 2 && hour >= 6 ? 7 : daysUntilTue === 0 ? 7 : daysUntilTue) * 24 * 60 * 60 * 1000
  );
  const prevDaysSinceTue = (day - 2 + 7) % 7;
  const mostRecentTuesday = new Date(manilaMs - prevDaysSinceTue * 24 * 60 * 60 * 1000);

  // Compute Monday of the current Manila week and Monday of the prior week
  const daysSinceMonday = (day + 6) % 7;
  const currentMondayMs = manilaMs - daysSinceMonday * 24 * 60 * 60 * 1000;
  const priorMondayMs = currentMondayMs - 7 * 24 * 60 * 60 * 1000;

  return {
    manilaIso: manila.toISOString().slice(0, 10),
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

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface ParsedNewsItem {
  title: string;
  link: string;
  pubDate: string;
  description: string;
}

async function fetchGoogleNewsPhFuel(query: string): Promise<ParsedNewsItem[]> {
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(
    query
  )}&hl=en-PH&gl=PH&ceid=PH:en`;
  const xml = await fetchTextWithTimeout(rssUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FuelPh/1.0)' },
  });

  const items: ParsedNewsItem[] = [];
  const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
  for (const m of itemMatches) {
    const block = m[1];
    const title = decodeHtmlEntities(block.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '');
    const link = decodeHtmlEntities(block.match(/<link>([\s\S]*?)<\/link>/)?.[1] || '');
    const pubDate = decodeHtmlEntities(block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || '');
    const description = decodeHtmlEntities(
      block.match(/<description>([\s\S]*?)<\/description>/)?.[1] || ''
    );
    if (title && link) {
      items.push({ title, link, pubDate, description });
    }
  }
  return items;
}

function inferDirectionSign(localContext: string, fullText: string): number {
  const downRe = /\b(rollback|rollbacks|roll back|cut|cuts|slash|slashed|decrease|decreasing|down|drop|drops|dropped|fall|falls|fell|reduce|lower|cheaper)\b/i;
  const upRe = /\b(hike|hikes|increase|increases|increasing|up|raise|raised|surge|jump|climb|higher)\b/i;

  const localDown = downRe.test(localContext);
  const localUp = upRe.test(localContext);
  if (localDown && !localUp) return -1;
  if (localUp && !localDown) return 1;

  const globalDown = downRe.test(fullText);
  const globalUp = upRe.test(fullText);
  if (globalDown && !globalUp) return -1;
  if (globalUp && !globalDown) return 1;
  return -1;
}

function extractFuelDeltasFromText(text: string): {
  gas?: number;
  diesel?: number;
  kerosene?: number;
} {
  const findFuelVal = (fuelPattern: string): number | undefined => {
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
          const sign = inferDirectionSign(localWindow, text);
          return Number((val * sign).toFixed(2));
        }
      }
    }
    return undefined;
  };

  return {
    gas: findFuelVal('gasoline|gas'),
    diesel: findFuelVal('diesel'),
    kerosene: findFuelVal('kerosene'),
  };
}

function parseTuesdayWindowDeltas(items: ParsedNewsItem[], targetTuesdayIso: string) {
  const targetMs = new Date(`${targetTuesdayIso}T00:00:00+08:00`).getTime();
  const recentWindowItems = items
    .map((item) => ({
      ...item,
      pubMs: item.pubDate ? new Date(item.pubDate).getTime() : 0,
    }))
    .filter((item) => item.pubMs > 0)
    .sort((a, b) => b.pubMs - a.pubMs);

  const currentCycleItems = recentWindowItems.filter(
    (item) => targetMs - item.pubMs <= 5 * 24 * 60 * 60 * 1000 && item.pubMs <= targetMs + 24 * 3600 * 1000
  );

  let gasDelta: number | undefined;
  let dieselDelta: number | undefined;
  let keroDelta: number | undefined;
  let leadTitle = '';

  for (const item of currentCycleItems) {
    const combined = `${item.title}. ${item.description}`;
    const parsed = extractFuelDeltasFromText(combined);
    if (parsed.gas !== undefined && gasDelta === undefined) gasDelta = parsed.gas;
    if (parsed.diesel !== undefined && dieselDelta === undefined) dieselDelta = parsed.diesel;
    if (parsed.kerosene !== undefined && keroDelta === undefined) keroDelta = parsed.kerosene;
    if (!leadTitle && (parsed.gas !== undefined || parsed.diesel !== undefined)) {
      leadTitle = item.title;
    }
  }

  return {
    gasDelta,
    dieselDelta,
    keroDelta,
    leadTitle,
    currentCycleItems,
    allSortedItems: recentWindowItems,
  };
}

const NCR_AREAS = new Set([
  'makati', 'taguig', 'quezon city', 'muntinlupa', 'parañaque', 'paranaque', 'manila', 'pasig',
  'mandaluyong', 'pasay', 'marikina', 'caloocan', 'las piñas', 'las pinas', 'valenzuela', 'san juan',
  'malabon', 'pateros', 'navotas',
]);

const SOUTH_LUZON_AREAS = new Set([
  'bacoor', 'dasmariñas', 'dasmarinas', 'imus', 'general trias', 'kawit', 'trece martires',
  'carmona', 'rosario', 'tanza', 'silang', 'noveleta', 'naic', 'cavite city', 'tagaytay',
  'ternate', 'maragondon', 'mendez', 'alfonso', 'amadeo', 'general mariano alvarez', 'indang',
  'magallanes', 'general emilio aguinaldo', 'calamba', 'santa rosa', 'biñan', 'binan', 'cabuyao',
  'san pedro', 'los baños', 'los banos', 'antipolo', 'cainta', 'taytay', 'batangas city',
  'lipa', 'tanauan', 'lucena', 'naga', 'legazpi',
]);

function classifyGasWatchRegion(area: string, lat: number): 'ncr' | 'south_luzon' | 'north_luzon' | 'visayas' | 'mindanao' {
  const norm = (area || '').toLowerCase().trim();
  if (NCR_AREAS.has(norm)) return 'ncr';
  if (SOUTH_LUZON_AREAS.has(norm)) return 'south_luzon';
  if (lat < 9.5) return 'mindanao';
  if (lat < 12.6) return 'visayas';
  if (lat > 14.85) return 'north_luzon';
  return 'south_luzon';
}

function buildNextTuesdayForecast(
  benchmarks: ExtendedBenchmarks,
  cal: ReturnType<typeof getManilaCalendar>
): NextTuesdayForecast {
  const usdPhp = benchmarks.usdPhpRate || 58.0;
  const avg = (arr: number[]) =>
    arr.length ? Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(4)) : 0;

  const rbobPrior = benchmarks.rbobHistory
    .filter((p) => p.date >= cal.priorWeekStartIso && p.date < cal.currentWeekStartIso)
    .map((p) => p.close);
  const rbobCurr = benchmarks.rbobHistory
    .filter((p) => p.date >= cal.currentWeekStartIso)
    .map((p) => p.close);

  const ulsdPrior = benchmarks.ulsdHistory
    .filter((p) => p.date >= cal.priorWeekStartIso && p.date < cal.currentWeekStartIso)
    .map((p) => p.close);
  const ulsdCurr = benchmarks.ulsdHistory
    .filter((p) => p.date >= cal.currentWeekStartIso)
    .map((p) => p.close);

  const rbobPriorAvg = avg(rbobPrior) || benchmarks.rbobLatest;
  const rbobCurrentAvg = avg(rbobCurr) || benchmarks.rbobLatest;
  const ulsdPriorAvg = avg(ulsdPrior) || benchmarks.ulsdLatest;
  const ulsdCurrentAvg = avg(ulsdCurr) || benchmarks.ulsdLatest;

  const rbobDeltaPct =
    rbobPriorAvg > 0 ? Number((((rbobCurrentAvg - rbobPriorAvg) / rbobPriorAvg) * 100).toFixed(2)) : 0;
  const ulsdDeltaPct =
    ulsdPriorAvg > 0 ? Number((((ulsdCurrentAvg - ulsdPriorAvg) / ulsdPriorAvg) * 100).toFixed(2)) : 0;

  const gasolineDelta = Number(
    (((rbobCurrentAvg - rbobPriorAvg) / 3.78541) * usdPhp).toFixed(2)
  );
  const dieselDelta = Number(
    (((ulsdCurrentAvg - ulsdPriorAvg) / 3.78541) * usdPhp).toFixed(2)
  );
  const keroseneDelta = Number((dieselDelta * 1.12).toFixed(2));

  const tradingDaysCompleted = Math.min(5, Math.max(1, Math.max(rbobCurr.length, ulsdCurr.length)));
  const confidence: NextTuesdayForecast['confidence'] =
    tradingDaysCompleted >= 4 ? 'high' : tradingDaysCompleted >= 2 ? 'moderate' : 'early_week';

  const allDown = gasolineDelta < -0.1 && dieselDelta < -0.1;
  const allUp = gasolineDelta > 0.1 && dieselDelta > 0.1;
  const direction: PriceDirection = allDown
    ? 'rollback'
    : allUp
      ? 'hike'
      : Math.abs(gasolineDelta) <= 0.1 && Math.abs(dieselDelta) <= 0.1
        ? 'unchanged'
        : 'mixed';

  const headline =
    direction === 'rollback'
      ? `Next Tuesday Reset (${cal.nextResetTuesdayIso}) Tracking Another Rollback`
      : direction === 'hike'
        ? `Next Tuesday Reset (${cal.nextResetTuesdayIso}) Tracking a Price Hike`
        : direction === 'mixed'
          ? `Next Tuesday Reset (${cal.nextResetTuesdayIso}) Tracking Mixed Moves`
          : `Next Tuesday Reset (${cal.nextResetTuesdayIso}) Tracking Flat`;

  const summary = `Current MOPS week vs prior 5-day average projects Gasoline ${gasolineDelta >= 0 ? '+' : '-'}₱${Math.abs(gasolineDelta).toFixed(2)}/L, Diesel ${dieselDelta >= 0 ? '+' : '-'}₱${Math.abs(dieselDelta).toFixed(2)}/L, and Kerosene ${keroseneDelta >= 0 ? '+' : '-'}₱${Math.abs(keroseneDelta).toFixed(2)}/L if current futures hold through Friday.`;

  const explanation = `Philippine pump resets every Tuesday follow the 5-day Mean of Platts Singapore (MOPS) average from the prior Monday–Friday trading week. Across ${tradingDaysCompleted} of 5 active sessions (${cal.currentWeekStartIso} onward), RBOB gasoline trades at $${rbobCurrentAvg.toFixed(3)}/gal (${rbobDeltaPct >= 0 ? '+' : ''}${rbobDeltaPct.toFixed(2)}% vs last week's $${rbobPriorAvg.toFixed(3)}) and ULSD gasoil trades at $${ulsdCurrentAvg.toFixed(3)}/gal (${ulsdDeltaPct >= 0 ? '+' : ''}${ulsdDeltaPct.toFixed(2)}% vs $${ulsdPriorAvg.toFixed(3)}), converted at USD/PHP ₱${usdPhp.toFixed(2)}.`;

  return {
    targetTuesdayDate: cal.nextResetTuesdayIso,
    effectiveTime: '06:00 AM PHT',
    mopsWindowLabel: `${cal.currentWeekStartIso.slice(5)} MOPS vs ${cal.priorWeekStartIso.slice(5)} wk`,
    tradingDaysCompleted,
    tradingDaysTotal: 5,
    direction,
    confidence,
    gasolineDelta,
    dieselDelta,
    keroseneDelta,
    headline,
    summary,
    explanation,
    rbobPriorAvg,
    rbobCurrentAvg,
    rbobDeltaPct,
    ulsdPriorAvg,
    ulsdCurrentAvg,
    ulsdDeltaPct,
  };
}

async function computeEffectiveDeltasForReferenceDate(
  referenceEndIso: string,
  cal: ReturnType<typeof getManilaCalendar>,
  currentAdvisoryDeltas?: { gas?: number; diesel?: number; kero?: number }
): Promise<{ gas: number; diesel: number; kero: number }> {
  if (cal.isEffectiveTuesdayNow && referenceEndIso < cal.targetTuesdayIso && currentAdvisoryDeltas) {
    return {
      gas: currentAdvisoryDeltas.gas ?? 0,
      diesel: currentAdvisoryDeltas.diesel ?? 0,
      kero: currentAdvisoryDeltas.kero ?? 0,
    };
  }
  if (cal.manilaDay !== 2 && referenceEndIso < cal.mostRecentTuesdayIso) {
    try {
      const items = await fetchGoogleNewsPhFuel(
        'Philippines fuel price rollback OR hike gasoline diesel when:14d'
      );
      const recentParsed = parseTuesdayWindowDeltas(items, cal.mostRecentTuesdayIso);
      if (recentParsed.gasDelta !== undefined || recentParsed.dieselDelta !== undefined) {
        return {
          gas: recentParsed.gasDelta ?? 0,
          diesel: recentParsed.dieselDelta ?? 0,
          kero: recentParsed.keroDelta ?? 0,
        };
      }
    } catch {
      // ignore if RSS unavailable
    }
  }
  return { gas: 0, diesel: 0, kero: 0 };
}

async function buildLiveReportFromPublicFeeds(
  benchmarks: ExtendedBenchmarks,
  gasWatch: GasWatchDataset,
  doeNcr: DoeNcrMonitorData | null
): Promise<LiveFuelReport> {
  const cal = getManilaCalendar();
  const targetTuesday = cal.targetTuesdayIso;

  const [newsMain, newsPump] = await Promise.all([
    fetchGoogleNewsPhFuel('Philippines fuel price rollback OR hike gasoline diesel when:45d').catch(() => []),
    fetchGoogleNewsPhFuel('Philippines DOE Metro Manila pump prices gasoline diesel when:30d').catch(() => []),
  ]);

  const combinedNews = [...newsMain, ...newsPump];
  const { gasDelta, dieselDelta, keroDelta, leadTitle, currentCycleItems, allSortedItems } =
    parseTuesdayWindowDeltas(combinedNews, targetTuesday);

  const hasAdvisory = gasDelta !== undefined || dieselDelta !== undefined;
  const usdPhp = benchmarks.usdPhpRate || 58.0;

  const mopsGasDelta = Number(
    (((benchmarks.rbobLatest * (benchmarks.rbobWeeklyPct / 100)) / 3.78541) * usdPhp).toFixed(2)
  );
  const mopsDieselDelta = Number(
    (((benchmarks.ulsdLatest * (benchmarks.ulsdWeeklyPct / 100)) / 3.78541) * usdPhp).toFixed(2)
  );

  const finalGasDelta = gasDelta ?? mopsGasDelta;
  const finalDieselDelta = dieselDelta ?? mopsDieselDelta;
  const finalKeroDelta = keroDelta ?? Number((finalDieselDelta * 1.15).toFixed(2));

  const appliedGw = await computeEffectiveDeltasForReferenceDate(gasWatch.lastUpdatedIso, cal, {
    gas: hasAdvisory ? finalGasDelta : undefined,
    diesel: hasAdvisory ? finalDieselDelta : undefined,
    kero: hasAdvisory ? finalKeroDelta : undefined,
  });

  const appliedDoe = doeNcr
    ? await computeEffectiveDeltasForReferenceDate(doeNcr.weekEndIso, cal, {
        gas: hasAdvisory ? finalGasDelta : undefined,
        diesel: hasAdvisory ? finalDieselDelta : undefined,
        kero: hasAdvisory ? finalKeroDelta : undefined,
      })
    : { gas: 0, diesel: 0, kero: 0 };

  // Compute GasWatch NCR vs Regional diffs for regional adjustments
  const ncrStations = gasWatch.stations.filter((s) => classifyGasWatchRegion(s.area, s.lat) === 'ncr');
  const refStations = ncrStations.length >= 20 ? ncrStations : gasWatch.stations;

  const gwNcrUnleaded = median(
    refStations
      .map((s) => s.prices.unleaded)
      .filter((v): v is number => v !== null)
      .map((v) => Number((v + appliedGw.gas).toFixed(2)))
  );
  const gwNcrDiesel = median(
    refStations
      .map((s) => s.prices.diesel)
      .filter((v): v is number => v !== null)
      .map((v) => Number((v + appliedGw.diesel).toFixed(2)))
  );

  // Use official DOE NCR PDF Common / Min / Max as authoritative NCR prevailing rates when available
  const ron91Common = doeNcr
    ? Number((doeNcr.ron91Common + appliedDoe.gas).toFixed(2))
    : gwNcrUnleaded;
  const ron95Common = doeNcr
    ? Number((doeNcr.ron95Common + appliedDoe.gas).toFixed(2))
    : median(
        refStations
          .map((s) => s.prices.premium95)
          .filter((v): v is number => v !== null)
          .map((v) => Number((v + appliedGw.gas).toFixed(2)))
      );
  const ron97Common = doeNcr
    ? Number((doeNcr.ron97Common + appliedDoe.gas).toFixed(2))
    : Number((ron95Common + 4.5).toFixed(2));
  const gasolineCommon = ron91Common;
  const finalGasMin = doeNcr
    ? Number((doeNcr.ron91Min + appliedDoe.gas).toFixed(2))
    : percentile(
        refStations.map((s) => s.prices.unleaded).filter((v): v is number => v !== null).map((v) => v + appliedGw.gas),
        0.05
      );
  const finalGasMax = doeNcr
    ? Number((doeNcr.ron95Max + appliedDoe.gas).toFixed(2))
    : percentile(
        refStations.map((s) => s.prices.premium95).filter((v): v is number => v !== null).map((v) => v + appliedGw.gas),
        0.95
      );

  const dieselCommon = doeNcr
    ? Number((doeNcr.dieselCommon + appliedDoe.diesel).toFixed(2))
    : gwNcrDiesel;
  const finalDieselMin = doeNcr
    ? Number((doeNcr.dieselMin + appliedDoe.diesel).toFixed(2))
    : percentile(
        refStations.map((s) => s.prices.diesel).filter((v): v is number => v !== null).map((v) => v + appliedGw.diesel),
        0.05
      );
  const finalDieselMax = doeNcr
    ? Number((doeNcr.dieselMax + appliedDoe.diesel).toFixed(2))
    : percentile(
        refStations.map((s) => s.prices.diesel).filter((v): v is number => v !== null).map((v) => v + appliedGw.diesel),
        0.95
      );

  const keroseneCommon = doeNcr
    ? Number((doeNcr.keroseneCommon + appliedDoe.kero).toFixed(2))
    : median(
        refStations.map((s) => s.prices.kerosene).filter((v): v is number => v !== null).map((v) => v + appliedGw.kero)
      );
  const finalKeroMin = doeNcr
    ? Number((doeNcr.keroseneMin + appliedDoe.kero).toFixed(2))
    : Number((keroseneCommon - 8).toFixed(2));
  const finalKeroMax = doeNcr
    ? Number((doeNcr.keroseneMax + appliedDoe.kero).toFixed(2))
    : Number((keroseneCommon + 12).toFixed(2));

  // Measure real regional offset vs NCR across GasWatch PH station dataset
  const regionBuckets: Record<'south_luzon' | 'north_luzon' | 'visayas' | 'mindanao', { g: number[]; d: number[] }> = {
    south_luzon: { g: [], d: [] },
    north_luzon: { g: [], d: [] },
    visayas: { g: [], d: [] },
    mindanao: { g: [], d: [] },
  };
  for (const s of gasWatch.stations) {
    const reg = classifyGasWatchRegion(s.area, s.lat);
    if (reg === 'ncr') continue;
    if (s.prices.unleaded) regionBuckets[reg].g.push(Number((s.prices.unleaded + appliedGw.gas).toFixed(2)));
    if (s.prices.diesel) regionBuckets[reg].d.push(Number((s.prices.diesel + appliedGw.diesel).toFixed(2)));
  }

  const regionalOffsetFor = (bucket: { g: number[]; d: number[] }) => ({
    gasolineOffset: bucket.g.length ? Number((median(bucket.g) - gwNcrUnleaded).toFixed(2)) : 0,
    dieselOffset: bucket.d.length ? Number((median(bucket.d) - gwNcrDiesel).toFixed(2)) : 0,
  });

  const southAdj = regionalOffsetFor(regionBuckets.south_luzon);
  const northAdj = regionalOffsetFor(regionBuckets.north_luzon);
  const visayasAdj = regionalOffsetFor(regionBuckets.visayas);
  const mindanaoAdj = regionalOffsetFor(regionBuckets.mindanao);

  // Build real 13-week historical pump chart anchored to GasWatch PRICE_HISTORY + DOE current benchmark
  const sortedGwHistory = [...gasWatch.history].sort((a, b) => a.week.localeCompare(b.week));
  const history: WeeklyHistoryPoint[] = sortedGwHistory.map((wk, idx) => {
    const prev = idx > 0 ? sortedGwHistory[idx - 1] : null;
    const tueMs = new Date(`${wk.week}T00:00:00+08:00`).getTime();
    const weekNews = allSortedItems.filter(
      (it) => it.pubMs >= tueMs - 5 * 24 * 3600 * 1000 && it.pubMs <= tueMs + 36 * 3600 * 1000
    );

    let newsGasDelta: number | undefined;
    let newsDieselDelta: number | undefined;
    let newsKeroDelta: number | undefined;
    let newsNote = '';

    for (const m of weekNews) {
      const parsed = extractFuelDeltasFromText(`${m.title}. ${m.description}`);
      if (parsed.gas !== undefined && newsGasDelta === undefined) newsGasDelta = parsed.gas;
      if (parsed.diesel !== undefined && newsDieselDelta === undefined) newsDieselDelta = parsed.diesel;
      if (parsed.kerosene !== undefined && newsKeroDelta === undefined) newsKeroDelta = parsed.kerosene;
      if (!newsNote && (parsed.gas !== undefined || parsed.diesel !== undefined)) {
        newsNote = m.title.replace(/\s+-\s+[^-]+$/, '').slice(0, 72);
      }
    }

    const avgGasDelta = prev ? Number((wk.unleadedAvg - prev.unleadedAvg).toFixed(2)) : 0;
    const avgDieselDelta = prev ? Number((wk.dieselAvg - prev.dieselAvg).toFixed(2)) : 0;
    const gD = newsGasDelta ?? avgGasDelta;
    const dD = newsDieselDelta ?? avgDieselDelta;
    const kD = newsKeroDelta ?? Number((dD * 1.1).toFixed(2));

    const dObj = new Date(`${wk.week}T00:00:00Z`);
    const label = dObj.toLocaleDateString('en-US', {
      month: 'short',
      day: '2-digit',
      timeZone: 'UTC',
    });

    const isLatestWeek = idx === sortedGwHistory.length - 1 && doeNcr && wk.week >= '2026-11-10';
    const weekGasAvg = isLatestWeek ? doeNcr.ron91Common : Number(wk.unleadedAvg.toFixed(2));
    const weekDieselAvg = isLatestWeek ? doeNcr.dieselCommon : Number(wk.dieselAvg.toFixed(2));

    return {
      effectiveDate: wk.week,
      label,
      gasolineDelta: gD,
      dieselDelta: dD,
      keroseneDelta: kD,
      gasolinePumpAvg: weekGasAvg,
      dieselPumpAvg: weekDieselAvg,
      kerosenePumpAvg: Number((weekDieselAvg + (keroseneCommon - dieselCommon)).toFixed(2)),
      note: newsNote || `DOE/GasWatch weekly average (${wk.label})`,
    };
  });

  const lastHist = history.at(-1);
  if (lastHist && lastHist.effectiveDate < targetTuesday) {
    const dObj = new Date(`${targetTuesday}T00:00:00Z`);
    const label = dObj.toLocaleDateString('en-US', {
      month: 'short',
      day: '2-digit',
      timeZone: 'UTC',
    });
    history.push({
      effectiveDate: targetTuesday,
      label,
      gasolineDelta: finalGasDelta,
      dieselDelta: finalDieselDelta,
      keroseneDelta: finalKeroDelta,
      gasolinePumpAvg: Number((lastHist.gasolinePumpAvg + finalGasDelta).toFixed(2)),
      dieselPumpAvg: Number((lastHist.dieselPumpAvg + finalDieselDelta).toFixed(2)),
      kerosenePumpAvg: Number((lastHist.kerosenePumpAvg + finalKeroDelta).toFixed(2)),
      note: hasAdvisory
        ? leadTitle.replace(/\s+-\s+[^-]+$/, '').slice(0, 72) || 'Latest Tuesday oil firm advisory'
        : 'Live MOPS/RBOB & ULSD benchmark projection',
    });
  }

  const allDown = finalGasDelta < -0.05 && finalDieselDelta < -0.05;
  const allUp = finalGasDelta > 0.05 && finalDieselDelta > 0.05;
  const direction: PriceDirection = allDown
    ? 'rollback'
    : allUp
      ? 'hike'
      : Math.abs(finalGasDelta) < 0.05 && Math.abs(finalDieselDelta) < 0.05
        ? 'unchanged'
        : 'mixed';

  const drivers: ForecastDriver[] = [
    {
      factor: 'Refined Gasoline Benchmark (RBOB / MOPS Mogas proxy)',
      impact: benchmarks.rbobWeeklyPct < -0.2 ? 'downward' : benchmarks.rbobWeeklyPct > 0.2 ? 'upward' : 'neutral',
      detail: `5-day refined gasoline benchmark shifted ${benchmarks.rbobWeeklyPct >= 0 ? '+' : ''}${benchmarks.rbobWeeklyPct.toFixed(2)}%, guiding MOPS 92/95 RON import parity.`,
      metric: `${benchmarks.rbobWeeklyPct >= 0 ? '+' : ''}${benchmarks.rbobWeeklyPct.toFixed(2)}% (5D)`,
    },
    {
      factor: 'Middle Distillates / Gasoil (ULSD / MOPS Diesel proxy)',
      impact: benchmarks.ulsdWeeklyPct < -0.2 ? 'downward' : benchmarks.ulsdWeeklyPct > 0.2 ? 'upward' : 'neutral',
      detail: `5-day gasoil benchmark moved ${benchmarks.ulsdWeeklyPct >= 0 ? '+' : ''}${benchmarks.ulsdWeeklyPct.toFixed(2)}%, driving local diesel and kerosene adjustments.`,
      metric: `${benchmarks.ulsdWeeklyPct >= 0 ? '+' : ''}${benchmarks.ulsdWeeklyPct.toFixed(2)}% (5D)`,
    },
    {
      factor: 'Global Brent Crude Supply & Risk Premium',
      impact: benchmarks.brentChangePct < -0.2 ? 'downward' : benchmarks.brentChangePct > 0.2 ? 'upward' : 'neutral',
      detail: `Brent crude spot trades at $${benchmarks.brentUsd.toFixed(2)}/bbl (${benchmarks.brentChangePct >= 0 ? '+' : ''}${benchmarks.brentChangePct.toFixed(2)}% daily), shaping Asian refinery crack spreads.`,
      metric: `$${benchmarks.brentUsd.toFixed(2)}/bbl`,
    },
    {
      factor: 'USD / PHP Peso Exchange Rate',
      impact: usdPhp >= 58.5 ? 'upward' : usdPhp <= 56.5 ? 'downward' : 'neutral',
      detail: `With USD/PHP at ₱${usdPhp.toFixed(2)}, peso movement scales every dollar swing in imported refined fuel.`,
      metric: `₱${usdPhp.toFixed(2)} / USD`,
    },
  ];

  const isTuesdayLive = cal.isEffectiveTuesdayNow;
  const headline =
    direction === 'rollback'
      ? `Pump Price Rollback ${isTuesdayLive ? 'Effective' : 'Expected for'} Tue ${targetTuesday}`
      : direction === 'hike'
        ? `Pump Price Hike ${isTuesdayLive ? 'Effective' : 'Projected for'} Tue ${targetTuesday}`
        : direction === 'mixed'
          ? `Mixed Fuel Adjustments ${isTuesdayLive ? 'Effective' : 'Set for'} Tue ${targetTuesday}`
          : `Flat Fuel Pricing Outlook for Tue ${targetTuesday}`;

  const summary = hasAdvisory
    ? `Confirmed Philippine oil company advisories implement Gasoline ${finalGasDelta >= 0 ? '+' : '-'}₱${Math.abs(finalGasDelta).toFixed(2)}/L, Diesel ${finalDieselDelta >= 0 ? '+' : '-'}₱${Math.abs(finalDieselDelta).toFixed(2)}/L, and Kerosene ${finalKeroDelta >= 0 ? '+' : '-'}₱${Math.abs(finalKeroDelta).toFixed(2)}/L effective Tuesday 06:00 AM PHT.`
    : `Based on live 5-day refined product futures and USD/PHP import parity, Tuesday adjustments are tracking Gasoline ${finalGasDelta >= 0 ? '+' : '-'}₱${Math.abs(finalGasDelta).toFixed(2)}/L and Diesel ${finalDieselDelta >= 0 ? '+' : '-'}₱${Math.abs(finalDieselDelta).toFixed(2)}/L.`;

  const explanation =
    (leadTitle ? `Latest advisory: "${leadTitle}". ` : '') +
    `Philippine oil companies reset pump prices every Tuesday at 06:00 AM using the previous trading week's Mean of Platts Singapore (MOPS) average converted via USD/PHP. Over the past 5 trading sessions, refined gasoline moved ${benchmarks.rbobWeeklyPct >= 0 ? '+' : ''}${benchmarks.rbobWeeklyPct.toFixed(2)}% and gasoil moved ${benchmarks.ulsdWeeklyPct >= 0 ? '+' : ''}${benchmarks.ulsdWeeklyPct.toFixed(2)}%, with Brent at $${benchmarks.brentUsd.toFixed(2)}/bbl and USD/PHP at ₱${usdPhp.toFixed(2)}. Prevailing benchmarks anchor directly to DOE's official retail monitoring report (${doeNcr ? `week ending ${doeNcr.weekEndIso}` : 'GasWatch station survey'}).`;

  const prediction: FuelPrediction = {
    targetTuesdayDate: targetTuesday,
    effectiveTime: '06:00 AM PHT',
    status: hasAdvisory ? 'confirmed_advisory' : 'mops_projection',
    direction,
    confidence: hasAdvisory ? 'high' : 'moderate',
    gasolineDelta: finalGasDelta,
    dieselDelta: finalDieselDelta,
    keroseneDelta: finalKeroDelta,
    headline,
    summary,
    explanation,
    drivers,
  };

  const nextWeekForecast = buildNextTuesdayForecast(benchmarks, cal);

  const prevailing: PrevailingPrices = {
    areaName: 'Metro Manila (DOE NCR)',
    effectiveDate: appliedDoe.gas !== 0 || appliedDoe.diesel !== 0 ? targetTuesday : doeNcr?.weekEndIso || gasWatch.lastUpdatedIso,
    gasolineCommon,
    gasolineMin: finalGasMin,
    gasolineMax: finalGasMax,
    ron91Common,
    ron95Common,
    ron97Common,
    dieselCommon,
    dieselMin: finalDieselMin,
    dieselMax: finalDieselMax,
    keroseneCommon,
    keroseneMin: finalKeroMin,
    keroseneMax: finalKeroMax,
    regionalAdjustments: [
      { region: 'Metro Manila (NCR)', gasolineOffset: 0, dieselOffset: 0, note: 'Official DOE NCR common price baseline' },
      { region: 'South Luzon (CALABARZON / Cavite / Bicol)', ...southAdj, note: 'Measured median spread vs NCR' },
      { region: 'North & Central Luzon', ...northAdj, note: 'Measured median spread vs NCR' },
      { region: 'Visayas (Cebu / Iloilo)', ...visayasAdj, note: 'Measured median spread vs NCR' },
      { region: 'Mindanao (Davao / CDO)', ...mindanaoAdj, note: 'Measured median spread vs NCR' },
    ],
  };

  const seenUrls = new Set<string>();
  const sources: GroundingSource[] = [];
  if (doeNcr) {
    seenUrls.add(doeNcr.sourceUrl);
    sources.push({
      title: `Department of Energy (DOE) NCR Retail Pump Prices (through ${doeNcr.weekEndIso})`,
      uri: doeNcr.sourceUrl,
    });
  }
  seenUrls.add('https://gaswatchph.com/');
  sources.push({
    title: `GasWatch PH Live Station Monitor (${gasWatch.stations.length.toLocaleString()} stations)`,
    uri: 'https://gaswatchph.com/',
  });

  for (const item of [...currentCycleItems, ...allSortedItems].slice(0, 6)) {
    if (item.link && !seenUrls.has(item.link)) {
      seenUrls.add(item.link);
      sources.push({ title: item.title, uri: item.link });
    }
  }

  return {
    fetchedAt: new Date().toISOString(),
    dataSource: doeNcr ? 'live_doe_pdf_and_feeds' : 'live_gaswatch_doe_feeds',
    prediction,
    nextWeekForecast,
    prevailing,
    history,
    benchmarks: {
      usdPhpRate: benchmarks.usdPhpRate,
      usdPhpUpdatedAt: benchmarks.usdPhpUpdatedAt,
      brentUsd: benchmarks.brentUsd,
      brentChangePct: benchmarks.brentChangePct,
      wtiUsd: benchmarks.wtiUsd,
      wtiChangePct: benchmarks.wtiChangePct,
      brentHistory: benchmarks.brentHistory,
      wtiHistory: benchmarks.wtiHistory,
    },
    sources,
  };
}

function extractJsonObject(raw: string): Record<string, unknown> {
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error('Failed to parse JSON from Gemini grounded response.');
  }
}

async function fetchGroundedDoeReport(benchmarks: ExtendedBenchmarks): Promise<LiveFuelReport> {
  if (!ai) {
    throw new Error('GEMINI_API_KEY is not configured.');
  }

  const cal = getManilaCalendar();
  const targetTuesday = cal.targetTuesdayIso;

  const prompt = `Today is ${cal.manilaIso}. The Philippine Tuesday fuel price adjustment date is ${targetTuesday}.
Current live market benchmarks:
- USD/PHP Exchange Rate: ${benchmarks.usdPhpRate}
- Brent Crude Spot: $${benchmarks.brentUsd}/bbl (${benchmarks.brentChangePct >= 0 ? '+' : ''}${benchmarks.brentChangePct}%)
- WTI Crude Spot: $${benchmarks.wtiUsd}/bbl

Use Google Search to gather REAL, CURRENT, VERIFIED Philippine Department of Energy (DOE) Oil Monitor announcements, Philippine news (Inquirer, Philstar, PNA, GMA News, Rappler, ABS-CBN), and oil company advisories for:
1. The fuel price adjustment effective on Tuesday ${targetTuesday} (gasolineDelta, dieselDelta, keroseneDelta in PHP/L).
2. Current prevailing Metro Manila (NCR) pump prices (gasolineCommon, gasolineMin, gasolineMax, ron91Common, ron95Common, ron97Common, dieselCommon, dieselMin, dieselMax, keroseneCommon, keroseneMin, keroseneMax) and regional differentials.
3. At least 10 recent weekly Tuesday effective dates leading up to ${targetTuesday} with real historical Peso/liter adjustments and prevailing NCR average pump prices.
4. Detailed analytical explanation of WHY this Tuesday movement is occurring.

Return ONLY a valid JSON object matching { prediction, prevailing, history }.`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      systemInstruction:
        'You are a Philippine petroleum market analyst sourcing live data exclusively from Google Search results. Return strictly valid JSON.',
    },
  });

  const text = response.text;
  if (!text) throw new Error('Empty response from Gemini Search grounding.');

  const parsed = extractJsonObject(text) as Pick<
    LiveFuelReport,
    'prediction' | 'prevailing' | 'history'
  >;

  const rawChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const sources: GroundingSource[] = [];
  const seenUris = new Set<string>();
  for (const chunk of rawChunks) {
    const uri = chunk?.web?.uri;
    const title = chunk?.web?.title;
    if (uri && !seenUris.has(uri)) {
      seenUris.add(uri);
      sources.push({ title: title || new URL(uri).hostname, uri });
    }
  }

  return {
    fetchedAt: new Date().toISOString(),
    dataSource: 'live_doe_gemini_search',
    prediction: parsed.prediction,
    nextWeekForecast: buildNextTuesdayForecast(benchmarks, cal),
    prevailing: parsed.prevailing,
    history: Array.isArray(parsed.history) ? parsed.history : [],
    benchmarks: {
      usdPhpRate: benchmarks.usdPhpRate,
      usdPhpUpdatedAt: benchmarks.usdPhpUpdatedAt,
      brentUsd: benchmarks.brentUsd,
      brentChangePct: benchmarks.brentChangePct,
      wtiUsd: benchmarks.wtiUsd,
      wtiChangePct: benchmarks.wtiChangePct,
      brentHistory: benchmarks.brentHistory,
      wtiHistory: benchmarks.wtiHistory,
    },
    sources,
  };
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return Number((R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(2));
}

function detectBrandAndTier(name: string, brandTag?: string): {
  brand: string;
  tier: 'major' | 'independent';
} {
  return canonicalBrandLabel(`${brandTag || ''} ${name}`);
}

interface NearbyRawStation {
  id: string;
  name: string;
  brand: string;
  brandTier: 'major' | 'independent';
  area?: string;
  address: string;
  distanceKm: number;
  lat: number;
  lng: number;
  liveGasoline?: number;
  liveRon95?: number;
  liveDiesel?: number;
  liveKerosene?: number;
}

async function queryNearbyStationsLive(
  lat: number,
  lng: number,
  radiusKm: number
): Promise<NearbyRawStation[]> {
  const cal = getManilaCalendar();
  const [gwRes, doeRes, newsItems] = await Promise.all([
    fetchLiveGasWatchData(false).catch(() => null),
    fetchLiveDoeNcrMonitor(false).catch(() => null),
    fetchGoogleNewsPhFuel('Philippines fuel price rollback OR hike gasoline diesel when:14d').catch(() => []),
  ]);

  const gasWatch = gwRes;
  const parsedNews = parseTuesdayWindowDeltas(newsItems, cal.targetTuesdayIso);
  const hasAdvisory = parsedNews.gasDelta !== undefined || parsedNews.dieselDelta !== undefined;

  let appliedGw = { gas: 0, diesel: 0, kero: 0 };
  if (gasWatch) {
    appliedGw = await computeEffectiveDeltasForReferenceDate(gasWatch.lastUpdatedIso, cal, {
      gas: hasAdvisory ? parsedNews.gasDelta : undefined,
      diesel: hasAdvisory ? parsedNews.dieselDelta : undefined,
      kero: hasAdvisory ? parsedNews.keroDelta : undefined,
    });
  }

  // Calibrate GasWatch station prices against official DOE NCR PDF Common Price when DOE PDF exists
  let gasCalibrationShift = 0;
  let dieselCalibrationShift = 0;
  if (gasWatch && doeRes) {
    const ncrStations = gasWatch.stations.filter((s) => classifyGasWatchRegion(s.area, s.lat) === 'ncr');
    const refStations = ncrStations.length >= 20 ? ncrStations : gasWatch.stations;
    const gwNcrU = median(refStations.map((s) => s.prices.unleaded).filter((v): v is number => v !== null));
    const gwNcrD = median(refStations.map((s) => s.prices.diesel).filter((v): v is number => v !== null));
    if (gwNcrU > 0 && doeRes.ron91Common > 0) {
      // Shift station baseline to match DOE official Common Price differential (keeps brand/station relative spreads intact)
      gasCalibrationShift = Number((doeRes.ron91Common - gwNcrU).toFixed(2));
    }
    if (gwNcrD > 0 && doeRes.dieselCommon > 0) {
      dieselCalibrationShift = Number((doeRes.dieselCommon - gwNcrD).toFixed(2));
    }
  }

  const results: NearbyRawStation[] = [];
  if (gasWatch) {
    for (const st of gasWatch.stations) {
      const dist = haversineKm(lat, lng, st.lat, st.lng);
      if (dist > radiusKm) continue;
      const { brand, tier } = canonicalBrandLabel(st.brand);

      const u = st.prices.unleaded
        ? Number((st.prices.unleaded + gasCalibrationShift + appliedGw.gas).toFixed(2))
        : undefined;
      const r95 = st.prices.premium95
        ? Number((st.prices.premium95 + gasCalibrationShift + appliedGw.gas).toFixed(2))
        : undefined;
      const d = st.prices.diesel
        ? Number((st.prices.diesel + dieselCalibrationShift + appliedGw.diesel).toFixed(2))
        : undefined;
      const k = st.prices.kerosene
        ? Number((st.prices.kerosene + appliedGw.kero).toFixed(2))
        : undefined;

      results.push({
        id: `gw-${st.id}`,
        name: st.name,
        brand,
        brandTier: tier,
        area: st.area,
        address: st.area ? `${st.area}, Philippines` : `${st.lat.toFixed(4)}, ${st.lng.toFixed(4)}`,
        distanceKm: dist,
        lat: st.lat,
        lng: st.lng,
        liveGasoline: u ?? r95,
        liveRon95: r95,
        liveDiesel: d,
        liveKerosene: k,
      });
    }
  }

  const localBrandMedians = new Map<string, { u: number[]; r95: number[]; d: number[]; k: number[] }>();
  for (const r of results) {
    const key = r.brand.toLowerCase();
    if (!localBrandMedians.has(key)) localBrandMedians.set(key, { u: [], r95: [], d: [], k: [] });
    const b = localBrandMedians.get(key)!;
    if (r.liveGasoline) b.u.push(r.liveGasoline);
    if (r.liveRon95) b.r95.push(r.liveRon95);
    if (r.liveDiesel) b.d.push(r.liveDiesel);
    if (r.liveKerosene) b.k.push(r.liveKerosene);
  }
  const allLocalU = results.map((r) => r.liveGasoline).filter((v): v is number => typeof v === 'number');
  const allLocalD = results.map((r) => r.liveDiesel).filter((v): v is number => typeof v === 'number');
  const localFallbackU = allLocalU.length ? median(allLocalU) : undefined;
  const localFallbackD = allLocalD.length ? median(allLocalD) : undefined;

  if (results.length < 18) {
    const deltaDeg = radiusKm / 111;
    const west = (lng - deltaDeg).toFixed(5);
    const east = (lng + deltaDeg).toFixed(5);
    const north = (lat + deltaDeg).toFixed(5);
    const south = (lat - deltaDeg).toFixed(5);

    const nomUrl = `https://nominatim.openstreetmap.org/search?q=fuel+station&format=jsonv2&addressdetails=1&viewbox=${west},${north},${east},${south}&bounded=1&limit=20`;
    const photonBrands = ['Petron', 'Shell', 'Caltex', 'Seaoil', 'Cleanfuel', 'Unioil'];

    const [nomRes, ...photonResponses] = await Promise.allSettled([
      fetchJsonWithTimeout(
        nomUrl,
        {
          headers: {
            'User-Agent': 'FuelPh/1.0 (https://github.com)',
            'Accept-Language': 'en',
          },
        },
        6000
      ),
      ...photonBrands.map((brand) =>
        fetchJsonWithTimeout(
          `https://photon.komoot.io/api/?q=${encodeURIComponent(brand)}&osm_tag=amenity:fuel&lat=${lat}&lon=${lng}&limit=5`,
          { headers: { 'User-Agent': 'FuelPh/1.0' } },
          4500
        )
      ),
    ]);

    const addIfNotDuplicate = (candidate: Omit<NearbyRawStation, 'liveGasoline' | 'liveRon95' | 'liveDiesel' | 'liveKerosene'>) => {
      const dup = results.some((existing) => haversineKm(existing.lat, existing.lng, candidate.lat, candidate.lng) < 0.14);
      if (dup) return;

      const bKey = candidate.brand.toLowerCase();
      const lb = localBrandMedians.get(bKey);
      const gwBrand = gasWatch?.brandAverages[bKey] || gasWatch?.brandAverages.default;

      const estU =
        lb && lb.u.length
          ? median(lb.u)
          : localFallbackU ??
            (gwBrand?.unleaded ? Number((gwBrand.unleaded + gasCalibrationShift + appliedGw.gas).toFixed(2)) : undefined);
      const estD =
        lb && lb.d.length
          ? median(lb.d)
          : localFallbackD ??
            (gwBrand?.diesel ? Number((gwBrand.diesel + dieselCalibrationShift + appliedGw.diesel).toFixed(2)) : undefined);

      results.push({
        ...candidate,
        liveGasoline: estU,
        liveDiesel: estD,
      });
    };

    if (nomRes.status === 'fulfilled' && Array.isArray(nomRes.value)) {
      for (const item of nomRes.value) {
        const sLat = Number(item.lat);
        const sLng = Number(item.lon);
        if (!Number.isFinite(sLat) || !Number.isFinite(sLng)) continue;
        const dist = haversineKm(lat, lng, sLat, sLng);
        if (dist > radiusKm) continue;
        const name = item.name || item.display_name?.split(',')[0] || 'Fuel Station';
        const { brand, tier } = detectBrandAndTier(name);
        const addrParts = [
          item.address?.road,
          item.address?.suburb || item.address?.neighbourhood || item.address?.city,
        ].filter(Boolean);
        addIfNotDuplicate({
          id: `${item.osm_type || 'osm'}-${item.osm_id || item.place_id}`,
          name,
          brand,
          brandTier: tier,
          address: addrParts.join(', ') || item.display_name?.split(',').slice(0, 3).join(',') || `${sLat.toFixed(4)}, ${sLng.toFixed(4)}`,
          distanceKm: dist,
          lat: sLat,
          lng: sLng,
        });
      }
    }

    for (const pRes of photonResponses) {
      if (pRes.status !== 'fulfilled' || !Array.isArray(pRes.value?.features)) continue;
      for (const f of pRes.value.features) {
        const coords = f.geometry?.coordinates;
        const props = f.properties || {};
        if (!Array.isArray(coords) || coords.length < 2) continue;
        const sLng = Number(coords[0]);
        const sLat = Number(coords[1]);
        if (!Number.isFinite(sLat) || !Number.isFinite(sLng)) continue;
        const dist = haversineKm(lat, lng, sLat, sLng);
        if (dist > radiusKm) continue;
        const name = props.name || 'Fuel Station';
        const { brand, tier } = detectBrandAndTier(name);
        const addr = [props.street, props.district || props.city || props.county]
          .filter(Boolean)
          .join(', ');
        addIfNotDuplicate({
          id: `${props.osm_type || 'ph'}-${props.osm_id || `${sLat.toFixed(4)}_${sLng.toFixed(4)}`}`,
          name,
          brand,
          brandTier: tier,
          address: addr || `${sLat.toFixed(4)}, ${sLng.toFixed(4)}`,
          distanceKm: dist,
          lat: sLat,
          lng: sLng,
        });
      }
    }
  }

  return results
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 30);
}

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/api/fuel/live', async (req, res) => {
    try {
      const forceRefresh = req.query.refresh === '1';
      if (!forceRefresh && liveReportCache && Date.now() < liveReportCache.expiresAt) {
        return res.json(liveReportCache.data);
      }

      const [benchmarks, gasWatchResult, doeNcrResult] = await Promise.all([
        fetchLiveMarketBenchmarks(),
        fetchLiveGasWatchData(forceRefresh).catch((err) => {
          console.warn('GasWatch PH feed warning:', err instanceof Error ? err.message : err);
          return null;
        }),
        fetchLiveDoeNcrMonitor(forceRefresh).catch(() => null),
      ]);

      let report: LiveFuelReport;
      if (gasWatchResult && gasWatchResult.stations.length > 0) {
        report = await buildLiveReportFromPublicFeeds(benchmarks, gasWatchResult, doeNcrResult);
      } else {
        report = await fetchGroundedDoeReport(benchmarks);
      }

      liveReportCache = {
        data: report,
        expiresAt: Date.now() + CACHE_TTL_MS,
      };

      res.json(report);
    } catch (err) {
      console.error('Error in /api/fuel/live:', err);
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Failed to load live Philippine fuel data.',
      });
    }
  });

  app.get('/api/fuel/nearby', async (req, res) => {
    try {
      const lat = Number(req.query.lat);
      const lng = Number(req.query.lng);
      const radiusKm = Math.min(Math.max(Number(req.query.radiusKm) || 6, 1), 25);

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return res.status(400).json({ error: 'Valid lat and lng query parameters are required.' });
      }

      const cacheKey = `${lat.toFixed(3)},${lng.toFixed(3)},${radiusKm}`;
      const cached = nearbyCache.get(cacheKey);
      if (cached && Date.now() < cached.expiresAt) {
        return res.json(cached.data);
      }

      const stations = await queryNearbyStationsLive(lat, lng, radiusKm);
      const payload = { stations, fetchedAt: new Date().toISOString() };
      nearbyCache.set(cacheKey, { data: payload, expiresAt: Date.now() + 15 * 60 * 1000 });
      res.json(payload);
    } catch (err) {
      console.error('Error in /api/fuel/nearby:', err);
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Failed to fetch nearby gas stations.',
      });
    }
  });

  app.get('/api/geocode/search', async (req, res) => {
    try {
      const q = String(req.query.q || '').trim();
      if (q.length < 2) {
        return res.json({ results: [] });
      }
      const url = `https://nominatim.openstreetmap.org/search?countrycodes=ph&format=jsonv2&addressdetails=1&limit=6&q=${encodeURIComponent(
        q
      )}`;
      const items = await fetchJsonWithTimeout(url, {
        headers: {
          'User-Agent': 'FuelPh/1.0 (https://github.com)',
          'Accept-Language': 'en',
        },
      });
      res.json({ results: Array.isArray(items) ? items : [] });
    } catch (err) {
      console.error('Error in /api/geocode/search:', err);
      res.status(502).json({ error: 'Location search failed.' });
    }
  });

  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    app.get('/manifest.webmanifest', (_req, res) => {
      res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
      res.json({
        id: '/',
        name: 'FuelPh — Philippines Fuel Price Monitor',
        short_name: 'FuelPh',
        description:
          'Live Philippine fuel price tracker, Tuesday pump price predictions with MOPS & DOE analysis, and nearby station pricing.',
        theme_color: '#0F172A',
        background_color: '#090D16',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      });
    });

    app.get('/favicon.ico', (_req, res) => {
      const iconPath = path.resolve(__dirname, 'public', 'pwa-192x192.png');
      if (fs.existsSync(iconPath)) {
        res.setHeader('Content-Type', 'image/png');
        return res.sendFile(iconPath);
      }
      return res.status(204).end();
    });

    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`FuelPh server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server error:', err);
  process.exit(1);
});
