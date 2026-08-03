const XML_DECLARATION = /^\uFEFF?<\?xml(?=[\x20\t\r\n])([\s\S]*?)\?>/;
const ENCODING_ATTRIBUTE = /(?:^|[\x20\t\r\n])encoding[\x20\t\r\n]*=[\x20\t\r\n]*(["'])([^"']*)\1/;

export function xmlDeclarationEncoding(value: string): string | null {
  const declaration = XML_DECLARATION.exec(value);
  if (!declaration) return null;
  return ENCODING_ATTRIBUTE.exec(declaration[1] ?? '')?.[2] ?? null;
}

export function canDownloadXmlAsUtf8(value: string): boolean {
  const encoding = xmlDeclarationEncoding(value);
  return encoding === null || /^UTF-8$/i.test(encoding);
}
