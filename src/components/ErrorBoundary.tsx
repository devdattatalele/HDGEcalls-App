import { Component, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { Button } from './ui/button';
import { Muted, Text } from './ui/text';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // eslint-disable-next-line no-console
    console.warn('[ErrorBoundary]', error?.message, info?.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    const msg = this.state.error?.message ?? String(this.state.error);
    return (
      <View className="flex-1 bg-background">
        <ScrollView contentContainerClassName="flex-grow items-center justify-center p-6 gap-4">
          <Text className="text-foreground text-xl font-semibold">
            Something went wrong
          </Text>
          <Muted className="text-center">{msg}</Muted>
          <Button onPress={this.reset} className="mt-2">
            Try again
          </Button>
        </ScrollView>
      </View>
    );
  }
}
