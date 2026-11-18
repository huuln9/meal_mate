DELETE FROM recipe_items;
UPDATE OR IGNORE foods SET kind = 'dish' WHERE kind = 'ingredient';
UPDATE foods SET unit = COALESCE(unit, (SELECT i.unit FROM foods i WHERE i.kind = 'ingredient' AND i.name = foods.name COLLATE NOCASE)), price = COALESCE(price, (SELECT i.price FROM foods i WHERE i.kind = 'ingredient' AND i.name = foods.name COLLATE NOCASE)) WHERE kind = 'dish' AND name COLLATE NOCASE IN (SELECT name FROM foods WHERE kind = 'ingredient');
UPDATE plan SET food_id = (SELECT d.id FROM foods d JOIN foods i ON d.name = i.name COLLATE NOCASE WHERE d.kind = 'dish' AND i.id = plan.food_id) WHERE food_id IN (SELECT id FROM foods WHERE kind = 'ingredient');
UPDATE shopping SET food_id = (SELECT d.id FROM foods d JOIN foods i ON d.name = i.name COLLATE NOCASE WHERE d.kind = 'dish' AND i.id = shopping.food_id) WHERE food_id IN (SELECT id FROM foods WHERE kind = 'ingredient');
DELETE FROM foods WHERE kind = 'ingredient';
