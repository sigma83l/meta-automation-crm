"use client";

import Script from "next/script";

export function ThemeScript() {
  return (
    <Script
      strategy="beforeInteractive"
      dangerouslySetInnerHTML={{
        __html:
          "(()=>{try{const p=localStorage.getItem('relay_theme')||document.cookie.match(/(?:^|; )relay_theme=([^;]+)/)?.[1]||'system';const d=p==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):p;document.documentElement.dataset.theme=d;document.documentElement.style.colorScheme=d}catch{}})()"
      }}
    />
  );
}