import type { ReactNode } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import {
  getPostAuthPath,
  getSafeReturnPath,
  saveBrowserOAuthReturnPath,
} from "@/lib/auth-redirect";

export function AuthLink({
  children,
  className,
  profile = false,
}: {
  children: ReactNode;
  className?: string;
  profile?: boolean;
}) {
  const { pathname, searchStr, hash } = useLocation();
  const next = getSafeReturnPath(`${pathname}${searchStr}${hash}`);
  const search = profile ? { view: "profile" as const, next } : { next };
  const returnPath = getPostAuthPath(next);

  return (
    <Link
      to="/auth"
      search={search}
      className={className}
      onClick={() => saveBrowserOAuthReturnPath(returnPath)}
    >
      {children}
    </Link>
  );
}
