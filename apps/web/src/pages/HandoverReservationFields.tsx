import { useTranslation } from "react-i18next";
import type { DomainRef, Workspace } from "../data/ui-contract";

export interface ReservationInput {
  issueRef: DomainRef;
  ownerPartyId?: string;
  dueAt?: string;
  closureRequirement?: string;
}

function localDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function HandoverReservationFields({ issues, participants, value, onChange }: {
  issues: Array<{ ref: DomainRef; label: string }>;
  participants: Workspace["participants"];
  value: ReservationInput[];
  onChange: (value: ReservationInput[]) => void;
}) {
  const { t } = useTranslation();
  const row = (ref: DomainRef) => value.find((entry) => entry.issueRef.objectId === ref.objectId && entry.issueRef.version === ref.version) ?? { issueRef: ref };
  const update = (ref: DomainRef, next: Partial<ReservationInput>) => onChange(issues.map((issue) => issue.ref.objectId === ref.objectId ? { ...row(issue.ref), ...next } : row(issue.ref)));
  return <div data-ui-component="handover-reservation-inputs">
    {issues.map(({ ref, label }) => {
      const entry = row(ref);
      return <fieldset key={`${ref.objectId}:${ref.version}`} aria-label={`${label} · ${ref.objectId}`}>
        <legend>{label} · v{ref.version}</legend>
        <label>{t("completion.reservationOwner")}<select aria-label={t("completion.reservationOwner")} value={entry.ownerPartyId ?? ""} onChange={(event) => update(ref, { ownerPartyId: event.target.value })}>
          <option value="">{t("commandModal.partySelect")}</option>
          {participants.map((participant) => <option key={participant.partyId} value={participant.partyId}>{participant.name}</option>)}
        </select></label>
        <label>{t("completion.dueAt")}<input aria-label={t("completion.dueAt")} type="datetime-local" value={localDate(entry.dueAt)} onChange={(event) => update(ref, { dueAt: event.target.value ? new Date(event.target.value).toISOString() : "" })} /></label>
        <label>{t("completion.closureRequirement")}<textarea aria-label={t("completion.closureRequirement")} value={entry.closureRequirement ?? ""} onChange={(event) => update(ref, { closureRequirement: event.target.value })} /></label>
      </fieldset>;
    })}
  </div>;
}
