import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AccessRoute",
  description: "Indoor guidance for blind and low-vision employees, built from a colleague's walkthrough.",
  applicationName: "AccessRoute",
};

export const viewport: Viewport = {
  themeColor: "#0b3d91",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans antialiased">
        <main className="mx-auto flex max-w-xl flex-col gap-5 px-4 py-4">{children}</main>
      </body>
    </html>
  );
}
