import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';

interface BaseButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly ref?: Ref<HTMLButtonElement>;
  readonly children?: ReactNode;
}

const BASE =
  'inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-45';

export function PrimaryButton({ className, type = 'button', ref, ...rest }: BaseButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      className={`${BASE} h-8 bg-accent px-3 text-[13px] text-accent-fg hover:bg-accent-hover ${className ?? ''}`}
      {...rest}
    />
  );
}

export function SecondaryButton({ className, type = 'button', ref, ...rest }: BaseButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      className={`${BASE} h-8 border border-border-strong bg-bg px-2.5 text-[13px] text-fg-strong hover:bg-bg-subtle ${className ?? ''}`}
      {...rest}
    />
  );
}

export function GhostButton({ className, type = 'button', ref, ...rest }: BaseButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      className={`${BASE} h-7 px-2 text-[13px] text-fg-muted hover:bg-bg-hover hover:text-fg-strong ${className ?? ''}`}
      {...rest}
    />
  );
}

export function DangerButton({ className, type = 'button', ref, ...rest }: BaseButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      className={`${BASE} h-8 border border-border-strong bg-bg px-3 text-[13px] text-fg-strong hover:border-danger hover:bg-danger-soft hover:text-danger ${className ?? ''}`}
      {...rest}
    />
  );
}

export function IconButton({ className, type = 'button', ref, ...rest }: BaseButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      className={`${BASE} h-8 w-8 text-fg-muted hover:bg-bg-hover hover:text-fg-strong ${className ?? ''}`}
      {...rest}
    />
  );
}
