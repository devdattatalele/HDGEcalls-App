import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import { cn } from '../../lib/cn';

export type SegmentedOption<T extends string> = { label: string; value: T };

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: SegmentedOption<T>[];
  className?: string;
}) {
  return (
    <View
      className={cn(
        'flex-row rounded-lg border border-border bg-muted p-1',
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            className={cn(
              'flex-1 items-center justify-center rounded-md py-2',
              active && 'bg-card',
            )}
          >
            <Text
              className={cn(
                'text-sm',
                active ? 'text-foreground font-semibold' : 'text-muted-foreground',
              )}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
