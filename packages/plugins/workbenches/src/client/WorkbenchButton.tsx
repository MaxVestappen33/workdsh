import React from 'react';
import { Button } from '@deepseek-ai/dsh-client-ui-primitives';

/** Shared workbench default; rendering, focus and theme remain native-owned. */
export const WorkbenchButton = React.forwardRef<HTMLButtonElement, React.ComponentPropsWithoutRef<typeof Button>>(
  ({ variant = 'toolbar', ...props }, ref) => <Button {...props} variant={variant} ref={ref} />,
);
WorkbenchButton.displayName = 'WorkbenchButton';
