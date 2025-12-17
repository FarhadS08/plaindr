import { describe, expect, it, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";

// Test Supabase connection and table structure
describe("Supabase Service", () => {
  let supabase: ReturnType<typeof createClient>;

  beforeAll(() => {
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Supabase credentials not configured");
    }

    supabase = createClient(supabaseUrl, supabaseKey);
  });

  it("should have VITE_SUPABASE_URL configured", () => {
    expect(process.env.VITE_SUPABASE_URL).toBeDefined();
    expect(process.env.VITE_SUPABASE_URL).toContain("supabase");
  });

  it("should have VITE_SUPABASE_ANON_KEY configured", () => {
    expect(process.env.VITE_SUPABASE_ANON_KEY).toBeDefined();
    expect(process.env.VITE_SUPABASE_ANON_KEY?.length).toBeGreaterThan(10);
  });

  it("should be able to connect to Supabase", async () => {
    // Try to query the conversations table (should work even if empty)
    const { error } = await supabase
      .from("conversations")
      .select("id")
      .limit(1);

    // No error means connection is successful and table exists
    expect(error).toBeNull();
  });

  it("should have conversations table with correct structure", async () => {
    // Insert a test conversation
    const testUserId = "test-user-" + Date.now();
    const { data: insertedConv, error: insertError } = await supabase
      .from("conversations")
      .insert({
        user_id: testUserId,
        title: "Test Conversation",
      })
      .select()
      .single();

    expect(insertError).toBeNull();
    expect(insertedConv).toBeDefined();
    expect(insertedConv?.user_id).toBe(testUserId);
    expect(insertedConv?.title).toBe("Test Conversation");
    expect(insertedConv?.id).toBeDefined();
    expect(insertedConv?.created_at).toBeDefined();
    expect(insertedConv?.updated_at).toBeDefined();

    // Clean up - delete the test conversation
    if (insertedConv?.id) {
      await supabase.from("conversations").delete().eq("id", insertedConv.id);
    }
  });

  it("should have messages table with correct structure", async () => {
    // First create a conversation
    const testUserId = "test-user-" + Date.now();
    const { data: conv, error: convError } = await supabase
      .from("conversations")
      .insert({
        user_id: testUserId,
        title: "Test for Messages",
      })
      .select()
      .single();

    expect(convError).toBeNull();
    expect(conv).toBeDefined();

    // Insert a test message
    const { data: insertedMsg, error: msgError } = await supabase
      .from("messages")
      .insert({
        conversation_id: conv!.id,
        role: "user",
        content: "Test message content",
      })
      .select()
      .single();

    expect(msgError).toBeNull();
    expect(insertedMsg).toBeDefined();
    expect(insertedMsg?.conversation_id).toBe(conv!.id);
    expect(insertedMsg?.role).toBe("user");
    expect(insertedMsg?.content).toBe("Test message content");
    expect(insertedMsg?.id).toBeDefined();
    expect(insertedMsg?.created_at).toBeDefined();

    // Clean up
    if (insertedMsg?.id) {
      await supabase.from("messages").delete().eq("id", insertedMsg.id);
    }
    if (conv?.id) {
      await supabase.from("conversations").delete().eq("id", conv.id);
    }
  });

  it("should be able to create and retrieve a full conversation flow", async () => {
    const testUserId = "test-user-flow-" + Date.now();

    // 1. Create conversation
    const { data: conv, error: convError } = await supabase
      .from("conversations")
      .insert({
        user_id: testUserId,
        title: "Full Flow Test",
      })
      .select()
      .single();

    expect(convError).toBeNull();
    expect(conv).toBeDefined();

    // 2. Add user message
    const { data: userMsg, error: userMsgError } = await supabase
      .from("messages")
      .insert({
        conversation_id: conv!.id,
        role: "user",
        content: "What are the AI policies?",
      })
      .select()
      .single();

    expect(userMsgError).toBeNull();

    // 3. Add assistant message
    const { data: assistantMsg, error: assistantMsgError } = await supabase
      .from("messages")
      .insert({
        conversation_id: conv!.id,
        role: "assistant",
        content: "AI policies cover various aspects...",
      })
      .select()
      .single();

    expect(assistantMsgError).toBeNull();

    // 4. Retrieve all messages for the conversation
    const { data: messages, error: fetchError } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conv!.id)
      .order("created_at", { ascending: true });

    expect(fetchError).toBeNull();
    expect(messages).toHaveLength(2);
    expect(messages![0].role).toBe("user");
    expect(messages![1].role).toBe("assistant");

    // 5. Retrieve conversations for user
    const { data: userConvs, error: userConvsError } = await supabase
      .from("conversations")
      .select("*")
      .eq("user_id", testUserId);

    expect(userConvsError).toBeNull();
    expect(userConvs).toHaveLength(1);

    // Clean up
    await supabase.from("messages").delete().eq("conversation_id", conv!.id);
    await supabase.from("conversations").delete().eq("id", conv!.id);
  });
});
