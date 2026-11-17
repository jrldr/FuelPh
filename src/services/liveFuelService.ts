import type {
  LiveFuelReport,
  NearbyStation,
  PrevailingPrices,
  StationPriceReport,
  UserLocation,
} from '../types/fuel';

const SESSION_CACHE_KEY = 'fuelph-live-cache-v3';

export async function fetchLiveFuelReport(forceRefresh = false): Promise<LiveFuelReport> {
  if (!forceRefresh) {
    try {
      const cachedRaw = sessionStorage.getItem(SESSION_CACHE_KEY);
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw) as { report: LiveFuelReport; expiresAt: number };
        if (
          Date.now() < cached.expiresAt &&
          cached.report?.prediction &&
          cached.report?.nextWeekForecast
        ) {
          return cached.report;
        }
      }
    } catch {
      // ignore session storage errors
    }
  }

  // 1. Primary: Live Express server (GasWatch PH + Google News PH RSS + Yahoo Finance + OpenER API)
  try {
    const endpoint = forceRefresh ? './api/fuel/live?refresh=1' : './api/fuel/live';
    const res = await fetch(endpoint, { headers: { Accept: 'application/json' } });
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      const report = (await res.json()) as LiveFuelReport;
      try {
        sessionStorage.setItem(
          SESSION_CACHE_KEY,
          JSON.stringify({ report, expiresAt: Date.now() + 8 * 60 * 1000 })
        );
      } catch {
        // ignore storage quota
      }
      return report;
    }
  } catch {
    // Fall through to static GitHub Pages snapshot + live browser FX refresh
  }

  // 2. GitHub Pages Static Hosting Mode: load synced live snapshot + live browser USD/PHP FX
  const snapshotRes = await fetch('./data/fuel-live.json', {
    headers: { Accept: 'application/json' },
  });
  if (!snapshotRes.ok) {
    throw new Error(
      'Unable to reach live fuel data service. Please verify network connectivity and retry.'
    );
  }
  const snapshot = (await snapshotRes.json()) as LiveFuelReport;

  // Refresh USD/PHP FX live in browser via CORS-enabled Open Exchange Rates API
  try {
    const fxRes = await fetch('https://open.er-api.com/v6/latest/USD');
    if (fxRes.ok) {
      const fxData = await fxRes.json();
      if (typeof fxData?.rates?.PHP === 'number') {
        snapshot.benchmarks.usdPhpRate = Number(fxData.rates.PHP.toFixed(3));
        snapshot.benchmarks.usdPhpUpdatedAt = fxData.time_last_update_utc
          ? new Date(fxData.time_last_update_utc).toISOString()
          : new Date().toISOString();
      }
    }
  } catch {
    // keep snapshot FX if offline
  }

  return snapshot;
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
  const combined = `${brandTag || ''} ${name}`.toLowerCase();
  if (combined.includes('petron')) return { brand: 'Petron', tier: 'major' };
  if (combined.includes('shell')) return { brand: 'Shell', tier: 'major' };
  if (combined.includes('caltex')) return { brand: 'Caltex', tier: 'major' };
  if (combined.includes('total')) return { brand: 'TotalEnergies', tier: 'major' };
  if (combined.includes('seaoil')) return { brand: 'Seaoil', tier: 'independent' };
  if (combined.includes('cleanfuel')) return { brand: 'Cleanfuel', tier: 'independent' };
  if (combined.includes('unioil')) return { brand: 'Unioil', tier: 'independent' };
  if (combined.includes('phoenix')) return { brand: 'Phoenix', tier: 'independent' };
  if (combined.includes('jetti')) return { brand: 'Jetti', tier: 'independent' };
  if (combined.includes('flying v') || combined.includes('flyingv')) {
    return { brand: 'Flying V', tier: 'independent' };
  }
  if (combined.includes('ptt')) return { brand: 'PTT', tier: 'independent' };
  if (combined.includes('rephil')) return { brand: 'Rephil', tier: 'independent' };
  if (combined.includes('petro gazz') || combined.includes('petrogazz')) {
    return { brand: 'Petro Gazz', tier: 'independent' };
  }
  return { brand: brandTag || 'Local Station', tier: 'independent' };
}

export function getRegionalOffset(
  region: string,
  prevailing: PrevailingPrices
): { gasOffset: number; dieselOffset: number } {
  const norm = region.toLowerCase();
  for (const adj of prevailing.regionalAdjustments || []) {
    const r = adj.region.toLowerCase();
    if (
      (norm.includes('metro manila') || norm.includes('ncr')) &&
      (r.includes('ncr') || r.includes('metro manila'))
    ) {
      return { gasOffset: adj.gasolineOffset, dieselOffset: adj.dieselOffset };
    }
    if (
      norm.includes('cavite') ||
      norm.includes('laguna') ||
      norm.includes('batangas') ||
      norm.includes('rizal') ||
      norm.includes('quezon') ||
      norm.includes('calabarzon') ||
      norm.includes('bicol') ||
      norm.includes('south luzon')
    ) {
      if (r.includes('south luzon') || r.includes('calabarzon')) {
        return { gasOffset: adj.gasolineOffset, dieselOffset: adj.dieselOffset };
      }
    }
    if (norm.includes('mindanao') || norm.includes('davao') || norm.includes('cagayan de oro')) {
      if (r.includes('mindanao')) {
        return { gasOffset: adj.gasolineOffset, dieselOffset: adj.dieselOffset };
      }
    }
    if (norm.includes('visayas') || norm.includes('cebu') || norm.includes('iloilo')) {
      if (r.includes('visayas')) {
        return { gasOffset: adj.gasolineOffset, dieselOffset: adj.dieselOffset };
      }
    }
    if (norm.includes('luzon') || norm.includes('central luzon')) {
      if (r.includes('north') || r.includes('central luzon')) {
        return { gasOffset: adj.gasolineOffset, dieselOffset: adj.dieselOffset };
      }
    }
  }
  return { gasOffset: 0, dieselOffset: 0 };
}

function deriveDynamicRegionalBand(
  baseCommon: number,
  minPrice: number,
  maxPrice: number,
  tier: 'major' | 'independent',
  regionalOffset: number
): number {
  const upperQuartileShift = Math.max(0, (maxPrice - baseCommon) * 0.25);
  const lowerQuartileShift = Math.max(0, (baseCommon - minPrice) * 0.35);
  const raw =
    tier === 'major'
      ? baseCommon + upperQuartileShift + regionalOffset
      : baseCommon - lowerQuartileShift + regionalOffset;
  return Number(Math.max(minPrice + regionalOffset, Math.min(maxPrice + regionalOffset, raw)).toFixed(2));
}

interface RawStationPayload {
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

interface CompactStaticStation {
  id: string;
  name: string;
  brand: string;
  brandTier: 'major' | 'independent';
  area?: string;
  lat: number;
  lng: number;
  u: number | null;
  r95: number | null;
  d: number | null;
  k: number | null;
}

export async function fetchNearbyStations(
  location: UserLocation,
  prevailing: PrevailingPrices,
  userReports: Record<string, StationPriceReport>,
  radiusKm = 6
): Promise<NearbyStation[]> {
  let rawStations: RawStationPayload[] = [];

  // 1. Try server endpoint first (combines GasWatch PH 1,811 stations + Nominatim + Photon)
  let loadedFromServer = false;
  try {
    const res = await fetch(
      `./api/fuel/nearby?lat=${location.lat}&lng=${location.lng}&radiusKm=${radiusKm}`,
      { headers: { Accept: 'application/json' } }
    );
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      const data = await res.json();
      if (Array.isArray(data.stations)) {
        rawStations = data.stations as RawStationPayload[];
        loadedFromServer = true;
      }
    }
  } catch {
    // Fall back to static GitHub Pages station catalog + OSM
  }

  // 2. GitHub Pages static fallback: load synced GasWatch stations + supplement with OSM
  if (!loadedFromServer) {
    try {
      const gwRes = await fetch('./data/stations-live.json', {
        headers: { Accept: 'application/json' },
      });
      if (gwRes.ok) {
        const gwJson = (await gwRes.json()) as { stations?: CompactStaticStation[] };
        for (const st of gwJson.stations || []) {
          const dist = haversineKm(location.lat, location.lng, st.lat, st.lng);
          if (dist > radiusKm) continue;
          rawStations.push({
            id: st.id,
            name: st.name,
            brand: st.brand,
            brandTier: st.brandTier,
            area: st.area,
            address: st.area ? `${st.area}, Philippines` : `${st.lat.toFixed(4)}, ${st.lng.toFixed(4)}`,
            distanceKm: dist,
            lat: st.lat,
            lng: st.lng,
            liveGasoline: st.u ?? st.r95 ?? undefined,
            liveRon95: st.r95 ?? undefined,
            liveDiesel: st.d ?? undefined,
            liveKerosene: st.k ?? undefined,
          });
        }
      }
    } catch {
      // ignore if static station catalog not built yet
    }

    if (rawStations.length < 15) {
      const deltaDeg = radiusKm / 111;
      const west = (location.lng - deltaDeg).toFixed(5);
      const east = (location.lng + deltaDeg).toFixed(5);
      const north = (location.lat + deltaDeg).toFixed(5);
      const south = (location.lat - deltaDeg).toFixed(5);

      const nomUrl = `https://nominatim.openstreetmap.org/search?q=fuel+station&format=jsonv2&addressdetails=1&viewbox=${west},${north},${east},${south}&bounded=1&limit=20`;
      const photonBrands = ['Petron', 'Shell', 'Caltex', 'Seaoil', 'Cleanfuel', 'Unioil'];

      const [nomRes, ...photonResponses] = await Promise.allSettled([
        fetch(nomUrl, { headers: { 'Accept-Language': 'en' } }).then((r) => r.json()),
        ...photonBrands.map((brand) =>
          fetch(
            `https://photon.komoot.io/api/?q=${encodeURIComponent(brand)}&osm_tag=amenity:fuel&lat=${location.lat}&lon=${location.lng}&limit=5`
          ).then((r) => r.json())
        ),
      ]);

      const addOsmIfNew = (item: RawStationPayload) => {
        const dup = rawStations.some(
          (existing) => haversineKm(existing.lat, existing.lng, item.lat, item.lng) < 0.14
        );
        if (!dup) rawStations.push(item);
      };

      if (nomRes.status === 'fulfilled' && Array.isArray(nomRes.value)) {
        for (const item of nomRes.value) {
          const sLat = Number(item.lat);
          const sLng = Number(item.lon);
          if (!Number.isFinite(sLat) || !Number.isFinite(sLng)) continue;
          const dist = haversineKm(location.lat, location.lng, sLat, sLng);
          if (dist > radiusKm) continue;
          const name = item.name || item.display_name?.split(',')[0] || 'Fuel Station';
          const { brand, tier } = detectBrandAndTier(name);
          const addr = [
            item.address?.road,
            item.address?.suburb || item.address?.neighbourhood || item.address?.city,
          ]
            .filter(Boolean)
            .join(', ');
          addOsmIfNew({
            id: `${item.osm_type || 'osm'}-${item.osm_id || item.place_id}`,
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

      for (const pRes of photonResponses) {
        if (pRes.status !== 'fulfilled' || !Array.isArray(pRes.value?.features)) continue;
        for (const f of pRes.value.features) {
          const coords = f.geometry?.coordinates;
          const props = f.properties || {};
          if (!Array.isArray(coords) || coords.length < 2) continue;
          const sLng = Number(coords[0]);
          const sLat = Number(coords[1]);
          if (!Number.isFinite(sLat) || !Number.isFinite(sLng)) continue;
          const dist = haversineKm(location.lat, location.lng, sLat, sLng);
          if (dist > radiusKm) continue;
          const name = props.name || 'Fuel Station';
          const { brand, tier } = detectBrandAndTier(name);
          const addr = [props.street, props.district || props.city || props.county]
            .filter(Boolean)
            .join(', ');
          addOsmIfNew({
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

    rawStations = rawStations
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 30);
  }

  const { gasOffset, dieselOffset } = getRegionalOffset(
    `${location.region} ${location.province} ${location.city}`,
    prevailing
  );

  return rawStations.map((st) => {
    const userLog = userReports[st.id];
    const hasRealStationPrices =
      typeof st.liveGasoline === 'number' || typeof st.liveDiesel === 'number';

    const estimatedGasoline =
      typeof st.liveGasoline === 'number'
        ? st.liveGasoline
        : deriveDynamicRegionalBand(
            prevailing.gasolineCommon,
            prevailing.gasolineMin,
            prevailing.gasolineMax,
            st.brandTier,
            gasOffset
          );
    const estimatedDiesel =
      typeof st.liveDiesel === 'number'
        ? st.liveDiesel
        : deriveDynamicRegionalBand(
            prevailing.dieselCommon,
            prevailing.dieselMin,
            prevailing.dieselMax,
            st.brandTier,
            dieselOffset
          );
    const estimatedKerosene =
      typeof st.liveKerosene === 'number'
        ? st.liveKerosene
        : deriveDynamicRegionalBand(
            prevailing.keroseneCommon,
            prevailing.keroseneMin,
            prevailing.keroseneMax,
            st.brandTier,
            dieselOffset
          );

    const isUserVerified = Boolean(
      userLog && (userLog.gasoline || userLog.diesel || userLog.kerosene)
    );

    return {
      id: st.id,
      name: st.name,
      brand: st.brand,
      brandTier: st.brandTier,
      area: st.area,
      address: st.address,
      distanceKm: st.distanceKm,
      lat: st.lat,
      lng: st.lng,
      estimatedGasoline,
      estimatedRon95: typeof st.liveRon95 === 'number' ? st.liveRon95 : undefined,
      estimatedDiesel,
      estimatedKerosene,
      reportedGasoline: userLog?.gasoline,
      reportedDiesel: userLog?.diesel,
      reportedKerosene: userLog?.kerosene,
      reportedUpdatedAt: userLog?.updatedAt,
      isUserVerified,
      priceSource: isUserVerified
        ? 'user_verified'
        : hasRealStationPrices
          ? 'gaswatch_doe'
          : 'regional_estimate',
    };
  });
}

export async function reverseGeocodeCoords(lat: number, lng: number): Promise<UserLocation> {
  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`;
  const res = await fetch(url);
  if (!res.ok) {
    return {
      lat,
      lng,
      city: 'Current Coordinates',
      province: 'Philippines',
      region: 'Philippines',
      displayName: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
      source: 'gps',
    };
  }
  const data = await res.json();
  const city = data.city || data.locality || data.principalSubdivision || 'Philippines';
  const province = data.principalSubdivision || 'Philippines';
  const region =
    data.localityInfo?.administrative?.find((a: { adminLevel?: number; name?: string }) => a.adminLevel === 3)
      ?.name || province;

  return {
    lat,
    lng,
    city,
    province,
    region,
    displayName: [data.locality, data.city !== data.locality ? data.city : '', province]
      .filter(Boolean)
      .join(', '),
    source: 'gps',
  };
}

export interface PhilippinePlaceResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  address?: {
    city?: string;
    town?: string;
    municipality?: string;
    state?: string;
    region?: string;
    province?: string;
  };
}

export async function searchPhilippineLocations(query: string): Promise<PhilippinePlaceResult[]> {
  if (query.trim().length < 2) return [];

  try {
    const res = await fetch(`./api/geocode/search?q=${encodeURIComponent(query)}`, {
      headers: { Accept: 'application/json' },
    });
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      const data = await res.json();
      if (Array.isArray(data.results)) return data.results;
    }
  } catch {
    // Fall back to direct Nominatim call for GitHub Pages static mode
  }

  const nomUrl = `https://nominatim.openstreetmap.org/search?countrycodes=ph&format=jsonv2&addressdetails=1&limit=6&q=${encodeURIComponent(
    query
  )}`;
  const nomRes = await fetch(nomUrl, { headers: { 'Accept-Language': 'en' } });
  if (!nomRes.ok) return [];
  const items = await nomRes.json();
  return Array.isArray(items) ? items : [];
}
