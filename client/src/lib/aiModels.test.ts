import { describe, it, expect } from "vitest";
import {
  convertToAIModel,
  getAllModels,
  getModelsBySource,
  getModelsByType,
  getModelById,
  mockLocalModels,
  mockAPIModels,
  mockMarketplaceModels,
} from "./aiModels";

describe("AI Models Library", () => {
  describe("Mock Data", () => {
    it("should have mock local models", () => {
      expect(mockLocalModels.length).toBeGreaterThan(0);
      expect(mockLocalModels[0].source).toMatch(/ollama|llamacpp/);
    });

    it("should have mock API models", () => {
      expect(mockAPIModels.length).toBeGreaterThan(0);
      expect(mockAPIModels[0].provider).toMatch(/openai|anthropic|gemini|grok/);
    });

    it("should have marketplace models", () => {
      expect(mockMarketplaceModels.length).toBeGreaterThan(0);
      expect(mockMarketplaceModels[0].name).toBeDefined();
      expect(mockMarketplaceModels[0].popularity).toBeGreaterThanOrEqual(0);
      expect(mockMarketplaceModels[0].popularity).toBeLessThanOrEqual(100);
    });
  });

  describe("convertToAIModel", () => {
    it("should convert local model to AIModel", () => {
      const localModel = mockLocalModels[0];
      const aiModel = convertToAIModel(localModel);

      expect(aiModel.id).toBe(localModel.id);
      expect(aiModel.name).toBe(localModel.name);
      expect(aiModel.type).toBe("local");
      expect(aiModel.source).toBe(localModel.source);
      expect(aiModel.status).toBe(localModel.status);
    });

    it("should convert API model to AIModel", () => {
      const apiModel = mockAPIModels[0];
      const aiModel = convertToAIModel(apiModel);

      expect(aiModel.id).toBe(apiModel.id);
      expect(aiModel.name).toBe(apiModel.name);
      expect(aiModel.type).toBe("api");
      expect(aiModel.source).toBe(apiModel.provider);
    });

    it("should set isSelected flag", () => {
      const localModel = mockLocalModels[0];
      const aiModel = convertToAIModel(localModel, true);

      expect(aiModel.isSelected).toBe(true);
    });

    it("should include capabilities in converted model", () => {
      const localModel = mockLocalModels[0];
      const aiModel = convertToAIModel(localModel);

      expect(aiModel.capabilities).toBeDefined();
      expect(aiModel.capabilities?.chat).toBe(true);
      expect(aiModel.capabilities?.completion).toBe(true);
    });

    it("should include cost information for API models", () => {
      const apiModel = mockAPIModels[0];
      const aiModel = convertToAIModel(apiModel);

      expect(aiModel.costPer1kTokens).toBeDefined();
      expect(aiModel.costPer1kTokens?.input).toBeGreaterThan(0);
      expect(aiModel.costPer1kTokens?.output).toBeGreaterThan(0);
    });
  });

  describe("getAllModels", () => {
    it("should return all models", () => {
      const allModels = getAllModels();

      expect(allModels.length).toBe(
        mockLocalModels.length + mockAPIModels.length
      );
    });

    it("should include both local and API models", () => {
      const allModels = getAllModels();

      const localModels = allModels.filter(m => m.type === "local");
      const apiModels = allModels.filter(m => m.type === "api");

      expect(localModels.length).toBe(mockLocalModels.length);
      expect(apiModels.length).toBe(mockAPIModels.length);
    });

    it("should mark selected model when ID provided", () => {
      const allModels = getAllModels(mockLocalModels[0].id);
      const selectedModel = allModels.find(m => m.isSelected);

      expect(selectedModel).toBeDefined();
      expect(selectedModel?.id).toBe(mockLocalModels[0].id);
    });
  });

  describe("getModelsBySource", () => {
    it("should filter models by source", () => {
      const ollamaModels = getModelsBySource("ollama");

      expect(ollamaModels.length).toBeGreaterThan(0);
      expect(ollamaModels.every(m => m.source === "ollama")).toBe(true);
    });

    it("should return empty array for unknown source", () => {
      const models = getModelsBySource("custom");

      expect(models.length).toBe(0);
    });
  });

  describe("getModelsByType", () => {
    it("should filter local models", () => {
      const localModels = getModelsByType("local");

      expect(localModels.length).toBe(mockLocalModels.length);
      expect(localModels.every(m => m.type === "local")).toBe(true);
    });

    it("should filter API models", () => {
      const apiModels = getModelsByType("api");

      expect(apiModels.length).toBe(mockAPIModels.length);
      expect(apiModels.every(m => m.type === "api")).toBe(true);
    });
  });

  describe("getModelById", () => {
    it("should find model by ID", () => {
      const targetId = mockLocalModels[0].id;
      const model = getModelById(targetId);

      expect(model).toBeDefined();
      expect(model?.id).toBe(targetId);
    });

    it("should return undefined for unknown ID", () => {
      const model = getModelById("unknown-model-id");

      expect(model).toBeUndefined();
    });
  });

  describe("Model Capabilities", () => {
    it("should have correct capabilities for local models", () => {
      const localModel = getModelsByType("local")[0];

      expect(localModel.capabilities?.chat).toBe(true);
      expect(localModel.capabilities?.completion).toBe(true);
      expect(localModel.capabilities?.embedding).toBe(false);
    });

    it("should have vision capability for appropriate API models", () => {
      const gptModel = getModelById("gpt-4");

      expect(gptModel?.capabilities?.vision).toBe(true);
    });

    it("should have function calling for Anthropic models", () => {
      const claudeModel = getModelById("claude-3-opus");

      expect(claudeModel?.capabilities?.functionCalling).toBe(true);
    });
  });

  describe("Marketplace Models", () => {
    it("should have valid marketplace model data", () => {
      mockMarketplaceModels.forEach(model => {
        expect(model.id).toBeDefined();
        expect(model.name).toBeDefined();
        expect(model.provider).toMatch(
          /ollama|llamacpp|openai|anthropic|gemini|grok/
        );
        expect(model.size).toBeGreaterThan(0);
        expect(model.quantizations).toBeInstanceOf(Array);
        expect(model.rating).toBeGreaterThanOrEqual(0);
        expect(model.rating).toBeLessThanOrEqual(5);
      });
    });

    it("should have proper quantization options", () => {
      mockMarketplaceModels.forEach(model => {
        expect(model.quantizations.length).toBeGreaterThan(0);
        expect(model.quantizations.every(q => typeof q === "string")).toBe(
          true
        );
      });
    });
  });
});
