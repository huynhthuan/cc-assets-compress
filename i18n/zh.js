'use strict';

const translations = {
    open_panel: '媒体资源浏览器',
    description: '浏览并压缩项目中的图片和音频文件',
    language: { label: '语言', english: '英语', chinese: '中文', vietnamese: '越南语' },
    common: {
        close: '关闭', cancel: '取消', files_zero: '0 个文件', files_count: '{count} 个文件',
        filtered_count: '{visible}/{total} 个文件', size_bytes: '{size}（{bytes} 字节）', calculating: '计算中...',
        compressing: '压缩中...', unavailable: '不可用', decrease: '减少 {percent}%', increase: '增加 {percent}%', cannot_evaluate: '无法评估',
    },
    viewer: { zoom_out: '缩小', zoom_in: '放大', reset: '适应窗口并重置位置', fit: '适应' },
    browser: {
        title: '媒体资源', loading_assets: '正在加载资源...', loading: '加载中...', reload: '重新加载', search: '搜索',
        search_placeholder: '文件名或路径...', asset_type: '资源类型', all: '全部',
        load_error: '无法加载资源：{error}', no_assets: '项目中未找到 PNG、JPG 或 MP3 文件。', no_results: '没有符合当前筛选条件的资源。',
    },
    table: {
        preview: '预览', file_name: '文件名', path: '路径', size: '大小', base64: 'Base64 大小', base64_zip: 'Base64 + JSZip', actions: '操作',
        sort_file_size: '按文件大小排序', sort_base64: '按 Base64 大小排序', sort_base64_zip: '按 JSZip 压缩后的 Base64 大小排序',
        audio_file: '音频文件', details: '详情', compress: '压缩', convert: '转换', delete: '删除', compress_unavailable: '此格式不支持压缩',
        revert: '还原', revert_available: '恢复原始文件', revert_unavailable: '没有可用的原始备份',
    },
    pagination: { items_per_page_prefix: '每页显示', items_per_page_suffix: '项', label: '分页', previous: '上一页', next: '下一页' },
    detail: {
        title: '资源详情', uuid: 'UUID', type: '类型', asset_path: '资源路径', absolute_path: '绝对路径', original_size: '文件大小',
        base64_size: 'Base64 大小', base64_zip: 'JSZip 压缩后的 Base64 大小', calculation_error: '无法计算大小：{error}',
    },
    conversion: {
        title: '转换资源', source_format: '源格式', target_format: '目标格式',
        destination: '转换后的资源将使用可用名称创建在原文件旁边。', converting: '转换中...', convert: '转换', success: '已创建资源：{path}',
    },
    deletion: {
        title: '删除资源', warning: '此操作将永久删除资源及其 meta 文件。继续前请检查资源的使用情况。',
        scanning: '正在扫描场景、预制体和 Bundle 文件夹...', references: '场景和预制体引用', no_references: '未找到场景或预制体引用。',
        bundles: 'Bundle 文件夹', not_in_bundle: '此资源不在 Bundle 文件夹中。', scene: '场景', prefab: '预制体',
        hierarchy_path: '层级路径', hierarchy_unknown: '无法确定节点路径', select_in_hierarchy: '在层级管理器中选择', select_in_assets: '在资源管理器中选择',
        confirm: '删除资源', deleting: '删除中...', scan_failed: '引用扫描未完成。仅在了解风险后执行删除。',
    },
    compression: {
        title: '压缩资源', unsupported_jpg_title: 'JPG 压缩不可用',
        unsupported_jpg_body: 'Sharp 尚未安装。请在扩展目录运行 npm install，然后重新打开此面板。',
        library: '压缩库', pngquant_desc: '针对 PNG 图片优化的调色板量化工具。', sharp_desc: '适用于 PNG 和 JPG 的通用图片处理工具。',
        jpg_sharp_note: 'JPG 图片使用 Sharp 压缩。', resize_title: '调整图片大小 — 保持原始比例 {width} × {height}',
        by_percent: '按百分比', manual_size: '自定义尺寸', width: '宽度', height: '高度', percent: '百分比', result_size: '结果：{width} × {height} px',
        aspect_lock: '已锁定原始宽高比', preset: '预设', high: '高质量', balanced: '均衡', small: '小文件', custom: '自定义',
        settings: '{engine} 设置', quality_min: '最低质量', quality_max: '最高质量', speed: '速度', colors: '颜色数量', dithering: '抖动',
        quality: '质量', compression_level: '压缩级别', progressive: '渐进式 JPEG', palette_png: '调色板 PNG', mozjpeg: '使用 MozJPEG',
        chroma: '色度子采样', bitrate: '比特率', sample_rate: '采样率', channels: '声道', mono: '单声道', stereo: '立体声',
        pngquant_fallback: '如果 pngquant 无法处理所选颜色数量，扩展将使用安全的颜色范围重试。',
        generating: '正在创建预览...', create_preview: '创建预览', preview_title: '压缩前后预览', before: '压缩前', after: '压缩后',
        before_alt: '原始图片预览', after_alt: '压缩后图片预览', no_preview: '创建压缩预览以比较结果。', comparison: '大小比较',
        metric: '指标', before_col: '压缩前', after_col: '压缩后', change: '变化', file_metric: '文件', base64_metric: 'Base64',
        base64_zip_metric: 'Base64 + JSZip', applying: '应用中...', apply_overwrite: '应用并覆盖原文件',
    },
    confirm: { overwrite: '要用压缩后的版本覆盖原文件 {name} 吗？', revert: '要将 {name} 恢复到压缩前的版本吗？' },
    errors: {
        binary_exit: '压缩进程退出，代码为 {code}。', extension_path: '无法确定扩展目录。', image_dimensions: '无法读取图片尺寸。',
        pngquant_missing: '未找到 pngquant 可执行文件。请在扩展目录运行 npm install。',
        ffmpeg_missing: '未找到 FFmpeg 可执行文件。请在扩展目录运行 npm install。',
        pngquant_jpg: 'pngquant 仅支持 PNG 图片。JPG 图片请选择 Sharp。', backup_missing: '此资源没有原始备份。', inspect_file: '无法分析文件。',
        resize_range: '图片尺寸必须在 1 到 16384 px 之间。', quality_order: '最低质量不能高于最高质量。', pngquant_speed: 'pngquant 速度必须在 1 到 11 之间。',
        color_range: '颜色数量必须在 2 到 256 之间。', dithering_range: '抖动值必须在 0 到 1 之间。', sharp_quality: 'Sharp 质量必须在 1 到 100 之间。',
        compression_level: '压缩级别必须在 0 到 9 之间。', bitrate_range: '比特率必须在 8 到 320 kbps 之间。',
        sample_rate_range: '采样率必须在 8000 到 48000 Hz 之间。', channel_range: '声道必须为 1（单声道）或 2（立体声）。',
        load_original: '无法读取原始文件。', create_preview: '无法创建压缩预览。', apply: '无法应用压缩文件。', revert: '无法恢复原始文件。', load_assets: '无法加载资源。',
        create_converted_asset: 'Cocos AssetDB 无法创建转换后的资源。', convert_asset: '无法转换资源。',
        scan_references: '无法扫描资源引用。', delete_asset: '无法删除资源。',
        scene_node_not_found: '打开场景后找不到被引用的节点。', select_reference: '无法在编辑器中选择引用。',
    },
};

function flatten(map, prefix = '', output = {}) {
    for (const [key, value] of Object.entries(map)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'object') {
            flatten(value, fullKey, output);
        } else {
            output[fullKey] = value;
        }
    }
    return output;
}

module.exports = flatten(translations);
