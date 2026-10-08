import { useCallback, useEffect, useRef, useState } from "react";

import type { SupervisionClient } from "../../data/supervision-client";
import type { DrawingImpactNotice, Workspace } from "../../data/ui-contract";
import { resolveNotificationSourceTarget } from "../../data/notification-target-client";
import { ActionButton, Panel, SectionHeader } from "../../ui";
import "./notification-events.css";
import { DrawingImpactPanel } from "./DrawingImpactPanel";

type Notification = {
  id: string;
  projectId: string;
  createdAt: string;
  dueAt: string;
  sourceRef: { objectType: string; objectId: string; version: number };
  channel: "in_app" | "push" | "email_adapter";
  status: string;
};
type InboxItem = { notification: Notification; isRead: boolean; readAt: string | null; drawingImpact?: DrawingImpactNotice };
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
  onSelect,
  onNavigate,
}: {
  client: SupervisionClient;
  workspace: Workspace;
  onChanged?: () => void;
  onSelect?: (id: string | null) => void;
  onNavigate?: (route: string) => void;
}) {
  const scopeKey = `${client.session?.projectId ?? workspace.project.id}:${client.session?.actor.roleAssignmentId ?? ""}`;
  const [inboxSnapshot, setInboxSnapshot] = useState<{ scopeKey: string; data: Inbox } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<{ scopeKey: string; id: string } | null>(null);
  const [errorSnapshot, setErrorSnapshot] = useState<{ scopeKey: string; message: string } | null>(null);
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [impactSelection, setImpactSelection] = useState<{ scope: string; notice: DrawingImpactNotice } | null>(null);
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

  const openTarget = useCallback((id: string, route: string) => {
    // AppShell navigation clears selection, so select the exact workspace row last.
    onNavigate?.(route);
    onSelect?.(id);
  }, [onNavigate, onSelect]);

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
          {inbox.items.map(({ notification, isRead, readAt, drawingImpact }) => {
            const target = resolveNotificationSourceTarget(notification.sourceRef, notification.projectId, workspace);
            return (
            <li key={notification.id} data-notification-id={notification.id} className={isRead ? "is-read" : "is-unread"}>
              <div className="notification-events-copy">
                <div className="notification-events-heading">
                  <strong>{drawingImpact?.title ?? "내 업무 변경"}</strong>
                  <span className="notification-events-read-state">{isRead ? "읽음" : "안 읽음"}</span>
                </div>
                {drawingImpact && <><p data-drawing-impact={drawingImpact.incidentId}>{drawingImpact.message}</p><ActionButton onClick={() => setImpactSelection({ scope: scopeKey, notice: drawingImpact })}>영향 업무 보기</ActionButton></>}
                <p className="notification-events-source">
                  {notification.sourceRef.objectType} · {notification.sourceRef.objectId} · v{notification.sourceRef.version}
                </p>
                {target.kind === "exact" && (
                  <div className="notification-events-target" data-source-target="exact" data-source-route={target.route}>
                    {(target.item.record.title || target.item.record.workName || (typeof target.item.record.data?.title === "string" && target.item.record.data.title)) && (
                      <strong>{target.item.record.title || target.item.record.workName || target.item.record.data?.title as string}</strong>
                    )}
                    {onNavigate && <ActionButton onClick={() => openTarget(target.item.record.id, target.route)}>원본 보기</ActionButton>}
                  </div>
                )}
                {target.kind === "past" && (
                  <div className="notification-events-target" data-source-target="past" data-source-route={target.route}>
                    <span>과거 버전, 변경 명령 불가</span>
                    {onNavigate && <ActionButton onClick={() => openTarget(target.currentItem.record.id, target.route)}>현재 v{target.currentItem.record.version} 별도 보기</ActionButton>}
                  </div>
                )}
                {target.kind === "unavailable" && (
                  <p className="notification-events-target-unavailable">원본 기록을 현재 작업공간에서 열 수 없습니다.</p>
                )}
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
          );})}
        </ul>
      )}
      {impactSelection?.scope === scopeKey && <DrawingImpactPanel key={JSON.stringify([scopeKey, impactSelection.notice])} client={client} workspace={workspace} drawingRef={impactSelection.notice.drawingRef} incidentId={impactSelection.notice.incidentId} onSelect={onSelect} onNavigate={onNavigate} />}
    </Panel>
  );
}
