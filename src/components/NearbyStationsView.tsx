import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Compass,
  ExternalLink,
  Loader2,
  MapPin,
  Navigation,
  PenLine,
  Search,
  X,
} from 'lucide-react';
import {
  fetchNearbyStations,
  type PhilippinePlaceResult,
  reverseGeocodeCoords,
  searchPhilippineLocations,
} from '../services/liveFuelService';
import type {
  FuelType,
  NearbyStation,
  PrevailingPrices,
  StationPriceReport,
  UserLocation,
} from '../types/fuel';

interface NearbyStationsViewProps {
  prevailing: PrevailingPrices;
  savedLocation: UserLocation | null;
  onSaveLocation: (loc: UserLocation) => void;
  preferredFuel: FuelType;
  stationReports: Record<string, StationPriceReport>;
  onReportPrice: (stationId: string, report: Omit<StationPriceReport, 'updatedAt'>) => void;
}

function getBrandBadgeStyle(brand: string): { code: string; className: string } {
  const b = brand.toLowerCase();
  if (b.includes('petron')) {
    return {
      code: 'PT',
      className: 'bg-blue-50 text-blue-700 border-blue-200/80 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800/70',
    };
  }
  if (b.includes('shell')) {
    return {
      code: 'SH',
      className: 'bg-amber-50 text-amber-700 border-amber-200/80 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800/70',
    };
  }
  if (b.includes('caltex')) {
    return {
      code: 'CX',
      className: 'bg-rose-50 text-rose-700 border-rose-200/80 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800/70',
    };
  }
  if (b.includes('total')) {
    return {
      code: 'TT',
      className: 'bg-sky-50 text-sky-700 border-sky-200/80 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-800/70',
    };
  }
  if (b.includes('seaoil')) {
    return {
      code: 'SE',
      className: 'bg-orange-50 text-orange-700 border-orange-200/80 dark:bg-orange-950/50 dark:text-orange-300 dark:border-orange-800/70',
    };
  }
  if (b.includes('cleanfuel')) {
    return {
      code: 'CF',
      className: 'bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800/70',
    };
  }
  if (b.includes('unioil')) {
    return {
      code: 'UN',
      className: 'bg-teal-50 text-teal-700 border-teal-200/80 dark:bg-teal-950/50 dark:text-teal-300 dark:border-teal-800/70',
    };
  }
  const letters = brand.replace(/[^a-zA-Z]/g, '').slice(0, 2).toUpperCase() || 'ST';
  return {
    code: letters,
    className: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
  };
}

export const NearbyStationsView: React.FC<NearbyStationsViewProps> = ({
  prevailing,
  savedLocation,
  onSaveLocation,
  preferredFuel,
  stationReports,
  onReportPrice,
}) => {
  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState<PhilippinePlaceResult[]>([]);
  const [searchingPlace, setSearchingPlace] = useState(false);

  const [locatingGps, setLocatingGps] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  const [stations, setStations] = useState<NearbyStation[]>([]);
  const [loadingStations, setLoadingStations] = useState(false);
  const [stationsError, setStationsError] = useState<string | null>(null);

  const [radiusKm, setRadiusKm] = useState<number>(6);
  const [fuelFilter, setFuelFilter] = useState<FuelType>(preferredFuel);
  const [tierFilter, setTierFilter] = useState<'all' | 'major' | 'independent'>('all');
  const [sortBy, setSortBy] = useState<'distance' | 'price'>('price');

  const [reportingStation, setReportingStation] = useState<NearbyStation | null>(null);
  const [reportGasInput, setReportGasInput] = useState('');
  const [reportDieselInput, setReportDieselInput] = useState('');
  const [reportKeroInput, setReportKeroInput] = useState('');

  useEffect(() => {
    setFuelFilter(preferredFuel);
  }, [preferredFuel]);

  useEffect(() => {
    if (!savedLocation) return;
    let cancelled = false;
    setLoadingStations(true);
    setStationsError(null);

    fetchNearbyStations(savedLocation, prevailing, stationReports, radiusKm)
      .then((list) => {
        if (!cancelled) setStations(list);
      })
      .catch((err) => {
        if (!cancelled) {
          setStationsError(
            err instanceof Error ? err.message : 'Unable to fetch nearby fuel stations.'
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingStations(false);
      });

    return () => {
      cancelled = true;
    };
  }, [savedLocation, prevailing, stationReports, radiusKm]);

  useEffect(() => {
    const q = searchText.trim();
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      setSearchingPlace(true);
      searchPhilippineLocations(q)
        .then(setSearchResults)
        .catch(() => setSearchResults([]))
        .finally(() => setSearchingPlace(false));
    }, 350);
    return () => clearTimeout(timer);
  }, [searchText]);

  const handleRequestGps = () => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported by your browser. Search a city below.');
      return;
    }
    setLocatingGps(true);
    setLocationError(null);

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const loc = await reverseGeocodeCoords(pos.coords.latitude, pos.coords.longitude);
          onSaveLocation(loc);
        } catch {
          onSaveLocation({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            city: 'GPS Location',
            province: 'Philippines',
            region: 'Philippines',
            displayName: `${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`,
            source: 'gps',
          });
        } finally {
          setLocatingGps(false);
        }
      },
      (err) => {
        setLocatingGps(false);
        if (err.code === err.PERMISSION_DENIED) {
          setLocationError('Location permission was denied. Search your Philippine city or barangay instead.');
        } else {
          setLocationError('Could not determine GPS position. Search your city or barangay below.');
        }
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handlePickPlace = (place: PhilippinePlaceResult) => {
    const lat = Number(place.lat);
    const lng = Number(place.lon);
    const city =
      place.address?.city ||
      place.address?.town ||
      place.address?.municipality ||
      place.display_name.split(',')[0];
    const province = place.address?.province || place.address?.state || 'Philippines';
    const region = place.address?.region || province;

    onSaveLocation({
      lat,
      lng,
      city,
      province,
      region,
      displayName: place.display_name.split(',').slice(0, 3).join(','),
      source: 'search',
    });
    setSearchText('');
    setSearchResults([]);
    setLocationError(null);
  };

  const getActivePrice = (st: NearbyStation, fuel: FuelType) => {
    if (fuel === 'gasoline') return st.reportedGasoline ?? st.estimatedGasoline;
    if (fuel === 'diesel') return st.reportedDiesel ?? st.estimatedDiesel;
    return st.reportedKerosene ?? st.estimatedKerosene;
  };

  const visibleStations = useMemo(() => {
    return stations
      .filter((st) => tierFilter === 'all' || st.brandTier === tierFilter)
      .sort((a, b) => {
        if (sortBy === 'price') {
          return getActivePrice(a, fuelFilter) - getActivePrice(b, fuelFilter);
        }
        return a.distanceKm - b.distanceKm;
      });
  }, [stations, tierFilter, sortBy, fuelFilter]);

  const priceStats = useMemo(() => {
    if (visibleStations.length === 0) return { min: 0, max: 0, span: 1 };
    const vals = visibleStations.map((st) => getActivePrice(st, fuelFilter));
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    return { min, max, span: Math.max(0.5, max - min) };
  }, [visibleStations, fuelFilter]);

  const openReportModal = (st: NearbyStation) => {
    setReportingStation(st);
    setReportGasInput(String(st.reportedGasoline ?? st.estimatedGasoline));
    setReportDieselInput(String(st.reportedDiesel ?? st.estimatedDiesel));
    setReportKeroInput(String(st.reportedKerosene ?? st.estimatedKerosene));
  };

  const submitPriceReport = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportingStation) return;
    const gas = Number(reportGasInput);
    const diesel = Number(reportDieselInput);
    const kero = Number(reportKeroInput);
    onReportPrice(reportingStation.id, {
      gasoline: Number.isFinite(gas) && gas > 0 ? Number(gas.toFixed(2)) : undefined,
      diesel: Number.isFinite(diesel) && diesel > 0 ? Number(diesel.toFixed(2)) : undefined,
      kerosene: Number.isFinite(kero) && kero > 0 ? Number(kero.toFixed(2)) : undefined,
    });
    setReportingStation(null);
  };

  return (
    <section aria-labelledby="nearby-heading" className="space-y-6">
      <div className="rounded-xl border border-slate-200/90 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)] dark:border-slate-800 dark:bg-[#0F1522]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2
              id="nearby-heading"
              className="text-lg font-bold tracking-tight text-slate-950 dark:text-white"
            >
              Nearby Fuel Stations & Local Pump Estimates
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Physical stations from OpenStreetMap calibrated against official DOE NCR & regional price spreads
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleRequestGps}
              disabled={locatingGps}
              className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap"
            >
              {locatingGps ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Compass className="h-4 w-4" aria-hidden="true" />
              )}
              <span>{locatingGps ? 'Detecting GPS...' : 'Use My GPS Location'}</span>
            </button>
          </div>
        </div>

        {/* Location Search Box */}
        <div className="relative mt-5">
          <label htmlFor="ph-location-search" className="sr-only">
            Search Philippine city, municipality, or barangay
          </label>
          <div className="relative flex items-center">
            <Search
              className="pointer-events-none absolute left-3.5 h-4 w-4 text-slate-400"
              aria-hidden="true"
            />
            <input
              id="ph-location-search"
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search any Philippine city or barangay (e.g., Bacoor Cavite, Makati, Cebu, Davao)..."
              className="min-h-[44px] w-full rounded-lg border border-slate-200 bg-slate-50/70 pl-10 pr-10 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700/80 dark:bg-[#151D2E] dark:text-slate-100 dark:focus:border-blue-500 dark:focus:bg-[#0F1522]"
            />
            {searchingPlace && (
              <Loader2 className="absolute right-3.5 h-4 w-4 animate-spin text-slate-400" />
            )}
          </div>

          {searchResults.length > 0 && (
            <ul
              role="listbox"
              className="absolute z-30 mt-1.5 w-full divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:divide-slate-800 dark:border-slate-700 dark:bg-[#0F1522]"
            >
              {searchResults.map((place) => (
                <li key={place.place_id}>
                  <button
                    type="button"
                    onClick={() => handlePickPlace(place)}
                    className="flex min-h-[44px] w-full items-center gap-2.5 px-4 py-2.5 text-left text-xs text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-[#151D2E]"
                  >
                    <MapPin className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
                    <span className="truncate">{place.display_name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {locationError && (
          <p className="mt-3 text-xs font-medium text-rose-700 dark:text-rose-400">
            {locationError}
          </p>
        )}

        {/* Active Location & Filter Controls */}
        {savedLocation ? (
          <div className="mt-5 flex flex-col gap-4 border-t border-slate-200/80 pt-5 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
            <div className="text-xs text-slate-600 dark:text-slate-300">
              <span className="font-semibold text-slate-950 dark:text-white">
                {savedLocation.displayName}
              </span>
              <span className="mx-2 text-slate-300 dark:text-slate-700">·</span>
              <span className="font-mono-tabular text-slate-500 dark:text-slate-400">
                {savedLocation.lat.toFixed(4)}, {savedLocation.lng.toFixed(4)}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Fuel grade filter"
                value={fuelFilter}
                onChange={(e) => setFuelFilter(e.target.value as FuelType)}
                className="min-h-[38px] rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-medium text-slate-800 dark:border-slate-700/80 dark:bg-[#151D2E] dark:text-slate-100"
              >
                <option value="gasoline">Gasoline</option>
                <option value="diesel">Diesel</option>
                <option value="kerosene">Kerosene</option>
              </select>

              <select
                aria-label="Brand tier filter"
                value={tierFilter}
                onChange={(e) => setTierFilter(e.target.value as 'all' | 'major' | 'independent')}
                className="min-h-[38px] rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-medium text-slate-800 dark:border-slate-700/80 dark:bg-[#151D2E] dark:text-slate-100"
              >
                <option value="all">All Brands</option>
                <option value="independent">Independent / Value</option>
                <option value="major">Major Oil Players</option>
              </select>

              <select
                aria-label="Search radius"
                value={radiusKm}
                onChange={(e) => setRadiusKm(Number(e.target.value))}
                className="min-h-[38px] rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-medium text-slate-800 dark:border-slate-700/80 dark:bg-[#151D2E] dark:text-slate-100"
              >
                <option value={3}>Within 3 km</option>
                <option value={6}>Within 6 km</option>
                <option value={12}>Within 12 km</option>
              </select>

              <select
                aria-label="Sort stations"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'distance' | 'price')}
                className="min-h-[38px] rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-medium text-slate-800 dark:border-slate-700/80 dark:bg-[#151D2E] dark:text-slate-100"
              >
                <option value="price">Lowest Price</option>
                <option value="distance">Nearest First</option>
              </select>
            </div>
          </div>
        ) : (
          <div className="mt-6 rounded-lg border border-dashed border-slate-300/90 p-8 text-center dark:border-slate-700">
            <MapPin className="mx-auto h-7 w-7 text-slate-400" aria-hidden="true" />
            <h3 className="mt-3 text-sm font-semibold text-slate-950 dark:text-white">
              Share your location to inspect nearby pump prices
            </h3>
            <p className="mx-auto mt-1 max-w-md text-xs text-slate-500 dark:text-slate-400">
              Tap Use My GPS Location or search a Philippine city above. FuelPh locates real stations nearby and applies regional DOE price spreads.
            </p>
          </div>
        )}

        {/* Station List */}
        {savedLocation && (
          <div className="mt-5">
            {loadingStations ? (
              <div className="space-y-3 py-6">
                {[1, 2, 3, 4].map((n) => (
                  <div
                    key={n}
                    className="h-20 animate-pulse rounded-lg bg-slate-100 dark:bg-[#151D2E]"
                  />
                ))}
              </div>
            ) : stationsError ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
                {stationsError}
              </div>
            ) : visibleStations.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                No stations matched your filters within {radiusKm} km. Try expanding the radius to 12 km.
              </div>
            ) : (
              <div className="divide-y divide-slate-200/70 border-t border-slate-200/80 dark:divide-slate-800/80 dark:border-slate-800">
                {visibleStations.map((st) => {
                  const activePrice = getActivePrice(st, fuelFilter);
                  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${st.lat},${st.lng}`;
                  const badge = getBrandBadgeStyle(st.brand);
                  const relPct = Math.min(
                    100,
                    Math.max(12, ((activePrice - priceStats.min) / priceStats.span) * 100)
                  );
                  const meterColor =
                    relPct <= 35
                      ? 'bg-emerald-600 dark:bg-emerald-500'
                      : relPct <= 70
                        ? 'bg-amber-400'
                        : 'bg-rose-600 dark:bg-rose-500';

                  return (
                    <div
                      key={st.id}
                      className="flex flex-col gap-3 py-4 transition-colors sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex min-w-0 flex-1 items-start gap-3.5">
                        <div
                          aria-hidden="true"
                          className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border font-display text-xs font-bold tracking-tight ${badge.className}`}
                        >
                          {badge.code}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="text-sm font-semibold text-slate-950 dark:text-white">
                              {st.name}
                            </span>
                            <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">·</span>
                            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                              {st.brand}
                            </span>
                            <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">·</span>
                            <span className="font-mono-tabular text-xs text-slate-500 dark:text-slate-400">
                              {st.distanceKm.toFixed(1)} km
                            </span>
                          </div>
                          <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                            {st.address}
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                            <span className="font-mono-tabular">
                              Unleaded ₱{(st.reportedGasoline ?? st.estimatedGasoline).toFixed(2)}
                            </span>
                            {st.estimatedRon95 && (
                              <span className="font-mono-tabular">
                                RON95 ₱{st.estimatedRon95.toFixed(2)}
                              </span>
                            )}
                            <span className="font-mono-tabular">
                              Diesel ₱{(st.reportedDiesel ?? st.estimatedDiesel).toFixed(2)}
                            </span>
                            <span
                              className={
                                st.isUserVerified
                                  ? 'font-medium text-emerald-700 dark:text-emerald-400'
                                  : st.priceSource === 'gaswatch_doe'
                                    ? 'font-medium text-blue-700 dark:text-blue-400'
                                    : 'text-slate-400 dark:text-slate-500'
                              }
                            >
                              {st.isUserVerified
                                ? 'Verified by you'
                                : st.priceSource === 'gaswatch_doe'
                                  ? 'Station Feed (DOE/Community)'
                                  : 'DOE Regional Estimate'}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-4 pl-12 sm:justify-end sm:pl-0">
                        <div className="w-28 text-left sm:text-right">
                          <div className="font-mono-tabular text-lg font-bold tracking-tight text-slate-950 dark:text-white">
                            ₱{activePrice.toFixed(2)}
                            <span className="text-xs font-normal text-slate-500">/L</span>
                          </div>
                          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                            <div
                              className={`h-full rounded-full ${meterColor}`}
                              style={{ width: `${relPct.toFixed(0)}%` }}
                            />
                          </div>
                          <div className="mt-0.5 text-[10px] capitalize text-slate-500 dark:text-slate-400">
                            {fuelFilter} {relPct <= 35 ? '· Best value' : ''}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openReportModal(st)}
                            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-[#151D2E] whitespace-nowrap"
                          >
                            <PenLine className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Log Price</span>
                          </button>

                          <a
                            href={mapsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Navigate to ${st.name} in Google Maps`}
                            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200 whitespace-nowrap"
                          >
                            <Navigation className="h-3.5 w-3.5" aria-hidden="true" />
                            <span className="hidden sm:inline">Directions</span>
                            <ExternalLink className="h-3 w-3 sm:hidden" aria-hidden="true" />
                          </a>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Report Actual Pump Price Modal */}
      {reportingStation && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="report-station-title"
        >
          <form
            onSubmit={submitPriceReport}
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-[#0F1522]"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3
                  id="report-station-title"
                  className="text-base font-bold text-slate-950 dark:text-white"
                >
                  Log Pump Price at {reportingStation.name}
                </h3>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Syncs immediately across open tabs and updates your savings calculator
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReportingStation(null)}
                aria-label="Close modal"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-3">
              <div>
                <label
                  htmlFor="log-gas"
                  className="block text-xs font-medium text-slate-600 dark:text-slate-300"
                >
                  Gasoline (₱/L)
                </label>
                <input
                  id="log-gas"
                  type="number"
                  step="0.01"
                  min="20"
                  max="200"
                  value={reportGasInput}
                  onChange={(e) => setReportGasInput(e.target.value)}
                  className="mt-1.5 min-h-[42px] w-full rounded-lg border border-slate-200 bg-white px-3 font-mono-tabular text-sm text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-600/30 dark:border-slate-700 dark:bg-[#151D2E] dark:text-white dark:focus:border-blue-500 dark:focus:bg-[#151D2E] dark:focus:ring-blue-500/30"
                />
              </div>

              <div>
                <label
                  htmlFor="log-diesel"
                  className="block text-xs font-medium text-slate-600 dark:text-slate-300"
                >
                  Diesel (₱/L)
                </label>
                <input
                  id="log-diesel"
                  type="number"
                  step="0.01"
                  min="20"
                  max="200"
                  value={reportDieselInput}
                  onChange={(e) => setReportDieselInput(e.target.value)}
                  className="mt-1.5 min-h-[42px] w-full rounded-lg border border-slate-200 bg-white px-3 font-mono-tabular text-sm text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-600/30 dark:border-slate-700 dark:bg-[#151D2E] dark:text-white dark:focus:border-blue-500 dark:focus:bg-[#151D2E] dark:focus:ring-blue-500/30"
                />
              </div>

              <div>
                <label
                  htmlFor="log-kero"
                  className="block text-xs font-medium text-slate-600 dark:text-slate-300"
                >
                  Kerosene (₱/L)
                </label>
                <input
                  id="log-kero"
                  type="number"
                  step="0.01"
                  min="20"
                  max="250"
                  value={reportKeroInput}
                  onChange={(e) => setReportKeroInput(e.target.value)}
                  className="mt-1.5 min-h-[42px] w-full rounded-lg border border-slate-200 bg-white px-3 font-mono-tabular text-sm text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-600/30 dark:border-slate-700 dark:bg-[#151D2E] dark:text-white dark:focus:border-blue-500 dark:focus:bg-[#151D2E] dark:focus:ring-blue-500/30"
                />
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setReportingStation(null)}
                className="min-h-[42px] rounded-lg px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
              >
                <Check className="h-4 w-4" aria-hidden="true" />
                <span>Save Pump Price</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
};
