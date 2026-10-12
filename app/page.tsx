import { redirect } from "next/navigation";
import { HomeGate } from "@/components/HomeGate";

export default function Home() {
  if (process.env.NEXT_PUBLIC_POST_DEV_AUTH === "1") {
    redirect("/mail/primary");
  }
  return <HomeGate />;
}
