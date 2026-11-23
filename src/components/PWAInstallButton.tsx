import React, { useState } from 'react';
import { Download, ExternalLink, Share, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { openCurrentUrlInExternalBrowser, triggerTelegramHaptic } from '../lib/telegram';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, isTelegram, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  // Already running as installed standalone PWA — hide button
  if (isInstalled) {
    return null;
  }

  // Inside Telegram Mini App: offer one-tap jump to external browser to pin home-screen shortcut
  if (isTelegram) {
    return (
      <button
        type="button"
        onClick={() => {
          triggerTelegramHaptic('light');
          openCurrentUrlInExternalBrowser();
        }}
        className="p-2 sm:px-2.5 sm:py-1.5 rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-800 dark:text-slate-100 transition-colors inline-flex items-center gap-1.5"
        title="Відкрити в браузері (щоб додати ярлик PWA на екран)"
        aria-label="Відкрити в браузері"
      >
        <ExternalLink className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
        <span className="hidden md:inline">Ярлик</span>
      </button>
    );
  }

  // Chromium / Android / Desktop native one-tap install
  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className="px-2.5 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shadow-xs"
        title="Встановити карту як додаток (ярлик на екран)"
      >
        <Download className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Встановити</span>
      </button>
    );
  }

  // iOS Safari guided install (WebKit does not emit beforeinstallprompt)
  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="px-2.5 py-1.5 rounded-md bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 border border-emerald-400/70 dark:border-emerald-700 text-xs font-semibold text-emerald-800 dark:text-emerald-300 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
          title="Додати ярлик на екран iPhone / iPad"
        >
          <Smartphone className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Ярлик iOS</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-[2200] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-xs">
            <div className="w-full max-w-sm rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-700 p-5 shadow-2xl space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Встановити ярлик на iPhone / iPad
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Додаток відкриватиметься на весь екран як нативний
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-white"
                  aria-label="Закрити"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <ol className="space-y-2.5 text-xs text-slate-700 dark:text-slate-300">
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-sky-100 dark:bg-sky-900/60 text-sky-700 dark:text-sky-300 font-bold inline-flex items-center justify-center shrink-0">
                    1
                  </span>
                  <span>
                    Натисніть кнопку <strong className="inline-flex items-center gap-1"><Share className="w-3.5 h-3.5 inline text-sky-500" /> Поділитися</strong> у нижній панелі Safari.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-sky-100 dark:bg-sky-900/60 text-sky-700 dark:text-sky-300 font-bold inline-flex items-center justify-center shrink-0">
                    2
                  </span>
                  <span>
                    Прогорніть вниз та натисніть <strong>«На початковий екран»</strong> → <strong>«Додати»</strong>.
                  </span>
                </li>
              </ol>

              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-xs font-semibold text-white transition-colors"
              >
                Зрозуміло
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
