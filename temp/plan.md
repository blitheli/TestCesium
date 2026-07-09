# addPoint - 可编辑代码实时应用到 Viewer

## 目标

在空 Cesium 场景上增加代码编辑窗口:用户可修改代码,点击「应用代码」后立即在当前 `viewer` 中执行。默认代码添加红色地面点并 `trackedEntity` 跟踪该点。

## 决策

- 执行策略:追加执行(不清空已有 entities),多次点击会叠加
- 执行方式:`new Function('viewer', 'Cesium', code)`,将全局 `viewer` / `Cesium` 注入
- UI:左上角浮动面板(textarea + 按钮 + 错误提示),不引入外部编辑器

## 实现要点

1. 浮动面板覆盖在 `#cesiumContainer` 之上
2. 默认代码使用 `CLAMP_TO_GROUND` 红色点,经纬度约北京
3. try/catch 捕获语法/运行时错误并显示在面板
4. 仅修改 `temp/addPoint.html`

## 验证

```
python -m http.server 8000
```

打开 `http://localhost:8000/temp/addPoint.html`,确认默认代码可应用,修改后再应用会追加新点。
