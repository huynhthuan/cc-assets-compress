"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs_extra_1 = require("fs-extra");
const os_1 = require("os");
const path_1 = require("path");
const url_1 = require("url");
const vue_1 = require("vue");
const compression_1 = require("../../compression");
const panelDataMap = new WeakMap();
const supportedExtensions = new Set(['.png', '.jpg', '.mp3']);
function getBackupPath(uuid, extension) {
    return (0, path_1.join)(Editor.Project.tmpDir, 'cc-assets-compress-backups', `${uuid}${extension}`);
}
function formatFileSize(bytes) {
    if (bytes === 0) {
        return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB'];
    const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / Math.pow(1024, unitIndex);
    return `${value.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}
const ImageViewer = (0, vue_1.defineComponent)({
    props: {
        src: {
            type: String,
            required: true,
        },
        alt: {
            type: String,
            default: '',
        },
    },
    data() {
        return {
            scale: 1,
            translateX: 0,
            translateY: 0,
            dragging: false,
            pointerId: -1,
            dragStartX: 0,
            dragStartY: 0,
            translateStartX: 0,
            translateStartY: 0,
        };
    },
    computed: {
        imageTransform() {
            return `translate(${this.translateX}px, ${this.translateY}px) scale(${this.scale})`;
        },
        zoomLabel() {
            return `${Math.round(this.scale * 100)}%`;
        },
    },
    watch: {
        src() {
            this.resetView();
        },
    },
    methods: {
        clampScale(scale) {
            return Math.min(8, Math.max(0.25, scale));
        },
        setScale(scale) {
            this.scale = this.clampScale(scale);
            if (this.scale === 1) {
                this.translateX = 0;
                this.translateY = 0;
            }
        },
        zoomIn() {
            this.setScale(this.scale * 1.25);
        },
        zoomOut() {
            this.setScale(this.scale / 1.25);
        },
        onWheel(event) {
            this.setScale(this.scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15));
        },
        resetView() {
            this.scale = 1;
            this.translateX = 0;
            this.translateY = 0;
            this.dragging = false;
        },
        startDrag(event) {
            if (event.button !== 0) {
                return;
            }
            this.dragging = true;
            this.pointerId = event.pointerId;
            this.dragStartX = event.clientX;
            this.dragStartY = event.clientY;
            this.translateStartX = this.translateX;
            this.translateStartY = this.translateY;
            event.currentTarget.setPointerCapture(event.pointerId);
        },
        drag(event) {
            if (!this.dragging || event.pointerId !== this.pointerId) {
                return;
            }
            this.translateX = this.translateStartX + event.clientX - this.dragStartX;
            this.translateY = this.translateStartY + event.clientY - this.dragStartY;
        },
        endDrag(event) {
            if (event.pointerId !== this.pointerId) {
                return;
            }
            this.dragging = false;
            const target = event.currentTarget;
            if (target.hasPointerCapture(event.pointerId)) {
                target.releasePointerCapture(event.pointerId);
            }
        },
    },
    template: `
        <div class="image-viewer">
            <div
                class="image-viewport"
                :class="{ dragging }"
                @wheel.prevent.stop="onWheel"
                @pointerdown.prevent="startDrag"
                @pointermove.prevent="drag"
                @pointerup="endDrag"
                @pointercancel="endDrag"
                @dblclick="resetView"
            >
                <img
                    :src="src"
                    :alt="alt"
                    :style="{ transform: imageTransform }"
                    draggable="false"
                />
            </div>
            <div class="image-viewer-controls">
                <button type="button" title="Thu nhỏ" @click="zoomOut">−</button>
                <span>{{ zoomLabel }}</span>
                <button type="button" title="Phóng to" @click="zoomIn">+</button>
                <button type="button" title="Fit và đặt lại vị trí" @click="resetView">Fit</button>
            </div>
        </div>
    `,
});
async function createMediaAsset(asset) {
    const extension = (0, path_1.extname)(asset.file).toLowerCase();
    if (asset.isDirectory || !supportedExtensions.has(extension)) {
        return null;
    }
    try {
        const name = (0, path_1.basename)(asset.file);
        const backupPath = getBackupPath(asset.uuid, extension);
        const [metrics, canRevert] = await Promise.all([
            (0, compression_1.calculateFileMetrics)(asset.file, name),
            (0, fs_extra_1.pathExists)(backupPath),
        ]);
        return {
            uuid: asset.uuid,
            name,
            path: asset.url || asset.source,
            filePath: asset.file,
            previewUrl: (0, url_1.pathToFileURL)(asset.file).href,
            extension,
            size: metrics.fileSize,
            base64Size: metrics.base64Size,
            zipSize: metrics.zipSize,
            backupPath,
            canRevert,
        };
    }
    catch (error) {
        console.warn(`[cc-assets-compress] Cannot read file: ${asset.file}`, error);
        return null;
    }
}
async function mapWithConcurrency(items, concurrency, mapper) {
    const results = new Array(items.length);
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (nextIndex < items.length) {
            const index = nextIndex;
            nextIndex += 1;
            results[index] = await mapper(items[index]);
        }
    });
    await Promise.all(workers);
    return results;
}
module.exports = Editor.Panel.define({
    listeners: {},
    template: (0, fs_extra_1.readFileSync)((0, path_1.join)(__dirname, '../../../static/template/default/index.html'), 'utf-8'),
    style: (0, fs_extra_1.readFileSync)((0, path_1.join)(__dirname, '../../../static/style/default/index.css'), 'utf-8'),
    $: {
        app: '#app',
    },
    methods: {},
    ready() {
        if (!this.$.app) {
            return;
        }
        const app = (0, vue_1.createApp)((0, vue_1.defineComponent)({
            data() {
                return {
                    assets: [],
                    loading: false,
                    errorMessage: '',
                    searchQuery: '',
                    extensionFilter: '',
                    sortColumn: '',
                    sortDirection: '',
                    currentPage: 1,
                    pageSize: 10,
                    selectedAsset: null,
                    detailLoading: false,
                    base64Size: null,
                    compressedSize: null,
                    detailError: '',
                    detailRequestId: 0,
                    compressionAsset: null,
                    imageCompressor: 'pngquant',
                    compressionPreset: 'balanced',
                    compressionSettings: {
                        qualityMin: 55,
                        qualityMax: 80,
                        speed: 6,
                        colors: 192,
                        dithering: 0.7,
                        audioBitrate: 128,
                        sampleRate: 44100,
                        channels: 2,
                        sharpQuality: 80,
                        sharpCompressionLevel: 9,
                        sharpProgressive: true,
                        sharpPalette: true,
                        sharpMozjpeg: true,
                        sharpChromaSubsampling: '4:2:0',
                        resizeWidth: null,
                        resizeHeight: null,
                    },
                    imageDimensions: null,
                    resizeMode: 'percent',
                    resizePercent: 100,
                    resizeWidth: 0,
                    resizeHeight: 0,
                    compressionLoading: false,
                    compressionApplying: false,
                    compressionError: '',
                    originalMetrics: null,
                    outputMetrics: null,
                    compressedPreviewUrl: '',
                    compressedFilePath: '',
                    compressionTempDirectory: '',
                    compressionRequestId: 0,
                };
            },
            computed: {
                visibleAssets() {
                    const query = this.searchQuery.trim().toLocaleLowerCase();
                    const filteredAssets = this.assets.filter((asset) => {
                        const matchesExtension = !this.extensionFilter
                            || asset.extension === this.extensionFilter;
                        const matchesQuery = !query
                            || asset.name.toLocaleLowerCase().includes(query)
                            || asset.path.toLocaleLowerCase().includes(query);
                        return matchesExtension && matchesQuery;
                    });
                    if (!this.sortColumn || !this.sortDirection) {
                        return filteredAssets;
                    }
                    const direction = this.sortDirection === 'asc' ? 1 : -1;
                    const sortColumn = this.sortColumn;
                    return [...filteredAssets].sort((left, right) => {
                        const sizeDifference = (left[sortColumn] - right[sortColumn]) * direction;
                        return sizeDifference || left.path.localeCompare(right.path);
                    });
                },
                totalPages() {
                    return Math.max(1, Math.ceil(this.visibleAssets.length / this.pageSize));
                },
                paginatedAssets() {
                    const startIndex = (this.currentPage - 1) * this.pageSize;
                    return this.visibleAssets.slice(startIndex, startIndex + this.pageSize);
                },
                pageNumbers() {
                    const firstPage = Math.max(1, Math.min(this.currentPage - 2, this.totalPages - 4));
                    const lastPage = Math.min(this.totalPages, firstPage + 4);
                    const pages = [];
                    for (let page = firstPage; page <= lastPage; page += 1) {
                        pages.push(page);
                    }
                    return pages;
                },
                pageRangeText() {
                    if (this.visibleAssets.length === 0) {
                        return '0 tệp';
                    }
                    const firstItem = (this.currentPage - 1) * this.pageSize + 1;
                    const lastItem = Math.min(this.currentPage * this.pageSize, this.visibleAssets.length);
                    return `${firstItem}-${lastItem} / ${this.visibleAssets.length} tệp`;
                },
                statusText() {
                    if (this.loading) {
                        return 'Đang tải tài nguyên...';
                    }
                    if (this.visibleAssets.length !== this.assets.length) {
                        return `${this.visibleAssets.length}/${this.assets.length} tệp`;
                    }
                    return `${this.assets.length} tệp`;
                },
            },
            watch: {
                searchQuery() {
                    this.currentPage = 1;
                },
                extensionFilter() {
                    this.currentPage = 1;
                },
                sortColumn() {
                    this.currentPage = 1;
                },
                sortDirection() {
                    this.currentPage = 1;
                },
                pageSize() {
                    this.currentPage = 1;
                },
                assets() {
                    this.currentPage = 1;
                },
            },
            methods: {
                formatFileSize,
                isImage(asset) {
                    return asset.extension === '.png' || asset.extension === '.jpg';
                },
                toggleSort(column) {
                    if (this.sortColumn !== column) {
                        this.sortColumn = column;
                        this.sortDirection = 'asc';
                    }
                    else if (this.sortDirection === 'asc') {
                        this.sortDirection = 'desc';
                    }
                    else {
                        this.sortColumn = '';
                        this.sortDirection = '';
                    }
                },
                sortIndicator(column) {
                    if (this.sortColumn !== column) {
                        return '⇅';
                    }
                    return this.sortDirection === 'asc' ? '▲' : '▼';
                },
                goToPage(page) {
                    this.currentPage = Math.min(Math.max(page, 1), this.totalPages);
                },
                compressionResult() {
                    if (!this.selectedAsset || this.compressedSize === null) {
                        return '';
                    }
                    if (this.selectedAsset.size === 0) {
                        return 'Không thể đánh giá';
                    }
                    const difference = (1 - this.compressedSize / this.selectedAsset.size) * 100;
                    if (difference > 0) {
                        return `Giảm ${difference.toFixed(2)}%`;
                    }
                    return `Tăng ${Math.abs(difference).toFixed(2)}%`;
                },
                metricDifference(before, after) {
                    if (before === 0) {
                        return '0%';
                    }
                    const difference = (1 - after / before) * 100;
                    return difference >= 0
                        ? `Giảm ${difference.toFixed(2)}%`
                        : `Tăng ${Math.abs(difference).toFixed(2)}%`;
                },
                async openAssetDetails(asset) {
                    this.selectedAsset = asset;
                    this.base64Size = null;
                    this.compressedSize = null;
                    this.detailError = '';
                    this.detailLoading = true;
                    const requestId = ++this.detailRequestId;
                    try {
                        const metrics = await (0, compression_1.calculateFileMetrics)(asset.filePath, asset.name);
                        if (requestId !== this.detailRequestId) {
                            return;
                        }
                        this.base64Size = metrics.base64Size;
                        this.compressedSize = metrics.zipSize;
                    }
                    catch (error) {
                        if (requestId !== this.detailRequestId) {
                            return;
                        }
                        this.detailError = error instanceof Error
                            ? error.message
                            : 'Không thể phân tích tệp.';
                        console.error(`[cc-assets-compress] Cannot inspect ${asset.filePath}`, error);
                    }
                    finally {
                        if (requestId === this.detailRequestId) {
                            this.detailLoading = false;
                        }
                    }
                },
                closeAssetDetails() {
                    this.detailRequestId += 1;
                    this.selectedAsset = null;
                    this.detailLoading = false;
                    this.detailError = '';
                },
                isCompressionSupported(asset) {
                    return asset.extension === '.png'
                        || asset.extension === '.jpg'
                        || asset.extension === '.mp3';
                },
                applyCompressionPreset(preset) {
                    var _a, _b;
                    this.compressionPreset = preset;
                    const isAudio = ((_a = this.compressionAsset) === null || _a === void 0 ? void 0 : _a.extension) === '.mp3';
                    if (isAudio) {
                        const presets = {
                            high: { audioBitrate: 192, sampleRate: 48000, channels: 2 },
                            balanced: { audioBitrate: 128, sampleRate: 44100, channels: 2 },
                            small: { audioBitrate: 64, sampleRate: 22050, channels: 1 },
                        };
                        Object.assign(this.compressionSettings, presets[preset] || {});
                    }
                    else if (this.imageCompressor === 'sharp') {
                        const isJpeg = ((_b = this.compressionAsset) === null || _b === void 0 ? void 0 : _b.extension) === '.jpg';
                        const presets = isJpeg
                            ? {
                                high: {
                                    sharpQuality: 92,
                                    sharpProgressive: true,
                                    sharpMozjpeg: true,
                                    sharpChromaSubsampling: '4:4:4',
                                },
                                balanced: {
                                    sharpQuality: 80,
                                    sharpProgressive: true,
                                    sharpMozjpeg: true,
                                    sharpChromaSubsampling: '4:2:0',
                                },
                                small: {
                                    sharpQuality: 60,
                                    sharpProgressive: true,
                                    sharpMozjpeg: true,
                                    sharpChromaSubsampling: '4:2:0',
                                },
                            }
                            : {
                                high: {
                                    sharpQuality: 95,
                                    sharpCompressionLevel: 6,
                                    sharpProgressive: true,
                                    sharpPalette: false,
                                },
                                balanced: {
                                    sharpQuality: 80,
                                    sharpCompressionLevel: 9,
                                    sharpProgressive: true,
                                    sharpPalette: true,
                                    colors: 192,
                                    dithering: 0.7,
                                },
                                small: {
                                    sharpQuality: 60,
                                    sharpCompressionLevel: 9,
                                    sharpProgressive: true,
                                    sharpPalette: true,
                                    colors: 128,
                                    dithering: 0.5,
                                },
                            };
                        Object.assign(this.compressionSettings, presets[preset] || {});
                    }
                    else {
                        const presets = {
                            high: { qualityMin: 75, qualityMax: 95, speed: 3, colors: 256, dithering: 0.8 },
                            balanced: { qualityMin: 55, qualityMax: 80, speed: 6, colors: 192, dithering: 0.7 },
                            small: { qualityMin: 30, qualityMax: 60, speed: 9, colors: 128, dithering: 0.5 },
                        };
                        Object.assign(this.compressionSettings, presets[preset] || {});
                    }
                    this.invalidateCompressionPreview();
                },
                changeImageCompressor() {
                    var _a;
                    if (((_a = this.compressionAsset) === null || _a === void 0 ? void 0 : _a.extension) === '.jpg') {
                        this.imageCompressor = 'sharp';
                    }
                    this.applyCompressionPreset('balanced');
                },
                resetResizeOptions(dimensions) {
                    this.resizeMode = 'percent';
                    this.resizePercent = 100;
                    this.resizeWidth = dimensions.width;
                    this.resizeHeight = dimensions.height;
                    this.compressionSettings.resizeWidth = null;
                    this.compressionSettings.resizeHeight = null;
                    this.invalidateCompressionPreview();
                },
                changeResizeMode() {
                    if (this.resizeMode === 'percent') {
                        this.updateResizeFromPercent();
                    }
                    else {
                        this.updateResizeFromWidth();
                    }
                },
                updateResizeFromPercent() {
                    if (!this.imageDimensions) {
                        return;
                    }
                    const percent = Number(this.resizePercent);
                    if (!Number.isFinite(percent) || percent <= 0) {
                        return;
                    }
                    this.resizeWidth = Math.max(1, Math.round(this.imageDimensions.width * percent / 100));
                    this.resizeHeight = Math.max(1, Math.round(this.imageDimensions.height * percent / 100));
                    this.updateResizeSettings();
                },
                updateResizeFromWidth() {
                    if (!this.imageDimensions || this.resizeWidth <= 0) {
                        return;
                    }
                    this.resizeHeight = Math.max(1, Math.round(this.resizeWidth * this.imageDimensions.height / this.imageDimensions.width));
                    this.resizePercent = Number((this.resizeWidth / this.imageDimensions.width * 100).toFixed(2));
                    this.updateResizeSettings();
                },
                updateResizeFromHeight() {
                    if (!this.imageDimensions || this.resizeHeight <= 0) {
                        return;
                    }
                    this.resizeWidth = Math.max(1, Math.round(this.resizeHeight * this.imageDimensions.width / this.imageDimensions.height));
                    this.resizePercent = Number((this.resizeHeight / this.imageDimensions.height * 100).toFixed(2));
                    this.updateResizeSettings();
                },
                updateResizeSettings() {
                    if (!this.imageDimensions) {
                        return;
                    }
                    const unchanged = this.resizeWidth === this.imageDimensions.width
                        && this.resizeHeight === this.imageDimensions.height;
                    this.compressionSettings.resizeWidth = unchanged ? null : this.resizeWidth;
                    this.compressionSettings.resizeHeight = unchanged ? null : this.resizeHeight;
                    this.useCustomCompressionSettings();
                },
                useCustomCompressionSettings() {
                    this.compressionPreset = 'custom';
                    this.invalidateCompressionPreview();
                },
                invalidateCompressionPreview() {
                    this.outputMetrics = null;
                    this.compressedPreviewUrl = '';
                    this.compressedFilePath = '';
                    this.compressionError = '';
                },
                validateCompressionSettings() {
                    var _a, _b, _c, _d;
                    const settings = this.compressionSettings;
                    if (this.compressionAsset && this.isImage(this.compressionAsset)) {
                        if (this.resizeWidth < 1 || this.resizeHeight < 1
                            || this.resizeWidth > 16384 || this.resizeHeight > 16384) {
                            return 'Kích thước resize phải nằm trong 1-16384 px.';
                        }
                    }
                    if (((_a = this.compressionAsset) === null || _a === void 0 ? void 0 : _a.extension) === '.png' && this.imageCompressor === 'pngquant') {
                        if (settings.qualityMin < 0 || settings.qualityMax > 100
                            || settings.qualityMin > settings.qualityMax) {
                            return 'Quality phải nằm trong 0-100 và Min không được lớn hơn Max.';
                        }
                        if (settings.speed < 1 || settings.speed > 11) {
                            return 'Speed của pngquant phải nằm trong 1-11.';
                        }
                        if (!Number.isInteger(settings.colors)
                            || settings.colors < 2 || settings.colors > 256) {
                            return 'Số màu phải nằm trong 2-256.';
                        }
                        if (settings.dithering < 0 || settings.dithering > 1) {
                            return 'Dithering phải nằm trong 0-1.';
                        }
                    }
                    else if ((((_b = this.compressionAsset) === null || _b === void 0 ? void 0 : _b.extension) === '.png'
                        || ((_c = this.compressionAsset) === null || _c === void 0 ? void 0 : _c.extension) === '.jpg')
                        && this.imageCompressor === 'sharp') {
                        if (settings.sharpQuality < 1 || settings.sharpQuality > 100) {
                            return 'Quality của Sharp phải nằm trong 1-100.';
                        }
                        if (settings.sharpCompressionLevel < 0 || settings.sharpCompressionLevel > 9) {
                            return 'Compression level của Sharp phải nằm trong 0-9.';
                        }
                        if (this.compressionAsset.extension === '.png' && settings.sharpPalette) {
                            if (!Number.isInteger(settings.colors)
                                || settings.colors < 2 || settings.colors > 256) {
                                return 'Số màu phải nằm trong 2-256.';
                            }
                            if (settings.dithering < 0 || settings.dithering > 1) {
                                return 'Dithering phải nằm trong 0-1.';
                            }
                        }
                    }
                    else if (((_d = this.compressionAsset) === null || _d === void 0 ? void 0 : _d.extension) === '.mp3') {
                        if (settings.audioBitrate < 8 || settings.audioBitrate > 320) {
                            return 'Bitrate phải nằm trong 8-320 kbps.';
                        }
                        if (settings.sampleRate < 8000 || settings.sampleRate > 48000) {
                            return 'Sample rate phải nằm trong 8000-48000 Hz.';
                        }
                        if (settings.channels !== 1 && settings.channels !== 2) {
                            return 'Số channel chỉ có thể là 1 hoặc 2.';
                        }
                    }
                    return '';
                },
                async openCompression(asset) {
                    this.compressionAsset = asset;
                    this.compressionError = '';
                    this.originalMetrics = null;
                    this.outputMetrics = null;
                    this.compressedPreviewUrl = '';
                    this.compressedFilePath = '';
                    this.imageDimensions = null;
                    this.imageCompressor = asset.extension === '.jpg' ? 'sharp' : 'pngquant';
                    this.applyCompressionPreset('balanced');
                    const requestId = ++this.compressionRequestId;
                    try {
                        const [metrics, dimensions] = await Promise.all([
                            (0, compression_1.calculateFileMetrics)(asset.filePath, asset.name),
                            this.isImage(asset)
                                ? (0, compression_1.getImageDimensions)(asset.filePath)
                                : Promise.resolve(null),
                        ]);
                        if (requestId === this.compressionRequestId) {
                            this.originalMetrics = metrics;
                            this.imageDimensions = dimensions;
                            if (dimensions) {
                                this.resetResizeOptions(dimensions);
                            }
                        }
                    }
                    catch (error) {
                        if (requestId === this.compressionRequestId) {
                            this.compressionError = error instanceof Error
                                ? error.message
                                : 'Không thể đọc thông tin file gốc.';
                        }
                    }
                },
                async createCompressionPreview() {
                    const asset = this.compressionAsset;
                    if (!asset || !this.isCompressionSupported(asset)) {
                        return;
                    }
                    const validationError = this.validateCompressionSettings();
                    if (validationError) {
                        this.compressionError = validationError;
                        return;
                    }
                    this.compressionLoading = true;
                    this.compressionError = '';
                    this.invalidateCompressionPreview();
                    const requestId = ++this.compressionRequestId;
                    try {
                        if (this.compressionTempDirectory) {
                            await (0, fs_extra_1.remove)(this.compressionTempDirectory);
                        }
                        const tempDirectory = await (0, fs_extra_1.mkdtemp)((0, path_1.join)((0, os_1.tmpdir)(), 'cc-assets-compress-'));
                        this.compressionTempDirectory = tempDirectory;
                        const outputPath = await (0, compression_1.compressFile)(asset.filePath, asset.extension, tempDirectory, this.imageCompressor, Object.assign({}, this.compressionSettings));
                        const metrics = await (0, compression_1.calculateFileMetrics)(outputPath, asset.name);
                        if (requestId !== this.compressionRequestId) {
                            await (0, fs_extra_1.remove)(tempDirectory);
                            return;
                        }
                        this.compressedFilePath = outputPath;
                        this.compressedPreviewUrl = `${(0, url_1.pathToFileURL)(outputPath).href}?v=${Date.now()}`;
                        this.outputMetrics = metrics;
                    }
                    catch (error) {
                        if (requestId === this.compressionRequestId) {
                            this.compressionError = error instanceof Error
                                ? error.message
                                : 'Không thể tạo bản nén.';
                        }
                    }
                    finally {
                        if (requestId === this.compressionRequestId) {
                            this.compressionLoading = false;
                        }
                    }
                },
                async applyCompressedAsset() {
                    const asset = this.compressionAsset;
                    if (!asset || !this.compressedFilePath || !this.outputMetrics) {
                        return;
                    }
                    if (!window.confirm(`Ghi đè file gốc ${asset.name} bằng bản đã nén?`)) {
                        return;
                    }
                    this.compressionApplying = true;
                    this.compressionError = '';
                    try {
                        await (0, compression_1.createOriginalBackup)(asset.filePath, asset.backupPath);
                        await (0, compression_1.replaceOriginalFile)(this.compressedFilePath, asset.filePath);
                        await Editor.Message.request('asset-db', 'reimport-asset', asset.uuid);
                        await this.loadAssets();
                        await this.closeCompression();
                    }
                    catch (error) {
                        this.compressionError = error instanceof Error
                            ? error.message
                            : 'Không thể áp dụng file đã nén.';
                    }
                    finally {
                        this.compressionApplying = false;
                    }
                },
                async revertAsset(asset) {
                    if (!asset.canRevert) {
                        return;
                    }
                    if (!window.confirm(`Khôi phục file gốc trước khi compress cho ${asset.name}?`)) {
                        return;
                    }
                    this.loading = true;
                    this.errorMessage = '';
                    try {
                        await (0, compression_1.restoreOriginalBackup)(asset.backupPath, asset.filePath);
                        await Editor.Message.request('asset-db', 'reimport-asset', asset.uuid);
                        await this.loadAssets();
                    }
                    catch (error) {
                        this.errorMessage = error instanceof Error
                            ? error.message
                            : 'Không thể khôi phục file gốc.';
                        this.loading = false;
                    }
                },
                async closeCompression() {
                    this.compressionRequestId += 1;
                    const tempDirectory = this.compressionTempDirectory;
                    this.compressionAsset = null;
                    this.compressionLoading = false;
                    this.compressionError = '';
                    this.compressedPreviewUrl = '';
                    this.compressedFilePath = '';
                    this.outputMetrics = null;
                    this.imageDimensions = null;
                    this.compressionTempDirectory = '';
                    if (tempDirectory) {
                        try {
                            await (0, fs_extra_1.remove)(tempDirectory);
                        }
                        catch (error) {
                            console.warn(`[cc-assets-compress] Cannot remove temp directory: ${tempDirectory}`, error);
                        }
                    }
                },
                async loadAssets() {
                    this.loading = true;
                    this.errorMessage = '';
                    try {
                        const assetDbItems = await Editor.Message.request('asset-db', 'query-assets', { extname: Array.from(supportedExtensions) }, ['uuid', 'file', 'url', 'source', 'isDirectory']);
                        const projectItems = assetDbItems.filter((asset) => {
                            const url = asset.url || asset.source || '';
                            return url.startsWith('db://assets/');
                        });
                        // Limit simultaneous Base64/JSZip work to avoid a memory spike on large projects.
                        const results = await mapWithConcurrency(projectItems, 4, createMediaAsset);
                        this.assets = results
                            .filter((asset) => asset !== null)
                            .sort((left, right) => left.path.localeCompare(right.path));
                    }
                    catch (error) {
                        this.errorMessage = error instanceof Error
                            ? error.message
                            : 'Không thể tải danh sách tài nguyên.';
                        console.error('[cc-assets-compress] Failed to load assets', error);
                    }
                    finally {
                        this.loading = false;
                    }
                },
            },
            mounted() {
                void this.loadAssets();
            },
        }));
        app.config.compilerOptions.isCustomElement = (tag) => tag.startsWith('ui-');
        app.component('ImageViewer', ImageViewer);
        const viewModel = app.mount(this.$.app);
        panelDataMap.set(this, {
            app,
            cleanup: () => {
                void viewModel.closeCompression();
            },
        });
    },
    beforeClose() { },
    close() {
        const panelData = panelDataMap.get(this);
        if (panelData) {
            panelData.cleanup();
            panelData.app.unmount();
            panelDataMap.delete(this);
        }
    },
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zb3VyY2UvcGFuZWxzL2RlZmF1bHQvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSx1Q0FBcUU7QUFDckUsMkJBQTRCO0FBQzVCLCtCQUErQztBQUMvQyw2QkFBb0M7QUFDcEMsNkJBQXNEO0FBQ3RELG1EQVcyQjtBQStCM0IsTUFBTSxZQUFZLEdBQUcsSUFBSSxPQUFPLEVBQXFCLENBQUM7QUFDdEQsTUFBTSxtQkFBbUIsR0FBRyxJQUFJLEdBQUcsQ0FBQyxDQUFDLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxDQUFDLENBQUMsQ0FBQztBQUU5RCxTQUFTLGFBQWEsQ0FBQyxJQUFZLEVBQUUsU0FBaUI7SUFDbEQsT0FBTyxJQUFBLFdBQUksRUFBQyxNQUFNLENBQUMsT0FBTyxDQUFDLE1BQU0sRUFBRSw0QkFBNEIsRUFBRSxHQUFHLElBQUksR0FBRyxTQUFTLEVBQUUsQ0FBQyxDQUFDO0FBQzVGLENBQUM7QUFFRCxTQUFTLGNBQWMsQ0FBQyxLQUFhO0lBQ2pDLElBQUksS0FBSyxLQUFLLENBQUMsRUFBRSxDQUFDO1FBQ2QsT0FBTyxLQUFLLENBQUM7SUFDakIsQ0FBQztJQUVELE1BQU0sS0FBSyxHQUFHLENBQUMsR0FBRyxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSSxDQUFDLENBQUM7SUFDdEMsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQyxFQUFFLEtBQUssQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUM7SUFDM0YsTUFBTSxLQUFLLEdBQUcsS0FBSyxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLFNBQVMsQ0FBQyxDQUFDO0lBQ2hELE9BQU8s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LENBQUMsVUFBVSxFQUFFLENBQUM7WUFDM0IsQ0FBQztTQUNKLENBQUMsQ0FBQyxDQUFDO1FBRUosR0FBRyxDQUFDLE1BQU0sQ0FBQyxlQUFlLENBQUMsZUFBZSxHQUFHLENBQUMsR0FBRyxFQUFFLEVBQUUsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLEtBQUssQ0FBQyxDQUFDO1FBQzVFLEdBQUcsQ0FBQyxTQUFTLENBQUMsYUFBYSxFQUFFLFdBQVcsQ0FBQyxDQUFDO1FBQzFDLE1BQU0sU0FBUyxHQUFHLEdBQUcsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBRXJDLENBQUM7UUFDRixZQUFZLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRTtZQUNuQixHQUFHO1lBQ0gsT0FBTyxFQUFFLEdBQUcsRUFBRTtnQkFDVixLQUFLLFNBQVMsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDO1lBQ3RDLENBQUM7U0FDSixDQUFDLENBQUM7SUFDUCxDQUFDO0lBQ0QsV0FBVyxLQUFJLENBQUM7SUFDaEIsS0FBSztRQUNELE1BQU0sU0FBUyxHQUFHLFlBQVksQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDekMsSUFBSSxTQUFTLEVBQUUsQ0FBQztZQUNaLFNBQVMsQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUNwQixTQUFTLENBQUMsR0FBRyxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBQ3hCLFlBQVksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDOUIsQ0FBQztJQUNMLENBQUM7Q0FDSixDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBta2R0ZW1wLCBwYXRoRXhpc3RzLCByZWFkRmlsZVN5bmMsIHJlbW92ZSB9IGZyb20gJ2ZzLWV4dHJhJztcbmltcG9ydCB7IHRtcGRpciB9IGZyb20gJ29zJztcbmltcG9ydCB7IGJhc2VuYW1lLCBleHRuYW1lLCBqb2luIH0gZnJvbSAncGF0aCc7XG5pbXBvcnQgeyBwYXRoVG9GaWxlVVJMIH0gZnJvbSAndXJsJztcbmltcG9ydCB7IEFwcCwgY3JlYXRlQXBwLCBkZWZpbmVDb21wb25lbnQgfSBmcm9tICd2dWUnO1xuaW1wb3J0IHtcbiAgICBjYWxjdWxhdGVGaWxlTWV0cmljcyxcbiAgICBjb21wcmVzc0ZpbGUsXG4gICAgQ29tcHJlc3Npb25TZXR0aW5ncyxcbiAgICBjcmVhdGVPcmlnaW5hbEJhY2t1cCxcbiAgICBGaWxlTWV0cmljcyxcbiAgICBnZXRJbWFnZURpbWVuc2lvbnMsXG4gICAgSW1hZ2VEaW1lbnNpb25zLFxuICAgIEltYWdlQ29tcHJlc3NvcixcbiAgICByZXBsYWNlT3JpZ2luYWxGaWxlLFxuICAgIHJlc3RvcmVPcmlnaW5hbEJhY2t1cCxcbn0gZnJvbSAnLi4vLi4vY29tcHJlc3Npb24nO1xuXG50eXBlIFNvcnRDb2x1bW4gPSAnJyB8ICdzaXplJyB8ICdiYXNlNjRTaXplJyB8ICd6aXBTaXplJztcblxuaW50ZXJmYWNlIE1lZGlhQXNzZXQge1xuICAgIHV1aWQ6IHN0cmluZztcbiAgICBuYW1lOiBzdHJpbmc7XG4gICAgcGF0aDogc3RyaW5nO1xuICAgIGZpbGVQYXRoOiBzdHJpbmc7XG4gICAgcHJldmlld1VybDogc3RyaW5nO1xuICAgIGV4dGVuc2lvbjogc3RyaW5nO1xuICAgIHNpemU6IG51bWJlcjtcbiAgICBiYXNlNjRTaXplOiBudW1iZXI7XG4gICAgemlwU2l6ZTogbnVtYmVyO1xuICAgIGJhY2t1cFBhdGg6IHN0cmluZztcbiAgICBjYW5SZXZlcnQ6IGJvb2xlYW47XG59XG5cbmludGVyZmFjZSBBc3NldERiSW5mbyB7XG4gICAgdXVpZDogc3RyaW5nO1xuICAgIGZpbGU6IHN0cmluZztcbiAgICB1cmw6IHN0cmluZztcbiAgICBzb3VyY2U6IHN0cmluZztcbiAgICBpc0RpcmVjdG9yeTogYm9vbGVhbjtcbn1cblxuaW50ZXJmYWNlIFBhbmVsRGF0YSB7XG4gICAgYXBwOiBBcHA7XG4gICAgY2xlYW51cDogKCkgPT4gdm9pZDtcbn1cblxuY29uc3QgcGFuZWxEYXRhTWFwID0gbmV3IFdlYWtNYXA8b2JqZWN0LCBQYW5lbERhdGE+KCk7XG5jb25zdCBzdXBwb3J0ZWRFeHRlbnNpb25zID0gbmV3IFNldChbJy5wbmcnLCAnLmpwZycsICcubXAzJ10pO1xuXG5mdW5jdGlvbiBnZXRCYWNrdXBQYXRoKHV1aWQ6IHN0cmluZywgZXh0ZW5zaW9uOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIHJldHVybiBqb2luKEVkaXRvci5Qcm9qZWN0LnRtcERpciwgJ2NjLWFzc2V0cy1jb21wcmVzcy1iYWNrdXBzJywgYCR7dXVpZH0ke2V4dGVuc2lvbn1gKTtcbn1cblxuZnVuY3Rpb24gZm9ybWF0RmlsZVNpemUoYnl0ZXM6IG51bWJlcik6IHN0cmluZyB7XG4gICAgaWYgKGJ5dGVzID09PSAwKSB7XG4gICAgICAgIHJldHVybiAnMCBCJztcbiAgICB9XG5cbiAgICBjb25zdCB1bml0cyA9IFsnQicsICdLQicsICdNQicsICdHQiddO1xuICAgIGNvbnN0IHVuaXRJbmRleCA9IE1hdGgubWluKE1hdGguZmxvb3IoTWF0aC5sb2coYnl0ZXMpIC8gTWF0aC5sb2coMTAyNCkpLCB1bml0cy5sZW5ndGggLSAxKTtcbiAgICBjb25zdCB2YWx1ZSA9IGJ5dGVzIC8gTWF0aC5wb3coMTAyNCwgdW5pdEluZGV4KTtcbiAgICByZXR1cm4gYCR7dmFsdWUudG9GaXhlZCh1bml0SW5kZXggPT09IDAgPyAwIDogMil9ICR7dW5pdHNbdW5pdEluZGV4XX1gO1xufVxuXG5jb25zdCBJbWFnZVZpZXdlciA9IGRlZmluZUNvbXBvbmVudCh7XG4gICAgcHJvcHM6IHtcbiAgICAgICAgc3JjOiB7XG4gICAgICAgICAgICB0eXBlOiBTdHJpbmcsXG4gICAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgfSxcbiAgICAgICAgYWx0OiB7XG4gICAgICAgICAgICB0eXBlOiBTdHJpbmcsXG4gICAgICAgICAgICBkZWZhdWx0OiAnJyxcbiAgICAgICAgfSxcbiAgICB9LFxuICAgIGRhdGEoKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBzY2FsZTogMSxcbiAgICAgICAgICAgIHRyYW5zbGF0ZVg6IDAsXG4gICAgICAgICAgICB0cmFuc2xhdGVZOiAwLFxuICAgICAgICAgICAgZHJhZ2dpbmc6IGZhbHNlLFxuICAgICAgICAgICAgcG9pbnRlcklkOiAtMSxcbiAgICAgICAgICAgIGRyYWdTdGFydFg6IDAsXG4gICAgICAgICAgICBkcmFnU3RhcnRZOiAwLFxuICAgICAgICAgICAgdHJhbnNsYXRlU3RhcnRYOiAwLFxuICAgICAgICAgICAgdHJhbnNsYXRlU3RhcnRZOiAwLFxuICAgICAgICB9O1xuICAgIH0sXG4gICAgY29tcHV0ZWQ6IHtcbiAgICAgICAgaW1hZ2VUcmFuc2Zvcm0oKTogc3RyaW5nIHtcbiAgICAgICAgICAgIHJldHVybiBgdHJhbnNsYXRlKCR7dGhpcy50cmFuc2xhdGVYfXB4LCAke3RoaXMudHJhbnNsYXRlWX1weCkgc2NhbGUoJHt0aGlzLnNjYWxlfSlgO1xuICAgICAgICB9LFxuICAgICAgICB6b29tTGFiZWwoKTogc3RyaW5nIHtcbiAgICAgICAgICAgIHJldHVybiBgJHtNYXRoLnJvdW5kKHRoaXMuc2NhbGUgKiAxMDApfSVgO1xuICAgICAgICB9LFxuICAgIH0sXG4gICAgd2F0Y2g6IHtcbiAgICAgICAgc3JjKCkge1xuICAgICAgICAgICAgdGhpcy5yZXNldFZpZXcoKTtcbiAgICAgICAgfSxcbiAgICB9LFxuICAgIG1ldGhvZHM6IHtcbiAgICAgICAgY2xhbXBTY2FsZShzY2FsZTogbnVtYmVyKTogbnVtYmVyIHtcbiAgICAgICAgICAgIHJldHVybiBNYXRoLm1pbig4LCBNYXRoLm1heCgwLjI1LCBzY2FsZSkpO1xuICAgICAgICB9LFxuICAgICAgICBzZXRTY2FsZShzY2FsZTogbnVtYmVyKTogdm9pZCB7XG4gICAgICAgICAgICB0aGlzLnNjYWxlID0gdGhpcy5jbGFtcFNjYWxlKHNjYWxlKTtcbiAgICAgICAgICAgIGlmICh0aGlzLnNjYWxlID09PSAxKSB7XG4gICAgICAgICAgICAgICAgdGhpcy50cmFuc2xhdGVYID0gMDtcbiAgICAgICAgICAgICAgICB0aGlzLnRyYW5zbGF0ZVkgPSAwO1xuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICB6b29tSW4oKTogdm9pZCB7XG4gICAgICAgICAgICB0aGlzLnNldFNjYWxlKHRoaXMuc2NhbGUgKiAxLjI1KTtcbiAgICAgICAgfSxcbiAgICAgICAgem9vbU91dCgpOiB2b2lkIHtcbiAgICAgICAgICAgIHRoaXMuc2V0U2NhbGUodGhpcy5zY2FsZSAvIDEuMjUpO1xuICAgICAgICB9LFxuICAgICAgICBvbldoZWVsKGV2ZW50OiBXaGVlbEV2ZW50KTogdm9pZCB7XG4gICAgICAgICAgICB0aGlzLnNldFNjYWxlKHRoaXMuc2NhbGUgKiAoZXZlbnQuZGVsdGFZIDwgMCA/IDEuMTUgOiAxIC8gMS4xNSkpO1xuICAgICAgICB9LFxuICAgICAgICByZXNldFZpZXcoKTogdm9pZCB7XG4gICAgICAgICAgICB0aGlzLnNjYWxlID0gMTtcbiAgICAgICAgICAgIHRoaXMudHJhbnNsYXRlWCA9IDA7XG4gICAgICAgICAgICB0aGlzLnRyYW5zbGF0ZVkgPSAwO1xuICAgICAgICAgICAgdGhpcy5kcmFnZ2luZyA9IGZhbHNlO1xuICAgICAgICB9LFxuICAgICAgICBzdGFydERyYWcoZXZlbnQ6IFBvaW50ZXJFdmVudCk6IHZvaWQge1xuICAgICAgICAgICAgaWYgKGV2ZW50LmJ1dHRvbiAhPT0gMCkge1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRoaXMuZHJhZ2dpbmcgPSB0cnVlO1xuICAgICAgICAgICAgdGhpcy5wb2ludGVySWQgPSBldmVudC5wb2ludGVySWQ7XG4gICAgICAgICAgICB0aGlzLmRyYWdTdGFydFggPSBldmVudC5jbGllbnRYO1xuICAgICAgICAgICAgdGhpcy5kcmFnU3RhcnRZID0gZXZlbnQuY2xpZW50WTtcbiAgICAgICAgICAgIHRoaXMudHJhbnNsYXRlU3RhcnRYID0gdGhpcy50cmFuc2xhdGVYO1xuICAgICAgICAgICAgdGhpcy50cmFuc2xhdGVTdGFydFkgPSB0aGlzLnRyYW5zbGF0ZVk7XG4gICAgICAgICAgICAoZXZlbnQuY3VycmVudFRhcmdldCBhcyBIVE1MRWxlbWVudCkuc2V0UG9pbnRlckNhcHR1cmUoZXZlbnQucG9pbnRlcklkKTtcbiAgICAgICAgfSxcbiAgICAgICAgZHJhZyhldmVudDogUG9pbnRlckV2ZW50KTogdm9pZCB7XG4gICAgICAgICAgICBpZiAoIXRoaXMuZHJhZ2dpbmcgfHwgZXZlbnQucG9pbnRlcklkICE9PSB0aGlzLnBvaW50ZXJJZCkge1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRoaXMudHJhbnNsYXRlWCA9IHRoaXMudHJhbnNsYXRlU3RhcnRYICsgZXZlbnQuY2xpZW50WCAtIHRoaXMuZHJhZ1N0YXJ0WDtcbiAgICAgICAgICAgIHRoaXMudHJhbnNsYXRlWSA9IHRoaXMudHJhbnNsYXRlU3RhcnRZICsgZXZlbnQuY2xpZW50WSAtIHRoaXMuZHJhZ1N0YXJ0WTtcbiAgICAgICAgfSxcbiAgICAgICAgZW5kRHJhZyhldmVudDogUG9pbnRlckV2ZW50KTogdm9pZCB7XG4gICAgICAgICAgICBpZiAoZXZlbnQucG9pbnRlcklkICE9PSB0aGlzLnBvaW50ZXJJZCkge1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRoaXMuZHJhZ2dpbmcgPSBmYWxzZTtcbiAgICAgICAgICAgIGNvbnN0IHRhcmdldCA9IGV2ZW50LmN1cnJlbnRUYXJnZXQgYXMgSFRNTEVsZW1lbnQ7XG4gICAgICAgICAgICBpZiAodGFyZ2V0Lmhhc1BvaW50ZXJDYXB0dXJlKGV2ZW50LnBvaW50ZXJJZCkpIHtcbiAgICAgICAgICAgICAgICB0YXJnZXQucmVsZWFzZVBvaW50ZXJDYXB0dXJlKGV2ZW50LnBvaW50ZXJJZCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgfSxcbiAgICB0ZW1wbGF0ZTogYFxuICAgICAgICA8ZGl2IGNsYXNzPVwiaW1hZ2Utdmlld2VyXCI+XG4gICAgICAgICAgICA8ZGl2XG4gICAgICAgICAgICAgICAgY2xhc3M9XCJpbWFnZS12aWV3cG9ydFwiXG4gICAgICAgICAgICAgICAgOmNsYXNzPVwieyBkcmFnZ2luZyB9XCJcbiAgICAgICAgICAgICAgICBAd2hlZWwucHJldmVudC5zdG9wPVwib25XaGVlbFwiXG4gICAgICAgICAgICAgICAgQHBvaW50ZXJkb3duLnByZXZlbnQ9XCJzdGFydERyYWdcIlxuICAgICAgICAgICAgICAgIEBwb2ludGVybW92ZS5wcmV2ZW50PVwiZHJhZ1wiXG4gICAgICAgICAgICAgICAgQHBvaW50ZXJ1cD1cImVuZERyYWdcIlxuICAgICAgICAgICAgICAgIEBwb2ludGVyY2FuY2VsPVwiZW5kRHJhZ1wiXG4gICAgICAgICAgICAgICAgQGRibGNsaWNrPVwicmVzZXRWaWV3XCJcbiAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICA8aW1nXG4gICAgICAgICAgICAgICAgICAgIDpzcmM9XCJzcmNcIlxuICAgICAgICAgICAgICAgICAgICA6YWx0PVwiYWx0XCJcbiAgICAgICAgICAgICAgICAgICAgOnN0eWxlPVwieyB0cmFuc2Zvcm06IGltYWdlVHJhbnNmb3JtIH1cIlxuICAgICAgICAgICAgICAgICAgICBkcmFnZ2FibGU9XCJmYWxzZVwiXG4gICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgICAgPGRpdiBjbGFzcz1cImltYWdlLXZpZXdlci1jb250cm9sc1wiPlxuICAgICAgICAgICAgICAgIDxidXR0b24gdHlwZT1cImJ1dHRvblwiIHRpdGxlPVwiVGh1IG5o4buPXCIgQGNsaWNrPVwiem9vbU91dFwiPuKIkjwvYnV0dG9uPlxuICAgICAgICAgICAgICAgIDxzcGFuPnt7IHpvb21MYWJlbCB9fTwvc3Bhbj5cbiAgICAgICAgICAgICAgICA8YnV0dG9uIHR5cGU9XCJidXR0b25cIiB0aXRsZT1cIlBow7NuZyB0b1wiIEBjbGljaz1cInpvb21JblwiPis8L2J1dHRvbj5cbiAgICAgICAgICAgICAgICA8YnV0dG9uIHR5cGU9XCJidXR0b25cIiB0aXRsZT1cIkZpdCB2w6AgxJHhurd0IGzhuqFpIHbhu4sgdHLDrVwiIEBjbGljaz1cInJlc2V0Vmlld1wiPkZpdDwvYnV0dG9uPlxuICAgICAgICAgICAgPC9kaXY+XG4gICAgICAgIDwvZGl2PlxuICAgIGAsXG59KTtcblxuYXN5bmMgZnVuY3Rpb24gY3JlYXRlTWVkaWFBc3NldChhc3NldDogQXNzZXREYkluZm8pOiBQcm9taXNlPE1lZGlhQXNzZXQgfCBudWxsPiB7XG4gICAgY29uc3QgZXh0ZW5zaW9uID0gZXh0bmFtZShhc3NldC5maWxlKS50b0xvd2VyQ2FzZSgpO1xuICAgIGlmIChhc3NldC5pc0RpcmVjdG9yeSB8fCAhc3VwcG9ydGVkRXh0ZW5zaW9ucy5oYXMoZXh0ZW5zaW9uKSkge1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgICBjb25zdCBuYW1lID0gYmFzZW5hbWUoYXNzZXQuZmlsZSk7XG4gICAgICAgIGNvbnN0IGJhY2t1cFBhdGggPSBnZXRCYWNrdXBQYXRoKGFzc2V0LnV1aWQsIGV4dGVuc2lvbik7XG4gICAgICAgIGNvbnN0IFttZXRyaWNzLCBjYW5SZXZlcnRdID0gYXdhaXQgUHJvbWlzZS5hbGwoW1xuICAgICAgICAgICAgY2FsY3VsYXRlRmlsZU1ldHJpY3MoYXNzZXQuZmlsZSwgbmFtZSksXG4gICAgICAgICAgICBwYXRoRXhpc3RzKGJhY2t1cFBhdGgpLFxuICAgICAgICBdKTtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHV1aWQ6IGFzc2V0LnV1aWQsXG4gICAgICAgICAgICBuYW1lLFxuICAgICAgICAgICAgcGF0aDogYXNzZXQudXJsIHx8IGFzc2V0LnNvdXJjZSxcbiAgICAgICAgICAgIGZpbGVQYXRoOiBhc3NldC5maWxlLFxuICAgICAgICAgICAgcHJldmlld1VybDogcGF0aFRvRmlsZVVSTChhc3NldC5maWxlKS5ocmVmLFxuICAgICAgICAgICAgZXh0ZW5zaW9uLFxuICAgICAgICAgICAgc2l6ZTogbWV0cmljcy5maWxlU2l6ZSxcbiAgICAgICAgICAgIGJhc2U2NFNpemU6IG1ldHJpY3MuYmFzZTY0U2l6ZSxcbiAgICAgICAgICAgIHppcFNpemU6IG1ldHJpY3MuemlwU2l6ZSxcbiAgICAgICAgICAgIGJhY2t1cFBhdGgsXG4gICAgICAgICAgICBjYW5SZXZlcnQsXG4gICAgICAgIH07XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS53YXJuKGBbY2MtYXNzZXRzLWNvbXByZXNzXSBDYW5ub3QgcmVhZCBmaWxlOiAke2Fzc2V0LmZpbGV9YCwgZXJyb3IpO1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIG1hcFdpdGhDb25jdXJyZW5jeTxULCBSPihcbiAgICBpdGVtczogVFtdLFxuICAgIGNvbmN1cnJlbmN5OiBudW1iZXIsXG4gICAgbWFwcGVyOiAoaXRlbTogVCkgPT4gUHJvbWlzZTxSPixcbik6IFByb21pc2U8UltdPiB7XG4gICAgY29uc3QgcmVzdWx0cyA9IG5ldyBBcnJheTxSPihpdGVtcy5sZW5ndGgpO1xuICAgIGxldCBuZXh0SW5kZXggPSAwO1xuICAgIGNvbnN0IHdvcmtlcnMgPSBBcnJheS5mcm9tKHsgbGVuZ3RoOiBNYXRoLm1pbihjb25jdXJyZW5jeSwgaXRlbXMubGVuZ3RoKSB9LCBhc3luYyAoKSA9PiB7XG4gICAgICAgIHdoaWxlIChuZXh0SW5kZXggPCBpdGVtcy5sZW5ndGgpIHtcbiAgICAgICAgICAgIGNvbnN0IGluZGV4ID0gbmV4dEluZGV4O1xuICAgICAgICAgICAgbmV4dEluZGV4ICs9IDE7XG4gICAgICAgICAgICByZXN1bHRzW2luZGV4XSA9IGF3YWl0IG1hcHBlcihpdGVtc1tpbmRleF0pO1xuICAgICAgICB9XG4gICAgfSk7XG4gICAgYXdhaXQgUHJvbWlzZS5hbGwod29ya2Vycyk7XG4gICAgcmV0dXJuIHJlc3VsdHM7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gRWRpdG9yLlBhbmVsLmRlZmluZSh7XG4gICAgbGlzdGVuZXJzOiB7fSxcbiAgICB0ZW1wbGF0ZTogcmVhZEZpbGVTeW5jKGpvaW4oX19kaXJuYW1lLCAnLi4vLi4vLi4vc3RhdGljL3RlbXBsYXRlL2RlZmF1bHQvaW5kZXguaHRtbCcpLCAndXRmLTgnKSxcbiAgICBzdHlsZTogcmVhZEZpbGVTeW5jKGpvaW4oX19kaXJuYW1lLCAnLi4vLi4vLi4vc3RhdGljL3N0eWxlL2RlZmF1bHQvaW5kZXguY3NzJyksICd1dGYtOCcpLFxuICAgICQ6IHtcbiAgICAgICAgYXBwOiAnI2FwcCcsXG4gICAgfSxcbiAgICBtZXRob2RzOiB7fSxcbiAgICByZWFkeSgpIHtcbiAgICAgICAgaWYgKCF0aGlzLiQuYXBwKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBhcHAgPSBjcmVhdGVBcHAoZGVmaW5lQ29tcG9uZW50KHtcbiAgICAgICAgICAgIGRhdGEoKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICAgICAgYXNzZXRzOiBbXSBhcyBNZWRpYUFzc2V0W10sXG4gICAgICAgICAgICAgICAgICAgIGxvYWRpbmc6IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICBlcnJvck1lc3NhZ2U6ICcnLFxuICAgICAgICAgICAgICAgICAgICBzZWFyY2hRdWVyeTogJycsXG4gICAgICAgICAgICAgICAgICAgIGV4dGVuc2lvbkZpbHRlcjogJycsXG4gICAgICAgICAgICAgICAgICAgIHNvcnRDb2x1bW46ICcnIGFzIFNvcnRDb2x1bW4sXG4gICAgICAgICAgICAgICAgICAgIHNvcnREaXJlY3Rpb246ICcnIGFzICcnIHwgJ2FzYycgfCAnZGVzYycsXG4gICAgICAgICAgICAgICAgICAgIGN1cnJlbnRQYWdlOiAxLFxuICAgICAgICAgICAgICAgICAgICBwYWdlU2l6ZTogMTAsXG4gICAgICAgICAgICAgICAgICAgIHNlbGVjdGVkQXNzZXQ6IG51bGwgYXMgTWVkaWFBc3NldCB8IG51bGwsXG4gICAgICAgICAgICAgICAgICAgIGRldGFpbExvYWRpbmc6IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICBiYXNlNjRTaXplOiBudWxsIGFzIG51bWJlciB8IG51bGwsXG4gICAgICAgICAgICAgICAgICAgIGNvbXByZXNzZWRTaXplOiBudWxsIGFzIG51bWJlciB8IG51bGwsXG4gICAgICAgICAgICAgICAgICAgIGRldGFpbEVycm9yOiAnJyxcbiAgICAgICAgICAgICAgICAgICAgZGV0YWlsUmVxdWVzdElkOiAwLFxuICAgICAgICAgICAgICAgICAgICBjb21wcmVzc2lvbkFzc2V0OiBudWxsIGFzIE1lZGlhQXNzZXQgfCBudWxsLFxuICAgICAgICAgICAgICAgICAgICBpbWFnZUNvbXByZXNzb3I6ICdwbmdxdWFudCcgYXMgSW1hZ2VDb21wcmVzc29yLFxuICAgICAgICAgICAgICAgICAgICBjb21wcmVzc2lvblByZXNldDogJ2JhbGFuY2VkJyxcbiAgICAgICAgICAgICAgICAgICAgY29tcHJlc3Npb25TZXR0aW5nczoge1xuICAgICAgICAgICAgICAgICAgICAgICAgcXVhbGl0eU1pbjogNTUsXG4gICAgICAgICAgICAgICAgICAgICAgICBxdWFsaXR5TWF4OiA4MCxcbiAgICAgICAgICAgICAgICAgICAgICAgIHNwZWVkOiA2LFxuICAgICAgICAgICAgICAgICAgICAgICAgY29sb3JzOiAxOTIsXG4gICAgICAgICAgICAgICAgICAgICAgICBkaXRoZXJpbmc6IDAuNyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGF1ZGlvQml0cmF0ZTogMTI4LFxuICAgICAgICAgICAgICAgICAgICAgICAgc2FtcGxlUmF0ZTogNDQxMDAsXG4gICAgICAgICAgICAgICAgICAgICAgICBjaGFubmVsczogMixcbiAgICAgICAgICAgICAgICAgICAgICAgIHNoYXJwUXVhbGl0eTogODAsXG4gICAgICAgICAgICAgICAgICAgICAgICBzaGFycENvbXByZXNzaW9uTGV2ZWw6IDksXG4gICAgICAgICAgICAgICAgICAgICAgICBzaGFycFByb2dyZXNzaXZlOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgc2hhcnBQYWxldHRlOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgc2hhcnBNb3pqcGVnOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgc2hhcnBDaHJvbWFTdWJzYW1wbGluZzogJzQ6MjowJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlc2l6ZVdpZHRoOiBudWxsLFxuICAgICAgICAgICAgICAgICAgICAgICAgcmVzaXplSGVpZ2h0OiBudWxsLFxuICAgICAgICAgICAgICAgICAgICB9IGFzIENvbXByZXNzaW9uU2V0dGluZ3MsXG4gICAgICAgICAgICAgICAgICAgIGltYWdlRGltZW5zaW9uczogbnVsbCBhcyBJbWFnZURpbWVuc2lvbnMgfCBudWxsLFxuICAgICAgICAgICAgICAgICAgICByZXNpemVNb2RlOiAncGVyY2VudCcgYXMgJ3BlcmNlbnQnIHwgJ3BpeGVscycsXG4gICAgICAgICAgICAgICAgICAgIHJlc2l6ZVBlcmNlbnQ6IDEwMCxcbiAgICAgICAgICAgICAgICAgICAgcmVzaXplV2lkdGg6IDAsXG4gICAgICAgICAgICAgICAgICAgIHJlc2l6ZUhlaWdodDogMCxcbiAgICAgICAgICAgICAgICAgICAgY29tcHJlc3Npb25Mb2FkaW5nOiBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgY29tcHJlc3Npb25BcHBseWluZzogZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgIGNvbXByZXNzaW9uRXJyb3I6ICcnLFxuICAgICAgICAgICAgICAgICAgICBvcmlnaW5hbE1ldHJpY3M6IG51bGwgYXMgRmlsZU1ldHJpY3MgfCBudWxsLFxuICAgICAgICAgICAgICAgICAgICBvdXRwdXRNZXRyaWNzOiBudWxsIGFzIEZpbGVNZXRyaWNzIHwgbnVsbCxcbiAgICAgICAgICAgICAgICAgICAgY29tcHJlc3NlZFByZXZpZXdVcmw6ICcnLFxuICAgICAgICAgICAgICAgICAgICBjb21wcmVzc2VkRmlsZVBhdGg6ICcnLFxuICAgICAgICAgICAgICAgICAgICBjb21wcmVzc2lvblRlbXBEaXJlY3Rvcnk6ICcnLFxuICAgICAgICAgICAgICAgICAgICBjb21wcmVzc2lvblJlcXVlc3RJZDogMCxcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGNvbXB1dGVkOiB7XG4gICAgICAgICAgICAgICAgdmlzaWJsZUFzc2V0cygpOiBNZWRpYUFzc2V0W10ge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBxdWVyeSA9IHRoaXMuc2VhcmNoUXVlcnkudHJpbSgpLnRvTG9jYWxlTG93ZXJDYXNlKCk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGZpbHRlcmVkQXNzZXRzID0gdGhpcy5hc3NldHMuZmlsdGVyKChhc3NldCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbWF0Y2hlc0V4dGVuc2lvbiA9ICF0aGlzLmV4dGVuc2lvbkZpbHRlclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHx8IGFzc2V0LmV4dGVuc2lvbiA9PT0gdGhpcy5leHRlbnNpb25GaWx0ZXI7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBtYXRjaGVzUXVlcnkgPSAhcXVlcnlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB8fCBhc3NldC5uYW1lLnRvTG9jYWxlTG93ZXJDYXNlKCkuaW5jbHVkZXMocXVlcnkpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfHwgYXNzZXQucGF0aC50b0xvY2FsZUxvd2VyQ2FzZSgpLmluY2x1ZGVzKHF1ZXJ5KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBtYXRjaGVzRXh0ZW5zaW9uICYmIG1hdGNoZXNRdWVyeTtcbiAgICAgICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICAgICAgaWYgKCF0aGlzLnNvcnRDb2x1bW4gfHwgIXRoaXMuc29ydERpcmVjdGlvbikge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZpbHRlcmVkQXNzZXRzO1xuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZGlyZWN0aW9uID0gdGhpcy5zb3J0RGlyZWN0aW9uID09PSAnYXNjJyA/IDEgOiAtMTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc29ydENvbHVtbiA9IHRoaXMuc29ydENvbHVtbiBhcyBFeGNsdWRlPFNvcnRDb2x1bW4sICcnPjtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIFsuLi5maWx0ZXJlZEFzc2V0c10uc29ydCgobGVmdCwgcmlnaHQpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHNpemVEaWZmZXJlbmNlID0gKGxlZnRbc29ydENvbHVtbl0gLSByaWdodFtzb3J0Q29sdW1uXSkgKiBkaXJlY3Rpb247XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gc2l6ZURpZmZlcmVuY2UgfHwgbGVmdC5wYXRoLmxvY2FsZUNvbXBhcmUocmlnaHQucGF0aCk7XG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgdG90YWxQYWdlcygpOiBudW1iZXIge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gTWF0aC5tYXgoMSwgTWF0aC5jZWlsKHRoaXMudmlzaWJsZUFzc2V0cy5sZW5ndGggLyB0aGlzLnBhZ2VTaXplKSk7XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBwYWdpbmF0ZWRBc3NldHMoKTogTWVkaWFBc3NldFtdIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3RhcnRJbmRleCA9ICh0aGlzLmN1cnJlbnRQYWdlIC0gMSkgKiB0aGlzLnBhZ2VTaXplO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy52aXNpYmxlQXNzZXRzLnNsaWNlKHN0YXJ0SW5kZXgsIHN0YXJ0SW5kZXggKyB0aGlzLnBhZ2VTaXplKTtcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHBhZ2VOdW1iZXJzKCk6IG51bWJlcltdIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZmlyc3RQYWdlID0gTWF0aC5tYXgoMSwgTWF0aC5taW4oXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmN1cnJlbnRQYWdlIC0gMixcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMudG90YWxQYWdlcyAtIDQsXG4gICAgICAgICAgICAgICAgICAgICkpO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBsYXN0UGFnZSA9IE1hdGgubWluKHRoaXMudG90YWxQYWdlcywgZmlyc3RQYWdlICsgNCk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHBhZ2VzOiBudW1iZXJbXSA9IFtdO1xuICAgICAgICAgICAgICAgICAgICBmb3IgKGxldCBwYWdlID0gZmlyc3RQYWdlOyBwYWdlIDw9IGxhc3RQYWdlOyBwYWdlICs9IDEpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHBhZ2VzLnB1c2gocGFnZSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHBhZ2VzO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgcGFnZVJhbmdlVGV4dCgpOiBzdHJpbmcge1xuICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy52aXNpYmxlQXNzZXRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuICcwIHThu4dwJztcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBjb25zdCBmaXJzdEl0ZW0gPSAodGhpcy5jdXJyZW50UGFnZSAtIDEpICogdGhpcy5wYWdlU2l6ZSArIDE7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGxhc3RJdGVtID0gTWF0aC5taW4odGhpcy5jdXJyZW50UGFnZSAqIHRoaXMucGFnZVNpemUsIHRoaXMudmlzaWJsZUFzc2V0cy5sZW5ndGgpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gYCR7Zmlyc3RJdGVtfS0ke2xhc3RJdGVtfSAvICR7dGhpcy52aXNpYmxlQXNzZXRzLmxlbmd0aH0gdOG7h3BgO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgc3RhdHVzVGV4dCgpOiBzdHJpbmcge1xuICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5sb2FkaW5nKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gJ8SQYW5nIHThuqNpIHTDoGkgbmd1ecOqbi4uLic7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMudmlzaWJsZUFzc2V0cy5sZW5ndGggIT09IHRoaXMuYXNzZXRzLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGAke3RoaXMudmlzaWJsZUFzc2V0cy5sZW5ndGh9LyR7dGhpcy5hc3NldHMubGVuZ3RofSB04buHcGA7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGAke3RoaXMuYXNzZXRzLmxlbmd0aH0gdOG7h3BgO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgd2F0Y2g6IHtcbiAgICAgICAgICAgICAgICBzZWFyY2hRdWVyeSgpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jdXJyZW50UGFnZSA9IDE7XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBleHRlbnNpb25GaWx0ZXIoKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY3VycmVudFBhZ2UgPSAxO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgc29ydENvbHVtbigpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jdXJyZW50UGFnZSA9IDE7XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBzb3J0RGlyZWN0aW9uKCkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmN1cnJlbnRQYWdlID0gMTtcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHBhZ2VTaXplKCkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmN1cnJlbnRQYWdlID0gMTtcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGFzc2V0cygpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jdXJyZW50UGFnZSA9IDE7XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBtZXRob2RzOiB7XG4gICAgICAgICAgICAgICAgZm9ybWF0RmlsZVNpemUsXG4gICAgICAgICAgICAgICAgaXNJbWFnZShhc3NldDogTWVkaWFBc3NldCk6IGJvb2xlYW4ge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gYXNzZXQuZXh0ZW5zaW9uID09PSAnLnBuZycgfHwgYXNzZXQuZXh0ZW5zaW9uID09PSAnLmpwZyc7XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB0b2dnbGVTb3J0KGNvbHVtbjogRXhjbHVkZTxTb3J0Q29sdW1uLCAnJz4pOiB2b2lkIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuc29ydENvbHVtbiAhPT0gY29sdW1uKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnNvcnRDb2x1bW4gPSBjb2x1bW47XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnNvcnREaXJlY3Rpb24gPSAnYXNjJztcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmICh0aGlzLnNvcnREaXJlY3Rpb24gPT09ICdhc2MnKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnNvcnREaXJlY3Rpb24gPSAnZGVzYyc7XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnNvcnRDb2x1bW4gPSAnJztcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuc29ydERpcmVjdGlvbiA9ICcnO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBzb3J0SW5kaWNhdG9yKGNvbHVtbjogRXhjbHVkZTxTb3J0Q29sdW1uLCAnJz4pOiBzdHJpbmcge1xuICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5zb3J0Q29sdW1uICE9PSBjb2x1bW4pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAn4oeFJztcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5zb3J0RGlyZWN0aW9uID09PSAnYXNjJyA/ICfilrInIDogJ+KWvCc7XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBnb1RvUGFnZShwYWdlOiBudW1iZXIpOiB2b2lkIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jdXJyZW50UGFnZSA9IE1hdGgubWluKE1hdGgubWF4KHBhZ2UsIDEpLCB0aGlzLnRvdGFsUGFnZXMpO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgY29tcHJlc3Npb25SZXN1bHQoKTogc3RyaW5nIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCF0aGlzLnNlbGVjdGVkQXNzZXQgfHwgdGhpcy5jb21wcmVzc2VkU2l6ZSA9PT0gbnVsbCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuICcnO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLnNlbGVjdGVkQXNzZXQuc2l6ZSA9PT0gMCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuICdLaMO0bmcgdGjhu4MgxJHDoW5oIGdpw6EnO1xuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZGlmZmVyZW5jZSA9ICgxIC0gdGhpcy5jb21wcmVzc2VkU2l6ZSAvIHRoaXMuc2VsZWN0ZWRBc3NldC5zaXplKSAqIDEwMDtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGRpZmZlcmVuY2UgPiAwKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gYEdp4bqjbSAke2RpZmZlcmVuY2UudG9GaXhlZCgyKX0lYDtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gYFTEg25nICR7TWF0aC5hYnMoZGlmZmVyZW5jZSkudG9GaXhlZCgyKX0lYDtcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIG1ldHJpY0RpZmZlcmVuY2UoYmVmb3JlOiBudW1iZXIsIGFmdGVyOiBudW1iZXIpOiBzdHJpbmcge1xuICAgICAgICAgICAgICAgICAgICBpZiAoYmVmb3JlID09PSAwKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gJzAlJztcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBjb25zdCBkaWZmZXJlbmNlID0gKDEgLSBhZnRlciAvIGJlZm9yZSkgKiAxMDA7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBkaWZmZXJlbmNlID49IDBcbiAgICAgICAgICAgICAgICAgICAgICAgID8gYEdp4bqjbSAke2RpZmZlcmVuY2UudG9GaXhlZCgyKX0lYFxuICAgICAgICAgICAgICAgICAgICAgICAgOiBgVMSDbmcgJHtNYXRoLmFicyhkaWZmZXJlbmNlKS50b0ZpeGVkKDIpfSVgO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgYXN5bmMgb3BlbkFzc2V0RGV0YWlscyhhc3NldDogTWVkaWFBc3NldCk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLnNlbGVjdGVkQXNzZXQgPSBhc3NldDtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5iYXNlNjRTaXplID0gbnVsbDtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jb21wcmVzc2VkU2l6ZSA9IG51bGw7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZGV0YWlsRXJyb3IgPSAnJztcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5kZXRhaWxMb2FkaW5nID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcmVxdWVzdElkID0gKyt0aGlzLmRldGFpbFJlcXVlc3RJZDtcblxuICAgICAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbWV0cmljcyA9IGF3YWl0IGNhbGN1bGF0ZUZpbGVNZXRyaWNzKGFzc2V0LmZpbGVQYXRoLCBhc3NldC5uYW1lKTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHJlcXVlc3RJZCAhPT0gdGhpcy5kZXRhaWxSZXF1ZXN0SWQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuYmFzZTY0U2l6ZSA9IG1ldHJpY3MuYmFzZTY0U2l6ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuY29tcHJlc3NlZFNpemUgPSBtZXRyaWNzLnppcFNpemU7XG4gICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAocmVxdWVzdElkICE9PSB0aGlzLmRldGFpbFJlcXVlc3RJZCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuZGV0YWlsRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPyBlcnJvci5tZXNzYWdlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgOiAnS2jDtG5nIHRo4buDIHBow6JuIHTDrWNoIHThu4dwLic7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbY2MtYXNzZXRzLWNvbXByZXNzXSBDYW5ub3QgaW5zcGVjdCAke2Fzc2V0LmZpbGVQYXRofWAsIGVycm9yKTtcbiAgICAgICAgICAgICAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChyZXF1ZXN0SWQgPT09IHRoaXMuZGV0YWlsUmVxdWVzdElkKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5kZXRhaWxMb2FkaW5nID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGNsb3NlQXNzZXREZXRhaWxzKCk6IHZvaWQge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmRldGFpbFJlcXVlc3RJZCArPSAxO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLnNlbGVjdGVkQXNzZXQgPSBudWxsO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmRldGFpbExvYWRpbmcgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5kZXRhaWxFcnJvciA9ICcnO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgaXNDb21wcmVzc2lvblN1cHBvcnRlZChhc3NldDogTWVkaWFBc3NldCk6IGJvb2xlYW4ge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gYXNzZXQuZXh0ZW5zaW9uID09PSAnLnBuZydcbiAgICAgICAgICAgICAgICAgICAgICAgIHx8IGFzc2V0LmV4dGVuc2lvbiA9PT0gJy5qcGcnXG4gICAgICAgICAgICAgICAgICAgICAgICB8fCBhc3NldC5leHRlbnNpb24gPT09ICcubXAzJztcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGFwcGx5Q29tcHJlc3Npb25QcmVzZXQocHJlc2V0OiBzdHJpbmcpOiB2b2lkIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jb21wcmVzc2lvblByZXNldCA9IHByZXNldDtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgaXNBdWRpbyA9IHRoaXMuY29tcHJlc3Npb25Bc3NldD8uZXh0ZW5zaW9uID09PSAnLm1wMyc7XG5cbiAgICAgICAgICAgICAgICAgICAgaWYgKGlzQXVkaW8pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHByZXNldHM6IFJlY29yZDxzdHJpbmcsIFBhcnRpYWw8Q29tcHJlc3Npb25TZXR0aW5ncz4+ID0ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhpZ2g6IHsgYXVkaW9CaXRyYXRlOiAxOTIsIHNhbXBsZVJhdGU6IDQ4MDAwLCBjaGFubmVsczogMiB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJhbGFuY2VkOiB7IGF1ZGlvQml0cmF0ZTogMTI4LCBzYW1wbGVSYXRlOiA0NDEwMCwgY2hhbm5lbHM6IDIgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzbWFsbDogeyBhdWRpb0JpdHJhdGU6IDY0LCBzYW1wbGVSYXRlOiAyMjA1MCwgY2hhbm5lbHM6IDEgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAgICAgICBPYmplY3QuYXNzaWduKHRoaXMuY29tcHJlc3Npb25TZXR0aW5ncywgcHJlc2V0c1twcmVzZXRdIHx8IHt9KTtcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmICh0aGlzLmltYWdlQ29tcHJlc3NvciA9PT0gJ3NoYXJwJykge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaXNKcGVnID0gdGhpcy5jb21wcmVzc2lvbkFzc2V0Py5leHRlbnNpb24gPT09ICcuanBnJztcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHByZXNldHM6IFJlY29yZDxzdHJpbmcsIFBhcnRpYWw8Q29tcHJlc3Npb25TZXR0aW5ncz4+ID0gaXNKcGVnXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPyB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhpZ2g6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNoYXJwUXVhbGl0eTogOTIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzaGFycFByb2dyZXNzaXZlOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc2hhcnBNb3pqcGVnOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc2hhcnBDaHJvbWFTdWJzYW1wbGluZzogJzQ6NDo0JyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYmFsYW5jZWQ6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNoYXJwUXVhbGl0eTogODAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzaGFycFByb2dyZXNzaXZlOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc2hhcnBNb3pqcGVnOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc2hhcnBDaHJvbWFTdWJzYW1wbGluZzogJzQ6MjowJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc21hbGw6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNoYXJwUXVhbGl0eTogNjAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzaGFycFByb2dyZXNzaXZlOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc2hhcnBNb3pqcGVnOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc2hhcnBDaHJvbWFTdWJzYW1wbGluZzogJzQ6MjowJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhpZ2g6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNoYXJwUXVhbGl0eTogOTUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzaGFycENvbXByZXNzaW9uTGV2ZWw6IDYsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzaGFycFByb2dyZXNzaXZlOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc2hhcnBQYWxldHRlOiBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYmFsYW5jZWQ6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNoYXJwUXVhbGl0eTogODAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzaGFycENvbXByZXNzaW9uTGV2ZWw6IDksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzaGFycFByb2dyZXNzaXZlOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc2hhcnBQYWxldHRlOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29sb3JzOiAxOTIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBkaXRoZXJpbmc6IDAuNyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc21hbGw6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNoYXJwUXVhbGl0eTogNjAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzaGFycENvbXByZXNzaW9uTGV2ZWw6IDksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzaGFycFByb2dyZXNzaXZlOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc2hhcnBQYWxldHRlOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29sb3JzOiAxMjgsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBkaXRoZXJpbmc6IDAuNSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgICAgICAgT2JqZWN0LmFzc2lnbih0aGlzLmNvbXByZXNzaW9uU2V0dGluZ3MsIHByZXNldHNbcHJlc2V0XSB8fCB7fSk7XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwcmVzZXRzOiBSZWNvcmQ8c3RyaW5nLCBQYXJ0aWFsPENvbXByZXNzaW9uU2V0dGluZ3M+PiA9IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBoaWdoOiB7IHF1YWxpdHlNaW46IDc1LCBxdWFsaXR5TWF4OiA5NSwgc3BlZWQ6IDMsIGNvbG9yczogMjU2LCBkaXRoZXJpbmc6IDAuOCB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJhbGFuY2VkOiB7IHF1YWxpdHlNaW46IDU1LCBxdWFsaXR5TWF4OiA4MCwgc3BlZWQ6IDYsIGNvbG9yczogMTkyLCBkaXRoZXJpbmc6IDAuNyB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNtYWxsOiB7IHF1YWxpdHlNaW46IDMwLCBxdWFsaXR5TWF4OiA2MCwgc3BlZWQ6IDksIGNvbG9yczogMTI4LCBkaXRoZXJpbmc6IDAuNSB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgICAgICAgIE9iamVjdC5hc3NpZ24odGhpcy5jb21wcmVzc2lvblNldHRpbmdzLCBwcmVzZXRzW3ByZXNldF0gfHwge30pO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuaW52YWxpZGF0ZUNvbXByZXNzaW9uUHJldmlldygpO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgY2hhbmdlSW1hZ2VDb21wcmVzc29yKCk6IHZvaWQge1xuICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5jb21wcmVzc2lvbkFzc2V0Py5leHRlbnNpb24gPT09ICcuanBnJykge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5pbWFnZUNvbXByZXNzb3IgPSAnc2hhcnAnO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuYXBwbHlDb21wcmVzc2lvblByZXNldCgnYmFsYW5jZWQnKTtcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHJlc2V0UmVzaXplT3B0aW9ucyhkaW1lbnNpb25zOiBJbWFnZURpbWVuc2lvbnMpOiB2b2lkIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5yZXNpemVNb2RlID0gJ3BlcmNlbnQnO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLnJlc2l6ZVBlcmNlbnQgPSAxMDA7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMucmVzaXplV2lkdGggPSBkaW1lbnNpb25zLndpZHRoO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLnJlc2l6ZUhlaWdodCA9IGRpbWVuc2lvbnMuaGVpZ2h0O1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmNvbXByZXNzaW9uU2V0dGluZ3MucmVzaXplV2lkdGggPSBudWxsO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmNvbXByZXNzaW9uU2V0dGluZ3MucmVzaXplSGVpZ2h0ID0gbnVsbDtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5pbnZhbGlkYXRlQ29tcHJlc3Npb25QcmV2aWV3KCk7XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBjaGFuZ2VSZXNpemVNb2RlKCk6IHZvaWQge1xuICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5yZXNpemVNb2RlID09PSAncGVyY2VudCcpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMudXBkYXRlUmVzaXplRnJvbVBlcmNlbnQoKTtcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMudXBkYXRlUmVzaXplRnJvbVdpZHRoKCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHVwZGF0ZVJlc2l6ZUZyb21QZXJjZW50KCk6IHZvaWQge1xuICAgICAgICAgICAgICAgICAgICBpZiAoIXRoaXMuaW1hZ2VEaW1lbnNpb25zKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcGVyY2VudCA9IE51bWJlcih0aGlzLnJlc2l6ZVBlcmNlbnQpO1xuICAgICAgICAgICAgICAgICAgICBpZiAoIU51bWJlci5pc0Zpbml0ZShwZXJjZW50KSB8fCBwZXJjZW50IDw9IDApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB0aGlzLnJlc2l6ZVdpZHRoID0gTWF0aC5tYXgoMSwgTWF0aC5yb3VuZCh0aGlzLmltYWdlRGltZW5zaW9ucy53aWR0aCAqIHBlcmNlbnQgLyAxMDApKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5yZXNpemVIZWlnaHQgPSBNYXRoLm1heCgxLCBNYXRoLnJvdW5kKHRoaXMuaW1hZ2VEaW1lbnNpb25zLmhlaWdodCAqIHBlcmNlbnQgLyAxMDApKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy51cGRhdGVSZXNpemVTZXR0aW5ncygpO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgdXBkYXRlUmVzaXplRnJvbVdpZHRoKCk6IHZvaWQge1xuICAgICAgICAgICAgICAgICAgICBpZiAoIXRoaXMuaW1hZ2VEaW1lbnNpb25zIHx8IHRoaXMucmVzaXplV2lkdGggPD0gMCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIHRoaXMucmVzaXplSGVpZ2h0ID0gTWF0aC5tYXgoMSwgTWF0aC5yb3VuZChcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMucmVzaXplV2lkdGggKiB0aGlzLmltYWdlRGltZW5zaW9ucy5oZWlnaHQgLyB0aGlzLmltYWdlRGltZW5zaW9ucy53aWR0aCxcbiAgICAgICAgICAgICAgICAgICAgKSk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMucmVzaXplUGVyY2VudCA9IE51bWJlcigodGhpcy5yZXNpemVXaWR0aCAvIHRoaXMuaW1hZ2VEaW1lbnNpb25zLndpZHRoICogMTAwKS50b0ZpeGVkKDIpKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy51cGRhdGVSZXNpemVTZXR0aW5ncygpO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgdXBkYXRlUmVzaXplRnJvbUhlaWdodCgpOiB2b2lkIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCF0aGlzLmltYWdlRGltZW5zaW9ucyB8fCB0aGlzLnJlc2l6ZUhlaWdodCA8PSAwKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgdGhpcy5yZXNpemVXaWR0aCA9IE1hdGgubWF4KDEsIE1hdGgucm91bmQoXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnJlc2l6ZUhlaWdodCAqIHRoaXMuaW1hZ2VEaW1lbnNpb25zLndpZHRoIC8gdGhpcy5pbWFnZURpbWVuc2lvbnMuaGVpZ2h0LFxuICAgICAgICAgICAgICAgICAgICApKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5yZXNpemVQZXJjZW50ID0gTnVtYmVyKCh0aGlzLnJlc2l6ZUhlaWdodCAvIHRoaXMuaW1hZ2VEaW1lbnNpb25zLmhlaWdodCAqIDEwMCkudG9GaXhlZCgyKSk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMudXBkYXRlUmVzaXplU2V0dGluZ3MoKTtcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHVwZGF0ZVJlc2l6ZVNldHRpbmdzKCk6IHZvaWQge1xuICAgICAgICAgICAgICAgICAgICBpZiAoIXRoaXMuaW1hZ2VEaW1lbnNpb25zKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdW5jaGFuZ2VkID0gdGhpcy5yZXNpemVXaWR0aCA9PT0gdGhpcy5pbWFnZURpbWVuc2lvbnMud2lkdGhcbiAgICAgICAgICAgICAgICAgICAgICAgICYmIHRoaXMucmVzaXplSGVpZ2h0ID09PSB0aGlzLmltYWdlRGltZW5zaW9ucy5oZWlnaHQ7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY29tcHJlc3Npb25TZXR0aW5ncy5yZXNpemVXaWR0aCA9IHVuY2hhbmdlZCA/IG51bGwgOiB0aGlzLnJlc2l6ZVdpZHRoO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmNvbXByZXNzaW9uU2V0dGluZ3MucmVzaXplSGVpZ2h0ID0gdW5jaGFuZ2VkID8gbnVsbCA6IHRoaXMucmVzaXplSGVpZ2h0O1xuICAgICAgICAgICAgICAgICAgICB0aGlzLnVzZUN1c3RvbUNvbXByZXNzaW9uU2V0dGluZ3MoKTtcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHVzZUN1c3RvbUNvbXByZXNzaW9uU2V0dGluZ3MoKTogdm9pZCB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY29tcHJlc3Npb25QcmVzZXQgPSAnY3VzdG9tJztcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5pbnZhbGlkYXRlQ29tcHJlc3Npb25QcmV2aWV3KCk7XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBpbnZhbGlkYXRlQ29tcHJlc3Npb25QcmV2aWV3KCk6IHZvaWQge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLm91dHB1dE1ldHJpY3MgPSBudWxsO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmNvbXByZXNzZWRQcmV2aWV3VXJsID0gJyc7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY29tcHJlc3NlZEZpbGVQYXRoID0gJyc7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY29tcHJlc3Npb25FcnJvciA9ICcnO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgdmFsaWRhdGVDb21wcmVzc2lvblNldHRpbmdzKCk6IHN0cmluZyB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHNldHRpbmdzID0gdGhpcy5jb21wcmVzc2lvblNldHRpbmdzO1xuICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5jb21wcmVzc2lvbkFzc2V0ICYmIHRoaXMuaXNJbWFnZSh0aGlzLmNvbXByZXNzaW9uQXNzZXQpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5yZXNpemVXaWR0aCA8IDEgfHwgdGhpcy5yZXNpemVIZWlnaHQgPCAxXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfHwgdGhpcy5yZXNpemVXaWR0aCA+IDE2Mzg0IHx8IHRoaXMucmVzaXplSGVpZ2h0ID4gMTYzODQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gJ0vDrWNoIHRoxrDhu5tjIHJlc2l6ZSBwaOG6o2kgbuG6sW0gdHJvbmcgMS0xNjM4NCBweC4nO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLmNvbXByZXNzaW9uQXNzZXQ/LmV4dGVuc2lvbiA9PT0gJy5wbmcnICYmIHRoaXMuaW1hZ2VDb21wcmVzc29yID09PSAncG5ncXVhbnQnKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoc2V0dGluZ3MucXVhbGl0eU1pbiA8IDAgfHwgc2V0dGluZ3MucXVhbGl0eU1heCA+IDEwMFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHx8IHNldHRpbmdzLnF1YWxpdHlNaW4gPiBzZXR0aW5ncy5xdWFsaXR5TWF4KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuICdRdWFsaXR5IHBo4bqjaSBu4bqxbSB0cm9uZyAwLTEwMCB2w6AgTWluIGtow7RuZyDEkcaw4bujYyBs4bubbiBoxqFuIE1heC4nO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHNldHRpbmdzLnNwZWVkIDwgMSB8fCBzZXR0aW5ncy5zcGVlZCA+IDExKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuICdTcGVlZCBj4bunYSBwbmdxdWFudCBwaOG6o2kgbuG6sW0gdHJvbmcgMS0xMS4nO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFOdW1iZXIuaXNJbnRlZ2VyKHNldHRpbmdzLmNvbG9ycylcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB8fCBzZXR0aW5ncy5jb2xvcnMgPCAyIHx8IHNldHRpbmdzLmNvbG9ycyA+IDI1Nikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAnU+G7kSBtw6B1IHBo4bqjaSBu4bqxbSB0cm9uZyAyLTI1Ni4nO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHNldHRpbmdzLmRpdGhlcmluZyA8IDAgfHwgc2V0dGluZ3MuZGl0aGVyaW5nID4gMSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAnRGl0aGVyaW5nIHBo4bqjaSBu4bqxbSB0cm9uZyAwLTEuJztcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmICgodGhpcy5jb21wcmVzc2lvbkFzc2V0Py5leHRlbnNpb24gPT09ICcucG5nJ1xuICAgICAgICAgICAgICAgICAgICAgICAgfHwgdGhpcy5jb21wcmVzc2lvbkFzc2V0Py5leHRlbnNpb24gPT09ICcuanBnJylcbiAgICAgICAgICAgICAgICAgICAgICAgICYmIHRoaXMuaW1hZ2VDb21wcmVzc29yID09PSAnc2hhcnAnKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoc2V0dGluZ3Muc2hhcnBRdWFsaXR5IDwgMSB8fCBzZXR0aW5ncy5zaGFycFF1YWxpdHkgPiAxMDApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gJ1F1YWxpdHkgY+G7p2EgU2hhcnAgcGjhuqNpIG7hurFtIHRyb25nIDEtMTAwLic7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoc2V0dGluZ3Muc2hhcnBDb21wcmVzc2lvbkxldmVsIDwgMCB8fCBzZXR0aW5ncy5zaGFycENvbXByZXNzaW9uTGV2ZWwgPiA5KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuICdDb21wcmVzc2lvbiBsZXZlbCBj4bunYSBTaGFycCBwaOG6o2kgbuG6sW0gdHJvbmcgMC05Lic7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5jb21wcmVzc2lvbkFzc2V0LmV4dGVuc2lvbiA9PT0gJy5wbmcnICYmIHNldHRpbmdzLnNoYXJwUGFsZXR0ZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICghTnVtYmVyLmlzSW50ZWdlcihzZXR0aW5ncy5jb2xvcnMpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHx8IHNldHRpbmdzLmNvbG9ycyA8IDIgfHwgc2V0dGluZ3MuY29sb3JzID4gMjU2KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAnU+G7kSBtw6B1IHBo4bqjaSBu4bqxbSB0cm9uZyAyLTI1Ni4nO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoc2V0dGluZ3MuZGl0aGVyaW5nIDwgMCB8fCBzZXR0aW5ncy5kaXRoZXJpbmcgPiAxKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAnRGl0aGVyaW5nIHBo4bqjaSBu4bqxbSB0cm9uZyAwLTEuJztcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAodGhpcy5jb21wcmVzc2lvbkFzc2V0Py5leHRlbnNpb24gPT09ICcubXAzJykge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHNldHRpbmdzLmF1ZGlvQml0cmF0ZSA8IDggfHwgc2V0dGluZ3MuYXVkaW9CaXRyYXRlID4gMzIwKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuICdCaXRyYXRlIHBo4bqjaSBu4bqxbSB0cm9uZyA4LTMyMCBrYnBzLic7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoc2V0dGluZ3Muc2FtcGxlUmF0ZSA8IDgwMDAgfHwgc2V0dGluZ3Muc2FtcGxlUmF0ZSA+IDQ4MDAwKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuICdTYW1wbGUgcmF0ZSBwaOG6o2kgbuG6sW0gdHJvbmcgODAwMC00ODAwMCBIei4nO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHNldHRpbmdzLmNoYW5uZWxzICE9PSAxICYmIHNldHRpbmdzLmNoYW5uZWxzICE9PSAyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuICdT4buRIGNoYW5uZWwgY2jhu4kgY8OzIHRo4buDIGzDoCAxIGhv4bq3YyAyLic7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuICcnO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgYXN5bmMgb3BlbkNvbXByZXNzaW9uKGFzc2V0OiBNZWRpYUFzc2V0KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY29tcHJlc3Npb25Bc3NldCA9IGFzc2V0O1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmNvbXByZXNzaW9uRXJyb3IgPSAnJztcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5vcmlnaW5hbE1ldHJpY3MgPSBudWxsO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLm91dHB1dE1ldHJpY3MgPSBudWxsO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmNvbXByZXNzZWRQcmV2aWV3VXJsID0gJyc7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY29tcHJlc3NlZEZpbGVQYXRoID0gJyc7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuaW1hZ2VEaW1lbnNpb25zID0gbnVsbDtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5pbWFnZUNvbXByZXNzb3IgPSBhc3NldC5leHRlbnNpb24gPT09ICcuanBnJyA/ICdzaGFycCcgOiAncG5ncXVhbnQnO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmFwcGx5Q29tcHJlc3Npb25QcmVzZXQoJ2JhbGFuY2VkJyk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlcXVlc3RJZCA9ICsrdGhpcy5jb21wcmVzc2lvblJlcXVlc3RJZDtcblxuICAgICAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgW21ldHJpY3MsIGRpbWVuc2lvbnNdID0gYXdhaXQgUHJvbWlzZS5hbGwoW1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNhbGN1bGF0ZUZpbGVNZXRyaWNzKGFzc2V0LmZpbGVQYXRoLCBhc3NldC5uYW1lKSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmlzSW1hZ2UoYXNzZXQpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID8gZ2V0SW1hZ2VEaW1lbnNpb25zKGFzc2V0LmZpbGVQYXRoKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA6IFByb21pc2UucmVzb2x2ZShudWxsKSxcbiAgICAgICAgICAgICAgICAgICAgICAgIF0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHJlcXVlc3RJZCA9PT0gdGhpcy5jb21wcmVzc2lvblJlcXVlc3RJZCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMub3JpZ2luYWxNZXRyaWNzID0gbWV0cmljcztcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmltYWdlRGltZW5zaW9ucyA9IGRpbWVuc2lvbnM7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGRpbWVuc2lvbnMpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5yZXNldFJlc2l6ZU9wdGlvbnMoZGltZW5zaW9ucyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHJlcXVlc3RJZCA9PT0gdGhpcy5jb21wcmVzc2lvblJlcXVlc3RJZCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuY29tcHJlc3Npb25FcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3JcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPyBlcnJvci5tZXNzYWdlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDogJ0tow7RuZyB0aOG7gyDEkeG7jWMgdGjDtG5nIHRpbiBmaWxlIGfhu5FjLic7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGFzeW5jIGNyZWF0ZUNvbXByZXNzaW9uUHJldmlldygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgYXNzZXQgPSB0aGlzLmNvbXByZXNzaW9uQXNzZXQ7XG4gICAgICAgICAgICAgICAgICAgIGlmICghYXNzZXQgfHwgIXRoaXMuaXNDb21wcmVzc2lvblN1cHBvcnRlZChhc3NldCkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHZhbGlkYXRpb25FcnJvciA9IHRoaXMudmFsaWRhdGVDb21wcmVzc2lvblNldHRpbmdzKCk7XG4gICAgICAgICAgICAgICAgICAgIGlmICh2YWxpZGF0aW9uRXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuY29tcHJlc3Npb25FcnJvciA9IHZhbGlkYXRpb25FcnJvcjtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY29tcHJlc3Npb25Mb2FkaW5nID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jb21wcmVzc2lvbkVycm9yID0gJyc7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuaW52YWxpZGF0ZUNvbXByZXNzaW9uUHJldmlldygpO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCByZXF1ZXN0SWQgPSArK3RoaXMuY29tcHJlc3Npb25SZXF1ZXN0SWQ7XG5cbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLmNvbXByZXNzaW9uVGVtcERpcmVjdG9yeSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IHJlbW92ZSh0aGlzLmNvbXByZXNzaW9uVGVtcERpcmVjdG9yeSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB0ZW1wRGlyZWN0b3J5ID0gYXdhaXQgbWtkdGVtcChqb2luKHRtcGRpcigpLCAnY2MtYXNzZXRzLWNvbXByZXNzLScpKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuY29tcHJlc3Npb25UZW1wRGlyZWN0b3J5ID0gdGVtcERpcmVjdG9yeTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IG91dHB1dFBhdGggPSBhd2FpdCBjb21wcmVzc0ZpbGUoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYXNzZXQuZmlsZVBhdGgsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYXNzZXQuZXh0ZW5zaW9uLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRlbXBEaXJlY3RvcnksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5pbWFnZUNvbXByZXNzb3IsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgeyAuLi50aGlzLmNvbXByZXNzaW9uU2V0dGluZ3MgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBtZXRyaWNzID0gYXdhaXQgY2FsY3VsYXRlRmlsZU1ldHJpY3Mob3V0cHV0UGF0aCwgYXNzZXQubmFtZSk7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChyZXF1ZXN0SWQgIT09IHRoaXMuY29tcHJlc3Npb25SZXF1ZXN0SWQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCByZW1vdmUodGVtcERpcmVjdG9yeSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmNvbXByZXNzZWRGaWxlUGF0aCA9IG91dHB1dFBhdGg7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmNvbXByZXNzZWRQcmV2aWV3VXJsID0gYCR7cGF0aFRvRmlsZVVSTChvdXRwdXRQYXRoKS5ocmVmfT92PSR7RGF0ZS5ub3coKX1gO1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5vdXRwdXRNZXRyaWNzID0gbWV0cmljcztcbiAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChyZXF1ZXN0SWQgPT09IHRoaXMuY29tcHJlc3Npb25SZXF1ZXN0SWQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmNvbXByZXNzaW9uRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID8gZXJyb3IubWVzc2FnZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA6ICdLaMO0bmcgdGjhu4MgdOG6oW8gYuG6o24gbsOpbi4nO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHJlcXVlc3RJZCA9PT0gdGhpcy5jb21wcmVzc2lvblJlcXVlc3RJZCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuY29tcHJlc3Npb25Mb2FkaW5nID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGFzeW5jIGFwcGx5Q29tcHJlc3NlZEFzc2V0KCk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBhc3NldCA9IHRoaXMuY29tcHJlc3Npb25Bc3NldDtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFhc3NldCB8fCAhdGhpcy5jb21wcmVzc2VkRmlsZVBhdGggfHwgIXRoaXMub3V0cHV0TWV0cmljcykge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGlmICghd2luZG93LmNvbmZpcm0oYEdoaSDEkcOoIGZpbGUgZ+G7kWMgJHthc3NldC5uYW1lfSBi4bqxbmcgYuG6o24gxJHDoyBuw6luP2ApKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICB0aGlzLmNvbXByZXNzaW9uQXBwbHlpbmcgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmNvbXByZXNzaW9uRXJyb3IgPSAnJztcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGNyZWF0ZU9yaWdpbmFsQmFja3VwKGFzc2V0LmZpbGVQYXRoLCBhc3NldC5iYWNrdXBQYXRoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IHJlcGxhY2VPcmlnaW5hbEZpbGUodGhpcy5jb21wcmVzc2VkRmlsZVBhdGgsIGFzc2V0LmZpbGVQYXRoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ2Fzc2V0LWRiJywgJ3JlaW1wb3J0LWFzc2V0JywgYXNzZXQudXVpZCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmxvYWRBc3NldHMoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuY2xvc2VDb21wcmVzc2lvbigpO1xuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5jb21wcmVzc2lvbkVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgID8gZXJyb3IubWVzc2FnZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDogJ0tow7RuZyB0aOG7gyDDoXAgZOG7pW5nIGZpbGUgxJHDoyBuw6luLic7XG4gICAgICAgICAgICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmNvbXByZXNzaW9uQXBwbHlpbmcgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgYXN5bmMgcmV2ZXJ0QXNzZXQoYXNzZXQ6IE1lZGlhQXNzZXQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFhc3NldC5jYW5SZXZlcnQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBpZiAoIXdpbmRvdy5jb25maXJtKGBLaMO0aSBwaOG7pWMgZmlsZSBn4buRYyB0csaw4bubYyBraGkgY29tcHJlc3MgY2hvICR7YXNzZXQubmFtZX0/YCkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9hZGluZyA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZXJyb3JNZXNzYWdlID0gJyc7XG4gICAgICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCByZXN0b3JlT3JpZ2luYWxCYWNrdXAoYXNzZXQuYmFja3VwUGF0aCwgYXNzZXQuZmlsZVBhdGgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnYXNzZXQtZGInLCAncmVpbXBvcnQtYXNzZXQnLCBhc3NldC51dWlkKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMubG9hZEFzc2V0cygpO1xuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5lcnJvck1lc3NhZ2UgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPyBlcnJvci5tZXNzYWdlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgOiAnS2jDtG5nIHRo4buDIGtow7RpIHBo4bulYyBmaWxlIGfhu5FjLic7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmxvYWRpbmcgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgYXN5bmMgY2xvc2VDb21wcmVzc2lvbigpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jb21wcmVzc2lvblJlcXVlc3RJZCArPSAxO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCB0ZW1wRGlyZWN0b3J5ID0gdGhpcy5jb21wcmVzc2lvblRlbXBEaXJlY3Rvcnk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY29tcHJlc3Npb25Bc3NldCA9IG51bGw7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY29tcHJlc3Npb25Mb2FkaW5nID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY29tcHJlc3Npb25FcnJvciA9ICcnO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmNvbXByZXNzZWRQcmV2aWV3VXJsID0gJyc7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY29tcHJlc3NlZEZpbGVQYXRoID0gJyc7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMub3V0cHV0TWV0cmljcyA9IG51bGw7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuaW1hZ2VEaW1lbnNpb25zID0gbnVsbDtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jb21wcmVzc2lvblRlbXBEaXJlY3RvcnkgPSAnJztcbiAgICAgICAgICAgICAgICAgICAgaWYgKHRlbXBEaXJlY3RvcnkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgcmVtb3ZlKHRlbXBEaXJlY3RvcnkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oYFtjYy1hc3NldHMtY29tcHJlc3NdIENhbm5vdCByZW1vdmUgdGVtcCBkaXJlY3Rvcnk6ICR7dGVtcERpcmVjdG9yeX1gLCBlcnJvcik7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGFzeW5jIGxvYWRBc3NldHMoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9hZGluZyA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZXJyb3JNZXNzYWdlID0gJyc7XG5cbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGFzc2V0RGJJdGVtcyA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2Fzc2V0LWRiJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAncXVlcnktYXNzZXRzJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB7IGV4dG5hbWU6IEFycmF5LmZyb20oc3VwcG9ydGVkRXh0ZW5zaW9ucykgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBbJ3V1aWQnLCAnZmlsZScsICd1cmwnLCAnc291cmNlJywgJ2lzRGlyZWN0b3J5J10sXG4gICAgICAgICAgICAgICAgICAgICAgICApIGFzIEFzc2V0RGJJbmZvW107XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHByb2plY3RJdGVtcyA9IGFzc2V0RGJJdGVtcy5maWx0ZXIoKGFzc2V0KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdXJsID0gYXNzZXQudXJsIHx8IGFzc2V0LnNvdXJjZSB8fCAnJztcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gdXJsLnN0YXJ0c1dpdGgoJ2RiOi8vYXNzZXRzLycpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBMaW1pdCBzaW11bHRhbmVvdXMgQmFzZTY0L0pTWmlwIHdvcmsgdG8gYXZvaWQgYSBtZW1vcnkgc3Bpa2Ugb24gbGFyZ2UgcHJvamVjdHMuXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCByZXN1bHRzID0gYXdhaXQgbWFwV2l0aENvbmN1cnJlbmN5KHByb2plY3RJdGVtcywgNCwgY3JlYXRlTWVkaWFBc3NldCk7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuYXNzZXRzID0gcmVzdWx0c1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC5maWx0ZXIoKGFzc2V0KTogYXNzZXQgaXMgTWVkaWFBc3NldCA9PiBhc3NldCAhPT0gbnVsbClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAuc29ydCgobGVmdCwgcmlnaHQpID0+IGxlZnQucGF0aC5sb2NhbGVDb21wYXJlKHJpZ2h0LnBhdGgpKTtcbiAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuZXJyb3JNZXNzYWdlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgID8gZXJyb3IubWVzc2FnZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDogJ0tow7RuZyB0aOG7gyB04bqjaSBkYW5oIHPDoWNoIHTDoGkgbmd1ecOqbi4nO1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignW2NjLWFzc2V0cy1jb21wcmVzc10gRmFpbGVkIHRvIGxvYWQgYXNzZXRzJywgZXJyb3IpO1xuICAgICAgICAgICAgICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2FkaW5nID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIG1vdW50ZWQoKSB7XG4gICAgICAgICAgICAgICAgdm9pZCB0aGlzLmxvYWRBc3NldHMoKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgIH0pKTtcblxuICAgICAgICBhcHAuY29uZmlnLmNvbXBpbGVyT3B0aW9ucy5pc0N1c3RvbUVsZW1lbnQgPSAodGFnKSA9PiB0YWcuc3RhcnRzV2l0aCgndWktJyk7XG4gICAgICAgIGFwcC5jb21wb25lbnQoJ0ltYWdlVmlld2VyJywgSW1hZ2VWaWV3ZXIpO1xuICAgICAgICBjb25zdCB2aWV3TW9kZWwgPSBhcHAubW91bnQodGhpcy4kLmFwcCkgYXMgdW5rbm93biBhcyB7XG4gICAgICAgICAgICBjbG9zZUNvbXByZXNzaW9uOiAoKSA9PiBQcm9taXNlPHZvaWQ+O1xuICAgICAgICB9O1xuICAgICAgICBwYW5lbERhdGFNYXAuc2V0KHRoaXMsIHtcbiAgICAgICAgICAgIGFwcCxcbiAgICAgICAgICAgIGNsZWFudXA6ICgpID0+IHtcbiAgICAgICAgICAgICAgICB2b2lkIHZpZXdNb2RlbC5jbG9zZUNvbXByZXNzaW9uKCk7XG4gICAgICAgICAgICB9LFxuICAgICAgICB9KTtcbiAgICB9LFxuICAgIGJlZm9yZUNsb3NlKCkge30sXG4gICAgY2xvc2UoKSB7XG4gICAgICAgIGNvbnN0IHBhbmVsRGF0YSA9IHBhbmVsRGF0YU1hcC5nZXQodGhpcyk7XG4gICAgICAgIGlmIChwYW5lbERhdGEpIHtcbiAgICAgICAgICAgIHBhbmVsRGF0YS5jbGVhbnVwKCk7XG4gICAgICAgICAgICBwYW5lbERhdGEuYXBwLnVubW91bnQoKTtcbiAgICAgICAgICAgIHBhbmVsRGF0YU1hcC5kZWxldGUodGhpcyk7XG4gICAgICAgIH1cbiAgICB9LFxufSk7XG4iXX0=