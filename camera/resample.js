/**
 * 像面重采样. 每个输出像素沿视线与 WGS84 椭球求交, 再在 XYZ/TMS 拼接画布上双线性采样.
 * 未命中像素透明. 程序化瓦片不访问外网.
 */

import {
  DEFAULT_MAX_EDGE,
  DEFAULT_TILE_SIZE,
  bilinearSample,
  centerGroundGsd,
  centerRayHit,
  coveringTiles,
  ecefToGeodetic,
  flipY,
  footprintRing,
  gsdMeters,
  imageSizeFromResolution,
  is4326,
  lonlatToCanvasXY,
  mercatorToLonlat,
  mosaicLayout,
  normalizeSrs,
  pixelRayDirection,
  pythonRound,
  rayIntersectEllipsoid,
  tileBounds3857Meters,
  tileBounds4326,
  zoomForResolution,
} from "./geometry.js";

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await fn(items[index], index);
    }
  }
  const workers = Math.max(1, Math.min(limit, items.length || 1));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
}

const NOTES =
  "sizingPlaneGsdMeters 是垂直于视线的切平面上的像元尺寸 (由中心斜距与视场定尺). " +
  "侧视时地面 GSD (centerGroundGsdMeters) 会更粗, 且影像内不均匀. " +
  "本图是透视重采样照片, 不是光照/大气光学渲染, 也没有地图投影坐标.";

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [pythonRound((r + m) * 255), pythonRound((g + m) * 255), pythonRound((b + m) * 255)];
}

export function proceduralColor(lon, lat, dlon, dlat, style) {
  if (style === "lonlat") {
    const lonW = ((lon + 180) % 360 + 360) % 360;
    const r = Math.max(0, Math.min(255, pythonRound((lonW / 360) * 255)));
    const g = Math.max(0, Math.min(255, pythonRound(((lat + 90) / 180) * 255)));
    return [r, g, 128, 255];
  }
  const cell = 0.2;
  const fx = Math.floor((lon + 180) / cell);
  const fy = Math.floor((lat + 90) / cell);
  const checker = (Math.abs(fx) + Math.abs(fy)) % 2 === 0;
  const hue = ((lon + 180) % 360 + 360) % 360;
  const [r, g, b] = hslToRgb(hue, 0.62, checker ? 0.62 : 0.36);
  const grid = 1;
  const lonStep = Math.max(Math.abs(dlon) * 0.65, 1e-6);
  const latStep = Math.max(Math.abs(dlat) * 0.65, 1e-6);
  const nearLon = Math.abs(lon - Math.round(lon / grid) * grid) <= lonStep;
  const nearLat = Math.abs(lat - Math.round(lat / grid) * grid) <= latStep;
  if (Math.abs(lat) <= latStep * 1.4) return [255, 64, 64, 255];
  if (Math.abs(Math.abs(lon) - 180) <= lonStep || Math.abs(lon) <= lonStep) return [64, 255, 160, 255];
  if (nearLon || nearLat) return [255, 255, 255, 255];
  return [r, g, b, 255];
}

function pixelLonLat(x, y, zoom, srs, i, j, tileSize) {
  const u = (i + 0.5) / tileSize;
  const v = (j + 0.5) / tileSize;
  if (is4326(srs)) {
    const [west, south, east, north] = tileBounds4326(x, y, zoom);
    const dlon = (east - west) / tileSize;
    const dlat = (north - south) / tileSize;
    return { lon: west + u * (east - west), lat: north - v * (north - south), dlon, dlat };
  }
  const [west, south, east, north] = tileBounds3857Meters(x, y, zoom);
  const mx = west + u * (east - west);
  const my = north - v * (north - south);
  const [lon, lat] = mercatorToLonlat(mx, my);
  const [lon2] = mercatorToLonlat(mx + (east - west) / tileSize, my);
  const [, lat2] = mercatorToLonlat(mx, my - (north - south) / tileSize);
  return { lon, lat, dlon: lon2 - lon, dlat: lat - lat2 };
}

export function renderProceduralTile(z, x, y, srs, tileSize = DEFAULT_TILE_SIZE, style = "map") {
  const data = new Uint8ClampedArray(tileSize * tileSize * 4);
  for (let j = 0; j < tileSize; j++) {
    for (let i = 0; i < tileSize; i++) {
      const p = pixelLonLat(x, y, z, srs, i, j, tileSize);
      const rgba = proceduralColor(p.lon, p.lat, p.dlon, p.dlat, style);
      const o = (j * tileSize + i) * 4;
      data[o] = rgba[0];
      data[o + 1] = rgba[1];
      data[o + 2] = rgba[2];
      data[o + 3] = rgba[3];
    }
  }
  return data;
}

export function formatTileUrl(template, z, x, y) {
  return String(template)
    .replaceAll("{z}", String(z))
    .replaceAll("{zoom}", String(z))
    .replaceAll("{x}", String(x))
    .replaceAll("{y}", String(y))
    .replaceAll("{reverseY}", String(y));
}

function deg(v) {
  return v == null ? null : (v * 180) / Math.PI;
}

export async function extractImagePlane(camera, options) {
  const srs = normalizeSrs(options.srs || "EPSG:4326");
  const scheme = options.scheme || "xyz";
  const tileSize = options.tileSize || DEFAULT_TILE_SIZE;
  const maxEdge = options.maxEdge ?? DEFAULT_MAX_EDGE;
  const maxTiles = options.maxTiles ?? 64;
  const samplesPerEdge = options.samplesPerEdge ?? 24;
  const resolutionM = options.resolutionM ?? null;
  let zoom = options.zoom ?? null;
  let width = options.width ?? null;
  let height = options.height ?? null;

  if (resolutionM == null && (width == null || height == null) && zoom == null) {
    throw new Error("需要分辨率, 或同时给出 zoom 与宽高");
  }
  if (width == null || height == null) {
    if (resolutionM == null) throw new Error("未给满宽高时, 需要分辨率才能按中心斜距定尺");
    const sized = imageSizeFromResolution(camera, resolutionM, width, height, maxEdge);
    width = sized.width;
    height = sized.height;
  } else if (Math.max(width, height) > maxEdge) {
    throw new Error(`指定的像面为 ${width}x${height}, 长边超过上限 ${maxEdge}. 请减小尺寸或加大长边上限.`);
  }

  const fp = footprintRing(camera, samplesPerEdge);
  if (!fp.ring) throw new Error(fp.error);
  const center = centerRayHit(camera);
  const zoomLat = center ? center.lat : fp.ring.reduce((s, p) => s + p[1], 0) / fp.ring.length;
  if (zoom == null) {
    if (resolutionM == null) throw new Error("未指定 zoom 时需要分辨率以选择瓦片级别");
    zoom = zoomForResolution(
      resolutionM,
      srs,
      zoomLat,
      tileSize,
      options.minZoom ?? 0,
      options.maxZoom ?? 22
    );
  }
  zoom = Math.max(options.minZoom ?? 0, Math.min(options.maxZoom ?? 22, zoom | 0));

  const tiles = coveringTiles(fp.ring, zoom, srs);
  if (!tiles.length) throw new Error("视场脚印没有覆盖到任何瓦片");
  if (tiles.length > maxTiles) {
    throw new Error(
      `级别 z=${zoom} 需 ${tiles.length} 张瓦片, 超过上限 ${maxTiles}. 成像分辨率已按斜距与 IFOV 选定, 不会自动降低级别.`
    );
  }

  const layout = mosaicLayout(tiles, zoom, srs);
  const srcW = layout.cols * tileSize;
  const srcH = layout.rows * tileSize;
  const maxMosaic = options.maxMosaicPixels ?? 4096 * 4096;
  if (srcW * srcH > maxMosaic) {
    throw new Error(
      `级别 z=${zoom} 的拼接画布为 ${srcW}x${srcH} (${tiles.length} 张瓦片), 超过上限 ${maxMosaic} 像素. 不会自动降低瓦片级别.`
    );
  }
  const canvas = new Uint8ClampedArray(srcW * srcH * 4);
  const failed = [];
  const style = options.tileStyle || "map";
  const concurrency = Math.max(1, options.concurrency || 6);
  const fetched = await mapPool(layout.placed, concurrency, async (tile) => {
    if (!options.getTile) {
      return {
        tile,
        got: { data: renderProceduralTile(zoom, tile.x, tile.y, srs, tileSize, style), error: null, url: "" },
      };
    }
    const yReq = flipY(tile.y, srs, zoom, scheme);
    const url = options.urlTemplate ? formatTileUrl(options.urlTemplate, zoom, tile.x, yReq) : "";
    try {
      const got = await options.getTile({ z: zoom, x: tile.x, y: tile.y, yReq, url, srs, tileSize, style });
      return { tile, got };
    } catch (err) {
      return { tile, got: { data: null, error: err && err.message ? err.message : String(err), url } };
    }
  });
  for (const item of fetched) {
    const tile = item.tile;
    const got = item.got;
    const url = (got && got.url) || "";
    if (!got || !got.data) {
      failed.push(url ? `${url} (${got && got.error ? got.error : "无数据"})` : got && got.error ? got.error : "瓦片失败");
      continue;
    }
    const src = got.data;
    const col = tile.xAdj - layout.xMin;
    const row = tile.y - layout.yMin;
    const x0 = col * tileSize;
    const y0 = row * tileSize;
    for (let rowPix = 0; rowPix < tileSize; rowPix++) {
      const dst = ((y0 + rowPix) * srcW + x0) * 4;
      canvas.set(src.subarray(rowPix * tileSize * 4, (rowPix + 1) * tileSize * 4), dst);
    }
  }

  const image = new Uint8ClampedArray(width * height * 4);
  let hitCount = 0;
  const chunk = 16;
  for (let j0 = 0; j0 < height; j0 += chunk) {
    const j1 = Math.min(height, j0 + chunk);
    for (let j = j0; j < j1; j++) {
      for (let i = 0; i < width; i++) {
        const dir = pixelRayDirection(camera, width, height, i, j);
        const hit = rayIntersectEllipsoid(camera.position, dir);
        const o = (j * width + i) * 4;
        if (!hit) continue;
        hitCount += 1;
        const geo = ecefToGeodetic(hit.point[0], hit.point[1], hit.point[2]);
        const [sx, sy] = lonlatToCanvasXY(geo.lon, geo.lat, layout.extent, srcW, srcH, srs);
        const rgba = bilinearSample(canvas, srcW, srcH, sx, sy);
        image[o] = rgba[0];
        image[o + 1] = rgba[1];
        image[o + 2] = rgba[2];
        image[o + 3] = rgba[3];
      }
    }
    if (options.onProgress && width * height > 20000) {
      options.onProgress(j1 / height);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  const range = center ? center.t : Number.NaN;
  const tanH = Math.tan(0.5 * camera.hfov);
  const sizing = width && Number.isFinite(range) ? (2 * range * tanH) / width : null;
  const centerGsd = centerGroundGsd(camera, width, height);
  const hitRatio = width * height ? hitCount / (width * height) : 0;
  const stem = options.stem || "fov";
  const pngName = `${stem}_z${zoom}.png`;
  const manifest = {
    mode: "image",
    stem,
    camera: {
      ellipsoid: "WGS84",
      positionEcef: [camera.position[0], camera.position[1], camera.position[2]],
      positionGeodetic: { lon: camera.lon, lat: camera.lat, height: camera.height },
      direction: camera.direction.slice(),
      up: camera.up.slice(),
      right: camera.right.slice(),
      headingDeg: deg(camera.heading),
      pitchDeg: deg(camera.pitch),
      rollDeg: deg(camera.roll),
      hfovDeg: deg(camera.hfov),
      vfovDeg: deg(camera.vfov),
      fovShape: "rectangular",
    },
    sizePixels: [width, height],
    centerRangeMeters: Number.isFinite(range) ? range : null,
    centerHitLonLat: center ? [center.lon, center.lat] : null,
    requestedResolutionMeters: resolutionM,
    sizingPlaneGsdMeters: sizing,
    centerGroundGsdMeters: centerGsd,
    detector: options.detector || null,
    notes: NOTES,
    zoom,
    tileGsdMetersAtCenterLat: gsdMeters(zoom, srs, zoomLat, tileSize),
    sourceId: options.sourceId || "procedural",
    sourceTitle: options.sourceTitle || "程序化经纬色块",
    urlTemplate: options.urlTemplate || "procedural://lonlat-grid/{z}/{x}/{y}.png",
    sourceSrs: srs,
    scheme,
    tileSize,
    tileCount: tiles.length,
    tiles,
    failedTiles: failed,
    hitPixelRatio: hitRatio,
    image: pngName,
    footprintGeoJSON: `${stem}_z${zoom}_footprint.geojson`,
    footprint: {
      type: "Polygon",
      coordinates: [fp.ring],
    },
  };
  return {
    image,
    width,
    height,
    manifest,
    footprint: {
      type: "Feature",
      properties: {
        name: stem,
        crs: "EPSG:4326",
        hfovDeg: deg(camera.hfov),
        vfovDeg: deg(camera.vfov),
      },
      geometry: manifest.footprint,
    },
    failed,
  };
}
