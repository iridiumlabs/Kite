"use client";

import { SignIn } from "@clerk/nextjs";

const appearance = {
  elements: {
    card: "shadow-none bg-transparent",
    rootBox: "w-full",
    formButtonPrimary:
      "bg-[#007AFF] hover:bg-[#0062CC] text-[13px] font-semibold rounded-lg h-9",
    formFieldInput:
      "rounded-lg h-9 text-[13px] border-[#0000001F] focus:border-[#007AFF] focus:ring-[#007AFF33]",
    headerTitle: "text-[#1D1D1F] font-semibold",
    headerSubtitle: "text-[#6E6E73]",
    footerActionLink: "text-[#007AFF]",
    socialButtonsBlockButton:
      "rounded-lg border-[#0000001F] text-[13px] font-medium",
    dividerLine: "bg-[#0000000F]",
    dividerText: "text-[#8A8A8E] text-xs",
  },
  layout: { socialButtonsPlacement: "bottom" as const },
};

export function ClerkSignIn() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-app gap-8">
      <div className="font-semibold text-primary text-2xl tracking-[-0.02em]">
        Post
      </div>
      <SignIn appearance={appearance} routing="path" path="/sign-in" />
    </main>
  );
}
