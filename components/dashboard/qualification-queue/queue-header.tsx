'use client';

import React from 'react';

/**
 * queue-header placeholder for future filters/tabs.
 * For now, it renders the queue meta test hooks (sr-only) and an optional toast.
 */
export function QueueHeader({
  queueMeta,
  toast,
}: {
  queueMeta: React.ReactNode;
  toast?: React.ReactNode;
}) {
  return (
    <>
      {queueMeta}
      {toast}
    </>
  );
}

