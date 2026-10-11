"use client";

import { Menu } from "@base-ui/react/menu";
import type { ReactNode } from "react";
import {
  ChevronsUpDown,
  Sliders,
  LinkIcon,
  KeyIcon,
  AppearanceIcon,
  SignOutIcon,
  ChevronRight,
} from "@/components/icons";
import { Avatar } from "./Avatar";
import type { UserInfo } from "@/lib/ui/types";

export interface ProfileMenuProps {
  user: UserInfo;
  theme: string;
  onOpenSettings: (tab?: string) => void;
  onSetTheme: (theme: "light" | "dark" | "system") => void;
  onSignOut: () => void;
  defaultOpen?: boolean;
}

function Item({
  children,
  icon,
  right,
  onClick,
  active,
}: {
  children: ReactNode;
  icon?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <Menu.Item
      onClick={onClick}
      className="flex items-center h-7 px-2 rounded-md gap-2.5 shrink-0 data-[highlighted]:bg-hover-strong outline-none cursor-default"
      style={active ? { background: "var(--hover-strong)" } : undefined}
    >
      {icon !== undefined && (
        <span className="text-icon inline-flex">{icon}</span>
      )}
      <div className="grow basis-0 text-[13px]/4 text-primary min-w-0">
        {children}
      </div>
      {right}
    </Menu.Item>
  );
}

const THEME_LABEL: Record<string, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

export function ProfileMenu(p: ProfileMenuProps) {
  return (
    <Menu.Root defaultOpen={p.defaultOpen}>
      <Menu.Trigger className="flex items-center h-8 pr-2 pl-1.5 rounded-[7px] gap-2 w-full text-left mail-row cursor-default select-none outline-none">
        <Avatar name={p.user.name} imageUrl={p.user.imageUrl} self size={22} rounded="md" />
        <div className="tracking-[-0.005em] font-semibold text-primary text-[13px]/4 line-clamp-1 min-w-0">
          {p.user.name}
        </div>
        <ChevronsUpDown className="text-tertiary shrink-0" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          side="bottom"
          align="start"
          sideOffset={6}
          className="z-50"
        >
          <Menu.Popup
            className="menu-popup w-64 p-1.25 rounded-[11px] bg-menu-bg outline-none"
            style={{ boxShadow: "var(--shadow-menu)" }}
          >
            <div className="flex items-center pt-2 pb-2.5 gap-2.5 px-2">
              <Avatar name={p.user.name} imageUrl={p.user.imageUrl} self size={30} rounded="md" />
              <div className="flex flex-col gap-px min-w-0">
                <div className="font-semibold text-primary text-[13px]/4 truncate">
                  {p.user.name}
                </div>
                <div className="text-tertiary text-xs/4">
                  {p.user.accountsConnected === 1
                    ? "1 account connected"
                    : `${p.user.accountsConnected} accounts connected`}
                </div>
              </div>
            </div>
            <div className="h-px bg-sidebar-border mx-2" />
            <div className="flex flex-col py-1 gap-px">
              <Item
                icon={<Sliders />}
                right={<div className="text-quaternary text-xs/4">⌘,</div>}
                onClick={() => p.onOpenSettings()}
                active
              >
                Settings
              </Item>
              <Item
                icon={<LinkIcon />}
                onClick={() => p.onOpenSettings("connections")}
              >
                Connections
              </Item>
              <Item
                icon={<KeyIcon />}
                onClick={() => p.onOpenSettings("mcp")}
              >
                MCP & API Keys
              </Item>
              <Menu.SubmenuRoot>
                <Menu.SubmenuTrigger className="flex items-center h-7 px-2 rounded-md gap-2.5 shrink-0 data-[highlighted]:bg-hover-strong outline-none cursor-default">
                  <span className="text-icon inline-flex">
                    <AppearanceIcon />
                  </span>
                  <div className="grow basis-0 text-[13px]/4 text-primary min-w-0">
                    Appearance
                  </div>
                  <div className="text-tertiary text-xs/4">
                    {THEME_LABEL[p.theme] ?? "System"}
                  </div>
                  <ChevronRight className="text-quaternary" />
                </Menu.SubmenuTrigger>
                <Menu.Portal>
                  <Menu.Positioner
                    side="right"
                    align="start"
                    sideOffset={4}
                    alignOffset={-4}
                    className="z-50"
                  >
                    <Menu.Popup
                      className="menu-popup min-w-36 p-1.25 rounded-[11px] bg-menu-bg outline-none"
                      style={{ boxShadow: "var(--shadow-menu)" }}
                    >
                      {(["light", "dark", "system"] as const).map((t) => (
                        <Item
                          key={t}
                          icon={null}
                          onClick={() => p.onSetTheme(t)}
                          right={
                            p.theme === t ? (
                              <div className="text-accent text-xs/4">✓</div>
                            ) : undefined
                          }
                        >
                          {THEME_LABEL[t]}
                        </Item>
                      ))}
                    </Menu.Popup>
                  </Menu.Positioner>
                </Menu.Portal>
              </Menu.SubmenuRoot>
            </div>
            <div className="h-px bg-sidebar-border mx-2" />
            <div className="flex flex-col pt-1 pb-0.5">
              <Item icon={<SignOutIcon />} onClick={p.onSignOut}>
                Sign out
              </Item>
            </div>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
