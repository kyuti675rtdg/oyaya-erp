import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { useNetwork } from './store/network';
import { refreshQueuedCount, syncOutbox } from './lib/sync';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false
    }
  }
});

// PWA: auto-update the service worker when a new build is deployed.
registerSW({ immediate: true });

function initNetworkSync(): void {
  const apply = async (): Promise<void> => {
    useNetwork.getState().setOnline(navigator.onLine);
    if (navigator.onLine) {
      await syncOutbox();
    } else {
      await refreshQueuedCount();
    }
  };

  window.addEventListener('online', () => void apply());
  window.addEventListener('offline', () => void apply());
  // Retry any leftover outbox entries every minute while online.
  window.setInterval(() => {
    if (navigator.onLine) void syncOutbox();
  }, 60_000);

  void apply();
}

initNetworkSync();

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
