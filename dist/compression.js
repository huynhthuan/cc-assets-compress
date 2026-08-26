"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateFileMetrics = calculateFileMetrics;
exports.getImageDimensions = getImageDimensions;
exports.compressFile = compressFile;
exports.replaceOriginalFile = replaceOriginalFile;
exports.createOriginalBackup = createOriginalBackup;
exports.restoreOriginalBackup = restoreOriginalBackup;
const fs_extra_1 = require("fs-extra");
const child_process_1 = require("child_process");
const path_1 = require("path");
const jszip_1 = __importDefault(require("jszip"));
const ffmpeg_static_1 = __importDefault(require("ffmpeg-static"));
const sharp_1 = __importDefault(require("sharp"));
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
            reject(new BinaryProcessError(errorOutput.trim() || `Compression process exited with code ${exitCode}.`, exitCode));
        });
    });
}
function getPngquantPath() {
    const extensionPath = Editor.Package.getPath('cc-assets-compress');
    if (!extensionPath) {
        throw new Error('Không tìm thấy thư mục extension cc-assets-compress.');
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
        throw new Error('Không thể đọc kích thước ảnh.');
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
            throw new Error('Không tìm thấy binary pngquant. Hãy cài lại dependency của extension.');
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
            throw new Error('Không tìm thấy binary FFmpeg. Hãy cài lại dependency của extension.');
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
    throw new Error('pngquant chỉ hỗ trợ ảnh PNG. Hãy chọn Sharp để nén file JPG.');
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
        throw new Error('Không tìm thấy file backup để khôi phục.');
    }
    await replaceOriginalFile(backupPath, originalPath);
    await (0, fs_extra_1.remove)(backupPath);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29tcHJlc3Npb24uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zb3VyY2UvY29tcHJlc3Npb24udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7QUFnRkEsb0RBZ0JDO0FBRUQsZ0RBTUM7QUFFRCxvQ0FrSEM7QUFFRCxrREFTQztBQUVELG9EQUtDO0FBRUQsc0RBTUM7QUF0UEQsdUNBQStFO0FBQy9FLGlEQUFzQztBQUN0QywrQkFBcUM7QUFDckMsa0RBQTBCO0FBQzFCLGtFQUF1QztBQUN2QyxrREFBMEI7QUFrQzFCLE1BQU0sa0JBQW1CLFNBQVEsS0FBSztJQUNsQyxZQUNJLE9BQWUsRUFDQyxRQUF1QjtRQUV2QyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUM7UUFGQyxhQUFRLEdBQVIsUUFBUSxDQUFlO1FBR3ZDLElBQUksQ0FBQyxJQUFJLEdBQUcsb0JBQW9CLENBQUM7SUFDckMsQ0FBQztDQUNKO0FBRUQsU0FBUyxTQUFTLENBQUMsTUFBYyxFQUFFLElBQWM7SUFDN0MsT0FBTyxJQUFJLE9BQU8sQ0FBQyxDQUFDLE9BQU8sRUFBRSxNQUFNLEVBQUUsRUFBRTtRQUNuQyxNQUFNLE9BQU8sR0FBRyxJQUFBLHFCQUFLLEVBQUMsTUFBTSxFQUFFLElBQUksRUFBRSxFQUFFLFdBQVcsRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDO1FBQzNELElBQUksV0FBVyxHQUFHLEVBQUUsQ0FBQztRQUVyQixPQUFPLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxLQUFhLEVBQUUsRUFBRTtZQUN4QyxXQUFXLElBQUksS0FBSyxDQUFDLFFBQVEsRUFBRSxDQUFDO1FBQ3BDLENBQUMsQ0FBQyxDQUFDO1FBQ0gsT0FBTyxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUsTUFBTSxDQUFDLENBQUM7UUFDNUIsT0FBTyxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxRQUFRLEVBQUUsRUFBRTtZQUM3QixJQUFJLFFBQVEsS0FB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LFVBQWtCLEVBQUUsWUFBb0I7SUFDaEYsSUFBSSxDQUFDLE1BQU0sSUFBQSxxQkFBVSxFQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUM7UUFDaEMsTUFBTSxJQUFJLEtBQUssQ0FBQywwQ0FBMEMsQ0FBQyxDQUFDO0lBQ2hFLENBQUM7SUFDRCxNQUFNLG1CQUFtQixDQUFDLFVBQVUsRUFBRSxZQUFZLENBQUMsQ0FBQztJQUNwRCxNQUFNLElBQUEsaUJBQU0sRUFBQyxVQUFVLENBQUMsQ0FBQztBQUM3QixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgY29weSwgZW5zdXJlRGlyLCBtb3ZlLCBwYXRoRXhpc3RzLCByZWFkRmlsZSwgcmVtb3ZlIH0gZnJvbSAnZnMtZXh0cmEnO1xuaW1wb3J0IHsgc3Bhd24gfSBmcm9tICdjaGlsZF9wcm9jZXNzJztcbmltcG9ydCB7IGRpcm5hbWUsIGpvaW4gfSBmcm9tICdwYXRoJztcbmltcG9ydCBKU1ppcCBmcm9tICdqc3ppcCc7XG5pbXBvcnQgZmZtcGVnUGF0aCBmcm9tICdmZm1wZWctc3RhdGljJztcbmltcG9ydCBzaGFycCBmcm9tICdzaGFycCc7XG5cbmV4cG9ydCB0eXBlIEltYWdlQ29tcHJlc3NvciA9ICdwbmdxdWFudCcgfCAnc2hhcnAnO1xuXG5leHBvcnQgaW50ZXJmYWNlIEZpbGVNZXRyaWNzIHtcbiAgICBmaWxlU2l6ZTogbnVtYmVyO1xuICAgIGJhc2U2NFNpemU6IG51bWJlcjtcbiAgICB6aXBTaXplOiBudW1iZXI7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgSW1hZ2VEaW1lbnNpb25zIHtcbiAgICB3aWR0aDogbnVtYmVyO1xuICAgIGhlaWdodDogbnVtYmVyO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIENvbXByZXNzaW9uU2V0dGluZ3Mge1xuICAgIHF1YWxpdHlNaW46IG51bWJlcjtcbiAgICBxdWFsaXR5TWF4OiBudW1iZXI7XG4gICAgc3BlZWQ6IG51bWJlcjtcbiAgICBjb2xvcnM6IG51bWJlcjtcbiAgICBkaXRoZXJpbmc6IG51bWJlcjtcbiAgICBhdWRpb0JpdHJhdGU6IG51bWJlcjtcbiAgICBzYW1wbGVSYXRlOiBudW1iZXI7XG4gICAgY2hhbm5lbHM6IG51bWJlcjtcbiAgICBzaGFycFF1YWxpdHk6IG51bWJlcjtcbiAgICBzaGFycENvbXByZXNzaW9uTGV2ZWw6IG51bWJlcjtcbiAgICBzaGFycFByb2dyZXNzaXZlOiBib29sZWFuO1xuICAgIHNoYXJwUGFsZXR0ZTogYm9vbGVhbjtcbiAgICBzaGFycE1vempwZWc6IGJvb2xlYW47XG4gICAgc2hhcnBDaHJvbWFTdWJzYW1wbGluZzogJzQ6MjowJyB8ICc0OjQ6NCc7XG4gICAgcmVzaXplV2lkdGg6IG51bWJlciB8IG51bGw7XG4gICAgcmVzaXplSGVpZ2h0OiBudW1iZXIgfCBudWxsO1xufVxuXG5jbGFzcyBCaW5hcnlQcm9jZXNzRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gICAgY29uc3RydWN0b3IoXG4gICAgICAgIG1lc3NhZ2U6IHN0cmluZyxcbiAgICAgICAgcHVibGljIHJlYWRvbmx5IGV4aXRDb2RlOiBudW1iZXIgfCBudWxsLFxuICAgICkge1xuICAgICAgICBzdXBlcihtZXNzYWdlKTtcbiAgICAgICAgdGhpcy5uYW1lID0gJ0JpbmFyeVByb2Nlc3NFcnJvcic7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBydW5CaW5hcnkoYmluYXJ5OiBzdHJpbmcsIGFyZ3M6IHN0cmluZ1tdKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgY29uc3QgcHJvY2VzcyA9IHNwYXduKGJpbmFyeSwgYXJncywgeyB3aW5kb3dzSGlkZTogdHJ1ZSB9KTtcbiAgICAgICAgbGV0IGVycm9yT3V0cHV0ID0gJyc7XG5cbiAgICAgICAgcHJvY2Vzcy5zdGRlcnIub24oJ2RhdGEnLCAoY2h1bms6IEJ1ZmZlcikgPT4ge1xuICAgICAgICAgICAgZXJyb3JPdXRwdXQgKz0gY2h1bmsudG9TdHJpbmcoKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHByb2Nlc3Mub24oJ2Vycm9yJywgcmVqZWN0KTtcbiAgICAgICAgcHJvY2Vzcy5vbignY2xvc2UnLCAoZXhpdENvZGUpID0+IHtcbiAgICAgICAgICAgIGlmIChleGl0Q29kZSA9PT0gMCkge1xuICAgICAgICAgICAgICAgIHJlc29sdmUoKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZWplY3QobmV3IEJpbmFyeVByb2Nlc3NFcnJvcihcbiAgICAgICAgICAgICAgICBlcnJvck91dHB1dC50cmltKCkgfHwgYENvbXByZXNzaW9uIHByb2Nlc3MgZXhpdGVkIHdpdGggY29kZSAke2V4aXRDb2RlfS5gLFxuICAgICAgICAgICAgICAgIGV4aXRDb2RlLFxuICAgICAgICAgICAgKSk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xufVxuXG5mdW5jdGlvbiBnZXRQbmdxdWFudFBhdGgoKTogc3RyaW5nIHtcbiAgICBjb25zdCBleHRlbnNpb25QYXRoID0gRWRpdG9yLlBhY2thZ2UuZ2V0UGF0aCgnY2MtYXNzZXRzLWNvbXByZXNzJyk7XG4gICAgaWYgKCFleHRlbnNpb25QYXRoKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignS2jDtG5nIHTDrG0gdGjhuqV5IHRoxrAgbeG7pWMgZXh0ZW5zaW9uIGNjLWFzc2V0cy1jb21wcmVzcy4nKTtcbiAgICB9XG4gICAgY29uc3QgZXhlY3V0YWJsZSA9IHByb2Nlc3MucGxhdGZvcm0gPT09ICd3aW4zMicgPyAncG5ncXVhbnQuZXhlJyA6ICdwbmdxdWFudCc7XG4gICAgcmV0dXJuIGpvaW4oZXh0ZW5zaW9uUGF0aCwgJ25vZGVfbW9kdWxlcycsICdwbmdxdWFudC1iaW4nLCAndmVuZG9yJywgZXhlY3V0YWJsZSk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjYWxjdWxhdGVGaWxlTWV0cmljcyhmaWxlUGF0aDogc3RyaW5nLCBmaWxlTmFtZTogc3RyaW5nKTogUHJvbWlzZTxGaWxlTWV0cmljcz4ge1xuICAgIGNvbnN0IGZpbGVCdWZmZXIgPSBhd2FpdCByZWFkRmlsZShmaWxlUGF0aCk7XG4gICAgY29uc3QgYmFzZTY0Q29udGVudCA9IGZpbGVCdWZmZXIudG9TdHJpbmcoJ2Jhc2U2NCcpO1xuICAgIGNvbnN0IHppcCA9IG5ldyBKU1ppcCgpO1xuICAgIHppcC5maWxlKGAke2ZpbGVOYW1lfS5iYXNlNjQudHh0YCwgYmFzZTY0Q29udGVudCk7XG4gICAgY29uc3QgemlwQnVmZmVyID0gYXdhaXQgemlwLmdlbmVyYXRlQXN5bmMoe1xuICAgICAgICB0eXBlOiAnbm9kZWJ1ZmZlcicsXG4gICAgICAgIGNvbXByZXNzaW9uOiAnREVGTEFURScsXG4gICAgICAgIGNvbXByZXNzaW9uT3B0aW9uczogeyBsZXZlbDogOSB9LFxuICAgIH0pO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgZmlsZVNpemU6IGZpbGVCdWZmZXIubGVuZ3RoLFxuICAgICAgICBiYXNlNjRTaXplOiBCdWZmZXIuYnl0ZUxlbmd0aChiYXNlNjRDb250ZW50LCAndXRmOCcpLFxuICAgICAgICB6aXBTaXplOiB6aXBCdWZmZXIubGVuZ3RoLFxuICAgIH07XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnZXRJbWFnZURpbWVuc2lvbnMoZmlsZVBhdGg6IHN0cmluZyk6IFByb21pc2U8SW1hZ2VEaW1lbnNpb25zPiB7XG4gICAgY29uc3QgbWV0YWRhdGEgPSBhd2FpdCBzaGFycChmaWxlUGF0aCkubWV0YWRhdGEoKTtcbiAgICBpZiAoIW1ldGFkYXRhLndpZHRoIHx8ICFtZXRhZGF0YS5oZWlnaHQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdLaMO0bmcgdGjhu4MgxJHhu41jIGvDrWNoIHRoxrDhu5tjIOG6o25oLicpO1xuICAgIH1cbiAgICByZXR1cm4geyB3aWR0aDogbWV0YWRhdGEud2lkdGgsIGhlaWdodDogbWV0YWRhdGEuaGVpZ2h0IH07XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjb21wcmVzc0ZpbGUoXG4gICAgaW5wdXRQYXRoOiBzdHJpbmcsXG4gICAgZXh0ZW5zaW9uOiBzdHJpbmcsXG4gICAgb3V0cHV0RGlyZWN0b3J5OiBzdHJpbmcsXG4gICAgaW1hZ2VDb21wcmVzc29yOiBJbWFnZUNvbXByZXNzb3IsXG4gICAgc2V0dGluZ3M6IENvbXByZXNzaW9uU2V0dGluZ3MsXG4pOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGF3YWl0IGVuc3VyZURpcihvdXRwdXREaXJlY3RvcnkpO1xuXG4gICAgaWYgKChleHRlbnNpb24gPT09ICcucG5nJyB8fCBleHRlbnNpb24gPT09ICcuanBnJykgJiYgaW1hZ2VDb21wcmVzc29yID09PSAnc2hhcnAnKSB7XG4gICAgICAgIGNvbnN0IG91dHB1dFBhdGggPSBqb2luKG91dHB1dERpcmVjdG9yeSwgYGNvbXByZXNzZWQke2V4dGVuc2lvbn1gKTtcbiAgICAgICAgbGV0IHBpcGVsaW5lID0gc2hhcnAoaW5wdXRQYXRoLCB7IGZhaWxPbjogJ2Vycm9yJyB9KTtcbiAgICAgICAgaWYgKHNldHRpbmdzLnJlc2l6ZVdpZHRoICYmIHNldHRpbmdzLnJlc2l6ZUhlaWdodCkge1xuICAgICAgICAgICAgcGlwZWxpbmUgPSBwaXBlbGluZS5yZXNpemUoc2V0dGluZ3MucmVzaXplV2lkdGgsIHNldHRpbmdzLnJlc2l6ZUhlaWdodCwge1xuICAgICAgICAgICAgICAgIGZpdDogJ2luc2lkZScsXG4gICAgICAgICAgICAgICAgd2l0aG91dEVubGFyZ2VtZW50OiBmYWxzZSxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGV4dGVuc2lvbiA9PT0gJy5wbmcnKSB7XG4gICAgICAgICAgICBhd2FpdCBwaXBlbGluZS5wbmcoe1xuICAgICAgICAgICAgICAgIHF1YWxpdHk6IHNldHRpbmdzLnNoYXJwUXVhbGl0eSxcbiAgICAgICAgICAgICAgICBjb21wcmVzc2lvbkxldmVsOiBzZXR0aW5ncy5zaGFycENvbXByZXNzaW9uTGV2ZWwsXG4gICAgICAgICAgICAgICAgcHJvZ3Jlc3NpdmU6IHNldHRpbmdzLnNoYXJwUHJvZ3Jlc3NpdmUsXG4gICAgICAgICAgICAgICAgcGFsZXR0ZTogc2V0dGluZ3Muc2hhcnBQYWxldHRlLFxuICAgICAgICAgICAgICAgIGNvbG91cnM6IHNldHRpbmdzLmNvbG9ycyxcbiAgICAgICAgICAgICAgICBkaXRoZXI6IHNldHRpbmdzLmRpdGhlcmluZyxcbiAgICAgICAgICAgIH0pLnRvRmlsZShvdXRwdXRQYXRoKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGF3YWl0IHBpcGVsaW5lLmpwZWcoe1xuICAgICAgICAgICAgICAgIHF1YWxpdHk6IHNldHRpbmdzLnNoYXJwUXVhbGl0eSxcbiAgICAgICAgICAgICAgICBwcm9ncmVzc2l2ZTogc2V0dGluZ3Muc2hhcnBQcm9ncmVzc2l2ZSxcbiAgICAgICAgICAgICAgICBtb3pqcGVnOiBzZXR0aW5ncy5zaGFycE1vempwZWcsXG4gICAgICAgICAgICAgICAgY2hyb21hU3Vic2FtcGxpbmc6IHNldHRpbmdzLnNoYXJwQ2hyb21hU3Vic2FtcGxpbmcsXG4gICAgICAgICAgICB9KS50b0ZpbGUob3V0cHV0UGF0aCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG91dHB1dFBhdGg7XG4gICAgfVxuXG4gICAgaWYgKGV4dGVuc2lvbiA9PT0gJy5wbmcnICYmIGltYWdlQ29tcHJlc3NvciA9PT0gJ3BuZ3F1YW50Jykge1xuICAgICAgICBjb25zdCBwbmdxdWFudFBhdGggPSBnZXRQbmdxdWFudFBhdGgoKTtcbiAgICAgICAgaWYgKCFhd2FpdCBwYXRoRXhpc3RzKHBuZ3F1YW50UGF0aCkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignS2jDtG5nIHTDrG0gdGjhuqV5IGJpbmFyeSBwbmdxdWFudC4gSMOjeSBjw6BpIGzhuqFpIGRlcGVuZGVuY3kgY+G7p2EgZXh0ZW5zaW9uLicpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3Qgb3V0cHV0UGF0aCA9IGpvaW4ob3V0cHV0RGlyZWN0b3J5LCAnY29tcHJlc3NlZC5wbmcnKTtcbiAgICAgICAgbGV0IHBuZ3F1YW50SW5wdXRQYXRoID0gaW5wdXRQYXRoO1xuICAgICAgICBpZiAoc2V0dGluZ3MucmVzaXplV2lkdGggJiYgc2V0dGluZ3MucmVzaXplSGVpZ2h0KSB7XG4gICAgICAgICAgICBwbmdxdWFudElucHV0UGF0aCA9IGpvaW4ob3V0cHV0RGlyZWN0b3J5LCAncmVzaXplZC1pbnB1dC5wbmcnKTtcbiAgICAgICAgICAgIGF3YWl0IHNoYXJwKGlucHV0UGF0aClcbiAgICAgICAgICAgICAgICAucmVzaXplKHNldHRpbmdzLnJlc2l6ZVdpZHRoLCBzZXR0aW5ncy5yZXNpemVIZWlnaHQsIHtcbiAgICAgICAgICAgICAgICAgICAgZml0OiAnaW5zaWRlJyxcbiAgICAgICAgICAgICAgICAgICAgd2l0aG91dEVubGFyZ2VtZW50OiBmYWxzZSxcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgIC5wbmcoKVxuICAgICAgICAgICAgICAgIC50b0ZpbGUocG5ncXVhbnRJbnB1dFBhdGgpO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGRpdGhlckFyZ3VtZW50cyA9IHNldHRpbmdzLmRpdGhlcmluZyA9PT0gMFxuICAgICAgICAgICAgPyBbJy0tbm9mcyddXG4gICAgICAgICAgICA6IFtgLS1mbG95ZD0ke3NldHRpbmdzLmRpdGhlcmluZ31gXTtcbiAgICAgICAgY29uc3QgY3JlYXRlUG5ncXVhbnRBcmd1bWVudHMgPSAobWluaW11bVF1YWxpdHk6IG51bWJlcik6IHN0cmluZ1tdID0+IFtcbiAgICAgICAgICAgICctLWZvcmNlJyxcbiAgICAgICAgICAgICctLXN0cmlwJyxcbiAgICAgICAgICAgICctLXF1YWxpdHknLCBgJHttaW5pbXVtUXVhbGl0eX0tJHtzZXR0aW5ncy5xdWFsaXR5TWF4fWAsXG4gICAgICAgICAgICAnLS1zcGVlZCcsIFN0cmluZyhzZXR0aW5ncy5zcGVlZCksXG4gICAgICAgICAgICAuLi5kaXRoZXJBcmd1bWVudHMsXG4gICAgICAgICAgICAnLS1vdXRwdXQnLCBvdXRwdXRQYXRoLFxuICAgICAgICAgICAgU3RyaW5nKHNldHRpbmdzLmNvbG9ycyksXG4gICAgICAgICAgICAnLS0nLCBwbmdxdWFudElucHV0UGF0aCxcbiAgICAgICAgXTtcblxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgYXdhaXQgcnVuQmluYXJ5KHBuZ3F1YW50UGF0aCwgY3JlYXRlUG5ncXVhbnRBcmd1bWVudHMoc2V0dGluZ3MucXVhbGl0eU1pbikpO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgLy8gcG5ncXVhbnQgdXNlcyBleGl0IGNvZGUgOTkgd2hlbiB0aGUgcmVxdWVzdGVkIGNvbG9yIGNvdW50IGNhbm5vdFxuICAgICAgICAgICAgLy8gc2F0aXNmeSB0aGUgbWluaW11bSBxdWFsaXR5LiBLZWVwIHRoZSBjaG9zZW4gY29sb3IgY291bnQgYW5kIG1heFxuICAgICAgICAgICAgLy8gcXVhbGl0eSwgYnV0IHJlbGF4IG9ubHkgdGhlIG1pbmltdW0gdGhyZXNob2xkIHNvIGFuIG91dHB1dCBjYW4gYmUgbWFkZS5cbiAgICAgICAgICAgIGlmICghKGVycm9yIGluc3RhbmNlb2YgQmluYXJ5UHJvY2Vzc0Vycm9yKVxuICAgICAgICAgICAgICAgIHx8IGVycm9yLmV4aXRDb2RlICE9PSA5OVxuICAgICAgICAgICAgICAgIHx8IHNldHRpbmdzLnF1YWxpdHlNaW4gPT09IDApIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnNvbGUud2FybihcbiAgICAgICAgICAgICAgICBgW2NjLWFzc2V0cy1jb21wcmVzc10gcG5ncXVhbnQgY291bGQgbm90IHJlYWNoIHF1YWxpdHkgJHtzZXR0aW5ncy5xdWFsaXR5TWlufTsgcmV0cnlpbmcgd2l0aCBtaW5pbXVtIHF1YWxpdHkgMC5gLFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIGF3YWl0IHJlbW92ZShvdXRwdXRQYXRoKTtcbiAgICAgICAgICAgIGF3YWl0IHJ1bkJpbmFyeShwbmdxdWFudFBhdGgsIGNyZWF0ZVBuZ3F1YW50QXJndW1lbnRzKDApKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gb3V0cHV0UGF0aDtcbiAgICB9XG5cbiAgICBpZiAoZXh0ZW5zaW9uID09PSAnLm1wMycpIHtcbiAgICAgICAgaWYgKCFmZm1wZWdQYXRoIHx8ICFhd2FpdCBwYXRoRXhpc3RzKGZmbXBlZ1BhdGgpKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0tow7RuZyB0w6xtIHRo4bqleSBiaW5hcnkgRkZtcGVnLiBIw6N5IGPDoGkgbOG6oWkgZGVwZW5kZW5jeSBj4bunYSBleHRlbnNpb24uJyk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBvdXRwdXRQYXRoID0gam9pbihvdXRwdXREaXJlY3RvcnksICdjb21wcmVzc2VkLm1wMycpO1xuICAgICAgICBhd2FpdCBydW5CaW5hcnkoZmZtcGVnUGF0aCwgW1xuICAgICAgICAgICAgJy1oaWRlX2Jhbm5lcicsXG4gICAgICAgICAgICAnLWxvZ2xldmVsJywgJ2Vycm9yJyxcbiAgICAgICAgICAgICcteScsXG4gICAgICAgICAgICAnLWknLCBpbnB1dFBhdGgsXG4gICAgICAgICAgICAnLW1hcF9tZXRhZGF0YScsICcwJyxcbiAgICAgICAgICAgICctdm4nLFxuICAgICAgICAgICAgJy1jb2RlYzphJywgJ2xpYm1wM2xhbWUnLFxuICAgICAgICAgICAgJy1iOmEnLCBgJHtzZXR0aW5ncy5hdWRpb0JpdHJhdGV9a2AsXG4gICAgICAgICAgICAnLWFyJywgU3RyaW5nKHNldHRpbmdzLnNhbXBsZVJhdGUpLFxuICAgICAgICAgICAgJy1hYycsIFN0cmluZyhzZXR0aW5ncy5jaGFubmVscyksXG4gICAgICAgICAgICBvdXRwdXRQYXRoLFxuICAgICAgICBdKTtcbiAgICAgICAgcmV0dXJuIG91dHB1dFBhdGg7XG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKCdwbmdxdWFudCBjaOG7iSBo4buXIHRy4bujIOG6o25oIFBORy4gSMOjeSBjaOG7jW4gU2hhcnAgxJHhu4MgbsOpbiBmaWxlIEpQRy4nKTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlcGxhY2VPcmlnaW5hbEZpbGUoY29tcHJlc3NlZFBhdGg6IHN0cmluZywgb3JpZ2luYWxQYXRoOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCB0ZW1wb3JhcnlQYXRoID0gYCR7b3JpZ2luYWxQYXRofS5jYy1hc3NldHMtY29tcHJlc3MudG1wYDtcbiAgICB0cnkge1xuICAgICAgICBhd2FpdCBjb3B5KGNvbXByZXNzZWRQYXRoLCB0ZW1wb3JhcnlQYXRoLCB7IG92ZXJ3cml0ZTogdHJ1ZSB9KTtcbiAgICAgICAgYXdhaXQgbW92ZSh0ZW1wb3JhcnlQYXRoLCBvcmlnaW5hbFBhdGgsIHsgb3ZlcndyaXRlOiB0cnVlIH0pO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGF3YWl0IHJlbW92ZSh0ZW1wb3JhcnlQYXRoKTtcbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfVxufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY3JlYXRlT3JpZ2luYWxCYWNrdXAob3JpZ2luYWxQYXRoOiBzdHJpbmcsIGJhY2t1cFBhdGg6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghYXdhaXQgcGF0aEV4aXN0cyhiYWNrdXBQYXRoKSkge1xuICAgICAgICBhd2FpdCBlbnN1cmVEaXIoZGlybmFtZShiYWNrdXBQYXRoKSk7XG4gICAgICAgIGF3YWl0IGNvcHkob3JpZ2luYWxQYXRoLCBiYWNrdXBQYXRoLCB7IG92ZXJ3cml0ZTogZmFsc2UgfSk7XG4gICAgfVxufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVzdG9yZU9yaWdpbmFsQmFja3VwKGJhY2t1cFBhdGg6IHN0cmluZywgb3JpZ2luYWxQYXRoOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWF3YWl0IHBhdGhFeGlzdHMoYmFja3VwUGF0aCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdLaMO0bmcgdMOsbSB0aOG6pXkgZmlsZSBiYWNrdXAgxJHhu4Mga2jDtGkgcGjhu6VjLicpO1xuICAgIH1cbiAgICBhd2FpdCByZXBsYWNlT3JpZ2luYWxGaWxlKGJhY2t1cFBhdGgsIG9yaWdpbmFsUGF0aCk7XG4gICAgYXdhaXQgcmVtb3ZlKGJhY2t1cFBhdGgpO1xufVxuIl19