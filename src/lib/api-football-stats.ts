export function completedPassesFromApi(total: number | null | undefined, accuracy: number | string | null | undefined) {
  if (typeof accuracy === "string" && accuracy.includes("%")) {
    const percentage = Number(accuracy.replace("%", "")) || 0;
    return Math.round((total ?? 0) * percentage / 100);
  }
  return Number(accuracy) || 0;
}
