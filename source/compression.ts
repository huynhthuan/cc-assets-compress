import { copy, ensureDir, move, pathExists, readFile, remove } from 'fs-extra';
import { spawn } from 'child_process';
import { dirname, join } from 'path';
import JSZip from 'jszip';
import ffmpegPath from 'ffmpeg-static';
import sharp from 'sharp';

export type ImageCompressor = 'pngquant' | 'sharp';

export interface FileMetrics {
    fileSize: number;
    base64Size: number;
    zipSize: number;
}

export interface ImageDimensions {
    width: number;
    height: number;
}

export interface CompressionSettings {
    qualityMin: number;
    qualityMax: number;
    speed: number;
    colors: number;
    dithering: number;
    audioBitrate: number;
    sampleRate: number;
    channels: number;
    sharpQuality: number;
    sharpCompressionLevel: number;
    sharpProgressive: boolean;
    sharpPalette: boolean;
    sharpMozjpeg: boolean;
    sharpChromaSubsampling: '4:2:0' | '4:4:4';
    resizeWidth: number | null;
    resizeHeight: number | null;
}

class BinaryProcessError extends Error {
    constructor(
        message: string,
        public readonly exitCode: number | null,
    ) {
        super(message);
        this.name = 'BinaryProcessError';
    }
}

function runBinary(binary: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        const process = spawn(binary, args, { windowsHide: true });
        let errorOutput = '';

        process.stderr.on('data', (chunk: Buffer) => {
            errorOutput += chunk.toString();
        });
        process.on('error', reject);
        process.on('close', (exitCode) => {
            if (exitCode === 0) {
                resolve();
                return;
            }
            reject(new BinaryProcessError(
                errorOutput.trim() || `Compression process exited with code ${exitCode}.`,
                exitCode,
            ));
        });
    });
}

function getPngquantPath(): string {
    const extensionPath = Editor.Package.getPath('cc-assets-compress');
    if (!extensionPath) {
        throw new Error('Không tìm thấy thư mục extension cc-assets-compress.');
    }
    const executable = process.platform === 'win32' ? 'pngquant.exe' : 'pngquant';
    return join(extensionPath, 'node_modules', 'pngquant-bin', 'vendor', executable);
}

export async function calculateFileMetrics(filePath: string, fileName: string): Promise<FileMetrics> {
    const fileBuffer = await readFile(filePath);
    const base64Content = fileBuffer.toString('base64');
    const zip = new JSZip();
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

export async function getImageDimensions(filePath: string): Promise<ImageDimensions> {
    const metadata = await sharp(filePath).metadata();
    if (!metadata.width || !metadata.height) {
        throw new Error('Không thể đọc kích thước ảnh.');
    }
    return { width: metadata.width, height: metadata.height };
}

export async function compressFile(
    inputPath: string,
    extension: string,
    outputDirectory: string,
    imageCompressor: ImageCompressor,
    settings: CompressionSettings,
): Promise<string> {
    await ensureDir(outputDirectory);

    if ((extension === '.png' || extension === '.jpg') && imageCompressor === 'sharp') {
        const outputPath = join(outputDirectory, `compressed${extension}`);
        let pipeline = sharp(inputPath, { failOn: 'error' });
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
        } else {
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
        if (!await pathExists(pngquantPath)) {
            throw new Error('Không tìm thấy binary pngquant. Hãy cài lại dependency của extension.');
        }

        const outputPath = join(outputDirectory, 'compressed.png');
        let pngquantInputPath = inputPath;
        if (settings.resizeWidth && settings.resizeHeight) {
            pngquantInputPath = join(outputDirectory, 'resized-input.png');
            await sharp(inputPath)
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
        const createPngquantArguments = (minimumQuality: number): string[] => [
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
        } catch (error) {
            // pngquant uses exit code 99 when the requested color count cannot
            // satisfy the minimum quality. Keep the chosen color count and max
            // quality, but relax only the minimum threshold so an output can be made.
            if (!(error instanceof BinaryProcessError)
                || error.exitCode !== 99
                || settings.qualityMin === 0) {
                throw error;
            }
            console.warn(
                `[cc-assets-compress] pngquant could not reach quality ${settings.qualityMin}; retrying with minimum quality 0.`,
            );
            await remove(outputPath);
            await runBinary(pngquantPath, createPngquantArguments(0));
        }
        return outputPath;
    }

    if (extension === '.mp3') {
        if (!ffmpegPath || !await pathExists(ffmpegPath)) {
            throw new Error('Không tìm thấy binary FFmpeg. Hãy cài lại dependency của extension.');
        }

        const outputPath = join(outputDirectory, 'compressed.mp3');
        await runBinary(ffmpegPath, [
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

export async function replaceOriginalFile(compressedPath: string, originalPath: string): Promise<void> {
    const temporaryPath = `${originalPath}.cc-assets-compress.tmp`;
    try {
        await copy(compressedPath, temporaryPath, { overwrite: true });
        await move(temporaryPath, originalPath, { overwrite: true });
    } catch (error) {
        await remove(temporaryPath);
        throw error;
    }
}

export async function createOriginalBackup(originalPath: string, backupPath: string): Promise<void> {
    if (!await pathExists(backupPath)) {
        await ensureDir(dirname(backupPath));
        await copy(originalPath, backupPath, { overwrite: false });
    }
}

export async function restoreOriginalBackup(backupPath: string, originalPath: string): Promise<void> {
    if (!await pathExists(backupPath)) {
        throw new Error('Không tìm thấy file backup để khôi phục.');
    }
    await replaceOriginalFile(backupPath, originalPath);
    await remove(backupPath);
}
