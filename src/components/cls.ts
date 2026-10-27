// Joins the truthy class names: cls("cell", marked && "marked") → "cell marked".
export const cls = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");
