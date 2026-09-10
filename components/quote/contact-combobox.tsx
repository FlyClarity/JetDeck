"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { searchContacts, type ContactOption } from "@/lib/contact-server";

export function ContactCombobox({
  onSelect,
  placeholder,
}: {
  onSelect: (contact: ContactOption) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ContactOption[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    const handle = setTimeout(async () => {
      if (q.length < 2) {
        setResults([]);
        return;
      }
      const matches = await searchContacts(q);
      setResults(matches);
    }, 200);
    return () => clearTimeout(handle);
  }, [query, open]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <Input
        value={query}
        placeholder={placeholder ?? "Search by name, email, or company"}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && results.length > 0 && (
        <div className="absolute z-10 mt-1 w-full min-w-72 rounded-md border border-border bg-popover shadow-md">
          {results.map((contact) => (
            <button
              key={contact.id}
              type="button"
              onClick={() => {
                onSelect(contact);
                setQuery("");
                setResults([]);
                setOpen(false);
              }}
              className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-muted"
            >
              <span className="font-medium">
                {contact.firstName} {contact.lastName}
                {contact.company ? ` — ${contact.company}` : ""}
              </span>
              <span className="text-xs text-muted-foreground">{contact.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
