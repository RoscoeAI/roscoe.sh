import {
  consentCategories,
  consentDisclosure,
  monthlyVolume,
  privacyDisclosure,
  sampleMessages,
  supportEmailDefault,
} from "../src/shared/program";

describe("program defaults", () => {
  it("keeps the twilio submission values aligned with the site copy", () => {
    expect(consentCategories).toEqual(["Events", "2FA", "Account Notifications"]);
    expect(monthlyVolume).toBe(100);
    expect(supportEmailDefault).toBe("hello@roscoe.sh");
    expect(consentDisclosure).toMatch(/reply stop to opt out/i);
    expect(consentDisclosure).toMatch(/reply help for help/i);
    expect(privacyDisclosure).toMatch(/does not sell, share, rent, transfer, or exchange/i);
    expect(sampleMessages.twoFactor).toMatch(/expires in 10 minutes/i);
    expect(sampleMessages.progressAlert).toMatch(/72% complete/i);
  });
});
