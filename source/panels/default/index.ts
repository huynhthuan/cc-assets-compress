import { mkdtemp, pathExists, readFileSync, remove } from 'fs-extra';
import { tmpdir } from 'os';
import { basename, extname, join } from 'path';
import { pathToFileURL } from 'url';
import { App, createApp, defineComponent } from 'vue';
import {
    calculateFileMetrics,
    compressFile,
    CompressionSettings,
    createOriginalBackup,
    FileMetrics,
    getImageDimensions,
    ImageDimensions,
    ImageCompressor,
    replaceOriginalFile,
    restoreOriginalBackup,
} from '../../compression';

type SortColumn = '' | 'size' | 'base64Size' | 'zipSize';

interface MediaAsset {
    uuid: string;
    name: string;
    path: string;
    filePath: string;
    previewUrl: string;
    extension: string;
    size: number;
    base64Size: number;
    zipSize: number;
    backupPath: string;
    canRevert: boolean;
}

interface AssetDbInfo {
    uuid: string;
    file: string;
    url: string;
    source: string;
    isDirectory: boolean;
}

interface PanelData {
    app: App;
    cleanup: () => void;
}

const panelDataMap = new WeakMap<object, PanelData>();
const supportedExtensions = new Set(['.png', '.jpg', '.mp3']);

function getBackupPath(uuid: string, extension: string): string {
    return join(Editor.Project.tmpDir, 'cc-assets-compress-backups', `${uuid}${extension}`);
}

function formatFileSize(bytes: number): string {
    if (bytes === 0) {
        return '0 B';
    }

    const units = ['B', 'KB', 'MB', 'GB'];
    const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / Math.pow(1024, unitIndex);
    return `${value.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

const ImageViewer = defineComponent({
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
        imageTransform(): string {
            return `translate(${this.translateX}px, ${this.translateY}px) scale(${this.scale})`;
        },
        zoomLabel(): string {
            return `${Math.round(this.scale * 100)}%`;
        },
    },
    watch: {
        src() {
            this.resetView();
        },
    },
    methods: {
        clampScale(scale: number): number {
            return Math.min(8, Math.max(0.25, scale));
        },
        setScale(scale: number): void {
            this.scale = this.clampScale(scale);
            if (this.scale === 1) {
                this.translateX = 0;
                this.translateY = 0;
            }
        },
        zoomIn(): void {
            this.setScale(this.scale * 1.25);
        },
        zoomOut(): void {
            this.setScale(this.scale / 1.25);
        },
        onWheel(event: WheelEvent): void {
            this.setScale(this.scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15));
        },
        resetView(): void {
            this.scale = 1;
            this.translateX = 0;
            this.translateY = 0;
            this.dragging = false;
        },
        startDrag(event: PointerEvent): void {
            if (event.button !== 0) {
                return;
            }
            this.dragging = true;
            this.pointerId = event.pointerId;
            this.dragStartX = event.clientX;
            this.dragStartY = event.clientY;
            this.translateStartX = this.translateX;
            this.translateStartY = this.translateY;
            (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        },
        drag(event: PointerEvent): void {
            if (!this.dragging || event.pointerId !== this.pointerId) {
                return;
            }
            this.translateX = this.translateStartX + event.clientX - this.dragStartX;
            this.translateY = this.translateStartY + event.clientY - this.dragStartY;
        },
        endDrag(event: PointerEvent): void {
            if (event.pointerId !== this.pointerId) {
                return;
            }
            this.dragging = false;
            const target = event.currentTarget as HTMLElement;
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

async function createMediaAsset(asset: AssetDbInfo): Promise<MediaAsset | null> {
    const extension = extname(asset.file).toLowerCase();
    if (asset.isDirectory || !supportedExtensions.has(extension)) {
        return null;
    }

    try {
        const name = basename(asset.file);
        const backupPath = getBackupPath(asset.uuid, extension);
        const [metrics, canRevert] = await Promise.all([
            calculateFileMetrics(asset.file, name),
            pathExists(backupPath),
        ]);
        return {
            uuid: asset.uuid,
            name,
            path: asset.url || asset.source,
            filePath: asset.file,
            previewUrl: pathToFileURL(asset.file).href,
            extension,
            size: metrics.fileSize,
            base64Size: metrics.base64Size,
            zipSize: metrics.zipSize,
            backupPath,
            canRevert,
        };
    } catch (error) {
        console.warn(`[cc-assets-compress] Cannot read file: ${asset.file}`, error);
        return null;
    }
}

async function mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    mapper: (item: T) => Promise<R>,
): Promise<R[]> {
    const results = new Array<R>(items.length);
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
    template: readFileSync(join(__dirname, '../../../static/template/default/index.html'), 'utf-8'),
    style: readFileSync(join(__dirname, '../../../static/style/default/index.css'), 'utf-8'),
    $: {
        app: '#app',
    },
    methods: {},
    ready() {
        if (!this.$.app) {
            return;
        }

        const app = createApp(defineComponent({
            data() {
                return {
                    assets: [] as MediaAsset[],
                    loading: false,
                    errorMessage: '',
                    searchQuery: '',
                    extensionFilter: '',
                    sortColumn: '' as SortColumn,
                    sortDirection: '' as '' | 'asc' | 'desc',
                    currentPage: 1,
                    pageSize: 10,
                    selectedAsset: null as MediaAsset | null,
                    detailLoading: false,
                    base64Size: null as number | null,
                    compressedSize: null as number | null,
                    detailError: '',
                    detailRequestId: 0,
                    compressionAsset: null as MediaAsset | null,
                    imageCompressor: 'pngquant' as ImageCompressor,
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
                    } as CompressionSettings,
                    imageDimensions: null as ImageDimensions | null,
                    resizeMode: 'percent' as 'percent' | 'pixels',
                    resizePercent: 100,
                    resizeWidth: 0,
                    resizeHeight: 0,
                    compressionLoading: false,
                    compressionApplying: false,
                    compressionError: '',
                    originalMetrics: null as FileMetrics | null,
                    outputMetrics: null as FileMetrics | null,
                    compressedPreviewUrl: '',
                    compressedFilePath: '',
                    compressionTempDirectory: '',
                    compressionRequestId: 0,
                };
            },
            computed: {
                visibleAssets(): MediaAsset[] {
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
                    const sortColumn = this.sortColumn as Exclude<SortColumn, ''>;
                    return [...filteredAssets].sort((left, right) => {
                        const sizeDifference = (left[sortColumn] - right[sortColumn]) * direction;
                        return sizeDifference || left.path.localeCompare(right.path);
                    });
                },
                totalPages(): number {
                    return Math.max(1, Math.ceil(this.visibleAssets.length / this.pageSize));
                },
                paginatedAssets(): MediaAsset[] {
                    const startIndex = (this.currentPage - 1) * this.pageSize;
                    return this.visibleAssets.slice(startIndex, startIndex + this.pageSize);
                },
                pageNumbers(): number[] {
                    const firstPage = Math.max(1, Math.min(
                        this.currentPage - 2,
                        this.totalPages - 4,
                    ));
                    const lastPage = Math.min(this.totalPages, firstPage + 4);
                    const pages: number[] = [];
                    for (let page = firstPage; page <= lastPage; page += 1) {
                        pages.push(page);
                    }
                    return pages;
                },
                pageRangeText(): string {
                    if (this.visibleAssets.length === 0) {
                        return '0 tệp';
                    }
                    const firstItem = (this.currentPage - 1) * this.pageSize + 1;
                    const lastItem = Math.min(this.currentPage * this.pageSize, this.visibleAssets.length);
                    return `${firstItem}-${lastItem} / ${this.visibleAssets.length} tệp`;
                },
                statusText(): string {
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
                isImage(asset: MediaAsset): boolean {
                    return asset.extension === '.png' || asset.extension === '.jpg';
                },
                toggleSort(column: Exclude<SortColumn, ''>): void {
                    if (this.sortColumn !== column) {
                        this.sortColumn = column;
                        this.sortDirection = 'asc';
                    } else if (this.sortDirection === 'asc') {
                        this.sortDirection = 'desc';
                    } else {
                        this.sortColumn = '';
                        this.sortDirection = '';
                    }
                },
                sortIndicator(column: Exclude<SortColumn, ''>): string {
                    if (this.sortColumn !== column) {
                        return '⇅';
                    }
                    return this.sortDirection === 'asc' ? '▲' : '▼';
                },
                goToPage(page: number): void {
                    this.currentPage = Math.min(Math.max(page, 1), this.totalPages);
                },
                compressionResult(): string {
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
                metricDifference(before: number, after: number): string {
                    if (before === 0) {
                        return '0%';
                    }
                    const difference = (1 - after / before) * 100;
                    return difference >= 0
                        ? `Giảm ${difference.toFixed(2)}%`
                        : `Tăng ${Math.abs(difference).toFixed(2)}%`;
                },
                async openAssetDetails(asset: MediaAsset): Promise<void> {
                    this.selectedAsset = asset;
                    this.base64Size = null;
                    this.compressedSize = null;
                    this.detailError = '';
                    this.detailLoading = true;
                    const requestId = ++this.detailRequestId;

                    try {
                        const metrics = await calculateFileMetrics(asset.filePath, asset.name);

                        if (requestId !== this.detailRequestId) {
                            return;
                        }

                        this.base64Size = metrics.base64Size;
                        this.compressedSize = metrics.zipSize;
                    } catch (error) {
                        if (requestId !== this.detailRequestId) {
                            return;
                        }
                        this.detailError = error instanceof Error
                            ? error.message
                            : 'Không thể phân tích tệp.';
                        console.error(`[cc-assets-compress] Cannot inspect ${asset.filePath}`, error);
                    } finally {
                        if (requestId === this.detailRequestId) {
                            this.detailLoading = false;
                        }
                    }
                },
                closeAssetDetails(): void {
                    this.detailRequestId += 1;
                    this.selectedAsset = null;
                    this.detailLoading = false;
                    this.detailError = '';
                },
                isCompressionSupported(asset: MediaAsset): boolean {
                    return asset.extension === '.png'
                        || asset.extension === '.jpg'
                        || asset.extension === '.mp3';
                },
                applyCompressionPreset(preset: string): void {
                    this.compressionPreset = preset;
                    const isAudio = this.compressionAsset?.extension === '.mp3';

                    if (isAudio) {
                        const presets: Record<string, Partial<CompressionSettings>> = {
                            high: { audioBitrate: 192, sampleRate: 48000, channels: 2 },
                            balanced: { audioBitrate: 128, sampleRate: 44100, channels: 2 },
                            small: { audioBitrate: 64, sampleRate: 22050, channels: 1 },
                        };
                        Object.assign(this.compressionSettings, presets[preset] || {});
                    } else if (this.imageCompressor === 'sharp') {
                        const isJpeg = this.compressionAsset?.extension === '.jpg';
                        const presets: Record<string, Partial<CompressionSettings>> = isJpeg
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
                    } else {
                        const presets: Record<string, Partial<CompressionSettings>> = {
                            high: { qualityMin: 75, qualityMax: 95, speed: 3, colors: 256, dithering: 0.8 },
                            balanced: { qualityMin: 55, qualityMax: 80, speed: 6, colors: 192, dithering: 0.7 },
                            small: { qualityMin: 30, qualityMax: 60, speed: 9, colors: 128, dithering: 0.5 },
                        };
                        Object.assign(this.compressionSettings, presets[preset] || {});
                    }
                    this.invalidateCompressionPreview();
                },
                changeImageCompressor(): void {
                    if (this.compressionAsset?.extension === '.jpg') {
                        this.imageCompressor = 'sharp';
                    }
                    this.applyCompressionPreset('balanced');
                },
                resetResizeOptions(dimensions: ImageDimensions): void {
                    this.resizeMode = 'percent';
                    this.resizePercent = 100;
                    this.resizeWidth = dimensions.width;
                    this.resizeHeight = dimensions.height;
                    this.compressionSettings.resizeWidth = null;
                    this.compressionSettings.resizeHeight = null;
                    this.invalidateCompressionPreview();
                },
                changeResizeMode(): void {
                    if (this.resizeMode === 'percent') {
                        this.updateResizeFromPercent();
                    } else {
                        this.updateResizeFromWidth();
                    }
                },
                updateResizeFromPercent(): void {
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
                updateResizeFromWidth(): void {
                    if (!this.imageDimensions || this.resizeWidth <= 0) {
                        return;
                    }
                    this.resizeHeight = Math.max(1, Math.round(
                        this.resizeWidth * this.imageDimensions.height / this.imageDimensions.width,
                    ));
                    this.resizePercent = Number((this.resizeWidth / this.imageDimensions.width * 100).toFixed(2));
                    this.updateResizeSettings();
                },
                updateResizeFromHeight(): void {
                    if (!this.imageDimensions || this.resizeHeight <= 0) {
                        return;
                    }
                    this.resizeWidth = Math.max(1, Math.round(
                        this.resizeHeight * this.imageDimensions.width / this.imageDimensions.height,
                    ));
                    this.resizePercent = Number((this.resizeHeight / this.imageDimensions.height * 100).toFixed(2));
                    this.updateResizeSettings();
                },
                updateResizeSettings(): void {
                    if (!this.imageDimensions) {
                        return;
                    }
                    const unchanged = this.resizeWidth === this.imageDimensions.width
                        && this.resizeHeight === this.imageDimensions.height;
                    this.compressionSettings.resizeWidth = unchanged ? null : this.resizeWidth;
                    this.compressionSettings.resizeHeight = unchanged ? null : this.resizeHeight;
                    this.useCustomCompressionSettings();
                },
                useCustomCompressionSettings(): void {
                    this.compressionPreset = 'custom';
                    this.invalidateCompressionPreview();
                },
                invalidateCompressionPreview(): void {
                    this.outputMetrics = null;
                    this.compressedPreviewUrl = '';
                    this.compressedFilePath = '';
                    this.compressionError = '';
                },
                validateCompressionSettings(): string {
                    const settings = this.compressionSettings;
                    if (this.compressionAsset && this.isImage(this.compressionAsset)) {
                        if (this.resizeWidth < 1 || this.resizeHeight < 1
                            || this.resizeWidth > 16384 || this.resizeHeight > 16384) {
                            return 'Kích thước resize phải nằm trong 1-16384 px.';
                        }
                    }
                    if (this.compressionAsset?.extension === '.png' && this.imageCompressor === 'pngquant') {
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
                    } else if ((this.compressionAsset?.extension === '.png'
                        || this.compressionAsset?.extension === '.jpg')
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
                    } else if (this.compressionAsset?.extension === '.mp3') {
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
                async openCompression(asset: MediaAsset): Promise<void> {
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
                            calculateFileMetrics(asset.filePath, asset.name),
                            this.isImage(asset)
                                ? getImageDimensions(asset.filePath)
                                : Promise.resolve(null),
                        ]);
                        if (requestId === this.compressionRequestId) {
                            this.originalMetrics = metrics;
                            this.imageDimensions = dimensions;
                            if (dimensions) {
                                this.resetResizeOptions(dimensions);
                            }
                        }
                    } catch (error) {
                        if (requestId === this.compressionRequestId) {
                            this.compressionError = error instanceof Error
                                ? error.message
                                : 'Không thể đọc thông tin file gốc.';
                        }
                    }
                },
                async createCompressionPreview(): Promise<void> {
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
                            await remove(this.compressionTempDirectory);
                        }
                        const tempDirectory = await mkdtemp(join(tmpdir(), 'cc-assets-compress-'));
                        this.compressionTempDirectory = tempDirectory;
                        const outputPath = await compressFile(
                            asset.filePath,
                            asset.extension,
                            tempDirectory,
                            this.imageCompressor,
                            { ...this.compressionSettings },
                        );
                        const metrics = await calculateFileMetrics(outputPath, asset.name);

                        if (requestId !== this.compressionRequestId) {
                            await remove(tempDirectory);
                            return;
                        }

                        this.compressedFilePath = outputPath;
                        this.compressedPreviewUrl = `${pathToFileURL(outputPath).href}?v=${Date.now()}`;
                        this.outputMetrics = metrics;
                    } catch (error) {
                        if (requestId === this.compressionRequestId) {
                            this.compressionError = error instanceof Error
                                ? error.message
                                : 'Không thể tạo bản nén.';
                        }
                    } finally {
                        if (requestId === this.compressionRequestId) {
                            this.compressionLoading = false;
                        }
                    }
                },
                async applyCompressedAsset(): Promise<void> {
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
                        await createOriginalBackup(asset.filePath, asset.backupPath);
                        await replaceOriginalFile(this.compressedFilePath, asset.filePath);
                        await Editor.Message.request('asset-db', 'reimport-asset', asset.uuid);
                        await this.loadAssets();
                        await this.closeCompression();
                    } catch (error) {
                        this.compressionError = error instanceof Error
                            ? error.message
                            : 'Không thể áp dụng file đã nén.';
                    } finally {
                        this.compressionApplying = false;
                    }
                },
                async revertAsset(asset: MediaAsset): Promise<void> {
                    if (!asset.canRevert) {
                        return;
                    }
                    if (!window.confirm(`Khôi phục file gốc trước khi compress cho ${asset.name}?`)) {
                        return;
                    }

                    this.loading = true;
                    this.errorMessage = '';
                    try {
                        await restoreOriginalBackup(asset.backupPath, asset.filePath);
                        await Editor.Message.request('asset-db', 'reimport-asset', asset.uuid);
                        await this.loadAssets();
                    } catch (error) {
                        this.errorMessage = error instanceof Error
                            ? error.message
                            : 'Không thể khôi phục file gốc.';
                        this.loading = false;
                    }
                },
                async closeCompression(): Promise<void> {
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
                            await remove(tempDirectory);
                        } catch (error) {
                            console.warn(`[cc-assets-compress] Cannot remove temp directory: ${tempDirectory}`, error);
                        }
                    }
                },
                async loadAssets(): Promise<void> {
                    this.loading = true;
                    this.errorMessage = '';

                    try {
                        const assetDbItems = await Editor.Message.request(
                            'asset-db',
                            'query-assets',
                            { extname: Array.from(supportedExtensions) },
                            ['uuid', 'file', 'url', 'source', 'isDirectory'],
                        ) as AssetDbInfo[];

                        const projectItems = assetDbItems.filter((asset) => {
                            const url = asset.url || asset.source || '';
                            return url.startsWith('db://assets/');
                        });
                        // Limit simultaneous Base64/JSZip work to avoid a memory spike on large projects.
                        const results = await mapWithConcurrency(projectItems, 4, createMediaAsset);

                        this.assets = results
                            .filter((asset): asset is MediaAsset => asset !== null)
                            .sort((left, right) => left.path.localeCompare(right.path));
                    } catch (error) {
                        this.errorMessage = error instanceof Error
                            ? error.message
                            : 'Không thể tải danh sách tài nguyên.';
                        console.error('[cc-assets-compress] Failed to load assets', error);
                    } finally {
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
        const viewModel = app.mount(this.$.app) as unknown as {
            closeCompression: () => Promise<void>;
        };
        panelDataMap.set(this, {
            app,
            cleanup: () => {
                void viewModel.closeCompression();
            },
        });
    },
    beforeClose() {},
    close() {
        const panelData = panelDataMap.get(this);
        if (panelData) {
            panelData.cleanup();
            panelData.app.unmount();
            panelDataMap.delete(this);
        }
    },
});
