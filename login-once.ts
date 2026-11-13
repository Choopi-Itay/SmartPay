import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const PROFILE_PATH = path.join(__dirname, 'profile');

function findChromeExecutable(): string {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  ];

  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  throw new Error('לא נמצא קובץ הפעלה של Google Chrome במחשב');
}

async function loginOnce() {
  const chromePath = findChromeExecutable();
  fs.mkdirSync(PROFILE_PATH, { recursive: true });

  console.log('פותח חלון Chrome רגיל ונקי (ללא Playwright)...');
  console.log('1. התחברו באתר "ביחד בשבילך" (כולל קוד SMS).');
  console.log('2. לאחר שאתם רואים שאתם מחוברים, סגרו את חלון הדפדפן שנפתח (X).\n');

  const child = spawn(
    chromePath,
    [
      `--user-data-dir=${PROFILE_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
      'https://www.hist.org.il/',
    ],
    { stdio: 'ignore' }
  );

  await new Promise<void>((resolve) => {
    child.on('exit', () => resolve());
  });

  console.log('הדפדפן נסגר והסשן נשמר בהצלחה ב-./profile.');
  console.log('כעת אפשר להריץ: npm run crawl:hist');
}

loginOnce().catch(console.error);