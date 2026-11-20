/**
 * 不访问外网. 运行: node camera/selftest.mjs
 */
import {
  DEFAULT_MAX_EDGE,
  WGS84_A,
  WGS84_B,
  cameraFromGeodeticHpr,
  cameraFromSensorJson,
  centerRayHit,
  deriveDetectorOptics,
  ecefToGeodetic,
  exportSensorCameraJSON,
  flipY,
  gsdFromRange,
  pixelRayDirection,
  srsFromLevel0Tiles,
  swathFromRange,
  assertFocalLengthConsistent,
  gsdMeters,
  imageSizeFromResolution,
  lonlatToTile,
  mapResolutionMercator,
  rayIntersectEllipsoid,
  tileBounds3857Meters,
  tileBounds4326,
  tileCountX,
  tileCountY,
  zoomForResolution,
  findObliquePitchDeg,
  EARTH_RADIUS,
} from "./geometry.js";
import { ELEMENTS, ltanHoursAt, stateAtJd } from "./orbit.js";
import { extractImagePlane, flipImageRows, renderProceduralTile } from "./resample.js";
import { captureImagePlane, cameraFromFixedMatrix, fixedMatrixFromCamera } from "./capture.js";

const errors = [];

function check(name, cond, detail = "") {
  if (cond) console.log(`  ok  ${name}`);
  else {
    console.log(`  FAIL  ${name} ${detail}`);
    errors.push(name);
  }
}

check("4326 z0 tiles 2x1", tileCountX("EPSG:4326", 0) === 2 && tileCountY("EPSG:4326", 0) === 1);
check("4326 z1 tiles 4x2", tileCountX("EPSG:4326", 1) === 4 && tileCountY("EPSG:4326", 1) === 2);
const b0 = tileBounds4326(0, 0, 0);
check(
  "4326 z0 tile0 bounds",
  Math.abs(b0[0] + 180) < 1e-9 && Math.abs(b0[2]) < 1e-9 && Math.abs(b0[1] + 90) < 1e-9 && Math.abs(b0[3] - 90) < 1e-9,
  JSON.stringify(b0)
);
const t01 = lonlatToTile(0, 0, 1, "EPSG:4326");
check("4326 lonlat (0,0) z1", t01.x === 2 && t01.y === 1, JSON.stringify(t01));
check("3857 z0 one tile", tileCountX("EPSG:3857", 0) === 1);
check(
  "3857 z0 res",
  Math.abs(mapResolutionMercator(0) - (2 * Math.PI * EARTH_RADIUS) / 256) < 1e-6
);
const z10 = zoomForResolution(10, "EPSG:3857", 0);
check("zoom 10m equator 3857 is 14", z10 === 14, `got ${z10}`);

const origin = [WGS84_A + 1e6, 0, 0];
const hit = rayIntersectEllipsoid(origin, [-1, 0, 0]);
check("ray along equator hits", hit && Math.abs(hit.t - 1e6) < 1e-4, hit && hit.t);
check(
  "hit at (a,0,0)",
  hit && Math.abs(hit.point[0] - WGS84_A) < 1e-3 && Math.abs(hit.point[1]) < 1e-3 && Math.abs(hit.point[2]) < 1e-3,
  hit && hit.point
);
const miss = rayIntersectEllipsoid(origin, [0, 1, 0]);
check("parallel ray misses", miss == null);
const polar = rayIntersectEllipsoid([0, 0, 2 * WGS84_A], [0, 0, -1]);
check(
  "polar ray hits (0,0,b)",
  polar && Math.abs(polar.point[2] - WGS84_B) < 1e-3 && Math.abs(polar.point[0]) < 1e-3,
  polar && polar.point
);

const nadir = cameraFromGeodeticHpr(0, 0, 1e6, 0, -90, 0, 8, 6);
const center = centerRayHit(nadir);
check("nadir camera has center hit", center != null);
if (center) {
  check("nadir center lon~0", Math.abs(center.lon) < 1e-6, center.lon);
  check("nadir center lat~0", Math.abs(center.lat) < 1e-6, center.lat);
  check("nadir center range 1e6", Math.abs(center.t - 1e6) < 1e-2, center.t);
}
const north = cameraFromGeodeticHpr(0, 0, 1e6, 0, 0, 0, 8, 6);
check(
  "pitch0 looks north",
  Math.abs(north.direction[2] - 1) < 1e-8 && Math.abs(north.direction[0]) < 1e-8,
  north.direction
);

const sizedCam = cameraFromGeodeticHpr(0, 0, 1e6, 0, -90, 0, 2, 1.5);
const sized = imageSizeFromResolution(sizedCam, 500, null, null, DEFAULT_MAX_EDGE);
check("size helper 70x52", sized.width === 70 && sized.height === 52, `${sized.width}x${sized.height}`);

check("SSO a", ELEMENTS.a === 6878137);
check("SSO e", ELEMENTS.e === 0);
check("SSO i ~ 97.4018 deg", Math.abs(ELEMENTS.iDeg - 97.40180772348974) < 1e-9, ELEMENTS.iDeg);
check("SSO nodal rate matches sun", Math.abs(ELEMENTS.raanRateDegPerDay - ELEMENTS.meanSolarDegPerDay) < 1e-9);
const epoch = stateAtJd(ELEMENTS.epochJd);
check("epoch lat ~ 0", Math.abs(epoch.geo.lat) < 1e-6, epoch.geo.lat);
check("epoch height 500 km", Math.abs(epoch.geo.height - 500000) < 0.05, epoch.geo.height);
check("epoch LTAN 10.5", Math.abs(epoch.ltanHours - 10.5) < 1e-9, epoch.ltanHours);
const later = ltanHoursAt(ELEMENTS.epochJd + 1);
check("LTAN after 1 day still ~10.5", Math.abs(later - 10.5) < 0.02, later);
const year = ltanHoursAt(ELEMENTS.epochJd + 365);
check("LTAN after 365 days ~10.5", Math.abs(year - 10.5) < 0.05, year);
const quarter = stateAtJd(ELEMENTS.epochJd + ELEMENTS.periodSec / 4 / 86400);
check("quarter-rev latitude near 82.6", Math.abs(Math.abs(quarter.geo.lat) - (180 - ELEMENTS.iDeg)) < 0.15, quarter.geo.lat);

const camJson = exportSensorCameraJSON(cameraFromGeodeticHpr(121.47, 31.23, 500000, 20, -60, 5, 8, 6));
camJson.heading = 0;
camJson.pitch = -90;
camJson.roll = 0;
const fromVec = cameraFromSensorJson(camJson);
const src = cameraFromGeodeticHpr(121.47, 31.23, 500000, 20, -60, 5, 8, 6);
const align = src.direction[0] * fromVec.direction[0] + src.direction[1] * fromVec.direction[1] + src.direction[2] * fromVec.direction[2];
check("JSON vectors override HPR", align > 1 - 1e-10, align);

const procedural = async ({ z, x, y, srs, tileSize, style }) => ({
  data: renderProceduralTile(z, x, y, srs, tileSize, style),
  error: null,
  url: `proc://${z}/${x}/${y}.png`,
});

const camImg = cameraFromGeodeticHpr(0, 0, 1e6, 0, -90, 0, 2, 1.5);
const shot = await extractImagePlane(camImg, {
  resolutionM: 500,
  srs: "EPSG:4326",
  tileStyle: "lonlat",
  getTile: procedural,
  maxTiles: 64,
  sourceId: "procedural",
});
check("image size 70x52", shot.width === 70 && shot.height === 52, `${shot.width}x${shot.height}`);
const cx = (shot.width / 2) | 0;
const cy = (shot.height / 2) | 0;
const pix = shot.image.slice((cy * shot.width + cx) * 4, (cy * shot.width + cx) * 4 + 4);
check("image center opaque", pix[3] > 200, [...pix]);
check("image center R near 128", Math.abs(pix[0] - 128) <= 3, pix[0]);
check("image center G near 128", Math.abs(pix[1] - 128) <= 3, pix[1]);
check("nadir hit ratio high", shot.manifest.hitPixelRatio > 0.99, shot.manifest.hitPixelRatio);
check("manifest mode image", shot.manifest.mode === "image" && shot.manifest.camera.fovShape === "rectangular");
console.log(
  `  像面 ${shot.width}x${shot.height} z=${shot.manifest.zoom} 中心像素 ${[...pix]} 瓦片 ${shot.manifest.tileCount} 命中 ${(shot.manifest.hitPixelRatio * 100).toFixed(1)}%`
);

const obliquePitch = findObliquePitchDeg(0, 0, 500000, 0, 0, 8, 6);
const oblique = cameraFromGeodeticHpr(0, 0, 500000, 0, obliquePitch, 0, 8, 6);
const shotO = await extractImagePlane(oblique, {
  width: 48,
  height: 36,
  zoom: 4,
  resolutionM: 4000,
  srs: "EPSG:4326",
  tileStyle: "map",
  getTile: procedural,
  maxTiles: 64,
});
let topMax = 0;
let botMax = 0;
for (let i = 0; i < shotO.width; i++) {
  topMax = Math.max(topMax, shotO.image[i * 4 + 3]);
  botMax = Math.max(botMax, shotO.image[((shotO.height - 1) * shotO.width + i) * 4 + 3]);
}
check("oblique pitch found", obliquePitch < -10 && obliquePitch > -40, obliquePitch);
check("oblique has some hits", shotO.manifest.hitPixelRatio > 0.05, shotO.manifest.hitPixelRatio);
check("oblique has some misses", shotO.manifest.hitPixelRatio < 0.99, shotO.manifest.hitPixelRatio);
check("oblique top edge transparent", topMax === 0, `topA=${topMax} pitch=${obliquePitch}`);
check("oblique bottom has opaque", botMax > 200, `botA=${botMax}`);
console.log(
  `  侧视 pitch=${obliquePitch.toFixed(2)} 命中 ${(shotO.manifest.hitPixelRatio * 100).toFixed(1)}% topA=${topMax} botA=${botMax}`
);

const ssoCam = cameraFromGeodeticHpr(epoch.geo.lon, epoch.geo.lat, epoch.geo.height, 0, -90, 0, 8, 6);
const shotS = await extractImagePlane(ssoCam, {
  resolutionM: 1000,
  srs: "EPSG:4326",
  tileStyle: "map",
  getTile: procedural,
  maxTiles: 32,
});
const scx = (shotS.width / 2) | 0;
const scy = (shotS.height / 2) | 0;
const sp = shotS.image[(scy * shotS.width + scx) * 4 + 3];
check("SSO nadir photo has center pixel", sp > 200, `A=${sp} ${shotS.width}x${shotS.height} z=${shotS.manifest.zoom}`);
check("SSO default size modest", shotS.width <= 128 && shotS.height <= 128, `${shotS.width}x${shotS.height}`);
console.log(
  `  SSO 天底 ${shotS.width}x${shotS.height} z=${shotS.manifest.zoom} 斜距 ${shotS.manifest.centerRangeMeters.toFixed(1)} 瓦片 ${shotS.manifest.tileCount}`
);

const cam3857 = cameraFromGeodeticHpr(10, 20, 500000, 0, -90, 0, 8, 6);
const shotM = await extractImagePlane(cam3857, {
  resolutionM: 1000,
  srs: "EPSG:3857",
  tileStyle: "lonlat",
  getTile: procedural,
  maxTiles: 32,
});
const mx = (shotM.width / 2) | 0;
const my = (shotM.height / 2) | 0;
const mpix = shotM.image.slice((my * shotM.width + mx) * 4, (my * shotM.width + mx) * 4 + 4);
check("3857 center opaque", mpix[3] > 200, [...mpix]);
check("3857 center not black", mpix[0] > 20 && mpix[1] > 20, [...mpix]);
console.log(`  3857 天底 ${shotM.width}x${shotM.height} z=${shotM.manifest.zoom} 中心像素 ${[...mpix]}`);

check("level0 geographic is 4326", srsFromLevel0Tiles(2, 1) === "EPSG:4326");
check("level0 mercator is 3857", srsFromLevel0Tiles(1, 1) === "EPSG:3857");
check("unknown tiling is null", srsFromLevel0Tiles(4, 2) == null);

function solidLayer(r, g, b, title) {
  return async ({ tileSize }) => {
    const data = new Uint8ClampedArray(tileSize * tileSize * 4);
    for (let i = 0; i < tileSize * tileSize; i++) {
      data[i * 4] = r;
      data[i * 4 + 1] = g;
      data[i * 4 + 2] = b;
      data[i * 4 + 3] = 255;
    }
    return { data, url: `layer://${title}`, error: null };
  };
}

const layerCam = cameraFromGeodeticHpr(0, 0, 500000, 0, -90, 0, 8, 6);
const layerOpts = { resolutionM: 4000, srs: srsFromLevel0Tiles(2, 1), maxTiles: 8 };
const redShot = await extractImagePlane(layerCam, { ...layerOpts, getTile: solidLayer(220, 10, 10, "red"), sourceTitle: "red-layer" });
const blueShot = await extractImagePlane(layerCam, { ...layerOpts, getTile: solidLayer(10, 10, 220, "blue"), sourceTitle: "blue-layer" });
const lcx = (redShot.width / 2) | 0;
const lcy = (redShot.height / 2) | 0;
const redPx = redShot.image.slice((lcy * redShot.width + lcx) * 4, (lcy * redShot.width + lcx) * 4 + 4);
const bluePx = blueShot.image.slice((lcy * blueShot.width + lcx) * 4, (lcy * blueShot.width + lcx) * 4 + 4);
check("photo follows red layer", redPx[0] > 200 && redPx[2] < 40 && redPx[3] > 200, [...redPx]);
check("photo follows blue layer", bluePx[2] > 200 && bluePx[0] < 40 && bluePx[3] > 200, [...bluePx]);
check("manifest names selected layer", redShot.manifest.sourceTitle === "red-layer" && blueShot.manifest.sourceTitle === "blue-layer");
const failedShot = await extractImagePlane(layerCam, {
  ...layerOpts,
  sourceTitle: "broken-layer",
  getTile: async () => ({ data: null, url: "http://tiles.example/missing.png", error: "HTTP 404" }),
});
const failPx = failedShot.image[(lcy * failedShot.width + lcx) * 4 + 3];
check("failed layer does not borrow other colors", failPx === 0 && failedShot.failed.length === failedShot.manifest.tileCount, `A=${failPx} failed=${failedShot.failed.length}`);
console.log("  选中影像层: 红/蓝中心像素随层变化, 失败层保持透明");

const square = deriveDetectorOptics({
  widthPx: 1024,
  heightPx: 1024,
  pixelPitchMeters: 10e-6,
  hfovRad: (8 * Math.PI) / 180,
});
const f1024 = (1024 * 10e-6) / (2 * Math.tan((4 * Math.PI) / 180));
check("f from array, pitch, hfov", Math.abs(square.focalLengthMeters - f1024) / f1024 < 1e-12, square.focalLengthMeters);
check("square array keeps one fov", Math.abs(square.vfovDeg - 8) < 1e-9, square.vfovDeg);
check("both axes share f", Math.abs(square.focalLengthFromHeightMeters - square.focalLengthMeters) / f1024 < 1e-9);
const rect = deriveDetectorOptics({
  widthPx: 256,
  heightPx: 192,
  pixelPitchMeters: 10e-6,
  hfovRad: (8 * Math.PI) / 180,
});
const vfovExpect = 2 * Math.atan(Math.tan(rect.hfovRad / 2) * (192 / 256));
check("vfov follows array aspect", Math.abs(rect.vfovRad - vfovExpect) < 1e-12, rect.vfovDeg);
check("focal plane is n times pitch", Math.abs(rect.focalPlaneWidthMeters - 0.00256) < 1e-15 && Math.abs(rect.focalPlaneHeightMeters - 0.00192) < 1e-15);
const rangeH = 500000;
const ifovH = ((8 * Math.PI) / 180) / 1024;
check("gsd is range times ifov", Math.abs(gsdFromRange(rangeH, square.ifovHorizontalRad) - rangeH * ifovH) < 1e-6);
check(
  "swath is 2 H tan(fov/2)",
  Math.abs(swathFromRange(rangeH, square.hfovRad) - 2 * rangeH * Math.tan((4 * Math.PI) / 180)) < 1e-4
);
let rejected = false;
try {
  assertFocalLengthConsistent(square, square.focalLengthMeters * 1.25);
} catch (err) {
  rejected = /焦距/.test(err.message);
}
check("conflicting f rejected", rejected);
const detCam = cameraFromGeodeticHpr(0, 0, 500000, 0, -90, 0, rect.hfovDeg, rect.vfovDeg);
detCam.detector = rect;
const detJson = exportSensorCameraJSON(detCam, "detector");
check("export keeps geometric hfov", Math.abs(detJson.hfov - 8) < 1e-9);
check("export stores derived f", Math.abs(detJson.detector.focalLengthMeters - rect.focalLengthMeters) < 1e-12);
detJson.detector.focalLengthMeters *= 2;
let jsonRejected = false;
try {
  cameraFromSensorJson(detJson);
} catch (err) {
  jsonRejected = /焦距/.test(err.message);
}
check("json conflicting f rejected", jsonRejected);
console.log(
  `  探测器 f=${(rect.focalLengthMeters * 1000).toFixed(3)} mm, vfov=${rect.vfovDeg.toFixed(4)}°, 1024 方阵 f=${(square.focalLengthMeters * 1000).toFixed(3)} mm`
);

const posed = cameraFromGeodeticHpr(0, 0, 500000, 0, -90, 0, 8, 8);
const sensorToFixed = fixedMatrixFromCamera(posed);
const viaMatrix = cameraFromFixedMatrix(sensorToFixed, 8, 8);
const frameAlign =
  posed.direction[0] * viaMatrix.direction[0] +
  posed.direction[1] * viaMatrix.direction[1] +
  posed.direction[2] * viaMatrix.direction[2];
const frameUp =
  posed.up[0] * viaMatrix.up[0] + posed.up[1] * viaMatrix.up[1] + posed.up[2] * viaMatrix.up[2];
const framePos = Math.hypot(
  posed.position[0] - viaMatrix.position[0],
  posed.position[1] - viaMatrix.position[1],
  posed.position[2] - viaMatrix.position[2]
);
check("matrix frame matches camera direction", frameAlign > 1 - 1e-12, frameAlign);
check("matrix frame matches camera up", frameUp > 1 - 1e-12, frameUp);
check("matrix frame matches camera position", framePos < 1e-6, framePos);

const planned = await captureImagePlane({
  sensorToFixed,
  hfov: 8,
  imagery: { projection: "geodetic" },
  planOnly: true,
});
const plannedH = planned.manifest.centerRangeMeters;
const plannedIfov = ((8 * Math.PI) / 180) / 5000;
const plannedGsd = plannedH * plannedIfov;
const plannedZoom = zoomForResolution(plannedGsd, "EPSG:4326", planned.manifest.centerHitLonLat[1], 256, 0, 22);
check("default array is 5000x5000", planned.width === 5000 && planned.height === 5000);
check("default plan allocates no image", planned.pixels == null);
check(
  "default gsd is H times IFOV",
  Math.abs(planned.manifest.detector.gsdHorizontalMeters - plannedGsd) < 1e-6,
  planned.manifest.detector.gsdHorizontalMeters
);
check("default zoom follows zoomForResolution", planned.manifest.zoom === plannedZoom, `${planned.manifest.zoom} vs ${plannedZoom}`);
check(
  "default swath",
  Math.abs(planned.manifest.detector.swathHorizontalMeters - 2 * plannedH * Math.tan((4 * Math.PI) / 180)) < 1e-3
);
check("default plan has no focal length without pitch", planned.manifest.detector.focalLengthMeters == null);
console.log(
  `  默认 5000x5000  H=${plannedH.toFixed(3)}  GSD=${planned.manifest.detector.gsdHorizontalMeters.toFixed(3)}  z=${planned.manifest.zoom}`
);

let overLimit = false;
try {
  await captureImagePlane({
    sensorToFixed,
    hfov: 8,
    width: 5000,
    height: 5000,
    imagery: { projection: "geodetic", requestTile: async () => new Uint8ClampedArray(256 * 256 * 4) },
    maxTiles: 1,
  });
} catch (err) {
  overLimit = /z=\d+/.test(err.message) && /不会自动降低/.test(err.message);
}
check("over tile limit reports zoom and does not downsample", overLimit);

const small = await captureImagePlane({
  sensorToFixed,
  hfov: 8,
  width: 48,
  height: 48,
  pixelPitchMeters: 10e-6,
  imagery: {
    projection: "geodetic",
    title: "procedural",
    requestTile: async ({ z, x, y, srs, tileSize }) => renderProceduralTile(z, x, y, srs || "EPSG:4326", tileSize || 256, "lonlat"),
  },
});
const centerCol = (small.width / 2) | 0;
const smallPx = small.pixels[(centerCol * small.width + centerCol) * 4 + 3];
check("small capture is array sized", small.width === 48 && small.height === 48);
check("small capture center opaque", smallPx > 200, smallPx);
check(
  "small capture zoom matches gsd",
  small.manifest.zoom ===
    zoomForResolution(small.manifest.detector.gsdHorizontalMeters, "EPSG:4326", small.manifest.centerHitLonLat[1], 256, 0, 22)
);
console.log(`  小阵列 ${small.width}x${small.height} z=${small.manifest.zoom} 命中 ${(small.manifest.hitPixelRatio * 100).toFixed(1)}%`);

function indexTile(z, x, y, tileSize) {
  const data = new Uint8ClampedArray(tileSize * tileSize * 4);
  for (let i = 0; i < tileSize * tileSize; i++) {
    const o = i * 4;
    data[o] = x & 255;
    data[o + 1] = (x >> 8) & 255;
    data[o + 2] = y & 255;
    data[o + 3] = (y >> 8) & 255;
  }
  return data;
}

function rowTile(tileSize) {
  const data = new Uint8ClampedArray(tileSize * tileSize * 4);
  for (let row = 0; row < tileSize; row++) {
    const v = Math.round(((row + 0.5) / tileSize) * 255);
    for (let col = 0; col < tileSize; col++) {
      const o = (row * tileSize + col) * 4;
      data[o] = v;
      data[o + 3] = 255;
    }
  }
  return data;
}

function tileFractions(lon, lat, zoom, srs, x, y) {
  if (srs === "EPSG:4326") {
    const [west, south, east, north] = tileBounds4326(x, y, zoom);
    return [(lon - west) / (east - west), (north - lat) / (north - south)];
  }
  const [west, south, east, north] = tileBounds3857Meters(x, y, zoom);
  const mx = ((lon * Math.PI) / 180) * EARTH_RADIUS;
  const my = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * EARTH_RADIUS;
  return [(mx - west) / (east - west), (north - my) / (north - south)];
}

async function sampleIndexAgreement(camera, srs, zoom, scheme) {
  const tileSize = 64;
  let badReq = 0;
  const shot = await extractImagePlane(camera, {
    width: 72,
    height: 72,
    zoom,
    srs,
    scheme,
    tileSize,
    maxTiles: 256,
    getTile: async (req) => {
      const expectedReq = flipY(req.y, req.srs, req.z, scheme);
      if (req.yReq !== expectedReq) badReq += 1;
      return { data: indexTile(req.z, req.x, req.y, tileSize), error: null, url: "" };
    },
  });
  let checked = 0;
  let indexMiss = 0;
  const w = shot.width;
  const h = shot.height;
  for (let j = 0; j < h; j += 2) {
    for (let i = 0; i < w; i += 2) {
      const dir = pixelRayDirection(camera, w, h, i, j);
      const hit = rayIntersectEllipsoid(camera.position, dir);
      if (!hit) continue;
      const geo = ecefToGeodetic(hit.point[0], hit.point[1], hit.point[2]);
      const tile = lonlatToTile(geo.lon, geo.lat, zoom, srs);
      const [u, v] = tileFractions(geo.lon, geo.lat, zoom, srs, tile.x, tile.y);
      if (u < 0.2 || u > 0.8 || v < 0.2 || v > 0.8) continue;
      const o = (j * w + i) * 4;
      const xGot = shot.image[o] + (shot.image[o + 1] << 8);
      const yGot = shot.image[o + 2] + (shot.image[o + 3] << 8);
      checked += 1;
      if (xGot !== tile.x || yGot !== tile.y) indexMiss += 1;
    }
  }
  return { checked, indexMiss, badReq, zoom: shot.manifest.zoom, tiles: shot.manifest.tileCount };
}

async function rowOrientationError(camera, srs, zoom, flipSource) {
  const tileSize = 64;
  const shot = await extractImagePlane(camera, {
    width: 72,
    height: 72,
    zoom,
    srs,
    tileSize,
    maxTiles: 256,
    getTile: async (req) => {
      const north = rowTile(tileSize);
      return { data: flipSource ? flipImageRows(north, tileSize, tileSize) : north, error: null, url: "" };
    },
  });
  let checked = 0;
  let errSum = 0;
  const w = shot.width;
  const h = shot.height;
  for (let j = 0; j < h; j += 2) {
    for (let i = 0; i < w; i += 2) {
      const dir = pixelRayDirection(camera, w, h, i, j);
      const hit = rayIntersectEllipsoid(camera.position, dir);
      if (!hit) continue;
      const geo = ecefToGeodetic(hit.point[0], hit.point[1], hit.point[2]);
      const tile = lonlatToTile(geo.lon, geo.lat, zoom, srs);
      const [, v] = tileFractions(geo.lon, geo.lat, zoom, srs, tile.x, tile.y);
      if (v < 0.15 || v > 0.85) continue;
      if (v > 0.4 && v < 0.6) continue;
      const got = shot.image[(j * w + i) * 4];
      errSum += Math.abs(got - Math.round(v * 255));
      checked += 1;
    }
  }
  return { checked, mean: checked ? errSum / checked : 999 };
}

const indexCam = cameraFromGeodeticHpr(10, -12, 500000, 0, -90, 0, 8, 8);
const idx4326 = await sampleIndexAgreement(indexCam, "EPSG:4326", 11, "xyz");
check(
  "4326 xyz pixel matches tile x/y",
  idx4326.checked > 40 && idx4326.indexMiss === 0 && idx4326.badReq === 0,
  JSON.stringify(idx4326)
);
const idx3857 = await sampleIndexAgreement(indexCam, "EPSG:3857", 12, "xyz");
check(
  "3857 xyz pixel matches tile x/y",
  idx3857.checked > 40 && idx3857.indexMiss === 0 && idx3857.badReq === 0,
  JSON.stringify(idx3857)
);
const idxTms = await sampleIndexAgreement(indexCam, "EPSG:4326", 11, "tms");
check(
  "tms yReq is flipped and mosaic stays xyz",
  idxTms.checked > 40 && idxTms.indexMiss === 0 && idxTms.badReq === 0,
  JSON.stringify(idxTms)
);
const northUp = await rowOrientationError(indexCam, "EPSG:4326", 11, false);
const southUp = await rowOrientationError(indexCam, "EPSG:4326", 11, true);
check("north-up tile rows match latitude", northUp.checked > 20 && northUp.mean < 3, JSON.stringify(northUp));
check("flipped tile rows do not match latitude", southUp.checked > 20 && southUp.mean > 40, JSON.stringify(southUp));
const once = rowTile(8);
const twice = flipImageRows(flipImageRows(once, 8, 8), 8, 8);
let roundTrip = true;
for (let i = 0; i < once.length; i++) if (once[i] !== twice[i]) roundTrip = false;
check("flipImageRows round trip", roundTrip);
console.log(
  `  瓦片编号 4326 miss ${idx4326.indexMiss}/${idx4326.checked}, 3857 miss ${idx3857.indexMiss}/${idx3857.checked}, TMS miss ${idxTms.indexMiss}/${idxTms.checked}, 北在上误差 ${northUp.mean.toFixed(2)}, 颠倒误差 ${southUp.mean.toFixed(2)}`
);

console.log(
  `  根数 a=${ELEMENTS.a} e=${ELEMENTS.e} i=${ELEMENTS.iDeg.toFixed(8)} RAAN0=${ELEMENTS.raan0Deg.toFixed(6)} LTAN=${epoch.ltanHours} 周期=${(ELEMENTS.periodSec / 60).toFixed(3)} min`
);

if (errors.length) {
  console.log(`自检失败 ${errors.length} 项: ${errors.join(", ")}`);
  process.exit(1);
}
console.log("自检通过.");
