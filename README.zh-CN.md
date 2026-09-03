# cc-assets-compress

[English](README.md) | [简体中文](README.zh-CN.md) | [Tiếng Việt](README.vi.md)

`cc-assets-compress` 是一个 Cocos Creator 编辑器扩展，用于浏览、检查、压缩、转换并安全删除项目中的媒体资源。

## 环境要求

- Cocos Creator `3.8.6` 或更高版本
- 扩展开发建议使用 Node.js `18` 或更高版本
- npm

Release 压缩包已经包含运行时所需的 Sharp、pngquant、FFmpeg、JSZip 和 Vue，无需另外安装这些依赖。

## 功能

### 资源浏览器

- 收集当前项目中的 PNG、JPG、WebP、MP3、WAV 和 OGG 资源。
- 图片显示 100 × 100 缩略图，音频显示文件图标。
- 显示资源路径、原始文件大小、Base64 大小以及 JSZip 压缩后的 Base64 大小。
- 支持按文件名或资源路径搜索。
- 根据项目中实际存在的格式动态生成资源类型筛选器。
- 支持按文件大小、Base64 大小和 JSZip 大小排序。
- 支持分页和每页数量设置；筛选、搜索或排序后会自动重新计算分页。

### 资源详情

- 显示资源名称、类型、UUID、资源 URL、绝对路径和大小信息。
- 图片支持缩放、拖动和平铺适应。
- 音频资源提供播放器。

### 压缩

- PNG：默认使用 pngquant，也可选择 Sharp。
- JPG：使用 Sharp。
- MP3：使用 FFmpeg。
- 提供高质量、均衡、小文件和自定义预设。
- 根据格式提供质量、速度、颜色数量、抖动、压缩级别、比特率、采样率和声道设置。
- 可按百分比或指定尺寸调整图片大小，并保持原始宽高比。
- 比较压缩前后的文件、Base64 和 JSZip 大小。
- 应用之前可以预览图片和音频结果。
- 覆盖原文件前会创建备份，并提供还原操作。

### 格式转换

- 图片：PNG、JPG 和 WebP。
- 音频：MP3、WAV 和 OGG。
- 转换后的资源创建在源资源旁边。
- 通过 Cocos AssetDB 自动生成不冲突的文件名并导入转换结果。

### 安全删除

- 删除前扫描场景和预制体中的引用。
- 显示资源所在节点的 Hierarchy 路径。
- 可以打开引用资源的场景并在 Hierarchy 中选择对应节点。
- 可以在 Assets 面板中选择引用资源的预制体。
- 检测资源是否位于 Bundle 文件夹内。
- 永久删除资源及其 meta 文件前必须确认。

### 多语言

- 英语
- 简体中文
- 越南语
- 可在扩展工具栏中立即切换语言，并自动保存选择。

## 在 Cocos Creator 中安装 Release

1. 打开 [GitHub Releases](https://github.com/huynhthuan/cc-assets-compress/releases/latest) 页面。
2. 下载 `cc-assets-compress-vX.Y.Z.zip`，不要解压或重新压缩该文件。
3. 在 Cocos Creator 中打开项目。
4. 从主菜单选择 **扩展 → 扩展管理器**。
5. 选择 **项目** 标签可仅为当前项目安装，选择 **全局** 标签可供所有项目使用。
6. 点击 **+** 按钮并选择下载的 ZIP 文件。
7. 在扩展列表中找到 `cc-assets-compress`，然后点击 **启用**。

如果已经安装旧版本，更新后请重新加载扩展或重启 Cocos Creator。

## 打开扩展

安装并启用后，从主菜单选择：

**面板 → cc-assets-compress → 媒体资源浏览器**

该面板支持停靠，可以放置在 Cocos Creator 布局中的任意位置。

## 开发环境配置

### 1. 克隆仓库

```bash
git clone https://github.com/huynhthuan/cc-assets-compress.git
cd cc-assets-compress
```

### 2. 安装依赖

```bash
npm install
```

安装过程会下载 Sharp、pngquant 和 FFmpeg 使用的平台二进制文件，因此首次安装需要网络连接。

### 3. 构建扩展

```bash
npm run build
```

`source/` 中的 TypeScript 源码会被编译到 `dist/`。

### 4. 将开发版本添加到 Cocos 项目

可以使用以下任一方式：

- 将仓库复制或克隆到：

  ```text
  <项目目录>/extensions/cc-assets-compress
  ```

- 或使用 **扩展 → 扩展管理器 → 开发者导入**，然后选择仓库文件夹。

扩展出现在扩展管理器后，请将其启用。

### 5. 修改代码后重新加载

重新执行构建：

```bash
npm run build
```

然后在扩展管理器中点击 `cc-assets-compress` 的 **重新加载**，或先禁用再启用。已经打开的面板可能需要关闭后重新打开。

## 项目结构

```text
cc-assets-compress/
├─ source/                  TypeScript 源码
├─ dist/                    Cocos Creator 加载的编译后 JavaScript
├─ static/                  面板 HTML 和 CSS
├─ i18n/                    英语、中文和越南语翻译
├─ scripts/                 安装辅助脚本
├─ package.json             扩展清单和依赖配置
└─ tsconfig.json            TypeScript 配置
```

## 打包本地构建

Cocos Creator 扩展 ZIP 的根目录必须包含：

```text
dist/
i18n/
node_modules/
package.json
static/
```

在 Windows 上，应避免使用会在 ZIP 项目名称中写入反斜杠的工具。以下命令会生成使用正斜杠路径的压缩包：

```powershell
tar -a -c -f cc-assets-compress-v1.1.0.zip dist i18n node_modules package.json static
```

发布前可以检查压缩包：

```powershell
tar -tf cc-assets-compress-v1.1.0.zip
```

更多信息请参阅 Cocos Creator 官方的[扩展安装和打包文档](https://docs.cocos.com/creator/3.8/manual/zh/editor/extension/install.html)。

## 注意事项

- 只有在明确确认后，压缩功能才会覆盖原始资源。
- 还原备份存储在 Cocos Creator 项目临时目录中，不应提交到版本控制。
- 删除资源前，请检查删除窗口中显示的所有场景、预制体和 Bundle 引用。
