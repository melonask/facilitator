import { useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Copy01Icon, Tick01Icon } from '@hugeicons/core-free-icons';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface CopyButtonProps {
  text: string;
  className?: string;
}

export function CopyButton({ text, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation(); 
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success('Copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        "inline-flex items-center justify-center h-3 w-3 text-muted-foreground/50 hover:text-primary transition-colors cursor-pointer focus:outline-none",
        className
      )}
      title="Copy"
    >
      {copied ? (
        <HugeiconsIcon icon={Tick01Icon} size={10} strokeWidth={3} className="text-green-500" />
      ) : (
        <HugeiconsIcon icon={Copy01Icon} size={10} strokeWidth={2} />
      )}
      <span className="sr-only">Copy</span>
    </button>
  );
}
