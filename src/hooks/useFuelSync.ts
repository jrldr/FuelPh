import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  FuelType,
  StationPriceReport,
  UserLocation,
  UserSyncedState,
} from '../types/fuel';

const STORAGE_KEY = 'fuelph-user-sync-v1';
const THEME_KEY = 'fuelph-theme';
const CHANNEL_NAME = 'fuelph-realtime-sync';

function getInitialTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'dark';
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
  } catch {
    // ignore
  }
  return 'light';
}

function getDefaultState(): UserSyncedState {
  return {
    theme: getInitialTheme(),
    preferredFuel: 'gasoline',
    vehicleName: 'Daily Commuter',
    tankLiters: 42,
    kmPerLiter: 12.5,
    weeklyKm: 180,
    savedLocation: null,
    stationReports: {},
    lastSyncedAt: new Date().toISOString(),
  };
}

function loadState(): UserSyncedState {
  if (typeof window === 'undefined') return getDefaultState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultState();
    const parsed = JSON.parse(raw) as Partial<UserSyncedState>;
    return {
      ...getDefaultState(),
      ...parsed,
      theme: getInitialTheme(),
      stationReports: parsed.stationReports || {},
    };
  } catch {
    return getDefaultState();
  }
}

export function useFuelSync() {
  const [state, setState] = useState<UserSyncedState>(loadState);
  const channelRef = useRef<BroadcastChannel | null>(null);

  const applyThemeClass = useCallback((theme: 'light' | 'dark') => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    applyThemeClass(state.theme);
  }, [state.theme, applyThemeClass]);

  useEffect(() => {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(CHANNEL_NAME);
      channelRef.current = channel;
      channel.onmessage = (event) => {
        if (event.data?.type === 'STATE_SYNC' && event.data.payload) {
          setState(event.data.payload as UserSyncedState);
        }
      };
    }

    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          const next = JSON.parse(e.newValue) as UserSyncedState;
          setState(next);
        } catch {
          // ignore
        }
      }
      if (e.key === THEME_KEY && (e.newValue === 'light' || e.newValue === 'dark')) {
        setState((prev) => ({ ...prev, theme: e.newValue as 'light' | 'dark' }));
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
      channelRef.current?.close();
    };
  }, []);

  const commitState = useCallback((updater: (prev: UserSyncedState) => UserSyncedState) => {
    setState((prev) => {
      const next = {
        ...updater(prev),
        lastSyncedAt: new Date().toISOString(),
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        localStorage.setItem(THEME_KEY, next.theme);
      } catch {
        // ignore quota errors
      }
      channelRef.current?.postMessage({ type: 'STATE_SYNC', payload: next });
      return next;
    });
  }, []);

  const toggleTheme = useCallback(() => {
    commitState((prev) => ({
      ...prev,
      theme: prev.theme === 'dark' ? 'light' : 'dark',
    }));
  }, [commitState]);

  const setPreferredFuel = useCallback(
    (preferredFuel: FuelType) => {
      commitState((prev) => ({ ...prev, preferredFuel }));
    },
    [commitState]
  );

  const setSavedLocation = useCallback(
    (savedLocation: UserLocation) => {
      commitState((prev) => ({ ...prev, savedLocation }));
    },
    [commitState]
  );

  const updateVehicleProfile = useCallback(
    (patch: Partial<Pick<UserSyncedState, 'vehicleName' | 'tankLiters' | 'kmPerLiter' | 'weeklyKm'>>) => {
      commitState((prev) => ({ ...prev, ...patch }));
    },
    [commitState]
  );

  const reportStationPrice = useCallback(
    (stationId: string, report: Omit<StationPriceReport, 'updatedAt'>) => {
      commitState((prev) => ({
        ...prev,
        stationReports: {
          ...prev.stationReports,
          [stationId]: {
            ...report,
            updatedAt: new Date().toISOString(),
          },
        },
      }));
    },
    [commitState]
  );

  const exportProfileJson = useCallback(() => {
    return JSON.stringify(state, null, 2);
  }, [state]);

  const importProfileJson = useCallback(
    (rawJson: string) => {
      const parsed = JSON.parse(rawJson) as Partial<UserSyncedState>;
      commitState((prev) => ({
        ...prev,
        ...parsed,
        stationReports: {
          ...prev.stationReports,
          ...(parsed.stationReports || {}),
        },
      }));
    },
    [commitState]
  );

  return {
    state,
    toggleTheme,
    setPreferredFuel,
    setSavedLocation,
    updateVehicleProfile,
    reportStationPrice,
    exportProfileJson,
    importProfileJson,
  };
}
