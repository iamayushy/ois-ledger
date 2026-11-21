import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';
import { CopyIcon } from '@phosphor-icons/react/dist/csr/Copy';
import { useState } from 'react';
import { GhostButton } from './button';

interface CopyButtonProps {
  readonly value: string;
  readonly label?: string;
}

export function CopyButton({ value, label }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      return;
    }
  }

  return (
    <GhostButton
      onClick={handleCopy}
      aria-label={label ? `Copy ${label}` : 'Copy'}
      className="h-6 shrink-0 px-1.5 text-[11.5px]"
    >
      {copied ? (
        <CheckIcon size={12} weight="bold" className="text-success" />
      ) : (
        <CopyIcon size={12} />
      )}
      {label ? <span>{copied ? 'Copied' : label}</span> : null}
    </GhostButton>
  );
}
