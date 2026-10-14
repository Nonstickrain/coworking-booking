// Backend REST API для приложения "Коворкинги"
const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 4000;
const TARIFF_URL = process.env.TARIFF_SERVICE_URL || 'http://tariff-service:5000';

const pool = new Pool({
  host: process.env.DB_HOST || 'db',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function badRequest(res, msg) { return res.status(400).json({ error: msg }); }
const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error(err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

async function tariff(path) {
  const r = await fetch(`${TARIFF_URL}${path}`);
  const body = await r.json();
  if (!r.ok) throw Object.assign(new Error(body.error || 'Ошибка тарифного сервиса'), { status: r.status });
  return body;
}

// ---------- Справочники ----------

app.get('/api/health', wrap(async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok' });
}));

app.get('/api/coworkings', wrap(async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT c.id, c.name, c.address,
           to_char(c.opens_at, 'HH24:MI') AS opens_at,
           to_char(c.closes_at, 'HH24:MI') AS closes_at,
           COUNT(w.id)::int AS workspaces
    FROM coworkings c LEFT JOIN workspaces w ON w.coworking_id = c.id
    GROUP BY c.id ORDER BY c.id`);
  res.json(rows);
}));

app.get('/api/equipment', wrap(async (_req, res) => {
  const { rows } = await pool.query('SELECT id, code, name FROM equipment ORDER BY id');
  res.json(rows);
}));

// ---------- Поиск свободных мест по оборудованию ----------
// GET /api/workspaces/free?date=YYYY-MM-DD&start=HH:MM&end=HH:MM&equipment=monitor,locker&coworking_id=1&type=fixed
app.get('/api/workspaces/free', wrap(async (req, res) => {
  const { date, start, end, coworking_id, type } = req.query;
  if (!DATE_RE.test(date || '')) return badRequest(res, 'Укажите дату в формате YYYY-MM-DD');
  if (!TIME_RE.test(start || '') || !TIME_RE.test(end || '')) return badRequest(res, 'Укажите время в формате HH:MM');
  if (end <= start) return badRequest(res, 'Время окончания должно быть позже начала');

  const equipment = (req.query.equipment || '').split(',').map((s) => s.trim()).filter(Boolean);

  const params = [date, start, end, equipment, equipment.length];
  let extra = '';
  if (coworking_id) { params.push(Number(coworking_id)); extra += ` AND w.coworking_id = $${params.length}`; }
  if (type)         { params.push(type);                 extra += ` AND w.type = $${params.length}`; }

  const { rows } = await pool.query(`
    SELECT w.id, w.name, w.type, w.seats, w.price_per_hour::float AS price_per_hour,
           c.id AS coworking_id, c.name AS coworking, c.address,
           COALESCE(json_agg(json_build_object('code', e.code, 'name', e.name) ORDER BY e.id)
                    FILTER (WHERE e.id IS NOT NULL), '[]') AS equipment
    FROM workspaces w
    JOIN coworkings c ON c.id = w.coworking_id
    LEFT JOIN workspace_equipment we ON we.workspace_id = w.id
    LEFT JOIN equipment e ON e.id = we.equipment_id
    WHERE c.opens_at <= $2::time AND c.closes_at >= $3::time
      AND NOT EXISTS (
        SELECT 1 FROM bookings b
        WHERE b.workspace_id = w.id AND b.booking_date = $1::date
          AND b.start_time < $3::time AND b.end_time > $2::time)
      ${extra}
    GROUP BY w.id, c.id
    HAVING COUNT(DISTINCT e.code) FILTER (WHERE e.code = ANY($4::text[])) = $5
    ORDER BY c.id, w.price_per_hour, w.name`, params);

  res.json(rows);
}));

// ---------- Бронирования (CRUD) ----------

app.get('/api/bookings', wrap(async (req, res) => {
  const params = [];
  let where = '';
  if (req.query.date) {
    if (!DATE_RE.test(req.query.date)) return badRequest(res, 'Неверный формат даты');
    params.push(req.query.date);
    where = 'WHERE b.booking_date = $1';
  }
  const { rows } = await pool.query(`
    SELECT b.id, b.client_name, b.client_phone,
           to_char(b.booking_date, 'YYYY-MM-DD') AS date,
           to_char(b.start_time, 'HH24:MI') AS start,
           to_char(b.end_time, 'HH24:MI') AS "end",
           b.total_price::float AS total_price,
           w.id AS workspace_id, w.name AS workspace, w.type, c.name AS coworking
    FROM bookings b
    JOIN workspaces w ON w.id = b.workspace_id
    JOIN coworkings c ON c.id = w.coworking_id
    ${where}
    ORDER BY b.booking_date, b.start_time, c.name, w.name`, params);
  res.json(rows);
}));

app.post('/api/bookings', wrap(async (req, res) => {
  const { workspace_id, client_name, client_phone, date, start, end } = req.body || {};
  if (!workspace_id) return badRequest(res, 'Не выбрано рабочее место');
  if (!client_name || !String(client_name).trim()) return badRequest(res, 'Укажите имя клиента');
  if (!DATE_RE.test(date || '')) return badRequest(res, 'Укажите дату в формате YYYY-MM-DD');
  if (!TIME_RE.test(start || '') || !TIME_RE.test(end || '')) return badRequest(res, 'Укажите время в формате HH:MM');
  if (end <= start) return badRequest(res, 'Время окончания должно быть позже начала');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Блокируем строку места, чтобы два одновременных запроса не забронировали одно и то же время
    const ws = await client.query(`
      SELECT w.id, w.price_per_hour::float AS pph, c.opens_at, c.closes_at
      FROM workspaces w JOIN coworkings c ON c.id = w.coworking_id
      WHERE w.id = $1 FOR UPDATE OF w`, [workspace_id]);
    if (!ws.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Место не найдено' }); }

    const { pph } = ws.rows[0];
    const hoursOk = await client.query(
      'SELECT $1::time >= $3::time AND $2::time <= $4::time AS ok',
      [start, end, ws.rows[0].opens_at, ws.rows[0].closes_at]);
    if (!hoursOk.rows[0].ok) { await client.query('ROLLBACK'); return badRequest(res, 'Время вне часов работы коворкинга'); }

    const conflict = await client.query(`
      SELECT 1 FROM bookings
      WHERE workspace_id = $1 AND booking_date = $2 AND start_time < $4 AND end_time > $3`,
      [workspace_id, date, start, end]);
    if (conflict.rows.length) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Место уже занято на это время' }); }

    let total = null;
    try {
      const q = new URLSearchParams({ price_per_hour: pph, date, start, end });
      total = (await tariff(`/calculate?${q}`)).total;
    } catch (e) {
      console.warn('Тарифный сервис недоступен, цена по базовому тарифу:', e.message);
      total = Math.round(pph * ((toMin(end) - toMin(start)) / 60) * 100) / 100;
    }

    const { rows } = await client.query(`
      INSERT INTO bookings (workspace_id, client_name, client_phone, booking_date, start_time, end_time, total_price)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, total_price::float AS total_price`,
      [workspace_id, String(client_name).trim(), client_phone || null, date, start, end, total]);
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}));

app.delete('/api/bookings/:id', wrap(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM bookings WHERE id = $1', [Number(req.params.id)]);
  if (!rowCount) return res.status(404).json({ error: 'Бронирование не найдено' });
  res.status(204).end();
}));

function toMin(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }

// ---------- Интеграция с Web-сервисом тарифов ----------

app.get('/api/promos', wrap(async (_req, res) => {
  try { res.json(await tariff('/promos')); }
  catch (e) { res.status(502).json({ error: 'Тарифный сервис недоступен' }); }
}));

// GET /api/quote?workspace_id=3&date=...&start=...&end=...
app.get('/api/quote', wrap(async (req, res) => {
  const { workspace_id, date, start, end } = req.query;
  const { rows } = await pool.query('SELECT price_per_hour::float AS pph FROM workspaces WHERE id = $1', [Number(workspace_id)]);
  if (!rows.length) return res.status(404).json({ error: 'Место не найдено' });
  try {
    const q = new URLSearchParams({ price_per_hour: rows[0].pph, date: date || '', start, end });
    res.json(await tariff(`/calculate?${q}`));
  } catch (e) {
    res.status(e.status === 400 ? 400 : 502).json({ error: e.message });
  }
}));

app.listen(PORT, () => console.log(`Backend listening on :${PORT}`));
