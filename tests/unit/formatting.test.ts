import { beforeEach, describe, expect, it, vi } from "vitest";

const createCompletionMock = vi.fn();
const groqConstructorMock = vi.fn(() => ({
  chat: {
    completions: {
      create: createCompletionMock
    }
  }
}));

vi.mock("groq-sdk", () => ({
  default: groqConstructorMock
}));

describe("formatTranscript", () => {
  beforeEach(() => {
    createCompletionMock.mockReset();
    groqConstructorMock.mockClear();
  });

  it("skips the LLM call for text shorter than the minimum word count", async () => {
    const { formatTranscript } = await import("@main/formatting");

    const result = await formatTranscript("test-key", "Hello world.");

    expect(result).toBe("Hello world.");
    expect(groqConstructorMock).not.toHaveBeenCalled();
    expect(createCompletionMock).not.toHaveBeenCalled();
  });

  it("formats heading-based list text when the sentence introduces items", async () => {
    createCompletionMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: "There are a few things about my project that I need. It is as follows the checklist.\n\n1. Keep UI\n2. Fix transcription\n3. And change the AI prompt"
          }
        }
      ]
    });

    const { formatTranscript } = await import("@main/formatting");
    const rawText = "There are a few things about my project that I need. It is as follows the checklist. Keep UI, fix transcription, and change the AI prompt.";
    const result = await formatTranscript("test-key", rawText);

    expect(result).toBe("There are a few things about my project that I need. It is as follows the checklist.\n\n1. Keep UI\n2. Fix transcription\n3. And change the AI prompt");
    expect(createCompletionMock).toHaveBeenCalledTimes(1);
  });

  it("formats cue-driven list text through the chat model", async () => {
    createCompletionMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: "Project checklist:\n\n1. Fix transcription.\n2. Improve API prompt."
          }
        }
      ]
    });

    const { formatTranscript } = await import("@main/formatting");
    const result = await formatTranscript("test-key", "Project checklist. Number 1. Fix transcription. Number 2. Improve API prompt.");

    expect(result).toBe("Project checklist:\n\n1. Fix transcription.\n2. Improve API prompt.");
    expect(createCompletionMock).toHaveBeenCalledTimes(1);
    expect(createCompletionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: expect.stringContaining("<transcript>\nProject checklist. Number 1. Fix transcription. Number 2. Improve API prompt.\n</transcript>")
          })
        ])
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("falls back to raw text when the LLM response is empty", async () => {
    createCompletionMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: ""
          }
        }
      ]
    });

    const { formatTranscript } = await import("@main/formatting");
    const rawText = "Shopping list. Bullet point. Apple. Bullet point. Bread.";
    const result = await formatTranscript("test-key", rawText);

    expect(result).toBe(rawText);
  });

  it("retries with a stricter prompt when the first pass drops context", async () => {
    createCompletionMock
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: "Project Checklist\n\n1. Fixed transcription\n2. Improved prompt\n3. Leave UI"
            }
          }
        ]
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: "I have some project checklist. The items are as follows.\n\n1. Fixed transcription\n2. Improved prompt\n3. Leave UI"
            }
          }
        ]
      });

    const { formatTranscript } = await import("@main/formatting");
    const rawText = "I have some project checklist. The items are as follows. Fixed transcription, improved prompt, leave UI.";
    const result = await formatTranscript("test-key", rawText);

    expect(result).toBe("I have some project checklist. The items are as follows.\n\n1. Fixed transcription\n2. Improved prompt\n3. Leave UI");
    expect(createCompletionMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to raw text when the formatter answers like an assistant", async () => {
    createCompletionMock
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: "I'll review the transcript. Please provide the raw transcript, and I'll format it according to the rules."
            }
          }
        ]
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: "I'll review the transcript. Please provide the raw transcript, and I'll format it according to the rules."
            }
          }
        ]
      });

    const { formatTranscript } = await import("@main/formatting");
    const rawText = "I got the formatting working. However, there is a problem. I didn't just say project checklist at start.";
    const result = await formatTranscript("test-key", rawText);

    expect(result).toBe(rawText);
    expect(createCompletionMock).toHaveBeenCalledTimes(2);
  });

  it("rejects assistant-style replies that start with 'I will format'", async () => {
    createCompletionMock
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: "I will format the transcript as requested. Please provide the raw transcript."
            }
          }
        ]
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: "I will format the transcript as requested. Please provide the raw transcript."
            }
          }
        ]
      });

    const { formatTranscript } = await import("@main/formatting");
    const rawText = "A few bugs that are still not resolved. Number 1. The text is not formatted correctly.";
    const result = await formatTranscript("test-key", rawText);

    expect(result).toBe(rawText);
    expect(createCompletionMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to raw text when the formatter invents a large template", async () => {
    const hallucinated = "Checklist\n----------\n\n1. Review project timeline\n2. Meet with team to discuss progress\n3. Update project management software\n4. Conduct quality assurance testing\n5. Launch project";
    createCompletionMock
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: hallucinated
            }
          }
        ]
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: hallucinated
            }
          }
        ]
      });

    const { formatTranscript } = await import("@main/formatting");
    const rawText = "There is a few things about my project that I need. It is as following the checklist. Keep UI, fix transcription, and change the AI prompt.";
    const result = await formatTranscript("test-key", rawText);

    expect(result).toBe(rawText);
    expect(createCompletionMock).toHaveBeenCalledTimes(2);
  });
});
