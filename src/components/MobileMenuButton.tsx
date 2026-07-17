import { Menu } from 'lucide-react';
import clsx from 'clsx';

interface MobileMenuButtonProps {
  onClick: () => void;
  className?: string;
  label?: string;
}

export default function MobileMenuButton({
  onClick,
  className,
  label = 'メニューを開く',
}: MobileMenuButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'p-2 -ml-1 rounded-lg text-gray-600 hover:bg-gray-100 active:bg-gray-200 transition-colors flex-shrink-0',
        className
      )}
      aria-label={label}
    >
      <Menu size={22} />
    </button>
  );
}
