/**
 * 500 km 圆轨道太阳同步 (SSO).
 *
 * 地心半径 a = WGS84 半长轴 + 500 km. 倾角由 J2 升交点进动等于平均太阳角运动解出.
 * 历元上 LTAN = 10:30, 之后升交点赤经按同一平均速率进动.
 * 位置在平赤道平春分点近似下用 GMST 转到 ECEF, 不依赖外网地球定向参数.
 */

import { ecefToGeodetic } from "./geometry.js";

export const MU = 3.986004418e14;
export const J2 = 1.08262668355e-3;
export const RE = 6378137.0;
export const HEIGHT_M = 500000.0;
export const A = RE + HEIGHT_M;
export const ECCENTRICITY = 0;
export const TROPICAL_YEAR_DAYS = 365.2421897;
export const EPOCH_ISO = "2026-03-21T18:00:00Z";
export const EPOCH_JD = 2461120.5;
export const LTAN_HOURS = 10.5;
export const ARGUMENT_OF_LATITUDE_0 = 0;

const DAY = 86400;

export function pyMod(a, n) {
  return ((a % n) + n) % n;
}

export const MEAN_MOTION = Math.sqrt(MU / A ** 3);
export const PERIOD_SEC = (2 * Math.PI) / MEAN_MOTION;
export const MEAN_SOLAR_RATE = (2 * Math.PI) / (TROPICAL_YEAR_DAYS * DAY);

const j2Factor = 1.5 * MEAN_MOTION * J2 * (RE / A) ** 2;
const cosInclination = -MEAN_SOLAR_RATE / j2Factor;
export const INCLINATION = Math.acos(cosInclination);
export const RAAN_RATE = -j2Factor * Math.cos(INCLINATION);

export function sunRightAscensionRad(jd) {
  const n = jd - 2451545.0;
  const wrap = (deg) => ((deg % 360) + 360) % 360;
  const L = (wrap(280.46 + 0.9856474 * n) * Math.PI) / 180;
  const g = (wrap(357.528 + 0.9856003 * n) * Math.PI) / 180;
  const lambda = L + ((1.915 * Math.PI) / 180) * Math.sin(g) + ((0.02 * Math.PI) / 180) * Math.sin(2 * g);
  const eps = ((23.439 - 0.0000004 * n) * Math.PI) / 180;
  return Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
}

export const RAAN0 = pyMod(
  sunRightAscensionRad(EPOCH_JD) + (LTAN_HOURS - 12) * (Math.PI / 12),
  Math.PI * 2
);

export const ELEMENTS = {
  a: A,
  e: ECCENTRICITY,
  i: INCLINATION,
  iDeg: (INCLINATION * 180) / Math.PI,
  raan0: RAAN0,
  raan0Deg: (RAAN0 * 180) / Math.PI,
  argPerigeeDeg: 0,
  u0Deg: 0,
  ltanHours: LTAN_HOURS,
  epochIso: EPOCH_ISO,
  epochJd: EPOCH_JD,
  periodSec: PERIOD_SEC,
  meanMotion: MEAN_MOTION,
  raanRateRadPerSec: RAAN_RATE,
  raanRateDegPerDay: ((RAAN_RATE * DAY) * 180) / Math.PI,
  meanSolarDegPerDay: ((MEAN_SOLAR_RATE * DAY) * 180) / Math.PI,
  heightM: HEIGHT_M,
  mu: MU,
  j2: J2,
  tropicalYearDays: TROPICAL_YEAR_DAYS,
};

export function gmstRad(jd) {
  const t = (jd - 2451545.0) / 36525.0;
  let sec =
    67310.54841 +
    (876600 * 3600 + 8640184.812866) * t +
    0.093104 * t * t -
    6.2e-6 * t * t * t;
  sec = pyMod(sec, DAY);
  return (sec * 2 * Math.PI) / DAY;
}

export function eciToEcef(r, gmst) {
  const c = Math.cos(gmst);
  const s = Math.sin(gmst);
  return [c * r[0] + s * r[1], -s * r[0] + c * r[1], r[2]];
}

export function raanAt(dtSec) {
  return RAAN0 + RAAN_RATE * dtSec;
}

export function argumentOfLatitude(dtSec) {
  return ARGUMENT_OF_LATITUDE_0 + MEAN_MOTION * dtSec;
}

export function ltanHoursAt(jd) {
  const dt = (jd - EPOCH_JD) * DAY;
  const omega = raanAt(dt);
  const sun = sunRightAscensionRad(jd);
  const delta = pyMod(omega - sun + Math.PI, Math.PI * 2) - Math.PI;
  const hours = 12 + ((delta * 180) / Math.PI) / 15;
  return pyMod(hours, 24);
}

function eciPosition(dtSec) {
  const om = raanAt(dtSec);
  const u = argumentOfLatitude(dtSec);
  const ci = Math.cos(INCLINATION);
  const si = Math.sin(INCLINATION);
  const cO = Math.cos(om);
  const sO = Math.sin(om);
  const cu = Math.cos(u);
  const su = Math.sin(u);
  return [
    A * (cO * cu - sO * su * ci),
    A * (sO * cu + cO * su * ci),
    A * (su * si),
  ];
}

export function jdFromDate(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

export function stateAtJd(jd) {
  const dt = (jd - EPOCH_JD) * DAY;
  const eci = eciPosition(dt);
  const gmst = gmstRad(jd);
  const ecef = eciToEcef(eci, gmst);
  const geo = ecefToGeodetic(ecef[0], ecef[1], ecef[2]);
  const u = pyMod(argumentOfLatitude(dt), Math.PI * 2);
  return {
    jd,
    dt,
    eci,
    ecef,
    geo,
    gmst,
    u,
    raan: pyMod(raanAt(dt), Math.PI * 2),
    ltanHours: ltanHoursAt(jd),
  };
}

export function ecefVelocity(jd) {
  const step = 0.05;
  const a = stateAtJd(jd - step / DAY);
  const b = stateAtJd(jd + step / DAY);
  return [
    (b.ecef[0] - a.ecef[0]) / (2 * step),
    (b.ecef[1] - a.ecef[1]) / (2 * step),
    (b.ecef[2] - a.ecef[2]) / (2 * step),
  ];
}

export function sampleEcef(jd0, jd1, stepSec) {
  const out = [];
  for (let jd = jd0; jd <= jd1 + 1e-9; jd += stepSec / DAY) {
    out.push(stateAtJd(jd));
  }
  return out;
}
