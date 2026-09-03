const SHEET_NAME = 'Kartvizitler';
const HEADERS = ['ID', 'Kayıt Tarihi', 'Firma Adı', 'Yetkili Kişi', 'Ünvan', 'Telefon', 'E-posta', 'Web', 'Adres', 'Not'];

function doGet(e) {
  try {
    const action = String((e.parameter && e.parameter.action) || 'health');
    if (action === 'search') return jsonResponse({ results: searchCards(e.parameter.q || '') }, e.parameter.callback);
    if (action === 'read') return jsonResponse(readCard(e.parameter.id || ''), e.parameter.callback);
    return jsonResponse({ ok: true, service: 'CardBase Apps Script' }, e.parameter && e.parameter.callback);
  } catch (error) {
    return jsonResponse({ error: error.message }, e.parameter && e.parameter.callback);
  }
}

function doPost(e) {
  try {
    const payload = JSON.parse((e.postData && e.postData.contents) || '{}');
    if (payload.action === 'create') return jsonResponse(createCard(payload.card || {}));
    if (payload.action === 'update') return jsonResponse(updateCard(payload.id || '', payload.card || {}));
    throw new Error('Geçersiz işlem.');
  } catch (error) {
    return jsonResponse({ error: error.message }, 400);
  }
}

function getSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS);
  return sheet;
}

function createCard(card) {
  validateCard(card);
  const id = Utilities.getUuid();
  const createdAt = new Date().toISOString();
  const row = cardToRow(card, id, createdAt);
  getSheet().appendRow(row);
  return rowToCard(row);
}

function searchCards(query) {
  const needle = normalize(query);
  if (!needle) throw new Error('Arama metni zorunludur.');
  const values = getSheet().getDataRange().getDisplayValues();
  return values.slice(1).map(rowToCard).filter(function(card) {
    return normalize(card.companyName).indexOf(needle) !== -1 || normalize(card.contactName).indexOf(needle) !== -1;
  });
}

function readCard(id) {
  const values = getSheet().getDataRange().getDisplayValues();
  const row = values.slice(1).find(function(item) { return item[0] === id; });
  if (!row) throw new Error('Kayıt bulunamadı.');
  return rowToCard(row);
}

function updateCard(id, card) {
  validateCard(card);
  const sheet = getSheet();
  const values = sheet.getDataRange().getDisplayValues();
  const index = values.slice(1).findIndex(function(row) { return row[0] === id; });
  if (index < 0) throw new Error('Kayıt bulunamadı.');
  const rowNumber = index + 2;
  const row = cardToRow(card, id, values[rowNumber - 1][1]);
  sheet.getRange(rowNumber, 1, 1, HEADERS.length).setValues([row]);
  return rowToCard(row);
}

function validateCard(card) {
  if (!String(card.companyName || '').trim() && !String(card.contactName || '').trim()) {
    throw new Error('Firma adı veya yetkili kişi alanlarından biri zorunludur.');
  }
}

function normalize(value) {
  return String(value || '').toLocaleLowerCase('tr-TR').trim();
}

function cardToRow(card, id, createdAt) {
  return [id, createdAt, card.companyName, card.contactName, card.title, card.phone,
    card.email, card.website, card.address, card.notes].map(function(value) { return String(value || '').trim(); });
}

function rowToCard(row) {
  return { id: row[0] || '', createdAt: row[1] || '', companyName: row[2] || '',
    contactName: row[3] || '', title: row[4] || '', phone: row[5] || '',
    email: row[6] || '', website: row[7] || '', address: row[8] || '', notes: row[9] || '' };
}

function jsonResponse(data, callback) {
  if (callback && /^[a-zA-Z_$][0-9a-zA-Z_$\.]*$/.test(callback)) {
    return ContentService.createTextOutput(callback + '(' + JSON.stringify(data) + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
