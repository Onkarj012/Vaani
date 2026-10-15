import { describe, expect, it } from "vitest";
import { addedContentWords, diffContentWords, missingContentWords, preservesContentWords, stripReasoningBlocks } from "../../src/shared/contentGuard";

describe("preservesContentWords", () => {
  it("accepts punctuation and capitalization changes", () => {
    expect(preservesContentWords("hello world", "Hello, world.", [])).toBe(true);
  });

  it("rejects an added negation that flips the meaning", () => {
    expect(preservesContentWords("send the report today", "Do not send the report today.", [])).toBe(false);
    expect(addedContentWords("send the report today", "Do not send the report today.", [])).toEqual(["do", "not"]);
  });

  it("rejects a dropped Devanagari word", () => {
    expect(missingContentWords("मुझे कल ऑफिस जाना है", "मुझे ऑफिस जाना है।", [])).toEqual(["कल"]);
  });

  it("accepts Devanagari punctuation and keeps combining marks with their letters", () => {
    expect(preservesContentWords("मुझे कल ऑफिस जाना है", "मुझे, कल ऑफिस जाना है।", [])).toBe(true);
  });

  it("keeps Hindi compound numbers distinct when written in Roman letters", () => {
    expect(preservesContentWords("तेईस रुपये भेजो।", "Teis rupaye bhejo.")).toBe(true);
    expect(preservesContentWords("तेईस रुपये भेजो।", "Tees rupaye bhejo.")).toBe(false);
    expect(preservesContentWords("पच्चीस रुपये भेजो।", "Pachas rupaye bhejo.")).toBe(false);
    expect(preservesContentWords("सत्ताईस रुपये भेजो।", "Sattais rupaye bhejo.")).toBe(true);
    expect(preservesContentWords("पचहत्तर रुपये भेजो।", "Pachhattar rupaye bhejo.")).toBe(true);
    expect(preservesContentWords("निन्यानवे रुपये भेजो।", "Ninyanve rupaye bhejo.")).toBe(true);
    expect(preservesContentWords("तेईस रुपये भेजो।", "तेईस रुपये भेजो।")).toBe(true);
  });

  it("rejects words moved out of order", () => {
    expect(preservesContentWords("we ship it Tuesday", "Tuesday, we ship it.", [])).toBe(false);
    expect(preservesContentWords("we ship it Tuesday", "We ship it Tuesday.", [])).toBe(true);
  });

  it("rejects a dropped word", () => {
    expect(preservesContentWords("contact Anthropic support", "contact support", [])).toBe(false);
  });

  it("accepts a stutter or repeat that was collapsed, and the repeat kept", () => {
    expect(preservesContentWords("this is very very good", "This is very good.", [])).toBe(true);
    expect(preservesContentWords("so I I tested it", "So I tested it.", [])).toBe(true);
    expect(preservesContentWords("I had had enough", "I had had enough.", [])).toBe(true);
  });

  it("accepts dropped hesitation sounds, cut-off words, and a corrected phrase", () => {
    expect(preservesContentWords("it went mm better hmm", "It went better.", ["mm", "hmm"])).toBe(true);
    expect(preservesContentWords("the formatting is po-- uh, bad", "The formatting is bad.", ["uh"])).toBe(true);
    expect(preservesContentWords("would it ru- run", "Would it run?", [])).toBe(true);
    // Without a hyphen a short word stays: "her" before "here" is a word, not a cut-off.
    expect(preservesContentWords("would it ru run", "Would it run?", [])).toBe(false);
    expect(preservesContentWords("Priyanka, run... Sorry. Priya, run the test again", "Priya, run the test again.", [])).toBe(true);
  });

  it("rejects meaning changes that look like speech noise (Codex review)", () => {
    expect(preservesContentWords("Do not notify Priya.", "Do notify Priya.", [])).toBe(false);
    expect(preservesContentWords("Send no money today.", "Send money today.", [])).toBe(false);
    expect(preservesContentWords("Do not send 500 to Priya. Sorry, I am late.", "I am late.", [])).toBe(false);
    expect(preservesContentWords("What I mean is important.", "Important.", [])).toBe(false);
    expect(preservesContentWords("Do not send, not today.", "Do send today.", [])).toBe(false);
    expect(preservesContentWords("I am not ready, not yet.", "I am ready, not yet.", [])).toBe(false);
    expect(preservesContentWords("Book 11- 12 seats.", "Book 12 seats.", [])).toBe(false);
    expect(preservesContentWords("We met Priya— yesterday.", "We met yesterday.", [])).toBe(false);
  });

  it("rejects the meaning changes Codex found in round 2", () => {
    expect(preservesContentWords("Do not pay 500. Sorry, call Priya.", "Call Priya.", [])).toBe(false);
    expect(preservesContentWords("Write what I mean here.", "Write here.", [])).toBe(false);
    expect(preservesContentWords("No, no, no, send it.", "Send it.", [])).toBe(false);
    expect(preservesContentWords("He said no. No one agreed.", "He said no one agreed.", [])).toBe(false);
    expect(preservesContentWords("Ship it. He said no. No one argued.", "Ship it. No one argued.", [])).toBe(false);
    expect(preservesContentWords("Send her here today.", "Send here today.", [])).toBe(false);
    expect(preservesContentWords("Please record values -1 -10 today.", "Please record values -10 today.", [])).toBe(false);
    expect(preservesContentWords("The PIN is 1 1 2.", "The PIN is 1 2.", [])).toBe(false);
    expect(preservesContentWords("Call Priya-- tomorrow.", "Call tomorrow.", [])).toBe(false);
    expect(preservesContentWords("Use ten mm screws.", "Use ten screws.", ["mm"])).toBe(false);
  });

  it("accepts the owner's corrections and stutters", () => {
    expect(preservesContentWords("Second, Arjun, sorry, Aditya needs to update the pricing page.", "Second, Aditya needs to update the pricing page.", [])).toBe(true);
    expect(preservesContentWords("Second sorry, Aditya needs to update it.", "Second, Aditya needs to update it.", [])).toBe(true);
    expect(preservesContentWords("send me the logs by by Friday no no no Thursday thanks", "Send me the logs by Thursday. Thanks.", [])).toBe(true);
    expect(preservesContentWords("quick update on the, on the release and, and it looks good", "Quick update on the release and it looks good.", [])).toBe(true);
    expect(preservesContentWords("there sh- there are certain times", "There are certain times.", [])).toBe(true);
  });

  it("keeps every word when speech noise is not allowed (cleanup off)", () => {
    expect(diffContentWords("Please send the the report.", "Please send the report.", [], { speechNoise: false }).missing).toEqual(["the"]);
  });

  it("keeps a unit after a number even when it spells a hesitation sound", () => {
    expect(preservesContentWords("Use 10 mm screws.", "Use 10 screws.", ["mm"])).toBe(false);
  });

  it("keeps a plain negation out of the correction cues", () => {
    expect(preservesContentWords("There is no need to restart the server.", "Need to restart the server.", [])).toBe(false);
    expect(missingContentWords("There is no need to restart the server.", "Need to restart the server.", [])).toEqual(["there", "is", "no"]);
    expect(preservesContentWords("Meet at Pune, no, Mumbai.", "Meet at Mumbai.", [])).toBe(true);
  });

  it("rejects a dropped word that is not speech noise", () => {
    expect(missingContentWords("do not send the report", "Send the report.", [])).toEqual(["do", "not"]);
    expect(missingContentWords("send it to John and Mary", "Send it to Mary.", [])).toEqual(["john", "and"]);
    // A correction cue at the very end has no replacement after it, so the run before it stays.
    expect(preservesContentWords("send it to John sorry", "Send it to", [])).toBe(false);
  });

  it("accepts dropping a listed filler", () => {
    expect(preservesContentWords("um hello uh world", "Hello, world.", ["um", "uh"])).toBe(true);
    expect(preservesContentWords("I have twenty um one item", "I have twenty one item.", ["um"])).toBe(true);
    expect(preservesContentWords("you know hello world", "Hello world.", ["you know"])).toBe(true);
  });

  it("rejects dropping a filler that is not listed", () => {
    expect(preservesContentWords("basically hello world", "Hello, world.", [])).toBe(false);
    expect(missingContentWords("basically hello world", "Hello, world.", [])).toEqual(["basically"]);
  });

  it("rejects a filler the output adds", () => {
    expect(preservesContentWords("hello world", "Um, hello world.", ["um"])).toBe(false);
    expect(addedContentWords("hello world", "Um, hello world.", ["um"])).toEqual(["um"]);
  });

  it("accepts number-word to digit conversion", () => {
    expect(preservesContentWords("I have twenty items", "I have 20 items.", [])).toBe(true);
  });

  it("rejects output words when the raw text is empty", () => {
    expect(preservesContentWords("", "anything", [])).toBe(false);
    expect(preservesContentWords("", "...", [])).toBe(true);
  });

  it("accepts a dictated new paragraph turned into a line break", () => {
    expect(preservesContentWords("hello there new paragraph how are you", "Hello there.\n\nHow are you?", [])).toBe(true);
  });

  it("requires the cue words when there is no line break", () => {
    expect(missingContentWords("hello there new paragraph how are you", "Hello there how are you", [])).toEqual(["new", "paragraph"]);
  });

  it("accepts a dictated enumeration formatted as a list", () => {
    expect(preservesContentWords(
      "point one write the report point two send the update",
      "1. Write the report.\n2. Send the update.",
      [],
    )).toBe(true);
  });

  it("requires enumeration cue words when the output has no list", () => {
    expect(preservesContentWords(
      "point one write the report point two send the update",
      "Write the report. Send the update.",
      [],
    )).toBe(false);
  });

  it("reports added content words that are not in the raw text", () => {
    expect(addedContentWords(
      "what is the status",
      "What is the status. The answer is 42.",
      [],
    )).toEqual(["the", "answer", "is", "42"]);
  });

  it("rejects a decimal number split into two numbers", () => {
    expect(preservesContentWords("set ratio to 1.5", "Set ratio to 1.5.", [])).toBe(true);
    expect(preservesContentWords("set ratio to 1.5", "Set ratio to 1 5.", [])).toBe(false);
    expect(missingContentWords("set ratio to 1.5", "Set ratio to 1 5.", [])).toEqual(["1.5"]);
  });

  it("keeps thousands separators and times whole", () => {
    expect(preservesContentWords("pay 1,000 at 10:30", "Pay 1,000 at 10:30.", [])).toBe(true);
    expect(preservesContentWords("pay 1,000 at 10:30", "Pay 1 000 at 10:30.", [])).toBe(false);
  });

  it("rejects a compound spelled number split into digits", () => {
    expect(preservesContentWords("I have twenty one items", "I have twenty one items.", [])).toBe(true);
    expect(preservesContentWords("I have twenty one items", "I have 20 1 items.", [])).toBe(false);
  });

  it("rejects a dictated number dropped from a list that the output numbers", () => {
    const raw = "I bought a number two pencil point one write the report point two send it";
    expect(preservesContentWords(raw, "I bought a pencil.\n1. Write the report.\n2. Send it.", [])).toBe(false);
    expect(missingContentWords(raw, "I bought a pencil.\n1. Write the report.\n2. Send it.", [])).toEqual(["number", "two"]);
  });

  it("accepts dictated bullet points formatted as a bullet list", () => {
    expect(preservesContentWords(
      "bullet point milk bullet point eggs",
      "- Milk\n- Eggs",
      [],
    )).toBe(true);
  });

  it("rejects a line break the output places away from the cue", () => {
    expect(preservesContentWords("hello there new paragraph how are you", "Hello there how are you?\n\n", [])).toBe(false);
  });

  it("does not read a version number split by a list marker as a cue", () => {
    expect(preservesContentWords("use version number 1.5", "Use version\n1. 5.", [])).toBe(false);
    expect(preservesContentWords("use version number 1.5", "Use version number 1.5.", [])).toBe(true);
  });

  it("keeps a sign in a number", () => {
    expect(preservesContentWords("temperature is -10", "Temperature is 10.", [])).toBe(false);
    expect(preservesContentWords("temperature is -10", "Temperature is -10.", [])).toBe(true);
  });

  it("keeps a leading decimal point in a number", () => {
    expect(preservesContentWords("dose is .5 mg", "Dose is 5 mg.", [])).toBe(false);
    expect(preservesContentWords("dose is .5 mg", "Dose is .5 mg.", [])).toBe(true);
  });

  it("does not treat a word hyphen as a sign", () => {
    expect(preservesContentWords("the COVID-19 rule", "The COVID -19 rule.", [])).toBe(false);
    expect(preservesContentWords("the COVID-19 rule", "The COVID-19 rule.", [])).toBe(true);
  });

  it("accepts a spoken cue that the output keeps as words", () => {
    expect(preservesContentWords("I bought a number two pencil", "I bought a number two pencil.", [])).toBe(true);
    expect(preservesContentWords("hello there new paragraph how are you", "Hello there new paragraph how are you.", [])).toBe(true);
  });

  it("exempts a filler phrase only when the output drops all of it", () => {
    expect(preservesContentWords("you know the answer", "You the answer.", ["you know"])).toBe(false);
    expect(missingContentWords("you know the answer", "You the answer.", ["you know"])).toEqual(["know"]);
    expect(preservesContentWords("you know the answer", "You know the answer.", ["you know"])).toBe(true);
    expect(preservesContentWords("you know hello world", "Hello world.", ["you know"])).toBe(true);
  });

  it("accepts a dropped filler phrase that shares a word with the kept text", () => {
    expect(preservesContentWords("you know you are right", "You are right.", ["you know"])).toBe(true);
  });

  it("keeps the fast path for a long transcript with fillers at both ends", () => {
    const body = Array.from({ length: 1_100 }, (_, index) => `word${index}`).join(" ");
    const raw = `um you know ${body} uh`;
    const formatted = `Um you know ${body} uh.`.replace("word0", "Word0");
    expect(diffContentWords(raw, formatted, ["um", "uh", "you know"])).toEqual({ missing: [], added: [] });
    expect(preservesContentWords(`you know ${body} you know`, `${body}.`, ["you know"])).toBe(true);
  });

  it("keeps the minus sign on a currency amount", () => {
    expect(preservesContentWords("the balance is -$10", "The balance is $10.", [])).toBe(false);
    expect(preservesContentWords("the balance is $10", "The balance is $10.", [])).toBe(true);
    expect(preservesContentWords("the balance is $-10", "The balance is -$10.", [])).toBe(true);
  });

  it("verifies a long unchanged transcript without a full alignment table", () => {
    const words = Array.from({ length: 5_000 }, (_, index) => `word${index}`).join(" ");
    expect(preservesContentWords(words, words, [])).toBe(true);
    const changed = [...words.split(" ").slice(0, 2_500), "changed", ...words.split(" ").slice(2_501)].join(" ");
    expect(missingContentWords(words, changed, [])).toEqual(["word2500"]);
    expect(addedContentWords(words, changed, [])).toEqual(["changed"]);
  });

  it("rejects a diff too large to align", () => {
    const raw = Array.from({ length: 1_001 }, (_, index) => `alpha${index}`).join(" ");
    const candidate = Array.from({ length: 1_001 }, (_, index) => `beta${index}`).join(" ");
    expect(diffContentWords(raw, candidate, []).rejection).toBe("Transcript too long to verify formatting.");
    expect(preservesContentWords(raw, candidate, [])).toBe(false);
  });
});

describe("stripReasoningBlocks", () => {
  it("removes closed reasoning blocks", () => {
    expect(stripReasoningBlocks("<think>I will drop words</think>Send the report today.")).toBe("Send the report today.");
  });

  it("removes an unclosed reasoning block to the end", () => {
    expect(stripReasoningBlocks("Send the report <thinking>maybe")).toBe("Send the report");
  });
});
