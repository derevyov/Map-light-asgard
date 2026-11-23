import crypto from 'crypto';
import express from 'express';
import type { Express, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { DpemApiPayload, SlotState, SubqueueId, TelegramFavoriteItem } from './types.ts';
import { SUBQUEUES } from './types.ts';

const __tgFilename = fileURLToPath(import.meta.url);
const __tgDirname = path.dirname(__tgFilename);

type TelegramApiMethod =
  | 'getMe'
  | 'sendMessage'
  | 'editMessageText'
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
  last_name?: string;
  username?: string;
}

interface TelegramChat {
  id: number;
  type?: string;
}

interface TelegramPhotoSize {
  file_id: string;
  width?: number;
  height?: number;
}

interface TelegramMessage {
  message_id?: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date?: number;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  reply_to_message?: TelegramMessage;
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
  getUserFavorites?: (userId: number) => TelegramFavoriteItem[];
  toggleUserFavoriteQueue?: (
    userId: number,
    queue: SubqueueId
  ) => { added: boolean; items: TelegramFavoriteItem[] };
}

const KYIV_TIMEZONE = 'Europe/Kyiv';
const MAX_MESSAGE_AGE_SEC = 3600; // process messages queued up to 1h while container slept

const BOT_SHORT_DESCRIPTION_UK =
  'Карта відключень ГПВ м. Південноукраїнськ (ДПЕМ) · черги 1.1–6.2, обрані адреси, живі таймери.';

function isAiStudioPrivateUrl(url: string | null): boolean {
  if (!url) return false;
  return /^https:\/\/ais-(?:dev|pre)-[^/]+\.run\.app(?:\/|$)/i.test(url);
}

function buildBotDescriptionUk(publicSiteUrl: string | null): string {
  const lines = [
    '⚡ Карта відключень електроенергії м. Південноукраїнськ (ДПЕМ).',
    '',
    '• Інтерактивна карта по будинках і чергах 1.1–6.2',
    '• Екран «Мій дім» та «Обрані» з таймерами й 24-год. матрицею',
    '• Статистика невезучих черг та гарячих точок (7 / 30 днів)',
    '• Швидка перевірка черги прямо в чаті (/now або 3.1)',
    '• Зворотний звʼязок з адміністратором (/feedback)',
  ];
  if (publicSiteUrl && !isAiStudioPrivateUrl(publicSiteUrl)) {
    lines.push('', `🌐 Повний сайт: ${publicSiteUrl}`);
  }
  lines.push('', 'Натисніть «Старт», щоб відкрити інтерактивну карту 👇');
  return lines.join('\n');
}

const DEFAULT_TELEGRAM_ADMIN_ID = 385900759;

function parseTelegramIdList(raw: string | undefined): number[] {
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isSafeInteger(n) && n !== 0);
}

function resolveFeedbackAdminIds(): number[] {
  const explicit = parseTelegramIdList(process.env.TELEGRAM_FEEDBACK_CHAT_ID);
  const admins = parseTelegramIdList(process.env.TELEGRAM_ADMIN_IDS);
  return Array.from(new Set([DEFAULT_TELEGRAM_ADMIN_ID, ...explicit, ...admins]));
}

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
  extra?: {
    queue?: SubqueueId;
    includeStatusButton?: boolean;
    includeFavoritesButtons?: boolean;
    includeWebsiteButton?: boolean;
    includeFeedbackButton?: boolean;
  }
): Record<string, unknown> | undefined {
  const rows: Array<Array<Record<string, unknown>>> = [];

  if (extra?.includeFavoritesButtons) {
    rows.push([
      {
        text: '⭐ Обрані зараз',
        callback_data: 'fav_now',
      },
      {
        text: '📅 План обраних',
        callback_data: 'fav_plan',
      },
    ]);
  }

  if (webAppUrl) {
    const queueUrl = extra?.queue
      ? `${webAppUrl}/?tgWebAppStartParam=q_${extra.queue.replace('-', '_')}`
      : webAppUrl;

    if (extra?.queue) {
      rows.push([
        {
          text: `🗺 Відкрити чергу ${queueDisplay(extra.queue)} на карті`,
          web_app: { url: queueUrl },
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

    if (extra?.includeWebsiteButton !== false) {
      rows.push([
        {
          text: '🌐 Відкрити повний сайт у браузері',
          url: queueUrl,
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

  if (extra?.includeFeedbackButton) {
    rows.push([
      {
        text: '✉️ Написати зворотний звʼязок',
        callback_data: 'feedback_start',
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

const DEFAULT_PUBLIC_SITE_URL = 'https://map-light-asgard.onrender.com';

export function resolveWebAppUrl(): string | null {
  const candidates = [
    sanitizeHttpsUrl(process.env.TELEGRAM_WEBAPP_URL),
    sanitizeHttpsUrl(process.env.RENDER_EXTERNAL_URL),
    sanitizeHttpsUrl(process.env.APP_URL),
  ];
  for (const url of candidates) {
    if (url && !isAiStudioPrivateUrl(url)) {
      return url;
    }
  }
  return DEFAULT_PUBLIC_SITE_URL;
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

export function formatStartMessage(firstName?: string, webAppUrl?: string | null): string {
  const safeName = firstName ? escapeTelegramHtml(firstName.slice(0, 48)) : '';
  const greeting = safeName ? `Вітаю, <b>${safeName}</b>! ⚡` : 'Вітаю! ⚡';

  const lines = [
    greeting,
    '',
    '<b>Карта відключень ГПВ — м. Південноукраїнськ (ДПЕМ)</b>',
    '',
    'Що вміє цей бот та Mini App:',
    '• 🗺 <b>Інтерактивна карта міста</b> — поточний статус світла по кожному будинку та черзі (1.1–6.2)',
    '• ⭐ <b>«Обрані» прямо в боті</b> — кнопки «⭐ Обрані зараз» та «📅 План обраних» (/fav), синхронізуються з Mini App',
    '• 📊 <b>Статистика та прогноз</b> — невезучі черги, гарячі точки й закономірності відключень',
    '• ⚡ <b>Швидка перевірка прямо в чаті</b> — надішліть /now або номер черги (наприклад <code>3.1</code>)',
    '• ✉️ <b>Зворотний звʼязок</b> — натисніть /feedback або просто напишіть повідомлення в цей чат',
  ];

  if (webAppUrl && !isAiStudioPrivateUrl(webAppUrl)) {
    const label = webAppUrl.replace(/^https:\/\//i, '');
    lines.push(
      '',
      `🌐 <b>Повний сайт:</b> <a href="${escapeTelegramHtml(webAppUrl)}">${escapeTelegramHtml(label)}</a>`
    );
  }

  lines.push('', 'Оберіть дію нижче або відкрийте інтерактивну карту 👇');
  return lines.join('\n');
}

export function initTelegramBot({
  app,
  getDpemPayload,
  getUserFavorites,
  toggleUserFavoriteQueue,
}: TelegramBotOptions): TelegramBotStatus {
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
  ): Promise<{ ok: boolean; messageId?: number }> => {
    const res = await callTelegramApi<{ message_id?: number }>(botToken, 'sendMessage', {
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
    return {
      ok: res.ok,
      messageId: typeof res.result?.message_id === 'number' ? res.result.message_id : undefined,
    };
  };

  // Feedback state: awaiting users (15 min TTL), per-user rate limit, and admin reply routing
  const awaitingFeedbackUntil = new Map<number, number>();
  const feedbackRateHits = new Map<number, number[]>();
  const adminMessageToUserChat = new Map<string, number>();

  const rememberFeedbackRoute = (adminChatId: number, adminMessageId: number | undefined, userChatId: number) => {
    if (typeof adminMessageId !== 'number') return;
    if (adminMessageToUserChat.size > 500) {
      const oldestKey = adminMessageToUserChat.keys().next().value;
      if (oldestKey) adminMessageToUserChat.delete(oldestKey);
    }
    adminMessageToUserChat.set(`${adminChatId}:${adminMessageId}`, userChatId);
  };

  const checkFeedbackRateLimit = (userId: number, isAdmin: boolean): boolean => {
    if (isAdmin) return true;
    const now = Date.now();
    const windowMs = 10 * 60 * 1000;
    const prev = (feedbackRateHits.get(userId) || []).filter((ts) => now - ts < windowMs);
    if (prev.length >= 5) {
      feedbackRateHits.set(userId, prev);
      return false;
    }
    prev.push(now);
    if (feedbackRateHits.size > 500) {
      feedbackRateHits.clear();
    }
    feedbackRateHits.set(userId, prev);
    return true;
  };

  const forwardFeedbackToAdmins = async (
    msg: TelegramMessage,
    bodyText: string,
    photoFileId?: string
  ): Promise<'sent' | 'no_admins' | 'rate_limited' | 'failed'> => {
    const adminIds = resolveFeedbackAdminIds();
    const senderId = msg.from?.id ?? msg.chat.id;
    const isAdminSender = adminIds.includes(senderId);

    if (adminIds.length === 0) {
      console.warn(
        'Telegram feedback received, but TELEGRAM_ADMIN_IDS / TELEGRAM_FEEDBACK_CHAT_ID is not configured.'
      );
      return 'no_admins';
    }

    if (!checkFeedbackRateLimit(senderId, isAdminSender)) {
      return 'rate_limited';
    }

    const fullName = [msg.from?.first_name, msg.from?.last_name]
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      .join(' ')
      .trim();
    const safeName = escapeTelegramHtml((fullName || 'Користувач').slice(0, 80));
    const safeUsername = msg.from?.username
      ? ` (@${escapeTelegramHtml(msg.from.username.slice(0, 64))})`
      : '';
    const safeBody = escapeTelegramHtml(bodyText.trim().slice(0, 1500));

    const headerLines = [
      '📩 <b>Новий зворотний звʼязок з бота</b>',
      `Від: <b>${safeName}</b>${safeUsername}`,
      `ID: <code>${senderId}</code>`,
    ];
    if (safeBody) {
      headerLines.push('', safeBody);
    }
    headerLines.push(
      '',
      '<i>Щоб відповісти користувачу, просто зробіть Reply (Відповісти) на це повідомлення.</i>'
    );
    const adminHtml = headerLines.join('\n');

    let deliveredAny = false;
    for (const adminChatId of adminIds) {
      if (photoFileId) {
        // Photo captions in Telegram are limited to 1024 chars; send photo + caption or separate message
        if (adminHtml.length <= 950) {
          const photoRes = await callTelegramApi<{ message_id?: number }>(botToken, 'sendPhoto', {
            chat_id: adminChatId,
            photo: photoFileId,
            caption: adminHtml,
            parse_mode: 'HTML',
          });
          if (photoRes.ok) {
            deliveredAny = true;
            rememberFeedbackRoute(adminChatId, photoRes.result?.message_id, msg.chat.id);
            continue;
          }
        }
        const photoRes = await callTelegramApi<{ message_id?: number }>(botToken, 'sendPhoto', {
          chat_id: adminChatId,
          photo: photoFileId,
        });
        const textRes = await sendReply(adminChatId, adminHtml);
        if (photoRes.ok || textRes.ok) {
          deliveredAny = true;
          rememberFeedbackRoute(adminChatId, textRes.messageId, msg.chat.id);
          rememberFeedbackRoute(adminChatId, photoRes.result?.message_id, msg.chat.id);
        }
      } else {
        const res = await sendReply(adminChatId, adminHtml);
        if (res.ok) {
          deliveredAny = true;
          rememberFeedbackRoute(adminChatId, res.messageId, msg.chat.id);
        }
      }
    }

    return deliveredAny ? 'sent' : 'failed';
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

  const describeNextChangeUk = (slots: SlotState[] | undefined, nowSlot: number, nowMinInDay: number): string => {
    if (!slots || slots.length < 48) return '';
    const isOff = (s: SlotState | undefined) => s === 'off' || s === 'switch_off';
    const curOff = isOff(slots[nowSlot]);
    for (let s = nowSlot + 1; s < 48; s++) {
      if (isOff(slots[s]) !== curOff) {
        const targetMin = s * 30;
        const diffMin = Math.max(1, targetMin - nowMinInDay);
        const h = Math.floor(diffMin / 60);
        const m = diffMin % 60;
        const dur = h > 0 ? (m > 0 ? `${h} год ${m} хв` : `${h} год`) : `${m} хв`;
        return `до ${formatSlotStart(s)} (через ${dur} → ${curOff ? '🟢 світло' : '🔴 відкл.'})`;
      }
    }
    return `до 24:00 без змін`;
  };

  const buildFavoritesKeyboard = (mode: 'now' | 'plan'): Record<string, unknown> => {
    const rows: Array<Array<Record<string, unknown>>> = [
      mode === 'now'
        ? [
            { text: '📅 План обраних на добу', callback_data: 'fav_plan' },
            { text: '🔄 Оновити', callback_data: 'fav_now' },
          ]
        : [
            { text: '⭐ Обрані зараз', callback_data: 'fav_now' },
            { text: '🔄 Оновити', callback_data: 'fav_plan' },
          ],
      [{ text: '⚙️ Обрати / змінити черги в чаті', callback_data: 'fav_edit' }],
    ];
    if (webAppUrl) {
      rows.push([{ text: '🗺 Відкрити карту ГПВ (Mini App)', web_app: { url: webAppUrl } }]);
    }
    return { inline_keyboard: rows };
  };

  const buildFavoritesPickerKeyboard = (userId: number): Record<string, unknown> => {
    const favs = getUserFavorites ? getUserFavorites(userId) : [];
    const activeQueues = new Set(favs.map((f) => f.queue));
    const rows: Array<Array<Record<string, unknown>>> = [];
    for (let i = 0; i < SUBQUEUES.length; i += 4) {
      const row: Array<Record<string, unknown>> = [];
      for (let j = i; j < Math.min(i + 4, SUBQUEUES.length); j++) {
        const q = SUBQUEUES[j];
        const has = activeQueues.has(q);
        row.push({
          text: `${has ? '✅' : '➕'} ${queueDisplay(q)}`,
          callback_data: `fav_toggle_${q}`,
        });
      }
      rows.push(row);
    }
    rows.push([
      { text: '⭐ Обрані зараз', callback_data: 'fav_now' },
      { text: '📅 План на добу', callback_data: 'fav_plan' },
    ]);
    if (webAppUrl) {
      rows.push([{ text: '🗺 Додати конкретні будинки в Mini App', web_app: { url: webAppUrl } }]);
    }
    return { inline_keyboard: rows };
  };

  const buildFavoritesNowText = async (userId: number): Promise<{ html: string; hasItems: boolean }> => {
    const favs = getUserFavorites ? getUserFavorites(userId) : [];
    if (favs.length === 0) {
      return {
        hasItems: false,
        html: [
          '⭐ <b>У вас ще немає обраних адрес чи черг</b>',
          '',
          'Ви можете:',
          '1️⃣ Натиснути на потрібні черги прямо нижче (1.1–6.2), щоб зберегти їх у боті;',
          '2️⃣ Або відкрити <b>Mini App</b> і додати конкретні будинки в ⭐ «Обрані» — вони автоматично зʼявляться тут!',
        ].join('\n'),
      };
    }

    const payload = await getDpemPayload();
    const kyiv = getKyivNowParts();
    const [hh, mm] = kyiv.clockText.split(':').map(Number);
    const nowMinInDay = (Number.isFinite(hh) ? hh : 0) * 60 + (Number.isFinite(mm) ? mm : 0);
    const dates = Object.keys(payload.scheduleByDate || {}).sort().reverse();
    const targetDate = payload.scheduleByDate[kyiv.isoDate] ? kyiv.isoDate : dates[0];
    const day = targetDate ? payload.scheduleByDate[targetDate] : undefined;

    if (!day) {
      return {
        hasItems: true,
        html: '⚠️ Графік ГПЕМ тимчасово недоступний. Спробуйте за хвилину.',
      };
    }

    const lines: string[] = [
      `⭐ <b>Обрані зараз</b> · ${kyiv.clockText} (${targetDate})`,
      '',
    ];

    for (const item of favs.slice(0, 12)) {
      const slots = day.queues[item.queue];
      const st = slots?.[kyiv.slot];
      const nextHint = describeNextChangeUk(slots, kyiv.slot, nowMinInDay);
      const prefix = item.isHome ? '🏠 ' : '⭐ ';
      const safeLabel = escapeTelegramHtml(item.label);
      lines.push(
        `${prefix}<b>${safeLabel}</b> (черга <b>${queueDisplay(item.queue)}</b>)`,
        `   ${stateEmoji(st)} <b>${stateTextUk(st)}</b>${nextHint ? ` · ${nextHint}` : ''}`
      );
      if (item.secondaryQueue) {
        const s2Slots = day.queues[item.secondaryQueue];
        const s2 = s2Slots?.[kyiv.slot];
        const roleLabel =
          item.dualType === 'split_lifts'
            ? '🛗 Ліфти'
            : item.dualType === 'split_entrances'
            ? '🏢 Інші підʼїзди'
            : '⚡ Резерв';
        lines.push(
          `   ↳ ${roleLabel} (<b>${queueDisplay(item.secondaryQueue)}</b>): ${stateEmoji(s2)} ${stateTextUk(s2)}`
        );
      }
      lines.push('');
    }

    return { hasItems: true, html: lines.join('\n').trim() };
  };

  const buildFavoritesPlanText = async (userId: number): Promise<{ html: string; hasItems: boolean }> => {
    const favs = getUserFavorites ? getUserFavorites(userId) : [];
    if (favs.length === 0) {
      return {
        hasItems: false,
        html: [
          '📅 <b>План по обраних порожній</b>',
          '',
          'Оберіть потрібні черги кнопками нижче або додайте будинки в ⭐ «Обрані» у Mini App.',
        ].join('\n'),
      };
    }

    const payload = await getDpemPayload();
    const kyiv = getKyivNowParts();
    const allDates = Object.keys(payload.scheduleByDate || {}).sort();
    const todayDate = payload.scheduleByDate[kyiv.isoDate]
      ? kyiv.isoDate
      : allDates[allDates.length - 1];
    const tomorrowDate = allDates.find((d) => d > (todayDate || kyiv.isoDate));
    const todayDay = todayDate ? payload.scheduleByDate[todayDate] : undefined;

    if (!todayDay) {
      return {
        hasItems: true,
        html: '⚠️ Графік ГПЕМ тимчасово недоступний. Спробуйте за хвилину.',
      };
    }

    const compactOffSummary = (slots: SlotState[] | undefined): string => {
      if (!slots || slots.length < 48) return 'немає даних';
      const offRanges: string[] = [];
      let start = -1;
      for (let i = 0; i <= 48; i++) {
        const isOff = i < 48 && (slots[i] === 'off' || slots[i] === 'switch_off');
        if (isOff && start === -1) start = i;
        else if (!isOff && start !== -1) {
          offRanges.push(`<code>${formatSlotStart(start)}–${formatSlotStart(i)}</code>`);
          start = -1;
        }
      }
      return offRanges.length > 0 ? `🔴 ${offRanges.join(', ')}` : '🟢 без відключень';
    };

    const lines: string[] = [
      `📅 <b>План по обраних на ${todayDate}</b>`,
      '',
    ];

    for (const item of favs.slice(0, 8)) {
      const slots = todayDay.queues[item.queue];
      const prefix = item.isHome ? '🏠 ' : '⭐ ';
      lines.push(
        `${prefix}<b>${escapeTelegramHtml(item.label)}</b> (черга <b>${queueDisplay(item.queue)}</b>)`
      );
      if (slots && slots.length >= 48) {
        if (favs.length <= 4) {
          lines.push(...buildMergedLightDarkLines(slots));
        } else {
          lines.push(`   Відключення: ${compactOffSummary(slots)}`);
        }
      } else {
        lines.push('   ⚠️ Немає графіка');
      }

      if (item.secondaryQueue) {
        const roleLabel =
          item.dualType === 'split_lifts'
            ? '🛗 Ліфти'
            : item.dualType === 'split_entrances'
            ? '🏢 Інші підʼїзди'
            : '⚡ 2-га черга';
        lines.push(
          `   ↳ ${roleLabel} (${queueDisplay(item.secondaryQueue)}): ${compactOffSummary(
            todayDay.queues[item.secondaryQueue]
          )}`
        );
      }
      lines.push('');
    }

    if (tomorrowDate && payload.scheduleByDate[tomorrowDate]) {
      const tmDay = payload.scheduleByDate[tomorrowDate];
      lines.push(`🔮 <b>На завтра (${tomorrowDate}):</b>`);
      for (const item of favs.slice(0, 6)) {
        lines.push(
          `• <b>${escapeTelegramHtml(item.label)}</b> (${queueDisplay(item.queue)}): ${compactOffSummary(
            tmDay.queues[item.queue]
          )}`
        );
      }
    }

    return { hasItems: true, html: lines.join('\n').trim().slice(0, 3900) };
  };

  const handleUpdate = async (update: TelegramUpdate): Promise<void> => {
    diag.updatesHandled += 1;

    if (update.callback_query) {
      const cb = update.callback_query;
      const chatId = cb.message?.chat?.id;
      const tgUserId = cb.from.id;
      const data = cb.data || '';

      if (chatId && data === 'status_now') {
        await callTelegramApi(botToken, 'answerCallbackQuery', { callback_query_id: cb.id });
        const text = await buildStatusNowText();
        await sendReply(chatId, text, buildMiniAppKeyboard(webAppUrl, { includeFavoritesButtons: true }));
        return;
      }

      if (chatId && data === 'fav_now') {
        await callTelegramApi(botToken, 'answerCallbackQuery', { callback_query_id: cb.id });
        const { html, hasItems } = await buildFavoritesNowText(tgUserId);
        await sendReply(
          chatId,
          html,
          hasItems ? buildFavoritesKeyboard('now') : buildFavoritesPickerKeyboard(tgUserId)
        );
        return;
      }

      if (chatId && data === 'fav_plan') {
        await callTelegramApi(botToken, 'answerCallbackQuery', { callback_query_id: cb.id });
        const { html, hasItems } = await buildFavoritesPlanText(tgUserId);
        await sendReply(
          chatId,
          html,
          hasItems ? buildFavoritesKeyboard('plan') : buildFavoritesPickerKeyboard(tgUserId)
        );
        return;
      }

      if (chatId && data === 'fav_edit') {
        await callTelegramApi(botToken, 'answerCallbackQuery', { callback_query_id: cb.id });
        await sendReply(
          chatId,
          '⚙️ <b>Налаштування обраних черг у боті</b>\n\nНатискайте на черги нижче, щоб додати або прибрати їх.\n<i>Якщо ви додаєте конкретні адреси в Mini App, вони синхронізуються сюди автоматично.</i>',
          buildFavoritesPickerKeyboard(tgUserId)
        );
        return;
      }

      if (chatId && data.startsWith('fav_toggle_')) {
        const q = data.slice('fav_toggle_'.length) as SubqueueId;
        if (SUBQUEUES.includes(q) && toggleUserFavoriteQueue) {
          const { added } = toggleUserFavoriteQueue(tgUserId, q);
          await callTelegramApi(botToken, 'answerCallbackQuery', {
            callback_query_id: cb.id,
            text: added
              ? `Чергу ${queueDisplay(q)} додано в обрані`
              : `Чергу ${queueDisplay(q)} прибрано з обраних`,
          });
          const nextKeyboard = buildFavoritesPickerKeyboard(tgUserId);
          if (typeof cb.message?.message_id === 'number') {
            await callTelegramApi(botToken, 'editMessageText', {
              chat_id: chatId,
              message_id: cb.message.message_id,
              text: '⚙️ <b>Налаштування обраних черг у боті</b>\n\nНатискайте на черги нижче, щоб додати або прибрати їх.\n<i>Якщо ви додаєте конкретні адреси в Mini App, вони синхронізуються сюди автоматично.</i>',
              parse_mode: 'HTML',
              reply_markup: nextKeyboard,
            });
          } else {
            await sendReply(chatId, '✅ Список обраних черг оновлено.', nextKeyboard);
          }
          return;
        }
      }

      await callTelegramApi(botToken, 'answerCallbackQuery', {
        callback_query_id: cb.id,
      });

      if (chatId && data === 'feedback_start') {
        if (awaitingFeedbackUntil.size > 500) awaitingFeedbackUntil.clear();
        awaitingFeedbackUntil.set(chatId, Date.now() + 15 * 60 * 1000);
        await sendReply(
          chatId,
          '✉️ <b>Зворотний звʼязок</b>\n\nНапишіть ваше повідомлення (або надішліть скріншот з описом) — я одразу перешлю його адміністратору.\n\n<i>Для скасування надішліть /cancel</i>'
        );
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

    const rawText = typeof msg.text === 'string' ? msg.text.trim() : '';
    const rawCaption = typeof msg.caption === 'string' ? msg.caption.trim() : '';
    const bestPhotoFileId =
      Array.isArray(msg.photo) && msg.photo.length > 0
        ? msg.photo[msg.photo.length - 1]?.file_id
        : undefined;
    const text = (rawText || rawCaption).slice(0, 1500);
    if (!text && !bestPhotoFileId) return;

    const chatId = msg.chat.id;
    const senderId = msg.from?.id ?? chatId;
    const isPrivate = !msg.chat.type || msg.chat.type === 'private';
    const adminIds = resolveFeedbackAdminIds();
    const isAdminSender = adminIds.includes(senderId);

    // Helper command to check one's own Telegram numeric ID (for TELEGRAM_ADMIN_IDS)
    if (/^\/(?:myid|id)(?:@\w+)?(?:\s|$)/i.test(rawText)) {
      await sendReply(
        chatId,
        `🆔 Ваш Telegram ID: <code>${senderId}</code>${
          isAdminSender ? '\n✅ Ви вказані як отримувач зворотного звʼязку.' : ''
        }`
      );
      return;
    }

    if (/^\/cancel(?:@\w+)?(?:\s|$)/i.test(rawText)) {
      awaitingFeedbackUntil.delete(chatId);
      await sendReply(
        chatId,
        'Скасовано. Ви можете скористатися /start, /now або відкрити карту 👇',
        buildMiniAppKeyboard(webAppUrl, { includeStatusButton: true })
      );
      return;
    }

    // Admin two-way reply: Reply to a forwarded feedback message OR `/reply <userId> <text>`
    if (isAdminSender && isPrivate) {
      const explicitReplyMatch = /^\/reply(?:@\w+)?\s+(\d+)\s+([\s\S]+)$/i.exec(rawText);
      if (explicitReplyMatch) {
        const targetUserId = Number(explicitReplyMatch[1]);
        const replyBody = explicitReplyMatch[2].trim().slice(0, 1500);
        if (Number.isSafeInteger(targetUserId) && replyBody) {
          const sent = await sendReply(
            targetUserId,
            `💬 <b>Відповідь адміністратора:</b>\n\n${escapeTelegramHtml(replyBody)}`
          );
          await sendReply(
            chatId,
            sent.ok
              ? `✅ Відповідь надіслано користувачу (ID <code>${targetUserId}</code>).`
              : `⚠️ Не вдалося доставити відповідь користувачу (ID <code>${targetUserId}</code>).`
          );
          return;
        }
      }

      if (msg.reply_to_message && !rawText.startsWith('/')) {
        const repliedMsgId = msg.reply_to_message.message_id;
        let targetUserId =
          typeof repliedMsgId === 'number'
            ? adminMessageToUserChat.get(`${chatId}:${repliedMsgId}`)
            : undefined;
        if (!targetUserId) {
          const repliedContent =
            msg.reply_to_message.text || msg.reply_to_message.caption || '';
          const idMatch = /ID:\s*(\d{5,20})/.exec(repliedContent);
          if (idMatch) {
            const parsed = Number(idMatch[1]);
            if (Number.isSafeInteger(parsed)) targetUserId = parsed;
          }
        }
        if (targetUserId) {
          let delivered = false;
          if (bestPhotoFileId) {
            const photoReplyCaption = text
              ? `💬 <b>Відповідь адміністратора:</b>\n\n${escapeTelegramHtml(text.slice(0, 900))}`
              : '💬 <b>Відповідь адміністратора</b>';
            const photoRes = await callTelegramApi(botToken, 'sendPhoto', {
              chat_id: targetUserId,
              photo: bestPhotoFileId,
              caption: photoReplyCaption,
              parse_mode: 'HTML',
            });
            delivered = photoRes.ok;
          } else {
            const res = await sendReply(
              targetUserId,
              `💬 <b>Відповідь адміністратора:</b>\n\n${escapeTelegramHtml(text)}`
            );
            delivered = res.ok;
          }
          await sendReply(
            chatId,
            delivered
              ? `✅ Відповідь надіслано користувачу (ID <code>${targetUserId}</code>).`
              : `⚠️ Не вдалося доставити відповідь користувачу (ID <code>${targetUserId}</code>).`
          );
          return;
        }
      }
    }

    if (/^\/start(?:@\w+)?(?:\s|$)/i.test(rawText) || /^\/help(?:@\w+)?(?:\s|$)/i.test(rawText)) {
      awaitingFeedbackUntil.delete(chatId);
      await sendStartPhotoReply(
        chatId,
        formatStartMessage(msg.from?.first_name, webAppUrl),
        buildMiniAppKeyboard(webAppUrl, {
          includeFavoritesButtons: true,
          includeStatusButton: true,
          includeWebsiteButton: true,
          includeFeedbackButton: true,
        })
      );
      return;
    }

    if (/^\/(?:fav|favorites)(?:@\w+)?(?:\s|$)/i.test(rawText)) {
      awaitingFeedbackUntil.delete(chatId);
      const { html, hasItems } = await buildFavoritesNowText(senderId);
      await sendReply(
        chatId,
        html,
        hasItems ? buildFavoritesKeyboard('now') : buildFavoritesPickerKeyboard(senderId)
      );
      return;
    }

    if (/^\/plan(?:@\w+)?(?:\s|$)/i.test(rawText)) {
      awaitingFeedbackUntil.delete(chatId);
      const { html, hasItems } = await buildFavoritesPlanText(senderId);
      await sendReply(
        chatId,
        html,
        hasItems ? buildFavoritesKeyboard('plan') : buildFavoritesPickerKeyboard(senderId)
      );
      return;
    }

    if (/^\/now(?:@\w+)?(?:\s|$)/i.test(rawText) || /^\/status(?:@\w+)?(?:\s|$)/i.test(rawText)) {
      awaitingFeedbackUntil.delete(chatId);
      const statusText = await buildStatusNowText();
      await sendReply(
        chatId,
        statusText,
        buildMiniAppKeyboard(webAppUrl, { includeFavoritesButtons: true })
      );
      return;
    }

    // Explicit `/feedback` command (with or without inline message)
    const feedbackCmdMatch = /^\/feedback(?:@\w+)?(?:\s+([\s\S]+))?$/i.exec(rawText);
    if (feedbackCmdMatch) {
      const inlineBody = (feedbackCmdMatch[1] || '').trim();
      if (!inlineBody && !bestPhotoFileId) {
        if (awaitingFeedbackUntil.size > 500) awaitingFeedbackUntil.clear();
        awaitingFeedbackUntil.set(chatId, Date.now() + 15 * 60 * 1000);
        await sendReply(
          chatId,
          '✉️ <b>Зворотний звʼязок</b>\n\nНапишіть ваше повідомлення (або надішліть скріншот з описом) — я одразу перешлю його адміністратору.\n\n<i>Для скасування надішліть /cancel</i>'
        );
        return;
      }

      awaitingFeedbackUntil.delete(chatId);
      const outcome = await forwardFeedbackToAdmins(msg, inlineBody, bestPhotoFileId);
      if (outcome === 'sent') {
        await sendReply(
          chatId,
          '✅ Дякуємо! Ваше повідомлення надіслано адміністратору.',
          buildMiniAppKeyboard(webAppUrl, { includeStatusButton: true })
        );
      } else if (outcome === 'rate_limited') {
        await sendReply(
          chatId,
          '⏳ Ви вже надіслали кілька повідомлень поспіль. Спробуйте ще раз за кілька хвилин.'
        );
      } else {
        await sendReply(
          chatId,
          '⚠️ Служба зворотного звʼязку тимчасово недоступна. Спробуйте пізніше.'
        );
      }
      return;
    }

    // If the user previously clicked "Feedback" or typed `/feedback`, forward their next message directly
    const pendingUntil = awaitingFeedbackUntil.get(chatId);
    const isAwaitingFeedback = typeof pendingUntil === 'number' && pendingUntil > Date.now();
    if (isAwaitingFeedback && !rawText.startsWith('/')) {
      awaitingFeedbackUntil.delete(chatId);
      const outcome = await forwardFeedbackToAdmins(msg, text, bestPhotoFileId);
      if (outcome === 'sent') {
        await sendReply(
          chatId,
          '✅ Дякуємо! Ваше повідомлення надіслано адміністратору.',
          buildMiniAppKeyboard(webAppUrl, { includeStatusButton: true })
        );
      } else if (outcome === 'rate_limited') {
        await sendReply(
          chatId,
          '⏳ Ви вже надіслали кілька повідомлень поспіль. Спробуйте ще раз за кілька хвилин.'
        );
      } else {
        await sendReply(
          chatId,
          '⚠️ Служба зворотного звʼязку тимчасово недоступна. Спробуйте пізніше.'
        );
      }
      return;
    }

    const queueMatch =
      /^\/(?:q|queue)(?:@\w+)?\s+(.+)$/i.exec(rawText)?.[1] ||
      (isPrivate && !bestPhotoFileId && rawText.length <= 16 ? rawText : null);

    if (queueMatch) {
      const queue = normalizeQueueQuery(queueMatch);
      if (queue) {
        const qText = await buildQueueText(queue);
        await sendReply(chatId, qText, buildMiniAppKeyboard(webAppUrl, { queue }));
        return;
      }
    }

    // Any other free-form message or screenshot in a private chat is forwarded to the admin as feedback
    if (isPrivate && !rawText.startsWith('/')) {
      if (!isAdminSender && adminIds.length > 0) {
        const outcome = await forwardFeedbackToAdmins(msg, text, bestPhotoFileId);
        if (outcome === 'sent') {
          await sendReply(
            chatId,
            '✅ Дякуємо! Ваше повідомлення передано адміністратору.\n\n<i>Для перевірки черги надішліть номер (наприклад <code>3.1</code>) або /now.</i>',
            buildMiniAppKeyboard(webAppUrl, { includeStatusButton: true })
          );
          return;
        }
        if (outcome === 'rate_limited') {
          await sendReply(
            chatId,
            '⏳ Ви вже надіслали кілька повідомлень поспіль. Спробуйте ще раз за кілька хвилин.'
          );
          return;
        }
      }

      await sendReply(
        chatId,
        'Натисніть /start для довідки, /now для статусу всіх черг, /feedback для зворотного звʼязку або введіть номер черги (наприклад <code>3.1</code>). Або відкрийте інтерактивну карту 👇',
        buildMiniAppKeyboard(webAppUrl, {
          includeStatusButton: true,
          includeFeedbackButton: true,
        })
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
          { command: 'fav', description: 'Обрані адреси/черги зараз' },
          { command: 'plan', description: 'План відключень обраних на добу' },
          { command: 'now', description: 'Статус усіх черг (1.1–6.2) зараз' },
          { command: 'feedback', description: 'Написати зворотний звʼязок адміністратору' },
          { command: 'help', description: 'Довідка по командах' },
        ],
      }),
      callTelegramApi(botToken, 'setMyDescription', {
        description: buildBotDescriptionUk(webAppUrl),
      }),
      callTelegramApi(botToken, 'setMyShortDescription', {
        short_description: BOT_SHORT_DESCRIPTION_UK,
      }),
    ]);

    if (meRes.ok && typeof meRes.result?.username === 'string') {
      diag.resolvedBotUsername = meRes.result.username;
    }

    let menuOk = true;
    // Never overwrite Telegram's public menu button with a Google-IAP-protected AI Studio preview URL
    if (webAppUrl && !isAiStudioPrivateUrl(webAppUrl)) {
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
