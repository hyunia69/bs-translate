// AudioWorkletProcessor: collects mono Float32 samples from input 0 channel 0 and posts them in ~20 ms batches
// (1024 samples @ 48 kHz = ~21 ms). Outputs silence; the graph also ends in a zero-gain node.
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.batch = new Float32Array(1024);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        this.batch[this.filled++] = channel[i];
        if (this.filled === this.batch.length) {
          const out = this.batch;
          this.port.postMessage(out, [out.buffer]);
          this.batch = new Float32Array(1024);
          this.filled = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("pcm-capture", PcmCapture);
