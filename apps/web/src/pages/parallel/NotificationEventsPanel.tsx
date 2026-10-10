import { recordTypeLabel } from "../../labels";
import { recordVersionLabel } from "../../labels";
import { useCallback, useEffect, useRef, useState } from "react";

import type { SupervisionClient } from "../../data/supervision-client";
import type { DrawingImpactNotice, Workspace } from "../../data/ui-contract";
import { resolveNotificationSourceTarget } from "../../data/notification-target-client";
import { ApiError } from "../../data/supervision-client";
import { ActionButton, Panel, SectionHeader } from "../../ui";
import "./notification-events.css";
import { DrawingImpactPanel } from "./DrawingImpactPanel";
import { formatDateTime, formatNumber } from "../../i18n/format";
import { reasonLabel } from "../../labels";

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
type LabelKey =
  | "title" | "unread" | "all" | "refresh" | "intro" | "loading" | "loadError" | "empty"
  | "fallbackTitle" | "read" | "unreadState" | "impactOpen" | "viewSource" | "pastVersion"
  | "viewCurrent" | "sourceUnavailable" | "occurredAt" | "status" | "savedInApp" | "readAt"
  | "markRead" | "markingRead" | "genericError";
const copy: Record<"ko" | "vi" | "en", Record<LabelKey, string>> = {
  ko: {
    title: "알림", unread: "안 읽음", all: "전체", refresh: "새로고침",
    intro: "현재 현장의 내 업무 변경 내역입니다. 이 화면에서 읽음으로 표시해도 업무 승인이나 전달 확인은 변경되지 않습니다.",
    loading: "알림을 불러오는 중…", loadError: "알림을 불러오거나 갱신하지 못했습니다.", empty: "표시할 알림이 없습니다.",
    fallbackTitle: "내 업무 변경", read: "읽음", unreadState: "안 읽음", impactOpen: "영향 업무 보기",
    viewSource: "원본 보기", pastVersion: "과거 작성 차수, 변경 업무 처리 불가", viewCurrent: "현재 제{{version}}차 별도 보기",
    sourceUnavailable: "원본 기록을 현재 업무 화면에서 열 수 없습니다.", occurredAt: "발생 시각", status: "상태",
    savedInApp: "앱에 저장됨", readAt: "읽은 시각", markRead: "읽음으로 표시", markingRead: "처리 중…",
    genericError: "알림 요청을 완료할 수 없습니다. 연결을 확인한 뒤 다시 시도하세요.",
  },
  vi: {
    title: "Thông báo", unread: "Chưa đọc", all: "Tất cả", refresh: "Làm mới",
    intro: "Các thay đổi công việc của bạn trong dự án hiện tại. Đánh dấu đã đọc ở đây không thay đổi phê duyệt công việc hoặc xác nhận đã gửi.",
    loading: "Đang tải thông báo…", loadError: "Không thể tải hoặc làm mới thông báo.", empty: "Không có thông báo để hiển thị.",
    fallbackTitle: "Thay đổi công việc của tôi", read: "Đã đọc", unreadState: "Chưa đọc", impactOpen: "Xem công việc bị ảnh hưởng",
    viewSource: "Mở bản ghi nguồn", pastVersion: "Phiên bản cũ; không thể ra lệnh thay đổi", viewCurrent: "Xem riêng phiên bản hiện tại v{{version}}",
    sourceUnavailable: "Không thể mở bản ghi nguồn trong không gian làm việc hiện tại.", occurredAt: "Thời điểm phát sinh", status: "Trạng thái",
    savedInApp: "Đã lưu trong ứng dụng", readAt: "Thời điểm đã đọc", markRead: "Đánh dấu đã đọc", markingRead: "Đang xử lý…",
    genericError: "Không thể hoàn tất yêu cầu thông báo. Hãy kiểm tra kết nối rồi thử lại.",
  },
  en: {
    title: "Notifications", unread: "Unread", all: "All", refresh: "Refresh",
    intro: "Changes to your work in the current project. Marking an item read here does not approve work or confirm delivery.",
    loading: "Loading notifications…", loadError: "Could not load or refresh notifications.", empty: "There are no notifications to show.",
    fallbackTitle: "My work changed", read: "Read", unreadState: "Unread", impactOpen: "View affected work",
    viewSource: "Open source", pastVersion: "Past version; change commands are unavailable", viewCurrent: "View current v{{version}} separately",
    sourceUnavailable: "The source record is not available in the current workspace.", occurredAt: "Occurred", status: "Status",
    savedInApp: "Saved in app", readAt: "Read at", markRead: "Mark as read", markingRead: "Working…",
    genericError: "The notification request could not be completed. Check the connection and try again.",
  },
};
const notificationStatusCopy: Record<"ko" | "vi" | "en", Record<string, string>> = {
  ko: { queued: "알림 등록", sent: "발송 완료", delivered: "전달 완료", acknowledged: "수신 확인", failed: "전달 실패", unknown: "알림 상태 확인 필요" },
  vi: { queued: "Thông báo đã đăng ký", sent: "Đã gửi", delivered: "Đã chuyển", acknowledged: "Đã xác nhận nhận", failed: "Chuyển thất bại", unknown: "Cần kiểm tra trạng thái thông báo" },
  en: { queued: "Notification registered", sent: "Sent", delivered: "Delivered", acknowledged: "Receipt confirmed", failed: "Delivery failed", unknown: "Check notification status" },
};
function notificationStatusLabel(status: string) {
  const language = typeof document === "undefined" ? "en" : document.documentElement.lang.slice(0, 2);
  const labels = notificationStatusCopy[language === "ko" || language === "vi" ? language : "en"];
  return labels[status] || labels.unknown;
}

function activeCopy(): Record<LabelKey, string> {
  const language = typeof document === "undefined" ? "en" : document.documentElement.lang.slice(0, 2);
  return copy[language === "ko" || language === "vi" ? language : "en"];
}
function apiErrorCode(error: unknown): string | null {
  return error instanceof ApiError ? error.detail.code : null;
}
function interpolate(value: string, fields: Record<string, string | number>) {
  return value.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(fields[key] ?? ""));
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
  const t = activeCopy();
  const [inboxSnapshot, setInboxSnapshot] = useState<{ scopeKey: string; data: Inbox } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<{ scopeKey: string; id: string } | null>(null);
  const [errorSnapshot, setErrorSnapshot] = useState<{ scopeKey: string; code: string | null } | null>(null);
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [impactSelection, setImpactSelection] = useState<{ scope: string; notice: DrawingImpactNotice } | null>(null);
  const inbox = inboxSnapshot?.scopeKey === scopeKey ? inboxSnapshot.data : { items: [], total: 0, unreadCount: 0 };
  const errorCode = errorSnapshot?.scopeKey === scopeKey ? errorSnapshot.code : null;
  const error = errorSnapshot?.scopeKey === scopeKey ? errorCode ? reasonLabel(errorCode) : t.genericError : "";
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
        setErrorSnapshot({ scopeKey, code: apiErrorCode(requestError) });
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
      if (mounted.current && scopeEpoch.current === epoch) setErrorSnapshot({ scopeKey, code: apiErrorCode(requestError) });
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
        title={<span id="notification-events-title">{t.title}</span>}
        meta={`${t.unread} ${formatNumber(inbox.unreadCount)} · ${t.all} ${formatNumber(inbox.total)}`}
      />
      <div className="notification-events-toolbar">
        <p>{t.intro}</p>
        <ActionButton onClick={() => setRefreshIndex((value) => value + 1)} disabled={loading}>{t.refresh}</ActionButton>
      </div>
      {loading && <div className="notification-events-state" role="status">{t.loading}</div>}
      {!loading && error && <div className="notification-events-error" role="alert"><strong>{t.loadError}</strong><p>{error}</p></div>}
      {!loading && !error && inbox.items.length === 0 && (
        <div className="notification-events-empty">{t.empty}</div>
      )}
      {!loading && !error && inbox.items.length > 0 && (
        <ul className="notification-events-list">
          {inbox.items.map(({ notification, isRead, readAt, drawingImpact }) => {
            const target = resolveNotificationSourceTarget(notification.sourceRef, notification.projectId, workspace);
            return (
            <li key={notification.id} data-notification-id={notification.id} className={isRead ? "is-read" : "is-unread"}>
              <div className="notification-events-copy">
                <div className="notification-events-heading">
                  <strong>{drawingImpact?.title ?? t.fallbackTitle}</strong>
                  <span className="notification-events-read-state">{isRead ? t.read : t.unreadState}</span>
                </div>
                {drawingImpact && <><p data-drawing-impact={drawingImpact.incidentId}>{drawingImpact.message}</p><ActionButton onClick={() => setImpactSelection({ scope: scopeKey, notice: drawingImpact })}>{t.impactOpen}</ActionButton></>}
                <p className="notification-events-source">
                  {recordTypeLabel(notification.sourceRef.objectType)} · {notification.sourceRef.objectId} · {recordVersionLabel(formatNumber(notification.sourceRef.version))}
                </p>
                {target.kind === "exact" && (
                  <div className="notification-events-target" data-source-target="exact" data-source-route={target.route}>
                    {(target.item.record.title || target.item.record.workName || (typeof target.item.record.data?.title === "string" && target.item.record.data.title)) && (
                      <strong>{target.item.record.title || target.item.record.workName || target.item.record.data?.title as string}</strong>
                    )}
                    {onNavigate && <ActionButton onClick={() => openTarget(target.item.record.id, target.route)}>{t.viewSource}</ActionButton>}
                  </div>
                )}
                {target.kind === "past" && (
                  <div className="notification-events-target" data-source-target="past" data-source-route={target.route}>
                    <span>{t.pastVersion}</span>
                    {onNavigate && <ActionButton onClick={() => openTarget(target.currentItem.record.id, target.route)}>{interpolate(t.viewCurrent, { version: formatNumber(target.currentItem.record.version) })}</ActionButton>}
                  </div>
                )}
                {target.kind === "unavailable" && (
                  <p className="notification-events-target-unavailable">{t.sourceUnavailable}</p>
                )}
                <dl>
                  <div><dt>{t.occurredAt}</dt><dd>{formatDateTime(notification.dueAt)}</dd></div>
                  <div><dt>{t.status}</dt><dd>{t.savedInApp} · {notificationStatusLabel(notification.status)}</dd></div>
                  {isRead && readAt && <div><dt>{t.readAt}</dt><dd>{formatDateTime(readAt)}</dd></div>}
                </dl>
              </div>
              {!isRead && (
                <ActionButton onClick={() => void markRead(notification.id)} disabled={busyId !== ""}>
                  {busyId === notification.id ? t.markingRead : t.markRead}
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
