import { describe, it, expect } from "vitest";
import {
  estimateTokens,
  generateMessageId,
  generateConversationId,
  createChatMessage,
  createConversation,
  addMessageToConversation,
  addFileToContext,
  removeFileFromContext,
  toggleFileInContext,
  calculateContextTransparency,
  getIncludedFiles,
  getExcludedFiles,
  createMockConversation,
  mockContextFiles,
} from "./chatContext";

describe("Chat & Context Library", () => {
  describe("Token Counting (approximation)", () => {
    it("should return a reasonable token count for short text", () => {
      // Approximation: ~4 chars/token for prose. "Hello world" = 11 chars → 3.
      expect(estimateTokens("Hello world")).toBeGreaterThan(0);
      expect(estimateTokens("Hello world")).toBeLessThanOrEqual(4);
      expect(estimateTokens("The quick brown fox jumps over the lazy dog")).toBeGreaterThan(0);
    });

    it("should handle empty strings", () => {
      expect(estimateTokens("")).toBe(0);
    });

    it("should return a proportional count for long texts", () => {
      const longText = "a".repeat(1000);
      const tokens = estimateTokens(longText);
      // Approx 4 chars/token → 250; must be > 0 and < raw char count.
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(longText.length);
    });

    it("should not throw on special-token-like substrings", () => {
      expect(() => estimateTokens("foo <|endoftext|> bar")).not.toThrow();
      expect(estimateTokens("foo <|endoftext|> bar")).toBeGreaterThan(0);
    });

    it("should accept a model id without throwing", () => {
      expect(estimateTokens("Hello world", "gpt-4")).toBeGreaterThan(0);
      expect(estimateTokens("Hello world", "gpt-4o")).toBeGreaterThan(0);
    });
  });

  describe("ID Generation", () => {
    it("should generate unique message IDs", () => {
      const id1 = generateMessageId();
      const id2 = generateMessageId();
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^msg_/);
    });

    it("should generate unique conversation IDs", () => {
      const id1 = generateConversationId();
      const id2 = generateConversationId();
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^conv_/);
    });
  });

  describe("Message Creation", () => {
    it("should create a user message", () => {
      const message = createChatMessage("user", "Hello, AI!");
      expect(message.role).toBe("user");
      expect(message.content).toBe("Hello, AI!");
      expect(message.tokens).toBeGreaterThan(0);
      expect(message.timestamp).toBeInstanceOf(Date);
    });

    it("should create an assistant message with metadata", () => {
      const message = createChatMessage("assistant", "Hello, user!", {
        model: "gpt-4",
        provider: "openai",
      });
      expect(message.role).toBe("assistant");
      expect(message.metadata?.model).toBe("gpt-4");
    });
  });

  describe("Conversation Management", () => {
    it("should create a new conversation", () => {
      const conversation = createConversation("Test Chat", "gpt-4");
      expect(conversation.title).toBe("Test Chat");
      expect(conversation.modelId).toBe("gpt-4");
      expect(conversation.messages).toHaveLength(0);
      expect(conversation.contextFiles).toHaveLength(0);
    });

    it("should add message to conversation", () => {
      let conversation = createConversation("Test", "gpt-4");
      const message = createChatMessage("user", "Hello");

      conversation = addMessageToConversation(conversation, message);

      expect(conversation.messages).toHaveLength(1);
      expect(conversation.messages[0].content).toBe("Hello");
      expect(conversation.totalTokensUsed).toBeGreaterThan(0);
    });

    it("should update timestamp when adding message", () => {
      const conversation = createConversation("Test", "gpt-4");
      const initialTime = conversation.updatedAt;

      const message = createChatMessage("user", "Hello");
      const updated = addMessageToConversation(conversation, message);

      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(
        initialTime.getTime()
      );
    });
  });

  describe("Context File Management", () => {
    it("should add file to context", () => {
      let conversation = createConversation("Test", "gpt-4");
      const file = mockContextFiles[0];

      conversation = addFileToContext(conversation, file);

      expect(conversation.contextFiles).toHaveLength(1);
      expect(conversation.contextFiles[0].id).toBe(file.id);
    });

    it("should remove file from context", () => {
      let conversation = createConversation("Test", "gpt-4");
      const file = mockContextFiles[0];

      conversation = addFileToContext(conversation, file);
      expect(conversation.contextFiles).toHaveLength(1);

      conversation = removeFileFromContext(conversation, file.id);
      expect(conversation.contextFiles).toHaveLength(0);
    });

    it("should toggle file inclusion", () => {
      let conversation = createConversation("Test", "gpt-4");
      const file = { ...mockContextFiles[0], included: true };

      conversation = addFileToContext(conversation, file);
      expect(conversation.contextFiles[0].included).toBe(true);

      conversation = toggleFileInContext(conversation, file.id);
      expect(conversation.contextFiles[0].included).toBe(false);

      conversation = toggleFileInContext(conversation, file.id);
      expect(conversation.contextFiles[0].included).toBe(true);
    });

    it("should update existing file when adding with same ID", () => {
      let conversation = createConversation("Test", "gpt-4");
      const file1 = { ...mockContextFiles[0], included: true };
      const file2 = { ...mockContextFiles[0], included: false };

      conversation = addFileToContext(conversation, file1);
      expect(conversation.contextFiles).toHaveLength(1);

      conversation = addFileToContext(conversation, file2);
      expect(conversation.contextFiles).toHaveLength(1);
      expect(conversation.contextFiles[0].included).toBe(false);
    });
  });

  describe("Context Transparency", () => {
    it("should calculate context transparency metrics", () => {
      let conversation = createConversation("Test", "gpt-4");
      const file = mockContextFiles[0];

      conversation = addFileToContext(conversation, file);
      const message = createChatMessage("user", "Hello");
      conversation = addMessageToConversation(conversation, message);

      const transparency = calculateContextTransparency(
        conversation,
        8192,
        500
      );

      expect(transparency.totalTokens).toBeGreaterThan(0);
      expect(transparency.maxTokens).toBe(8192);
      expect(transparency.usedPercentage).toBeGreaterThan(0);
      expect(transparency.usedPercentage).toBeLessThanOrEqual(100);
      expect(transparency.remainingTokens).toBeGreaterThanOrEqual(0);
    });

    it("should include only included files in token calculation", () => {
      let conversation = createConversation("Test", "gpt-4");
      const includedFile = { ...mockContextFiles[0], included: true };
      const excludedFile = { ...mockContextFiles[1], included: false };

      conversation = addFileToContext(conversation, includedFile);
      conversation = addFileToContext(conversation, excludedFile);

      const transparency = calculateContextTransparency(conversation);

      // Only included file tokens should be counted
      expect(transparency.totalTokens).toBeGreaterThan(500); // system prompt
      expect(transparency.totalTokens).toBeLessThan(
        500 + includedFile.tokens + excludedFile.tokens
      );
    });

    it("should handle max token limit", () => {
      let conversation = createConversation("Test", "gpt-4");
      const file = mockContextFiles[0];

      conversation = addFileToContext(conversation, file);

      const transparency = calculateContextTransparency(conversation, 100, 50);

      expect(transparency.remainingTokens).toBeLessThanOrEqual(100);
      expect(transparency.usedPercentage).toBeGreaterThanOrEqual(0);
    });
  });

  describe("File Filtering", () => {
    it("should get included files", () => {
      let conversation = createConversation("Test", "gpt-4");

      mockContextFiles.forEach(file => {
        conversation = addFileToContext(conversation, file);
      });

      const includedFiles = getIncludedFiles(conversation);

      expect(includedFiles.length).toBeGreaterThan(0);
      expect(includedFiles.every(f => f.included)).toBe(true);
    });

    it("should get excluded files", () => {
      let conversation = createConversation("Test", "gpt-4");

      mockContextFiles.forEach(file => {
        conversation = addFileToContext(conversation, file);
      });

      const excludedFiles = getExcludedFiles(conversation);

      expect(excludedFiles.length).toBeGreaterThan(0);
      expect(excludedFiles.every(f => !f.included)).toBe(true);
    });
  });

  describe("Mock Data", () => {
    it("should have valid mock context files", () => {
      mockContextFiles.forEach(file => {
        expect(file.id).toBeDefined();
        expect(file.path).toBeDefined();
        expect(file.name).toBeDefined();
        expect(file.type).toMatch(/file|folder/);
        expect(file.size).toBeGreaterThan(0);
        expect(file.tokens).toBeGreaterThan(0);
        expect(file.included).toBeTypeOf("boolean");
      });
    });

    it("should create valid mock conversation", () => {
      const conversation = createMockConversation();

      expect(conversation.id).toMatch(/^conv_/);
      expect(conversation.title).toBeDefined();
      expect(conversation.messages.length).toBeGreaterThan(0);
      expect(conversation.contextFiles.length).toBeGreaterThan(0);
      expect(conversation.modelId).toBeDefined();
      expect(conversation.totalTokensUsed).toBeGreaterThan(0);
    });

    it("should have correct message roles in mock conversation", () => {
      const conversation = createMockConversation();

      const userMessages = conversation.messages.filter(m => m.role === "user");
      const assistantMessages = conversation.messages.filter(
        m => m.role === "assistant"
      );

      expect(userMessages.length).toBeGreaterThan(0);
      expect(assistantMessages.length).toBeGreaterThan(0);
    });
  });
});
