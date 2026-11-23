# Гід по деплою та безпечному налаштуванню ключів (`deploy.md`)

Цей документ описує **5 способів розгортання** додатку (включно з повністю безкоштовними) та чіткі правила безпеки: **які ключі існують, де їх брати і куди саме вказувати**.

---

## 1. Змінні середовища та правила безпеки ключів

### Які змінні існують

| Змінна | Обов'язкова? | Секретна? | Призначення |
| :--- | :---: | :---: | :--- |
| `PORT` | Ні (за замовч. `3000`) | Ні | Порт Node.js сервера (більшість хостингів задають автоматично) |
| `NODE_ENV` | Так (`production`) | Ні | Вмикає роздачу зібраного `dist/` без Vite dev-сервера |
| `TELEGRAM_BOT_TOKEN` | Лише для входу через Telegram | **ТАК (Секрет!)** | Токен бота від `@BotFather`. Використовується **тільки на сервері** для перевірки криптографічного підпису `HMAC-SHA256` Telegram Mini App та Login Widget |
| `TELEGRAM_BOT_USERNAME` | Лише для кнопки Telegram у браузері | Ні | Публічний username бота **без `@`** (напр. `dpem_map_bot`) |
| `TELEGRAM_ADMIN_IDS` | Ні | Бажано приховати | Список числових Telegram ID через кому (напр. `123456789,987654321`) |
| `SESSION_SIGNING_SECRET` | Ні (рекомендовано для prod) | **ТАК (Секрет!)** | Випадковий 64-символьний рядок для підпису Bearer-сесій Telegram (якщо не задати — генерується в пам'яті при старті) |
| `CARTO_API_KEY` | Ні | **ТАК (Секрет!)** | Опційний ключ для тайлів CARTO. Якщо порожньо — карта безкоштовно використовує OpenStreetMap |

### Залізні правила безпеки ключів
1. **НІКОЛИ не додавайте префікс `VITE_`** до `TELEGRAM_BOT_TOKEN`, `CARTO_API_KEY` чи `SESSION_SIGNING_SECRET` — усе з `VITE_` вшивається у відкритий JS-код браузера!
2. **НІКОЛИ не комітьте файл `.env`** у GitHub (він вже доданий у `.gitignore`; у репозиторії має бути лише шаблон `.env.example` з порожніми значеннями).
3. **Firebase конфіг (`firebase-applet-config.json`)** містить публічний ідентифікатор веб-клієнта Firebase (це нормально за архітектурою Firebase — безпека забезпечується виключно через **`firestore.rules`** та список авторизованих доменів у Firebase Console).
4. **Обов'язково додайте ваш новий домен у Firebase Console:**
   - Відкрийте [Firebase Console](https://console.firebase.google.com/) → **Authentication** → **Settings** → **Authorized domains** → **Add domain** → вкажіть домен вашого сайту (напр. `dpem-map.onrender.com` або ваш власний домен). Без цього вхід через Google на новому домені не спрацює!

---

## 2. Спосіб №1 — Google Cloud Run / AI Studio Publish (найпростіший)
- **Вартість:** є великий безкоштовний щомісячний ліміт Cloud Run (2 млн запитів/міс, 360 000 vCPU-сек), але Google Cloud вимагає прив'язану платіжну картку (Billing Account).
- **Як задеплоїти:**
  1. Натисніть **Publish / Deploy** в AI Studio (або `gcloud run deploy` з репозиторію).
  2. Скрипт запуску вже налаштований у `package.json`: `"build": "vite build"` та `"start": "node server.ts"` (сумісно з Node.js 22 native ESM).
- **Куди вказати ключі:**
  - В AI Studio: **Settings → Secrets** (або в Google Cloud Console → **Cloud Run** → ваш сервіс → **Edit & Deploy New Revision** → вкладка **Variables & Secrets** → **Add Variable / Reference a Secret**).
  - Додайте `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `SESSION_SIGNING_SECRET` (за потреби).

---

## 3. Спосіб №2 — Render.com Free Tier (безкоштовно, без прив'язки картки)
Ідеальний варіант для тестування та невеликої аудиторії (до 50–200 користувачів) з автоматичним HTTPS (потрібним для PWA та Telegram Mini App).

1. Завантажте код у приватний або публічний репозиторій **GitHub**.
2. Зареєструйтесь на [render.com](https://render.com) → **New +** → **Web Service** → підключіть ваш репозиторій.
3. Заповніть параметри:
   - **Runtime:** `Node` (версія Node 22: додайте змінну `NODE_VERSION=22`)
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Instance Type:** `Free`
4. **Куди вказати ключі:**
   - На тій самій сторінці (або після створення у вкладці **Environment** → **Environment Variables**) натисніть **Add Environment Variable**:
     - `NODE_ENV` = `production`
     - `NODE_VERSION` = `22`
     - `TELEGRAM_BOT_TOKEN` = `<ваш токен від @BotFather>`
     - `TELEGRAM_BOT_USERNAME` = `<username бота без @>`
     - `SESSION_SIGNING_SECRET` = `<випадкові 64 символи>`
5. Після деплою отримаєте HTTPS-посилання `https://<name>.onrender.com`.
6. Додайте `<name>.onrender.com` у **Firebase Console → Authentication → Settings → Authorized domains**.

> **Примітка про Render Free:** сервер «засинає» після 15 хв без запитів (холодний старт ~20–30 сек при першому заході). PWA-кеш при цьому миттєво відкриє оболонку та останній графік.

---

## 4. Спосіб №3 — Fly.io або Railway (мінімальна затримка, завжди швидкий старт)
1. Встановіть CLI (`flyctl`) або підключіть GitHub у [railway.app](https://railway.app).
2. Команда збірки: `npm ci && npm run build`, запуск: `NODE_ENV=production npm start`.
3. **Куди вказати ключі:**
   - **Fly.io (найбезпечніше — зашифровані секрети):**
     ```bash
     fly secrets set NODE_ENV=production \
       TELEGRAM_BOT_TOKEN="ваш_токен" \
       TELEGRAM_BOT_USERNAME="ваш_бот" \
       SESSION_SIGNING_SECRET="$(openssl rand -hex 32)"
     ```
   - **Railway:** відкрийте сервіс → вкладка **Variables** → **New Variable** (або **Raw Editor**) і додайте змінні туди.

---

## 5. Спосіб №4 — Власний VPS (Ubuntu / Debian + Docker або PM2 + Nginx + HTTPS)
Найкращий варіант для повного контролю, відсутності «засинання» та зберігання файлів на диску.

### Швидкий запуск через Node.js 22 + PM2:
```bash
# 1. Клонуйте репозиторій
git clone <URL_ВАШОГО_РЕПОЗИТОРІЮ> dpem-map
cd dpem-map

# 2. Встановіть залежності та зберіть фронтенд + PWA
npm ci
npm run build

# 3. Створіть захищений файл .env (доступ тільки власнику файлу)
cat << 'EOF' > .env
NODE_ENV=production
PORT=3000
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=
TELEGRAM_ADMIN_IDS=
SESSION_SIGNING_SECRET=$(openssl rand -hex 32)
EOF
chmod 600 .env

# 4. Запустіть через PM2 (автоперезапуск після ребуту)
npm i -g pm2
pm2 start "node --env-file=.env server.ts" --name dpem-map
pm2 save
pm2 startup
```
Налаштуйте **Nginx / Caddy** як reverse proxy на `http://127.0.0.1:3000` з безкоштовним SSL-сертифікатом **Let's Encrypt** (`certbot --nginx` або автоматичний HTTPS у Caddy).

---

## 6. Спосіб №5 — Роздільний деплой: Cloudflare Pages (фронтенд) + Cloudflare Worker (API)
У проєкті вже є базовий шаблон у `backend/` та `wrangler.toml` для проксування ДПЕМ через Cloudflare Workers (100 000 безкоштовних запитів/день, без засинання):
1. Задеплойте `backend/` через `npx wrangler deploy`.
2. **Куди вказати ключі у Cloudflare:**
   ```bash
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   npx wrangler secret put SESSION_SIGNING_SECRET
   ```
3. Задеплойте `dist/` на **Cloudflare Pages** (Build command: `npm run build`, Output directory: `dist`) та вкажіть URL Worker у вкладці **Адмін → URL API**.

---

## 7. Налаштування Telegram Mini App та входу через Telegram (3 хвилини)

1. Відкрийте **[@BotFather](https://t.me/BotFather)** у Telegram → `/newbot` → отримайте **Bot Token** та **username** бота (наприклад `dpem_yu_bot`).
2. **Підключіть Mini App (кнопка відкриття карти в Telegram):**
   - У `@BotFather` введіть `/mybots` → оберіть бота → **Bot Settings → Menu Button → Configure menu button** → вставте ваш HTTPS-домен (напр. `https://dpem-map.onrender.com`) і назву кнопки `Карта світла`.
   - Або створіть Direct Link Mini App: `/newapp` → вкажіть ваш HTTPS-домен (тоді запрацюють короткі посилання з чергою, напр. `https://t.me/dpem_yu_bot/map?startapp=q_3_1`).
3. **Увімкніть Telegram Login Widget (для входу через Telegram у звичайному браузері):**
   - У `@BotFather` введіть `/setdomain` → оберіть бота → вкажіть ваш домен (без `https://`, напр. `dpem-map.onrender.com`).
4. **Додайте ключі в налаштування хостингу (див. розділи вище):**
   - `TELEGRAM_BOT_TOKEN` = токен від `@BotFather`
   - `TELEGRAM_BOT_USERNAME` = `dpem_yu_bot` (без `@`)
5. Перезапустіть сервер — вхід через Telegram та перевірка підпису `HMAC-SHA256` запрацюють автоматично.

---

## 8. Деплой правил безпеки Firestore (`firestore.rules`)
Якщо ви змінюєте `firestore.rules` локально:
```bash
# 1. Перевірка правил лінтером безпеки
npx eslint firestore.rules

# 2. Деплой правил у ваш Firebase проєкт
npx firebase-tools deploy --only firestore:rules
```
