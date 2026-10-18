import * as React from "react"
import { Check, ChevronsDown } from "lucide-react"
import {
  parsePhoneNumberFromString,
  AsYouType,
  getCountryCallingCode,
  type CountryCode,
} from "libphonenumber-js"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"

type Country = {
  code: CountryCode
  name: string
  dial: string
  flag: string
}

// A compact, commonly-used subset. libphonenumber-js supports every ISO code,
// so users can still type any number; this list is what appears in the picker.
const COUNTRY_CODES: CountryCode[] = [
  "US", "CA", "GB", "IE", "AU", "NZ", "IN", "PK", "BD", "PH", "ID", "MY",
  "SG", "TH", "VN", "JP", "KR", "CN", "HK", "TW", "AE", "SA", "QA", "KW",
  "BH", "OM", "EG", "ZA", "NG", "KE", "GH", "FR", "DE", "IT", "ES", "PT",
  "NL", "BE", "CH", "AT", "SE", "NO", "DK", "FI", "PL", "GR", "TR", "RU",
  "UA", "RO", "CZ", "HU", "MX", "BR", "AR", "CL", "CO", "PE", "VE", "EC",
  "JM", "TT", "BB", "DO", "PR", "IL", "LB", "JO", "IQ", "MA", "DZ", "TN",
  "CM", "CI", "UG", "TZ", "RW", "ZM", "ZW", "AO", "MZ", "NA",
]

const COUNTRIES: Country[] = COUNTRY_CODES
  .map((code) => ({
    code,
    name: new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code,
    dial: getCountryCallingCode(code),
    flag: flagEmoji(code),
  }))
  .sort((a, b) => a.name.localeCompare(b.name))

function flagEmoji(code: CountryCode): string {
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 127397 + c.charCodeAt(0)))
}

function deriveCountry(value: string): CountryCode | null {
  if (!value) return null
  const parsed = parsePhoneNumberFromString(value)
  if (parsed?.country) return parsed.country
  // Fall back to a leading "+<dial>" match.
  if (value.startsWith("+")) {
    const dial = value.slice(1).replace(/\D/g, "")
    const hit = COUNTRIES.find((c) => dial.startsWith(c.dial))
    return hit?.code ?? null
  }
  return null
}

function nationalPart(value: string, country: CountryCode | null): string {
  if (!value) return ""
  const parsed = parsePhoneNumberFromString(value, country ?? undefined)
  if (parsed) return parsed.formatNational().trim()
  // Show what the user typed if we can't parse it yet.
  const digits = value.replace(/\D/g, "")
  if (country) {
    const dial = getCountryCallingCode(country)
    return digits.startsWith(dial) ? digits.slice(dial.length) : digits
  }
  return digits
}

export type PhoneInputProps = {
  value: string
  onChange: (e164: string) => void
  id?: string
  name?: string
  placeholder?: string
  autoComplete?: string
  ariaInvalid?: boolean
  className?: string
  disabled?: boolean
  defaultCountry?: CountryCode
}

export function PhoneInput({
  value,
  onChange,
  id,
  name,
  placeholder = "555 123 4567",
  autoComplete = "tel",
  ariaInvalid,
  className,
  disabled,
  defaultCountry = "US",
}: PhoneInputProps) {
  const initialCountry = React.useMemo(
    () => deriveCountry(value) ?? defaultCountry,
    // Only seed once from the incoming value; afterwards the user drives it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )
  const [country, setCountry] = React.useState<CountryCode>(initialCountry)
  const [national, setNational] = React.useState(() => nationalPart(value, initialCountry))
  const [open, setOpen] = React.useState(false)

  // Keep internal state in sync when the parent resets value (e.g. form clear).
  React.useEffect(() => {
    if (!value) {
      setNational("")
      return
    }
    const parsed = parsePhoneNumberFromString(value, country)
    setNational(parsed ? parsed.formatNational().trim() : nationalPart(value, country))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  function emit(nextCountry: CountryCode, nextNational: string) {
    const trimmed = nextNational.trim()
    if (!trimmed) {
      onChange("")
      return
    }
    const parsed = parsePhoneNumberFromString(trimmed, nextCountry)
    if (parsed?.isValid()) {
      onChange(parsed.format("E.164"))
    } else {
      // Pass through the digits with dial code so the parent can show its own
      // validation error; final E.164 is produced once the number is valid.
      const digits = trimmed.replace(/\D/g, "")
      onChange(`+${getCountryCallingCode(nextCountry)}${digits}`)
    }
  }

  function handleNationalChange(raw: string) {
    // Format as the user types for the active country.
    const formatted = new AsYouType(country).input(raw)
    setNational(formatted)
    emit(country, formatted)
  }

  function handleCountryChange(next: CountryCode) {
    setCountry(next)
    setNational("")
    onChange("")
    setOpen(false)
  }

  const selected = COUNTRIES.find((c) => c.code === country)

  return (
    <div
      className={cn(
        "flex w-full items-stretch rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] outline-none focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        ariaInvalid && "border-destructive focus-within:border-destructive focus-within:ring-destructive/30",
        className
      )}
      data-slot="phone-input"
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-r-none border-r border-input bg-transparent px-2.5 text-sm font-medium hover:bg-transparent"
            aria-label="Choose country code"
          >
            <span className="text-base leading-none">{selected?.flag}</span>
            <span className="tabular-nums text-muted-foreground">+{selected?.dial}</span>
            <ChevronsDown className="size-3.5 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search country or code" />
            <CommandList>
              <CommandEmpty>No country found.</CommandEmpty>
              <CommandGroup>
                {COUNTRIES.map((c) => (
                  <CommandItem
                    key={c.code}
                    value={`${c.name} +${c.dial} ${c.code}`}
                    onSelect={() => handleCountryChange(c.code)}
                    className="gap-2"
                  >
                    <span className="text-base leading-none">{c.flag}</span>
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className="tabular-nums text-xs text-muted-foreground">+{c.dial}</span>
                    {c.code === country && <Check className="size-3.5 text-primary" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <Input
        id={id}
        name={name}
        type="tel"
        inputMode="tel"
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={national}
        disabled={disabled}
        onChange={(e) => handleNationalChange(e.target.value)}
        aria-invalid={ariaInvalid}
        className="h-9 flex-1 rounded-l-none border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:border-0 px-3"
      />
    </div>
  )
}

// Validate an E.164-ish string and return a friendly error, or null when ok.
export function validatePhoneE164(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return "Please enter your WhatsApp number."
  const parsed = parsePhoneNumberFromString(trimmed)
  if (!parsed) return "That number doesn't look right — pick your country and enter the number."
  if (!parsed.isValid()) return "That number isn't valid — check the country code and digits."
  return null
}


