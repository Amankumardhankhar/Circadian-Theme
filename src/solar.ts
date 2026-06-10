import SunCalc from 'suncalc';

export type SolarAnchor = { name: string; time: Date };

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const IST_OFFSET_MIN = 5 * 60 + 30;

const IST_FIXED: Array<[string, number, number]> = [
  ['solarMidnight', 0, 0],
  ['dawn', 5, 30],
  ['sunrise', 6, 0],
  ['morning', 8, 30],
  ['solarNoon', 12, 0],
  ['afternoon', 15, 0],
  ['goldenHour', 18, 0],
  ['sunset', 18, 45],
  ['dusk', 19, 15],
  ['night', 21, 0],
];

function istDateComponents(now: Date): { year: number; month: number; day: number } {
  const shifted = new Date(now.getTime() + IST_OFFSET_MIN * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
}

function istAt(year: number, month: number, day: number, hh: number, mm: number): Date {
  return new Date(Date.UTC(year, month, day, hh - 5, mm - 30));
}

function buildIstRing(now: Date): SolarAnchor[] {
  const { year, month, day } = istDateComponents(now);
  const ring: SolarAnchor[] = IST_FIXED.map(([name, hh, mm]) => ({
    name,
    time: istAt(year, month, day, hh, mm),
  }));
  ring.push({ name: 'solarMidnight', time: istAt(year, month, day + 1, 0, 0) });
  return ring;
}

function buildLocationRing(
  dayDate: Date,
  nextDayDate: Date,
  lat: number,
  lng: number,
): SolarAnchor[] {
  const t = SunCalc.getTimes(dayDate, lat, lng);
  const next = SunCalc.getTimes(nextDayDate, lat, lng);

  const morning = new Date(t.sunrise.getTime() + 2.5 * HOUR_MS);
  const afternoon = new Date(t.solarNoon.getTime() + 3 * HOUR_MS);
  const night = new Date(t.sunset.getTime() + 2.5 * HOUR_MS);

  return [
    { name: 'solarMidnight', time: t.nadir },
    { name: 'dawn', time: t.dawn },
    { name: 'sunrise', time: t.sunrise },
    { name: 'morning', time: morning },
    { name: 'solarNoon', time: t.solarNoon },
    { name: 'afternoon', time: afternoon },
    { name: 'goldenHour', time: t.goldenHour },
    { name: 'sunset', time: t.sunset },
    { name: 'dusk', time: t.dusk },
    { name: 'night', time: night },
    { name: 'solarMidnight', time: next.nadir },
  ];
}

export function getSolarAnchors(
  now: Date,
  location?: { lat: number; lng: number },
): SolarAnchor[] {
  if (!location) return buildIstRing(now);

  const today = SunCalc.getTimes(now, location.lat, location.lng);
  if (now.getTime() < today.nadir.getTime()) {
    const yesterday = new Date(now.getTime() - DAY_MS);
    return buildLocationRing(yesterday, now, location.lat, location.lng);
  }
  const tomorrow = new Date(now.getTime() + DAY_MS);
  return buildLocationRing(now, tomorrow, location.lat, location.lng);
}
