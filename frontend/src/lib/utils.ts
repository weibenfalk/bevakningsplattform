import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Slår ihop klassnamn och låter den sista Tailwind-klassen vinna (standard i shadcn/ui). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
