import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { I } from './Icons';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const ua = window.navigator.userAgent.toLowerCase();
    const iosDevice = /iphone|ipad|ipod/.test(ua);
    setIsIOS(iosDevice);

    const checkInstalled = () => {
      const standaloneMatch = window.matchMedia?.('(display-mode: standalone)').matches;
      const iosStandalone = Boolean((window.navigator as unknown as { standalone?: boolean }).standalone);
      setIsInstalled(Boolean(standaloneMatch || iosStandalone));
    };
    checkInstalled();

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setIsInstallable(true);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setIsInstallable(false);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const promptInstall = async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    if (!deferredPrompt) return 'unavailable';
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      setIsInstalled(true);
      setIsInstallable(false);
    }
    setDeferredPrompt(null);
    return choice.outcome;
  };

  return {
    isInstallable,
    isInstalled,
    isIOS,
    promptInstall,
  };
}

export function PWAInstallButton({
  className = '',
  label = 'تثبيت كتطبيق 📲',
}: {
  className?: string;
  label?: string;
}) {
  const { isInstallable, isInstalled, isIOS, promptInstall } = usePWAInstall();
  const [showGuideModal, setShowGuideModal] = useState(false);

  if (isInstalled) return null;

  const handleClick = async () => {
    if (isInstallable) {
      const outcome = await promptInstall();
      if (outcome !== 'unavailable') return;
    }
    setShowGuideModal(true);
  };

  const guideModal = showGuideModal ? (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm fade overflow-y-auto"
      style={{ position: 'fixed', inset: 0, zIndex: 9999 }}
      onClick={() => setShowGuideModal(false)}
    >
      <div
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-3xl p-6 max-w-md w-full space-y-4 shadow-2xl border border-slate-200 text-slate-900 my-auto"
        style={{ backgroundColor: '#FFFFFF' }}
      >
        <div className="flex items-center justify-between">
          <div className="font-extrabold text-base flex items-center gap-2">
            <span>📲 تثبيت لوحة التاجر كتطبيق</span>
          </div>
          <button
            type="button"
            onClick={() => setShowGuideModal(false)}
            className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold flex items-center justify-center cursor-pointer"
          >
            ✕
          </button>
        </div>

        {isIOS ? (
          <div className="rounded-2xl bg-sky-50 border border-sky-200 p-4 text-xs sm:text-sm text-slate-700 space-y-2 leading-6">
            <p className="font-bold text-[#0284C7]">خطوات التثبيت على iPhone / iPad:</p>
            <ol className="list-decimal list-inside space-y-1.5">
              <li>افتح الصفحة في متصفح <b>Safari</b>.</li>
              <li>اضغط على أيقونة المشاركة <b>(Share ⎙)</b> أسفل الشاشة.</li>
              <li>اختر <b>«إضافة إلى الشاشة الرئيسية» (Add to Home Screen)</b> ثم اضغط إضافة.</li>
            </ol>
          </div>
        ) : (
          <div className="rounded-2xl bg-sky-50 border border-sky-200 p-4 text-xs sm:text-sm text-slate-700 space-y-2 leading-6">
            <p className="font-bold text-[#0284C7]">خطوات التثبيت على الموبايل أو الكمبيوتر:</p>
            <ol className="list-decimal list-inside space-y-1.5">
              <li>افتح قائمة المتصفح (النقاط الثلاث ⋮) أو أيقونة التثبيت في شريط العنوان.</li>
              <li>اختر <b>«تثبيت التطبيق» (Install App / Add to Home Screen)</b>.</li>
              <li>سيعمل تطبيق التاجر في نافذة مستقلة بوصول فوري وسريع للمخزون والطلبات.</li>
            </ol>
          </div>
        )}

        <button
          type="button"
          onClick={() => setShowGuideModal(false)}
          className="w-full py-2.5 rounded-xl bg-[#0F172A] hover:bg-slate-800 text-white font-extrabold text-xs cursor-pointer"
        >
          حسناً ✓
        </button>
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        type="button"
        onClick={() => void handleClick()}
        className={
          className ||
          'btn btn-sm whitespace-nowrap shrink-0 font-extrabold bg-[#0F172A] hover:bg-slate-800 text-amber-300 border border-amber-400/30 shadow-sm'
        }
      >
        <I n="dl" s={14} />
        <span>{label}</span>
      </button>

      {guideModal && (typeof document !== 'undefined' ? ReactDOM.createPortal(guideModal, document.body) : guideModal)}
    </>
  );
}

export function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div
      dir="rtl"
      className="fixed bottom-16 inset-x-4 z-[95] flex justify-center pointer-events-none"
    >
      <div className="px-4 py-2 rounded-2xl bg-amber-50 border border-amber-300 text-amber-900 text-xs font-extrabold shadow-lg pointer-events-auto">
        ⚠️ أنت غير متصل بالإنترنت — يتم عرض البيانات المحفوظة محلياً
      </div>
    </div>
  );
}
