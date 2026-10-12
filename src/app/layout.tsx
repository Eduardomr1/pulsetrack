import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PulseTrack | Real-time API Observability & Health Monitor',
  description: 'Enterprise API uptime, latency breakdown and health monitoring platform.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className="dark">
      <body className="bg-[#070a12] text-slate-100 antialiased selection:bg-cyan-500 selection:text-white">
        {children}
      </body>
    </html>
  );
}
