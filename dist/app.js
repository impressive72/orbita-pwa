(() => {
  const SUPABASE_URL = 'https://laogfiekublnxeerqoae.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_HHYrVJLODneB3MdfnvkCIQ_SBl-CHCk';
  const TOKEN_KEY = 'orbita-field-token-v1';
  const REFRESH_KEY = 'orbita-field-refresh-v1';
  const USER_KEY = 'orbita-field-user-v1';
  const CACHE_PREFIX = 'orbita-field-cache-v1:';
  const USERNAME_DOMAIN = 'users.orbita.invalid';
  const PHOTO_DB = 'orbita-field-photos-v1';
  const PHOTO_STORE = 'pending';
  const RESOURCES = ['projects', 'employees', 'tasks', 'assets', 'timeEntries', 'reports'];
  const labels = {
    projects: 'Объекты',
    tasks: 'Этапы',
    reports: 'Фотоотчёты',
    settings: 'Профиль'
  };
  const state = {
    user: null,
    route: 'projects',
    selectedProject: null,
    projects: [],
    employees: [],
    tasks: [],
    timeEntries: [],
    reports: [],
    assets: [],
    pending: {},
    pendingPhotos: {},
    photoURLs: new Map(),
    filter: 'active',
    search: '',
    syncState: 'idle',
    syncMessage: '',
    lastSync: null,
    syncing: false,
    syncRequested: false,
    installPrompt: null,
    selectedPhoto: null
  };
  const main = document.querySelector('#main');
  const modal = document.querySelector('#modal');
  const modalContent = document.querySelector('#modal-content');
  const toast = document.querySelector('#toast');

  function html(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function token() {
    return sessionStorage.getItem(TOKEN_KEY);
  }

  function authEmail(identifier) {
    const value = String(identifier || '').trim();
    if (value.includes('@')) return value.toLowerCase();
    const login = value.toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{1,47}$/.test(login)) {
      throw new Error('Логин: от 2 до 48 символов латиницей, цифры, точка, дефис или подчёркивание.');
    }
    return `${login}@${USERNAME_DOMAIN}`;
  }

  function displayIdentifier(email) {
    const suffix = `@${USERNAME_DOMAIN}`;
    const value = String(email || '');
    if (!value.toLowerCase().endsWith(suffix)) return value;
    const login = value.slice(0, -suffix.length);
    return /^[a-z0-9][a-z0-9._-]{1,47}$/i.test(login) ? login : value;
  }

  function readUser() {
    try { return JSON.parse(sessionStorage.getItem(USER_KEY) || 'null'); }
    catch { return null; }
  }

  function clearSession() {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(REFRESH_KEY);
    sessionStorage.removeItem(USER_KEY);
    state.user = null;
  }

  async function refreshToken() {
    const refresh = sessionStorage.getItem(REFRESH_KEY);
    if (!refresh) {
      clearSession();
      return false;
    }
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refresh }),
      cache: 'no-store'
    });
    const session = await response.json().catch(() => ({}));
    if (!response.ok || !session.access_token || !session.refresh_token) {
      if (response.status === 400 || response.status === 401) clearSession();
      return false;
    }
    sessionStorage.setItem(TOKEN_KEY, session.access_token);
    sessionStorage.setItem(REFRESH_KEY, session.refresh_token);
    return true;
  }

  async function request(path, options = {}, canRefresh = true) {
    const { rawResponse, ...fetchOptions } = options;
    const headers = new Headers(fetchOptions.headers || {});
    headers.set('apikey', SUPABASE_KEY);
    if (token()) headers.set('Authorization', `Bearer ${token()}`);
    const body = fetchOptions.body;
    if (body && typeof body === 'object' &&
        !(body instanceof Blob) && !(body instanceof FormData) &&
        !(body instanceof ArrayBuffer) && !ArrayBuffer.isView(body)) {
      headers.set('Content-Type', 'application/json');
      fetchOptions.body = JSON.stringify(body);
    }
    const response = await fetch(`${SUPABASE_URL}/${path}`, {
      ...fetchOptions,
      headers,
      cache: 'no-store'
    });
    if (response.status === 401 && canRefresh && token()) {
      if (await refreshToken()) return request(path, options, false);
    }
    if (!response.ok) {
      const text = await response.text();
      let detail = '';
      try {
        const bodyJSON = JSON.parse(text);
        detail = bodyJSON.msg || bodyJSON.message || bodyJSON.error_description || bodyJSON.error || '';
      } catch { detail = text; }
      throw new Error(detail || `Ошибка сервера (${response.status})`);
    }
    if (rawResponse) return response;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  function cacheKey() {
    return `${CACHE_PREFIX}${String(state.user?.email || 'guest').toLowerCase()}`;
  }

  function persist() {
    if (!state.user) return;
    try {
      const cached = {
        projects: state.projects,
        employees: state.employees,
        tasks: state.tasks,
        timeEntries: state.timeEntries,
        reports: state.reports,
        assets: state.assets,
        pending: state.pending,
        lastSync: state.lastSync
      };
      localStorage.setItem(cacheKey(), JSON.stringify(cached));
    } catch (error) {
      showToast('Не удалось сохранить офлайн-копию. Проверьте свободное место.');
      console.error('Не удалось сохранить локальный кэш:', error);
    }
  }

  function restoreCache() {
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey()) || '{}');
      for (const key of ['projects', 'employees', 'tasks', 'timeEntries', 'reports', 'assets']) {
        state[key] = Array.isArray(cached[key]) ? cached[key] : [];
      }
      state.pending = cached.pending && typeof cached.pending === 'object' ? cached.pending : {};
      state.lastSync = cached.lastSync || null;
    } catch {
      state.syncMessage = 'Офлайн-копия повреждена; данные будут загружены заново.';
    }
  }

  function openPhotoDB() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('Хранилище фото недоступно в этом браузере.'));
        return;
      }
      const request = indexedDB.open(PHOTO_DB, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(PHOTO_STORE)) {
          db.createObjectStore(PHOTO_STORE, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Не удалось открыть хранилище фото.'));
    });
  }

  async function storePhoto(id, data) {
    const db = await openPhotoDB();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(PHOTO_STORE, 'readwrite');
      transaction.objectStore(PHOTO_STORE).put({ id, data, email: state.user.email });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('Не удалось сохранить фото офлайн.'));
      transaction.onabort = () => reject(transaction.error || new Error('Не удалось сохранить фото офлайн.'));
    });
    db.close();
    state.pendingPhotos[id] = data;
  }

  async function removeStoredPhoto(id) {
    const db = await openPhotoDB();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(PHOTO_STORE, 'readwrite');
      transaction.objectStore(PHOTO_STORE).delete(id);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('Не удалось удалить локальное фото.'));
    });
    db.close();
    delete state.pendingPhotos[id];
  }

  async function restorePhotos() {
    const db = await openPhotoDB();
    const items = await new Promise((resolve, reject) => {
      const transaction = db.transaction(PHOTO_STORE, 'readonly');
      const request = transaction.objectStore(PHOTO_STORE).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error || new Error('Не удалось прочитать локальные фото.'));
    });
    db.close();
    const email = String(state.user?.email || '').toLowerCase();
    state.pendingPhotos = Object.fromEntries(items
      .filter(item => String(item.email || '').toLowerCase() === email)
      .map(item => [item.id, item.data]));
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast.timeout);
    showToast.timeout = setTimeout(() => toast.classList.remove('show'), 2600);
  }

  function fmtDate(value, includeTime = false) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('ru-RU', includeTime
      ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
      : { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
  }

  function duration(seconds) {
    const safeSeconds = Math.max(0, Math.floor(seconds || 0));
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const remainder = safeSeconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
  }

  function allTasks(projectID) {
    return state.tasks.filter(task => task.projectID === projectID);
  }

  function doneTask(task) {
    return task.status === 'done' || task.status === 'completed';
  }

  function activeTimer() {
    const email = String(state.user?.email || '').toLowerCase();
    return state.timeEntries.find(entry =>
      entry.status === 'inProgress' &&
      String(entry.employeeEmail || '').toLowerCase() === email
    ) || null;
  }

  function projectName(id) {
    return state.projects.find(project => project.id === id)?.name || 'Объект';
  }

  function employeeForUser() {
    const email = String(state.user?.email || '').toLowerCase();
    return state.employees.find(employee => String(employee.email || '').toLowerCase() === email) || null;
  }

  function employeeName() {
    return employeeForUser()?.name || displayIdentifier(state.user?.email) || 'Монтажник';
  }

  function addOrReplace(list, value) {
    const index = list.findIndex(item => item.id === value.id);
    if (index < 0) list.push(value);
    else list[index] = value;
  }

  function queueRecord(resource, record) {
    if (!record.id) throw new Error('У записи отсутствует идентификатор.');
    record.updatedAt = new Date().toISOString();
    state.pending[`${resource}:${record.id}`] = { resource, record };
    const collection = {
      projects: state.projects,
      tasks: state.tasks,
      timeEntries: state.timeEntries,
      reports: state.reports,
      assets: state.assets
    }[resource];
    if (collection) addOrReplace(collection, record);
    persist();
    render();
    syncNow(false);
  }

  async function pullRecords() {
    const list = [];
    for (let offset = 0; ; offset += 1000) {
      const params = new URLSearchParams({
        select: 'organization_id,resource,record_id,data,deleted,updated_at',
        organization_id: `eq.${state.user.organization_id}`,
        resource: `in.(${RESOURCES.join(',')})`,
        deleted: 'eq.false',
        order: 'updated_at.asc',
        limit: '1000',
        offset: String(offset)
      });
      const page = await request(`rest/v1/orbita_records?${params}`);
      if (!Array.isArray(page)) throw new Error('Сервер вернул неверный формат данных.');
      list.push(...page);
      if (page.length < 1000) break;
    }
    return list;
  }

  function mergeRemote(rows) {
    const collections = {
      projects: state.projects,
      employees: state.employees,
      tasks: state.tasks,
      timeEntries: state.timeEntries,
      reports: state.reports,
      assets: state.assets
    };
    for (const row of rows) {
      const collection = collections[row.resource];
      if (!collection || !row.record_id || !row.data) continue;
      const record = { ...row.data, id: row.record_id };
      const pendingKey = `${row.resource}:${row.record_id}`;
      if (state.pending[pendingKey]) continue;
      addOrReplace(collection, record);
    }
    persist();
  }

  async function pushRecords() {
    const changes = Object.values(state.pending);
    if (!changes.length) return 0;
    for (let offset = 0; offset < changes.length; offset += 25) {
      const batch = changes.slice(offset, offset + 25);
      const body = batch.map(({ resource, record }) => ({
        organization_id: state.user.organization_id,
        resource,
        record_id: record.id,
        data: record,
        deleted: false
      }));
      const params = new URLSearchParams({
        on_conflict: 'organization_id,resource,record_id'
      });
      await request(`rest/v1/orbita_records?${params}`, {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body
      });
      for (const { resource, record } of batch) {
        delete state.pending[`${resource}:${record.id}`];
      }
      persist();
    }
    return changes.length;
  }

  async function pushPhotos() {
    let uploaded = 0;
    for (const [reportID, encoded] of Object.entries(state.pendingPhotos)) {
      const report = state.reports.find(item => item.id === reportID);
      if (!report?.remoteFileID) continue;
      const raw = atob(encoded);
      const bytes = new Uint8Array(raw.length);
      for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
      const path = report.remoteFileID.split('/').map(encodeURIComponent).join('/');
      await request(`storage/v1/object/orbita-files/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'true' },
        body: new Blob([bytes], { type: 'image/jpeg' })
      });
      await removeStoredPhoto(reportID);
      uploaded += 1;
      persist();
    }
    return uploaded;
  }

  async function syncNow(showStatus = true) {
    if (!state.user) return;
    if (state.syncing) {
      state.syncRequested = true;
      return;
    }
    state.syncing = true;
    state.syncState = 'syncing';
    if (showStatus) state.syncMessage = 'Обновляю данные…';
    render();
    try {
      const pushed = await pushRecords();
      const photos = await pushPhotos();
      const records = await pullRecords();
      mergeRemote(records);
      state.lastSync = new Date().toISOString();
      state.syncState = navigator.onLine ? 'online' : 'offline';
      state.syncMessage = navigator.onLine
        ? `Синхронизировано${pushed || photos ? `: записей ${pushed}, фото ${photos}` : ''}.`
        : 'Нет подключения к сети. Изменения сохранены на устройстве.';
      persist();
    } catch (error) {
      state.syncState = navigator.onLine ? 'error' : 'offline';
      state.syncMessage = navigator.onLine
        ? `Синхронизация не завершена: ${error.message}`
        : 'Нет подключения. Изменения останутся на устройстве до синхронизации.';
      console.error('Ошибка синхронизации монтажника:', error);
    } finally {
      state.syncing = false;
      render();
      const shouldResync = state.syncRequested;
      state.syncRequested = false;
      if (shouldResync && navigator.onLine) {
        setTimeout(() => syncNow(false), 0);
      }
    }
  }

  function statusBadge(task) {
    return doneTask(task)
      ? '<span class="status done">Выполнено</span>'
      : `<span class="status ${task.status === 'inProgress' ? 'progress' : 'planned'}">${task.status === 'inProgress' ? 'В работе' : 'К выполнению'}</span>`;
  }

  function progressFor(projectID) {
    const tasks = allTasks(projectID);
    if (!tasks.length) return 0;
    return Math.round(tasks.filter(doneTask).length * 100 / tasks.length);
  }

  function connectionStrip() {
    const kind = state.syncState;
    const label = kind === 'syncing' ? 'Синхронизация…'
      : kind === 'error' ? state.syncMessage
        : kind === 'offline' || !navigator.onLine ? 'Офлайн — изменения будут сохранены'
          : state.syncMessage || 'На связи с общей базой';
    return `<div class="connection ${kind}" role="status"><span class="connection-dot"></span><span>${html(label)}</span><button class="text-button" data-action="sync" ${state.syncing ? 'disabled' : ''}>Обновить</button></div>`;
  }

  function loginView() {
    return `<section class="login-wrap">
      <div class="login-mark">О</div>
      <p class="eyebrow">Рабочее место монтажника</p>
      <h2>Вход в Орбиту</h2>
      <p class="muted">Объекты, этапы работ, учёт времени и фотоотчёты.</p>
      <form id="login-form" class="login-form">
        <label class="field"><span>Логин</span><input name="login" type="text" autocomplete="username" autocapitalize="none" required></label>
        <label class="field"><span>Пароль</span><input name="password" type="password" autocomplete="current-password" required></label>
        <p id="login-error" class="form-error" aria-live="polite"></p>
        <button class="button primary wide-button" type="submit">Войти</button>
      </form>
      <p class="login-foot">Введите выданный логин и пароль. Для входа администратора укажите его email. Сохранённые данные синхронизируются при подключении к интернету.</p>
    </section>`;
  }

  function projectCard(project) {
    const tasks = allTasks(project.id);
    const percent = progressFor(project.id);
    return `<button class="project-card" data-open-project="${html(project.id)}">
      <div class="project-top"><span class="project-mark">⌂</span><span class="project-percent">${percent}%</span></div>
      <h3>${html(project.name || 'Объект без названия')}</h3>
      <p class="project-address">${html(project.address || 'Адрес не указан')}</p>
      <div class="progress-track"><span style="width:${percent}%"></span></div>
      <div class="project-bottom"><span>${tasks.filter(doneTask).length} из ${tasks.length} этапов</span><span>Открыть <b>›</b></span></div>
    </button>`;
  }

  function projectsView() {
    const term = state.search.toLowerCase().trim();
    const projects = state.projects.filter(project => {
      const tasks = allTasks(project.id);
      const active = tasks.some(task => !doneTask(task)) || !tasks.length;
      return (state.filter !== 'active' || active) &&
        (!term || `${project.name || ''} ${project.address || ''}`.toLowerCase().includes(term));
    });
    const timer = activeTimer();
    return `${connectionStrip()}
      <div class="welcome-row"><div><p class="eyebrow">Добрый день</p><h2>${html(employeeName())}</h2></div>
        <span class="avatar">${html(employeeName().trim().slice(0, 1).toUpperCase())}</span></div>
      ${timer ? `<button class="active-timer" data-open-project="${html(timer.projectID)}"><span class="timer-pulse"></span><span><b>Учёт времени идёт</b><small>${html(projectName(timer.projectID))}</small></span><strong data-elapsed="${html(timer.startedAt)}">${duration((Date.now() - new Date(timer.startedAt).getTime()) / 1000)}</strong></button>` : ''}
      <div class="section-head"><h2>Мои объекты</h2><span class="count-pill">${projects.length}</span></div>
      <input class="search" id="project-search" type="search" placeholder="Поиск по объектам и адресам" value="${html(state.search)}">
      <div class="chips">
        <button class="chip ${state.filter === 'active' ? 'active' : ''}" data-filter="active">В работе</button>
        <button class="chip ${state.filter === 'all' ? 'active' : ''}" data-filter="all">Все объекты</button>
      </div>
      <div class="project-grid">${projects.length ? projects.map(projectCard).join('') : `<div class="empty"><b>${state.projects.length ? 'Активных объектов нет' : 'Объекты пока не назначены'}</b><span>${state.projects.length ? 'Переключитесь на «Все объекты».' : 'Назначенные вам объекты появятся здесь.'}</span></div>`}</div>`;
  }

  function taskRow(task) {
    return `<article class="task-row ${doneTask(task) ? 'task-done' : ''}">
      <button class="task-check ${doneTask(task) ? 'checked' : ''}" data-action="toggle-task" data-id="${html(task.id)}" aria-label="Изменить статус">${doneTask(task) ? '✓' : ''}</button>
      <div class="task-info"><b>${html(task.name || 'Этап без названия')}</b><div class="task-meta">${statusBadge(task)}${task.dueDate ? `<span>Срок: ${html(fmtDate(task.dueDate))}</span>` : ''}</div>${task.notes ? `<p>${html(task.notes)}</p>` : ''}</div>
    </article>`;
  }

  function activeTimerForProject(projectID) {
    const timer = activeTimer();
    return timer?.projectID === projectID ? timer : null;
  }

  function projectView(project) {
    const tasks = allTasks(project.id).sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
    const reports = state.reports.filter(report => report.projectID === project.id)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    const timer = activeTimer();
    const projectTimer = activeTimerForProject(project.id);
    const otherTimer = timer && timer.projectID !== project.id;
    const mapURL = project.address ? `https://maps.apple.com/?q=${encodeURIComponent(project.address)}` : '';
    return `${connectionStrip()}
      <button class="back-link" data-action="back">‹ Объекты</button>
      <section class="project-hero">
        <div class="project-hero-top"><span class="status ${html(project.status || 'active')}">${html(project.status === 'completed' ? 'Завершён' : 'В работе')}</span><span class="muted">${progressFor(project.id)}% готово</span></div>
        <h2>${html(project.name || 'Объект')}</h2>
        ${project.address ? `<a class="address-link" href="${mapURL}" target="_blank" rel="noopener">${html(project.address)} <span>↗</span></a>` : '<p class="muted">Адрес не указан</p>'}
        ${project.notes ? `<p class="project-notes">${html(project.notes)}</p>` : ''}
      </section>
      <section class="timer-card">
        ${projectTimer ? `<div class="timer-running"><span class="timer-pulse"></span><span><b>Учёт времени</b><small>Начат ${html(fmtDate(projectTimer.startedAt, true))}</small></span><strong data-elapsed="${html(projectTimer.startedAt)}">${duration((Date.now() - new Date(projectTimer.startedAt).getTime()) / 1000)}</strong></div>
          <button class="button danger timer-button" data-action="stop-timer">Завершить учёт времени</button>`
          : `<div class="timer-running"><span class="timer-icon">◷</span><span><b>Учёт времени</b><small>${otherTimer ? `Уже идёт на объекте «${html(projectName(timer.projectID))}»` : 'Зафиксируйте время работы на объекте'}</small></span></div>
          <button class="button primary timer-button" data-action="start-timer" ${otherTimer ? 'disabled' : ''}>▶ Начать учёт времени</button>`}
      </section>
      <div class="section-head"><h2>Этапы работ</h2><span class="count-pill">${tasks.filter(doneTask).length}/${tasks.length}</span></div>
      <div class="task-list">${tasks.length ? tasks.map(taskRow).join('') : '<div class="empty"><b>Этапы не добавлены</b><span>Добавьте этапы в карточке объекта в основной системе.</span></div>'}</div>
      <div class="section-head report-head"><h2>Фотоотчёты</h2><button class="button small primary" data-action="new-report">＋ Добавить</button></div>
      ${reports.length ? `<div class="report-list">${reports.slice(0, 10).map(reportCard).join('')}</div>` : '<div class="muted report-empty">Фотоотчётов пока нет.</div>'}`;
  }

  function reportCard(report) {
    const photo = report.remoteFileID
      ? `<img class="report-photo" data-photo-id="${html(report.id)}" alt="Фотоотчёт" loading="lazy">`
      : '<div class="report-photo-placeholder">▧</div>';
    const task = state.tasks.find(item => item.id === report.taskID);
    return `<article class="report-card">${photo}<div class="report-copy"><b>${html(report.title || 'Фотоотчёт')}</b><p>${html(report.notes || 'Без комментария')}</p><small>${html(fmtDate(report.createdAt, true))}${task ? ` · ${html(task.name)}` : ''}</small></div></article>`;
  }

  function tasksView() {
    const items = state.tasks.filter(task => {
      if (state.filter === 'active' && doneTask(task)) return false;
      if (state.filter === 'done' && !doneTask(task)) return false;
      const project = projectName(task.projectID);
      const term = state.search.toLowerCase().trim();
      return !term || `${task.name || ''} ${project}`.toLowerCase().includes(term);
    });
    return `${connectionStrip()}<div class="section-head"><div><p class="eyebrow">Назначенные работы</p><h2>Этапы</h2></div><span class="count-pill">${items.length}</span></div>
      <input class="search" id="task-search" type="search" placeholder="Поиск по этапам и объектам" value="${html(state.search)}">
      <div class="chips"><button class="chip ${state.filter === 'active' ? 'active' : ''}" data-filter="active">К выполнению</button><button class="chip ${state.filter === 'done' ? 'active' : ''}" data-filter="done">Выполнено</button><button class="chip ${state.filter === 'all' ? 'active' : ''}" data-filter="all">Все</button></div>
      <div class="task-page-list">${items.length ? items.map(task => `<section class="task-project-group"><button class="group-title" data-open-project="${html(task.projectID)}"><span>${html(projectName(task.projectID))}</span><span>›</span></button>${taskRow(task)}</section>`).join('') : '<div class="empty"><b>Этапы не найдены</b><span>Попробуйте изменить фильтр.</span></div>'}</div>`;
  }

  function reportsView() {
    const reports = [...state.reports].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    return `${connectionStrip()}<div class="section-head"><div><p class="eyebrow">Результаты работ</p><h2>Фотоотчёты</h2></div><span class="count-pill">${reports.length}</span></div>
      <div class="report-list all-reports">${reports.length ? reports.map(report => `<section class="report-group"><button class="group-title" data-open-project="${html(report.projectID)}"><span>${html(projectName(report.projectID))}</span><span>›</span></button>${reportCard(report)}</section>`).join('') : '<div class="empty"><b>Фотоотчётов пока нет</b><span>Создайте фотоотчёт из карточки объекта.</span></div>'}</div>`;
  }

  function settingsView() {
    const pending = Object.keys(state.pending).length + Object.keys(state.pendingPhotos).length;
    return `${connectionStrip()}<div class="section-head"><div><p class="eyebrow">Учётная запись</p><h2>Профиль</h2></div></div>
      <section class="settings-card">
        <div class="profile-row"><span class="avatar">${html(employeeName().trim().slice(0, 1).toUpperCase())}</span><div><b>${html(employeeName())}</b><small>${html(displayIdentifier(state.user.email))}</small></div></div>
        <div class="setting-row"><span>Роль</span><span>${state.user.role === 'admin' ? 'Администратор' : 'Монтажник'}</span></div>
        <div class="setting-row"><span>Подключение</span><span>${navigator.onLine ? 'Интернет доступен' : 'Офлайн'}</span></div>
        <div class="setting-row"><span>Последняя синхронизация</span><span>${html(state.lastSync ? fmtDate(state.lastSync, true) : 'Ещё не выполнялась')}</span></div>
        <div class="setting-row"><span>Ожидают отправки</span><span>${pending}</span></div>
      </section>
      <button class="button primary wide-button settings-sync" data-action="sync" ${state.syncing ? 'disabled' : ''}>${state.syncing ? 'Синхронизация…' : 'Синхронизировать сейчас'}</button>
      <button class="button danger wide-button logout-button" data-action="logout">Выйти из аккаунта</button>
      <p class="settings-note">Данные монтажника синхронизируются с общей базой Орбиты и доступны только в рамках назначенных объектов.</p>`;
  }

  function render() {
    const title = !state.user ? 'Орбита' : state.selectedProject && state.route === 'project'
      ? 'Объект'
      : labels[state.route] || 'Объекты';
    document.querySelector('#page-title').textContent = title;
    document.querySelector('#top-eyebrow').textContent = state.user ? 'Полевые работы' : 'Монтажная бригада';
    document.querySelectorAll('.bottom-nav [data-route]').forEach(button => {
      button.classList.toggle('active', button.dataset.route ===
        (state.route === 'project' ? 'projects' : state.route));
    });
    if (!state.user) {
      document.querySelector('.bottom-nav').hidden = true;
      document.querySelector('#topbar-action').hidden = true;
      main.innerHTML = loginView();
      hydrateLogin();
      return;
    }
    document.querySelector('.bottom-nav').hidden = false;
    document.querySelector('#topbar-action').hidden = false;
    if (state.route === 'project') {
      const project = state.projects.find(item => item.id === state.selectedProject);
      if (!project) {
        state.route = 'projects';
        state.selectedProject = null;
        render();
        return;
      }
      main.innerHTML = projectView(project);
    } else if (state.route === 'tasks') main.innerHTML = tasksView();
    else if (state.route === 'reports') main.innerHTML = reportsView();
    else if (state.route === 'settings') main.innerHTML = settingsView();
    else main.innerHTML = projectsView();
    hydratePhotos();
  }

  function hydrateLogin() {
    const form = document.querySelector('#login-form');
    if (!form) return;
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const submit = form.querySelector('[type="submit"]');
      const error = document.querySelector('#login-error');
      const values = new FormData(form);
      submit.disabled = true;
      error.textContent = 'Проверяю доступ…';
      try {
        const session = await request('auth/v1/token?grant_type=password', {
          method: 'POST',
          body: {
            email: authEmail(values.get('login')),
            password: values.get('password')
          }
        }, false);
        if (!session.access_token || !session.refresh_token || !session.user?.id || !session.user?.email) {
          throw new Error('Не удалось получить сессию Supabase.');
        }
        sessionStorage.setItem(TOKEN_KEY, session.access_token);
        sessionStorage.setItem(REFRESH_KEY, session.refresh_token);
        const profile = await request(`rest/v1/orbita_profiles?select=organization_id,role,email&user_id=eq.${encodeURIComponent(session.user.id)}`);
        const account = Array.isArray(profile) ? profile[0] : null;
        if (!account?.organization_id || !['admin', 'installer'].includes(account.role)) {
          throw new Error('Для аккаунта не настроен профиль Орбиты.');
        }
        state.user = {
          id: session.user.id,
          email: session.user.email,
          role: account.role,
          organization_id: account.organization_id
        };
        sessionStorage.setItem(USER_KEY, JSON.stringify(state.user));
        restoreCache();
        try { await restorePhotos(); }
        catch (storageError) {
          state.syncMessage = storageError.message;
          state.syncState = 'error';
        }
        state.route = 'projects';
        render();
        await syncNow();
      } catch (loginError) {
        clearSession();
        error.textContent = loginError.message || 'Не удалось войти.';
        submit.disabled = false;
      }
    });
  }

  async function hydratePhotos() {
    const images = main.querySelectorAll('[data-photo-id]');
    for (const image of images) {
      const report = state.reports.find(item => item.id === image.dataset.photoId);
      if (!report?.remoteFileID) continue;
      try {
        let url = state.photoURLs.get(report.id);
        if (!url && state.pendingPhotos[report.id]) {
          url = `data:image/jpeg;base64,${state.pendingPhotos[report.id]}`;
        } else if (!url) {
          const path = report.remoteFileID.split('/').map(encodeURIComponent).join('/');
          const response = await request(`storage/v1/object/orbita-files/${path}`, { rawResponse: true });
          url = URL.createObjectURL(await response.blob());
          state.photoURLs.set(report.id, url);
        }
        if (image.isConnected) image.src = url;
      } catch (error) {
        image.alt = 'Не удалось загрузить фото';
        image.classList.add('photo-error');
        console.error('Не удалось загрузить фотоотчёт:', error);
      }
    }
  }

  function openProject(projectID) {
    if (!state.projects.some(project => project.id === projectID)) return;
    state.selectedProject = projectID;
    state.route = 'project';
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function findTask(id) {
    return state.tasks.find(task => task.id === id);
  }

  function toggleTask(id) {
    const task = findTask(id);
    if (!task) return;
    const completed = doneTask(task);
    queueRecord('tasks', {
      ...task,
      status: completed ? 'active' : 'done',
      completedAt: completed ? null : new Date().toISOString()
    });
  }

  function startTimer() {
    const projectID = state.selectedProject;
    if (!projectID || activeTimer()) {
      showToast('Сначала завершите текущий учёт времени.');
      return;
    }
    const employee = employeeForUser();
    const now = new Date().toISOString();
    queueRecord('timeEntries', {
      id: crypto.randomUUID(),
      projectID,
      taskID: null,
      employeeID: employee?.id || null,
      employeeEmail: state.user.email,
      employeeName: employeeName(),
      startedAt: now,
      endedAt: null,
      durationMinutes: 0,
      status: 'inProgress',
      notes: '',
      createdAt: now,
      updatedAt: now
    });
    showToast('Учёт времени начат.');
  }

  function stopTimer() {
    const timer = activeTimer();
    if (!timer) return;
    const endedAt = new Date();
    const startedAt = new Date(timer.startedAt);
    const seconds = Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000);
    if (!Number.isFinite(seconds) || seconds < 1) {
      showToast('Не удалось определить длительность таймера.');
      return;
    }
    const minutes = Math.floor(seconds / 60);
    queueRecord('timeEntries', {
      ...timer,
      endedAt: endedAt.toISOString(),
      durationMinutes: minutes,
      status: 'submitted'
    });
    showToast(`Время сохранено: ${minutes} мин.`);
  }

  function openReportForm() {
    const project = state.projects.find(item => item.id === state.selectedProject);
    if (!project) return;
    const tasks = allTasks(project.id);
    state.selectedPhoto = null;
    modalContent.innerHTML = `<div class="modal-head"><h2>Новый фотоотчёт</h2><button class="close-button" data-close aria-label="Закрыть">×</button></div>
      <form id="report-form" class="modal-body">
        <label class="field"><span>Заголовок</span><input name="title" maxlength="120" value="Фотоотчёт"></label>
        ${tasks.length ? `<label class="field"><span>Этап работ</span><select name="taskID"><option value="">Без привязки к этапу</option>${tasks.map(task => `<option value="${html(task.id)}">${html(task.name)}</option>`).join('')}</select></label>` : ''}
        <label class="field"><span>Комментарий</span><textarea name="notes" maxlength="2000" placeholder="Что выполнено, замечания, материалы…"></textarea></label>
        <label class="photo-pick"><span class="photo-pick-icon">＋</span><span><b id="photo-name">Добавить фото</b><small>Изображение будет сжато перед отправкой</small></span><input id="report-photo" name="photo" type="file" accept="image/*" capture="environment"></label>
        <div id="photo-preview" class="photo-preview"></div>
        <p id="report-error" class="form-error" aria-live="polite"></p>
        <button class="button primary wide-button" type="submit">Сохранить фотоотчёт</button>
      </form>`;
    modal.showModal();
    modal.querySelector('#report-photo').addEventListener('change', async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        state.selectedPhoto = await compressImage(file);
        modal.querySelector('#photo-name').textContent = file.name;
        modal.querySelector('#photo-preview').innerHTML = `<img src="data:image/jpeg;base64,${state.selectedPhoto}" alt="Предпросмотр фото">`;
      } catch (error) {
        modal.querySelector('#report-error').textContent = error.message;
        state.selectedPhoto = null;
      }
    });
    modal.querySelector('#report-form').addEventListener('submit', saveReport);
  }

  async function compressImage(file) {
    if (!file.type.startsWith('image/')) throw new Error('Выберите файл изображения.');
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Не удалось обработать изображение.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.74));
    if (!blob) throw new Error('Не удалось преобразовать изображение в JPEG.');
    if (blob.size > 9 * 1024 * 1024) throw new Error('Изображение после обработки больше 9 МБ.');
    const buffer = await blob.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  }

  async function saveReport(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    const error = form.querySelector('#report-error');
    const values = new FormData(form);
    const notes = String(values.get('notes') || '').trim();
    if (!state.selectedPhoto && !notes) {
      error.textContent = 'Добавьте фото или комментарий.';
      return;
    }
    button.disabled = true;
    error.textContent = '';
    const employee = employeeForUser();
    const reportID = crypto.randomUUID().toLowerCase();
    const now = new Date().toISOString();
    const remoteFileID = state.selectedPhoto ? `${state.user.organization_id}/reports/${reportID}.jpg` : null;
    const report = {
      id: reportID,
      title: String(values.get('title') || '').trim() || 'Фотоотчёт',
      notes,
      projectID: state.selectedProject,
      taskID: String(values.get('taskID') || '') || null,
      employeeID: employee?.id || null,
      employeeEmail: state.user.email,
      employeeName: employeeName(),
      remoteFileID,
      createdAt: now,
      updatedAt: now
    };
    try {
      if (state.selectedPhoto) await storePhoto(reportID, state.selectedPhoto);
      state.pending[`reports:${reportID}`] = { resource: 'reports', record: report };
      addOrReplace(state.reports, report);
      persist();
      modal.close();
      render();
      showToast('Фотоотчёт сохранён на устройстве.');
      await syncNow();
    } catch (saveError) {
      error.textContent = saveError.message || 'Не удалось сохранить фотоотчёт.';
      button.disabled = false;
    }
  }

  main.addEventListener('input', event => {
    if (event.target.id === 'project-search' || event.target.id === 'task-search') {
      state.search = event.target.value;
      const selection = event.target.selectionStart;
      render();
      const replacement = document.querySelector(`#${event.target.id}`);
      replacement?.focus();
      replacement?.setSelectionRange(selection, selection);
    }
  });

  main.addEventListener('click', event => {
    const open = event.target.closest('[data-open-project]');
    if (open) {
      openProject(open.dataset.openProject);
      return;
    }
    const filter = event.target.closest('[data-filter]');
    if (filter) {
      state.filter = filter.dataset.filter;
      render();
      return;
    }
    const action = event.target.closest('[data-action]');
    if (!action) return;
    if (action.dataset.action === 'sync') syncNow();
    else if (action.dataset.action === 'back') {
      state.route = 'projects';
      state.selectedProject = null;
      render();
    } else if (action.dataset.action === 'toggle-task') toggleTask(action.dataset.id);
    else if (action.dataset.action === 'start-timer') startTimer();
    else if (action.dataset.action === 'stop-timer') stopTimer();
    else if (action.dataset.action === 'new-report') openReportForm();
    else if (action.dataset.action === 'logout') {
      clearSession();
      state.route = 'projects';
      render();
    }
  });

  document.querySelectorAll('.bottom-nav [data-route]').forEach(button => {
    button.addEventListener('click', () => {
      state.route = button.dataset.route;
      state.selectedProject = null;
      state.search = '';
      state.filter = button.dataset.route === 'tasks' ? 'active' : 'all';
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  modal.addEventListener('click', event => {
    if (event.target === modal || event.target.closest('[data-close]')) modal.close();
  });

  window.addEventListener('online', () => {
    state.syncState = 'online';
    if (state.user) syncNow(false);
    else render();
  });
  window.addEventListener('offline', () => {
    state.syncState = 'offline';
    state.syncMessage = 'Нет подключения. Изменения сохраняются на устройстве.';
    render();
  });
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    state.installPrompt = event;
    document.querySelector('#topbar-action').hidden = false;
    document.querySelector('#topbar-action').textContent = 'Установить';
  });
  document.querySelector('#topbar-action').addEventListener('click', async () => {
    if (state.installPrompt) {
      state.installPrompt.prompt();
      await state.installPrompt.userChoice;
      state.installPrompt = null;
      document.querySelector('#topbar-action').textContent = '↻';
    } else if (state.selectedProject) openReportForm();
    else if (state.user) syncNow();
  });

  setInterval(() => {
    document.querySelectorAll('[data-elapsed]').forEach(element => {
      const start = new Date(element.dataset.elapsed).getTime();
      element.textContent = duration((Date.now() - start) / 1000);
    });
  }, 1000);

  async function initialize() {
    const savedUser = readUser();
    if (savedUser && token()) {
      state.user = savedUser;
      restoreCache();
      try { await restorePhotos(); }
      catch (error) {
        state.syncMessage = error.message;
        state.syncState = 'error';
      }
      render();
      syncNow(false);
    } else {
      clearSession();
      render();
    }
  }
  initialize();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(error => {
      console.error('Не удалось зарегистрировать офлайн-режим:', error);
    }));
  }
})();
