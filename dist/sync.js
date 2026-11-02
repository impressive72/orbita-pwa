(() => {
  const TOKEN_KEY = 'orbita-pwa-token-v1';
  const REFRESH_KEY = 'orbita-pwa-refresh-v1';
  const USER_KEY = 'orbita-pwa-user-v1';
  const CURSOR_KEY = account => `orbita-pwa-cursor-v1:${account}`;
  const SUPABASE_URL = 'https://laogfiekublnxeerqoae.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_HHYrVJLODneB3MdfnvkCIQ_SBl-CHCk';
  const DOC_ENTITIES = {
    invoice: 'Invoice',
    proposal: 'Proposal',
    estimate: 'Estimate',
    contract: 'Contract',
    act: 'Act'
  };
  const ITEM_ENTITIES = {
    invoice: 'InvoiceItem',
    proposal: 'ProposalItem',
    estimate: 'EstimateItem',
    act: 'ActItem'
  };
  const ENTITY_TYPES = Object.fromEntries(Object.entries(DOC_ENTITIES).map(([type, entity]) => [entity, type]));
  const ITEM_TYPES = Object.fromEntries(Object.entries(ITEM_ENTITIES).map(([type, entity]) => [entity, type]));
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function isoDate(value) {
    if (!value) return new Date().toISOString();
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value))
      ? new Date(`${value}T12:00:00.000Z`)
      : new Date(value);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  }

  function dateInput(value) {
    if (!value) return new Date().toISOString().slice(0, 10);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value).slice(0, 10) : date.toISOString().slice(0, 10);
  }

  function token() {
    return sessionStorage.getItem(TOKEN_KEY);
  }

  function user() {
    try { return JSON.parse(sessionStorage.getItem(USER_KEY) || 'null'); }
    catch { return null; }
  }

  async function request(path, options = {}, canRefresh = true) {
    const headers = new Headers(options.headers || {});
    headers.set('apikey', SUPABASE_KEY);
    if (token()) headers.set('Authorization', `Bearer ${token()}`);
    if (options.body) headers.set('Content-Type', 'application/json');
    const response = await fetch(`${SUPABASE_URL}/${path}`, {...options, headers, cache: 'no-store'});
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && canRefresh && token() && sessionStorage.getItem(REFRESH_KEY)) {
        const refreshed = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
          method: 'POST',
          headers: {'apikey': SUPABASE_KEY, 'Content-Type': 'application/json'},
          body: JSON.stringify({refresh_token: sessionStorage.getItem(REFRESH_KEY)}),
          cache: 'no-store'
        });
        const session = await refreshed.json().catch(() => ({}));
        if (refreshed.ok && session.access_token && session.refresh_token) {
          sessionStorage.setItem(TOKEN_KEY, session.access_token);
          sessionStorage.setItem(REFRESH_KEY, session.refresh_token);
          return request(path, options, false);
        }
        sessionStorage.removeItem(TOKEN_KEY);
        sessionStorage.removeItem(REFRESH_KEY);
        sessionStorage.removeItem(USER_KEY);
      }
      throw new Error(body.msg || body.message || body.error_description || body.error || `Ошибка Supabase: ${response.status}`);
    }
    return body;
  }

  function businessRecord(entity, id, fields, relations, updatedAt) {
    return {
      resource: 'business',
      id: `${entity}:${id}`,
      data: {entity, fields, relations, updatedAt}
    };
  }

  function stateRecords(state) {
    const records = [];
    for (const client of state.clients) {
      if (!UUID.test(client.id)) continue;
      const updatedAt = isoDate(client.updatedAt || client.createdAt);
      client.createdAt ||= updatedAt;
      client.updatedAt ||= updatedAt;
      const fields = {
        ...(client._syncFields || {}),
        name: client.name || '',
        inn: client.inn || '',
        kpp: client.kpp || '',
        ogrn: client.ogrn || '',
        address: client.address || '',
        phone: client.phone || '',
        email: client.email || '',
        bankName: client.bankName || '',
        bik: client.bik || '',
        account: client.account || '',
        correspondentAccount: client.correspondentAccount || '',
        signer: client.signer || '',
        signingBasis: client.signingBasis || '',
        notes: client.notes || '',
        isArchived: Boolean(client.isArchived),
        createdAt: isoDate(client.createdAt || updatedAt),
        updatedAt
      };
      if (!client.syncUpdatedAt || updatedAt > client.syncUpdatedAt) {
        records.push(businessRecord('Counterparty', client.id, fields, {}, updatedAt));
      }
    }

    for (const item of state.documents) {
      const entity = DOC_ENTITIES[item.type];
      if (!entity || !UUID.test(item.id)) continue;
      const updatedAt = isoDate(item.updatedAt || item.createdAt);
      item.createdAt ||= updatedAt;
      item.updatedAt ||= updatedAt;
      if (!item.syncUpdatedAt || updatedAt > item.syncUpdatedAt) {
        const fields = {
          ...(item._syncFields || {}),
          number: item.number || '',
          status: item.status || 'draft',
          notes: item.notes || '',
          createdAt: isoDate(item.createdAt || updatedAt),
          updatedAt
        };
        if (item.type === 'invoice') Object.assign(fields, {issueDate: isoDate(item.date || updatedAt), subtotal: total(item), total: total(item), currency: 'RUR', paymentTerms: fields.paymentTerms || '', vatMode: fields.vatMode || 'none', amountInWords: fields.amountInWords || '', isSent: item.status === 'sent', dueDate: fields.dueDate || null, vatAmount: Number(fields.vatAmount) || 0});
        if (item.type === 'proposal') Object.assign(fields, {issueDate: isoDate(item.date || updatedAt), subtotal: total(item), total: total(item), currency: 'RUR', title: item.title || '', paymentTerms: fields.paymentTerms || '', vatMode: fields.vatMode || 'none', validUntil: fields.validUntil || null, vatAmount: Number(fields.vatAmount) || 0, isSent: item.status === 'sent'});
        if (item.type === 'estimate') {
          const estimateChanged = (item.lines || []).some(line => line.localChanged);
          Object.assign(fields, {
            name: item.title || item.number || 'Смета',
            issueDate: isoDate(item.date || updatedAt),
            version: fields.version || '1',
            region: fields.region || '',
            vatMode: fields.vatMode || 'none',
            paymentTerms: fields.paymentTerms || '',
            vatRate: Number(fields.vatRate) || 0,
            totalMinimum: estimateChanged ? total(item) : Number(fields.totalMinimum ?? total(item)),
            totalMarket: estimateChanged ? total(item) : Number(fields.totalMarket ?? total(item)),
            totalMaximum: estimateChanged ? total(item) : Number(fields.totalMaximum ?? total(item))
          });
        }
        if (item.type === 'contract') Object.assign(fields, {kind: fields.kind || 'service', title: item.title || item.number || 'Договор', body: item.notes || fields.body || '', paymentTerms: fields.paymentTerms || '', version: fields.version || '1', issueDate: isoDate(item.date || updatedAt), startDate: fields.startDate || null, endDate: fields.endDate || null, total: total(item)});
        if (item.type === 'act') Object.assign(fields, {issueDate: isoDate(item.date || updatedAt), subtotal: total(item), total: total(item), kind: fields.kind || 'work', vatMode: fields.vatMode || 'none', currency: fields.currency || 'RUR', paymentTerms: fields.paymentTerms || '', vatAmount: Number(fields.vatAmount) || 0});
        records.push(businessRecord(entity, item.id, fields, {...(item._syncRelations || {}), counterparty: item.clientId || null}, updatedAt));
      }

      if (item.type === 'estimate') {
        if (!Array.isArray(item.sections)) item.sections = [];
        if (item.sections.length === 0) {
          if (!UUID.test(item.sectionId || '')) item.sectionId = crypto.randomUUID();
          item.sections.push({id: item.sectionId, name: 'Основные работы и материалы', notes: '', sortOrder: 0});
        }
        for (const section of item.sections) {
          if (!UUID.test(section.id || '')) section.id = crypto.randomUUID();
          state.syncSections[section.id] = item.id;
          const sectionLines = (item.lines || []).filter(line => (line.sectionId || item.sectionId || item.sections[0].id) === section.id);
          const sectionTotal = sectionLines.reduce((sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.price) || 0), 0);
          const sectionChanged = sectionLines.some(line => line.localChanged);
          const sectionUpdatedAt = sectionChanged ? updatedAt : isoDate(section.updatedAt || updatedAt);
          if (!section.syncUpdatedAt || sectionUpdatedAt > section.syncUpdatedAt) {
            records.push(businessRecord('EstimateSection', section.id, {
              ...(section._syncFields || {}),
              name: section.name || 'Основные работы и материалы',
              notes: section.notes || '',
              createdAt: isoDate(section.createdAt || item.createdAt || updatedAt),
              updatedAt: sectionUpdatedAt,
              sortOrder: Number(section.sortOrder) || 0,
              totalMinimum: sectionChanged ? sectionTotal : Number(section._syncFields?.totalMinimum ?? sectionTotal),
              totalMarket: sectionChanged ? sectionTotal : Number(section._syncFields?.totalMarket ?? sectionTotal),
              totalMaximum: sectionChanged ? sectionTotal : Number(section._syncFields?.totalMaximum ?? sectionTotal)
            }, {...(section._syncRelations || {}), estimate: item.id}, sectionUpdatedAt));
          }
        }
      }

      const itemEntity = ITEM_ENTITIES[item.type];
      if (!itemEntity) continue;
      for (let index = 0; index < (item.lines || []).length; index++) {
        const line = item.lines[index];
        if (!UUID.test(line.id || '')) line.id = crypto.randomUUID();
        const lineUpdatedAt = updatedAt;
        if (line.syncUpdatedAt && lineUpdatedAt <= line.syncUpdatedAt) continue;
        const quantity = Number(line.quantity) || 0;
        const price = Number(line.price) || 0;
        const fields = {
          ...(line._syncFields || {}),
          name: line.name || '',
          unit: line.unit || 'шт.',
          quantity,
          unitPrice: price,
          sortOrder: index,
          createdAt: isoDate(line.createdAt || item.createdAt || updatedAt),
          updatedAt: lineUpdatedAt
        };
        if (item.type === 'estimate') {
          Object.assign(fields, {
            kind: fields.kind || 'work',
            sourceURL: fields.sourceURL || '',
            sourceType: fields.sourceType || 'manual',
            sourceDate: fields.sourceDate || null,
            coefficient: Number(fields.coefficient) || 1,
            overheadPercent: Number(fields.overheadPercent) || 0,
            profitPercent: Number(fields.profitPercent) || 0,
            vatRate: Number(fields.vatRate) || 0,
            totalMinimum: line.localChanged ? quantity * price : Number(fields.totalMinimum ?? quantity * price),
            totalMarket: line.localChanged ? quantity * price : Number(fields.totalMarket ?? quantity * price),
            totalMaximum: line.localChanged ? quantity * price : Number(fields.totalMaximum ?? quantity * price)
          });
        } else {
          fields.total = quantity * price;
        }
        const parent = item.type === 'estimate'
          ? {section: line.sectionId || item.sectionId || item.sections[0].id}
          : ({invoice: {invoice: item.id}, proposal: {proposal: item.id}, act: {act: item.id}}[item.type]);
        records.push(businessRecord(itemEntity, line.id, fields, {...(line._syncRelations || {}), ...parent}, lineUpdatedAt));
      }
    }
    return records;
  }

  function total(item) {
    return (item.lines || []).reduce((sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.price) || 0), 0);
  }

  function markSynced(state, record) {
    const [entity, id] = record.id.split(':', 2);
    if (entity === 'Counterparty') {
      const client = state.clients.find(value => value.id === id);
      if (client) client.syncUpdatedAt = record.data.updatedAt;
    } else if (entity === 'EstimateSection') {
      const estimate = state.documents.find(value => value.id === record.data.relations.estimate);
      const section = estimate?.sections?.find(value => value.id === id);
      if (section) section.syncUpdatedAt = record.data.updatedAt;
    } else if (ITEM_TYPES[entity]) {
      const parentID = record.data.relations[ITEM_TYPES[entity]] || state.syncSections[record.data.relations.section];
      const object = state.documents.find(value => value.id === parentID);
      if (!object) return;
      const line = (object.lines || []).find(value => value.id === id);
      if (line) {
        line.syncUpdatedAt = record.data.updatedAt;
        delete line.localChanged;
      }
    } else {
      const document = state.documents.find(value => value.id === id);
      if (document) document.syncUpdatedAt = record.data.updatedAt;
    }
  }

  function removeRemote(state, entity, id) {
    if (entity === 'Counterparty') state.clients = state.clients.filter(value => value.id !== id);
    const type = ENTITY_TYPES[entity];
    if (type) state.documents = state.documents.filter(value => !(value.type === type && value.id === id));
    const lineType = ITEM_TYPES[entity];
    if (lineType) {
      for (const document of state.documents) {
        if (document.type === lineType) document.lines = (document.lines || []).filter(value => value.id !== id);
      }
    }
    if (entity === 'EstimateSection') {
      delete state.syncSections[id];
      for (const document of state.documents) {
        if (document.type !== 'estimate') continue;
        document.sections = (document.sections || []).filter(value => value.id !== id);
        if (document.sectionId === id) document.sectionId = document.sections[0]?.id || '';
      }
    }
  }

  function applyRemote(state, change) {
    const [entity, id] = String(change.id || '').split(':', 2);
    if (!entity || !UUID.test(id || '')) return;
    state.deletedRecords = state.deletedRecords.filter(record => record.id !== change.id);
    if (change.deleted) {
      removeRemote(state, entity, id);
      return;
    }
    const data = change.data;
    if (!data || data.entity !== entity || !data.fields || typeof data.fields !== 'object') return;
    const fields = data.fields;
    const relations = data.relations || {};
    const updatedAt = isoDate(data.updatedAt || fields.updatedAt || fields.createdAt);
    if (entity === 'Counterparty') {
      const existing = state.clients.find(value => value.id === id);
      if (existing?.updatedAt && isoDate(existing.updatedAt) > updatedAt) return;
      const client = existing || {id};
      for (const key of ['name','inn','phone','email','address','kpp','ogrn','bankName','bik','account','correspondentAccount','signer','signingBasis','notes','isArchived']) {
        if (fields[key] !== undefined && fields[key] !== null) client[key] = fields[key];
      }
      client.createdAt = fields.createdAt || client.createdAt || updatedAt;
      client.updatedAt = updatedAt;
      client.syncUpdatedAt = updatedAt;
      client._syncFields = {...fields};
      if (!existing) state.clients.push(client);
      return;
    }
    if (entity === 'EstimateSection') {
      state.syncSections[id] = relations.estimate || '';
      const document = state.documents.find(value => value.type === 'estimate' && value.id === relations.estimate);
      if (document) {
        if (!Array.isArray(document.sections)) document.sections = [];
        let section = document.sections.find(value => value.id === id);
        if (!section) {
          section = {id};
          document.sections.push(section);
        }
        if (!section.updatedAt || isoDate(section.updatedAt) <= updatedAt) {
          for (const key of ['name','notes','sortOrder','createdAt','updatedAt']) {
            if (fields[key] !== undefined && fields[key] !== null) section[key] = fields[key];
          }
          section.updatedAt = updatedAt;
          section.syncUpdatedAt = updatedAt;
          section._syncFields = {...fields};
          section._syncRelations = {...relations};
        }
        document.sectionId ||= id;
      }
      return;
    }
    const type = ENTITY_TYPES[entity];
    if (type) {
      const existing = state.documents.find(value => value.type === type && value.id === id);
      if (existing?.updatedAt && isoDate(existing.updatedAt) > updatedAt) return;
      const document = existing || {id, type, lines: [], createdAt: updatedAt};
      document.number = fields.number || document.number || '';
      document.status = fields.status || document.status || 'draft';
      document.date = dateInput(fields.issueDate || fields.createdAt || updatedAt);
      document.title = fields.title || fields.name || document.title || '';
      document.notes = fields.notes || fields.body || '';
      document.clientId = relations.counterparty || '';
      document.updatedAt = updatedAt;
      document.syncUpdatedAt = updatedAt;
      document._syncFields = {...fields};
      document._syncRelations = {...relations};
      if (!existing) state.documents.push(document);
      return;
    }
    const itemType = ITEM_TYPES[entity];
    if (!itemType) return;
    let parentID = itemType === 'estimate' ? state.syncSections[relations.section] : relations[itemType];
    if (!parentID && itemType === 'estimate') parentID = relations.estimate;
    const document = state.documents.find(value => value.type === itemType && value.id === parentID);
    if (!document) return;
    if (document.updatedAt && isoDate(document.updatedAt) > updatedAt) return;
    const line = {
      id,
      name: fields.name || '',
      unit: fields.unit || 'шт.',
      quantity: Number(fields.quantity) || 0,
      price: Number(fields.unitPrice) || 0,
      syncUpdatedAt: updatedAt,
      sectionId: relations.section || '',
      _syncFields: {...fields},
      _syncRelations: {...relations}
    };
    const index = document.lines.findIndex(value => value.id === id);
    if (index >= 0) document.lines[index] = line;
    else document.lines.push(line);
  }

  async function pull(state, account) {
    let cursor = Number(localStorage.getItem(CURSOR_KEY(account)) || 0);
    let downloaded = 0;
    let more = true;
    while (more) {
      const result = await request(`rest/v1/orbita_changes?select=cursor,resource,record_id,version,data,deleted&cursor=gt.${cursor}&order=cursor.asc&limit=500`);
      if (!Array.isArray(result)) throw new Error('Supabase вернул некорректный пакет синхронизации.');
      for (const row of result) {
        if (!Number.isInteger(Number(row.cursor)) || typeof row.resource !== 'string' || typeof row.record_id !== 'string') {
          throw new Error('Supabase вернул запись с неожиданным форматом.');
        }
        const change = {
          cursor: Number(row.cursor),
          resource: row.resource,
          id: row.record_id,
          data: row.data,
          deleted: Boolean(row.deleted)
        };
        if (change.resource === 'business') {
          applyRemote(state, change);
          downloaded++;
        }
        cursor = Math.max(cursor, change.cursor);
      }
      window.orbitaPWA.saveState();
      localStorage.setItem(CURSOR_KEY(account), String(cursor));
      more = result.length === 500;
    }
    return downloaded;
  }

  async function push(state) {
    const records = stateRecords(state);
    window.orbitaPWA.saveState();
    const tombstones = [...state.deletedRecords];
    const changes = [
      ...records.map(({id, data}) => ({id, data})),
      ...tombstones.map(({id}) => ({id, deleted: true}))
    ];
    if (changes.length === 0) return 0;
    const account = user();
    if (!account?.organization_id) throw new Error('Профиль Supabase не содержит организацию.');
    let uploaded = 0;
    for (let offset = 0; offset < changes.length; offset += 20) {
      const batch = changes.slice(offset, offset + 20);
      await request('rest/v1/orbita_records?on_conflict=organization_id,resource,record_id', {
        method: 'POST',
        headers: {Prefer: 'resolution=merge-duplicates,return=minimal'},
        body: JSON.stringify(batch.map(change => ({
          organization_id: account.organization_id,
          resource: 'business',
          record_id: change.id,
          data: change.data || {},
          deleted: Boolean(change.deleted)
        })))
      });
      for (const change of batch) {
        if (!change.deleted) {
          const record = records.find(value => value.id === change.id);
          if (record) markSynced(state, record);
        }
      }
      uploaded += batch.length;
    }
    const sentTombstones = new Set(tombstones.map(item => item.id));
    state.deletedRecords = state.deletedRecords.filter(item => !sentTombstones.has(item.id));
    return uploaded;
  }

  async function syncNow(panel) {
    const status = panel.querySelector('#sync-status');
    const button = panel.querySelector('#sync-now');
    button.disabled = true;
    status.textContent = 'Получаю изменения с сервера…';
    try {
      const account = user()?.email;
      if (!account) throw new Error('Войдите в аккаунт администратора.');
      const state = window.orbitaPWA.getState();
      const downloaded = await pull(state, account);
      window.orbitaPWA.saveState();
      const uploaded = await push(state);
      window.orbitaPWA.saveState();
      window.orbitaPWA.setState(state);
      toast(`Синхронизация завершена: отправлено ${uploaded}, получено ${downloaded}.`);
    } catch (error) {
      if (!token()) {
        mount(panel);
        panel.querySelector('#sync-status').textContent = error.message || 'Сессия истекла. Войдите снова.';
      } else {
        status.textContent = error.message || 'Не удалось выполнить синхронизацию.';
      }
      button.disabled = false;
      return;
    }
    status.textContent = 'Синхронизация завершена.';
    button.disabled = false;
  }

  function mount(panel) {
    if (!panel) return;
    const currentUser = user();
    if (token() && currentUser?.role === 'admin') {
      panel.innerHTML = `<p class="sync-user">Подключено: <b>${escapeHTML(currentUser.email)}</b> · администратор</p>
        <div class="actions"><button class="button primary" id="sync-now">Синхронизировать</button><button class="button" id="sync-logout">Выйти</button></div>
        <p id="sync-status" class="muted" role="status">Подключено к общей базе Supabase.</p>`;
      panel.querySelector('#sync-now').addEventListener('click', () => syncNow(panel));
      panel.querySelector('#sync-logout').addEventListener('click', () => {
        sessionStorage.removeItem(TOKEN_KEY);
        sessionStorage.removeItem(REFRESH_KEY);
        sessionStorage.removeItem(USER_KEY);
        mount(panel);
      });
      return;
    }
    panel.innerHTML = `<form id="sync-login" class="sync-form">
        <div class="field"><label for="sync-email">Email администратора</label><input id="sync-email" name="email" type="email" autocomplete="username" required></div>
        <div class="field"><label for="sync-password">Пароль</label><input id="sync-password" name="password" type="password" autocomplete="current-password" required></div>
        <button class="button primary" type="submit">Подключить базу</button>
      </form><p id="sync-status" class="muted" role="status">Вход и синхронизация выполняются через Supabase.</p>`;
    panel.querySelector('#sync-login').addEventListener('submit', async event => {
      event.preventDefault();
      const status = panel.querySelector('#sync-status');
      const submit = event.currentTarget.querySelector('[type="submit"]');
      const form = new FormData(event.currentTarget);
      submit.disabled = true;
      status.textContent = 'Проверяю доступ…';
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(REFRESH_KEY);
      sessionStorage.removeItem(USER_KEY);
      try {
        const session = await request('auth/v1/token?grant_type=password', {
          method: 'POST',
          body: JSON.stringify({email: form.get('email'), password: form.get('password')})
        }, false);
        if (!session.access_token || !session.refresh_token || !session.user?.id || !session.user?.email) {
          throw new Error('Supabase вернул неполные данные входа.');
        }
        sessionStorage.setItem(TOKEN_KEY, session.access_token);
        sessionStorage.setItem(REFRESH_KEY, session.refresh_token);
        const profiles = await request(`rest/v1/orbita_profiles?select=organization_id,role&user_id=eq.${encodeURIComponent(session.user.id)}`);
        const profile = profiles[0];
        if (!profile?.organization_id || !profile?.role) throw new Error('Для аккаунта не настроен профиль Орбиты.');
        if (profile.role !== 'admin') throw new Error('Для синхронизации бизнес-данных нужна учётная запись администратора.');
        sessionStorage.setItem(USER_KEY, JSON.stringify({
          email: session.user.email,
          role: profile.role,
          organization_id: profile.organization_id
        }));
        mount(panel);
      } catch (error) {
        if (!user()) {
          sessionStorage.removeItem(TOKEN_KEY);
          sessionStorage.removeItem(REFRESH_KEY);
          sessionStorage.removeItem(USER_KEY);
        }
        status.textContent = error.message || 'Не удалось войти.';
        submit.disabled = false;
      }
      event.currentTarget.reset();
    });
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>'"]/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[character]);
  }

  window.orbitaSync = {mount};
})();
