/**
 * Resilient Architecture Admin Dashboard
 * 
 * A real-time monitoring interface built with React and Tailwind CSS.
 * Connects to the API Gateway via WebSockets to visualize cluster topology,
 * in-flight requests, load balancing distributions, and circuit breaker states.
 */
import React, { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { Activity, Server, Zap, AlertTriangle, ShieldCheck } from 'lucide-react';

interface BackendMetric {
  url: string;
  latency: number;
  requests: number;
  totalRequests: number;
  status: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failures: number;
}

const socket = io('http://localhost:3000');

export default function App() {
  const [metrics, setMetrics] = useState<BackendMetric[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('metrics', (data) => setMetrics(data));
    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('metrics');
    };
  }, []);

  return (
    <div className="min-h-screen bg-background p-8 text-white selection:bg-primary/30 font-sans">
      <div className="max-w-6xl mx-auto space-y-8">

        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-blue-400 to-primary bg-clip-text text-transparent">
              API Gateway
            </h1>
            <p className="text-gray-400 mt-2 text-sm font-medium">Real-time Cluster Observability</p>
          </div>
          <div className="flex items-center gap-3 glass-panel px-4 py-2">
            <div className={`w-3 h-3 rounded-full animate-pulse ${connected ? 'bg-success shadow-[0_0_10px_#10b981]' : 'bg-danger shadow-[0_0_10px_#ef4444]'}`} />
            <span className="text-sm font-medium text-gray-300">{connected ? 'Live Sync' : 'Disconnected'}</span>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {metrics.map((backend) => (
            <div key={backend.url} className="glass-panel p-6 relative overflow-hidden group transition-all hover:-translate-y-1 hover:shadow-2xl hover:shadow-primary/10 hover:border-primary/30">

              {/* Status Indicator Glow */}
              <div className={`absolute -top-12 -right-12 w-40 h-40 rounded-full blur-[50px] opacity-20 transition-colors duration-1000 ${backend.status === 'CLOSED' ? 'bg-success' :
                  backend.status === 'HALF_OPEN' ? 'bg-warning' : 'bg-danger'
                }`} />

              <div className="flex items-start justify-between mb-8">
                <div>
                  <h3 className="text-xl font-bold flex items-center gap-2 text-gray-100">
                    <Server className="w-5 h-5 text-gray-400" />
                    {backend.url.replace('http://localhost:', 'Node ')}
                  </h3>
                  <p className="text-xs text-gray-500 font-mono mt-1.5">{backend.url}</p>
                </div>

                <div className={`px-3 py-1.5 rounded-full text-xs font-bold border flex items-center gap-1.5 ${backend.status === 'CLOSED' ? 'bg-success/10 text-success border-success/20 shadow-[0_0_15px_rgba(16,185,129,0.1)]' :
                    backend.status === 'HALF_OPEN' ? 'bg-warning/10 text-warning border-warning/20 shadow-[0_0_15px_rgba(245,158,11,0.1)]' :
                      'bg-danger/10 text-danger border-danger/20 shadow-[0_0_15px_rgba(239,68,68,0.1)]'
                  }`}>
                  {backend.status === 'CLOSED' && <ShieldCheck className="w-4 h-4" />}
                  {backend.status === 'HALF_OPEN' && <Activity className="w-4 h-4 animate-spin-slow" />}
                  {backend.status === 'OPEN' && <AlertTriangle className="w-4 h-4 animate-pulse" />}
                  {backend.status === 'CLOSED' ? 'HEALTHY' : backend.status}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-surface/50 rounded-xl p-4 border border-white/5 backdrop-blur-sm">
                  <div className="text-gray-400 text-xs font-medium mb-1.5 flex items-center gap-1.5 uppercase tracking-wider">
                    <Zap className="w-3.5 h-3.5 text-blue-400" /> Latency
                  </div>
                  <div className="text-3xl font-mono font-light tracking-tight text-white">
                    {backend.latency.toFixed(1)}<span className="text-sm font-medium text-gray-500 ml-1">ms</span>
                  </div>
                </div>

                <div className="bg-surface/50 rounded-xl p-4 border border-white/5 backdrop-blur-sm">
                  <div className="text-gray-400 text-xs font-medium mb-1.5 flex items-center gap-1.5 uppercase tracking-wider">
                    <Activity className="w-3.5 h-3.5 text-blue-400" /> In-Flight
                  </div>
                  <div className="text-3xl font-mono font-light tracking-tight text-white">
                    {backend.requests}
                  </div>
                </div>

                <div className="col-span-2 bg-surface/50 rounded-xl px-5 py-4 border border-white/5 flex items-center justify-between backdrop-blur-sm">
                  <div className="text-gray-400 text-xs font-medium uppercase tracking-wider">Total Served</div>
                  <div className="text-xl font-mono text-gray-200">
                    {backend.totalRequests.toLocaleString()}
                  </div>
                </div>
              </div>

              {backend.failures > 0 && (
                <div className="mt-4 text-xs font-medium text-danger flex items-center gap-2 bg-danger/10 px-4 py-3 rounded-xl border border-danger/20">
                  <AlertTriangle className="w-4 h-4" />
                  {backend.failures} consecutive failures detected
                </div>
              )}
            </div>
          ))}
        </div>

        {metrics.length === 0 && (
          <div className="glass-panel p-16 text-center text-gray-400 flex flex-col items-center justify-center border-dashed">
            <div className="relative">
              <Server className="w-16 h-16 mb-6 opacity-20" />
              <Activity className="w-8 h-8 absolute bottom-4 -right-2 text-primary animate-pulse" />
            </div>
            <h2 className="text-xl font-semibold text-gray-300">Waiting for Telemetry</h2>
            <p className="mt-2 text-sm max-w-md mx-auto">Ensure the API Gateway is running and the WebSocket server is broadcasting metrics on port 3000.</p>
          </div>
        )}
      </div>
    </div>
  );
}
