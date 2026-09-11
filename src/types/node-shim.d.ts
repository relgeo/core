declare module "node:fs" {
  export function readFileSync(path: string, encoding: string): string;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}

declare class URL {
  constructor(url: string, base?: string | URL);
  readonly href: string;
}

interface ImportMeta {
  readonly url: string;
}
