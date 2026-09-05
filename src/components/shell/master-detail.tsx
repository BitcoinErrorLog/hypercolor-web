import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function MasterDetail({
  list,
  detail,
  className,
  listClassName,
  detailClassName,
}: {
  list: ReactNode;
  detail: ReactNode;
  className?: string;
  listClassName?: string;
  detailClassName?: string;
}) {
  return (
    <div className={cn("hc-master-detail min-h-0 flex-1", className)}>
      <div
        data-slot="master-list"
        className={cn(
          "hc-master-list-scroll overflow-y-auto border-b border-border hc-wash lg:border-r lg:border-b-0",
          listClassName,
        )}
      >
        {list}
      </div>
      <div
        data-slot="detail-pane"
        className={cn("flex h-full min-h-0 w-full min-w-0 flex-col items-stretch overflow-hidden", detailClassName)}
      >
        {detail}
      </div>
    </div>
  );
}
