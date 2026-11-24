import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';

import { cn } from '@talentflow/ui';

const alertVariants = cva('relative w-full rounded-lg border p-4 text-sm [&>svg]:size-4 [&>svg]:shrink-0', {
  variants: {
    variant: {
      default: 'border-border bg-muted/50 text-foreground',
      info: 'border-info/30 bg-info/8 text-foreground [&>svg]:text-info',
      success: 'border-success/30 bg-success/8 text-foreground [&>svg]:text-success',
      warning: 'border-warning/35 bg-warning/10 text-foreground [&>svg]:text-warning',
      destructive: 'border-destructive/30 bg-destructive/8 text-foreground [&>svg]:text-destructive',
    },
  },
  defaultVariants: { variant: 'default' },
});

export interface AlertProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {}

export function Alert({ className, variant, ...props }: AlertProps) {
  return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

export function AlertTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h5
      className={cn('mb-1 flex items-center gap-2 font-medium leading-none tracking-tight', className)}
      {...props}
    />
  );
}

export function AlertDescription({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('text-sm text-muted-foreground [&_p]:leading-relaxed', className)} {...props} />;
}
