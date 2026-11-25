export function wellsAirbnbReferences(description: string): string[] {
 const tokens = description.matchAll(/(?:^|[\s*])(M-[A-Za-z0-9]{8,})(?=$|[\s\\])/gi);
 return [...new Set([...tokens].map(match => match[1]))];
}

export function wellsAirbnbReference(description: string): string {
 const references = wellsAirbnbReferences(description);
 return references.length === 1 ? references[0] : '';
}

export function payoutReferences(description: string, knownNumericFormat = false): string[] {
 const matches = description.matchAll(/\b(?:Ref(?:erence)?\s*[:#]\s*|TRN\*1\*)\s*([A-Za-z0-9-]{6,})(?=$|[\s\\])/gi);
 const references = new Set([...matches].map(match => match[1]));
 // RBC's Airbnb export can print the numeric payout reference on its own line.
 if (knownNumericFormat) {
  for (const match of description.matchAll(/(?:^|\s)(\d{10,})(?=$|\s)/g)) references.add(match[1]);
 }
 return [...references];
}

export function payoutReference(description: string, knownNumericFormat = false): string {
 const references = payoutReferences(description,knownNumericFormat);
 return references.length === 1 ? references[0] : '';
}
