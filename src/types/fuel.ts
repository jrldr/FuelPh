export type FuelType = 'gasoline' | 'diesel' | 'kerosene';

export type PriceDirection = 'rollback' | 'hike' | 'mixed' | 'unchanged';

export interface ForecastDriver {
  factor: string;
  impact: 'downward' | 'upward' | 'neutral';
  detail: string;
  metric?: string;
}

export interface FuelPrediction {
  targetTuesdayDate: string;
  effectiveTime: string;
  status: 'confirmed_advisory' | 'mops_projection';
  direction: PriceDirection;
  confidence: 'high' | 'moderate' | 'early_week';
  gasolineDelta: number;
  dieselDelta: number;
  keroseneDelta: number;
  headline: string;
  summary: string;
  explanation: string;
  drivers: ForecastDriver[];
}

export interface PrevailingPrices {
  areaName: string;
  effectiveDate: string;
  gasolineCommon: number;
  gasolineMin: number;
  gasolineMax: number;
  ron91Common: number;
  ron95Common: number;
  ron97Common: number;
  dieselCommon: number;
  dieselMin: number;
  dieselMax: number;
  keroseneCommon: number;
  keroseneMin: number;
  keroseneMax: number;
  regionalAdjustments: {
    region: string;
    gasolineOffset: number;
    dieselOffset: number;
    note: string;
  }[];
}

export interface WeeklyHistoryPoint {
  effectiveDate: string;
  label: string;
  gasolineDelta: number;
  dieselDelta: number;
  keroseneDelta: number;
  gasolinePumpAvg: number;
  dieselPumpAvg: number;
  kerosenePumpAvg: number;
  note: string;
}

export interface CommodityPoint {
  date: string;
  close: number;
}

export interface MarketBenchmarks {
  usdPhpRate: number;
  usdPhpUpdatedAt: string;
  brentUsd: number;
  brentChangePct: number;
  wtiUsd: number;
  wtiChangePct: number;
  brentHistory: CommodityPoint[];
  wtiHistory: CommodityPoint[];
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface NextTuesdayForecast {
  targetTuesdayDate: string;
  effectiveTime: string;
  mopsWindowLabel: string;
  tradingDaysCompleted: number;
  tradingDaysTotal: number;
  direction: PriceDirection;
  confidence: 'high' | 'moderate' | 'early_week';
  gasolineDelta: number;
  dieselDelta: number;
  keroseneDelta: number;
  headline: string;
  summary: string;
  explanation: string;
  rbobPriorAvg: number;
  rbobCurrentAvg: number;
  rbobDeltaPct: number;
  ulsdPriorAvg: number;
  ulsdCurrentAvg: number;
  ulsdDeltaPct: number;
}

export interface LiveFuelReport {
  fetchedAt: string;
  dataSource:
    | 'live_doe_gemini_search'
    | 'live_doe_pdf_and_feeds'
    | 'live_gaswatch_doe_feeds'
    | 'live_public_feeds';
  prediction: FuelPrediction;
  nextWeekForecast: NextTuesdayForecast;
  prevailing: PrevailingPrices;
  history: WeeklyHistoryPoint[];
  benchmarks: MarketBenchmarks;
  sources: GroundingSource[];
}

export interface UserLocation {
  lat: number;
  lng: number;
  city: string;
  province: string;
  region: string;
  displayName: string;
  source: 'gps' | 'search' | 'manual';
}

export interface StationPriceReport {
  gasoline?: number;
  diesel?: number;
  kerosene?: number;
  updatedAt: string;
  note?: string;
}

export interface NearbyStation {
  id: string;
  name: string;
  brand: string;
  brandTier: 'major' | 'independent';
  area?: string;
  address: string;
  distanceKm: number;
  lat: number;
  lng: number;
  estimatedGasoline: number;
  estimatedRon95?: number;
  estimatedDiesel: number;
  estimatedKerosene: number;
  reportedGasoline?: number;
  reportedDiesel?: number;
  reportedKerosene?: number;
  reportedUpdatedAt?: string;
  isUserVerified: boolean;
  priceSource?: 'gaswatch_doe' | 'regional_estimate' | 'user_verified';
}

export interface UserSyncedState {
  theme: 'light' | 'dark';
  preferredFuel: FuelType;
  vehicleName: string;
  tankLiters: number;
  kmPerLiter: number;
  weeklyKm: number;
  savedLocation: UserLocation | null;
  stationReports: Record<string, StationPriceReport>;
  lastSyncedAt: string;
}
