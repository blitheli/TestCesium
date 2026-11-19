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
  exportSensorCameraJSON,
  gsdFromRange,
  srsFromLevel0Tiles,
  swathFromRange,
  assertFocalLengthConsistent,
  gsdMeters,
  imageSizeFromResolution,
  lonlatToTile,
  mapResolutionMercator,
  rayIntersectEllipsoid,
  tileBounds4326,
  tileCountX,
  tileCountY,
  zoomForResolution,
  findObliquePitchDeg,
  EARTH_RADIUS,
} from "./geometry.js";
import { ELEMENTS, ltanHoursAt, stateAtJd } from "./orbit.js";
import { extractImagePlane, renderProceduralTile } from "./resample.js";

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
console.log(
  `  根数 a=${ELEMENTS.a} e=${ELEMENTS.e} i=${ELEMENTS.iDeg.toFixed(8)} RAAN0=${ELEMENTS.raan0Deg.toFixed(6)} LTAN=${epoch.ltanHours} 周期=${(ELEMENTS.periodSec / 60).toFixed(3)} min`
);

if (errors.length) {
  console.log(`自检失败 ${errors.length} 项: ${errors.join(", ")}`);
  process.exit(1);
}
console.log("自检通过.");
