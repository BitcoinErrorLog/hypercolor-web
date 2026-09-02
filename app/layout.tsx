import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { BackupLeaveGuard } from "@/components/backup-leave-guard";
import { PwaRegister } from "@/components/pwa-register";
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
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: APP_NAME,
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <SessionBootstrap />
        <BackupLeaveGuard />
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <SessionBanner />
        <TabLockBanner />
        <PwaRegister />
        <header className="border-b border-border">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-6 py-4">
            <p className="text-sm font-medium tracking-wide text-muted-foreground">
              {APP_NAME}
            </p>
            <SiteNav />
          </div>
        </header>
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-5xl flex-1 px-6 py-8 pb-24 md:pb-8"
        >
          {children}
        </main>
      </body>
    </html>
  );
}
