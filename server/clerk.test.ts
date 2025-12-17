import { describe, expect, it } from "vitest";

describe("Clerk Configuration", () => {
  it("should have VITE_CLERK_PUBLISHABLE_KEY configured", () => {
    const key = process.env.VITE_CLERK_PUBLISHABLE_KEY;
    expect(key).toBeDefined();
    expect(key).toContain("pk_");
  });

  it("should have CLERK_SECRET_KEY configured", () => {
    const key = process.env.CLERK_SECRET_KEY;
    expect(key).toBeDefined();
    expect(key).toContain("sk_");
  });

  it("should be able to verify Clerk API connectivity", async () => {
    const secretKey = process.env.CLERK_SECRET_KEY;
    
    if (!secretKey) {
      throw new Error("Clerk secret key not configured");
    }

    // Test Clerk API connectivity by fetching organization list (lightweight endpoint)
    const response = await fetch("https://api.clerk.com/v1/users?limit=1", {
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
    });

    // 200 means valid key, 401 means invalid key
    expect(response.status).toBe(200);
  });
});
