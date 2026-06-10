import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  type PressableProps,
} from 'react-native';
import { cn } from '../../lib/cn';

const buttonVariants = cva(
  'flex-row items-center justify-center rounded-lg active:opacity-80',
  {
    variants: {
      variant: {
        default: 'bg-primary',
        secondary: 'bg-secondary',
        outline: 'border border-input bg-background',
        ghost: 'bg-transparent',
        destructive: 'bg-destructive',
      },
      size: {
        sm: 'h-9 px-3',
        md: 'h-11 px-4',
        lg: 'h-12 px-5',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
);

const buttonTextVariants = cva('text-base font-semibold', {
  variants: {
    variant: {
      default: 'text-primary-foreground',
      secondary: 'text-secondary-foreground',
      outline: 'text-foreground',
      ghost: 'text-foreground',
      destructive: 'text-destructive-foreground',
    },
    size: {
      sm: 'text-sm',
      md: 'text-base',
      lg: 'text-base',
      icon: 'text-sm',
    },
  },
  defaultVariants: { variant: 'default', size: 'md' },
});

type ButtonProps = Omit<PressableProps, 'children'> &
  VariantProps<typeof buttonVariants> & {
    className?: string;
    loading?: boolean;
    children?: React.ReactNode;
  };

export const Button = React.forwardRef<React.ComponentRef<typeof Pressable>, ButtonProps>(
  ({ className, variant, size, loading, disabled, children, ...props }, ref) => {
    return (
      <Pressable
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          buttonVariants({ variant, size }),
          (disabled || loading) && 'opacity-50',
          className,
        )}
        {...props}
      >
        {loading ? (
          <ActivityIndicator
            size="small"
            color={variant === 'outline' || variant === 'ghost' ? '#0a0a0a' : '#fff'}
          />
        ) : typeof children === 'string' ? (
          <Text className={buttonTextVariants({ variant, size })}>{children}</Text>
        ) : (
          children
        )}
      </Pressable>
    );
  },
);
Button.displayName = 'Button';

export { buttonTextVariants, buttonVariants };
