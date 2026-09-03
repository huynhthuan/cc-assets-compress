"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateFileMetrics = calculateFileMetrics;
exports.getImageDimensions = getImageDimensions;
exports.compressFile = compressFile;
exports.convertFile = convertFile;
exports.replaceOriginalFile = replaceOriginalFile;
exports.createOriginalBackup = createOriginalBackup;
exports.restoreOriginalBackup = restoreOriginalBackup;
const fs_extra_1 = require("fs-extra");
const child_process_1 = require("child_process");
const path_1 = require("path");
const jszip_1 = __importDefault(require("jszip"));
const ffmpeg_static_1 = __importDefault(require("ffmpeg-static"));
const sharp_1 = __importDefault(require("sharp"));
const i18n_1 = require("./i18n");
class BinaryProcessError extends Error {
    constructor(message, exitCode) {
        super(message);
        this.exitCode = exitCode;
        this.name = 'BinaryProcessError';
    }
}
function runBinary(binary, args) {
    return new Promise((resolve, reject) => {
        const process = (0, child_process_1.spawn)(binary, args, { windowsHide: true });
        let errorOutput = '';
        process.stderr.on('data', (chunk) => {
            errorOutput += chunk.toString();
        });
        process.on('error', reject);
        process.on('close', (exitCode) => {
            if (exitCode === 0) {
                resolve();
                return;
            }
            reject(new BinaryProcessError(errorOutput.trim() || (0, i18n_1.t)('errors.binary_exit', { code: exitCode !== null && exitCode !== void 0 ? exitCode : 'unknown' }), exitCode));
        });
    });
}
function getPngquantPath() {
    const extensionPath = Editor.Package.getPath('cc-assets-compress');
    if (!extensionPath) {
        throw new Error((0, i18n_1.t)('errors.extension_path'));
    }
    const executable = process.platform === 'win32' ? 'pngquant.exe' : 'pngquant';
    return (0, path_1.join)(extensionPath, 'node_modules', 'pngquant-bin', 'vendor', executable);
}
async function calculateFileMetrics(filePath, fileName) {
    const fileBuffer = await (0, fs_extra_1.readFile)(filePath);
    const base64Content = fileBuffer.toString('base64');
    const zip = new jszip_1.default();
    zip.file(`${fileName}.base64.txt`, base64Content);
    const zipBuffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 },
    });
    return {
        fileSize: fileBuffer.length,
        base64Size: Buffer.byteLength(base64Content, 'utf8'),
        zipSize: zipBuffer.length,
    };
}
async function getImageDimensions(filePath) {
    const metadata = await (0, sharp_1.default)(filePath).metadata();
    if (!metadata.width || !metadata.height) {
        throw new Error((0, i18n_1.t)('errors.image_dimensions'));
    }
    return { width: metadata.width, height: metadata.height };
}
async function compressFile(inputPath, extension, outputDirectory, imageCompressor, settings) {
    await (0, fs_extra_1.ensureDir)(outputDirectory);
    if ((extension === '.png' || extension === '.jpg') && imageCompressor === 'sharp') {
        const outputPath = (0, path_1.join)(outputDirectory, `compressed${extension}`);
        let pipeline = (0, sharp_1.default)(inputPath, { failOn: 'error' });
        if (settings.resizeWidth && settings.resizeHeight) {
            pipeline = pipeline.resize(settings.resizeWidth, settings.resizeHeight, {
                fit: 'inside',
                withoutEnlargement: false,
            });
        }
        if (extension === '.png') {
            await pipeline.png({
                quality: settings.sharpQuality,
                compressionLevel: settings.sharpCompressionLevel,
                progressive: settings.sharpProgressive,
                palette: settings.sharpPalette,
                colours: settings.colors,
                dither: settings.dithering,
            }).toFile(outputPath);
        }
        else {
            await pipeline.jpeg({
                quality: settings.sharpQuality,
                progressive: settings.sharpProgressive,
                mozjpeg: settings.sharpMozjpeg,
                chromaSubsampling: settings.sharpChromaSubsampling,
            }).toFile(outputPath);
        }
        return outputPath;
    }
    if (extension === '.png' && imageCompressor === 'pngquant') {
        const pngquantPath = getPngquantPath();
        if (!await (0, fs_extra_1.pathExists)(pngquantPath)) {
            throw new Error((0, i18n_1.t)('errors.pngquant_missing'));
        }
        const outputPath = (0, path_1.join)(outputDirectory, 'compressed.png');
        let pngquantInputPath = inputPath;
        if (settings.resizeWidth && settings.resizeHeight) {
            pngquantInputPath = (0, path_1.join)(outputDirectory, 'resized-input.png');
            await (0, sharp_1.default)(inputPath)
                .resize(settings.resizeWidth, settings.resizeHeight, {
                fit: 'inside',
                withoutEnlargement: false,
            })
                .png()
                .toFile(pngquantInputPath);
        }
        const ditherArguments = settings.dithering === 0
            ? ['--nofs']
            : [`--floyd=${settings.dithering}`];
        const createPngquantArguments = (minimumQuality) => [
            '--force',
            '--strip',
            '--quality', `${minimumQuality}-${settings.qualityMax}`,
            '--speed', String(settings.speed),
            ...ditherArguments,
            '--output', outputPath,
            String(settings.colors),
            '--', pngquantInputPath,
        ];
        try {
            await runBinary(pngquantPath, createPngquantArguments(settings.qualityMin));
        }
        catch (error) {
            // pngquant uses exit code 99 when the requested color count cannot
            // satisfy the minimum quality. Keep the chosen color count and max
            // quality, but relax only the minimum threshold so an output can be made.
            if (!(error instanceof BinaryProcessError)
                || error.exitCode !== 99
                || settings.qualityMin === 0) {
                throw error;
            }
            console.warn(`[cc-assets-compress] pngquant could not reach quality ${settings.qualityMin}; retrying with minimum quality 0.`);
            await (0, fs_extra_1.remove)(outputPath);
            await runBinary(pngquantPath, createPngquantArguments(0));
        }
        return outputPath;
    }
    if (extension === '.mp3') {
        if (!ffmpeg_static_1.default || !await (0, fs_extra_1.pathExists)(ffmpeg_static_1.default)) {
            throw new Error((0, i18n_1.t)('errors.ffmpeg_missing'));
        }
        const outputPath = (0, path_1.join)(outputDirectory, 'compressed.mp3');
        await runBinary(ffmpeg_static_1.default, [
            '-hide_banner',
            '-loglevel', 'error',
            '-y',
            '-i', inputPath,
            '-map_metadata', '0',
            '-vn',
            '-codec:a', 'libmp3lame',
            '-b:a', `${settings.audioBitrate}k`,
            '-ar', String(settings.sampleRate),
            '-ac', String(settings.channels),
            outputPath,
        ]);
        return outputPath;
    }
    throw new Error((0, i18n_1.t)('errors.pngquant_jpg'));
}
async function convertFile(inputPath, targetExtension, outputDirectory) {
    await (0, fs_extra_1.ensureDir)(outputDirectory);
    const outputPath = (0, path_1.join)(outputDirectory, `converted${targetExtension}`);
    if (targetExtension === '.png') {
        await (0, sharp_1.default)(inputPath).png().toFile(outputPath);
        return outputPath;
    }
    if (targetExtension === '.jpg') {
        await (0, sharp_1.default)(inputPath).jpeg({ quality: 92, progressive: true }).toFile(outputPath);
        return outputPath;
    }
    if (targetExtension === '.webp') {
        await (0, sharp_1.default)(inputPath).webp({ quality: 90 }).toFile(outputPath);
        return outputPath;
    }
    if (!ffmpeg_static_1.default || !await (0, fs_extra_1.pathExists)(ffmpeg_static_1.default)) {
        throw new Error((0, i18n_1.t)('errors.ffmpeg_missing'));
    }
    const audioArguments = {
        '.mp3': ['-codec:a', 'libmp3lame', '-b:a', '192k'],
        '.wav': ['-codec:a', 'pcm_s16le'],
        '.ogg': ['-codec:a', 'libvorbis', '-q:a', '5'],
    };
    await runBinary(ffmpeg_static_1.default, [
        '-hide_banner',
        '-loglevel', 'error',
        '-y',
        '-i', inputPath,
        '-map_metadata', '0',
        '-vn',
        ...audioArguments[targetExtension],
        outputPath,
    ]);
    return outputPath;
}
async function replaceOriginalFile(compressedPath, originalPath) {
    const temporaryPath = `${originalPath}.cc-assets-compress.tmp`;
    try {
        await (0, fs_extra_1.copy)(compressedPath, temporaryPath, { overwrite: true });
        await (0, fs_extra_1.move)(temporaryPath, originalPath, { overwrite: true });
    }
    catch (error) {
        await (0, fs_extra_1.remove)(temporaryPath);
        throw error;
    }
}
async function createOriginalBackup(originalPath, backupPath) {
    if (!await (0, fs_extra_1.pathExists)(backupPath)) {
        await (0, fs_extra_1.ensureDir)((0, path_1.dirname)(backupPath));
        await (0, fs_extra_1.copy)(originalPath, backupPath, { overwrite: false });
    }
}
async function restoreOriginalBackup(backupPath, originalPath) {
    if (!await (0, fs_extra_1.pathExists)(backupPath)) {
        throw new Error((0, i18n_1.t)('errors.backup_missing'));
    }
    await replaceOriginalFile(backupPath, originalPath);
    await (0, fs_extra_1.remove)(backupPath);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29tcHJlc3Npb24uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zb3VyY2UvY29tcHJlc3Npb24udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7QUFrRkEsb0RBZ0JDO0FBRUQsZ0RBTUM7QUFFRCxvQ0FrSEM7QUFFRCxrQ0F5Q0M7QUFFRCxrREFTQztBQUVELG9EQUtDO0FBRUQsc0RBTUM7QUFuU0QsdUNBQStFO0FBQy9FLGlEQUFzQztBQUN0QywrQkFBcUM7QUFDckMsa0RBQTBCO0FBQzFCLGtFQUF1QztBQUN2QyxrREFBMEI7QUFDMUIsaUNBQTJCO0FBbUMzQixNQUFNLGtCQUFtQixTQUFRLEtBQUs7SUFDbEMsWUFDSSxPQUFlLEVBQ0MsUUFBdUI7UUFFdkMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBRkMsYUFBUSxHQUFSLFFBQVEsQ0FBZTtRQUd2QyxJQUFJLENBQUMsSUFBSSxHQUFHLG9CQUFvQixDQUFDO0lBQ3JDLENBQUM7Q0FDSjtBQUVELFNBQVMsU0FBUyxDQUFDLE1BQWMsRUFBRSxJQUFjO0lBQzdDLE9BQU8sSUFBSSxPQUFPLENBQUMsQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLEVBQUU7UUFDbkMsTUFBTSxPQUFPLEdBQUcsSUFBQSxxQkFBSyxFQUFDLE1BQU0sRUFBRSxJQUFJLEVBQUUsRUFBRSxXQUFXLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQztRQUMzRCxJQUFJLFdBQVcsR0FBRyxFQUFFLENBQUM7UUFFckIsT0FBTyxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsTUFBTSxFQUFFLENBQUMsS0FBYSxFQUFFLEVBQUU7WUFDeEMsV0FBVyxJQUFJLEtBQUssQ0FBQyxRQUFRLEVBQUUsQ0FBQztRQUNwQyxDQUFDLENBQUMsQ0FBQztRQUNILE9BQU8sQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLE1BQU0sQ0FBQyxDQUFDO1FBQzVCLE9BQU8sQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLENBQUMsUUFBUSxFQUFF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LEVBQUUsYUFBYSxFQUFFLEVBQUUsU0FBUyxFQUFFLElBQUksRUFBRSxDQUFDLENBQUM7UUFDL0QsTUFBTSxJQUFBLGVBQUksRUFBQyxhQUFhLEVBQUUsWUFBWSxFQUFFLEVBQUUsU0FBUyxFQUFFLElBQUksRUFBRSxDQUFDLENBQUM7SUFDakUsQ0FBQztJQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7UUFDYixNQUFNLElBQUEsaUJBQU0sRUFBQyxhQUFhLENBQUMsQ0FBQztRQUM1QixNQUFNLEtBQUssQ0FBQztJQUNoQixDQUFDO0FBQ0wsQ0FBQztBQUVNLEtBQUssVUFBVSxvQkFBb0IsQ0FBQyxZQUFvQixFQUFFLFVBQWtCO0lBQy9FLElBQUksQ0FBQyxNQUFNLElBQUEscUJBQVUsRUFBQyxVQUFVLENBQUMsRUFBRSxDQUFDO1FBQ2hDLE1BQU0sSUFBQSxvQkFBUyxFQUFDLElBQUEsY0FBTyxFQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUM7UUFDckMsTUFBTSxJQUFBLGVBQUksRUFBQyxZQUFZLEVBQUUsVUFBVSxFQUFFLEVBQUUsU0FBUyxFQUFFLEtBQUssRUFBRSxDQUFDLENBQUM7SUFDL0QsQ0FBQztBQUNMLENBQUM7QUFFTSxLQUFLLFVBQVUscUJBQXFCLENBQUMsVUFBa0IsRUFBRSxZQUFvQjtJQUNoRixJQUFJLENBQUMsTUFBTSxJQUFBLHFCQUFVLEVBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQztRQUNoQyxNQUFNLElBQUksS0FBSyxDQUFDLElBQUEsUUFBQyxFQUFDLHVCQUF1QixDQUFDLENBQUMsQ0FBQztJQUNoRCxDQUFDO0lBQ0QsTUFBTSxtQkFBbUIsQ0FBQyxVQUFVLEVBQUUsWUFBWSxDQUFDLENBQUM7SUFDcEQsTUFBTSxJQUFBLGlCQUFNLEVBQUMsVUFBVSxDQUFDLENBQUM7QUFDN0IsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGNvcHksIGVuc3VyZURpciwgbW92ZSwgcGF0aEV4aXN0cywgcmVhZEZpbGUsIHJlbW92ZSB9IGZyb20gJ2ZzLWV4dHJhJztcclxuaW1wb3J0IHsgc3Bhd24gfSBmcm9tICdjaGlsZF9wcm9jZXNzJztcclxuaW1wb3J0IHsgZGlybmFtZSwgam9pbiB9IGZyb20gJ3BhdGgnO1xyXG5pbXBvcnQgSlNaaXAgZnJvbSAnanN6aXAnO1xyXG5pbXBvcnQgZmZtcGVnUGF0aCBmcm9tICdmZm1wZWctc3RhdGljJztcclxuaW1wb3J0IHNoYXJwIGZyb20gJ3NoYXJwJztcbmltcG9ydCB7IHQgfSBmcm9tICcuL2kxOG4nO1xuXHJcbmV4cG9ydCB0eXBlIEltYWdlQ29tcHJlc3NvciA9ICdwbmdxdWFudCcgfCAnc2hhcnAnO1xuZXhwb3J0IHR5cGUgQ29udmVyc2lvbkV4dGVuc2lvbiA9ICcucG5nJyB8ICcuanBnJyB8ICcud2VicCcgfCAnLm1wMycgfCAnLndhdicgfCAnLm9nZyc7XG5cclxuZXhwb3J0IGludGVyZmFjZSBGaWxlTWV0cmljcyB7XHJcbiAgICBmaWxlU2l6ZTogbnVtYmVyO1xyXG4gICAgYmFzZTY0U2l6ZTogbnVtYmVyO1xyXG4gICAgemlwU2l6ZTogbnVtYmVyO1xyXG59XHJcblxyXG5leHBvcnQgaW50ZXJmYWNlIEltYWdlRGltZW5zaW9ucyB7XHJcbiAgICB3aWR0aDogbnVtYmVyO1xyXG4gICAgaGVpZ2h0OiBudW1iZXI7XHJcbn1cclxuXHJcbmV4cG9ydCBpbnRlcmZhY2UgQ29tcHJlc3Npb25TZXR0aW5ncyB7XHJcbiAgICBxdWFsaXR5TWluOiBudW1iZXI7XHJcbiAgICBxdWFsaXR5TWF4OiBudW1iZXI7XHJcbiAgICBzcGVlZDogbnVtYmVyO1xyXG4gICAgY29sb3JzOiBudW1iZXI7XHJcbiAgICBkaXRoZXJpbmc6IG51bWJlcjtcclxuICAgIGF1ZGlvQml0cmF0ZTogbnVtYmVyO1xyXG4gICAgc2FtcGxlUmF0ZTogbnVtYmVyO1xyXG4gICAgY2hhbm5lbHM6IG51bWJlcjtcclxuICAgIHNoYXJwUXVhbGl0eTogbnVtYmVyO1xyXG4gICAgc2hhcnBDb21wcmVzc2lvbkxldmVsOiBudW1iZXI7XHJcbiAgICBzaGFycFByb2dyZXNzaXZlOiBib29sZWFuO1xyXG4gICAgc2hhcnBQYWxldHRlOiBib29sZWFuO1xyXG4gICAgc2hhcnBNb3pqcGVnOiBib29sZWFuO1xyXG4gICAgc2hhcnBDaHJvbWFTdWJzYW1wbGluZzogJzQ6MjowJyB8ICc0OjQ6NCc7XHJcbiAgICByZXNpemVXaWR0aDogbnVtYmVyIHwgbnVsbDtcclxuICAgIHJlc2l6ZUhlaWdodDogbnVtYmVyIHwgbnVsbDtcclxufVxyXG5cclxuY2xhc3MgQmluYXJ5UHJvY2Vzc0Vycm9yIGV4dGVuZHMgRXJyb3Ige1xyXG4gICAgY29uc3RydWN0b3IoXHJcbiAgICAgICAgbWVzc2FnZTogc3RyaW5nLFxyXG4gICAgICAgIHB1YmxpYyByZWFkb25seSBleGl0Q29kZTogbnVtYmVyIHwgbnVsbCxcclxuICAgICkge1xyXG4gICAgICAgIHN1cGVyKG1lc3NhZ2UpO1xyXG4gICAgICAgIHRoaXMubmFtZSA9ICdCaW5hcnlQcm9jZXNzRXJyb3InO1xyXG4gICAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiBydW5CaW5hcnkoYmluYXJ5OiBzdHJpbmcsIGFyZ3M6IHN0cmluZ1tdKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xyXG4gICAgICAgIGNvbnN0IHByb2Nlc3MgPSBzcGF3bihiaW5hcnksIGFyZ3MsIHsgd2luZG93c0hpZGU6IHRydWUgfSk7XHJcbiAgICAgICAgbGV0IGVycm9yT3V0cHV0ID0gJyc7XHJcblxyXG4gICAgICAgIHByb2Nlc3Muc3RkZXJyLm9uKCdkYXRhJywgKGNodW5rOiBCdWZmZXIpID0+IHtcclxuICAgICAgICAgICAgZXJyb3JPdXRwdXQgKz0gY2h1bmsudG9TdHJpbmcoKTtcclxuICAgICAgICB9KTtcclxuICAgICAgICBwcm9jZXNzLm9uKCdlcnJvcicsIHJlamVjdCk7XHJcbiAgICAgICAgcHJvY2Vzcy5vbignY2xvc2UnLCAoZXhpdENvZGUpID0+IHtcclxuICAgICAgICAgICAgaWYgKGV4aXRDb2RlID09PSAwKSB7XHJcbiAgICAgICAgICAgICAgICByZXNvbHZlKCk7XHJcbiAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgcmVqZWN0KG5ldyBCaW5hcnlQcm9jZXNzRXJyb3IoXHJcbiAgICAgICAgICAgICAgICBlcnJvck91dHB1dC50cmltKCkgfHwgdCgnZXJyb3JzLmJpbmFyeV9leGl0JywgeyBjb2RlOiBleGl0Q29kZSA/PyAndW5rbm93bicgfSksXG4gICAgICAgICAgICAgICAgZXhpdENvZGUsXHJcbiAgICAgICAgICAgICkpO1xyXG4gICAgICAgIH0pO1xyXG4gICAgfSk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGdldFBuZ3F1YW50UGF0aCgpOiBzdHJpbmcge1xyXG4gICAgY29uc3QgZXh0ZW5zaW9uUGF0aCA9IEVkaXRvci5QYWNrYWdlLmdldFBhdGgoJ2NjLWFzc2V0cy1jb21wcmVzcycpO1xyXG4gICAgaWYgKCFleHRlbnNpb25QYXRoKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKHQoJ2Vycm9ycy5leHRlbnNpb25fcGF0aCcpKTtcbiAgICB9XHJcbiAgICBjb25zdCBleGVjdXRhYmxlID0gcHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ3dpbjMyJyA/ICdwbmdxdWFudC5leGUnIDogJ3BuZ3F1YW50JztcclxuICAgIHJldHVybiBqb2luKGV4dGVuc2lvblBhdGgsICdub2RlX21vZHVsZXMnLCAncG5ncXVhbnQtYmluJywgJ3ZlbmRvcicsIGV4ZWN1dGFibGUpO1xyXG59XHJcblxyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY2FsY3VsYXRlRmlsZU1ldHJpY3MoZmlsZVBhdGg6IHN0cmluZywgZmlsZU5hbWU6IHN0cmluZyk6IFByb21pc2U8RmlsZU1ldHJpY3M+IHtcclxuICAgIGNvbnN0IGZpbGVCdWZmZXIgPSBhd2FpdCByZWFkRmlsZShmaWxlUGF0aCk7XHJcbiAgICBjb25zdCBiYXNlNjRDb250ZW50ID0gZmlsZUJ1ZmZlci50b1N0cmluZygnYmFzZTY0Jyk7XHJcbiAgICBjb25zdCB6aXAgPSBuZXcgSlNaaXAoKTtcclxuICAgIHppcC5maWxlKGAke2ZpbGVOYW1lfS5iYXNlNjQudHh0YCwgYmFzZTY0Q29udGVudCk7XHJcbiAgICBjb25zdCB6aXBCdWZmZXIgPSBhd2FpdCB6aXAuZ2VuZXJhdGVBc3luYyh7XHJcbiAgICAgICAgdHlwZTogJ25vZGVidWZmZXInLFxyXG4gICAgICAgIGNvbXByZXNzaW9uOiAnREVGTEFURScsXHJcbiAgICAgICAgY29tcHJlc3Npb25PcHRpb25zOiB7IGxldmVsOiA5IH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICAgIGZpbGVTaXplOiBmaWxlQnVmZmVyLmxlbmd0aCxcclxuICAgICAgICBiYXNlNjRTaXplOiBCdWZmZXIuYnl0ZUxlbmd0aChiYXNlNjRDb250ZW50LCAndXRmOCcpLFxyXG4gICAgICAgIHppcFNpemU6IHppcEJ1ZmZlci5sZW5ndGgsXHJcbiAgICB9O1xyXG59XHJcblxyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZ2V0SW1hZ2VEaW1lbnNpb25zKGZpbGVQYXRoOiBzdHJpbmcpOiBQcm9taXNlPEltYWdlRGltZW5zaW9ucz4ge1xyXG4gICAgY29uc3QgbWV0YWRhdGEgPSBhd2FpdCBzaGFycChmaWxlUGF0aCkubWV0YWRhdGEoKTtcclxuICAgIGlmICghbWV0YWRhdGEud2lkdGggfHwgIW1ldGFkYXRhLmhlaWdodCkge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcih0KCdlcnJvcnMuaW1hZ2VfZGltZW5zaW9ucycpKTtcbiAgICB9XHJcbiAgICByZXR1cm4geyB3aWR0aDogbWV0YWRhdGEud2lkdGgsIGhlaWdodDogbWV0YWRhdGEuaGVpZ2h0IH07XHJcbn1cclxuXHJcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjb21wcmVzc0ZpbGUoXG4gICAgaW5wdXRQYXRoOiBzdHJpbmcsXHJcbiAgICBleHRlbnNpb246IHN0cmluZyxcclxuICAgIG91dHB1dERpcmVjdG9yeTogc3RyaW5nLFxyXG4gICAgaW1hZ2VDb21wcmVzc29yOiBJbWFnZUNvbXByZXNzb3IsXHJcbiAgICBzZXR0aW5nczogQ29tcHJlc3Npb25TZXR0aW5ncyxcclxuKTogUHJvbWlzZTxzdHJpbmc+IHtcclxuICAgIGF3YWl0IGVuc3VyZURpcihvdXRwdXREaXJlY3RvcnkpO1xyXG5cclxuICAgIGlmICgoZXh0ZW5zaW9uID09PSAnLnBuZycgfHwgZXh0ZW5zaW9uID09PSAnLmpwZycpICYmIGltYWdlQ29tcHJlc3NvciA9PT0gJ3NoYXJwJykge1xyXG4gICAgICAgIGNvbnN0IG91dHB1dFBhdGggPSBqb2luKG91dHB1dERpcmVjdG9yeSwgYGNvbXByZXNzZWQke2V4dGVuc2lvbn1gKTtcclxuICAgICAgICBsZXQgcGlwZWxpbmUgPSBzaGFycChpbnB1dFBhdGgsIHsgZmFpbE9uOiAnZXJyb3InIH0pO1xyXG4gICAgICAgIGlmIChzZXR0aW5ncy5yZXNpemVXaWR0aCAmJiBzZXR0aW5ncy5yZXNpemVIZWlnaHQpIHtcclxuICAgICAgICAgICAgcGlwZWxpbmUgPSBwaXBlbGluZS5yZXNpemUoc2V0dGluZ3MucmVzaXplV2lkdGgsIHNldHRpbmdzLnJlc2l6ZUhlaWdodCwge1xyXG4gICAgICAgICAgICAgICAgZml0OiAnaW5zaWRlJyxcclxuICAgICAgICAgICAgICAgIHdpdGhvdXRFbmxhcmdlbWVudDogZmFsc2UsXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKGV4dGVuc2lvbiA9PT0gJy5wbmcnKSB7XHJcbiAgICAgICAgICAgIGF3YWl0IHBpcGVsaW5lLnBuZyh7XHJcbiAgICAgICAgICAgICAgICBxdWFsaXR5OiBzZXR0aW5ncy5zaGFycFF1YWxpdHksXHJcbiAgICAgICAgICAgICAgICBjb21wcmVzc2lvbkxldmVsOiBzZXR0aW5ncy5zaGFycENvbXByZXNzaW9uTGV2ZWwsXHJcbiAgICAgICAgICAgICAgICBwcm9ncmVzc2l2ZTogc2V0dGluZ3Muc2hhcnBQcm9ncmVzc2l2ZSxcclxuICAgICAgICAgICAgICAgIHBhbGV0dGU6IHNldHRpbmdzLnNoYXJwUGFsZXR0ZSxcclxuICAgICAgICAgICAgICAgIGNvbG91cnM6IHNldHRpbmdzLmNvbG9ycyxcclxuICAgICAgICAgICAgICAgIGRpdGhlcjogc2V0dGluZ3MuZGl0aGVyaW5nLFxyXG4gICAgICAgICAgICB9KS50b0ZpbGUob3V0cHV0UGF0aCk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgYXdhaXQgcGlwZWxpbmUuanBlZyh7XHJcbiAgICAgICAgICAgICAgICBxdWFsaXR5OiBzZXR0aW5ncy5zaGFycFF1YWxpdHksXHJcbiAgICAgICAgICAgICAgICBwcm9ncmVzc2l2ZTogc2V0dGluZ3Muc2hhcnBQcm9ncmVzc2l2ZSxcclxuICAgICAgICAgICAgICAgIG1vempwZWc6IHNldHRpbmdzLnNoYXJwTW96anBlZyxcclxuICAgICAgICAgICAgICAgIGNocm9tYVN1YnNhbXBsaW5nOiBzZXR0aW5ncy5zaGFycENocm9tYVN1YnNhbXBsaW5nLFxyXG4gICAgICAgICAgICB9KS50b0ZpbGUob3V0cHV0UGF0aCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiBvdXRwdXRQYXRoO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChleHRlbnNpb24gPT09ICcucG5nJyAmJiBpbWFnZUNvbXByZXNzb3IgPT09ICdwbmdxdWFudCcpIHtcclxuICAgICAgICBjb25zdCBwbmdxdWFudFBhdGggPSBnZXRQbmdxdWFudFBhdGgoKTtcclxuICAgICAgICBpZiAoIWF3YWl0IHBhdGhFeGlzdHMocG5ncXVhbnRQYXRoKSkge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IodCgnZXJyb3JzLnBuZ3F1YW50X21pc3NpbmcnKSk7XG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3Qgb3V0cHV0UGF0aCA9IGpvaW4ob3V0cHV0RGlyZWN0b3J5LCAnY29tcHJlc3NlZC5wbmcnKTtcclxuICAgICAgICBsZXQgcG5ncXVhbnRJbnB1dFBhdGggPSBpbnB1dFBhdGg7XHJcbiAgICAgICAgaWYgKHNldHRpbmdzLnJlc2l6ZVdpZHRoICYmIHNldHRpbmdzLnJlc2l6ZUhlaWdodCkge1xyXG4gICAgICAgICAgICBwbmdxdWFudElucHV0UGF0aCA9IGpvaW4ob3V0cHV0RGlyZWN0b3J5LCAncmVzaXplZC1pbnB1dC5wbmcnKTtcclxuICAgICAgICAgICAgYXdhaXQgc2hhcnAoaW5wdXRQYXRoKVxyXG4gICAgICAgICAgICAgICAgLnJlc2l6ZShzZXR0aW5ncy5yZXNpemVXaWR0aCwgc2V0dGluZ3MucmVzaXplSGVpZ2h0LCB7XHJcbiAgICAgICAgICAgICAgICAgICAgZml0OiAnaW5zaWRlJyxcclxuICAgICAgICAgICAgICAgICAgICB3aXRob3V0RW5sYXJnZW1lbnQ6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgICAgIC5wbmcoKVxyXG4gICAgICAgICAgICAgICAgLnRvRmlsZShwbmdxdWFudElucHV0UGF0aCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGNvbnN0IGRpdGhlckFyZ3VtZW50cyA9IHNldHRpbmdzLmRpdGhlcmluZyA9PT0gMFxyXG4gICAgICAgICAgICA/IFsnLS1ub2ZzJ11cclxuICAgICAgICAgICAgOiBbYC0tZmxveWQ9JHtzZXR0aW5ncy5kaXRoZXJpbmd9YF07XHJcbiAgICAgICAgY29uc3QgY3JlYXRlUG5ncXVhbnRBcmd1bWVudHMgPSAobWluaW11bVF1YWxpdHk6IG51bWJlcik6IHN0cmluZ1tdID0+IFtcclxuICAgICAgICAgICAgJy0tZm9yY2UnLFxyXG4gICAgICAgICAgICAnLS1zdHJpcCcsXHJcbiAgICAgICAgICAgICctLXF1YWxpdHknLCBgJHttaW5pbXVtUXVhbGl0eX0tJHtzZXR0aW5ncy5xdWFsaXR5TWF4fWAsXHJcbiAgICAgICAgICAgICctLXNwZWVkJywgU3RyaW5nKHNldHRpbmdzLnNwZWVkKSxcclxuICAgICAgICAgICAgLi4uZGl0aGVyQXJndW1lbnRzLFxyXG4gICAgICAgICAgICAnLS1vdXRwdXQnLCBvdXRwdXRQYXRoLFxyXG4gICAgICAgICAgICBTdHJpbmcoc2V0dGluZ3MuY29sb3JzKSxcclxuICAgICAgICAgICAgJy0tJywgcG5ncXVhbnRJbnB1dFBhdGgsXHJcbiAgICAgICAgXTtcclxuXHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgYXdhaXQgcnVuQmluYXJ5KHBuZ3F1YW50UGF0aCwgY3JlYXRlUG5ncXVhbnRBcmd1bWVudHMoc2V0dGluZ3MucXVhbGl0eU1pbikpO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIC8vIHBuZ3F1YW50IHVzZXMgZXhpdCBjb2RlIDk5IHdoZW4gdGhlIHJlcXVlc3RlZCBjb2xvciBjb3VudCBjYW5ub3RcclxuICAgICAgICAgICAgLy8gc2F0aXNmeSB0aGUgbWluaW11bSBxdWFsaXR5LiBLZWVwIHRoZSBjaG9zZW4gY29sb3IgY291bnQgYW5kIG1heFxyXG4gICAgICAgICAgICAvLyBxdWFsaXR5LCBidXQgcmVsYXggb25seSB0aGUgbWluaW11bSB0aHJlc2hvbGQgc28gYW4gb3V0cHV0IGNhbiBiZSBtYWRlLlxyXG4gICAgICAgICAgICBpZiAoIShlcnJvciBpbnN0YW5jZW9mIEJpbmFyeVByb2Nlc3NFcnJvcilcclxuICAgICAgICAgICAgICAgIHx8IGVycm9yLmV4aXRDb2RlICE9PSA5OVxyXG4gICAgICAgICAgICAgICAgfHwgc2V0dGluZ3MucXVhbGl0eU1pbiA9PT0gMCkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgY29uc29sZS53YXJuKFxyXG4gICAgICAgICAgICAgICAgYFtjYy1hc3NldHMtY29tcHJlc3NdIHBuZ3F1YW50IGNvdWxkIG5vdCByZWFjaCBxdWFsaXR5ICR7c2V0dGluZ3MucXVhbGl0eU1pbn07IHJldHJ5aW5nIHdpdGggbWluaW11bSBxdWFsaXR5IDAuYCxcclxuICAgICAgICAgICAgKTtcclxuICAgICAgICAgICAgYXdhaXQgcmVtb3ZlKG91dHB1dFBhdGgpO1xyXG4gICAgICAgICAgICBhd2FpdCBydW5CaW5hcnkocG5ncXVhbnRQYXRoLCBjcmVhdGVQbmdxdWFudEFyZ3VtZW50cygwKSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiBvdXRwdXRQYXRoO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChleHRlbnNpb24gPT09ICcubXAzJykge1xyXG4gICAgICAgIGlmICghZmZtcGVnUGF0aCB8fCAhYXdhaXQgcGF0aEV4aXN0cyhmZm1wZWdQYXRoKSkge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IodCgnZXJyb3JzLmZmbXBlZ19taXNzaW5nJykpO1xuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IG91dHB1dFBhdGggPSBqb2luKG91dHB1dERpcmVjdG9yeSwgJ2NvbXByZXNzZWQubXAzJyk7XHJcbiAgICAgICAgYXdhaXQgcnVuQmluYXJ5KGZmbXBlZ1BhdGgsIFtcclxuICAgICAgICAgICAgJy1oaWRlX2Jhbm5lcicsXHJcbiAgICAgICAgICAgICctbG9nbGV2ZWwnLCAnZXJyb3InLFxyXG4gICAgICAgICAgICAnLXknLFxyXG4gICAgICAgICAgICAnLWknLCBpbnB1dFBhdGgsXHJcbiAgICAgICAgICAgICctbWFwX21ldGFkYXRhJywgJzAnLFxyXG4gICAgICAgICAgICAnLXZuJyxcclxuICAgICAgICAgICAgJy1jb2RlYzphJywgJ2xpYm1wM2xhbWUnLFxyXG4gICAgICAgICAgICAnLWI6YScsIGAke3NldHRpbmdzLmF1ZGlvQml0cmF0ZX1rYCxcclxuICAgICAgICAgICAgJy1hcicsIFN0cmluZyhzZXR0aW5ncy5zYW1wbGVSYXRlKSxcclxuICAgICAgICAgICAgJy1hYycsIFN0cmluZyhzZXR0aW5ncy5jaGFubmVscyksXHJcbiAgICAgICAgICAgIG91dHB1dFBhdGgsXHJcbiAgICAgICAgXSk7XHJcbiAgICAgICAgcmV0dXJuIG91dHB1dFBhdGg7XHJcbiAgICB9XHJcblxyXG4gICAgdGhyb3cgbmV3IEVycm9yKHQoJ2Vycm9ycy5wbmdxdWFudF9qcGcnKSk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjb252ZXJ0RmlsZShcbiAgICBpbnB1dFBhdGg6IHN0cmluZyxcbiAgICB0YXJnZXRFeHRlbnNpb246IENvbnZlcnNpb25FeHRlbnNpb24sXG4gICAgb3V0cHV0RGlyZWN0b3J5OiBzdHJpbmcsXG4pOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGF3YWl0IGVuc3VyZURpcihvdXRwdXREaXJlY3RvcnkpO1xuICAgIGNvbnN0IG91dHB1dFBhdGggPSBqb2luKG91dHB1dERpcmVjdG9yeSwgYGNvbnZlcnRlZCR7dGFyZ2V0RXh0ZW5zaW9ufWApO1xuXG4gICAgaWYgKHRhcmdldEV4dGVuc2lvbiA9PT0gJy5wbmcnKSB7XG4gICAgICAgIGF3YWl0IHNoYXJwKGlucHV0UGF0aCkucG5nKCkudG9GaWxlKG91dHB1dFBhdGgpO1xuICAgICAgICByZXR1cm4gb3V0cHV0UGF0aDtcbiAgICB9XG4gICAgaWYgKHRhcmdldEV4dGVuc2lvbiA9PT0gJy5qcGcnKSB7XG4gICAgICAgIGF3YWl0IHNoYXJwKGlucHV0UGF0aCkuanBlZyh7IHF1YWxpdHk6IDkyLCBwcm9ncmVzc2l2ZTogdHJ1ZSB9KS50b0ZpbGUob3V0cHV0UGF0aCk7XG4gICAgICAgIHJldHVybiBvdXRwdXRQYXRoO1xuICAgIH1cbiAgICBpZiAodGFyZ2V0RXh0ZW5zaW9uID09PSAnLndlYnAnKSB7XG4gICAgICAgIGF3YWl0IHNoYXJwKGlucHV0UGF0aCkud2VicCh7IHF1YWxpdHk6IDkwIH0pLnRvRmlsZShvdXRwdXRQYXRoKTtcbiAgICAgICAgcmV0dXJuIG91dHB1dFBhdGg7XG4gICAgfVxuXG4gICAgaWYgKCFmZm1wZWdQYXRoIHx8ICFhd2FpdCBwYXRoRXhpc3RzKGZmbXBlZ1BhdGgpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcih0KCdlcnJvcnMuZmZtcGVnX21pc3NpbmcnKSk7XG4gICAgfVxuXG4gICAgY29uc3QgYXVkaW9Bcmd1bWVudHM6IFJlY29yZDwnLm1wMycgfCAnLndhdicgfCAnLm9nZycsIHN0cmluZ1tdPiA9IHtcbiAgICAgICAgJy5tcDMnOiBbJy1jb2RlYzphJywgJ2xpYm1wM2xhbWUnLCAnLWI6YScsICcxOTJrJ10sXG4gICAgICAgICcud2F2JzogWyctY29kZWM6YScsICdwY21fczE2bGUnXSxcbiAgICAgICAgJy5vZ2cnOiBbJy1jb2RlYzphJywgJ2xpYnZvcmJpcycsICctcTphJywgJzUnXSxcbiAgICB9O1xuICAgIGF3YWl0IHJ1bkJpbmFyeShmZm1wZWdQYXRoLCBbXG4gICAgICAgICctaGlkZV9iYW5uZXInLFxuICAgICAgICAnLWxvZ2xldmVsJywgJ2Vycm9yJyxcbiAgICAgICAgJy15JyxcbiAgICAgICAgJy1pJywgaW5wdXRQYXRoLFxuICAgICAgICAnLW1hcF9tZXRhZGF0YScsICcwJyxcbiAgICAgICAgJy12bicsXG4gICAgICAgIC4uLmF1ZGlvQXJndW1lbnRzW3RhcmdldEV4dGVuc2lvbl0sXG4gICAgICAgIG91dHB1dFBhdGgsXG4gICAgXSk7XG4gICAgcmV0dXJuIG91dHB1dFBhdGg7XG59XG5cclxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlcGxhY2VPcmlnaW5hbEZpbGUoY29tcHJlc3NlZFBhdGg6IHN0cmluZywgb3JpZ2luYWxQYXRoOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnN0IHRlbXBvcmFyeVBhdGggPSBgJHtvcmlnaW5hbFBhdGh9LmNjLWFzc2V0cy1jb21wcmVzcy50bXBgO1xyXG4gICAgdHJ5IHtcclxuICAgICAgICBhd2FpdCBjb3B5KGNvbXByZXNzZWRQYXRoLCB0ZW1wb3JhcnlQYXRoLCB7IG92ZXJ3cml0ZTogdHJ1ZSB9KTtcclxuICAgICAgICBhd2FpdCBtb3ZlKHRlbXBvcmFyeVBhdGgsIG9yaWdpbmFsUGF0aCwgeyBvdmVyd3JpdGU6IHRydWUgfSk7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGF3YWl0IHJlbW92ZSh0ZW1wb3JhcnlQYXRoKTtcclxuICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgIH1cclxufVxyXG5cclxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNyZWF0ZU9yaWdpbmFsQmFja3VwKG9yaWdpbmFsUGF0aDogc3RyaW5nLCBiYWNrdXBQYXRoOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGlmICghYXdhaXQgcGF0aEV4aXN0cyhiYWNrdXBQYXRoKSkge1xyXG4gICAgICAgIGF3YWl0IGVuc3VyZURpcihkaXJuYW1lKGJhY2t1cFBhdGgpKTtcclxuICAgICAgICBhd2FpdCBjb3B5KG9yaWdpbmFsUGF0aCwgYmFja3VwUGF0aCwgeyBvdmVyd3JpdGU6IGZhbHNlIH0pO1xyXG4gICAgfVxyXG59XHJcblxyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVzdG9yZU9yaWdpbmFsQmFja3VwKGJhY2t1cFBhdGg6IHN0cmluZywgb3JpZ2luYWxQYXRoOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGlmICghYXdhaXQgcGF0aEV4aXN0cyhiYWNrdXBQYXRoKSkge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcih0KCdlcnJvcnMuYmFja3VwX21pc3NpbmcnKSk7XG4gICAgfVxyXG4gICAgYXdhaXQgcmVwbGFjZU9yaWdpbmFsRmlsZShiYWNrdXBQYXRoLCBvcmlnaW5hbFBhdGgpO1xyXG4gICAgYXdhaXQgcmVtb3ZlKGJhY2t1cFBhdGgpO1xyXG59XHJcbiJdfQ==