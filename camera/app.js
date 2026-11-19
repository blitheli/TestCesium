import {
  add3,
  cameraFromGeodeticHpr,
  centerRayHit,
  exportFootprintGeoJSON,
  exportSensorCameraJSON,
  findObliquePitchDeg,
  footprintRing,
  geodeticToEcef,
  imageSizeFromResolution,
  rayDirectionUV,
  rayIntersectEllipsoid,
  scale3,
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
import { extractImagePlane, renderProceduralTile } from "./resample.js";

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

function attitude() {
  return {
    heading: num("heading"),
    pitch: num("pitch"),
    roll: num("roll"),
    hfov: num("hfov"),
    vfov: num("vfov"),
  };
}

function cameraAt(time) {
  const st = stateAtJd(jdOf(time));
  const geo = state.frozen || st.geo;
  const att = attitude();
  const camera = cameraFromGeodeticHpr(geo.lon, geo.lat, geo.height, att.heading, att.pitch, att.roll, att.hfov, att.vfov);
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
    baseLayerPicker: true,
    geocoder: false,
    homeButton: true,
    sceneModePicker: true,
    navigationHelpButton: false,
    infoBox: false,
    selectionIndicator: false,
  });
  viewer.scene.globe.enableLighting = true;
  viewer.scene.fog.enabled = false;
  viewer.scene.globe.depthTestAgainstTerrain = false;
  viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#0b3d5c");
  try {
    viewer.imageryLayers.removeAll();
    viewer.imageryLayers.addImageryProvider(
      new Cesium.GridImageryProvider({
        tilingScheme: new Cesium.GeographicTilingScheme(),
        cells: 4,
        color: Cesium.Color.fromCssColorString("#d7eef8").withAlpha(0.7),
        glowColor: Cesium.Color.fromCssColorString("#d7eef8").withAlpha(0.2),
        glowWidth: 1,
        backgroundColor: Cesium.Color.fromCssColorString("#0b3d5c"),
      })
    );
  } catch (err) {
    console.warn(err);
  }

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
      const { camera } = cameraAt(viewer.clock.currentTime);
      const sized = imageSizeFromResolution(camera, num("resolution"), null, null, num("maxEdge"));
      const center = centerRayHit(camera);
      const lat = center ? center.lat : camera.lat;
      const zoom = zoomForResolution(num("resolution"), $("srs").value, lat);
      $("estimate").textContent =
        `定尺约 ${sized.width} x ${sized.height} px, 中心斜距 ${sized.range.toFixed(0)} m, 预计 z=${zoom}. ` +
        "侧视时地面 GSD 比切平面更粗.";
    } catch (err) {
      $("estimate").textContent = err.message || String(err);
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
  for (const id of ["heading", "pitch", "roll", "hfov", "vfov", "resolution", "maxEdge", "srs"]) {
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
    const pitch = findObliquePitchDeg(camera.lon, camera.lat, camera.height, num("heading"), num("roll"), num("hfov"), num("vfov"));
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

  async function fetchUrlTile(req) {
    const template = $("urlTemplate").value.trim();
    if (!template || template.includes("<id>") || template.includes("%3Cid%3E")) {
      return { data: null, url: req.url, error: "URL 模板仍包含 <id>, 请换成真实影像源 id, 或改回程序化瓦片" };
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const resp = await fetch(req.url, { signal: ctrl.signal, mode: "cors" });
      if (resp.status === 404) return { data: null, url: req.url, error: "HTTP 404" };
      if (!resp.ok) return { data: null, url: req.url, error: `HTTP ${resp.status}` };
      const blob = await resp.blob();
      const bmp = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = req.tileSize;
      canvas.height = req.tileSize;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0, req.tileSize, req.tileSize);
      const data = ctx.getImageData(0, 0, req.tileSize, req.tileSize).data;
      if (bmp.close) bmp.close();
      return { data, url: req.url, error: null };
    } catch (err) {
      const raw = err && err.name === "AbortError" ? "请求超时" : err && err.message ? err.message : String(err);
      const cors = /fetch|network|cors|failed/i.test(raw);
      return {
        data: null,
        url: req.url,
        error: cors ? `${raw}. 可能是 CORS 或服务不可达, 可改回程序化瓦片源.` : raw,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async function getTile(req) {
    if ($("source").value === "procedural") {
      return { data: renderProceduralTile(req.z, req.x, req.y, req.srs, req.tileSize, "map"), url: req.url, error: null };
    }
    return fetchUrlTile(req);
  }

  function showSummary(manifest) {
    const g = manifest.centerGroundGsdMeters || {};
    const lines = [
      `像面 ${manifest.sizePixels[0]} x ${manifest.sizePixels[1]}  z=${manifest.zoom}`,
      `hfov ${manifest.camera.hfovDeg.toFixed(3)}°  vfov ${manifest.camera.vfovDeg.toFixed(3)}°`,
      `中心斜距 ${manifest.centerRangeMeters == null ? "-" : manifest.centerRangeMeters.toFixed(1)} m`,
      `切平面 GSD ${manifest.sizingPlaneGsdMeters == null ? "-" : manifest.sizingPlaneGsdMeters.toFixed(2)} m`,
      `中心地面 GSD ${g.mean == null ? "-" : g.mean.toFixed(2)} m (x ${g.x == null ? "-" : g.x.toFixed(2)}, y ${g.y == null ? "-" : g.y.toFixed(2)})`,
      `分辨率 ${manifest.requestedResolutionMeters} m/px  瓦片 ${manifest.tileCount} 张  失败 ${manifest.failedTiles.length}`,
      `命中 ${(manifest.hitPixelRatio * 100).toFixed(1)}%  ${manifest.sourceSrs} ${manifest.scheme}`,
      manifest.centerHitLonLat ? `中心 ${manifest.centerHitLonLat[0].toFixed(4)}°, ${manifest.centerHitLonLat[1].toFixed(4)}°` : "中心未命中",
    ];
    $("summary").textContent = lines.join("\n");
  }

  async function capture() {
    const button = $("capture");
    button.disabled = true;
    setMessage("正在重采样...", "");
    try {
      const { camera } = cameraAt(viewer.clock.currentTime);
      const useUrl = $("source").value === "url";
      const result = await extractImagePlane(camera, {
        resolutionM: num("resolution"),
        maxEdge: num("maxEdge"),
        maxTiles: 48,
        srs: $("srs").value,
        scheme: $("scheme").value,
        urlTemplate: useUrl ? $("urlTemplate").value.trim() : "procedural://lonlat-grid/{z}/{x}/{y}.png",
        sourceId: useUrl ? "url" : "procedural",
        sourceTitle: useUrl ? "URL 模板" : "程序化经纬色块",
        getTile,
        stem: "fov",
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
          `已生成 ${result.width}x${result.height}, 命中 ${(result.manifest.hitPixelRatio * 100).toFixed(1)}%, 瓦片 ${result.manifest.tileCount} 张.`,
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
