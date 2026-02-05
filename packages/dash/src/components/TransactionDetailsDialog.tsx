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
  const hasTokenTransfers = transaction.tokensTransferred.length > 0;

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
            {hasTokenTransfers && (
              <Badge className="gap-1.5 h-6 text-xs bg-teal-500/15 text-teal-600 dark:text-teal-400 border-teal-500/20 hover:bg-teal-500/15">
                EIP-7702
              </Badge>
            )}
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

          {/* Payment Flow for EIP-7702 */}
          {hasTokenTransfers ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <HugeiconsIcon icon={Link01Icon} className="h-4 w-4" />
                <span>Payment Flow</span>
                <Badge variant="secondary" className="ml-auto text-[10px]">
                  {transaction.tokensTransferred.length} transfer{transaction.tokensTransferred.length !== 1 ? 's' : ''}
                </Badge>
              </div>
              <div className="border divide-y">
                {transaction.tokensTransferred.map((t, idx) => {
                  const meta = tokenMetadata[t.address.toLowerCase()];
                  const isEth = t.address === '0x0000000000000000000000000000000000000000';
                  const decimals = meta?.decimals ?? 18;
                  const amount = Number(BigInt(t.amount)) / 10 ** decimals;
                  const formattedAmount = amount < 0.0001 ? amount.toExponential(2) : amount.toPrecision(4);
                  const symbol = isEth ? currency : (meta?.symbol || 'TOKEN');

                  return (
                    <div key={idx} className="p-3 space-y-2.5">
                      {/* Amount */}
                      <div className="flex items-center justify-between">
                        <Badge variant="secondary" className="font-bold text-xs">
                          {symbol}
                        </Badge>
                        <span className="font-mono font-semibold text-sm">
                          {formattedAmount}
                        </span>
                      </div>

                      {/* Payer → Recipient */}
                      <div className="flex items-center gap-2 text-xs">
                        <div className="flex-1 min-w-0">
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium block mb-0.5">Payer</span>
                          <div className="bg-muted/50 px-2 py-1.5 font-mono flex items-center gap-1 min-w-0">
                            <span className="truncate">{shortenAddress(t.from, 4)}</span>
                            <CopyButton text={t.from} />
                          </div>
                        </div>
                        <HugeiconsIcon icon={ArrowRight01Icon} className="h-3 w-3 text-muted-foreground shrink-0 mt-4" />
                        <div className="flex-1 min-w-0">
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium block mb-0.5">Recipient</span>
                          <div className="bg-muted/50 px-2 py-1.5 font-mono flex items-center gap-1 min-w-0">
                            <span className="truncate">{shortenAddress(t.to, 4)}</span>
                            <CopyButton text={t.to} />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* Standard FROM → TO for non-payment transactions */
            <div className="border bg-muted/20 p-3 space-y-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="h-5 w-5 bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <HugeiconsIcon icon={UserIcon} className="h-3 w-3" />
                  </div>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">From</span>
                </div>
                <div className="bg-background border px-3 py-2 font-mono text-xs flex items-center gap-2 min-w-0">
                  <span className="truncate flex-1">{transaction.from}</span>
                  <CopyButton text={transaction.from} />
                </div>
              </div>
              <div className="flex justify-center">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <div className="h-px w-8 bg-border" />
                  <HugeiconsIcon icon={ArrowRight01Icon} className="h-4 w-4 rotate-90" />
                  <div className="h-px w-8 bg-border" />
                </div>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="h-5 w-5 bg-muted text-muted-foreground flex items-center justify-center shrink-0">
                    <HugeiconsIcon icon={CheckListIcon} className="h-3 w-3" />
                  </div>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">To</span>
                </div>
                <div className="bg-background border px-3 py-2 font-mono text-xs flex items-center gap-2 min-w-0">
                  <span className="truncate flex-1">{transaction.to || 'Contract Creation'}</span>
                  {transaction.to && <CopyButton text={transaction.to} />}
                </div>
              </div>
            </div>
          )}

          {/* Relayer & Gas */}
          <div className={`grid gap-3 ${hasTokenTransfers ? 'grid-cols-3' : 'grid-cols-2'}`}>
            {hasTokenTransfers && (
              <div className="p-3 border bg-muted/20 space-y-1">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                  <HugeiconsIcon icon={UserIcon} className="h-3 w-3" /> Relayer
                </div>
                <div className="font-mono text-xs truncate" title={transaction.from}>
                  {shortenAddress(transaction.from, 4)}
                </div>
                <p className="text-[10px] text-muted-foreground">Paid gas</p>
              </div>
            )}
            <div className="p-3 border bg-muted/20 space-y-1">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                <HugeiconsIcon icon={Coins01Icon} className="h-3 w-3" /> {hasTokenTransfers ? 'Tx Value' : 'Value'}
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
