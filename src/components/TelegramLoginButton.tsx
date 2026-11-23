import React, { useEffect, useRef } from 'react';
import { TelegramLoginWidgetPayload } from '../lib/telegram';

interface TelegramLoginButtonProps {
  botUsername: string;
  onAuth: (payload: TelegramLoginWidgetPayload) => void;
}

export const TelegramLoginButton: React.FC<TelegramLoginButtonProps> = ({
  botUsername,
  onAuth,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onAuthRef = useRef(onAuth);
  onAuthRef.current = onAuth;

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !botUsername || !/^[a-zA-Z0-9_]{3,64}$/.test(botUsername)) return;

    window.__dpemTelegramLoginCb = (user: TelegramLoginWidgetPayload) => {
      onAuthRef.current(user);
    };

    el.innerHTML = '';
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', botUsername);
    script.setAttribute('data-size', 'medium');
    script.setAttribute('data-radius', '6');
    script.setAttribute('data-onauth', '__dpemTelegramLoginCb(user)');
    script.setAttribute('data-request-access', 'write');
    el.appendChild(script);

    return () => {
      el.innerHTML = '';
    };
  }, [botUsername]);

  return <div ref={containerRef} className="flex items-center justify-center min-h-[34px]" />;
};
