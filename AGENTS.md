# AGENTS.md

### 仓库概述

本仓库 是一个CesiumJS测试项目,用于测试各种Cesium功能。每个功能放在单独的文件夹内。

主页面index.html仅作为链接入口。每新增一个测试功能,在此页面中增加对应的链接。

如无特别说明，新建测试页面时，均以“CesiumTemplate.html"作为模板开始。

### 无构建/无依赖

- 没有 `package.json`、`requirements.txt`、`Makefile`、`Dockerfile` 或任何构建系统。

### 如何测试/验证

使用以下语句启动静态服务进行打开相应的页面进行测试

```
python -m http.server 8000
```

### 注意事项

- 使用英文符号:,()
- 在每个功能测试文件夹内,将分析过程写入到plan.md中
- 相关Cesium函数的功能可查询:[https://cesium.com/learn/cesiumjs/ref-doc/](https://cesium.com/learn/cesiumjs/ref-doc/)

