import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";
import { RealtimeRefresher } from "@/components/ui/RealtimeRefresher";

export const metadata: Metadata = {
  title: "Elec Nova Tech AI",
  description: "Agentic AI electrical design command center"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="studio-backdrop fixed inset-0 -z-20" />
        <div className="grid-overlay fixed inset-0 -z-10 opacity-80" />
        <div className="relative z-10 flex min-h-screen">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <Header />
            <RealtimeRefresher />
            <main className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-5 sm:px-6 lg:px-8">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
