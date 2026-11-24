import React from 'react';
import { Modals } from './components/Modals';
import { AdminPage } from './pages/AdminPage';
import { LandingPage } from './pages/LandingPage';
import { MerchantPage } from './pages/MerchantPage';
import { StorefrontPage } from './pages/StorefrontPage';
import { OptiVerseProvider, useOptiVerse } from './services/optiverseStore';

function RouterView() {
  const { route } = useOptiVerse();
  const path = (route || '/').split('?')[0];

  if (path === '/' || path === '') {
    return <LandingPage />;
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

export default function App() {
  return (
    <OptiVerseProvider>
      <RouterView />
      <Modals />
    </OptiVerseProvider>
  );
}
