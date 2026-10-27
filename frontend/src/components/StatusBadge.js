import { STATUS_META } from "@/lib/constants";

export const StatusBadge = ({ status, testId }) => {
  const meta = STATUS_META[status] || STATUS_META.new_lead;
  return (
    <span
      data-testid={testId || `status-badge-${status}`}
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${meta.cls}`}
    >
      {meta.label}
    </span>
  );
};

export default StatusBadge;
