const path = require('path');
const { randomUUID } = require('crypto');
const express = require('express');
const multer = require('multer');
const { google } = require('googleapis');

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype))
});

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const HEADERS = ['ID', 'Kayıt Tarihi', 'Firma Adı', 'Yetkili Kişi', 'Ünvan', 'Telefon', 'E-posta', 'Web', 'Adres', 'Not'];

function normalize(value = '') {
  return String(value).toLocaleLowerCase('tr-TR').trim();
}

function escapeSheetName(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

function credentials() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return undefined;
  try {
    const parsed = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    if (parsed.private_key) parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    return parsed;
  } catch (_error) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON geçerli JSON değil.');
  }
}

async function sheetsClient() {
  if (!process.env.SHEET_ID) throw new Error('SHEET_ID tanımlı değil.');
  const auth = new google.auth.GoogleAuth({
    credentials: credentials(),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  return google.sheets({ version: 'v4', auth });
}

function rowToRecord(row = []) {
  return {
    id: row[0] || '', createdAt: row[1] || '', companyName: row[2] || '',
    contactName: row[3] || '', title: row[4] || '', phone: row[5] || '',
    email: row[6] || '', website: row[7] || '', address: row[8] || '', notes: row[9] || ''
  };
}

function recordToRow(body, id, createdAt) {
  return [id, createdAt, body.companyName, body.contactName, body.title, body.phone,
    body.email, body.website, body.address, body.notes].map(value => String(value || '').trim());
}

function validate(body) {
  if (!body.companyName && !body.contactName) return 'Firma adı veya yetkili kişi alanlarından biri zorunludur.';
  if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) return 'E-posta adresi geçersiz.';
  return null;
}

async function getRows() {
  const sheets = await sheetsClient();
  const sheet = escapeSheetName(process.env.SHEET_NAME || 'Kartvizitler');
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEET_ID,
    range: `${sheet}!A:J`
  });
  return result.data.values || [];
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/cards', async (req, res, next) => {
  try {
    const error = validate(req.body);
    if (error) return res.status(400).json({ error });
    const sheets = await sheetsClient();
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const row = recordToRow(req.body, id, createdAt);
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SHEET_ID,
      range: `${escapeSheetName(process.env.SHEET_NAME || 'Kartvizitler')}!A:J`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] }
    });
    res.status(201).json(rowToRecord(row));
  } catch (error) { next(error); }
});

app.get('/api/cards/search', async (req, res, next) => {
  try {
    const query = normalize(req.query.q);
    if (!query) return res.status(400).json({ error: 'Arama metni zorunludur.' });
    const rows = await getRows();
    const records = rows.slice(1).map(rowToRecord).filter(card =>
      normalize(card.companyName).includes(query) || normalize(card.contactName).includes(query)
    );
    res.json({ results: records });
  } catch (error) { next(error); }
});

app.get('/api/cards/:id', async (req, res, next) => {
  try {
    const card = (await getRows()).slice(1).map(rowToRecord).find(item => item.id === req.params.id);
    if (!card) return res.status(404).json({ error: 'Kayıt bulunamadı.' });
    res.json(card);
  } catch (error) { next(error); }
});

app.put('/api/cards/:id', async (req, res, next) => {
  try {
    const error = validate(req.body);
    if (error) return res.status(400).json({ error });
    const rows = await getRows();
    const index = rows.slice(1).findIndex(row => row[0] === req.params.id);
    if (index < 0) return res.status(404).json({ error: 'Kayıt bulunamadı.' });
    const rowNumber = index + 2;
    const row = recordToRow(req.body, req.params.id, rows[rowNumber - 1][1]);
    const sheets = await sheetsClient();
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.SHEET_ID,
      range: `${escapeSheetName(process.env.SHEET_NAME || 'Kartvizitler')}!A${rowNumber}:J${rowNumber}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] }
    });
    res.json(rowToRecord(row));
  } catch (error) { next(error); }
});

app.post('/api/ocr', upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Kartvizit görseli gereklidir.' });
    if (!process.env.OCR_API_URL) {
      return res.status(501).json({
        error: 'OCR servisi henüz yapılandırılmadı.',
        code: 'OCR_NOT_CONFIGURED'
      });
    }
    const form = new FormData();
    form.append('image', new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname);
    const headers = process.env.OCR_API_KEY ? { Authorization: `Bearer ${process.env.OCR_API_KEY}` } : {};
    const response = await fetch(process.env.OCR_API_URL, { method: 'POST', headers, body: form });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'OCR servisi başarısız oldu.');
    res.json(data);
  } catch (error) { next(error); }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(error.status || 500).json({ error: error.message || 'Beklenmeyen bir hata oluştu.' });
});

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

module.exports = app;
