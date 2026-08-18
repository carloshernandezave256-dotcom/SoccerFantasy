export function loginPathFor(pathname: string, search = "") {
  return `/login?next=${encodeURIComponent(`${pathname}${search}`)}`;
}
