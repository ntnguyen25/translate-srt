# Hướng dẫn Deploy lên Cloudflare Pages

Ứng dụng **Dịch Phụ Đề AI (SubStream AI)** đã được tối ưu hóa toàn diện để deploy lên **Cloudflare Pages** một cách mượt mà và không gặp lỗi.

---

## Cách 1: Deploy tự động qua Git (Khuyên dùng)

### Bước 1: Đẩy mã nguồn lên GitHub hoặc GitLab
Đẩy toàn bộ source code của project lên repository của bạn trên GitHub/GitLab.

### Bước 2: Tạo dự án trên Cloudflare Dashboard
1. Truy cập [Cloudflare Dashboard](https://dash.cloudflare.com/) > chọn **Workers & Pages**.
2. Nhấn nút **Create application** > chọn tab **Pages** > **Connect to Git**.
3. Chọn repository chứa dự án này.

### Bước 3: Cấu hình Build Settings
Điền các thông số sau trong phần **Set up builds and deployments**:
- **Framework preset**: `Vite` (hoặc `None`)
- **Build command**: `npm run build`
- **Build output directory**: `dist`
- **Root directory**: `/` (để trống)

### Bước 4: Thiết lập Biến Môi Trường (Environment Variables)
Tại mục **Environment variables**:
- Tên biến: `GEMINI_API_KEY`
- Giá trị: Khóa API Gemini của bạn (lấy tại [Google AI Studio](https://aistudio.google.com/app/apikey)).

*(Lưu ý: Nếu không thêm biến môi trường, người dùng vẫn có thể bấm nút **"Cần nhập API Key"** ngay trên giao diện web để nhập khóa API cá nhân, khóa được lưu an toàn trong trình duyệt localStorage).*

### Bước 5: Hoàn tất
Nhấn **Save and Deploy**. Cloudflare Pages sẽ tự động cài đặt dependency, biên dịch Vite và cung cấp tên miền miễn phí dạng `https://ten-du-an.pages.dev`.

---

## Cách 2: Deploy trực tiếp bằng Cloudflare Wrangler CLI

Nếu bạn muốn deploy trực tiếp từ máy tính mà không cần kết nối Git:

```bash
# 1. Cài đặt dependency & build ứng dụng
npm install
npm run build

# 2. Deploy lên Cloudflare Pages bằng Wrangler
npx wrangler pages deploy dist --project-name dich-phu-de-ai
```

Hoặc sử dụng câu lệnh được cấu hình sẵn trong `package.json`:
```bash
npm run deploy
```

---

## Các cải tiến đã được cấu hình sẵn cho Cloudflare:

1. **SPA Routing Fallback (`public/_redirects`)**: Chuyển hướng `/* -> /index.html 200` để đảm bảo khi F5 reload hoặc mở trực tiếp URL không bị lỗi 404.
2. **Tối ưu Cache & Security Header (`public/_headers`)**: Thiết lập `immutable cache` cho thư mục `/assets` và các header bảo mật (`nosniff`, `SAMEORIGIN`).
3. **Wrangler Config (`wrangler.toml`)**: Tích hợp cấu hình chuẩn cho Cloudflare Pages.
4. **Chuẩn hóa Tên Package (`package.json`)**: Đổi tên sang slug chuẩn URL (`dich-phu-de-ai`) không chứa dấu tiếng Việt tránh lỗi `EINVALIDPACKAGENAME` khi build trên Linux runner của Cloudflare.
5. **Giao diện Quản lý API Key đa tầng**:
   - Nhận tự động từ `process.env.GEMINI_API_KEY`, `VITE_GEMINI_API_KEY` (khi build trên Cloudflare).
   - Cho phép người dùng nhập trực tiếp trên giao diện web kèm nút **Kiểm tra API Key** và lưu trong `localStorage`.
