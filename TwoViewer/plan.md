# TwoViewer

主视图用 `Cesium.Viewer`, 左上角 300 px 小窗用 `Cesium.CesiumWidget`. 小窗 `baseLayer: false`, 不加载 ion 默认影像, 再单独加 ArcGIS World Imagery. 下载按钮调用 `capture.js`, 把小窗画布按目标宽度放大后导出.

## 影像地址

ArcGIS MapServer 瓦片接口是 `/tile/{level}/{row}/{col}`. 在 Web Mercator 里 level 是 `{z}`, row 是从北向南的 `{y}`, col 是从西向东的 `{x}`. 模板必须写成 `{z}/{y}/{x}`. 写成 `{z}/{x}/{y}` 时, 0 级碰巧相同, 更细的级别会请求到另一行另一列, 小窗里的地面和主视图对不上.

`tilesLoaded` 只等当前视角、当前屏幕空间误差选出的地表瓦片. 它不按绘图缓冲区的像素宽度再升一级. 放大 `resolutionScale` 时, 画布像素和 `scene.pixelRatio` 同倍增加, 屏幕空间误差里这两项抵消, 层级不变. 要更细的瓦片, 需要降低 `maximumScreenSpaceError`.
