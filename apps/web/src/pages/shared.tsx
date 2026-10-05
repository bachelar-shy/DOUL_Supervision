import type { WorkItem } from "../data/ui-contract";
import { states } from "../labels";
import { StatusBadge } from "../ui";
import { machineLabels } from "../app/routes";
import { recordTitle } from "./record-utils";

const icons: Record<string, string> = {
  home: "M3 10 12 3l9 7v11h-6v-7H9v7H3Z",
  check: "M4 3h16v18H4z M8 8l2 2 5-5 M8 15h8",
  camera:
    "M3 7h4l2-3h6l2 3h4v14H3z M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  eye:
    "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12 M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  flag: "M5 21V3h14l-3 5 3 5H5",
  tool: "m4 20 7-7 M14 3a5 5 0 0 0 7 7l-4-1-2-3z",
  report: "M4 21V3h16v18H4 M8 8h8 M8 12h8 M8 16h5",
  document: "M5 3h10l4 4v14H5z M14 3v5h5 M8 12h8 M8 16h8",
  layers: "m12 3 10 6-10 6L2 9z M2 13l10 6 10-6 M2 17l10 6 10-6",
  users:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M18 4a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-4",
  arrow: "M5 12h14 M13 6l6 6-6 6",
  refresh:
    "M20 7v5h-5 M4 17v-5h5 M5 7a8 8 0 0 1 14-2l1 2 M4 17l1 2a8 8 0 0 0 14-2",
  close: "m5 5 14 14 M19 5 5 19",
};

export function Icon({ name }: { name: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={icons[name] || icons.document} />
    </svg>
  );
}
export function RecordList({
  items,
  onSelect,
  selected,
}: {
  items: WorkItem[];
  onSelect: (x: WorkItem) => void;
  selected?: string | null;
}) {
  return (
    <div className="record-list">
      {items.length ? (
        items.map((x) => (
          <button
            key={x.record.id}
            className={
              "record-row " + (selected === x.record.id ? "selected" : "")
            }
            onClick={() => onSelect(x)}
          >
            <div className="record-icon">
              <Icon
                name={
                  x.machine === "inspection"
                    ? "check"
                    : x.machine === "action"
                      ? "tool"
                      : "document"
                }
              />
            </div>
            <div className="record-summary">
              <div>
                <small>
                  {machineLabels[x.machine] || x.machine} ·{" "}
                  {x.record.id.slice(0, 6)}
                </small>
                <StatusBadge status={x.record.status}>
                  {states[x.record.status || ""] ||
                    x.record.status ||
                    "원본 보존"}
                </StatusBadge>
              </div>
              <strong>{recordTitle(x.record)}</strong>
              <span>
                A동 2층 / C-5 <i>·</i> 원본 v{x.record.version}
              </span>
            </div>
            <Icon name="arrow" />
          </button>
        ))
      ) : (
        <div className="empty compact">
          현재 권한에서 조회할 항목이 없습니다.
        </div>
      )}
    </div>
  );
}
export function FloorPlan() {
  return (
    <div className="floorplan">
      <span>
        도면 예시 · A-201 Rev.03 <small>실제 위치 정합 전</small>
      </span>
      <svg viewBox="0 0 620 170" aria-label="샘플 도면">
        <g fill="none" stroke="#c5ccd4" strokeWidth="1">
          <path d="M30 20H590V150H30Z M150 20v130 M290 20v130 M440 20v130 M30 80h560" />
          <path
            strokeDasharray="4 4"
            d="M10 45h600 M10 115h600 M90 0v170 M360 0v170 M510 0v170"
          />
        </g>
        <path
          d="M150 20h140v60H150z M290 80h150v70H290z"
          fill="#17365d0d"
          stroke="#17365D"
          strokeWidth="2"
        />
        <circle cx="360" cy="115" r="7" fill="#17365D" />
        <circle
          cx="360"
          cy="115"
          r="17"
          fill="none"
          stroke="#17365D"
          opacity=".3"
        />
        <text x="382" y="120" fill="#17365D" fontSize="14">
          C-5
        </text>
      </svg>
    </div>
  );
}
