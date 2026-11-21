import { Tooltip } from '@base-ui/react/tooltip';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SWRConfig } from 'swr';
import { swrFetcher } from './api/client';
import { App } from './App';
import './styles/app.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root mount element #root not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <SWRConfig
      value={{
        fetcher: swrFetcher,
        dedupingInterval: 2_000,
        shouldRetryOnError: false,
      }}
    >
      <Tooltip.Provider delay={250}>
        <App />
      </Tooltip.Provider>
    </SWRConfig>
  </StrictMode>,
);
