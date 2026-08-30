import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { SessionBanner } from "@/components/session-banner";
import { SessionBootstrap } from "@/components/session-bootstrap";
import { SiteNav } from "@/components/site-nav";
import { TabLockBanner } from "@/components/tab-lock-banner";
import { APP_NAME } from "@/lib/app-meta";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: APP_NAME,
  description:
    "Web client for Hypercolor Encrypted Links. Same protocol as the mobile app; homeserver is the backend.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <SessionBootstrap />
        <TabLockBanner />
        <SessionBanner />
        <header className="border-b border-border">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-6 py-4">
            <p className="text-sm font-medium tracking-wide text-muted-foreground">
              {APP_NAME}
            </p>
            <SiteNav />
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
