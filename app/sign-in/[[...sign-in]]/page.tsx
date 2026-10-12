import { redirect } from "next/navigation";
import { ClerkSignIn } from "@/components/ClerkSignIn";

export default function SignInPage() {
  if (process.env.NEXT_PUBLIC_POST_DEV_AUTH === "1") {
    redirect("/mail/primary");
  }
  return <ClerkSignIn />;
}
