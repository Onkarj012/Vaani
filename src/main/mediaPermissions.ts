export interface MediaPermissionDetails {
  mediaTypes?: readonly string[];
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

  const mediaTypes = details?.mediaTypes;
  return Array.isArray(mediaTypes) && mediaTypes.length > 0 && mediaTypes.every((type) => type === "audio");
}

// Without a check handler Electron grants every permission check, so only
// media checks are narrowed here. Device labels from enumerateDevices depend
// on this check, so the renderers that may capture audio must pass it before
// their first getUserMedia call.
export function shouldGrantMediaPermissionCheck(
  requestingWebContents: object | null,
  permission: string,
  details: { mediaType?: string; isMainFrame?: boolean },
  allowedWebContents: readonly (object | null | undefined)[]
): boolean {
  if (permission !== "media") return true;
  if (!requestingWebContents || !allowedWebContents.includes(requestingWebContents)) return false;
  return details.mediaType !== "video" && details.isMainFrame !== false;
}
