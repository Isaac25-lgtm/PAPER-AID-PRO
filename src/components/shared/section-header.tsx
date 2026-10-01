import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface SectionHeaderProps {
  badge?: string;
  title: string;
  description?: string;
  centered?: boolean;
  className?: string;
  action?: React.ReactNode;
}

export function SectionHeader({
  badge,
  title,
  description,
  centered = false,
  className,
  action,
}: SectionHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 mb-8",
        centered ? "items-center text-center" : "items-start",
        action && "sm:flex-row sm:items-end sm:justify-between",
        className
      )}
    >
      <div className={cn("space-y-1.5", centered && "max-w-2xl")}>
        {badge && (
          <Badge variant="academic" className="mb-1">
            {badge}
          </Badge>
        )}
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
          {title}
        </h2>
        {description && (
          <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {action && <div className="mt-4 sm:mt-0">{action}</div>}
    </div>
  );
}
