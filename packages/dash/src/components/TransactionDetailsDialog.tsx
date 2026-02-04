import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { type Transaction, type TokenMetadata } from '@/store/useStore';
import { formatEther } from 'viem';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowRight01Icon, File01Icon, Coins01Icon, Rocket01Icon, Calendar01Icon, Link01Icon, Blockchain01Icon, Globe02Icon, UserIcon, CheckListIcon } from '@hugeicons/core-free-icons';
import { CopyButton } from '@/components/CopyButton';
import { Badge } from '@/components/ui/badge';

interface TransactionDetailsDialogProps {
  transaction: Transaction | null;
  isOpen: boolean;
  onClose: () => void;
  tokenMetadata: Record<string, TokenMetadata>;
  networkName: string;
  currency: string;
}

function formatNumber(eth: number, decimals = 7): string {
  if (eth === 0) return '0';
  if (eth >= 1) return eth.toFixed(4);
  // Always show as 0.XXXXXXX with specified decimal places
  return eth.toFixed(decimals);
}

function formatGasFee(wei: string): string {
  const eth = parseFloat(formatEther(BigInt(wei)));
  return formatNumber(eth, 7);
}

function formatValue(wei: string): string {
  if (wei === '0') return '0';
  const eth = parseFloat(formatEther(BigInt(wei)));
  return formatNumber(eth, 7);
}

function shortenAddress(address: string, chars = 6): string {
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

export function TransactionDetailsDialog({ transaction, isOpen, onClose, tokenMetadata, networkName, currency }: TransactionDetailsDialogProps) {
  if (!transaction) return null;

  const val = formatValue(transaction.value);
  const fee = transaction.gasCost ? formatGasFee(transaction.gasCost) : 'Unknown';

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[640px] max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <div className="p-1.5 bg-primary/10 text-primary">
              <HugeiconsIcon icon={File01Icon} className="h-4 w-4" strokeWidth={2} />
            </div>
            <span>Transaction Details</span>
          </DialogTitle>
          <DialogDescription className="sr-only">
            Transaction details for hash {transaction.hash}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-4 pr-1">
          {/* Hash */}
          <div className="space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Transaction Hash</span>
            <div className="font-mono text-xs bg-muted/50 px-3 py-2 flex items-center gap-2 min-w-0">
              <span className="truncate flex-1">{transaction.hash}</span>
              <CopyButton text={transaction.hash} />
            </div>
          </div>

          {/* Meta info */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="gap-1.5 font-normal h-6 text-xs">
              <HugeiconsIcon icon={Globe02Icon} className="h-3 w-3" /> {networkName}
            </Badge>
            <Badge variant="outline" className="gap-1.5 font-normal h-6 text-xs">
              <HugeiconsIcon icon={Blockchain01Icon} className="h-3 w-3" /> Block {transaction.blockNumber.toLocaleString()}
            </Badge>
            <span className="text-xs text-muted-foreground flex items-center gap-1.5 ml-auto">
              <HugeiconsIcon icon={Calendar01Icon} className="h-3 w-3" />
              {new Date(transaction.timestamp).toLocaleString([], { hour12: false })}
            </span>
          </div>

          {/* FROM → TO */}
          <div className="border bg-muted/20 p-3 space-y-3">
            {/* From */}
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="h-5 w-5 bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <HugeiconsIcon icon={UserIcon} className="h-3 w-3" />
                </div>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">From (Facilitator)</span>
              </div>
              <div className="bg-background border px-3 py-2 font-mono text-xs flex items-center gap-2 min-w-0">
                <span className="truncate flex-1">{transaction.from}</span>
                <CopyButton text={transaction.from} />
              </div>
            </div>

            {/* Arrow */}
            <div className="flex justify-center">
              <div className="flex items-center gap-2 text-muted-foreground">
                <div className="h-px w-8 bg-border" />
                <HugeiconsIcon icon={ArrowRight01Icon} className="h-4 w-4 rotate-90" />
                <div className="h-px w-8 bg-border" />
              </div>
            </div>

            {/* To */}
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="h-5 w-5 bg-muted text-muted-foreground flex items-center justify-center shrink-0">
                  <HugeiconsIcon icon={CheckListIcon} className="h-3 w-3" />
                </div>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                  {transaction.tokensTransferred.length > 0 ? 'Contract' : 'To'}
                </span>
              </div>
              <div className="bg-background border px-3 py-2 font-mono text-xs flex items-center gap-2 min-w-0">
                <span className="truncate flex-1">{transaction.to || 'Contract Creation'}</span>
                {transaction.to && <CopyButton text={transaction.to} />}
              </div>
            </div>
          </div>

          {/* Value and Gas Fee */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 border bg-muted/20 space-y-1">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                <HugeiconsIcon icon={Coins01Icon} className="h-3 w-3" /> Value
              </div>
              <div className="text-lg font-bold font-mono truncate" title={`${formatEther(BigInt(transaction.value))} ${currency}`}>
                {val}
                <span className="text-xs font-normal text-muted-foreground ml-1">{currency}</span>
              </div>
            </div>
            <div className="p-3 border bg-muted/20 space-y-1">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                <HugeiconsIcon icon={Rocket01Icon} className="h-3 w-3" /> Gas Fee
              </div>
              <div className="text-lg font-bold font-mono truncate" title={transaction.gasCost ? `${formatEther(BigInt(transaction.gasCost))} ${currency}` : 'Unknown'}>
                {fee}
                <span className="text-xs font-normal text-muted-foreground ml-1">{currency}</span>
              </div>
            </div>
          </div>

          {/* Token Transfers */}
          {transaction.tokensTransferred.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <HugeiconsIcon icon={Link01Icon} className="h-4 w-4" />
                <span>Token Transfers</span>
                <Badge variant="secondary" className="ml-auto text-[10px]">
                  {transaction.tokensTransferred.length}
                </Badge>
              </div>
              <div className="border divide-y">
                {transaction.tokensTransferred.map((t, idx) => {
                  const meta = tokenMetadata[t.address.toLowerCase()];
                  const amount = parseFloat(formatEther(BigInt(t.amount)));
                  const formattedAmount = amount < 0.0001 ? amount.toExponential(2) : amount.toPrecision(4);

                  return (
                    <div key={idx} className="p-3 space-y-2">
                      {/* Token and Amount */}
                      <div className="flex items-center justify-between">
                        <Badge variant="secondary" className="font-bold text-xs">
                          {meta?.symbol || 'TOKEN'}
                        </Badge>
                        <span className="font-mono font-semibold text-sm">
                          {formattedAmount}
                        </span>
                      </div>

                      {/* Flow */}
                      <div className="flex items-center gap-2 text-xs">
                        <div className="flex-1 min-w-0 bg-muted/50 px-2 py-1.5 font-mono truncate">
                          {shortenAddress(transaction.from, 4)}
                        </div>
                        <HugeiconsIcon icon={ArrowRight01Icon} className="h-3 w-3 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0 bg-muted/50 px-2 py-1.5 font-mono flex items-center gap-1">
                          <span className="truncate">{shortenAddress(t.to, 4)}</span>
                          <CopyButton text={t.to} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
