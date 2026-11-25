import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { BottomNav } from "@/components/Nav";
import { RegisterSW } from "@/components/RegisterSW";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vuelos BCN ⇄ AGP",
  description: "Rastreador de precios de Vueling y Ryanair entre Barcelona y Málaga",
  appleWebApp: { capable: true, title: "Vuelos", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1120" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <RegisterSW />
        <div className="flex flex-1 flex-col pb-20">{children}</div>
        <Suspense fallback={null}>
          <BottomNav />
        </Suspense>
      </body>
    </html>
  );
}
