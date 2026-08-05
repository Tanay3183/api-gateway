import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error: any) => {
        // Retry up to 5 times if it's a 429 error
        if (error?.response?.status === 429 && failureCount < 5) return true;
        return false;
      },
      retryDelay: (attemptIndex, error: any) => {
        if (error?.response?.status === 429) {
          const retryAfter = error.response.headers['retry-after'];
          return retryAfter ? parseInt(retryAfter, 10) * 1000 : 1000;
        }
        return Math.min(1000 * 2 ** attemptIndex, 30000);
      }
    },
    mutations: {
      retry: (failureCount, error: any) => {
        if (error?.response?.status === 429 && failureCount < 5) return true;
        return false;
      },
      retryDelay: (attemptIndex, error: any) => {
        if (error?.response?.status === 429) {
          const retryAfter = error.response.headers['retry-after'];
          return retryAfter ? parseInt(retryAfter, 10) * 1000 : 1000;
        }
        return 1000;
      }
    }
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
