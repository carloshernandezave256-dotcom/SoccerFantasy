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
import "./auction.css";
import "./polish.css";
import { LegalDisclosureGate } from "@/components/legal-disclosure-gate";
import { BetaAccessGate } from "@/components/beta-access-gate";
import { SessionGuard } from "@/components/session-guard";
import { LanguageProvider } from "@/lib/i18n";
import { LeagueChat } from "@/components/league-chat";

export const metadata: Metadata = {
  title: "My Fantasy XI | Build Your Football World",
  description: "Draft, auction or collect your squad and compete head to head every gameweek.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#08110d",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <LanguageProvider>
          <SessionGuard>{children}</SessionGuard>
          <LeagueChat />
          <LegalDisclosureGate />
          <BetaAccessGate />
        </LanguageProvider>
      </body>
    </html>
  );
}
