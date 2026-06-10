import * as React from 'react';
import { Text, View } from 'react-native';
import { cn } from '../../lib/cn';

// Deterministic color from a string, picked from a fixed palette so the same
// contact always renders with the same color.
const PALETTE = [
  'bg-rose-500',
  'bg-orange-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-teal-500',
  'bg-sky-500',
  'bg-indigo-500',
  'bg-fuchsia-500',
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function initials(name: string | null | undefined, fallback: string): string {
  const src = (name ?? '').trim() || fallback;
  const parts = src.split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

type Size = 'sm' | 'md' | 'lg';
const SIZE_MAP: Record<Size, string> = {
  sm: 'h-9 w-9',
  md: 'h-11 w-11',
  lg: 'h-16 w-16',
};
const TEXT_SIZE: Record<Size, string> = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-xl',
};

export function Avatar({
  name,
  fallback = '#',
  size = 'md',
  className,
}: {
  name: string | null | undefined;
  fallback?: string;
  size?: Size;
  className?: string;
}) {
  const seed = (name ?? fallback ?? '?').toString();
  const color = PALETTE[hash(seed) % PALETTE.length];
  return (
    <View
      className={cn(
        'items-center justify-center rounded-full',
        SIZE_MAP[size],
        color,
        className,
      )}
    >
      <Text className={cn('font-semibold text-white', TEXT_SIZE[size])}>
        {initials(name, fallback)}
      </Text>
    </View>
  );
}
