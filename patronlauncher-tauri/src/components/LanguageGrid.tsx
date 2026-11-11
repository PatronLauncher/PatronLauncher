import { languages, type Language } from "../i18n";
import Flag from "./Flag";
export default function LanguageGrid({
  value,
  onChange,
  disabled,
}: {
  value: Language;
  onChange: (code: Language) => void;
  disabled?: boolean;
}) {
  return (
    <div className="language-grid" role="radiogroup">
      {languages.map((l, i) => (
        <button
          key={l.code}
          type="button"
          role="radio"
          aria-checked={value === l.code}
          className={"language-choice " + (value === l.code ? "selected" : "")}
          style={{ "--i": i } as React.CSSProperties}
          disabled={disabled}
          lang={l.code}
          onClick={() => onChange(l.code)}
        >
          <Flag code={l.code} />
          <span>
            <b>{l.name}</b>
            <small>{l.english}</small>
          </span>
          {value === l.code && <i aria-hidden="true">✓</i>}
        </button>
      ))}
    </div>
  );
}
