import { useCallback, useEffect, useRef, useState } from "react";

import type { SupervisionClient } from "../../data/supervision-client";
import type { Workspace } from "../../data/ui-contract";
import { ActionButton, Panel, SectionHeader } from "../../ui";
import "./notification-events.css";

type Notification = {
  id: string;
  projectId: string;
  createdAt: string;
  dueAt: string;
  sourceRef: { objectType: string; objectId: string; version: number };
  channel: "in_app" | "push" | "email_adapter";
  status: string;
};
type InboxItem = { notification: Notification; isRead: boolean; readAt: string | null };
type Inbox = { items: InboxItem[]; total: number; unreadCount: number };

function asInbox(value: unknown): Inbox {
  if (!value || typeof value !== "object") return { items: [], total: 0, unreadCount: 0 };
  const candidate = value as Partial<Inbox>;
  return {
    items: Array.isArray(candidate.items) ? candidate.items as InboxItem[] : [],
    total: typeof candidate.total === "number" ? candidate.total : 0,
    unreadCount: typeof candidate.unreadCount === "number" ? candidate.unreadCount : 0,
  };
}
function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ko-KR");
}
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function NotificationEventsPanel({
  client,
  workspace,
  onChanged,
}: {
  client: SupervisionClient;
  workspace: Workspace;
  onChanged?: () => void;
}) {
  const scopeKey = `${client.session?.projectId ?? workspace.project.id}:${client.session?.actor.roleAssignmentId ?? ""}`;
  const [inboxSnapshot, setInboxSnapshot] = useState<{ scopeKey: string; data: Inbox } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<{ scopeKey: string; id: string } | null>(null);
  const [errorSnapshot, setErrorSnapshot] = useState<{ scopeKey: string; message: string } | null>(null);
  const [refreshIndex, setRefreshIndex] = useState(0);
  const inbox = inboxSnapshot?.scopeKey === scopeKey ? inboxSnapshot.data : { items: [], total: 0, unreadCount: 0 };
  const error = errorSnapshot?.scopeKey === scopeKey ? errorSnapshot.message : "";
  const busyId = busy?.scopeKey === scopeKey ? busy.id : "";
  const scopeEpoch = useRef(0);
  const requestSequence = useRef(0);
  const busyRead = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      scopeEpoch.current += 1;
      requestSequence.current += 1;
      busyRead.current = false;
    };
  }, []);

  const refresh = useCallback(async (expectedScope = scopeEpoch.current) => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setErrorSnapshot(null);
    try {
      const result = await client.request<unknown>(client.path("/parallel/notifications"));
      if (mounted.current && scopeEpoch.current === expectedScope && requestSequence.current === sequence) {
        setInboxSnapshot({ scopeKey, data: asInbox(result) });
      }
    } catch (requestError) {
      if (mounted.current && scopeEpoch.current === expectedScope && requestSequence.current === sequence) {
        setInboxSnapshot({ scopeKey, data: { items: [], total: 0, unreadCount: 0 } });
        setErrorSnapshot({ scopeKey, message: errorMessage(requestError) });
      }
    } finally {
      if (mounted.current && scopeEpoch.current === expectedScope && requestSequence.current === sequence) {
        setLoading(false);
      }
    }
  }, [client, scopeKey]);

  useEffect(() => {
    const epoch = ++scopeEpoch.current;
    requestSequence.current += 1;
    busyRead.current = false;
    void refresh(epoch);
    return () => {
      if (scopeEpoch.current === epoch) scopeEpoch.current += 1;
      requestSequence.current += 1;
    };
  }, [refresh, refreshIndex, scopeKey]);

  const markRead = useCallback(async (notificationId: string) => {
    if (busyRead.current) return;
    busyRead.current = true;
    const epoch = scopeEpoch.current;
    setBusy({ scopeKey, id: notificationId });
    setErrorSnapshot(null);
    try {
      await client.request<unknown>(
        client.path(`/parallel/notifications/${encodeURIComponent(notificationId)}/read`),
        { method: "POST" },
      );
      if (mounted.current && scopeEpoch.current === epoch) {
        await refresh(epoch);
        if (scopeEpoch.current === epoch) onChanged?.();
      }
    } catch (requestError) {
      if (mounted.current && scopeEpoch.current === epoch) setErrorSnapshot({ scopeKey, message: errorMessage(requestError) });
    } finally {
      if (mounted.current && scopeEpoch.current === epoch) {
        busyRead.current = false;
        setBusy(null);
      }
    }
  }, [client, onChanged, refresh, scopeKey]);

  return (
    <Panel className="notification-events-panel" aria-labelledby="notification-events-title">
      <SectionHeader
        title={<span id="notification-events-title">알림</span>}
        meta={`안 읽음 ${inbox.unreadCount}건 · 전체 ${inbox.total}건`}
      />
      <div className="notification-events-toolbar">
        <p>현재 프로젝트의 내 업무 변경 내역입니다. 이 화면에서 읽음으로 표시해도 업무 승인이나 전달 확인은 변경되지 않습니다.</p>
        <ActionButton onClick={() => setRefreshIndex((value) => value + 1)} disabled={loading}>새로고침</ActionButton>
      </div>
      {loading && <div className="notification-events-state" role="status">알림을 불러오는 중…</div>}
      {!loading && error && <div className="notification-events-error" role="alert"><strong>알림을 불러오거나 갱신하지 못했습니다.</strong><p>{error}</p></div>}
      {!loading && !error && inbox.items.length === 0 && (
        <div className="notification-events-empty">표시할 알림이 없습니다.</div>
      )}
      {!loading && !error && inbox.items.length > 0 && (
        <ul className="notification-events-list">
          {inbox.items.map(({ notification, isRead, readAt }) => (
            <li key={notification.id} data-notification-id={notification.id} className={isRead ? "is-read" : "is-unread"}>
              <div className="notification-events-copy">
                <div className="notification-events-heading">
                  <strong>내 업무 변경</strong>
                  <span className="notification-events-read-state">{isRead ? "읽음" : "안 읽음"}</span>
                </div>
                <p className="notification-events-source">
                  {notification.sourceRef.objectType} · v{notification.sourceRef.version}
                </p>
                <dl>
                  <div><dt>발생 시각</dt><dd>{formatDate(notification.dueAt)}</dd></div>
                  <div><dt>상태</dt><dd>앱에 저장됨 · {notification.status}</dd></div>
                  {isRead && readAt && <div><dt>읽은 시각</dt><dd>{formatDate(readAt)}</dd></div>}
                </dl>
              </div>
              {!isRead && (
                <ActionButton onClick={() => void markRead(notification.id)} disabled={busyId !== ""}>
                  {busyId === notification.id ? "처리 중…" : "읽음으로 표시"}
                </ActionButton>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
