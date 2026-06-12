import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {
  assertNotRealChromeUserDataDir,
  CHROME_USER_DATA_DIR
} from '../lib/chrome-profile-guard.js';

test('assertNotRealChromeUserDataDir blocks real Chrome directory', () => {
  assert.throws(
    () => assertNotRealChromeUserDataDir(CHROME_USER_DATA_DIR),
    /GÜVENLİK/
  );
});

test('assertNotRealChromeUserDataDir allows temp automation dir', () => {
  const tempDir = path.join(os.tmpdir(), 'petfix-chrome-automation-test');
  assert.doesNotThrow(() => assertNotRealChromeUserDataDir(tempDir));
});
