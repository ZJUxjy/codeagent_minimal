import { appendFileSync, existsSync, readFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export function writeLineSync<T>(filePath: string, record: T): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const line = JSON.stringify(record) + '\n';
  appendFileSync(filePath, line, 'utf-8');
}

export function readLinesSync<T>(filePath: string): T[] {
  if (!existsSync(filePath)) {
    return [];
  }
  const content = readFileSync(filePath, 'utf-8');
  return content
    .split('\n')
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.trim().length > 0)
    .map(({ line, index }) => {
      try {
        return JSON.parse(line) as T;
      } catch (error) {
        throw new Error(`Invalid JSON at line ${index + 1} in ${filePath}: ${line.slice(0, 100)}`);
      }
    });
}
