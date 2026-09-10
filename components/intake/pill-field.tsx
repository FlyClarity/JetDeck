"use client";

import { useState } from "react";
import { PillToggle } from "@/components/intake/pill-toggle";

export function PillField({
  name,
  options,
  defaultValue,
}: {
  name: string;
  options: readonly { value: string; label: string }[];
  defaultValue: string;
}) {
  const [value, setValue] = useState(defaultValue);
  return <PillToggle name={name} options={options} value={value} onChange={setValue} />;
}
