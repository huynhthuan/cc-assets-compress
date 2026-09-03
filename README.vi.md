# cc-assets-compress

[English](README.md) | [简体中文](README.zh-CN.md) | [Tiếng Việt](README.vi.md)

`cc-assets-compress` là extension dành cho Cocos Creator Editor, hỗ trợ duyệt, kiểm tra, nén, chuyển đổi và xóa an toàn các tài nguyên media trong dự án.

## Yêu cầu môi trường

- Cocos Creator `3.8.6` trở lên
- Node.js `18` trở lên để phát triển extension
- npm

Gói release đã bao gồm các dependency cần thiết khi chạy: Sharp, pngquant, FFmpeg, JSZip và Vue.

## Chức năng

### Trình duyệt tài nguyên

- Thu thập các tài nguyên PNG, JPG, WebP, MP3, WAV và OGG trong dự án hiện tại.
- Hiển thị thumbnail ảnh 100 × 100; file âm thanh được biểu diễn bằng icon.
- Hiển thị đường dẫn, kích thước file gốc, kích thước Base64 và kích thước Base64 sau khi nén bằng JSZip.
- Tìm kiếm theo tên file hoặc đường dẫn asset.
- Tự động tạo bộ lọc loại asset từ các định dạng thực tế có trong dự án.
- Sắp xếp theo kích thước file, Base64 và JSZip.
- Hỗ trợ phân trang và chọn số item mỗi trang. Phân trang tự tính lại sau khi filter, search hoặc sort.

### Chi tiết tài nguyên

- Hiển thị tên, loại, UUID, URL asset, đường dẫn tuyệt đối và các thông tin kích thước.
- Ảnh hỗ trợ zoom, kéo và fit vào khung.
- Tài nguyên âm thanh có player để nghe thử.

### Nén tài nguyên

- PNG: mặc định dùng pngquant, có thể chuyển sang Sharp.
- JPG: dùng Sharp.
- MP3: dùng FFmpeg.
- Có các preset chất lượng cao, cân bằng, dung lượng nhỏ và tùy chỉnh.
- Tùy theo định dạng, có thể cấu hình quality, speed, số màu, dithering, compression level, bitrate, sample rate và số channel.
- Resize ảnh theo phần trăm hoặc kích thước cụ thể và luôn giữ nguyên tỷ lệ gốc.
- So sánh kích thước file, Base64 và JSZip trước và sau khi nén.
- Xem trước ảnh hoặc nghe thử âm thanh trước khi áp dụng.
- Tạo backup trước khi ghi đè và có chức năng khôi phục file gốc.

### Chuyển đổi định dạng

- Hình ảnh: PNG, JPG và WebP.
- Âm thanh: MP3, WAV và OGG.
- Tài nguyên sau khi chuyển đổi được tạo cạnh tài nguyên nguồn.
- Sử dụng Cocos AssetDB để tự tạo tên không trùng và import kết quả.

### Xóa tài nguyên an toàn

- Quét các reference trong scene và prefab trước khi xóa.
- Hiển thị đường dẫn node trong Hierarchy của scene.
- Có thể mở scene tham chiếu và chọn đúng node trong Hierarchy.
- Có thể chọn prefab tham chiếu trong Assets panel.
- Phát hiện asset có đang nằm trong folder bundle hay không.
- Yêu cầu xác nhận trước khi xóa vĩnh viễn asset và file meta.

### Đa ngôn ngữ

- Tiếng Anh
- Tiếng Trung giản thể
- Tiếng Việt
- Có thể đổi ngôn ngữ ngay trên toolbar của extension và lựa chọn được lưu giữa các phiên làm việc.

## Cài đặt bản release trong Cocos Creator

1. Mở trang [GitHub Releases](https://github.com/huynhthuan/cc-assets-compress/releases/latest).
2. Tải file `cc-assets-compress-vX.Y.Z.zip`. Không giải nén hoặc nén lại file này.
3. Mở dự án bằng Cocos Creator.
4. Trên menu chính, chọn **Extension → Extension Manager**.
5. Chọn tab **Project** nếu chỉ muốn cài cho dự án hiện tại, hoặc **Global** nếu muốn sử dụng cho tất cả dự án.
6. Nhấn nút **+** và chọn file ZIP vừa tải.
7. Tìm `cc-assets-compress` trong danh sách extension và nhấn **Enable**.

Nếu đã cài phiên bản cũ, hãy reload extension hoặc khởi động lại Cocos Creator sau khi cập nhật.

## Mở extension sau khi cài đặt

Sau khi cài đặt và bật extension, trên menu chính chọn:

**Panel → cc-assets-compress → Trình duyệt tài nguyên Media**

Đây là một panel có thể dock và đặt ở vị trí bất kỳ trong layout của Cocos Creator.

## Cấu hình môi trường phát triển

### 1. Clone repository

```bash
git clone https://github.com/huynhthuan/cc-assets-compress.git
cd cc-assets-compress
```

### 2. Cài đặt dependency

```bash
npm install
```

Quá trình cài đặt sẽ tải các binary theo nền tảng dành cho Sharp, pngquant và FFmpeg. Vì vậy lần cài đặt đầu tiên cần có kết nối Internet.

### 3. Build extension

```bash
npm run build
```

Mã TypeScript trong `source/` sẽ được biên dịch sang `dist/`.

### 4. Thêm bản development vào dự án Cocos

Sử dụng một trong hai cách:

- Copy hoặc clone repository vào:

  ```text
  <thư-mục-dự-án>/extensions/cc-assets-compress
  ```

- Hoặc chọn **Extension → Extension Manager → Developer Import**, sau đó chọn thư mục repository.

Khi extension xuất hiện trong Extension Manager, hãy bật extension.

### 5. Reload sau khi thay đổi code

Build lại source:

```bash
npm run build
```

Sau đó nhấn **Reload** cho `cc-assets-compress` trong Extension Manager, hoặc tắt rồi bật lại extension. Nếu panel đang mở, có thể cần đóng và mở lại panel.

## Cấu trúc dự án

```text
cc-assets-compress/
├─ source/                  Mã nguồn TypeScript
├─ dist/                    JavaScript đã build và được Cocos Creator load
├─ static/                  HTML và CSS của panel
├─ i18n/                    Bản dịch tiếng Anh, Trung và Việt
├─ scripts/                 Script hỗ trợ cài đặt
├─ package.json             Manifest và dependency của extension
└─ tsconfig.json            Cấu hình TypeScript
```

## Đóng gói bản build cục bộ

File ZIP cài đặt Cocos Creator phải chứa các mục sau ngay tại thư mục gốc:

```text
dist/
i18n/
node_modules/
package.json
static/
```

Trên Windows, không nên dùng công cụ tạo tên entry trong ZIP bằng dấu gạch chéo ngược. Lệnh sau tạo ZIP với dấu `/` đúng chuẩn:

```powershell
tar -a -c -f cc-assets-compress-v1.1.0.zip dist i18n node_modules package.json static
```

Kiểm tra nội dung trước khi phát hành:

```powershell
tar -tf cc-assets-compress-v1.1.0.zip
```

Xem thêm [hướng dẫn cài đặt và đóng gói extension của Cocos Creator](https://docs.cocos.com/creator/3.8/manual/en/editor/extension/install.html).

## Lưu ý

- Chức năng nén chỉ ghi đè file gốc sau khi người dùng xác nhận rõ ràng.
- Backup phục vụ Revert được lưu trong thư mục tạm của dự án Cocos Creator và không nên đưa vào source control.
- Hãy kiểm tra toàn bộ reference scene, prefab và bundle trong modal xác nhận trước khi xóa asset.
