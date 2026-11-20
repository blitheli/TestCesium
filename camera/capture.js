/**
 * 不依赖 Cesium Viewer 的像面拍照接口.
 * 射线与椭球求交, 双线性重采样, 以及按 H*IFOV 自动选瓦片级别, 都走 geometry.js / resample.js 里的原公式.
 *
 * 传感器到 Fixed 的 Matrix4 为列主序 16 数, 或带 toArray 的 Cesium.Matrix4:
 * 列 0 = right (+X), 列 1 = up (+Y), 列 2 = -direction (传感器 +Z), 平移 = 传感器原点.
 */

import {
  cameraFromSensorJson,
  centerRayHit,
  deriveDetectorOptics,
  gsdFromRange,
  normalize3,
  swathFromRange,
  zoomForResolution,
} from "./geometry.js";
import { extractImagePlane } from "./resample.js";

export const DEFAULT_ARRAY_WIDTH = 5000;
export const DEFAULT_ARRAY_HEIGHT = 5000;
export const DEFAULT_MAX_TILES = 4096;
export const DEFAULT_MAX_EDGE = 8192;
export const DEFAULT_MAX_MOSAIC_PIXELS = 12288 * 12288;

export function matrixToElements(matrix) {
  if (matrix == null) throw new Error("需要传感器到 Fixed 的 Matrix4");
  if (typeof matrix.toArray === "function") {
    const out = new Array(16);
    matrix.toArray(out, 0);
    if (out.length === 16 && out.every((v) => Number.isFinite(v))) return out;
  }
  if (matrix.length === 16) {
    const out = Array.from(matrix, Number);
    if (out.every((v) => Number.isFinite(v))) return out;
  }
  if (matrix[0] != null && matrix[15] != null) {
    const out = [];
    for (let i = 0; i < 16; i++) out.push(Number(matrix[i]));
    if (out.every((v) => Number.isFinite(v))) return out;
  }
  throw new Error("Matrix4 需要 16 个列主序元素, 或带 toArray 的 Cesium.Matrix4");
}

export function fixedMatrixFromCamera(camera) {
  const right = camera.right;
  const up = camera.up;
  const direction = camera.direction;
  const position = camera.position;
  return [
    right[0], right[1], right[2], 0,
    up[0], up[1], up[2], 0,
    -direction[0], -direction[1], -direction[2], 0,
    position[0], position[1], position[2], 1,
  ];
}

export function frameFromFixedMatrix(matrix) {
  const m = matrixToElements(matrix);
  const right = normalize3(m[0], m[1], m[2]);
  const up = normalize3(m[4], m[5], m[6]);
  const direction = normalize3(-m[8], -m[9], -m[10]);
  const position = [m[12], m[13], m[14]];
  return { position, right, up, direction };
}

function hfovToRad(hfov, unit) {
  if (hfov == null || !(Number(hfov) > 0)) throw new Error("需要水平视场 hfov");
  const rad = String(unit || "deg").toLowerCase().startsWith("rad")
    ? Number(hfov)
    : (Number(hfov) * Math.PI) / 180;
  if (!(rad > 0) || !(rad < Math.PI)) throw new Error("hfov 必须在 (0, 180) 度内");
  return rad;
}

export function srsFromProjection(projection) {
  const p = String(projection || "").toLowerCase().replace(/\s/g, "");
  if (p === "geodetic" || p === "epsg:4326" || p === "4326") return "EPSG:4326";
  if (p === "webmercator" || p === "mercator" || p === "epsg:3857" || p === "3857") return "EPSG:3857";
  throw new Error("imagery.projection 需要 geodetic 或 webmercator");
}

export function cameraFromFixedMatrix(matrix, hfovDeg, vfovDeg) {
  const frame = frameFromFixedMatrix(matrix);
  return cameraFromSensorJson({
    position: { x: frame.position[0], y: frame.position[1], z: frame.position[2] },
    direction: frame.direction,
    up: frame.up,
    right: frame.right,
    hfov: hfovDeg,
    vfov: vfovDeg,
    fovUnit: "deg",
  });
}

function normalizeTileResult(got, url) {
  if (!got) return { data: null, url, error: "影像层没有返回该瓦片" };
  if (got instanceof Uint8ClampedArray || got instanceof Uint8Array) {
    return { data: got, url, error: null };
  }
  if (got.data || got.error) return { data: got.data || null, url: got.url || url, error: got.error || null };
  return { data: null, url, error: "无法识别的瓦片结果" };
}

async function fetchUrlTile(url, tileSize) {
  if (typeof fetch !== "function") {
    throw new Error("当前环境没有 fetch. 请在 imagery.requestTile 里提供瓦片, 或在浏览器中使用 URL 模板.");
  }
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 20000) : null;
  try {
    const resp = await fetch(url, ctrl ? { signal: ctrl.signal, mode: "cors" } : { mode: "cors" });
    if (resp.status === 404) return { data: null, url, error: "HTTP 404" };
    if (!resp.ok) return { data: null, url, error: `HTTP ${resp.status}` };
    if (typeof createImageBitmap !== "function") {
      throw new Error("当前环境不能把瓦片解码成像素. 请改用 imagery.requestTile.");
    }
    const blob = await resp.blob();
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = tileSize;
    canvas.height = tileSize;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, tileSize, tileSize);
    const data = ctx.getImageData(0, 0, tileSize, tileSize).data;
    if (bmp.close) bmp.close();
    return { data, url, error: null };
  } catch (err) {
    const raw = err && err.name === "AbortError" ? "请求超时" : err && err.message ? err.message : String(err);
    const cors = /fetch|network|cors|failed/i.test(raw);
    return {
      data: null,
      url,
      error: cors ? `${raw}. 可能是 CORS 或服务不可达. 照片不会改用其它影像.` : raw,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 矩形像面拍照.
 *
 * @param {object} args
 * @param {number[]|object} args.sensorToFixed 传感器到 ECEF 的 Matrix4
 * @param {number} args.hfov 水平全视场, 默认度
 * @param {"deg"|"rad"} [args.hfovUnit]
 * @param {number} [args.width=5000] 阵列宽, 像素
 * @param {number} [args.height=5000] 阵列高, 像素
 * @param {number} [args.pixelPitchMeters] 可选像元边长. 不给则不计算焦距
 * @param {object} args.imagery url / projection / 可选 requestTile, tileSize, minZoom, maxZoom, scheme
 * @param {boolean} [args.planOnly] 只返回选级和 manifest, 不分配像面
 */
export async function captureImagePlane(args = {}) {
  const imagery = args.imagery || {};
  const width = Math.round(args.width == null ? DEFAULT_ARRAY_WIDTH : args.width);
  const height = Math.round(args.height == null ? DEFAULT_ARRAY_HEIGHT : args.height);
  if (!(width >= 1) || !(height >= 1)) throw new Error("阵列像素数必须为正整数");
  const maxEdge = args.maxEdge == null ? DEFAULT_MAX_EDGE : args.maxEdge;
  if (Math.max(width, height) > maxEdge) {
    throw new Error(`阵列 ${width}x${height} 长边超过上限 ${maxEdge}. 不会缩小阵列或改视场.`);
  }
  const hfovRad = hfovToRad(args.hfov, args.hfovUnit);
  const vfovRad = 2 * Math.atan(Math.tan(hfovRad / 2) * (height / width));
  const hfovDeg = (hfovRad * 180) / Math.PI;
  const vfovDeg = (vfovRad * 180) / Math.PI;
  const camera = cameraFromFixedMatrix(args.sensorToFixed, hfovDeg, vfovDeg);
  const hit = centerRayHit(camera);
  if (!hit || !(hit.t > 0)) throw new Error("中心射线未与地球相交, 无法由斜距计算 GSD 和幅宽.");

  const ifovH = hfovRad / width;
  const ifovV = vfovRad / height;
  const gsdH = gsdFromRange(hit.t, ifovH);
  const gsdV = gsdFromRange(hit.t, ifovV);
  const swathH = swathFromRange(hit.t, hfovRad);
  const swathV = swathFromRange(hit.t, vfovRad);
  const srs = srsFromProjection(imagery.projection);
  const tileSize = imagery.tileSize || 256;
  const minZoom = imagery.minZoom ?? 0;
  const maxZoom = imagery.maxZoom ?? 22;
  const scheme = imagery.scheme || (typeof imagery.url === "string" && imagery.url.includes("{reverseY}") ? "tms" : "xyz");
  const zoom = zoomForResolution(gsdH, srs, hit.lat, tileSize, minZoom, maxZoom);

  let focalLengthMeters = null;
  let focalPlaneWidthMeters = null;
  let focalPlaneHeightMeters = null;
  if (args.pixelPitchMeters != null) {
    const optics = deriveDetectorOptics({
      widthPx: width,
      heightPx: height,
      pixelPitchMeters: args.pixelPitchMeters,
      hfovRad,
    });
    focalLengthMeters = optics.focalLengthMeters;
    focalPlaneWidthMeters = optics.focalPlaneWidthMeters;
    focalPlaneHeightMeters = optics.focalPlaneHeightMeters;
  }

  const detector = {
    widthPx: width,
    heightPx: height,
    pixelPitchMeters: args.pixelPitchMeters ?? null,
    focalPlaneWidthMeters,
    focalPlaneHeightMeters,
    focalLengthMeters,
    hfovDeg,
    vfovDeg,
    ifovHorizontalRad: ifovH,
    ifovVerticalRad: ifovV,
    rangeMeters: hit.t,
    gsdHorizontalMeters: gsdH,
    gsdVerticalMeters: gsdV,
    swathHorizontalMeters: swathH,
    swathVerticalMeters: swathV,
  };

  if (args.planOnly) {
    return {
      width,
      height,
      pixels: null,
      image: null,
      footprint: null,
      manifest: {
        mode: "image",
        planOnly: true,
        sizePixels: [width, height],
        zoom,
        centerRangeMeters: hit.t,
        centerHitLonLat: [hit.lon, hit.lat],
        requestedResolutionMeters: gsdH,
        detector,
        sourceSrs: srs,
        scheme,
        tileSize,
      },
      camera,
    };
  }

  if (!imagery.requestTile && !imagery.url) {
    throw new Error("imagery 需要 url 模板, 或 requestTile 回调.");
  }

  const sourceTitle = imagery.title || imagery.url || "imagery";
  const result = await extractImagePlane(camera, {
    width,
    height,
    resolutionM: gsdH,
    zoom,
    maxEdge,
    maxTiles: args.maxTiles == null ? DEFAULT_MAX_TILES : args.maxTiles,
    maxMosaicPixels: args.maxMosaicPixels == null ? DEFAULT_MAX_MOSAIC_PIXELS : args.maxMosaicPixels,
    srs,
    scheme,
    tileSize,
    minZoom,
    maxZoom,
    urlTemplate: imagery.url || `imagery://{z}/{x}/{y}`,
    sourceId: imagery.id || sourceTitle,
    sourceTitle,
    detector,
    stem: args.stem || "fov",
    getTile: async (req) => {
      if (imagery.requestTile) return normalizeTileResult(await imagery.requestTile(req), req.url);
      return fetchUrlTile(req.url, req.tileSize);
    },
  });

  return {
    width: result.width,
    height: result.height,
    pixels: result.image,
    image: result.image,
    footprint: result.footprint,
    manifest: result.manifest,
    failed: result.failed,
    camera,
  };
}
