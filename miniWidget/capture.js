/**
 * 触发 2000 像元宽度高分成像拍照
 * @param {Cesium.Viewer} viewer 小窗口 Viewer 实例
 * @param {number} targetWidth 目标像元宽度（如 2000）
 */
async function captureHighResImage(viewer, targetWidth = 2000) {
  const scene = viewer.scene;
  const canvas = viewer.canvas;

  // 1. 记录原始状态
  const originalScale = viewer.resolutionScale;
  const originalSSE = scene.globe.maximumScreenSpaceError;
  const cssWidth = canvas.clientWidth; // 例如 300px

  try {
    // 2. 计算放大倍率（300px -> 2000px，约 6.67 倍）
    viewer.resolutionScale = targetWidth / cssWidth;

    // 3. 调高瓦片加载精细度，确保 2000px 放大后地面纹理依然清晰
    // 这个参数真正把层级往下推，（默认是 2），允许的屏幕误差更小，四叉树才会选择更细的地形瓦片
    scene.globe.maximumScreenSpaceError = 0.5;

    // 4. 强制同步渲染一帧并等待瓦片就绪
    viewer.resize();
    scene.render();

    // 若需要等待高分辨率瓦片完全加载完毕再快门成像，可轮询瓦片队列
    await waitForTilesLoaded(scene);
    scene.render();

    // 5. 导出 2000px 宽度的图像（支持 PNG 或 JPEG）
    const dataUrl = canvas.toDataURL("image/png");
    downloadImage(dataUrl, `satellite_capture_${Date.now()}.png`);

    return dataUrl;
  } finally {
    // 6. 拍完立即恢复小窗口日常预览状态，释放 GPU 压力
    viewer.resolutionScale = originalScale;
    scene.globe.maximumScreenSpaceError = originalSSE;
    viewer.resize();
    scene.render();
  }
}

// 辅助函数：等待高分瓦片加载完成（设置超时防止死等）
function waitForTilesLoaded(scene, timeout = 3000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      scene.render();
      if (scene.globe.tilesLoaded || Date.now() - start > timeout) {
        resolve();
      } else {
        requestAnimationFrame(check);
      }
    };
    check();
  });
}

// 辅助函数：触发浏览器下载
function downloadImage(dataUrl, filename) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  link.click();
}

//=================================================================================
/**
 * 获取小窗口的Viewer，用于画中画功能。未设置相机, 和图层(默认)
 * 必须和主 Viewer 共用同一个 Cesium.SharedContext。Cesium 1.140 的 ResourceCache
 * 只按 URL 缓存纹理、顶点缓冲和着色器，不区分 WebGL context。小窗再开一个 context
 * 时，同一份 glTF / Entity 会把主窗口的 GPU 对象绑到小窗上。
 * @param {string} id
 * @param {Cesium.SharedContext} sharedContext
 * @returns {Cesium.CesiumWidget}
 */
function getMiniViewer(id, sharedContext) {
  if (!(sharedContext instanceof Cesium.SharedContext)) {
    throw new Error("小窗口必须和主 Viewer 共用 Cesium.SharedContext, 不能再开一个 WebGL context");
  }

  // 小窗口，同样是Viewer，但是不显示任何UI，只显示地图。
  // contextOptions 传入 SharedContext 实例时，Scene 不会再 getContext("webgl2")，
  // 而是在这块画布上取 2d context，由共享的 WebGL 画布画完再贴过来。
  const miniViewer = new Cesium.CesiumWidget(id, {
    scene3DOnly: true,
    baseLayer: false,
    //imageryProvider: false,
    contextOptions: sharedContext,
  });

  //如果主窗口和副窗口使用的是同一个在线底图，直接复用同一个 imageryProvider 实例
  //miniViewer.scene.imageryLayers.addImageryProvider(viewer.scene.imageryLayers.getImageryProvider(0));

  // ArcGIS MapServer 的路径是 /tile/{level}/{row}/{col}, 对应 {z}/{y}/{x}
  const imageryProvider = new Cesium.UrlTemplateImageryProvider({
    url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maximumLevel: 18,
  });
  miniViewer.scene.imageryLayers.addImageryProvider(imageryProvider);

  //if (miniViewer.scene.imageryLayers.length) miniViewer.scene.imageryLayers.removeAll();
  miniViewer.resolutionScale = 1;
  miniViewer.scene.globe.enableLighting = false;
  miniViewer.scene.globe.showGroundAtmosphere = false;
  miniViewer.scene.globe.depthTestAgainstTerrain = false;
  miniViewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#0b3d5c");
  miniViewer.scene.globe.maximumScreenSpaceError = 4;
  miniViewer.scene.fog.enabled = false;
  miniViewer.scene.skyAtmosphere.show = false;
  miniViewer.scene.sun.show = false;
  miniViewer.scene.moon.show = false;
  if (miniViewer.scene.skyBox) miniViewer.scene.skyBox.show = false;
  miniViewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#0b3d5c");
  // 关闭小窗口的旋转、缩放、平移功能
  const liveController = miniViewer.scene.screenSpaceCameraController;
  liveController.enableRotate = false;
  liveController.enableTranslate = false;
  liveController.enableZoom = false;
  liveController.enableTilt = false;
  liveController.enableLook = false;

  return miniViewer;
}


export { captureHighResImage, getMiniViewer };
