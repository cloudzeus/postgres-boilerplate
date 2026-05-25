'use client';

import { forwardRef, ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual variant */
  variant?: 'primary' | 'secondary' | 'subtle' | 'ghost' | 'danger' | 'brand';
  /** Size preset */
  size?: 'sm' | 'md' | 'lg';
  /** Left or right icon */
  icon?: React.ReactNode;
  /** Full width button */
  fullWidth?: boolean;
  /** Loading state */
  isLoading?: boolean;
}

/**
 * DG Button — Fluent 2 semantics
 * 
 * Variants:
 * - primary: Sisyphus Blue, for main actions
 * - secondary: White/bordered, default action
 * - subtle: Ghost-like, secondary actions
 * - ghost: Text-only, minimal
 * - danger: Red, destructive actions
 * - brand: DG Red, brand moments (rare)
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ 
    className, 
    variant = 'secondary', 
    size = 'md', 
    icon, 
    fullWidth,
    isLoading,
    children, 
    disabled,
    ...props 
  }, ref) => {
    const isDisabled = disabled || isLoading;

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        className={cn(
          // Base styles
          'inline-flex items-center justify-center gap-2 font-semibold rounded-sm',
          'transition-all duration-150 select-none',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'active:scale-[0.98]',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dg-red-500',
          
          // Variants
          variant === 'primary' && 
            'bg-sisyphus-500 text-white hover:bg-sisyphus-600 active:bg-sisyphus-700 shadow-fluent-2',
          
          variant === 'secondary' && 
            'bg-white text-neutral-90 border border-neutral-20 hover:bg-neutral-6 hover:border-neutral-30 shadow-fluent-2',
          
          variant === 'subtle' && 
            'bg-neutral-8 text-neutral-80 hover:bg-neutral-10 active:bg-neutral-20',
          
          variant === 'ghost' && 
            'text-neutral-80 hover:bg-neutral-8 active:bg-neutral-10',
          
          variant === 'danger' && 
            'bg-danger-500 text-white hover:bg-red-700 active:bg-red-800 shadow-fluent-2',
          
          variant === 'brand' && 
            'bg-dg-red-500 text-white hover:bg-dg-red-600 active:bg-dg-red-700 shadow-brand-glow',

          // Sizes
          size === 'sm' && 'h-8 px-3 text-sm',
          size === 'md' && 'h-9 px-4 text-sm',
          size === 'lg' && 'h-11 px-6 text-base',

          // Full width
          fullWidth && 'w-full',

          className,
        )}
        {...props}
      >
        {isLoading && (
          <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        )}
        {icon && !isLoading && icon}
        {children}
      </button>
    );
  },
);

Button.displayName = 'Button';
