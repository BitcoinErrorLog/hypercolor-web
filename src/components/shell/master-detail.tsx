import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function MasterDetail({
  list,
  detail,
  className,
}: {
  list: ReactNode;
  detail: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("hc-master-detail min-h-0 flex-1 border-t border-border", className)}>
      <div
        data-slot="master-list"
        className="max-h-[36svh] overflow-y-auto border-b border-border bg-white/[0.03] lg:max-h-none lg:border-r lg:border-b-0"
      >
        {list}
      </div>
      <div
        data-slot="detail-pane"
        className="flex h-full min-h-0 w-full min-w-0 flex-col items-stretch overflow-hidden"
      >
        {detail}
      </div>
    </div>
  );
}
