import React, { useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { CommodityPoint, FuelType, GroundingSource, WeeklyHistoryPoint } from '../types/fuel';

interface PriceTrendChartsProps {
  history: WeeklyHistoryPoint[];
  brentHistory: CommodityPoint[];
  sources: GroundingSource[];
  preferredFuel: FuelType;
}

type ChartMode = 'pump' | 'delta' | 'brent';

const SERIES_META: Record<FuelType, { label: string; color: string }> = {
  gasoline: { label: 'Gasoline', color: '#2563EB' },
  diesel: { label: 'Diesel', color: '#059669' },
  kerosene: { label: 'Kerosene', color: '#D97706' },
};

export const PriceTrendCharts: React.FC<PriceTrendChartsProps> = ({
  history,
  brentHistory,
  sources,
  preferredFuel,
}) => {
  const [chartMode, setChartMode] = useState<ChartMode>('pump');
  const [selectedFuels, setSelectedFuels] = useState<Record<FuelType, boolean>>({
    gasoline: true,
    diesel: true,
    kerosene: false,
  });
  const [deltaFuel, setDeltaFuel] = useState<FuelType>(preferredFuel);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const activeFuels = (Object.keys(selectedFuels) as FuelType[]).filter((k) => selectedFuels[k]);

  const toggleFuelSeries = (fuel: FuelType) => {
    setSelectedFuels((prev) => {
      const next = { ...prev, [fuel]: !prev[fuel] };
      if (!next.gasoline && !next.diesel && !next.kerosene) {
        return prev;
      }
      return next;
    });
  };

  const width = 760;
  const height = 276;
  const padL = 54;
  const padR = 18;
  const padT = 20;
  const padB = 34;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const pumpStats = useMemo(() => {
    if (!history.length) return null;
    const values: number[] = [];
    for (const h of history) {
      if (selectedFuels.gasoline && h.gasolinePumpAvg > 0) values.push(h.gasolinePumpAvg);
      if (selectedFuels.diesel && h.dieselPumpAvg > 0) values.push(h.dieselPumpAvg);
      if (selectedFuels.kerosene && h.kerosenePumpAvg > 0) values.push(h.kerosenePumpAvg);
    }
    const min = values.length ? Math.floor(Math.min(...values) - 2) : 50;
    const max = values.length ? Math.ceil(Math.max(...values) + 2) : 100;
    const span = Math.max(max - min, 4);
    const yTicks = [min, min + span * 0.33, min + span * 0.66, max].map((v) =>
      Number(v.toFixed(1))
    );
    return { min, max, span, yTicks };
  }, [history, selectedFuels]);

  const deltaStats = useMemo(() => {
    if (!history.length) return null;
    const vals = history.map((h) =>
      deltaFuel === 'gasoline'
        ? h.gasolineDelta
        : deltaFuel === 'diesel'
          ? h.dieselDelta
          : h.keroseneDelta
    );
    const maxAbs = Math.max(2, ...vals.map((v) => Math.abs(v))) * 1.15;
    return { maxAbs, vals };
  }, [history, deltaFuel]);

  const brentStats = useMemo(() => {
    if (!brentHistory.length) return null;
    const vals = brentHistory.map((p) => p.close);
    const min = Math.floor(Math.min(...vals) - 2);
    const max = Math.ceil(Math.max(...vals) + 2);
    const span = Math.max(max - min, 4);
    const yTicks = [min, min + span * 0.33, min + span * 0.66, max].map((v) =>
      Number(v.toFixed(1))
    );
    return { min, max, span, yTicks };
  }, [brentHistory]);

  const activePointCount = chartMode === 'brent' ? brentHistory.length : history.length;

  const handlePointer = (e: React.PointerEvent<SVGSVGElement>) => {
    if (activePointCount <= 1) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * width;
    const clampedX = Math.max(padL, Math.min(width - padR, relX));
    const idx = Math.round(((clampedX - padL) / plotW) * (activePointCount - 1));
    setHoverIdx(Math.max(0, Math.min(activePointCount - 1, idx)));
  };

  const activeHoverIdx =
    hoverIdx !== null && hoverIdx < activePointCount
      ? hoverIdx
      : activePointCount > 0
        ? activePointCount - 1
        : null;

  return (
    <section aria-labelledby="trends-heading" className="space-y-6">
      <div className="rounded-xl border border-slate-200/90 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)] dark:border-slate-800 dark:bg-[#0F1522]">
        {/* Header + Controls */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2
              id="trends-heading"
              className="text-lg font-bold tracking-tight text-slate-950 dark:text-white"
            >
              Historical Price Trends & Benchmark Correlation
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Weekly Tuesday NCR average pump movements and global Brent crude trajectory
            </p>
          </div>

          <div
            role="tablist"
            aria-label="Chart mode"
            className="inline-flex rounded-lg border border-slate-200/80 bg-slate-100/80 p-1 dark:border-slate-800 dark:bg-[#151D2E]"
          >
            {(
              [
                { id: 'pump', label: 'Pump Price (₱/L)' },
                { id: 'delta', label: 'Weekly Δ' },
                { id: 'brent', label: 'Brent 3M ($)' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={chartMode === tab.id}
                onClick={() => {
                  setChartMode(tab.id);
                  setHoverIdx(null);
                }}
                className={`min-h-[36px] rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-150 whitespace-nowrap shrink-0 ${
                  chartMode === tab.id
                    ? 'bg-white text-slate-950 shadow-xs dark:bg-[#0F1522] dark:text-white'
                    : 'text-slate-600 hover:text-slate-950 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Series Filter + Active Readout Bar */}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 pb-4 dark:border-slate-800">
          {chartMode === 'pump' && (
            <div className="flex flex-wrap items-center gap-2">
              {(Object.keys(SERIES_META) as FuelType[]).map((fuel) => {
                const active = selectedFuels[fuel];
                return (
                  <button
                    key={fuel}
                    type="button"
                    onClick={() => toggleFuelSeries(fuel)}
                    className={`inline-flex min-h-[36px] items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                      active
                        ? 'border-slate-300 bg-slate-50 text-slate-900 dark:border-slate-700 dark:bg-[#151D2E] dark:text-slate-100'
                        : 'border-transparent text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-xs"
                      style={{ backgroundColor: SERIES_META[fuel].color, opacity: active ? 1 : 0.3 }}
                      aria-hidden="true"
                    />
                    <span>{SERIES_META[fuel].label}</span>
                  </button>
                );
              })}
            </div>
          )}

          {chartMode === 'delta' && (
            <div className="flex flex-wrap items-center gap-2">
              {(Object.keys(SERIES_META) as FuelType[]).map((fuel) => (
                <button
                  key={fuel}
                  type="button"
                  onClick={() => setDeltaFuel(fuel)}
                  className={`min-h-[36px] rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    deltaFuel === fuel
                      ? 'bg-slate-900 text-white dark:bg-blue-600 dark:text-white'
                      : 'bg-slate-100 text-slate-600 hover:text-slate-900 dark:bg-[#151D2E] dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  {SERIES_META[fuel].label}
                </button>
              ))}
            </div>
          )}

          {chartMode === 'brent' && (
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
              ICE Brent Crude Futures (BZ=F) · 90-Day Daily Close in USD/bbl
            </div>
          )}

          {/* Crosshair Readout */}
          {activeHoverIdx !== null && chartMode === 'pump' && history[activeHoverIdx] && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span className="font-semibold text-slate-950 dark:text-white">
                {history[activeHoverIdx].label}
              </span>
              {selectedFuels.gasoline && (
                <span className="font-mono-tabular font-medium text-blue-700 dark:text-blue-400">
                  Gas ₱{history[activeHoverIdx].gasolinePumpAvg.toFixed(2)}
                </span>
              )}
              {selectedFuels.diesel && (
                <span className="font-mono-tabular font-medium text-emerald-700 dark:text-emerald-400">
                  Diesel ₱{history[activeHoverIdx].dieselPumpAvg.toFixed(2)}
                </span>
              )}
              {selectedFuels.kerosene && (
                <span className="font-mono-tabular font-medium text-amber-700 dark:text-amber-400">
                  Kero ₱{history[activeHoverIdx].kerosenePumpAvg.toFixed(2)}
                </span>
              )}
            </div>
          )}

          {activeHoverIdx !== null && chartMode === 'delta' && history[activeHoverIdx] && (
            <div className="flex items-center gap-3 text-xs">
              <span className="font-semibold text-slate-950 dark:text-white">
                {history[activeHoverIdx].label}
              </span>
              {(() => {
                const v =
                  deltaFuel === 'gasoline'
                    ? history[activeHoverIdx].gasolineDelta
                    : deltaFuel === 'diesel'
                      ? history[activeHoverIdx].dieselDelta
                      : history[activeHoverIdx].keroseneDelta;
                return (
                  <span
                    className={`font-mono-tabular font-semibold ${
                      v <= 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-rose-700 dark:text-rose-400'
                    }`}
                  >
                    {v > 0 ? `+₱${v.toFixed(2)}` : v < 0 ? `-₱${Math.abs(v).toFixed(2)}` : '₱0.00'}/L
                  </span>
                );
              })()}
            </div>
          )}

          {activeHoverIdx !== null && chartMode === 'brent' && brentHistory[activeHoverIdx] && (
            <div className="flex items-center gap-3 text-xs">
              <span className="font-semibold text-slate-950 dark:text-white">
                {brentHistory[activeHoverIdx].date}
              </span>
              <span className="font-mono-tabular font-semibold text-blue-700 dark:text-blue-400">
                ${brentHistory[activeHoverIdx].close.toFixed(2)}/bbl
              </span>
            </div>
          )}
        </div>

        {/* SVG Chart Viewport */}
        <div className="mt-5 w-full overflow-hidden">
          {activePointCount === 0 ? (
            <div className="flex h-64 items-center justify-center text-sm text-slate-500 dark:text-slate-400">
              No historical data available for this series yet.
            </div>
          ) : (
            <svg
              viewBox={`0 0 ${width} ${height}`}
              className="h-64 w-full touch-pan-y select-none sm:h-72"
              onPointerMove={handlePointer}
              onPointerDown={handlePointer}
              onPointerLeave={() => setHoverIdx(null)}
              role="img"
              aria-label="Interactive fuel price trend chart"
            >
              {/* Pump Price Multi-Line Chart */}
              {chartMode === 'pump' && pumpStats && (
                <>
                  {pumpStats.yTicks.map((tick) => {
                    const y = padT + plotH - ((tick - pumpStats.min) / pumpStats.span) * plotH;
                    return (
                      <g key={tick}>
                        <line
                          x1={padL}
                          x2={width - padR}
                          y1={y}
                          y2={y}
                          className="stroke-slate-200/80 dark:stroke-slate-800"
                          strokeDasharray="3 3"
                        />
                        <text
                          x={padL - 8}
                          y={y + 4}
                          textAnchor="end"
                          className="fill-slate-400 text-[10px] font-mono dark:fill-slate-500"
                        >
                          ₱{tick.toFixed(0)}
                        </text>
                      </g>
                    );
                  })}

                  {activeFuels.map((fuel, fuelIdx) => {
                    const points = history.map((h, i) => {
                      const val =
                        fuel === 'gasoline'
                          ? h.gasolinePumpAvg
                          : fuel === 'diesel'
                            ? h.dieselPumpAvg
                            : h.kerosenePumpAvg;
                      const x =
                        padL +
                        (history.length > 1 ? (i / (history.length - 1)) * plotW : plotW / 2);
                      const y = padT + plotH - ((val - pumpStats.min) / pumpStats.span) * plotH;
                      return { x, y, val };
                    });

                    const pathD = points
                      .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
                      .join(' ');
                    const areaD = `${pathD} L ${points[points.length - 1].x.toFixed(1)} ${padT + plotH} L ${points[0].x.toFixed(1)} ${padT + plotH} Z`;
                    const gradId = `pumpFill-${fuel}`;

                    return (
                      <g key={fuel}>
                        {fuelIdx === 0 && (
                          <>
                            <defs>
                              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={SERIES_META[fuel].color} stopOpacity="0.12" />
                                <stop offset="100%" stopColor={SERIES_META[fuel].color} stopOpacity="0.0" />
                              </linearGradient>
                            </defs>
                            <path d={areaD} fill={`url(#${gradId})`} />
                          </>
                        )}
                        <path
                          d={pathD}
                          fill="none"
                          stroke={SERIES_META[fuel].color}
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        {points.map((p, idx) => (
                          <circle
                            key={idx}
                            cx={p.x}
                            cy={p.y}
                            r={activeHoverIdx === idx ? 5 : 3}
                            fill={SERIES_META[fuel].color}
                            className="stroke-white dark:stroke-[#0F1522]"
                            strokeWidth="1.75"
                          />
                        ))}
                      </g>
                    );
                  })}

                  {activeHoverIdx !== null && history.length > 1 && (
                    <line
                      x1={padL + (activeHoverIdx / (history.length - 1)) * plotW}
                      x2={padL + (activeHoverIdx / (history.length - 1)) * plotW}
                      y1={padT}
                      y2={padT + plotH}
                      className="stroke-slate-400/60 dark:stroke-slate-600"
                      strokeDasharray="2 2"
                    />
                  )}

                  {history.map((h, i) => {
                    if (history.length > 7 && i % 2 !== 0 && i !== history.length - 1) return null;
                    const x =
                      padL +
                      (history.length > 1 ? (i / (history.length - 1)) * plotW : plotW / 2);
                    return (
                      <text
                        key={h.effectiveDate}
                        x={x}
                        y={height - 10}
                        textAnchor="middle"
                        className="fill-slate-400 text-[10px] dark:fill-slate-500"
                      >
                        {h.label}
                      </text>
                    );
                  })}
                </>
              )}

              {/* Weekly Adjustment Delta Bar Chart */}
              {chartMode === 'delta' && deltaStats && (
                <>
                  {(() => {
                    const zeroY = padT + plotH / 2;
                    const barSlot = plotW / Math.max(history.length, 1);
                    const barW = Math.min(34, barSlot * 0.6);

                    return (
                      <>
                        {[-deltaStats.maxAbs, -deltaStats.maxAbs / 2, 0, deltaStats.maxAbs / 2, deltaStats.maxAbs].map(
                          (tick, idx) => {
                            const y = zeroY - (tick / deltaStats.maxAbs) * (plotH / 2);
                            return (
                              <g key={idx}>
                                <line
                                  x1={padL}
                                  x2={width - padR}
                                  y1={y}
                                  y2={y}
                                  className={
                                    tick === 0
                                      ? 'stroke-slate-400 dark:stroke-slate-600'
                                      : 'stroke-slate-200/80 dark:stroke-slate-800'
                                  }
                                  strokeDasharray={tick === 0 ? undefined : '3 3'}
                                />
                                <text
                                  x={padL - 8}
                                  y={y + 4}
                                  textAnchor="end"
                                  className="fill-slate-400 text-[10px] font-mono dark:fill-slate-500"
                                >
                                  {tick > 0 ? `+${tick.toFixed(1)}` : tick.toFixed(1)}
                                </text>
                              </g>
                            );
                          }
                        )}

                        {history.map((h, i) => {
                          const v = deltaStats.vals[i];
                          const barH = (Math.abs(v) / deltaStats.maxAbs) * (plotH / 2);
                          const x = padL + i * barSlot + (barSlot - barW) / 2;
                          const y = v >= 0 ? zeroY - barH : zeroY;
                          const isRollback = v <= 0;

                          return (
                            <g key={h.effectiveDate}>
                              <rect
                                x={x}
                                y={y}
                                width={barW}
                                height={Math.max(barH, 2)}
                                rx={3}
                                fill={isRollback ? '#059669' : '#E11D48'}
                                opacity={activeHoverIdx === i ? 1 : 0.8}
                              />
                              {(history.length <= 8 || i % 2 === 0 || i === history.length - 1) && (
                                <text
                                  x={x + barW / 2}
                                  y={height - 10}
                                  textAnchor="middle"
                                  className="fill-slate-400 text-[10px] dark:fill-slate-500"
                                >
                                  {h.label}
                                </text>
                              )}
                            </g>
                          );
                        })}
                      </>
                    );
                  })()}
                </>
              )}

              {/* Brent Crude 3-Month Chart */}
              {chartMode === 'brent' && brentStats && (
                <>
                  {brentStats.yTicks.map((tick) => {
                    const y = padT + plotH - ((tick - brentStats.min) / brentStats.span) * plotH;
                    return (
                      <g key={tick}>
                        <line
                          x1={padL}
                          x2={width - padR}
                          y1={y}
                          y2={y}
                          className="stroke-slate-200/80 dark:stroke-slate-800"
                          strokeDasharray="3 3"
                        />
                        <text
                          x={padL - 8}
                          y={y + 4}
                          textAnchor="end"
                          className="fill-slate-400 text-[10px] font-mono dark:fill-slate-500"
                        >
                          ${tick.toFixed(0)}
                        </text>
                      </g>
                    );
                  })}

                  {(() => {
                    const pts = brentHistory.map((p, i) => ({
                      x:
                        padL +
                        (brentHistory.length > 1
                          ? (i / (brentHistory.length - 1)) * plotW
                          : plotW / 2),
                      y: padT + plotH - ((p.close - brentStats.min) / brentStats.span) * plotH,
                    }));
                    const lineD = pts
                      .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
                      .join(' ');
                    const areaD = `${lineD} L ${pts[pts.length - 1].x.toFixed(1)} ${padT + plotH} L ${pts[0].x.toFixed(1)} ${padT + plotH} Z`;

                    return (
                      <>
                        <defs>
                          <linearGradient id="brentFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#2563EB" stopOpacity="0.2" />
                            <stop offset="100%" stopColor="#2563EB" stopOpacity="0.0" />
                          </linearGradient>
                        </defs>
                        <path d={areaD} fill="url(#brentFill)" />
                        <path
                          d={lineD}
                          fill="none"
                          stroke="#2563EB"
                          strokeWidth="2.25"
                          strokeLinecap="round"
                        />
                        {activeHoverIdx !== null && pts[activeHoverIdx] && (
                          <>
                            <line
                              x1={pts[activeHoverIdx].x}
                              x2={pts[activeHoverIdx].x}
                              y1={padT}
                              y2={padT + plotH}
                              className="stroke-slate-400/60 dark:stroke-slate-600"
                              strokeDasharray="2 2"
                            />
                            <circle
                              cx={pts[activeHoverIdx].x}
                              cy={pts[activeHoverIdx].y}
                              r="5"
                              fill="#2563EB"
                              className="stroke-white dark:stroke-[#0F1522]"
                              strokeWidth="2"
                            />
                          </>
                        )}
                      </>
                    );
                  })()}

                  {brentHistory.map((p, i) => {
                    const step = Math.max(1, Math.floor(brentHistory.length / 5));
                    if (i % step !== 0 && i !== brentHistory.length - 1) return null;
                    const x =
                      padL +
                      (brentHistory.length > 1
                        ? (i / (brentHistory.length - 1)) * plotW
                        : plotW / 2);
                    return (
                      <text
                        key={p.date}
                        x={x}
                        y={height - 10}
                        textAnchor="middle"
                        className="fill-slate-400 text-[10px] dark:fill-slate-500"
                      >
                        {p.date.slice(5)}
                      </text>
                    );
                  })}
                </>
              )}
            </svg>
          )}
        </div>
      </div>

      {/* Historical Weekly Adjustment Ledger */}
      <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)] dark:border-slate-800 dark:bg-[#0F1522]">
        <div className="border-b border-slate-200/80 px-6 py-4 dark:border-slate-800">
          <h3 className="text-base font-bold tracking-tight text-slate-950 dark:text-white">
            Weekly Tuesday Adjustment Ledger
          </h3>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Chronological record of DOE-monitored Philippine Tuesday pump price movements
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200/80 bg-slate-50/70 text-slate-500 dark:border-slate-800 dark:bg-[#151D2E]/60 dark:text-slate-400">
                <th className="px-6 py-3 font-semibold">Effective Tuesday</th>
                <th className="px-4 py-3 text-right font-semibold">Gasoline Δ</th>
                <th className="px-4 py-3 text-right font-semibold">Diesel Δ</th>
                <th className="px-4 py-3 text-right font-semibold">Kerosene Δ</th>
                <th className="px-4 py-3 text-right font-semibold">NCR Gas Avg</th>
                <th className="px-4 py-3 text-right font-semibold">NCR Diesel Avg</th>
                <th className="px-6 py-3 font-semibold">Market Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800/80">
              {[...history].reverse().map((row) => (
                <tr
                  key={row.effectiveDate}
                  className="transition-colors hover:bg-slate-50/80 dark:hover:bg-[#151D2E]/60"
                >
                  <td className="px-6 py-3.5 font-mono-tabular font-semibold text-slate-900 whitespace-nowrap dark:text-slate-100">
                    {row.effectiveDate}
                  </td>
                  {[row.gasolineDelta, row.dieselDelta, row.keroseneDelta].map((val, idx) => (
                    <td
                      key={idx}
                      className={`px-4 py-3.5 text-right font-mono-tabular font-semibold whitespace-nowrap ${
                        val < -0.001
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : val > 0.001
                            ? 'text-rose-700 dark:text-rose-400'
                            : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {val > 0 ? `+₱${val.toFixed(2)}` : val < 0 ? `-₱${Math.abs(val).toFixed(2)}` : '₱0.00'}
                    </td>
                  ))}
                  <td className="px-4 py-3.5 text-right font-mono-tabular text-slate-700 whitespace-nowrap dark:text-slate-200">
                    ₱{row.gasolinePumpAvg.toFixed(2)}
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono-tabular text-slate-700 whitespace-nowrap dark:text-slate-200">
                    ₱{row.dieselPumpAvg.toFixed(2)}
                  </td>
                  <td className="px-6 py-3.5 text-slate-600 dark:text-slate-400">
                    {row.note}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {sources.length > 0 && (
          <div className="border-t border-slate-200/80 bg-slate-50/40 px-6 py-4 dark:border-slate-800 dark:bg-[#151D2E]/30">
            <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Verified Live Sources
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
              {sources.slice(0, 6).map((src) => (
                <a
                  key={src.uri}
                  href={src.uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:underline dark:text-blue-400"
                >
                  <span className="max-w-[220px] truncate">{src.title}</span>
                  <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
