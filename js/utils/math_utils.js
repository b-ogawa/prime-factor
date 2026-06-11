export function bigIntToBytesLE(bigInt) {
    if (bigInt === 0n) return new Uint8Array([0]);

    // Convert to positive, assuming the rust side will either treat it as positive
    // or we normalize it modulo N before calling this function.
    // For general serialization, handle two's complement for negatives up to 256 bits:
    if (bigInt < 0n) {
        // Create 256 bit two's complement representation
        let mask256 = (1n << 256n) - 1n;
        bigInt = (bigInt & mask256);
    }

    let hex = bigInt.toString(16);
    if (hex.length % 2 !== 0) hex = '0' + hex;
    const len = hex.length / 2;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[len - 1 - i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
}

export function bytesToBigIntLE(bytes) {
    let hex = '';
    for (let i = bytes.length - 1; i >= 0; i--) {
        let b = bytes[i].toString(16);
        if (b.length === 1) b = '0' + b;
        hex += b;
    }
    return BigInt('0x' + hex);
}
