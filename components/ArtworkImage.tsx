"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { cn } from "@/lib/utils/cn";

export function ArtworkImage({
  src,
  width,
  height,
  className,
  fallback,
  loading = "lazy",
}: {
  src?: string | null;
  width: number;
  height: number;
  className?: string;
  fallback?: ReactNode;
  loading?: "eager" | "lazy";
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = Boolean(src && failedSrc !== src);

  return (
    <span className={cn("relative grid shrink-0 place-items-center overflow-hidden", className)}>
      <span aria-hidden="true">{fallback}</span>
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src!}
          alt=""
          width={width}
          height={height}
          loading={loading}
          decoding="async"
          onError={() => setFailedSrc(src!)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : null}
    </span>
  );
}
