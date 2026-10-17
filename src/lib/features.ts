// Feature flags. Build-time Vite variables, so a flag is set per Railway
// environment and takes effect on the next deploy. Unset means off.

function flag(name: string): boolean {
  return (import.meta.env[name] as string | undefined) === "true";
}

export const FEATURES = {
  // Device passcodes on tickets (decision 85). Off for launch: the first shops
  // are tailors, who don't take devices. Saved passcodes still show on their
  // ticket so they can be revealed or deleted.
  passcodes: flag("VITE_FEATURE_PASSCODES"),
} as const;
