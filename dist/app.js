const STORE_KEY = 'smeta-business-pwa-v1';
const COMPANY = {
  name: 'ИП ЛИПАТОВА ОЛЬГА ЮРЬЕВНА',
  fullName: 'ЛИПАТОВА ОЛЬГА ЮРЬЕВНА (ИП)',
  address: '456506, РОССИЯ, Челябинская область, Сосновский, Садовый, ул Первомайская, 13, 2',
  inn: '743801685451', account: '40802810709680000778', currency: 'RUR',
  bank: 'АО «АЛЬФА-БАНК»', bankInn: '7728168971', bik: '044525593',
  correspondent: '30101810200000000593',
  bankAddress: '454003, Челябинская область, г. Челябинск, ул. Чичерина, д. 38 В.'
};
const TYPES = {
  invoice: {one:'Счёт', many:'Счета', icon:'СЧ'}, proposal:{one:'КП',many:'Коммерческие предложения',icon:'КП'},
  estimate:{one:'Смета',many:'Сметы',icon:'СМ'}, contract:{one:'Договор',many:'Договоры',icon:'Д'}, act:{one:'Акт',many:'Акты',icon:'А'}
};
const STATUS = {draft:'Черновик',sent:'Отправлен',paid:'Оплачен'};
const money = value => new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:2}).format(Number(value)||0);
const dateText = value => new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(value));
const today = () => new Date().toISOString().slice(0,10);
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

let state = loadState();
if (!Array.isArray(state.deletedRecords)) state.deletedRecords = [];
if (!state.syncSections || typeof state.syncSections !== 'object') state.syncSections = {};
let catalog = [];
let route = 'home';
let docFilter = 'invoice';
let installPrompt;
const main = document.querySelector('#main');
const title = document.querySelector('#page-title');
const modal = document.querySelector('#modal');
const modalContent = document.querySelector('#modal-content');

function loadState() {
  try { return {...{documents:[],clients:[],profile:COMPANY}, ...JSON.parse(localStorage.getItem(STORE_KEY))}; }
  catch { return {documents:[],clients:[],profile:COMPANY}; }
}
function saveState(message) {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  if (message) toast(message);
}
function toast(message) {
  const element = document.querySelector('#toast');
  element.textContent = message; element.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => element.classList.remove('show'),2200);
}
function total(document) { return (document.lines || []).reduce((sum,line) => sum + (Number(line.quantity)||0)*(Number(line.price)||0),0); }
function markDeleted(entity, id) {
  if (!id) return;
  const recordId = `${entity}:${id}`;
  if (!state.deletedRecords.some(item => item.id === recordId)) {
    state.deletedRecords.push({resource:'business',id:recordId});
  }
}
function nextNumber(type) {
  const prefixes = {invoice:'СЧ',proposal:'КП',estimate:'СМ',contract:'Д',act:'А'};
  const count = state.documents.filter(item => item.type === type).length + 1;
  return `${prefixes[type]}-${new Date().getFullYear()}-${String(count).padStart(4,'0')}`;
}

function navigate(next) {
  route = next;
  document.querySelectorAll('.bottom-nav button').forEach(button => button.classList.toggle('active',button.dataset.route === route));
  render(); window.scrollTo({top:0,behavior:'smooth'});
}
document.querySelector('.bottom-nav').addEventListener('click', event => {
  const button = event.target.closest('button[data-route]'); if (button) navigate(button.dataset.route);
});
document.querySelector('#quick-add').addEventListener('click', () => openDocumentEditor());

function render() {
  const views = {home:renderHome,documents:renderDocuments,catalog:renderCatalog,clients:renderClients,more:renderMore};
  views[route]();
}
function empty(titleText, description) { return `<div class="empty"><b>${titleText}</b>${description}</div>`; }
function statusBadge(value) { return `<span class="status ${esc(value)}">${STATUS[value] || esc(value)}</span>`; }
function documentRow(document) {
  const client = state.clients.find(item => item.id === document.clientId)?.name || 'Контрагент не выбран';
  return `<button class="list-row" data-doc-id="${document.id}">
    <span class="row-icon">${TYPES[document.type].icon}</span><span class="row-main"><span class="row-title">${TYPES[document.type].one} № ${esc(document.number)}</span><span class="row-sub">${esc(client)} · ${dateText(document.date)}</span></span>
    <span><span class="row-value">${money(total(document))}</span><br>${statusBadge(document.status)}</span></button>`;
}

function renderHome() {
  title.textContent = 'Орбита';
  const waiting = state.documents.filter(item => item.status !== 'paid').reduce((sum,item) => sum + total(item),0);
  const unpaid = state.documents.filter(item => item.type === 'invoice' && item.status !== 'paid').length;
  const recent = [...state.documents].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0,5);
  main.innerHTML = `<section class="grid metrics">
    <article class="card metric"><span class="metric-icon">₽</span><div><strong>${money(waiting)}</strong><small>К получению</small></div></article>
    <article class="card metric"><span class="metric-icon">◷</span><div><strong>${unpaid}</strong><small>Неоплаченных счетов</small></div></article>
    <article class="card metric wide"><span class="metric-icon">▤</span><div><strong>${state.documents.length}</strong><small>Документов в базе</small></div></article>
  </section>
  <div class="section-head"><h2>Последние документы</h2><button class="button small" data-go="documents">Все</button></div>
  <section class="list">${recent.length ? recent.map(documentRow).join('') : empty('Документов пока нет','Нажмите «+», чтобы создать первый документ.')}</section>`;
  bindDocumentRows();
  main.querySelector('[data-go]')?.addEventListener('click',() => navigate('documents'));
}

function renderDocuments() {
  title.textContent = TYPES[docFilter].many;
  const filtered = state.documents.filter(item => item.type === docFilter).sort((a,b) => b.date.localeCompare(a.date));
  main.innerHTML = `<div class="chips">${Object.entries(TYPES).map(([key,value]) => `<button class="chip ${key===docFilter?'active':''}" data-type="${key}">${value.one}</button>`).join('')}</div>
    <input class="search" id="document-search" placeholder="Поиск по номеру или клиенту">
    <section class="list" id="document-list">${filtered.length ? filtered.map(documentRow).join('') : empty(`Нет: ${TYPES[docFilter].many.toLowerCase()}`,'Создайте документ кнопкой «+».')}</section>`;
  main.querySelectorAll('[data-type]').forEach(button => button.addEventListener('click',() => {docFilter=button.dataset.type;renderDocuments();}));
  main.querySelector('#document-search').addEventListener('input',event => {
    const q = event.target.value.toLowerCase();
    const rows = filtered.filter(document => {
      const client = state.clients.find(item => item.id === document.clientId)?.name || '';
      return document.number.toLowerCase().includes(q) || client.toLowerCase().includes(q);
    });
    main.querySelector('#document-list').innerHTML = rows.length ? rows.map(documentRow).join('') : empty('Ничего не найдено','Измените строку поиска.');
    bindDocumentRows();
  });
  bindDocumentRows();
}
function bindDocumentRows() { document.querySelectorAll('[data-doc-id]').forEach(row => row.addEventListener('click',() => openDocumentEditor(row.dataset.docId))); }

function openDocumentEditor(id, draftOverride = null) {
  const existing = state.documents.find(item => item.id === id);
  const document = draftOverride ? structuredClone(draftOverride) : existing ? structuredClone(existing) : {id:uid(),type:docFilter,number:nextNumber(docFilter),date:today(),status:'draft',clientId:'',title:'',notes:'',lines:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  const hasLines = document.type !== 'contract';
  modalContent.innerHTML = `<form id="document-form">
    <div class="modal-head"><button class="button small" type="button" data-close>Отмена</button><h3>${existing?'Редактирование':'Новый документ'}</h3><button class="button primary small" type="submit">Сохранить</button></div>
    <div class="modal-body">
      <section class="form-section"><h3>Документ</h3>
        <div class="two-col"><div class="field"><label>Тип</label><select name="type">${Object.entries(TYPES).map(([key,value])=>`<option value="${key}" ${key===document.type?'selected':''}>${value.one}</option>`).join('')}</select></div><div class="field"><label>Номер</label><input name="number" required value="${esc(document.number)}"></div></div>
        <div class="two-col"><div class="field"><label>Дата</label><input type="date" name="date" value="${document.date}"></div><div class="field"><label>Статус</label><select name="status">${Object.entries(STATUS).map(([key,value])=>`<option value="${key}" ${key===document.status?'selected':''}>${value}</option>`).join('')}</select></div></div>
        <div class="field"><label>Контрагент</label><select name="clientId"><option value="">Не выбран</option>${state.clients.map(client=>`<option value="${client.id}" ${client.id===document.clientId?'selected':''}>${esc(client.name)}</option>`).join('')}</select></div>
        ${(document.type==='proposal'||document.type==='estimate'||document.type==='contract')?`<div class="field"><label>Название</label><input name="title" value="${esc(document.title)}"></div>`:''}
        <div class="field"><label>Комментарий</label><textarea name="notes">${esc(document.notes)}</textarea></div>
      </section>
      ${hasLines ? `<section class="form-section"><h3>Позиции</h3><div id="lines"></div><div class="actions"><button class="button" type="button" id="from-catalog">Из прайса</button><button class="button" type="button" id="manual-line">Вручную</button></div><div class="total-box"><span>Итого</span><span id="editor-total">${money(total(document))}</span></div></section>`:''}
      <div class="actions">${existing?`<button class="button" type="button" id="print-document">Печать / PDF</button><button class="button danger" type="button" id="delete-document">Удалить</button>`:''}</div>
    </div></form>`;
  if (!modal.open) modal.showModal();
  const form = modalContent.querySelector('#document-form');
  const renderLines = () => {
    if (!hasLines) return;
    form.querySelector('#lines').innerHTML = document.lines.length ? document.lines.map((line,index) => `<div class="line-item" data-index="${index}">
      <div><small class="muted">Наименование</small><input data-field="name" value="${esc(line.name)}"></div><div><small class="muted">Кол-во</small><input inputmode="decimal" data-field="quantity" value="${line.quantity}"></div><div><small class="muted">Цена</small><input inputmode="decimal" data-field="price" value="${line.price}"></div><button type="button" class="remove-line">×</button></div>`).join('') : `<p class="muted">Добавьте работы или материалы.</p>`;
    form.querySelector('#editor-total').textContent = money(total(document));
    form.querySelectorAll('.line-item').forEach(row => {
      const index = Number(row.dataset.index);
      row.querySelectorAll('input').forEach(input => input.addEventListener('input',() => {document.lines[index][input.dataset.field] = input.dataset.field==='name'?input.value:Number(input.value.replace(',','.'));document.lines[index].localChanged=true;form.querySelector('#editor-total').textContent=money(total(document));}));
      row.querySelector('.remove-line').addEventListener('click',() => {const itemEntities={invoice:'InvoiceItem',proposal:'ProposalItem',estimate:'EstimateItem',act:'ActItem'};markDeleted(itemEntities[document.type],document.lines[index].id);document.lines.splice(index,1);renderLines();});
    });
  };
  renderLines();
  form.querySelector('[data-close]').addEventListener('click',closeModal);
  form.querySelector('[name="type"]').addEventListener('change',event => { if (!existing) { closeModal(); docFilter=event.target.value; openDocumentEditor(); } });
  form.querySelector('#manual-line')?.addEventListener('click',() => {document.lines.push({id:uid(),name:'',unit:'шт.',quantity:1,price:0});renderLines();});
  form.querySelector('#from-catalog')?.addEventListener('click',() => openCatalogPicker(selected => {
    document.lines.push(...selected.map(item=>({id:uid(),catalogId:item.id,name:item.name,unit:item.unit,quantity:1,price:item.price})));
    openDocumentEditor(existing ? document.id : null, document);
  }, () => openDocumentEditor(existing ? document.id : null, document)));
  form.querySelector('#print-document')?.addEventListener('click',() => printDocument(document));
  form.querySelector('#delete-document')?.addEventListener('click',() => {if(confirm('Удалить документ без возможности восстановления?')){const entities={invoice:['Invoice','InvoiceItem'],proposal:['Proposal','ProposalItem'],estimate:['Estimate','EstimateItem'],contract:['Contract'],act:['Act','ActItem']}[document.type]||[];entities.slice(1).forEach(entity=>(document.lines||[]).forEach(line=>markDeleted(entity,line.id)));if(document.type==='estimate')for(const section of document.sections||[])markDeleted('EstimateSection',section.id);markDeleted(entities[0],document.id);state.documents=state.documents.filter(item=>item.id!==document.id);saveState('Документ удалён');closeModal();render();}});
  form.addEventListener('submit',event => {
    event.preventDefault(); const data = new FormData(form);
    document.type=data.get('type'); document.number=String(data.get('number')).trim(); document.date=data.get('date'); document.status=data.get('status'); document.clientId=data.get('clientId'); document.title=data.get('title')||''; document.notes=data.get('notes')||''; document.updatedAt=new Date().toISOString();
    const index=state.documents.findIndex(item=>item.id===document.id); if(index>=0)state.documents[index]=document;else state.documents.push(document);
    saveState('Документ сохранён'); closeModal(); render();
  });
}
function openCatalogPicker(onAdd, onCancel) {
  modalContent.innerHTML = `<div class="modal-head"><button class="button small" data-back>Назад</button><h3>Выбор позиций</h3><button class="button primary small" id="add-selected">Добавить</button></div><div class="modal-body"><input class="search" id="picker-search" placeholder="Работа или материал"><div id="picker-list"></div></div>`;
  const selected = new Set();
  const draw = query => {
    const items = catalog.filter(item => !query || item.name.toLowerCase().includes(query)||item.category.toLowerCase().includes(query)).slice(0,220);
    modalContent.querySelector('#picker-list').innerHTML = items.map(item=>`<label class="catalog-choice"><input type="checkbox" value="${item.id}" ${selected.has(item.id)?'checked':''}><span><b>${esc(item.name)}</b><br><small class="muted">${esc(item.category)} · ${money(item.price)}/${esc(item.unit)}</small></span></label>`).join('');
    modalContent.querySelectorAll('[type="checkbox"]').forEach(box=>box.addEventListener('change',()=>box.checked?selected.add(box.value):selected.delete(box.value)));
  };
  draw(''); modalContent.querySelector('#picker-search').addEventListener('input',event=>draw(event.target.value.toLowerCase()));
  modalContent.querySelector('[data-back]').addEventListener('click',onCancel);
  modalContent.querySelector('#add-selected').addEventListener('click',()=>{onAdd(catalog.filter(item=>selected.has(item.id)));});
}

function renderCatalog() {
  title.textContent = 'Прайс';
  main.innerHTML = `<input class="search" id="catalog-search" placeholder="Поиск работы или материала"><div class="chips"><button class="chip active" data-kind="all">Все</button><button class="chip" data-kind="work">Работы</button><button class="chip" data-kind="material">Материалы</button></div><section class="list" id="catalog-list"></section>`;
  let kind='all',query='';
  const draw=()=>{
    const items=catalog.filter(item=>(kind==='all'||item.kind===kind)&&(!query||item.name.toLowerCase().includes(query)||item.category.toLowerCase().includes(query)));
    main.querySelector('#catalog-list').innerHTML=items.length?items.slice(0,300).map(item=>`<div class="list-row"><span class="row-icon">${item.kind==='work'?'Р':'М'}</span><span class="row-main"><span class="row-title">${esc(item.name)}</span><span class="row-sub">${esc(item.category)} · ${esc(item.unit)}</span></span><span class="row-value">${money(item.price)}</span></div>`).join(''):empty('Ничего не найдено','Измените фильтр.');
  };
  main.querySelector('#catalog-search').addEventListener('input',event=>{query=event.target.value.toLowerCase();draw();});
  main.querySelectorAll('[data-kind]').forEach(button=>button.addEventListener('click',()=>{kind=button.dataset.kind;main.querySelectorAll('[data-kind]').forEach(x=>x.classList.toggle('active',x===button));draw();}));draw();
}

function renderClients() {
  title.textContent='Клиенты';
  main.innerHTML=`<div class="section-head"><h2>Контрагенты</h2><button class="button primary small" id="new-client">Добавить</button></div><input class="search" id="client-search" placeholder="Название или ИНН"><section class="list" id="client-list"></section>`;
  const draw=query=>{const clients=state.clients.filter(item=>!query||item.name.toLowerCase().includes(query)||item.inn.includes(query));main.querySelector('#client-list').innerHTML=clients.length?clients.map(client=>`<button class="list-row" data-client-id="${client.id}"><span class="row-icon">К</span><span class="row-main"><span class="row-title">${esc(client.name)}</span><span class="row-sub">${client.inn?'ИНН '+esc(client.inn):'ИНН не указан'}${client.phone?' · '+esc(client.phone):''}</span></span></button>`).join(''):empty('Клиентов пока нет','Добавьте первого контрагента.');main.querySelectorAll('[data-client-id]').forEach(row=>row.addEventListener('click',()=>openClientEditor(row.dataset.clientId)));};
  main.querySelector('#new-client').addEventListener('click',()=>openClientEditor());main.querySelector('#client-search').addEventListener('input',event=>draw(event.target.value.toLowerCase()));draw('');
}
function openClientEditor(id) {
  const existing=state.clients.find(item=>item.id===id); const client=existing?{...existing}:{id:uid(),name:'',inn:'',phone:'',email:'',address:''};
  modalContent.innerHTML=`<form id="client-form"><div class="modal-head"><button class="button small" type="button" data-close>Отмена</button><h3>${existing?'Клиент':'Новый клиент'}</h3><button class="button primary small">Сохранить</button></div><div class="modal-body"><section class="form-section"><div class="field"><label>Наименование</label><input required name="name" value="${esc(client.name)}"></div><div class="field"><label>ИНН</label><input inputmode="numeric" name="inn" value="${esc(client.inn)}"></div><div class="field"><label>Телефон</label><input inputmode="tel" name="phone" value="${esc(client.phone)}"></div><div class="field"><label>Email</label><input type="email" name="email" value="${esc(client.email)}"></div><div class="field"><label>Адрес</label><textarea name="address">${esc(client.address)}</textarea></div></section>${existing?'<button class="button danger" type="button" id="delete-client">Удалить клиента</button>':''}</div></form>`;
  if (!modal.open) modal.showModal();const form=modalContent.querySelector('form');form.querySelector('[data-close]').addEventListener('click',closeModal);form.querySelector('#delete-client')?.addEventListener('click',()=>{if(confirm('Удалить клиента?')){markDeleted('Counterparty',id);state.clients=state.clients.filter(item=>item.id!==id);saveState('Клиент удалён');closeModal();renderClients();}});form.addEventListener('submit',event=>{event.preventDefault();const data=new FormData(form);['name','inn','phone','email','address'].forEach(key=>client[key]=String(data.get(key)||'').trim());const index=state.clients.findIndex(item=>item.id===client.id);if(index>=0)state.clients[index]=client;else{client.createdAt=new Date().toISOString();state.clients.push(client);}client.updatedAt=new Date().toISOString();const deletedId=`Counterparty:${client.id}`;state.deletedRecords=state.deletedRecords.filter(item=>item.id!==deletedId);saveState('Клиент сохранён');closeModal();renderClients();});
}

function renderMore() {
  title.textContent='Ещё';
  const standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone;
  main.innerHTML=`<section class="card install-card"><h2>${standalone?'Приложение установлено':'Установить на iPhone'}</h2><p class="muted">${standalone?'Орбита работает в полноэкранном режиме и доступна офлайн.':'Откройте меню «Поделиться» в Safari и выберите «На экран Домой».'}</p>${installPrompt?'<button class="button" id="install-app">Установить</button>':''}</section>
  <div class="section-head"><h2>Моя компания</h2></div><section class="card"><div class="setting-row"><b>Организация</b><span>${esc(COMPANY.name)}</span></div><div class="setting-row"><b>ИНН</b><span>${COMPANY.inn}</span></div><div class="setting-row"><b>Расчётный счёт</b><span>${COMPANY.account}</span></div><div class="setting-row"><b>Банк</b><span>${esc(COMPANY.bank)}<br>БИК ${COMPANY.bik}</span></div></section>
  <div class="section-head"><h2>Данные</h2></div><section class="card"><div class="setting-row"><b>Документы</b><span>${state.documents.length}</span></div><div class="setting-row"><b>Клиенты</b><span>${state.clients.length}</span></div><div class="setting-row"><b>Позиции прайса</b><span>${catalog.length}</span></div><div class="actions"><button class="button" id="export-data">Сохранить копию</button><label class="button" for="import-data">Восстановить<input hidden type="file" id="import-data" accept="application/json"></label></div></section>
  <section class="card sync-card"><h2>Синхронизация</h2><p class="muted">Войдите под администратором, чтобы синхронизировать клиентов и документы с Орбитой.</p><div id="sync-panel"></div></section>
  <p class="muted">Без входа данные хранятся только в этом браузере. Не очищайте данные Safari без сохранённой копии.</p>`;
  main.querySelector('#install-app')?.addEventListener('click',async()=>{installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;renderMore();});
  main.querySelector('#export-data').addEventListener('click',exportData);main.querySelector('#import-data').addEventListener('change',importData);
  window.orbitaSync?.mount(main.querySelector('#sync-panel'));
}
function exportData(){const blob=new Blob([JSON.stringify({...state,exportedAt:new Date().toISOString()},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`smeta-business-${today()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Копия подготовлена');}
function importData(event){const file=event.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=()=>{try{const data=JSON.parse(reader.result);if(!Array.isArray(data.documents)||!Array.isArray(data.clients))throw new Error();if(confirm('Заменить текущие документы и клиентов данными из файла?')){state={...state,...data};saveState('Данные восстановлены');renderMore();}}catch{toast('Файл не подходит');}};reader.readAsText(file);}

function printDocument(document) {
  const client=state.clients.find(item=>item.id===document.clientId)||{};
  const popup=window.open('','_blank');
  popup.document.write(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${TYPES[document.type].one} ${esc(document.number)}</title><style>body{font:14px Arial;color:#111;margin:38px}h1{font-size:24px}.muted{color:#555}.bank{border:1px solid #222;padding:10px;margin:18px 0}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{border:1px solid #555;padding:7px;text-align:left}th:nth-child(n+3),td:nth-child(n+3){text-align:right}.total{text-align:right;font-size:18px;font-weight:bold;margin-top:18px}.sign{margin-top:55px;display:flex;justify-content:space-between}@page{size:A4;margin:14mm}</style></head><body><div class="muted">${esc(COMPANY.name)} · ИНН ${COMPANY.inn}</div><h1>${TYPES[document.type].one} № ${esc(document.number)} от ${dateText(document.date)}</h1><div class="bank"><b>${esc(COMPANY.bank)}</b><br>БИК ${COMPANY.bik} · к/с ${COMPANY.correspondent}<br>Получатель: ${esc(COMPANY.fullName)} · ИНН ${COMPANY.inn}<br>Счёт ${COMPANY.account}</div><p><b>Заказчик:</b> ${esc(client.name||'Не указан')}${client.inn?' · ИНН '+esc(client.inn):''}</p>${document.title?`<p><b>${esc(document.title)}</b></p>`:''}<table><thead><tr><th>№</th><th>Наименование</th><th>Кол-во</th><th>Цена</th><th>Сумма</th></tr></thead><tbody>${(document.lines||[]).map((line,index)=>`<tr><td>${index+1}</td><td>${esc(line.name)}</td><td>${line.quantity} ${esc(line.unit||'')}</td><td>${money(line.price)}</td><td>${money(Number(line.quantity)*Number(line.price))}</td></tr>`).join('')}</tbody></table><div class="total">Итого: ${money(total(document))}<br><small>Без НДС</small></div>${document.notes?`<p>${esc(document.notes)}</p>`:''}<div class="sign"><span>ИП __________________</span><span>Липатова О. Ю.</span></div><script>onload=()=>setTimeout(()=>print(),300)<\/script></body></html>`);popup.document.close();
}
function closeModal(){modal.close();modalContent.innerHTML='';}
modal.addEventListener('click',event=>{if(event.target===modal)closeModal();});
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;});

async function boot(){
  try{catalog=await fetch('catalog.json').then(response=>response.json());}catch{catalog=[];}
  if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
  render();
}
window.orbitaPWA = {
  getState: () => state,
  setState: next => { state = next; saveState(); render(); },
  saveState,
  markDeleted
};
boot();
