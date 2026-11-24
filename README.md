# 🍽️ Meal Mate – Mini App thực đơn & đi chợ trên Telegram

Cloudflare Workers (API + bot) + D1 (database) + giao diện tĩnh trong `public/`.
Cùng kiến trúc với `bida_pool`, chạy chung tài khoản Cloudflare free được.

## Chức năng

- **Kho**: các loại món ngang hàng, mặc định **Đồ ăn / Rau củ / Trái cây / Đồ uống / Đồ ngọt / Nguyên liệu**.
  Nút **Loại** để thêm, đổi tên, đổi màu, sắp xếp, xoá loại (loại còn món thì phải chuyển món đi trước).
  Món nào cũng có thể **gồm các món khác** (thành phần, ngang hàng; gõ tên mới khi thêm thành phần sẽ tự tạo thành Nguyên liệu),
  VD Phở bò (1 tô) gồm 0,2 kg Bánh phở + 0,1 kg Thịt bò. Thành phần lồng nhiều tầng được, chặn vòng lặp.
  Mỗi món: ảnh (tự cắt vuông, nén nhỏ; chưa có ảnh thì hiện chữ cái đầu), tên, đơn vị, giá, nhóm, nơi mua, ghi chú.
  Tìm kiếm gõ không dấu cũng được.
- **Thực đơn tuần**: 6 bữa/ngày (Sáng / Phụ sáng / Trưa / Phụ chiều / Tối / Phụ tối). Bấm `+` để thêm món,
  có 🎲 gợi ý món chưa ăn mấy ngày gần đây. Bấm vào món để đổi số lượng, chuyển bữa / ngày, thêm ghi chú. Chép thực đơn tuần trước, xoá cả tuần.
- **Đi chợ**: tự cộng số lượng từ thực đơn trong khoảng ngày, nhóm theo Nhóm của món, có giá ước tính.
  Món có thành phần thì mua các thành phần (ghi "cho <món>"), món không có thành phần thì mua chính nó.
  Tick đã mua, nhập tiền thực trả (nghìn đồng) → giá tham khảo tự cập nhật. Thêm tay, gửi danh sách vào Telegram.
  Tạo lại danh sách sẽ trừ phần đã mua, không bị trùng.
- **Chi tiêu**: tổng chi theo tháng, theo nhóm, món tốn nhiều nhất. Sao lưu (bot gửi file JSON) và khôi phục.
- **Bot**: `/homnay`, `/mai`, `/dicho`. Mỗi tối 20:00 nhắn thực đơn ngày mai + số món chưa mua.
- **App riêng**: chỉ ID trong `OWNER_IDS` mới mở được.

## Cấu trúc

```
public/          Giao diện Mini App (HTML/CSS/JS thuần)
src/index.ts     API + bot webhook + nhắc lịch (cron)
src/planner.ts   Cộng danh sách đi chợ từ thực đơn, ngày tháng, định dạng tiền
src/telegram.ts  Xác thực initData của Telegram
schema.sql       Tạo bảng
seed.sql         Dữ liệu mẫu, chỉ dùng khi chạy thử trên máy
test/            Test logic (npm test)
wrangler.toml    Cấu hình Worker
```

## Deploy (khoảng 15 phút)

### 1. Tạo bot Telegram
Chat với **@BotFather**, gõ `/newbot`, đặt tên (VD `Meal Mate`, username `MealMate_xxx_bot`). Lưu lại **token**.

### 2. Đẩy code lên GitHub
Repo `meal_mate` (Private cũng được): `git add . && git commit -m "Meal Mate" && git push`.

### 3. Tạo database D1
1. **dash.cloudflare.com → Storage & Databases → D1 → Create**, đặt tên `meal-mate`.
2. Tab **Console**: dán toàn bộ `schema.sql` → Execute (lỗi khi chạy nhiều lệnh thì chạy từng lệnh). **Không** cần `seed.sql`.
3. Copy **Database ID**, thay vào `database_id` trong `wrangler.toml`, commit + push.

### 4. Tạo Worker từ GitHub
**Workers & Pages → Create → Import a repository** → chọn repo `meal_mate`.
Project name: `meal-mate`. Build command để trống, Deploy command giữ `npx wrangler deploy`. Bấm Deploy.
Có link dạng `https://meal-mate.<tên-bạn>.workers.dev`.

### 5. Khai báo biến bí mật
Worker **meal-mate → Settings → Variables and Secrets → Add**:

| Tên | Loại | Giá trị |
|---|---|---|
| `BOT_TOKEN` | Secret | token từ BotFather |
| `WEBHOOK_SECRET` | Secret | chuỗi tự đặt, chỉ chữ và số, VD `mealMate2026abc` |
| `OWNER_IDS` | Text | ID Telegram của bạn (giống `ADMIN_IDS` bên bida). Nhiều người: cách nhau dấu phẩy |

> Chưa biết ID? Cứ để trống, làm bước 6 rồi nhắn bot bất kỳ — bot sẽ trả lời ID của bạn.

### 6. Kết nối bot với app
Mở trên trình duyệt:

```
https://meal-mate.<tên-bạn>.workers.dev/bot/setup?key=<WEBHOOK_SECRET>
```

Thấy 3 dòng `"ok": true` là xong. Vào chat với bot, bấm nút **Meal Mate** cạnh ô chat để mở app.

## Cập nhật database (migrations)
Khi code đổi cấu trúc bảng, chạy file trong `migrations/` **một lần** trên D1 Console (dán từng dòng nếu báo lỗi):

| File | Nội dung |
|---|---|
| `001_nam_bua.sql` | Chia ngày thành 6 bữa (thêm Phụ sáng, Phụ tối; bữa "Phụ" cũ thành Phụ chiều) |
| `002_anh_mon.sql` | Bảng `food_images` lưu ảnh món |
| `003_don_gian.sql` | Bỏ công thức; Món ăn + Nguyên liệu cũ thành Đồ ăn (trùng tên thì gộp) |
| `004_don_db.sql` | Xoá bảng `recipe_items`, cột `emoji`, `servings` của `foods` (chạy sau 003) |
| `005_rau_cu_ghi_chu.sql` | Thêm loại Rau củ (bỏ CHECK của `foods.kind`), thêm ghi chú cho từng bữa — dựng lại bảng, giữ dữ liệu |
| `006_thanh_phan.sql` | Bảng `food_parts`: món gồm các món khác |
| `007_thu_tu_thanh_phan.sql` | Thêm cột `pos` để sắp xếp thứ tự thành phần (chạy sau 006) |
| `008_loai.sql` | Bảng `kinds`: tự quản lý loại món (tạo sẵn 6 loại mặc định) |

DB mới tạo từ `schema.sql` đã có sẵn, không cần chạy migration.

## Ghi chú
- Nhắc 20:00 cấu hình ở `[triggers]` trong `wrangler.toml` (giờ UTC). Xoá khối đó nếu không muốn nhắc.
- File sao lưu không chứa ảnh món; khôi phục từ file thì phải chọn lại ảnh.
- Hạn mức free Cloudflare (100k request/ngày, D1 5 GB) dùng chung với bida_pool vẫn dư rất nhiều.

## Chạy thử trên máy (cần Node.js 22.6+)

```
npm install
npm test
printf 'DEV_MODE=1\n' > .dev.vars   # chỉ dùng local: bỏ qua đăng nhập
npm run db:local
npm run dev                          # mở http://localhost:8787
```
