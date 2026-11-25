export function isRbcOwnerReference(value: string): boolean {
 if (!/^[A-Za-z0-9]{6,}$/.test(value)) return false;
 if (/\d/.test(value)) return true;
 // RBC also uses eight-character CA-prefixed references with mixed case after the prefix.
 const tail = /^CA([A-Za-z]{6})$/.exec(value)?.[1] ?? '';
 return /[a-z]/.test(tail) && /[A-Z]/.test(tail);
}

export function extractRbcOwnerReference(value: string): { ownerName: string; reference: string } {
 const detail = value.trim();
 const marked = /(?:^|\s)Ref(?:erence)?(?:\s*([:#])\s*|\s+)([A-Za-z0-9]{6,})$/i.exec(detail);
 if (marked && (marked[1] || isRbcOwnerReference(marked[2]))) {
  return { ownerName: detail.slice(0, marked.index).trim(), reference: marked[2] };
 }
 const match = /(?:^|\s)([A-Za-z0-9]{6,})$/.exec(detail);
 if (!match || !isRbcOwnerReference(match[1])) return { ownerName: detail, reference: '' };
 return { ownerName: detail.slice(0, match.index).trim(), reference: match[1] };
}
