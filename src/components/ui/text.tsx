import * as Slot from '@rn-primitives/slot';
import * as React from 'react';
import { Text as RNText, type TextProps } from 'react-native';
import { cn } from '../../lib/cn';

type Props = TextProps & { asChild?: boolean; className?: string };

const Text = React.forwardRef<RNText, Props>(
  ({ className, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot.Text : RNText;
    return (
      <Comp
        ref={ref}
        className={cn('text-foreground text-base', className)}
        {...props}
      />
    );
  },
);
Text.displayName = 'Text';

const H1 = React.forwardRef<RNText, TextProps & { className?: string }>(
  ({ className, ...props }, ref) => (
    <RNText
      ref={ref}
      className={cn('text-foreground text-3xl font-bold tracking-tight', className)}
      {...props}
    />
  ),
);
H1.displayName = 'H1';

const H2 = React.forwardRef<RNText, TextProps & { className?: string }>(
  ({ className, ...props }, ref) => (
    <RNText
      ref={ref}
      className={cn('text-foreground text-xl font-semibold', className)}
      {...props}
    />
  ),
);
H2.displayName = 'H2';

const P = React.forwardRef<RNText, TextProps & { className?: string }>(
  ({ className, ...props }, ref) => (
    <RNText
      ref={ref}
      className={cn('text-foreground text-base leading-6', className)}
      {...props}
    />
  ),
);
P.displayName = 'P';

const Muted = React.forwardRef<RNText, TextProps & { className?: string }>(
  ({ className, ...props }, ref) => (
    <RNText
      ref={ref}
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  ),
);
Muted.displayName = 'Muted';

export { Text, H1, H2, P, Muted };
