/**
 * Simple Ring Buffer implementation for audio/video packets.
 */
export class RingBuffer {
    constructor(capacity) {
        this.capacity = capacity;
        this.buffer = new Array(capacity);
        this.writePtr = 0;
        this.readPtr = 0;
        this.count = 0;
    }

    push(item) {
        if (this.count >= this.capacity) {
            console.warn('Buffer overflow, dropping packet');
            return false; // Overflow
        }
        this.buffer[this.writePtr] = item;
        this.writePtr = (this.writePtr + 1) % this.capacity;
        this.count++;
        return true;
    }

    pop() {
        if (this.count === 0) return null;
        const item = this.buffer[this.readPtr];
        this.readPtr = (this.readPtr + 1) % this.capacity;
        this.count--;
        return item;
    }

    peek() {
        if (this.count === 0) return null;
        return this.buffer[this.readPtr];
    }

    clear() {
        this.writePtr = 0;
        this.readPtr = 0;
        this.count = 0;
    }

    get length() {
        return this.count;
    }
}
