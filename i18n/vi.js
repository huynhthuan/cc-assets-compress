'use strict';

const translations = {
    open_panel: 'Trình duyệt tài nguyên Media',
    description: 'Duyệt và nén các tệp hình ảnh, âm thanh trong dự án',
    language: { label: 'Ngôn ngữ', english: 'Tiếng Anh', chinese: 'Tiếng Trung', vietnamese: 'Tiếng Việt' },
    common: {
        close: 'Đóng', cancel: 'Hủy', files_zero: '0 tệp', files_count: '{count} tệp',
        filtered_count: '{visible}/{total} tệp', size_bytes: '{size} ({bytes} byte)', calculating: 'Đang tính...',
        compressing: 'Đang nén...', unavailable: 'Không có', decrease: 'Giảm {percent}%', increase: 'Tăng {percent}%', cannot_evaluate: 'Không thể đánh giá',
    },
    viewer: { zoom_out: 'Thu nhỏ', zoom_in: 'Phóng to', reset: 'Vừa khung và đặt lại vị trí', fit: 'Vừa khung' },
    browser: {
        title: 'Tài nguyên Media', loading_assets: 'Đang tải tài nguyên...', loading: 'Đang tải...', reload: 'Tải lại', search: 'Tìm kiếm',
        search_placeholder: 'Tên tệp hoặc đường dẫn...', asset_type: 'Loại tài nguyên', all: 'Tất cả',
        load_error: 'Không thể tải tài nguyên: {error}', no_assets: 'Không tìm thấy tệp PNG, JPG hoặc MP3 trong dự án.',
        no_results: 'Không có tài nguyên phù hợp với bộ lọc hiện tại.',
    },
    table: {
        preview: 'Xem trước', file_name: 'Tên tệp', path: 'Đường dẫn', size: 'Kích thước', base64: 'Kích thước Base64',
        base64_zip: 'Base64 + JSZip', actions: 'Thao tác', sort_file_size: 'Sắp xếp theo kích thước tệp',
        sort_base64: 'Sắp xếp theo kích thước Base64', sort_base64_zip: 'Sắp xếp theo kích thước Base64 được nén bằng JSZip',
        audio_file: 'Tệp âm thanh', details: 'Chi tiết', compress: 'Nén', convert: 'Chuyển đổi', delete: 'Xóa',
        compress_unavailable: 'Không hỗ trợ nén định dạng này', revert: 'Khôi phục',
        revert_available: 'Khôi phục tệp gốc', revert_unavailable: 'Không có bản sao lưu tệp gốc',
    },
    pagination: { items_per_page_prefix: 'Hiển thị', items_per_page_suffix: 'mục mỗi trang', label: 'Phân trang', previous: 'Trang trước', next: 'Trang sau' },
    detail: {
        title: 'Chi tiết tài nguyên', uuid: 'UUID', type: 'Loại', asset_path: 'Đường dẫn tài nguyên', absolute_path: 'Đường dẫn tuyệt đối',
        original_size: 'Kích thước tệp', base64_size: 'Kích thước Base64', base64_zip: 'Kích thước Base64 được nén bằng JSZip',
        calculation_error: 'Không thể tính kích thước: {error}',
    },
    conversion: {
        title: 'Chuyển đổi tài nguyên', source_format: 'Định dạng nguồn', target_format: 'Định dạng đích',
        destination: 'Tài nguyên sau khi chuyển đổi sẽ được tạo cạnh tệp gốc với một tên chưa được sử dụng.',
        converting: 'Đang chuyển đổi...', convert: 'Chuyển đổi', success: 'Đã tạo tài nguyên: {path}',
    },
    deletion: {
        title: 'Xóa tài nguyên', warning: 'Thao tác này sẽ xóa vĩnh viễn tài nguyên và tệp meta. Hãy kiểm tra nơi sử dụng trước khi tiếp tục.',
        scanning: 'Đang quét scene, prefab và thư mục bundle...', references: 'Tham chiếu trong scene và prefab',
        no_references: 'Không tìm thấy tham chiếu trong scene hoặc prefab.', bundles: 'Thư mục bundle',
        not_in_bundle: 'Tài nguyên này không nằm trong thư mục bundle.', scene: 'Scene', prefab: 'Prefab',
        hierarchy_path: 'Đường dẫn Hierarchy', hierarchy_unknown: 'Không thể xác định đường dẫn node',
        select_in_hierarchy: 'Chọn trong Hierarchy', select_in_assets: 'Chọn trong Assets',
        confirm: 'Xóa tài nguyên', deleting: 'Đang xóa...', scan_failed: 'Quá trình quét tham chiếu chưa hoàn tất. Chỉ xóa nếu bạn hiểu rõ rủi ro.',
    },
    compression: {
        title: 'Nén tài nguyên', unsupported_jpg_title: 'Không thể nén JPG',
        unsupported_jpg_body: 'Sharp chưa được cài đặt. Hãy chạy npm install trong thư mục extension rồi mở lại panel.',
        library: 'Thư viện nén', pngquant_desc: 'Lượng tử hóa bảng màu được tối ưu cho ảnh PNG.',
        sharp_desc: 'Xử lý hình ảnh đa dụng cho PNG và JPG.', jpg_sharp_note: 'Ảnh JPG được nén bằng Sharp.',
        resize_title: 'Đổi kích thước ảnh — giữ tỷ lệ gốc {width} × {height}', by_percent: 'Theo phần trăm',
        manual_size: 'Kích thước tùy chỉnh', width: 'Chiều rộng', height: 'Chiều cao', percent: 'Tỷ lệ',
        result_size: 'Kết quả: {width} × {height} px', aspect_lock: 'Tỷ lệ khung hình gốc đã được khóa', preset: 'Cấu hình sẵn',
        high: 'Chất lượng cao', balanced: 'Cân bằng', small: 'Tệp nhỏ', custom: 'Tùy chỉnh', settings: 'Thông số {engine}',
        quality_min: 'Chất lượng tối thiểu', quality_max: 'Chất lượng tối đa', speed: 'Tốc độ', colors: 'Số lượng màu',
        dithering: 'Dithering', quality: 'Chất lượng', compression_level: 'Mức nén', progressive: 'JPEG lũy tiến',
        palette_png: 'PNG bảng màu', mozjpeg: 'Sử dụng MozJPEG', chroma: 'Lấy mẫu phụ màu', bitrate: 'Bitrate',
        sample_rate: 'Tần số lấy mẫu', channels: 'Số kênh', mono: 'Mono', stereo: 'Stereo',
        pngquant_fallback: 'Nếu pngquant không thể xử lý số màu đã chọn, extension sẽ thử lại với khoảng màu an toàn.',
        generating: 'Đang tạo bản xem trước...', create_preview: 'Tạo bản xem trước', preview_title: 'Xem trước trước và sau khi nén',
        before: 'Trước khi nén', after: 'Sau khi nén', before_alt: 'Xem trước ảnh gốc', after_alt: 'Xem trước ảnh đã nén',
        no_preview: 'Hãy tạo bản nén để xem trước và so sánh kết quả.', comparison: 'So sánh kích thước', metric: 'Chỉ số',
        before_col: 'Trước', after_col: 'Sau', change: 'Thay đổi', file_metric: 'Tệp', base64_metric: 'Base64',
        base64_zip_metric: 'Base64 + JSZip', applying: 'Đang áp dụng...', apply_overwrite: 'Áp dụng và ghi đè tệp gốc',
    },
    confirm: {
        overwrite: 'Ghi đè tệp gốc {name} bằng phiên bản đã nén?',
        revert: 'Khôi phục {name} về phiên bản trước khi nén?',
    },
    errors: {
        binary_exit: 'Tiến trình nén đã thoát với mã {code}.', extension_path: 'Không thể xác định thư mục extension.',
        image_dimensions: 'Không thể đọc kích thước ảnh.',
        pngquant_missing: 'Không tìm thấy chương trình pngquant. Hãy chạy npm install trong thư mục extension.',
        ffmpeg_missing: 'Không tìm thấy chương trình FFmpeg. Hãy chạy npm install trong thư mục extension.',
        pngquant_jpg: 'pngquant chỉ hỗ trợ ảnh PNG. Hãy chọn Sharp cho ảnh JPG.', backup_missing: 'Tài nguyên này không có bản sao lưu gốc.',
        inspect_file: 'Không thể phân tích tệp.', resize_range: 'Kích thước ảnh phải nằm trong khoảng từ 1 đến 16384 px.',
        quality_order: 'Chất lượng tối thiểu không thể lớn hơn chất lượng tối đa.', pngquant_speed: 'Tốc độ pngquant phải nằm trong khoảng từ 1 đến 11.',
        color_range: 'Số lượng màu phải nằm trong khoảng từ 2 đến 256.', dithering_range: 'Dithering phải nằm trong khoảng từ 0 đến 1.',
        sharp_quality: 'Chất lượng Sharp phải nằm trong khoảng từ 1 đến 100.', compression_level: 'Mức nén phải nằm trong khoảng từ 0 đến 9.',
        bitrate_range: 'Bitrate phải nằm trong khoảng từ 8 đến 320 kbps.', sample_rate_range: 'Tần số lấy mẫu phải nằm trong khoảng từ 8000 đến 48000 Hz.',
        channel_range: 'Số kênh phải là 1 (mono) hoặc 2 (stereo).', load_original: 'Không thể đọc tệp gốc.',
        create_preview: 'Không thể tạo bản nén xem trước.', apply: 'Không thể áp dụng tệp đã nén.',
        revert: 'Không thể khôi phục tệp gốc.', load_assets: 'Không thể tải tài nguyên.',
        create_converted_asset: 'Cocos AssetDB không thể tạo tài nguyên đã chuyển đổi.', convert_asset: 'Không thể chuyển đổi tài nguyên.',
        scan_references: 'Không thể quét các tham chiếu của tài nguyên.', delete_asset: 'Không thể xóa tài nguyên.',
        scene_node_not_found: 'Không tìm thấy node tham chiếu sau khi mở scene.', select_reference: 'Không thể chọn tham chiếu trong Editor.',
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
