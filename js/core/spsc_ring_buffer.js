const CAPACITY = 1048576; // 1MB (2^20)
const MASK = 0xFFFFF; // 1MB - 1

export class SPSCRingBuffer {
    /**
     * @param {SharedArrayBuffer} sharedArrayBuffer
     */
    constructor(sharedArrayBuffer) {
        this.sab = sharedArrayBuffer;
        // Header:
        // [0]: head (Int32, Consumer index)
        // [1]: tail (Int32, Producer index)
        // [2]: abort (Int32, Abort flag, 0=running, 1=aborted)
        // [3]: reserved
        this.header = new Int32Array(this.sab, 0, 4);
        this.data = new Uint8Array(this.sab, 16, CAPACITY);
    }

    /**
     * Write data to the ring buffer. Blocks (via Atomics.wait) if there is not enough space.
     * Only used by the Producer (Worker).
     * @param {Uint8Array} dataBytes
     * @returns {boolean} True if write succeeded, false if aborted.
     */
    write(dataBytes) {
        const len = dataBytes.byteLength;
        const totalLen = len + 4; // Prepend 4 bytes for length prefix

        if (totalLen > CAPACITY - 1) {
            throw new Error(`Data is too large for the ring buffer (size: ${totalLen}, capacity: ${CAPACITY - 1})`);
        }

        while (true) {
            if (this.isAborted()) {
                return false;
            }

            const head = Atomics.load(this.header, 0);
            const tail = Atomics.load(this.header, 1);
            const used = (tail - head) >>> 0;
            const freeSpace = CAPACITY - used;

            // We must leave at least 1 byte free to distinguish empty vs full
            if (freeSpace >= totalLen + 1) {
                // Write length prefix (4 bytes)
                const lenBytes = new Uint8Array(new Uint32Array([len]).buffer);
                this._writeRaw(tail, lenBytes);

                // Write actual data
                this._writeRaw(tail + 4, dataBytes);

                // Update tail with memory fence
                const newTail = (tail + totalLen) | 0;
                Atomics.store(this.header, 1, newTail);
                Atomics.notify(this.header, 1);
                return true;
            }

            // Wait for Consumer (UI thread) to read and advance head
            // Atomics.wait will block the worker thread efficiently
            Atomics.wait(this.header, 0, head, 10);
        }
    }

    /**
     * Try to read one complete frame from the ring buffer.
     * Only used by the Consumer (UI Thread).
     * @param {Uint8Array} destWasmBuffer
     * @returns {number} The length of the read frame in bytes, or 0 if no complete frame is available.
     */
    readFrame(destWasmBuffer) {
        const head = Atomics.load(this.header, 0);
        const tail = Atomics.load(this.header, 1);
        const used = (tail - head) >>> 0;

        if (used < 4) {
            return 0; // Not even the length prefix has arrived
        }

        // Read 4-byte length prefix
        const lenBytes = this._readRaw(head, 4);
        const len = new Uint32Array(lenBytes.buffer)[0];

        if (used < 4 + len) {
            return 0; // The entire frame has not been written yet
        }

        if (destWasmBuffer.byteLength < len) {
            throw new Error(`Destination buffer too small (dest: ${destWasmBuffer.byteLength}, data: ${len})`);
        }

        // Read data frame directly into destination buffer
        this._readRawInto(head + 4, destWasmBuffer.subarray(0, len));

        // Advance head
        const newHead = (head + 4 + len) | 0;
        Atomics.store(this.header, 0, newHead);

        // Notify Producer in case it is waiting
        Atomics.notify(this.header, 0);

        return len;
    }

    /**
     * Check if the execution is aborted.
     * @returns {boolean}
     */
    isAborted() {
        return Atomics.load(this.header, 2) === 1;
    }

    /**
     * Trigger abort status.
     */
    setAbort() {
        Atomics.store(this.header, 2, 1);
        Atomics.notify(this.header, 2);
    }

    /**
     * Reset the buffer header.
     */
    reset() {
        Atomics.store(this.header, 0, 0);
        Atomics.store(this.header, 1, 0);
        Atomics.store(this.header, 2, 0);
    }

    /**
     * @private
     */
    _writeRaw(offset, bytes) {
        const len = bytes.length;
        const startIdx = offset & MASK;
        if (startIdx + len <= CAPACITY) {
            this.data.set(bytes, startIdx);
        } else {
            const firstPart = CAPACITY - startIdx;
            this.data.set(bytes.subarray(0, firstPart), startIdx);
            this.data.set(bytes.subarray(firstPart), 0);
        }
    }

    /**
     * @private
     */
    _readRaw(offset, len) {
        const startIdx = offset & MASK;
        const bytes = new Uint8Array(len);
        if (startIdx + len <= CAPACITY) {
            bytes.set(this.data.subarray(startIdx, startIdx + len));
        } else {
            const firstPart = CAPACITY - startIdx;
            bytes.set(this.data.subarray(startIdx, CAPACITY), 0);
            bytes.set(this.data.subarray(0, len - firstPart), firstPart);
        }
        return bytes;
    }

    /**
     * @private
     */
    _readRawInto(offset, dest) {
        const len = dest.length;
        const startIdx = offset & MASK;
        if (startIdx + len <= CAPACITY) {
            dest.set(this.data.subarray(startIdx, startIdx + len));
        } else {
            const firstPart = CAPACITY - startIdx;
            dest.set(this.data.subarray(startIdx, CAPACITY), 0);
            dest.set(this.data.subarray(0, len - firstPart), firstPart);
        }
    }
}
