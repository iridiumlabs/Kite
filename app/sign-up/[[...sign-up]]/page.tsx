import { redirect } from "next/navigation";
import { ClerkSignUp } from "@/components/ClerkSignUp";

export default function SignUpPage() {
  if (process.env.NEXT_PUBLIC_KITE_DEV_AUTH === "1") {
    redirect("/mail/primary");
  }
  return <ClerkSignUp />;
}
