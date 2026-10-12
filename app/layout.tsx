import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Providers } from "@/components/providers";
import { AppToaster } from "@/components/AppToaster";
import { MotionPreferences } from "@/components/ui/MotionPreferences";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Kite",
  applicationName: "Kite",
  description: "Kite — a personal email client",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <MotionPreferences>
            <Providers>{children}</Providers>
            <AppToaster />
          </MotionPreferences>
        </ThemeProvider>
      </body>
    </html>
  );
}
