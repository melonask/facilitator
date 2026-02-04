import { useState } from 'react';
import { useStore } from '@/store/useStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { HugeiconsIcon } from '@hugeicons/react';
import { Delete02Icon, Add01Icon, Alert01Icon } from '@hugeicons/core-free-icons';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from 'sonner';
import { privateKeyToAccount } from 'viem/accounts';
import { CopyButton } from '@/components/CopyButton';

export function Settings() {
  const { networks, addNetwork, removeNetwork, facilitators, addFacilitator, removeFacilitator, clearAllData } = useStore();

  const [newNetwork, setNewNetwork] = useState({ id: '', name: '', rpcUrl: '', currency: 'ETH' });
  const [newFacilitator, setNewFacilitator] = useState({ id: '', label: '', networkId: '', privateKey: '' });
  const [addMode, setAddMode] = useState<'address' | 'privateKey'>('address');

  const handleAddNetwork = () => {
    if (!newNetwork.id || !newNetwork.name || !newNetwork.rpcUrl) {
      toast.error("Please fill in all network fields");
      return;
    }
    if (networks.some(n => n.id === newNetwork.id)) {
      toast.error("Network ID already exists");
      return;
    }
    addNetwork(newNetwork);
    setNewNetwork({ id: '', name: '', rpcUrl: '', currency: 'ETH' });
    toast.success('Network added');
  };

  const handleAddFacilitator = () => {
    let address = newFacilitator.id;
    let pk = undefined;

    if (addMode === 'privateKey') {
      if (!newFacilitator.privateKey) {
        toast.error("Please enter a private key");
        return;
      }
      try {
        const account = privateKeyToAccount(newFacilitator.privateKey as `0x${string}`);
        address = account.address;
        pk = newFacilitator.privateKey;
      } catch {
        toast.error("Invalid Private Key format");
        return;
      }
    } else {
        if (!address) {
            toast.error("Please enter an address");
            return;
        }
    }

    if (!newFacilitator.networkId) {
      toast.error("Please select a network");
      return;
    }

    if (facilitators.some(f => f.id === address && f.networkId === newFacilitator.networkId)) {
      toast.error("Facilitator already exists");
      return;
    }

    addFacilitator({
        id: address,
        label: newFacilitator.label,
        networkId: newFacilitator.networkId,
        privateKey: pk
    });
    
    setNewFacilitator({ id: '', label: '', networkId: '', privateKey: '' });
    toast.success('Facilitator added');
  };

  const handleClearData = async () => {
      if (confirm('Are you sure? This will wipe all networks, facilitators, and transaction history.')) {
          await clearAllData();
          toast.success('All data cleared');
          setTimeout(() => window.location.reload(), 500);
      }
  };

  return (
    <div className="space-y-6">
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Networks Section */}
      <Card>
        <CardHeader>
          <CardTitle>Networks</CardTitle>
          <CardDescription>Manage RPC endpoints and chains.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            {networks.map((net) => (
              <div key={net.id} className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                  <div className="font-medium text-sm">{net.name}</div>
                  <div className="text-xs text-muted-foreground">{net.rpcUrl} (ID: {net.id})</div>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => removeNetwork(net.id)}>
                  <HugeiconsIcon icon={Delete02Icon} className="h-4 w-4" strokeWidth={2} />
                </Button>
              </div>
            ))}
          </div>
          <div className="space-y-3 border-t pt-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Name</Label>
                <Input className="h-8" value={newNetwork.name} onChange={e => setNewNetwork({...newNetwork, name: e.target.value})} placeholder="Localhost" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Chain ID</Label>
                <Input className="h-8" value={newNetwork.id} onChange={e => setNewNetwork({...newNetwork, id: e.target.value})} placeholder="31337" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">RPC URL</Label>
              <Input className="h-8" value={newNetwork.rpcUrl} onChange={e => setNewNetwork({...newNetwork, rpcUrl: e.target.value})} placeholder="http://127.0.0.1:8545" />
            </div>
             <div className="space-y-1">
              <Label className="text-xs">Currency Symbol</Label>
              <Input className="h-8" value={newNetwork.currency} onChange={e => setNewNetwork({...newNetwork, currency: e.target.value})} placeholder="ETH" />
            </div>
            <Button onClick={handleAddNetwork} className="w-full gap-2" size="sm">
              <HugeiconsIcon icon={Add01Icon} className="h-3 w-3" strokeWidth={2} /> Add Network
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Facilitators Section */}
      <Card>
        <CardHeader>
          <CardTitle>Facilitators</CardTitle>
          <CardDescription>Addresses to track.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            {facilitators.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No facilitators added.</p>}
            {facilitators.map((fac) => {
              const net = networks.find(n => n.id === fac.networkId);
              return (
                <div key={fac.id + fac.networkId} className="flex items-center justify-between rounded-lg border p-3">
                  <div className="overflow-hidden space-y-0.5">
                    <div className="flex items-center gap-2">
                         <div className="font-medium text-sm truncate">{fac.label || "Unnamed"}</div>
                         {fac.privateKey && <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded border border-primary/20">KEY</span>}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <span className="truncate font-mono">{fac.id}</span>
                        <CopyButton text={fac.id} />
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{net?.name || fac.networkId}</div>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => removeFacilitator(fac.id, fac.networkId)}>
                    <HugeiconsIcon icon={Delete02Icon} className="h-4 w-4" strokeWidth={2} />
                  </Button>
                </div>
              );
            })}
          </div>
          
          <div className="space-y-3 border-t pt-4">
            <Tabs defaultValue="address" onValueChange={(v) => setAddMode(v as 'address' | 'privateKey')} className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="address">Address</TabsTrigger>
                    <TabsTrigger value="privateKey">Private Key</TabsTrigger>
                </TabsList>
                <div className="pt-4 space-y-3">
                    <TabsContent value="address" className="space-y-1 mt-0">
                        <Label className="text-xs">Address</Label>
                        <Input className="h-8 font-mono text-xs" value={newFacilitator.id} onChange={e => setNewFacilitator({...newFacilitator, id: e.target.value})} placeholder="0x..." />
                    </TabsContent>
                    <TabsContent value="privateKey" className="space-y-1 mt-0">
                        <Label className="text-xs">Private Key</Label>
                        <Input type="password" className="h-8 font-mono text-xs" value={newFacilitator.privateKey} onChange={e => setNewFacilitator({...newFacilitator, privateKey: e.target.value})} placeholder="0x..." />
                        <p className="text-[10px] text-muted-foreground">Stored locally in your browser.</p>
                    </TabsContent>
                    
                    <div className="space-y-1">
                        <Label className="text-xs">Label (Optional)</Label>
                        <Input className="h-8" value={newFacilitator.label} onChange={e => setNewFacilitator({...newFacilitator, label: e.target.value})} placeholder="My Facilitator" />
                    </div>
                    <div className="space-y-1">
                        <Label className="text-xs">Network</Label>
                        <Select value={newFacilitator.networkId} onValueChange={val => setNewFacilitator({...newFacilitator, networkId: val})}>
                            <SelectTrigger className="h-8">
                            <SelectValue placeholder="Select network" />
                            </SelectTrigger>
                            <SelectContent>
                            {networks.map(n => (
                                <SelectItem key={n.id} value={n.id}>{n.name}</SelectItem>
                            ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <Button onClick={handleAddFacilitator} className="w-full gap-2" size="sm">
                        <HugeiconsIcon icon={Add01Icon} className="h-3 w-3" strokeWidth={2} /> Add Facilitator
                    </Button>
                </div>
            </Tabs>
          </div>
        </CardContent>
      </Card>
    </div>

    {/* Danger Zone */}
    <Card className="border-destructive/50">
        <CardHeader>
            <CardTitle className="text-destructive flex items-center gap-2">
                <HugeiconsIcon icon={Alert01Icon} className="h-5 w-5" strokeWidth={2} /> Danger Zone
            </CardTitle>
            <CardDescription>Irreversible actions.</CardDescription>
        </CardHeader>
        <CardContent>
            <Button variant="destructive" onClick={handleClearData}>
                Clear All Local Data
            </Button>
        </CardContent>
    </Card>
    </div>
  );
}