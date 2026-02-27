// Deno Global Type Definitions for Node-based IDEs
declare namespace Deno {
    export interface Env {
        get(key: string): string | undefined;
        set(key: string, value: string): void;
        delete(key: string): void;
        toObject(): { [key: string]: string };
    }
    export const env: Env;
    export function exit(code?: number): never;
    export function readTextFile(path: string | URL): Promise<string>;
}
