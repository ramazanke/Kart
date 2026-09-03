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
    const data = new FormData(); data.append('image', selectedFile);
    const parsed = await api('/api/ocr', { method: 'POST', body: data });
    fillForm(parsed.card || parsed, 'Taramadan');
    notify('Bilgiler forma aktarıldı. Lütfen kontrol edin.');
  } catch (error) {
    if (error.message.includes('yapılandırılmadı')) {
      fillForm({}, 'Fotoğraftan / Manuel');
      notify('OCR bağlı değil; bilgileri elle tamamlayabilirsiniz.', true);
    } else notify(error.message, true);
  } finally { button.disabled = false; button.textContent = 'Bilgileri Oku'; }
});

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
