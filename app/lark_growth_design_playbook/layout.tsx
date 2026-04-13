import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Lark Growth Design Playbook",
  description: "Discover insights, experiments, and best practices for driving growth through design.",
};

export default function PlaybookLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
