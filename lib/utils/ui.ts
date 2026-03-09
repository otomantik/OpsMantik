import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Enterprise class name merger.
 * Combines clsx for conditional classes and tailwind-merge to handle conflict resolution.
 */
export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

