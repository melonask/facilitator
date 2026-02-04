import { useStore } from '@/store/useStore';
import { Button } from '@/components/ui/button';
import { HugeiconsIcon } from '@hugeicons/react';
import { Moon02Icon, Sun03Icon, ComputerIcon } from '@hugeicons/core-free-icons';

export function ThemeToggle() {
  const { theme, setTheme } = useStore();

  const toggleTheme = () => {
    if (theme === 'system') setTheme('light');
    else if (theme === 'light') setTheme('dark');
    else setTheme('system');
  };

  const getIcon = () => {
      switch (theme) {
          case 'dark': return Moon02Icon;
          case 'light': return Sun03Icon;
          default: return ComputerIcon;
      }
  }

  return (
    <Button variant="ghost" size="sm" onClick={toggleTheme} className="w-full justify-start gap-2 px-2">
      <HugeiconsIcon icon={getIcon()} className="h-4 w-4" strokeWidth={2} />
      <span className="capitalize">{theme} Mode</span>
    </Button>
  );
}
