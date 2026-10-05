import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Class merge helper. Keeps variant overrides predictable. §9.1 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
