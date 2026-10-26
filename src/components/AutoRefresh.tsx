'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Re-renders the server page every few seconds while something on it is still running (a search that is waiting or running).
export function AutoRefresh({ active, every = 3000 }: { active: boolean; every?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), every);
    return () => clearInterval(t);
  }, [active, every, router]);
  return null;
}
