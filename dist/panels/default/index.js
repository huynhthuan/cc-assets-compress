"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs_extra_1 = require("fs-extra");
const os_1 = require("os");
const path_1 = require("path");
const url_1 = require("url");
const vue_1 = require("vue");
const compression_1 = require("../../compression");
const i18n_1 = require("../../i18n");
const panelDataMap = new WeakMap();
const imageExtensions = new Set(['.png', '.jpg', '.webp']);
const audioExtensions = new Set(['.mp3', '.wav', '.ogg']);
const supportedExtensions = new Set([...imageExtensions, ...audioExtensions]);
const imageConversionExtensions = ['.png', '.jpg', '.webp'];
const audioConversionExtensions = ['.mp3', '.wav', '.ogg'];
const languageStorageKey = 'cc-assets-compress.language';
function getInitialLanguage() {
    try {
        const savedLanguage = localStorage.getItem(languageStorageKey);
        if (savedLanguage === 'en' || savedLanguage === 'zh' || savedLanguage === 'vi') {
            return savedLanguage;
        }
    }
    catch (error) {
        console.warn('[cc-assets-compress] Cannot read the saved language', error);
    }
    return (0, i18n_1.getLanguage)();
}
function isSerializedObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function containsAssetUuid(value, targetUuid) {
    if (Array.isArray(value)) {
        return value.some((item) => containsAssetUuid(item, targetUuid));
    }
    if (!isSerializedObject(value)) {
        return false;
    }
    if (value.__uuid__ === targetUuid) {
        return true;
    }
    return Object.values(value).some((item) => containsAssetUuid(item, targetUuid));
}
function getSerializedId(value) {
    return isSerializedObject(value) && typeof value.__id__ === 'number'
        ? value.__id__
        : null;
}
function containsSerializedId(value, targetId) {
    if (Array.isArray(value)) {
        return value.some((item) => containsSerializedId(item, targetId));
    }
    if (!isSerializedObject(value)) {
        return false;
    }
    if (value.__id__ === targetId) {
        return true;
    }
    return Object.values(value).some((item) => containsSerializedId(item, targetId));
}
function isSerializedNode(value) {
    return isSerializedObject(value)
        && typeof value.__type__ === 'string'
        && (value.__type__ === 'cc.Node' || value.__type__.endsWith('.Node'));
}
function findOwnerNodeIndex(entries, entryIndex) {
    var _a;
    const visited = new Set();
    const queue = [entryIndex];
    while (queue.length > 0) {
        const currentIndex = queue.shift();
        if (visited.has(currentIndex)) {
            continue;
        }
        visited.add(currentIndex);
        const entry = entries[currentIndex];
        if (isSerializedNode(entry)) {
            return currentIndex;
        }
        if (isSerializedObject(entry)) {
            const directNodeIndex = (_a = getSerializedId(entry.node)) !== null && _a !== void 0 ? _a : getSerializedId(entry._node);
            if (directNodeIndex !== null && isSerializedNode(entries[directNodeIndex])) {
                return directNodeIndex;
            }
        }
        for (let index = 0; index < entries.length; index += 1) {
            if (!visited.has(index) && containsSerializedId(entries[index], currentIndex)) {
                queue.push(index);
            }
        }
    }
    return null;
}
function buildHierarchyPath(entries, nodeIndex) {
    const names = [];
    const visited = new Set();
    let currentIndex = nodeIndex;
    while (currentIndex !== null && !visited.has(currentIndex)) {
        visited.add(currentIndex);
        const node = entries[currentIndex];
        if (!isSerializedObject(node)) {
            break;
        }
        const name = typeof node._name === 'string' && node._name
            ? node._name
            : 'Node';
        names.unshift(name);
        currentIndex = getSerializedId(node._parent);
    }
    return names.join('/');
}
function readSceneHierarchyReferences(filePath, targetUuid) {
    try {
        const serialized = JSON.parse((0, fs_extra_1.readFileSync)(filePath, 'utf8'));
        const entries = Array.isArray(serialized) ? serialized : [serialized];
        const references = new Map();
        entries.forEach((entry, entryIndex) => {
            if (!containsAssetUuid(entry, targetUuid)) {
                return;
            }
            const nodeIndex = findOwnerNodeIndex(entries, entryIndex);
            if (nodeIndex === null) {
                return;
            }
            const node = entries[nodeIndex];
            const hierarchyPath = buildHierarchyPath(entries, nodeIndex);
            const nodeUuid = isSerializedObject(node) && typeof node._id === 'string'
                ? node._id
                : undefined;
            references.set(`${nodeUuid || ''}:${hierarchyPath}`, { hierarchyPath, nodeUuid });
        });
        return Array.from(references.values());
    }
    catch (error) {
        console.warn(`[cc-assets-compress] Cannot inspect scene hierarchy: ${filePath}`, error);
        return [];
    }
}
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
        t: i18n_1.t,
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
                <button type="button" :title="t('viewer.zoom_out')" @click="zoomOut">−</button>
                <span>{{ zoomLabel }}</span>
                <button type="button" :title="t('viewer.zoom_in')" @click="zoomIn">+</button>
                <button type="button" :title="t('viewer.reset')" @click="resetView">{{ t('viewer.fit') }}</button>
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
        const initialLanguage = getInitialLanguage();
        (0, i18n_1.setLanguage)(initialLanguage);
        const app = (0, vue_1.createApp)((0, vue_1.defineComponent)({
            data() {
                return {
                    selectedLanguage: initialLanguage,
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
                    conversionAsset: null,
                    conversionTarget: '.png',
                    conversionLoading: false,
                    conversionError: '',
                    conversionResultPath: '',
                    deleteAssetTarget: null,
                    deleteReferences: [],
                    deleteBundlePaths: [],
                    deleteScanLoading: false,
                    deleteScanFailed: false,
                    deleteApplying: false,
                    deleteError: '',
                };
            },
            computed: {
                assetTypes() {
                    return Array.from(new Set(this.assets.map((asset) => asset.extension)))
                        .sort((left, right) => left.localeCompare(right));
                },
                conversionFormats() {
                    if (!this.conversionAsset) {
                        return [];
                    }
                    const formats = this.isImage(this.conversionAsset)
                        ? imageConversionExtensions
                        : audioConversionExtensions;
                    return formats.filter((extension) => { var _a; return extension !== ((_a = this.conversionAsset) === null || _a === void 0 ? void 0 : _a.extension); });
                },
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
                    void this.selectedLanguage;
                    if (this.visibleAssets.length === 0) {
                        return (0, i18n_1.t)('common.files_zero');
                    }
                    const firstItem = (this.currentPage - 1) * this.pageSize + 1;
                    const lastItem = Math.min(this.currentPage * this.pageSize, this.visibleAssets.length);
                    return `${firstItem}-${lastItem} / ${(0, i18n_1.t)('common.files_count', { count: this.visibleAssets.length })}`;
                },
                statusText() {
                    void this.selectedLanguage;
                    if (this.loading) {
                        return (0, i18n_1.t)('browser.loading_assets');
                    }
                    if (this.visibleAssets.length !== this.assets.length) {
                        return (0, i18n_1.t)('common.filtered_count', {
                            visible: this.visibleAssets.length,
                            total: this.assets.length,
                        });
                    }
                    return (0, i18n_1.t)('common.files_count', { count: this.assets.length });
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
                    if (this.extensionFilter && !this.assetTypes.includes(this.extensionFilter)) {
                        this.extensionFilter = '';
                    }
                },
            },
            methods: {
                t: i18n_1.t,
                formatFileSize,
                changeLanguage(event) {
                    const locale = event.target.value;
                    if (locale !== 'en' && locale !== 'zh' && locale !== 'vi') {
                        return;
                    }
                    this.selectedLanguage = locale;
                    (0, i18n_1.setLanguage)(locale);
                    try {
                        localStorage.setItem(languageStorageKey, locale);
                    }
                    catch (error) {
                        console.warn('[cc-assets-compress] Cannot save the selected language', error);
                    }
                    this.$forceUpdate();
                },
                isImage(asset) {
                    return imageExtensions.has(asset.extension);
                },
                isAudio(asset) {
                    return audioExtensions.has(asset.extension);
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
                        return (0, i18n_1.t)('common.cannot_evaluate');
                    }
                    const difference = (1 - this.compressedSize / this.selectedAsset.size) * 100;
                    if (difference > 0) {
                        return (0, i18n_1.t)('common.decrease', { percent: difference.toFixed(2) });
                    }
                    return (0, i18n_1.t)('common.increase', { percent: Math.abs(difference).toFixed(2) });
                },
                metricDifference(before, after) {
                    if (before === 0) {
                        return '0%';
                    }
                    const difference = (1 - after / before) * 100;
                    return difference >= 0
                        ? (0, i18n_1.t)('common.decrease', { percent: difference.toFixed(2) })
                        : (0, i18n_1.t)('common.increase', { percent: Math.abs(difference).toFixed(2) });
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
                            : (0, i18n_1.t)('errors.inspect_file');
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
                openConversion(asset) {
                    this.conversionAsset = asset;
                    this.conversionError = '';
                    this.conversionResultPath = '';
                    const formats = this.isImage(asset)
                        ? imageConversionExtensions
                        : audioConversionExtensions;
                    this.conversionTarget = formats.find((extension) => extension !== asset.extension)
                        || formats[0];
                },
                closeConversion() {
                    if (this.conversionLoading) {
                        return;
                    }
                    this.conversionAsset = null;
                    this.conversionError = '';
                    this.conversionResultPath = '';
                },
                async convertAsset() {
                    const asset = this.conversionAsset;
                    if (!asset || !this.conversionTarget) {
                        return;
                    }
                    this.conversionLoading = true;
                    this.conversionError = '';
                    this.conversionResultPath = '';
                    let tempDirectory = '';
                    try {
                        tempDirectory = await (0, fs_extra_1.mkdtemp)((0, path_1.join)((0, os_1.tmpdir)(), 'cc-assets-convert-'));
                        const outputPath = await (0, compression_1.convertFile)(asset.filePath, this.conversionTarget, tempDirectory);
                        const baseUrl = asset.path.slice(0, -asset.extension.length);
                        const requestedUrl = `${baseUrl}${this.conversionTarget}`;
                        const availableUrl = await Editor.Message.request('asset-db', 'generate-available-url', requestedUrl);
                        const createdAsset = await Editor.Message.request('asset-db', 'create-asset', availableUrl, (0, fs_extra_1.readFileSync)(outputPath));
                        if (!createdAsset) {
                            throw new Error((0, i18n_1.t)('errors.create_converted_asset'));
                        }
                        this.conversionResultPath = createdAsset.url || availableUrl;
                        await this.loadAssets();
                    }
                    catch (error) {
                        this.conversionError = error instanceof Error
                            ? error.message
                            : (0, i18n_1.t)('errors.convert_asset');
                    }
                    finally {
                        if (tempDirectory) {
                            try {
                                await (0, fs_extra_1.remove)(tempDirectory);
                            }
                            catch (error) {
                                console.warn(`[cc-assets-compress] Cannot remove conversion directory: ${tempDirectory}`, error);
                            }
                        }
                        this.conversionLoading = false;
                    }
                },
                async findAssetReferences(asset) {
                    const references = new Map();
                    const visited = new Set([asset.uuid]);
                    const queue = [asset.uuid];
                    while (queue.length > 0) {
                        const uuid = queue.shift();
                        const users = await Editor.Message.request('asset-db', 'query-asset-users', uuid, 'asset');
                        for (const userUuid of users || []) {
                            if (visited.has(userUuid)) {
                                continue;
                            }
                            visited.add(userUuid);
                            const info = await Editor.Message.request('asset-db', 'query-asset-info', userUuid, ['uuid', 'name', 'file', 'url', 'source', 'type', 'isDirectory']);
                            if (!info || info.isDirectory) {
                                continue;
                            }
                            const extension = (0, path_1.extname)(info.file || info.url || info.source).toLowerCase();
                            if (extension === '.scene') {
                                const hierarchyReferences = readSceneHierarchyReferences(info.file, uuid);
                                if (hierarchyReferences.length === 0) {
                                    references.set(`${info.uuid}:unknown`, {
                                        uuid: info.uuid,
                                        name: info.name || (0, path_1.basename)(info.file),
                                        path: info.url || info.source,
                                        kind: 'scene',
                                        referencedAssetUuid: uuid,
                                    });
                                    continue;
                                }
                                for (const hierarchyReference of hierarchyReferences) {
                                    const key = `${info.uuid}:${hierarchyReference.nodeUuid || hierarchyReference.hierarchyPath}`;
                                    references.set(key, {
                                        uuid: info.uuid,
                                        name: info.name || (0, path_1.basename)(info.file),
                                        path: info.url || info.source,
                                        kind: 'scene',
                                        hierarchyPath: hierarchyReference.hierarchyPath,
                                        nodeUuid: hierarchyReference.nodeUuid,
                                        referencedAssetUuid: uuid,
                                    });
                                }
                            }
                            else if (extension === '.prefab') {
                                references.set(info.uuid, {
                                    uuid: info.uuid,
                                    name: info.name || (0, path_1.basename)(info.file),
                                    path: info.url || info.source,
                                    kind: 'prefab',
                                });
                            }
                            else {
                                queue.push(userUuid);
                            }
                        }
                    }
                    return Array.from(references.values())
                        .sort((left, right) => left.path.localeCompare(right.path)
                        || (left.hierarchyPath || '').localeCompare(right.hierarchyPath || ''));
                },
                async selectAssetReference(reference) {
                    this.deleteError = '';
                    try {
                        if (reference.kind === 'prefab') {
                            Editor.Selection.clear('asset');
                            Editor.Selection.select('asset', reference.uuid);
                            return;
                        }
                        await Editor.Message.request('scene', 'open-scene', reference.uuid);
                        let nodeUuids = [];
                        if (reference.referencedAssetUuid) {
                            nodeUuids = await Editor.Message.request('scene', 'query-nodes-by-asset-uuid', reference.referencedAssetUuid);
                        }
                        const nodeUuid = reference.nodeUuid && nodeUuids.includes(reference.nodeUuid)
                            ? reference.nodeUuid
                            : nodeUuids[0] || reference.nodeUuid;
                        if (!nodeUuid) {
                            throw new Error((0, i18n_1.t)('errors.scene_node_not_found'));
                        }
                        Editor.Selection.clear('node');
                        Editor.Selection.select('node', nodeUuid);
                    }
                    catch (error) {
                        this.deleteError = error instanceof Error
                            ? error.message
                            : (0, i18n_1.t)('errors.select_reference');
                    }
                },
                async findBundlePaths(asset) {
                    if (!asset.path.startsWith('db://assets/')) {
                        return [];
                    }
                    const relativePath = asset.path.slice('db://assets/'.length);
                    const segments = relativePath.split('/');
                    segments.pop();
                    const bundlePaths = [];
                    for (let index = 1; index <= segments.length; index += 1) {
                        const folderUrl = `db://assets/${segments.slice(0, index).join('/')}`;
                        const [info, meta] = await Promise.all([
                            Editor.Message.request('asset-db', 'query-asset-info', folderUrl, ['url', 'isDirectory', 'isBundle']),
                            Editor.Message.request('asset-db', 'query-asset-meta', folderUrl),
                        ]);
                        const userData = meta === null || meta === void 0 ? void 0 : meta.userData;
                        if ((info === null || info === void 0 ? void 0 : info.isBundle) || (userData === null || userData === void 0 ? void 0 : userData.isBundle) === true) {
                            bundlePaths.push(folderUrl);
                        }
                    }
                    return bundlePaths;
                },
                async openDeleteAsset(asset) {
                    var _a, _b;
                    this.deleteAssetTarget = asset;
                    this.deleteReferences = [];
                    this.deleteBundlePaths = [];
                    this.deleteError = '';
                    this.deleteScanFailed = false;
                    this.deleteScanLoading = true;
                    try {
                        const [references, bundlePaths] = await Promise.all([
                            this.findAssetReferences(asset),
                            this.findBundlePaths(asset),
                        ]);
                        if (((_a = this.deleteAssetTarget) === null || _a === void 0 ? void 0 : _a.uuid) !== asset.uuid) {
                            return;
                        }
                        this.deleteReferences = references;
                        this.deleteBundlePaths = bundlePaths;
                    }
                    catch (error) {
                        this.deleteScanFailed = true;
                        this.deleteError = error instanceof Error
                            ? error.message
                            : (0, i18n_1.t)('errors.scan_references');
                    }
                    finally {
                        if (((_b = this.deleteAssetTarget) === null || _b === void 0 ? void 0 : _b.uuid) === asset.uuid) {
                            this.deleteScanLoading = false;
                        }
                    }
                },
                closeDeleteAsset() {
                    if (this.deleteApplying) {
                        return;
                    }
                    this.deleteAssetTarget = null;
                    this.deleteReferences = [];
                    this.deleteBundlePaths = [];
                    this.deleteError = '';
                    this.deleteScanFailed = false;
                    this.deleteScanLoading = false;
                },
                async confirmDeleteAsset() {
                    const asset = this.deleteAssetTarget;
                    if (!asset || this.deleteScanLoading) {
                        return;
                    }
                    this.deleteApplying = true;
                    this.deleteError = '';
                    try {
                        const deletedAsset = await Editor.Message.request('asset-db', 'delete-asset', asset.path);
                        if (!deletedAsset) {
                            throw new Error((0, i18n_1.t)('errors.delete_asset'));
                        }
                        if (await (0, fs_extra_1.pathExists)(asset.backupPath)) {
                            await (0, fs_extra_1.remove)(asset.backupPath);
                        }
                        this.deleteApplying = false;
                        this.closeDeleteAsset();
                        await this.loadAssets();
                    }
                    catch (error) {
                        this.deleteError = error instanceof Error
                            ? error.message
                            : (0, i18n_1.t)('errors.delete_asset');
                    }
                    finally {
                        this.deleteApplying = false;
                    }
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
                            return (0, i18n_1.t)('errors.resize_range');
                        }
                    }
                    if (((_a = this.compressionAsset) === null || _a === void 0 ? void 0 : _a.extension) === '.png' && this.imageCompressor === 'pngquant') {
                        if (settings.qualityMin < 0 || settings.qualityMax > 100
                            || settings.qualityMin > settings.qualityMax) {
                            return (0, i18n_1.t)('errors.quality_order');
                        }
                        if (settings.speed < 1 || settings.speed > 11) {
                            return (0, i18n_1.t)('errors.pngquant_speed');
                        }
                        if (!Number.isInteger(settings.colors)
                            || settings.colors < 2 || settings.colors > 256) {
                            return (0, i18n_1.t)('errors.color_range');
                        }
                        if (settings.dithering < 0 || settings.dithering > 1) {
                            return (0, i18n_1.t)('errors.dithering_range');
                        }
                    }
                    else if ((((_b = this.compressionAsset) === null || _b === void 0 ? void 0 : _b.extension) === '.png'
                        || ((_c = this.compressionAsset) === null || _c === void 0 ? void 0 : _c.extension) === '.jpg')
                        && this.imageCompressor === 'sharp') {
                        if (settings.sharpQuality < 1 || settings.sharpQuality > 100) {
                            return (0, i18n_1.t)('errors.sharp_quality');
                        }
                        if (settings.sharpCompressionLevel < 0 || settings.sharpCompressionLevel > 9) {
                            return (0, i18n_1.t)('errors.compression_level');
                        }
                        if (this.compressionAsset.extension === '.png' && settings.sharpPalette) {
                            if (!Number.isInteger(settings.colors)
                                || settings.colors < 2 || settings.colors > 256) {
                                return (0, i18n_1.t)('errors.color_range');
                            }
                            if (settings.dithering < 0 || settings.dithering > 1) {
                                return (0, i18n_1.t)('errors.dithering_range');
                            }
                        }
                    }
                    else if (((_d = this.compressionAsset) === null || _d === void 0 ? void 0 : _d.extension) === '.mp3') {
                        if (settings.audioBitrate < 8 || settings.audioBitrate > 320) {
                            return (0, i18n_1.t)('errors.bitrate_range');
                        }
                        if (settings.sampleRate < 8000 || settings.sampleRate > 48000) {
                            return (0, i18n_1.t)('errors.sample_rate_range');
                        }
                        if (settings.channels !== 1 && settings.channels !== 2) {
                            return (0, i18n_1.t)('errors.channel_range');
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
                                : (0, i18n_1.t)('errors.load_original');
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
                                : (0, i18n_1.t)('errors.create_preview');
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
                    if (!window.confirm((0, i18n_1.t)('confirm.overwrite', { name: asset.name }))) {
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
                            : (0, i18n_1.t)('errors.apply');
                    }
                    finally {
                        this.compressionApplying = false;
                    }
                },
                async revertAsset(asset) {
                    if (!asset.canRevert) {
                        return;
                    }
                    if (!window.confirm((0, i18n_1.t)('confirm.revert', { name: asset.name }))) {
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
                            : (0, i18n_1.t)('errors.revert');
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
                            : (0, i18n_1.t)('errors.load_assets');
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zb3VyY2UvcGFuZWxzL2RlZmF1bHQvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSx1Q0FBcUU7QUFDckUsMkJBQTRCO0FBQzVCLCtCQUErQztBQUMvQyw2QkFBb0M7QUFDcEMsNkJBQXNEO0FBQ3RELG1EQWEyQjtBQUMzQixxQ0FLb0I7QUFrRHBCLE1BQU0sWUFBWSxHQUFHLElBQUksT0FBTyxFQUFxQixDQUFDO0FBQ3RELE1BQU0sZUFBZSxHQUFHLElBQUksR0FBRyxDQUFDLENBQUMsTUFBTSxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsQ0FBQyxDQUFDO0FBQzNELE1BQU0sZUFBZSxHQUFHLElBQUksR0FBRyxDQUFDLENBQUMsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFDO0FBQzFELE1BQU0sbUJBQW1CLEdBQUcsSUFBSSxHQUFHLENBQUMsQ0FBQyxHQUFHLGVBQWUsRUFBRSxHQUFHLGVBQWUsQ0FBQyxDQUFDLENBQUM7QUFDOUUsTUFBTSx5QkFBeUIsR0FBMEIsQ0FBQyxNQUFNLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxDQUFDO0FBQ25GLE1BQU0seUJBQXlCLEdBQTBCLENBQUMsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLENBQUMsQ0FBQztBQUNsRixNQUFNLGtCQUFrQixHQUFHLDZCQUE2QixDQUFDO0FBRXpELFNBQVMsa0JBQWtCO0lBQ3ZCLElBQUksQ0FBQztRQUNELE1BQU0sYUFBYSxHQUFHLFlBQVksQ0FBQyxPQUFPLENBQUMsa0JBQWtCLENBQUMsQ0FBQztRQUMvRCxJQUFJLGFBQWEsS0FBSyxJQUFJLElBQUksYUFBYSxLQUFLLElBQUksSUFBSSxhQUFhLEtBQUssSUFBSSxFQUFFLENBQUM7WUFDN0UsT0FBTyxhQUFhLENBQUM7UUFDekIsQ0FBQztJQUNMLENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFD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QUNaLFNBQVMsQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUNwQixTQUFTLENBQUMsR0FBRyxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBQ3hCLFlBQVksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDOUIsQ0FBQztJQUNMLENBQUM7Q0FDSixDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBta2R0ZW1wLCBwYXRoRXhpc3RzLCByZWFkRmlsZVN5bmMsIHJlbW92ZSB9IGZyb20gJ2ZzLWV4dHJhJztcclxuaW1wb3J0IHsgdG1wZGlyIH0gZnJvbSAnb3MnO1xyXG5pbXBvcnQgeyBiYXNlbmFtZSwgZXh0bmFtZSwgam9pbiB9IGZyb20gJ3BhdGgnO1xyXG5pbXBvcnQgeyBwYXRoVG9GaWxlVVJMIH0gZnJvbSAndXJsJztcclxuaW1wb3J0IHsgQXBwLCBjcmVhdGVBcHAsIGRlZmluZUNvbXBvbmVudCB9IGZyb20gJ3Z1ZSc7XHJcbmltcG9ydCB7XG4gICAgY2FsY3VsYXRlRmlsZU1ldHJpY3MsXG4gICAgY29tcHJlc3NGaWxlLFxuICAgIENvbXByZXNzaW9uU2V0dGluZ3MsXG4gICAgQ29udmVyc2lvbkV4dGVuc2lvbixcbiAgICBjb252ZXJ0RmlsZSxcbiAgICBjcmVhdGVPcmlnaW5hbEJhY2t1cCxcclxuICAgIEZpbGVNZXRyaWNzLFxyXG4gICAgZ2V0SW1hZ2VEaW1lbnNpb25zLFxyXG4gICAgSW1hZ2VEaW1lbnNpb25zLFxyXG4gICAgSW1hZ2VDb21wcmVzc29yLFxyXG4gICAgcmVwbGFjZU9yaWdpbmFsRmlsZSxcclxuICAgIHJlc3RvcmVPcmlnaW5hbEJhY2t1cCxcclxufSBmcm9tICcuLi8uLi9jb21wcmVzc2lvbic7XG5pbXBvcnQge1xuICAgIGdldExhbmd1YWdlLFxuICAgIHNldExhbmd1YWdlLFxuICAgIFN1cHBvcnRlZExvY2FsZSxcbiAgICB0IGFzIHRyYW5zbGF0ZSxcbn0gZnJvbSAnLi4vLi4vaTE4bic7XG5cclxudHlwZSBTb3J0Q29sdW1uID0gJycgfCAnc2l6ZScgfCAnYmFzZTY0U2l6ZScgfCAnemlwU2l6ZSc7XHJcblxyXG5pbnRlcmZhY2UgTWVkaWFBc3NldCB7XHJcbiAgICB1dWlkOiBzdHJpbmc7XHJcbiAgICBuYW1lOiBzdHJpbmc7XHJcbiAgICBwYXRoOiBzdHJpbmc7XHJcbiAgICBmaWxlUGF0aDogc3RyaW5nO1xyXG4gICAgcHJldmlld1VybDogc3RyaW5nO1xyXG4gICAgZXh0ZW5zaW9uOiBzdHJpbmc7XHJcbiAgICBzaXplOiBudW1iZXI7XHJcbiAgICBiYXNlNjRTaXplOiBudW1iZXI7XHJcbiAgICB6aXBTaXplOiBudW1iZXI7XHJcbiAgICBiYWNrdXBQYXRoOiBzdHJpbmc7XHJcbiAgICBjYW5SZXZlcnQ6IGJvb2xlYW47XHJcbn1cclxuXHJcbmludGVyZmFjZSBBc3NldERiSW5mbyB7XG4gICAgdXVpZDogc3RyaW5nO1xuICAgIG5hbWU/OiBzdHJpbmc7XG4gICAgZmlsZTogc3RyaW5nO1xyXG4gICAgdXJsOiBzdHJpbmc7XHJcbiAgICBzb3VyY2U6IHN0cmluZztcclxuICAgIGlzRGlyZWN0b3J5OiBib29sZWFuO1xuICAgIHR5cGU/OiBzdHJpbmc7XG4gICAgaXNCdW5kbGU/OiBib29sZWFuO1xufVxuXG5pbnRlcmZhY2UgQXNzZXRSZWZlcmVuY2Uge1xuICAgIHV1aWQ6IHN0cmluZztcbiAgICBuYW1lOiBzdHJpbmc7XG4gICAgcGF0aDogc3RyaW5nO1xuICAgIGtpbmQ6ICdzY2VuZScgfCAncHJlZmFiJztcbiAgICBoaWVyYXJjaHlQYXRoPzogc3RyaW5nO1xuICAgIG5vZGVVdWlkPzogc3RyaW5nO1xuICAgIHJlZmVyZW5jZWRBc3NldFV1aWQ/OiBzdHJpbmc7XG59XG5cbmludGVyZmFjZSBTZXJpYWxpemVkUmVmZXJlbmNlIHtcbiAgICBfX2lkX18/OiBudW1iZXI7XG4gICAgX191dWlkX18/OiBzdHJpbmc7XG4gICAgW2tleTogc3RyaW5nXTogdW5rbm93bjtcbn1cblxyXG5pbnRlcmZhY2UgUGFuZWxEYXRhIHtcclxuICAgIGFwcDogQXBwO1xyXG4gICAgY2xlYW51cDogKCkgPT4gdm9pZDtcclxufVxyXG5cclxuY29uc3QgcGFuZWxEYXRhTWFwID0gbmV3IFdlYWtNYXA8b2JqZWN0LCBQYW5lbERhdGE+KCk7XG5jb25zdCBpbWFnZUV4dGVuc2lvbnMgPSBuZXcgU2V0KFsnLnBuZycsICcuanBnJywgJy53ZWJwJ10pO1xuY29uc3QgYXVkaW9FeHRlbnNpb25zID0gbmV3IFNldChbJy5tcDMnLCAnLndhdicsICcub2dnJ10pO1xuY29uc3Qgc3VwcG9ydGVkRXh0ZW5zaW9ucyA9IG5ldyBTZXQoWy4uLmltYWdlRXh0ZW5zaW9ucywgLi4uYXVkaW9FeHRlbnNpb25zXSk7XG5jb25zdCBpbWFnZUNvbnZlcnNpb25FeHRlbnNpb25zOiBDb252ZXJzaW9uRXh0ZW5zaW9uW10gPSBbJy5wbmcnLCAnLmpwZycsICcud2VicCddO1xuY29uc3QgYXVkaW9Db252ZXJzaW9uRXh0ZW5zaW9uczogQ29udmVyc2lvbkV4dGVuc2lvbltdID0gWycubXAzJywgJy53YXYnLCAnLm9nZyddO1xuY29uc3QgbGFuZ3VhZ2VTdG9yYWdlS2V5ID0gJ2NjLWFzc2V0cy1jb21wcmVzcy5sYW5ndWFnZSc7XG5cbmZ1bmN0aW9uIGdldEluaXRpYWxMYW5ndWFnZSgpOiBTdXBwb3J0ZWRMb2NhbGUge1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHNhdmVkTGFuZ3VhZ2UgPSBsb2NhbFN0b3JhZ2UuZ2V0SXRlbShsYW5ndWFnZVN0b3JhZ2VLZXkpO1xuICAgICAgICBpZiAoc2F2ZWRMYW5ndWFnZSA9PT0gJ2VuJyB8fCBzYXZlZExhbmd1YWdlID09PSAnemgnIHx8IHNhdmVkTGFuZ3VhZ2UgPT09ICd2aScpIHtcbiAgICAgICAgICAgIHJldHVybiBzYXZlZExhbmd1YWdlO1xuICAgICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS53YXJuKCdbY2MtYXNzZXRzLWNvbXByZXNzXSBDYW5ub3QgcmVhZCB0aGUgc2F2ZWQgbGFuZ3VhZ2UnLCBlcnJvcik7XG4gICAgfVxuICAgIHJldHVybiBnZXRMYW5ndWFnZSgpO1xufVxuXG5mdW5jdGlvbiBpc1NlcmlhbGl6ZWRPYmplY3QodmFsdWU6IHVua25vd24pOiB2YWx1ZSBpcyBTZXJpYWxpemVkUmVmZXJlbmNlIHtcbiAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiB2YWx1ZSAhPT0gbnVsbCAmJiAhQXJyYXkuaXNBcnJheSh2YWx1ZSk7XG59XG5cbmZ1bmN0aW9uIGNvbnRhaW5zQXNzZXRVdWlkKHZhbHVlOiB1bmtub3duLCB0YXJnZXRVdWlkOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgICAgcmV0dXJuIHZhbHVlLnNvbWUoKGl0ZW0pID0+IGNvbnRhaW5zQXNzZXRVdWlkKGl0ZW0sIHRhcmdldFV1aWQpKTtcbiAgICB9XG4gICAgaWYgKCFpc1NlcmlhbGl6ZWRPYmplY3QodmFsdWUpKSB7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgaWYgKHZhbHVlLl9fdXVpZF9fID09PSB0YXJnZXRVdWlkKSB7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICByZXR1cm4gT2JqZWN0LnZhbHVlcyh2YWx1ZSkuc29tZSgoaXRlbSkgPT4gY29udGFpbnNBc3NldFV1aWQoaXRlbSwgdGFyZ2V0VXVpZCkpO1xufVxuXG5mdW5jdGlvbiBnZXRTZXJpYWxpemVkSWQodmFsdWU6IHVua25vd24pOiBudW1iZXIgfCBudWxsIHtcbiAgICByZXR1cm4gaXNTZXJpYWxpemVkT2JqZWN0KHZhbHVlKSAmJiB0eXBlb2YgdmFsdWUuX19pZF9fID09PSAnbnVtYmVyJ1xuICAgICAgICA/IHZhbHVlLl9faWRfX1xuICAgICAgICA6IG51bGw7XG59XG5cbmZ1bmN0aW9uIGNvbnRhaW5zU2VyaWFsaXplZElkKHZhbHVlOiB1bmtub3duLCB0YXJnZXRJZDogbnVtYmVyKTogYm9vbGVhbiB7XG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICAgIHJldHVybiB2YWx1ZS5zb21lKChpdGVtKSA9PiBjb250YWluc1NlcmlhbGl6ZWRJZChpdGVtLCB0YXJnZXRJZCkpO1xuICAgIH1cbiAgICBpZiAoIWlzU2VyaWFsaXplZE9iamVjdCh2YWx1ZSkpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICBpZiAodmFsdWUuX19pZF9fID09PSB0YXJnZXRJZCkge1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgcmV0dXJuIE9iamVjdC52YWx1ZXModmFsdWUpLnNvbWUoKGl0ZW0pID0+IGNvbnRhaW5zU2VyaWFsaXplZElkKGl0ZW0sIHRhcmdldElkKSk7XG59XG5cbmZ1bmN0aW9uIGlzU2VyaWFsaXplZE5vZGUodmFsdWU6IHVua25vd24pOiB2YWx1ZSBpcyBTZXJpYWxpemVkUmVmZXJlbmNlIHtcbiAgICByZXR1cm4gaXNTZXJpYWxpemVkT2JqZWN0KHZhbHVlKVxuICAgICAgICAmJiB0eXBlb2YgdmFsdWUuX190eXBlX18gPT09ICdzdHJpbmcnXG4gICAgICAgICYmICh2YWx1ZS5fX3R5cGVfXyA9PT0gJ2NjLk5vZGUnIHx8IHZhbHVlLl9fdHlwZV9fLmVuZHNXaXRoKCcuTm9kZScpKTtcbn1cblxuZnVuY3Rpb24gZmluZE93bmVyTm9kZUluZGV4KGVudHJpZXM6IHVua25vd25bXSwgZW50cnlJbmRleDogbnVtYmVyKTogbnVtYmVyIHwgbnVsbCB7XG4gICAgY29uc3QgdmlzaXRlZCA9IG5ldyBTZXQ8bnVtYmVyPigpO1xuICAgIGNvbnN0IHF1ZXVlID0gW2VudHJ5SW5kZXhdO1xuICAgIHdoaWxlIChxdWV1ZS5sZW5ndGggPiAwKSB7XG4gICAgICAgIGNvbnN0IGN1cnJlbnRJbmRleCA9IHF1ZXVlLnNoaWZ0KCkgYXMgbnVtYmVyO1xuICAgICAgICBpZiAodmlzaXRlZC5oYXMoY3VycmVudEluZGV4KSkge1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgdmlzaXRlZC5hZGQoY3VycmVudEluZGV4KTtcbiAgICAgICAgY29uc3QgZW50cnkgPSBlbnRyaWVzW2N1cnJlbnRJbmRleF07XG4gICAgICAgIGlmIChpc1NlcmlhbGl6ZWROb2RlKGVudHJ5KSkge1xuICAgICAgICAgICAgcmV0dXJuIGN1cnJlbnRJbmRleDtcbiAgICAgICAgfVxuICAgICAgICBpZiAoaXNTZXJpYWxpemVkT2JqZWN0KGVudHJ5KSkge1xuICAgICAgICAgICAgY29uc3QgZGlyZWN0Tm9kZUluZGV4ID0gZ2V0U2VyaWFsaXplZElkKGVudHJ5Lm5vZGUpID8/IGdldFNlcmlhbGl6ZWRJZChlbnRyeS5fbm9kZSk7XG4gICAgICAgICAgICBpZiAoZGlyZWN0Tm9kZUluZGV4ICE9PSBudWxsICYmIGlzU2VyaWFsaXplZE5vZGUoZW50cmllc1tkaXJlY3ROb2RlSW5kZXhdKSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBkaXJlY3ROb2RlSW5kZXg7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IGVudHJpZXMubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgICAgICAgICBpZiAoIXZpc2l0ZWQuaGFzKGluZGV4KSAmJiBjb250YWluc1NlcmlhbGl6ZWRJZChlbnRyaWVzW2luZGV4XSwgY3VycmVudEluZGV4KSkge1xuICAgICAgICAgICAgICAgIHF1ZXVlLnB1c2goaW5kZXgpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiBudWxsO1xufVxuXG5mdW5jdGlvbiBidWlsZEhpZXJhcmNoeVBhdGgoZW50cmllczogdW5rbm93bltdLCBub2RlSW5kZXg6IG51bWJlcik6IHN0cmluZyB7XG4gICAgY29uc3QgbmFtZXM6IHN0cmluZ1tdID0gW107XG4gICAgY29uc3QgdmlzaXRlZCA9IG5ldyBTZXQ8bnVtYmVyPigpO1xuICAgIGxldCBjdXJyZW50SW5kZXg6IG51bWJlciB8IG51bGwgPSBub2RlSW5kZXg7XG4gICAgd2hpbGUgKGN1cnJlbnRJbmRleCAhPT0gbnVsbCAmJiAhdmlzaXRlZC5oYXMoY3VycmVudEluZGV4KSkge1xuICAgICAgICB2aXNpdGVkLmFkZChjdXJyZW50SW5kZXgpO1xuICAgICAgICBjb25zdCBub2RlID0gZW50cmllc1tjdXJyZW50SW5kZXhdO1xuICAgICAgICBpZiAoIWlzU2VyaWFsaXplZE9iamVjdChub2RlKSkge1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgbmFtZSA9IHR5cGVvZiBub2RlLl9uYW1lID09PSAnc3RyaW5nJyAmJiBub2RlLl9uYW1lXG4gICAgICAgICAgICA/IG5vZGUuX25hbWVcbiAgICAgICAgICAgIDogJ05vZGUnO1xuICAgICAgICBuYW1lcy51bnNoaWZ0KG5hbWUpO1xuICAgICAgICBjdXJyZW50SW5kZXggPSBnZXRTZXJpYWxpemVkSWQobm9kZS5fcGFyZW50KTtcbiAgICB9XG4gICAgcmV0dXJuIG5hbWVzLmpvaW4oJy8nKTtcbn1cblxuZnVuY3Rpb24gcmVhZFNjZW5lSGllcmFyY2h5UmVmZXJlbmNlcyhmaWxlUGF0aDogc3RyaW5nLCB0YXJnZXRVdWlkOiBzdHJpbmcpOiBBcnJheTx7XG4gICAgaGllcmFyY2h5UGF0aDogc3RyaW5nO1xuICAgIG5vZGVVdWlkPzogc3RyaW5nO1xufT4ge1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHNlcmlhbGl6ZWQgPSBKU09OLnBhcnNlKHJlYWRGaWxlU3luYyhmaWxlUGF0aCwgJ3V0ZjgnKSkgYXMgdW5rbm93bjtcbiAgICAgICAgY29uc3QgZW50cmllcyA9IEFycmF5LmlzQXJyYXkoc2VyaWFsaXplZCkgPyBzZXJpYWxpemVkIDogW3NlcmlhbGl6ZWRdO1xuICAgICAgICBjb25zdCByZWZlcmVuY2VzID0gbmV3IE1hcDxzdHJpbmcsIHsgaGllcmFyY2h5UGF0aDogc3RyaW5nOyBub2RlVXVpZD86IHN0cmluZyB9PigpO1xuXG4gICAgICAgIGVudHJpZXMuZm9yRWFjaCgoZW50cnksIGVudHJ5SW5kZXgpID0+IHtcbiAgICAgICAgICAgIGlmICghY29udGFpbnNBc3NldFV1aWQoZW50cnksIHRhcmdldFV1aWQpKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29uc3Qgbm9kZUluZGV4ID0gZmluZE93bmVyTm9kZUluZGV4KGVudHJpZXMsIGVudHJ5SW5kZXgpO1xuICAgICAgICAgICAgaWYgKG5vZGVJbmRleCA9PT0gbnVsbCkge1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnN0IG5vZGUgPSBlbnRyaWVzW25vZGVJbmRleF07XG4gICAgICAgICAgICBjb25zdCBoaWVyYXJjaHlQYXRoID0gYnVpbGRIaWVyYXJjaHlQYXRoKGVudHJpZXMsIG5vZGVJbmRleCk7XG4gICAgICAgICAgICBjb25zdCBub2RlVXVpZCA9IGlzU2VyaWFsaXplZE9iamVjdChub2RlKSAmJiB0eXBlb2Ygbm9kZS5faWQgPT09ICdzdHJpbmcnXG4gICAgICAgICAgICAgICAgPyBub2RlLl9pZFxuICAgICAgICAgICAgICAgIDogdW5kZWZpbmVkO1xuICAgICAgICAgICAgcmVmZXJlbmNlcy5zZXQoYCR7bm9kZVV1aWQgfHwgJyd9OiR7aGllcmFyY2h5UGF0aH1gLCB7IGhpZXJhcmNoeVBhdGgsIG5vZGVVdWlkIH0pO1xuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIEFycmF5LmZyb20ocmVmZXJlbmNlcy52YWx1ZXMoKSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS53YXJuKGBbY2MtYXNzZXRzLWNvbXByZXNzXSBDYW5ub3QgaW5zcGVjdCBzY2VuZSBoaWVyYXJjaHk6ICR7ZmlsZVBhdGh9YCwgZXJyb3IpO1xuICAgICAgICByZXR1cm4gW107XG4gICAgfVxufVxuXHJcbmZ1bmN0aW9uIGdldEJhY2t1cFBhdGgodXVpZDogc3RyaW5nLCBleHRlbnNpb246IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgICByZXR1cm4gam9pbihFZGl0b3IuUHJvamVjdC50bXBEaXIsICdjYy1hc3NldHMtY29tcHJlc3MtYmFja3VwcycsIGAke3V1aWR9JHtleHRlbnNpb259YCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGZvcm1hdEZpbGVTaXplKGJ5dGVzOiBudW1iZXIpOiBzdHJpbmcge1xyXG4gICAgaWYgKGJ5dGVzID09PSAwKSB7XHJcbiAgICAgICAgcmV0dXJuICcwIEInO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHVuaXRzID0gWydCJywgJ0tCJywgJ01CJywgJ0dCJ107XHJcbiAgICBjb25zdCB1bml0SW5kZXggPSBNYXRoLm1pbihNYXRoLmZsb29yKE1hdGgubG9nKGJ5dGVzKSAvIE1hdGgubG9nKDEwMjQpKSwgdW5pdHMubGVuZ3RoIC0gMSk7XHJcbiAgICBjb25zdCB2YWx1ZSA9IGJ5dGVzIC8gTWF0aC5wb3coMTAyNCwgdW5pdEluZGV4KTtcclxuICAgIHJldHVybiBgJHt2YWx1ZS50b0ZpeGVkKHVuaXRJbmRleCA9PT0gMCA/IDAgOiAyKX0gJHt1bml0c1t1bml0SW5kZXhdfWA7XHJcbn1cclxuXHJcbmNvbnN0IEltYWdlVmlld2VyID0gZGVmaW5lQ29tcG9uZW50KHtcclxuICAgIHByb3BzOiB7XHJcbiAgICAgICAgc3JjOiB7XHJcbiAgICAgICAgICAgIHR5cGU6IFN0cmluZyxcclxuICAgICAgICAgICAgcmVxdWlyZWQ6IHRydWUsXHJcbiAgICAgICAgfSxcclxuICAgICAgICBhbHQ6IHtcclxuICAgICAgICAgICAgdHlwZTogU3RyaW5nLFxyXG4gICAgICAgICAgICBkZWZhdWx0OiAnJyxcclxuICAgICAgICB9LFxyXG4gICAgfSxcclxuICAgIGRhdGEoKSB7XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgc2NhbGU6IDEsXHJcbiAgICAgICAgICAgIHRyYW5zbGF0ZVg6IDAsXHJcbiAgICAgICAgICAgIHRyYW5zbGF0ZVk6IDAsXHJcbiAgICAgICAgICAgIGRyYWdnaW5nOiBmYWxzZSxcclxuICAgICAgICAgICAgcG9pbnRlcklkOiAtMSxcclxuICAgICAgICAgICAgZHJhZ1N0YXJ0WDogMCxcclxuICAgICAgICAgICAgZHJhZ1N0YXJ0WTogMCxcclxuICAgICAgICAgICAgdHJhbnNsYXRlU3RhcnRYOiAwLFxyXG4gICAgICAgICAgICB0cmFuc2xhdGVTdGFydFk6IDAsXHJcbiAgICAgICAgfTtcclxuICAgIH0sXHJcbiAgICBjb21wdXRlZDoge1xyXG4gICAgICAgIGltYWdlVHJhbnNmb3JtKCk6IHN0cmluZyB7XHJcbiAgICAgICAgICAgIHJldHVybiBgdHJhbnNsYXRlKCR7dGhpcy50cmFuc2xhdGVYfXB4LCAke3RoaXMudHJhbnNsYXRlWX1weCkgc2NhbGUoJHt0aGlzLnNjYWxlfSlgO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgem9vbUxhYmVsKCk6IHN0cmluZyB7XHJcbiAgICAgICAgICAgIHJldHVybiBgJHtNYXRoLnJvdW5kKHRoaXMuc2NhbGUgKiAxMDApfSVgO1xyXG4gICAgICAgIH0sXHJcbiAgICB9LFxyXG4gICAgd2F0Y2g6IHtcclxuICAgICAgICBzcmMoKSB7XHJcbiAgICAgICAgICAgIHRoaXMucmVzZXRWaWV3KCk7XHJcbiAgICAgICAgfSxcclxuICAgIH0sXHJcbiAgICBtZXRob2RzOiB7XG4gICAgICAgIHQ6IHRyYW5zbGF0ZSxcbiAgICAgICAgY2xhbXBTY2FsZShzY2FsZTogbnVtYmVyKTogbnVtYmVyIHtcclxuICAgICAgICAgICAgcmV0dXJuIE1hdGgubWluKDgsIE1hdGgubWF4KDAuMjUsIHNjYWxlKSk7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBzZXRTY2FsZShzY2FsZTogbnVtYmVyKTogdm9pZCB7XHJcbiAgICAgICAgICAgIHRoaXMuc2NhbGUgPSB0aGlzLmNsYW1wU2NhbGUoc2NhbGUpO1xyXG4gICAgICAgICAgICBpZiAodGhpcy5zY2FsZSA9PT0gMSkge1xyXG4gICAgICAgICAgICAgICAgdGhpcy50cmFuc2xhdGVYID0gMDtcclxuICAgICAgICAgICAgICAgIHRoaXMudHJhbnNsYXRlWSA9IDA7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9LFxyXG4gICAgICAgIHpvb21JbigpOiB2b2lkIHtcclxuICAgICAgICAgICAgdGhpcy5zZXRTY2FsZSh0aGlzLnNjYWxlICogMS4yNSk7XHJcbiAgICAgICAgfSxcclxuICAgICAgICB6b29tT3V0KCk6IHZvaWQge1xyXG4gICAgICAgICAgICB0aGlzLnNldFNjYWxlKHRoaXMuc2NhbGUgLyAxLjI1KTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIG9uV2hlZWwoZXZlbnQ6IFdoZWVsRXZlbnQpOiB2b2lkIHtcclxuICAgICAgICAgICAgdGhpcy5zZXRTY2FsZSh0aGlzLnNjYWxlICogKGV2ZW50LmRlbHRhWSA8IDAgPyAxLjE1IDogMSAvIDEuMTUpKTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIHJlc2V0VmlldygpOiB2b2lkIHtcclxuICAgICAgICAgICAgdGhpcy5zY2FsZSA9IDE7XHJcbiAgICAgICAgICAgIHRoaXMudHJhbnNsYXRlWCA9IDA7XHJcbiAgICAgICAgICAgIHRoaXMudHJhbnNsYXRlWSA9IDA7XHJcbiAgICAgICAgICAgIHRoaXMuZHJhZ2dpbmcgPSBmYWxzZTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIHN0YXJ0RHJhZyhldmVudDogUG9pbnRlckV2ZW50KTogdm9pZCB7XHJcbiAgICAgICAgICAgIGlmIChldmVudC5idXR0b24gIT09IDApIHtcclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB0aGlzLmRyYWdnaW5nID0gdHJ1ZTtcclxuICAgICAgICAgICAgdGhpcy5wb2ludGVySWQgPSBldmVudC5wb2ludGVySWQ7XHJcbiAgICAgICAgICAgIHRoaXMuZHJhZ1N0YXJ0WCA9IGV2ZW50LmNsaWVudFg7XHJcbiAgICAgICAgICAgIHRoaXMuZHJhZ1N0YXJ0WSA9IGV2ZW50LmNsaWVudFk7XHJcbiAgICAgICAgICAgIHRoaXMudHJhbnNsYXRlU3RhcnRYID0gdGhpcy50cmFuc2xhdGVYO1xyXG4gICAgICAgICAgICB0aGlzLnRyYW5zbGF0ZVN0YXJ0WSA9IHRoaXMudHJhbnNsYXRlWTtcclxuICAgICAgICAgICAgKGV2ZW50LmN1cnJlbnRUYXJnZXQgYXMgSFRNTEVsZW1lbnQpLnNldFBvaW50ZXJDYXB0dXJlKGV2ZW50LnBvaW50ZXJJZCk7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBkcmFnKGV2ZW50OiBQb2ludGVyRXZlbnQpOiB2b2lkIHtcclxuICAgICAgICAgICAgaWYgKCF0aGlzLmRyYWdnaW5nIHx8IGV2ZW50LnBvaW50ZXJJZCAhPT0gdGhpcy5wb2ludGVySWQpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB0aGlzLnRyYW5zbGF0ZVggPSB0aGlzLnRyYW5zbGF0ZVN0YXJ0WCArIGV2ZW50LmNsaWVudFggLSB0aGlzLmRyYWdTdGFydFg7XHJcbiAgICAgICAgICAgIHRoaXMudHJhbnNsYXRlWSA9IHRoaXMudHJhbnNsYXRlU3RhcnRZICsgZXZlbnQuY2xpZW50WSAtIHRoaXMuZHJhZ1N0YXJ0WTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIGVuZERyYWcoZXZlbnQ6IFBvaW50ZXJFdmVudCk6IHZvaWQge1xyXG4gICAgICAgICAgICBpZiAoZXZlbnQucG9pbnRlcklkICE9PSB0aGlzLnBvaW50ZXJJZCkge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHRoaXMuZHJhZ2dpbmcgPSBmYWxzZTtcclxuICAgICAgICAgICAgY29uc3QgdGFyZ2V0ID0gZXZlbnQuY3VycmVudFRhcmdldCBhcyBIVE1MRWxlbWVudDtcclxuICAgICAgICAgICAgaWYgKHRhcmdldC5oYXNQb2ludGVyQ2FwdHVyZShldmVudC5wb2ludGVySWQpKSB7XHJcbiAgICAgICAgICAgICAgICB0YXJnZXQucmVsZWFzZVBvaW50ZXJDYXB0dXJlKGV2ZW50LnBvaW50ZXJJZCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9LFxyXG4gICAgfSxcclxuICAgIHRlbXBsYXRlOiBgXHJcbiAgICAgICAgPGRpdiBjbGFzcz1cImltYWdlLXZpZXdlclwiPlxyXG4gICAgICAgICAgICA8ZGl2XHJcbiAgICAgICAgICAgICAgICBjbGFzcz1cImltYWdlLXZpZXdwb3J0XCJcclxuICAgICAgICAgICAgICAgIDpjbGFzcz1cInsgZHJhZ2dpbmcgfVwiXHJcbiAgICAgICAgICAgICAgICBAd2hlZWwucHJldmVudC5zdG9wPVwib25XaGVlbFwiXHJcbiAgICAgICAgICAgICAgICBAcG9pbnRlcmRvd24ucHJldmVudD1cInN0YXJ0RHJhZ1wiXHJcbiAgICAgICAgICAgICAgICBAcG9pbnRlcm1vdmUucHJldmVudD1cImRyYWdcIlxyXG4gICAgICAgICAgICAgICAgQHBvaW50ZXJ1cD1cImVuZERyYWdcIlxyXG4gICAgICAgICAgICAgICAgQHBvaW50ZXJjYW5jZWw9XCJlbmREcmFnXCJcclxuICAgICAgICAgICAgICAgIEBkYmxjbGljaz1cInJlc2V0Vmlld1wiXHJcbiAgICAgICAgICAgID5cclxuICAgICAgICAgICAgICAgIDxpbWdcclxuICAgICAgICAgICAgICAgICAgICA6c3JjPVwic3JjXCJcclxuICAgICAgICAgICAgICAgICAgICA6YWx0PVwiYWx0XCJcclxuICAgICAgICAgICAgICAgICAgICA6c3R5bGU9XCJ7IHRyYW5zZm9ybTogaW1hZ2VUcmFuc2Zvcm0gfVwiXHJcbiAgICAgICAgICAgICAgICAgICAgZHJhZ2dhYmxlPVwiZmFsc2VcIlxyXG4gICAgICAgICAgICAgICAgLz5cclxuICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJpbWFnZS12aWV3ZXItY29udHJvbHNcIj5cclxuICAgICAgICAgICAgICAgIDxidXR0b24gdHlwZT1cImJ1dHRvblwiIDp0aXRsZT1cInQoJ3ZpZXdlci56b29tX291dCcpXCIgQGNsaWNrPVwiem9vbU91dFwiPuKIkjwvYnV0dG9uPlxuICAgICAgICAgICAgICAgIDxzcGFuPnt7IHpvb21MYWJlbCB9fTwvc3Bhbj5cclxuICAgICAgICAgICAgICAgIDxidXR0b24gdHlwZT1cImJ1dHRvblwiIDp0aXRsZT1cInQoJ3ZpZXdlci56b29tX2luJylcIiBAY2xpY2s9XCJ6b29tSW5cIj4rPC9idXR0b24+XG4gICAgICAgICAgICAgICAgPGJ1dHRvbiB0eXBlPVwiYnV0dG9uXCIgOnRpdGxlPVwidCgndmlld2VyLnJlc2V0JylcIiBAY2xpY2s9XCJyZXNldFZpZXdcIj57eyB0KCd2aWV3ZXIuZml0JykgfX08L2J1dHRvbj5cbiAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgIDwvZGl2PlxyXG4gICAgYCxcclxufSk7XHJcblxyXG5hc3luYyBmdW5jdGlvbiBjcmVhdGVNZWRpYUFzc2V0KGFzc2V0OiBBc3NldERiSW5mbyk6IFByb21pc2U8TWVkaWFBc3NldCB8IG51bGw+IHtcclxuICAgIGNvbnN0IGV4dGVuc2lvbiA9IGV4dG5hbWUoYXNzZXQuZmlsZSkudG9Mb3dlckNhc2UoKTtcclxuICAgIGlmIChhc3NldC5pc0RpcmVjdG9yeSB8fCAhc3VwcG9ydGVkRXh0ZW5zaW9ucy5oYXMoZXh0ZW5zaW9uKSkge1xyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG5cclxuICAgIHRyeSB7XHJcbiAgICAgICAgY29uc3QgbmFtZSA9IGJhc2VuYW1lKGFzc2V0LmZpbGUpO1xyXG4gICAgICAgIGNvbnN0IGJhY2t1cFBhdGggPSBnZXRCYWNrdXBQYXRoKGFzc2V0LnV1aWQsIGV4dGVuc2lvbik7XHJcbiAgICAgICAgY29uc3QgW21ldHJpY3MsIGNhblJldmVydF0gPSBhd2FpdCBQcm9taXNlLmFsbChbXHJcbiAgICAgICAgICAgIGNhbGN1bGF0ZUZpbGVNZXRyaWNzKGFzc2V0LmZpbGUsIG5hbWUpLFxyXG4gICAgICAgICAgICBwYXRoRXhpc3RzKGJhY2t1cFBhdGgpLFxyXG4gICAgICAgIF0pO1xyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgIHV1aWQ6IGFzc2V0LnV1aWQsXHJcbiAgICAgICAgICAgIG5hbWUsXHJcbiAgICAgICAgICAgIHBhdGg6IGFzc2V0LnVybCB8fCBhc3NldC5zb3VyY2UsXHJcbiAgICAgICAgICAgIGZpbGVQYXRoOiBhc3NldC5maWxlLFxyXG4gICAgICAgICAgICBwcmV2aWV3VXJsOiBwYXRoVG9GaWxlVVJMKGFzc2V0LmZpbGUpLmhyZWYsXHJcbiAgICAgICAgICAgIGV4dGVuc2lvbixcclxuICAgICAgICAgICAgc2l6ZTogbWV0cmljcy5maWxlU2l6ZSxcclxuICAgICAgICAgICAgYmFzZTY0U2l6ZTogbWV0cmljcy5iYXNlNjRTaXplLFxyXG4gICAgICAgICAgICB6aXBTaXplOiBtZXRyaWNzLnppcFNpemUsXHJcbiAgICAgICAgICAgIGJhY2t1cFBhdGgsXHJcbiAgICAgICAgICAgIGNhblJldmVydCxcclxuICAgICAgICB9O1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICBjb25zb2xlLndhcm4oYFtjYy1hc3NldHMtY29tcHJlc3NdIENhbm5vdCByZWFkIGZpbGU6ICR7YXNzZXQuZmlsZX1gLCBlcnJvcik7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIG1hcFdpdGhDb25jdXJyZW5jeTxULCBSPihcclxuICAgIGl0ZW1zOiBUW10sXHJcbiAgICBjb25jdXJyZW5jeTogbnVtYmVyLFxyXG4gICAgbWFwcGVyOiAoaXRlbTogVCkgPT4gUHJvbWlzZTxSPixcclxuKTogUHJvbWlzZTxSW10+IHtcclxuICAgIGNvbnN0IHJlc3VsdHMgPSBuZXcgQXJyYXk8Uj4oaXRlbXMubGVuZ3RoKTtcclxuICAgIGxldCBuZXh0SW5kZXggPSAwO1xyXG4gICAgY29uc3Qgd29ya2VycyA9IEFycmF5LmZyb20oeyBsZW5ndGg6IE1hdGgubWluKGNvbmN1cnJlbmN5LCBpdGVtcy5sZW5ndGgpIH0sIGFzeW5jICgpID0+IHtcclxuICAgICAgICB3aGlsZSAobmV4dEluZGV4IDwgaXRlbXMubGVuZ3RoKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGluZGV4ID0gbmV4dEluZGV4O1xyXG4gICAgICAgICAgICBuZXh0SW5kZXggKz0gMTtcclxuICAgICAgICAgICAgcmVzdWx0c1tpbmRleF0gPSBhd2FpdCBtYXBwZXIoaXRlbXNbaW5kZXhdKTtcclxuICAgICAgICB9XHJcbiAgICB9KTtcclxuICAgIGF3YWl0IFByb21pc2UuYWxsKHdvcmtlcnMpO1xyXG4gICAgcmV0dXJuIHJlc3VsdHM7XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gRWRpdG9yLlBhbmVsLmRlZmluZSh7XHJcbiAgICBsaXN0ZW5lcnM6IHt9LFxyXG4gICAgdGVtcGxhdGU6IHJlYWRGaWxlU3luYyhqb2luKF9fZGlybmFtZSwgJy4uLy4uLy4uL3N0YXRpYy90ZW1wbGF0ZS9kZWZhdWx0L2luZGV4Lmh0bWwnKSwgJ3V0Zi04JyksXHJcbiAgICBzdHlsZTogcmVhZEZpbGVTeW5jKGpvaW4oX19kaXJuYW1lLCAnLi4vLi4vLi4vc3RhdGljL3N0eWxlL2RlZmF1bHQvaW5kZXguY3NzJyksICd1dGYtOCcpLFxyXG4gICAgJDoge1xyXG4gICAgICAgIGFwcDogJyNhcHAnLFxyXG4gICAgfSxcclxuICAgIG1ldGhvZHM6IHt9LFxyXG4gICAgcmVhZHkoKSB7XG4gICAgICAgIGlmICghdGhpcy4kLmFwcCkge1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCBpbml0aWFsTGFuZ3VhZ2UgPSBnZXRJbml0aWFsTGFuZ3VhZ2UoKTtcbiAgICAgICAgc2V0TGFuZ3VhZ2UoaW5pdGlhbExhbmd1YWdlKTtcblxuICAgICAgICBjb25zdCBhcHAgPSBjcmVhdGVBcHAoZGVmaW5lQ29tcG9uZW50KHtcbiAgICAgICAgICAgIGRhdGEoKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICBzZWxlY3RlZExhbmd1YWdlOiBpbml0aWFsTGFuZ3VhZ2UgYXMgU3VwcG9ydGVkTG9jYWxlLFxuICAgICAgICAgICAgICAgICAgICBhc3NldHM6IFtdIGFzIE1lZGlhQXNzZXRbXSxcclxuICAgICAgICAgICAgICAgICAgICBsb2FkaW5nOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgICAgICBlcnJvck1lc3NhZ2U6ICcnLFxyXG4gICAgICAgICAgICAgICAgICAgIHNlYXJjaFF1ZXJ5OiAnJyxcclxuICAgICAgICAgICAgICAgICAgICBleHRlbnNpb25GaWx0ZXI6ICcnLFxyXG4gICAgICAgICAgICAgICAgICAgIHNvcnRDb2x1bW46ICcnIGFzIFNvcnRDb2x1bW4sXHJcbiAgICAgICAgICAgICAgICAgICAgc29ydERpcmVjdGlvbjogJycgYXMgJycgfCAnYXNjJyB8ICdkZXNjJyxcclxuICAgICAgICAgICAgICAgICAgICBjdXJyZW50UGFnZTogMSxcclxuICAgICAgICAgICAgICAgICAgICBwYWdlU2l6ZTogMTAsXHJcbiAgICAgICAgICAgICAgICAgICAgc2VsZWN0ZWRBc3NldDogbnVsbCBhcyBNZWRpYUFzc2V0IHwgbnVsbCxcclxuICAgICAgICAgICAgICAgICAgICBkZXRhaWxMb2FkaW5nOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgICAgICBiYXNlNjRTaXplOiBudWxsIGFzIG51bWJlciB8IG51bGwsXHJcbiAgICAgICAgICAgICAgICAgICAgY29tcHJlc3NlZFNpemU6IG51bGwgYXMgbnVtYmVyIHwgbnVsbCxcclxuICAgICAgICAgICAgICAgICAgICBkZXRhaWxFcnJvcjogJycsXHJcbiAgICAgICAgICAgICAgICAgICAgZGV0YWlsUmVxdWVzdElkOiAwLFxyXG4gICAgICAgICAgICAgICAgICAgIGNvbXByZXNzaW9uQXNzZXQ6IG51bGwgYXMgTWVkaWFBc3NldCB8IG51bGwsXHJcbiAgICAgICAgICAgICAgICAgICAgaW1hZ2VDb21wcmVzc29yOiAncG5ncXVhbnQnIGFzIEltYWdlQ29tcHJlc3NvcixcclxuICAgICAgICAgICAgICAgICAgICBjb21wcmVzc2lvblByZXNldDogJ2JhbGFuY2VkJyxcclxuICAgICAgICAgICAgICAgICAgICBjb21wcmVzc2lvblNldHRpbmdzOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHF1YWxpdHlNaW46IDU1LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBxdWFsaXR5TWF4OiA4MCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgc3BlZWQ6IDYsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbG9yczogMTkyLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBkaXRoZXJpbmc6IDAuNyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXVkaW9CaXRyYXRlOiAxMjgsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHNhbXBsZVJhdGU6IDQ0MTAwLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjaGFubmVsczogMixcclxuICAgICAgICAgICAgICAgICAgICAgICAgc2hhcnBRdWFsaXR5OiA4MCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgc2hhcnBDb21wcmVzc2lvbkxldmVsOiA5LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBzaGFycFByb2dyZXNzaXZlOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBzaGFycFBhbGV0dGU6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHNoYXJwTW96anBlZzogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgc2hhcnBDaHJvbWFTdWJzYW1wbGluZzogJzQ6MjowJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmVzaXplV2lkdGg6IG51bGwsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlc2l6ZUhlaWdodDogbnVsbCxcclxuICAgICAgICAgICAgICAgICAgICB9IGFzIENvbXByZXNzaW9uU2V0dGluZ3MsXHJcbiAgICAgICAgICAgICAgICAgICAgaW1hZ2VEaW1lbnNpb25zOiBudWxsIGFzIEltYWdlRGltZW5zaW9ucyB8IG51bGwsXHJcbiAgICAgICAgICAgICAgICAgICAgcmVzaXplTW9kZTogJ3BlcmNlbnQnIGFzICdwZXJjZW50JyB8ICdwaXhlbHMnLFxyXG4gICAgICAgICAgICAgICAgICAgIHJlc2l6ZVBlcmNlbnQ6IDEwMCxcclxuICAgICAgICAgICAgICAgICAgICByZXNpemVXaWR0aDogMCxcclxuICAgICAgICAgICAgICAgICAgICByZXNpemVIZWlnaHQ6IDAsXHJcbiAgICAgICAgICAgICAgICAgICAgY29tcHJlc3Npb25Mb2FkaW5nOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgICAgICBjb21wcmVzc2lvbkFwcGx5aW5nOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgICAgICBjb21wcmVzc2lvbkVycm9yOiAnJyxcclxuICAgICAgICAgICAgICAgICAgICBvcmlnaW5hbE1ldHJpY3M6IG51bGwgYXMgRmlsZU1ldHJpY3MgfCBudWxsLFxyXG4gICAgICAgICAgICAgICAgICAgIG91dHB1dE1ldHJpY3M6IG51bGwgYXMgRmlsZU1ldHJpY3MgfCBudWxsLFxyXG4gICAgICAgICAgICAgICAgICAgIGNvbXByZXNzZWRQcmV2aWV3VXJsOiAnJyxcclxuICAgICAgICAgICAgICAgICAgICBjb21wcmVzc2VkRmlsZVBhdGg6ICcnLFxyXG4gICAgICAgICAgICAgICAgICAgIGNvbXByZXNzaW9uVGVtcERpcmVjdG9yeTogJycsXHJcbiAgICAgICAgICAgICAgICAgICAgY29tcHJlc3Npb25SZXF1ZXN0SWQ6IDAsXG4gICAgICAgICAgICAgICAgICAgIGNvbnZlcnNpb25Bc3NldDogbnVsbCBhcyBNZWRpYUFzc2V0IHwgbnVsbCxcbiAgICAgICAgICAgICAgICAgICAgY29udmVyc2lvblRhcmdldDogJy5wbmcnIGFzIENvbnZlcnNpb25FeHRlbnNpb24sXG4gICAgICAgICAgICAgICAgICAgIGNvbnZlcnNpb25Mb2FkaW5nOiBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgY29udmVyc2lvbkVycm9yOiAnJyxcbiAgICAgICAgICAgICAgICAgICAgY29udmVyc2lvblJlc3VsdFBhdGg6ICcnLFxuICAgICAgICAgICAgICAgICAgICBkZWxldGVBc3NldFRhcmdldDogbnVsbCBhcyBNZWRpYUFzc2V0IHwgbnVsbCxcbiAgICAgICAgICAgICAgICAgICAgZGVsZXRlUmVmZXJlbmNlczogW10gYXMgQXNzZXRSZWZlcmVuY2VbXSxcbiAgICAgICAgICAgICAgICAgICAgZGVsZXRlQnVuZGxlUGF0aHM6IFtdIGFzIHN0cmluZ1tdLFxuICAgICAgICAgICAgICAgICAgICBkZWxldGVTY2FuTG9hZGluZzogZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgIGRlbGV0ZVNjYW5GYWlsZWQ6IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICBkZWxldGVBcHBseWluZzogZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgIGRlbGV0ZUVycm9yOiAnJyxcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGNvbXB1dGVkOiB7XG4gICAgICAgICAgICAgICAgYXNzZXRUeXBlcygpOiBzdHJpbmdbXSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBBcnJheS5mcm9tKG5ldyBTZXQodGhpcy5hc3NldHMubWFwKChhc3NldCkgPT4gYXNzZXQuZXh0ZW5zaW9uKSkpXG4gICAgICAgICAgICAgICAgICAgICAgICAuc29ydCgobGVmdCwgcmlnaHQpID0+IGxlZnQubG9jYWxlQ29tcGFyZShyaWdodCkpO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgY29udmVyc2lvbkZvcm1hdHMoKTogQ29udmVyc2lvbkV4dGVuc2lvbltdIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCF0aGlzLmNvbnZlcnNpb25Bc3NldCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGZvcm1hdHMgPSB0aGlzLmlzSW1hZ2UodGhpcy5jb252ZXJzaW9uQXNzZXQpXG4gICAgICAgICAgICAgICAgICAgICAgICA/IGltYWdlQ29udmVyc2lvbkV4dGVuc2lvbnNcbiAgICAgICAgICAgICAgICAgICAgICAgIDogYXVkaW9Db252ZXJzaW9uRXh0ZW5zaW9ucztcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZvcm1hdHMuZmlsdGVyKChleHRlbnNpb24pID0+IGV4dGVuc2lvbiAhPT0gdGhpcy5jb252ZXJzaW9uQXNzZXQ/LmV4dGVuc2lvbik7XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB2aXNpYmxlQXNzZXRzKCk6IE1lZGlhQXNzZXRbXSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHF1ZXJ5ID0gdGhpcy5zZWFyY2hRdWVyeS50cmltKCkudG9Mb2NhbGVMb3dlckNhc2UoKTtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBmaWx0ZXJlZEFzc2V0cyA9IHRoaXMuYXNzZXRzLmZpbHRlcigoYXNzZXQpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbWF0Y2hlc0V4dGVuc2lvbiA9ICF0aGlzLmV4dGVuc2lvbkZpbHRlclxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfHwgYXNzZXQuZXh0ZW5zaW9uID09PSB0aGlzLmV4dGVuc2lvbkZpbHRlcjtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbWF0Y2hlc1F1ZXJ5ID0gIXF1ZXJ5XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB8fCBhc3NldC5uYW1lLnRvTG9jYWxlTG93ZXJDYXNlKCkuaW5jbHVkZXMocXVlcnkpXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB8fCBhc3NldC5wYXRoLnRvTG9jYWxlTG93ZXJDYXNlKCkuaW5jbHVkZXMocXVlcnkpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gbWF0Y2hlc0V4dGVuc2lvbiAmJiBtYXRjaGVzUXVlcnk7XHJcbiAgICAgICAgICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICAgICAgICAgIGlmICghdGhpcy5zb3J0Q29sdW1uIHx8ICF0aGlzLnNvcnREaXJlY3Rpb24pIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZpbHRlcmVkQXNzZXRzO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZGlyZWN0aW9uID0gdGhpcy5zb3J0RGlyZWN0aW9uID09PSAnYXNjJyA/IDEgOiAtMTtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBzb3J0Q29sdW1uID0gdGhpcy5zb3J0Q29sdW1uIGFzIEV4Y2x1ZGU8U29ydENvbHVtbiwgJyc+O1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBbLi4uZmlsdGVyZWRBc3NldHNdLnNvcnQoKGxlZnQsIHJpZ2h0KSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHNpemVEaWZmZXJlbmNlID0gKGxlZnRbc29ydENvbHVtbl0gLSByaWdodFtzb3J0Q29sdW1uXSkgKiBkaXJlY3Rpb247XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBzaXplRGlmZmVyZW5jZSB8fCBsZWZ0LnBhdGgubG9jYWxlQ29tcGFyZShyaWdodC5wYXRoKTtcclxuICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICB0b3RhbFBhZ2VzKCk6IG51bWJlciB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIE1hdGgubWF4KDEsIE1hdGguY2VpbCh0aGlzLnZpc2libGVBc3NldHMubGVuZ3RoIC8gdGhpcy5wYWdlU2l6ZSkpO1xyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIHBhZ2luYXRlZEFzc2V0cygpOiBNZWRpYUFzc2V0W10ge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHN0YXJ0SW5kZXggPSAodGhpcy5jdXJyZW50UGFnZSAtIDEpICogdGhpcy5wYWdlU2l6ZTtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy52aXNpYmxlQXNzZXRzLnNsaWNlKHN0YXJ0SW5kZXgsIHN0YXJ0SW5kZXggKyB0aGlzLnBhZ2VTaXplKTtcclxuICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICBwYWdlTnVtYmVycygpOiBudW1iZXJbXSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZmlyc3RQYWdlID0gTWF0aC5tYXgoMSwgTWF0aC5taW4oXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuY3VycmVudFBhZ2UgLSAyLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnRvdGFsUGFnZXMgLSA0LFxyXG4gICAgICAgICAgICAgICAgICAgICkpO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGxhc3RQYWdlID0gTWF0aC5taW4odGhpcy50b3RhbFBhZ2VzLCBmaXJzdFBhZ2UgKyA0KTtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBwYWdlczogbnVtYmVyW10gPSBbXTtcclxuICAgICAgICAgICAgICAgICAgICBmb3IgKGxldCBwYWdlID0gZmlyc3RQYWdlOyBwYWdlIDw9IGxhc3RQYWdlOyBwYWdlICs9IDEpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcGFnZXMucHVzaChwYWdlKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHBhZ2VzO1xyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIHBhZ2VSYW5nZVRleHQoKTogc3RyaW5nIHtcbiAgICAgICAgICAgICAgICAgICAgdm9pZCB0aGlzLnNlbGVjdGVkTGFuZ3VhZ2U7XG4gICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLnZpc2libGVBc3NldHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJhbnNsYXRlKCdjb21tb24uZmlsZXNfemVybycpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGZpcnN0SXRlbSA9ICh0aGlzLmN1cnJlbnRQYWdlIC0gMSkgKiB0aGlzLnBhZ2VTaXplICsgMTtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBsYXN0SXRlbSA9IE1hdGgubWluKHRoaXMuY3VycmVudFBhZ2UgKiB0aGlzLnBhZ2VTaXplLCB0aGlzLnZpc2libGVBc3NldHMubGVuZ3RoKTtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gYCR7Zmlyc3RJdGVtfS0ke2xhc3RJdGVtfSAvICR7dHJhbnNsYXRlKCdjb21tb24uZmlsZXNfY291bnQnLCB7IGNvdW50OiB0aGlzLnZpc2libGVBc3NldHMubGVuZ3RoIH0pfWA7XG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIHN0YXR1c1RleHQoKTogc3RyaW5nIHtcbiAgICAgICAgICAgICAgICAgICAgdm9pZCB0aGlzLnNlbGVjdGVkTGFuZ3VhZ2U7XG4gICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLmxvYWRpbmcpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRyYW5zbGF0ZSgnYnJvd3Nlci5sb2FkaW5nX2Fzc2V0cycpO1xuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMudmlzaWJsZUFzc2V0cy5sZW5ndGggIT09IHRoaXMuYXNzZXRzLmxlbmd0aCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJhbnNsYXRlKCdjb21tb24uZmlsdGVyZWRfY291bnQnLCB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmlzaWJsZTogdGhpcy52aXNpYmxlQXNzZXRzLmxlbmd0aCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0b3RhbDogdGhpcy5hc3NldHMubGVuZ3RoLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJhbnNsYXRlKCdjb21tb24uZmlsZXNfY291bnQnLCB7IGNvdW50OiB0aGlzLmFzc2V0cy5sZW5ndGggfSk7XG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgd2F0Y2g6IHtcclxuICAgICAgICAgICAgICAgIHNlYXJjaFF1ZXJ5KCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY3VycmVudFBhZ2UgPSAxO1xyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIGV4dGVuc2lvbkZpbHRlcigpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLmN1cnJlbnRQYWdlID0gMTtcclxuICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICBzb3J0Q29sdW1uKCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY3VycmVudFBhZ2UgPSAxO1xyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIHNvcnREaXJlY3Rpb24oKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jdXJyZW50UGFnZSA9IDE7XHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgcGFnZVNpemUoKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jdXJyZW50UGFnZSA9IDE7XHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgYXNzZXRzKCkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmN1cnJlbnRQYWdlID0gMTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuZXh0ZW5zaW9uRmlsdGVyICYmICF0aGlzLmFzc2V0VHlwZXMuaW5jbHVkZXModGhpcy5leHRlbnNpb25GaWx0ZXIpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmV4dGVuc2lvbkZpbHRlciA9ICcnO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIG1ldGhvZHM6IHtcbiAgICAgICAgICAgICAgICB0OiB0cmFuc2xhdGUsXG4gICAgICAgICAgICAgICAgZm9ybWF0RmlsZVNpemUsXG4gICAgICAgICAgICAgICAgY2hhbmdlTGFuZ3VhZ2UoZXZlbnQ6IEV2ZW50KTogdm9pZCB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGxvY2FsZSA9IChldmVudC50YXJnZXQgYXMgSFRNTFNlbGVjdEVsZW1lbnQpLnZhbHVlIGFzIFN1cHBvcnRlZExvY2FsZTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGxvY2FsZSAhPT0gJ2VuJyAmJiBsb2NhbGUgIT09ICd6aCcgJiYgbG9jYWxlICE9PSAndmknKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICB0aGlzLnNlbGVjdGVkTGFuZ3VhZ2UgPSBsb2NhbGU7XG4gICAgICAgICAgICAgICAgICAgIHNldExhbmd1YWdlKGxvY2FsZSk7XG4gICAgICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBsb2NhbFN0b3JhZ2Uuc2V0SXRlbShsYW5ndWFnZVN0b3JhZ2VLZXksIGxvY2FsZSk7XG4gICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oJ1tjYy1hc3NldHMtY29tcHJlc3NdIENhbm5vdCBzYXZlIHRoZSBzZWxlY3RlZCBsYW5ndWFnZScsIGVycm9yKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB0aGlzLiRmb3JjZVVwZGF0ZSgpO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgaXNJbWFnZShhc3NldDogTWVkaWFBc3NldCk6IGJvb2xlYW4ge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gaW1hZ2VFeHRlbnNpb25zLmhhcyhhc3NldC5leHRlbnNpb24pO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgaXNBdWRpbyhhc3NldDogTWVkaWFBc3NldCk6IGJvb2xlYW4ge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gYXVkaW9FeHRlbnNpb25zLmhhcyhhc3NldC5leHRlbnNpb24pO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgdG9nZ2xlU29ydChjb2x1bW46IEV4Y2x1ZGU8U29ydENvbHVtbiwgJyc+KTogdm9pZCB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuc29ydENvbHVtbiAhPT0gY29sdW1uKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuc29ydENvbHVtbiA9IGNvbHVtbjtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5zb3J0RGlyZWN0aW9uID0gJ2FzYyc7XHJcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmICh0aGlzLnNvcnREaXJlY3Rpb24gPT09ICdhc2MnKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuc29ydERpcmVjdGlvbiA9ICdkZXNjJztcclxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnNvcnRDb2x1bW4gPSAnJztcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5zb3J0RGlyZWN0aW9uID0gJyc7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIHNvcnRJbmRpY2F0b3IoY29sdW1uOiBFeGNsdWRlPFNvcnRDb2x1bW4sICcnPik6IHN0cmluZyB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuc29ydENvbHVtbiAhPT0gY29sdW1uKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAn4oeFJztcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuc29ydERpcmVjdGlvbiA9PT0gJ2FzYycgPyAn4payJyA6ICfilrwnO1xyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIGdvVG9QYWdlKHBhZ2U6IG51bWJlcik6IHZvaWQge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY3VycmVudFBhZ2UgPSBNYXRoLm1pbihNYXRoLm1heChwYWdlLCAxKSwgdGhpcy50b3RhbFBhZ2VzKTtcclxuICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICBjb21wcmVzc2lvblJlc3VsdCgpOiBzdHJpbmcge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICghdGhpcy5zZWxlY3RlZEFzc2V0IHx8IHRoaXMuY29tcHJlc3NlZFNpemUgPT09IG51bGwpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuICcnO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5zZWxlY3RlZEFzc2V0LnNpemUgPT09IDApIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRyYW5zbGF0ZSgnY29tbW9uLmNhbm5vdF9ldmFsdWF0ZScpO1xuICAgICAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGRpZmZlcmVuY2UgPSAoMSAtIHRoaXMuY29tcHJlc3NlZFNpemUgLyB0aGlzLnNlbGVjdGVkQXNzZXQuc2l6ZSkgKiAxMDA7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGRpZmZlcmVuY2UgPiAwKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB0cmFuc2xhdGUoJ2NvbW1vbi5kZWNyZWFzZScsIHsgcGVyY2VudDogZGlmZmVyZW5jZS50b0ZpeGVkKDIpIH0pO1xuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRyYW5zbGF0ZSgnY29tbW9uLmluY3JlYXNlJywgeyBwZXJjZW50OiBNYXRoLmFicyhkaWZmZXJlbmNlKS50b0ZpeGVkKDIpIH0pO1xuICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICBtZXRyaWNEaWZmZXJlbmNlKGJlZm9yZTogbnVtYmVyLCBhZnRlcjogbnVtYmVyKTogc3RyaW5nIHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoYmVmb3JlID09PSAwKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAnMCUnO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBkaWZmZXJlbmNlID0gKDEgLSBhZnRlciAvIGJlZm9yZSkgKiAxMDA7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGRpZmZlcmVuY2UgPj0gMFxyXG4gICAgICAgICAgICAgICAgICAgICAgICA/IHRyYW5zbGF0ZSgnY29tbW9uLmRlY3JlYXNlJywgeyBwZXJjZW50OiBkaWZmZXJlbmNlLnRvRml4ZWQoMikgfSlcbiAgICAgICAgICAgICAgICAgICAgICAgIDogdHJhbnNsYXRlKCdjb21tb24uaW5jcmVhc2UnLCB7IHBlcmNlbnQ6IE1hdGguYWJzKGRpZmZlcmVuY2UpLnRvRml4ZWQoMikgfSk7XG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIGFzeW5jIG9wZW5Bc3NldERldGFpbHMoYXNzZXQ6IE1lZGlhQXNzZXQpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLnNlbGVjdGVkQXNzZXQgPSBhc3NldDtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLmJhc2U2NFNpemUgPSBudWxsO1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY29tcHJlc3NlZFNpemUgPSBudWxsO1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZGV0YWlsRXJyb3IgPSAnJztcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLmRldGFpbExvYWRpbmcgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlcXVlc3RJZCA9ICsrdGhpcy5kZXRhaWxSZXF1ZXN0SWQ7XHJcblxyXG4gICAgICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IG1ldHJpY3MgPSBhd2FpdCBjYWxjdWxhdGVGaWxlTWV0cmljcyhhc3NldC5maWxlUGF0aCwgYXNzZXQubmFtZSk7XHJcblxyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAocmVxdWVzdElkICE9PSB0aGlzLmRldGFpbFJlcXVlc3RJZCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmJhc2U2NFNpemUgPSBtZXRyaWNzLmJhc2U2NFNpemU7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuY29tcHJlc3NlZFNpemUgPSBtZXRyaWNzLnppcFNpemU7XHJcbiAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHJlcXVlc3RJZCAhPT0gdGhpcy5kZXRhaWxSZXF1ZXN0SWQpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmRldGFpbEVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgID8gZXJyb3IubWVzc2FnZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDogdHJhbnNsYXRlKCdlcnJvcnMuaW5zcGVjdF9maWxlJyk7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbY2MtYXNzZXRzLWNvbXByZXNzXSBDYW5ub3QgaW5zcGVjdCAke2Fzc2V0LmZpbGVQYXRofWAsIGVycm9yKTtcclxuICAgICAgICAgICAgICAgICAgICB9IGZpbmFsbHkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAocmVxdWVzdElkID09PSB0aGlzLmRldGFpbFJlcXVlc3RJZCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5kZXRhaWxMb2FkaW5nID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgY2xvc2VBc3NldERldGFpbHMoKTogdm9pZCB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5kZXRhaWxSZXF1ZXN0SWQgKz0gMTtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLnNlbGVjdGVkQXNzZXQgPSBudWxsO1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZGV0YWlsTG9hZGluZyA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZGV0YWlsRXJyb3IgPSAnJztcclxuICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICBpc0NvbXByZXNzaW9uU3VwcG9ydGVkKGFzc2V0OiBNZWRpYUFzc2V0KTogYm9vbGVhbiB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBhc3NldC5leHRlbnNpb24gPT09ICcucG5nJ1xuICAgICAgICAgICAgICAgICAgICAgICAgfHwgYXNzZXQuZXh0ZW5zaW9uID09PSAnLmpwZydcbiAgICAgICAgICAgICAgICAgICAgICAgIHx8IGFzc2V0LmV4dGVuc2lvbiA9PT0gJy5tcDMnO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgb3BlbkNvbnZlcnNpb24oYXNzZXQ6IE1lZGlhQXNzZXQpOiB2b2lkIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jb252ZXJzaW9uQXNzZXQgPSBhc3NldDtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jb252ZXJzaW9uRXJyb3IgPSAnJztcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jb252ZXJzaW9uUmVzdWx0UGF0aCA9ICcnO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBmb3JtYXRzID0gdGhpcy5pc0ltYWdlKGFzc2V0KVxuICAgICAgICAgICAgICAgICAgICAgICAgPyBpbWFnZUNvbnZlcnNpb25FeHRlbnNpb25zXG4gICAgICAgICAgICAgICAgICAgICAgICA6IGF1ZGlvQ29udmVyc2lvbkV4dGVuc2lvbnM7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY29udmVyc2lvblRhcmdldCA9IGZvcm1hdHMuZmluZCgoZXh0ZW5zaW9uKSA9PiBleHRlbnNpb24gIT09IGFzc2V0LmV4dGVuc2lvbilcbiAgICAgICAgICAgICAgICAgICAgICAgIHx8IGZvcm1hdHNbMF07XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBjbG9zZUNvbnZlcnNpb24oKTogdm9pZCB7XG4gICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLmNvbnZlcnNpb25Mb2FkaW5nKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jb252ZXJzaW9uQXNzZXQgPSBudWxsO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmNvbnZlcnNpb25FcnJvciA9ICcnO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmNvbnZlcnNpb25SZXN1bHRQYXRoID0gJyc7XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBhc3luYyBjb252ZXJ0QXNzZXQoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGFzc2V0ID0gdGhpcy5jb252ZXJzaW9uQXNzZXQ7XG4gICAgICAgICAgICAgICAgICAgIGlmICghYXNzZXQgfHwgIXRoaXMuY29udmVyc2lvblRhcmdldCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jb252ZXJzaW9uTG9hZGluZyA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY29udmVyc2lvbkVycm9yID0gJyc7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY29udmVyc2lvblJlc3VsdFBhdGggPSAnJztcbiAgICAgICAgICAgICAgICAgICAgbGV0IHRlbXBEaXJlY3RvcnkgPSAnJztcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRlbXBEaXJlY3RvcnkgPSBhd2FpdCBta2R0ZW1wKGpvaW4odG1wZGlyKCksICdjYy1hc3NldHMtY29udmVydC0nKSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBvdXRwdXRQYXRoID0gYXdhaXQgY29udmVydEZpbGUoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYXNzZXQuZmlsZVBhdGgsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5jb252ZXJzaW9uVGFyZ2V0LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRlbXBEaXJlY3RvcnksXG4gICAgICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYmFzZVVybCA9IGFzc2V0LnBhdGguc2xpY2UoMCwgLWFzc2V0LmV4dGVuc2lvbi5sZW5ndGgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcmVxdWVzdGVkVXJsID0gYCR7YmFzZVVybH0ke3RoaXMuY29udmVyc2lvblRhcmdldH1gO1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYXZhaWxhYmxlVXJsID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnYXNzZXQtZGInLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdnZW5lcmF0ZS1hdmFpbGFibGUtdXJsJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXF1ZXN0ZWRVcmwsXG4gICAgICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgY3JlYXRlZEFzc2V0ID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnYXNzZXQtZGInLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdjcmVhdGUtYXNzZXQnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF2YWlsYWJsZVVybCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZWFkRmlsZVN5bmMob3V0cHV0UGF0aCksXG4gICAgICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFjcmVhdGVkQXNzZXQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IodHJhbnNsYXRlKCdlcnJvcnMuY3JlYXRlX2NvbnZlcnRlZF9hc3NldCcpKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuY29udmVyc2lvblJlc3VsdFBhdGggPSBjcmVhdGVkQXNzZXQudXJsIHx8IGF2YWlsYWJsZVVybDtcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMubG9hZEFzc2V0cygpO1xuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5jb252ZXJzaW9uRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPyBlcnJvci5tZXNzYWdlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgOiB0cmFuc2xhdGUoJ2Vycm9ycy5jb252ZXJ0X2Fzc2V0Jyk7XG4gICAgICAgICAgICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAodGVtcERpcmVjdG9yeSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IHJlbW92ZSh0ZW1wRGlyZWN0b3J5KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oYFtjYy1hc3NldHMtY29tcHJlc3NdIENhbm5vdCByZW1vdmUgY29udmVyc2lvbiBkaXJlY3Rvcnk6ICR7dGVtcERpcmVjdG9yeX1gLCBlcnJvcik7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5jb252ZXJzaW9uTG9hZGluZyA9IGZhbHNlO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBhc3luYyBmaW5kQXNzZXRSZWZlcmVuY2VzKGFzc2V0OiBNZWRpYUFzc2V0KTogUHJvbWlzZTxBc3NldFJlZmVyZW5jZVtdPiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlZmVyZW5jZXMgPSBuZXcgTWFwPHN0cmluZywgQXNzZXRSZWZlcmVuY2U+KCk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHZpc2l0ZWQgPSBuZXcgU2V0PHN0cmluZz4oW2Fzc2V0LnV1aWRdKTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcXVldWUgPSBbYXNzZXQudXVpZF07XG5cbiAgICAgICAgICAgICAgICAgICAgd2hpbGUgKHF1ZXVlLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHV1aWQgPSBxdWV1ZS5zaGlmdCgpIGFzIHN0cmluZztcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHVzZXJzID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnYXNzZXQtZGInLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdxdWVyeS1hc3NldC11c2VycycsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdXVpZCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnYXNzZXQnLFxuICAgICAgICAgICAgICAgICAgICAgICAgKSBhcyBzdHJpbmdbXTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCB1c2VyVXVpZCBvZiB1c2VycyB8fCBbXSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICh2aXNpdGVkLmhhcyh1c2VyVXVpZCkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZpc2l0ZWQuYWRkKHVzZXJVdWlkKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBpbmZvID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2Fzc2V0LWRiJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ3F1ZXJ5LWFzc2V0LWluZm8nLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB1c2VyVXVpZCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgWyd1dWlkJywgJ25hbWUnLCAnZmlsZScsICd1cmwnLCAnc291cmNlJywgJ3R5cGUnLCAnaXNEaXJlY3RvcnknXSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICApIGFzIEFzc2V0RGJJbmZvIHwgbnVsbDtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWluZm8gfHwgaW5mby5pc0RpcmVjdG9yeSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBleHRlbnNpb24gPSBleHRuYW1lKGluZm8uZmlsZSB8fCBpbmZvLnVybCB8fCBpbmZvLnNvdXJjZSkudG9Mb3dlckNhc2UoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoZXh0ZW5zaW9uID09PSAnLnNjZW5lJykge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBoaWVyYXJjaHlSZWZlcmVuY2VzID0gcmVhZFNjZW5lSGllcmFyY2h5UmVmZXJlbmNlcyhpbmZvLmZpbGUsIHV1aWQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoaGllcmFyY2h5UmVmZXJlbmNlcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlZmVyZW5jZXMuc2V0KGAke2luZm8udXVpZH06dW5rbm93bmAsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB1dWlkOiBpbmZvLnV1aWQsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbmFtZTogaW5mby5uYW1lIHx8IGJhc2VuYW1lKGluZm8uZmlsZSksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcGF0aDogaW5mby51cmwgfHwgaW5mby5zb3VyY2UsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAga2luZDogJ3NjZW5lJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZWZlcmVuY2VkQXNzZXRVdWlkOiB1dWlkLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IGhpZXJhcmNoeVJlZmVyZW5jZSBvZiBoaWVyYXJjaHlSZWZlcmVuY2VzKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBrZXkgPSBgJHtpbmZvLnV1aWR9OiR7aGllcmFyY2h5UmVmZXJlbmNlLm5vZGVVdWlkIHx8IGhpZXJhcmNoeVJlZmVyZW5jZS5oaWVyYXJjaHlQYXRofWA7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZWZlcmVuY2VzLnNldChrZXksIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB1dWlkOiBpbmZvLnV1aWQsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbmFtZTogaW5mby5uYW1lIHx8IGJhc2VuYW1lKGluZm8uZmlsZSksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcGF0aDogaW5mby51cmwgfHwgaW5mby5zb3VyY2UsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAga2luZDogJ3NjZW5lJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoaWVyYXJjaHlQYXRoOiBoaWVyYXJjaHlSZWZlcmVuY2UuaGllcmFyY2h5UGF0aCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBub2RlVXVpZDogaGllcmFyY2h5UmVmZXJlbmNlLm5vZGVVdWlkLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlZmVyZW5jZWRBc3NldFV1aWQ6IHV1aWQsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoZXh0ZW5zaW9uID09PSAnLnByZWZhYicpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVmZXJlbmNlcy5zZXQoaW5mby51dWlkLCB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB1dWlkOiBpbmZvLnV1aWQsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiBpbmZvLm5hbWUgfHwgYmFzZW5hbWUoaW5mby5maWxlKSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhdGg6IGluZm8udXJsIHx8IGluZm8uc291cmNlLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAga2luZDogJ3ByZWZhYicsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHF1ZXVlLnB1c2godXNlclV1aWQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBBcnJheS5mcm9tKHJlZmVyZW5jZXMudmFsdWVzKCkpXG4gICAgICAgICAgICAgICAgICAgICAgICAuc29ydCgobGVmdCwgcmlnaHQpID0+IGxlZnQucGF0aC5sb2NhbGVDb21wYXJlKHJpZ2h0LnBhdGgpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfHwgKGxlZnQuaGllcmFyY2h5UGF0aCB8fCAnJykubG9jYWxlQ29tcGFyZShyaWdodC5oaWVyYXJjaHlQYXRoIHx8ICcnKSk7XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBhc3luYyBzZWxlY3RBc3NldFJlZmVyZW5jZShyZWZlcmVuY2U6IEFzc2V0UmVmZXJlbmNlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZGVsZXRlRXJyb3IgPSAnJztcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChyZWZlcmVuY2Uua2luZCA9PT0gJ3ByZWZhYicpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBFZGl0b3IuU2VsZWN0aW9uLmNsZWFyKCdhc3NldCcpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIEVkaXRvci5TZWxlY3Rpb24uc2VsZWN0KCdhc3NldCcsIHJlZmVyZW5jZS51dWlkKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ29wZW4tc2NlbmUnLCByZWZlcmVuY2UudXVpZCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBsZXQgbm9kZVV1aWRzOiBzdHJpbmdbXSA9IFtdO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHJlZmVyZW5jZS5yZWZlcmVuY2VkQXNzZXRVdWlkKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbm9kZVV1aWRzID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ3NjZW5lJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ3F1ZXJ5LW5vZGVzLWJ5LWFzc2V0LXV1aWQnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZWZlcmVuY2UucmVmZXJlbmNlZEFzc2V0VXVpZCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICApIGFzIHN0cmluZ1tdO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgbm9kZVV1aWQgPSByZWZlcmVuY2Uubm9kZVV1aWQgJiYgbm9kZVV1aWRzLmluY2x1ZGVzKHJlZmVyZW5jZS5ub2RlVXVpZClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA/IHJlZmVyZW5jZS5ub2RlVXVpZFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDogbm9kZVV1aWRzWzBdIHx8IHJlZmVyZW5jZS5ub2RlVXVpZDtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghbm9kZVV1aWQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IodHJhbnNsYXRlKCdlcnJvcnMuc2NlbmVfbm9kZV9ub3RfZm91bmQnKSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBFZGl0b3IuU2VsZWN0aW9uLmNsZWFyKCdub2RlJyk7XG4gICAgICAgICAgICAgICAgICAgICAgICBFZGl0b3IuU2VsZWN0aW9uLnNlbGVjdCgnbm9kZScsIG5vZGVVdWlkKTtcbiAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuZGVsZXRlRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPyBlcnJvci5tZXNzYWdlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgOiB0cmFuc2xhdGUoJ2Vycm9ycy5zZWxlY3RfcmVmZXJlbmNlJyk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGFzeW5jIGZpbmRCdW5kbGVQYXRocyhhc3NldDogTWVkaWFBc3NldCk6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFhc3NldC5wYXRoLnN0YXJ0c1dpdGgoJ2RiOi8vYXNzZXRzLycpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gW107XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcmVsYXRpdmVQYXRoID0gYXNzZXQucGF0aC5zbGljZSgnZGI6Ly9hc3NldHMvJy5sZW5ndGgpO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBzZWdtZW50cyA9IHJlbGF0aXZlUGF0aC5zcGxpdCgnLycpO1xuICAgICAgICAgICAgICAgICAgICBzZWdtZW50cy5wb3AoKTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgYnVuZGxlUGF0aHM6IHN0cmluZ1tdID0gW107XG5cbiAgICAgICAgICAgICAgICAgICAgZm9yIChsZXQgaW5kZXggPSAxOyBpbmRleCA8PSBzZWdtZW50cy5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGZvbGRlclVybCA9IGBkYjovL2Fzc2V0cy8ke3NlZ21lbnRzLnNsaWNlKDAsIGluZGV4KS5qb2luKCcvJyl9YDtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IFtpbmZvLCBtZXRhXSA9IGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnYXNzZXQtZGInLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAncXVlcnktYXNzZXQtaW5mbycsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZvbGRlclVybCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgWyd1cmwnLCAnaXNEaXJlY3RvcnknLCAnaXNCdW5kbGUnXSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICApIGFzIFByb21pc2U8QXNzZXREYkluZm8gfCBudWxsPixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdxdWVyeS1hc3NldC1tZXRhJywgZm9sZGVyVXJsKSxcbiAgICAgICAgICAgICAgICAgICAgICAgIF0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdXNlckRhdGEgPSBtZXRhPy51c2VyRGF0YSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IHVuZGVmaW5lZDtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChpbmZvPy5pc0J1bmRsZSB8fCB1c2VyRGF0YT8uaXNCdW5kbGUgPT09IHRydWUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBidW5kbGVQYXRocy5wdXNoKGZvbGRlclVybCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGJ1bmRsZVBhdGhzO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgYXN5bmMgb3BlbkRlbGV0ZUFzc2V0KGFzc2V0OiBNZWRpYUFzc2V0KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZGVsZXRlQXNzZXRUYXJnZXQgPSBhc3NldDtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5kZWxldGVSZWZlcmVuY2VzID0gW107XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZGVsZXRlQnVuZGxlUGF0aHMgPSBbXTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5kZWxldGVFcnJvciA9ICcnO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmRlbGV0ZVNjYW5GYWlsZWQgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5kZWxldGVTY2FuTG9hZGluZyA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBbcmVmZXJlbmNlcywgYnVuZGxlUGF0aHNdID0gYXdhaXQgUHJvbWlzZS5hbGwoW1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuZmluZEFzc2V0UmVmZXJlbmNlcyhhc3NldCksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5maW5kQnVuZGxlUGF0aHMoYXNzZXQpLFxuICAgICAgICAgICAgICAgICAgICAgICAgXSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5kZWxldGVBc3NldFRhcmdldD8udXVpZCAhPT0gYXNzZXQudXVpZCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuZGVsZXRlUmVmZXJlbmNlcyA9IHJlZmVyZW5jZXM7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmRlbGV0ZUJ1bmRsZVBhdGhzID0gYnVuZGxlUGF0aHM7XG4gICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmRlbGV0ZVNjYW5GYWlsZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5kZWxldGVFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3JcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA/IGVycm9yLm1lc3NhZ2VcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA6IHRyYW5zbGF0ZSgnZXJyb3JzLnNjYW5fcmVmZXJlbmNlcycpO1xuICAgICAgICAgICAgICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuZGVsZXRlQXNzZXRUYXJnZXQ/LnV1aWQgPT09IGFzc2V0LnV1aWQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmRlbGV0ZVNjYW5Mb2FkaW5nID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGNsb3NlRGVsZXRlQXNzZXQoKTogdm9pZCB7XG4gICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLmRlbGV0ZUFwcGx5aW5nKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgdGhpcy5kZWxldGVBc3NldFRhcmdldCA9IG51bGw7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZGVsZXRlUmVmZXJlbmNlcyA9IFtdO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmRlbGV0ZUJ1bmRsZVBhdGhzID0gW107XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZGVsZXRlRXJyb3IgPSAnJztcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5kZWxldGVTY2FuRmFpbGVkID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZGVsZXRlU2NhbkxvYWRpbmcgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGFzeW5jIGNvbmZpcm1EZWxldGVBc3NldCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgYXNzZXQgPSB0aGlzLmRlbGV0ZUFzc2V0VGFyZ2V0O1xuICAgICAgICAgICAgICAgICAgICBpZiAoIWFzc2V0IHx8IHRoaXMuZGVsZXRlU2NhbkxvYWRpbmcpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB0aGlzLmRlbGV0ZUFwcGx5aW5nID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5kZWxldGVFcnJvciA9ICcnO1xuICAgICAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZGVsZXRlZEFzc2V0ID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnYXNzZXQtZGInLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdkZWxldGUtYXNzZXQnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFzc2V0LnBhdGgsXG4gICAgICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFkZWxldGVkQXNzZXQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IodHJhbnNsYXRlKCdlcnJvcnMuZGVsZXRlX2Fzc2V0JykpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGF3YWl0IHBhdGhFeGlzdHMoYXNzZXQuYmFja3VwUGF0aCkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCByZW1vdmUoYXNzZXQuYmFja3VwUGF0aCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmRlbGV0ZUFwcGx5aW5nID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmNsb3NlRGVsZXRlQXNzZXQoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMubG9hZEFzc2V0cygpO1xuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5kZWxldGVFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3JcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA/IGVycm9yLm1lc3NhZ2VcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA6IHRyYW5zbGF0ZSgnZXJyb3JzLmRlbGV0ZV9hc3NldCcpO1xuICAgICAgICAgICAgICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5kZWxldGVBcHBseWluZyA9IGZhbHNlO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBhcHBseUNvbXByZXNzaW9uUHJlc2V0KHByZXNldDogc3RyaW5nKTogdm9pZCB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jb21wcmVzc2lvblByZXNldCA9IHByZXNldDtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBpc0F1ZGlvID0gdGhpcy5jb21wcmVzc2lvbkFzc2V0Py5leHRlbnNpb24gPT09ICcubXAzJztcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGlzQXVkaW8pIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcHJlc2V0czogUmVjb3JkPHN0cmluZywgUGFydGlhbDxDb21wcmVzc2lvblNldHRpbmdzPj4gPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBoaWdoOiB7IGF1ZGlvQml0cmF0ZTogMTkyLCBzYW1wbGVSYXRlOiA0ODAwMCwgY2hhbm5lbHM6IDIgfSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJhbGFuY2VkOiB7IGF1ZGlvQml0cmF0ZTogMTI4LCBzYW1wbGVSYXRlOiA0NDEwMCwgY2hhbm5lbHM6IDIgfSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNtYWxsOiB7IGF1ZGlvQml0cmF0ZTogNjQsIHNhbXBsZVJhdGU6IDIyMDUwLCBjaGFubmVsczogMSB9LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBPYmplY3QuYXNzaWduKHRoaXMuY29tcHJlc3Npb25TZXR0aW5ncywgcHJlc2V0c1twcmVzZXRdIHx8IHt9KTtcclxuICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHRoaXMuaW1hZ2VDb21wcmVzc29yID09PSAnc2hhcnAnKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGlzSnBlZyA9IHRoaXMuY29tcHJlc3Npb25Bc3NldD8uZXh0ZW5zaW9uID09PSAnLmpwZyc7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHByZXNldHM6IFJlY29yZDxzdHJpbmcsIFBhcnRpYWw8Q29tcHJlc3Npb25TZXR0aW5ncz4+ID0gaXNKcGVnXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA/IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoaWdoOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNoYXJwUXVhbGl0eTogOTIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNoYXJwUHJvZ3Jlc3NpdmU6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNoYXJwTW96anBlZzogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc2hhcnBDaHJvbWFTdWJzYW1wbGluZzogJzQ6NDo0JyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJhbGFuY2VkOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNoYXJwUXVhbGl0eTogODAsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNoYXJwUHJvZ3Jlc3NpdmU6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNoYXJwTW96anBlZzogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc2hhcnBDaHJvbWFTdWJzYW1wbGluZzogJzQ6MjowJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNtYWxsOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNoYXJwUXVhbGl0eTogNjAsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNoYXJwUHJvZ3Jlc3NpdmU6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNoYXJwTW96anBlZzogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc2hhcnBDaHJvbWFTdWJzYW1wbGluZzogJzQ6MjowJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGlnaDoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzaGFycFF1YWxpdHk6IDk1LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzaGFycENvbXByZXNzaW9uTGV2ZWw6IDYsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNoYXJwUHJvZ3Jlc3NpdmU6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNoYXJwUGFsZXR0ZTogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBiYWxhbmNlZDoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzaGFycFF1YWxpdHk6IDgwLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzaGFycENvbXByZXNzaW9uTGV2ZWw6IDksXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNoYXJwUHJvZ3Jlc3NpdmU6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNoYXJwUGFsZXR0ZTogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29sb3JzOiAxOTIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRpdGhlcmluZzogMC43LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc21hbGw6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc2hhcnBRdWFsaXR5OiA2MCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc2hhcnBDb21wcmVzc2lvbkxldmVsOiA5LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzaGFycFByb2dyZXNzaXZlOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzaGFycFBhbGV0dGU6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbG9yczogMTI4LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBkaXRoZXJpbmc6IDAuNSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgT2JqZWN0LmFzc2lnbih0aGlzLmNvbXByZXNzaW9uU2V0dGluZ3MsIHByZXNldHNbcHJlc2V0XSB8fCB7fSk7XHJcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcHJlc2V0czogUmVjb3JkPHN0cmluZywgUGFydGlhbDxDb21wcmVzc2lvblNldHRpbmdzPj4gPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBoaWdoOiB7IHF1YWxpdHlNaW46IDc1LCBxdWFsaXR5TWF4OiA5NSwgc3BlZWQ6IDMsIGNvbG9yczogMjU2LCBkaXRoZXJpbmc6IDAuOCB9LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYmFsYW5jZWQ6IHsgcXVhbGl0eU1pbjogNTUsIHF1YWxpdHlNYXg6IDgwLCBzcGVlZDogNiwgY29sb3JzOiAxOTIsIGRpdGhlcmluZzogMC43IH0sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzbWFsbDogeyBxdWFsaXR5TWluOiAzMCwgcXVhbGl0eU1heDogNjAsIHNwZWVkOiA5LCBjb2xvcnM6IDEyOCwgZGl0aGVyaW5nOiAwLjUgfSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgT2JqZWN0LmFzc2lnbih0aGlzLmNvbXByZXNzaW9uU2V0dGluZ3MsIHByZXNldHNbcHJlc2V0XSB8fCB7fSk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuaW52YWxpZGF0ZUNvbXByZXNzaW9uUHJldmlldygpO1xyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIGNoYW5nZUltYWdlQ29tcHJlc3NvcigpOiB2b2lkIHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5jb21wcmVzc2lvbkFzc2V0Py5leHRlbnNpb24gPT09ICcuanBnJykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmltYWdlQ29tcHJlc3NvciA9ICdzaGFycCc7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuYXBwbHlDb21wcmVzc2lvblByZXNldCgnYmFsYW5jZWQnKTtcclxuICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICByZXNldFJlc2l6ZU9wdGlvbnMoZGltZW5zaW9uczogSW1hZ2VEaW1lbnNpb25zKTogdm9pZCB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5yZXNpemVNb2RlID0gJ3BlcmNlbnQnO1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMucmVzaXplUGVyY2VudCA9IDEwMDtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLnJlc2l6ZVdpZHRoID0gZGltZW5zaW9ucy53aWR0aDtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLnJlc2l6ZUhlaWdodCA9IGRpbWVuc2lvbnMuaGVpZ2h0O1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY29tcHJlc3Npb25TZXR0aW5ncy5yZXNpemVXaWR0aCA9IG51bGw7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jb21wcmVzc2lvblNldHRpbmdzLnJlc2l6ZUhlaWdodCA9IG51bGw7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5pbnZhbGlkYXRlQ29tcHJlc3Npb25QcmV2aWV3KCk7XHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgY2hhbmdlUmVzaXplTW9kZSgpOiB2b2lkIHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5yZXNpemVNb2RlID09PSAncGVyY2VudCcpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy51cGRhdGVSZXNpemVGcm9tUGVyY2VudCgpO1xyXG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMudXBkYXRlUmVzaXplRnJvbVdpZHRoKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIHVwZGF0ZVJlc2l6ZUZyb21QZXJjZW50KCk6IHZvaWQge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICghdGhpcy5pbWFnZURpbWVuc2lvbnMpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBwZXJjZW50ID0gTnVtYmVyKHRoaXMucmVzaXplUGVyY2VudCk7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFOdW1iZXIuaXNGaW5pdGUocGVyY2VudCkgfHwgcGVyY2VudCA8PSAwKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5yZXNpemVXaWR0aCA9IE1hdGgubWF4KDEsIE1hdGgucm91bmQodGhpcy5pbWFnZURpbWVuc2lvbnMud2lkdGggKiBwZXJjZW50IC8gMTAwKSk7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5yZXNpemVIZWlnaHQgPSBNYXRoLm1heCgxLCBNYXRoLnJvdW5kKHRoaXMuaW1hZ2VEaW1lbnNpb25zLmhlaWdodCAqIHBlcmNlbnQgLyAxMDApKTtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLnVwZGF0ZVJlc2l6ZVNldHRpbmdzKCk7XHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgdXBkYXRlUmVzaXplRnJvbVdpZHRoKCk6IHZvaWQge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICghdGhpcy5pbWFnZURpbWVuc2lvbnMgfHwgdGhpcy5yZXNpemVXaWR0aCA8PSAwKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5yZXNpemVIZWlnaHQgPSBNYXRoLm1heCgxLCBNYXRoLnJvdW5kKFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnJlc2l6ZVdpZHRoICogdGhpcy5pbWFnZURpbWVuc2lvbnMuaGVpZ2h0IC8gdGhpcy5pbWFnZURpbWVuc2lvbnMud2lkdGgsXHJcbiAgICAgICAgICAgICAgICAgICAgKSk7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5yZXNpemVQZXJjZW50ID0gTnVtYmVyKCh0aGlzLnJlc2l6ZVdpZHRoIC8gdGhpcy5pbWFnZURpbWVuc2lvbnMud2lkdGggKiAxMDApLnRvRml4ZWQoMikpO1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMudXBkYXRlUmVzaXplU2V0dGluZ3MoKTtcclxuICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICB1cGRhdGVSZXNpemVGcm9tSGVpZ2h0KCk6IHZvaWQge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICghdGhpcy5pbWFnZURpbWVuc2lvbnMgfHwgdGhpcy5yZXNpemVIZWlnaHQgPD0gMCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMucmVzaXplV2lkdGggPSBNYXRoLm1heCgxLCBNYXRoLnJvdW5kKFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnJlc2l6ZUhlaWdodCAqIHRoaXMuaW1hZ2VEaW1lbnNpb25zLndpZHRoIC8gdGhpcy5pbWFnZURpbWVuc2lvbnMuaGVpZ2h0LFxyXG4gICAgICAgICAgICAgICAgICAgICkpO1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMucmVzaXplUGVyY2VudCA9IE51bWJlcigodGhpcy5yZXNpemVIZWlnaHQgLyB0aGlzLmltYWdlRGltZW5zaW9ucy5oZWlnaHQgKiAxMDApLnRvRml4ZWQoMikpO1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMudXBkYXRlUmVzaXplU2V0dGluZ3MoKTtcclxuICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICB1cGRhdGVSZXNpemVTZXR0aW5ncygpOiB2b2lkIHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoIXRoaXMuaW1hZ2VEaW1lbnNpb25zKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdW5jaGFuZ2VkID0gdGhpcy5yZXNpemVXaWR0aCA9PT0gdGhpcy5pbWFnZURpbWVuc2lvbnMud2lkdGhcclxuICAgICAgICAgICAgICAgICAgICAgICAgJiYgdGhpcy5yZXNpemVIZWlnaHQgPT09IHRoaXMuaW1hZ2VEaW1lbnNpb25zLmhlaWdodDtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLmNvbXByZXNzaW9uU2V0dGluZ3MucmVzaXplV2lkdGggPSB1bmNoYW5nZWQgPyBudWxsIDogdGhpcy5yZXNpemVXaWR0aDtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLmNvbXByZXNzaW9uU2V0dGluZ3MucmVzaXplSGVpZ2h0ID0gdW5jaGFuZ2VkID8gbnVsbCA6IHRoaXMucmVzaXplSGVpZ2h0O1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMudXNlQ3VzdG9tQ29tcHJlc3Npb25TZXR0aW5ncygpO1xyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIHVzZUN1c3RvbUNvbXByZXNzaW9uU2V0dGluZ3MoKTogdm9pZCB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jb21wcmVzc2lvblByZXNldCA9ICdjdXN0b20nO1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuaW52YWxpZGF0ZUNvbXByZXNzaW9uUHJldmlldygpO1xyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIGludmFsaWRhdGVDb21wcmVzc2lvblByZXZpZXcoKTogdm9pZCB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5vdXRwdXRNZXRyaWNzID0gbnVsbDtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLmNvbXByZXNzZWRQcmV2aWV3VXJsID0gJyc7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jb21wcmVzc2VkRmlsZVBhdGggPSAnJztcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLmNvbXByZXNzaW9uRXJyb3IgPSAnJztcclxuICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICB2YWxpZGF0ZUNvbXByZXNzaW9uU2V0dGluZ3MoKTogc3RyaW5nIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBzZXR0aW5ncyA9IHRoaXMuY29tcHJlc3Npb25TZXR0aW5ncztcclxuICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5jb21wcmVzc2lvbkFzc2V0ICYmIHRoaXMuaXNJbWFnZSh0aGlzLmNvbXByZXNzaW9uQXNzZXQpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLnJlc2l6ZVdpZHRoIDwgMSB8fCB0aGlzLnJlc2l6ZUhlaWdodCA8IDFcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHx8IHRoaXMucmVzaXplV2lkdGggPiAxNjM4NCB8fCB0aGlzLnJlc2l6ZUhlaWdodCA+IDE2Mzg0KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJhbnNsYXRlKCdlcnJvcnMucmVzaXplX3JhbmdlJyk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLmNvbXByZXNzaW9uQXNzZXQ/LmV4dGVuc2lvbiA9PT0gJy5wbmcnICYmIHRoaXMuaW1hZ2VDb21wcmVzc29yID09PSAncG5ncXVhbnQnKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChzZXR0aW5ncy5xdWFsaXR5TWluIDwgMCB8fCBzZXR0aW5ncy5xdWFsaXR5TWF4ID4gMTAwXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB8fCBzZXR0aW5ncy5xdWFsaXR5TWluID4gc2V0dGluZ3MucXVhbGl0eU1heCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRyYW5zbGF0ZSgnZXJyb3JzLnF1YWxpdHlfb3JkZXInKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHNldHRpbmdzLnNwZWVkIDwgMSB8fCBzZXR0aW5ncy5zcGVlZCA+IDExKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJhbnNsYXRlKCdlcnJvcnMucG5ncXVhbnRfc3BlZWQnKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFOdW1iZXIuaXNJbnRlZ2VyKHNldHRpbmdzLmNvbG9ycylcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHx8IHNldHRpbmdzLmNvbG9ycyA8IDIgfHwgc2V0dGluZ3MuY29sb3JzID4gMjU2KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJhbnNsYXRlKCdlcnJvcnMuY29sb3JfcmFuZ2UnKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHNldHRpbmdzLmRpdGhlcmluZyA8IDAgfHwgc2V0dGluZ3MuZGl0aGVyaW5nID4gMSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRyYW5zbGF0ZSgnZXJyb3JzLmRpdGhlcmluZ19yYW5nZScpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoKHRoaXMuY29tcHJlc3Npb25Bc3NldD8uZXh0ZW5zaW9uID09PSAnLnBuZydcclxuICAgICAgICAgICAgICAgICAgICAgICAgfHwgdGhpcy5jb21wcmVzc2lvbkFzc2V0Py5leHRlbnNpb24gPT09ICcuanBnJylcclxuICAgICAgICAgICAgICAgICAgICAgICAgJiYgdGhpcy5pbWFnZUNvbXByZXNzb3IgPT09ICdzaGFycCcpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHNldHRpbmdzLnNoYXJwUXVhbGl0eSA8IDEgfHwgc2V0dGluZ3Muc2hhcnBRdWFsaXR5ID4gMTAwKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJhbnNsYXRlKCdlcnJvcnMuc2hhcnBfcXVhbGl0eScpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoc2V0dGluZ3Muc2hhcnBDb21wcmVzc2lvbkxldmVsIDwgMCB8fCBzZXR0aW5ncy5zaGFycENvbXByZXNzaW9uTGV2ZWwgPiA5KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJhbnNsYXRlKCdlcnJvcnMuY29tcHJlc3Npb25fbGV2ZWwnKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuY29tcHJlc3Npb25Bc3NldC5leHRlbnNpb24gPT09ICcucG5nJyAmJiBzZXR0aW5ncy5zaGFycFBhbGV0dGUpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICghTnVtYmVyLmlzSW50ZWdlcihzZXR0aW5ncy5jb2xvcnMpXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfHwgc2V0dGluZ3MuY29sb3JzIDwgMiB8fCBzZXR0aW5ncy5jb2xvcnMgPiAyNTYpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJhbnNsYXRlKCdlcnJvcnMuY29sb3JfcmFuZ2UnKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoc2V0dGluZ3MuZGl0aGVyaW5nIDwgMCB8fCBzZXR0aW5ncy5kaXRoZXJpbmcgPiAxKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRyYW5zbGF0ZSgnZXJyb3JzLmRpdGhlcmluZ19yYW5nZScpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAodGhpcy5jb21wcmVzc2lvbkFzc2V0Py5leHRlbnNpb24gPT09ICcubXAzJykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoc2V0dGluZ3MuYXVkaW9CaXRyYXRlIDwgOCB8fCBzZXR0aW5ncy5hdWRpb0JpdHJhdGUgPiAzMjApIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB0cmFuc2xhdGUoJ2Vycm9ycy5iaXRyYXRlX3JhbmdlJyk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChzZXR0aW5ncy5zYW1wbGVSYXRlIDwgODAwMCB8fCBzZXR0aW5ncy5zYW1wbGVSYXRlID4gNDgwMDApIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB0cmFuc2xhdGUoJ2Vycm9ycy5zYW1wbGVfcmF0ZV9yYW5nZScpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoc2V0dGluZ3MuY2hhbm5lbHMgIT09IDEgJiYgc2V0dGluZ3MuY2hhbm5lbHMgIT09IDIpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB0cmFuc2xhdGUoJ2Vycm9ycy5jaGFubmVsX3JhbmdlJyk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiAnJztcclxuICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICBhc3luYyBvcGVuQ29tcHJlc3Npb24oYXNzZXQ6IE1lZGlhQXNzZXQpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLmNvbXByZXNzaW9uQXNzZXQgPSBhc3NldDtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLmNvbXByZXNzaW9uRXJyb3IgPSAnJztcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLm9yaWdpbmFsTWV0cmljcyA9IG51bGw7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5vdXRwdXRNZXRyaWNzID0gbnVsbDtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLmNvbXByZXNzZWRQcmV2aWV3VXJsID0gJyc7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jb21wcmVzc2VkRmlsZVBhdGggPSAnJztcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLmltYWdlRGltZW5zaW9ucyA9IG51bGw7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5pbWFnZUNvbXByZXNzb3IgPSBhc3NldC5leHRlbnNpb24gPT09ICcuanBnJyA/ICdzaGFycCcgOiAncG5ncXVhbnQnO1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuYXBwbHlDb21wcmVzc2lvblByZXNldCgnYmFsYW5jZWQnKTtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCByZXF1ZXN0SWQgPSArK3RoaXMuY29tcHJlc3Npb25SZXF1ZXN0SWQ7XHJcblxyXG4gICAgICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IFttZXRyaWNzLCBkaW1lbnNpb25zXSA9IGF3YWl0IFByb21pc2UuYWxsKFtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNhbGN1bGF0ZUZpbGVNZXRyaWNzKGFzc2V0LmZpbGVQYXRoLCBhc3NldC5uYW1lKSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuaXNJbWFnZShhc3NldClcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA/IGdldEltYWdlRGltZW5zaW9ucyhhc3NldC5maWxlUGF0aClcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA6IFByb21pc2UucmVzb2x2ZShudWxsKSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgXSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChyZXF1ZXN0SWQgPT09IHRoaXMuY29tcHJlc3Npb25SZXF1ZXN0SWQpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMub3JpZ2luYWxNZXRyaWNzID0gbWV0cmljcztcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuaW1hZ2VEaW1lbnNpb25zID0gZGltZW5zaW9ucztcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChkaW1lbnNpb25zKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5yZXNldFJlc2l6ZU9wdGlvbnMoZGltZW5zaW9ucyk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAocmVxdWVzdElkID09PSB0aGlzLmNvbXByZXNzaW9uUmVxdWVzdElkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmNvbXByZXNzaW9uRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPyBlcnJvci5tZXNzYWdlXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgOiB0cmFuc2xhdGUoJ2Vycm9ycy5sb2FkX29yaWdpbmFsJyk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIGFzeW5jIGNyZWF0ZUNvbXByZXNzaW9uUHJldmlldygpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBhc3NldCA9IHRoaXMuY29tcHJlc3Npb25Bc3NldDtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoIWFzc2V0IHx8ICF0aGlzLmlzQ29tcHJlc3Npb25TdXBwb3J0ZWQoYXNzZXQpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHZhbGlkYXRpb25FcnJvciA9IHRoaXMudmFsaWRhdGVDb21wcmVzc2lvblNldHRpbmdzKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHZhbGlkYXRpb25FcnJvcikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmNvbXByZXNzaW9uRXJyb3IgPSB2YWxpZGF0aW9uRXJyb3I7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY29tcHJlc3Npb25Mb2FkaW5nID0gdHJ1ZTtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLmNvbXByZXNzaW9uRXJyb3IgPSAnJztcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLmludmFsaWRhdGVDb21wcmVzc2lvblByZXZpZXcoKTtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCByZXF1ZXN0SWQgPSArK3RoaXMuY29tcHJlc3Npb25SZXF1ZXN0SWQ7XHJcblxyXG4gICAgICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLmNvbXByZXNzaW9uVGVtcERpcmVjdG9yeSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgcmVtb3ZlKHRoaXMuY29tcHJlc3Npb25UZW1wRGlyZWN0b3J5KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB0ZW1wRGlyZWN0b3J5ID0gYXdhaXQgbWtkdGVtcChqb2luKHRtcGRpcigpLCAnY2MtYXNzZXRzLWNvbXByZXNzLScpKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5jb21wcmVzc2lvblRlbXBEaXJlY3RvcnkgPSB0ZW1wRGlyZWN0b3J5O1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBvdXRwdXRQYXRoID0gYXdhaXQgY29tcHJlc3NGaWxlKFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYXNzZXQuZmlsZVBhdGgsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhc3NldC5leHRlbnNpb24sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0ZW1wRGlyZWN0b3J5LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5pbWFnZUNvbXByZXNzb3IsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB7IC4uLnRoaXMuY29tcHJlc3Npb25TZXR0aW5ncyB9LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICApO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBtZXRyaWNzID0gYXdhaXQgY2FsY3VsYXRlRmlsZU1ldHJpY3Mob3V0cHV0UGF0aCwgYXNzZXQubmFtZSk7XHJcblxyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAocmVxdWVzdElkICE9PSB0aGlzLmNvbXByZXNzaW9uUmVxdWVzdElkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCByZW1vdmUodGVtcERpcmVjdG9yeSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuY29tcHJlc3NlZEZpbGVQYXRoID0gb3V0cHV0UGF0aDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5jb21wcmVzc2VkUHJldmlld1VybCA9IGAke3BhdGhUb0ZpbGVVUkwob3V0cHV0UGF0aCkuaHJlZn0/dj0ke0RhdGUubm93KCl9YDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5vdXRwdXRNZXRyaWNzID0gbWV0cmljcztcclxuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAocmVxdWVzdElkID09PSB0aGlzLmNvbXByZXNzaW9uUmVxdWVzdElkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmNvbXByZXNzaW9uRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPyBlcnJvci5tZXNzYWdlXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgOiB0cmFuc2xhdGUoJ2Vycm9ycy5jcmVhdGVfcHJldmlldycpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH0gZmluYWxseSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChyZXF1ZXN0SWQgPT09IHRoaXMuY29tcHJlc3Npb25SZXF1ZXN0SWQpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuY29tcHJlc3Npb25Mb2FkaW5nID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgYXN5bmMgYXBwbHlDb21wcmVzc2VkQXNzZXQoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgYXNzZXQgPSB0aGlzLmNvbXByZXNzaW9uQXNzZXQ7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFhc3NldCB8fCAhdGhpcy5jb21wcmVzc2VkRmlsZVBhdGggfHwgIXRoaXMub3V0cHV0TWV0cmljcykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIGlmICghd2luZG93LmNvbmZpcm0odHJhbnNsYXRlKCdjb25maXJtLm92ZXJ3cml0ZScsIHsgbmFtZTogYXNzZXQubmFtZSB9KSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY29tcHJlc3Npb25BcHBseWluZyA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jb21wcmVzc2lvbkVycm9yID0gJyc7XHJcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgY3JlYXRlT3JpZ2luYWxCYWNrdXAoYXNzZXQuZmlsZVBhdGgsIGFzc2V0LmJhY2t1cFBhdGgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCByZXBsYWNlT3JpZ2luYWxGaWxlKHRoaXMuY29tcHJlc3NlZEZpbGVQYXRoLCBhc3NldC5maWxlUGF0aCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ2Fzc2V0LWRiJywgJ3JlaW1wb3J0LWFzc2V0JywgYXNzZXQudXVpZCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMubG9hZEFzc2V0cygpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmNsb3NlQ29tcHJlc3Npb24oKTtcclxuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmNvbXByZXNzaW9uRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA/IGVycm9yLm1lc3NhZ2VcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDogdHJhbnNsYXRlKCdlcnJvcnMuYXBwbHknKTtcbiAgICAgICAgICAgICAgICAgICAgfSBmaW5hbGx5IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5jb21wcmVzc2lvbkFwcGx5aW5nID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIGFzeW5jIHJldmVydEFzc2V0KGFzc2V0OiBNZWRpYUFzc2V0KTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFhc3NldC5jYW5SZXZlcnQpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICBpZiAoIXdpbmRvdy5jb25maXJtKHRyYW5zbGF0ZSgnY29uZmlybS5yZXZlcnQnLCB7IG5hbWU6IGFzc2V0Lm5hbWUgfSkpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvYWRpbmcgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZXJyb3JNZXNzYWdlID0gJyc7XHJcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgcmVzdG9yZU9yaWdpbmFsQmFja3VwKGFzc2V0LmJhY2t1cFBhdGgsIGFzc2V0LmZpbGVQYXRoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnYXNzZXQtZGInLCAncmVpbXBvcnQtYXNzZXQnLCBhc3NldC51dWlkKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5sb2FkQXNzZXRzKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5lcnJvck1lc3NhZ2UgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA/IGVycm9yLm1lc3NhZ2VcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDogdHJhbnNsYXRlKCdlcnJvcnMucmV2ZXJ0Jyk7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmxvYWRpbmcgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgYXN5bmMgY2xvc2VDb21wcmVzc2lvbigpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLmNvbXByZXNzaW9uUmVxdWVzdElkICs9IDE7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGVtcERpcmVjdG9yeSA9IHRoaXMuY29tcHJlc3Npb25UZW1wRGlyZWN0b3J5O1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY29tcHJlc3Npb25Bc3NldCA9IG51bGw7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jb21wcmVzc2lvbkxvYWRpbmcgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLmNvbXByZXNzaW9uRXJyb3IgPSAnJztcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLmNvbXByZXNzZWRQcmV2aWV3VXJsID0gJyc7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jb21wcmVzc2VkRmlsZVBhdGggPSAnJztcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLm91dHB1dE1ldHJpY3MgPSBudWxsO1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuaW1hZ2VEaW1lbnNpb25zID0gbnVsbDtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLmNvbXByZXNzaW9uVGVtcERpcmVjdG9yeSA9ICcnO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICh0ZW1wRGlyZWN0b3J5KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCByZW1vdmUodGVtcERpcmVjdG9yeSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oYFtjYy1hc3NldHMtY29tcHJlc3NdIENhbm5vdCByZW1vdmUgdGVtcCBkaXJlY3Rvcnk6ICR7dGVtcERpcmVjdG9yeX1gLCBlcnJvcik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgYXN5bmMgbG9hZEFzc2V0cygpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvYWRpbmcgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZXJyb3JNZXNzYWdlID0gJyc7XHJcblxyXG4gICAgICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGFzc2V0RGJJdGVtcyA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnYXNzZXQtZGInLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ3F1ZXJ5LWFzc2V0cycsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB7IGV4dG5hbWU6IEFycmF5LmZyb20oc3VwcG9ydGVkRXh0ZW5zaW9ucykgfSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFsndXVpZCcsICdmaWxlJywgJ3VybCcsICdzb3VyY2UnLCAnaXNEaXJlY3RvcnknXSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgKSBhcyBBc3NldERiSW5mb1tdO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcHJvamVjdEl0ZW1zID0gYXNzZXREYkl0ZW1zLmZpbHRlcigoYXNzZXQpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHVybCA9IGFzc2V0LnVybCB8fCBhc3NldC5zb3VyY2UgfHwgJyc7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gdXJsLnN0YXJ0c1dpdGgoJ2RiOi8vYXNzZXRzLycpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gTGltaXQgc2ltdWx0YW5lb3VzIEJhc2U2NC9KU1ppcCB3b3JrIHRvIGF2b2lkIGEgbWVtb3J5IHNwaWtlIG9uIGxhcmdlIHByb2plY3RzLlxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCByZXN1bHRzID0gYXdhaXQgbWFwV2l0aENvbmN1cnJlbmN5KHByb2plY3RJdGVtcywgNCwgY3JlYXRlTWVkaWFBc3NldCk7XHJcblxyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmFzc2V0cyA9IHJlc3VsdHNcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC5maWx0ZXIoKGFzc2V0KTogYXNzZXQgaXMgTWVkaWFBc3NldCA9PiBhc3NldCAhPT0gbnVsbClcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC5zb3J0KChsZWZ0LCByaWdodCkgPT4gbGVmdC5wYXRoLmxvY2FsZUNvbXBhcmUocmlnaHQucGF0aCkpO1xyXG4gICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuZXJyb3JNZXNzYWdlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvclxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPyBlcnJvci5tZXNzYWdlXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA6IHRyYW5zbGF0ZSgnZXJyb3JzLmxvYWRfYXNzZXRzJyk7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbY2MtYXNzZXRzLWNvbXByZXNzXSBGYWlsZWQgdG8gbG9hZCBhc3NldHMnLCBlcnJvcik7XHJcbiAgICAgICAgICAgICAgICAgICAgfSBmaW5hbGx5IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2FkaW5nID0gZmFsc2U7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgbW91bnRlZCgpIHtcclxuICAgICAgICAgICAgICAgIHZvaWQgdGhpcy5sb2FkQXNzZXRzKCk7XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgfSkpO1xyXG5cclxuICAgICAgICBhcHAuY29uZmlnLmNvbXBpbGVyT3B0aW9ucy5pc0N1c3RvbUVsZW1lbnQgPSAodGFnKSA9PiB0YWcuc3RhcnRzV2l0aCgndWktJyk7XHJcbiAgICAgICAgYXBwLmNvbXBvbmVudCgnSW1hZ2VWaWV3ZXInLCBJbWFnZVZpZXdlcik7XHJcbiAgICAgICAgY29uc3Qgdmlld01vZGVsID0gYXBwLm1vdW50KHRoaXMuJC5hcHApIGFzIHVua25vd24gYXMge1xyXG4gICAgICAgICAgICBjbG9zZUNvbXByZXNzaW9uOiAoKSA9PiBQcm9taXNlPHZvaWQ+O1xyXG4gICAgICAgIH07XHJcbiAgICAgICAgcGFuZWxEYXRhTWFwLnNldCh0aGlzLCB7XHJcbiAgICAgICAgICAgIGFwcCxcclxuICAgICAgICAgICAgY2xlYW51cDogKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgdm9pZCB2aWV3TW9kZWwuY2xvc2VDb21wcmVzc2lvbigpO1xyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgIH0pO1xyXG4gICAgfSxcclxuICAgIGJlZm9yZUNsb3NlKCkge30sXHJcbiAgICBjbG9zZSgpIHtcclxuICAgICAgICBjb25zdCBwYW5lbERhdGEgPSBwYW5lbERhdGFNYXAuZ2V0KHRoaXMpO1xyXG4gICAgICAgIGlmIChwYW5lbERhdGEpIHtcclxuICAgICAgICAgICAgcGFuZWxEYXRhLmNsZWFudXAoKTtcclxuICAgICAgICAgICAgcGFuZWxEYXRhLmFwcC51bm1vdW50KCk7XHJcbiAgICAgICAgICAgIHBhbmVsRGF0YU1hcC5kZWxldGUodGhpcyk7XHJcbiAgICAgICAgfVxyXG4gICAgfSxcclxufSk7XHJcbiJdfQ==