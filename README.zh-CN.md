# 项目简介

一份包含面板的扩展，该面板基于 vue3.x 开发，展示了如何通过消息和菜单打开面板，以及与面板通讯。

## 开发环境

Node.js

## 安装

```bash
# 安装依赖模块
npm install
# 构建
npm run build
```

## 用法

启用扩展后，点击主菜单栏中的 `面板 -> cc-assets-compress -> Media Asset Browser`，即可打开扩展面板。

该扩展可浏览、预览、检查、压缩和恢复当前 Cocos Creator 项目中的 PNG、JPG 和 MP3 资源。

点击 `发送消息给面板` 后，根据 `package.json` 中 `contributions.menu` 的定义将发送一条消息 `send-to-panel` 给扩展。根据 `package.json` 中 `contributions.messages` 的定义当扩展收到 `send-to-panel` 后将会使 `default` 面板调用 `hello` 方法。
