// Whether this device's native share sheet is the right way to "save" files
// -- pure, so native-share-device.test.ts runs under Node.
//
// The Post Editor's touch hint is `(pointer: coarse)`, which Windows touch
// laptops / 2-in-1s match too. There the "share sheet" is the Windows Share
// dialog, not a way to save to Photos, and whether it opened depended on
// timing: navigator.share() needs the click's user activation, which the
// file fetches before it could outlast (then it threw and the zip
// downloaded instead). So the share sheet is only for phone/tablet OSes;
// everything else always gets the zip.

export type DeviceHints = {
  userAgent: string;
  maxTouchPoints?: number;
  // navigator.userAgentData.mobile, where the browser has it (Chromium)
  uaDataMobile?: boolean;
};

export function isPhoneOrTabletOs({ userAgent, maxTouchPoints = 0, uaDataMobile }: DeviceHints): boolean {
  if (uaDataMobile === true) return true;
  if (/Android|iPhone|iPad|iPod/i.test(userAgent)) return true;
  // iPadOS 13+ Safari presents itself as a Mac; a Mac has no touch points
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

export function currentDeviceIsPhoneOrTablet(): boolean {
  if (typeof navigator === "undefined") return false;
  const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  return isPhoneOrTabletOs({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    uaDataMobile: uaData?.mobile,
  });
}
