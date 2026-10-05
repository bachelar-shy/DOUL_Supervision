import type { HTMLAttributes, ReactNode } from "react";

export function PageBoundary({
  name,
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  name: string;
  children: ReactNode;
}) {
  return (
    <div
      data-ui-page={name}
      {...props}
      className={["ui-page-boundary", className].filter(Boolean).join(" ")}
    >
      {children}
    </div>
  );
}
