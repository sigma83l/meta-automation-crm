import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@/app/globals.css";
import { I18nProvider } from "@/src/lib/i18n/client";
import { getRequestPreferences } from "@/src/lib/i18n/server";

export const metadata: Metadata = {
  title: "Relay CRM",
  description: "Workspace-safe Instagram and WhatsApp automation control."
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
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(()=>{try{const p=localStorage.getItem('relay_theme')||document.cookie.match(/(?:^|; )relay_theme=([^;]+)/)?.[1]||'system';const d=p==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):p;document.documentElement.dataset.theme=d;document.documentElement.style.colorScheme=d}catch{}})()"
          }}
        />
      </head>
      <body>
        <I18nProvider locale={locale} theme={theme}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
