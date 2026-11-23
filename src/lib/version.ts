declare const __APP_VERSION__: string | undefined;
declare const __BUILD_TIME__: string | undefined;
declare const __BUILD_COMMIT__: string | undefined;

export const APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__ ? __APP_VERSION__ : '1.4.0';

export const BUILD_TIME: string =
  typeof __BUILD_TIME__ !== 'undefined' && __BUILD_TIME__ ? __BUILD_TIME__ : '';

export const BUILD_COMMIT: string =
  typeof __BUILD_COMMIT__ !== 'undefined' && __BUILD_COMMIT__ ? __BUILD_COMMIT__ : '';

function formatBuildTime(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('uk-UA', {
      timeZone: 'Europe/Kyiv',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .format(date)
      .replace(',', '');
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}

export const BUILD_TIME_LABEL: string = formatBuildTime(BUILD_TIME);

export const APP_VERSION_FULL: string = [
  `v${APP_VERSION}`,
  BUILD_TIME_LABEL ? `збірка ${BUILD_TIME_LABEL}` : '',
  BUILD_COMMIT ? `#${BUILD_COMMIT}` : '',
]
  .filter(Boolean)
  .join(' · ');

/**
 * Unregisters active PWA Service Workers, clears Cache Storage, and reloads the page
 * so users immediately receive the latest deployed bundle.
 */
export async function forceReloadAppCache(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((reg) => reg.unregister()));
    }
    if ('caches' in window) {
      const cacheNames = await window.caches.keys();
      await Promise.all(cacheNames.map((name) => window.caches.delete(name)));
    }
  } catch {
    // Ignore cache API failures in restricted webviews and still reload
  }
  window.location.reload();
}
