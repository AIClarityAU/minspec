export interface BuildCoreOptions {
  outfile: string;
  metafile?: boolean | string;
  entry?: string;
  /** Packages left unbundled; a reachable import then shows in the metafile instead of failing the build. */
  external?: string[];
}
export function buildCore(options: BuildCoreOptions): Promise<{
  metafile?: { inputs: Record<string, { imports: { path: string; kind: string; external?: boolean }[] }> };
}>;
