import {
  ArrowRight,
  Camera,
  ClipboardCheck,
  Eye,
  FileText,
  Flag,
  Home,
  Layers,
  RefreshCw,
  Users,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";

import type { WorkItem } from "../data/ui-contract";
import { states } from "../labels";
import { StatusBadge } from "../ui";
import { machineLabels } from "../app/routes";
import { recordTitle } from "./record-utils";

const icons: Record<string, LucideIcon> = {
  home: Home,
  check: ClipboardCheck,
  camera: Camera,
  eye: Eye,
  flag: Flag,
  tool: Wrench,
  report: FileText,
  document: FileText,
  layers: Layers,
  users: Users,
  arrow: ArrowRight,
  refresh: RefreshCw,
  close: X,
};

export function Icon({ name }: { name: string }) {
  const IconComponent = icons[name] || FileText;
  return <IconComponent aria-hidden="true" strokeWidth={1.6} />;
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
