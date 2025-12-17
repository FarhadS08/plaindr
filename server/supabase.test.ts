import { describe, expect, it } from "vitest";

describe("Supabase Configuration", () => {
  it("should have VITE_SUPABASE_URL configured", () => {
    const url = process.env.VITE_SUPABASE_URL;
    expect(url).toBeDefined();
    expect(url).toContain("supabase.co");
  });

  it("should have VITE_SUPABASE_ANON_KEY configured", () => {
    const key = process.env.VITE_SUPABASE_ANON_KEY;
    expect(key).toBeDefined();
    expect(key?.length).toBeGreaterThan(0);
  });

  it("should be able to connect to Supabase", async () => {
    const url = process.env.VITE_SUPABASE_URL;
    const key = process.env.VITE_SUPABASE_ANON_KEY;
    
    if (!url || !key) {
      throw new Error("Supabase credentials not configured");
    }

    // Test connection by fetching the REST API health
    const response = await fetch(`${url}/rest/v1/`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    });

    expect(response.ok).toBe(true);
  });
});
