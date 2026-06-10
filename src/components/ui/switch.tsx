import * as SwitchPrimitives from '@rn-primitives/switch';
import * as React from 'react';
import { cn } from '../../lib/cn';

const Switch = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root> & { className?: string }
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    ref={ref}
    className={cn(
      'h-7 w-12 shrink-0 flex-row items-center rounded-full border-2 border-transparent px-0.5',
      props.checked ? 'bg-primary' : 'bg-input',
      props.disabled && 'opacity-50',
      className,
    )}
    {...props}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        'h-5 w-5 rounded-full bg-background shadow',
        props.checked ? 'translate-x-5' : 'translate-x-0',
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = 'Switch';

export { Switch };
