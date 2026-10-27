import { Fragment, type ReactNode } from "react";
import { encodeText, generateKey, KEY_BASES, type KeyBase } from "../lib/barn.ts";
import { MAX_TEXT_BYTES, type Cipher } from "../useCipher.ts";

const BASE_NAMES: Record<KeyBase, string> = {
  ternary: "ternary",
  quaternary: "quaternary",
  octal: "octal",
  decimal: "decimal",
  hexadecimal: "hex",
};

interface FieldProps {
  id: string;
  label: string;
  meta?: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}

function Field({ id, label, meta, hint, error, children }: FieldProps) {
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label} {meta && <span className="meta">{meta}</span>}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      )}
      <p id={`${id}-error`} className="error" role="alert">
        {error}
      </p>
    </div>
  );
}

// Props every text field shares: its id, aria wiring for the hint and error, no autofill or spellcheck.
const fieldProps = (id: string, error?: string, hint = false) => ({
  id,
  "aria-invalid": Boolean(error),
  "aria-describedby": hint ? `${id}-hint ${id}-error` : `${id}-error`,
  autoComplete: "off",
  spellCheck: false,
});

export function EncryptInputs({ cipher }: { cipher: Cipher }) {
  const { fields, errors, edit, start } = cipher;
  const size = encodeText(fields.text).bytes.length;
  const drawKey = (
    <>
      or draw one from 32 random bits:{" "}
      {(Object.keys(KEY_BASES) as KeyBase[]).map((base, i) => (
        <Fragment key={base}>
          {i > 0 && ", "}
          <button type="button" className="link" onClick={() => edit({ key: generateKey(base).join(", ") })}>
            {BASE_NAMES[base]}
          </button>
        </Fragment>
      ))}
    </>
  );

  return (
    <form className="inputs" noValidate onSubmit={(e) => (e.preventDefault(), start())}>
      <Field id="plaintext" label="plaintext" meta={`${size}/${MAX_TEXT_BYTES} bytes`} error={errors.text}>
        <input className="text-input" value={fields.text} onChange={(e) => edit({ text: e.target.value })} {...fieldProps("plaintext", errors.text)} />
      </Field>
      <Field id="enc-key" label="key K" hint={drawKey} error={errors.key}>
        <input className="key-input" value={fields.key} onChange={(e) => edit({ key: e.target.value })} {...fieldProps("enc-key", errors.key, true)} />
      </Field>
      <button type="submit" className="btn primary">
        Encrypt
      </button>
    </form>
  );
}

export function DecryptInputs({ cipher }: { cipher: Cipher }) {
  const { fields, errors, edit, start } = cipher;
  const count = fields.text.replace(/[^01]/g, "").length;

  return (
    <form className="inputs" noValidate onSubmit={(e) => (e.preventDefault(), start())}>
      <Field id="cipher" label="cipher C" meta={`${count} bits`} error={errors.text}>
        <textarea className="bits-input" rows={2} value={fields.text} onChange={(e) => edit({ text: e.target.value })} {...fieldProps("cipher", errors.text)} />
      </Field>
      <Field id="dec-key" label="key K" hint="the same key that encrypted it" error={errors.key}>
        <input className="key-input" value={fields.key} onChange={(e) => edit({ key: e.target.value })} {...fieldProps("dec-key", errors.key, true)} />
      </Field>
      <button type="submit" className="btn primary">
        Decrypt
      </button>
    </form>
  );
}
