import type { ChangeEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Typography } from "@/components/ui/typography";

export function InputField({
  id,
  value,
  defaultValue,
  placeholder,
  onChange,
  icon,
  message,
  size = "md",
}: {
  id?: string;
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  icon?: ReactNode;
  message?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const sizeClass = { sm: "h-10 text-sm", md: "h-12 text-base", lg: "h-14 text-lg" }[size];
  return (
    <label className="flex w-full flex-col gap-2">
      <span className="relative flex items-center">
        {icon ? <span className="pointer-events-none absolute left-3">{icon}</span> : null}
        <Input
          id={id}
          value={value}
          defaultValue={defaultValue}
          placeholder={placeholder}
          onChange={onChange}
          className={cn(sizeClass, icon && "pl-10")}
        />
      </span>
      {message ? (
        <Typography as="span" size="xs" className="text-muted-foreground">
          {message}
        </Typography>
      ) : null}
    </label>
  );
}
