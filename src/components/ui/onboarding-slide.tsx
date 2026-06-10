import * as React from 'react';
import { View, useWindowDimensions } from 'react-native';
import { cn } from '../../lib/cn';
import { Muted, P, Text } from './text';

export interface SlideProps {
  title: string;
  body?: string;
  icon?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export function OnboardingSlide({
  title,
  body,
  icon,
  children,
  footer,
  className,
}: SlideProps) {
  const { width } = useWindowDimensions();
  return (
    <View style={{ width }} className={cn('flex-1 px-6 py-8', className)}>
      <View className="flex-1 items-center justify-center gap-6">
        {icon ? <View className="items-center">{icon}</View> : null}
        <View className="items-center gap-3 max-w-md">
          <Text className="text-foreground text-3xl font-bold text-center">
            {title}
          </Text>
          {body ? <P className="text-center text-muted-foreground">{body}</P> : null}
        </View>
        {children ? <View className="w-full max-w-md">{children}</View> : null}
      </View>
      {footer ? <View className="pb-4">{footer}</View> : null}
    </View>
  );
}

export function Dot({ filled }: { filled: boolean }) {
  return (
    <View
      className={cn(
        'h-2 w-2 rounded-full',
        filled ? 'bg-brand' : 'bg-muted',
      )}
    />
  );
}

export function Bullet({ text }: { text: string }) {
  return (
    <View className="flex-row gap-2 items-start">
      <View className="mt-2 h-1.5 w-1.5 rounded-full bg-brand" />
      <Muted className="flex-1 text-foreground/80 text-base leading-6">{text}</Muted>
    </View>
  );
}
