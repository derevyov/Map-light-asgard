import React, { useMemo, useState } from 'react';
import {
  Ban,
  Check,
  Crown,
  Send,
  Shield,
  ShieldAlert,
  Trash2,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import {
  AccessRequestRecord,
  EffectiveRoleName,
  TelegramUserProfile,
  UserRoleRecord,
} from '../lib/types';

interface AccessControlModalProps {
  authUser: User | null;
  telegramUser: TelegramUserProfile | null;
  effectiveRole: EffectiveRoleName;
  myRoleRecord: UserRoleRecord | null;
  userRoles: UserRoleRecord[];
  accessRequests: AccessRequestRecord[];
  onSignInGoogle: () => void;
  onSubmitRequest: (input: {
    requestedRole: 'editor' | 'admin';
    reason: string;
    telegramHandle?: string;
  }) => Promise<void>;
  onCancelRequest: (requestId: string) => Promise<void>;
  onApproveRequest: (req: AccessRequestRecord, grantRole: 'editor' | 'admin') => Promise<void>;
  onRejectRequest: (req: AccessRequestRecord) => Promise<void>;
  onBanUser: (target: UserRoleRecord, banned: boolean, reason?: string) => Promise<void>;
  onChangeRole: (target: UserRoleRecord, nextRole: 'editor' | 'admin') => Promise<void>;
  onDeleteRole: (target: UserRoleRecord) => Promise<void>;
  onClose: () => void;
}

const ROLE_LABELS: Record<EffectiveRoleName, string> = {
  super_admin: 'Супер-адмін',
  admin: 'Адміністратор',
  editor: 'Редактор',
  viewer: 'Перегляд',
  banned: 'Заблоковано',
};

export const AccessControlModal: React.FC<AccessControlModalProps> = ({
  authUser,
  telegramUser,
  effectiveRole,
  myRoleRecord,
  userRoles,
  accessRequests,
  onSignInGoogle,
  onSubmitRequest,
  onCancelRequest,
  onApproveRequest,
  onRejectRequest,
  onBanUser,
  onChangeRole,
  onDeleteRole,
  onClose,
}) => {
  const isSuperAdmin = effectiveRole === 'super_admin';
  const isAnyAdmin = isSuperAdmin || effectiveRole === 'admin';
  const [tab, setTab] = useState<'requests' | 'members' | 'my_request'>(
    isAnyAdmin ? 'requests' : 'my_request'
  );
  const [requestedRole, setRequestedRole] = useState<'editor' | 'admin'>('editor');
  const [reason, setReason] = useState('');
  const [telegramHandle, setTelegramHandle] = useState(
    telegramUser?.username ? `@${telegramUser.username}` : ''
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [banReasonDraft, setBanReasonDraft] = useState<Record<string, string>>({});

  const pendingRequests = useMemo(
    () => accessRequests.filter((r) => r.status === 'pending'),
    [accessRequests]
  );

  const myRequests = useMemo(
    () =>
      authUser
        ? accessRequests.filter((r) => r.requesterUid === authUser.uid)
        : [],
    [accessRequests, authUser]
  );

  const hasMyPending = myRequests.some((r) => r.status === 'pending');

  // Strict client mirror of Firestore lineage rules:
  // Super Admin -> can ban/unban & permanently delete ANY admin or editor.
  // Delegated Admin -> can ban/unban ANY editor OR an admin whom THEY added (grantedByUid == authUser.uid).
  const canBanTarget = (target: UserRoleRecord): boolean => {
    if (!authUser) return false;
    if (isSuperAdmin) return target.uid !== authUser.uid;
    if (effectiveRole !== 'admin') return false;
    if (target.uid === authUser.uid) return false;
    if (target.role === 'editor') return true;
    if (target.role === 'admin' && target.grantedByUid === authUser.uid) return true;
    return false;
  };

  const handleRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) return;
    setBusyId('submit_req');
    try {
      await onSubmitRequest({
        requestedRole,
        reason: reason.trim(),
        telegramHandle: telegramHandle.trim() || undefined,
      });
      setReason('');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[2100] flex items-center justify-center bg-slate-950/70 p-2 sm:p-4 backdrop-blur-xs">
      <div className="w-full max-w-2xl max-h-[90dvh] flex flex-col rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {isSuperAdmin ? (
              <Crown className="w-4 h-4 text-amber-500 shrink-0" />
            ) : (
              <Shield className="w-4 h-4 text-sky-500 shrink-0" />
            )}
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                Права доступу та запити
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                Ваша роль: <strong className="text-slate-800 dark:text-slate-200">{ROLE_LABELS[effectiveRole]}</strong>
                {telegramUser ? ` · Telegram: ${telegramUser.username ? `@${telegramUser.username}` : telegramUser.firstName}` : ''}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Закрити"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Tabs for Admins */}
        {isAnyAdmin && (
          <div className="px-4 pt-3 flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setTab('requests')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                tab === 'requests'
                  ? 'bg-sky-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
              }`}
            >
              Запити ({pendingRequests.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('members')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                tab === 'members'
                  ? 'bg-sky-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
              }`}
            >
              Команда ({userRoles.length})
            </button>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
          {/* Banned banner */}
          {effectiveRole === 'banned' && (
            <div className="p-3.5 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-300 dark:border-red-800 text-red-800 dark:text-red-200 space-y-1">
              <div className="font-bold flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>Права на редагування заблоковано</span>
              </div>
              {myRoleRecord?.banReason && (
                <p className="text-[11px]">Причина: {myRoleRecord.banReason}</p>
              )}
              <p className="text-[11px] opacity-85">
                Ви можете продовжувати переглядати карту та обрані адреси.
              </p>
            </div>
          )}

          {/* VIEWER / EDITOR: Request Edit or Admin Access */}
          {!isAnyAdmin && (
            <div className="space-y-4">
              {!authUser ? (
                <div className="p-4 rounded-lg bg-slate-50 dark:bg-[#0b1120] border border-slate-200 dark:border-slate-800 space-y-3">
                  <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                    Щоб подати запит адміністраторам на права <strong>Редактора</strong> або <strong>Адміністратора</strong> для спільних правок у базі Firestore, увійдіть через Google-акаунт.
                  </p>
                  <button
                    type="button"
                    onClick={onSignInGoogle}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>Увійти через Google</span>
                  </button>
                </div>
              ) : effectiveRole !== 'banned' ? (
                <form
                  onSubmit={handleRequestSubmit}
                  className="p-4 rounded-lg bg-slate-50 dark:bg-[#0b1120] border border-slate-200 dark:border-slate-800 space-y-3"
                >
                  <h3 className="font-bold text-slate-900 dark:text-slate-100">
                    Запит на права змін карти
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Адміністратори розглянуть ваш запит і зможуть видати роль Редактора або Адміністратора.
                  </p>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setRequestedRole('editor')}
                      className={`py-2 px-3 rounded-lg border text-xs font-semibold ${
                        requestedRole === 'editor'
                          ? 'bg-sky-600 border-sky-500 text-white'
                          : 'bg-white dark:bg-[#111827] border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      Редактор (точки, колізії, переноси)
                    </button>
                    <button
                      type="button"
                      onClick={() => setRequestedRole('admin')}
                      className={`py-2 px-3 rounded-lg border text-xs font-semibold ${
                        requestedRole === 'admin'
                          ? 'bg-sky-600 border-sky-500 text-white'
                          : 'bg-white dark:bg-[#111827] border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      Адміністратор (видача прав + модерація)
                    </button>
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                      Ваш Telegram (необовʼязково, для звʼязку)
                    </label>
                    <input
                      type="text"
                      value={telegramHandle}
                      onChange={(e) => setTelegramHandle(e.target.value)}
                      placeholder="@username"
                      maxLength={64}
                      className="w-full rounded-md bg-white dark:bg-[#111827] border border-slate-300 dark:border-slate-700 px-2.5 py-1.5 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                      Коротко: який район / навіщо потрібні права
                    </label>
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Напр.: Знаю реальні черги по 3-му мікрорайону та переноси фідерів"
                      maxLength={240}
                      rows={2}
                      required
                      disabled={hasMyPending}
                      className="w-full rounded-md bg-white dark:bg-[#111827] border border-slate-300 dark:border-slate-700 px-2.5 py-1.5 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500 disabled:opacity-60"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={hasMyPending || busyId === 'submit_req' || reason.trim().length < 2}
                    className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-semibold"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>
                      {hasMyPending
                        ? 'Ваш запит вже очікує розгляду'
                        : 'Надіслати запит адміністраторам'}
                    </span>
                  </button>
                </form>
              ) : null}

              {/* My previous requests */}
              {myRequests.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-bold text-slate-700 dark:text-slate-300">Мої запити</h4>
                  {myRequests.map((r) => (
                    <div
                      key={r.id}
                      className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0b1120]/60 flex items-start justify-between gap-2"
                    >
                      <div className="space-y-0.5">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          Запит: {r.requestedRole === 'admin' ? 'Адмін' : 'Редактор'} ·{' '}
                          <span
                            className={
                              r.status === 'approved'
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : r.status === 'rejected'
                                ? 'text-red-500'
                                : 'text-amber-500'
                            }
                          >
                            {r.status === 'approved'
                              ? `Схвалено (${r.grantedRole === 'admin' ? 'Адмін' : 'Редактор'})`
                              : r.status === 'rejected'
                              ? 'Відхилено'
                              : 'Очікує розгляду'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">{r.reason}</p>
                      </div>
                      {r.status === 'pending' && (
                        <button
                          type="button"
                          onClick={() => void onCancelRequest(r.id)}
                          className="text-[11px] text-red-500 hover:underline shrink-0"
                        >
                          Скасувати
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ADMIN / SUPER ADMIN: Pending & Recent Requests */}
          {isAnyAdmin && tab === 'requests' && (
            <div className="space-y-3">
              <div className="p-3 rounded-lg bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800/60 text-[11px] text-sky-900 dark:text-sky-200">
                <strong>Правила ієрархії:</strong> Адміністратор може видати роль{' '}
                <strong>Редактора</strong> або <strong>Адміна</strong> та банити редакторів або
                адмінів, яких додав особисто. <strong>Супер-адмін</strong> може банити та остаточно
                видаляти будь-яких адмінів і редакторів.
              </div>

              {pendingRequests.length === 0 ? (
                <div className="py-8 text-center text-slate-500 dark:text-slate-400">
                  Нових запитів на права немає
                </div>
              ) : (
                pendingRequests.map((req) => (
                  <div
                    key={req.id}
                    className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0b1120] space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-bold text-slate-900 dark:text-slate-100">
                          {req.requesterName}
                          {req.telegramHandle && (
                            <span className="ml-1.5 font-mono text-[11px] text-sky-600 dark:text-sky-400">
                              {req.telegramHandle}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          Просить роль:{' '}
                          <strong className="text-slate-700 dark:text-slate-200">
                            {req.requestedRole === 'admin' ? 'Адміністратор' : 'Редактор'}
                          </strong>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono text-slate-400">
                        {new Date(req.createdAt).toLocaleDateString('uk-UA')}
                      </span>
                    </div>

                    <p className="text-xs text-slate-700 dark:text-slate-300 bg-white dark:bg-[#111827] p-2 rounded border border-slate-200 dark:border-slate-800">
                      {req.reason}
                    </p>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={busyId === req.id}
                        onClick={async () => {
                          setBusyId(req.id);
                          try {
                            await onApproveRequest(req, 'editor');
                          } finally {
                            setBusyId(null);
                          }
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Видати Редактора</span>
                      </button>

                      <button
                        type="button"
                        disabled={busyId === req.id}
                        onClick={async () => {
                          setBusyId(req.id);
                          try {
                            await onApproveRequest(req, 'admin');
                          } finally {
                            setBusyId(null);
                          }
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-white font-semibold"
                      >
                        <Shield className="w-3.5 h-3.5" />
                        <span>Видати Адміна</span>
                      </button>

                      <button
                        type="button"
                        disabled={busyId === req.id}
                        onClick={async () => {
                          setBusyId(req.id);
                          try {
                            await onRejectRequest(req);
                          } finally {
                            setBusyId(null);
                          }
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-slate-200 dark:bg-slate-800 hover:bg-red-600 hover:text-white text-slate-700 dark:text-slate-300 font-semibold transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>Відхилити</span>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* ADMIN / SUPER ADMIN: Team Members, Bans & Super-Admin Delete */}
          {isAnyAdmin && tab === 'members' && (
            <div className="space-y-2.5">
              {userRoles.length === 0 ? (
                <div className="py-8 text-center text-slate-500 dark:text-slate-400">
                  Поки що немає призначених редакторів чи адмінів
                </div>
              ) : (
                userRoles.map((member) => {
                  const allowBan = canBanTarget(member);
                  const isBanned = member.status === 'banned';
                  const addedByMe = authUser && member.grantedByUid === authUser.uid;

                  return (
                    <div
                      key={member.uid}
                      className={`p-3.5 rounded-lg border space-y-2.5 ${
                        isBanned
                          ? 'border-red-300 dark:border-red-900 bg-red-50/50 dark:bg-red-950/20'
                          : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0b1120]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5 flex-wrap">
                            <span>{member.displayName}</span>
                            {member.contactLabel && (
                              <span className="font-mono text-[11px] text-sky-600 dark:text-sky-400">
                                {member.contactLabel}
                              </span>
                            )}
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                isBanned
                                  ? 'bg-red-600 text-white'
                                  : member.role === 'admin'
                                  ? 'bg-sky-600 text-white'
                                  : 'bg-emerald-600 text-white'
                              }`}
                            >
                              {isBanned
                                ? 'ЗАБАНЕНО'
                                : member.role === 'admin'
                                ? 'Адмін'
                                : 'Редактор'}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            Додав: {member.grantedByName || member.grantedByUid.slice(0, 8)}
                            {addedByMe ? ' (ви)' : ''}
                          </div>
                          {isBanned && member.banReason && (
                            <div className="text-[11px] text-red-600 dark:text-red-400 mt-0.5">
                              Причина бану: {member.banReason}
                            </div>
                          )}
                        </div>

                        {!allowBan && !isSuperAdmin && (
                          <span className="text-[10px] text-slate-400 italic shrink-0">
                            Додано іншим адміном
                          </span>
                        )}
                      </div>

                      {(allowBan || isSuperAdmin) && (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          {/* Role switch */}
                          {!isBanned && (
                            <button
                              type="button"
                              disabled={busyId === member.uid}
                              onClick={async () => {
                                setBusyId(member.uid);
                                try {
                                  await onChangeRole(
                                    member,
                                    member.role === 'admin' ? 'editor' : 'admin'
                                  );
                                } finally {
                                  setBusyId(null);
                                }
                              }}
                              className="px-2.5 py-1 rounded-md bg-white dark:bg-[#111827] border border-slate-300 dark:border-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:border-sky-500"
                            >
                              {member.role === 'admin'
                                ? 'Понизити до Редактора'
                                : 'Підвищити до Адміна'}
                            </button>
                          )}

                          {/* Ban / Unban */}
                          {!isBanned ? (
                            <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
                              <input
                                type="text"
                                value={banReasonDraft[member.uid] || ''}
                                onChange={(e) =>
                                  setBanReasonDraft((prev) => ({
                                    ...prev,
                                    [member.uid]: e.target.value,
                                  }))
                                }
                                placeholder="Причина бану (необовʼязк.)"
                                maxLength={120}
                                className="flex-1 rounded-md bg-white dark:bg-[#111827] border border-slate-300 dark:border-slate-700 px-2 py-1 text-[11px] text-slate-900 dark:text-slate-100"
                              />
                              <button
                                type="button"
                                disabled={busyId === member.uid}
                                onClick={async () => {
                                  setBusyId(member.uid);
                                  try {
                                    await onBanUser(member, true, banReasonDraft[member.uid]);
                                  } finally {
                                    setBusyId(null);
                                  }
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-semibold shrink-0"
                              >
                                <Ban className="w-3 h-3" />
                                <span>Забанити</span>
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              disabled={busyId === member.uid}
                              onClick={async () => {
                                setBusyId(member.uid);
                                try {
                                  await onBanUser(member, false);
                                } finally {
                                  setBusyId(null);
                                }
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold"
                            >
                              <UserCheck className="w-3 h-3" />
                              <span>Розбанити</span>
                            </button>
                          )}

                          {/* Super-Admin-ONLY permanent delete */}
                          {isSuperAdmin && (
                            <button
                              type="button"
                              disabled={busyId === member.uid}
                              onClick={async () => {
                                setBusyId(member.uid);
                                try {
                                  await onDeleteRole(member);
                                } finally {
                                  setBusyId(null);
                                }
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-red-600 hover:bg-red-500 text-white text-[11px] font-semibold"
                              title="Тільки Супер-адмін може повністю видалити роль"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>Видалити</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
