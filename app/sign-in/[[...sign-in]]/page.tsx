import { redirect } from "next/navigation";
import { ClerkSignIn } from "@/components/ClerkSignIn";

export default function SignInPage() {
  if (process.env.NEXT_PUBLIC_KITE_DEV_AUTH === "1") {
    redirect("/mail/primary");
  }
  return <ClerkSignIn />;
}
