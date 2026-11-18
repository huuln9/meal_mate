-- Dữ liệu mẫu, CHỈ dùng khi chạy thử trên máy (npm run db:local). Không cần chạy trên Cloudflare.
INSERT INTO foods (id, name, kind, emoji, category, unit, price, servings) VALUES
  (1, 'Thịt ba chỉ', 'ingredient', '🥓', 'Thịt', 'kg', 140000, 1),
  (2, 'Trứng vịt', 'ingredient', '🥚', 'Trứng & sữa', 'quả', 4000, 1),
  (3, 'Rau muống', 'ingredient', '🥬', 'Rau củ', 'bó', 10000, 1),
  (4, 'Tỏi', 'ingredient', '🧄', 'Gia vị', 'củ', 3000, 1),
  (5, 'Nước dừa', 'ingredient', '🥥', 'Đồ uống', 'quả', 15000, 1),
  (6, 'Bí đao', 'ingredient', '🥒', 'Rau củ', 'kg', 20000, 1),
  (7, 'Tôm khô', 'ingredient', '🦐', 'Đồ khô', 'lạng', 60000, 1),
  (10, 'Thịt kho trứng', 'dish', '🍖', 'Món mặn', NULL, NULL, 4),
  (11, 'Rau muống xào tỏi', 'dish', '🥬', 'Xào', NULL, NULL, 2),
  (12, 'Canh bí tôm khô', 'dish', '🍲', 'Canh', NULL, NULL, 4),
  (20, 'Cam', 'fruit', '🍊', 'Trái cây', 'kg', 40000, 1),
  (21, 'Trà đá', 'drink', '🧊', 'Đồ uống', NULL, NULL, 1);

INSERT INTO recipe_items (dish_id, ingredient_id, qty) VALUES
  (10, 1, 0.5), (10, 2, 6), (10, 5, 1),
  (11, 3, 1), (11, 4, 1),
  (12, 6, 0.5), (12, 7, 0.5);
