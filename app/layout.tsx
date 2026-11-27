import type { Metadata, Viewport } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Тайный Санта",
  description: "Тёплый обмен подарками в Telegram",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Санта" },
};

export const viewport: Viewport = {
  width: "device-width", initialScale: 1, maximumScale: 1,
  themeColor: "#0F3D2E", viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><head><link rel="preload" href="/assets/illustrations/santa-shh.webp" as="image" /><link rel="preload" href="/assets/illustrations/home-tree.webp" as="image" /><link rel="preload" href="/fonts/20295.ttf" as="font" type="font/ttf" crossOrigin="anonymous" /><script src="https://telegram.org/js/telegram-web-app.js?65" /></head><body>{children}</body></html>;
}

