import React, { useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Fuel,
  Minus,
} from 'lucide-react';
import heroStationImg from '../assets/images/hero_manila_station_1794873866376.jpg';
import { getRegionalOffset } from '../services/liveFuelService';
import type { CommodityPoint, FuelType, LiveFuelReport, UserLocation } from '../types/fuel';
import { NextTuesdayForecastCard } from './NextTuesdayForecastCard';

interface ForecastHeroProps {
  report: LiveFuelReport;
  preferredFuel: FuelType;
  onSelectFuel: (fuel: FuelType) => void;
  locationLabel: string;
  savedLocation: UserLocation | null;
}

function formatDelta(val: number): string {
  const abs = Math.abs(val).toFixed(2);
  if (val < -0.001) return `-₱${abs}/L`;
  if (val > 0.001) return `+₱${abs}/L`;
  return '₱0.00/L';
}

function getDeltaMeta(val: number) {
  if (val < -0.001) {
    return {
      label: 'Rollback',
      textClass: 'text-emerald-700 dark:text-emerald-400',
      Icon: ArrowDownRight,
    };
  }
  if (val > 0.001) {
    return {
      label: 'Price Hike',
      textClass: 'text-rose-700 dark:text-rose-400',
      Icon: ArrowUpRight,
    };
  }
  return {
    label: 'Unchanged',
    textClass: 'text-slate-600 dark:text-slate-400',
    Icon: Minus,
  };
}

const MiniSparkline: React.FC<{ points: CommodityPoint[]; strokeColor: string; id: string }> = ({
  points,
  strokeColor,
  id,
}) => {
  const slice = points.slice(-28);
  if (slice.length < 2) return null;
  const vals = slice.map((p) => p.close);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = Math.max(max - min, 0.5);
  const w = 128;
  const h = 34;
  const coords = slice.map((p, i) => ({
    x: (i / (slice.length - 1)) * w,
    y: h - 3 - ((p.close - min) / span) * (h - 6),
  }));
  const d = coords.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(' ');
  const areaD = `${d} L ${w} ${h} L 0 ${h} Z`;
  const last = coords[coords.length - 1];

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-2.5 h-8 w-full overflow-visible" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={strokeColor} stopOpacity="0.22" />
          <stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#${id})`} />
      <path d={d} fill="none" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last.x} cy={last.y} r="2.5" fill={strokeColor} />
    </svg>
  );
};

export const ForecastHero: React.FC<ForecastHeroProps> = ({
  report,
  preferredFuel,
  onSelectFuel,
  locationLabel,
  savedLocation,
}) => {
  const [imgFailed, setImgFailed] = useState(false);
  const [showDrivers, setShowDrivers] = useState(true);

  const { prediction, prevailing, benchmarks, nextWeekForecast } = report;

  const { gasOffset, dieselOffset, matchedRegion } = useMemo(() => {
    if (!savedLocation) {
      return { gasOffset: 0, dieselOffset: 0, matchedRegion: prevailing.areaName };
    }
    const { gasOffset: gOff, dieselOffset: dOff } = getRegionalOffset(
      `${savedLocation.region} ${savedLocation.province} ${savedLocation.city}`,
      prevailing
    );
    return {
      gasOffset: gOff,
      dieselOffset: dOff,
      matchedRegion: `${savedLocation.city}${savedLocation.province ? `, ${savedLocation.province}` : ''}`,
    };
  }, [savedLocation, prevailing]);

  const localGasCommon = Number((prevailing.gasolineCommon + gasOffset).toFixed(2));
  const localGasMin = Number((prevailing.gasolineMin + gasOffset).toFixed(2));
  const localGasMax = Number((prevailing.gasolineMax + gasOffset).toFixed(2));
  const localRon91 = Number((prevailing.ron91Common + gasOffset).toFixed(2));
  const localRon95 = Number((prevailing.ron95Common + gasOffset).toFixed(2));
  const localRon97 = Number((prevailing.ron97Common + gasOffset).toFixed(2));
  const localDieselCommon = Number((prevailing.dieselCommon + dieselOffset).toFixed(2));
  const localDieselMin = Number((prevailing.dieselMin + dieselOffset).toFixed(2));
  const localDieselMax = Number((prevailing.dieselMax + dieselOffset).toFixed(2));
  const localKeroCommon = Number((prevailing.keroseneCommon + dieselOffset).toFixed(2));
  const localKeroMin = Number((prevailing.keroseneMin + dieselOffset).toFixed(2));
  const localKeroMax = Number((prevailing.keroseneMax + dieselOffset).toFixed(2));

  const fuelCards: Array<{
    key: FuelType;
    name: string;
    subtitle: string;
    delta: number;
    commonPrice: number;
    range: [number, number];
  }> = [
    {
      key: 'gasoline',
      name: 'Gasoline',
      subtitle: `RON 91 ₱${localRon91.toFixed(2)}`,
      delta: prediction.gasolineDelta,
      commonPrice: localGasCommon,
      range: [localGasMin, localGasMax],
    },
    {
      key: 'diesel',
      name: 'Diesel',
      subtitle: 'Auto Diesel',
      delta: prediction.dieselDelta,
      commonPrice: localDieselCommon,
      range: [localDieselMin, localDieselMax],
    },
    {
      key: 'kerosene',
      name: 'Kerosene',
      subtitle: 'Standard Base',
      delta: prediction.keroseneDelta,
      commonPrice: localKeroCommon,
      range: [localKeroMin, localKeroMax],
    },
  ];

  const activeCard = fuelCards.find((f) => f.key === preferredFuel) || fuelCards[0];
  const spectrumSpan = Math.max(1, activeCard.range[1] - activeCard.range[0]);
  const commonPosPct = Math.min(
    94,
    Math.max(6, ((activeCard.commonPrice - activeCard.range[0]) / spectrumSpan) * 100)
  );

  const statusText =
    prediction.status === 'confirmed_advisory'
      ? 'Confirmed Tuesday Advisory'
      : 'Mid-Week MOPS Projection';

  const confidenceLabel =
    prediction.confidence === 'high'
      ? 'High Confidence'
      : prediction.confidence === 'moderate'
        ? 'Moderate Confidence'
        : 'Early-Week Estimate';

  const heroAmbientTint =
    prediction.direction === 'rollback'
      ? 'bg-gradient-to-br from-emerald-50/35 via-white to-white dark:from-emerald-950/15 dark:via-[#0F1522] dark:to-[#0F1522]'
      : prediction.direction === 'hike'
        ? 'bg-gradient-to-br from-rose-50/35 via-white to-white dark:from-rose-950/15 dark:via-[#0F1522] dark:to-[#0F1522]'
        : 'bg-white dark:bg-[#0F1522]';

  const maxLedgerPrice = Math.max(localRon91, localRon95, localRon97, localDieselCommon, localKeroCommon, 1);
  const rightLedgerRows = [
    { label: 'Gasoline · RON 91', price: localRon91 },
    { label: 'Gasoline · RON 95', price: localRon95 },
    { label: 'Gasoline · RON 97', price: localRon97 },
    { label: 'Diesel · Common', price: localDieselCommon },
    { label: 'Kerosene · Common', price: localKeroCommon },
  ];

  return (
    <section aria-labelledby="forecast-heading" className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-stretch">
        {/* Left 7 columns: Current Tuesday Advisory & Analytical Explanation */}
        <div
          className={`flex flex-col justify-between rounded-xl border border-slate-200/90 p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:p-7 dark:border-slate-800 lg:col-span-7 ${heroAmbientTint}`}
        >
          <div>
            {/* Unboxed Metadata Line */}
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs font-medium text-slate-500 dark:text-slate-400">
              <span className="font-semibold text-blue-700 dark:text-blue-400">{statusText}</span>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
              <span className="font-mono-tabular">
                Effective Tue {prediction.targetTuesdayDate} · {prediction.effectiveTime}
              </span>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
              <span>{confidenceLabel}</span>
            </div>

            <h1
              id="forecast-heading"
              className="mt-3 text-2xl font-extrabold tracking-tight text-slate-950 text-balance sm:text-[30px] sm:leading-[1.18] dark:text-white"
            >
              {prediction.headline}
            </h1>

            <p className="mt-2.5 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              {prediction.summary}
            </p>

            {/* Interactive 3-Fuel Delta Matrix */}
            <div
              role="radiogroup"
              aria-label="Select primary fuel grade"
              className="mt-6 grid grid-cols-1 gap-2.5 sm:grid-cols-3"
            >
              {fuelCards.map((item) => {
                const meta = getDeltaMeta(item.delta);
                const DeltaIcon = meta.Icon;
                const isSelected = preferredFuel === item.key;

                return (
                  <button
                    key={item.key}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => onSelectFuel(item.key)}
                    className={`group flex flex-col items-start rounded-lg border p-4 text-left transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                      isSelected
                        ? 'border-blue-600 bg-blue-50/40 ring-1 ring-blue-600/20 dark:border-blue-500 dark:bg-blue-950/25 dark:ring-blue-500/25'
                        : 'border-slate-200/90 bg-slate-50/60 hover:border-slate-300 hover:bg-white dark:border-slate-800 dark:bg-[#151D2E]/60 dark:hover:border-slate-700 dark:hover:bg-[#151D2E]'
                    }`}
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span
                        className={`text-xs font-semibold ${
                          isSelected
                            ? 'text-blue-700 dark:text-blue-300'
                            : 'text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {item.name}
                      </span>
                      <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${meta.textClass}`}>
                        <DeltaIcon className="h-3.5 w-3.5" aria-hidden="true" />
                        {meta.label}
                      </span>
                    </div>

                    <div className="mt-2 font-mono-tabular text-2xl font-bold tracking-tight text-slate-950 dark:text-white">
                      {formatDelta(item.delta)}
                    </div>

                    <div className="mt-2 flex w-full items-baseline justify-between border-t border-slate-200/70 pt-2 text-xs dark:border-slate-800/80">
                      <span className="text-slate-500 dark:text-slate-400">
                        {savedLocation ? 'Local' : 'Common'}
                      </span>
                      <span className="font-mono-tabular font-semibold text-slate-900 dark:text-slate-100">
                        ₱{item.commonPrice.toFixed(2)}
                        <span className="ml-1 text-[10px] font-normal text-slate-400">/L</span>
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Calibrated Local Price Spectrum Ruler */}
            <div className="mt-5 border-t border-slate-200/70 pt-4 dark:border-slate-800/80">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-medium text-slate-600 dark:text-slate-300">
                  {activeCard.name} Pump Range · <span className="text-slate-900 dark:text-white">{matchedRegion}</span>
                </span>
                <span className="font-mono-tabular font-semibold text-slate-900 dark:text-slate-100">
                  Typical ₱{activeCard.commonPrice.toFixed(2)}/L
                </span>
              </div>

              <div className="relative mt-3 h-2 w-full rounded-full bg-gradient-to-r from-emerald-500 via-amber-400 to-rose-500">
                <div
                  className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-slate-950 shadow-sm dark:border-[#0F1522] dark:bg-white"
                  style={{ left: `${commonPosPct}%` }}
                  aria-hidden="true"
                />
              </div>

              <div className="mt-2 flex items-center justify-between font-mono-tabular text-[11px] text-slate-500 dark:text-slate-400">
                <span>Low ₱{activeCard.range[0].toFixed(2)}</span>
                <span>Median ₱{activeCard.commonPrice.toFixed(2)}</span>
                <span>High ₱{activeCard.range[1].toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Why This Prediction Section */}
          <div className="mt-6 border-t border-slate-200/80 pt-5 dark:border-slate-800">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-sm font-semibold text-slate-950 dark:text-white">
                Why FuelPh reports this movement
              </h2>
              <button
                type="button"
                onClick={() => setShowDrivers((v) => !v)}
                className="inline-flex min-h-[36px] items-center gap-1 text-xs font-medium text-blue-700 hover:underline dark:text-blue-400"
              >
                <span>{showDrivers ? 'Hide drivers' : 'Show drivers'}</span>
                {showDrivers ? (
                  <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                )}
              </button>
            </div>

            <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              {prediction.explanation}
            </p>

            {showDrivers && prediction.drivers && prediction.drivers.length > 0 && (
              <div className="mt-4 divide-y divide-slate-200/70 border-t border-slate-200/70 dark:divide-slate-800/80 dark:border-slate-800/80">
                {prediction.drivers.map((driver, idx) => {
                  const impactLabel =
                    driver.impact === 'downward'
                      ? 'Downward pressure'
                      : driver.impact === 'upward'
                        ? 'Upward pressure'
                        : 'Neutral factor';
                  const impactColor =
                    driver.impact === 'downward'
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : driver.impact === 'upward'
                        ? 'text-rose-700 dark:text-rose-400'
                        : 'text-slate-500 dark:text-slate-400';

                  return (
                    <div
                      key={`${driver.factor}-${idx}`}
                      className="flex flex-col gap-1.5 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
                          <span>{driver.factor}</span>
                          <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
                          <span className={impactColor}>{impactLabel}</span>
                        </div>
                        <p className="mt-0.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                          {driver.detail}
                        </p>
                      </div>
                      {driver.metric && (
                        <span className="font-mono-tabular shrink-0 text-xs font-semibold text-slate-800 dark:text-slate-200">
                          {driver.metric}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right 5 columns: Editorial Manila Station Visual + Location-Calibrated Pump Ledger */}
        <div className="relative flex min-h-[380px] flex-col justify-between overflow-hidden rounded-xl border border-slate-200/90 bg-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.03)] dark:border-slate-800 lg:col-span-5">
          {!imgFailed ? (
            <img
              src={heroStationImg}
              alt="Philippine gasoline station canopy at twilight in Metro Manila"
              referrerPolicy="no-referrer"
              onError={() => setImgFailed(true)}
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950">
              <Fuel className="h-16 w-16 text-slate-600" aria-hidden="true" />
            </div>
          )}

          <div className="absolute inset-0 bg-gradient-to-t from-[#080B12] via-[#080B12]/78 to-[#080B12]/25" />

          <div className="relative z-10 p-6 sm:p-7">
            <div className="inline-flex items-center gap-2 text-xs font-medium text-slate-200">
              <span>{matchedRegion}</span>
              <span aria-hidden="true" className="text-slate-400">·</span>
              <span className="font-mono-tabular">As of {prevailing.effectiveDate}</span>
            </div>
          </div>

          <div className="relative z-10 p-6 pt-0 text-white sm:p-7 sm:pt-0">
            <div className="text-xs font-medium text-slate-300">
              DOE Official Baseline · {locationLabel}
            </div>
            <h2 className="mt-1 text-xl font-bold tracking-tight text-white">
              Prevailing Pump Rates
            </h2>

            <dl className="mt-4 divide-y divide-white/12 border-t border-white/15 text-sm">
              {rightLedgerRows.map((row) => {
                const widthPct = Math.min(100, Math.max(18, (row.price / maxLedgerPrice) * 100));
                return (
                  <div key={row.label} className="py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-xs font-medium text-slate-200">{row.label}</dt>
                      <dd className="font-mono-tabular text-sm font-bold text-white">
                        ₱{row.price.toFixed(2)}
                        <span className="ml-0.5 text-[11px] font-normal text-slate-300">/L</span>
                      </dd>
                    </div>
                    <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/15">
                      <div
                        className="h-full rounded-full bg-blue-400"
                        style={{ width: `${widthPct.toFixed(0)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </dl>
          </div>
        </div>
      </div>

      {/* Dedicated Next Tuesday Reset Forecast Card */}
      {nextWeekForecast && (
        <NextTuesdayForecastCard
          forecast={nextWeekForecast}
          localGasBase={localGasCommon}
          localDieselBase={localDieselCommon}
          localKeroBase={localKeroCommon}
          locationLabel={matchedRegion}
        />
      )}

      {/* Full-width 4-column Live Benchmark Strip */}
      <div className="grid grid-cols-2 divide-y divide-slate-200/80 overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:grid-cols-4 sm:divide-x sm:divide-y-0 dark:divide-slate-800 dark:border-slate-800 dark:bg-[#0F1522]">
        <div className="flex flex-col justify-between p-5">
          <div>
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
              USD / PHP Exchange
            </div>
            <div className="mt-1.5 font-mono-tabular text-2xl font-bold tracking-tight text-slate-950 dark:text-white">
              ₱{benchmarks.usdPhpRate ? benchmarks.usdPhpRate.toFixed(2) : '—'}
            </div>
          </div>
          <div className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
            Live import parity rate
          </div>
        </div>

        <div className="p-5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Brent Crude
            </span>
            <span
              className={`font-mono-tabular text-xs font-semibold ${
                benchmarks.brentChangePct <= 0
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-rose-700 dark:text-rose-400'
              }`}
            >
              {benchmarks.brentChangePct >= 0 ? '+' : ''}
              {benchmarks.brentChangePct.toFixed(2)}%
            </span>
          </div>
          <div className="mt-1 font-mono-tabular text-2xl font-bold tracking-tight text-slate-950 dark:text-white">
            ${benchmarks.brentUsd ? benchmarks.brentUsd.toFixed(2) : '—'}
          </div>
          <MiniSparkline
            id="brentSpark"
            points={benchmarks.brentHistory}
            strokeColor={benchmarks.brentChangePct <= 0 ? '#059669' : '#E11D48'}
          />
        </div>

        <div className="p-5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              WTI Crude
            </span>
            <span
              className={`font-mono-tabular text-xs font-semibold ${
                benchmarks.wtiChangePct <= 0
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-rose-700 dark:text-rose-400'
              }`}
            >
              {benchmarks.wtiChangePct >= 0 ? '+' : ''}
              {benchmarks.wtiChangePct.toFixed(2)}%
            </span>
          </div>
          <div className="mt-1 font-mono-tabular text-2xl font-bold tracking-tight text-slate-950 dark:text-white">
            ${benchmarks.wtiUsd ? benchmarks.wtiUsd.toFixed(2) : '—'}
          </div>
          <MiniSparkline
            id="wtiSpark"
            points={benchmarks.wtiHistory}
            strokeColor={benchmarks.wtiChangePct <= 0 ? '#059669' : '#E11D48'}
          />
        </div>

        <div className="flex flex-col justify-between p-5">
          <div>
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Local Diesel Common
            </div>
            <div className="mt-1.5 font-mono-tabular text-2xl font-bold tracking-tight text-slate-950 dark:text-white">
              ₱{localDieselCommon.toFixed(2)}
              <span className="ml-1 text-xs font-normal text-slate-400">/L</span>
            </div>
          </div>
          <div className="mt-3 font-mono-tabular text-[11px] text-slate-500 dark:text-slate-400">
            Range ₱{localDieselMin.toFixed(2)} – ₱{localDieselMax.toFixed(2)}
          </div>
        </div>
      </div>
    </section>
  );
};
