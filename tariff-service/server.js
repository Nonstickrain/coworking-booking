// Web-сервис "Тарифы" — отдельный микросервис-эмулятор.
// Рассчитывает итоговую стоимость бронирования с учётом скидок
// и отдаёт актуальные промо-предложения. Без внешних зависимостей.
const http = require('http');

const PORT = process.env.PORT || 5000;

const PROMOS = [
  { code: 'LONG4',   title: 'От 4 часов — скидка 10%',               condition: 'Бронирование от 4 часов' },
  { code: 'FULLDAY', title: 'От 8 часов — скидка 20%',               condition: 'Бронирование от 8 часов' },
  { code: 'WEEKEND', title: 'Выходные — скидка 15%',                 condition: 'Суббота и воскресенье' },
  { code: 'EVENING', title: 'Вечер после 18:00 — скидка 25%',        condition: 'Часы с 18:00 до 22:00' },
  { code: 'MORNING', title: 'Ранняя пташка до 10:00 — скидка 10%',   condition: 'Часы с 08:00 до 10:00' },
];

function toMinutes(t) {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + (m || 0);
}

// Расчёт стоимости: каждый час тарифицируется отдельно (вечер/утро),
// затем на сумму применяется лучшая скидка за длительность и выходные.
function calculate({ price_per_hour, date, start, end }) {
  const pph = Number(price_per_hour);
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (!pph || isNaN(s) || isNaN(e) || e <= s) {
    throw new Error('Некорректные параметры: нужны price_per_hour, start, end (end > start)');
  }

  const hours = (e - s) / 60;
  const lines = [];
  let base = 0;
  let timeDiscount = 0;

  for (let m = s; m < e; m += 30) {
    const chunk = Math.min(30, e - m) / 60;
    const cost = pph * chunk;
    base += cost;
    if (m >= 18 * 60 && m < 22 * 60) timeDiscount += cost * 0.25;
    else if (m >= 8 * 60 && m < 10 * 60) timeDiscount += cost * 0.10;
  }
  if (timeDiscount > 0) lines.push({ code: 'TIME', title: 'Скидка за утренние/вечерние часы', amount: -round(timeDiscount) });

  let subtotal = base - timeDiscount;

  let durationPct = 0;
  if (hours >= 8) durationPct = 0.20;
  else if (hours >= 4) durationPct = 0.10;
  if (durationPct) {
    const d = subtotal * durationPct;
    lines.push({ code: hours >= 8 ? 'FULLDAY' : 'LONG4', title: `Скидка за длительность ${durationPct * 100}%`, amount: -round(d) });
    subtotal -= d;
  }

  if (date) {
    const day = new Date(date + 'T00:00:00').getDay();
    if (day === 0 || day === 6) {
      const d = subtotal * 0.15;
      lines.push({ code: 'WEEKEND', title: 'Скидка выходного дня 15%', amount: -round(d) });
      subtotal -= d;
    }
  }

  return {
    hours,
    price_per_hour: pph,
    base_price: round(base),
    discounts: lines,
    total: round(subtotal),
    currency: 'RUB',
    calculated_at: new Date().toISOString(),
  };
}

function round(x) { return Math.round(x * 100) / 100; }

function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/health') return send(res, 200, { status: 'ok' });
    if (url.pathname === '/promos') return send(res, 200, PROMOS);
    if (url.pathname === '/calculate') {
      const q = Object.fromEntries(url.searchParams);
      return send(res, 200, calculate(q));
    }
    send(res, 404, { error: 'Not found' });
  } catch (err) {
    send(res, 400, { error: err.message });
  }
});

server.listen(PORT, () => console.log(`Tariff service listening on :${PORT}`));
