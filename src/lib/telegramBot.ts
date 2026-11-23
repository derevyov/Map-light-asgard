import crypto from 'crypto';
import express from 'express';
import type { Express, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { DpemApiPayload, SlotState, SubqueueId } from './types.ts';
import { SUBQUEUES } from './types.ts';

const __tgFilename = fileURLToPath(import.meta.url);
const __tgDirname = path.dirname(__tgFilename);

type TelegramApiMethod =
  | 'getMe'
  | 'sendMessage'
  | 'sendPhoto'
  | 'answerCallbackQuery'
  | 'setWebhook'
  | 'deleteWebhook'
  | 'getUpdates'
  | 'setMyCommands'
  | 'setChatMenuButton'
  | 'setMyDescription'
  | 'setMyShortDescription';

interface TelegramUser {
  id: number;
  first_name?: string;
  username?: string;
}

interface TelegramChat {
  id: number;
  type?: string;
}

interface TelegramMessage {
  message_id?: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date?: number;
  text?: string;
}

interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramBotStatus {
  enabled: boolean;
  mode: 'disabled' | 'polling' | 'webhook';
  hasWebAppUrl: boolean;
  getDiagnostics: () => {
    resolvedBotUsername: string | null;
    profileSynced: boolean;
    lastPollOk: boolean | null;
    lastPollStatus: number | null;
    lastError: string | null;
    updatesHandled: number;
    lastReplyOk: boolean | null;
  };
}

interface TelegramBotOptions {
  app: Express;
  getDpemPayload: () => Promise<DpemApiPayload>;
}

const KYIV_TIMEZONE = 'Europe/Kyiv';
const MAX_MESSAGE_AGE_SEC = 3600; // process messages queued up to 1h while container slept

const BOT_SHORT_DESCRIPTION_UK =
  'Карта відключень ГПВ м. Південноукраїнськ (ДПЕМ) · черги 1.1–6.2, обрані адреси, живі таймери.';

const BOT_DESCRIPTION_UK = [
  '⚡ Карта відключень електроенергії м. Південноукраїнськ (ДПЕМ).',
  '',
  '• Інтерактивна карта по будинках і чергах 1.1–6.2',
  '• Екран «Мій дім» та «Обрані» з таймерами й 24-год. матрицею',
  '• Спрощений режим «Світло / Без світла»',
  '• Швидка перевірка черги прямо в чаті (/now або 3.1)',
  '',
  'Натисніть «Старт», щоб відкрити інтерактивну карту 👇',
].join('\n');

function escapeTelegramHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function sanitizeHttpsUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return null;
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function getKyivNowParts(now = new Date()): {
  isoDate: string;
  clockText: string;
  slot: number;
} {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: KYIV_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value || '00';
  const y = pick('year');
  const m = pick('month');
  const d = pick('day');
  const rawHour = Number(pick('hour'));
  const h = Number.isFinite(rawHour) ? rawHour % 24 : 0;
  const min = Number(pick('minute')) || 0;
  const slot = Math.max(0, Math.min(47, h * 2 + (min >= 30 ? 1 : 0)));
  return {
    isoDate: `${y}-${m}-${d}`,
    clockText: `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
    slot,
  };
}

function formatSlotStart(slot: number): string {
  if (slot >= 48) return '24:00';
  const totalMin = slot * 30;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function queueDisplay(q: SubqueueId): string {
  return q.replace('-', '.');
}

function normalizeQueueQuery(raw: string): SubqueueId | null {
  const match = raw.match(/\b([1-6])\s*[.\-_/]\s*([12])\b/);
  if (!match) return null;
  const candidate = `${match[1]}-${match[2]}` as SubqueueId;
  return SUBQUEUES.includes(candidate) ? candidate : null;
}

function stateEmoji(state: SlotState | undefined): string {
  if (state === 'off') return '🔴';
  if (state === 'switch_off' || state === 'switch_on') return '🟠';
  if (state === 'possible') return '🟡';
  return '🟢';
}

function stateTextUk(state: SlotState | undefined): string {
  if (state === 'off') return 'Немає світла';
  if (state === 'switch_off') return 'Вимкнення';
  if (state === 'switch_on') return 'Увімкнення';
  if (state === 'possible') return 'Можливе відключення';
  return 'Є світло';
}

function buildMergedLightDarkLines(slots: SlotState[]): string[] {
  const merged: Array<{ start: number; end: number; isOn: boolean }> = [];
  for (let i = 0; i < Math.min(48, slots.length); i++) {
    const s = slots[i];
    const isOn = s === 'on' || s === 'switch_on' || s === 'possible';
    const prev = merged[merged.length - 1];
    if (prev && prev.isOn === isOn) {
      prev.end = i + 1;
    } else {
      merged.push({ start: i, end: i + 1, isOn });
    }
  }
  return merged.map(
    (seg) =>
      `${seg.isOn ? '🟢' : '🔴'} <code>${formatSlotStart(seg.start)}–${formatSlotStart(seg.end)}</code> — ${
        seg.isOn ? 'Світло' : 'Без світла'
      }`
  );
}

function buildMiniAppKeyboard(
  webAppUrl: string | null,
  extra?: { queue?: SubqueueId; includeStatusButton?: boolean }
): Record<string, unknown> | undefined {
  const rows: Array<Array<Record<string, unknown>>> = [];

  if (webAppUrl) {
    if (extra?.queue) {
      const targetUrl = `${webAppUrl}/?tgWebAppStartParam=q_${extra.queue.replace('-', '_')}`;
      rows.push([
        {
          text: `🗺 Відкрити чергу ${queueDisplay(extra.queue)} на карті`,
          web_app: { url: targetUrl },
        },
      ]);
    } else {
      rows.push([
        {
          text: '🗺 Відкрити карту ГПВ (Mini App)',
          web_app: { url: webAppUrl },
        },
      ]);
    }
  }

  if (extra?.includeStatusButton) {
    rows.push([
      {
        text: '⚡ Статус усіх черг зараз',
        callback_data: 'status_now',
      },
    ]);
  }

  return rows.length > 0 ? { inline_keyboard: rows } : undefined;
}

export function deriveWebhookSecret(botToken: string): string {
  const explicit = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (explicit && /^[A-Za-z0-9_-]{8,256}$/.test(explicit)) {
    return explicit;
  }
  return crypto
    .createHmac('sha256', botToken)
    .update('dpem-pivdennoukrainsk-tg-webhook-v1')
    .digest('hex')
    .slice(0, 48);
}

function verifySecretToken(received: string | undefined, expected: string): boolean {
  if (!received || typeof received !== 'string') return false;
  const a = Buffer.from(received, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function resolveWebAppUrl(): string | null {
  return (
    sanitizeHttpsUrl(process.env.TELEGRAM_WEBAPP_URL) ||
    sanitizeHttpsUrl(process.env.APP_URL)
  );
}

async function callTelegramApi<T = unknown>(
  botToken: string,
  method: TelegramApiMethod,
  payload?: Record<string, unknown>,
  signal?: AbortSignal
): Promise<{ ok: boolean; result?: T; status?: number; description?: string }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
      signal: signal || AbortSignal.timeout(12_000),
    });
    const data = (await res.json().catch(() => ({ ok: false }))) as {
      ok?: boolean;
      result?: T;
      description?: string;
    };
    return {
      ok: Boolean(res.ok && data.ok),
      result: data.result,
      status: res.status,
      description: typeof data.description === 'string' ? data.description.slice(0, 160) : undefined,
    };
  } catch {
    // Never log the request URL because it contains the bot token.
    return { ok: false, description: 'Network or timeout error' };
  }
}

export function formatStartMessage(firstName?: string): string {
  const safeName = firstName ? escapeTelegramHtml(firstName.slice(0, 48)) : '';
  const greeting = safeName ? `Вітаю, <b>${safeName}</b>! ⚡` : 'Вітаю! ⚡';

  return [
    greeting,
    '',
    '<b>Карта відключень ГПВ — м. Південноукраїнськ (ДПЕМ)</b>',
    '',
    'Що вміє цей бот та Mini App:',
    '• 🗺 <b>Інтерактивна карта міста</b> — поточний статус світла по кожному будинку та черзі (1.1–6.2)',
    '• ⭐ <b>«Мій дім» та «Обрані»</b> — окрема сторінка з таймером до змін і 24-годинною матрицею адрес',
    '• 🌓 <b>Режим «Світло / Без світла»</b> — спрощений графік без зайвої нарізки перемикань',
    '• ⚡ <b>Швидка перевірка прямо в чаті</b> — надішліть /now або номер черги (наприклад <code>3.1</code>)',
    '',
    'Натисніть кнопку нижче, щоб відкрити інтерактивну карту 👇',
  ].join('\n');
}

export function initTelegramBot({ app, getDpemPayload }: TelegramBotOptions): TelegramBotStatus {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim() || '';
  const webAppUrl = resolveWebAppUrl();

  const diag = {
    resolvedBotUsername: null as string | null,
    profileSynced: false,
    lastPollOk: null as boolean | null,
    lastPollStatus: null as number | null,
    lastError: null as string | null,
    updatesHandled: 0,
    lastReplyOk: null as boolean | null,
  };

  if (!botToken) {
    return {
      enabled: false,
      mode: 'disabled',
      hasWebAppUrl: Boolean(webAppUrl),
      getDiagnostics: () => ({ ...diag }),
    };
  }

  const webhookSecret = deriveWebhookSecret(botToken);
  const rawMode = (process.env.TELEGRAM_BOT_MODE || 'auto').trim().toLowerCase();

  const shouldUsePolling =
    rawMode === 'polling' ||
    (rawMode !== 'webhook' &&
      rawMode !== 'off' &&
      (!webAppUrl ||
        webAppUrl.includes('ais-dev-') ||
        process.env.NODE_ENV !== 'production'));

  const mode: TelegramBotStatus['mode'] =
    rawMode === 'off' ? 'disabled' : shouldUsePolling ? 'polling' : 'webhook';

  let cachedStartPhotoFileId: string | null = null;

  const resolveStartPhotoPath = (): string | null => {
    const candidates = [
      path.resolve(
        __tgDirname,
        '..',
        '..',
        'public',
        'assets',
        'aistudio',
        'Screenshot_20261123-061918_Chrome_8556d62f.png'
      ),
      path.resolve(__tgDirname, '..', '..', 'public', 'telegram-description-640x360.png'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  };

  const sendReply = async (
    chatId: number,
    htmlText: string,
    replyMarkup?: Record<string, unknown>
  ): Promise<void> => {
    const res = await callTelegramApi(botToken, 'sendMessage', {
      chat_id: chatId,
      text: htmlText,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
    diag.lastReplyOk = res.ok;
    if (!res.ok) {
      diag.lastError = `sendMessage (${res.status ?? 'net'}): ${res.description || 'failed'}`;
      console.warn(`Telegram ${diag.lastError}`);
    }
  };

  const sendStartPhotoReply = async (
    chatId: number,
    captionHtml: string,
    replyMarkup?: Record<string, unknown>
  ): Promise<void> => {
    if (cachedStartPhotoFileId) {
      const res = await callTelegramApi(botToken, 'sendPhoto', {
        chat_id: chatId,
        photo: cachedStartPhotoFileId,
        caption: captionHtml,
        parse_mode: 'HTML',
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      });
      if (res.ok) {
        diag.lastReplyOk = true;
        return;
      }
      cachedStartPhotoFileId = null;
    }

    const photoPath = resolveStartPhotoPath();
    if (photoPath) {
      try {
        const fileBuf = fs.readFileSync(photoPath);
        const form = new FormData();
        form.append('chat_id', String(chatId));
        form.append('caption', captionHtml);
        form.append('parse_mode', 'HTML');
        if (replyMarkup) {
          form.append('reply_markup', JSON.stringify(replyMarkup));
        }
        form.append(
          'photo',
          new Blob([fileBuf], { type: 'image/png' }),
          'dpem-map-preview.png'
        );

        const res = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
          method: 'POST',
          body: form,
          signal: AbortSignal.timeout(15_000),
        });
        const data = (await res.json().catch(() => ({ ok: false }))) as {
          ok?: boolean;
          result?: { photo?: Array<{ file_id?: string }> };
        };
        if (res.ok && data.ok) {
          const sizes = data.result?.photo;
          const bestFileId =
            Array.isArray(sizes) && sizes.length > 0
              ? sizes[sizes.length - 1]?.file_id
              : undefined;
          if (typeof bestFileId === 'string' && bestFileId.length > 0) {
            cachedStartPhotoFileId = bestFileId;
          }
          diag.lastReplyOk = true;
          return;
        }
      } catch {
        // Never log URL with bot token; fall back gracefully to sendMessage
      }
    }

    await sendReply(chatId, captionHtml, replyMarkup);
  };

  const buildStatusNowText = async (): Promise<string> => {
    const payload = await getDpemPayload();
    const kyiv = getKyivNowParts();
    const dates = Object.keys(payload.scheduleByDate || {}).sort().reverse();
    const targetDate = payload.scheduleByDate[kyiv.isoDate] ? kyiv.isoDate : dates[0];
    const day = targetDate ? payload.scheduleByDate[targetDate] : undefined;

    if (!day) {
      return '⚠️ Графік ГПЕМ тимчасово недоступний. Спробуйте відкрити карту через хвилину.';
    }

    const lines: string[] = [
      `⚡ <b>Статус черг зараз (${kyiv.clockText}, ${targetDate})</b>`,
      '',
    ];

    for (let i = 0; i < SUBQUEUES.length; i += 2) {
      const q1 = SUBQUEUES[i];
      const q2 = SUBQUEUES[i + 1];
      const s1 = day.queues[q1]?.[kyiv.slot];
      const s2 = day.queues[q2]?.[kyiv.slot];
      const left = `${stateEmoji(s1)} <b>${queueDisplay(q1)}</b> ${stateTextUk(s1)}`;
      const right = q2
        ? `${stateEmoji(s2)} <b>${queueDisplay(q2)}</b> ${stateTextUk(s2)}`
        : '';
      lines.push(right ? `${left}  |  ${right}` : left);
    }

    lines.push('', 'Надішліть номер черги (наприклад <code>3.1</code>) для графіка на добу або відкрийте карту 👇');
    return lines.join('\n');
  };

  const buildQueueText = async (queue: SubqueueId): Promise<string> => {
    const payload = await getDpemPayload();
    const kyiv = getKyivNowParts();
    const dates = Object.keys(payload.scheduleByDate || {}).sort().reverse();
    const targetDate = payload.scheduleByDate[kyiv.isoDate] ? kyiv.isoDate : dates[0];
    const slots = targetDate ? payload.scheduleByDate[targetDate]?.queues?.[queue] : undefined;

    if (!slots || slots.length < 48) {
      return `⚠️ Графік для черги <b>${queueDisplay(queue)}</b> наразі відсутній.`;
    }

    const curState = slots[kyiv.slot];
    const intervals = buildMergedLightDarkLines(slots);

    return [
      `⚡ <b>Черга ${queueDisplay(queue)}</b> · ${targetDate} (зараз ${kyiv.clockText})`,
      `Поточний стан: ${stateEmoji(curState)} <b>${stateTextUk(curState)}</b>`,
      '',
      '<b>Графік на добу (об\'єднані інтервали):</b>',
      ...intervals,
    ].join('\n');
  };

  const handleUpdate = async (update: TelegramUpdate): Promise<void> => {
    diag.updatesHandled += 1;

    if (update.callback_query) {
      const cb = update.callback_query;
      await callTelegramApi(botToken, 'answerCallbackQuery', {
        callback_query_id: cb.id,
      });
      const chatId = cb.message?.chat?.id;
      if (chatId && cb.data === 'status_now') {
        const text = await buildStatusNowText();
        await sendReply(chatId, text, buildMiniAppKeyboard(webAppUrl));
      }
      return;
    }

    const msg = update.message;
    if (!msg || typeof msg.chat?.id !== 'number') return;

    // Ignore very old backlog messages when polling starts
    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof msg.date === 'number' && nowSec - msg.date > MAX_MESSAGE_AGE_SEC) {
      return;
    }

    const text = typeof msg.text === 'string' ? msg.text.trim().slice(0, 256) : '';
    if (!text) return;

    const chatId = msg.chat.id;
    const isPrivate = !msg.chat.type || msg.chat.type === 'private';

    if (/^\/start(?:@\w+)?(?:\s|$)/i.test(text) || /^\/help(?:@\w+)?(?:\s|$)/i.test(text)) {
      await sendStartPhotoReply(
        chatId,
        formatStartMessage(msg.from?.first_name),
        buildMiniAppKeyboard(webAppUrl, { includeStatusButton: true })
      );
      return;
    }

    if (/^\/now(?:@\w+)?(?:\s|$)/i.test(text) || /^\/status(?:@\w+)?(?:\s|$)/i.test(text)) {
      const statusText = await buildStatusNowText();
      await sendReply(chatId, statusText, buildMiniAppKeyboard(webAppUrl));
      return;
    }

    const queueMatch =
      /^\/(?:q|queue)(?:@\w+)?\s+(.+)$/i.exec(text)?.[1] ||
      (isPrivate && text.length <= 16 ? text : null);

    if (queueMatch) {
      const queue = normalizeQueueQuery(queueMatch);
      if (queue) {
        const qText = await buildQueueText(queue);
        await sendReply(chatId, qText, buildMiniAppKeyboard(webAppUrl, { queue }));
        return;
      }
    }

    if (isPrivate) {
      await sendReply(
        chatId,
        'Натисніть /start для довідки, /now для статусу всіх черг або введіть номер черги (наприклад <code>3.1</code>). Або відкрийте інтерактивну карту 👇',
        buildMiniAppKeyboard(webAppUrl, { includeStatusButton: true })
      );
    }
  };

  // Always mount the hardened webhook endpoint (strictly authenticated by secret token header)
  app.post('/api/telegram/webhook', express.json({ limit: '32kb' }), (req: Request, res: Response) => {
    const receivedSecret = req.header('x-telegram-bot-api-secret-token');
    if (!verifySecretToken(receivedSecret, webhookSecret)) {
      res.status(401).json({ ok: false });
      return;
    }

    const update = req.body as TelegramUpdate | undefined;
    if (!update || typeof update.update_id !== 'number') {
      res.status(400).json({ ok: false });
      return;
    }

    res.status(200).json({ ok: true });
    void handleUpdate(update).catch(() => {
      // swallow per-update errors without crashing server
    });
  });

  if (mode === 'disabled') {
    return {
      enabled: true,
      mode: 'disabled',
      hasWebAppUrl: Boolean(webAppUrl),
      getDiagnostics: () => ({ ...diag }),
    };
  }

  // Bootstrap bot identity, description, commands, menu button, and transport (non-blocking)
  const abortController = new AbortController();
  const stopPolling = () => abortController.abort();
  process.once('SIGTERM', stopPolling);
  process.once('SIGINT', stopPolling);

  void (async () => {
    const [meRes, cmdRes, descRes, shortDescRes] = await Promise.all([
      callTelegramApi<{ username?: string }>(botToken, 'getMe'),
      callTelegramApi(botToken, 'setMyCommands', {
        commands: [
          { command: 'start', description: 'Про бота та відкрити карту ГПВ' },
          { command: 'now', description: 'Статус усіх черг (1.1–6.2) зараз' },
          { command: 'help', description: 'Довідка по командах' },
        ],
      }),
      callTelegramApi(botToken, 'setMyDescription', {
        description: BOT_DESCRIPTION_UK,
      }),
      callTelegramApi(botToken, 'setMyShortDescription', {
        short_description: BOT_SHORT_DESCRIPTION_UK,
      }),
    ]);

    if (meRes.ok && typeof meRes.result?.username === 'string') {
      diag.resolvedBotUsername = meRes.result.username;
    }

    let menuOk = true;
    if (webAppUrl) {
      const menuRes = await callTelegramApi(botToken, 'setChatMenuButton', {
        menu_button: {
          type: 'web_app',
          text: 'Карта ГПВ',
          web_app: { url: webAppUrl },
        },
      });
      menuOk = menuRes.ok;
    }

    diag.profileSynced = Boolean(cmdRes.ok && descRes.ok && shortDescRes.ok && menuOk);

    if (mode === 'webhook' && webAppUrl) {
      const webhookUrl = `${webAppUrl}/api/telegram/webhook`;
      const reg = await callTelegramApi(botToken, 'setWebhook', {
        url: webhookUrl,
        secret_token: webhookSecret,
        allowed_updates: ['message', 'callback_query'],
      });
      diag.lastPollOk = reg.ok;
      diag.lastPollStatus = reg.status ?? null;
      if (!reg.ok) diag.lastError = `setWebhook: ${reg.description || 'failed'}`;
      console.log(
        `Telegram bot webhook ${reg.ok ? 'registered' : 'registration pending'}`
      );
      return;
    }

    // Long-polling mode (ideal for local dev & AI Studio preview behind auth proxy)
    await callTelegramApi(botToken, 'deleteWebhook', { drop_pending_updates: false });
    console.log('Telegram bot started in long-polling mode');

    let offset = 0;
    let backoffMs = 2000;

    while (!abortController.signal.aborted) {
      const pollRes = await callTelegramApi<TelegramUpdate[]>(
        botToken,
        'getUpdates',
        {
          offset,
          timeout: 25,
          allowed_updates: ['message', 'callback_query'],
        },
        abortController.signal
      );

      if (abortController.signal.aborted) break;

      diag.lastPollOk = pollRes.ok;
      diag.lastPollStatus = pollRes.status ?? null;

      if (!pollRes.ok || !Array.isArray(pollRes.result)) {
        diag.lastError = `getUpdates (${pollRes.status ?? 'net'}): ${pollRes.description || 'failed'}`;
        // 409 Conflict means another instance is polling/webhook is active — back off politely
        const delay = pollRes.status === 409 ? 15_000 : backoffMs;
        backoffMs = Math.min(backoffMs * 2, 30_000);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      backoffMs = 2000;
      for (const upd of pollRes.result) {
        if (typeof upd.update_id === 'number' && upd.update_id >= offset) {
          offset = upd.update_id + 1;
        }
        try {
          await handleUpdate(upd);
        } catch {
          // isolate single update failures
        }
      }
    }
  })();

  return {
    enabled: true,
    mode,
    hasWebAppUrl: Boolean(webAppUrl),
    getDiagnostics: () => ({ ...diag }),
  };
}
