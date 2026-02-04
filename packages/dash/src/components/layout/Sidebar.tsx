import { NavLink } from 'react-router-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import { Home01Icon, Settings02Icon, ChartAverageIcon, ArrowDataTransferHorizontalIcon } from '@hugeicons/core-free-icons';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/ThemeToggle';

export function Sidebar() {
  const navItems = [
    { to: '/', icon: Home01Icon, label: 'Overview' },
    { to: '/facilitators', icon: ChartAverageIcon, label: 'Facilitators' },
    { to: '/transactions', icon: ArrowDataTransferHorizontalIcon, label: 'Transactions' },
    { to: '/settings', icon: Settings02Icon, label: 'Settings' },
  ];

  return (
    <div className="flex h-screen w-64 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 items-center border-b px-6 font-semibold">
        Facilitator Dash
      </div>
      <nav className="flex-1 space-y-1 p-2">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                isActive ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground"
              )
            }
          >
            <HugeiconsIcon icon={item.icon} className="h-4 w-4" strokeWidth={2} />
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t p-4">
        <ThemeToggle />
      </div>
    </div>
  );
}