# cc-assets-compress

[English](README.md) | [简体中文](README.zh-CN.md) | [Tiếng Việt](README.vi.md)

`cc-assets-compress` is a Cocos Creator editor extension for browsing, inspecting, compressing, converting, and safely deleting media assets in a project.

## Requirements

- Cocos Creator `3.8.6` or newer
- Node.js `18` or newer for extension development
- npm

Release packages already include the required runtime dependencies: Sharp, pngquant, FFmpeg, JSZip, and Vue.

## Features

### Asset browser

- Collects PNG, JPG, WebP, MP3, WAV, and OGG assets from the current project.
- Displays 100 × 100 image thumbnails and an icon for audio files.
- Shows file path, original file size, Base64 size, and JSZip-compressed Base64 size.
- Searches by file name or asset path.
- Dynamically builds the asset-type filter from formats found in the project.
- Sorts by file size, Base64 size, and JSZip size.
- Supports pagination and configurable items per page. Filtering, searching, and sorting automatically reset pagination.

### Asset details

- Displays the asset name, type, UUID, asset URL, absolute path, and size metrics.
- Provides zoom, pan, and fit controls for images.
- Provides an audio player for audio assets.

### Compression

- PNG: pngquant by default, with Sharp as an alternative.
- JPG: Sharp.
- MP3: FFmpeg.
- Includes high-quality, balanced, small-file, and custom presets.
- Supports quality, speed, color count, dithering, compression level, bitrate, sample rate, and channel settings where applicable.
- Resizes images by percentage or dimensions while preserving the original aspect ratio.
- Compares file, Base64, and JSZip sizes before and after compression.
- Previews images and audio before applying the result.
- Creates a backup before overwriting and provides a Revert action.

### Conversion

- Images: PNG, JPG, and WebP.
- Audio: MP3, WAV, and OGG.
- Creates the converted asset next to the source asset.
- Uses Cocos AssetDB to generate a non-conflicting file name and import the result.

### Safe deletion

- Scans for scene and prefab references before deletion.
- Shows the node path inside the scene Hierarchy.
- Can open a referenced scene and select its node in the Hierarchy.
- Can select a referenced prefab in the Assets panel.
- Detects whether the asset is inside a bundle folder.
- Requires confirmation before permanently deleting the asset and its meta file.

### Localization

- English
- Simplified Chinese
- Vietnamese
- The language can be changed immediately from the extension toolbar and is saved between sessions.

## Install a release in Cocos Creator

1. Open the [GitHub Releases](https://github.com/huynhthuan/cc-assets-compress/releases/latest) page.
2. Download `cc-assets-compress-vX.Y.Z.zip`. Do not extract or re-compress the archive.
3. Open your project in Cocos Creator.
4. Select **Extension → Extension Manager** from the main menu.
5. Select the **Project** tab to install it only for the current project, or **Global** to make it available to all projects.
6. Click the **+** button and select the downloaded ZIP file.
7. Find `cc-assets-compress` in the extension list and click **Enable**.

If an older version is already installed, reload the extension or restart Cocos Creator after updating it.

## Open the extension

After installation and activation, select:

**Panel → cc-assets-compress → Media Asset Browser**

The panel is dockable and can be placed anywhere in the Cocos Creator layout.

## Development setup

### 1. Clone the repository

```bash
git clone https://github.com/huynhthuan/cc-assets-compress.git
cd cc-assets-compress
```

### 2. Install dependencies

```bash
npm install
```

The install step downloads the platform binaries used by Sharp, pngquant, and FFmpeg. Internet access is therefore required for a fresh installation.

### 3. Build the extension

```bash
npm run build
```

TypeScript sources in `source/` are compiled into `dist/`.

### 4. Add the development extension to a Cocos project

Use one of these methods:

- Copy or clone the repository to:

  ```text
  <project>/extensions/cc-assets-compress
  ```

- Or use **Extension → Extension Manager → Developer Import** and select the repository folder.

Enable the extension after it appears in Extension Manager.

### 5. Reload after making changes

Run the build again:

```bash
npm run build
```

Then use **Reload** for `cc-assets-compress` in Extension Manager, or disable and enable it again. An already-open panel may need to be closed and reopened.

## Project structure

```text
cc-assets-compress/
├─ source/                  TypeScript source code
├─ dist/                    Compiled JavaScript loaded by Cocos Creator
├─ static/                  Panel HTML and CSS
├─ i18n/                    English, Chinese, and Vietnamese translations
├─ scripts/                 Installation helpers
├─ package.json             Extension manifest and dependencies
└─ tsconfig.json            TypeScript configuration
```

## Packaging a local build

Cocos Creator release archives must contain these entries at the ZIP root:

```text
dist/
i18n/
node_modules/
package.json
static/
```

On Windows, avoid ZIP tools that store entry names with backslashes. The following command uses forward-slash paths:

```powershell
tar -a -c -f cc-assets-compress-v1.1.0.zip dist i18n node_modules package.json static
```

Verify the archive before distributing it:

```powershell
tar -tf cc-assets-compress-v1.1.0.zip
```

See the official [Cocos Creator extension installation and packaging guide](https://docs.cocos.com/creator/3.8/manual/en/editor/extension/install.html) for more information.

## Notes

- Compression overwrites the original asset only after explicit confirmation.
- Revert backups are stored in the Cocos Creator project temporary directory and are not intended for source control.
- Review all scene, prefab, and bundle references shown in the deletion modal before deleting an asset.
