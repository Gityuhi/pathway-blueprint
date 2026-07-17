import { useEffect } from 'react';
import clsx from 'clsx';

interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}

export default function MobileDrawer({
  open,
  onClose,
  children,
  className,
}: MobileDrawerProps) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 md:hidden">
      <button
        type="button"
        className="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
        onClick={onClose}
        aria-label="メニューを閉じる"
      />
      <aside
        className={clsx(
          'absolute top-0 left-0 bottom-0 w-[min(18rem,85vw)] bg-white shadow-2xl flex flex-col animate-slide-in-left safe-top',
          className
        )}
        role="dialog"
        aria-modal="true"
      >
        {children}
      </aside>
    </div>
  );
}
