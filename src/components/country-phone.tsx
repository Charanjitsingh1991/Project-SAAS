"use client";

import { useState } from "react";
import { COUNTRY_LIST, countryFromPhone, type CountryCode } from "@/lib/countries";
import { cn } from "@/lib/utils";

/**
 * Country picker + mobile number. Typing +971… or +91… switches the country;
 * switching the country swaps the dialling prefix.
 */
export function CountryPhoneFields({
  defaultCountry = "IN",
  defaultPhone = "",
  phoneError,
}: {
  defaultCountry?: string;
  defaultPhone?: string;
  phoneError?: string;
}) {
  const [country, setCountry] = useState<CountryCode>(defaultCountry === "AE" ? "AE" : "IN");
  const pack = COUNTRY_LIST.find((c) => c.code === country)!;
  const [phone, setPhone] = useState(defaultPhone || `${pack.phone.code} `);

  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium">Country</span>
        <div className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-card p-1">
          {COUNTRY_LIST.map((c) => (
            <button
              key={c.code}
              type="button"
              onClick={() => {
                setCountry(c.code);
                const digits = phone.replace(/^\+\d{2,3}\s?/, "");
                setPhone(`${c.phone.code} ${digits}`.trimEnd() + (digits ? "" : " "));
              }}
              aria-pressed={country === c.code}
              className={cn("rounded-lg py-2 text-sm transition-colors", country === c.code ? "bg-ink text-paper" : "hover:bg-paper-2")}
            >
              <span className="mr-1">{c.flag}</span>
              {c.code === "AE" ? "UAE" : c.name}
            </button>
          ))}
        </div>
        <input type="hidden" name="country" value={country} />
      </label>
      <label className="block">
        <span className="mb-1.5 flex items-baseline justify-between text-sm font-medium">
          Mobile number <span className="text-xs font-normal text-ink-mute">e.g. {pack.phone.example}</span>
        </span>
        <input
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => {
            const v = e.target.value;
            setPhone(v);
            const detected = countryFromPhone(v);
            if (detected && detected !== country) setCountry(detected);
          }}
          aria-invalid={!!phoneError}
          className={cn(
            "h-12 w-full rounded-xl border bg-card px-4 outline-none transition focus:border-ink focus:ring-4 focus:ring-ink/5",
            phoneError ? "border-signal" : "border-line",
          )}
        />
        {phoneError && <span className="mt-1.5 block text-xs font-medium text-signal">{phoneError}</span>}
      </label>
    </div>
  );
}
