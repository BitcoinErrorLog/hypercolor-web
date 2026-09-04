export function avatarInitial(value: string | null | undefined): string {
  const cleaned = (value ?? "").replace(/\p{Cf}/gu, "").trim();
  return [...cleaned][0]?.toUpperCase() ?? "?";
}
