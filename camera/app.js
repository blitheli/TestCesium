import {
  add3,
  assertFocalLengthConsistent,
  cameraFromGeodeticHpr,
  centerRayHit,
  deriveDetectorOptics,
  exportFootprintGeoJSON,
  exportSensorCameraJSON,
  findObliquePitchDeg,
  footprintRing,
  geodeticToEcef,
  gsdFromRange,
  rayDirectionUV,
  rayIntersectEllipsoid,
  scale3,
  srsFromLevel0Tiles,
  swathFromRange,
  trackHeadingRad,
  zoomForResolution,
} from "./geometry.js";
import {
  ELEMENTS,
  ecefVelocity,
  jdFromDate,
  sampleEcef,
  stateAtJd,
} from "./orbit.js";
import { flipImageRows, renderProceduralTile } from "./resample.js";
import { captureImagePlane, fixedMatrixFromCamera, DEFAULT_MAX_TILES } from "./capture.js";

const ION_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI4M2ZhYzM4My1lN2NhLTRjNTktODY1OC1jZDdmOTU3Y2ZjMGEiLCJpZCI6MTMwNTAsInNjb3BlcyI6WyJhc3IiLCJnYyJdLCJpYXQiOjE1NjI0NzA5NzB9.rRTs6chsWJdo9KNYe5VjJj2fUzMHeniIJvFQOd0aLJU";

const $ = (id) => document.getElementById(id);
const state = {
  frozen: null,
  follow: true,
  applyingFollow: false,
  result: null,
  pngUrl: null,
};

function num(id) {
  return Number($(id).value);
}

function setMessage(text, kind) {
  const el = $("message");
  el.textContent = text || "";
  el.className = kind || "";
}

function formatLtan(hours) {
  let h = Math.floor(hours);
  let mFloat = (hours - h) * 60;
  let m = Math.floor(mFloat);
  let s = Math.round((mFloat - m) * 60);
  if (s === 60) {
    s = 0;
    m += 1;
  }
  if (m === 60) {
    m = 0;
    h = (h + 1) % 24;
  }
  const pad = (v) => String(v).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function jdOf(time) {
  return jdFromDate(Cesium.JulianDate.toDate(time));
}

const PAGE_MAX_ARRAY_EDGE = 8192;

function readOpticsOrThrow() {
  const widthPx = Math.round(num("arrayW"));
  const heightPx = Math.round(num("arrayH"));
  const pitchUm = num("pitchUm");
  const hfovDeg = num("hfov");
  if (!(widthPx >= 2) || !(heightPx >= 2)) throw new Error("阵列宽和高至少为 2 像素.");
  if (Math.max(widthPx, heightPx) > PAGE_MAX_ARRAY_EDGE) {
    throw new Error(`阵列长边超过 ${PAGE_MAX_ARRAY_EDGE} px. 输出像素数就是阵列大小, 请减小阵列.`);
  }
  const optics = deriveDetectorOptics({
    widthPx,
    heightPx,
    pixelPitchMeters: pitchUm * 1e-6,
    hfovRad: (hfovDeg * Math.PI) / 180,
  });
  assertFocalLengthConsistent(optics, optics.focalLengthMeters);
  return optics;
}

function readOptics() {
  try {
    const optics = readOpticsOrThrow();
    state.opticsError = null;
    state.optics = optics;
    return optics;
  } catch (err) {
    state.opticsError = err;
    if (state.optics) return state.optics;
    throw err;
  }
}

function attitude() {
  const optics = readOptics();
  return {
    heading: num("heading"),
    pitch: num("pitch"),
    roll: num("roll"),
    hfov: optics.hfovDeg,
    vfov: optics.vfovDeg,
    optics,
  };
}

function cameraAt(time) {
  const st = stateAtJd(jdOf(time));
  const geo = state.frozen || st.geo;
  const att = attitude();
  const camera = cameraFromGeodeticHpr(geo.lon, geo.lat, geo.height, att.heading, att.pitch, att.roll, att.hfov, att.vfov);
  camera.detector = att.optics;
  return { state: st, camera };
}

function cartesian(arr) {
  return Cesium.Cartesian3.fromElements(arr[0], arr[1], arr[2]);
}

function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function downloadJSON(obj, filename) {
  downloadBlob(new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" }), filename);
}

function rayEnd(camera, u, v) {
  const origin = camera.position;
  const dir = rayDirectionUV(camera, u, v);
  const hit = rayIntersectEllipsoid(origin, dir);
  if (hit) return { hit: true, end: hit.point };
  return { hit: false, end: add3(origin, scale3(dir, 900000)) };
}

function nearFrame(camera, distance) {
  const uvs = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
    [-1, -1],
  ];
  return uvs.map(([u, v]) => {
    const dir = rayDirectionUV(camera, u, v);
    return cartesian(add3(camera.position, scale3(dir, distance)));
  });
}

function ringCartesians(camera) {
  const fp = footprintRing(camera, 12);
  if (!fp.ring) return null;
  return fp.ring.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat, 0));
}

function fallbackTriangle(camera) {
  const d = 0.02;
  return [
    Cesium.Cartesian3.fromDegrees(camera.lon, camera.lat, 0),
    Cesium.Cartesian3.fromDegrees(camera.lon + d, camera.lat, 0),
    Cesium.Cartesian3.fromDegrees(camera.lon, camera.lat + d, 0),
  ];
}

if (typeof Cesium === "undefined") {
  $("status").textContent = "CesiumJS 未能从 CDN 加载.";
} else {
  Cesium.Ion.defaultAccessToken = ION_TOKEN;
  const viewer = new Cesium.Viewer("cesiumContainer", {
    animation: true,
    timeline: true,
    baseLayer: false,
    baseLayerPicker: true,
    geocoder: false,
    homeButton: true,
    sceneModePicker: true,
    navigationHelpButton: false,
    infoBox: false,
    selectionIndicator: false,
  });
  viewer.resolutionScale = 2.0;
  viewer.scene.globe.enableLighting = true;
  viewer.scene.fog.enabled = false;
  viewer.scene.globe.depthTestAgainstTerrain = false;
  viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#0b3d5c");
  state.suppressLayerPick = true;

  const start = Cesium.JulianDate.fromIso8601(ELEMENTS.epochIso);
  const stop = Cesium.JulianDate.addDays(start, 2, new Cesium.JulianDate());
  viewer.clock.startTime = start.clone();
  viewer.clock.stopTime = stop.clone();
  viewer.clock.currentTime = start.clone();
  viewer.clock.clockRange = Cesium.ClockRange.LOOP_STOP;
  viewer.clock.multiplier = num("multiplier");
  viewer.clock.shouldAnimate = true;
  viewer.timeline.zoomTo(start, stop);

  $("elements").textContent =
    `a=${ELEMENTS.a.toFixed(0)} m, e=${ELEMENTS.e}, i=${ELEMENTS.iDeg.toFixed(6)}°, ` +
    `RAAN0=${ELEMENTS.raan0Deg.toFixed(3)}°, LTAN=${formatLtan(ELEMENTS.ltanHours)}, ` +
    `周期=${(ELEMENTS.periodSec / 60).toFixed(3)} min. 历元 ${ELEMENTS.epochIso}.`;

  const track = sampleEcef(ELEMENTS.epochJd, ELEMENTS.epochJd + 2, 20);
  viewer.entities.add({
    name: "轨道",
    polyline: {
      positions: track.map((s) => cartesian(s.ecef)),
      width: 1.4,
      arcType: Cesium.ArcType.NONE,
      material: Cesium.Color.fromCssColorString("#7ee0c8").withAlpha(0.28),
    },
  });
  viewer.entities.add({
    name: "星下点轨",
    polyline: {
      positions: track.map((s) => Cesium.Cartesian3.fromDegrees(s.geo.lon, s.geo.lat, 0)),
      width: 1.2,
      arcType: Cesium.ArcType.GEODESIC,
      material: Cesium.Color.fromCssColorString("#ffb703").withAlpha(0.28),
    },
  });

  viewer.entities.add({
    name: "SSO 卫星",
    position: new Cesium.CallbackProperty((time) => cartesian(stateAtJd(jdOf(time)).ecef), false),
    point: {
      pixelSize: 14,
      color: Cesium.Color.fromCssColorString("#e8fff8"),
      outlineColor: Cesium.Color.fromCssColorString("#12806a"),
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    ellipsoid: {
      radii: new Cesium.Cartesian3(16000, 16000, 16000),
      material: Cesium.Color.fromCssColorString("#f4fff9").withAlpha(0.92),
      outline: true,
      outlineColor: Cesium.Color.fromCssColorString("#55d6be"),
    },
    label: {
      text: "SSO 500 km",
      font: "14px sans-serif",
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(14, -14),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });

  const frozenPoint = viewer.entities.add({
    name: "定格相机",
    show: false,
    position: new Cesium.CallbackProperty((time) => {
      if (!state.frozen) return cartesian(stateAtJd(jdOf(time)).ecef);
      return cartesian(geodeticToEcef(state.frozen.lon, state.frozen.lat, state.frozen.height));
    }, false),
    point: {
      pixelSize: 8,
      color: Cesium.Color.fromCssColorString("#ffd166"),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    label: {
      text: "定格",
      font: "13px sans-serif",
      fillColor: Cesium.Color.fromCssColorString("#ffd166"),
      pixelOffset: new Cesium.Cartesian2(12, 10),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });

  const footprintEntity = viewer.entities.add({
    name: "地面脚印",
    polygon: {
      hierarchy: new Cesium.CallbackProperty((time) => {
        const camera = cameraAt(time).camera;
        const ring = ringCartesians(camera) || fallbackTriangle(camera);
        return new Cesium.PolygonHierarchy(ring);
      }, false),
      material: Cesium.Color.YELLOW.withAlpha(0.28),
      outline: false,
      height: 0,
    },
    polyline: {
      positions: new Cesium.CallbackProperty((time) => {
        const camera = cameraAt(time).camera;
        return ringCartesians(camera) || fallbackTriangle(camera);
      }, false),
      width: 3,
      arcType: Cesium.ArcType.GEODESIC,
      material: Cesium.Color.fromCssColorString("#ffe66d"),
    },
  });

  const revCache = { jd: null, space: null, ground: null };
  function currentRevolution(time) {
    const jd = jdOf(time);
    if (revCache.jd == null || Math.abs(jd - revCache.jd) > 15 / 86400) {
      const samples = sampleEcef(jd, jd + ELEMENTS.periodSec / 86400, 20);
      revCache.jd = jd;
      revCache.space = samples.map((s) => cartesian(s.ecef));
      revCache.ground = samples.map((s) => Cesium.Cartesian3.fromDegrees(s.geo.lon, s.geo.lat, 0));
    }
    return revCache;
  }
  viewer.entities.add({
    name: "当前一圈",
    polyline: {
      positions: new Cesium.CallbackProperty((time) => currentRevolution(time).space, false),
      width: 3,
      arcType: Cesium.ArcType.NONE,
      material: Cesium.Color.fromCssColorString("#f8fffc"),
    },
  });
  viewer.entities.add({
    name: "当前星下点",
    polyline: {
      positions: new Cesium.CallbackProperty((time) => currentRevolution(time).ground, false),
      width: 3,
      arcType: Cesium.ArcType.NONE,
      material: Cesium.Color.fromCssColorString("#ffe08a"),
    },
  });

  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  for (const [u, v] of corners) {
    viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty((time) => {
          const camera = cameraAt(time).camera;
          const end = rayEnd(camera, u, v);
          return [cartesian(camera.position), cartesian(end.end)];
        }, false),
        width: 2.4,
        arcType: Cesium.ArcType.NONE,
        material: new Cesium.ColorMaterialProperty(
          new Cesium.CallbackProperty((time) => {
            const camera = cameraAt(time).camera;
            return rayEnd(camera, u, v).hit
              ? Cesium.Color.WHITE.withAlpha(0.9)
              : Cesium.Color.fromCssColorString("#ff6b8a");
          }, false)
        ),
      },
    });
  }

  viewer.entities.add({
    polyline: {
      positions: new Cesium.CallbackProperty((time) => nearFrame(cameraAt(time).camera, 140000), false),
      width: 3,
      arcType: Cesium.ArcType.NONE,
      material: Cesium.Color.fromCssColorString("#55d6be"),
    },
  });

  viewer.entities.add({
    polyline: {
      positions: new Cesium.CallbackProperty((time) => {
        const camera = cameraAt(time).camera;
        const ground = geodeticToEcef(camera.lon, camera.lat, 0);
        return [cartesian(camera.position), cartesian(ground)];
      }, false),
      width: 1,
      arcType: Cesium.ArcType.NONE,
      material: Cesium.Color.fromCssColorString("#9ad7ff").withAlpha(0.7),
    },
  });

  function applyFollow(pack) {
    const target = cartesian(pack.camera.position);
    state.applyingFollow = true;
    viewer.camera.lookAt(
      target,
      new Cesium.HeadingPitchRange(Cesium.Math.toRadians(42), Cesium.Math.toRadians(-22), 780000)
    );
    state.applyingFollow = false;
  }

  function releaseFollow() {
    state.applyingFollow = true;
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    state.applyingFollow = false;
  }

  viewer.camera.moveStart.addEventListener(() => {
    if (state.applyingFollow || !state.follow) return;
    state.follow = false;
    $("follow").checked = false;
    releaseFollow();
  });

  viewer.homeButton.viewModel.command.beforeExecute.addEventListener((event) => {
    event.cancel = true;
    state.follow = true;
    $("follow").checked = true;
    applyFollow(cameraAt(viewer.clock.currentTime));
  });

  function updateEstimate() {
    try {
      const optics = readOpticsOrThrow();
      const { camera } = cameraAt(viewer.clock.currentTime);
      const hit = centerRayHit(camera);
      const range = hit ? hit.t : Number.NaN;
      const info = selectedLayerInfo();
      const gsdH = Number.isFinite(range) ? gsdFromRange(range, optics.ifovHorizontalRad) : Number.NaN;
      const gsdV = Number.isFinite(range) ? gsdFromRange(range, optics.ifovVerticalRad) : Number.NaN;
      const zoom = Number.isFinite(gsdH)
        ? zoomForResolution(gsdH, info.srs, hit ? hit.lat : camera.lat, info.tileSize, info.minZoom, info.maxZoom)
        : null;
      const swathH = Number.isFinite(range) ? swathFromRange(range, optics.hfovRad) : Number.NaN;
      const swathV = Number.isFinite(range) ? swathFromRange(range, optics.vfovRad) : Number.NaN;
      const mm = (m) => (m * 1000).toFixed(3);
      const deg = (rad) => ((rad * 180) / Math.PI).toFixed(5);
      $("derived").textContent =
        `vfov ${optics.vfovDeg.toFixed(4)}° (由阵列纵横比和 hfov 锁定, 保证同一焦距)\n` +
        `焦平面 ${mm(optics.focalPlaneWidthMeters)} mm x ${mm(optics.focalPlaneHeightMeters)} mm\n` +
        `f ${mm(optics.focalLengthMeters)} mm\n` +
        `IFOV ${deg(optics.ifovHorizontalRad)}° x ${deg(optics.ifovVerticalRad)}°\n` +
        `斜距 H ${Number.isFinite(range) ? range.toFixed(1) : "-"} m, 预计 z=${zoom ?? "-"}\n` +
        `GSD ${Number.isFinite(gsdH) ? gsdH.toFixed(2) : "-"} m x ${Number.isFinite(gsdV) ? gsdV.toFixed(2) : "-"} m\n` +
        `幅宽 ${Number.isFinite(swathH) ? (swathH / 1000).toFixed(3) : "-"} km x ${Number.isFinite(swathV) ? (swathV / 1000).toFixed(3) : "-"} km\n` +
        `影像层 ${info.name}, ${info.srs}`;
    } catch (err) {
      $("derived").textContent = err.message || String(err);
    }
  }

  viewer.clock.onTick.addEventListener(() => {
    const pack = cameraAt(viewer.clock.currentTime);
    const st = pack.state;
    const geo = state.frozen || st.geo;
    const vel = ecefVelocity(st.jd);
    const speed = Math.hypot(vel[0], vel[1], vel[2]);
    $("status").textContent =
      `星下点 ${st.geo.lon.toFixed(2)}°, ${st.geo.lat.toFixed(2)}°, 测地高 ${(st.geo.height / 1000).toFixed(1)} km, ` +
      `u=${((st.u * 180) / Math.PI).toFixed(1)}°, LTAN ${formatLtan(st.ltanHours)}, ` +
      `${speed.toFixed(0)} m/s` +
      (state.frozen ? `\n定格相机 ${geo.lon.toFixed(2)}°, ${geo.lat.toFixed(2)}°, ${(geo.height / 1000).toFixed(1)} km` : "");
    if (state.follow) applyFollow(pack);
    footprintEntity.show = !!ringCartesians(pack.camera);
    updateEstimate();
  });

  $("multiplier").addEventListener("change", () => {
    const value = num("multiplier");
    if (value > 0) viewer.clock.multiplier = value;
  });
  $("follow").addEventListener("change", () => {
    state.follow = $("follow").checked;
    if (state.follow) applyFollow(cameraAt(viewer.clock.currentTime));
    else releaseFollow();
  });
  for (const id of ["heading", "pitch", "roll", "hfov", "arrayW", "arrayH", "pitchUm"]) {
    $(id).addEventListener("input", updateEstimate);
  }

  $("nadir").addEventListener("click", () => {
    $("heading").value = "0";
    $("pitch").value = "-90";
    $("roll").value = "0";
    updateEstimate();
  });
  $("oblique").addEventListener("click", () => {
    const { camera } = cameraAt(viewer.clock.currentTime);
    const optics = readOptics();
    const pitch = findObliquePitchDeg(camera.lon, camera.lat, camera.height, num("heading"), num("roll"), optics.hfovDeg, optics.vfovDeg);
    $("pitch").value = pitch.toFixed(2);
    updateEstimate();
    setMessage(`侧视 pitch=${pitch.toFixed(2)}°. 上边缘射线落到地平线外, 拍照后上边应为透明.`, "ok");
  });
  $("along").addEventListener("click", () => {
    const st = stateAtJd(jdOf(viewer.clock.currentTime));
    const heading = trackHeadingRad(st.ecef, ecefVelocity(st.jd));
    let deg = (heading * 180) / Math.PI;
    if (deg < 0) deg += 360;
    $("heading").value = deg.toFixed(2);
    updateEstimate();
  });
  $("freeze").addEventListener("click", () => {
    if (state.frozen) {
      state.frozen = null;
      frozenPoint.show = false;
      $("freeze").textContent = "定格当前相机";
      setMessage("已解除定格, 视场跟随卫星.", "ok");
      return;
    }
    const st = stateAtJd(jdOf(viewer.clock.currentTime));
    state.frozen = { lon: st.geo.lon, lat: st.geo.lat, height: st.geo.height };
    frozenPoint.show = true;
    $("freeze").textContent = "解除定格";
    setMessage("已定格相机位置. 时间仍在走, 姿态滑块仍作用在定格位置上.", "ok");
  });
  $("toggle").addEventListener("click", () => {
    const panel = $("panel");
    const collapsed = panel.classList.toggle("collapsed");
    $("toggle").textContent = collapsed ? "+" : "−";
  });

  function layerLabel(layer, index) {
    if (layer.name) return layer.name;
    const provider = layer.imageryProvider;
    const credit = provider && provider.credit;
    const text = credit && (credit.html || credit.text);
    if (text) return String(text).replace(/<[^>]+>/g, "").slice(0, 72);
    const ctor = provider && provider.constructor && provider.constructor.name;
    return ctor && ctor !== "Object" ? ctor : `影像层 ${index + 1}`;
  }

  function refreshLayerList() {
    const select = $("imageryLayer");
    const current = state.selectedLayer;
    select.innerHTML = "";
    for (let i = 0; i < viewer.imageryLayers.length; i++) {
      const layer = viewer.imageryLayers.get(i);
      const option = document.createElement("option");
      option.value = String(i);
      option.textContent = layerLabel(layer, i);
      if (layer === current) option.selected = true;
      select.appendChild(option);
    }
  }

  function selectLayer(layer) {
    if (!layer) return;
    state.selectedLayer = layer;
    const collection = viewer.imageryLayers;
    for (let i = 0; i < collection.length; i++) {
      collection.get(i).show = collection.get(i) === layer;
    }
    if (collection.indexOf(layer) !== collection.length - 1) collection.raiseToTop(layer);
    refreshLayerList();
    updateEstimate();
  }

  function selectedLayerInfo() {
    const layer = state.selectedLayer;
    const provider = layer && layer.imageryProvider;
    if (!provider || !provider.tilingScheme) throw new Error("没有选中的影像层.");
    const scheme = provider.tilingScheme;
    const nx = scheme.getNumberOfXTilesAtLevel(0);
    const ny = scheme.getNumberOfYTilesAtLevel(0);
    const srs = srsFromLevel0Tiles(nx, ny);
    if (!srs) throw new Error(`当前影像层 0 级是 ${nx}x${ny}, 不是全球 Geographic (2x1) 或 WebMercator (1x1).`);
    if (srs === "EPSG:4326" && scheme.rectangle) {
      const west = Cesium.Math.toDegrees(scheme.rectangle.west);
      const east = Cesium.Math.toDegrees(scheme.rectangle.east);
      const south = Cesium.Math.toDegrees(scheme.rectangle.south);
      const north = Cesium.Math.toDegrees(scheme.rectangle.north);
      if (Math.abs(west + 180) > 0.01 || Math.abs(east - 180) > 0.01 || Math.abs(south + 90) > 0.01 || Math.abs(north - 90) > 0.01) {
        throw new Error("当前影像层不是全球范围, 像面重采样按全球切片计算.");
      }
    }
    const maxZoom = provider.maximumLevel == null || !Number.isFinite(provider.maximumLevel) ? 22 : provider.maximumLevel;
    return {
      layer,
      provider,
      name: layer.name || layerLabel(layer, 0),
      srs,
      tileSize: provider.tileWidth || 256,
      minZoom: provider.minimumLevel || 0,
      maxZoom,
      url: typeof provider.url === "string" ? provider.url : `cesium-imagery://${layer.name || "layer"}/{z}/{x}/{y}`,
    };
  }

  function tileUrl(info, z, x, y) {
    return String(info.url)
      .replaceAll("{z}", String(z))
      .replaceAll("{zoom}", String(z))
      .replaceAll("{x}", String(x))
      .replaceAll("{y}", String(y))
      .replaceAll("{reverseY}", String(y));
  }

  async function rgbaFromProviderImage(image, width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, width, height);
    let data;
    try {
      data = ctx.getImageData(0, 0, width, height).data;
    } catch (_err) {
      throw new Error("无法读取影像像素, 多半是跨域 (CORS). 该影像层的瓦片不允许浏览器读取, 照片不会改用其他层.");
    }
    // Cesium 为了 WebGL 把 ImageBitmap 上下翻转, 行 0 是南. Canvas 和 HTMLImageElement 已经是北在上.
    if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) {
      data = flipImageRows(data, width, height);
    }
    return data;
  }

  async function getTile(req) {
    const info = selectedLayerInfo();
    // requestImage 用 XYZ 的 y (北为 0). Cesium 自己把 URL 里的 {reverseY} 换成 TMS 行号, 这里不能再传 yReq.
    const url = tileUrl(info, req.z, req.x, req.y);
    try {
      let image = info.provider.requestImage(req.x, req.y, req.z);
      if (image && typeof image.then === "function") image = await image;
      if (!image) return { data: null, url, error: "影像层没有返回该瓦片" };
      const data = await rgbaFromProviderImage(image, info.tileSize, info.provider.tileHeight || info.tileSize);
      return { data, url, error: null };
    } catch (err) {
      return { data: null, url, error: err && err.message ? err.message : String(err) };
    }
  }

  function createProceduralImageryProvider() {
    const tilingScheme = new Cesium.GeographicTilingScheme();
    return {
      tilingScheme,
      rectangle: tilingScheme.rectangle,
      tileWidth: 256,
      tileHeight: 256,
      minimumLevel: 0,
      maximumLevel: 12,
      ready: true,
      readyPromise: Promise.resolve(true),
      credit: new Cesium.Credit("程序化经纬色块"),
      errorEvent: new Cesium.Event(),
      hasAlphaChannel: true,
      getTileCredits() {
        return undefined;
      },
      pickFeatures() {
        return undefined;
      },
      requestImage(x, y, level) {
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext("2d");
        const imageData = ctx.createImageData(256, 256);
        imageData.data.set(renderProceduralTile(level, x, y, "EPSG:4326", 256, "map"));
        ctx.putImageData(imageData, 0, 0);
        return Promise.resolve(canvas);
      },
    };
  }

  viewer.imageryLayers.layerAdded.addEventListener((layer) => {
    refreshLayerList();
    if (!state.suppressLayerPick) selectLayer(layer);
  });
  viewer.imageryLayers.layerRemoved.addEventListener((layer) => {
    if (state.selectedLayer === layer) state.selectedLayer = null;
    refreshLayerList();
    if (!state.selectedLayer && viewer.imageryLayers.length) {
      selectLayer(viewer.imageryLayers.get(viewer.imageryLayers.length - 1));
    }
  });
  viewer.imageryLayers.layerMoved.addEventListener(() => refreshLayerList());

  const proceduralLayer = viewer.imageryLayers.addImageryProvider(createProceduralImageryProvider());
  proceduralLayer.name = "程序化经纬色块";
  const gridLayer = viewer.imageryLayers.addImageryProvider(
    new Cesium.GridImageryProvider({
      tilingScheme: new Cesium.GeographicTilingScheme(),
      cells: 4,
      color: Cesium.Color.WHITE,
      glowColor: Cesium.Color.WHITE.withAlpha(0.2),
      glowWidth: 1,
      backgroundColor: Cesium.Color.fromCssColorString("#0b3d5c"),
    })
  );
  gridLayer.name = "经纬网格";
  state.suppressLayerPick = false;
  selectLayer(proceduralLayer);

  $("imageryLayer").addEventListener("change", () => {
    const layer = viewer.imageryLayers.get(Number($("imageryLayer").value));
    if (layer) selectLayer(layer);
  });

  $("addLayer").addEventListener("click", () => {
    const template = $("urlTemplate").value.trim();
    const hasZ = template.includes("{z}") || template.includes("{zoom}");
    if (!template || !hasZ || !template.includes("{x}") || !template.includes("{y}")) {
      setMessage("URL 需要包含 {z} 或 {zoom}, 以及 {x} 和 {y}.", "error");
      return;
    }
    if (template.includes("<id>") || template.includes("%3Cid%3E")) {
      setMessage("URL 模板仍包含 <id>, 请换成真实影像源 id 后再添加. 当前照片仍使用已选中的影像层.", "error");
      return;
    }
    const srs = $("newSrs").value;
    const scheme = $("newScheme").value;
    const url = scheme === "tms" ? template.replaceAll("{y}", "{reverseY}") : template;
    try {
      const provider = new Cesium.UrlTemplateImageryProvider({
        url,
        tilingScheme: srs === "EPSG:4326" ? new Cesium.GeographicTilingScheme() : new Cesium.WebMercatorTilingScheme(),
        maximumLevel: 18,
        credit: url,
      });
      const layer = viewer.imageryLayers.addImageryProvider(provider);
      layer.name = `URL ${url.slice(0, 42)}`;
      if (provider.errorEvent) {
        provider.errorEvent.addEventListener((error) => {
          if (state.selectedLayer === layer) {
            const text = error && error.message ? error.message : String(error);
            setMessage(`影像层请求失败: ${text}. 照片不会改用其他层.`, "error");
          }
        });
      }
      selectLayer(layer);
      setMessage("已添加并选中影像层. 地球和拍照都使用这一层.", "ok");
    } catch (err) {
      setMessage(err && err.message ? err.message : String(err), "error");
    }
  });

  function showSummary(manifest) {
    const d = manifest.detector || {};
    const g = manifest.centerGroundGsdMeters || {};
    const mm = (m) => (m == null ? "-" : (m * 1000).toFixed(3));
    const deg = (rad) => (rad == null ? "-" : ((rad * 180) / Math.PI).toFixed(5));
    const lines = [
      `像面 ${manifest.sizePixels[0]} x ${manifest.sizePixels[1]}  z=${manifest.zoom}`,
      `hfov ${manifest.camera.hfovDeg.toFixed(4)}°  vfov ${manifest.camera.vfovDeg.toFixed(4)}°`,
      `f ${mm(d.focalLengthMeters)} mm, 焦平面 ${mm(d.focalPlaneWidthMeters)} mm x ${mm(d.focalPlaneHeightMeters)} mm`,
      `IFOV ${deg(d.ifovHorizontalRad)}° x ${deg(d.ifovVerticalRad)}°`,
      `斜距 H ${manifest.centerRangeMeters == null ? "-" : manifest.centerRangeMeters.toFixed(1)} m`,
      `GSD ${d.gsdHorizontalMeters == null ? "-" : d.gsdHorizontalMeters.toFixed(2)} m x ${d.gsdVerticalMeters == null ? "-" : d.gsdVerticalMeters.toFixed(2)} m`,
      `幅宽 ${d.swathHorizontalMeters == null ? "-" : (d.swathHorizontalMeters / 1000).toFixed(3)} km x ${d.swathVerticalMeters == null ? "-" : (d.swathVerticalMeters / 1000).toFixed(3)} km`,
      `切平面像元 ${manifest.sizingPlaneGsdMeters == null ? "-" : manifest.sizingPlaneGsdMeters.toFixed(2)} m, 中心地面 ${g.mean == null ? "-" : g.mean.toFixed(2)} m`,
      `瓦片 ${manifest.tileCount} 张  失败 ${manifest.failedTiles.length}`,
      `命中 ${(manifest.hitPixelRatio * 100).toFixed(1)}%  ${manifest.sourceTitle}  ${manifest.sourceSrs}`,
    ];
    $("summary").textContent = lines.join("\n");
  }

  async function capture() {
    const button = $("capture");
    button.disabled = true;
    setMessage("正在读取阵列...", "");
    try {
      const { camera } = cameraAt(viewer.clock.currentTime);
      const optics = camera.detector;
      setMessage(
        `正在重采样 ${optics.widthPx}x${optics.heightPx}. 大阵列会按成像 GSD 选择较细的瓦片级别, 可能较慢并占用较多内存, 不会降低级别.`,
        ""
      );
      const info = selectedLayerInfo();
      const projection = info.srs === "EPSG:3857" ? "webmercator" : "geodetic";
      const result = await captureImagePlane({
        sensorToFixed: fixedMatrixFromCamera(camera),
        hfov: optics.hfovDeg,
        hfovUnit: "deg",
        width: optics.widthPx,
        height: optics.heightPx,
        pixelPitchMeters: optics.pixelPitchMeters,
        maxEdge: PAGE_MAX_ARRAY_EDGE,
        maxTiles: DEFAULT_MAX_TILES,
        imagery: {
          url: info.url,
          projection,
          scheme: typeof info.url === "string" && info.url.includes("{reverseY}") ? "tms" : "xyz",
          tileSize: info.tileSize,
          minZoom: info.minZoom,
          maxZoom: info.maxZoom,
          title: info.name,
          id: info.name,
          requestTile: (req) => getTile(req),
        },
      });
      const canvas = document.createElement("canvas");
      canvas.width = result.width;
      canvas.height = result.height;
      canvas.getContext("2d").putImageData(new ImageData(result.image, result.width, result.height), 0, 0);
      if (state.pngUrl) URL.revokeObjectURL(state.pngUrl);
      state.pngUrl = canvas.toDataURL("image/png");
      $("preview").src = state.pngUrl;
      state.result = result;
      $("savePng").disabled = false;
      $("saveManifest").disabled = false;
      showSummary(result.manifest);
      const failed = result.failed.length;
      if (failed && failed === result.manifest.tileCount) {
        setMessage(`全部 ${failed} 张瓦片失败. ${result.failed[0]}`, "error");
      } else if (failed) {
        setMessage(`照片已生成, ${failed} 张瓦片失败. ${result.failed[0]}`, "error");
      } else if (result.manifest.hitPixelRatio <= 0) {
        setMessage("中心或视场没有打到椭球, 照片全透明. 请把 pitch 调向天底.", "error");
      } else {
        setMessage(
          `已生成 ${result.width}x${result.height}, 命中 ${(result.manifest.hitPixelRatio * 100).toFixed(1)}%, 瓦片 ${result.manifest.tileCount} 张. 影像层: ${result.manifest.sourceTitle}.`,
          "ok"
        );
      }
    } catch (err) {
      setMessage(err && err.message ? err.message : String(err), "error");
    } finally {
      button.disabled = false;
    }
  }

  $("capture").addEventListener("click", capture);
  $("savePng").addEventListener("click", () => {
    if (!state.result || !state.pngUrl) return;
    const a = document.createElement("a");
    a.href = state.pngUrl;
    a.download = state.result.manifest.image;
    a.click();
  });
  $("saveManifest").addEventListener("click", () => {
    if (!state.result) return;
    downloadJSON(state.result.manifest, state.result.manifest.image.replace(/\.png$/, ".json"));
  });
  $("saveCamera").addEventListener("click", () => {
    const { camera } = cameraAt(viewer.clock.currentTime);
    downloadJSON(exportSensorCameraJSON(camera, "sso-500km"), "camera.json");
  });
  $("saveFootprint").addEventListener("click", () => {
    try {
      const { camera } = cameraAt(viewer.clock.currentTime);
      downloadJSON(exportFootprintGeoJSON(camera, 16, "sso-500km"), "footprint.geojson");
    } catch (err) {
      setMessage(err.message || String(err), "error");
    }
  });

  applyFollow(cameraAt(viewer.clock.currentTime));
  updateEstimate();
  viewer.scene.requestRender();
}
