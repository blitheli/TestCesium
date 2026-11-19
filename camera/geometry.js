/**
 * 矩形相机像面几何. 与 extract_fov_tiles.py 的瓦片公式, WGS84 射线求交,
 * Cesium Camera 标架保持同一含义.
 *
 * 标架: direction = -Z, up = +Y, right = +X.
 * HPR: heading=0 朝北, pitch=-90 为天底, roll 绕视线.
 * 视线: u,v in [-1,1],
 *   dir = normalize(direction + u*tan(hfov/2)*right + v*tan(vfov/2)*up)
 */

export const EARTH_RADIUS = 6378137.0;
export const WGS84_A = 6378137.0;
export const WGS84_F = 1.0 / 298.257223563;
export const WGS84_B = WGS84_A * (1.0 - WGS84_F);
export const WGS84_E2 = WGS84_F * (2.0 - WGS84_F);
export const WGS84_EP2 = (WGS84_A * WGS84_A - WGS84_B * WGS84_B) / (WGS84_B * WGS84_B);
export const DEFAULT_TILE_SIZE = 256;
export const DEFAULT_MAX_EDGE = 16384;
export const RAY_EPS = 1e-6;
const MERCATOR_LAT = 85.05112878;

export function pythonRound(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const fl = Math.floor(ax);
  const frac = ax - fl;
  let r;
  if (frac > 0.5) r = fl + 1;
  else if (frac < 0.5) r = fl;
  else r = fl % 2 === 0 ? fl : fl + 1;
  return sign * r;
}

export function pyMod(a, n) {
  return ((a % n) + n) % n;
}

export function wrapLon(lon) {
  return pyMod(lon + 180, 360) - 180;
}

export function is4326(srs) {
  const s = String(srs || "").toUpperCase().replace(/ /g, "");
  return s.includes("4326") || s === "WGS84" || s === "CRS:84" || s === "GEODETIC";
}

export function is3857(srs) {
  const s = String(srs || "").toUpperCase().replace(/ /g, "");
  return s.includes("3857") || s.includes("900913") || s.includes("WEBMERCATOR") || s.includes("MERCATOR");
}

export function normalizeSrs(srs) {
  return is4326(srs) ? "EPSG:4326" : "EPSG:3857";
}

export function clampLat(lat) {
  return Math.max(Math.min(lat, MERCATOR_LAT), -MERCATOR_LAT);
}

export function tileCountX(srs, zoom) {
  return is4326(srs) ? 2 << zoom : 1 << zoom;
}

export function srsFromLevel0Tiles(nx, ny) {
  if (nx === 2 && ny === 1) return "EPSG:4326";
  if (nx === 1 && ny === 1) return "EPSG:3857";
  return null;
}

export function tileCountY(srs, zoom) {
  return 1 << zoom;
}

export function flipY(y, srs, zoom, scheme) {
  if ((scheme || "xyz").toLowerCase() !== "tms") return y;
  return tileCountY(srs, zoom) - y - 1;
}

export function lonlatToTile(lon, lat, zoom, srs) {
  lon = wrapLon(lon);
  const nx = tileCountX(srs, zoom);
  const ny = tileCountY(srs, zoom);
  let x;
  let y;
  if (is4326(srs)) {
    x = Math.trunc(((lon + 180) / 360) * nx);
    y = Math.trunc(((90 - lat) / 360) * nx);
  } else {
    lat = clampLat(lat);
    x = Math.trunc(((lon + 180) / 360) * nx);
    const sinLat = Math.sin((lat * Math.PI) / 180);
    y = Math.trunc((0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * ny);
  }
  return {
    x: Math.max(0, Math.min(nx - 1, x)),
    y: Math.max(0, Math.min(ny - 1, y)),
  };
}

export function tileBounds4326(x, y, zoom) {
  const nx = tileCountX("EPSG:4326", zoom);
  const ny = tileCountY("EPSG:4326", zoom);
  const xw = 360 / nx;
  const yh = 180 / ny;
  const west = x * xw - 180;
  const east = (x + 1) * xw - 180;
  const north = 90 - y * yh;
  const south = 90 - (y + 1) * yh;
  return [west, south, east, north];
}

export function tileBounds3857Meters(x, y, zoom) {
  const n = 1 << zoom;
  const origin = Math.PI * EARTH_RADIUS;
  const size = (2 * origin) / n;
  const west = -origin + x * size;
  const east = -origin + (x + 1) * size;
  const north = origin - y * size;
  const south = origin - (y + 1) * size;
  return [west, south, east, north];
}

export function lonlatToMercator(lon, lat) {
  lat = clampLat(lat);
  const x = ((lon * Math.PI) / 180) * EARTH_RADIUS;
  const y = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * EARTH_RADIUS;
  return [x, y];
}

export function mercatorToLonlat(x, y) {
  const lon = (x / EARTH_RADIUS) * (180 / Math.PI);
  const lat = (2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - Math.PI / 2) * (180 / Math.PI);
  return [lon, lat];
}

export function mapResolutionDeg(zoom, tileSize = DEFAULT_TILE_SIZE) {
  return 180 / (tileSize * (1 << zoom));
}

export function mapResolutionMercator(zoom, tileSize = DEFAULT_TILE_SIZE) {
  return (2 * Math.PI * EARTH_RADIUS) / (tileSize * (1 << zoom));
}

export function metersPerDegreeLat() {
  return (Math.PI * EARTH_RADIUS) / 180;
}

export function gsdMeters(zoom, srs, lat, tileSize = DEFAULT_TILE_SIZE) {
  const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 1e-6);
  if (is4326(srs)) return mapResolutionDeg(zoom, tileSize) * metersPerDegreeLat() * cosLat;
  return mapResolutionMercator(zoom, tileSize) * cosLat;
}

export function zoomForResolution(resolutionM, srs, lat, tileSize = DEFAULT_TILE_SIZE, minZoom = 0, maxZoom = 22) {
  if (!(resolutionM > 0)) throw new Error("分辨率必须为正数 (米/像素)");
  const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 1e-6);
  const c = is4326(srs)
    ? (180 * metersPerDegreeLat() * cosLat) / tileSize
    : (2 * Math.PI * EARTH_RADIUS * cosLat) / tileSize;
  const z = Math.ceil(Math.log2(c / resolutionM));
  return Math.max(minZoom, Math.min(maxZoom, z));
}

export function geodeticToEcef(lonDeg, latDeg, height) {
  const lon = (lonDeg * Math.PI) / 180;
  const lat = (latDeg * Math.PI) / 180;
  const sLat = Math.sin(lat);
  const cLat = Math.cos(lat);
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sLat * sLat);
  const x = (n + height) * cLat * Math.cos(lon);
  const y = (n + height) * cLat * Math.sin(lon);
  const z = (n * (1 - WGS84_E2) + height) * sLat;
  return [x, y, z];
}

export function ecefToGeodetic(x, y, z) {
  const lon = Math.atan2(y, x);
  const p = Math.hypot(x, y);
  const theta = Math.atan2(z * WGS84_A, Math.max(p, 1e-12) * WGS84_B);
  const st = Math.sin(theta);
  const ct = Math.cos(theta);
  const lat = Math.atan2(z + WGS84_EP2 * WGS84_B * st * st * st, p - WGS84_E2 * WGS84_A * ct * ct * ct);
  const sLat = Math.sin(lat);
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sLat * sLat);
  const cLat = Math.cos(lat);
  const height = Math.abs(cLat) > 1e-10 ? p / cLat - n : Math.abs(z) - WGS84_B;
  return { lon: (lon * 180) / Math.PI, lat: (lat * 180) / Math.PI, height };
}

export function normalize3(x, y, z) {
  const n = Math.hypot(x, y, z);
  const s = n < 1e-15 ? 1 : n;
  return [x / s, y / s, z / s];
}

export function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function add3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function scale3(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function geodeticSurfaceNormal(x, y, z) {
  return normalize3(x / (WGS84_A * WGS84_A), y / (WGS84_A * WGS84_A), z / (WGS84_B * WGS84_B));
}

export function eastNorthUp(pos) {
  const p = pos;
  if (Math.hypot(p[0], p[1], p[2]) < 1e-12) {
    return [
      [0, 1, 0],
      [-1, 0, 0],
      [0, 0, 1],
    ];
  }
  if (Math.abs(p[0]) < 1e-14 && Math.abs(p[1]) < 1e-14) {
    const sign = p[2] >= 0 ? 1 : -1;
    return [
      [0, 1, 0],
      [-sign, 0, 0],
      [0, 0, sign],
    ];
  }
  const up = geodeticSurfaceNormal(p[0], p[1], p[2]);
  let east = normalize3(-p[1], p[0], 0);
  let north = normalize3(...cross(up, east));
  return [east, north, up];
}

function rotX(a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [1, 0, 0, 0, c, -s, 0, s, c];
}

function rotY(a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}

function rotZ(a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

function matMul(a, b) {
  const c = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let col = 0; col < 3; col++) {
      c[r * 3 + col] =
        a[r * 3] * b[col] + a[r * 3 + 1] * b[3 + col] + a[r * 3 + 2] * b[6 + col];
    }
  }
  return c;
}

function col(m, i) {
  return [m[i], m[3 + i], m[6 + i]];
}

function combineEnu(east, north, up, v) {
  return [
    east[0] * v[0] + north[0] * v[1] + up[0] * v[2],
    east[1] * v[0] + north[1] * v[1] + up[1] * v[2],
    east[2] * v[0] + north[2] * v[1] + up[2] * v[2],
  ];
}

export function cameraAxesFromHpr(position, heading, pitch, roll) {
  const [east, north, upEnu] = eastNorthUp(position);
  const h = heading - Math.PI / 2;
  const rot = matMul(matMul(rotZ(-h), rotY(-pitch)), rotX(roll));
  let direction = normalize3(...combineEnu(east, north, upEnu, col(rot, 0)));
  let up = normalize3(...combineEnu(east, north, upEnu, col(rot, 2)));
  let right = cross(direction, up);
  let n = Math.hypot(...right);
  if (n < 1e-12) {
    const alt = Math.abs(dot(direction, east)) < 0.9 ? east : north;
    right = cross(direction, alt);
    n = Math.hypot(...right);
  }
  right = scale3(right, 1 / Math.max(n, 1e-15));
  up = normalize3(...cross(right, direction));
  return { direction, up, right };
}

export function cameraAxesFromVectors(direction, up, right) {
  direction = normalize3(direction[0], direction[1], direction[2]);
  if (up) {
    right = cross(direction, up);
    const n = Math.hypot(...right);
    if (n < 1e-12) throw new Error("direction 与 up 平行, 无法构成相机标架");
    right = scale3(right, 1 / n);
    up = normalize3(...cross(right, direction));
  } else if (right) {
    right = normalize3(right[0], right[1], right[2]);
    up = normalize3(...cross(right, direction));
    right = normalize3(...cross(direction, up));
  } else {
    throw new Error("需要 direction 与 up (或 right)");
  }
  return { direction, up, right };
}

export function hprFromCameraAxes(position, direction, up, right) {
  const [east, north, upEnu] = eastNorthUp(position);
  const d = [dot(east, direction), dot(north, direction), dot(upEnu, direction)];
  const u = [dot(east, up), dot(north, up), dot(upEnu, up)];
  const r = [dot(east, right), dot(north, right), dot(upEnu, right)];
  const pitch = Math.PI / 2 - Math.acos(Math.max(-1, Math.min(1, d[2])));
  let heading;
  let roll;
  if (Math.abs(Math.abs(d[2]) - 1) < 1e-3) {
    heading = Math.atan2(u[1], u[0]) - Math.PI / 2;
    roll = 0;
  } else {
    heading = Math.atan2(d[1], d[0]) - Math.PI / 2;
    roll = Math.atan2(-r[2], u[2]);
  }
  const tau = Math.PI * 2;
  heading = pyMod(tau - pyMod(heading, tau), tau);
  roll = pyMod(roll, tau);
  return { heading, pitch, roll };
}

export function rayIntersectEllipsoid(origin, direction) {
  const [ox, oy, oz] = origin;
  const [dx, dy, dz] = direction;
  const invA2 = 1 / (WGS84_A * WGS84_A);
  const invB2 = 1 / (WGS84_B * WGS84_B);
  const a = dx * dx * invA2 + dy * dy * invA2 + dz * dz * invB2;
  const b = 2 * (ox * dx * invA2 + oy * dy * invA2 + oz * dz * invB2);
  const c = ox * ox * invA2 + oy * oy * invA2 + oz * oz * invB2 - 1;
  const disc = b * b - 4 * a * c;
  if (disc < 0 || Math.abs(a) <= 1e-18) return null;
  const sqrtDisc = Math.sqrt(disc);
  const inv2a = 0.5 / a;
  const t1 = (-b - sqrtDisc) * inv2a;
  const t2 = (-b + sqrtDisc) * inv2a;
  let t = Infinity;
  if (t1 > RAY_EPS) t = t1;
  if (t2 > RAY_EPS && t2 < t) t = t2;
  if (!Number.isFinite(t)) return null;
  return { t, point: [ox + t * dx, oy + t * dy, oz + t * dz] };
}

export function tanHalf(camera) {
  return { tanH: Math.tan(0.5 * camera.hfov), tanV: Math.tan(0.5 * camera.vfov) };
}

export function rayDirectionUV(camera, u, v) {
  const { tanH, tanV } = tanHalf(camera);
  return normalize3(
    camera.direction[0] + u * tanH * camera.right[0] + v * tanV * camera.up[0],
    camera.direction[1] + u * tanH * camera.right[1] + v * tanV * camera.up[1],
    camera.direction[2] + u * tanH * camera.right[2] + v * tanV * camera.up[2]
  );
}

export function pixelUV(width, height, i, j) {
  const u = ((i + 0.5) / width) * 2 - 1;
  const v = 1 - ((j + 0.5) / height) * 2;
  return { u, v };
}

export function pixelRayDirection(camera, width, height, i, j) {
  const { u, v } = pixelUV(width, height, i, j);
  return rayDirectionUV(camera, u, v);
}

export function centerRayHit(camera) {
  const hit = rayIntersectEllipsoid(camera.position, camera.direction);
  if (!hit) return null;
  const geo = ecefToGeodetic(hit.point[0], hit.point[1], hit.point[2]);
  return { point: hit.point, t: hit.t, lon: geo.lon, lat: geo.lat, height: geo.height };
}

export function imageSizeFromResolution(camera, resolutionM, width, height, maxEdge) {
  const hit = centerRayHit(camera);
  if (!hit) {
    if (width == null || height == null) {
      throw new Error("中心射线未与地球相交, 无法按分辨率自动定尺. 请显式给出宽与高.");
    }
    return { width: width | 0, height: height | 0, range: Number.NaN };
  }
  const rng = hit.t;
  if (!(rng > 0)) throw new Error("中心斜距无效");
  const { tanH, tanV } = tanHalf(camera);
  if (width != null && height != null) return { width: width | 0, height: height | 0, range: rng };
  if (width != null) {
    return { width: width | 0, height: Math.max(1, pythonRound((width * tanV) / tanH)), range: rng };
  }
  if (height != null) {
    return { width: Math.max(1, pythonRound((height * tanH) / tanV)), height: height | 0, range: rng };
  }
  const w = Math.max(1, pythonRound((2 * rng * tanH) / resolutionM));
  const h = Math.max(1, pythonRound((2 * rng * tanV) / resolutionM));
  if (Math.max(w, h) > maxEdge) {
    throw new Error(
      `按分辨率 ${resolutionM} m/px 得到的像面为 ${w}x${h}, 长边超过上限 ${maxEdge}. 请改用更粗的分辨率, 或显式给出宽高, 或加大长边上限.`
    );
  }
  return { width: w, height: h, range: rng };
}

function degToRad(value, unit) {
  if (String(unit || "deg").toLowerCase().startsWith("rad")) return Number(value);
  return (Number(value) * Math.PI) / 180;
}

function vecFromJson(value) {
  if (!value) return null;
  if (Array.isArray(value) && value.length === 3) return value.map(Number);
  if (typeof value === "object" && "x" in value && "y" in value && "z" in value) {
    return [Number(value.x), Number(value.y), Number(value.z)];
  }
  return null;
}

function makeCamera(position, direction, up, right, heading, pitch, roll, hfov, vfov) {
  const geo = ecefToGeodetic(position[0], position[1], position[2]);
  return {
    position,
    lon: geo.lon,
    lat: geo.lat,
    height: geo.height,
    direction,
    up,
    right,
    heading,
    pitch,
    roll,
    hfov,
    vfov,
  };
}

export function cameraFromGeodeticHpr(lon, lat, height, headingDeg, pitchDeg, rollDeg, hfovDeg, vfovDeg) {
  const position = geodeticToEcef(lon, lat, height);
  const heading = (headingDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  const roll = (rollDeg * Math.PI) / 180;
  const axes = cameraAxesFromHpr(position, heading, pitch, roll);
  return makeCamera(position, axes.direction, axes.up, axes.right, heading, pitch, roll, (hfovDeg * Math.PI) / 180, (vfovDeg * Math.PI) / 180);
}

export function cameraFromSensorJson(json, overrides = {}) {
  const js = json || {};
  const unit = js.fovUnit || js.angleUnit || js.units || "deg";
  const angleUnit = overrides.angleUnit || "deg";
  let position = null;
  let lon = overrides.lon;
  let lat = overrides.lat;
  let height = overrides.height;
  if (lon == null || lat == null || height == null) {
    const pos = js.position || {};
    if (pos.lon != null && pos.lat != null) {
      lon = Number(pos.lon);
      lat = Number(pos.lat);
      height = Number(pos.height ?? pos.alt ?? 0);
    } else if (pos.longitude != null && pos.latitude != null) {
      lon = Number(pos.longitude);
      lat = Number(pos.latitude);
      height = Number(pos.height ?? pos.alt ?? 0);
    } else if (js.lon != null && js.lat != null) {
      lon = Number(js.lon);
      lat = Number(js.lat);
      height = Number(js.height ?? js.alt ?? 0);
    }
  }
  if (lon != null && lat != null && height != null) position = geodeticToEcef(lon, lat, height);
  if (!position) {
    position = overrides.ecef || vecFromJson(js.position) || vecFromJson(js.ecef) || vecFromJson(js.positionEcef);
  }
  if (!position) throw new Error("相机 JSON 缺少位置");

  let hfov = overrides.hfov;
  let vfov = overrides.vfov;
  if (hfov == null && js.hfov != null) hfov = degToRad(js.hfov, unit);
  else if (hfov != null) hfov = degToRad(hfov, angleUnit);
  if (vfov == null && js.vfov != null) vfov = degToRad(js.vfov, js.fovUnit || unit);
  else if (vfov != null) vfov = degToRad(vfov, angleUnit);
  if (hfov == null) throw new Error("必须提供水平视场 hfov");
  if (vfov == null) {
    if (overrides.width && overrides.heightPx) {
      vfov = 2 * Math.atan(Math.tan(0.5 * hfov) * (overrides.heightPx / overrides.width));
    } else vfov = hfov;
  }

  let direction = overrides.direction || vecFromJson(js.direction) || vecFromJson(js.directionEcef);
  let up = overrides.up || vecFromJson(js.up) || vecFromJson(js.upEcef);
  let right = overrides.right || vecFromJson(js.right) || vecFromJson(js.rightEcef);
  const useVectors = direction && (up || right);

  let heading = overrides.heading;
  let pitch = overrides.pitch;
  let roll = overrides.roll;
  if (heading == null && js.heading != null) heading = degToRad(js.heading, unit);
  else if (heading != null) heading = degToRad(heading, angleUnit);
  if (pitch == null && js.pitch != null) pitch = degToRad(js.pitch, unit);
  else if (pitch != null) pitch = degToRad(pitch, angleUnit);
  if (roll == null && js.roll != null) roll = degToRad(js.roll, unit);
  else if (roll != null) roll = degToRad(roll, angleUnit);

  let axes;
  if (useVectors) {
    axes = cameraAxesFromVectors(direction, up, right);
    try {
      const hpr = hprFromCameraAxes(position, axes.direction, axes.up, axes.right);
      heading = hpr.heading;
      pitch = hpr.pitch;
      roll = hpr.roll;
    } catch (_err) {
      /* 反算失败时仍保留向量标架 */
    }
  } else {
    if (heading == null) heading = 0;
    if (pitch == null) pitch = (-90 * Math.PI) / 180;
    if (roll == null) roll = 0;
    axes = cameraAxesFromHpr(position, heading, pitch, roll);
  }
  return makeCamera(position, axes.direction, axes.up, axes.right, heading, pitch, roll, hfov, vfov);
}

export function exportSensorCameraJSON(camera, name) {
  const result = {
    type: "astrox-sensor-camera",
    ellipsoid: "WGS84",
    position: {
      lon: camera.lon,
      lat: camera.lat,
      height: camera.height,
      x: camera.position[0],
      y: camera.position[1],
      z: camera.position[2],
    },
    direction: camera.direction.slice(),
    up: camera.up.slice(),
    right: camera.right.slice(),
    hfov: (camera.hfov * 180) / Math.PI,
    vfov: (camera.vfov * 180) / Math.PI,
    fovUnit: "deg",
  };
  if (camera.heading != null) result.heading = (camera.heading * 180) / Math.PI;
  if (camera.pitch != null) result.pitch = (camera.pitch * 180) / Math.PI;
  if (camera.roll != null) result.roll = (camera.roll * 180) / Math.PI;
  if (name) result.name = name;
  return result;
}

export function footprintRing(camera, samplesPerEdge = 32) {
  const n = Math.max(2, samplesPerEdge | 0);
  const uvs = [];
  for (let i = 0; i < n; i++) uvs.push([-1 + (2 * i) / n, -1]);
  for (let i = 0; i < n; i++) uvs.push([1, -1 + (2 * i) / n]);
  for (let i = 0; i < n; i++) uvs.push([1 - (2 * i) / n, 1]);
  for (let i = 0; i < n; i++) uvs.push([-1, 1 - (2 * i) / n]);
  const raw = [];
  let missed = 0;
  for (const [u, v] of uvs) {
    const dir = rayDirectionUV(camera, u, v);
    const hit = rayIntersectEllipsoid(camera.position, dir);
    if (!hit) {
      missed += 1;
      continue;
    }
    const geo = ecefToGeodetic(hit.point[0], hit.point[1], hit.point[2]);
    raw.push([geo.lon, geo.lat]);
  }
  if (raw.length < 3) {
    return { ring: null, missed, error: "视场与地球没有足够的交点 (可能未指向地球, 或部分视场落到地平线外)" };
  }
  const unwrapped = [[raw[0][0], raw[0][1]]];
  for (let k = 1; k < raw.length; k++) {
    let lo = raw[k][0];
    const prev = unwrapped[unwrapped.length - 1][0];
    while (lo - prev > 180) lo -= 360;
    while (lo - prev < -180) lo += 360;
    unwrapped.push([lo, raw[k][1]]);
  }
  const first = unwrapped[0];
  const last = unwrapped[unwrapped.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) unwrapped.push([first[0], first[1]]);
  return { ring: unwrapped, missed };
}

export function exportFootprintGeoJSON(camera, samplesPerEdge = 16, name = "sensor-footprint") {
  const fp = footprintRing(camera, samplesPerEdge);
  if (!fp.ring) throw new Error(fp.error);
  return {
    type: "Feature",
    properties: {
      name,
      crs: "EPSG:4326",
      hfovDeg: (camera.hfov * 180) / Math.PI,
      vfovDeg: (camera.vfov * 180) / Math.PI,
      samplesPerEdge,
      missedRays: fp.missed,
      useGlobe: false,
    },
    geometry: { type: "Polygon", coordinates: [fp.ring] },
  };
}

export function coveringTiles(ring, zoom, srs) {
  const pts = ring.length && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1)
    : ring.slice();
  if (!pts.length) return [];
  const wrapped = pts.map(([lon, lat]) => [wrapLon(lon), lat]);
  let minx = Infinity;
  let maxx = -Infinity;
  for (const [lon] of wrapped) {
    minx = Math.min(minx, lon);
    maxx = Math.max(maxx, lon);
  }
  const parts = [];
  if (maxx - minx <= 180) parts.push(wrapped);
  else {
    const east = wrapped.filter((p) => p[0] >= 0);
    const west = wrapped.filter((p) => p[0] < 0);
    if (east.length) parts.push(east);
    if (west.length) parts.push(west);
  }
  const nx = tileCountX(srs, zoom);
  const ny = tileCountY(srs, zoom);
  const tiles = new Set();
  for (const poly of parts) {
    let pminx = Infinity;
    let pmaxx = -Infinity;
    let pminy = Infinity;
    let pmaxy = -Infinity;
    for (const [lon, lat] of poly) {
      pminx = Math.min(pminx, lon);
      pmaxx = Math.max(pmaxx, lon);
      pminy = Math.min(pminy, lat);
      pmaxy = Math.max(pmaxy, lat);
    }
    const corners = [
      [pminx, pminy],
      [pmaxx, pminy],
      [pmaxx, pmaxy],
      [pminx, pmaxy],
      [pminx, (pminy + pmaxy) / 2],
      [pmaxx, (pminy + pmaxy) / 2],
      [(pminx + pmaxx) / 2, pminy],
      [(pminx + pmaxx) / 2, pmaxy],
    ];
    const xs = [];
    const ys = [];
    for (const [lon, lat] of corners) {
      const t = lonlatToTile(lon, lat, zoom, srs);
      xs.push(t.x);
      ys.push(t.y);
    }
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const y0 = Math.max(0, Math.min(...ys));
    const y1 = Math.min(ny - 1, Math.max(...ys));
    const xr = [];
    if (x1 >= x0 && x1 - x0 < nx / 2) {
      for (let x = x0; x <= x1; x++) xr.push(x);
    } else {
      for (let x = x0; x < nx; x++) xr.push(x);
      for (let x = 0; x <= x1; x++) xr.push(x);
    }
    for (const x of xr) {
      for (let y = y0; y <= y1; y++) tiles.add(`${((x % nx) + nx) % nx},${y}`);
    }
  }
  return [...tiles]
    .map((key) => key.split(",").map(Number))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

export function mosaicLayout(tiles, zoom, srs) {
  const nx = tileCountX(srs, zoom);
  const xs = tiles.map((t) => t[0]);
  const ys = tiles.map((t) => t[1]);
  const wrap = Math.max(...xs) - Math.min(...xs) > nx / 2;
  const placed = tiles.map(([x, y]) => ({
    x,
    y,
    xAdj: wrap ? (x < nx / 2 ? x : x - nx) : x,
  }));
  const xMin = Math.min(...placed.map((p) => p.xAdj));
  const xMax = Math.max(...placed.map((p) => p.xAdj));
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  let extent;
  if (is4326(srs)) {
    const xw = 360 / tileCountX(srs, zoom);
    const yh = 180 / tileCountY(srs, zoom);
    extent = [xMin * xw - 180, 90 - (yMax + 1) * yh, (xMax + 1) * xw - 180, 90 - yMin * yh];
  } else {
    const origin = Math.PI * EARTH_RADIUS;
    const size = (2 * origin) / (1 << zoom);
    extent = [-origin + xMin * size, origin - (yMax + 1) * size, -origin + (xMax + 1) * size, origin - yMin * size];
  }
  return { placed, xMin, yMin, cols: xMax - xMin + 1, rows: yMax - yMin + 1, extent };
}

export function lonlatToCanvasXY(lon, lat, extent, width, height, srs) {
  const [west, south, east, north] = extent;
  if (is4326(srs)) {
    // 西边界在反子午线外时可以小于 -180, 把经度展开到这块画布上.
    const lonU = lon - 360 * Math.floor((lon - west) / 360);
    return [((lonU - west) / (east - west)) * width - 0.5, ((north - lat) / (north - south)) * height - 0.5];
  }
  // 3857 的 extent 是米. 先把西边界换算成可能超出 ±180 的经度, 再展开, 避免把米当成度.
  const westLon = (west / EARTH_RADIUS) * (180 / Math.PI);
  const lonU = lon - 360 * Math.floor((lon - westLon) / 360);
  const latC = clampLat(lat);
  const mx = ((lonU * Math.PI) / 180) * EARTH_RADIUS;
  const my = Math.log(Math.tan(Math.PI / 4 + (latC * Math.PI) / 360)) * EARTH_RADIUS;
  return [((mx - west) / (east - west)) * width - 0.5, ((north - my) / (north - south)) * height - 0.5];
}

export function bilinearSample(canvas, srcW, srcH, sx, sy) {
  if (!(sx >= 0 && sy >= 0 && sx <= srcW - 1 && sy <= srcH - 1)) return [0, 0, 0, 0];
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = Math.min(x0 + 1, srcW - 1);
  const y1 = Math.min(y0 + 1, srcH - 1);
  const dx = sx - x0;
  const dy = sy - y0;
  const out = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    const c00 = canvas[(y0 * srcW + x0) * 4 + c];
    const c10 = canvas[(y0 * srcW + x1) * 4 + c];
    const c01 = canvas[(y1 * srcW + x0) * 4 + c];
    const c11 = canvas[(y1 * srcW + x1) * 4 + c];
    const v = c00 * (1 - dx) * (1 - dy) + c10 * dx * (1 - dy) + c01 * (1 - dx) * dy + c11 * dx * dy;
    out[c] = Math.max(0, Math.min(255, pythonRound(v)));
  }
  return out;
}

export function centerGroundGsd(camera, width, height) {
  const ic = width / 2 - 0.5;
  const jc = height / 2 - 0.5;
  const samples = [
    [ic - 0.5, jc],
    [ic + 0.5, jc],
    [ic, jc - 0.5],
    [ic, jc + 0.5],
  ];
  const pts = samples.map(([i, j]) => {
    const dir = pixelRayDirection(camera, width, height, i, j);
    return rayIntersectEllipsoid(camera.position, dir);
  });
  const out = { x: null, y: null, mean: null };
  if (pts[0] && pts[1]) out.x = Math.hypot(...pts[1].point.map((v, k) => v - pts[0].point[k]));
  if (pts[2] && pts[3]) out.y = Math.hypot(...pts[3].point.map((v, k) => v - pts[2].point[k]));
  const vals = [out.x, out.y].filter((v) => v != null);
  if (vals.length) out.mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  return out;
}

export function trackHeadingRad(position, velocity) {
  const [east, north] = eastNorthUp(position);
  const ve = dot(velocity, east);
  const vn = dot(velocity, north);
  return Math.atan2(ve, vn);
}

function rayHits(camera, u, v) {
  return rayIntersectEllipsoid(camera.position, rayDirectionUV(camera, u, v)) != null;
}

export function findObliquePitchDeg(lon, lat, height, headingDeg, rollDeg, hfovDeg, vfovDeg) {
  const probe = (pitchDeg) => {
    const camera = cameraFromGeodeticHpr(lon, lat, height, headingDeg, pitchDeg, rollDeg, hfovDeg, vfovDeg);
    return {
      topL: rayHits(camera, -1, 1),
      top: rayHits(camera, 0, 1),
      topR: rayHits(camera, 1, 1),
      mid: rayHits(camera, 0, 0),
      bot: rayHits(camera, 0, -1),
    };
  };
  let found = null;
  for (let p = -80; p <= -8; p += 0.25) {
    const r = probe(p);
    if (!r.topL && !r.top && !r.topR && r.mid && r.bot) {
      found = p;
      break;
    }
  }
  if (found == null) return -22;
  let pitched = Math.min(-8, found + 1.5);
  const check = probe(pitched);
  if (!check.top && check.mid && check.bot) return pitched;
  return found;
}
