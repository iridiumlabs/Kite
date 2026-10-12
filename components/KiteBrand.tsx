import Image from "next/image";

export function KiteBrand() {
  return (
    <div className="flex items-center gap-3 font-semibold text-primary text-2xl tracking-[-0.02em]">
      <Image src="/icon.svg" alt="" width={36} height={36} unoptimized />
      <span>Kite</span>
    </div>
  );
}
