// Клиентская логика: поиск мест, бронирование, список бронирований, акции
const $ = (s) => document.querySelector(s);

const TYPES = { open: 'Открытое пространство', fixed: 'Фиксированное место', cabinet: 'Кабинет', meeting: 'Переговорная' };
const rub = (n) => Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, opts = {}) {
  const r = await fetch('/api' + path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (r.status === 204) return null;
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `Ошибка ${r.status}`);
  return body;
}

function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.className = 'toast'), 3000);
}

function setResult(title, meta, html) {
  $('#result-title').textContent = title;
  $('#result-meta').textContent = meta || '';
  $('#result').innerHTML = html;
}

function selectedEquipment() {
  return [...document.querySelectorAll('#equipment input:checked')].map((i) => i.value);
}

// ---------- Инициализация ----------
async function init() {
  $('#f-date').value = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD в локальной зоне

  try {
    const [coworkings, equipment] = await Promise.all([api('/coworkings'), api('/equipment')]);
    $('#f-coworking').insertAdjacentHTML('beforeend',
      coworkings.map((c) => `<option value="${c.id}">${esc(c.name)} (${c.opens_at}–${c.closes_at})</option>`).join(''));
    $('#equipment').innerHTML = equipment.map((e) =>
      `<label class="chip"><input type="checkbox" value="${esc(e.code)}">${esc(e.name)}</label>`).join('');
    $('#equipment').addEventListener('change', (ev) => ev.target.closest('.chip').classList.toggle('on', ev.target.checked));
  } catch (e) {
    toast('Не удалось загрузить справочники: ' + e.message, true);
  }
}

// ---------- Кнопка 1: поиск свободных мест (БД) ----------
let lastSearch = null;

async function search() {
  const params = {
    date: $('#f-date').value,
    start: $('#f-start').value,
    end: $('#f-end').value,
    equipment: selectedEquipment().join(','),
    coworking_id: $('#f-coworking').value,
    type: $('#f-type').value,
  };
  if (!params.date || !params.start || !params.end) return toast('Заполните дату и время', true);
  lastSearch = params;
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v));

  const btn = $('#btn-search');
  btn.disabled = true;
  try {
    const rows = await api('/workspaces/free?' + q);
    const want = new Set(selectedEquipment());
    const meta = `${params.date}, ${params.start}–${params.end} · найдено: ${rows.length}`;
    if (!rows.length) return setResult('Свободные места', meta, '<p class="muted">Нет свободных мест с таким оборудованием на это время. Попробуйте изменить фильтры.</p>');
    setResult('Свободные места', meta, `<div class="cards">${rows.map((w) => `
      <div class="card">
        <div class="row"><span class="name">${esc(w.name)}</span><span class="price">${rub(w.price_per_hour)}/ч</span></div>
        <div><b>${esc(w.coworking)}</b><br><span class="muted">${esc(w.address)}</span></div>
        <div class="muted">${TYPES[w.type] || w.type} · мест: ${w.seats}</div>
        <div>${w.equipment.map((e) => `<span class="tag ${want.has(e.code) ? 'hit' : ''}">${esc(e.name)}</span>`).join('') || '<span class="muted">Без оборудования</span>'}</div>
        <button class="btn primary" data-book='${esc(JSON.stringify({ id: w.id, name: w.name, coworking: w.coworking }))}'>Забронировать</button>
      </div>`).join('')}</div>`);
  } catch (e) {
    toast(e.message, true);
  } finally {
    btn.disabled = false;
  }
}

// ---------- Бронирование ----------
let booking = null;

async function openBooking(ws) {
  booking = { ...ws, ...lastSearch };
  $('#book-title').textContent = `Бронирование места ${ws.name}`;
  $('#book-sub').textContent = `${ws.coworking} · ${booking.date}, ${booking.start}–${booking.end}`;
  $('#b-name').value = '';
  $('#b-phone').value = '';
  $('#quote').innerHTML = 'Рассчитываем стоимость…';
  $('#book-dialog').showModal();

  try {
    const q = new URLSearchParams({ workspace_id: ws.id, date: booking.date, start: booking.start, end: booking.end });
    const p = await api('/quote?' + q);
    $('#quote').innerHTML = `
      <div>Базовая цена: ${rub(p.base_price)} (${p.hours} ч × ${rub(p.price_per_hour)})</div>
      ${p.discounts.length ? `<ul>${p.discounts.map((d) => `<li>${esc(d.title)}: ${rub(d.amount)}</li>`).join('')}</ul>` : ''}
      <div style="margin-top:6px">Итого: <span class="total">${rub(p.total)}</span></div>
      <div class="muted" style="font-size:12px">Расчёт от тарифного сервиса</div>`;
  } catch (e) {
    $('#quote').innerHTML = `<span class="muted">Тарифный сервис недоступен: ${esc(e.message)}</span>`;
  }
}

async function submitBooking(ev) {
  ev.preventDefault();
  const btn = $('#b-submit');
  btn.disabled = true;
  try {
    const res = await api('/bookings', {
      method: 'POST',
      body: JSON.stringify({
        workspace_id: booking.id,
        client_name: $('#b-name').value,
        client_phone: $('#b-phone').value,
        date: booking.date, start: booking.start, end: booking.end,
      }),
    });
    $('#book-dialog').close();
    toast(`Бронь №${res.id} оформлена на ${rub(res.total_price)}`);
    search();
  } catch (e) {
    toast(e.message, true);
  } finally {
    btn.disabled = false;
  }
}

// ---------- Кнопка 2: все бронирования (БД) ----------
async function showBookings() {
  try {
    const rows = await api('/bookings');
    if (!rows.length) return setResult('Бронирования', '', '<p class="muted">Бронирований пока нет.</p>');
    const sum = rows.reduce((s, b) => s + (b.total_price || 0), 0);
    setResult('Бронирования', `всего: ${rows.length} · на сумму ${rub(sum)}`, `
      <div class="table-wrap"><table>
        <thead><tr><th>№</th><th>Дата</th><th>Время</th><th>Коворкинг</th><th>Место</th><th>Клиент</th><th>Сумма</th><th></th></tr></thead>
        <tbody>${rows.map((b) => `
          <tr>
            <td>${b.id}</td><td>${b.date}</td><td>${b.start}–${b.end}</td>
            <td>${esc(b.coworking)}</td><td>${esc(b.workspace)} <span class="muted">· ${TYPES[b.type] || ''}</span></td>
            <td>${esc(b.client_name)}<br><span class="muted">${esc(b.client_phone || '')}</span></td>
            <td>${b.total_price != null ? rub(b.total_price) : '—'}</td>
            <td><button class="btn small danger" data-cancel="${b.id}">Отменить</button></td>
          </tr>`).join('')}
        </tbody>
      </table></div>`);
  } catch (e) {
    toast(e.message, true);
  }
}

async function cancelBooking(id) {
  if (!confirm(`Отменить бронирование №${id}?`)) return;
  try {
    await api('/bookings/' + id, { method: 'DELETE' });
    toast(`Бронирование №${id} отменено`);
    showBookings();
  } catch (e) {
    toast(e.message, true);
  }
}

// ---------- Кнопка 3: акции (Web-сервис тарифов) ----------
async function showPromos() {
  try {
    const rows = await api('/promos');
    setResult('Акции и тарифы', 'данные от тарифного web-сервиса', `<div class="cards">${rows.map((p) => `
      <div class="card promo"><div class="name">${esc(p.title)}</div><div class="muted">${esc(p.condition)}</div><span class="tag">${esc(p.code)}</span></div>`).join('')}</div>`);
  } catch (e) {
    toast(e.message, true);
  }
}

// ---------- События ----------
$('#btn-search').addEventListener('click', search);
$('#btn-bookings').addEventListener('click', showBookings);
$('#btn-promos').addEventListener('click', showPromos);
$('#search-form').addEventListener('submit', (e) => { e.preventDefault(); search(); });
$('#book-form').addEventListener('submit', submitBooking);
$('#b-cancel').addEventListener('click', () => $('#book-dialog').close());
$('#result').addEventListener('click', (e) => {
  const b = e.target.closest('[data-book]');
  if (b) return openBooking(JSON.parse(b.dataset.book));
  const c = e.target.closest('[data-cancel]');
  if (c) cancelBooking(c.dataset.cancel);
});

init();
