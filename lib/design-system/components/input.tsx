'use client';

import { forwardRef, InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Error state */
  error?: boolean;
  /** Error message to display */
  errorMessage?: string;
  /** Label text */
  label?: string;
  /** Helper text below input */
  helperText?: string;
  /** Left icon/addon */
  leftAddon?: React.ReactNode;
  /** Right icon/addon */
  rightAddon?: React.ReactNode;
}

/**
 * DG Input — Fluent 2 text field
 * 
 * Features:
 * - Optional label and helper text
 * - Error state with message
 * - Left/right addons for icons
 * - Accessible and keyboard-navigable
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ 
    className,
    label,
    helperText,
    error,
    errorMessage,
    leftAddon,
    rightAddon,
    ...props 
  }, ref) => {
    const inputId = props.id || `input-${Math.random()}`;

    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label 
            htmlFor={inputId}
            className={cn(
              'text-sm font-semibold',
              error ? 'text-danger-500' : 'text-neutral-90'
            )}
          >
            {label}
            {props.required && <span className="text-danger-500 ml-1">*</span>}
          </label>
        )}

        <div className={cn(
          'flex items-center gap-0',
          'border rounded-sm transition-all duration-150',
          'bg-white',
          error 
            ? 'border-danger-500 focus-within:border-danger-600 focus-within:ring-2 focus-within:ring-danger-100'
            : 'border-neutral-20 focus-within:border-sisyphus-500 focus-within:ring-2 focus-within:ring-sisyphus-100',
          'hover:border-neutral-30',
        )}>
          {leftAddon && (
            <div className="flex items-center px-3 py-2 text-neutral-60">
              {leftAddon}
            </div>
          )}

          <input
            ref={ref}
            id={inputId}
            className={cn(
              'flex-1 px-3 py-2 bg-transparent outline-none text-sm',
              'placeholder:text-neutral-40',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              className,
            )}
            {...props}
          />

          {rightAddon && (
            <div className="flex items-center px-3 py-2 text-neutral-60">
              {rightAddon}
            </div>
          )}
        </div>

        {error && errorMessage && (
          <p className="text-xs text-danger-500 font-medium">
            {errorMessage}
          </p>
        )}

        {helperText && !error && (
          <p className="text-xs text-neutral-60">
            {helperText}
          </p>
        )}
      </div>
    );
  },
);

Input.displayName = 'Input';

/**
 * DG Textarea — Multi-line text input
 */
interface TextareaProps extends InputHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  helperText?: string;
  error?: boolean;
  errorMessage?: string;
  rows?: number;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ 
    className,
    label,
    helperText,
    error,
    errorMessage,
    rows = 4,
    ...props 
  }, ref) => {
    const inputId = props.id || `textarea-${Math.random()}`;

    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label 
            htmlFor={inputId}
            className={cn(
              'text-sm font-semibold',
              error ? 'text-danger-500' : 'text-neutral-90'
            )}
          >
            {label}
            {props.required && <span className="text-danger-500 ml-1">*</span>}
          </label>
        )}

        <textarea
          ref={ref}
          id={inputId}
          rows={rows}
          className={cn(
            'w-full px-3 py-2 bg-white border rounded-sm outline-none transition-all duration-150',
            'text-sm placeholder:text-neutral-40',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            error 
              ? 'border-danger-500 focus:border-danger-600 focus:ring-2 focus:ring-danger-100'
              : 'border-neutral-20 focus:border-sisyphus-500 focus:ring-2 focus:ring-sisyphus-100',
            'hover:border-neutral-30',
            'resize-none',
            className,
          )}
          {...props}
        />

        {error && errorMessage && (
          <p className="text-xs text-danger-500 font-medium">
            {errorMessage}
          </p>
        )}

        {helperText && !error && (
          <p className="text-xs text-neutral-60">
            {helperText}
          </p>
        )}
      </div>
    );
  },
);

Textarea.displayName = 'Textarea';
