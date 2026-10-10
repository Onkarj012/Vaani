export const UNRESOLVED_BUILD_GIT_SHA = "unresolved";

declare const __VAANI_BUILD_GIT_SHA__: string | undefined;

export function getBuildGitSha(): string {
  return typeof __VAANI_BUILD_GIT_SHA__ === "string" && __VAANI_BUILD_GIT_SHA__
    ? __VAANI_BUILD_GIT_SHA__
    : UNRESOLVED_BUILD_GIT_SHA;
}

export function formatBuildIdentifier(appVersion: string): string {
  return `${appVersion}+${getBuildGitSha()}`;
}
