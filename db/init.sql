-- Схема и первичные данные для приложения "Коворкинги"
-- Выполняется автоматически при первом старте контейнера PostgreSQL

CREATE TABLE coworkings (
    id       SERIAL PRIMARY KEY,
    name     VARCHAR(100) NOT NULL,
    address  VARCHAR(200) NOT NULL,
    opens_at TIME NOT NULL DEFAULT '08:00',
    closes_at TIME NOT NULL DEFAULT '22:00'
);

CREATE TABLE equipment (
    id   SERIAL PRIMARY KEY,
    code VARCHAR(30)  NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL
);

CREATE TABLE workspaces (
    id             SERIAL PRIMARY KEY,
    coworking_id   INT NOT NULL REFERENCES coworkings(id) ON DELETE CASCADE,
    name           VARCHAR(50) NOT NULL,
    type           VARCHAR(20) NOT NULL CHECK (type IN ('open', 'fixed', 'cabinet', 'meeting')),
    seats          INT NOT NULL DEFAULT 1,
    price_per_hour NUMERIC(8,2) NOT NULL
);

CREATE TABLE workspace_equipment (
    workspace_id INT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    equipment_id INT NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
    PRIMARY KEY (workspace_id, equipment_id)
);

CREATE TABLE bookings (
    id           SERIAL PRIMARY KEY,
    workspace_id INT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    client_name  VARCHAR(100) NOT NULL,
    client_phone VARCHAR(30),
    booking_date DATE NOT NULL,
    start_time   TIME NOT NULL,
    end_time     TIME NOT NULL,
    total_price  NUMERIC(10,2),
    created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
    CHECK (end_time > start_time)
);

CREATE INDEX idx_bookings_ws_date ON bookings(workspace_id, booking_date);

-- ---------- Первичные данные ----------

INSERT INTO coworkings (name, address, opens_at, closes_at) VALUES
('Точка Роста', 'ул. Ленина, 15',          '08:00', '22:00'),
('Hub 24',      'пр. Мира, 101, 3 этаж',   '00:00', '23:59'),
('Тихий Офис',  'ул. Садовая, 7',          '09:00', '21:00');

INSERT INTO equipment (code, name) VALUES
('monitor',    'Внешний монитор'),
('dual',       'Два монитора'),
('pc',         'Стационарный ПК'),
('printer',    'Принтер / сканер'),
('projector',  'Проектор'),
('whiteboard', 'Маркерная доска'),
('phone',      'Телефонная будка рядом'),
('locker',     'Личный шкафчик'),
('ergochair',  'Эргономичное кресло'),
('standdesk',  'Стол с регулировкой высоты');

INSERT INTO workspaces (coworking_id, name, type, seats, price_per_hour) VALUES
-- Точка Роста
(1, 'A-01', 'open',    1, 250),
(1, 'A-02', 'open',    1, 250),
(1, 'A-03', 'fixed',   1, 350),
(1, 'B-01', 'fixed',   1, 400),
(1, 'K-1',  'cabinet', 4, 1200),
(1, 'M-1',  'meeting', 8, 1500),
-- Hub 24
(2, 'H-10', 'open',    1, 300),
(2, 'H-11', 'fixed',   1, 450),
(2, 'H-12', 'fixed',   1, 450),
(2, 'H-20', 'cabinet', 2, 900),
(2, 'H-M',  'meeting', 12, 2000),
-- Тихий Офис
(3, 'T-1',  'open',    1, 200),
(3, 'T-2',  'fixed',   1, 320),
(3, 'T-3',  'fixed',   1, 380),
(3, 'T-K',  'cabinet', 3, 1000);

-- Оборудование мест (workspace_id, equipment_id)
INSERT INTO workspace_equipment VALUES
(1, 9),
(2, 1), (2, 9),
(3, 1), (3, 8), (3, 9),
(4, 2), (4, 8), (4, 9), (4, 10),
(5, 1), (5, 4), (5, 6), (5, 8),
(6, 5), (6, 6), (6, 7),
(7, 1), (7, 7),
(8, 2), (8, 3), (8, 9), (8, 10),
(9, 1), (9, 3), (9, 8),
(10, 2), (10, 4), (10, 8), (10, 9),
(11, 5), (11, 6), (11, 7), (11, 4),
(12, 9),
(13, 1), (13, 8), (13, 10),
(14, 2), (14, 9), (14, 10),
(15, 1), (15, 4), (15, 6), (15, 8);

-- Несколько бронирований "на сегодня" и "на завтра" для демонстрации поиска
INSERT INTO bookings (workspace_id, client_name, client_phone, booking_date, start_time, end_time, total_price) VALUES
(3,  'Иванов И.И.',   '+7 900 111-22-33', CURRENT_DATE,     '09:00', '13:00', 1400),
(4,  'Петрова А.С.',  '+7 900 222-33-44', CURRENT_DATE,     '10:00', '18:00', 3200),
(8,  'Сидоров П.П.',  '+7 900 333-44-55', CURRENT_DATE,     '12:00', '16:00', 1800),
(6,  'ООО «Вектор»',  '+7 900 444-55-66', CURRENT_DATE + 1, '11:00', '13:00', 3000),
(14, 'Кузнецова Е.В.','+7 900 555-66-77', CURRENT_DATE + 1, '09:00', '21:00', 4560);
