import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from "react";

/** The site's pages. Paths live here once; links and the switch in App read them. */
export const routes = {
  registry: "/",
  retirements: "/retirements",
  verify: "/verify",
  try: "/try",
  how: "/how-it-works",
} as const;

function useLocationPart(read: () => string): string {
  const [value, setValue] = useState(read);
  useEffect(() => {
    const onPop = () => setValue(read());
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, [read]);
  return value;
}

const readPath = () => location.pathname;
const readSearch = () => location.search;

export function usePath(): string {
  return useLocationPart(readPath);
}

/** The query string (`?n=3`), updated on navigation. Verify keeps its lookup here so the URL can be shared. */
export function useSearch(): string {
  return useLocationPart(readSearch);
}

export function navigate(to: string, opts: { keepScroll?: boolean } = {}): void {
  if (to === location.pathname + location.search) return;
  history.pushState(null, "", to);
  dispatchEvent(new PopStateEvent("popstate"));
  if (!opts.keepScroll) scrollTo(0, 0);
}

/** An ordinary link that changes page without a reload; modified clicks open as usual. */
export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(href);
  };
  return <a href={href} onClick={handle} {...rest} />;
}
