import { Avatar } from "@/components/ui/avatar";
import { formatPublicKey } from "@/lib/formatPublicKey";
import { formatRelativeTime } from "@/lib/format";

export function CompactListRow({
  name,
  pubky,
  subtitle,
  time,
}: {
  name: string;
  pubky: string;
  subtitle?: string;
  time?: number;
}) {
  return (
    <div className="flex items-center gap-2 py-2" data-slot="compact-row">
      <Avatar seed={pubky} size="md" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold">{name}</p>
        <p
          className={
            subtitle
              ? "truncate text-base text-muted-foreground"
              : "truncate text-xs font-medium tracking-[1.2px] text-muted-foreground uppercase"
          }
        >
          {subtitle ?? formatPublicKey({ key: pubky })}
        </p>
      </div>
      {time ? <span className="text-xs text-muted-foreground">{formatRelativeTime(time)}</span> : null}
    </div>
  );
}
