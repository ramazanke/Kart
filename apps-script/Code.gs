const SHEET_NAME = 'Kartvizitler';
const HEADERS = ['ID', 'Kayıt Tarihi', 'Firma Adı', 'Yetkili Kişi', 'Ünvan', 'Telefon', 'E-posta', 'Web', 'Adres', 'Not'];

// Kurulumdan sonra editörde bu işlevi bir kez elle çalıştırın.
// Google Sheets ve harici Gemini isteği için gerekli izin ekranını açar.
function authorizeServices() {
  SpreadsheetApp.getActiveSpreadsheet().getId();
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('Önce GEMINI_API_KEY komut dosyası özelliğini ekleyin.');
  UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(apiKey), {
    method: 'get', muteHttpExceptions: true
  });
  return 'İzinler hazır.';
}

function doGet(e) {
  try {
    const action = String((e.parameter && e.parameter.action) || 'health');
    if (action === 'search') return jsonResponse({ results: searchCards(e.parameter.q || '') }, e.parameter.callback);
    if (action === 'read') return jsonResponse(readCard(e.parameter.id || ''), e.parameter.callback);
    return jsonResponse({ ok: true, service: 'CardBase Apps Script', version: 3, geminiConfigured: Boolean(PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY')) }, e.parameter && e.parameter.callback);
  } catch (error) {
    return jsonResponse({ error: error.message }, e.parameter && e.parameter.callback);
  }
}

function doPost(e) {
  if (e.parameter && e.parameter.action === 'ocr') {
    try {
      const result = analyzeBusinessCard(e.parameter.image || '', e.parameter.mimeType || 'image/jpeg');
      return iframeResponse(e.parameter.requestId || '', result, '');
    } catch (error) {
      return iframeResponse(e.parameter.requestId || '', null, error.message);
    }
  }
  try {
    const payload = JSON.parse((e.postData && e.postData.contents) || '{}');
    if (payload.action === 'create') return jsonResponse(createCard(payload.card || {}));
    if (payload.action === 'update') return jsonResponse(updateCard(payload.id || '', payload.card || {}));
    throw new Error('Geçersiz işlem.');
  } catch (error) {
    return jsonResponse({ error: error.message }, 400);
  }
}

function analyzeBusinessCard(base64Image, mimeType) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY tanımlı değil.');
  if (!base64Image) throw new Error('Kartvizit görseli alınamadı.');
  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=' + encodeURIComponent(apiKey);
  const prompt = 'Bu kartviziti dikkatle oku. Yalnızca geçerli JSON döndür. Görünmeyen bilgileri uydurma, boş string kullan. Birden fazla telefon veya e-posta varsa hiçbirini atlama ve / ile ayır. Alanlar tam olarak: companyName, contactName, title, phone, email, website, address, notes. Çok satırlı ünvanı anlamlı biçimde birleştir.';
  const payload = { contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: mimeType, data: base64Image } }] }], generationConfig: { responseMimeType: 'application/json' } };
  const response = UrlFetchApp.fetch(endpoint, { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true });
  const body = JSON.parse(response.getContentText() || '{}');
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) throw new Error((body.error && body.error.message) || 'Gemini kartı okuyamadı.');
  const content = body.candidates && body.candidates[0] && body.candidates[0].content;
  const raw = content && content.parts && content.parts[0] && content.parts[0].text;
  if (!raw) throw new Error('Gemini boş sonuç döndürdü.');
  return JSON.parse(raw.replace(/^```json\s*|\s*```$/g, '').trim());
}

function iframeResponse(requestId, result, error) {
  const message = JSON.stringify({ source: 'cardbase-gemini', requestId: requestId, result: result, error: error || '' }).replace(/</g, '\\u003c');
  return HtmlService
    .createHtmlOutput('<!doctype html><script>window.top.postMessage(' + message + ', "*");<\/script>')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
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
