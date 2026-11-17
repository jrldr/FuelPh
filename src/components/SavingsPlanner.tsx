import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Check, Download, Sparkles, Upload } from 'lucide-react';
import { getRegionalOffset } from '../services/liveFuelService';
import type { FuelType, LiveFuelReport, UserSyncedState } from '../types/fuel';

interface SavingsPlannerProps {
  report: LiveFuelReport;
  syncState: UserSyncedState;
  onSelectFuel: (fuel: FuelType) => void;
  onUpdateProfile: (
    patch: Partial<Pick<UserSyncedState, 'vehicleName' | 'tankLiters' | 'kmPerLiter' | 'weeklyKm'>>
  ) => void;
  onExportJson: () => string;
  onImportJson: (raw: string) => void;
}

const VEHICLE_PRESETS = [
  { label: 'Motorcycle / Scooter', name: 'Motorcycle (3.9L)', tank: 3.9, kmPerL: 50, weeklyKm: 120 },
  { label: 'Maxi Scooter', name: 'Maxi Scooter (7.1L)', tank: 7.1, kmPerL: 38, weeklyKm: 150 },
  { label: 'Sedan / Hatch', name: 'Sedan / Hatch (42L)', tank: 42, kmPerL: 13.5, weeklyKm: 180 },
  { label: 'SUV / Pickup', name: 'SUV / Pickup (75L)', tank: 75, kmPerL: 9.5, weeklyKm: 220 },
];

export const SavingsPlanner: React.FC<SavingsPlannerProps> = ({
  report,
  syncState,
  onSelectFuel,
  onUpdateProfile,
  onExportJson,
  onImportJson,
}) => {
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Local string states to allow natural typing (e.g. typing 3.9, backspacing, etc.)
  const [vehicleNameInput, setVehicleNameInput] = useState<string>(syncState.vehicleName);
  const [tankLitersInput, setTankLitersInput] = useState<string>(String(syncState.tankLiters));
  const [weeklyKmInput, setWeeklyKmInput] = useState<string>(String(syncState.weeklyKm));
  const [kmPerLiterInput, setKmPerLiterInput] = useState<string>(String(syncState.kmPerLiter));

  useEffect(() => {
    setVehicleNameInput(syncState.vehicleName);
  }, [syncState.vehicleName]);

  useEffect(() => {
    setTankLitersInput(String(syncState.tankLiters));
  }, [syncState.tankLiters]);

  useEffect(() => {
    setWeeklyKmInput(String(syncState.weeklyKm));
  }, [syncState.weeklyKm]);

  useEffect(() => {
    setKmPerLiterInput(String(syncState.kmPerLiter));
  }, [syncState.kmPerLiter]);

  const { prediction, prevailing, nextWeekForecast } = report;
  const activeFuel = syncState.preferredFuel;

  const { gasOffset, dieselOffset } = useMemo(() => {
    if (!syncState.savedLocation) return { gasOffset: 0, dieselOffset: 0 };
    return getRegionalOffset(
      `${syncState.savedLocation.region} ${syncState.savedLocation.province} ${syncState.savedLocation.city}`,
      prevailing
    );
  }, [syncState.savedLocation, prevailing]);

  const localGas = Number((prevailing.gasolineCommon + gasOffset).toFixed(2));
  const localDiesel = Number((prevailing.dieselCommon + dieselOffset).toFixed(2));
  const localKero = Number((prevailing.keroseneCommon + dieselOffset).toFixed(2));

  const currentPrice =
    activeFuel === 'gasoline'
      ? localGas
      : activeFuel === 'diesel'
        ? localDiesel
        : localKero;

  const activeForecast = nextWeekForecast ?? prediction;

  const upcomingDelta =
    activeFuel === 'gasoline'
      ? activeForecast.gasolineDelta
      : activeFuel === 'diesel'
        ? activeForecast.dieselDelta
        : activeForecast.keroseneDelta;

  const postTuesdayPrice = Math.max(0, currentPrice + upcomingDelta);
  const fullTankImpact = Number((syncState.tankLiters * Math.abs(upcomingDelta)).toFixed(2));
  const weeklyLiters = syncState.kmPerLiter > 0 ? syncState.weeklyKm / syncState.kmPerLiter : 0;
  const monthlySpendNow = weeklyLiters * 4.33 * currentPrice;
  const monthlySpendPost = weeklyLiters * 4.33 * postTuesdayPrice;

  const isRollback = upcomingDelta < -0.001;
  const isHike = upcomingDelta > 0.001;

  const handleDownloadBackup = () => {
    const json = onExportJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fuelph-sync-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        onImportJson(String(reader.result || ''));
        setImportMessage('Profile and logged station prices restored.');
      } catch {
        setImportMessage('Invalid FuelPh backup file.');
      }
    };
    reader.readAsText(file);
  };

  const handleVehicleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setVehicleNameInput(val);
    onUpdateProfile({ vehicleName: val });
  };

  const handleTankChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const valStr = e.target.value;
    setTankLitersInput(valStr);
    const val = parseFloat(valStr);
    if (!isNaN(val) && val > 0 && val <= 500) {
      onUpdateProfile({ tankLiters: Number(val.toFixed(2)) });
    }
  };

  const handleTankBlur = () => {
    const val = parseFloat(tankLitersInput);
    if (isNaN(val) || val <= 0) {
      setTankLitersInput(String(syncState.tankLiters));
    } else {
      const clamped = Math.max(0.5, Math.min(500, Number(val.toFixed(2))));
      setTankLitersInput(String(clamped));
      onUpdateProfile({ tankLiters: clamped });
    }
  };

  const handleWeeklyKmChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const valStr = e.target.value;
    setWeeklyKmInput(valStr);
    const val = parseFloat(valStr);
    if (!isNaN(val) && val >= 0 && val <= 10000) {
      onUpdateProfile({ weeklyKm: Number(val.toFixed(1)) });
    }
  };

  const handleWeeklyKmBlur = () => {
    const val = parseFloat(weeklyKmInput);
    if (isNaN(val) || val < 0) {
      setWeeklyKmInput(String(syncState.weeklyKm));
    } else {
      const clamped = Math.max(1, Math.min(10000, Number(val.toFixed(1))));
      setWeeklyKmInput(String(clamped));
      onUpdateProfile({ weeklyKm: clamped });
    }
  };

  const handleKmPerLiterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const valStr = e.target.value;
    setKmPerLiterInput(valStr);
    const val = parseFloat(valStr);
    if (!isNaN(val) && val > 0 && val <= 150) {
      onUpdateProfile({ kmPerLiter: Number(val.toFixed(1)) });
    }
  };

  const handleKmPerLiterBlur = () => {
    const val = parseFloat(kmPerLiterInput);
    if (isNaN(val) || val <= 0) {
      setKmPerLiterInput(String(syncState.kmPerLiter));
    } else {
      const clamped = Math.max(1, Math.min(150, Number(val.toFixed(1))));
      setKmPerLiterInput(String(clamped));
      onUpdateProfile({ kmPerLiter: clamped });
    }
  };

  const applyPreset = (preset: typeof VEHICLE_PRESETS[number]) => {
    setVehicleNameInput(preset.name);
    setTankLitersInput(String(preset.tank));
    setKmPerLiterInput(String(preset.kmPerL));
    setWeeklyKmInput(String(preset.weeklyKm));
    onUpdateProfile({
      vehicleName: preset.name,
      tankLiters: preset.tank,
      kmPerLiter: preset.kmPerL,
      weeklyKm: preset.weeklyKm,
    });
  };

  return (
    <section aria-labelledby="planner-heading" className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Left 7 cols: Vehicle & Tuesday Timing Advisor */}
      <div className="rounded-xl border border-slate-200/90 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)] dark:border-slate-800 dark:bg-[#0F1522] lg:col-span-7">
        <h2
          id="planner-heading"
          className="text-lg font-bold tracking-tight text-slate-950 dark:text-white"
        >
          Tuesday Fill-Up Timing Advisor
        </h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Calculate exact Peso savings before or after Tuesday 6:00 AM pump adjustments
        </p>

        {/* Action Recommendation Callout */}
        <div className="mt-5 rounded-lg border border-slate-200/80 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-[#151D2E]/80">
          <div className="flex items-center gap-2 text-xs font-semibold">
            {isRollback ? (
              <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                <ArrowDownRight className="h-4 w-4" aria-hidden="true" />
                Wait until Tuesday 6:00 AM ({activeForecast.targetTuesdayDate})
              </span>
            ) : isHike ? (
              <span className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-400">
                <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                Fill up before Tuesday 6:00 AM ({activeForecast.targetTuesdayDate})
              </span>
            ) : (
              <span className="text-slate-600 dark:text-slate-300">
                Minimal movement projected for Tuesday ({activeForecast.targetTuesdayDate})
              </span>
            )}
          </div>

          <p className="mt-1.5 text-sm text-slate-700 dark:text-slate-200">
            {isRollback ? (
              <>
                Holding off on a <span className="font-mono-tabular font-semibold">{syncState.tankLiters}L</span>{' '}
                {activeFuel} full tank until Tuesday saves{' '}
                <span className="font-mono-tabular font-bold text-emerald-700 dark:text-emerald-400">
                  ₱{fullTankImpact.toFixed(2)}
                </span>{' '}
                (₱{Math.abs(upcomingDelta).toFixed(2)}/L cheaper).
              </>
            ) : isHike ? (
              <>
                Filling your <span className="font-mono-tabular font-semibold">{syncState.tankLiters}L</span>{' '}
                {activeFuel} tank before Tuesday avoids an extra{' '}
                <span className="font-mono-tabular font-bold text-rose-700 dark:text-rose-400">
                  ₱{fullTankImpact.toFixed(2)}
                </span>{' '}
                at the pump.
              </>
            ) : (
              <>No major full-tank price swing is currently projected for {activeFuel}.</>
            )}
          </p>
        </div>

        {/* Quick Vehicle Presets */}
        <div className="mt-5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
            <Sparkles className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
            <span>Quick Presets:</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {VEHICLE_PRESETS.map((preset) => {
              const isMatch = Math.abs(syncState.tankLiters - preset.tank) < 0.1;
              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className={`inline-flex min-h-[34px] items-center rounded-lg border px-3 py-1 text-xs font-medium transition-colors ${
                    isMatch
                      ? 'border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-950/40 dark:text-blue-300'
                      : 'border-slate-200 bg-slate-50/70 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#151D2E] dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  <span>{preset.label}</span>
                  <span className="ml-1.5 font-mono-tabular opacity-75">({preset.tank}L)</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Vehicle Profile Inputs with High-Contrast Dark Mode Styling */}
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="vehicle-name"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              Vehicle Profile Name
            </label>
            <input
              id="vehicle-name"
              type="text"
              value={vehicleNameInput}
              onChange={handleVehicleNameChange}
              placeholder="e.g. Honda Beat 110"
              className="mt-1.5 min-h-[42px] w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-600/30 dark:border-slate-700 dark:bg-[#151D2E] dark:text-white dark:placeholder:text-slate-500 dark:focus:border-blue-500 dark:focus:bg-[#151D2E] dark:focus:ring-blue-500/30"
            />
          </div>

          <div>
            <label
              htmlFor="planner-fuel-type"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              Fuel Grade
            </label>
            <select
              id="planner-fuel-type"
              value={activeFuel}
              onChange={(e) => onSelectFuel(e.target.value as FuelType)}
              className="mt-1.5 min-h-[42px] w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-600/30 dark:border-slate-700 dark:bg-[#151D2E] dark:text-white dark:focus:border-blue-500 dark:focus:bg-[#151D2E] dark:focus:ring-blue-500/30"
            >
              <option value="gasoline" className="bg-white text-slate-900 dark:bg-[#151D2E] dark:text-white">
                Gasoline (₱{localGas.toFixed(2)}/L)
              </option>
              <option value="diesel" className="bg-white text-slate-900 dark:bg-[#151D2E] dark:text-white">
                Diesel (₱{localDiesel.toFixed(2)}/L)
              </option>
              <option value="kerosene" className="bg-white text-slate-900 dark:bg-[#151D2E] dark:text-white">
                Kerosene (₱{localKero.toFixed(2)}/L)
              </option>
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label
                htmlFor="tank-liters"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Tank Capacity (Liters)
              </label>
              <span className="text-[11px] text-slate-400 dark:text-slate-500">
                Supports motorcycles & cars
              </span>
            </div>
            <input
              id="tank-liters"
              type="number"
              step="0.1"
              min="0.5"
              max="500"
              value={tankLitersInput}
              onChange={handleTankChange}
              onBlur={handleTankBlur}
              placeholder="e.g. 3.9"
              className="mt-1.5 min-h-[42px] w-full rounded-lg border border-slate-200 bg-white px-3 font-mono-tabular text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-600/30 dark:border-slate-700 dark:bg-[#151D2E] dark:text-white dark:placeholder:text-slate-500 dark:focus:border-blue-500 dark:focus:bg-[#151D2E] dark:focus:ring-blue-500/30"
            />
          </div>

          <div>
            <label
              htmlFor="km-per-liter"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              Fuel Economy (km/L)
            </label>
            <input
              id="km-per-liter"
              type="number"
              step="0.1"
              min="1"
              max="150"
              value={kmPerLiterInput}
              onChange={handleKmPerLiterChange}
              onBlur={handleKmPerLiterBlur}
              placeholder="e.g. 45"
              className="mt-1.5 min-h-[42px] w-full rounded-lg border border-slate-200 bg-white px-3 font-mono-tabular text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-600/30 dark:border-slate-700 dark:bg-[#151D2E] dark:text-white dark:placeholder:text-slate-500 dark:focus:border-blue-500 dark:focus:bg-[#151D2E] dark:focus:ring-blue-500/30"
            />
          </div>

          <div className="sm:col-span-2">
            <label
              htmlFor="weekly-km"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              Weekly Distance (km)
            </label>
            <input
              id="weekly-km"
              type="number"
              step="1"
              min="1"
              max="10000"
              value={weeklyKmInput}
              onChange={handleWeeklyKmChange}
              onBlur={handleWeeklyKmBlur}
              placeholder="e.g. 120"
              className="mt-1.5 min-h-[42px] w-full rounded-lg border border-slate-200 bg-white px-3 font-mono-tabular text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-600/30 dark:border-slate-700 dark:bg-[#151D2E] dark:text-white dark:placeholder:text-slate-500 dark:focus:border-blue-500 dark:focus:bg-[#151D2E] dark:focus:ring-blue-500/30"
            />
          </div>
        </div>
      </div>

      {/* Right 5 cols: Budget Breakdown + Cross-Device Sync Backup */}
      <div className="flex flex-col justify-between rounded-xl border border-slate-200/90 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)] dark:border-slate-800 dark:bg-[#0F1522] lg:col-span-5">
        <div>
          <h3 className="text-base font-bold tracking-tight text-slate-950 dark:text-white">
            Estimated Fuel Spend
          </h3>
          <dl className="mt-4 divide-y divide-slate-200/70 border-t border-slate-200/80 text-sm dark:divide-slate-800 dark:border-slate-800">
            <div className="flex items-center justify-between py-3.5">
              <dt className="text-xs font-medium text-slate-600 dark:text-slate-400">
                Weekly consumption
              </dt>
              <dd className="font-mono-tabular text-sm font-semibold text-slate-950 dark:text-white">
                {weeklyLiters.toFixed(2)} L
              </dd>
            </div>
            <div className="flex items-center justify-between py-3.5">
              <dt className="text-xs font-medium text-slate-600 dark:text-slate-400">
                Current monthly cost
              </dt>
              <dd className="font-mono-tabular text-sm font-semibold text-slate-950 dark:text-white">
                ₱{monthlySpendNow.toLocaleString('en-PH', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}
              </dd>
            </div>
            <div className="flex items-center justify-between py-3.5">
              <dt className="text-xs font-medium text-slate-600 dark:text-slate-400">
                Projected post-Tuesday monthly
              </dt>
              <dd className="font-mono-tabular text-sm font-semibold text-slate-950 dark:text-white">
                ₱{monthlySpendPost.toLocaleString('en-PH', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}
              </dd>
            </div>
            <div className="flex items-center justify-between py-3.5">
              <dt className="text-xs font-medium text-slate-600 dark:text-slate-400">
                Full tank cost after Tuesday
              </dt>
              <dd className="font-mono-tabular text-base font-bold text-slate-950 dark:text-white">
                ₱{(syncState.tankLiters * postTuesdayPrice).toFixed(2)}
              </dd>
            </div>
          </dl>
        </div>

        <div className="mt-6 border-t border-slate-200/80 pt-5 dark:border-slate-800">
          <div className="text-xs font-semibold text-slate-950 dark:text-white">
            Real-Time Tab Sync & Portable Backup
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Vehicle settings and logged station prices sync live across open tabs. Export or restore JSON to transfer between devices.
          </p>

          <div className="mt-3.5 flex flex-wrap gap-2.5">
            <button
              type="button"
              onClick={handleDownloadBackup}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-[#151D2E]"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Export Profile</span>
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-[#151D2E]"
            >
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Import Profile</span>
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              onChange={handleFileImport}
              className="hidden"
            />
          </div>

          {importMessage && (
            <div className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{importMessage}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
