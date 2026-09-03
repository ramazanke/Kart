const panels = [...document.querySelectorAll('.panel')];
const cardForm = document.querySelector('#cardForm');
const toast = document.querySelector('#toast');
let selectedFile;

function showPanel(id) {
  panels.forEach(panel => panel.classList.toggle('active', panel.id === id));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function notify(message, error = false) {
  toast.textContent = message;
  toast.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.className = 'toast', 3200);
}

async function api(url, options = {}) {
  const appsScriptUrl = String(window.APPS_SCRIPT_URL || '').trim();
  if (appsScriptUrl && url.startsWith('/api/cards')) {
    let target = appsScriptUrl;
    let requestOptions = { ...options, redirect: 'follow' };
    if (url.startsWith('/api/cards/search')) {
      const query = new URLSearchParams(url.split('?')[1] || '').get('q') || '';
      return jsonp(`${target}?action=search&q=${encodeURIComponent(query)}`);
    } else if ((options.method || 'GET') === 'POST') {
      target += '?action=create';
      requestOptions = { method: 'POST', mode: 'no-cors', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'create', card: JSON.parse(options.body || '{}') }) };
    } else if ((options.method || 'GET') === 'PUT') {
      const id = decodeURIComponent(url.split('/').pop());
      target += '?action=update';
      requestOptions = { method: 'POST', mode: 'no-cors', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'update', id, card: JSON.parse(options.body || '{}') }) };
    }
    const response = await fetch(target, requestOptions);
    if (response.type === 'opaque') return { ok: true };
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw new Error(data.error || 'İşlem tamamlanamadı.');
    return data;
  }
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'İşlem tamamlanamadı.');
  return data;
}

function jsonp(url) {
  return new Promise((resolve, reject) => {
    const callback = `cardbase_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    const timer = setTimeout(() => finish(new Error('E-Tablo yanıt vermedi. Apps Script dağıtımını kontrol edin.')), 15000);
    function finish(error, data) {
      clearTimeout(timer); delete window[callback]; script.remove();
      error ? reject(error) : resolve(data);
    }
    window[callback] = data => data && data.error ? finish(new Error(data.error)) : finish(null, data);
    script.onerror = () => finish(new Error('E-Tablo bağlantısı kurulamadı.'));
    script.src = `${url}&callback=${encodeURIComponent(callback)}`;
    document.head.appendChild(script);
  });
}

function formDataToObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function fillForm(card = {}, mode = 'Manuel') {
  cardForm.reset();
  for (const [key, value] of Object.entries(card)) {
    if (cardForm.elements[key]) cardForm.elements[key].value = value || '';
  }
  document.querySelector('#formMode').textContent = mode;
  document.querySelector('#formTitle').textContent = card.id ? 'Kartviziti düzenle' : 'Yeni kartvizit';
  showPanel('form');
}

document.addEventListener('click', event => {
  const open = event.target.closest('[data-open]');
  if (open) open.dataset.open === 'form' ? fillForm() : showPanel(open.dataset.open);
  if (event.target.closest('[data-home]')) showPanel('home');
});

document.querySelector('#cardImage').addEventListener('change', event => {
  selectedFile = event.target.files[0];
  if (!selectedFile) return;
  const preview = document.querySelector('#preview');
  preview.src = URL.createObjectURL(selectedFile);
  preview.classList.add('visible');
  document.querySelector('#scanButton').disabled = false;
});

document.querySelector('#scanButton').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true; button.textContent = 'Okunuyor…';
  try {
    button.textContent = 'Fotoğraf hazırlanıyor…';
    const preparedImage = await prepareImageForOcr(selectedFile);
    button.textContent = 'Gemini okuyor…';
    const parsed = await sendImageToGemini(preparedImage);
    fillForm(parsed, 'Taramadan');
    notify('Bilgiler forma aktarıldı. Lütfen kontrol edin.');
  } catch (error) {
    notify(error.message, true);
  } finally { button.disabled = false; button.textContent = 'Bilgileri Oku'; }
});

async function sendImageToGemini(blob) {
  const endpoint = String(window.APPS_SCRIPT_URL || '').trim();
  if (!endpoint) throw new Error('Apps Script bağlantısı tanımlı değil.');
  const status = await jsonp(`${endpoint}?action=health`);
  if (!status || Number(status.version || 0) < 3) throw new Error('Apps Script eski sürümde. Güncel Code.gs kodunu yeni sürüm olarak dağıtın.');
  if (!status.geminiConfigured) throw new Error('GEMINI_API_KEY, Apps Script proje özelliklerinde bulunamadı.');
  const base64 = await blobToBase64(blob);
  const requestId = `ocr_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe');
    iframe.name = requestId; iframe.hidden = true;
    const form = document.createElement('form');
    form.method = 'POST'; form.action = endpoint; form.target = requestId; form.hidden = true;
    const fields = { action: 'ocr', requestId, mimeType: blob.type || 'image/jpeg', image: base64 };
    Object.entries(fields).forEach(([name, value]) => {
      const input = document.createElement('input'); input.name = name; input.value = value; form.appendChild(input);
    });
    const cleanup = () => { window.removeEventListener('message', onMessage); iframe.remove(); form.remove(); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Gemini 90 saniye içinde yanıt vermedi. Apps Script çalıştırma kayıtlarını kontrol edin.')); }, 90000);
    const onMessage = event => {
      if (!event.data || event.data.source !== 'cardbase-gemini' || event.data.requestId !== requestId) return;
      clearTimeout(timer); cleanup();
      event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.result);
    };
    window.addEventListener('message', onMessage);
    document.body.append(iframe, form); form.submit();
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Fotoğraf dönüştürülemedi.'));
    reader.readAsDataURL(blob);
  });
}

function prepareImageForOcr(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      const maxWidth = 1400;
      const scale = Math.min(1, maxWidth / image.naturalWidth);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.naturalWidth * scale);
      canvas.height = Math.round(image.naturalHeight * scale);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let index = 0; index < pixels.data.length; index += 4) {
        const gray = pixels.data[index] * .299 + pixels.data[index + 1] * .587 + pixels.data[index + 2] * .114;
        const contrasted = Math.max(0, Math.min(255, (gray - 128) * 1.45 + 128));
        pixels.data[index] = pixels.data[index + 1] = pixels.data[index + 2] = contrasted;
      }
      context.putImageData(pixels, 0, 0);
      URL.revokeObjectURL(objectUrl);
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Fotoğraf hazırlanamadı.')), 'image/jpeg', .9);
    };
    image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Fotoğraf açılamadı.')); };
    image.src = objectUrl;
  });
}

function extractBusinessCard(rawText) {
  const text = rawText.replace(/\r/g, '');
  const lines = text.split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const email = (text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [''])[0];
  const website = (text.match(/(?:https?:\/\/|www\.)[^\s]+/i) || [''])[0].replace(/[),.;]+$/, '');
  const phoneMatches = (text.match(/(?:\+|00)\d[\d\s().-]{7,}\d/g) || []).map(value => value.replace(/^[TMWF]:?\s*/i, '').trim());
  const ignored = new Set([email, website, ...phoneMatches].map(value => value.toLocaleLowerCase('tr-TR')));
  const candidates = lines.filter(line => ![...ignored].some(value => value && line.toLocaleLowerCase('tr-TR').includes(value)) && line.length > 2 && line.length < 70);
  const titlePattern = /müdür|manager|director|başkan|uzman|specialist|technologist|engineer|mühendis|satış|sales|purchasing|founder|kurucu|ceo|division/i;
  const companyPattern = /ltd|şti|a\.?ş|sanayi|ticaret|holding|group|grup|company|corp|inc|teknoloji|makina|inşaat/i;
  const title = candidates.find(line => titlePattern.test(line)) || '';
  const namePattern = /^(?:[A-ZÇĞİÖŞÜ]{2,}[ .'-]*){2,4}$|^[A-ZÇĞİÖŞÜ][A-Za-zÇĞİÖŞÜçğıöşü.'-]+(?:\s+[A-ZÇĞİÖŞÜ][A-Za-zÇĞİÖŞÜçğıöşü.'-]+){1,3}$/;
  const contactName = candidates.find(line => namePattern.test(line)) || '';
  const emailDomain = email.split('@')[1]?.split('.')[0] || '';
  const domainCompany = emailDomain && !/gmail|hotmail|outlook|yahoo|icloud/i.test(emailDomain)
    ? emailDomain.replace(/[-_]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase()) : '';
  const companyName = candidates.find(line => line !== contactName && companyPattern.test(line)) || domainCompany;
  const nameIndex = lines.indexOf(contactName);
  const firstContactIndex = lines.findIndex(line => /(?:\+|00)\d|@|www\.|https?:/i.test(line));
  const titleLines = nameIndex >= 0
    ? lines.slice(nameIndex + 1, firstContactIndex > nameIndex ? firstContactIndex : nameIndex + 4).filter(line => titlePattern.test(line))
    : [];
  const addressLines = lines.filter(line => !line.includes(email) && !line.includes(website) &&
    !phoneMatches.some(phone => line.includes(phone)) &&
    /street|st\.|avenue|ave\.|road|rd\.|zone|israel|türkiye|turkey|istanbul|ankara|izmir|\b\d{5,7}\b/i.test(line));
  return {
    companyName,
    contactName: toNameCase(contactName),
    title: titleLines.join(' · ') || title,
    phone: phoneMatches.join(' / '),
    email,
    website,
    address: addressLines.join(', '),
    notes: `OCR metni:\n${text.trim()}`
  };
}

function toNameCase(value) {
  if (!value || value !== value.toLocaleUpperCase('tr-TR')) return value;
  return value.toLocaleLowerCase('tr-TR').replace(/(^|\s)[a-zçğıöşü]/g, char => char.toLocaleUpperCase('tr-TR'));
}

cardForm.addEventListener('submit', async event => {
  event.preventDefault();
  const button = cardForm.querySelector('[type=submit]');
  const body = formDataToObject(cardForm); const id = body.id; delete body.id;
  button.disabled = true; button.textContent = 'Kaydediliyor…';
  try {
    await api(id ? `/api/cards/${encodeURIComponent(id)}` : '/api/cards', {
      method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    notify(id ? 'Kayıt güncellendi.' : 'Kartvizit kaydedildi.');
    cardForm.reset(); showPanel('home');
  } catch (error) { notify(error.message, true); }
  finally { button.disabled = false; button.textContent = 'Kaydet'; }
});

document.querySelector('#searchForm').addEventListener('submit', async event => {
  event.preventDefault();
  const query = document.querySelector('#searchInput').value.trim();
  const info = document.querySelector('#searchInfo'); const results = document.querySelector('#results');
  info.textContent = 'Aranıyor…'; results.innerHTML = '';
  try {
    const data = await api(`/api/cards/search?q=${encodeURIComponent(query)}`);
    info.textContent = data.results.length ? `${data.results.length} kayıt bulundu.` : 'Eşleşen kayıt bulunamadı.';
    data.results.forEach(card => {
      const article = document.createElement('article'); article.className = 'result';
      const safe = value => { const span = document.createElement('span'); span.textContent = value || '—'; return span.innerHTML; };
      article.innerHTML = `<h3>${safe(card.companyName || 'İsimsiz Firma')}</h3><p class="person">${safe(card.contactName)}${card.title ? ` · ${safe(card.title)}` : ''}</p><div class="details"><span>☎ ${safe(card.phone)}</span><span>✉ ${safe(card.email)}</span><span>⌂ ${safe(card.address)}</span><span>↗ ${safe(card.website)}</span></div><footer></footer>`;
      const edit = document.createElement('button'); edit.textContent = 'Düzenle'; edit.onclick = () => fillForm(card, 'Düzenleme');
      article.querySelector('footer').append(edit); results.append(article);
    });
  } catch (error) { info.textContent = ''; notify(error.message, true); }
});
