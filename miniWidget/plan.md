# TwoViewer

主视图用 `Cesium.Viewer`, 左上角 300 px 小窗用 `Cesium.CesiumWidget`. 两个场景共用一个 `Cesium.SharedContext`: 真正的 WebGL 画布只有一块, 各自的可见画布是 2d, 每帧画完再贴上去. 小窗 `baseLayer: false`, 不加载 ion 默认影像, 再单独加 ArcGIS World Imagery. 下载按钮调用 `capture.js`, 把小窗画布按目标宽度放大后导出.

## WebGL 警告

控制台里这一组警告是成套出现的:

- `framebufferTexture2D: object does not belong to this context`
- `drawElements: no valid shader program in use`
- `glClear: Framebuffer is incomplete: No attachments and default size is zero`
- `glDrawElements: Must have element array buffer bound`
- `bindTexture: object does not belong to this context`

根因不是画布尺寸为 0. 主窗口 300 px 小窗在单独打开时, 两个 context 各自渲染地球, 这些警告一次都没有. 把同一个 glTF (例如 `model/Cesium_Air.glb`) 分别 `entities.add` 到两个场景, 警告的条数和上面一致, 包括 Chrome 分组后的 35 / 28 / 15 / 20 / 6.

Cesium 1.140 的 `ResourceCache` 是页面级单例, 缓存键只有资源 URL, 没有 WebGL context. 模型的纹理, 顶点缓冲, 索引缓冲和着色器在第一个 context 里创建. 小窗再用同一个 URL 时, 缓存把这些 GPU 对象交回去. 小窗的 context 不能绑定它们: `framebufferTexture2D` / `bindTexture` 报对象不属于这个 context, 着色器和 element array buffer 绑定失败, 帧缓冲没有挂上附件, 随后的 `glClear` / `glDrawElements` 就报 framebuffer incomplete. 两个 Entity 各 new 一份也不够, 只要 URI 相同就会撞上这份缓存. 把同一个 Entity 实例 add 进两个 `entities` 集合同样会中.

影像层不是这条路径. 两个场景各建一个 `UrlTemplateImageryProvider`, 或者暂时共用主窗口那个 provider, 都不会产生上面的警告. 瓦片纹理是按 context 上传的.

修法是主窗口和小窗传入同一个 `SharedContext`. `Scene` 发现 `contextOptions` 是 `SharedContext` 实例后, 不再为这块画布调用 `getContext("webgl2")`, 模型、地球和 Entity 的 GPU 资源都落在同一个 context 上, 缓存命中是合法的. 小窗相机同步, 单独的 ArcGIS 影像, 以及按 `resolutionScale` 放大后 `canvas.toDataURL` 导出, 都还走原来的调用.

## 影像地址

ArcGIS MapServer 瓦片接口是 `/tile/{level}/{row}/{col}`. 在 Web Mercator 里 level 是 `{z}`, row 是从北向南的 `{y}`, col 是从西向东的 `{x}`. 模板必须写成 `{z}/{y}/{x}`. 写成 `{z}/{x}/{y}` 时, 0 级碰巧相同, 更细的级别会请求到另一行另一列, 小窗里的地面和主视图对不上.

`tilesLoaded` 只等当前视角、当前屏幕空间误差选出的地表瓦片. 它不按绘图缓冲区的像素宽度再升一级. 放大 `resolutionScale` 时, 画布像素和 `scene.pixelRatio` 同倍增加, 屏幕空间误差里这两项抵消, 层级不变. 要更细的瓦片, 需要降低 `maximumScreenSpaceError`.
