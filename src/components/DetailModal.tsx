import React, { useEffect } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  header: React.ReactNode;
  children: React.ReactNode;
  maxWidth?: number;
}

/**
 * 共用彈窗外框：點背景或按 Esc 關閉，開啟時鎖定頁面捲動
 */
export const DetailModal: React.FC<Props> = ({ open, onClose, header, children, maxWidth = 600 }) => {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/45 p-3 animate-in fade-in duration-200"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white rounded-2xl p-4 sm:p-6 w-full max-h-[88vh] flex flex-col relative shadow-2xl"
        style={{ maxWidth }}
        onClick={e => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="關閉"
          className="absolute top-3.5 right-3.5 w-8 h-8 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 flex items-center justify-center text-lg cursor-pointer"
        >
          ✕
        </button>
        <div className="pr-8 mb-3 shrink-0">{header}</div>
        <div className="flex-1 min-h-0 overflow-y-auto pr-1">{children}</div>
      </div>
    </div>
  );
};

