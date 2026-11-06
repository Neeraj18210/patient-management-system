const pageName = document.body.dataset.page;
const state = { schema: [], primaryKey: null, records: [] };

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result;
}

function toast(message, isError = false) {
  const region = document.querySelector('.toast-region');
  if (!region) return;
  const item = document.createElement('div');
  item.className = `toast${isError ? ' error' : ''}`;
  item.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${isError ? '<path d="m7 7 10 10M17 7 7 17"/><circle cx="12" cy="12" r="9"/>' : '<path d="m5 12 4 4L19 6"/>'}</svg><span>${escapeHtml(message)}</span>`;
  region.append(item);
  window.setTimeout(() => item.remove(), 3600);
}

function setConnection(connected, message = '') {
  document.querySelectorAll('[data-connection-dot]').forEach((dot) => {
    dot.classList.toggle('connected', connected);
    dot.classList.toggle('disconnected', !connected);
  });
  document.querySelectorAll('[data-connection-label]').forEach((label) => {
    label.textContent = connected ? 'MySQL connected' : 'Database offline';
  });
  document.querySelectorAll('[data-db-status]').forEach((label) => {
    label.textContent = connected ? 'Connected' : 'Offline';
  });
  document.querySelectorAll('[data-database-notice]').forEach((notice) => {
    notice.hidden = connected;
    const text = notice.querySelector('[data-database-message]');
    if (text && message) text.textContent = message;
  });
}

function getPrimaryColumn() {
  return state.schema.find((column) => column.name === state.primaryKey);
}

function preferredNameColumn() {
  return state.schema.find((column) => /patient.?name|full.?name|^name$/i.test(column.name))
    || state.schema.find((column) => /first.?name/i.test(column.name))
    || state.schema.find((column) => column.name !== state.primaryKey)
    || state.schema[0];
}

function rowLabel(record) {
  const nameColumn = preferredNameColumn();
  const value = nameColumn ? record[nameColumn.name] : '';
  return String(value || (state.primaryKey ? `Record ${record[state.primaryKey]}` : 'Patient record'));
}

function formatCell(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function visibleColumns(limit = Infinity) {
  const chosen = state.schema.slice(0, limit);
  if (state.primaryKey && !chosen.some((column) => column.name === state.primaryKey)) {
    chosen[chosen.length - 1] = getPrimaryColumn();
  }
  return chosen.filter(Boolean);
}

function updateCounts() {
  document.querySelectorAll('[data-record-count]').forEach((element) => {
    element.textContent = state.records.length.toLocaleString();
  });
  document.querySelectorAll('[data-record-total], [data-total-records]').forEach((element) => {
    element.textContent = state.records.length.toLocaleString();
  });
  document.querySelectorAll('[data-column-count], [data-field-count]').forEach((element) => {
    element.textContent = state.schema.length.toLocaleString();
  });
  document.querySelectorAll('[data-primary-key]').forEach((element) => {
    element.textContent = state.primaryKey || 'Not set';
  });
  document.querySelectorAll('[data-db-name]').forEach((element) => {
    element.textContent = 'patient_management';
  });
  document.querySelectorAll('[data-latest-record]').forEach((element) => {
    element.textContent = state.records.length ? rowLabel(state.records[0]) : 'No records';
  });
}

function renderDashboard() {
  const columns = visibleColumns(4);
  const head = document.querySelector('[data-dashboard-head]');
  const body = document.querySelector('[data-dashboard-records]');
  if (head && body) {
    head.innerHTML = `<tr>${columns.map((column) => `<th>${escapeHtml(column.name)}</th>`).join('')}</tr>`;
    if (!state.records.length) {
      body.innerHTML = '<tr><td class="empty-state" colspan="6"><strong>No patient records yet</strong>Add your first row from the patient records page.</td></tr>';
    } else {
      body.innerHTML = state.records.slice(0, 5).map((record) => `<tr>${columns.map((column) => `<td title="${escapeHtml(formatCell(record[column.name]))}">${escapeHtml(formatCell(record[column.name]))}</td>`).join('')}</tr>`).join('');
    }
  }
  const summary = document.querySelector('[data-schema-summary]');
  if (summary) {
    summary.innerHTML = state.schema.length
      ? state.schema.slice(0, 6).map((column) => `<div class="schema-line"><strong>${escapeHtml(column.name)}${column.key === 'PRI' ? ' · key' : ''}</strong><span class="schema-type">${escapeHtml(column.type)}</span></div>`).join('')
      : '<div class="empty-state">No schema fields were returned.</div>';
  }
}

function renderPatients(searchText = '') {
  const head = document.querySelector('[data-record-head]');
  const body = document.querySelector('[data-record-rows]');
  if (!head || !body) return;
  const columns = visibleColumns();
  const canEdit = Boolean(state.primaryKey);
  head.innerHTML = `<tr>${columns.map((column) => `<th>${escapeHtml(column.name)}${column.key === 'PRI' ? ' <span title="Primary key">⌑</span>' : ''}</th>`).join('')}<th class="actions-heading">ACTIONS</th></tr>`;
  const query = searchText.trim().toLowerCase();
  const records = state.records.filter((record) => !query || columns.some((column) => formatCell(record[column.name]).toLowerCase().includes(query)));
  const summary = document.querySelector('[data-table-summary]');
  if (summary) summary.textContent = query ? `Showing ${records.length} of ${state.records.length} records` : `${state.records.length} ${state.records.length === 1 ? 'record' : 'records'} · ${state.schema.length} fields`;
  if (!records.length) {
    body.innerHTML = `<tr><td class="empty-state" colspan="${Math.max(columns.length + 1, 2)}"><strong>${query ? 'No matching records' : 'No patient records yet'}</strong>${query ? 'Try a different search term.' : 'Use “Add patient record” to create your first row.'}</td></tr>`;
    return;
  }
  body.innerHTML = records.map((record) => {
    const id = state.primaryKey ? record[state.primaryKey] : '';
    const actions = canEdit
      ? `<div class="row-actions"><button class="icon-button" data-action="edit" data-id="${escapeHtml(id)}" aria-label="Edit record" title="Edit record"><svg viewBox="0 0 24 24"><path d="m14 5 5 5M4 20l4.2-.8L19 8.4a2.1 2.1 0 0 0-3-3L5.2 16.2 4 20Z"/></svg></button><button class="icon-button" data-action="delete" data-id="${escapeHtml(id)}" aria-label="Delete record" title="Delete record"><svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6m4-6v6M5 7l1 14h12l1-14M9 7V4h6v3"/></svg></button></div>`
      : '<span class="form-help">Add a primary key to enable actions</span>';
    return `<tr>${columns.map((column) => `<td title="${escapeHtml(formatCell(record[column.name]))}">${escapeHtml(formatCell(record[column.name]))}</td>`).join('')}<td>${actions}</td></tr>`;
  }).join('');
}

function renderInsights() {
  const fieldList = document.querySelector('[data-field-list]');
  if (fieldList) {
    fieldList.innerHTML = state.schema.length
      ? state.schema.map((column) => `<div class="field-row"><span class="field-name">${column.key === 'PRI' ? '<span class="key-indicator" title="Primary key"><svg viewBox="0 0 24 24"><circle cx="8" cy="15.5" r="4.5"/><path d="m11.3 12.2 8.2-8.2 2.7 2.7"/></svg></span>' : ''}<span title="${escapeHtml(column.name)}">${escapeHtml(column.name)}</span></span><span class="field-type" title="${escapeHtml(column.type)}">${escapeHtml(column.type)}</span><span class="field-nullable${column.nullable ? '' : ' required'}">${column.nullable ? 'Optional' : 'Required'}</span></div>`).join('')
      : '<div class="empty-state">No table fields found.</div>';
  }
  const distribution = document.querySelector('[data-type-distribution]');
  if (distribution) {
    const counts = new Map();
    for (const column of state.schema) {
      const type = column.type.toLowerCase();
      const group = /int|decimal|float|double|numeric|bit/.test(type) ? 'Number'
        : /date|time|year/.test(type) ? 'Date & time'
          : /text|blob|json/.test(type) ? 'Long text'
            : 'Text';
      counts.set(group, (counts.get(group) || 0) + 1);
    }
    const total = state.schema.length || 1;
    distribution.innerHTML = counts.size
      ? [...counts].map(([name, count]) => `<div class="type-row"><div class="type-row-top"><span>${escapeHtml(name)}</span><strong>${count} ${count === 1 ? 'field' : 'fields'}</strong></div><div class="type-track"><div class="type-bar" style="width:${Math.max(8, Math.round(count / total * 100))}%"></div></div></div>`).join('')
      : '<div class="empty-state">Type breakdown appears when the table schema is available.</div>';
  }
}

function fieldControl(column, record, isNew) {
  const sqlType = column.type.toLowerCase();
  const isAuto = column.extra.toLowerCase().includes('auto_increment');
  if (isAuto || (!isNew && column.name === state.primaryKey)) return '';
  const required = !column.nullable && column.defaultValue === null && !isAuto;
  let inputType = 'text';
  let value = record
    ? record[column.name]
    : isNew && column.name === state.primaryKey && /int/.test(sqlType)
      ? String(Math.max(0, ...state.records.map((item) => Number(item[column.name]) || 0)) + 1)
      : '';
  let control;
  const enumMatch = column.type.match(/^enum\((.*)\)$/i);
  const categoryColumn = /^(problem|diagnosis|condition|gender|sex|blood_?group|status|category|type)$/i.test(column.name);
  if (enumMatch) {
    const choices = [...enumMatch[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((match) => match[1].replace(/\\'/g, "'"));
    control = `<select id="${escapeHtml(column.name)}" name="${escapeHtml(column.name)}"${required ? ' required' : ''}><option value="">Choose...</option>${choices.map((choice) => `<option value="${escapeHtml(choice)}"${String(value) === choice ? ' selected' : ''}>${escapeHtml(choice)}</option>`).join('')}</select>`;
  } else if (categoryColumn) {
    const choices = [...new Set(state.records.map((item) => String(item[column.name] ?? '').trim()).filter(Boolean))];
    if (value && !choices.includes(String(value))) choices.unshift(String(value));
    control = `<select id="${escapeHtml(column.name)}" name="${escapeHtml(column.name)}" data-category-select="${escapeHtml(column.name)}"${required ? ' required' : ''}><option value="">Choose...</option>${choices.map((choice) => `<option value="${escapeHtml(choice)}"${String(value) === choice ? ' selected' : ''}>${escapeHtml(choice)}</option>`).join('')}<option value="__custom__">Enter a new value...</option></select><input id="${escapeHtml(column.name)}-custom" type="text" data-category-custom="${escapeHtml(column.name)}" placeholder="Enter a new value" aria-label="New ${escapeHtml(column.name)} value" hidden>`;
  } else if (/^(tinyint\(1\)|boolean|bool)$/.test(sqlType)) {
    const truthy = value === true || value === 1 || value === '1';
    control = `<select id="${escapeHtml(column.name)}" name="${escapeHtml(column.name)}"><option value="0"${truthy ? '' : ' selected'}>No</option><option value="1"${truthy ? ' selected' : ''}>Yes</option></select>`;
  } else {
    if (/date/.test(sqlType)) inputType = sqlType.includes('time') ? 'datetime-local' : 'date';
    else if (/time/.test(sqlType)) inputType = 'time';
    else if (/int|decimal|float|double|numeric|real/.test(sqlType)) inputType = 'number';
    else if (/email/i.test(column.name)) inputType = 'email';
    if (inputType === 'datetime-local' && value) value = String(value).replace(' ', 'T').slice(0, 16);
    if (inputType === 'date' && value) value = String(value).slice(0, 10);
    const step = /decimal|float|double|numeric|real/.test(sqlType) ? ' step="any"' : '';
    const safeValue = value === null || value === undefined ? '' : String(value);
    if (/text|json/.test(sqlType)) {
      control = `<textarea id="${escapeHtml(column.name)}" name="${escapeHtml(column.name)}"${required ? ' required' : ''}>${escapeHtml(safeValue)}</textarea>`;
    } else {
      control = `<input id="${escapeHtml(column.name)}" name="${escapeHtml(column.name)}" type="${inputType}" value="${escapeHtml(safeValue)}"${step}${required ? ' required' : ''} autocomplete="off">`;
    }
  }
  const idHint = isNew && column.name === state.primaryKey && !isAuto
    ? '<small class="form-help">Suggested next patient ID. It must be unique.</small>'
    : '';
  return `<div class="form-field${/text|json/.test(sqlType) ? ' full-width' : ''}"><label for="${escapeHtml(column.name)}">${escapeHtml(column.name)}${required ? ' <b aria-hidden="true">*</b>' : ''}</label>${control}${idHint}</div>`;
}

function openRecordDialog(record = null) {
  const dialog = document.querySelector('[data-record-dialog]');
  const fields = document.querySelector('[data-form-fields]');
  if (!dialog || !fields) return;
  const isNew = !record;
  const title = dialog.querySelector('[data-dialog-title]');
  const kicker = dialog.querySelector('[data-dialog-kicker]');
  const description = dialog.querySelector('[data-dialog-description]');
  if (title) title.textContent = isNew ? 'Add patient record' : 'Edit patient record';
  if (kicker) kicker.textContent = isNew ? 'NEW DATABASE ROW' : 'UPDATE DATABASE ROW';
  if (description) description.textContent = isNew
    ? 'Enter the patient details below. Fields are generated from your MySQL table.'
    : 'Update the selected patient details. Changes save directly to details_table.';
  fields.innerHTML = state.schema.map((column) => fieldControl(column, record, isNew)).join('');
  dialog.showModal();
  fields.querySelector('input, select, textarea')?.focus();
}

function askDelete() {
  const dialog = document.querySelector('[data-confirm-dialog]');
  return new Promise((resolve) => {
    if (!dialog) return resolve(false);
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'delete'), { once: true });
    dialog.showModal();
  });
}

async function loadApplication() {
  const search = document.querySelector('[data-record-search]');
  try {
    const [schema, records] = await Promise.all([api('/api/schema'), api('/api/records')]);
    state.schema = schema.columns;
    state.primaryKey = schema.primaryKey;
    state.records = records;
    setConnection(true);
    updateCounts();
    renderDashboard();
    renderPatients(search?.value || '');
    renderInsights();
  } catch (error) {
    setConnection(false, error.message);
    const dashboardBody = document.querySelector('[data-dashboard-records]');
    const schemaSummary = document.querySelector('[data-schema-summary]');
    const recordRows = document.querySelector('[data-record-rows]');
    const fieldList = document.querySelector('[data-field-list]');
    const distribution = document.querySelector('[data-type-distribution]');
    if (dashboardBody) dashboardBody.innerHTML = `<tr><td class="empty-state" colspan="6"><strong>Database not connected</strong>${escapeHtml(error.message)}</td></tr>`;
    if (schemaSummary) schemaSummary.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    if (recordRows) recordRows.innerHTML = `<tr><td class="empty-state" colspan="2"><strong>Can't load records</strong>${escapeHtml(error.message)}</td></tr>`;
    if (fieldList) fieldList.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    if (distribution) distribution.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

function wireInteractions() {
  const menuButton = document.querySelector('.mobile-menu');
  const sidebar = document.querySelector('.sidebar');
  menuButton?.addEventListener('click', () => {
    const isOpen = sidebar.classList.toggle('is-open');
    menuButton.setAttribute('aria-expanded', String(isOpen));
  });
  document.addEventListener('click', (event) => {
    if (sidebar?.classList.contains('is-open') && !sidebar.contains(event.target) && !menuButton?.contains(event.target)) {
      sidebar.classList.remove('is-open');
      menuButton?.setAttribute('aria-expanded', 'false');
    }
  });
  document.querySelector('[data-record-search]')?.addEventListener('input', (event) => renderPatients(event.target.value));
  document.querySelector('[data-refresh]')?.addEventListener('click', (event) => {
    const button = event.currentTarget;
    button.classList.add('is-refreshing');
    loadApplication().finally(() => window.setTimeout(() => button.classList.remove('is-refreshing'), 250));
  });
  document.querySelector('[data-add-record]')?.addEventListener('click', () => openRecordDialog());
  if (pageName === 'patients' && location.hash === '#new-record') openRecordDialog();

  document.querySelector('[data-record-form]')?.addEventListener('submit', async (event) => {
    if (event.submitter?.value !== 'save') {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    const dialog = event.currentTarget.closest('dialog');
    const recordId = dialog.dataset.recordId;
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    for (const select of event.currentTarget.querySelectorAll('[data-category-select]')) {
      if (select.value !== '__custom__') continue;
      const customInput = [...event.currentTarget.querySelectorAll('[data-category-custom]')]
        .find((input) => input.dataset.categoryCustom === select.dataset.categorySelect);
      if (!customInput?.value.trim()) {
        customInput?.focus();
        toast(`Enter a value for ${select.dataset.categorySelect}.`, true);
        return;
      }
      values[select.name] = customInput.value.trim();
    }
    for (const [key, value] of Object.entries(values)) {
      const column = state.schema.find((item) => item.name === key);
      if (column && /datetime/.test(column.type.toLowerCase())) values[key] = value.replace('T', ' ');
    }
    try {
      await api(recordId ? `/api/records/${encodeURIComponent(recordId)}` : '/api/records', {
        method: recordId ? 'PATCH' : 'POST',
        body: JSON.stringify(values),
      });
      dialog.close();
      delete dialog.dataset.recordId;
      toast(recordId ? 'Patient record updated.' : 'Patient record added.');
      await loadApplication();
    } catch (error) {
      toast(error.message, true);
    }
  });

  document.querySelector('[data-record-form]')?.addEventListener('change', (event) => {
    const select = event.target.closest('[data-category-select]');
    if (!select) return;
    const customInput = [...event.currentTarget.querySelectorAll('[data-category-custom]')]
      .find((input) => input.dataset.categoryCustom === select.dataset.categorySelect);
    if (!customInput) return;
    customInput.hidden = select.value !== '__custom__';
    if (customInput.hidden) customInput.value = '';
    else customInput.focus();
  });

  document.querySelectorAll('[data-record-dialog] [data-dialog-cancel]').forEach((button) => {
    button.addEventListener('click', () => button.closest('dialog').close('cancel'));
  });

  document.querySelector('[data-record-rows]')?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const record = state.records.find((item) => String(item[state.primaryKey]) === button.dataset.id);
    if (button.dataset.action === 'edit' && record) {
      const dialog = document.querySelector('[data-record-dialog]');
      dialog.dataset.recordId = button.dataset.id;
      openRecordDialog(record);
    }
    if (button.dataset.action === 'delete') {
      const confirmed = await askDelete();
      if (!confirmed) return;
      try {
        await api(`/api/records/${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE' });
        toast('Patient record deleted.');
        await loadApplication();
      } catch (error) {
        toast(error.message, true);
      }
    }
  });
  document.querySelector('[data-record-dialog]')?.addEventListener('close', (event) => {
    if (event.currentTarget.returnValue !== 'save') delete event.currentTarget.dataset.recordId;
  });
}

wireInteractions();
loadApplication();
