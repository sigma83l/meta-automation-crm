import type { Metadata, Viewport } from "next";
import { Geist, Vazirmatn } from "next/font/google";
import type { ReactNode } from "react";
import { ThemeScript } from "@/app/theme-script";
import "@/app/globals.css";
import { I18nProvider } from "@/src/lib/i18n/client";
import { getRequestPreferences } from "@/src/lib/i18n/server";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap"
});

const vazirmatn = Vazirmatn({
  subsets: ["arabic"],
  variable: "--font-vazirmatn",
  display: "swap"
});

export const metadata: Metadata = {
  title: {
    default: "Rellooma",
    template: "%s · Rellooma"
  },
  description: "Calm, workspace-safe Instagram and WhatsApp automation with human control.",
  icons: {
    icon: "/brand/rellooma-app-icon.png",
    apple: "/brand/rellooma-app-icon.png"
  },
  robots: {
    index: false,
    follow: false
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const { locale, theme, direction } = await getRequestPreferences();
  return (
    <html
      lang={locale}
      dir={direction}
      data-theme={theme === "dark" ? "dark" : "light"}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <head>
        <ThemeScript />
      </head>
      <body className={`${geist.variable} ${vazirmatn.variable}`}>
        <I18nProvider locale={locale} theme={theme}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
