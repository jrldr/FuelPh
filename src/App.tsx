import React, { useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  Calculator,
  Compass,
  LayoutDashboard,
  MapPin,
  Moon,
  RefreshCw,
  Sun,
} from 'lucide-react';
import { ForecastHero } from './components/ForecastHero';
import { NearbyStationsView } from './components/NearbyStationsView';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PriceTrendCharts } from './components/PriceTrendCharts';
import { PWAInstallButton } from './components/PWAInstallButton';
import { SavingsPlanner } from './components/SavingsPlanner';
import { useFuelSync } from './hooks/useFuelSync';
import {
  fetchLiveFuelReport,
  reverseGeocodeCoords,
  searchPhilippineLocations,
} from './services/liveFuelService';
import type { LiveFuelReport } from './types/fuel';

type NavSection = 'overview' | 'trends' | 'stations' | 'planner';

export default function App() {
  const {
    state: syncState,
    toggleTheme,
    setPreferredFuel,
    setSavedLocation,
    updateVehicleProfile,
    reportStationPrice,
    exportProfileJson,
    importProfileJson,
  } = useFuelSync();

  const [report, setReport] = useState<LiveFuelReport | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<NavSection>('overview');
  const [requestingGps, setRequestingGps] = useState<boolean>(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  const loadLiveData = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const data = await fetchLiveFuelReport(forceRefresh);
      setReport(data);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not retrieve live Philippine fuel prices.'
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadLiveData(false);
  }, [loadLiveData]);

  const navigateToSection = (section: NavSection) => {
    setActiveTab(section);
    const el = document.getElementById(`section-${section}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleQuickGps = () => {
    if (!navigator.geolocation) {
      setGpsError('Geolocation is unavailable in this browser. Search your city in Stations.');
      navigateToSection('stations');
      return;
    }
    setRequestingGps(true);
    setGpsError(null);

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const loc = await reverseGeocodeCoords(pos.coords.latitude, pos.coords.longitude);
          setSavedLocation(loc);
        } catch {
          setSavedLocation({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            city: 'GPS Location',
            province: 'Philippines',
            region: 'Philippines',
            displayName: `${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`,
            source: 'gps',
          });
        } finally {
          setRequestingGps(false);
        }
      },
      () => {
        setRequestingGps(false);
        setGpsError('Location access declined. Choose a hub below or search any Philippine city.');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleSelectQuickCity = async (query: string) => {
    setRequestingGps(true);
    setGpsError(null);
    try {
      const results = await searchPhilippineLocations(query);
      if (results.length > 0) {
        const place = results[0];
        const city =
          place.address?.city ||
          place.address?.town ||
          place.address?.municipality ||
          place.address?.province ||
          place.display_name.split(',')[0];
        const province = place.address?.province || place.address?.state || city;
        const region = place.address?.region || province;
        setSavedLocation({
          lat: Number(place.lat),
          lng: Number(place.lon),
          city,
          province,
          region,
          displayName: place.display_name.split(',').slice(0, 3).join(','),
          source: 'search',
        });
      } else {
        setGpsError(`Could not locate ${query}. Try searching in Stations.`);
        navigateToSection('stations');
      }
    } catch {
      setGpsError('Location lookup unavailable right now. Please retry.');
    } finally {
      setRequestingGps(false);
    }
  };

  const formattedUpdatedAt = report?.fetchedAt
    ? new Date(report.fetchedAt).toLocaleString('en-PH', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  const locationLabel = syncState.savedLocation
    ? syncState.savedLocation.city
    : 'Metro Manila Reference';

  const navItems: Array<{ id: NavSection; label: string; Icon: typeof LayoutDashboard }> = [
    { id: 'overview', label: 'Overview', Icon: LayoutDashboard },
    { id: 'trends', label: 'Trends', Icon: BarChart3 },
    { id: 'stations', label: 'Stations', Icon: MapPin },
    { id: 'planner', label: 'Planner', Icon: Calculator },
  ];

  return (
    <div className="min-h-screen bg-[#F7F8FA] pb-24 text-slate-900 transition-colors duration-200 md:pb-14 dark:bg-[#080B12] dark:text-slate-100">
      {/* Top Bar Contract: 3 exact zones separated by gap-8 */}
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl dark:border-slate-800/80 dark:bg-[#080B12]/90">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-8 px-4 sm:px-6">
          {/* Zone 1: Single-element Brand Wordmark */}
          <a
            href="#section-overview"
            onClick={(e) => {
              e.preventDefault();
              navigateToSection('overview');
            }}
            className="font-display text-lg font-extrabold tracking-tight text-slate-950 whitespace-nowrap shrink-0 dark:text-white"
          >
            FuelPh
          </a>

          {/* Zone 2: Clean single-line navigation links */}
          <nav aria-label="Primary navigation" className="hidden items-center gap-7 md:flex">
            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigateToSection(item.id)}
                  className={`relative flex min-h-[40px] items-center px-0.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'text-slate-950 dark:text-white'
                      : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  <span>{item.label}</span>
                  {isActive && (
                    <span
                      aria-hidden="true"
                      className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-blue-600 dark:bg-blue-400"
                    />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: 1 Primary Action */}
          <div className="shrink-0">
            <button
              type="button"
              onClick={() => loadLiveData(true)}
              disabled={loading || refreshing}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-all duration-150 hover:bg-slate-800 active:scale-[0.98] disabled:opacity-60 whitespace-nowrap shrink-0 dark:bg-blue-600 dark:hover:bg-blue-500"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>{refreshing ? 'Syncing...' : 'Sync Live'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace Container */}
      <main className="mx-auto max-w-6xl space-y-6 px-4 pt-5 sm:px-6 sm:pt-6">
        {/* Scrollable Workspace Toolbar */}
        <div className="flex flex-col gap-3 border-b border-slate-200/70 pb-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800/70">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-medium text-slate-700 dark:text-slate-300">
              Philippines Petroleum Monitor
            </span>
            {formattedUpdatedAt && (
              <>
                <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
                <span className="font-mono-tabular">Synced {formattedUpdatedAt}</span>
              </>
            )}
            <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
            <button
              type="button"
              onClick={() => navigateToSection('stations')}
              className="inline-flex items-center gap-1 font-medium text-blue-700 hover:underline dark:text-blue-400"
            >
              <MapPin className="h-3 w-3" aria-hidden="true" />
              <span>{locationLabel}</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={`Switch to ${syncState.theme === 'dark' ? 'light' : 'dark'} mode`}
              className="inline-flex min-h-[38px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 shadow-2xs transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-800 dark:bg-[#0F1522] dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {syncState.theme === 'dark' ? (
                <>
                  <Sun className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                  <span>Light Mode</span>
                </>
              ) : (
                <>
                  <Moon className="h-3.5 w-3.5 text-slate-600" aria-hidden="true" />
                  <span>Dark Mode</span>
                </>
              )}
            </button>

            <PWAInstallButton />
          </div>
        </div>

        {/* Inline Non-Blocking Location Request Prompt */}
        {!syncState.savedLocation && (
          <div className="flex flex-col gap-4 rounded-xl border border-slate-200/90 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] lg:flex-row lg:items-center lg:justify-between dark:border-slate-800 dark:bg-[#0F1522]">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Set your area for calibrated regional pump prices
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Matches nearby physical stations with official DOE regional spreads across Luzon, Visayas, and Mindanao.
              </p>
              {gpsError && (
                <p className="mt-1.5 text-xs font-medium text-rose-700 dark:text-rose-400">
                  {gpsError}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleQuickGps}
                disabled={requestingGps}
                className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap"
              >
                <Compass className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{requestingGps ? 'Locating...' : 'Share Location'}</span>
              </button>
              {['Cavite', 'Metro Manila', 'Cebu City', 'Davao City'].map((hub) => (
                <button
                  key={hub}
                  type="button"
                  disabled={requestingGps}
                  onClick={() => handleSelectQuickCity(`${hub}, Philippines`)}
                  className="inline-flex min-h-[42px] items-center rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700/80 dark:bg-[#151D2E] dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
                >
                  {hub}
                </button>
              ))}
              <button
                type="button"
                onClick={() => navigateToSection('stations')}
                className="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700/80 dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                <span>Search City</span>
              </button>
            </div>
          </div>
        )}

        {/* Loading State */}
        {loading && !report && (
          <div className="space-y-6" aria-busy="true" aria-label="Loading live Philippine fuel data">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              <div className="h-[460px] animate-pulse rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#0F1522] lg:col-span-7" />
              <div className="h-[460px] animate-pulse rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#0F1522] lg:col-span-5" />
            </div>
            <div className="h-52 animate-pulse rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#0F1522]" />
          </div>
        )}

        {/* Error State */}
        {error && !report && !loading && (
          <div
            role="alert"
            className="rounded-xl border border-rose-200 bg-white p-8 text-center shadow-xs dark:border-rose-900/60 dark:bg-[#0F1522]"
          >
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Live Market Feed Unavailable
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-600 dark:text-slate-400">
              {error}
            </p>
            <button
              type="button"
              onClick={() => loadLiveData(true)}
              className="mt-5 inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-blue-700"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              <span>Retry Live Sync</span>
            </button>
          </div>
        )}

        {/* Populated Live Dashboard */}
        {report && (
          <div className="space-y-8">
            {error && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                Refresh failed ({error}). Displaying most recent synced snapshot.
              </div>
            )}

            <div
              id="section-overview"
              className={activeTab === 'overview' ? 'block scroll-mt-16' : 'hidden scroll-mt-16 md:block'}
            >
              <ForecastHero
                report={report}
                preferredFuel={syncState.preferredFuel}
                onSelectFuel={setPreferredFuel}
                locationLabel={locationLabel}
                savedLocation={syncState.savedLocation}
              />
            </div>

            <div
              id="section-trends"
              className={activeTab === 'trends' ? 'block scroll-mt-16' : 'hidden scroll-mt-16 md:block'}
            >
              <PriceTrendCharts
                history={report.history}
                brentHistory={report.benchmarks.brentHistory}
                sources={report.sources}
                preferredFuel={syncState.preferredFuel}
              />
            </div>

            <div
              id="section-stations"
              className={activeTab === 'stations' ? 'block scroll-mt-16' : 'hidden scroll-mt-16 md:block'}
            >
              <NearbyStationsView
                prevailing={report.prevailing}
                savedLocation={syncState.savedLocation}
                onSaveLocation={setSavedLocation}
                preferredFuel={syncState.preferredFuel}
                stationReports={syncState.stationReports}
                onReportPrice={reportStationPrice}
              />
            </div>

            <div
              id="section-planner"
              className={activeTab === 'planner' ? 'block scroll-mt-16' : 'hidden scroll-mt-16 md:block'}
            >
              <SavingsPlanner
                report={report}
                syncState={syncState}
                onSelectFuel={setPreferredFuel}
                onUpdateProfile={updateVehicleProfile}
                onExportJson={exportProfileJson}
                onImportJson={importProfileJson}
              />
            </div>
          </div>
        )}
      </main>

      {/* Quiet Footer */}
      <footer className="mx-auto mt-14 max-w-6xl border-t border-slate-200/80 px-4 py-6 text-xs text-slate-500 sm:px-6 dark:border-slate-800/80 dark:text-slate-400">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            FuelPh · Philippine fuel monitoring grounded on DOE retail advisories, MOPS futures, Open Exchange Rates, and OpenStreetMap.
          </div>
          <div className="font-mono-tabular">
            Weekly Tuesday resets take effect at 06:00 AM PHT
          </div>
        </div>
      </footer>

      {/* Mobile Bottom Tab Bar (Natural Thumb Zone, <=15% Sticky Cap) */}
      <nav
        aria-label="Mobile navigation"
        className="fixed bottom-0 left-0 right-0 z-40 grid h-16 grid-cols-4 border-t border-slate-200/90 bg-white/95 backdrop-blur-xl pb-safe md:hidden dark:border-slate-800/90 dark:bg-[#080B12]/95"
      >
        {navItems.map((item) => {
          const Icon = item.Icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => navigateToSection(item.id)}
              className={`relative flex min-h-[48px] flex-col items-center justify-center gap-1 transition-colors ${
                active
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              {active && (
                <span
                  aria-hidden="true"
                  className="absolute top-0 h-0.5 w-8 rounded-b-full bg-blue-600 dark:bg-blue-400"
                />
              )}
              <Icon className="h-5 w-5" aria-hidden="true" />
              <span className="text-[11px] font-medium tracking-tight">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <OfflineIndicator />
    </div>
  );
}
