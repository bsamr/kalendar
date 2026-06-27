'use strict';

// ---------- Состояние ----------
const STORAGE_KEY = 'kalendar.state.v1';
const SETTINGS_KEY = 'kalendar.settings.v1';
const VIEW_KEY = 'kalendar.view.v1';

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
                'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
                    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const GIST_FILENAME = 'kalendar.json';

let state = loadLocal() || { tasks: [], updatedAt: 0 };
let settings = loadSettings() || { token: '', gistId: '' };
let viewMode = localStorage.getItem(VIEW_KEY) === 'week' ? 'week' : 'month';
let viewDate = viewMode === 'week' ? startOfWeek(new Date()) : startOfMonth(new Date());
let openDate = null;
let remoteUpdatedAt = 0;
let pushTimer = null;
let isPushing = false;

// ---------- Утилиты ----------
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function startOfWeek(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const offset = (x.getDay() + 6) % 7; // Mon=0
  x.setDate(x.getDate() - offset);
  return x;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function sameDate(a, b) { return isoDate(a) === isoDate(b); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

function loadLocal() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; }
}
function saveLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)); } catch { return null; }
}
function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function touch() {
  state.updatedAt = Date.now();
  saveLocal();
  schedulePush();
}

// ---------- Toast ----------
let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2400);
}

function setSyncStatus(text, cls) {
  const el = document.getElementById('syncStatus');
  el.textContent = text;
  el.className = 'status' + (cls ? ' ' + cls : '');
}

// ---------- Рендер месяца ----------
function renderWeekdays() {
  const wd = document.getElementById('weekdays');
  wd.innerHTML = '';
  WEEKDAYS.forEach((d, i) => {
    const div = document.createElement('div');
    div.textContent = d;
    if (i >= 5) div.classList.add('weekend');
    wd.appendChild(div);
  });
}

function placeToggle() {
  const toggle = document.querySelector('.viewtoggle');
  const nav = document.querySelector('.nav');
  const topbar = document.querySelector('.topbar');
  const weekHeader = document.getElementById('weekHeader');
  const actions = document.querySelector('.actions');
  if (!toggle || !nav || !topbar || !weekHeader || !actions) return;
  if (viewMode === 'week') {
    if (nav.parentElement !== weekHeader) weekHeader.appendChild(nav);
    if (toggle.parentElement !== weekHeader) weekHeader.appendChild(toggle);
    weekHeader.hidden = false;
  } else {
    if (nav.parentElement !== topbar) topbar.insertBefore(nav, topbar.firstChild);
    if (toggle.parentElement !== actions) actions.insertBefore(toggle, actions.firstChild);
    weekHeader.hidden = true;
  }
}

function renderMonth() {
  placeToggle();
  if (viewMode === 'week') return renderWeek();
  const title = document.getElementById('monthTitle');
  title.textContent = `${MONTHS[viewDate.getMonth()]} ${viewDate.getFullYear()}`;

  document.getElementById('weekdays').className = 'weekdays';
  const grid = document.getElementById('grid');
  grid.className = 'grid';
  grid.innerHTML = '';

  const firstDay = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  const offset = (firstDay.getDay() + 6) % 7;
  const start = new Date(firstDay);
  start.setDate(1 - offset);

  const today = new Date();
  const currentMonth = viewDate.getMonth();

  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    grid.appendChild(renderCell(d, currentMonth, today));
  }
}

function renderWeek() {
  const title = document.getElementById('monthTitle');
  const end = addDays(viewDate, 6);
  const sameMonth = viewDate.getMonth() === end.getMonth();
  const sameYear = viewDate.getFullYear() === end.getFullYear();
  const startStr = sameMonth
    ? `${viewDate.getDate()}`
    : `${viewDate.getDate()} ${MONTHS_GEN[viewDate.getMonth()]}${sameYear ? '' : ' ' + viewDate.getFullYear()}`;
  const endStr = `${end.getDate()} ${MONTHS_GEN[end.getMonth()]} ${end.getFullYear()}`;
  title.textContent = `${startStr} – ${endStr}`;

  document.getElementById('weekdays').className = 'weekdays week';
  const grid = document.getElementById('grid');
  grid.className = 'grid week';
  grid.innerHTML = '';

  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const d = addDays(viewDate, i);
    // В недельном виде все ячейки относятся к текущему диапазону — не приглушаем
    grid.appendChild(renderCell(d, d.getMonth(), today, { weekMode: true }));
  }
}

function renderCell(date, currentMonth, today, opts = {}) {
  const cell = document.createElement('div');
  cell.className = 'cell';
  const iso = isoDate(date);
  cell.dataset.date = iso;
  if (!opts.weekMode && date.getMonth() !== currentMonth) cell.classList.add('other-month');
  if (date.getDay() === 0 || date.getDay() === 6) cell.classList.add('weekend');
  if (sameDate(date, today)) cell.classList.add('today');

  const num = document.createElement('div');
  num.className = 'daynum';
  num.textContent = opts.weekMode
    ? `${WEEKDAYS[(date.getDay() + 6) % 7]} ${date.getDate()}`
    : date.getDate();
  cell.appendChild(num);

  const dayTasks = state.tasks
    .filter(t => t.date === iso)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const maxPreview = opts.weekMode ? 20 : 3;
  dayTasks.slice(0, maxPreview).forEach(task => {
    const p = document.createElement('div');
    p.className = 'preview' + (task.done ? ' done' : '');
    p.draggable = true;
    p.dataset.taskId = task.id;
    const mark = document.createElement('span');
    mark.className = 'mark';
    mark.textContent = task.done ? '✓' : '•';
    const txt = document.createElement('span');
    txt.textContent = task.text;
    p.append(mark, txt);
    attachDragSource(p, task.id);
    cell.appendChild(p);
  });

  if (dayTasks.length > maxPreview) {
    const more = document.createElement('div');
    more.className = 'more';
    more.textContent = `+ ещё ${dayTasks.length - maxPreview}`;
    cell.appendChild(more);
  }

  cell.addEventListener('click', (e) => {
    // Игнорируем клики, начатые на превьюшке (это начало drag)
    if (e.target.closest('.preview')) return;
    openDay(iso);
  });

  attachDropTarget(cell, iso);
  return cell;
}

// ---------- Панель дня ----------
function openDay(iso) {
  openDate = iso;
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const weekday = WEEKDAYS[(date.getDay() + 6) % 7];
  document.getElementById('dayTitle').textContent =
    `${d} ${MONTHS_GEN[m - 1]} ${y}, ${weekday.toLowerCase()}`;
  renderTaskList();
  document.getElementById('dayPanel').hidden = false;
  setTimeout(() => document.getElementById('newTaskInput').focus(), 50);
}

function closeDay() {
  document.getElementById('dayPanel').hidden = true;
  openDate = null;
}

function renderTaskList() {
  const list = document.getElementById('taskList');
  list.innerHTML = '';
  const dayTasks = state.tasks
    .filter(t => t.date === openDate)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  if (dayTasks.length === 0) {
    const empty = document.createElement('li');
    empty.style.cssText = 'padding: 20px; text-align: center; color: var(--text-dim); font-size: 13px;';
    empty.textContent = 'Пусто. Добавь задачу сверху.';
    list.appendChild(empty);
    return;
  }

  dayTasks.forEach(task => list.appendChild(renderTaskItem(task)));
}

function renderTaskItem(task) {
  const li = document.createElement('li');
  li.className = 'task' + (task.done ? ' done' : '');
  li.dataset.taskId = task.id;
  li.draggable = true;

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = !!task.done;
  cb.addEventListener('change', () => {
    task.done = cb.checked;
    touch();
    renderTaskList();
    renderMonth();
  });

  const txt = document.createElement('div');
  txt.className = 'text';
  txt.textContent = task.text;
  txt.addEventListener('click', () => startEdit(txt, task));

  const del = document.createElement('button');
  del.className = 'del';
  del.textContent = '✕';
  del.title = 'Удалить';
  del.addEventListener('click', () => {
    state.tasks = state.tasks.filter(t => t.id !== task.id);
    touch();
    renderTaskList();
    renderMonth();
  });

  li.append(cb, txt, del);
  attachDragSource(li, task.id);
  return li;
}

function startEdit(el, task) {
  el.contentEditable = 'true';
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  const finish = (commit) => {
    el.contentEditable = 'false';
    el.removeEventListener('blur', onBlur);
    el.removeEventListener('keydown', onKey);
    const newText = el.textContent.trim();
    if (commit && newText && newText !== task.text) {
      task.text = newText;
      touch();
    } else {
      el.textContent = task.text;
    }
    renderMonth();
  };
  const onBlur = () => finish(true);
  const onKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  };
  el.addEventListener('blur', onBlur);
  el.addEventListener('keydown', onKey);
}

// ---------- Создание задачи ----------
function addTask(date, text) {
  const dayTasks = state.tasks.filter(t => t.date === date);
  const maxOrder = dayTasks.reduce((m, t) => Math.max(m, t.order ?? 0), 0);
  state.tasks.push({
    id: uid(),
    date,
    text: text.trim(),
    done: false,
    order: maxOrder + 1,
    createdAt: Date.now(),
  });
  touch();
}

// ---------- Drag & drop (мышь + touch) ----------
let dragTaskId = null;
let touchDragEl = null;
let touchGhost = null;
let touchStartXY = null;
let touchActive = false;

function attachDragSource(el, taskId) {
  el.addEventListener('dragstart', (e) => {
    dragTaskId = taskId;
    el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', taskId);
  });
  el.addEventListener('dragend', () => {
    el.classList.remove('dragging');
    dragTaskId = null;
    clearDragHighlights();
  });

  // Touch — long-press start
  let longPressTimer = null;
  el.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    touchStartXY = { x: t.clientX, y: t.clientY };
    longPressTimer = setTimeout(() => {
      touchActive = true;
      dragTaskId = taskId;
      touchDragEl = el;
      el.classList.add('dragging');
      // ghost
      touchGhost = el.cloneNode(true);
      touchGhost.style.position = 'fixed';
      touchGhost.style.pointerEvents = 'none';
      touchGhost.style.opacity = '0.85';
      touchGhost.style.zIndex = '999';
      touchGhost.style.left = t.clientX + 'px';
      touchGhost.style.top = t.clientY + 'px';
      touchGhost.style.transform = 'translate(-50%, -50%)';
      touchGhost.style.boxShadow = 'var(--shadow)';
      document.body.appendChild(touchGhost);
      // блок прокрутки
      document.body.style.overflow = 'hidden';
    }, 350);
  }, { passive: true });

  el.addEventListener('touchmove', (e) => {
    if (!touchActive) {
      // если двинули до long-press — отменяем таймер
      if (longPressTimer && touchStartXY) {
        const t = e.touches[0];
        const dx = Math.abs(t.clientX - touchStartXY.x);
        const dy = Math.abs(t.clientY - touchStartXY.y);
        if (dx > 8 || dy > 8) { clearTimeout(longPressTimer); longPressTimer = null; }
      }
      return;
    }
    e.preventDefault();
    const t = e.touches[0];
    if (touchGhost) {
      touchGhost.style.left = t.clientX + 'px';
      touchGhost.style.top = t.clientY + 'px';
    }
    clearDragHighlights();
    const overEl = document.elementFromPoint(t.clientX, t.clientY);
    const cell = overEl?.closest?.('.cell');
    if (cell) cell.classList.add('drag-over');
  }, { passive: false });

  const endTouch = (e) => {
    clearTimeout(longPressTimer);
    longPressTimer = null;
    if (!touchActive) return;
    touchActive = false;
    const t = (e.changedTouches && e.changedTouches[0]) || null;
    let cell = null;
    if (t) {
      // временно прячем ghost, чтобы elementFromPoint увидел ячейку
      if (touchGhost) touchGhost.style.display = 'none';
      const overEl = document.elementFromPoint(t.clientX, t.clientY);
      cell = overEl?.closest?.('.cell');
    }
    if (touchGhost) { touchGhost.remove(); touchGhost = null; }
    if (touchDragEl) { touchDragEl.classList.remove('dragging'); touchDragEl = null; }
    document.body.style.overflow = '';
    clearDragHighlights();
    if (cell && dragTaskId) {
      moveTaskToDate(dragTaskId, cell.dataset.date);
    }
    dragTaskId = null;
  };
  el.addEventListener('touchend', endTouch);
  el.addEventListener('touchcancel', endTouch);
}

function attachDropTarget(cell, iso) {
  cell.addEventListener('dragover', (e) => {
    if (!dragTaskId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    cell.classList.add('drag-over');
  });
  cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
  cell.addEventListener('drop', (e) => {
    e.preventDefault();
    cell.classList.remove('drag-over');
    const id = dragTaskId || e.dataTransfer.getData('text/plain');
    if (id) moveTaskToDate(id, iso);
  });
}

function clearDragHighlights() {
  document.querySelectorAll('.cell.drag-over').forEach(c => c.classList.remove('drag-over'));
}

function moveTaskToDate(taskId, newDate) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task || task.date === newDate) return;
  task.date = newDate;
  const dayTasks = state.tasks.filter(t => t.date === newDate && t.id !== taskId);
  const maxOrder = dayTasks.reduce((m, t) => Math.max(m, t.order ?? 0), 0);
  task.order = maxOrder + 1;
  touch();
  renderMonth();
  if (openDate) renderTaskList();
}

// ---------- Синхронизация (Gist) ----------
function hasSync() { return !!(settings.token && settings.gistId); }

async function gistGet() {
  const res = await fetch(`https://api.github.com/gists/${settings.gistId}`, {
    headers: {
      'Authorization': `token ${settings.token}`,
      'Accept': 'application/vnd.github+json',
    },
  });
  if (!res.ok) throw new Error(`GET ${res.status}`);
  const data = await res.json();
  const file = data.files?.[GIST_FILENAME];
  if (!file) return null;
  const content = file.truncated
    ? await (await fetch(file.raw_url)).text()
    : file.content;
  return JSON.parse(content);
}

async function gistPatch(payload) {
  const res = await fetch(`https://api.github.com/gists/${settings.gistId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `token ${settings.token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      files: { [GIST_FILENAME]: { content: JSON.stringify(payload, null, 2) } },
    }),
  });
  if (!res.ok) throw new Error(`PATCH ${res.status}`);
  return res.json();
}

async function gistCreate() {
  const res = await fetch('https://api.github.com/gists', {
    method: 'POST',
    headers: {
      'Authorization': `token ${settings.token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      description: 'Kalendar tasks data',
      public: false,
      files: {
        [GIST_FILENAME]: { content: JSON.stringify(state, null, 2) },
      },
    }),
  });
  if (!res.ok) throw new Error(`CREATE ${res.status}`);
  return res.json();
}

async function pullFromGist({ silent = false } = {}) {
  if (!hasSync()) return;
  try {
    setSyncStatus('тяну…', 'sync');
    const remote = await gistGet();
    if (remote && typeof remote.updatedAt === 'number') {
      remoteUpdatedAt = remote.updatedAt;
      if (remote.updatedAt > (state.updatedAt || 0)) {
        state = remote;
        saveLocal();
        renderMonth();
        if (openDate) renderTaskList();
        if (!silent) toast('Подтянул свежие данные');
      }
    }
    setSyncStatus('синк ок', 'ok');
  } catch (e) {
    setSyncStatus('ошибка', 'err');
    if (!silent) toast('Не удалось получить данные: ' + e.message);
  }
}

function schedulePush() {
  if (!hasSync()) return;
  clearTimeout(pushTimer);
  setSyncStatus('сохраняю…', 'sync');
  pushTimer = setTimeout(pushNow, 500);
}

async function pushNow() {
  if (!hasSync() || isPushing) return;
  isPushing = true;
  try {
    // лёгкая защита от затирания: если на удалённом новее — сначала pull
    try {
      const remote = await gistGet();
      if (remote && remote.updatedAt > remoteUpdatedAt && remote.updatedAt > state.updatedAt) {
        // удалённое новее — мерджим (берём удалённое, наши изменения уже в state.updatedAt)
        state = remote;
        saveLocal();
        renderMonth();
        if (openDate) renderTaskList();
        toast('На сервере свежее — подтянул');
        remoteUpdatedAt = remote.updatedAt;
        return;
      }
    } catch { /* offline — продолжим, попробуем PATCH */ }

    await gistPatch(state);
    remoteUpdatedAt = state.updatedAt;
    setSyncStatus('синк ок', 'ok');
  } catch (e) {
    setSyncStatus('офлайн', 'err');
    // Повторим, когда сеть появится
  } finally {
    isPushing = false;
  }
}

// ---------- Настройки ----------
function openSettings() {
  document.getElementById('tokenInput').value = settings.token || '';
  document.getElementById('gistIdInput').value = settings.gistId || '';
  document.getElementById('settingsMsg').textContent = '';
  document.getElementById('settingsMsg').className = 'msg';
  document.getElementById('settingsPanel').hidden = false;
}
function closeSettings() {
  document.getElementById('settingsPanel').hidden = true;
}

function bindSettings() {
  document.getElementById('settingsBtn').addEventListener('click', openSettings);

  document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
    settings.token = document.getElementById('tokenInput').value.trim();
    settings.gistId = document.getElementById('gistIdInput').value.trim();
    saveSettings();
    const msg = document.getElementById('settingsMsg');
    msg.textContent = 'Сохранено. Проверяю подключение…';
    msg.className = 'msg';
    if (hasSync()) {
      try {
        await pullFromGist({ silent: true });
        msg.textContent = 'Подключено к Gist.';
        msg.className = 'msg ok';
        setSyncStatus('синк ок', 'ok');
      } catch (e) {
        msg.textContent = 'Ошибка: ' + e.message;
        msg.className = 'msg err';
      }
    } else {
      setSyncStatus('локально');
      msg.textContent = 'Сохранено. Без токена работает только локально.';
      msg.className = 'msg ok';
    }
  });

  document.getElementById('createGistBtn').addEventListener('click', async () => {
    settings.token = document.getElementById('tokenInput').value.trim();
    const msg = document.getElementById('settingsMsg');
    if (!settings.token) {
      msg.textContent = 'Сначала вставь токен.';
      msg.className = 'msg err';
      return;
    }
    saveSettings();
    msg.textContent = 'Создаю Gist…';
    msg.className = 'msg';
    try {
      const gist = await gistCreate();
      settings.gistId = gist.id;
      saveSettings();
      document.getElementById('gistIdInput').value = gist.id;
      remoteUpdatedAt = state.updatedAt;
      msg.textContent = 'Создан Gist ' + gist.id;
      msg.className = 'msg ok';
      setSyncStatus('синк ок', 'ok');
    } catch (e) {
      msg.textContent = 'Ошибка: ' + e.message;
      msg.className = 'msg err';
    }
  });

  document.getElementById('pullNowBtn').addEventListener('click', () => pullFromGist());

  document.getElementById('clearTokenBtn').addEventListener('click', () => {
    settings = { token: '', gistId: '' };
    saveSettings();
    document.getElementById('tokenInput').value = '';
    document.getElementById('gistIdInput').value = '';
    setSyncStatus('локально');
    const msg = document.getElementById('settingsMsg');
    msg.textContent = 'Токен и Gist ID удалены из этого браузера.';
    msg.className = 'msg ok';
  });
}

// ---------- Биндинги ----------
function bind() {
  document.getElementById('prevBtn').addEventListener('click', () => {
    viewDate = viewMode === 'week'
      ? addDays(viewDate, -7)
      : new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1);
    renderMonth();
  });
  document.getElementById('nextBtn').addEventListener('click', () => {
    viewDate = viewMode === 'week'
      ? addDays(viewDate, 7)
      : new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1);
    renderMonth();
  });
  document.getElementById('todayBtn').addEventListener('click', () => {
    viewDate = viewMode === 'week' ? startOfWeek(new Date()) : startOfMonth(new Date());
    renderMonth();
  });

  const setView = (mode) => {
    viewMode = mode;
    localStorage.setItem(VIEW_KEY, mode);
    viewDate = mode === 'week' ? startOfWeek(new Date()) : startOfMonth(new Date());
    document.getElementById('viewMonthBtn').setAttribute('aria-selected', mode === 'month');
    document.getElementById('viewWeekBtn').setAttribute('aria-selected', mode === 'week');
    renderMonth();
  };
  document.getElementById('viewMonthBtn').addEventListener('click', () => setView('month'));
  document.getElementById('viewWeekBtn').addEventListener('click', () => setView('week'));
  // Применяем сохранённый режим к кнопкам при старте
  document.getElementById('viewMonthBtn').setAttribute('aria-selected', viewMode === 'month');
  document.getElementById('viewWeekBtn').setAttribute('aria-selected', viewMode === 'week');

  document.querySelectorAll('[data-close]').forEach(el => {
    el.addEventListener('click', () => {
      closeDay();
      closeSettings();
    });
  });

  document.getElementById('newTaskForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('newTaskInput');
    const text = input.value.trim();
    if (!text || !openDate) return;
    addTask(openDate, text);
    input.value = '';
    renderTaskList();
    renderMonth();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeDay(); closeSettings(); }
  });

  // Подтягиваем при возврате на вкладку
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && hasSync()) {
      pullFromGist({ silent: true });
    }
  });
  window.addEventListener('online', () => {
    if (hasSync()) { pullFromGist({ silent: true }); }
  });
}

// ---------- Старт ----------
function init() {
  renderWeekdays();
  renderMonth();
  bind();
  bindSettings();
  if (hasSync()) {
    setSyncStatus('тяну…', 'sync');
    pullFromGist({ silent: true });
  } else {
    setSyncStatus('локально');
  }
}

init();
