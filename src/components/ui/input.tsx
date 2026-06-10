import * as React from 'react';
import { TextInput, type TextInputProps } from 'react-native';
import { cn } from '../../lib/cn';

export const Input = React.forwardRef<TextInput, TextInputProps & { className?: string }>(
  ({ className, placeholderTextColor, ...props }, ref) => (
    <TextInput
      ref={ref}
      placeholderTextColor={placeholderTextColor ?? 'hsl(215 16% 50%)'}
      className={cn(
        'h-11 rounded-lg border border-input bg-background px-3 text-foreground text-base',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
