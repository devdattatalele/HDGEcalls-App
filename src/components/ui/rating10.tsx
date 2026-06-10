import { Pressable, View } from 'react-native';
import { cn } from '../../lib/cn';
import { Text } from './text';

/**
 * Compact 1–10 picker. Renders as ten round chips on one line. Tap a chip
 * to set the value; tap the currently-selected chip to clear back to null.
 */
export function Rating10({
  value,
  onChange,
  className,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  className?: string;
}) {
  return (
    <View className={cn('flex-row gap-1.5', className)}>
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
        const active = value !== null && n <= value;
        const isCurrent = value === n;
        return (
          <Pressable
            key={n}
            onPress={() => onChange(isCurrent ? null : n)}
            className="flex-1 items-center"
          >
            <View
              className={cn(
                'h-9 w-full items-center justify-center rounded-md border',
                active
                  ? 'border-brand bg-brand'
                  : 'border-border bg-card',
              )}
            >
              <Text
                className={cn(
                  'text-xs font-semibold',
                  active ? 'text-brand-foreground' : 'text-muted-foreground',
                )}
              >
                {n}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
