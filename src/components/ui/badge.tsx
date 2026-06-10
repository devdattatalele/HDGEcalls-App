import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { Text, View, type ViewProps } from 'react-native';
import { cn } from '../../lib/cn';

const badgeVariants = cva(
  'self-start flex-row items-center rounded-full px-2.5 py-0.5',
  {
    variants: {
      variant: {
        default: 'bg-primary',
        secondary: 'bg-secondary',
        outline: 'border border-border bg-transparent',
        success: 'bg-emerald-500/15',
        warning: 'bg-amber-500/15',
        destructive: 'bg-destructive/15',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

const badgeTextVariants = cva('text-xs font-medium', {
  variants: {
    variant: {
      default: 'text-primary-foreground',
      secondary: 'text-secondary-foreground',
      outline: 'text-foreground',
      success: 'text-emerald-600 dark:text-emerald-400',
      warning: 'text-amber-600 dark:text-amber-400',
      destructive: 'text-red-600 dark:text-red-400',
    },
  },
  defaultVariants: { variant: 'default' },
});

type BadgeProps = ViewProps &
  VariantProps<typeof badgeVariants> & {
    className?: string;
    children: React.ReactNode;
  };

export function Badge({ className, variant, children, ...props }: BadgeProps) {
  return (
    <View className={cn(badgeVariants({ variant }), className)} {...props}>
      <Text className={badgeTextVariants({ variant })}>{children}</Text>
    </View>
  );
}
