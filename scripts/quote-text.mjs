const FOOTER_START = /(?:\\?---\s*(?:Are you enjoying|And,? as always|\|)|\s\*\s\*\s\*\s|\s+P\.S\.\s|Happy new year, all|\(Click here to share on (?:Twitter|X)\.?\)|And,? as always|Which bullet above|Have a wonderful weekend|Have an amazing weekend|FORWARDED THIS MESSAGE|Forwarded this message|DUE TO VOLUME|This email was sent to|\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\))/i;

export function quoteText(value) {
  const source = String(value ?? "").trim();
  const footer = source.search(FOOTER_START);
  return (footer >= 0 ? source.slice(0, footer) : source)
    .replace(/\s*\\?---\s*$/, "")
    .trim();
}
