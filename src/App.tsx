import React from 'react';
import { Modals } from './components/Modals';
import { OfflineIndicator } from './components/PWAInstallPrompt';
import { AdminPage } from './pages/AdminPage';
import { DirectoryPage } from './pages/DirectoryPage';
import { LandingPage } from './pages/LandingPage';
import { MerchantPage } from './pages/MerchantPage';
import { StorefrontPage } from './pages/StorefrontPage';
import { OptiVerseProvider, useOptiVerse } from './services/optiverseStore';

function AdminFloatingReturnBar() {
  const { session, route, navigate } = useOptiVerse();
  const path = (route || '/').split('?')[0];
  const [collapsed, setCollapsed] = React.useState(true);
  const [offset, setOffset] = React.useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragRef = React.useRef<{
    active: boolean;
    moved: boolean;
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
  }>({ active: false, moved: false, startX: 0, startY: 0, baseX: 0, baseY: 0 });

  if (!session || (session.role !== 'super_admin' && session.role !== 'admin')) return null;
  if (path.startsWith('/admin')) return null;

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button[data-no-drag="true"]')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      active: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      baseX: offset.x,
      baseY: offset.y,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      dragRef.current.moved = true;
    }
    setOffset({
      x: dragRef.current.baseX + dx,
      y: dragRef.current.baseY + dy,
    });
  };

  const handlePointerUp = () => {
    dragRef.current.active = false;
  };

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0)` }}
      className={`fixed top-3 left-3 z-[80] touch-none select-none flex items-center rounded-full bg-slate-900/92 text-amber-300 border border-amber-400/40 shadow-2xl backdrop-blur-md transition-all ${
        collapsed ? 'w-11 h-11 justify-center p-0' : 'gap-1 p-1'
      }`}
    >
      {collapsed ? (
        <button
          type="button"
          onClick={() => {
            if (!dragRef.current.moved) setCollapsed(false);
          }}
          aria-label="إظهار زر العودة للإدارة العليا"
          title="العودة للإدارة العليا"
          className="w-11 h-11 rounded-full hover:bg-slate-800 text-sm font-extrabold cursor-pointer flex items-center justify-center"
        >
          <span>↩</span>
        </button>
      ) : (
        <>
          <button
            type="button"
            onClick={() => {
              if (!dragRef.current.moved) navigate('/admin');
            }}
            className="px-2.5 py-1 rounded-full hover:bg-slate-800 text-xs font-extrabold cursor-pointer flex items-center gap-1.5"
          >
            <span>العودة للإدارة العليا ↩</span>
          </button>
          <button
            type="button"
            data-no-drag="true"
            onClick={() => setCollapsed(true)}
            aria-label="طي شريط الإدارة"
            title="طي"
            className="w-6 h-6 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 text-[0.7rem] font-bold flex items-center justify-center cursor-pointer"
          >
            −
          </button>
        </>
      )}
    </div>
  );
}

function RouterView() {
  const { route } = useOptiVerse();
  const [rawPath, rawSearch] = (route || '/').split('?');
  const path = rawPath || '/';
  const searchParams = new URLSearchParams(
    rawSearch !== undefined ? rawSearch : typeof window !== 'undefined' ? window.location.search.slice(1) : ''
  );
  const shopQuerySlug = searchParams.get('shop')?.trim();
  const frameQueryId = searchParams.get('f')?.trim() || searchParams.get('frame')?.trim() || undefined;

  if ((path === '/' || path === '') && shopQuerySlug) {
    return <StorefrontPage slug={shopQuerySlug} initialFrameId={frameQueryId} />;
  }

  if (path === '/' || path === '') {
    return <LandingPage />;
  }
  if (path === '/stores' || path.startsWith('/stores/') || path === '/directory') {
    return <DirectoryPage />;
  }
  if (path === '/admin' || path.startsWith('/admin/')) {
    return <AdminPage />;
  }
  if (path === '/merchant' || path.startsWith('/merchant/')) {
    return <MerchantPage />;
  }

  // Support clean SaaS routes: /s/[slug] and /s/[slug]/f/[frameId]
  if (path.startsWith('/s/')) {
    const parts = path.slice(3).replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
    const slug = parts[0] || '';
    const initialFrameId = parts[1] === 'f' && parts[2] ? decodeURIComponent(parts[2]) : undefined;
    return <StorefrontPage slug={slug} initialFrameId={initialFrameId} />;
  }

  if (path.startsWith('/shop/')) {
    const parts = path.slice(6).replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
    const slug = parts[0] || '';
    const initialFrameId = parts[1] === 'f' && parts[2] ? decodeURIComponent(parts[2]) : undefined;
    return <StorefrontPage slug={slug} initialFrameId={initialFrameId} />;
  }

  const slug = path.replace(/^\/+|\/+$/g, '').split('/')[0];
  return <StorefrontPage slug={slug} />;
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('OptiVerse ErrorBoundary caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[100dvh] flex items-center justify-center p-6 bg-slate-950 text-white" dir="rtl">
          <div className="max-w-md w-full bg-slate-900 border border-red-500/40 p-6 rounded-2xl shadow-2xl text-center space-y-4">
            <div className="text-4xl">⚠️</div>
            <h2 className="text-lg font-extrabold text-red-400">عذراً، حدث خطأ غير متوقع في التطبيق</h2>
            <p className="text-xs text-slate-300 opacity-90 break-words font-mono bg-slate-950/80 p-3 rounded-xl border border-slate-800 text-left">
              {((this.state.error as unknown) as Error)?.message || String(this.state.error)}
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="w-full py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-sm transition-all cursor-pointer"
            >
              إعادة تحميل التطبيق ⟳
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  React.useEffect(() => {
    const handler = (event: PromiseRejectionEvent) => {
      console.error('Unhandled promise rejection:', event.reason);
    };
    window.addEventListener('unhandledrejection', handler);
    return () => window.removeEventListener('unhandledrejection', handler);
  }, []);

  return (
    <ErrorBoundary>
      <OptiVerseProvider>
        <AdminFloatingReturnBar />
        <RouterView />
        <OfflineIndicator />
        <Modals />
      </OptiVerseProvider>
    </ErrorBoundary>
  );
}
