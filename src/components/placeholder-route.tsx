import type { ReactNode } from "react";

type PlaceholderRouteProps = {
  title: string;
  children?: ReactNode;
};

export function PlaceholderRoute({ title, children }: PlaceholderRouteProps) {
  return (
    <article className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-muted-foreground">
        {title} — coming online with your session.
      </p>
      {children}
    </article>
  );
}
