import React from 'react';
import { ArrowDownRight, ArrowUpRight, CalendarClock, Minus } from 'lucide-react';
import type { NextTuesdayForecast, PriceDirection } from '../types/fuel';

interface NextTuesdayForecastCardProps {
  forecast: NextTuesdayForecast;
  localGasBase: number;
  localDieselBase: number;
  localKeroBase: number;
  locationLabel: string;
}

function formatDelta(val: number): string {
  const abs = Math.abs(val).toFixed(2);
  if (val < -0.001) return `-₱${abs}/L`;
  if (val > 0.001) return `+₱${abs}/L`;
  return '₱0.00/L';
}

function getVerdictMeta(direction: PriceDirection) {
  if (direction === 'rollback') {
    return {
      verdict: 'Rollback Projected',
      accentText: 'text-emerald-700 dark:text-emerald-400',
      barColor: '#059669',
      Icon: ArrowDownRight,
    };
  }
  if (direction === 'hike') {
    return {
      verdict: 'Hike Projected',
      accentText: 'text-rose-700 dark:text-rose-400',
      barColor: '#E11D48',
      Icon: ArrowUpRight,
    };
  }
  if (direction === 'mixed') {
    return {
      verdict: 'Mixed Movement',
      accentText: 'text-amber-700 dark:text-amber-400',
      barColor: '#D97706',
      Icon: Minus,
    };
  }
  return {
    verdict: 'Flat Outlook',
    accentText: 'text-slate-600 dark:text-slate-400',
    barColor: '#64748B',
    Icon: Minus,
  };
}

export const NextTuesdayForecastCard: React.FC<NextTuesdayForecastCardProps> = ({
  forecast,
  localGasBase,
  localDieselBase,
  localKeroBase,
  locationLabel,
}) => {
  const meta = getVerdictMeta(forecast.direction);
  const VerdictIcon = meta.Icon;

  const confidenceText =
    forecast.confidence === 'high'
      ? 'High Confidence (4–5 MOPS sessions)'
      : forecast.confidence === 'moderate'
        ? 'Mid-Week Estimate (2–3 MOPS sessions)'
        : 'Early-Week Tracker (Updates Mon–Fri)';

  const avgMove = (forecast.gasolineDelta + forecast.dieselDelta) / 2;
  const clampedAngle = Math.max(-72, Math.min(72, avgMove * 14));
  const rad = ((clampedAngle - 90) * Math.PI) / 180;
  const needleX = 88 + 52 * Math.cos(rad);
  const needleY = 82 + 52 * Math.sin(rad);

  const fuels = [
    {
      label: 'Gasoline (RON 91/95)',
      current: localGasBase,
      delta: forecast.gasolineDelta,
      projected: Math.max(0, localGasBase + forecast.gasolineDelta),
    },
    {
      label: 'Diesel',
      current: localDieselBase,
      delta: forecast.dieselDelta,
      projected: Math.max(0, localDieselBase + forecast.dieselDelta),
    },
    {
      label: 'Kerosene',
      current: localKeroBase,
      delta: forecast.keroseneDelta,
      projected: Math.max(0, localKeroBase + forecast.keroseneDelta),
    },
  ];

  const maxAbsDelta = Math.max(2.5, ...fuels.map((f) => Math.abs(f.delta)));
  const rbobMax = Math.max(forecast.rbobPriorAvg, forecast.rbobCurrentAvg, 0.01);
  const ulsdMax = Math.max(forecast.ulsdPriorAvg, forecast.ulsdCurrentAvg, 0.01);

  return (
    <section
      aria-labelledby="next-tuesday-heading"
      className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)] dark:border-slate-800 dark:bg-[#0F1522]"
    >
      {/* Top Analytical Header Strip */}
      <div className="flex flex-col gap-4 border-b border-slate-200/80 px-6 py-5 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs font-medium text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5 font-semibold text-blue-700 dark:text-blue-400">
              <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
              Next Tuesday Reset Forecast
            </span>
            <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
            <span className="font-mono-tabular">
              Tue {forecast.targetTuesdayDate} · {forecast.effectiveTime}
            </span>
            <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
            <span>{confidenceText}</span>
          </div>
          <h2
            id="next-tuesday-heading"
            className="mt-1.5 text-lg font-bold tracking-tight text-slate-950 text-balance sm:text-xl dark:text-white"
          >
            {forecast.headline}
          </h2>
        </div>

        {/* 5-Day MOPS Cycle Progress Stepper */}
        <div className="shrink-0">
          <div className="flex items-center justify-between gap-4 text-[11px] font-medium text-slate-500 dark:text-slate-400">
            <span>MOPS Trading Cycle</span>
            <span className="font-mono-tabular font-semibold text-slate-800 dark:text-slate-200">
              {forecast.tradingDaysCompleted}/{forecast.tradingDaysTotal} sessions
            </span>
          </div>
          <div
            className="mt-2 grid grid-cols-5 gap-1.5"
            aria-label={`MOPS day ${forecast.tradingDaysCompleted} of 5`}
          >
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((dayName, idx) => {
              const filled = idx < forecast.tradingDaysCompleted;
              return (
                <div key={dayName} className="flex flex-col items-center gap-1">
                  <div
                    className={`h-1.5 w-8 rounded-full transition-colors ${
                      filled
                        ? 'bg-blue-600 dark:bg-blue-400'
                        : 'bg-slate-200 dark:bg-slate-800'
                    }`}
                  />
                  <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500">
                    {dayName}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 3-Column Visual Briefing Grid */}
      <div className="grid grid-cols-1 divide-y divide-slate-200/80 lg:grid-cols-12 lg:divide-x lg:divide-y-0 dark:divide-slate-800">
        {/* Column 1: Calibrated Momentum Dial */}
        <div className="flex flex-col justify-between p-6 lg:col-span-4">
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Directional Signal
              </span>
              <span className={`inline-flex items-center gap-1 text-xs font-bold ${meta.accentText}`}>
                <VerdictIcon className="h-4 w-4" aria-hidden="true" />
                {meta.verdict}
              </span>
            </div>

            <div className="mt-3 flex items-center justify-center rounded-lg bg-slate-50/80 py-3 dark:bg-[#151D2E]/70">
              <svg
                viewBox="0 0 176 102"
                className="h-28 w-48"
                role="img"
                aria-label={`Next Tuesday MOPS momentum dial showing ${meta.verdict}`}
              >
                {/* Scale Arcs */}
                <path
                  d="M 22 82 A 66 66 0 0 1 85 16"
                  fill="none"
                  stroke="#059669"
                  strokeWidth="9"
                  strokeLinecap="round"
                  opacity="0.28"
                />
                <path
                  d="M 88 16 A 66 66 0 0 1 89 16"
                  fill="none"
                  stroke="#94A3B8"
                  strokeWidth="9"
                  strokeLinecap="round"
                />
                <path
                  d="M 91 16 A 66 66 0 0 1 154 82"
                  fill="none"
                  stroke="#E11D48"
                  strokeWidth="9"
                  strokeLinecap="round"
                  opacity="0.28"
                />

                {/* Calibrated tick markers */}
                {[-60, -30, 0, 30, 60].map((deg) => {
                  const r = ((deg - 90) * Math.PI) / 180;
                  const x1 = 88 + 56 * Math.cos(r);
                  const y1 = 82 + 56 * Math.sin(r);
                  const x2 = 88 + 60 * Math.cos(r);
                  const y2 = 82 + 60 * Math.sin(r);
                  return (
                    <line
                      key={deg}
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      className="stroke-slate-400/70 dark:stroke-slate-500"
                      strokeWidth="1.25"
                    />
                  );
                })}

                {/* Active Needle */}
                <line
                  x1="88"
                  y1="82"
                  x2={needleX.toFixed(1)}
                  y2={needleY.toFixed(1)}
                  stroke={meta.barColor}
                  strokeWidth="3"
                  strokeLinecap="round"
                />
                <circle cx="88" cy="82" r="5" fill={meta.barColor} />
                <text
                  x="16"
                  y="98"
                  className="fill-emerald-700 text-[9px] font-semibold dark:fill-emerald-400"
                >
                  Rollback
                </text>
                <text
                  x="88"
                  y="98"
                  textAnchor="middle"
                  className="fill-slate-400 text-[9px] font-mono dark:fill-slate-500"
                >
                  0.00
                </text>
                <text
                  x="160"
                  y="98"
                  textAnchor="end"
                  className="fill-rose-700 text-[9px] font-semibold dark:fill-rose-400"
                >
                  Hike
                </text>
              </svg>
            </div>
          </div>

          <p className="mt-4 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            {forecast.summary}
          </p>
        </div>

        {/* Column 2: Per-Fuel Projected Delta & Post-Reset Pump Estimate */}
        <div className="p-6 lg:col-span-4">
          <div className="flex items-center justify-between gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Projected Next Reset Δ</span>
            <span className="truncate max-w-[165px] text-slate-700 dark:text-slate-300">
              {locationLabel}
            </span>
          </div>

          <div className="mt-5 space-y-4">
            {fuels.map((f) => {
              const isDown = f.delta < -0.001;
              const isUp = f.delta > 0.001;
              const barPct = Math.min(100, Math.max(8, (Math.abs(f.delta) / maxAbsDelta) * 100));
              return (
                <div key={f.label} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      {f.label}
                    </span>
                    <span
                      className={`font-mono-tabular text-sm font-bold ${
                        isDown
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : isUp
                            ? 'text-rose-700 dark:text-rose-400'
                            : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {formatDelta(f.delta)}
                    </span>
                  </div>

                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className={`h-full rounded-full ${
                        isDown ? 'bg-emerald-600 dark:bg-emerald-500' : isUp ? 'bg-rose-600 dark:bg-rose-500' : 'bg-slate-400'
                      }`}
                      style={{ width: `${barPct.toFixed(0)}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between font-mono-tabular text-[11px] text-slate-500 dark:text-slate-400">
                    <span>Now ₱{f.current.toFixed(2)}</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      Est. ₱{f.projected.toFixed(2)}/L
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Column 3: MOPS Futures Parity Visual & Analytical Basis */}
        <div className="flex flex-col justify-between p-6 lg:col-span-4">
          <div>
            <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
              <span>MOPS Parity Shift</span>
              <span className="font-mono-tabular">{forecast.mopsWindowLabel}</span>
            </div>

            <div className="mt-5 space-y-4">
              {/* Gasoline RBOB */}
              <div>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    Gasoline Futures (RB=F)
                  </span>
                  <span
                    className={`font-mono-tabular font-semibold ${
                      forecast.rbobDeltaPct <= 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-rose-700 dark:text-rose-400'
                    }`}
                  >
                    {forecast.rbobDeltaPct >= 0 ? '+' : ''}
                    {forecast.rbobDeltaPct.toFixed(2)}%
                  </span>
                </div>
                <div className="mt-2 space-y-1.5">
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="w-14 text-slate-500 dark:text-slate-400">Prior Wk</span>
                    <div className="h-2 flex-1 rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className="h-full rounded-full bg-slate-400 dark:bg-slate-600"
                        style={{ width: `${((forecast.rbobPriorAvg / rbobMax) * 100).toFixed(0)}%` }}
                      />
                    </div>
                    <span className="font-mono-tabular w-14 text-right text-slate-500 dark:text-slate-400">
                      ${forecast.rbobPriorAvg.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="w-14 font-semibold text-slate-800 dark:text-slate-200">This Wk</span>
                    <div className="h-2 flex-1 rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className={`h-full rounded-full ${
                          forecast.rbobDeltaPct <= 0
                            ? 'bg-emerald-600 dark:bg-emerald-500'
                            : 'bg-rose-600 dark:bg-rose-500'
                        }`}
                        style={{ width: `${((forecast.rbobCurrentAvg / rbobMax) * 100).toFixed(0)}%` }}
                      />
                    </div>
                    <span className="font-mono-tabular w-14 text-right font-semibold text-slate-900 dark:text-slate-100">
                      ${forecast.rbobCurrentAvg.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Gasoil / Diesel ULSD */}
              <div>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    Gasoil / Diesel (HO=F)
                  </span>
                  <span
                    className={`font-mono-tabular font-semibold ${
                      forecast.ulsdDeltaPct <= 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-rose-700 dark:text-rose-400'
                    }`}
                  >
                    {forecast.ulsdDeltaPct >= 0 ? '+' : ''}
                    {forecast.ulsdDeltaPct.toFixed(2)}%
                  </span>
                </div>
                <div className="mt-2 space-y-1.5">
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="w-14 text-slate-500 dark:text-slate-400">Prior Wk</span>
                    <div className="h-2 flex-1 rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className="h-full rounded-full bg-slate-400 dark:bg-slate-600"
                        style={{ width: `${((forecast.ulsdPriorAvg / ulsdMax) * 100).toFixed(0)}%` }}
                      />
                    </div>
                    <span className="font-mono-tabular w-14 text-right text-slate-500 dark:text-slate-400">
                      ${forecast.ulsdPriorAvg.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="w-14 font-semibold text-slate-800 dark:text-slate-200">This Wk</span>
                    <div className="h-2 flex-1 rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className={`h-full rounded-full ${
                          forecast.ulsdDeltaPct <= 0
                            ? 'bg-emerald-600 dark:bg-emerald-500'
                            : 'bg-rose-600 dark:bg-rose-500'
                        }`}
                        style={{ width: `${((forecast.ulsdCurrentAvg / ulsdMax) * 100).toFixed(0)}%` }}
                      />
                    </div>
                    <span className="font-mono-tabular w-14 text-right font-semibold text-slate-900 dark:text-slate-100">
                      ${forecast.ulsdCurrentAvg.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <p className="mt-5 border-t border-slate-200/70 pt-3.5 text-[11px] leading-relaxed text-slate-500 dark:border-slate-800/80 dark:text-slate-400">
            {forecast.explanation}
          </p>
        </div>
      </div>
    </section>
  );
};
