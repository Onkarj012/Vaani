export interface MediaPermissionDetails {
  mediaTypes?: string[];
}

export function shouldGrantMediaPermission(
  requestingWebContents: object,
  permission: string,
  details: MediaPermissionDetails | undefined,
  allowedWebContents: readonly (object | null | undefined)[]
): boolean {
  if (permission !== "media" || !allowedWebContents.includes(requestingWebContents)) {
    return false;
  }

  const mediaTypes = details?.mediaTypes ?? [];
  return mediaTypes.length === 0 || mediaTypes.every((type) => type === "audio");
}
