import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./player-headshot.css";
import "./account.css";
import "./milestone.css";
import "./draft.css";
import "./lineup.css";
import "./invites.css";
import "./practice.css";
import "./gameweek.css";
import "./trades.css";
import "./quick-links.css";
import "./team-demo.css";
import "./home.css";
import "./waivers.css";
import "./packs.css";

export const metadata: Metadata = {
  title: "XI | Cross-League Fantasy",
  description: "Draft across Europe's top five leagues.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#08120d",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
