import { useRef, useState } from "react";
import { LANGUAGES, type AppLanguage } from "../i18n";

export const localizedLanguageNames: Record<AppLanguage, Record<AppLanguage, string>> = {
  pt: {
    pt: "Português",
    en: "Inglês",
    es: "Espanhol",
    tr: "Turco",
  },
  en: {
    pt: "Portuguese",
    en: "English",
    es: "Spanish",
    tr: "Turkish",
  },
  es: {
    pt: "Portugués",
    en: "Inglés",
    es: "Español",
    tr: "Turco",
  },
  tr: {
    pt: "Portekizce",
    en: "İngilizce",
    es: "İspanyolca",
    tr: "Türkçe",
  },
};

export function getLanguageOptionLabel(code: AppLanguage, currentLanguage: AppLanguage) {
  return localizedLanguageNames[currentLanguage]?.[code] ?? localizedLanguageNames.pt[code];
}

export function LanguageSelector({
  language,
  onChange,
  label,
  compact = false,
}: {
  language: AppLanguage;
  onChange: (language: AppLanguage) => void;
  label: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedLanguage = LANGUAGES.find((item) => item.code === language) ?? LANGUAGES[0];
  const selectedLabel = getLanguageOptionLabel(selectedLanguage.code, language);
  const selectorClasses = ["languageSelect", compact ? "compact" : "full", "customLanguageSelect"]
    .filter(Boolean)
    .join(" ");

  function focusOption(index: number) {
    const normalizedIndex = (index + LANGUAGES.length) % LANGUAGES.length;
    optionRefs.current[normalizedIndex]?.focus();
  }

  function openOptions() {
    setOpen(true);
    window.setTimeout(() => {
      const selectedIndex = Math.max(
        0,
        LANGUAGES.findIndex((item) => item.code === language),
      );
      focusOption(selectedIndex);
    }, 0);
  }

  return (
    <div
      className={selectorClasses}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
    >
      <span className="srOnly">{label}</span>
      <button
        ref={buttonRef}
        type="button"
        className={open ? "languageSelectButton open" : "languageSelectButton"}
        aria-label={`${label}: ${selectedLabel}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`${label}: ${selectedLabel}`}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openOptions();
          }

          if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      >
        <svg className="languageGlobeIcon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />
          <path d="M3.6 9h16.8M3.6 15h16.8M12 3c2.15 2.35 3.25 5.35 3.25 9S14.15 18.65 12 21c-2.15-2.35-3.25-5.35-3.25-9S9.85 5.35 12 3Z" />
        </svg>
        <span className="srOnly">{selectedLabel}</span>
      </button>

      {open && (
        <div className="languageOptions" role="listbox" aria-label={label}>
          {LANGUAGES.map((item, index) => {
            const active = item.code === language;
            return (
              <button
                key={item.code}
                ref={(element) => {
                  optionRefs.current[index] = element;
                }}
                type="button"
                role="option"
                aria-selected={active}
                className={active ? "languageOption active" : "languageOption"}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(item.code);
                  setOpen(false);
                  buttonRef.current?.focus();
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    focusOption(index + 1);
                  }

                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    focusOption(index - 1);
                  }

                  if (event.key === "Home") {
                    event.preventDefault();
                    focusOption(0);
                  }

                  if (event.key === "End") {
                    event.preventDefault();
                    focusOption(LANGUAGES.length - 1);
                  }

                  if (event.key === "Escape") {
                    event.preventDefault();
                    setOpen(false);
                    buttonRef.current?.focus();
                  }
                }}
              >
                <span className="languageOptionCode">{item.shortLabel}</span>
                <span className="languageOptionLabel">{getLanguageOptionLabel(item.code, language)}</span>
                {active && <span className="languageOptionCheck" aria-hidden="true">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
