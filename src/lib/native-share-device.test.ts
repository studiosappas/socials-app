// Tests for native-share-device.ts. Run with:
//   node --experimental-strip-types src/lib/native-share-device.test.ts
// The real button (Save Media -> zip on a Windows touch device) is checked in
// scripts/post-export.check.mjs part C.

import assert from "node:assert/strict";
import { isPhoneOrTabletOs } from "./native-share-device.ts";

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    throw err;
  }
}

const WIN_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const WIN_EDGE = WIN_CHROME + " Edg/141.0.0.0";
const MAC_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const ANDROID_TABLET = "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

test("Windows touch laptops / 2-in-1s (Chrome, Edge) are NOT phone/tablet -- Save Media downloads the zip", () => {
  assert.equal(isPhoneOrTabletOs({ userAgent: WIN_CHROME, maxTouchPoints: 10, uaDataMobile: false }), false);
  assert.equal(isPhoneOrTabletOs({ userAgent: WIN_EDGE, maxTouchPoints: 10 }), false);
});

test("desktop Mac is not phone/tablet", () => {
  assert.equal(isPhoneOrTabletOs({ userAgent: MAC_SAFARI, maxTouchPoints: 0 }), false);
});

test("iPhone, iPadOS (Mac-looking UA with touch points), Android phone and tablet keep the share sheet", () => {
  assert.equal(isPhoneOrTabletOs({ userAgent: IPHONE, maxTouchPoints: 5 }), true);
  assert.equal(isPhoneOrTabletOs({ userAgent: MAC_SAFARI, maxTouchPoints: 5 }), true);
  assert.equal(isPhoneOrTabletOs({ userAgent: ANDROID, maxTouchPoints: 5, uaDataMobile: true }), true);
  assert.equal(isPhoneOrTabletOs({ userAgent: ANDROID_TABLET, maxTouchPoints: 5, uaDataMobile: false }), true);
});

console.log(`\n${passed} tests passed`);
