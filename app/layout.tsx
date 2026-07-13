import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cohort — enrollment intelligence for clinical trials',
  description:
    'Cohort forecasts enrollment, optimizes the site portfolio, and automates trial operations — with human sign-off and a tamper-evident audit trail.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
