"use client";

import { Select as BaseSelect } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";

export interface SelectOption { value: string; label: string }

// Shared styled dropdown. Do not use native <select> controls in the app.
export function Select({ label, value, options, onChange, disabled = false }: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <BaseSelect.Root items={options} value={value} disabled={disabled} onValueChange={next => { if (next !== null) onChange(next); }}>
      <BaseSelect.Trigger aria-label={label} className="pressable flex items-center justify-between gap-2 h-8 min-w-30 max-w-40 sm:max-w-56 px-2.5 rounded-lg bg-search-field text-primary text-[13px]/4 disabled:opacity-50">
        <BaseSelect.Value className="truncate" />
        <BaseSelect.Icon><ChevronDown size={14} className="text-tertiary shrink-0" /></BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner side="bottom" align="end" sideOffset={5} alignItemWithTrigger={false} className="z-[80] outline-none">
          <BaseSelect.Popup className="menu-popup min-w-[var(--anchor-width)] max-w-[min(22rem,90vw)] rounded-[11px] p-1.25 bg-menu-bg outline-none" style={{ boxShadow: "var(--shadow-menu)", transformOrigin: "var(--transform-origin)" }}>
            <BaseSelect.List className="max-h-[min(18rem,var(--available-height))] overflow-y-auto outline-none">
              {options.map(option => (
                <BaseSelect.Item key={option.value} value={option.value} className="flex items-center min-h-7 px-2 rounded-md gap-2 text-primary text-[13px]/4 data-[highlighted]:bg-hover-strong outline-none cursor-default">
                  <BaseSelect.ItemText className="grow truncate">{option.label}</BaseSelect.ItemText>
                  <BaseSelect.ItemIndicator className="text-accent shrink-0"><Check size={13} /></BaseSelect.ItemIndicator>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
