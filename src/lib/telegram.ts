import { SUBQUEUES, SubqueueId, TelegramUserProfile } from './types';

interface TelegramWebAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  language_code?: string;
}

interface TelegramBackButton {
  isVisible: boolean;
  show: () => void;
  hide: () => void;
  onClick: (cb: () => void) => void;
  offClick: (cb: () => void) => void;
}

interface TelegramHapticFeedback {
  impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
  notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
  selectionChanged: () => void;
}

export interface TelegramWebAppInstance {
  initData: string;
  initDataUnsafe?: {
    user?: TelegramWebAppUser;
    start_param?: string;
    auth_date?: number;
  };
  version: string;
  platform: string;
  colorScheme: 'light' | 'dark';
  isExpanded: boolean;
  viewportHeight: number;
  viewportStableHeight: number;
  ready: () => void;
  expand: () => void;
  close: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  disableVerticalSwipes?: () => void;
  enableClosingConfirmation?: () => void;
  openLink?: (url: string, options?: { try_instant_view?: boolean }) => void;
  onEvent?: (eventType: string, cb: () => void) => void;
  offEvent?: (eventType: string, cb: () => void) => void;
  BackButton?: TelegramBackButton;
  HapticFeedback?: TelegramHapticFeedback;
}

export interface TelegramLoginWidgetPayload {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebAppInstance;
    };
    __dpemTelegramLoginCb?: (user: TelegramLoginWidgetPayload) => void;
  }
}

export function getTelegramWebApp(): TelegramWebAppInstance | null {
  if (typeof window === 'undefined') return null;
  const wa = window.Telegram?.WebApp;
  if (!wa) return null;
  // Detect genuine Telegram Mini App container (has initData or non-unknown platform)
  const inTelegram =
    (typeof wa.initData === 'string' && wa.initData.length > 0) ||
    (typeof wa.platform === 'string' && wa.platform !== '' && wa.platform !== 'unknown');
  return inTelegram ? wa : null;
}

export function isInsideTelegramMiniApp(): boolean {
  return getTelegramWebApp() !== null;
}

function sanitizePhotoUrl(raw?: string): string | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'https:') return parsed.toString();
  } catch {
    // invalid URL
  }
  return undefined;
}

export function parseTelegramStartQueue(startParam?: string): SubqueueId | null {
  if (!startParam || typeof startParam !== 'string') return null;
  const cleaned = startParam.trim().replace(/^q[_-]?/i, '').replace('_', '-').replace('.', '-');
  return SUBQUEUES.includes(cleaned as SubqueueId) ? (cleaned as SubqueueId) : null;
}

export function initTelegramMiniApp(theme: 'dark' | 'light'): {
  webApp: TelegramWebAppInstance | null;
  unsafeProfile: TelegramUserProfile | null;
  startQueue: SubqueueId | null;
} {
  const wa = getTelegramWebApp();
  if (!wa) {
    return { webApp: null, unsafeProfile: null, startQueue: null };
  }

  try {
    wa.ready();
    wa.expand();
    wa.disableVerticalSwipes?.();
    syncTelegramThemeColors(theme);
  } catch {
    // ignore unsupported Bot API versions
  }

  const rawUser = wa.initDataUnsafe?.user;
  const unsafeProfile: TelegramUserProfile | null =
    rawUser && typeof rawUser.id === 'number'
      ? {
          id: rawUser.id,
          firstName: rawUser.first_name || 'Telegram',
          lastName: rawUser.last_name,
          username: rawUser.username,
          photoUrl: sanitizePhotoUrl(rawUser.photo_url),
          verified: false,
        }
      : null;

  const urlStartParam =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('tgWebAppStartParam') || undefined
      : undefined;
  const startQueue = parseTelegramStartQueue(
    wa.initDataUnsafe?.start_param || urlStartParam
  );

  return { webApp: wa, unsafeProfile, startQueue };
}

export function syncTelegramThemeColors(theme: 'dark' | 'light'): void {
  const wa = getTelegramWebApp();
  if (!wa) return;
  try {
    if (theme === 'dark') {
      wa.setHeaderColor?.('#111827');
      wa.setBackgroundColor?.('#0b1120');
    } else {
      wa.setHeaderColor?.('#ffffff');
      wa.setBackgroundColor?.('#f8fafc');
    }
  } catch {
    // ignore
  }
}

export function triggerTelegramHaptic(kind: 'light' | 'medium' | 'success' | 'warning'): void {
  const wa = getTelegramWebApp();
  if (!wa?.HapticFeedback) return;
  try {
    if (kind === 'success' || kind === 'warning') {
      wa.HapticFeedback.notificationOccurred(kind);
    } else {
      wa.HapticFeedback.impactOccurred(kind);
    }
  } catch {
    // ignore
  }
}

export function openCurrentUrlInExternalBrowser(): void {
  const wa = getTelegramWebApp();
  if (wa?.openLink) {
    wa.openLink(window.location.href);
  }
}

export interface TelegramAuthVerifyResult {
  verified: boolean;
  configured: boolean;
  user?: TelegramUserProfile;
  token?: string;
  error?: string;
}

export async function verifyTelegramMiniAppInitData(
  initData: string
): Promise<TelegramAuthVerifyResult> {
  try {
    const res = await fetch('/api/auth/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData }),
    });
    const data = (await res.json()) as TelegramAuthVerifyResult;
    return data;
  } catch {
    return { verified: false, configured: false, error: 'Мережева помилка перевірки Telegram' };
  }
}

export async function verifyTelegramLoginWidget(
  loginWidget: TelegramLoginWidgetPayload
): Promise<TelegramAuthVerifyResult> {
  try {
    const res = await fetch('/api/auth/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginWidget }),
    });
    const data = (await res.json()) as TelegramAuthVerifyResult;
    return data;
  } catch {
    return { verified: false, configured: false, error: 'Мережева помилка перевірки Telegram' };
  }
}

export async function fetchTelegramAuthConfig(): Promise<{
  enabled: boolean;
  botUsername: string | null;
}> {
  try {
    const res = await fetch('/api/auth/telegram/config');
    if (!res.ok) return { enabled: false, botUsername: null };
    return (await res.json()) as { enabled: boolean; botUsername: string | null };
  } catch {
    return { enabled: false, botUsername: null };
  }
}
