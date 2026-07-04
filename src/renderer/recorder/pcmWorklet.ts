declare const AudioWorkletProcessor: {
  prototype: { port: MessagePort };
  new(): { port: MessagePort };
};

declare function registerProcessor(name: string, processorCtor: typeof AudioWorkletProcessor): void;

class VaaniPcmProcessor extends AudioWorkletProcessor {
  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    const channel = input?.[0];
    if (!channel || channel.length === 0) {
      return true;
    }

    const copy = new Float32Array(channel.length);
    copy.set(channel);
    this.port.postMessage(copy, [copy.buffer]);
    return true;
  }
}

registerProcessor("vaani-pcm-processor", VaaniPcmProcessor);

export {};
