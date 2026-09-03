# Kartvizit Yönetimi

Telefon kamerasından kartvizit alma, manuel kayıt ve Google Sheets üzerinde firma/yetkili sorgulama özellikli mobil uyumlu web uygulaması.

## Tamamen ücretsiz kurulum (önerilen)

Bu yöntemde Google Cloud, kredi kartı, Service Account veya Vercel gerekmez.

1. Google E-Tablo oluşturun ve alt sekmesine `Kartvizitler` adını verin.
2. İlk satıra şu sütunları yazın: `ID | Kayıt Tarihi | Firma Adı | Yetkili Kişi | Ünvan | Telefon | E-posta | Web | Adres | Not`.
3. E-Tabloda **Uzantılar → Apps Script** menüsünü açın.
4. Editördeki mevcut kodu silip projedeki `apps-script/Code.gs` dosyasının tamamını yapıştırın ve kaydedin.
5. Sağ üstten **Dağıt → Yeni dağıtım** seçin. Tür olarak **Web uygulaması**, çalıştıran kullanıcı olarak **Ben**, erişim için **Herkes** seçin ve dağıtın.
6. Google'ın istediği izinleri onaylayın. Oluşan ve `/exec` ile biten Web uygulaması adresini kopyalayın.
7. `public/config.js` dosyasını açıp adresi şu satıra ekleyin:

```js
window.APPS_SCRIPT_URL = 'https://script.google.com/macros/s/SIZE_VERILEN_KOD/exec';
```

8. `public` klasöründeki `index.html`, `styles.css`, `app.js` ve `config.js` dosyalarını GitHub Pages'a yükleyin veya `index.html` dosyasını açarak deneyin.

Apps Script kodunu daha sonra değiştirirseniz **Dağıt → Dağıtımları yönet → Düzenle → Yeni sürüm → Dağıt** işlemini yapmanız gerekir.

> Önemli: `Code.gs` değiştirildiğinde yalnızca kaydetmek yeterli değildir. Dağıtımı yeni sürümle güncellemezseniz web uygulaması eski kodu çalıştırmaya devam eder.

## Özellikler

- Kartvizit fotoğrafı çekme veya galeriden seçme
- Türkçe ve İngilizce kartvizitleri cihaz içinde ücretsiz okuyan Tesseract.js OCR
- Harici OCR/AI servisine bağlanabilen güvenli backend endpoint'i
- Firma, yetkili, ünvan, telefon, e-posta, web, adres ve not alanları
- Firma adı veya yetkili adına göre kısmi ve Türkçe büyük/küçük harf duyarsız arama
- Kayıt oluşturma, tek kayıt okuma, arama ve güncelleme API'leri
- Google kimlik bilgilerini yalnızca sunucuda tutan `.env` yapılandırması
- Express ile yerel, Vercel ile serverless çalışma

## 1. Google Sheet hazırlama

Yeni bir Google Sheet oluşturun. Alt sekmenin adını `Kartvizitler` yapın ve ilk satıra şu başlıkları, aynı sırayla yazın:

```text
ID | Kayıt Tarihi | Firma Adı | Yetkili Kişi | Ünvan | Telefon | E-posta | Web | Adres | Not
```

Sheet adresindeki `/d/` ile `/edit` arasındaki değer `SHEET_ID` değeridir.

## 2. Google Cloud ve Service Account

1. [Google Cloud Console](https://console.cloud.google.com/) içinde bir proje oluşturun veya seçin.
2. **APIs & Services → Library** bölümünden **Google Sheets API** hizmetini etkinleştirin.
3. **IAM & Admin → Service Accounts** bölümünden bir service account oluşturun.
4. Service account içinde **Keys → Add key → Create new key → JSON** ile anahtar indirin.
5. Google Sheet'i açın ve **Paylaş** düğmesinden JSON dosyasındaki `client_email` adresine **Düzenleyici** erişimi verin. Bu adım atlanırsa API 403 hatası verir.

API anahtarı tek başına özel bir Sheet'e satır yazmak için yeterli değildir. Bu uygulama sunucuda service account kullanır.

## 3. Yerel kurulum

Node.js 18 veya daha yeni bir sürüm gereklidir.

```bash
npm install
cp .env.example .env
```

Windows PowerShell'de kopyalama komutu:

```powershell
Copy-Item .env.example .env
```

`.env` içindeki ayarları doldurun. İki kimlik doğrulama seçeneği vardır:

### Seçenek A — JSON içeriğini env değişkeninde tutmak (Vercel için önerilir)

İndirilen JSON dosyasının tamamını tek satır halinde `GOOGLE_SERVICE_ACCOUNT_JSON` değerine koyun. `private_key` içindeki satır sonları `\n` olarak kalmalıdır.

### Seçenek B — Yerel JSON dosyası

JSON'u proje klasörüne `service-account.json` adıyla koyun ve `.env` içine şunu ekleyin:

```env
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
```

Bu dosya `.gitignore` kapsamındadır; GitHub'a yüklemeyin.

Uygulamayı başlatın:

```bash
npm run dev
```

Ardından `http://localhost:3000` adresini açın.

## Ortam değişkenleri

| Değişken | Zorunlu | Açıklama |
|---|---:|---|
| `SHEET_ID` | Evet | Google Sheet kimliği |
| `SHEET_NAME` | Hayır | Alt sekme adı; varsayılan `Kartvizitler` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Dağıtımda | Service account JSON içeriği |
| `GOOGLE_APPLICATION_CREDENTIALS` | Yerel alternatif | Service account JSON dosya yolu |
| `OCR_API_URL` | Hayır | Görsel kabul eden harici OCR/AI endpoint'i |
| `OCR_API_KEY` | Hayır | OCR servisi Bearer anahtarı |
| `PORT` | Hayır | Yerel port; varsayılan 3000 |

## OCR/AI endpoint sözleşmesi

Frontend görseli `POST /api/ocr` adresine, `multipart/form-data` içinde `image` alanıyla gönderir. Backend bunu `OCR_API_URL` adresine aktarır. Harici servis şu alanları doğrudan veya `{ "card": { ... } }` altında döndürebilir:

```json
{
  "companyName": "ABC Makina",
  "contactName": "Ahmet Yılmaz",
  "title": "Satış Müdürü",
  "phone": "+90 532 000 00 00",
  "email": "ahmet@example.com",
  "website": "https://example.com",
  "address": "İstanbul",
  "notes": ""
}
```

OCR ayarlanmadığında kullanıcıya bilgi verilir ve aynı kayıt formu manuel doldurulmak üzere açılır. OpenAI Vision, Google Cloud Vision veya başka bir servis için yalnızca sunucudaki `/api/ocr` adaptörünü değiştirmeniz yeterlidir; gizli anahtarı frontend'e koymayın.

## API

- `POST /api/cards` — yeni kayıt
- `GET /api/cards/search?q=abc` — firma/yetkili adına göre arama
- `GET /api/cards/:id` — tek kayıt
- `PUT /api/cards/:id` — kayıt güncelleme
- `POST /api/ocr` — kartvizit görselini OCR servisine gönderme
- `GET /api/health` — sağlık kontrolü

## GitHub'a yükleme

```bash
git init
git add .
git commit -m "Kartvizit yonetim uygulamasi"
git branch -M main
git remote add origin https://github.com/KULLANICI/DEPO.git
git push -u origin main
```

Commit öncesi `git status` ile `.env` veya service account JSON dosyasının listelenmediğini mutlaka kontrol edin.

## Vercel'e dağıtma

1. Projeyi GitHub'a gönderin.
2. [Vercel](https://vercel.com/) üzerinde **Add New → Project** ile depoyu içe aktarın.
3. Framework ayarını **Other** bırakın; proje kökü bu klasör olmalıdır.
4. **Settings → Environment Variables** altında `SHEET_ID`, `SHEET_NAME` ve `GOOGLE_SERVICE_ACCOUNT_JSON` değerlerini ekleyin. OCR kullanacaksanız `OCR_API_URL` ve `OCR_API_KEY` değerlerini de ekleyin.
5. Deploy edin. Sonrasında `/api/health` adresinin `{ "ok": true }` döndürdüğünü kontrol edin.

Vercel'de dosya yolu yerine `GOOGLE_SERVICE_ACCOUNT_JSON` kullanın; dağıtım paketine secret dosyası eklemeyin.

## Güvenlik notları

- `.env`, service account JSON dosyaları ve özel anahtarlar `.gitignore` içindedir.
- Google Sheet'i herkese açık yapmayın; yalnızca service account e-postasıyla paylaşın.
- Service account'a proje genelinde geniş rol vermek gerekmez; ilgili Sheet paylaşımı yeterlidir.
- Üretimde kötüye kullanımı önlemek için oturum açma, hız sınırı ve istek doğrulama eklenmesi önerilir.
- Bir secret yanlışlıkla GitHub'a gönderilirse dosyayı silmek yetmez; Google Cloud'dan anahtarı iptal edip yenisini oluşturun.
