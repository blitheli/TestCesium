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

  export { captureHighResImage };
  