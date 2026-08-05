import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import axios, { AxiosError } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { ShoppingCart, RefreshCw, Zap, ShieldAlert, CheckCircle2, Clock, Activity } from 'lucide-react';
import clsx from 'clsx';

const apiClient = axios.create({
  baseURL: 'http://localhost:3000',
});

export default function App() {
  const [logs, setLogs] = useState<string[]>([]);
  const [idempotencyKey, setIdempotencyKey] = useState(uuidv4());

  const addLog = (msg: string) => setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 10));

  // GET Query
  const { data, refetch, isFetching, failureCount } = useQuery({
    queryKey: ['data'],
    queryFn: async () => {
      addLog('Fetching data from gateway...');
      const res = await apiClient.get('/data');
      addLog(`Success! Routed to ${res.data.instance}`);
      return res.data;
    },
    enabled: false, // Don't fetch automatically on mount
  });

  // POST Mutation
  const checkoutMutation = useMutation({
    mutationFn: async (key: string) => {
      addLog(`Sending POST with Idempotency-Key: ${key.split('-')[0]}...`);
      const res = await apiClient.post('/data', { item: 'Premium Subscription' }, {
        headers: { 'x-idempotency-key': key }
      });
      return res;
    },
    onSuccess: (res) => {
      if (res.status === 201) {
        addLog(`Checkout Successful! (HTTP 201)`);
      } else if (res.status === 200) {
        addLog(`Ignored duplicate! (HTTP 200 from backend)`);
      }
    },
    onError: (err: any) => {
      if (err.response?.status === 409) {
        addLog(`Intercepted by Gateway! (HTTP 409 Conflict)`);
      } else {
        addLog(`Error: ${err.message}`);
      }
    }
  });

  const blastRequests = () => {
    addLog('Blasting 15 rapid requests to trigger Rate Limiter...');
    for(let i=0; i<15; i++) {
      apiClient.get('/data').catch(() => {});
    }
    // Refetch the main query slightly after to show TanStack catching the 429 and waiting
    setTimeout(() => refetch(), 100);
  };

  return (
    <div className="min-h-screen bg-surface p-8 text-gray-900 font-sans selection:bg-primary/30">
      <div className="max-w-4xl mx-auto space-y-8">
        
        <header className="mb-10 text-center md:text-left">
          <h1 className="text-4xl font-extrabold text-gray-900 flex items-center justify-center md:justify-start gap-3">
            <Zap className="text-primary w-10 h-10" /> Client Application
          </h1>
          <p className="text-gray-500 mt-2 font-medium">Smart Client Integration with TanStack Query & Axios</p>
        </header>

        <div className="grid md:grid-cols-2 gap-8">
          
          {/* Rate Limiting Demo */}
          <div className="bg-white rounded-3xl p-8 shadow-xl border border-gray-100 transition-all hover:shadow-2xl hover:border-gray-200">
            <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
              <Clock className="text-warning w-7 h-7" /> Rate Limit Handler
            </h2>
            <p className="text-sm text-gray-600 mb-8 leading-relaxed">
              Blast requests to trigger the 429 Error. TanStack Query will automatically parse the <code className="bg-gray-100 text-primary px-1.5 py-0.5 rounded">Retry-After</code> header and wait exactly that long before gracefully retrying!
            </p>

            <div className="space-y-4">
              <button 
                onClick={blastRequests}
                disabled={isFetching}
                className="w-full bg-gradient-to-r from-warning to-orange-400 text-white font-bold py-3.5 px-4 rounded-2xl hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-2 shadow-lg shadow-warning/20"
              >
                <Zap className="w-5 h-5" /> Spam Requests (Trigger 429)
              </button>

              <button 
                onClick={() => refetch()}
                disabled={isFetching}
                className="w-full bg-gray-100 text-gray-700 font-bold py-3.5 px-4 rounded-2xl hover:bg-gray-200 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
              >
                <RefreshCw className={clsx("w-5 h-5", isFetching && "animate-spin text-primary")} /> 
                {isFetching ? 'Fetching / Waiting...' : 'Normal Fetch'}
              </button>
            </div>

            {isFetching && failureCount > 0 && (
              <div className="mt-6 p-4 bg-warning/10 text-orange-700 rounded-2xl border border-warning/20 flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
                <ShieldAlert className="w-5 h-5 mt-0.5 shrink-0 animate-pulse" />
                <span className="text-sm font-medium leading-snug">Rate Limited! TanStack Query paused execution and is waiting for Retry-After... (Attempt {failureCount}/5)</span>
              </div>
            )}
            
            {data && !isFetching && failureCount === 0 && (
              <div className="mt-6 p-4 bg-success/10 text-emerald-700 rounded-2xl border border-success/20 flex flex-col animate-in fade-in slide-in-from-bottom-2">
                <span className="text-xs font-bold text-success uppercase tracking-wider flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4"/> Data Received</span>
                <span className="font-mono mt-2 text-sm text-gray-800 bg-white/50 p-2 rounded-xl">{JSON.stringify(data)}</span>
              </div>
            )}
          </div>

          {/* Idempotency Demo */}
          <div className="bg-white rounded-3xl p-8 shadow-xl border border-gray-100 transition-all hover:shadow-2xl hover:border-gray-200">
            <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
              <ShieldAlert className="text-danger w-7 h-7" /> Idempotent POST
            </h2>
            <p className="text-sm text-gray-600 mb-8 leading-relaxed">
              Simulate an impatient user double-clicking a "Checkout" button. The Gateway will intercept duplicate POST requests via Redis automatically.
            </p>

            <div className="mb-8">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 block">Idempotency Key</label>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  readOnly 
                  value={idempotencyKey.split('-')[0]} 
                  className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono text-gray-600 focus:outline-none"
                />
                <button 
                  onClick={() => setIdempotencyKey(uuidv4())}
                  className="px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-sm font-bold transition-colors border border-gray-200"
                >
                  Regenerate
                </button>
              </div>
            </div>

            <button 
              onClick={() => checkoutMutation.mutate(idempotencyKey)}
              disabled={checkoutMutation.isPending}
              className="w-full bg-gradient-to-r from-danger to-rose-500 text-white font-bold py-3.5 px-4 rounded-2xl hover:opacity-90 transition-all flex items-center justify-center gap-2 shadow-lg shadow-danger/20 active:scale-[0.98]"
            >
              <ShoppingCart className="w-5 h-5" /> 
              Submit Payment
            </button>
          </div>
        </div>

        {/* Real-time Logs */}
        <div className="bg-gray-900 rounded-3xl p-6 shadow-2xl overflow-hidden mt-8 border border-gray-800">
          <h3 className="text-white font-bold flex items-center gap-2 mb-6">
            <Activity className="w-5 h-5 text-primary" /> Live Network Trace
          </h3>
          <div className="space-y-2.5 font-mono text-[13px]">
            {logs.map((log, i) => (
              <div key={i} className={clsx(
                "p-3 rounded-xl border-l-4 transition-all duration-300",
                log.includes('429') || log.includes('409') ? 'bg-danger/10 text-rose-200 border-danger' : 
                log.includes('Success') || log.includes('201') || log.includes('Ignored') ? 'bg-success/10 text-emerald-200 border-success' : 
                'bg-white/5 text-gray-300 border-gray-500'
              )}>
                {log}
              </div>
            ))}
            {logs.length === 0 && <div className="text-gray-500 italic p-4 text-center">Awaiting network activity...</div>}
          </div>
        </div>

      </div>
    </div>
  );
}
