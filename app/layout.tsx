import type { Metadata, Viewport } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Тайный Санта",
  description: "Тёплый обмен подарками в Telegram",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Санта" },
};

export const viewport: Viewport = {
  width: "device-width", initialScale: 1, maximumScale: 1,
  themeColor: "#f6f3ed", viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><head><script src="https://telegram.org/js/telegram-web-app.js?65" /></head><body>{children}</body></html>;
}

