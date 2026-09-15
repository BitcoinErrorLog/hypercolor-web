function hashBytes(value: string): number[] {
  const bytes: number[] = [];
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
    bytes.push((h >>> 0) & 255);
  }
  while (bytes.length < 18) {
    h = Math.imul(h ^ bytes.length, 16777619);
    bytes.push((h >>> 0) & 255);
  }
  return bytes;
}

/** Deterministic 5×5 SVG identicon from a pubky (facehash stand-in). */
export function Identicon({ seed, size }: { seed: string; size: number }) {
  const bytes = hashBytes(seed || "hypercolor");
  const hue = (bytes[0] / 255) * 40 + 262;
  const cells: boolean[] = [];
  for (let i = 0; i < 15; i += 1) {
    cells.push(bytes[i + 2] > 110);
  }
  const grid: boolean[][] = [];
  for (let y = 0; y < 5; y += 1) {
    const row: boolean[] = [];
    for (let x = 0; x < 3; x += 1) {
      row.push(cells[y * 3 + x]);
    }
    grid.push([...row, row[1], row[0]]);
  }
  const cell = 20;
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className="block size-full max-w-full"
      aria-hidden="true"
    >
      <rect width="100" height="100" fill={`hsl(${hue} 62% 18%)`} />
      {grid.flatMap((row, y) =>
        row.map((on, x) =>
          on ? (
            <rect
              key={`${x}-${y}`}
              x={x * cell}
              y={y * cell}
              width={cell}
              height={cell}
              fill={`hsl(${hue} 70% 62%)`}
            />
          ) : null,
        ),
      )}
    </svg>
  );
}
